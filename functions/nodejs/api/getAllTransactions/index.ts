import { Request, Response } from '@google-cloud/functions-framework';
import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';

interface QueryParams {
  startDate?: string;
  endDate?: string;
  limit?: string;
  'auth-token'?: string;
}

export async function getAllTransactions(req: Request, res: Response) {
  try {
    console.log('🚀 Function started');
    const query = req.query as QueryParams;
    const { startDate, endDate, limit } = query;
    const authToken = query['auth-token'];

    // Check authentication
    const validToken = await getSecret('api-auth-key');
    if (!authToken || authToken !== validToken) {
      console.warn('⚠️ Invalid or missing auth token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Auth validated');
    console.log('📋 Query params:', JSON.stringify({ startDate, endDate, limit }));
    console.log('🔌 Connecting to database...');

    const db = await getDatabase();
    console.log('✅ Database connected');

    const limitNum = limit ? parseInt(limit) : 100;

    console.log('🔍 Executing query with limit:', limitNum);
    const transactions = await db.transactions.find(
      { startDate, endDate },
      { limit: limitNum }
    );
    console.log(`📊 Found ${transactions.length} transactions`);

    res.status(200).json(transactions);
    console.log('✅ Response sent');
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
