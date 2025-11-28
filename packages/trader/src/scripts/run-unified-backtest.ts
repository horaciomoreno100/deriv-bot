#!/usr/bin/env npx tsx
/**
 * Unified Backtest Runner
 *
 * Example script showing how to use the new backtest engine.
 *
 * Usage:
 *   ASSET="R_100" DATA_FILE="analysis-output/R_100_60s_90d.csv" npx tsx src/scripts/run-unified-backtest.ts
 */

import * as path from 'path';
import {
  // Data loading
  loadCandlesFromCSV,
  // Strategy
  createBBSqueezeStrategy,
  // Runner
  runBacktest,
  // Reporters
  printBacktestResult,
  quickExport,
  quickExportChart,
} from '../backtest/index.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'R_100';
const DATA_FILE = process.env.DATA_FILE ?? `analysis-output/${ASSET}_60s_90d.csv`;
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE ?? '1000');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER ?? '100');
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');

// Analysis flags
const RUN_MONTE_CARLO = process.env.MONTE_CARLO !== 'false';
const RUN_OOS = process.env.OOS !== 'false';
const EXPORT_CHART = process.env.CHART !== 'false';
const EXPORT_JSON = process.env.JSON !== 'false';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           UNIFIED BACKTEST ENGINE v2.0                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Load data
  console.log(`📂 Loading data from: ${DATA_FILE}`);
  const dataPath = path.join(process.cwd(), DATA_FILE);

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
    });
  } catch (error) {
    console.error(`❌ Failed to load CSV: ${error}`);
    console.log('\nMake sure you have data available. You can fetch it with:');
    console.log(`  SYMBOLS="${ASSET}" DAYS=90 npx tsx src/scripts/fetch-historical-data.ts`);
    process.exit(1);
  }

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  if (candles.length === 0) {
    console.error('❌ No candles loaded');
    process.exit(1);
  }

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);
  console.log();

  // Create strategy
  console.log(`📊 Strategy: BB-Squeeze for ${ASSET}`);
  const strategy = createBBSqueezeStrategy(ASSET);
  console.log(`   Required indicators: ${strategy.requiredIndicators().join(', ')}`);
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
    monteCarloSimulations: 1000,
    runOOS: RUN_OOS,
    oosRatio: 0.7,
    verbose: true,
    onProgress: ({ current, total, phase }) => {
      if (current % 10000 === 0) {
        const pct = ((current / total) * 100).toFixed(1);
        process.stdout.write(`\r   ${phase}: ${pct}%`);
      }
    },
  });

  const elapsed = Date.now() - startTime;
  console.log(`\n   Completed in ${elapsed}ms`);
  console.log();

  // Print results
  printBacktestResult(result);

  // Export JSON
  if (EXPORT_JSON) {
    console.log('\n📄 Exporting JSON...');
    const jsonPath = quickExport(result);
    console.log(`   Saved to: ${jsonPath}`);
  }

  // Export chart
  if (EXPORT_CHART && result.trades.length > 0) {
    console.log('\n📈 Generating chart...');
    const chartPath = quickExportChart(result, undefined, {
      title: `BB-Squeeze Backtest - ${ASSET}`,
      showIndicators: ['rsi', 'bbands', 'squeeze'],
    });
    console.log(`   Saved to: ${chartPath}`);
    console.log(`   Open in browser: file://${chartPath}`);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Asset:        ${ASSET}`);
  console.log(`Trades:       ${result.metrics.totalTrades}`);
  console.log(`Win Rate:     ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`Net P&L:      $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%`);

  if (result.oosTest) {
    console.log(`\nOOS Test:     ${result.oosTest.recommendation}`);
  }

  if (result.monteCarlo) {
    console.log(`\nMonte Carlo:`);
    console.log(`  Profit Probability: ${result.monteCarlo.profitProbability.toFixed(1)}%`);
    console.log(`  Risk of Ruin:       ${result.monteCarlo.riskOfRuin.toFixed(2)}%`);
  }

  console.log('\n✅ Backtest complete!');
}

main().catch(console.error);
