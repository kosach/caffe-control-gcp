import { Request, Response } from '@google-cloud/functions-framework';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { connectToDatabase, getSecret } from '../../utils/mongodb';

/**
 * Official Poster webhook actions
 * @see https://dev.joinposter.com/docs/v3/web/webhooks
 */
type PosterAction = 'added' | 'changed' | 'removed' | 'transformed';

/**
 * Transaction history entry structure from Poster
 * Based on real webhook data
 */
interface TransactionHistory {
  type_history: string;
  time: number;
  value: number | string;
  value2: number | string;
  value3: number | string;
  value4: number | string;
  value5: number | string | null;
  value_text: string; // Can be JSON string with product details
  user_id: number;
  spot_tablet_id: number;
}

/**
 * Transaction data structure (nested in webhook.data field)
 */
interface TransactionData {
  transactions_history?: TransactionHistory;
  status?: string;
  payed_sum?: string;
  [key: string]: unknown; // Allow additional fields
}

/**
 * Poster API response for finance.getTransaction
 * @see https://dev.joinposter.com/docs/v3/web/finance/getTransaction
 */
interface PosterTransactionResponse {
  response: {
    transaction_id: string;
    account_id: string;
    user_id: string;
    category_id: string;
    type: string;
    amount: string;
    balance: string;
    date: string;
    recipient_type: string;
    recipient_id: string;
    binding_type: string;
    binding_id: string;
    comment: string;
    delete: string;
    account_name: string;
    category_name: string;
    currency_symbol: string;
    [key: string]: unknown;
  };
}

/**
 * Official Poster Webhook Format
 * Based on Poster API documentation
 * @see https://dev.joinposter.com/docs/v3/web/webhooks
 */
interface PosterWebhook {
  /** Client account that created the event */
  account: string;
  /** Account number that created the event */
  account_number: string;
  /** Entity for which the webhook was received (e.g., "transaction", "product", "client") */
  object: string;
  /** Primary key of the object */
  object_id: number;
  /** Action performed: added, changed, removed, transformed */
  action: PosterAction;
  /** Webhook sending time in Unix timestamp */
  time: string;
  /** Request signature: md5(account;object;object_id;action;data;time;secret) */
  verify: string;
  /** Additional parameter - JSON string or object with transaction data */
  data?: string | TransactionData;
}

/**
 * MongoDB document structure for poster-hooks-data collection
 * Stores complete webhook body at root level + metadata
 */
interface RawHookDocument extends Partial<PosterWebhook> {
  _id?: ObjectId;
  // Metadata separated from webhook data
  metadata: {
    received_at: Date;
    query_params: Record<string, unknown>;
    processed: boolean;
    processed_at: Date | null;
    saved_to_transactions: boolean;
    processing_error: string | null;
    error_time: Date | null;
  };
  // All webhook fields are spread at root level
  [key: string]: unknown;
}

/** Official Poster webhook actions */
const ALLOWED_ACTIONS: PosterAction[] = ['added', 'changed', 'removed', 'transformed'];

/**
 * Fetch full transaction data from Poster API
 */
async function fetchPosterTransaction(
  transactionId: number,
  posterToken: string
): Promise<PosterTransactionResponse['response'] | null> {
  try {
    const url = `https://joinposter.com/api/finance.getTransaction?token=${posterToken}&transaction_id=${transactionId}`;

    console.log('🔍 Fetching transaction from Poster API:', transactionId);

    const response = await axios.get<PosterTransactionResponse>(url, {
      timeout: 10000 // 10 second timeout
    });

    if (response.data && response.data.response) {
      console.log('✅ Poster API data fetched successfully');
      return response.data.response;
    }

    console.warn('⚠️ Poster API returned empty response');
    return null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Poster API request failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
    } else {
      console.error('❌ Poster API request failed:', error);
    }
    return null;
  }
}

function parsePayload(body: unknown): PosterWebhook {
  if (!body) {
    throw new Error('Empty request body');
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as PosterWebhook;
    } catch {
      throw new Error('Invalid JSON payload');
    }
  }

  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8')) as PosterWebhook;
    } catch {
      throw new Error('Invalid JSON payload');
    }
  }

  return body as PosterWebhook;
}

/**
 * Parse nested data field from Poster webhook
 * The data field can be a JSON string or already parsed object
 */
function parseWebhookData(data: string | TransactionData | undefined): TransactionData {
  if (!data) {
    return {};
  }

  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as TransactionData;
    } catch (parseError) {
      console.warn('⚠️ Failed to parse data string, storing as raw');
      return { raw_data_string: data };
    }
  }

  return data;
}

function snapshotBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }

  if (body && typeof body === 'object') {
    try {
      return JSON.parse(JSON.stringify(body));
    } catch {
      return body;
    }
  }

  return body ?? null;
}

function snapshotQuery(query: Request['query']): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  Object.entries(query ?? {}).forEach(([key, value]) => {
    result[key] = Array.isArray(value) ? [...value] : value;
  });

  return result;
}

export async function webhook(req: Request, res: Response) {
  try {
    if (req.method !== 'POST') {
      console.warn('⚠️ Unsupported method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('🔔 Webhook request received');

    const apiKeyParam = req.query['api-key'];
    const apiKey = Array.isArray(apiKeyParam) ? apiKeyParam[0] : apiKeyParam;

    const validKey = await getSecret('poster-hook-api-key');

    if (!apiKey || apiKey !== validKey) {
      console.warn('⚠️ Invalid or missing API key');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ API key validated');

    const { db } = await connectToDatabase();
    const rawHooksCollection = db.collection<RawHookDocument>('poster-hooks-data');
    const transactionsCollection = db.collection('transactions');

    const receivedAt = new Date();

    // Store the complete raw webhook body at root level + metadata
    const rawBodySnapshot = snapshotBody(req.body);
    const rawDocument: RawHookDocument = {
      // Spread the entire webhook body at root level
      ...(typeof rawBodySnapshot === 'object' && rawBodySnapshot !== null
        ? rawBodySnapshot as Record<string, unknown>
        : { raw_body_string: rawBodySnapshot }),
      // Add metadata
      metadata: {
        received_at: receivedAt,
        query_params: snapshotQuery(req.query),
        processed: false,
        processed_at: null,
        saved_to_transactions: false,
        processing_error: null,
        error_time: null
      }
    };

    let rawHookId: ObjectId;

    try {
      const insertResult = await rawHooksCollection.insertOne(rawDocument);
      rawHookId = insertResult.insertedId;
      console.log('📝 RAW webhook stored:', rawHookId.toHexString());
    } catch (error) {
      console.error('❌ Failed to store RAW webhook:', error);
      return res.status(500).json({
        error: 'Processing failed',
        message: 'Unexpected error'
      });
    }

    const markRawError = async (message: string) => {
      try {
        await rawHooksCollection.updateOne(
          { _id: rawHookId },
          {
            $set: {
              'metadata.processing_error': message,
              'metadata.error_time': new Date()
            }
          }
        );
      } catch (updateError) {
        console.error('⚠️ Failed to record RAW webhook error:', updateError);
      }
    };

    let webhook: PosterWebhook;

    try {
      webhook = parsePayload(req.body);
    } catch (parseError) {
      const details =
        parseError instanceof Error ? parseError.message : 'Invalid payload';
      await markRawError(details);
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    console.log('📦 Poster webhook:', {
      object: webhook.object,
      object_id: webhook.object_id,
      action: webhook.action,
      account: webhook.account
    });

    // Validate required fields
    if (!webhook.action) {
      const details = 'Missing required field: action';
      await markRawError(details);
      console.warn('⚠️ Missing action field');
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    if (!ALLOWED_ACTIONS.includes(webhook.action)) {
      const details = `Invalid action: ${webhook.action}. Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
      await markRawError(details);
      console.warn('⚠️ Invalid action:', webhook.action);
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    if (!webhook.object_id) {
      const details = 'Missing required field: object_id';
      await markRawError(details);
      console.warn('⚠️ Missing object_id field');
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    const transactionId = webhook.object_id;
    const parsedData = parseWebhookData(webhook.data);
    const timestampIso = receivedAt.toISOString();

    console.log('✅ Webhook validated:', {
      action: webhook.action,
      object_id: transactionId,
      raw_hook_id: rawHookId.toHexString()
    });

    // Only save to transactions collection if action is 'changed' (transaction completed)
    let savedToTransactions = false;

    if (webhook.action === 'changed') {
      try {
        // Fetch full transaction data from Poster API
        const posterToken = await getSecret('poster-token');
        const posterApiData = await fetchPosterTransaction(transactionId, posterToken);

        // Store ONLY Poster API transaction data if available
        if (posterApiData) {
          // Use Poster API's transaction_id (string) as the unique key
          await transactionsCollection.updateOne(
            { transaction_id: posterApiData.transaction_id },
            { $set: posterApiData },
            { upsert: true }
          );
          savedToTransactions = true;
          console.log('✅ Transaction saved:', posterApiData.transaction_id);
        } else {
          console.warn('⚠️ Poster API data not available, skipping transaction save');
        }
      } catch (dbError) {
        const details =
          dbError instanceof Error ? dbError.message : 'Database error';
        await markRawError(details);
        console.error('❌ Failed to save transaction:', dbError);
        return res.status(500).json({
          error: 'Processing failed',
          message: 'Unexpected error'
        });
      }
    } else {
      console.log(
        `ℹ️ Action "${webhook.action}" - RAW saved, transaction not persisted`
      );
    }

    try {
      await rawHooksCollection.updateOne(
        { _id: rawHookId },
        {
          $set: {
            'metadata.processed': true,
            'metadata.processed_at': new Date(),
            'metadata.saved_to_transactions': savedToTransactions,
            'metadata.processing_error': null,
            'metadata.error_time': null
          }
        }
      );
    } catch (updateError) {
      console.error('⚠️ Failed to mark RAW webhook as processed:', updateError);
    }

    console.log('✅ Webhook processing completed:', {
      object_id: transactionId,
      action: webhook.action,
      saved_to_transactions: savedToTransactions
    });

    return res.status(200).json({
      success: true,
      object_id: transactionId,
      action: webhook.action,
      saved_to_transactions: savedToTransactions,
      raw_hook_id: rawHookId.toHexString()
    });
  } catch (error) {
    console.error('❌ Webhook processing failed:', error);
    return res.status(500).json({
      error: 'Processing failed',
      message: 'Unexpected error'
    });
  }
}
