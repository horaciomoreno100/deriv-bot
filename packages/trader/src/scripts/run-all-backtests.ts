#!/usr/bin/env npx tsx
/**
 * Run All Production Strategy Backtests
 *
 * Runs backtests on all strategies currently in production:
 * - BB-Squeeze (original momentum)
 * - BB-Squeeze-MR (mean reversion)
 * - Keltner-MR (mean reversion)
 * - Hybrid-MTF (multi-timeframe)
 *
 * Usage:
 *   npx tsx src/scripts/run-all-backtests.ts
 */

import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  createBBSqueezeStrategy,
  createBBSqueezeMRStrategy,
  createKeltnerMRStrategy,
  createHybridMTFStrategy,
  type BacktestResult,
} from '../backtest/index.js';

// Configuration
const ASSETS = ['R_75', 'R_100'];
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface StrategyResult {
  asset: string;
  strategy: string;
  result: BacktestResult;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       ALL PRODUCTION STRATEGIES BACKTEST                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  const allResults: StrategyResult[] = [];
  const startTime = Date.now();

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 ASSET: ${asset}`);
    console.log('═'.repeat(60));

    // Load data
    const dataFile = `data/${asset}_1m_90d.csv`;
    const dataPath = path.join(process.cwd(), dataFile);

    let candles;
    try {
      candles = loadCandlesFromCSV(dataPath, {
        asset,
        timeframe: 60,
        timestampColumn: 'timestamp',
        timestampFormat: 'unix_ms', // CSV has timestamps in milliseconds
        openColumn: 'open',
        highColumn: 'high',
        lowColumn: 'low',
        closeColumn: 'close',
      });
    } catch (error) {
      console.error(`❌ Failed to load data for ${asset}: ${error}`);
      continue;
    }

    console.log(`📂 Loaded ${candles.length.toLocaleString()} candles from ${dataFile}`);
    const firstCandle = candles[0]!;
    const lastCandle = candles[candles.length - 1]!;
    console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);

    // Define strategies to test
    const strategies = [
      { name: 'BB-Squeeze', factory: () => createBBSqueezeStrategy(asset) },
      { name: 'BB-Squeeze-MR', factory: () => createBBSqueezeMRStrategy(asset) },
      { name: 'Keltner-MR', factory: () => createKeltnerMRStrategy(asset) },
      { name: 'Hybrid-MTF', factory: () => createHybridMTFStrategy(asset) },
    ];

    for (const strategyDef of strategies) {
      console.log(`\n🎯 Strategy: ${strategyDef.name}`);
      console.log('-'.repeat(40));

      const strategy = strategyDef.factory();

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
      console.log(`   ${emoji} Trades: ${metrics.totalTrades} | WR: ${metrics.winRate.toFixed(1)}% | P&L: $${metrics.netPnl.toFixed(2)} | PF: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)} | MaxDD: ${metrics.maxDrawdownPct.toFixed(1)}%`);

      // Export JSON
      const jsonPath = quickExport(result);
      console.log(`   📄 Saved: ${jsonPath}`);
    }
  }

  const elapsed = Date.now() - startTime;

  // Final comparison table
  console.log('\n\n' + '═'.repeat(80));
  console.log('                          COMPARISON SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.log('Asset      Strategy         Trades   WR%     P&L        PF      MaxDD%');
  console.log('-'.repeat(80));

  for (const { asset, strategy, result } of allResults) {
    const { metrics } = result;
    const pf = metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
    console.log(
      `${asset.padEnd(10)} ${strategy.padEnd(16)} ${String(metrics.totalTrades).padStart(6)}   ${metrics.winRate.toFixed(1).padStart(5)}%  ${('$' + metrics.netPnl.toFixed(2)).padStart(10)}  ${pf.padStart(6)}  ${metrics.maxDrawdownPct.toFixed(1).padStart(6)}%`
    );
  }

  console.log('-'.repeat(80));

  // Best strategy per asset
  console.log('\n🏆 BEST BY ASSET:');
  for (const asset of ASSETS) {
    const assetResults = allResults.filter(r => r.asset === asset);
    const best = assetResults.reduce((a, b) =>
      b.result.metrics.netPnl > a.result.metrics.netPnl ? b : a
    );
    console.log(`   ${asset}: ${best.strategy} ($${best.result.metrics.netPnl.toFixed(2)})`);
  }

  // Best overall
  const bestOverall = allResults.reduce((a, b) =>
    b.result.metrics.netPnl > a.result.metrics.netPnl ? b : a
  );
  console.log(`\n🥇 BEST OVERALL: ${bestOverall.asset} + ${bestOverall.strategy} ($${bestOverall.result.metrics.netPnl.toFixed(2)})`);

  console.log(`\n⏱️  Total time: ${(elapsed / 1000).toFixed(1)}s`);
  console.log('✅ All backtests complete!');
}

main().catch(console.error);
