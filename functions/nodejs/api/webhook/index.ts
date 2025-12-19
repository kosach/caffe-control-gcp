import { Request, Response } from '@google-cloud/functions-framework';
import axios from 'axios';
import { getDatabase, RawHookDocument } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';

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
 */
interface TransactionHistory {
  type_history: string;
  time: number;
  value: number | string;
  value2: number | string;
  value3: number | string;
  value4: number | string;
  value5: number | string | null;
  value_text: string;
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
  [key: string]: unknown;
}

/**
 * Poster API response for dash.getTransaction
 * @see https://dev.joinposter.com/docs/v3/web/dash/getTransaction
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
 * @see https://dev.joinposter.com/docs/v3/web/webhooks
 */
interface PosterWebhook {
  account: string;
  account_number: string;
  object: string;
  object_id: number;
  action: PosterAction;
  time: string;
  verify: string;
  data?: string | TransactionData;
}

const ALLOWED_ACTIONS = Object.values(PosterAction);

/**
 * Fetch full transaction data from Poster API
 */
async function fetchPosterTransaction(
  transactionId: number,
  posterToken: string
): Promise<PosterTransaction | null> {
  try {
    const url = `https://joinposter.com/api/dash.getTransaction?token=${posterToken}&transaction_id=${transactionId}&include_products=true&include_history=true&include_delivery=true`;

    console.log('🔍 Fetching transaction from Poster API:', transactionId);

    const response = await axios.get<PosterTransactionResponse>(url, {
      timeout: 10000
    });

    if (response.data && response.data.response && response.data.response.length > 0) {
      console.log('✅ Poster API data fetched successfully');
      return response.data.response[0];
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

    const db = await getDatabase();
    const receivedAt = new Date();

    // Store the complete raw webhook body + metadata
    const rawBodySnapshot = snapshotBody(req.body);
    const rawDocument: RawHookDocument = {
      ...(typeof rawBodySnapshot === 'object' && rawBodySnapshot !== null
        ? rawBodySnapshot as Record<string, unknown>
        : { raw_body_string: rawBodySnapshot }),
      metadata: {
        received_at: receivedAt,
        processed: false,
        processed_at: null,
        saved_to_transactions: false,
        processing_error: null,
        error_time: null
      }
    };

    let rawHookId: string;

    try {
      rawHookId = await db.rawHooks.insertOne(rawDocument);
      console.log('📝 RAW webhook stored:', rawHookId);
    } catch (error) {
      console.error('❌ Failed to store RAW webhook:', error);
      return res.status(500).json({
        error: 'Processing failed',
        message: 'Unexpected error'
      });
    }

    const markRawError = async (message: string) => {
      try {
        await db.rawHooks.updateOne(rawHookId, {
          metadata: {
            received_at: receivedAt,
            processed: false,
            processed_at: null,
            saved_to_transactions: false,
            processing_error: message,
            error_time: new Date()
          }
        });
      } catch (updateError) {
        console.error('⚠️ Failed to record RAW webhook error:', updateError);
      }
    };

    let webhookData: PosterWebhook;

    try {
      webhookData = parsePayload(req.body);
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
      object: webhookData.object,
      object_id: webhookData.object_id,
      action: webhookData.action,
      account: webhookData.account
    });

    // Validate required fields
    if (!webhookData.action) {
      const details = 'Missing required field: action';
      await markRawError(details);
      console.warn('⚠️ Missing action field');
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    if (!ALLOWED_ACTIONS.includes(webhookData.action)) {
      const details = `Invalid action: ${webhookData.action}. Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
      await markRawError(details);
      console.warn('⚠️ Invalid action:', webhookData.action);
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    if (!webhookData.object_id) {
      const details = 'Missing required field: object_id';
      await markRawError(details);
      console.warn('⚠️ Missing object_id field');
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    const transactionId = webhookData.object_id;

    console.log('✅ Webhook validated:', {
      action: webhookData.action,
      object_id: transactionId,
      raw_hook_id: rawHookId
    });

    // Only save to transactions collection if action is 'changed' or 'closed'
    let savedToTransactions = false;

    if (webhookData.action === PosterAction.Closed || webhookData.action === PosterAction.Changed) {
      try {
        // Fetch full transaction data from Poster API
        const posterToken = await getSecret('poster-token');
        const posterApiData = await fetchPosterTransaction(transactionId, posterToken);

        // Store Poster API transaction data if available
        if (posterApiData) {
          await db.transactions.upsert(posterApiData.transaction_id, posterApiData);
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
        `ℹ️ Action "${webhookData.action}" - RAW saved, transaction not persisted`
      );
    }

    try {
      await db.rawHooks.updateOne(rawHookId, {
        metadata: {
          received_at: receivedAt,
          processed: true,
          processed_at: new Date(),
          saved_to_transactions: savedToTransactions,
          processing_error: null,
          error_time: null
        }
      });
    } catch (updateError) {
      console.error('⚠️ Failed to mark RAW webhook as processed:', updateError);
    }

    console.log('✅ Webhook processing completed:', {
      object_id: transactionId,
      action: webhookData.action,
      saved_to_transactions: savedToTransactions
    });

    return res.status(200).json({
      success: true,
      object_id: transactionId,
      action: webhookData.action,
      saved_to_transactions: savedToTransactions,
      raw_hook_id: rawHookId
    });
  } catch (error) {
    console.error('❌ Webhook processing failed:', error);
    return res.status(500).json({
      error: 'Processing failed',
      message: 'Unexpected error'
    });
  }
}
