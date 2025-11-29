#!/usr/bin/env npx tsx
/**
 * RSI Scalp Strategy Backtest Script
 *
 * Usage:
 *   ASSET="cryBTCUSD" DAYS=90 npx tsx src/scripts/backtest-rsi-scalp.ts
 *
 * Environment variables:
 *   ASSET - Asset to backtest (default: cryBTCUSD)
 *   DAYS - Number of days of data (default: 90)
 *   STAKE_PCT - Stake percentage (default: 0.02 = 2%)
 *   MULTIPLIER - Leverage multiplier (default: 50)
 *   MONTE_CARLO - Run Monte Carlo simulation (default: false)
 *   CHART - Generate HTML chart (default: false)
 *   JSON - Save results to JSON (default: false)
 *   PRESET - Use preset: aggressive, conservative, 1m, 15m (default: none)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { RSIScalpBacktestStrategy } from '../backtest/strategies/rsi-scalp-backtest.strategy.js';
import { getPreset, getParamsForAsset } from '../strategies/rsi-scalp.params.js';
import type { RSIScalpParams } from '../strategies/rsi-scalp.types.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'cryBTCUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');
const MULTIPLIER = parseInt(process.env.MULTIPLIER ?? '50', 10);
const RUN_MONTE_CARLO = process.env.MONTE_CARLO === 'true';
const GENERATE_CHART = process.env.CHART === 'true';
const SAVE_JSON = process.env.JSON === 'true';
const PRESET = process.env.PRESET as 'aggressive' | 'conservative' | '1m' | '15m' | undefined;

// Initial capital
const INITIAL_CAPITAL = 1000;

async function main() {
  console.log('═'.repeat(60));
  console.log('  RSI SCALP STRATEGY BACKTEST');
  console.log('═'.repeat(60));
  console.log('');

  // Get params
  let params: Partial<RSIScalpParams> = {};
  if (PRESET) {
    params = getPreset(PRESET);
    console.log(`📋 Using preset: ${PRESET}`);
  }

  const finalParams = getParamsForAsset(ASSET, params);

  console.log(`📊 Configuration:`);
  console.log(`   Asset: ${ASSET}`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log(`   RSI Period: ${finalParams.rsiPeriod}`);
  console.log(`   EMA Period: ${finalParams.emaPeriod}`);
  console.log(`   Stop Loss: ${finalParams.stopLossPercent}%`);
  console.log(`   TP Levels: ${finalParams.takeProfitLevels.map(t => `${t.profitPercent}%`).join(', ')}`);
  console.log('');

  // Load data
  const dataDir = path.join(process.cwd(), 'data');
  const dataFile = `${ASSET}_1m_${DAYS}d.csv`;
  const dataPath = path.join(dataDir, dataFile);

  if (!fs.existsSync(dataPath)) {
    console.log(`❌ Data file not found: ${dataPath}`);
    console.log('');
    console.log('To download data, run:');
    console.log(`   SYMBOLS="${ASSET}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    process.exit(1);
  }

  console.log(`📥 Loading data from: ${dataFile}`);
  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
  console.log('');

  // Create strategy
  const strategy = new RSIScalpBacktestStrategy(ASSET, params);

  // Run backtest
  console.log('🚀 Running backtest...');
  const startTime = Date.now();

  const tp1 = finalParams.takeProfitLevels[0];
  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_CAPITAL,
    multiplier: MULTIPLIER,
    stakeAmount: INITIAL_CAPITAL * STAKE_PCT,
    takeProfitPct: tp1 ? tp1.profitPercent / 100 : 0.006,
    stopLossPct: finalParams.stopLossPercent / 100,
  });

  const duration = Date.now() - startTime;
  console.log(`   Completed in ${duration}ms`);
  console.log('');

  // Print results
  printResults(result, candles);

  // Monte Carlo simulation
  if (RUN_MONTE_CARLO && result.trades.length > 30) {
    runMonteCarloSimulation(result.trades);
  }

  // Generate chart
  if (GENERATE_CHART) {
    const chartPath = generateChart(result, candles);
    console.log(`\n📈 Chart saved to: ${chartPath}`);
  }

  // Save JSON
  if (SAVE_JSON) {
    const jsonPath = saveResultsToJSON(result, candles);
    console.log(`\n💾 Results saved to: ${jsonPath}`);
  }

  console.log('\n✅ Backtest complete!');
}

function printResults(result: any, candles: any[]) {
  const { trades, metrics } = result;

  // Use metrics computed by the backtest engine
  const wins = metrics.wins ?? 0;
  const losses = metrics.losses ?? 0;
  const winRate = metrics.winRate ?? 0;
  const grossProfit = metrics.grossProfit ?? 0;
  const grossLoss = Math.abs(metrics.grossLoss ?? 0);
  const netPnl = metrics.netPnl ?? 0;
  const profitFactor = metrics.profitFactor ?? 0;
  const avgWin = metrics.avgWin ?? 0;
  const avgLoss = Math.abs(metrics.avgLoss ?? 0);
  const maxDrawdown = metrics.maxDrawdownPct ?? 0;
  const maxConsecWins = metrics.maxConsecutiveWins ?? 0;
  const maxConsecLosses = metrics.maxConsecutiveLosses ?? 0;
  const avgDuration = metrics.avgBarsHeld ?? 0;
  const nearMisses = metrics.nearMisses ?? 0;
  const quickLosses = metrics.immediateReversals ?? 0;

  // Expectancy and SQN
  const expectancy = trades.length > 0 ? netPnl / trades.length : 0;
  const pnls = trades.map((t: any) => t.pnl ?? 0);
  const pnlStd = std(pnls);
  const sqn = pnlStd > 0 ? (expectancy / pnlStd) * Math.sqrt(trades.length) : 0;

  // Date range
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const startDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];

  console.log('═'.repeat(60));
  console.log(`  BACKTEST RESULT: RSI-Scalp v1.0.0`);
  console.log('═'.repeat(60));
  console.log('');

  console.log('📊 CONFIGURATION');
  console.log('─'.repeat(60));
  console.log(`  Asset:        ${ASSET}`);
  console.log(`  Timeframe:    60s`);
  console.log(`  Period:       ${startDate} → ${endDate}`);
  console.log(`  Candles:      ${candles.length.toLocaleString()}`);
  console.log(`  Initial:      $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  Stake:        ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`  Multiplier:   ${MULTIPLIER}x`);
  console.log('');

  console.log('📈 PERFORMANCE');
  console.log('─'.repeat(60));
  console.log(`  Trades:       ${trades.length} (${wins}W / ${losses}L)`);
  console.log(`  Win Rate:     ${winRate.toFixed(1)}%`);
  console.log(`  Net P&L:      $${netPnl.toFixed(2)}`);
  console.log(`  Profit Factor: ${profitFactor.toFixed(2)}`);
  console.log('');

  console.log('💰 P&L BREAKDOWN');
  console.log('─'.repeat(60));
  console.log(`  Gross Profit: $${grossProfit.toFixed(2)}`);
  console.log(`  Gross Loss:   $${grossLoss.toFixed(2)}`);
  console.log(`  Avg Win:      $${avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:     $${avgLoss.toFixed(2)}`);
  console.log(`  Avg Trade:    $${expectancy.toFixed(2)}`);
  console.log('');

  console.log('⚠️  RISK METRICS');
  console.log('─'.repeat(60));
  console.log(`  Max Drawdown: $${(maxDrawdown * INITIAL_CAPITAL / 100).toFixed(2)} (${maxDrawdown.toFixed(1)}%)`);
  console.log(`  Max Consec W: ${maxConsecWins}`);
  console.log(`  Max Consec L: ${maxConsecLosses}`);
  console.log(`  Expectancy:   $${expectancy.toFixed(2)}`);
  console.log(`  SQN:          ${sqn.toFixed(2)}`);
  console.log('');

  console.log('🔍 QUALITY');
  console.log('─'.repeat(60));
  console.log(`  Near Misses:  ${nearMisses} (lost but reached >50% of TP)`);
  console.log(`  Quick Losses: ${quickLosses} (lost in ≤3 bars)`);
  console.log(`  Avg Duration: ${avgDuration.toFixed(1)} bars`);
  console.log('');

  // Entry level breakdown
  const entryLevelStats = analyzeEntryLevels(trades);
  if (entryLevelStats.length > 0) {
    console.log('📊 DCA ENTRY LEVELS');
    console.log('─'.repeat(60));
    for (const stat of entryLevelStats) {
      console.log(`  Level ${stat.level}: ${stat.count} entries, ${stat.winRate.toFixed(1)}% win rate`);
    }
    console.log('');
  }

  console.log('═'.repeat(60));
}

function analyzeEntryLevels(trades: any[]): { level: number; count: number; winRate: number }[] {
  const levels: Map<number, { wins: number; total: number }> = new Map();

  for (const trade of trades) {
    const level = trade.entry?.metadata?.entryLevel ?? trade.signal?.metadata?.entryLevel ?? 1;
    const current = levels.get(level) ?? { wins: 0, total: 0 };
    current.total++;
    if (trade.result?.outcome === 'WIN') current.wins++;
    levels.set(level, current);
  }

  return Array.from(levels.entries())
    .map(([level, stats]) => ({
      level,
      count: stats.total,
      winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
    }))
    .sort((a, b) => a.level - b.level);
}

function runMonteCarloSimulation(trades: any[]) {
  console.log('\n🎲 MONTE CARLO SIMULATION (1000 runs)');
  console.log('─'.repeat(60));

  const pnls = trades.map((t: any) => t.result?.pnl ?? t.pnl ?? 0);
  const results: number[] = [];

  for (let i = 0; i < 1000; i++) {
    // Shuffle trades
    const shuffled = [...pnls].sort(() => Math.random() - 0.5);
    let equity = INITIAL_CAPITAL;
    let maxDD = 0;
    let peak = equity;

    for (const pnl of shuffled) {
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    results.push(maxDD);
  }

  results.sort((a, b) => a - b);

  console.log(`  50th percentile DD: ${results[499].toFixed(1)}%`);
  console.log(`  75th percentile DD: ${results[749].toFixed(1)}%`);
  console.log(`  95th percentile DD: ${results[949].toFixed(1)}%`);
  console.log(`  99th percentile DD: ${results[989].toFixed(1)}%`);
  console.log(`  Worst case DD:      ${results[999].toFixed(1)}%`);
}

function generateChart(_result: any, _candles: any[]): string {
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const filename = `chart_RSI-Scalp_${ASSET}_${timestamp}.html`;
  const filepath = path.join(outputDir, filename);

  // Chart generation not implemented yet
  console.log('Chart generation not implemented yet');

  return filepath;
}

function saveResultsToJSON(result: any, candles: any[]): string {
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const filename = `backtest_RSI-Scalp_${ASSET}_${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  const output = {
    metadata: {
      strategy: 'RSI-Scalp',
      version: '1.0.0',
      asset: ASSET,
      days: DAYS,
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      timestamp: new Date().toISOString(),
    },
    summary: {
      totalTrades: result.trades.length,
      winRate: result.trades.length > 0
        ? result.trades.filter((t: any) => t.result.outcome === 'WIN').length / result.trades.length * 100
        : 0,
      netPnl: result.trades.reduce((s: number, t: any) => s + t.result.pnl, 0),
    },
    trades: result.trades,
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));

  return filepath;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

main().catch(console.error);
