/**
 * Check transaction date range in Firestore
 */

import { Firestore } from '@google-cloud/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  console.log('🔍 Checking transaction date range in Firestore...\n');

  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
  });

  const transactionsCollection = firestore.collection('transactions');

  // Get earliest transaction
  const earliestSnapshot = await transactionsCollection
    .orderBy('date_close_date', 'asc')
    .limit(1)
    .get();

  // Get latest transaction
  const latestSnapshot = await transactionsCollection
    .orderBy('date_close_date', 'desc')
    .limit(1)
    .get();

  // Get total count
  const countSnapshot = await transactionsCollection.count().get();
  const totalCount = countSnapshot.data().count;

  // Get count of transactions with write_offs
  const withWriteOffsSnapshot = await transactionsCollection
    .where('write_offs_synced_at', '!=', null)
    .count()
    .get();
  const withWriteOffsCount = withWriteOffsSnapshot.data().count;

  console.log('📊 Transaction Statistics:');
  console.log('==========================');
  console.log(`Total transactions: ${totalCount}`);
  console.log(`With write-offs: ${withWriteOffsCount}`);
  console.log(`Without write-offs: ${totalCount - withWriteOffsCount}`);

  if (!earliestSnapshot.empty) {
    const earliest = earliestSnapshot.docs[0].data();
    console.log(`\nEarliest transaction: ${earliest.date_close_date}`);
  }

  if (!latestSnapshot.empty) {
    const latest = latestSnapshot.docs[0].data();
    console.log(`Latest transaction: ${latest.date_close_date}`);
  }

  // Get sample of transactions per year/month
  console.log('\n📅 Transactions by period:');

  // Sample check for different periods
  const periods = [
    { from: '2023-01-01', to: '2023-12-31', label: '2023' },
    { from: '2024-01-01', to: '2024-06-30', label: '2024 H1' },
    { from: '2024-07-01', to: '2024-12-31', label: '2024 H2' },
    { from: '2025-01-01', to: '2025-12-31', label: '2025' }
  ];

  for (const period of periods) {
    const periodSnapshot = await transactionsCollection
      .where('date_close_date', '>=', period.from)
      .where('date_close_date', '<=', period.to + ' 23:59:59')
      .count()
      .get();

    const count = periodSnapshot.data().count;
    if (count > 0) {
      console.log(`   ${period.label}: ${count} transactions`);
    }
  }
}

main().catch(console.error);
