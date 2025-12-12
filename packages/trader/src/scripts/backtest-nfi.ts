#!/usr/bin/env npx tsx
/**
 * NostalgiaForInfinity (NFI) Strategy Backtest Script
 *
 * Usage:
 *   ASSET="cryETHUSD" DAYS=90 npx tsx src/scripts/backtest-nfi.ts
 *
 * Environment variables:
 *   ASSET - Asset to backtest (default: cryETHUSD)
 *   DAYS - Number of days of data (default: 90)
 *   DATA_FILE - Optional: direct path to CSV file
 *   STAKE_PCT - Stake percentage (default: 0.03 = 3%)
 *   MULTIPLIER - Leverage multiplier (default: 100)
 *   MONTE_CARLO - Run Monte Carlo simulation (default: false)
 *   PRESET - Use preset: eth, btc, conservative (default: none)
 *   JSON - Save results to JSON (default: false)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { NFIBacktestStrategy } from '../backtest/strategies/nfi-backtest.strategy.js';
import {
  getParamsForAsset,
  ETH_NFI_PARAMS,
  BTC_NFI_PARAMS,
  CONSERVATIVE_NFI_PARAMS,
  DEFAULT_NFI_PARAMS,
} from '../strategies/nfi/nfi.params.js';
import type { NFIParams } from '../strategies/nfi/nfi.types.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'cryETHUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const DATA_FILE = process.env.DATA_FILE;
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.03');
const MULTIPLIER = parseInt(process.env.MULTIPLIER ?? '100', 10);
const RUN_MONTE_CARLO = process.env.MONTE_CARLO === 'true';
const SAVE_JSON = process.env.JSON === 'true';
const PRESET = process.env.PRESET as 'eth' | 'btc' | 'conservative' | undefined;

// Initial capital
const INITIAL_CAPITAL = 1000;

async function main() {
  console.log('═'.repeat(70));
  console.log('  NOSTALGIAFORINFINITY (NFI) STRATEGY BACKTEST');
  console.log('═'.repeat(70));
  console.log('');

  // Get params based on preset or asset
  let baseParams: Partial<NFIParams> = {};

  if (PRESET === 'eth') {
    baseParams = ETH_NFI_PARAMS;
    console.log(`📋 Using preset: ETH (aggressive)`);
  } else if (PRESET === 'btc') {
    baseParams = BTC_NFI_PARAMS;
    console.log(`📋 Using preset: BTC`);
  } else if (PRESET === 'conservative') {
    baseParams = CONSERVATIVE_NFI_PARAMS;
    console.log(`📋 Using preset: Conservative`);
  }

  const finalParams = getParamsForAsset(ASSET, baseParams);

  // Get first ROI target for display
  const roiKeys = Object.keys(finalParams.dynamicROI).map(Number);
  const firstROI = finalParams.dynamicROI[Math.min(...roiKeys)] ?? 4.0;

  console.log(`📊 Configuration:`);
  console.log(`   Asset: ${ASSET}`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log(`   Stop Loss: ${(finalParams.stopLoss.percentage * 100).toFixed(1)}%`);
  console.log(`   Initial ROI Target: ${firstROI}%`);
  console.log(`   Trailing Stop: ${finalParams.stopLoss.useTrailing ? 'ON' : 'OFF'}`);
  console.log(`   RSI Oversold: ${finalParams.rsi.oversold}`);
  console.log(`   RSI Overbought: ${finalParams.rsi.overbought}`);
  console.log(`   Max Bars in Trade: ${finalParams.risk.maxBarsInTrade}`);
  console.log(`   Cooldown Bars: ${finalParams.risk.cooldownBars}`);
  console.log('');

  // Determine data file path
  let dataPath: string;
  if (DATA_FILE) {
    dataPath = path.isAbsolute(DATA_FILE)
      ? DATA_FILE
      : path.join(process.cwd(), DATA_FILE);
  } else {
    const dataDir = path.join(process.cwd(), 'data');
    const dataFile = `${ASSET}_1m_${DAYS}d.csv`;
    dataPath = path.join(dataDir, dataFile);
  }

  if (!fs.existsSync(dataPath)) {
    console.log(`❌ Data file not found: ${dataPath}`);
    console.log('');
    console.log('To download data, run:');
    console.log(
      `   SYMBOLS="${ASSET}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`
    );
    process.exit(1);
  }

  console.log(`📥 Loading data from: ${path.basename(dataPath)}`);
  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60, // 1m candles
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    volumeColumn: 'volume',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  // Date range
  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  const startDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];
  console.log(`   Period: ${startDate} → ${endDate}`);
  console.log('');

  // Create strategy
  const strategy = new NFIBacktestStrategy(ASSET, baseParams);

  // Run backtest
  console.log('🚀 Running NFI backtest...');
  console.log('   (This may take a while due to multi-timeframe calculations)');
  const startTime = Date.now();

  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_CAPITAL,
    multiplier: MULTIPLIER,
    stakeAmount: INITIAL_CAPITAL * STAKE_PCT,
    takeProfitPct: firstROI / 100,
    stopLossPct: finalParams.stopLoss.percentage,
  });

  const duration = Date.now() - startTime;
  console.log(`   Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log('');

  // Print results
  printResults(result, candles, finalParams);

  // Analyze entry tags
  analyzeEntryTags(result.trades);

  // Monte Carlo simulation
  if (RUN_MONTE_CARLO && result.trades.length > 30) {
    runMonteCarloSimulation(result.trades);
  }

  // Save JSON
  if (SAVE_JSON) {
    const jsonPath = saveResultsToJSON(result, candles);
    console.log(`\n💾 Results saved to: ${jsonPath}`);
  }

  console.log('\n✅ NFI Backtest complete!');
}

function printResults(result: any, candles: any[], params: NFIParams) {
  const { trades, metrics } = result;

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

  console.log('═'.repeat(70));
  console.log(`  NFI BACKTEST RESULTS`);
  console.log('═'.repeat(70));
  console.log('');

  console.log('📊 CONFIGURATION');
  console.log('─'.repeat(70));
  console.log(`  Asset:        ${ASSET}`);
  console.log(`  Timeframe:    1m (multi-TF analysis: 5m, 15m, 1h, 4h, 1d)`);
  console.log(`  Period:       ${startDate} → ${endDate}`);
  console.log(`  Candles:      ${candles.length.toLocaleString()}`);
  console.log(`  Initial:      $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  Stake:        ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`  Multiplier:   ${MULTIPLIER}x`);
  console.log(`  Stop Loss:    ${(params.stopLoss.percentage * 100).toFixed(1)}%`);
  console.log('');

  console.log('📈 PERFORMANCE');
  console.log('─'.repeat(70));
  console.log(`  Trades:       ${trades.length} (${wins}W / ${losses}L)`);
  console.log(`  Win Rate:     ${winRate.toFixed(1)}%`);
  console.log(`  Net P&L:      $${netPnl.toFixed(2)}`);
  console.log(`  ROI:          ${((netPnl / INITIAL_CAPITAL) * 100).toFixed(1)}%`);
  console.log(`  Profit Factor: ${profitFactor.toFixed(2)}`);
  console.log('');

  console.log('💰 P&L BREAKDOWN');
  console.log('─'.repeat(70));
  console.log(`  Gross Profit: $${grossProfit.toFixed(2)}`);
  console.log(`  Gross Loss:   $${grossLoss.toFixed(2)}`);
  console.log(`  Avg Win:      $${avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:     $${avgLoss.toFixed(2)}`);
  console.log(`  Avg Trade:    $${expectancy.toFixed(2)}`);
  console.log('');

  console.log('⚠️  RISK METRICS');
  console.log('─'.repeat(70));
  console.log(
    `  Max Drawdown: $${((maxDrawdown * INITIAL_CAPITAL) / 100).toFixed(2)} (${maxDrawdown.toFixed(1)}%)`
  );
  console.log(`  Max Consec W: ${maxConsecWins}`);
  console.log(`  Max Consec L: ${maxConsecLosses}`);
  console.log(`  Expectancy:   $${expectancy.toFixed(2)}`);
  console.log(`  SQN:          ${sqn.toFixed(2)}`);
  console.log('');

  console.log('🔍 TRADE QUALITY');
  console.log('─'.repeat(70));
  console.log(`  Avg Duration: ${avgDuration.toFixed(1)} bars (${(avgDuration * 1).toFixed(0)} min)`);
  console.log(`  Trades/Day:   ${(trades.length / DAYS).toFixed(1)}`);
  console.log('');

  // Exit reason breakdown
  const exitReasons = analyzeExitReasons(trades);
  console.log('📊 EXIT REASONS');
  console.log('─'.repeat(70));
  for (const [reason, count] of Object.entries(exitReasons)) {
    const pct = ((count as number) / trades.length) * 100;
    console.log(`  ${reason.padEnd(22)}: ${String(count).padStart(4)} (${pct.toFixed(1)}%)`);
  }
  console.log('');

  console.log('═'.repeat(70));
}

function analyzeEntryTags(trades: any[]) {
  const tagStats: Record<string, { count: number; wins: number; totalPnl: number }> = {};

  for (const trade of trades) {
    const tag = trade.result?.metadata?.entryTag ?? trade.metadata?.entryTag ?? 'unknown';
    if (!tagStats[tag]) {
      tagStats[tag] = { count: 0, wins: 0, totalPnl: 0 };
    }
    tagStats[tag]!.count++;
    if ((trade.pnl ?? 0) > 0) tagStats[tag]!.wins++;
    tagStats[tag]!.totalPnl += trade.pnl ?? 0;
  }

  // Sort by count
  const sorted = Object.entries(tagStats).sort((a, b) => b[1].count - a[1].count);

  console.log('🏷️  ENTRY TAG ANALYSIS');
  console.log('─'.repeat(70));
  console.log('  Tag      Count   WinRate   Avg P&L');
  console.log('  ' + '-'.repeat(40));

  for (const [tag, stats] of sorted.slice(0, 15)) {
    const winRate = stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
    const avgPnl = stats.count > 0 ? stats.totalPnl / stats.count : 0;
    console.log(
      `  ${tag.padEnd(8)} ${String(stats.count).padStart(5)}   ${winRate.toFixed(1).padStart(5)}%   $${avgPnl.toFixed(2).padStart(7)}`
    );
  }
  console.log('');
}

function analyzeExitReasons(trades: any[]): Record<string, number> {
  const reasons: Record<string, number> = {};

  for (const trade of trades) {
    const reason = trade.result?.exitReason ?? trade.exitReason ?? 'UNKNOWN';
    // Normalize reason
    const normalizedReason = reason.split(' ')[0] ?? reason;
    reasons[normalizedReason] = (reasons[normalizedReason] ?? 0) + 1;
  }

  return reasons;
}

function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squaredDiffs = arr.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function runMonteCarloSimulation(trades: any[]) {
  console.log('🎲 MONTE CARLO SIMULATION');
  console.log('─'.repeat(70));

  const iterations = 1000;
  const pnls = trades.map((t: any) => t.pnl ?? 0);
  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let balance = INITIAL_CAPITAL;
    const shuffled = [...pnls].sort(() => Math.random() - 0.5);

    for (const pnl of shuffled) {
      balance += pnl;
    }

    results.push(balance - INITIAL_CAPITAL);
  }

  results.sort((a, b) => a - b);

  const p5 = results[Math.floor(iterations * 0.05)]!;
  const p25 = results[Math.floor(iterations * 0.25)]!;
  const p50 = results[Math.floor(iterations * 0.5)]!;
  const p75 = results[Math.floor(iterations * 0.75)]!;
  const p95 = results[Math.floor(iterations * 0.95)]!;

  console.log(`  Iterations:  ${iterations}`);
  console.log(`  5th pctl:    $${p5.toFixed(2)}`);
  console.log(`  25th pctl:   $${p25.toFixed(2)}`);
  console.log(`  Median:      $${p50.toFixed(2)}`);
  console.log(`  75th pctl:   $${p75.toFixed(2)}`);
  console.log(`  95th pctl:   $${p95.toFixed(2)}`);
  console.log('');
}

function saveResultsToJSON(result: any, candles: any[]): string {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nfi-backtest-${ASSET}-${DAYS}d-${timestamp}.json`;
  const outputPath = path.join(outputDir, filename);

  const output = {
    strategy: 'NostalgiaForInfinity',
    version: '1.0.0',
    asset: ASSET,
    days: DAYS,
    preset: PRESET,
    config: {
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      initialCapital: INITIAL_CAPITAL,
    },
    period: {
      start: new Date(candles[0]!.timestamp * 1000).toISOString(),
      end: new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString(),
      candles: candles.length,
    },
    metrics: result.metrics,
    trades: result.trades.map((t: any) => ({
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      direction: t.direction,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.pnl,
      pnlPct: t.pnlPct,
      exitReason: t.exitReason,
      entryTag: t.metadata?.entryTag,
      barsHeld: t.barsHeld,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  return outputPath;
}

main().catch(console.error);
