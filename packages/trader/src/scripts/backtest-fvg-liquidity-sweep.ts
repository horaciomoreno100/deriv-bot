#!/usr/bin/env npx tsx
/**
 * FVG Liquidity Sweep Backtest Runner
 *
 * Tests the FVG Liquidity Sweep strategy on synthetic indices.
 *
 * Usage:
 *   ASSET="R_100" DAYS=7 npx tsx src/scripts/backtest-fvg-liquidity-sweep.ts
 *   ASSET="R_75,R_100" DAYS=7 npx tsx src/scripts/backtest-fvg-liquidity-sweep.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  quickExportChart,
  createFVGLiquiditySweepStrategy,
} from '../backtest/index.js';

// Configuration from environment
const ASSETS = (process.env.ASSET ?? 'R_75,R_100').split(',').map(a => a.trim());
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
  avgRR: number;
}

async function runBacktestForAsset(asset: string): Promise<AssetResult | null> {
  console.log('\n' + '═'.repeat(60));
  console.log(`BACKTESTING: ${asset}`);
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

  // Also check analysis-output
  if (!dataPath) {
    const analysisDir = path.join(process.cwd(), 'analysis-output');
    for (const file of possibleFiles) {
      const fullPath = path.join(analysisDir, file);
      if (fs.existsSync(fullPath)) {
        dataPath = fullPath;
        break;
      }
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

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  if (candles.length < 100) {
    console.log(`❌ Not enough candles (need at least 100)`);
    return null;
  }

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);

  // Create strategy
  console.log(`\n📊 Strategy: FVG-Liquidity-Sweep for ${asset}`);
  const strategy = createFVGLiquiditySweepStrategy(asset);
  console.log(`   Required indicators: ${strategy.requiredIndicators().join(', ')}`);

  // Run backtest
  console.log('\n🚀 Running backtest...');
  const startTime = Date.now();

  const result = runBacktest(strategy, candles, {
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

  // Calculate average R:R
  let totalRR = 0;
  for (const trade of result.trades) {
    if (trade.result === 'WIN') {
      totalRR += Math.abs(trade.pnl) / (INITIAL_BALANCE * STAKE_PCT);
    }
  }
  const avgRR = result.metrics.wins > 0 ? totalRR / result.metrics.wins : 0;

  // Export
  if (EXPORT_JSON && result.trades.length > 0) {
    console.log('\n📄 Exporting JSON...');
    const jsonPath = quickExport(result);
    console.log(`   Saved to: ${jsonPath}`);
  }

  if (EXPORT_CHART && result.trades.length > 0) {
    console.log('\n📈 Generating chart...');
    const chartPath = quickExportChart(result, undefined, {
      title: `FVG-Liquidity-Sweep - ${asset}`,
      showIndicators: ['rsi'],
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
    avgRR,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FVG LIQUIDITY SWEEP BACKTEST                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Assets: ${ASSETS.join(', ')}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`Multiplier: x${MULTIPLIER}`);

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
    console.log('┌──────────┬────────┬──────────┬────────────┬────────────┬───────────┬────────┐');
    console.log('│ Asset    │ Trades │ Win Rate │ Net P&L    │ PF         │ Max DD    │ Avg RR │');
    console.log('├──────────┼────────┼──────────┼────────────┼────────────┼───────────┼────────┤');

    for (const r of results) {
      const pf = r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2);
      console.log(
        `│ ${r.asset.padEnd(8)} │ ${r.trades.toString().padStart(6)} │ ${(r.winRate.toFixed(1) + '%').padStart(8)} │ ${('$' + r.netPnl.toFixed(2)).padStart(10)} │ ${pf.padStart(10)} │ ${(r.maxDrawdown.toFixed(1) + '%').padStart(9)} │ ${r.avgRR.toFixed(2).padStart(6)} │`
      );
    }

    console.log('└──────────┴────────┴──────────┴────────────┴────────────┴───────────┴────────┘');

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
