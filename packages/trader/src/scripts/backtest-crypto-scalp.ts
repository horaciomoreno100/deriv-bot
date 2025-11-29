#!/usr/bin/env npx tsx
/**
 * CryptoScalp Strategy v2 Backtest Script
 *
 * Usage:
 *   ASSET="cryBTCUSD" DAYS=90 npx tsx src/scripts/backtest-crypto-scalp.ts
 *
 * Environment variables:
 *   ASSET - Asset to backtest (default: cryBTCUSD)
 *   DAYS - Number of days of data (default: 90)
 *   STAKE_PCT - Stake percentage (default: 0.03 = 3%)
 *   MULTIPLIER - Leverage multiplier (default: 100)
 *   MONTE_CARLO - Run Monte Carlo simulation (default: false)
 *   CHART - Generate HTML chart (default: false)
 *   JSON - Save results to JSON (default: false)
 *   PRESET - Use preset: aggressive, conservative, scalp, swing, highPF (default: none)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { CryptoScalpBacktestStrategy } from '../backtest/strategies/crypto-scalp-backtest.strategy.js';
import { getPreset, getParamsForAsset } from '../strategies/crypto-scalp/crypto-scalp.params.js';
import type { CryptoScalpParams } from '../strategies/crypto-scalp/crypto-scalp.types.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'cryBTCUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.03');
const MULTIPLIER = parseInt(process.env.MULTIPLIER ?? '100', 10);
const RUN_MONTE_CARLO = process.env.MONTE_CARLO === 'true';
const GENERATE_CHART = process.env.CHART === 'true';
const SAVE_JSON = process.env.JSON === 'true';
const PRESET = process.env.PRESET as
  | 'aggressive'
  | 'conservative'
  | 'scalp'
  | 'swing'
  | 'highPF'
  | undefined;

// Initial capital
const INITIAL_CAPITAL = 1000;

async function main() {
  console.log('═'.repeat(70));
  console.log('  CRYPTO SCALP STRATEGY v2 BACKTEST');
  console.log('═'.repeat(70));
  console.log('');

  // Get params
  let params: Partial<CryptoScalpParams> = {};
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
  console.log(`   RSI: ${finalParams.rsi.oversoldThreshold}/${finalParams.rsi.overboughtThreshold}`);
  console.log(`   VWAP periods: ${finalParams.vwap.periods}`);
  console.log(`   ADX period: ${finalParams.adx.period}`);
  console.log(`   ATR TP/SL: ${finalParams.atr.tpMultiplier}x / ${finalParams.atr.slMultiplier}x`);
  console.log(`   BB: ${finalParams.bb.period} period, ${finalParams.bb.stdDev} stdDev`);
  console.log(`   Trailing Stop: ${finalParams.trailingStop.enabled ? 'ON' : 'OFF'}`);
  console.log('');

  // Load data
  const dataDir = path.join(process.cwd(), 'data');
  const dataFile = `${ASSET}_1m_${DAYS}d.csv`;
  const dataPath = path.join(dataDir, dataFile);

  if (!fs.existsSync(dataPath)) {
    console.log(`❌ Data file not found: ${dataPath}`);
    console.log('');
    console.log('To download data, run:');
    console.log(
      `   SYMBOLS="${ASSET}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`
    );
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
    volumeColumn: 'volume',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
  console.log('');

  // Create strategy
  const strategy = new CryptoScalpBacktestStrategy(ASSET, params);

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
    takeProfitPct: tp1 ? tp1.profitPercent / 100 : 0.005,
    stopLossPct: finalParams.baseStopLossPct / 100,
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
    console.log('\nChart generation not yet implemented for v2');
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
  console.log(`  BACKTEST RESULT: CryptoScalp v2.0.0`);
  console.log('═'.repeat(70));
  console.log('');

  console.log('📊 CONFIGURATION');
  console.log('─'.repeat(70));
  console.log(`  Asset:        ${ASSET}`);
  console.log(`  Timeframe:    60s`);
  console.log(`  Period:       ${startDate} → ${endDate}`);
  console.log(`  Candles:      ${candles.length.toLocaleString()}`);
  console.log(`  Initial:      $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  Stake:        ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`  Multiplier:   ${MULTIPLIER}x`);
  console.log('');

  console.log('📈 PERFORMANCE');
  console.log('─'.repeat(70));
  console.log(`  Trades:       ${trades.length} (${wins}W / ${losses}L)`);
  console.log(`  Win Rate:     ${winRate.toFixed(1)}%`);
  console.log(`  Net P&L:      $${netPnl.toFixed(2)}`);
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

  console.log('🔍 QUALITY');
  console.log('─'.repeat(70));
  console.log(`  Avg Duration: ${avgDuration.toFixed(1)} bars`);
  console.log('');

  // Exit reason breakdown
  const exitReasons = analyzeExitReasons(trades);
  console.log('📊 EXIT REASONS');
  console.log('─'.repeat(70));
  for (const [reason, count] of Object.entries(exitReasons)) {
    const pct = ((count as number) / trades.length) * 100;
    console.log(`  ${reason.padEnd(18)}: ${count} (${pct.toFixed(1)}%)`);
  }
  console.log('');

  console.log('═'.repeat(70));
}

function analyzeExitReasons(trades: any[]): Record<string, number> {
  const reasons: Record<string, number> = {};

  for (const trade of trades) {
    const reason = trade.result?.exitReason ?? trade.exitReason ?? 'UNKNOWN';
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }

  return reasons;
}

function runMonteCarloSimulation(trades: any[]) {
  console.log('\n🎲 MONTE CARLO SIMULATION (1000 runs)');
  console.log('─'.repeat(70));

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
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    results.push(maxDD);
  }

  results.sort((a, b) => a - b);

  console.log(`  50th percentile DD: ${results[499]?.toFixed(1) ?? 'N/A'}%`);
  console.log(`  75th percentile DD: ${results[749]?.toFixed(1) ?? 'N/A'}%`);
  console.log(`  95th percentile DD: ${results[949]?.toFixed(1) ?? 'N/A'}%`);
  console.log(`  99th percentile DD: ${results[989]?.toFixed(1) ?? 'N/A'}%`);
  console.log(`  Worst case DD:      ${results[999]?.toFixed(1) ?? 'N/A'}%`);
}

function saveResultsToJSON(result: any, candles: any[]): string {
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const filename = `backtest_CryptoScalp_${ASSET}_${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  const output = {
    metadata: {
      strategy: 'CryptoScalp',
      version: '2.0.0',
      asset: ASSET,
      days: DAYS,
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      preset: PRESET ?? 'default',
      timestamp: new Date().toISOString(),
    },
    summary: {
      totalTrades: result.trades.length,
      winRate:
        result.trades.length > 0
          ? (result.trades.filter((t: any) => t.result?.outcome === 'WIN').length /
              result.trades.length) *
            100
          : 0,
      netPnl: result.trades.reduce((s: number, t: any) => s + (t.result?.pnl ?? t.pnl ?? 0), 0),
      profitFactor: result.metrics?.profitFactor ?? 0,
      maxDrawdownPct: result.metrics?.maxDrawdownPct ?? 0,
    },
    trades: result.trades,
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));

  return filepath;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

main().catch(console.error);
