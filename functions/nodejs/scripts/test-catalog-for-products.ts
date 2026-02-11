/**
 * Test if current catalog can resolve product names from transactions
 */
import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const POSTER_API = 'https://joinposter.com/api';

async function main() {
  const posterToken = process.env.POSTER_TOKEN;
  if (!posterToken) {
    console.error('POSTER_TOKEN not found');
    process.exit(1);
  }

  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });

  // Fetch catalog directly from Poster API (like the original script)
  console.log('📦 Fetching catalog from Poster API...');

  const productsResponse = await fetch(`${POSTER_API}/menu.getProducts?token=${posterToken}`);
  const productsData = await productsResponse.json() as { response: any[] };

  const productsMap = { 1: 3, 2: 2, 3: 1 };
  const catalogMap = new Map<string, { name: string; type: number }>();

  for (const p of productsData.response || []) {
    catalogMap.set(p.product_id, {
      name: p.product_name,
      type: (productsMap as any)[p.type] || 1
    });
  }

  console.log(`   Products loaded: ${catalogMap.size}`);

  // Get transactions with products
  console.log('\n🔍 Checking transaction products...');
  const txSnapshot = await firestore.collection('transactions')
    .orderBy('date_close', 'desc')
    .limit(5)
    .get();

  let found = 0;
  let notFound = 0;

  for (const doc of txSnapshot.docs) {
    const data = doc.data();
    const products = data.products || [];

    if (products.length === 0) continue;

    console.log(`\nTransaction ${doc.id}:`);
    for (const product of products.slice(0, 3)) {
      const catalogItem = catalogMap.get(product.product_id);
      if (catalogItem) {
        found++;
        console.log(`  ✅ ${product.product_id} → ${catalogItem.name}`);
      } else {
        notFound++;
        console.log(`  ❌ ${product.product_id} → NOT FOUND`);
      }
      if (product.modification_id !== '0') {
        console.log(`     modification_id: ${product.modification_id}`);
      }
    }
  }

  console.log(`\n📊 Summary: ${found} found, ${notFound} not found`);
}

main().catch(console.error);
