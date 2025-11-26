/**
 * Test Position Monitor
 *
 * Quick test to verify PositionMonitor behavior with existing positions
 */

import { GatewayClient } from '@deriv-bot/shared';
import { PositionMonitor } from '../trade-management/position-monitor.js';

async function testPositionMonitor() {
  console.log('🧪 Testing Position Monitor...\n');

  // Create client
  const client = new GatewayClient({
    url: 'ws://localhost:3000',
    enableLogging: false,
  });

  await client.connect();
  console.log('✅ Connected to Gateway\n');

  // Test 1: Monitor R_75 and R_100 (current demo config)
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 1: Monitor R_75, R_100 (but positions are R_25, R_50)');
  console.log('═══════════════════════════════════════════════════════\n');

  const monitor1 = new PositionMonitor(client, ['R_75', 'R_100'], 5000);
  monitor1.start((positions) => {
    console.log(`\n📥 [TEST 1 CALLBACK] Received ${positions.length} position(s)`);
    positions.forEach((pos, i) => {
      console.log(`   ${i + 1}. ${pos.symbol} | ${pos.contractId} | $${pos.profit.toFixed(2)}`);
    });
  });

  await new Promise(resolve => setTimeout(resolve, 6000)); // Wait for one poll cycle
  monitor1.stop();

  // Test 2: Monitor R_25 and R_50 (the actual open positions)
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 2: Monitor R_25, R_50 (matching actual positions)');
  console.log('═══════════════════════════════════════════════════════\n');

  const monitor2 = new PositionMonitor(client, ['R_25', 'R_50'], 5000);
  monitor2.start((positions) => {
    console.log(`\n📥 [TEST 2 CALLBACK] Received ${positions.length} position(s)`);
    positions.forEach((pos, i) => {
      console.log(`   ${i + 1}. ${pos.symbol} | ${pos.contractId} | $${pos.profit.toFixed(2)}`);
    });
  });

  await new Promise(resolve => setTimeout(resolve, 6000)); // Wait for one poll cycle
  monitor2.stop();

  // Cleanup
  await client.disconnect();
  console.log('\n✅ Test complete');
  process.exit(0);
}

testPositionMonitor().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
