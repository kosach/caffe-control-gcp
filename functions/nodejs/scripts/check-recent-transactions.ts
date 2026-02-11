/**
 * Check recent transactions with write-offs in Firestore
 */

import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  console.log('🔍 Checking 5 most recent transactions with write-offs...\n');

  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });

  // Get transactions WITH write-offs
  const snapshot = await firestore.collection('transactions')
    .where('write_offs_synced_at', '!=', null)
    .orderBy('write_offs_synced_at', 'desc')
    .limit(5)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log('═'.repeat(60));
    console.log(`Transaction ID: ${doc.id}`);
    console.log(`Date: ${data.date_close_date}`);
    console.log(`Sum: ${data.payed_sum / 100} UAH`);
    console.log(`Write-offs synced: ${data.write_offs_synced_at ? 'Yes' : 'No'}`);

    if (data.write_offs && data.write_offs.length > 0) {
      console.log(`\n📦 Write-offs (${data.write_offs.length} items):`);

      for (const wo of data.write_offs.slice(0, 10)) {
        const name = wo.ingredient_name || wo.product_name || `ID: ${wo.ingredient_id || wo.product_id}`;
        const typeLabel = ['', 'product', 'recipe', 'prepack', 'ingredient', 'modifier'][wo.type] || 'unknown';
        console.log(`   - ${name} (${typeLabel}): ${wo.weight} ${wo.unit}, cost: ${wo.cost}`);
      }

      if (data.write_offs.length > 10) {
        console.log(`   ... and ${data.write_offs.length - 10} more`);
      }
    } else {
      console.log('\n⚠️ No write-offs found');
    }
    console.log('');
  }
}

main().catch(console.error);
