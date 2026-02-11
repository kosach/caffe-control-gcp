import { getFirestore } from './firestore';
import { getSecret } from './mongodb';

/**
 * Catalog lazy cache service
 *
 * Fetches and caches product/ingredient catalog from Poster API.
 * Cache is stored in Firestore and refreshed every 24 hours.
 */

// Cache TTL in hours
const CACHE_TTL_HOURS = 24;

// Ignored ingredient categories (service/system categories)
const IGNORED_INGREDIENT_CATEGORIES = [14, 17, 4, 6, 7, 8, 15, 18];

// Product type to write-off type mapping
const PRODUCT_TYPE_MAP: Record<number, number> = {
  1: 3,  // prepack → 3
  2: 2,  // recipe → 2
  3: 1   // product → 1
};

/**
 * Catalog item structure
 */
export interface CatalogItem {
  id: string;
  name: string;
  type: number;  // 1=product, 2=recipe, 3=prepack, 4=ingredient, 5=modifier
  unit?: string;
  category_id?: string;
}

/**
 * Catalog metadata stored in Firestore
 */
interface CatalogMetadata {
  synced_at: Date;
  items_count: number;
}

// Poster API response types
interface PosterProduct {
  product_id: string;
  product_name: string;
  type: string;
  unit?: string;
  category_id?: string;
}

interface PosterIngredient {
  ingredient_id: string;
  ingredient_name: string;
  category_id: string;
  ingredient_unit?: string;
}

interface PosterProductsResponse {
  response: PosterProduct[];
}

interface PosterIngredientsResponse {
  response: PosterIngredient[];
}

/**
 * Get catalog with lazy caching
 *
 * Checks if cached catalog is still valid (< 24h old).
 * If not, fetches fresh data from Poster API and caches it.
 *
 * @param posterToken - Poster API token (optional, will be fetched from secrets if not provided)
 * @returns Array of catalog items
 */
export async function getCatalog(posterToken?: string): Promise<CatalogItem[]> {
  const firestore = getFirestore();
  const catalogRef = firestore.collection('catalog');
  const metadataRef = catalogRef.doc('metadata');

  // Check if cache is valid
  const metadataDoc = await metadataRef.get();

  if (metadataDoc.exists) {
    const metadata = metadataDoc.data() as CatalogMetadata;
    const syncedAt = metadata.synced_at instanceof Date
      ? metadata.synced_at
      : (metadata.synced_at as any).toDate();
    const hoursSinceSync = (Date.now() - syncedAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceSync < CACHE_TTL_HOURS) {
      console.log(`📦 Using cached catalog (synced ${hoursSinceSync.toFixed(1)}h ago)`);
      return getCachedItems(catalogRef);
    }
  }

  // Refresh cache
  console.log('🔄 Refreshing catalog from Poster API...');

  const token = posterToken || await getSecret('poster-token');
  const items = await fetchCatalogFromPoster(token);

  await saveCatalogToFirestore(catalogRef, metadataRef, items);

  console.log(`✅ Catalog refreshed: ${items.length} items`);
  return items;
}

/**
 * Force refresh catalog cache
 */
export async function refreshCatalog(posterToken?: string): Promise<CatalogItem[]> {
  const firestore = getFirestore();
  const catalogRef = firestore.collection('catalog');
  const metadataRef = catalogRef.doc('metadata');

  console.log('🔄 Force refreshing catalog from Poster API...');

  const token = posterToken || await getSecret('poster-token');
  const items = await fetchCatalogFromPoster(token);

  await saveCatalogToFirestore(catalogRef, metadataRef, items);

  console.log(`✅ Catalog refreshed: ${items.length} items`);
  return items;
}

/**
 * Get catalog item by ID and type
 */
export async function getCatalogItem(
  itemId: string,
  itemType: number
): Promise<CatalogItem | null> {
  const catalog = await getCatalog();
  return catalog.find(item => item.id === itemId && item.type === itemType) || null;
}

/**
 * Get catalog item name by ID
 * Returns 'Unknown' if not found
 */
export async function getCatalogItemName(itemId: string): Promise<string> {
  const catalog = await getCatalog();
  const item = catalog.find(i => i.id === itemId);
  return item?.name || 'Unknown';
}

/**
 * Create a map of catalog items by ID for quick lookup
 */
export function createCatalogMap(catalog: CatalogItem[]): Map<string, CatalogItem> {
  return new Map(catalog.map(item => [item.id, item]));
}

// Private helper functions

async function getCachedItems(
  catalogRef: FirebaseFirestore.CollectionReference
): Promise<CatalogItem[]> {
  const itemsSnapshot = await catalogRef.doc('items').get();

  if (!itemsSnapshot.exists) {
    return [];
  }

  const data = itemsSnapshot.data();
  return (data?.items as CatalogItem[]) || [];
}

async function fetchCatalogFromPoster(posterToken: string): Promise<CatalogItem[]> {
  const posterApi = 'https://joinposter.com/api';
  const result: CatalogItem[] = [];

  // Fetch products
  const productsUrl = `${posterApi}/menu.getProducts?token=${posterToken}`;
  const productsResponse = await fetch(productsUrl);

  if (!productsResponse.ok) {
    throw new Error(`Failed to fetch products: ${productsResponse.status}`);
  }

  const productsData = await productsResponse.json() as PosterProductsResponse;

  if (productsData.response) {
    for (const product of productsData.response) {
      const productType = parseInt(product.type, 10);
      result.push({
        id: product.product_id,
        name: product.product_name,
        type: PRODUCT_TYPE_MAP[productType] || 1,
        unit: product.unit,
        category_id: product.category_id
      });
    }
  }

  // Fetch ingredients
  const ingredientsUrl = `${posterApi}/menu.getIngredients?token=${posterToken}`;
  const ingredientsResponse = await fetch(ingredientsUrl);

  if (!ingredientsResponse.ok) {
    throw new Error(`Failed to fetch ingredients: ${ingredientsResponse.status}`);
  }

  const ingredientsData = await ingredientsResponse.json() as PosterIngredientsResponse;

  if (ingredientsData.response) {
    for (const ingredient of ingredientsData.response) {
      const categoryId = parseInt(ingredient.category_id, 10);

      // Skip ignored categories
      if (IGNORED_INGREDIENT_CATEGORIES.includes(categoryId)) {
        continue;
      }

      result.push({
        id: ingredient.ingredient_id,
        name: ingredient.ingredient_name,
        type: 4,  // ingredient type
        unit: ingredient.ingredient_unit,
        category_id: ingredient.category_id
      });
    }
  }

  return result;
}

async function saveCatalogToFirestore(
  catalogRef: FirebaseFirestore.CollectionReference,
  metadataRef: FirebaseFirestore.DocumentReference,
  items: CatalogItem[]
): Promise<void> {
  const batch = getFirestore().batch();

  // Save metadata
  batch.set(metadataRef, {
    synced_at: new Date(),
    items_count: items.length
  });

  // Save items in a single document (catalog is typically small enough)
  // If catalog grows too large, consider pagination
  batch.set(catalogRef.doc('items'), {
    items,
    updated_at: new Date()
  });

  await batch.commit();
}

// Export constants for testing
export { CACHE_TTL_HOURS, IGNORED_INGREDIENT_CATEGORIES, PRODUCT_TYPE_MAP };
