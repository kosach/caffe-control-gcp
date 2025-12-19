import { Request, Response } from '@google-cloud/functions-framework';
import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';

interface QueryParams {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  'auth-token'?: string;
}

/**
 * Poster API response for dash.getTransactions
 */
interface PosterTransactionsResponse {
  response: unknown[];
  count?: number;
}

/**
 * Sync response statistics
 */
interface SyncStats {
  totalRows: number;
  affectedRows: number;
  affectedWithError: number;
  pagesProcessed: number;
}

/**
 * Synchronizes transactions from Poster API to database
 * Handles pagination and duplicate key errors gracefully
 * Supports dual-write to MongoDB and Firestore
 */
export async function syncTransactions(req: Request, res: Response) {
  try {
    console.log('🚀 syncTransactions started');
    const query = req.query as QueryParams;
    const { dateFrom, dateTo, status } = query;
    const authToken = query['auth-token'];

    // Check authentication
    const validToken = await getSecret('api-auth-key');
    if (!authToken || authToken !== validToken) {
      console.warn('⚠️ Invalid or missing auth token');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    console.log('✅ Auth validated');

    // Require dateFrom parameter to prevent syncing all transactions
    if (!dateFrom) {
      console.warn('⚠️ Missing required parameter: dateFrom');
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'dateFrom parameter is required (format: YYYY-MM-DD)'
      });
    }

    console.log('📋 Sync params:', JSON.stringify({ dateFrom, dateTo, status }));

    // Get Poster API token
    const posterToken = await getSecret('poster-token');

    // Initialize counters
    let totalRows = 0;
    let affectedRows = 0;
    let affectedWithError = 0;
    let page = 1;
    let shouldContinue = true;
    let pagesWithoutNewRecords = 0;
    const MAX_PAGES_WITHOUT_NEW_RECORDS = 10;

    // Connect to database abstraction layer
    console.log('🔌 Connecting to database...');
    const db = await getDatabase();
    console.log('✅ Database connected');

    // Pagination loop
    while (shouldContinue) {
      console.log(`📄 Processing page ${page}...`);

      // Build Poster API URL
      const params = new URLSearchParams({
        token: posterToken,
        page: page.toString(),
        per_page: '100'
      });

      const url = `https://joinposter.com/api/dash.getTransactions?${params.toString()}`;

      try {
        // Fetch from Poster API
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Poster API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as PosterTransactionsResponse;

        // Store total count from first page
        if (page === 1 && data.count !== undefined) {
          totalRows = data.count;
          console.log(`📊 Total rows to sync: ${totalRows}`);
        }

        // Check if we have data
        if (!data.response || data.response.length === 0) {
          console.log('✅ No more data, stopping pagination');
          shouldContinue = false;
          break;
        }

        let transactions = data.response as any[];
        console.log(`📦 Fetched ${transactions.length} transactions from page ${page}`);

        // Check if all transactions on this page are older than dateFrom
        const allTooOld = transactions.every((tx: any) => {
          const txDate = tx.date_close_date;
          if (!txDate) return true;
          const txDateOnly = txDate.split(' ')[0];
          return txDateOnly < dateFrom;
        });

        if (allTooOld) {
          console.log('🛑 All transactions on this page are older than dateFrom, stopping pagination');
          shouldContinue = false;
          break;
        }

        // Filter transactions by date locally
        const originalCount = transactions.length;
        transactions = transactions.filter((tx: any) => {
          const txDate = tx.date_close_date;
          if (!txDate) return false;

          const txDateOnly = txDate.split(' ')[0];

          if (dateFrom && txDateOnly < dateFrom) return false;
          if (dateTo && txDateOnly > dateTo) return false;

          return true;
        });

        console.log(`🔍 After date filtering: ${transactions.length}/${originalCount} transactions match criteria`);

        // Skip this page if no transactions match the date filter
        if (transactions.length === 0) {
          console.log('⏭️  No matching transactions, skipping to next page');
          page++;
          continue;
        }

        // Insert using database abstraction (dual-write to MongoDB and Firestore)
        const result = await db.transactions.insertMany(transactions);

        affectedRows += result.insertedCount;
        affectedWithError += result.duplicateCount;

        console.log(`✅ Page ${page}: ${result.insertedCount} inserted, ${result.duplicateCount} duplicates skipped`);

        // Track pages without new records
        if (result.insertedCount === 0) {
          pagesWithoutNewRecords++;
          console.log(`📊 Pages without new records: ${pagesWithoutNewRecords}/${MAX_PAGES_WITHOUT_NEW_RECORDS}`);

          if (pagesWithoutNewRecords >= MAX_PAGES_WITHOUT_NEW_RECORDS) {
            console.log('🛑 Reached max pages without new records, stopping pagination');
            shouldContinue = false;
            break;
          }
        } else {
          pagesWithoutNewRecords = 0;
        }

        page++;

        // Safety check
        if (page > 1000) {
          console.warn('⚠️ Safety limit reached (1000 pages), stopping sync');
          shouldContinue = false;
        }

      } catch (apiError) {
        console.error(`❌ Error fetching page ${page}:`, apiError);
        throw apiError;
      }
    }

    const stats: SyncStats = {
      totalRows,
      affectedRows,
      affectedWithError,
      pagesProcessed: page - 1
    };

    console.log('✅ Sync completed:', stats);

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
