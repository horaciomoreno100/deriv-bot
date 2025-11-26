/**
 * Pivot Reversal Strategy Demo
 *
 * Test the Pivot Reversal strategy with real market data
 */

import { PivotReversalStrategy } from '../strategies/pivot-reversal.strategy.js';
import { GatewayClient } from '@deriv-bot/shared';
import type { Candle } from '@deriv-bot/shared';

async function main() {
  console.log('🚀 Starting Pivot Reversal Strategy Demo...\n');

  // Connect to gateway
  const gateway = new GatewayClient({
    gatewayUrl: 'http://localhost:3000',
  });

  await gateway.connect();
  console.log('✅ Connected to gateway\n');

  // Create strategy
  const strategy = new PivotReversalStrategy({
    name: 'Pivot Reversal Demo',
    asset: 'R_75',
    expiry: 1, // 1 minute
    stake: 10,
    parameters: {
      leftBars: 4, // Check last 4 candles for pivot
      expiryMinutes: 1,
      maxLossStreak: 2,
    },
  });

  console.log('📊 Strategy Parameters:', strategy.getParams(), '\n');

  // Start strategy
  await strategy.start();
  console.log('✅ Strategy started\n');

  // Track stats
  let signalCount = 0;
  let callSignals = 0;
  let putSignals = 0;

  // Listen for signals
  strategy.on('signal', (signal) => {
    signalCount++;
    if (signal.type === 'CALL') callSignals++;
    if (signal.type === 'PUT') putSignals++;

    const streakInfo = strategy.getStreakInfo();

    console.log('\n🎯 Signal Generated:');
    console.log('  Type:', signal.type);
    console.log('  Confidence:', (signal.confidence * 100).toFixed(0) + '%');
    console.log('  Asset:', signal.asset);
    console.log('  Expiry:', signal.expiry, 'min');
    console.log('  Details:', signal.metadata);
    console.log('  Streak:', {
      wins: streakInfo.consecutiveWins,
      losses: streakInfo.consecutiveLosses,
      currentStake: streakInfo.currentStake,
    });
    console.log('  Total Signals:', signalCount, `(${callSignals} CALL, ${putSignals} PUT)`);
  });

  // Subscribe to candles
  const candles: Candle[] = [];
  const maxCandles = 100; // Keep last 100 candles

  await gateway.subscribe({
    asset: 'R_75',
    interval: '1m',
    onTick: (tick) => {
      // Tick updates (optional)
    },
    onCandle: async (candle) => {
      // Add candle to history
      candles.push(candle);
      if (candles.length > maxCandles) {
        candles.shift(); // Remove oldest
      }

      console.log(
        `📈 Candle closed: ${candle.asset} @ ${candle.timestamp} - O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)}`
      );

      // Feed candle to strategy
      await strategy.processTick(null, {
        candles,
        latestTick: null,
        balance: 1000,
        openPositions: 0,
      });
    },
  });

  console.log('📡 Subscribed to R_75 1m candles');
  console.log('⏳ Waiting for signals... (Ctrl+C to stop)\n');

  // Keep process alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
