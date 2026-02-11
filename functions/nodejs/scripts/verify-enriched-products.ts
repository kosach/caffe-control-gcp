/**
 * Verify that products in transactions have product_name
 */
import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  console.log('🔍 Verifying enriched products in transactions...\n');

  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });

  // Get recent transactions
  const snapshot = await firestore.collection('transactions')
    .orderBy('date_close', 'desc')
    .limit(5)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const products = data.products || [];

    console.log('═'.repeat(60));
    console.log(`Transaction ID: ${doc.id}`);
    console.log(`Date: ${data.date_close_date}`);
    console.log(`Products enriched at: ${data.products_enriched_at?.toDate?.() || 'N/A'}`);
    console.log(`\n📦 Products (${products.length}):`);

    for (const product of products.slice(0, 5)) {
      const name = product.product_name || '❌ NO NAME';
      console.log(`   ${product.product_id} → ${name}`);
    }
    if (products.length > 5) {
      console.log(`   ... and ${products.length - 5} more`);
    }
    console.log('');
  }
}

main().catch(console.error);
