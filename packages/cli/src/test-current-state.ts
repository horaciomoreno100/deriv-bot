#!/usr/bin/env tsx
/**
 * Quick State Test - Immediate verification
 *
 * Connects to Gateway and waits for ONE indicator update
 * to verify the system is working right now.
 */

import { GatewayClient } from '@deriv-bot/trader';

const GATEWAY_URL = 'ws://localhost:3000';
const TIMEOUT_MS = 90_000; // 90 seconds max wait

async function quickTest(): Promise<void> {
  console.log('🔍 Quick State Verification');
  console.log('=' .repeat(60));
  console.log('Connecting to Gateway and waiting for ONE indicator update...\n');

  const client = new GatewayClient({
    url: GATEWAY_URL,
    enableLogging: false,
  });

  let receivedIndicators = false;
  let startTime: number;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.disconnect();
      reject(new Error('Timeout: No indicators received in 90 seconds'));
    }, TIMEOUT_MS);

    client.on('connected', () => {
      console.log('✅ Connected to Gateway');
      startTime = Date.now();
      console.log('⏳ Waiting for next candle completion (~60 seconds max)...\n');
    });

    client.on('tick', (tick) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`\r📈 Ticks flowing... (${elapsed}s elapsed)`);
    });

    client.on('indicators', (indicators) => {
      if (receivedIndicators) return;
      receivedIndicators = true;

      clearTimeout(timeout);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log('\n\n' + '='.repeat(60));
      console.log('✅ INDICATOR RECEIVED!');
      console.log('='.repeat(60));
      console.log(`⏱️  Time elapsed: ${elapsed} seconds`);
      console.log(`📊 Asset: ${indicators.asset}`);
      console.log(`📊 RSI: ${indicators.rsi.toFixed(2)}`);
      console.log(`📊 BB Upper: ${indicators.bbUpper.toFixed(2)}`);
      console.log(`📊 BB Middle: ${indicators.bbMiddle.toFixed(2)}`);
      console.log(`📊 BB Lower: ${indicators.bbLower.toFixed(2)}`);
      console.log(`📊 ATR: ${indicators.atr.toFixed(2)}`);
      console.log(`📊 Timestamp: ${new Date(indicators.timestamp).toLocaleString()}`);
      console.log('='.repeat(60));
      console.log('\n✅ System is working! Indicators are being calculated and sent.');
      console.log('   They update every 60 seconds when a candle completes.\n');

      client.disconnect();
      resolve();
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    client.connect().catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

quickTest()
  .then(() => {
    console.log('✅ Test passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    console.error('\n💡 Make sure:');
    console.error('   1. Gateway is running: pnpm --filter @deriv-bot/gateway dev');
    console.error('   2. Trader is running: pnpm --filter @deriv-bot/trader demo');
    console.error('   3. Trader has accumulated enough candles (check logs)\n');
    process.exit(1);
  });
