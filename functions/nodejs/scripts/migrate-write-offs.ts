/**
 * Migration script: Add write-offs to historical transactions
 *
 * Fetches write-offs from Poster API using batch endpoint and updates
 * transactions in Firestore with write_offs array.
 *
 * Usage:
 *   npx ts-node scripts/migrate-write-offs.ts --from=2024-01-01 --to=2024-12-31 [--dry-run]
 *
 * Options:
 *   --from=YYYY-MM-DD    Start date (required)
 *   --to=YYYY-MM-DD      End date (required)
 *   --dry-run            Preview changes without writing to Firestore
 *   --month-by-month     Process one month at a time (recommended for large date ranges)
 *
 * Environment variables:
 *   POSTER_TOKEN - Poster API token
 *   GCP_PROJECT_ID - Google Cloud project ID (default: caffe-control-prod)
 */

import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Configuration
const BATCH_SIZE = 500; // Firestore batch limit
const POSTER_API_PER_PAGE = 1000;

// Ignored ingredient categories (from story spec)
const IGNORED_INGREDIENT_CATEGORIES = [14, 17, 4, 6, 7, 8, 15, 18];

// Type definitions
interface PosterWriteOff {
  write_off_id: number;
  storage_id: number;
  product_id: number;
  modificator_id: number;
  ingredient_id: number;
  prepack_id: number;
  cost: number;
  weight: number;
  unit: string;
}

interface PosterTransactionWriteOffs {
  transaction_id: number;
  write_offs: PosterWriteOff[];
}

interface PosterWriteOffsResponse {
  response: {
    count: number;
    page: {
      per_page: number;
      page: number;
      count: number;
    };
    data: PosterTransactionWriteOffs[];
  };
}

interface CatalogItem {
  id: string;
  name: string;
  type: number;
}

interface EnrichedWriteOff {
  write_off_id: string;
  storage_id: string;
  ingredient_id: string;
  ingredient_name: string | null;
  product_id: string;
  product_name: string | null;
  modificator_id: string;
  prepack_id: string;
  weight: number;
  unit: string;
  cost: number;
  type: number;
}

interface MigrationStats {
  dateRange: string;
  totalTransactions: number;
  updatedTransactions: number;
  skippedTransactions: number;
  totalWriteOffs: number;
  errors: number;
  durationMs: number;
}

interface MigrationOptions {
  fromDate: string;
  toDate: string;
  dryRun: boolean;
  monthByMonth: boolean;
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    fromDate: '',
    toDate: '',
    dryRun: false,
    monthByMonth: false
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--month-by-month') {
      options.monthByMonth = true;
    } else if (arg.startsWith('--from=')) {
      options.fromDate = arg.split('=')[1];
    } else if (arg.startsWith('--to=')) {
      options.toDate = arg.split('=')[1];
    }
  }

  return options;
}

function validateDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Generate month ranges between two dates
 */
function* generateMonthRanges(fromDate: string, toDate: string): Generator<{ from: string; to: string }> {
  const start = new Date(fromDate);
  const end = new Date(toDate);

  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    const monthStart = current.toISOString().slice(0, 10);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const monthEndStr = monthEnd > end ? toDate : monthEnd.toISOString().slice(0, 10);

    yield { from: monthStart < fromDate ? fromDate : monthStart, to: monthEndStr };

    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }
}

/**
 * Fetch catalog from Poster API
 */
async function fetchCatalog(posterToken: string): Promise<Map<string, CatalogItem>> {
  console.log('📦 Fetching catalog from Poster API...');

  const catalogMap = new Map<string, CatalogItem>();
  const posterApi = 'https://joinposter.com/api';

  // Product type mapping
  const productTypeMap: Record<number, number> = {
    1: 3,  // prepack
    2: 2,  // recipe
    3: 1   // product
  };

  // Fetch products
  const productsUrl = `${posterApi}/menu.getProducts?token=${posterToken}`;
  const productsResponse = await fetch(productsUrl);
  const productsData = await productsResponse.json() as { response?: Array<{ product_id: string; product_name: string; type: string }> };

  if (productsData.response) {
    for (const product of productsData.response) {
      const productType = parseInt(product.type, 10);
      catalogMap.set(product.product_id, {
        id: product.product_id,
        name: product.product_name,
        type: productTypeMap[productType] || 1
      });
    }
  }

  // Fetch ingredients
  const ingredientsUrl = `${posterApi}/menu.getIngredients?token=${posterToken}`;
  const ingredientsResponse = await fetch(ingredientsUrl);
  const ingredientsData = await ingredientsResponse.json() as { response?: Array<{ ingredient_id: string; ingredient_name: string; category_id: string }> };

  if (ingredientsData.response) {
    for (const ingredient of ingredientsData.response) {
      const categoryId = parseInt(ingredient.category_id, 10);
      if (!IGNORED_INGREDIENT_CATEGORIES.includes(categoryId)) {
        catalogMap.set(ingredient.ingredient_id, {
          id: ingredient.ingredient_id,
          name: ingredient.ingredient_name,
          type: 4  // ingredient
        });
      }
    }
  }

  console.log(`   ✅ Loaded ${catalogMap.size} catalog items`);
  return catalogMap;
}

/**
 * Fetch write-offs for a date range using batch API
 */
async function fetchWriteOffsForPeriod(
  dateFrom: string,
  dateTo: string,
  posterToken: string
): Promise<Map<number, PosterWriteOff[]>> {
  const writeOffsMap = new Map<number, PosterWriteOff[]>();
  let page = 1;
  let hasMore = true;
  let totalFetched = 0;

  console.log(`   🔍 Fetching write-offs for ${dateFrom} to ${dateTo}...`);

  while (hasMore) {
    const url = `https://joinposter.com/api/transactions.getTransactionsWriteOffs?token=${posterToken}&date_from=${dateFrom}&date_to=${dateTo}&per_page=${POSTER_API_PER_PAGE}&page=${page}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Poster API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as PosterWriteOffsResponse;

    if (!data.response || !data.response.data) {
      console.log(`   ⚠️ No data in response for page ${page}`);
      break;
    }

    for (const item of data.response.data) {
      writeOffsMap.set(item.transaction_id, item.write_offs);
      totalFetched += item.write_offs.length;
    }

    const pageCount = data.response.page.count;
    console.log(`      Page ${page}: ${data.response.data.length} transactions, ${pageCount} items`);

    hasMore = pageCount === POSTER_API_PER_PAGE;
    page++;

    // Rate limiting - small delay between pages
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`   ✅ Fetched ${writeOffsMap.size} transactions with ${totalFetched} total write-offs`);
  return writeOffsMap;
}

/**
 * Determine write-off type based on which ID is populated
 */
function determineWriteOffType(writeOff: PosterWriteOff): number {
  if (writeOff.modificator_id && writeOff.modificator_id !== 0) {
    return 5;  // modifier
  }
  if (writeOff.ingredient_id && writeOff.ingredient_id !== 0) {
    return 4;  // ingredient
  }
  if (writeOff.prepack_id && writeOff.prepack_id !== 0) {
    return 3;  // prepack
  }
  return 4;  // default to ingredient
}

/**
 * Enrich write-offs with catalog names
 * Note: Uses null instead of undefined for Firestore compatibility
 */
function enrichWriteOffs(
  writeOffs: PosterWriteOff[],
  catalog: Map<string, CatalogItem>
): EnrichedWriteOff[] {
  return writeOffs.map(wo => {
    const ingredientName = catalog.get(String(wo.ingredient_id))?.name ?? null;
    const productName = catalog.get(String(wo.product_id))?.name ?? null;

    return {
      write_off_id: String(wo.write_off_id),
      storage_id: String(wo.storage_id),
      ingredient_id: String(wo.ingredient_id),
      ingredient_name: ingredientName,
      product_id: String(wo.product_id),
      product_name: productName,
      modificator_id: String(wo.modificator_id),
      prepack_id: String(wo.prepack_id),
      weight: wo.weight,
      unit: wo.unit,
      cost: wo.cost,
      type: determineWriteOffType(wo)
    };
  });
}

/**
 * Migrate write-offs for a date range
 */
async function migrateWriteOffsForPeriod(
  firestore: Firestore,
  writeOffsMap: Map<number, PosterWriteOff[]>,
  catalog: Map<string, CatalogItem>,
  options: MigrationOptions
): Promise<MigrationStats> {
  const startTime = Date.now();
  const stats: MigrationStats = {
    dateRange: `${options.fromDate} to ${options.toDate}`,
    totalTransactions: writeOffsMap.size,
    updatedTransactions: 0,
    skippedTransactions: 0,
    totalWriteOffs: 0,
    errors: 0,
    durationMs: 0
  };

  if (writeOffsMap.size === 0) {
    console.log('   ℹ️ No transactions with write-offs found');
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  if (options.dryRun) {
    console.log(`   [DRY RUN] Would update ${writeOffsMap.size} transactions`);
    writeOffsMap.forEach((writeOffs) => {
      stats.totalWriteOffs += writeOffs.length;
    });
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  const transactionsCollection = firestore.collection('transactions');
  let batch = firestore.batch();
  let batchCount = 0;
  let processedCount = 0;

  const entries = Array.from(writeOffsMap.entries());

  for (const [transactionId, writeOffs] of entries) {
    processedCount++;

    try {
      const docRef = transactionsCollection.doc(String(transactionId));
      const doc = await docRef.get();

      if (!doc.exists) {
        stats.skippedTransactions++;
        continue;
      }

      const enrichedWriteOffs = enrichWriteOffs(writeOffs, catalog);
      stats.totalWriteOffs += enrichedWriteOffs.length;

      batch.update(docRef, {
        write_offs: enrichedWriteOffs,
        write_offs_synced_at: new Date()
      });
      batchCount++;

      // Commit batch when reaching limit
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        stats.updatedTransactions += batchCount;
        console.log(`      Progress: ${stats.updatedTransactions}/${stats.totalTransactions} updated`);
        batch = firestore.batch();
        batchCount = 0;
      }
    } catch (error) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(`      Error updating transaction ${transactionId}:`, error);
      }
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    stats.updatedTransactions += batchCount;
  }

  stats.durationMs = Date.now() - startTime;
  return stats;
}

async function main() {
  const options = parseArgs();

  console.log('🚀 Write-offs Migration');
  console.log('=======================');

  // Validate options
  if (!options.fromDate || !options.toDate) {
    console.error('❌ Required: --from=YYYY-MM-DD --to=YYYY-MM-DD');
    console.error('   Example: npx ts-node scripts/migrate-write-offs.ts --from=2024-01-01 --to=2024-12-31');
    process.exit(1);
  }

  if (!validateDateFormat(options.fromDate) || !validateDateFormat(options.toDate)) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Date range: ${options.fromDate} to ${options.toDate}`);
  console.log(`Processing: ${options.monthByMonth ? 'Month by month' : 'Full range'}`);

  // Get Poster token
  const posterToken = process.env.POSTER_TOKEN;
  if (!posterToken) {
    console.error('❌ POSTER_TOKEN environment variable is required');
    process.exit(1);
  }

  // Connect to Firestore
  console.log('\n🔌 Connecting to Firestore...');
  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });
  console.log('   ✅ Connected');

  // Fetch catalog once
  const catalog = await fetchCatalog(posterToken);

  const allStats: MigrationStats[] = [];

  try {
    if (options.monthByMonth) {
      // Process month by month
      const ranges = Array.from(generateMonthRanges(options.fromDate, options.toDate));
      for (const range of ranges) {
        console.log(`\n📅 Processing ${range.from} to ${range.to}`);

        const writeOffsMap = await fetchWriteOffsForPeriod(range.from, range.to, posterToken);

        const periodOptions = { ...options, fromDate: range.from, toDate: range.to };
        const stats = await migrateWriteOffsForPeriod(firestore, writeOffsMap, catalog, periodOptions);
        allStats.push(stats);

        console.log(`   ✅ ${stats.updatedTransactions} updated, ${stats.skippedTransactions} skipped, ${stats.errors} errors`);

        // Rate limiting between months
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      // Process full range at once
      console.log(`\n📅 Processing full range`);

      const writeOffsMap = await fetchWriteOffsForPeriod(options.fromDate, options.toDate, posterToken);
      const stats = await migrateWriteOffsForPeriod(firestore, writeOffsMap, catalog, options);
      allStats.push(stats);
    }

    // Print summary
    console.log('\n📈 Migration Summary');
    console.log('====================');

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalWriteOffs = 0;
    let totalDuration = 0;

    for (const stats of allStats) {
      totalUpdated += stats.updatedTransactions;
      totalSkipped += stats.skippedTransactions;
      totalErrors += stats.errors;
      totalWriteOffs += stats.totalWriteOffs;
      totalDuration += stats.durationMs;
    }

    console.log(`\nTotal transactions updated: ${totalUpdated}`);
    console.log(`Total transactions skipped: ${totalSkipped}`);
    console.log(`Total write-offs added: ${totalWriteOffs}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`Total duration: ${(totalDuration / 1000).toFixed(1)}s`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }

  console.log('\n✅ Migration complete');
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
