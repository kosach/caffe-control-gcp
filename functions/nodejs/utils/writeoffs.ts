import { getSecret } from './mongodb';
import { getCatalog, createCatalogMap, CatalogItem } from './catalog';

/**
 * Write-offs service
 *
 * Fetches transaction write-offs from Poster API and enriches them with catalog names.
 */

/**
 * Raw write-off from Poster API dash.getTransactionWriteoffs
 */
export interface PosterWriteOff {
  write_off_id: string;
  tr_product_id: string;
  storage_id: string;
  ingredient_id: string;
  product_id: string;
  modificator_id: string;
  prepack_id: string;
  weight: string;
  unit: string;
  cost: number;
  cost_netto: number;
  time: string;
}

/**
 * Enriched write-off with catalog names
 */
export interface TransactionWriteOff {
  write_off_id: string;
  tr_product_id: string;
  storage_id: string;
  ingredient_id: string;
  ingredient_name?: string;
  product_id: string;
  product_name?: string;
  modificator_id: string;
  prepack_id: string;
  weight: number;
  unit: string;
  cost: number;
  cost_netto: number;
  time: string;
  type: number;  // 1=product, 2=recipe, 3=prepack, 4=ingredient, 5=modifier
}

interface PosterWriteOffsResponse {
  response: PosterWriteOff[] | null;
}

/**
 * Fetch write-offs for a single transaction from Poster API
 *
 * @param transactionId - Transaction ID
 * @param posterToken - Poster API token (optional, will be fetched from secrets if not provided)
 * @returns Array of raw write-offs
 */
export async function fetchTransactionWriteOffs(
  transactionId: string | number,
  posterToken?: string
): Promise<PosterWriteOff[]> {
  const token = posterToken || await getSecret('poster-token');
  const url = `https://joinposter.com/api/dash.getTransactionWriteoffs?token=${token}&transaction_id=${transactionId}`;

  console.log(`🔍 Fetching write-offs for transaction ${transactionId}`);

  const response = await fetch(url);

  if (!response.ok) {
    console.error(`❌ Failed to fetch write-offs: ${response.status}`);
    throw new Error(`Failed to fetch write-offs: ${response.status}`);
  }

  const data = await response.json() as PosterWriteOffsResponse;

  if (!data.response) {
    console.log(`ℹ️ No write-offs for transaction ${transactionId}`);
    return [];
  }

  console.log(`✅ Fetched ${data.response.length} write-offs`);
  return data.response;
}

/**
 * Determine write-off item type based on which ID is populated
 *
 * @param writeOff - Raw write-off from Poster
 * @returns Type number (1=product, 2=recipe, 3=prepack, 4=ingredient, 5=modifier)
 */
function determineWriteOffType(writeOff: PosterWriteOff): number {
  // Check in order of specificity
  if (writeOff.modificator_id && writeOff.modificator_id !== '0') {
    return 5;  // modifier
  }
  if (writeOff.ingredient_id && writeOff.ingredient_id !== '0') {
    return 4;  // ingredient
  }
  if (writeOff.prepack_id && writeOff.prepack_id !== '0') {
    return 3;  // prepack
  }
  // Default to ingredient if none match
  return 4;
}

/**
 * Enrich write-offs with names from catalog
 *
 * @param writeOffs - Raw write-offs from Poster
 * @param catalog - Catalog items (optional, will be fetched if not provided)
 * @returns Enriched write-offs with names
 */
export async function enrichWriteOffsWithCatalog(
  writeOffs: PosterWriteOff[],
  catalog?: CatalogItem[]
): Promise<TransactionWriteOff[]> {
  if (writeOffs.length === 0) {
    return [];
  }

  const catalogItems = catalog || await getCatalog();
  const catalogMap = createCatalogMap(catalogItems);

  return writeOffs.map(wo => {
    const type = determineWriteOffType(wo);

    // Find names based on type
    let ingredientName: string | undefined;
    let productName: string | undefined;

    if (wo.ingredient_id && wo.ingredient_id !== '0') {
      ingredientName = catalogMap.get(wo.ingredient_id)?.name;
    }

    if (wo.product_id && wo.product_id !== '0') {
      productName = catalogMap.get(wo.product_id)?.name;
    }

    return {
      write_off_id: wo.write_off_id,
      tr_product_id: wo.tr_product_id,
      storage_id: wo.storage_id,
      ingredient_id: wo.ingredient_id,
      ingredient_name: ingredientName,
      product_id: wo.product_id,
      product_name: productName,
      modificator_id: wo.modificator_id,
      prepack_id: wo.prepack_id,
      weight: parseFloat(wo.weight) || 0,
      unit: wo.unit,
      cost: wo.cost,
      cost_netto: wo.cost_netto,
      time: wo.time,
      type
    };
  });
}

/**
 * Fetch and enrich write-offs for a transaction
 *
 * Combines fetching from Poster API and enriching with catalog names.
 *
 * @param transactionId - Transaction ID
 * @param posterToken - Poster API token (optional)
 * @returns Enriched write-offs
 */
export async function getTransactionWriteOffs(
  transactionId: string | number,
  posterToken?: string
): Promise<TransactionWriteOff[]> {
  const rawWriteOffs = await fetchTransactionWriteOffs(transactionId, posterToken);
  return enrichWriteOffsWithCatalog(rawWriteOffs);
}

/**
 * Calculate total cost of write-offs
 */
export function calculateWriteOffsTotalCost(writeOffs: TransactionWriteOff[]): number {
  return writeOffs.reduce((sum, wo) => sum + (wo.cost || 0), 0);
}

/**
 * Calculate total cost netto of write-offs
 */
export function calculateWriteOffsTotalCostNetto(writeOffs: TransactionWriteOff[]): number {
  return writeOffs.reduce((sum, wo) => sum + (wo.cost_netto || 0), 0);
}
