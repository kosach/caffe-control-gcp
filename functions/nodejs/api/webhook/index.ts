import { Request, Response } from '@google-cloud/functions-framework';
import { ObjectId } from 'mongodb';
import { connectToDatabase, getSecret } from '../../utils/mongodb';

/**
 * Official Poster webhook actions
 * @see https://dev.joinposter.com/docs/v3/web/webhooks
 */
type PosterAction = 'added' | 'changed' | 'removed' | 'transformed';
type AllowedAction = 'created' | 'updated' | 'closed' | PosterAction;

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
  /** Additional parameter for some entities (can be JSON string) */
  data?: string | Record<string, unknown>;
}

/**
 * Simplified format (backwards compatibility for testing)
 */
interface SimplifiedWebhookPayload {
  action?: AllowedAction | string;
  data?: {
    transaction_id?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

type WebhookPayload = PosterWebhook | SimplifiedWebhookPayload;

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

// Support both Poster actions and simplified actions
const ALLOWED_ACTIONS: AllowedAction[] = [
  // Poster official actions
  'added',
  'changed',
  'removed',
  'transformed',
  // Simplified format actions (backwards compatibility)
  'created',
  'updated',
  'closed'
];

function parsePayload(body: unknown): WebhookPayload {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('Invalid JSON payload');
    }
  }

  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('Invalid JSON payload');
    }
  }

  return body as WebhookPayload;
}

/**
 * Type guard to check if payload is a Poster webhook
 */
function isPosterWebhook(payload: unknown): payload is PosterWebhook {
  const p = payload as Partial<PosterWebhook>;
  return (
    typeof p === 'object' &&
    p !== null &&
    'object_id' in p &&
    typeof p.object_id === 'number'
  );
}

/**
 * Normalize Poster webhook format to standard format
 * Handles both official Poster format and simplified format
 */
function normalizePosterPayload(raw: WebhookPayload): SimplifiedWebhookPayload {
  // Check if this is the official Poster webhook format
  if (isPosterWebhook(raw)) {
    console.log('📦 Detected official Poster webhook format');
    console.log(`   Object: ${raw.object}, ID: ${raw.object_id}, Action: ${raw.action}`);

    // Parse nested data field if it's a JSON string
    let parsedData: Record<string, unknown> = {};
    if (typeof raw.data === 'string') {
      try {
        parsedData = JSON.parse(raw.data) as Record<string, unknown>;
        console.log('📝 Parsed nested JSON data string');
      } catch (parseError) {
        console.warn('⚠️ Failed to parse data string, storing as raw');
        parsedData = { raw_data_string: raw.data };
      }
    } else if (raw.data && typeof raw.data === 'object') {
      parsedData = raw.data;
    }

    // Return normalized format with all Poster fields preserved
    return {
      action: raw.action,
      data: {
        transaction_id: raw.object_id,
        ...parsedData,
        // Preserve Poster-specific fields for audit trail
        poster_account: raw.account,
        poster_object: raw.object,
        poster_time: raw.time,
        poster_verify: raw.verify,
        poster_account_number: raw.account_number
      }
    };
  }

  // Already in simplified format, return as-is
  return raw as SimplifiedWebhookPayload;
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

    let payload: WebhookPayload;

    try {
      const rawPayload = parsePayload(req.body);
      payload = normalizePosterPayload(rawPayload);
    } catch (parseError) {
      const details =
        parseError instanceof Error ? parseError.message : 'Invalid payload';
      await markRawError(details);
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    let { action, data } = payload;

    // Map Poster's 'changed' action to 'closed' for consistency
    const originalAction = action;
    if (action === 'changed') {
      action = 'closed';
      console.log('🔄 Mapped action "changed" → "closed"');
    }

    if (!action) {
      const details = 'Missing required field: action';
      await markRawError(details);
      console.warn('⚠️ Missing action field');
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    if (!ALLOWED_ACTIONS.includes(originalAction as AllowedAction)) {
      const details = `Invalid action: ${originalAction}. Allowed: ${ALLOWED_ACTIONS.join(
        ', '
      )}`;
      await markRawError(details);
      console.warn('⚠️ Invalid action:', originalAction);
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    if (!data) {
      const details = 'Missing required field: data';
      await markRawError(details);
      console.warn('⚠️ Missing data field');
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    const transactionId = data.transaction_id;

    if (typeof transactionId !== 'number' || Number.isNaN(transactionId)) {
      const details = 'Missing or invalid field: data.transaction_id';
      await markRawError(details);
      console.warn('⚠️ Invalid transaction_id:', transactionId);
      return res.status(400).json({
        error: 'Invalid payload',
        details
      });
    }

    const timestampIso = receivedAt.toISOString();
    console.log('🔔 Webhook received:', {
      action,
      transaction_id: transactionId,
      raw_hook_id: rawHookId.toHexString(),
      timestamp: timestampIso
    });

    let savedToTransactions = false;

    if (action === 'closed') {
      try {
        await transactionsCollection.updateOne(
          { transaction_id: transactionId },
          {
            $set: {
              ...data,
              webhook_received_at: timestampIso,
              webhook_action: action,
              raw_hook_id: rawHookId
            }
          },
          { upsert: true }
        );
        savedToTransactions = true;
        console.log('✅ Transaction stored:', transactionId);
      } catch (dbError) {
        const details =
          dbError instanceof Error ? dbError.message : 'Database error';
        await markRawError(details);
        console.error('❌ Failed to upsert transaction:', dbError);
        return res.status(500).json({
          error: 'Processing failed',
          message: 'Unexpected error'
        });
      }
    } else {
      console.log(
        `ℹ️ Action "${action}" does not require transactions persistence`
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
      transaction_id: transactionId,
      action: originalAction,
      mapped_action: action !== originalAction ? action : undefined,
      saved_to_transactions: savedToTransactions
    });

    return res.status(200).json({
      success: true,
      transaction_id: transactionId,
      action: originalAction,
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
