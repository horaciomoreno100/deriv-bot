#!/usr/bin/env npx tsx
/**
 * Validate NFI Filters - Out-of-Sample Testing
 * 
 * Tests if the filters we discovered are overfitting or actually predictive:
 * 1. Split data: 70% in-sample (training), 30% out-of-sample (testing)
 * 2. Find optimal filters on in-sample
 * 3. Test those filters on out-of-sample
 * 4. Compare performance degradation
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { getParamsForAsset } from '../strategies/nfi/nfi.params.js';
import { NFI_ETH_OPTIMIZED } from '../strategies/nfi/nfi-optimized.params.js';
import type { NFIParams } from '../strategies/nfi/nfi.types.js';
// @ts-ignore
import * as ti from 'technicalindicators';

const ASSET = process.env.ASSET ?? 'cryETHUSD';
const DATA_FILE = process.env.DATA_FILE;
const IN_SAMPLE_RATIO = parseFloat(process.env.IN_SAMPLE_RATIO ?? '0.7');
const dataDir = path.join(process.cwd(), 'data');

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;

interface IndicatorSeries {
  rsi_3: (number | undefined)[];
  rsi_14: (number | undefined)[];
  ema_50: (number | undefined)[];
  ema_200: (number | undefined)[];
  bb_lower: (number | undefined)[];
  bb_middle: (number | undefined)[];
  bb_upper: (number | undefined)[];
  ewo: (number | undefined)[];
  atr: (number | undefined)[];
  adx: (number | undefined)[];
}

interface Trade {
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
  barsHeld: number;
  // Features at entry
  rsi_3: number;
  atr_pct: number;
  adx: number;
  entryTag: string;
}

interface FilterConfig {
  maxATR?: number;      // Filter high volatility
  maxADX?: number;      // Filter strong trends
  maxRSI3?: number;     // Only very oversold
  excludeTags?: string[]; // Exclude bad tags
}

// Load and prepare data (same as nfi-ml-collect.ts)
function loadCandles(filepath: string): Candle[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts.length > 5 ? parseFloat(parts[5]!) : 0,
      });
    }
  }
  return candles;
}

function calculateIndicators(candles: Candle[]): IndicatorSeries {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const rsi3 = ti.RSI.calculate({ values: closes, period: 3 });
  const rsi14 = ti.RSI.calculate({ values: closes, period: 14 });
  const ema50 = ti.EMA.calculate({ values: closes, period: 50 });
  const ema200 = ti.EMA.calculate({ values: closes, period: 200 });
  const bb = ti.BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const atr = ti.ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const adx = ti.ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

  const ema5 = ti.EMA.calculate({ values: closes, period: 5 });
  const ema35 = ti.EMA.calculate({ values: closes, period: 35 });
  const ewoValues: (number | undefined)[] = [];
  for (let i = 0; i < candles.length; i++) {
    const e5 = ema5[i - 4];
    const e35 = ema35[i - 34];
    if (e5 !== undefined && e35 !== undefined) {
      ewoValues.push(((e5 - e35) / closes[i]!) * 100);
    } else {
      ewoValues.push(undefined);
    }
  }

  const pad = <T>(arr: T[], offset: number): (T | undefined)[] =>
    Array(offset).fill(undefined).concat(arr);

  return {
    rsi_3: pad(rsi3, 3),
    rsi_14: pad(rsi14, 14),
    ema_50: pad(ema50, 49),
    ema_200: pad(ema200, 199),
    bb_upper: pad(bb.map(b => b.upper), 19),
    bb_middle: pad(bb.map(b => b.middle), 19),
    bb_lower: pad(bb.map(b => b.lower), 19),
    ewo: ewoValues,
    atr: pad(atr, 14),
    adx: pad(adx.map(a => a.adx), 28),
  };
}

function checkNFIEntry(
  i: number,
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams
): { triggered: boolean; tag: string } | null {
  const rsi = series.rsi_14[i];
  const rsi3 = series.rsi_3[i];
  const ema50 = series.ema_50[i];
  const ema200 = series.ema_200[i];
  const bbLower = series.bb_lower[i];
  const bbMiddle = series.bb_middle[i];
  const close = candles[i]!.close;
  const ewo = series.ewo[i];

  if (!rsi || !ema50 || !bbLower || !bbMiddle || ewo === undefined) return null;

  if (rsi < 25 && ewo < -4 && close < bbLower) return { triggered: true, tag: '1' };
  if (rsi < 28 && close < bbLower * 1.002) return { triggered: true, tag: '4' };
  if (rsi < 32 && close < bbMiddle && ewo < 0) return { triggered: true, tag: '10' };
  if (rsi < 35 && close < bbMiddle) return { triggered: true, tag: '12' };
  if (rsi < 30 && close < bbLower * 1.01) return { triggered: true, tag: '41' };
  if (rsi < 28 && ewo < -4) return { triggered: true, tag: '44' };
  if (rsi < 25) return { triggered: true, tag: '102' };
  if (ema200 && close < ema200 && rsi < 40 && ewo < -1) return { triggered: true, tag: '141' };

  return null;
}

function applyFilters(
  i: number,
  candles: Candle[],
  series: IndicatorSeries,
  entryTag: string,
  filters: FilterConfig
): boolean {
  const close = candles[i]!.close;
  const rsi3 = series.rsi_3[i] ?? 50;
  const atr = series.atr[i] ?? 0;
  const adx = series.adx[i] ?? 25;

  const atrPct = close > 0 ? (atr / close) * 100 : 0;

  // Apply filters
  if (filters.maxATR !== undefined && atrPct > filters.maxATR) return false;
  if (filters.maxADX !== undefined && adx > filters.maxADX) return false;
  if (filters.maxRSI3 !== undefined && rsi3 > filters.maxRSI3) return false;
  if (filters.excludeTags && filters.excludeTags.includes(entryTag)) return false;

  return true;
}

function runBacktest(
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams,
  filters: FilterConfig
): Trade[] {
  const trades: Trade[] = [];
  let cooldownUntil = 0;
  const maxBarsInTrade = params.risk?.maxBarsInTrade ?? 72;
  const cooldownBars = params.risk?.cooldownBars ?? 6;
  const slPct = params.stopLoss.percentage * 100;
  let equity = INITIAL_CAPITAL;

  for (let i = 200; i < candles.length; i++) {
    if (i < cooldownUntil) continue;

    const entry = checkNFIEntry(i, candles, series, params);
    if (!entry?.triggered) continue;

    // Apply filters
    if (!applyFilters(i, candles, series, entry.tag, filters)) continue;

    const entryPrice = candles[i]!.close;
    const stake = equity * STAKE_PCT;
    const slPrice = entryPrice * (1 - slPct / 100);

    const rsi3 = series.rsi_3[i] ?? 50;
    const atr = series.atr[i] ?? 0;
    const adx = series.adx[i] ?? 25;
    const atrPct = entryPrice > 0 ? (atr / entryPrice) * 100 : 0;

    let exitIndex = i;
    let exitPrice = entryPrice;
    let exitReason = 'TIME_LIMIT';
    let outcome: 'WIN' | 'LOSS' = 'LOSS';

    for (let j = i + 1; j < Math.min(i + maxBarsInTrade + 1, candles.length); j++) {
      const candle = candles[j]!;
      const barsHeld = j - i;
      const currentPnlPct = ((candle.close - entryPrice) / entryPrice) * 100;

      if (candle.low <= slPrice) {
        exitIndex = j;
        exitPrice = slPrice;
        exitReason = 'STOP_LOSS';
        outcome = 'LOSS';
        break;
      }

      let roiTarget = 3.0;
      if (barsHeld >= 48) roiTarget = 0.8;
      else if (barsHeld >= 24) roiTarget = 1.0;
      else if (barsHeld >= 12) roiTarget = 1.2;
      else if (barsHeld >= 6) roiTarget = 1.5;
      else if (barsHeld >= 3) roiTarget = 2.0;

      if (currentPnlPct >= roiTarget) {
        exitIndex = j;
        exitPrice = candle.close;
        exitReason = `ROI_${barsHeld * 5}min`;
        outcome = 'WIN';
        break;
      }
    }

    if (exitIndex === i) {
      exitIndex = Math.min(i + maxBarsInTrade, candles.length - 1);
      exitPrice = candles[exitIndex]!.close;
      outcome = exitPrice >= entryPrice ? 'WIN' : 'LOSS';
    }

    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const pnl = pnlPct > 0
      ? stake * MULTIPLIER * (pnlPct / 100)
      : -stake * MULTIPLIER * (Math.abs(pnlPct) / 100);

    trades.push({
      entryPrice,
      exitPrice,
      pnl,
      pnlPct,
      outcome,
      exitReason,
      barsHeld: exitIndex - i,
      rsi_3: rsi3,
      atr_pct: atrPct,
      adx,
      entryTag: entry.tag,
    });

    equity += pnl;
    cooldownUntil = exitIndex + cooldownBars;
  }

  return trades;
}

function calculateMetrics(trades: Trade[]) {
  if (trades.length === 0) {
    return {
      count: 0,
      winRate: 0,
      netPnl: 0,
      avgPnl: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
    };
  }

  const wins = trades.filter(t => t.outcome === 'WIN');
  const losses = trades.filter(t => t.outcome === 'LOSS');
  const totalWins = wins.reduce((sum, t) => sum + Math.abs(t.pnl), 0);
  const totalLosses = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0);

  return {
    count: trades.length,
    winRate: (wins.length / trades.length) * 100,
    netPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
    avgPnl: trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 10 : 0,
    avgWin: wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length : 0,
  };
}

function findOptimalFilters(inSampleTrades: Trade[]): FilterConfig {
  // Analyze in-sample to find best filters
  const losses = inSampleTrades.filter(t => t.outcome === 'LOSS');
  const wins = inSampleTrades.filter(t => t.outcome === 'WIN');

  // Calculate thresholds based on in-sample analysis
  const lossATR = losses.map(t => t.atr_pct);
  const winATR = wins.map(t => t.atr_pct);
  const avgLossATR = lossATR.reduce((a, b) => a + b, 0) / lossATR.length;
  const avgWinATR = winATR.reduce((a, b) => a + b, 0) / winATR.length;

  const lossADX = losses.map(t => t.adx);
  const winADX = wins.map(t => t.adx);
  const avgLossADX = lossADX.reduce((a, b) => a + b, 0) / lossADX.length;
  const avgWinADX = winADX.reduce((a, b) => a + b, 0) / winADX.length;

  const lossRSI3 = losses.map(t => t.rsi_3);
  const winRSI3 = wins.map(t => t.rsi_3);
  const avgLossRSI3 = lossRSI3.reduce((a, b) => a + b, 0) / lossRSI3.length;
  const avgWinRSI3 = winRSI3.reduce((a, b) => a + b, 0) / winRSI3.length;

  // Find bad tags
  const tagPerformance = new Map<string, { wins: number; losses: number; pnl: number }>();
  for (const trade of inSampleTrades) {
    const existing = tagPerformance.get(trade.entryTag) || { wins: 0, losses: 0, pnl: 0 };
    if (trade.outcome === 'WIN') existing.wins++;
    else existing.losses++;
    existing.pnl += trade.pnl;
    tagPerformance.set(trade.entryTag, existing);
  }

  const badTags: string[] = [];
  for (const [tag, perf] of tagPerformance.entries()) {
    const total = perf.wins + perf.losses;
    const wr = total > 0 ? (perf.wins / total) * 100 : 0;
    if (total >= 10 && (wr < 40 || perf.pnl < -100)) {
      badTags.push(tag);
    }
  }

  return {
    maxATR: avgLossATR > avgWinATR ? avgWinATR + (avgLossATR - avgWinATR) * 0.5 : undefined,
    maxADX: avgLossADX > avgWinADX ? avgWinADX + (avgLossADX - avgWinADX) * 0.5 : undefined,
    maxRSI3: avgLossRSI3 > avgWinRSI3 ? avgWinRSI3 + (avgLossRSI3 - avgWinRSI3) * 0.5 : undefined,
    excludeTags: badTags.length > 0 ? badTags : undefined,
  };
}

async function main() {
  console.log('═'.repeat(80));
  console.log('  NFI FILTER VALIDATION - Out-of-Sample Testing');
  console.log('═'.repeat(80));
  console.log(`  Asset: ${ASSET} | In-Sample Ratio: ${(IN_SAMPLE_RATIO * 100).toFixed(0)}%`);
  console.log('═'.repeat(80));

  // Load data
  let filepath: string;
  if (DATA_FILE) {
    filepath = path.isAbsolute(DATA_FILE) ? DATA_FILE : path.join(dataDir, DATA_FILE);
  } else {
    filepath = path.join(dataDir, `${ASSET}_1m_180d.csv`);
  }

  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`);
    process.exit(1);
  }

  console.log(`\n📥 Loading candles from: ${filepath}`);
  const allCandles = loadCandles(filepath);
  console.log(`   Loaded ${allCandles.length.toLocaleString()} 1m candles`);

  // Aggregate to 5m
  const candles5m: Candle[] = [];
  for (let i = 0; i < allCandles.length; i += 5) {
    const chunk = allCandles.slice(i, i + 5);
    if (chunk.length === 5) {
      candles5m.push({
        timestamp: chunk[0]!.timestamp,
        open: chunk[0]!.open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[4]!.close,
        volume: chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0),
      });
    }
  }
  console.log(`   Aggregated to ${candles5m.length.toLocaleString()} 5m candles`);

  // Split in-sample / out-of-sample
  const splitIndex = Math.floor(candles5m.length * IN_SAMPLE_RATIO);
  const inSampleCandles = candles5m.slice(0, splitIndex);
  const outOfSampleCandles = candles5m.slice(splitIndex);

  const inSampleDays = Math.floor((inSampleCandles.length / (24 * 12)));
  const outOfSampleDays = Math.floor((outOfSampleCandles.length / (24 * 12)));

  console.log(`\n📊 Data Split:`);
  console.log(`   In-Sample:  ${inSampleCandles.length.toLocaleString()} candles (~${inSampleDays} days)`);
  console.log(`   Out-of-Sample: ${outOfSampleCandles.length.toLocaleString()} candles (~${outOfSampleDays} days)`);

  // Get params
  const params = getParamsForAsset(ASSET, NFI_ETH_OPTIMIZED);

  // Calculate indicators for both sets
  console.log(`\n🔧 Calculating indicators...`);
  const inSampleSeries = calculateIndicators(inSampleCandles);
  const outOfSampleSeries = calculateIndicators(outOfSampleCandles);

  // 1. Baseline: No filters
  console.log(`\n🚀 Running baseline (no filters)...`);
  const baselineIS = runBacktest(inSampleCandles, inSampleSeries, params, {});
  const baselineOOS = runBacktest(outOfSampleCandles, outOfSampleSeries, params, {});

  const baselineISMetrics = calculateMetrics(baselineIS);
  const baselineOOSMetrics = calculateMetrics(baselineOOS);

  console.log(`\n📊 BASELINE RESULTS (No Filters)`);
  console.log('─'.repeat(80));
  console.log('Metric          | In-Sample | Out-of-Sample | Degradation');
  console.log('─'.repeat(80));
  console.log(`Trades          | ${baselineISMetrics.count.toString().padStart(10)} | ${baselineOOSMetrics.count.toString().padStart(13)} |`);
  console.log(`Win Rate        | ${baselineISMetrics.winRate.toFixed(1).padStart(9)}% | ${baselineOOSMetrics.winRate.toFixed(1).padStart(12)}% | ${(baselineISMetrics.winRate - baselineOOSMetrics.winRate).toFixed(1)}%`);
  console.log(`Net P&L         | $${baselineISMetrics.netPnl.toFixed(2).padStart(8)} | $${baselineOOSMetrics.netPnl.toFixed(2).padStart(11)} | $${(baselineISMetrics.netPnl - baselineOOSMetrics.netPnl).toFixed(2)}`);
  console.log(`Avg P&L/Trade   | $${baselineISMetrics.avgPnl.toFixed(2).padStart(8)} | $${baselineOOSMetrics.avgPnl.toFixed(2).padStart(11)} | $${(baselineISMetrics.avgPnl - baselineOOSMetrics.avgPnl).toFixed(2)}`);
  console.log(`Profit Factor   | ${baselineISMetrics.profitFactor.toFixed(2).padStart(9)} | ${baselineOOSMetrics.profitFactor.toFixed(2).padStart(12)} | ${(baselineISMetrics.profitFactor - baselineOOSMetrics.profitFactor).toFixed(2)}`);

  // 2. Find optimal filters on in-sample
  console.log(`\n🔍 Finding optimal filters on in-sample data...`);
  const optimalFilters = findOptimalFilters(baselineIS);
  console.log(`   Filters found:`);
  if (optimalFilters.maxATR) console.log(`     - Max ATR: ${optimalFilters.maxATR.toFixed(3)}%`);
  if (optimalFilters.maxADX) console.log(`     - Max ADX: ${optimalFilters.maxADX.toFixed(1)}`);
  if (optimalFilters.maxRSI3) console.log(`     - Max RSI3: ${optimalFilters.maxRSI3.toFixed(1)}`);
  if (optimalFilters.excludeTags) console.log(`     - Exclude Tags: ${optimalFilters.excludeTags.join(', ')}`);

  // 3. Test filters on in-sample (should improve)
  const filteredIS = runBacktest(inSampleCandles, inSampleSeries, params, optimalFilters);
  const filteredISMetrics = calculateMetrics(filteredIS);

  // 4. Test filters on out-of-sample (the real test)
  const filteredOOS = runBacktest(outOfSampleCandles, outOfSampleSeries, params, optimalFilters);
  const filteredOOSMetrics = calculateMetrics(filteredOOS);

  console.log(`\n📊 FILTERED RESULTS`);
  console.log('─'.repeat(80));
  console.log('Metric          | In-Sample | Out-of-Sample | Degradation');
  console.log('─'.repeat(80));
  console.log(`Trades          | ${filteredISMetrics.count.toString().padStart(10)} | ${filteredOOSMetrics.count.toString().padStart(13)} |`);
  console.log(`Win Rate        | ${filteredISMetrics.winRate.toFixed(1).padStart(9)}% | ${filteredOOSMetrics.winRate.toFixed(1).padStart(12)}% | ${(filteredISMetrics.winRate - filteredOOSMetrics.winRate).toFixed(1)}%`);
  console.log(`Net P&L         | $${filteredISMetrics.netPnl.toFixed(2).padStart(8)} | $${filteredOOSMetrics.netPnl.toFixed(2).padStart(11)} | $${(filteredISMetrics.netPnl - filteredOOSMetrics.netPnl).toFixed(2)}`);
  console.log(`Avg P&L/Trade   | $${filteredISMetrics.avgPnl.toFixed(2).padStart(8)} | $${filteredOOSMetrics.avgPnl.toFixed(2).padStart(11)} | $${(filteredISMetrics.avgPnl - filteredOOSMetrics.avgPnl).toFixed(2)}`);
  console.log(`Profit Factor   | ${filteredISMetrics.profitFactor.toFixed(2).padStart(9)} | ${filteredOOSMetrics.profitFactor.toFixed(2).padStart(12)} | ${(filteredISMetrics.profitFactor - filteredOOSMetrics.profitFactor).toFixed(2)}`);

  // 5. Overfitting analysis
  console.log(`\n🔬 OVERFITTING ANALYSIS`);
  console.log('─'.repeat(80));

  const wrDegradationBaseline = baselineISMetrics.winRate - baselineOOSMetrics.winRate;
  const wrDegradationFiltered = filteredISMetrics.winRate - filteredOOSMetrics.winRate;
  const pnlDegradationBaseline = baselineISMetrics.netPnl - baselineOOSMetrics.netPnl;
  const pnlDegradationFiltered = filteredISMetrics.netPnl - filteredOOSMetrics.netPnl;

  const isImprovement = filteredOOSMetrics.netPnl > baselineOOSMetrics.netPnl;
  // Overfitting: if degradation is much worse, OR if OOS is worse despite IS improvement
  const isOverfit = (wrDegradationFiltered > wrDegradationBaseline + 10) || 
                    (filteredOOSMetrics.netPnl < baselineOOSMetrics.netPnl && filteredISMetrics.netPnl > baselineISMetrics.netPnl * 2);
  
  // Calculate improvement metrics
  const oosPnlImprovement = filteredOOSMetrics.netPnl - baselineOOSMetrics.netPnl;
  const oosWRImprovement = filteredOOSMetrics.winRate - baselineOOSMetrics.winRate;

  console.log(`Baseline WR Degradation:  ${wrDegradationBaseline.toFixed(1)}%`);
  console.log(`Filtered WR Degradation:  ${wrDegradationFiltered.toFixed(1)}%`);
  console.log(`Baseline P&L Degradation: $${pnlDegradationBaseline.toFixed(2)}`);
  console.log(`Filtered P&L Degradation: $${pnlDegradationFiltered.toFixed(2)}`);
  console.log(`\nOOS Improvement:`);
  console.log(`  P&L: $${oosPnlImprovement.toFixed(2)} ${isImprovement ? '✅' : '❌'}`);
  console.log(`  WR: ${oosWRImprovement.toFixed(1)}% ${oosWRImprovement > 0 ? '✅' : '❌'}`);
  console.log(`\nOverfitting Risk: ${isOverfit ? '⚠️  HIGH' : '✅ LOW'}`);

  // 6. Conclusion
  console.log(`\n💡 CONCLUSION`);
  console.log('─'.repeat(80));
  
  const oosImprovementPct = baselineOOSMetrics.netPnl !== 0 
    ? ((oosPnlImprovement / Math.abs(baselineOOSMetrics.netPnl)) * 100)
    : oosPnlImprovement > 0 ? 100 : 0;
  
  if (isImprovement && !isOverfit) {
    console.log(`✅ Filters are VALID - They improve out-of-sample performance!`);
    console.log(`   OOS P&L improvement: $${oosPnlImprovement.toFixed(2)} (${oosImprovementPct.toFixed(1)}% better)`);
    console.log(`   OOS WR improvement: ${oosWRImprovement.toFixed(1)}%`);
    console.log(`   ✅ Safe to use these filters in production`);
  } else if (isImprovement && isOverfit) {
    console.log(`⚠️  MIXED RESULTS - Filters improve OOS but show overfitting signs`);
    console.log(`   OOS P&L improvement: $${oosPnlImprovement.toFixed(2)}`);
    console.log(`   However, degradation from IS to OOS is high`);
    console.log(`   ⚠️  Use with caution - may need more data or simpler filters`);
  } else if (isOverfit) {
    console.log(`❌ Filters show OVERFITTING - Performance degrades too much in OOS`);
    console.log(`   OOS is worse despite IS improvement`);
    console.log(`   ❌ Do NOT use these filters - they're overfitted`);
  } else {
    console.log(`❌ Filters don't help - OOS performance is worse`);
    console.log(`   OOS P&L change: $${oosPnlImprovement.toFixed(2)}`);
    console.log(`   ❌ The patterns found may not be predictive`);
  }
  
  console.log(`\n📝 RECOMMENDATION:`);
  if (isImprovement && oosImprovementPct > 50) {
    console.log(`   ✅ Strong improvement (>50%) - Filters are likely valid`);
  } else if (isImprovement && oosImprovementPct > 20) {
    console.log(`   ⚠️  Moderate improvement (20-50%) - Use filters but monitor closely`);
  } else if (isImprovement) {
    console.log(`   ⚠️  Small improvement (<20%) - Marginal benefit, may be noise`);
  } else {
    console.log(`   ❌ No improvement - Filters are not predictive`);
  }
}

main().catch(console.error);

