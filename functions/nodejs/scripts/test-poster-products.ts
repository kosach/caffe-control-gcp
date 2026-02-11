/**
 * Test Poster API products and compare with transaction data
 */

import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const POSTER_API = 'https://joinposter.com/api';

interface PosterProduct {
  product_id: string;
  product_name: string;
  menu_category_id: string;
  category_name?: string;
  price?: Record<string, string>;
}

interface TransactionProduct {
  product_id: string;
  product_name?: string;
  count?: string;
  payed_sum?: string;
}

async function main() {
  const posterToken = process.env.POSTER_TOKEN;
  if (!posterToken) {
    console.error('POSTER_TOKEN not found');
    process.exit(1);
  }

  console.log('🔍 Testing Poster API products mapping...\n');

  // 1. Fetch products from Poster API
  console.log('📦 Fetching products from Poster API...');
  const productsResponse = await fetch(`${POSTER_API}/menu.getProducts?token=${posterToken}`);
  const productsData = await productsResponse.json() as { response: PosterProduct[] };

  const productsMap = new Map<string, PosterProduct>();
  for (const product of productsData.response) {
    productsMap.set(product.product_id, product);
  }
  console.log(`   Found ${productsMap.size} products\n`);

  // 2. Get a recent transaction with products
  console.log('📋 Fetching recent transaction from Firestore...');
  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });

  const snapshot = await firestore.collection('transactions')
    .orderBy('date_close_date', 'desc')
    .limit(10)
    .get();

  // Find a transaction with products
  let sampleTransaction: any = null;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.products && data.products.length > 0) {
      sampleTransaction = { id: doc.id, ...data };
      break;
    }
  }

  if (!sampleTransaction) {
    console.log('No transaction with products found');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`Transaction ID: ${sampleTransaction.id}`);
  console.log(`Date: ${sampleTransaction.date_close_date}`);
  console.log(`Sum: ${sampleTransaction.payed_sum / 100} UAH`);
  console.log(`═══════════════════════════════════════════════════════════`);

  // 3. Check products mapping
  console.log('\n📦 Products in transaction:');
  const products = sampleTransaction.products as TransactionProduct[];

  for (const txProduct of products) {
    const posterProduct = productsMap.get(txProduct.product_id);

    console.log(`\n   Product ID: ${txProduct.product_id}`);
    console.log(`   In transaction: ${txProduct.product_name || '(no name in transaction)'}`);
    console.log(`   In Poster API: ${posterProduct?.product_name || '❌ NOT FOUND'}`);
    console.log(`   Count: ${txProduct.count}`);

    if (posterProduct) {
      console.log(`   ✅ Match!`);
    } else {
      console.log(`   ❌ Product not found in Poster API`);
    }
  }

  // 4. Show sample of Poster API product structure
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('Sample Poster API product structure:');
  console.log('═══════════════════════════════════════════════════════════');

  const sampleProduct = productsData.response[0];
  console.log(JSON.stringify(sampleProduct, null, 2));

  // 5. Show transaction product structure
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Sample transaction product structure:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(JSON.stringify(products[0], null, 2));
}

main().catch(console.error);
