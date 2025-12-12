#!/usr/bin/env npx tsx
/**
 * NFI ML Data Collection
 *
 * Runs NFI backtest and collects features for each trade
 * to train an ML model that can predict WIN vs LOSS
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
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const DATA_FILE = process.env.DATA_FILE; // Optional: specify exact file
const dataDir = path.join(process.cwd(), 'data');

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;

interface IndicatorSeries {
  rsi_3: (number | undefined)[];
  rsi_14: (number | undefined)[];
  ema_12: (number | undefined)[];
  ema_26: (number | undefined)[];
  ema_50: (number | undefined)[];
  ema_200: (number | undefined)[];
  bb_upper: (number | undefined)[];
  bb_middle: (number | undefined)[];
  bb_lower: (number | undefined)[];
  stoch_k: (number | undefined)[];
  stoch_d: (number | undefined)[];
  ewo: (number | undefined)[];
  atr: (number | undefined)[];
  adx: (number | undefined)[];
  mfi: (number | undefined)[];
  cci: (number | undefined)[];
  williams_r: (number | undefined)[];
  cmf: (number | undefined)[];
}

interface TradeFeatures {
  // Identification
  timestamp: number;
  datetime: string;
  entryTag: string;

  // Time features
  hourOfDay: number;
  dayOfWeek: number;
  timeBlock4h: number;

  // Price context
  entryPrice: number;

  // RSI features
  rsi_3: number;
  rsi_14: number;
  rsi_delta: number;       // rsi_14 - previous
  rsi_oversold_depth: number; // How far below 30

  // BB features
  bb_width: number;
  bb_position: number;     // -1 to 1, 0 = middle
  dist_to_lower_bb: number;
  dist_to_upper_bb: number;
  below_lower_bb: boolean;

  // EWO features
  ewo: number;
  ewo_bullish: boolean;    // ewo < -2
  ewo_bearish: boolean;    // ewo > 2

  // Trend features
  above_ema_50: boolean;
  above_ema_200: boolean;
  ema_50_slope: number;
  ema_200_slope: number;

  // Momentum
  stoch_k: number;
  stoch_d: number;
  stoch_oversold: boolean;

  // Volatility
  atr_pct: number;

  // Other indicators
  adx: number;
  mfi: number;
  cci: number;
  williams_r: number;

  // Price action
  price_change_5: number;
  price_change_15: number;
  price_change_60: number;
  candle_body_pct: number;
  is_green_candle: boolean;

  // Recent performance
  recent_volatility: number;
  recent_trend: number;

  // Target (filled after trade)
  outcome: 'WIN' | 'LOSS' | null;
  pnl: number | null;
  pnlPct: number | null;
  exitReason: string | null;
  barsHeld: number | null;
}

// Load CSV
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

// Calculate all indicators
function calculateIndicators(candles: Candle[]): IndicatorSeries {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume ?? 1);

  // RSI
  const rsi3 = ti.RSI.calculate({ values: closes, period: 3 });
  const rsi14 = ti.RSI.calculate({ values: closes, period: 14 });

  // EMAs
  const ema12 = ti.EMA.calculate({ values: closes, period: 12 });
  const ema26 = ti.EMA.calculate({ values: closes, period: 26 });
  const ema50 = ti.EMA.calculate({ values: closes, period: 50 });
  const ema200 = ti.EMA.calculate({ values: closes, period: 200 });

  // BB
  const bb = ti.BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });

  // Stoch RSI
  const stochRsi = ti.StochasticRSI.calculate({
    values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3
  });

  // ATR
  const atr = ti.ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

  // ADX
  const adx = ti.ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

  // MFI
  const mfi = ti.MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 });

  // CCI
  const cci = ti.CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });

  // Williams %R
  const willR = ti.WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });

  // EWO
  const ema5 = ti.EMA.calculate({ values: closes, period: 5 });
  const ema35 = ti.EMA.calculate({ values: closes, period: 35 });

  // Pad arrays
  const pad = <T>(arr: T[], offset: number): (T | undefined)[] =>
    Array(offset).fill(undefined).concat(arr);

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

  return {
    rsi_3: pad(rsi3, 3),
    rsi_14: pad(rsi14, 14),
    ema_12: pad(ema12, 11),
    ema_26: pad(ema26, 25),
    ema_50: pad(ema50, 49),
    ema_200: pad(ema200, 199),
    bb_upper: pad(bb.map(b => b.upper), 19),
    bb_middle: pad(bb.map(b => b.middle), 19),
    bb_lower: pad(bb.map(b => b.lower), 19),
    stoch_k: pad(stochRsi.map(s => s.k), candles.length - stochRsi.length),
    stoch_d: pad(stochRsi.map(s => s.d), candles.length - stochRsi.length),
    ewo: ewoValues,
    atr: pad(atr, 14),
    adx: pad(adx.map(a => a.adx), 28),
    mfi: pad(mfi, 14),
    cci: pad(cci, 20),
    williams_r: pad(willR, 14),
    cmf: Array(candles.length).fill(0), // Simplified
  };
}

// Check NFI entry
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

  // Multiple entry conditions from NFI
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

// Extract features for a trade
function extractFeatures(
  i: number,
  candles: Candle[],
  series: IndicatorSeries,
  entryTag: string
): TradeFeatures {
  const candle = candles[i]!;
  const close = candle.close;
  const date = new Date(candle.timestamp * 1000);

  // Get indicator values with defaults
  const rsi_3 = series.rsi_3[i] ?? 50;
  const rsi_14 = series.rsi_14[i] ?? 50;
  const rsi_14_prev = series.rsi_14[i - 1] ?? 50;
  const bbUpper = series.bb_upper[i] ?? close;
  const bbMiddle = series.bb_middle[i] ?? close;
  const bbLower = series.bb_lower[i] ?? close;
  const ewo = series.ewo[i] ?? 0;
  const ema50 = series.ema_50[i] ?? close;
  const ema200 = series.ema_200[i] ?? close;
  const ema50_prev = series.ema_50[i - 1] ?? close;
  const ema200_prev = series.ema_200[i - 1] ?? close;
  const stochK = series.stoch_k[i] ?? 50;
  const stochD = series.stoch_d[i] ?? 50;
  const atr = series.atr[i] ?? 0;
  const adx = series.adx[i] ?? 25;
  const mfi = series.mfi[i] ?? 50;
  const cci = series.cci[i] ?? 0;
  const willR = series.williams_r[i] ?? -50;

  // BB calculations
  const bbWidth = bbMiddle > 0 ? (bbUpper - bbLower) / bbMiddle : 0;
  const bbRange = bbUpper - bbLower;
  const bbPosition = bbRange > 0 ? (close - bbMiddle) / (bbRange / 2) : 0;

  // Price changes
  const priceChange5 = i >= 5 ? ((close - candles[i - 5]!.close) / candles[i - 5]!.close) * 100 : 0;
  const priceChange15 = i >= 15 ? ((close - candles[i - 15]!.close) / candles[i - 15]!.close) * 100 : 0;
  const priceChange60 = i >= 60 ? ((close - candles[i - 60]!.close) / candles[i - 60]!.close) * 100 : 0;

  // Candle body
  const candleRange = candle.high - candle.low;
  const candleBody = Math.abs(candle.close - candle.open);
  const candleBodyPct = candleRange > 0 ? candleBody / candleRange : 0;

  // Recent volatility (std dev of returns over 20 periods)
  let recentVolatility = 0;
  if (i >= 20) {
    const returns: number[] = [];
    for (let j = i - 19; j <= i; j++) {
      returns.push((candles[j]!.close - candles[j - 1]!.close) / candles[j - 1]!.close);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    recentVolatility = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length) * 100;
  }

  // Recent trend (linear regression slope over 20 periods)
  let recentTrend = 0;
  if (i >= 20) {
    const prices: number[] = [];
    for (let j = i - 19; j <= i; j++) {
      prices.push(candles[j]!.close);
    }
    const n = prices.length;
    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let j = 0; j < n; j++) {
      num += (j - xMean) * (prices[j]! - yMean);
      den += Math.pow(j - xMean, 2);
    }
    recentTrend = den !== 0 ? (num / den / yMean) * 100 : 0;
  }

  return {
    timestamp: candle.timestamp,
    datetime: date.toISOString(),
    entryTag,

    hourOfDay: date.getUTCHours(),
    dayOfWeek: date.getUTCDay(),
    timeBlock4h: Math.floor(date.getUTCHours() / 4),

    entryPrice: close,

    rsi_3,
    rsi_14,
    rsi_delta: rsi_14 - rsi_14_prev,
    rsi_oversold_depth: Math.max(0, 30 - rsi_14),

    bb_width: bbWidth,
    bb_position: bbPosition,
    dist_to_lower_bb: ((close - bbLower) / close) * 100,
    dist_to_upper_bb: ((bbUpper - close) / close) * 100,
    below_lower_bb: close < bbLower,

    ewo,
    ewo_bullish: ewo < -2,
    ewo_bearish: ewo > 2,

    above_ema_50: close > ema50,
    above_ema_200: close > ema200,
    ema_50_slope: ema50_prev > 0 ? ((ema50 - ema50_prev) / ema50_prev) * 100 : 0,
    ema_200_slope: ema200_prev > 0 ? ((ema200 - ema200_prev) / ema200_prev) * 100 : 0,

    stoch_k: stochK,
    stoch_d: stochD,
    stoch_oversold: stochK < 20,

    atr_pct: close > 0 ? (atr / close) * 100 : 0,

    adx,
    mfi,
    cci,
    williams_r: willR,

    price_change_5: priceChange5,
    price_change_15: priceChange15,
    price_change_60: priceChange60,
    candle_body_pct: candleBodyPct,
    is_green_candle: candle.close > candle.open,

    recent_volatility: recentVolatility,
    recent_trend: recentTrend,

    outcome: null,
    pnl: null,
    pnlPct: null,
    exitReason: null,
    barsHeld: null,
  };
}

// Run backtest and collect features
function runBacktestWithCollection(
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams
): TradeFeatures[] {
  const features: TradeFeatures[] = [];
  let cooldownUntil = 0;
  const maxBarsInTrade = params.risk?.maxBarsInTrade ?? 72;
  const cooldownBars = params.risk?.cooldownBars ?? 6;
  const slPct = params.stopLoss.percentage * 100;
  let equity = INITIAL_CAPITAL;

  for (let i = 200; i < candles.length; i++) {
    if (i < cooldownUntil) continue;

    const entry = checkNFIEntry(i, candles, series, params);
    if (!entry?.triggered) continue;

    // Extract features at entry
    const tradeFeatures = extractFeatures(i, candles, series, entry.tag);

    const entryPrice = candles[i]!.close;
    const stake = equity * STAKE_PCT;
    const slPrice = entryPrice * (1 - slPct / 100);

    let exitIndex = i;
    let exitPrice = entryPrice;
    let exitReason = 'TIME_LIMIT';
    let outcome: 'WIN' | 'LOSS' = 'LOSS';

    // Simulate trade
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

    // Update features with outcome
    tradeFeatures.outcome = outcome;
    tradeFeatures.pnl = pnl;
    tradeFeatures.pnlPct = pnlPct;
    tradeFeatures.exitReason = exitReason;
    tradeFeatures.barsHeld = exitIndex - i;

    features.push(tradeFeatures);

    equity += pnl;
    cooldownUntil = exitIndex + cooldownBars;
  }

  return features;
}

// Analyze feature importance (basic statistics)
function analyzeFeatures(features: TradeFeatures[]): void {
  const wins = features.filter(f => f.outcome === 'WIN');
  const losses = features.filter(f => f.outcome === 'LOSS');

  console.log('\n📊 FEATURE ANALYSIS');
  console.log('═'.repeat(70));
  console.log(`Total: ${features.length} trades | Wins: ${wins.length} | Losses: ${losses.length}`);
  console.log(`Win Rate: ${((wins.length / features.length) * 100).toFixed(1)}%`);
  console.log('');

  // Analyze numeric features
  const numericFeatures = [
    'rsi_3', 'rsi_14', 'rsi_oversold_depth', 'bb_width', 'bb_position',
    'ewo', 'stoch_k', 'atr_pct', 'adx', 'mfi', 'cci', 'williams_r',
    'price_change_5', 'price_change_15', 'recent_volatility', 'recent_trend'
  ];

  console.log('Feature               | WIN avg   | LOSS avg  | Diff      | Predictive?');
  console.log('─'.repeat(70));

  for (const feat of numericFeatures) {
    const winAvg = wins.reduce((sum, f) => sum + (f[feat as keyof TradeFeatures] as number ?? 0), 0) / wins.length;
    const lossAvg = losses.reduce((sum, f) => sum + (f[feat as keyof TradeFeatures] as number ?? 0), 0) / losses.length;
    const diff = winAvg - lossAvg;
    const predictive = Math.abs(diff) > Math.abs(winAvg) * 0.1 ? '✓' : '';

    console.log(`${feat.padEnd(20)} | ${winAvg.toFixed(3).padStart(9)} | ${lossAvg.toFixed(3).padStart(9)} | ${diff.toFixed(3).padStart(9)} | ${predictive}`);
  }

  // Boolean features
  console.log('\nBoolean Features:');
  console.log('─'.repeat(70));
  const boolFeatures = ['below_lower_bb', 'ewo_bullish', 'above_ema_50', 'above_ema_200', 'stoch_oversold', 'is_green_candle'];

  for (const feat of boolFeatures) {
    const winTrue = wins.filter(f => f[feat as keyof TradeFeatures] === true).length / wins.length * 100;
    const lossTrue = losses.filter(f => f[feat as keyof TradeFeatures] === true).length / losses.length * 100;
    console.log(`${feat.padEnd(20)} | WIN: ${winTrue.toFixed(1).padStart(5)}% true | LOSS: ${lossTrue.toFixed(1).padStart(5)}% true`);
  }

  // Entry tag analysis
  console.log('\nEntry Tag Performance:');
  console.log('─'.repeat(70));
  const tags = [...new Set(features.map(f => f.entryTag))].sort();
  for (const tag of tags) {
    const tagTrades = features.filter(f => f.entryTag === tag);
    const tagWins = tagTrades.filter(f => f.outcome === 'WIN').length;
    const tagWR = (tagWins / tagTrades.length) * 100;
    const tagPnL = tagTrades.reduce((sum, f) => sum + (f.pnl ?? 0), 0);
    console.log(`Tag ${tag.padStart(3)}: ${tagTrades.length.toString().padStart(4)} trades | WR: ${tagWR.toFixed(1).padStart(5)}% | P&L: $${tagPnL.toFixed(2)}`);
  }

  // Time analysis
  console.log('\nHourly Performance (UTC):');
  console.log('─'.repeat(70));
  for (let h = 0; h < 24; h += 4) {
    const hourTrades = features.filter(f => f.hourOfDay >= h && f.hourOfDay < h + 4);
    if (hourTrades.length === 0) continue;
    const hourWins = hourTrades.filter(f => f.outcome === 'WIN').length;
    const hourWR = (hourWins / hourTrades.length) * 100;
    console.log(`${h.toString().padStart(2)}h-${(h+4).toString().padStart(2)}h: ${hourTrades.length.toString().padStart(4)} trades | WR: ${hourWR.toFixed(1).padStart(5)}%`);
  }
}

// Export to CSV
function exportToCSV(features: TradeFeatures[], outputPath: string): void {
  const headers = Object.keys(features[0]!);
  const lines: string[] = [headers.join(',')];

  for (const row of features) {
    const values = headers.map(h => {
      const v = row[h as keyof TradeFeatures];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (typeof v === 'string') return `"${v}"`;
      return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(6) : String(v);
    });
    lines.push(values.join(','));
  }

  fs.writeFileSync(outputPath, lines.join('\n'));
  console.log(`\n💾 CSV exported to: ${outputPath}`);
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  NFI ML DATA COLLECTION');
  console.log('═'.repeat(70));
  console.log(`  Asset: ${ASSET} | Days: ${DAYS}`);
  if (DATA_FILE) console.log(`  Data File: ${DATA_FILE}`);
  console.log('═'.repeat(70));

  // Load data - use DATA_FILE if provided, otherwise construct from ASSET and DAYS
  let filepath: string;
  if (DATA_FILE) {
    // If DATA_FILE is provided, use it directly (can be relative or absolute)
    filepath = path.isAbsolute(DATA_FILE) ? DATA_FILE : path.join(dataDir, DATA_FILE);
  } else {
    // Otherwise, construct filename based on DAYS
    const daysSuffix = DAYS === 180 ? '180d' : DAYS === 90 ? '90d' : DAYS === 30 ? '30d' : `${DAYS}d`;
    filepath = path.join(dataDir, `${ASSET}_1m_${daysSuffix}.csv`);
  }

  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`);
    console.error(`   Looking for data file in: ${dataDir}`);
    console.error(`   Available files: ${fs.readdirSync(dataDir).filter(f => f.includes(ASSET) && f.endsWith('.csv')).join(', ')}`);
    process.exit(1);
  }

  console.log(`📁 Using data file: ${filepath}`);

  console.log('\n📥 Loading candles...');
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

  // Filter by days
  const candlesPerDay = 24 * 12;
  const candlesToUse = Math.min(DAYS * candlesPerDay, candles5m.length);
  const candles = candles5m.slice(-candlesToUse);
  console.log(`   Using last ${DAYS} days: ${candles.length} candles`);

  // Get params
  const params = getParamsForAsset(ASSET, NFI_ETH_OPTIMIZED);

  // Calculate indicators
  console.log('\n🔧 Calculating indicators...');
  const series = calculateIndicators(candles);

  // Run backtest with collection
  console.log('🚀 Running backtest and collecting features...');
  const features = runBacktestWithCollection(candles, series, params);

  console.log(`\n✅ Collected ${features.length} trades with features`);

  // Analyze
  analyzeFeatures(features);

  // Export
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csvPath = path.join(outputDir, `nfi_ml_${ASSET}_${DAYS}d_${timestamp}.csv`);
  exportToCSV(features, csvPath);

  // Summary
  const wins = features.filter(f => f.outcome === 'WIN').length;
  const netPnl = features.reduce((sum, f) => sum + (f.pnl ?? 0), 0);

  console.log('\n📋 SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Trades: ${features.length}`);
  console.log(`Win Rate: ${((wins / features.length) * 100).toFixed(1)}%`);
  console.log(`Net P&L: $${netPnl.toFixed(2)}`);
  console.log('\n✅ Use the CSV file to train XGBoost or similar ML model');
}

main().catch(console.error);
