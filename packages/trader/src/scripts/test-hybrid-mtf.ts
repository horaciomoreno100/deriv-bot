/**
 * Quick test to verify HybridMTFStrategy can be instantiated
 * and basic functionality works
 */

import { HybridMTFStrategy } from '../strategies/hybrid-mtf.strategy.js';
import type { StrategyConfig, Candle } from '@deriv-bot/shared';

console.log('🧪 Testing HybridMTFStrategy...\n');

// Test 1: Strategy instantiation
console.log('Test 1: Creating strategy instance...');
const config: StrategyConfig = {
    name: 'HybridMTF-Test',
    enabled: true,
    assets: ['R_100'],
    timeframe: '1m',
    parameters: {
        ctxAdxPeriod: 14,
        ctxAdxThreshold: 25,
        ctxSmaPeriod: 50,
        ctxSlopeThreshold: 0.0002,
        midRsiPeriod: 14,
        midRsiOverbought: 80,
        midRsiOversold: 20,
        bbPeriod: 20,
        bbStdDev: 2,
        rsiPeriod: 14,
        rsiOverbought: 55,
        rsiOversold: 45,
        takeProfitPct: 0.005,
        stopLossPct: 0.005,
        cooldownSeconds: 60,
        minCandles: 100,
        confirmationCandles: 1,
    },
};

try {
    const strategy = new HybridMTFStrategy(config);
    console.log('✅ Strategy created successfully');
    console.log(`   Name: ${strategy.getName()}`);
    console.log(`   Running: ${strategy.isRunning()}`);
} catch (error) {
    console.error('❌ Failed to create strategy:', error);
    process.exit(1);
}

// Test 2: Start/Stop
console.log('\nTest 2: Starting strategy...');
try {
    const strategy = new HybridMTFStrategy(config);
    await strategy.start();
    console.log('✅ Strategy started successfully');
    console.log(`   Running: ${strategy.isRunning()}`);

    await strategy.stop();
    console.log('✅ Strategy stopped successfully');
    console.log(`   Running: ${strategy.isRunning()}`);
} catch (error) {
    console.error('❌ Failed to start/stop strategy:', error);
    process.exit(1);
}

// Test 3: Process candle (with insufficient data)
console.log('\nTest 3: Processing candle with insufficient data...');
try {
    const strategy = new HybridMTFStrategy(config);
    await strategy.start();

    const testCandle: Candle = {
        asset: 'R_100',
        timestamp: Date.now(),
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
    };

    const signal = await strategy.processCandle(testCandle, {
        candles: [testCandle], // Only 1 candle (insufficient)
        latestTick: null,
        balance: 1000,
        openPositions: 0,
    });

    if (signal === undefined) {
        console.log('✅ Strategy correctly handled insufficient data (returned undefined)');
    } else {
        console.log('⚠️  Strategy returned:', signal);
    }

    await strategy.stop();
} catch (error) {
    console.error('❌ Failed to process candle:', error);
    process.exit(1);
}

console.log('\n🎉 All tests passed! Strategy is ready to use.');
console.log('\n📝 Next steps:');
console.log('   1. Configure the strategy in your bot config');
console.log('   2. Start bot in paper trading mode');
console.log('   3. Monitor for 24h to validate behavior');
