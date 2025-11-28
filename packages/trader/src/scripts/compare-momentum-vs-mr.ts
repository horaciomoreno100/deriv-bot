#!/usr/bin/env npx tsx
/**
 * Compare Momentum vs Mean Reversion Strategies
 *
 * Shows the difference between:
 * - BB-Squeeze (momentum): Enters on breakout ABOVE/BELOW bands
 * - BB-Squeeze-MR (mean reversion): Enters at bands expecting REVERSION
 *
 * Usage:
 *   ASSET="R_100" DATA_FILE="data/R_100_1m_7d.csv" npx tsx src/scripts/compare-momentum-vs-mr.ts
 */

import * as path from 'path';
import {
  loadCandlesFromCSV,
  createBBSqueezeStrategy,
  createBBSqueezeMRStrategy,
  runBacktest,
  printBacktestResult,
  quickExportChart,
  type BacktestResult,
} from '../backtest/index.js';

const ASSET = process.env.ASSET ?? 'R_100';
const DATA_FILE = process.env.DATA_FILE ?? `data/${ASSET}_1m_7d.csv`;
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface StrategyComparison {
  name: string;
  description: string;
  result: BacktestResult;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     MOMENTUM vs MEAN REVERSION COMPARISON                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Load data
  console.log(`📂 Loading: ${DATA_FILE}`);
  const dataPath = path.join(process.cwd(), DATA_FILE);

  let candles;
  try {
    candles = loadCandlesFromCSV(dataPath, {
      asset: ASSET,
      timeframe: 60,
      timestampColumn: 'timestamp',
      timestampFormat: 'unix_ms',
    });
  } catch (error) {
    console.error(`❌ Failed to load CSV: ${error}`);
    process.exit(1);
  }

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);
  console.log();

  const comparisons: StrategyComparison[] = [];

  // Strategy 1: BB-Squeeze (Momentum/Breakout)
  console.log('━'.repeat(60));
  console.log('🚀 STRATEGY 1: BB-Squeeze (Momentum/Breakout)');
  console.log('   Entry Logic: CALL when price > BB_Upper + RSI > 55');
  console.log('                PUT when price < BB_Lower + RSI < 45');
  console.log('   Philosophy: Follow the breakout momentum');
  console.log('━'.repeat(60));

  const momentumStrategy = createBBSqueezeStrategy(ASSET);
  const momentumResult = runBacktest(momentumStrategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_BALANCE,
    stakeMode: 'percentage',
    stakePct: STAKE_PCT,
    stakeAmount: INITIAL_BALANCE * STAKE_PCT,
    multiplier: MULTIPLIER,
  }, {
    runMonteCarlo: false,
    runOOS: false,
    verbose: false,
  });

  comparisons.push({
    name: 'BB-Squeeze (Momentum)',
    description: 'Enters on breakout',
    result: momentumResult,
  });

  console.log(`   ✅ Trades: ${momentumResult.metrics.totalTrades}`);
  console.log(`   WR: ${momentumResult.metrics.winRate.toFixed(1)}% | P&L: $${momentumResult.metrics.netPnl.toFixed(2)}`);
  console.log();

  // Strategy 2: BB-Squeeze-MR (Mean Reversion)
  console.log('━'.repeat(60));
  console.log('🔄 STRATEGY 2: BB-Squeeze-MR (Mean Reversion)');
  console.log('   Entry Logic: CALL when price <= BB_Lower + RSI < 30');
  console.log('                PUT when price >= BB_Upper + RSI > 70');
  console.log('   Philosophy: Price reverts to mean from extremes');
  console.log('━'.repeat(60));

  const mrStrategy = createBBSqueezeMRStrategy(ASSET);
  const mrResult = runBacktest(mrStrategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_BALANCE,
    stakeMode: 'percentage',
    stakePct: STAKE_PCT,
    stakeAmount: INITIAL_BALANCE * STAKE_PCT,
    multiplier: MULTIPLIER,
  }, {
    runMonteCarlo: false,
    runOOS: false,
    verbose: false,
  });

  comparisons.push({
    name: 'BB-Squeeze-MR (Reversion)',
    description: 'Enters at extremes expecting bounce',
    result: mrResult,
  });

  console.log(`   ✅ Trades: ${mrResult.metrics.totalTrades}`);
  console.log(`   WR: ${mrResult.metrics.winRate.toFixed(1)}% | P&L: $${mrResult.metrics.netPnl.toFixed(2)}`);
  console.log();

  // Comparison Table
  console.log();
  console.log('═'.repeat(70));
  console.log('                      COMPARISON RESULTS');
  console.log('═'.repeat(70));
  console.log();
  console.log('Strategy                  Trades    WR%      P&L       PF     MaxDD%');
  console.log('-'.repeat(70));

  for (const { name, result } of comparisons) {
    const { metrics } = result;
    const pf = metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
    console.log(
      `${name.padEnd(25)} ${String(metrics.totalTrades).padStart(6)}   ${metrics.winRate.toFixed(1).padStart(5)}%  ${('$' + metrics.netPnl.toFixed(2)).padStart(8)}  ${pf.padStart(6)}  ${metrics.maxDrawdownPct.toFixed(1).padStart(6)}%`
    );
  }

  console.log('-'.repeat(70));
  console.log();

  // Winner
  const winner = comparisons.reduce((a, b) =>
    b.result.metrics.netPnl > a.result.metrics.netPnl ? b : a
  );

  console.log(`🏆 WINNER: ${winner.name}`);
  console.log(`   P&L: $${winner.result.metrics.netPnl.toFixed(2)}`);
  console.log();

  // Generate charts for both
  console.log('📈 Generating charts...');

  for (const { name, result } of comparisons) {
    if (result.trades.length === 0) {
      console.log(`   ⚠️  ${name}: No trades to chart`);
      continue;
    }
    const chartPath = quickExportChart(result, undefined, {
      title: `${name} - ${ASSET}`,
      showIndicators: ['rsi', 'bbands', 'squeeze'],
    });
    console.log(`   ${name}: ${chartPath}`);
  }

  // Analysis
  console.log();
  console.log('═'.repeat(70));
  console.log('                         ANALYSIS');
  console.log('═'.repeat(70));
  console.log();

  if (momentumResult.metrics.netPnl > mrResult.metrics.netPnl) {
    console.log('📊 Momentum strategy performed better.');
    console.log('   This suggests the market has been TRENDING during this period.');
    console.log('   Breakouts led to continued moves in the same direction.');
  } else {
    console.log('📊 Mean Reversion strategy performed better.');
    console.log('   This suggests the market has been RANGING during this period.');
    console.log('   Price reversed from band extremes instead of breaking through.');
  }

  console.log();
  console.log('💡 Key insight from your observation:');
  console.log('   "Las entradas se hacen del lado contrario de la banda"');
  console.log();
  console.log('   BB-Squeeze (momentum): price > BB_Upper → CALL (buy high, sell higher)');
  console.log('   BB-Squeeze-MR (reversion): price <= BB_Lower → CALL (buy low, sell at mean)');
  console.log();
  console.log('   La estrategia ideal depende del régimen del mercado:');
  console.log('   - Trending → Momentum funciona mejor');
  console.log('   - Ranging → Mean Reversion funciona mejor');
  console.log();

  console.log('✅ Comparison complete! Check the charts to visualize the difference.');
}

main().catch(console.error);
