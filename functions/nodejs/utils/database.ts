import { Db, ObjectId, Filter, UpdateFilter, Document } from 'mongodb';
import { Firestore, WriteBatch, FieldPath } from '@google-cloud/firestore';
import { connectToDatabase } from './mongodb';
import { getFirestore } from './firestore';

/**
 * Database configuration controlled by environment variables
 *
 * ENABLE_FIRESTORE: 'true' | 'false' - Enable writes to Firestore (default: true)
 * ENABLE_MONGODB: 'true' | 'false' - Enable writes to MongoDB (default: true)
 * READ_FROM: 'mongodb' | 'firestore' - Which database to read from (default: mongodb)
 */
interface DatabaseConfig {
  enableFirestore: boolean;
  enableMongoDB: boolean;
  readFrom: 'mongodb' | 'firestore';
}

function getConfig(): DatabaseConfig {
  return {
    enableFirestore: process.env.ENABLE_FIRESTORE !== 'false',
    enableMongoDB: process.env.ENABLE_MONGODB !== 'false',
    readFrom: (process.env.READ_FROM as 'mongodb' | 'firestore') || 'mongodb'
  };
}

/**
 * Query options for find operations
 */
interface FindOptions {
  limit?: number;
}

/**
 * Date range query filter
 */
interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

/**
 * Result of insertMany operation
 */
interface InsertManyResult {
  insertedCount: number;
  duplicateCount: number;
}

/**
 * Metadata for raw hooks
 */
interface HookMetadata {
  received_at: Date;
  processed: boolean;
  processed_at: Date | null;
  saved_to_transactions: boolean;
  processing_error: string | null;
  error_time: Date | null;
}

/**
 * Raw hook document structure
 */
interface RawHookDocument {
  _id?: ObjectId;
  metadata: HookMetadata;
  [key: string]: unknown;
}

// Firestore batch size limit
const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Database abstraction layer supporting dual-write to MongoDB and Firestore
 */
class DatabaseAbstraction {
  private mongoDb: Db | null = null;
  private firestore: Firestore | null = null;

  /**
   * Initialize database connections
   */
  async init(): Promise<void> {
    const config = getConfig();

    if (config.enableMongoDB || config.readFrom === 'mongodb') {
      const { db } = await connectToDatabase();
      this.mongoDb = db;
    }

    if (config.enableFirestore || config.readFrom === 'firestore') {
      this.firestore = getFirestore();
    }
  }

  /**
   * Transactions collection operations
   */
  transactions = {
    /**
     * Find transactions with optional date range filter
     */
    find: async (filter: DateRangeFilter, options: FindOptions = {}): Promise<Document[]> => {
      await this.ensureInit();
      const config = getConfig();
      const limit = options.limit || 100;

      if (config.readFrom === 'firestore') {
        return this.findFromFirestore('transactions', filter, limit);
      } else {
        return this.findFromMongoDB('transactions', filter, limit);
      }
    },

    /**
     * Insert single transaction (upsert by transaction_id)
     */
    upsert: async (transactionId: string, data: Document): Promise<void> => {
      await this.ensureInit();
      const config = getConfig();

      const operations: Promise<void>[] = [];

      if (config.enableMongoDB && this.mongoDb) {
        operations.push(this.upsertMongoDB('transactions', { transaction_id: transactionId }, data));
      }

      if (config.enableFirestore && this.firestore) {
        operations.push(this.upsertFirestore('transactions', transactionId, data));
      }

      await Promise.all(operations);
    },

    /**
     * Insert many transactions (bulk insert with duplicate handling)
     */
    insertMany: async (documents: Document[]): Promise<InsertManyResult> => {
      await this.ensureInit();
      const config = getConfig();

      let mongoResult: InsertManyResult = { insertedCount: 0, duplicateCount: 0 };
      let firestoreResult: InsertManyResult = { insertedCount: 0, duplicateCount: 0 };

      const operations: Promise<void>[] = [];

      if (config.enableMongoDB && this.mongoDb) {
        operations.push(
          this.insertManyMongoDB('transactions', documents).then(result => {
            mongoResult = result;
          })
        );
      }

      if (config.enableFirestore && this.firestore) {
        operations.push(
          this.insertManyFirestore('transactions', documents, 'transaction_id').then(result => {
            firestoreResult = result;
          })
        );
      }

      await Promise.all(operations);

      // Return MongoDB result as primary (since it's source of truth during dual-write)
      return config.enableMongoDB ? mongoResult : firestoreResult;
    }
  };

  /**
   * Raw hooks collection operations
   */
  rawHooks = {
    /**
     * Insert raw webhook document
     * Note: MongoDB is inserted first to get the ID, then Firestore uses the same ID
     */
    insertOne: async (document: RawHookDocument): Promise<string> => {
      await this.ensureInit();
      const config = getConfig();

      let insertedId = '';

      // MongoDB must be inserted first to get the canonical ID
      if (config.enableMongoDB && this.mongoDb) {
        const collection = this.mongoDb.collection<RawHookDocument>('poster-hooks-data');
        const result = await collection.insertOne(document);
        insertedId = result.insertedId.toHexString();
      }

      // If MongoDB is disabled, generate an ID for Firestore
      if (!insertedId) {
        insertedId = new ObjectId().toHexString();
      }

      // Use the same ID for Firestore to ensure updateOne can find it later
      if (config.enableFirestore && this.firestore) {
        await this.firestore.collection('poster-hooks-data').doc(insertedId).set(
          this.convertToFirestoreDoc(document)
        );
      }

      return insertedId;
    },

    /**
     * Update raw hook document by ID
     */
    updateOne: async (id: string, update: Partial<RawHookDocument>): Promise<void> => {
      await this.ensureInit();
      const config = getConfig();

      const operations: Promise<void>[] = [];

      if (config.enableMongoDB && this.mongoDb) {
        operations.push(
          (async () => {
            const collection = this.mongoDb!.collection<RawHookDocument>('poster-hooks-data');
            await collection.updateOne(
              { _id: new ObjectId(id) },
              { $set: update }
            );
          })()
        );
      }

      if (config.enableFirestore && this.firestore) {
        operations.push(
          (async () => {
            // For Firestore, we need to handle the nested metadata update differently
            const firestoreUpdate = this.flattenForFirestoreUpdate(update);
            await this.firestore!.collection('poster-hooks-data').doc(id).update(firestoreUpdate);
          })()
        );
      }

      await Promise.all(operations);
    }
  };

  // Private helper methods

  private async ensureInit(): Promise<void> {
    const config = getConfig();

    if ((config.enableMongoDB || config.readFrom === 'mongodb') && !this.mongoDb) {
      const { db } = await connectToDatabase();
      this.mongoDb = db;
    }

    if ((config.enableFirestore || config.readFrom === 'firestore') && !this.firestore) {
      this.firestore = getFirestore();
    }
  }

  private async findFromMongoDB(collection: string, filter: DateRangeFilter, limit: number): Promise<Document[]> {
    if (!this.mongoDb) throw new Error('MongoDB not initialized');

    const mongoQuery: Filter<Document> = {};

    if (filter.startDate && filter.endDate) {
      mongoQuery.date_close_date = {
        $gte: `${filter.startDate} 00:00:00`,
        $lte: `${filter.endDate} 23:59:59`
      };
    }

    return this.mongoDb
      .collection(collection)
      .find(mongoQuery)
      .limit(limit)
      .toArray();
  }

  private async findFromFirestore(collection: string, filter: DateRangeFilter, limit: number): Promise<Document[]> {
    if (!this.firestore) throw new Error('Firestore not initialized');

    let query = this.firestore.collection(collection) as FirebaseFirestore.Query;

    if (filter.startDate && filter.endDate) {
      query = query
        .where('date_close_date', '>=', `${filter.startDate} 00:00:00`)
        .where('date_close_date', '<=', `${filter.endDate} 23:59:59`);
    }

    const snapshot = await query.limit(limit).get();
    return snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  }

  private async upsertMongoDB(collection: string, filter: Filter<Document>, data: Document): Promise<void> {
    if (!this.mongoDb) throw new Error('MongoDB not initialized');

    await this.mongoDb.collection(collection).updateOne(
      filter,
      { $set: data },
      { upsert: true }
    );
  }

  private async upsertFirestore(collection: string, docId: string, data: Document): Promise<void> {
    if (!this.firestore) throw new Error('Firestore not initialized');

    const firestoreData = this.convertToFirestoreDoc(data);
    await this.firestore.collection(collection).doc(docId).set(firestoreData, { merge: true });
  }

  private async insertManyMongoDB(collection: string, documents: Document[]): Promise<InsertManyResult> {
    if (!this.mongoDb) throw new Error('MongoDB not initialized');

    try {
      const result = await this.mongoDb.collection(collection).insertMany(
        documents,
        { ordered: false }
      );
      return { insertedCount: result.insertedCount, duplicateCount: 0 };
    } catch (err: any) {
      // Handle duplicate key errors (E11000)
      if (err.code === 11000 || err.writeErrors) {
        const duplicateCount = err.writeErrors?.length || 0;
        const insertedCount = err.result?.nInserted || 0;
        return { insertedCount, duplicateCount };
      }
      throw err;
    }
  }

  private async insertManyFirestore(
    collection: string,
    documents: Document[],
    idField: string
  ): Promise<InsertManyResult> {
    if (!this.firestore) throw new Error('Firestore not initialized');

    let insertedCount = 0;
    let duplicateCount = 0;

    // Process in batches of 500
    for (let i = 0; i < documents.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = this.firestore.batch();
      const batchDocs = documents.slice(i, i + FIRESTORE_BATCH_LIMIT);

      for (const doc of batchDocs) {
        const docId = String(doc[idField]);
        const docRef = this.firestore.collection(collection).doc(docId);

        // Check if document exists
        const existing = await docRef.get();
        if (existing.exists) {
          duplicateCount++;
        } else {
          batch.set(docRef, this.convertToFirestoreDoc(doc));
          insertedCount++;
        }
      }

      await batch.commit();
    }

    return { insertedCount, duplicateCount };
  }

  /**
   * Convert MongoDB document to Firestore-compatible format
   * Removes _id field and converts ObjectId to string
   */
  private convertToFirestoreDoc(doc: Document): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(doc)) {
      if (key === '_id') continue; // Skip MongoDB _id

      if (value instanceof ObjectId) {
        result[key] = value.toHexString();
      } else if (value instanceof Date) {
        result[key] = value;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.convertToFirestoreDoc(value as Document);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Flatten nested object for Firestore update
   * Converts { metadata: { processed: true } } to { 'metadata.processed': true }
   */
  private flattenForFirestoreUpdate(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        Object.assign(result, this.flattenForFirestoreUpdate(value as Record<string, unknown>, newKey));
      } else {
        result[newKey] = value;
      }
    }

    return result;
  }
}

// Singleton instance
let dbInstance: DatabaseAbstraction | null = null;

/**
 * Get database abstraction instance
 */
export async function getDatabase(): Promise<DatabaseAbstraction> {
  if (!dbInstance) {
    dbInstance = new DatabaseAbstraction();
    await dbInstance.init();
  }
  return dbInstance;
}

// Export types
export type { DateRangeFilter, FindOptions, InsertManyResult, RawHookDocument, HookMetadata };
