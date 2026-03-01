import { Request, Response } from '@google-cloud/functions-framework';
import { getSecret } from '../../utils/mongodb';
import { BigQuery } from '@google-cloud/bigquery';

interface PosterProduct {
  product_id: string;
  product_name: string;
  menu_category_id: string;
  category_name: string;
  type: string;
  unit: string;
  cost: string;
  cost_netto: string;
  price?: Record<string, string>;
  hidden: string;
  out: string;
  fiscal: string;
  sort_order: string;
  modifications?: Array<{
    modificator_id: string;
    modificator_name: string;
    modificator_barcode?: string;
    modificator_product_code?: string;
  }>;
}

interface PosterCategory {
  category_id: string;
  category_name: string;
  parent_category: string;
  category_hidden: string;
  sort_order: string;
  level: string;
  visible: Array<{ spot_id: string; visible: string }>;
}

interface QueryParams {
  'auth-token'?: string;
}

const BQ_DATASET = 'caffe_control';
const BQ_PRODUCTS_TABLE = 'products_catalog';
const BQ_CATEGORIES_TABLE = 'categories_catalog';

/**
 * Sync product catalog and categories from Poster API to BigQuery.
 *
 * Query params:
 *   - auth-token: required, must match api-auth-key secret
 */
export async function syncCatalog(req: Request, res: Response) {
  try {
    console.log('🚀 syncCatalog started');

    const query = req.query as QueryParams;
    const authToken = query['auth-token'];

    // Auth
    const validToken = await getSecret('api-auth-key');
    if (!authToken || authToken !== validToken) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const posterToken = await getSecret('poster-token');
    const bq = new BigQuery();

    // Fetch products
    console.log('📦 Fetching products from Poster...');
    const productsResp = await fetch(
      `https://joinposter.com/api/menu.getProducts?token=${posterToken}`
    );
    if (!productsResp.ok) {
      throw new Error(`Failed to fetch products: ${productsResp.status}`);
    }
    const productsData = await productsResp.json() as { response: PosterProduct[] };
    const products = productsData.response || [];
    console.log(`✅ Fetched ${products.length} products`);

    // Fetch categories
    console.log('📦 Fetching categories from Poster...');
    const categoriesResp = await fetch(
      `https://joinposter.com/api/menu.getCategories?token=${posterToken}`
    );
    if (!categoriesResp.ok) {
      throw new Error(`Failed to fetch categories: ${categoriesResp.status}`);
    }
    const categoriesData = await categoriesResp.json() as { response: PosterCategory[] };
    const categories = categoriesData.response || [];
    console.log(`✅ Fetched ${categories.length} categories`);

    // Build category tree for root_category resolution
    const categoryMap = new Map<string, PosterCategory>();
    for (const cat of categories) {
      categoryMap.set(cat.category_id, cat);
    }

    function getRootCategory(categoryId: string): string {
      let current = categoryMap.get(categoryId);
      if (!current) return '';
      let depth = 0;
      while (current && current.parent_category !== '0' && depth < 10) {
        const parent = categoryMap.get(current.parent_category);
        if (!parent) break;
        current = parent;
        depth++;
      }
      return current.category_name;
    }

    // Prepare product rows for BQ
    const syncedAt = new Date().toISOString();
    const productRows = products.map(p => ({
      product_id: p.product_id,
      product_name: p.product_name,
      menu_category_id: p.menu_category_id,
      category_name: p.category_name,
      root_category: getRootCategory(p.menu_category_id),
      type: p.type,
      unit: p.unit || null,
      cost: p.cost ? parseInt(p.cost, 10) / 100 : 0,
      hidden: p.hidden === '1',
      out: p.out === '1',
      sort_order: parseInt(p.sort_order, 10) || 0,
      synced_at: syncedAt,
    }));

    // Prepare category rows for BQ
    const categoryRows = categories.map(c => ({
      category_id: c.category_id,
      category_name: c.category_name,
      parent_category_id: c.parent_category,
      parent_category_name: c.parent_category !== '0'
        ? (categoryMap.get(c.parent_category)?.category_name || null)
        : null,
      root_category: getRootCategory(c.category_id),
      level: parseInt(c.level, 10) || 0,
      hidden: c.category_hidden === '1',
      sort_order: parseInt(c.sort_order, 10) || 0,
      synced_at: syncedAt,
    }));

    // Write to BQ — full replace via query DML (DELETE + INSERT)
    // Using queryJobs to avoid streaming buffer issues with WRITE_TRUNCATE
    console.log('📝 Writing products to BigQuery...');
    if (productRows.length > 0) {
      await bq.query(`DELETE FROM \`${BQ_DATASET}.${BQ_PRODUCTS_TABLE}\` WHERE TRUE`);
      await bq.dataset(BQ_DATASET).table(BQ_PRODUCTS_TABLE).insert(productRows);
      console.log(`✅ ${productRows.length} products written`);
    }

    console.log('📝 Writing categories to BigQuery...');
    if (categoryRows.length > 0) {
      await bq.query(`DELETE FROM \`${BQ_DATASET}.${BQ_CATEGORIES_TABLE}\` WHERE TRUE`);
      await bq.dataset(BQ_DATASET).table(BQ_CATEGORIES_TABLE).insert(categoryRows);
      console.log(`✅ ${categoryRows.length} categories written`);
    }

    const stats = {
      products: productRows.length,
      categories: categoryRows.length,
      synced_at: syncedAt,
    };

    console.log('✅ Catalog sync completed:', stats);
    res.status(200).json({ success: true, data: stats });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
