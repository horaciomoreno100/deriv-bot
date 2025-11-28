#!/usr/bin/env npx tsx
/**
 * Test All Trend Exhaustion Detectors
 *
 * Compares different methods for detecting end of micro-trends:
 * 1. RSI Divergence
 * 2. Pin Bar
 * 3. Engulfing Pattern
 * 4. EMA Distance
 * 5. Exhaustion Candles
 * 6. Multi-Signal Combo
 *
 * Usage:
 *   ASSET="R_100" DATA_FILE="data/R_100_1m_7d.csv" npx tsx src/scripts/test-exhaustion-detectors.ts
 */

import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  quickExportChart,
  createTrendExhaustionStrategy,
  type BacktestResult,
  type DetectionMethod,
} from '../backtest/index.js';

const ASSET = process.env.ASSET ?? 'R_100';
const DATA_FILE = process.env.DATA_FILE ?? `data/${ASSET}_1m_7d.csv`;
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface DetectorResult {
  name: string;
  method: DetectionMethod;
  result: BacktestResult;
}

const DETECTORS: { name: string; method: DetectionMethod }[] = [
  { name: 'RSI Divergence', method: 'rsi_divergence' },
  { name: 'Pin Bar', method: 'pin_bar' },
  { name: 'Engulfing Pattern', method: 'engulfing' },
  { name: 'EMA Distance', method: 'ema_distance' },
  { name: 'Exhaustion Candles', method: 'exhaustion_candles' },
  { name: 'Multi-Signal Combo', method: 'multi_combo' },
  { name: 'ZigZag Reversal', method: 'zigzag_reversal' },
  { name: 'RSI Divergence Confirmed', method: 'rsi_divergence_confirmed' },
  { name: 'ZigZag+RSI Combo', method: 'zigzag_rsi_combo' },
  { name: 'CHoCH (SMC)', method: 'choch' },
  { name: 'CHoCH + Pullback', method: 'choch_pullback' },
  { name: 'ZigZag Strong', method: 'zigzag_strong' },
  { name: 'ZigZag PUT Only', method: 'zigzag_put_only' },
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     TREND EXHAUSTION DETECTOR COMPARISON                   ║');
  console.log('║     "El Santo Grial" - Detectando fin de micro-tendencias  ║');
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

  const results: DetectorResult[] = [];

  // Test each detector
  for (const detector of DETECTORS) {
    console.log('━'.repeat(60));
    console.log(`🔍 Testing: ${detector.name}`);
    console.log('━'.repeat(60));

    const strategy = createTrendExhaustionStrategy(ASSET, detector.method);

    const result = runBacktest(strategy, candles, {
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

    results.push({
      name: detector.name,
      method: detector.method,
      result,
    });

    const { metrics } = result;
    const emoji = metrics.netPnl > 0 ? '✅' : '❌';
    console.log(`   ${emoji} Trades: ${metrics.totalTrades} | WR: ${metrics.winRate.toFixed(1)}% | P&L: $${metrics.netPnl.toFixed(2)} | PF: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}`);
    console.log();
  }

  // Comparison Table
  console.log();
  console.log('═'.repeat(80));
  console.log('                      COMPARISON RESULTS');
  console.log('═'.repeat(80));
  console.log();
  console.log('Detector                  Trades   WR%      P&L       PF     MaxDD%  AvgWin/Loss');
  console.log('-'.repeat(80));

  for (const { name, result } of results) {
    const { metrics } = result;
    const pf = metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
    const avgRatio = metrics.avgLoss !== 0 ? (metrics.avgWin / Math.abs(metrics.avgLoss)).toFixed(2) : '∞';
    console.log(
      `${name.padEnd(25)} ${String(metrics.totalTrades).padStart(6)}   ${metrics.winRate.toFixed(1).padStart(5)}%  ${('$' + metrics.netPnl.toFixed(2)).padStart(8)}  ${pf.padStart(6)}  ${metrics.maxDrawdownPct.toFixed(1).padStart(6)}%  ${avgRatio.padStart(8)}`
    );
  }

  console.log('-'.repeat(80));
  console.log();

  // Sort by P&L
  const sortedByPnL = [...results].sort((a, b) => b.result.metrics.netPnl - a.result.metrics.netPnl);

  // Sort by Win Rate (min 5 trades)
  const sortedByWR = [...results]
    .filter(r => r.result.metrics.totalTrades >= 5)
    .sort((a, b) => b.result.metrics.winRate - a.result.metrics.winRate);

  // Sort by Profit Factor (min 5 trades)
  const sortedByPF = [...results]
    .filter(r => r.result.metrics.totalTrades >= 5 && r.result.metrics.profitFactor !== Infinity)
    .sort((a, b) => b.result.metrics.profitFactor - a.result.metrics.profitFactor);

  console.log('🏆 RANKINGS:');
  console.log();

  console.log('📊 By Net P&L:');
  sortedByPnL.slice(0, 3).forEach((r, i) => {
    const medal = ['🥇', '🥈', '🥉'][i];
    console.log(`   ${medal} ${r.name}: $${r.result.metrics.netPnl.toFixed(2)}`);
  });
  console.log();

  if (sortedByWR.length > 0) {
    console.log('📈 By Win Rate (min 5 trades):');
    sortedByWR.slice(0, 3).forEach((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i];
      console.log(`   ${medal} ${r.name}: ${r.result.metrics.winRate.toFixed(1)}% (${r.result.metrics.totalTrades} trades)`);
    });
    console.log();
  }

  if (sortedByPF.length > 0) {
    console.log('💰 By Profit Factor (min 5 trades):');
    sortedByPF.slice(0, 3).forEach((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i];
      console.log(`   ${medal} ${r.name}: ${r.result.metrics.profitFactor.toFixed(2)}`);
    });
    console.log();
  }

  // Generate charts for top performers
  console.log('📈 Generating charts for detectors with trades...');
  console.log();

  for (const { name, method, result } of results) {
    if (result.trades.length === 0) {
      console.log(`   ⚠️  ${name}: No trades to chart`);
      continue;
    }

    try {
      const chartPath = quickExportChart(result, undefined, {
        title: `${name} (${method}) - ${ASSET}`,
        showIndicators: ['rsi', 'bbands'],
      });
      console.log(`   ✅ ${name}: ${path.basename(chartPath)}`);
    } catch (error) {
      console.log(`   ❌ ${name}: Failed to generate chart - ${error}`);
    }
  }

  // Analysis
  console.log();
  console.log('═'.repeat(80));
  console.log('                         ANALYSIS');
  console.log('═'.repeat(80));
  console.log();

  const bestByPnL = sortedByPnL[0];
  const worstByPnL = sortedByPnL[sortedByPnL.length - 1];

  if (bestByPnL && bestByPnL.result.metrics.netPnl > 0) {
    console.log(`🌟 BEST PERFORMER: ${bestByPnL.name}`);
    console.log(`   This detector generated the highest profit of $${bestByPnL.result.metrics.netPnl.toFixed(2)}`);
    console.log(`   with ${bestByPnL.result.metrics.totalTrades} trades and ${bestByPnL.result.metrics.winRate.toFixed(1)}% win rate.`);
  } else {
    console.log('⚠️  No detector was profitable in this period.');
    console.log('   Consider adjusting parameters or testing on different data.');
  }

  console.log();

  // Trade frequency analysis
  const highFrequency = results.filter(r => r.result.metrics.totalTrades > 50);
  const lowFrequency = results.filter(r => r.result.metrics.totalTrades < 10 && r.result.metrics.totalTrades > 0);

  if (highFrequency.length > 0) {
    console.log('📊 High-frequency detectors (>50 trades):');
    highFrequency.forEach(r => {
      console.log(`   - ${r.name}: ${r.result.metrics.totalTrades} trades`);
    });
    console.log();
  }

  if (lowFrequency.length > 0) {
    console.log('📊 Low-frequency/selective detectors (<10 trades):');
    lowFrequency.forEach(r => {
      console.log(`   - ${r.name}: ${r.result.metrics.totalTrades} trades`);
    });
    console.log('   These may be too selective or parameters need adjustment.');
    console.log();
  }

  // Recommendations
  console.log('💡 RECOMMENDATIONS:');
  console.log();

  const profitable = results.filter(r => r.result.metrics.netPnl > 0);
  if (profitable.length >= 2) {
    console.log('   Consider combining signals from multiple profitable detectors');
    console.log('   to create a higher-confidence entry system.');
  }

  const highWR = results.filter(r => r.result.metrics.winRate > 50 && r.result.metrics.totalTrades >= 5);
  if (highWR.length > 0) {
    console.log(`   Detectors with >50% WR: ${highWR.map(r => r.name).join(', ')}`);
    console.log('   These show good reversal detection capability.');
  }

  console.log();
  console.log('✅ Comparison complete!');
  console.log('   Check the generated charts to visualize entry points.');
}

main().catch(console.error);
