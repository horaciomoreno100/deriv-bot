#!/usr/bin/env npx tsx
/**
 * Return to Base Backtest Runner
 *
 * Tests the Return to Base (mean reversion scalping) strategy.
 *
 * Usage:
 *   ASSET="cryETHUSD" DAYS=30 npx tsx src/scripts/backtest-return-to-base.ts
 *   ASSET="frxEURUSD" DAYS=7 PRESET=forex npx tsx src/scripts/backtest-return-to-base.ts
 *   ASSET="R_100" DAYS=7 PRESET=aggressive npx tsx src/scripts/backtest-return-to-base.ts
 *
 * Environment Variables:
 *   ASSET          - Asset to test (default: R_100)
 *   DAYS           - Days of data to use (default: 7)
 *   PRESET         - Parameter preset: default, aggressive, conservative, crypto, forex
 *   DATA_FILE      - Override data file path
 *   INITIAL_BALANCE - Starting balance (default: 1000)
 *   STAKE_PCT      - Stake percentage (default: 0.02 = 2%)
 *   MULTIPLIER     - Multiplier for CFD trades (default: 100)
 *   MONTE_CARLO    - Run Monte Carlo simulation (default: true)
 *   CHART          - Generate HTML chart (default: true)
 *   JSON           - Export results to JSON (default: false)
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  quickExportChart,
  createReturnToBaseStrategy,
  createReturnToBaseForAsset,
} from '../backtest/index.js';
import {
  DEFAULT_RTB_PARAMS,
  RTB_AGGRESSIVE_PRESET,
  RTB_CONSERVATIVE_PRESET,
  RTB_CRYPTO_PRESET,
  RTB_FOREX_PRESET,
  RTB_BALANCED_PRESET,
  RTB_SYNTHETIC_PRESET,
  type ReturnToBaseParams,
} from '../strategies/return-to-base/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ASSET = process.env.ASSET ?? 'R_100';
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const PRESET = process.env.PRESET ?? 'default';
const DATA_FILE = process.env.DATA_FILE;
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE ?? '1000');
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER ?? '100');

// Analysis flags
const RUN_MONTE_CARLO = process.env.MONTE_CARLO !== 'false';
const EXPORT_CHART = process.env.CHART !== 'false';
const EXPORT_JSON = process.env.JSON === 'true';

// ============================================================================
// PRESET SELECTION
// ============================================================================

function getPresetParams(preset: string): Partial<ReturnToBaseParams> {
  switch (preset.toLowerCase()) {
    case 'aggressive':
      return RTB_AGGRESSIVE_PRESET;
    case 'conservative':
      return RTB_CONSERVATIVE_PRESET;
    case 'crypto':
      return RTB_CRYPTO_PRESET;
    case 'forex':
      return RTB_FOREX_PRESET;
    case 'balanced':
      return RTB_BALANCED_PRESET;
    case 'synthetic':
      return RTB_SYNTHETIC_PRESET;
    case 'default':
    default:
      return {};
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================

function findDataFile(asset: string, days: number): string | null {
  // If explicit file provided
  if (DATA_FILE && fs.existsSync(DATA_FILE)) {
    return DATA_FILE;
  }

  const dataDir = path.join(process.cwd(), 'data');
  const analysisDir = path.join(process.cwd(), 'analysis-output');

  // Try different file naming patterns
  const patterns = [
    `${asset}_1m_${days}d.csv`,
    `${asset}_60s_${days}d.csv`,
    `${asset}_1m_7d.csv`,
    `${asset}_1m_30d.csv`,
    `${asset}_1m_90d.csv`,
    `${asset}_1m_180d.csv`,
    `${asset}_60s_7d.csv`,
    `${asset}_60s_30d.csv`,
    `${asset}_60s_90d.csv`,
  ];

  // Check data directory
  for (const pattern of patterns) {
    const fullPath = path.join(dataDir, pattern);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Check analysis-output directory
  for (const pattern of patterns) {
    const fullPath = path.join(analysisDir, pattern);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          RETURN TO BASE - BACKTEST                         ║');
  console.log('║          Mean Reversion Scalping Strategy                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Print configuration
  console.log('📋 Configuration:');
  console.log(`   Asset: ${ASSET}`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Preset: ${PRESET}`);
  console.log(`   Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`   Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log();

  // Find data file
  const dataPath = findDataFile(ASSET, DAYS);
  if (!dataPath) {
    console.error('❌ No data file found for', ASSET);
    console.log();
    console.log('Please fetch data first with:');
    console.log(`  SYMBOLS="${ASSET}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    process.exit(1);
  }

  console.log(`📂 Loading data from: ${path.basename(dataPath)}`);

  // Load candles
  let candles;
  try {
    candles = loadCandlesFromCSV(dataPath, {
      asset: ASSET,
      timeframe: 60,
      timestampColumn: 'timestamp',
      openColumn: 'open',
      highColumn: 'high',
      lowColumn: 'low',
      closeColumn: 'close',
      timestampFormat: 'unix_ms',
    });
  } catch (error) {
    console.error('❌ Failed to load CSV:', error);
    process.exit(1);
  }

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  if (candles.length < 100) {
    console.error('❌ Not enough candles (need at least 100)');
    process.exit(1);
  }

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  const startDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];
  console.log(`   Period: ${startDate} → ${endDate}`);
  console.log();

  // Create strategy
  const presetParams = getPresetParams(PRESET);
  const strategy = createReturnToBaseForAsset(ASSET, presetParams);

  console.log('📊 Strategy: RETURN_TO_BASE');
  console.log(`   Preset: ${PRESET}`);
  console.log('   Parameters:');
  const params = strategy.getParams();
  console.log(`     - BB: period=${params.bbPeriod}, stdDev=${params.bbStdDev}`);
  console.log(`     - RSI: period=${params.rsiPeriod}, oversold=${params.rsiOversold}, overbought=${params.rsiOverbought}`);
  console.log(`     - EMA: fast=${params.emaFastPeriod}, slow=${params.emaSlowPeriod}`);
  console.log(`     - Band expansion threshold: ${(params.bandWidthExpansionThreshold * 100).toFixed(0)}%`);
  console.log(`     - Require rejection candle: ${params.requireRejectionCandle}`);
  console.log(`     - Require RSI confirmation: ${params.requireRsiConfirmation}`);
  console.log();

  // Run backtest
  console.log('🚀 Running backtest...');
  const startTime = Date.now();

  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_BALANCE,
    stakeMode: 'percentage',
    stakePct: STAKE_PCT,
    stakeAmount: INITIAL_BALANCE * STAKE_PCT,
    multiplier: MULTIPLIER,
  }, {
    runMonteCarlo: RUN_MONTE_CARLO,
    monteCarloSimulations: 500,
    runOOS: false,
    verbose: false,
  });

  const elapsed = Date.now() - startTime;
  console.log(`   Completed in ${elapsed}ms`);
  console.log();

  // Print results
  printBacktestResult(result);

  // Additional analysis
  if (result.trades.length > 0) {
    console.log('\n📈 Trade Analysis:');

    // Win rate by direction
    const callTrades = result.trades.filter(t => t.direction === 'CALL');
    const putTrades = result.trades.filter(t => t.direction === 'PUT');
    const callWins = callTrades.filter(t => t.result === 'WIN').length;
    const putWins = putTrades.filter(t => t.result === 'WIN').length;

    console.log(`   CALL trades: ${callTrades.length} (${callTrades.length > 0 ? ((callWins / callTrades.length) * 100).toFixed(1) : 0}% win rate)`);
    console.log(`   PUT trades: ${putTrades.length} (${putTrades.length > 0 ? ((putWins / putTrades.length) * 100).toFixed(1) : 0}% win rate)`);

    // Exit reasons
    const exitReasons = result.trades.reduce((acc, t) => {
      acc[t.exitReason] = (acc[t.exitReason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('   Exit reasons:');
    for (const [reason, count] of Object.entries(exitReasons)) {
      console.log(`     - ${reason}: ${count} (${((count / result.trades.length) * 100).toFixed(1)}%)`);
    }

    // Average hold time
    const avgBars = result.trades.reduce((sum, t) => sum + t.barsHeld, 0) / result.trades.length;
    console.log(`   Avg bars held: ${avgBars.toFixed(1)} bars (${(avgBars).toFixed(1)} minutes)`);
  }

  // Export
  if (EXPORT_JSON && result.trades.length > 0) {
    console.log('\n📄 Exporting JSON...');
    const jsonPath = quickExport(result);
    console.log(`   Saved to: ${jsonPath}`);
  }

  if (EXPORT_CHART && result.trades.length > 0) {
    console.log('\n📊 Generating chart...');
    try {
      const chartPath = quickExportChart(result, undefined, {
        title: `Return to Base - ${ASSET}`,
        showIndicators: ['rsi', 'bbUpper', 'bbLower', 'bbMiddle'],
      });
      console.log(`   Saved to: ${chartPath}`);
    } catch (error) {
      console.log(`   ⚠️ Chart generation failed: ${error}`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  const pf = result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2);
  const verdict = result.metrics.profitFactor >= 1.5 && result.metrics.winRate >= 50
    ? '✅ PROFITABLE'
    : result.metrics.profitFactor >= 1.0
    ? '⚠️ MARGINAL'
    : '❌ NOT PROFITABLE';

  console.log(`   ${verdict}`);
  console.log(`   Trades: ${result.metrics.totalTrades}`);
  console.log(`   Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`   Profit Factor: ${pf}`);
  console.log(`   Net P&L: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`   Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%`);

  console.log('\n✅ Backtest complete!');
}

main().catch(console.error);
