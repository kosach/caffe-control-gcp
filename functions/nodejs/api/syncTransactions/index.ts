import { Request, Response } from '@google-cloud/functions-framework';
import { connectToDatabase, getSecret } from '../../utils/mongodb';

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
 * Synchronizes transactions from Poster API to MongoDB
 * Handles pagination and duplicate key errors gracefully
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
    const MAX_PAGES_WITHOUT_NEW_RECORDS = 10; // Stop after 10 pages with only duplicates

    // Connect to database
    console.log('🔌 Connecting to database...');
    const { db } = await connectToDatabase();
    console.log('✅ Database connected');

    const transactionsCollection = db.collection('transactions');

    // Pagination loop
    while (shouldContinue) {
      console.log(`📄 Processing page ${page}...`);

      // Build Poster API URL
      // NOTE: dash.getTransactions does NOT support date filtering via API parameters
      // We filter locally after fetching the data
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
        // If so, we can stop pagination (Poster returns newest first)
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

        // Filter transactions by date locally (since Poster API doesn't support date filtering)
        const originalCount = transactions.length;
        transactions = transactions.filter((tx: any) => {
          const txDate = tx.date_close_date; // Format: "YYYY-MM-DD HH:MM:SS"
          if (!txDate) return false;

          const txDateOnly = txDate.split(' ')[0]; // Get "YYYY-MM-DD" part

          // Check if transaction is >= dateFrom
          if (dateFrom && txDateOnly < dateFrom) return false;

          // Check if transaction is <= dateTo
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

        // Insert into MongoDB with unordered bulk write
        // This continues on duplicate key errors
        let insertedCount = 0;
        try {
          const result = await transactionsCollection.insertMany(
            transactions,
            { ordered: false }
          );

          insertedCount = result.insertedCount;
          affectedRows += insertedCount;
          console.log(`✅ Inserted ${insertedCount} new transactions`);
        } catch (err: any) {
          // Handle duplicate key errors (E11000)
          if (err.code === 11000 || err.writeErrors) {
            const duplicateCount = err.writeErrors?.length || 0;
            insertedCount = err.result?.nInserted || 0;

            affectedWithError += duplicateCount;
            affectedRows += insertedCount;

            console.log(`⚠️ Page ${page}: ${insertedCount} inserted, ${duplicateCount} duplicates skipped`);
          } else {
            // Re-throw unexpected errors
            throw err;
          }
        }

        // Track pages without new records
        if (insertedCount === 0) {
          pagesWithoutNewRecords++;
          console.log(`📊 Pages without new records: ${pagesWithoutNewRecords}/${MAX_PAGES_WITHOUT_NEW_RECORDS}`);

          if (pagesWithoutNewRecords >= MAX_PAGES_WITHOUT_NEW_RECORDS) {
            console.log('🛑 Reached max pages without new records, stopping pagination');
            shouldContinue = false;
            break;
          }
        } else {
          // Reset counter if we found new records
          pagesWithoutNewRecords = 0;
        }

        // Move to next page
        page++;

        // Safety check: stop if we've processed many pages (prevent infinite loops)
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
