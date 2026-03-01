import { Request, Response } from '@google-cloud/functions-framework';
import { getDatabase } from '../../utils/database';
import { getSecret } from '../../utils/mongodb';
import { getCatalog, createCatalogMap } from '../../utils/catalog';
import { fetchPosterTransaction, enrichTransaction } from '../../utils/enrichment';

interface QueryParams {
  dateFrom?: string;
  dateTo?: string;
  enrich?: string;       // 'true' to enrich with product names + write-offs (default: true)
  'auth-token'?: string;
}

interface SyncStats {
  totalFetched: number;
  synced: number;
  enriched: number;
  errors: number;
  pagesProcessed: number;
}

/**
 * Synchronizes transactions from Poster API to Firestore.
 * Fetches full transaction details and enriches with product names + write-offs.
 *
 * Query params:
 *   - auth-token: required, must match api-auth-key secret
 *   - dateFrom: required, YYYY-MM-DD
 *   - dateTo: optional, YYYY-MM-DD (defaults to today)
 *   - enrich: optional, 'false' to skip enrichment (default: true)
 */
export async function syncTransactions(req: Request, res: Response) {
  try {
    console.log('🚀 syncTransactions started');
    const query = req.query as QueryParams;
    const { dateFrom, dateTo } = query;
    const authToken = query['auth-token'];
    const shouldEnrich = query.enrich !== 'false';

    // Auth check
    const validToken = await getSecret('api-auth-key');
    if (!authToken || authToken !== validToken) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!dateFrom) {
      return res.status(400).json({
        success: false,
        error: 'dateFrom parameter is required (format: YYYY-MM-DD)'
      });
    }

    console.log('📋 Sync params:', JSON.stringify({ dateFrom, dateTo, enrich: shouldEnrich }));

    const posterToken = await getSecret('poster-token');
    const db = await getDatabase();

    // Pre-load catalog once for all transactions
    let catalogMap;
    if (shouldEnrich) {
      try {
        const catalog = await getCatalog(posterToken);
        catalogMap = createCatalogMap(catalog);
        console.log(`📦 Catalog loaded: ${catalogMap.size} items`);
      } catch (err) {
        console.warn('⚠️ Failed to load catalog, will skip product name enrichment:', err);
      }
    }

    const stats: SyncStats = {
      totalFetched: 0,
      synced: 0,
      enriched: 0,
      errors: 0,
      pagesProcessed: 0,
    };

    let page = 1;
    let shouldContinue = true;

    while (shouldContinue) {
      console.log(`📄 Fetching page ${page}...`);

      // Poster API uses YYYYMMDD format without dashes
      const dfParam = dateFrom.replace(/-/g, '');
      const dtParam = dateTo ? dateTo.replace(/-/g, '') : undefined;

      const params = new URLSearchParams({
        token: posterToken,
        page: page.toString(),
        per_page: '100',
        date_from: dfParam,
        ...(dtParam && { date_to: dtParam }),
      });

      const listUrl = `https://joinposter.com/api/dash.getTransactions?${params}`;
      const listResp = await fetch(listUrl);

      if (!listResp.ok) {
        throw new Error(`Poster API error: ${listResp.status}`);
      }

      const listData = await listResp.json() as { response: any[]; count?: number };

      if (!listData.response || listData.response.length === 0) {
        console.log('✅ No more data');
        shouldContinue = false;
        break;
      }

      const transactions = listData.response;
      stats.totalFetched += transactions.length;
      console.log(`📦 Page ${page}: ${transactions.length} transactions`);

      // Process each transaction: fetch full details + enrich + upsert
      for (const txn of transactions) {
        const txnId = txn.transaction_id;

        try {
          if (shouldEnrich) {
            // Fetch full transaction with products
            const fullTxn = await fetchPosterTransaction(txnId, posterToken);

            if (fullTxn) {
              const enriched = await enrichTransaction(fullTxn, posterToken, catalogMap);
              await db.transactions.upsert(txnId, enriched);
              stats.enriched++;
            } else {
              // Fallback: save raw data
              await db.transactions.upsert(txnId, txn);
            }
          } else {
            await db.transactions.upsert(txnId, txn);
          }

          stats.synced++;
        } catch (err) {
          stats.errors++;
          console.error(`❌ Failed txn ${txnId}:`, err instanceof Error ? err.message : err);
        }
      }

      stats.pagesProcessed = page;
      console.log(`✅ Page ${page} done: ${stats.synced} synced, ${stats.errors} errors`);

      // Stop if fewer than full page
      if (transactions.length < 100) {
        shouldContinue = false;
      }

      page++;

      // Safety limit
      if (page > 500) {
        console.warn('⚠️ Safety limit (500 pages)');
        shouldContinue = false;
      }
    }

    console.log('✅ Sync completed:', stats);
    res.status(200).json({ success: true, data: stats });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
