#!/usr/bin/env npx tsx
/**
 * BB-Squeeze Backtest Runner (Unified System)
 *
 * Uses the unified backtest engine to run BB-Squeeze strategy
 * and generate charts.
 *
 * Usage:
 *   ASSET="R_75" DAYS=7 CHART=true npx tsx src/scripts/backtest-bb-squeeze-unified.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  quickExportChart,
  createBBSqueezeStrategy,
} from '../backtest/index.js';

// Configuration from environment
const ASSETS = (process.env.ASSET ?? 'R_75').split(',').map(a => a.trim());
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE ?? '1000');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER ?? '100');
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');

// Analysis flags
const RUN_MONTE_CARLO = process.env.MONTE_CARLO !== 'false';
const EXPORT_CHART = process.env.CHART !== 'false';
const EXPORT_JSON = process.env.JSON !== 'false';

interface AssetResult {
  asset: string;
  trades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
}

async function runBacktestForAsset(asset: string): Promise<AssetResult | null> {
  console.log('\n' + '═'.repeat(60));
  console.log(`BACKTESTING: ${asset} (BB-Squeeze)`);
  console.log('═'.repeat(60));

  // Try to find data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${asset}_1m_${DAYS}d.csv`,
    `${asset}_60s_${DAYS}d.csv`,
    `${asset}_1m_7d.csv`,
    `${asset}_60s_7d.csv`,
    `${asset}_1m_30d.csv`,
    `${asset}_60s_30d.csv`,
    `${asset}_1m_60d.csv`,
    `${asset}_1m_90d.csv`,
    `${asset}_60s_90d.csv`,
  ];

  let dataPath: string | null = null;
  for (const file of possibleFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      dataPath = fullPath;
      break;
    }
  }

  if (!dataPath) {
    console.log(`\n❌ No data file found for ${asset}`);
    console.log('Please fetch data first with:');
    console.log(`  SYMBOLS="${asset}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    return null;
  }

  console.log(`\n📂 Loading data from: ${path.basename(dataPath)}`);

  let candles;
  try {
    candles = loadCandlesFromCSV(dataPath, {
      asset,
      timeframe: 60,
      timestampColumn: 'timestamp',
      openColumn: 'open',
      highColumn: 'high',
      lowColumn: 'low',
      closeColumn: 'close',
      timestampFormat: 'unix_ms',
    });
  } catch (error) {
    console.error(`❌ Failed to load CSV: ${error}`);
    return null;
  }

  console.log(`   Total candles loaded: ${candles.length.toLocaleString()}`);

  // Filter by days if needed
  const targetCandles = DAYS * 24 * 60; // candles needed for X days
  let candlesToUse = candles;

  if (candles.length > targetCandles) {
    candlesToUse = candles.slice(-targetCandles);
    console.log(`   Using last ${DAYS} days: ${candlesToUse.length.toLocaleString()} candles`);
  }

  if (candlesToUse.length < 100) {
    console.log(`❌ Not enough candles (need at least 100)`);
    return null;
  }

  const firstCandle = candlesToUse[0]!;
  const lastCandle = candlesToUse[candlesToUse.length - 1]!;
  console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);

  // Create strategy
  console.log(`\n📊 Strategy: BB-Squeeze for ${asset}`);
  const strategy = createBBSqueezeStrategy(asset);
  console.log(`   Required indicators: ${strategy.requiredIndicators().join(', ')}`);

  // Run backtest
  console.log('\n🚀 Running backtest...');
  const startTime = Date.now();

  const result = runBacktest(strategy, candlesToUse, {
    asset,
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

  // Print results
  printBacktestResult(result);

  // Export
  if (EXPORT_JSON && result.trades.length > 0) {
    console.log('\n📄 Exporting JSON...');
    const jsonPath = quickExport(result);
    console.log(`   Saved to: ${jsonPath}`);
  }

  if (EXPORT_CHART && result.trades.length > 0) {
    console.log('\n📈 Generating chart...');
    const chartPath = quickExportChart(result, undefined, {
      title: `BB-Squeeze - ${asset} (${DAYS} days)`,
      showIndicators: ['rsi', 'bbands', 'squeeze'],
    });
    console.log(`   Saved to: ${chartPath}`);
  }

  return {
    asset,
    trades: result.metrics.totalTrades,
    winRate: result.metrics.winRate,
    netPnl: result.metrics.netPnl,
    profitFactor: result.metrics.profitFactor,
    maxDrawdown: result.metrics.maxDrawdownPct,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     BB-SQUEEZE BACKTEST (Unified Engine)                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Assets: ${ASSETS.join(', ')}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`Multiplier: x${MULTIPLIER}`);
  console.log(`Monte Carlo: ${RUN_MONTE_CARLO ? 'enabled' : 'disabled'}`);
  console.log(`Export Chart: ${EXPORT_CHART ? 'yes' : 'no'}`);
  console.log(`Export JSON: ${EXPORT_JSON ? 'yes' : 'no'}`);

  const results: AssetResult[] = [];

  for (const asset of ASSETS) {
    const result = await runBacktestForAsset(asset);
    if (result) {
      results.push(result);
    }
  }

  // Summary table
  if (results.length > 0) {
    console.log('\n\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log();
    console.log('┌──────────┬────────┬──────────┬────────────┬────────────┬───────────┐');
    console.log('│ Asset    │ Trades │ Win Rate │ Net P&L    │ PF         │ Max DD    │');
    console.log('├──────────┼────────┼──────────┼────────────┼────────────┼───────────┤');

    for (const r of results) {
      const pf = r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2);
      console.log(
        `│ ${r.asset.padEnd(8)} │ ${r.trades.toString().padStart(6)} │ ${(r.winRate.toFixed(1) + '%').padStart(8)} │ ${('$' + r.netPnl.toFixed(2)).padStart(10)} │ ${pf.padStart(10)} │ ${(r.maxDrawdown.toFixed(1) + '%').padStart(9)} │`
      );
    }

    console.log('└──────────┴────────┴──────────┴────────────┴────────────┴───────────┘');

    // Totals
    const totalTrades = results.reduce((sum, r) => sum + r.trades, 0);
    const totalPnl = results.reduce((sum, r) => sum + r.netPnl, 0);
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;

    console.log();
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`Avg Win Rate: ${avgWinRate.toFixed(1)}%`);
  }

  console.log('\n✅ Backtest complete!');
}

main().catch(console.error);
