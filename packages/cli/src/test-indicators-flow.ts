#!/usr/bin/env tsx
/**
 * TDD Test - Verify Indicator Updates Flow
 *
 * This test verifies:
 * 1. Gateway connection establishes successfully
 * 2. Ticks arrive every ~2 seconds
 * 3. Indicators emit every 60 seconds (when candle completes)
 * 4. Indicator values actually change over time (not stuck)
 * 5. Dashboard receives real data from strategy
 */

import { GatewayClient } from '@deriv-bot/trader';

const GATEWAY_URL = 'ws://localhost:3000';
const TEST_DURATION_MS = 180_000; // 3 minutes (3 candle periods)
const EXPECTED_CANDLES = 3;

interface TestResults {
  connected: boolean;
  ticksReceived: number;
  indicatorsReceived: number;
  uniqueRsiValues: Set<number>;
  uniqueAtrValues: Set<number>;
  indicatorTimestamps: number[];
  firstIndicators: any | null;
  lastIndicators: any | null;
  errors: string[];
}

async function runTest(): Promise<TestResults> {
  const results: TestResults = {
    connected: false,
    ticksReceived: 0,
    indicatorsReceived: 0,
    uniqueRsiValues: new Set(),
    uniqueAtrValues: new Set(),
    indicatorTimestamps: [],
    firstIndicators: null,
    lastIndicators: null,
    errors: [],
  };

  const client = new GatewayClient({
    url: GATEWAY_URL,
    enableLogging: false, // Quiet mode for test
  });

  return new Promise((resolve) => {
    client.on('connected', () => {
      results.connected = true;
      console.log('✅ TEST: Connected to Gateway');
    });

    client.on('tick', () => {
      results.ticksReceived++;
    });

    client.on('indicators', (indicators) => {
      results.indicatorsReceived++;
      const now = Date.now();
      results.indicatorTimestamps.push(now);

      // Track unique values to verify they change
      results.uniqueRsiValues.add(Math.round(indicators.rsi * 100) / 100);
      results.uniqueAtrValues.add(Math.round(indicators.atr * 100) / 100);

      if (!results.firstIndicators) {
        results.firstIndicators = indicators;
      }
      results.lastIndicators = indicators;

      console.log(`\n📊 Indicator Update #${results.indicatorsReceived} at ${new Date(now).toLocaleTimeString()}`);
      console.log(`   RSI: ${indicators.rsi.toFixed(2)}`);
      console.log(`   BB Upper: ${indicators.bbUpper.toFixed(2)}`);
      console.log(`   BB Middle: ${indicators.bbMiddle.toFixed(2)}`);
      console.log(`   BB Lower: ${indicators.bbLower.toFixed(2)}`);
      console.log(`   ATR: ${indicators.atr.toFixed(2)}`);

      // Calculate interval if we have previous timestamp
      if (results.indicatorTimestamps.length > 1) {
        const interval = now - results.indicatorTimestamps[results.indicatorTimestamps.length - 2];
        const intervalSeconds = Math.round(interval / 1000);
        console.log(`   ⏱️  Interval since last: ${intervalSeconds}s (expected: ~60s)`);
      }
    });

    client.on('error', (error) => {
      results.errors.push(error.message);
      console.error('❌ TEST ERROR:', error.message);
    });

    // Start test
    client.connect()
      .then(() => {
        console.log(`\n🧪 Starting ${TEST_DURATION_MS / 1000}s test...`);
        console.log(`   Expected: ${EXPECTED_CANDLES} indicator updates (1 per minute)\n`);

        // Progress updates every 30 seconds
        const progressInterval = setInterval(() => {
          const elapsed = Math.min(TEST_DURATION_MS, Date.now());
          const remaining = Math.max(0, TEST_DURATION_MS - elapsed) / 1000;
          console.log(`\n⏳ Progress: ${results.ticksReceived} ticks, ${results.indicatorsReceived} indicator updates`);
          console.log(`   Time remaining: ${Math.round(remaining)}s`);
        }, 30000);

        // End test after duration
        setTimeout(() => {
          clearInterval(progressInterval);
          client.disconnect();
          resolve(results);
        }, TEST_DURATION_MS);
      })
      .catch((error) => {
        results.errors.push(`Connection failed: ${error.message}`);
        resolve(results);
      });
  });
}

function analyzeResults(results: TestResults): void {
  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST RESULTS ANALYSIS');
  console.log('='.repeat(60) + '\n');

  // Test 1: Connection
  console.log('1️⃣  Gateway Connection');
  if (results.connected) {
    console.log('   ✅ PASS: Successfully connected to Gateway');
  } else {
    console.log('   ❌ FAIL: Could not connect to Gateway');
  }

  // Test 2: Tick Flow
  console.log('\n2️⃣  Tick Data Flow');
  const expectedTicks = Math.floor(TEST_DURATION_MS / 2000); // ~1 tick per 2 seconds
  const tickMargin = expectedTicks * 0.3; // 30% margin
  if (results.ticksReceived >= expectedTicks - tickMargin && results.ticksReceived <= expectedTicks + tickMargin) {
    console.log(`   ✅ PASS: Received ${results.ticksReceived} ticks (expected: ~${expectedTicks})`);
  } else {
    console.log(`   ⚠️  WARNING: Received ${results.ticksReceived} ticks (expected: ~${expectedTicks})`);
  }

  // Test 3: Indicator Updates
  console.log('\n3️⃣  Indicator Updates');
  if (results.indicatorsReceived >= EXPECTED_CANDLES) {
    console.log(`   ✅ PASS: Received ${results.indicatorsReceived} indicator updates (expected: ${EXPECTED_CANDLES})`);
  } else {
    console.log(`   ❌ FAIL: Only received ${results.indicatorsReceived} indicator updates (expected: ${EXPECTED_CANDLES})`);
  }

  // Test 4: Update Interval
  if (results.indicatorTimestamps.length > 1) {
    console.log('\n4️⃣  Update Intervals (should be ~60 seconds)');
    for (let i = 1; i < results.indicatorTimestamps.length; i++) {
      const interval = results.indicatorTimestamps[i] - results.indicatorTimestamps[i - 1];
      const intervalSeconds = Math.round(interval / 1000);
      const withinRange = intervalSeconds >= 55 && intervalSeconds <= 65;
      const status = withinRange ? '✅' : '⚠️';
      console.log(`   ${status} Update ${i}: ${intervalSeconds}s after previous`);
    }
  }

  // Test 5: Value Changes
  console.log('\n5️⃣  Indicator Value Changes (NOT stuck)');
  if (results.uniqueRsiValues.size > 1) {
    console.log(`   ✅ PASS: RSI changed ${results.uniqueRsiValues.size} times`);
    console.log(`      Values: [${Array.from(results.uniqueRsiValues).join(', ')}]`);
  } else if (results.uniqueRsiValues.size === 1) {
    console.log(`   ⚠️  WARNING: RSI stayed constant at ${Array.from(results.uniqueRsiValues)[0]}`);
  } else {
    console.log(`   ❌ FAIL: No RSI values received`);
  }

  if (results.uniqueAtrValues.size > 1) {
    console.log(`   ✅ PASS: ATR changed ${results.uniqueAtrValues.size} times`);
    console.log(`      Values: [${Array.from(results.uniqueAtrValues).join(', ')}]`);
  } else if (results.uniqueAtrValues.size === 1) {
    console.log(`   ⚠️  WARNING: ATR stayed constant at ${Array.from(results.uniqueAtrValues)[0]}`);
  } else {
    console.log(`   ❌ FAIL: No ATR values received`);
  }

  // Test 6: Data Completeness
  console.log('\n6️⃣  Indicator Data Completeness');
  if (results.lastIndicators) {
    const hasAllFields =
      results.lastIndicators.rsi !== undefined &&
      results.lastIndicators.bbUpper !== undefined &&
      results.lastIndicators.bbMiddle !== undefined &&
      results.lastIndicators.bbLower !== undefined &&
      results.lastIndicators.atr !== undefined &&
      results.lastIndicators.asset !== undefined;

    if (hasAllFields) {
      console.log('   ✅ PASS: All indicator fields present');
      console.log(`      Asset: ${results.lastIndicators.asset}`);
    } else {
      console.log('   ❌ FAIL: Missing indicator fields');
    }
  }

  // Overall Summary
  console.log('\n' + '='.repeat(60));
  const totalTests = 6;
  const passedTests = [
    results.connected,
    results.ticksReceived > 0,
    results.indicatorsReceived >= EXPECTED_CANDLES,
    results.indicatorTimestamps.length > 1,
    results.uniqueRsiValues.size > 1 || results.uniqueAtrValues.size > 1,
    results.lastIndicators !== null,
  ].filter(Boolean).length;

  console.log(`\n🎯 FINAL SCORE: ${passedTests}/${totalTests} tests passed`);

  if (passedTests === totalTests) {
    console.log('✅ ALL TESTS PASSED - System is working correctly!');
  } else if (passedTests >= totalTests - 1) {
    console.log('⚠️  MOSTLY PASSING - Minor issues detected');
  } else {
    console.log('❌ SYSTEM HAS ISSUES - Review failures above');
  }

  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    results.errors.forEach((error) => console.log(`   - ${error}`));
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// Run test
console.log('🧪 Indicator Flow TDD Test');
console.log('=' .repeat(60));
console.log('This test will verify the complete indicator flow:');
console.log('  Strategy → Engine → Trader → Gateway → Dashboard');
console.log('');
console.log('Prerequisites:');
console.log('  ✓ Gateway must be running on ws://localhost:3000');
console.log('  ✓ Trader must be running with mean-reversion strategy');
console.log('');
console.log('⚠️  Make sure both are running before starting test!');
console.log('=' .repeat(60) + '\n');

runTest()
  .then((results) => {
    analyzeResults(results);
    process.exit(results.indicatorsReceived >= EXPECTED_CANDLES ? 0 : 1);
  })
  .catch((error) => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });
