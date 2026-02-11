/**
 * Migration script: Enrich transaction products with names
 *
 * Fetches product names from catalog and updates transactions in Firestore.
 *
 * Usage:
 *   npx ts-node scripts/enrich-products.ts [--dry-run] [--limit=N]
 *
 * Options:
 *   --dry-run     Preview changes without writing to Firestore
 *   --limit=N     Process only N transactions (for testing)
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
const POSTER_API = 'https://joinposter.com/api';

// Type definitions
interface CatalogItem {
  id: string;
  name: string;
  type: number;
}

interface TransactionProduct {
  product_id: string;
  modification_id?: string;
  num?: string;
  payed_sum?: string;
  [key: string]: unknown;
}

interface EnrichedProduct {
  product_id: string;
  modification_id?: string;
  num?: string;
  payed_sum?: string;
  product_name: string | null;
  [key: string]: unknown;
}

interface MigrationStats {
  totalTransactions: number;
  updatedTransactions: number;
  skippedTransactions: number;
  alreadyEnrichedTransactions: number;
  totalProducts: number;
  enrichedProducts: number;
  notFoundProducts: number;
  errors: number;
  durationMs: number;
}

interface MigrationOptions {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    dryRun: false,
    limit: null
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

/**
 * Fetch catalog from Poster API
 */
async function fetchCatalog(posterToken: string): Promise<Map<string, CatalogItem>> {
  console.log('📦 Fetching catalog from Poster API...');

  const catalogMap = new Map<string, CatalogItem>();

  // Product type mapping
  const productTypeMap: Record<number, number> = {
    1: 3,  // prepack
    2: 2,  // recipe
    3: 1   // product
  };

  // Fetch products
  const productsUrl = `${POSTER_API}/menu.getProducts?token=${posterToken}`;
  const productsResponse = await fetch(productsUrl);
  const productsData = await productsResponse.json() as {
    response?: Array<{ product_id: string; product_name: string; type: string }>
  };

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

  console.log(`   ✅ Loaded ${catalogMap.size} products`);
  return catalogMap;
}

/**
 * Enrich products with names from catalog
 */
function enrichProducts(
  products: TransactionProduct[],
  catalogMap: Map<string, CatalogItem>
): { enriched: EnrichedProduct[]; stats: { enriched: number; notFound: number } } {
  let enrichedCount = 0;
  let notFoundCount = 0;

  const enriched = products.map(p => {
    const catalogItem = catalogMap.get(p.product_id);
    if (catalogItem) {
      enrichedCount++;
    } else {
      notFoundCount++;
    }
    return {
      ...p,
      product_name: catalogItem?.name ?? null
    };
  });

  return {
    enriched,
    stats: { enriched: enrichedCount, notFound: notFoundCount }
  };
}

/**
 * Migrate products in transactions using pagination
 */
async function migrateProducts(
  firestore: Firestore,
  catalogMap: Map<string, CatalogItem>,
  options: MigrationOptions
): Promise<MigrationStats> {
  const startTime = Date.now();
  const PAGE_SIZE = 1000; // Firestore query limit per page
  const stats: MigrationStats = {
    totalTransactions: 0,
    updatedTransactions: 0,
    skippedTransactions: 0,
    alreadyEnrichedTransactions: 0,
    totalProducts: 0,
    enrichedProducts: 0,
    notFoundProducts: 0,
    errors: 0,
    durationMs: 0
  };

  console.log('\n🔍 Processing transactions from Firestore (paginated)...');

  if (options.dryRun) {
    console.log('[DRY RUN] Analyzing transactions...');
  } else {
    console.log('📝 Updating transactions...');
  }

  let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;
  let hasMore = true;
  let pageNum = 0;
  let totalRemaining = options.limit || Infinity;

  while (hasMore && totalRemaining > 0) {
    pageNum++;
    const pageLimit = Math.min(PAGE_SIZE, totalRemaining);

    // Build paginated query
    let query = firestore.collection('transactions')
      .orderBy('date_close', 'desc')
      .limit(pageLimit);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    const docsCount = snapshot.docs.length;

    if (docsCount === 0) {
      hasMore = false;
      break;
    }

    console.log(`   Page ${pageNum}: processing ${docsCount} transactions...`);

    let batch = firestore.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
      stats.totalTransactions++;
      const data = doc.data();
      const products = (data.products || []) as TransactionProduct[];

      // Skip if no products
      if (products.length === 0) {
        stats.skippedTransactions++;
        continue;
      }

      // Skip if already enriched (first product has product_name)
      if (products[0]?.product_name !== undefined) {
        stats.alreadyEnrichedTransactions++;
        continue;
      }

      stats.totalProducts += products.length;

      const { enriched, stats: productStats } = enrichProducts(products, catalogMap);
      stats.enrichedProducts += productStats.enriched;
      stats.notFoundProducts += productStats.notFound;

      if (!options.dryRun) {
        try {
          batch.update(doc.ref, {
            products: enriched,
            products_enriched_at: new Date()
          });
          batchCount++;

          // Commit batch when reaching limit
          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            stats.updatedTransactions += batchCount;
            batch = firestore.batch();
            batchCount = 0;
          }
        } catch (error) {
          stats.errors++;
          if (stats.errors <= 5) {
            console.error(`   Error updating transaction ${doc.id}:`, error);
          }
        }
      } else {
        stats.updatedTransactions++;
      }
    }

    // Commit remaining batch for this page
    if (!options.dryRun && batchCount > 0) {
      await batch.commit();
      stats.updatedTransactions += batchCount;
    }

    console.log(`   Page ${pageNum} done. Total updated: ${stats.updatedTransactions}`);

    // Prepare for next page
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = docsCount === pageLimit;
    totalRemaining -= docsCount;

    // Small delay between pages to avoid rate limiting
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  stats.durationMs = Date.now() - startTime;
  return stats;
}

async function main() {
  const options = parseArgs();

  console.log('🚀 Product Names Migration');
  console.log('==========================');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (options.limit) {
    console.log(`Limit: ${options.limit} transactions`);
  }

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
  const catalogMap = await fetchCatalog(posterToken);

  // Run migration
  const stats = await migrateProducts(firestore, catalogMap, options);

  // Print summary
  console.log('\n📈 Migration Summary');
  console.log('====================');
  console.log(`Total transactions: ${stats.totalTransactions}`);
  console.log(`Updated: ${stats.updatedTransactions}`);
  console.log(`Already enriched: ${stats.alreadyEnrichedTransactions}`);
  console.log(`Skipped (no products): ${stats.skippedTransactions}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`\nProducts:`);
  console.log(`  Total: ${stats.totalProducts}`);
  console.log(`  Enriched with names: ${stats.enrichedProducts}`);
  console.log(`  Not found in catalog: ${stats.notFoundProducts}`);
  console.log(`\nDuration: ${(stats.durationMs / 1000).toFixed(1)}s`);

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN - no changes were made');
    console.log('   Run without --dry-run to apply changes');
  }

  console.log('\n✅ Migration complete');
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
