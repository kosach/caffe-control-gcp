import axios from 'axios';
import { getCatalog, createCatalogMap, CatalogItem } from './catalog';
import { getTransactionWriteOffs, TransactionWriteOff } from './writeoffs';

/**
 * Raw product from Poster transaction
 */
export interface TransactionProduct {
  product_id: string;
  modification_id: string;
  num: string;
  payed_sum: string;
  product_cost?: string;
  product_profit?: string;
  [key: string]: unknown;
}

/**
 * Enriched product with name from catalog
 */
export interface EnrichedProduct extends TransactionProduct {
  product_name: string | null;
}

/**
 * Poster API transaction response
 */
interface PosterTransactionResponse {
  response: PosterTransaction[];
}

/**
 * Poster transaction data
 */
export interface PosterTransaction {
  transaction_id: number;
  date_close_date: string;
  products?: TransactionProduct[];
  [key: string]: unknown;
}

/**
 * Enrich products with names from catalog
 */
export function enrichProducts(
  products: TransactionProduct[],
  catalogMap: Map<string, CatalogItem>
): EnrichedProduct[] {
  return products.map(p => ({
    ...p,
    product_name: catalogMap.get(p.product_id)?.name ?? null
  }));
}

/**
 * Fetch full transaction data from Poster API
 */
export async function fetchPosterTransaction(
  transactionId: number | string,
  posterToken: string
): Promise<PosterTransaction | null> {
  try {
    const url = `https://joinposter.com/api/dash.getTransaction?token=${posterToken}&transaction_id=${transactionId}&include_products=true&include_history=true&include_delivery=true`;

    const response = await axios.get<PosterTransactionResponse>(url, {
      timeout: 10000
    });

    if (response.data?.response?.length > 0) {
      return response.data.response[0];
    }

    return null;
  } catch (error) {
    console.error(`❌ Failed to fetch transaction ${transactionId}:`, error);
    return null;
  }
}

/**
 * Enrich a single transaction with product names and write-offs.
 * Returns the enriched transaction object ready for Firestore.
 */
export async function enrichTransaction(
  transaction: PosterTransaction,
  posterToken: string,
  catalogMap?: Map<string, CatalogItem>
): Promise<Record<string, unknown>> {
  // Enrich products
  let enrichedProducts: EnrichedProduct[] = [];
  try {
    if (!catalogMap) {
      const catalog = await getCatalog(posterToken);
      catalogMap = createCatalogMap(catalog);
    }
    const products = (transaction.products || []) as TransactionProduct[];
    enrichedProducts = enrichProducts(products, catalogMap);
  } catch (err) {
    console.warn(`⚠️ Failed to enrich products for txn ${transaction.transaction_id}:`, err);
    enrichedProducts = (transaction.products || []) as EnrichedProduct[];
  }

  // Fetch write-offs
  let writeOffs: TransactionWriteOff[] = [];
  try {
    writeOffs = await getTransactionWriteOffs(transaction.transaction_id, posterToken);
  } catch (err) {
    console.warn(`⚠️ Failed to fetch write-offs for txn ${transaction.transaction_id}:`, err);
  }

  return {
    ...transaction,
    products: enrichedProducts,
    products_enriched_at: enrichedProducts.length > 0 ? new Date() : null,
    write_offs: writeOffs,
    write_offs_synced_at: writeOffs.length > 0 ? new Date() : null
  };
}
