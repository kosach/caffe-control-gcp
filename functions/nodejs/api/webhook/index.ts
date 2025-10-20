import { Request, Response } from '@google-cloud/functions-framework';
import { ObjectId } from 'mongodb';
import { connectToDatabase, getSecret } from '../../utils/mongodb';

type AllowedAction = 'created' | 'updated' | 'closed' | 'changed';

// Simplified format (backwards compatibility)
interface WebhookPayload {
  action?: AllowedAction | string;
  data?: {
    transaction_id?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Real Poster webhook format
interface PosterWebhookPayload {
  account?: string;
  object?: string;
  object_id?: number;
  action?: string;
  time?: string;
  verify?: string;
  account_number?: string;
  data?: string | object; // Can be JSON string!
  [key: string]: unknown;
}

interface RawHookDocument {
  _id?: ObjectId;
  received_at: Date;
  raw_body: unknown;
  query_params: Record<string, unknown>;
  processed: boolean;
  processed_at: Date | null;
  saved_to_transactions: boolean;
  processing_error: string | null;
  error_time: Date | null;
}

const ALLOWED_ACTIONS: AllowedAction[] = ['created', 'updated', 'closed', 'changed'];

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
 * Normalize Poster webhook format to standard format
 * Handles both real Poster format and simplified format
 */
function normalizePosterPayload(raw: WebhookPayload | PosterWebhookPayload): WebhookPayload {
  // Check if this is the real Poster format (has object_id field)
  const posterPayload = raw as PosterWebhookPayload;

  if (posterPayload.object_id !== undefined) {
    // Real Poster format detected
    console.log('📦 Detected real Poster webhook format');

    // Parse nested data field if it's a JSON string
    let parsedData: any = {};
    if (typeof posterPayload.data === 'string') {
      try {
        parsedData = JSON.parse(posterPayload.data);
        console.log('📝 Parsed nested JSON data string');
      } catch (parseError) {
        console.warn('⚠️ Failed to parse data string, using as-is');
        parsedData = { raw: posterPayload.data };
      }
    } else if (posterPayload.data && typeof posterPayload.data === 'object') {
      parsedData = posterPayload.data;
    }

    // Return normalized format
    return {
      action: posterPayload.action,
      data: {
        transaction_id: posterPayload.object_id,
        ...parsedData,
        // Preserve Poster-specific fields for audit
        poster_account: posterPayload.account,
        poster_object: posterPayload.object,
        poster_time: posterPayload.time,
        poster_verify: posterPayload.verify,
        poster_account_number: posterPayload.account_number
      }
    };
  }

  // Already in simplified format, return as-is
  return raw as WebhookPayload;
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
    const rawDocument: RawHookDocument = {
      received_at: receivedAt,
      raw_body: snapshotBody(req.body),
      query_params: snapshotQuery(req.query),
      processed: false,
      processed_at: null,
      saved_to_transactions: false,
      processing_error: null,
      error_time: null
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
              processing_error: message,
              error_time: new Date()
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
            processed: true,
            processed_at: new Date(),
            saved_to_transactions: savedToTransactions,
            processing_error: null,
            error_time: null
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
