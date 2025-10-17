import { Request, Response } from '@google-cloud/functions-framework';
import { connectToDatabase } from '../../utils/mongodb';

interface QueryParams {
  startDate?: string;
  endDate?: string;
  'auth-token'?: string;
}

export async function getAllTransactions(req: Request, res: Response) {
  try {
    // Auth check will be added later
    const query = req.query as QueryParams;
    const { startDate, endDate } = query;

    console.log('Query params:', JSON.stringify(query));

    const { db } = await connectToDatabase();
    const transactionsCollection = db.collection('transactions');

    // Build MongoDB query
    const mongoQuery: any = {};

    if (startDate && endDate) {
      console.log('Date range:', startDate, endDate);
      mongoQuery.date_close_date = {
        $gte: `${startDate} 00:00:00`,
        $lte: `${endDate} 23:59:59`
      };
    }

    const transactions = await transactionsCollection.find(mongoQuery).toArray();

    res.status(200).json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
