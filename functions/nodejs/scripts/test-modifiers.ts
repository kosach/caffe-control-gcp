/**
 * Test if modifiers are available in Poster API
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

  console.log('🔍 Checking if modifiers are included in menu.getProducts...\n');

  const response = await fetch(
    `${POSTER_API}/menu.getProducts?token=${posterToken}`
  );
  const data = await response.json() as { response: any[] };

  if (!data.response) {
    console.log('No products found');
    process.exit(1);
  }

  // Find a product with modifications
  const productWithMods = data.response.find(p => p.modifications && p.modifications.length > 0);

  if (productWithMods) {
    console.log('✅ Found product with modifications:');
    console.log(`   Product ID: ${productWithMods.product_id}`);
    console.log(`   Product Name: ${productWithMods.product_name}`);
    console.log(`   Modifications:`);
    const modsToShow = productWithMods.modifications.slice(0, 5);
    for (const mod of modsToShow) {
      console.log(`     - ID: ${mod.modificator_id}, Name: ${mod.modificator_name}`);
    }
    const remaining = productWithMods.modifications.length - 5;
    if (remaining > 0) {
      console.log(`     ... and ${remaining} more`);
    }
  } else {
    console.log('❌ No products with modifications found');
  }

  // Count total modifiers
  let totalMods = 0;
  for (const product of data.response) {
    if (product.modifications) {
      totalMods += product.modifications.length;
    }
  }
  console.log(`\n📊 Total products: ${data.response.length}`);
  console.log(`📊 Total modifiers across all products: ${totalMods}`);
}

main().catch(console.error);
