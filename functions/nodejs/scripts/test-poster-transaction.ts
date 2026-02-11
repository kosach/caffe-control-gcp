/**
 * Test Poster API transaction structure
 */

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

  // Get transaction from Poster API using dash.getTransactions
  const transactionId = '58814';
  console.log(`🔍 Fetching transaction ${transactionId} from Poster API...\n`);

  // First get transaction
  const response = await fetch(
    `${POSTER_API}/dash.getTransactions?token=${posterToken}&transaction_id=${transactionId}`
  );
  const data = await response.json() as { response: any[] };

  if (!data.response || data.response.length === 0) {
    console.log('No transaction found');
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const tx = data.response[0];

  // Also get transaction products using dash.getTransactionProducts
  console.log('Fetching transaction products...');
  const productsResponse = await fetch(
    `${POSTER_API}/dash.getTransactionProducts?token=${posterToken}&transaction_id=${transactionId}`
  );
  const productsData = await productsResponse.json() as { response: any };
  console.log('dash.getTransactionProducts response:', JSON.stringify(productsData, null, 2).slice(0, 1000));

  // Try dash.getTransaction with include_products (webhook method)
  console.log('\nFetching via dash.getTransaction (webhook method)...');
  const txResponse = await fetch(
    `${POSTER_API}/dash.getTransaction?token=${posterToken}&transaction_id=${transactionId}&include_products=true&include_history=true&include_delivery=true`
  );
  const txData = await txResponse.json() as { response: any };
  console.log('dash.getTransaction response:', JSON.stringify(txData, null, 2).slice(0, 2000));

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Transaction from Poster API:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`transaction_id: ${tx.transaction_id}`);
  console.log(`date_close: ${tx.date_close}`);
  console.log(`payed_sum: ${tx.payed_sum}`);

  console.log('\n📦 Products:');
  if (tx.products && tx.products.length > 0) {
    for (const product of tx.products) {
      console.log(`\n   product_id: ${product.product_id}`);
      console.log(`   product_name: ${product.product_name || '(empty)'}`);
      console.log(`   modification_id: ${product.modification_id}`);
      console.log(`   modificator_name: ${product.modificator_name || '(empty)'}`);
      console.log(`   num: ${product.num}`);
      console.log(`   payed_sum: ${product.payed_sum}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Full product object structure:');
  console.log('═══════════════════════════════════════════════════════════');
  if (tx.products && tx.products.length > 0) {
    console.log(JSON.stringify(tx.products[0], null, 2));
  }
}

main().catch(console.error);
