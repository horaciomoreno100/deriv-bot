#!/usr/bin/env npx tsx
/**
 * Compare All Strategies - 1 Month Backtest
 *
 * Runs backtests on all available strategies with R_75 and R_100
 * using 1 month (30 days) of data to compare performance.
 *
 * Usage:
 *   npx tsx src/scripts/compare-all-strategies-1month.ts
 * 
 * Or with custom days:
 *   DAYS=30 npx tsx src/scripts/compare-all-strategies-1month.ts
 */

import * as path from 'path';
import { existsSync } from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  // Strategy factories
  createBBSqueezeStrategy,
  createBBSqueezeMRStrategy,
  createKeltnerMRStrategy,
  createHybridMTFStrategy,
  createFVGStrategy,
  createFVGLiquiditySweepStrategy,
  createMTFLevelsStrategy,
  type BacktestResult,
} from '../backtest/index.js';

// Configuration
const DAYS = parseInt(process.env.DAYS || '30'); // 1 month default
const ASSETS = ['R_75', 'R_100'];
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface StrategyResult {
  asset: string;
  strategy: string;
  result: BacktestResult;
}

interface StrategyDefinition {
  name: string;
  factory: (asset: string) => any;
  enabled: boolean;
}

// Define all available strategies
const ALL_STRATEGIES: StrategyDefinition[] = [
  {
    name: 'BB-Squeeze',
    factory: (asset) => createBBSqueezeStrategy(asset),
    enabled: true,
  },
  {
    name: 'BB-Squeeze-MR',
    factory: (asset) => createBBSqueezeMRStrategy(asset),
    enabled: true,
  },
  {
    name: 'Hybrid-MTF',
    factory: (asset) => createHybridMTFStrategy(asset),
    enabled: true,
  },
  {
    name: 'FVG',
    factory: (asset) => createFVGStrategy(asset),
    enabled: true,
  },
  {
    name: 'FVG-Liquidity-Sweep',
    factory: (asset) => createFVGLiquiditySweepStrategy(asset),
    enabled: true,
  },
  {
    name: 'Keltner-MR',
    factory: (asset) => createKeltnerMRStrategy(asset),
    enabled: true,
  },
  {
    name: 'MTF-Levels',
    factory: (asset) => createMTFLevelsStrategy(asset),
    enabled: true,
  },
];

/**
 * Find data file for asset
 */
function findDataFile(asset: string, days: number): string | null {
  const possiblePaths = [
    // Try different naming conventions
    path.join(process.cwd(), 'data', `${asset}_1m_${days}d.csv`),
    path.join(process.cwd(), 'data', `${asset}_60s_${days}d.csv`),
    path.join(process.cwd(), 'backtest-data', `${asset}_1m_${days}d.csv`),
    path.join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`),
    path.join(process.cwd(), 'packages', 'trader', 'data', `${asset}_1m_${days}d.csv`),
    path.join(process.cwd(), 'packages', 'trader', 'data', `${asset}_60s_${days}d.csv`),
    path.join(process.cwd(), 'packages', 'trader', 'backtest-data', `${asset}_1m_${days}d.csv`),
    path.join(process.cwd(), 'packages', 'trader', 'backtest-data', `${asset}_60s_${days}d.csv`),
    // Try with 90d file and truncate later
    path.join(process.cwd(), 'data', `${asset}_1m_90d.csv`),
    path.join(process.cwd(), 'data', `${asset}_60s_90d.csv`),
    path.join(process.cwd(), 'backtest-data', `${asset}_1m_90d.csv`),
    path.join(process.cwd(), 'backtest-data', `${asset}_60s_90d.csv`),
  ];

  for (const dataPath of possiblePaths) {
    if (existsSync(dataPath)) {
      return dataPath;
    }
  }

  return null;
}

/**
 * Load candles and limit to specified days
 */
function loadCandlesForDays(asset: string, days: number) {
  // First try exact days file
  let dataFile = findDataFile(asset, days);
  
  if (!dataFile) {
    // Try 90d file and truncate
    dataFile = findDataFile(asset, 90);
    if (!dataFile) {
      throw new Error(
        `No data file found for ${asset}. Please fetch data first:\n` +
        `  SYMBOLS="${asset}" DAYS=${days} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`
      );
    }
  }

  console.log(`📂 Loading data from: ${dataFile}`);
  
  const candles = loadCandlesFromCSV(dataFile, {
    asset,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
  });

  // If we loaded more than requested, truncate to last N days
  if (candles.length > 0) {
    const firstTimestamp = candles[0]!.timestamp;
    const lastTimestamp = candles[candles.length - 1]!.timestamp;
    const totalSeconds = lastTimestamp - firstTimestamp;
    const requestedSeconds = days * 24 * 60 * 60;
    
    if (totalSeconds > requestedSeconds) {
      const cutoffTimestamp = lastTimestamp - requestedSeconds;
      const filtered = candles.filter(c => c.timestamp >= cutoffTimestamp);
      console.log(`   Truncated from ${candles.length} to ${filtered.length} candles (last ${days} days)`);
      return filtered;
    }
  }

  return candles;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     COMPARE ALL STRATEGIES - 1 MONTH BACKTEST             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📅 Period: ${DAYS} days`);
  console.log(`📊 Assets: ${ASSETS.join(', ')}`);
  console.log(`🎯 Strategies: ${ALL_STRATEGIES.filter(s => s.enabled).length}`);
  console.log();

  const allResults: StrategyResult[] = [];
  const startTime = Date.now();

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📊 ASSET: ${asset}`);
    console.log('═'.repeat(80));

    // Load data
    let candles;
    try {
      candles = loadCandlesForDays(asset, DAYS);
    } catch (error: any) {
      console.error(`❌ ${error.message}`);
      continue;
    }

    if (candles.length === 0) {
      console.error(`❌ No candles loaded for ${asset}`);
      continue;
    }

    const firstCandle = candles[0]!;
    const lastCandle = candles[candles.length - 1]!;
    const firstDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
    const lastDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];
    
    console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
    console.log(`   Period: ${firstDate} → ${lastDate}`);
    console.log();

    // Run each strategy
    const enabledStrategies = ALL_STRATEGIES.filter(s => s.enabled);
    
    for (const strategyDef of enabledStrategies) {
      console.log(`\n🎯 Strategy: ${strategyDef.name}`);
      console.log('-'.repeat(60));

      try {
        const strategy = strategyDef.factory(asset);

        const result = runBacktest(strategy, candles, {
          asset,
          timeframe: 60,
          initialBalance: INITIAL_BALANCE,
          stakeMode: 'percentage',
          stakePct: STAKE_PCT,
          stakeAmount: INITIAL_BALANCE * STAKE_PCT,
          multiplier: MULTIPLIER,
        }, {
          runMonteCarlo: false, // Skip for speed
          runOOS: false,
          verbose: false,
        });

        allResults.push({ asset, strategy: strategyDef.name, result });

        // Quick summary
        const { metrics } = result;
        const emoji = metrics.netPnl > 0 ? '✅' : '❌';
        const pf = metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
        console.log(
          `   ${emoji} Trades: ${metrics.totalTrades} | ` +
          `WR: ${metrics.winRate.toFixed(1)}% | ` +
          `P&L: $${metrics.netPnl.toFixed(2)} | ` +
          `PF: ${pf} | ` +
          `MaxDD: ${metrics.maxDrawdownPct.toFixed(1)}%`
        );

        // Export JSON
        const jsonPath = quickExport(result);
        console.log(`   📄 Saved: ${jsonPath}`);
      } catch (error: any) {
        console.error(`   ❌ Error: ${error.message}`);
        if (error.stack) {
          console.error(`   Stack: ${error.stack.split('\n')[1]?.trim()}`);
        }
      }
    }
  }

  const elapsed = Date.now() - startTime;

  // Final comparison table
  console.log('\n\n' + '═'.repeat(100));
  console.log('                          COMPARISON SUMMARY');
  console.log('═'.repeat(100));
  console.log();
  console.log('Asset      Strategy              Trades   WR%     P&L         PF      MaxDD%    ROI%');
  console.log('-'.repeat(100));

  // Sort by P&L descending
  const sortedResults = [...allResults].sort((a, b) => b.result.metrics.netPnl - a.result.metrics.netPnl);

  for (const { asset, strategy, result } of sortedResults) {
    const { metrics } = result;
    const pf = metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
    const roi = ((metrics.netPnl / INITIAL_BALANCE) * 100).toFixed(1);
    const pnlStr = `$${metrics.netPnl >= 0 ? '+' : ''}${metrics.netPnl.toFixed(2)}`;
    
    console.log(
      `${asset.padEnd(10)} ${strategy.padEnd(20)} ` +
      `${String(metrics.totalTrades).padStart(6)}   ` +
      `${metrics.winRate.toFixed(1).padStart(5)}%  ` +
      `${pnlStr.padStart(10)}  ` +
      `${pf.padStart(6)}  ` +
      `${metrics.maxDrawdownPct.toFixed(1).padStart(6)}%  ` +
      `${roi.padStart(5)}%`
    );
  }

  console.log('-'.repeat(100));

  // Best strategy per asset
  console.log('\n🏆 BEST BY ASSET:');
  for (const asset of ASSETS) {
    const assetResults = allResults.filter(r => r.asset === asset);
    if (assetResults.length === 0) continue;
    
    const best = assetResults.reduce((a, b) =>
      b.result.metrics.netPnl > a.result.metrics.netPnl ? b : a
    );
    const roi = ((best.result.metrics.netPnl / INITIAL_BALANCE) * 100).toFixed(1);
    console.log(
      `   ${asset}: ${best.strategy.padEnd(20)} ` +
      `($${best.result.metrics.netPnl.toFixed(2)}, ` +
      `${roi}% ROI, ` +
      `${best.result.metrics.winRate.toFixed(1)}% WR, ` +
      `${best.result.metrics.totalTrades} trades)`
    );
  }

  // Best overall
  if (sortedResults.length > 0) {
    const bestOverall = sortedResults[0]!;
    const roi = ((bestOverall.result.metrics.netPnl / INITIAL_BALANCE) * 100).toFixed(1);
    console.log(`\n🥇 BEST OVERALL: ${bestOverall.asset} + ${bestOverall.strategy}`);
    console.log(
      `   P&L: $${bestOverall.result.metrics.netPnl.toFixed(2)} ` +
      `(${roi}% ROI) | ` +
      `WR: ${bestOverall.result.metrics.winRate.toFixed(1)}% | ` +
      `Trades: ${bestOverall.result.metrics.totalTrades} | ` +
      `PF: ${bestOverall.result.metrics.profitFactor === Infinity ? '∞' : bestOverall.result.metrics.profitFactor.toFixed(2)} | ` +
      `MaxDD: ${bestOverall.result.metrics.maxDrawdownPct.toFixed(1)}%`
    );
  }

  // Summary statistics
  const profitable = sortedResults.filter(r => r.result.metrics.netPnl > 0).length;
  const total = sortedResults.length;
  const avgPnl = sortedResults.reduce((sum, r) => sum + r.result.metrics.netPnl, 0) / total;
  const avgWr = sortedResults.reduce((sum, r) => sum + r.result.metrics.winRate, 0) / total;

  console.log(`\n📊 SUMMARY STATISTICS:`);
  console.log(`   Profitable strategies: ${profitable}/${total} (${((profitable/total)*100).toFixed(1)}%)`);
  console.log(`   Average P&L: $${avgPnl.toFixed(2)}`);
  console.log(`   Average Win Rate: ${avgWr.toFixed(1)}%`);

  console.log(`\n⏱️  Total time: ${(elapsed / 1000).toFixed(1)}s`);
  console.log('✅ All backtests complete!');
}

main().catch(console.error);

