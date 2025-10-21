import { Request, Response } from '@google-cloud/functions-framework';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { connectToDatabase, getSecret } from '../../utils/mongodb';

/**
 * Official Poster webhook actions
 * @see https://dev.joinposter.com/docs/v3/web/webhooks
 */
enum PosterAction {
  Added = 'added',
  Changed = 'changed',
  Removed = 'removed',
  Transformed = 'transformed',
  Closed = 'closed'
}

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
 * Poster API response for dash.getTransaction
 * @see https://dev.joinposter.com/docs/v3/web/dash/getTransaction
 * @see docs/poster/getTtransaction.md
 */
interface PosterTransaction {
  transaction_id: string;
  date_start: string;
  date_start_new: string;
  date_close: string;
  status: string;
  guests_count: string;
  name: string;
  discount: string;
  bonus: string;
  pay_type: string;
  payed_bonus: string;
  payed_card: string;
  payed_cash: string;
  payed_sum: string;
  payed_cert: string;
  payed_third_party: string;
  payed_card_type: string;
  payed_ewallet: string;
  round_sum: string;
  tip_sum: string;
  tips_card: string;
  tips_cash: string;
  sum: string;
  tax_sum: string;
  payment_method_id: string;
  spot_id: string;
  table_id: string;
  table_name: string | null;
  user_id: string;
  client_id: string;
  card_number: string;
  transaction_comment: string | null;
  reason: string;
  print_fiscal: string;
  total_profit: string;
  total_profit_netto: string;
  client_firstname: string | null;
  client_lastname: string | null;
  date_close_date: string;
  service_mode: string;
  processing_status: string;
  client_phone: string | null;
  auto_accept?: boolean;
  application_id?: string | null;
  products?: unknown[];
  history?: unknown[];
  delivery?: unknown;
  [key: string]: unknown;
}

interface PosterTransactionResponse {
  response: PosterTransaction[];
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
  /** Action performed: added, changed, removed, transformed, closed */
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
  metadata: {
    received_at: Date;
    processed: boolean;
    processed_at: Date | null;
    saved_to_transactions: boolean;
    processing_error: string | null;
    error_time: Date | null;
  };
  [key: string]: unknown;
}

const ALLOWED_ACTIONS = Object.values(PosterAction);

/**
 * Fetch full transaction data from Poster API
 * @see docs/poster/getTtransaction.md
 */
async function fetchPosterTransaction(
  transactionId: number,
  posterToken: string
): Promise<PosterTransaction | null> {
  try {
    const url = `https://joinposter.com/api/dash.getTransaction?token=${posterToken}&transaction_id=${transactionId}&include_products=true&include_history=true&include_delivery=true`;

    console.log('🔍 Fetching transaction from Poster API:', transactionId);

    const response = await axios.get<PosterTransactionResponse>(url, {
      timeout: 10000 // 10 second timeout
    });

    if (response.data && response.data.response && response.data.response.length > 0) {
      console.log('✅ Poster API data fetched successfully');
      return response.data.response[0]; // Return first element of array
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

    console.log('✅ Webhook validated:', {
      action: webhook.action,
      object_id: transactionId,
      raw_hook_id: rawHookId.toHexString()
    });

    // Only save to transactions collection if action is 'changed' or 'closed' (transaction completed)
    let savedToTransactions = false;

    if (webhook.action === PosterAction.Closed || webhook.action === PosterAction.Changed) {
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
