/**
 * Manual test script to debug Deriv API connection
 * Run with: tsx src/api/test-deriv-manual.ts
 */

import { DerivClient } from './deriv-client.js';

async function main() {
  console.log('🚀 Starting Deriv API test...\n');

  const client = new DerivClient({
    appId: 1089,
    endpoint: 'wss://ws.derivws.com/websockets/v3',
  });

  // Connect
  console.log('📡 Connecting...');
  await client.connect();
  console.log('✅ Connected!\n');

  // Get symbols
  console.log('📊 Fetching symbols...');
  const symbols = await client.getActiveSymbols();
  console.log(`✅ Got ${symbols.length} symbols`);

  const r100 = symbols.find((s) => s.symbol === 'R_100');
  console.log(`   R_100: ${r100?.displayName}\n`);

  // Subscribe to ticks
  console.log('📈 Subscribing to R_100 ticks...');
  let tickCount = 0;

  const sub = await client.subscribeTicks('R_100', (tick) => {
    tickCount++;
    console.log(`   Tick #${tickCount}: ${tick.price} at ${new Date(tick.timestamp).toISOString()}`);
  });

  console.log(`✅ Subscribed with ID: ${sub.id}\n`);

  // Wait 10 seconds
  console.log('⏳ Waiting 10 seconds for ticks...\n');
  await new Promise((resolve) => setTimeout(resolve, 10000));

  console.log(`\n✅ Received ${tickCount} ticks total`);

  // Unsubscribe
  console.log('\n🛑 Unsubscribing...');
  await client.unsubscribe(sub.id);
  console.log('✅ Unsubscribed');

  // Disconnect
  console.log('\n👋 Disconnecting...');
  client.disconnect();
  console.log('✅ Disconnected\n');

  console.log('🎉 Test completed successfully!');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
