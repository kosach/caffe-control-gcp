/**
 * Migration script: MongoDB → Firestore
 *
 * Migrates all data from MongoDB to Firestore for:
 * - transactions collection
 * - poster-hooks-data collection
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-firestore.ts [--dry-run] [--collection=transactions|hooks|all]
 *
 * Environment variables:
 *   MONGODB_URI - MongoDB connection string
 *   GCP_PROJECT_ID - Google Cloud project ID (default: caffe-control-prod)
 */

import { MongoClient, Document } from 'mongodb';
import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const BATCH_SIZE = 500; // Firestore batch limit
const COLLECTIONS_TO_MIGRATE = {
  transactions: {
    mongoCollection: 'transactions',
    firestoreCollection: 'transactions',
    idField: 'transaction_id'
  },
  hooks: {
    mongoCollection: 'poster-hooks-data',
    firestoreCollection: 'poster-hooks-data',
    idField: null // Use auto-generated ID
  }
};

interface MigrationStats {
  collection: string;
  totalDocuments: number;
  migratedDocuments: number;
  skippedDocuments: number;
  errors: number;
  durationMs: number;
}

interface MigrationOptions {
  dryRun: boolean;
  collections: ('transactions' | 'hooks' | 'all')[];
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    dryRun: false,
    collections: ['all']
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--collection=')) {
      const value = arg.split('=')[1];
      if (value === 'all' || value === 'transactions' || value === 'hooks') {
        options.collections = [value];
      }
    }
  }

  return options;
}

function convertToFirestoreDoc(doc: Document): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id') continue; // Skip MongoDB _id

    if (value && typeof value === 'object') {
      if (value.constructor && value.constructor.name === 'ObjectId') {
        result[key] = value.toString();
      } else if (value instanceof Date) {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.map(item =>
          item && typeof item === 'object' ? convertToFirestoreDoc(item) : item
        );
      } else {
        result[key] = convertToFirestoreDoc(value);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

async function migrateCollection(
  mongoClient: MongoClient,
  firestore: Firestore,
  collectionConfig: typeof COLLECTIONS_TO_MIGRATE.transactions,
  options: MigrationOptions
): Promise<MigrationStats> {
  const startTime = Date.now();
  const stats: MigrationStats = {
    collection: collectionConfig.mongoCollection,
    totalDocuments: 0,
    migratedDocuments: 0,
    skippedDocuments: 0,
    errors: 0,
    durationMs: 0
  };

  console.log(`\n📦 Migrating collection: ${collectionConfig.mongoCollection}`);

  const db = mongoClient.db('easy-control');
  const mongoCollection = db.collection(collectionConfig.mongoCollection);
  const firestoreCollection = firestore.collection(collectionConfig.firestoreCollection);

  // Get total count
  stats.totalDocuments = await mongoCollection.countDocuments();
  console.log(`   Total documents: ${stats.totalDocuments}`);

  if (options.dryRun) {
    console.log('   [DRY RUN] Would migrate all documents');
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  // Process in batches using cursor
  const cursor = mongoCollection.find({});
  let batch = firestore.batch();
  let batchCount = 0;
  let processedCount = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;

    processedCount++;

    try {
      const firestoreDoc = convertToFirestoreDoc(doc);

      // Determine document ID
      let docId: string;
      if (collectionConfig.idField && doc[collectionConfig.idField]) {
        docId = String(doc[collectionConfig.idField]);
      } else {
        docId = doc._id?.toString() || firestore.collection('temp').doc().id;
      }

      const docRef = firestoreCollection.doc(docId);
      batch.set(docRef, firestoreDoc);
      batchCount++;

      // Commit batch when reaching limit
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        stats.migratedDocuments += batchCount;
        console.log(`   Progress: ${stats.migratedDocuments}/${stats.totalDocuments} (${Math.round(stats.migratedDocuments / stats.totalDocuments * 100)}%)`);
        batch = firestore.batch();
        batchCount = 0;
      }
    } catch (error) {
      stats.errors++;
      console.error(`   Error migrating document ${doc._id}:`, error);
    }
  }

  // Commit remaining documents
  if (batchCount > 0) {
    await batch.commit();
    stats.migratedDocuments += batchCount;
  }

  await cursor.close();

  stats.durationMs = Date.now() - startTime;
  console.log(`   ✅ Completed: ${stats.migratedDocuments} migrated, ${stats.errors} errors`);

  return stats;
}

async function verifyMigration(
  mongoClient: MongoClient,
  firestore: Firestore,
  collectionConfig: typeof COLLECTIONS_TO_MIGRATE.transactions
): Promise<boolean> {
  console.log(`\n🔍 Verifying collection: ${collectionConfig.mongoCollection}`);

  const db = mongoClient.db('easy-control');
  const mongoCollection = db.collection(collectionConfig.mongoCollection);
  const firestoreCollection = firestore.collection(collectionConfig.firestoreCollection);

  const mongoCount = await mongoCollection.countDocuments();

  // Count Firestore documents (limited approach for large collections)
  const firestoreSnapshot = await firestoreCollection.count().get();
  const firestoreCount = firestoreSnapshot.data().count;

  console.log(`   MongoDB: ${mongoCount} documents`);
  console.log(`   Firestore: ${firestoreCount} documents`);

  if (mongoCount === firestoreCount) {
    console.log('   ✅ Counts match!');
    return true;
  } else {
    console.log(`   ⚠️ Count mismatch: diff = ${Math.abs(mongoCount - firestoreCount)}`);
    return false;
  }
}

async function main() {
  const options = parseArgs();

  console.log('🚀 MongoDB → Firestore Migration');
  console.log('================================');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Collections: ${options.collections.join(', ')}`);

  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI environment variable is required');
    process.exit(1);
  }

  console.log('\n🔌 Connecting to MongoDB...');
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  console.log('   ✅ Connected');

  // Connect to Firestore
  console.log('🔌 Connecting to Firestore...');
  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });
  console.log('   ✅ Connected');

  const allStats: MigrationStats[] = [];

  try {
    // Determine which collections to migrate
    const collectionsToProcess: (keyof typeof COLLECTIONS_TO_MIGRATE)[] = [];

    if (options.collections.includes('all')) {
      collectionsToProcess.push('transactions', 'hooks');
    } else {
      if (options.collections.includes('transactions')) {
        collectionsToProcess.push('transactions');
      }
      if (options.collections.includes('hooks')) {
        collectionsToProcess.push('hooks');
      }
    }

    // Migrate each collection
    for (const collectionKey of collectionsToProcess) {
      const config = COLLECTIONS_TO_MIGRATE[collectionKey];
      const stats = await migrateCollection(mongoClient, firestore, config, options);
      allStats.push(stats);
    }

    // Verify migration (only in live mode)
    if (!options.dryRun) {
      console.log('\n📊 Verification');
      console.log('===============');

      for (const collectionKey of collectionsToProcess) {
        const config = COLLECTIONS_TO_MIGRATE[collectionKey];
        await verifyMigration(mongoClient, firestore, config);
      }
    }

    // Print summary
    console.log('\n📈 Migration Summary');
    console.log('====================');

    for (const stats of allStats) {
      console.log(`\n${stats.collection}:`);
      console.log(`   Total: ${stats.totalDocuments}`);
      console.log(`   Migrated: ${stats.migratedDocuments}`);
      console.log(`   Errors: ${stats.errors}`);
      console.log(`   Duration: ${(stats.durationMs / 1000).toFixed(1)}s`);
    }

  } finally {
    await mongoClient.close();
    console.log('\n✅ Migration complete');
  }
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
