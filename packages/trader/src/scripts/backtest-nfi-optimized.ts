#!/usr/bin/env npx tsx
/**
 * NostalgiaForInfinity (NFI) Strategy Backtest - OPTIMIZED VERSION
 *
 * Uses technicalindicators library for fast indicator calculation.
 * Pre-calculates all indicator series ONCE, then simulates trading.
 *
 * Usage:
 *   ASSET="cryETHUSD" DAYS=90 npx tsx src/scripts/backtest-nfi-optimized.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { loadCandlesFromCSV } from '../backtest/index.js';
import {
  ETH_NFI_PARAMS,
  BTC_NFI_PARAMS,
  CONSERVATIVE_NFI_PARAMS,
  getParamsForAsset,
} from '../strategies/nfi/nfi.params.js';
import {
  NFI_ETH_OPTIMIZED,
  NFI_BTC_OPTIMIZED,
  NFI_SCALP,
} from '../strategies/nfi/nfi-optimized.params.js';
import type { NFIParams, NFIIndicators } from '../strategies/nfi/nfi.types.js';
import {
  checkEntryConditions,
  getBestEntryCondition,
} from '../strategies/nfi/entry-conditions.js';

// @ts-ignore - technicalindicators uses default export
import * as ti from 'technicalindicators';

const RSI = ti.RSI;
const EMA = ti.EMA;
const SMA = ti.SMA;
const BollingerBands = ti.BollingerBands;
const Stochastic = ti.Stochastic;
const CCI = ti.CCI;
const WilliamsR = ti.WilliamsR;
const MFI = ti.MFI;
const ROC = ti.ROC;

// Configuration from environment
const ASSET = process.env.ASSET ?? 'cryETHUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const DATA_FILE = process.env.DATA_FILE;
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.03');
const MULTIPLIER = parseInt(process.env.MULTIPLIER ?? '100', 10);
const RUN_MONTE_CARLO = process.env.MONTE_CARLO === 'true';
const SAVE_JSON = process.env.JSON === 'true';
const PRESET = process.env.PRESET as 'eth' | 'btc' | 'conservative' | 'eth_opt' | 'btc_opt' | 'scalp' | undefined;

const INITIAL_CAPITAL = 1000;

interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'CALL' | 'PUT';
  pnl: number;
  pnlPct: number;
  exitReason: string;
  entryTag: string;
  barsHeld: number;
}

interface IndicatorSeries {
  rsi_3: number[];
  rsi_14: number[];
  ema_12: number[];
  ema_26: number[];
  ema_50: number[];
  ema_200: number[];
  sma_9: number[];
  sma_200: number[];
  bb_upper: number[];
  bb_middle: number[];
  bb_lower: number[];
  bb_width: number[];
  stoch_k: number[];
  stoch_d: number[];
  cci: number[];
  williams_r: number[];
  mfi: number[];
  roc_2: number[];
  roc_9: number[];
  ewo: number[];
  cti: number[];
  cmf: number[];
  // 1h
  rsi_14_1h: number[];
  ema_200_1h: number[];
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  NOSTALGIAFORINFINITY (NFI) BACKTEST - OPTIMIZED');
  console.log('═'.repeat(70));
  console.log('');

  // Get params based on preset
  let baseParams: Partial<NFIParams> = {};
  if (PRESET === 'eth') {
    baseParams = ETH_NFI_PARAMS;
    console.log(`📋 Using preset: ETH (original)`);
  } else if (PRESET === 'btc') {
    baseParams = BTC_NFI_PARAMS;
    console.log(`📋 Using preset: BTC (original)`);
  } else if (PRESET === 'conservative') {
    baseParams = CONSERVATIVE_NFI_PARAMS;
    console.log(`📋 Using preset: Conservative`);
  } else if (PRESET === 'eth_opt') {
    baseParams = NFI_ETH_OPTIMIZED;
    console.log(`📋 Using preset: ETH OPTIMIZED (tight SL/TP)`);
  } else if (PRESET === 'btc_opt') {
    baseParams = NFI_BTC_OPTIMIZED;
    console.log(`📋 Using preset: BTC OPTIMIZED (tight SL/TP)`);
  } else if (PRESET === 'scalp') {
    baseParams = NFI_SCALP;
    console.log(`📋 Using preset: SCALP (ultra-tight)`);
  }

  const params = getParamsForAsset(ASSET, baseParams);

  console.log(`📊 Configuration:`);
  console.log(`   Asset: ${ASSET}`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log(`   Stop Loss: ${(params.stopLoss.percentage * 100).toFixed(1)}%`);
  console.log(`   RSI Oversold: ${params.rsi.oversold}`);
  console.log(`   RSI Overbought: ${params.rsi.overbought}`);
  console.log('');

  // Load data
  let dataPath: string;
  if (DATA_FILE) {
    dataPath = path.isAbsolute(DATA_FILE) ? DATA_FILE : path.join(process.cwd(), DATA_FILE);
  } else {
    const dataDir = path.join(process.cwd(), 'data');
    dataPath = path.join(dataDir, `${ASSET}_1m_${DAYS}d.csv`);
  }

  if (!fs.existsSync(dataPath)) {
    console.log(`❌ Data file not found: ${dataPath}`);
    console.log('To download data, run:');
    console.log(`   SYMBOLS="${ASSET}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    process.exit(1);
  }

  console.log(`📥 Loading data from: ${path.basename(dataPath)}`);
  const candles1m = loadCandlesFromCSV(dataPath, {
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

  console.log(`   Loaded ${candles1m.length.toLocaleString()} candles (1m)`);

  // Convert 1m candles to 5m for NFI
  const candles = resampleCandles(candles1m, 5);
  console.log(`   Resampled to ${candles.length.toLocaleString()} candles (5m)`);

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  const startDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];
  console.log(`   Period: ${startDate} → ${endDate}`);
  console.log('');

  // Pre-calculate all indicators using technicalindicators
  console.log('🔧 Pre-calculating indicators (optimized)...');
  const startCalc = Date.now();
  const series = preCalculateIndicators(candles);
  console.log(`   Completed in ${((Date.now() - startCalc) / 1000).toFixed(1)}s`);
  console.log('');

  // Run simulation
  console.log('🚀 Running simulation...');
  const startSim = Date.now();
  const trades = runSimulation(candles, series, params);
  console.log(`   Completed in ${((Date.now() - startSim) / 1000).toFixed(1)}s`);
  console.log(`   Total trades: ${trades.length}`);
  console.log('');

  // Calculate metrics
  const metrics = calculateMetrics(trades);

  // Print results
  printResults(trades, metrics, candles, params);

  // Analyze entry tags
  analyzeEntryTags(trades);

  // Monte Carlo
  if (RUN_MONTE_CARLO && trades.length > 30) {
    runMonteCarloSimulation(trades);
  }

  // Save JSON
  if (SAVE_JSON) {
    const jsonPath = saveResultsToJSON(trades, metrics, candles);
    console.log(`\n💾 Results saved to: ${jsonPath}`);
  }

  console.log('\n✅ NFI Optimized Backtest complete!');
}

/**
 * Resample candles to higher timeframe
 */
function resampleCandles(candles: Candle[], factor: number): Candle[] {
  const resampled: Candle[] = [];

  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;

    const firstCandle = chunk[0]!;
    const lastCandle = chunk[chunk.length - 1]!;

    resampled.push({
      open: firstCandle.open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: lastCandle.close,
      volume: chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0),
      timestamp: lastCandle.timestamp,
      asset: firstCandle.asset,
      timeframe: (firstCandle.timeframe ?? 60) * factor,
    });
  }

  return resampled;
}

/**
 * Pre-calculate all indicator series using technicalindicators library
 */
function preCalculateIndicators(candles: Candle[]): IndicatorSeries {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume ?? 0);

  // Initialize arrays with defaults
  const series: IndicatorSeries = {
    rsi_3: new Array(n).fill(50),
    rsi_14: new Array(n).fill(50),
    ema_12: new Array(n).fill(closes[0]),
    ema_26: new Array(n).fill(closes[0]),
    ema_50: new Array(n).fill(closes[0]),
    ema_200: new Array(n).fill(closes[0]),
    sma_9: new Array(n).fill(closes[0]),
    sma_200: new Array(n).fill(closes[0]),
    bb_upper: new Array(n).fill(closes[0]),
    bb_middle: new Array(n).fill(closes[0]),
    bb_lower: new Array(n).fill(closes[0]),
    bb_width: new Array(n).fill(0),
    stoch_k: new Array(n).fill(50),
    stoch_d: new Array(n).fill(50),
    cci: new Array(n).fill(0),
    williams_r: new Array(n).fill(-50),
    mfi: new Array(n).fill(50),
    roc_2: new Array(n).fill(0),
    roc_9: new Array(n).fill(0),
    ewo: new Array(n).fill(0),
    cti: new Array(n).fill(0),
    cmf: new Array(n).fill(0),
    rsi_14_1h: new Array(n).fill(50),
    ema_200_1h: new Array(n).fill(closes[0]),
  };

  // RSI 3 and 14
  const rsi3Values = RSI.calculate({ values: closes, period: 3 });
  const rsi14Values = RSI.calculate({ values: closes, period: 14 });

  for (let i = 0; i < rsi3Values.length; i++) {
    series.rsi_3[i + 3] = rsi3Values[i]!;
  }
  for (let i = 0; i < rsi14Values.length; i++) {
    series.rsi_14[i + 14] = rsi14Values[i]!;
  }

  // EMAs
  const ema12Values = EMA.calculate({ values: closes, period: 12 });
  const ema26Values = EMA.calculate({ values: closes, period: 26 });
  const ema50Values = EMA.calculate({ values: closes, period: 50 });
  const ema200Values = EMA.calculate({ values: closes, period: 200 });

  for (let i = 0; i < ema12Values.length; i++) series.ema_12[i + 11] = ema12Values[i]!;
  for (let i = 0; i < ema26Values.length; i++) series.ema_26[i + 25] = ema26Values[i]!;
  for (let i = 0; i < ema50Values.length; i++) series.ema_50[i + 49] = ema50Values[i]!;
  for (let i = 0; i < ema200Values.length; i++) series.ema_200[i + 199] = ema200Values[i]!;

  // SMAs
  const sma9Values = SMA.calculate({ values: closes, period: 9 });
  const sma200Values = SMA.calculate({ values: closes, period: 200 });

  for (let i = 0; i < sma9Values.length; i++) series.sma_9[i + 8] = sma9Values[i]!;
  for (let i = 0; i < sma200Values.length; i++) series.sma_200[i + 199] = sma200Values[i]!;

  // Bollinger Bands
  const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  for (let i = 0; i < bbValues.length; i++) {
    const bb = bbValues[i]!;
    series.bb_upper[i + 19] = bb.upper;
    series.bb_middle[i + 19] = bb.middle;
    series.bb_lower[i + 19] = bb.lower;
    series.bb_width[i + 19] = bb.middle > 0 ? (bb.upper - bb.lower) / bb.middle : 0;
  }

  // Stochastic
  const stochValues = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3,
  });
  for (let i = 0; i < stochValues.length; i++) {
    const stoch = stochValues[i]!;
    series.stoch_k[i + 15] = stoch.k;
    series.stoch_d[i + 15] = stoch.d;
  }

  // CCI
  const cciValues = CCI.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 20,
  });
  for (let i = 0; i < cciValues.length; i++) {
    series.cci[i + 19] = cciValues[i]!;
  }

  // Williams %R
  const wrValues = WilliamsR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  });
  for (let i = 0; i < wrValues.length; i++) {
    series.williams_r[i + 13] = wrValues[i]!;
  }

  // MFI
  const mfiValues = MFI.calculate({
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
    period: 14,
  });
  for (let i = 0; i < mfiValues.length; i++) {
    series.mfi[i + 14] = mfiValues[i]!;
  }

  // ROC
  const roc2Values = ROC.calculate({ values: closes, period: 2 });
  const roc9Values = ROC.calculate({ values: closes, period: 9 });
  for (let i = 0; i < roc2Values.length; i++) series.roc_2[i + 2] = roc2Values[i]!;
  for (let i = 0; i < roc9Values.length; i++) series.roc_9[i + 9] = roc9Values[i]!;

  // EWO (EMA5 - EMA35)
  const ema5Values = EMA.calculate({ values: closes, period: 5 });
  const ema35Values = EMA.calculate({ values: closes, period: 35 });
  const offset5 = 4;
  const offset35 = 34;

  for (let i = offset35; i < n; i++) {
    const idx5 = i - offset5;
    const idx35 = i - offset35;
    if (idx5 >= 0 && idx5 < ema5Values.length && idx35 >= 0 && idx35 < ema35Values.length) {
      const ema5 = ema5Values[idx5]!;
      const ema35 = ema35Values[idx35]!;
      series.ewo[i] = closes[i]! > 0 ? ((ema5 - ema35) / closes[i]!) * 100 : 0;
    }
  }

  // CTI (Correlation Trend Indicator) - Simple linear regression correlation
  const ctiPeriod = 20;
  for (let i = ctiPeriod; i < n; i++) {
    const slice = closes.slice(i - ctiPeriod, i);
    series.cti[i] = calculateCTI(slice);
  }

  // CMF (Chaikin Money Flow)
  const cmfPeriod = 20;
  for (let i = cmfPeriod; i < n; i++) {
    const candleSlice = candles.slice(i - cmfPeriod, i);
    series.cmf[i] = calculateCMF(candleSlice);
  }

  // 1h indicators (every 12 5m bars)
  const candles1h = resampleCandles(candles, 12);
  const closes1h = candles1h.map(c => c.close);

  if (closes1h.length > 14) {
    const rsi14_1h = RSI.calculate({ values: closes1h, period: 14 });
    const ema200_1h = closes1h.length > 200
      ? EMA.calculate({ values: closes1h, period: 200 })
      : EMA.calculate({ values: closes1h, period: Math.min(200, closes1h.length - 1) });

    for (let i = 0; i < rsi14_1h.length; i++) {
      const start5m = (i + 14) * 12;
      const end5m = Math.min((i + 15) * 12, n);
      for (let j = start5m; j < end5m; j++) {
        if (j < n) series.rsi_14_1h[j] = rsi14_1h[i]!;
      }
    }

    for (let i = 0; i < ema200_1h.length; i++) {
      const offset1h = Math.min(199, closes1h.length - 2);
      const start5m = (i + offset1h) * 12;
      const end5m = Math.min((i + offset1h + 1) * 12, n);
      for (let j = start5m; j < end5m; j++) {
        if (j < n) series.ema_200_1h[j] = ema200_1h[i]!;
      }
    }
  }

  return series;
}

/**
 * Calculate CTI (Correlation Trend Indicator)
 */
function calculateCTI(closes: number[]): number {
  const n = closes.length;
  if (n < 2) return 0;

  const times = Array.from({ length: n }, (_, i) => i + 1);
  const meanPrice = closes.reduce((a, b) => a + b, 0) / n;
  const meanTime = times.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomPrices = 0;
  let denomTimes = 0;

  for (let i = 0; i < n; i++) {
    const priceDiff = closes[i]! - meanPrice;
    const timeDiff = times[i]! - meanTime;
    numerator += priceDiff * timeDiff;
    denomPrices += priceDiff * priceDiff;
    denomTimes += timeDiff * timeDiff;
  }

  const denom = Math.sqrt(denomPrices * denomTimes);
  return denom === 0 ? 0 : numerator / denom;
}

/**
 * Calculate CMF (Chaikin Money Flow)
 */
function calculateCMF(candles: Candle[]): number {
  let mfvSum = 0;
  let volumeSum = 0;

  for (const candle of candles) {
    const hl = candle.high - candle.low;
    if (hl === 0) continue;

    const vol = candle.volume ?? 0;
    const mfm = ((candle.close - candle.low) - (candle.high - candle.close)) / hl;
    mfvSum += mfm * vol;
    volumeSum += vol;
  }

  return volumeSum === 0 ? 0 : mfvSum / volumeSum;
}

/**
 * Build NFIIndicators for a specific index
 */
function getIndicatorsAtIndex(i: number, candles: Candle[], series: IndicatorSeries): NFIIndicators {
  const candle = candles[i]!;
  const prevCandle = candles[Math.max(0, i - 1)]!;

  const bb_delta = series.bb_middle[i]! - series.bb_lower[i]!;
  const close_delta = candle.close - prevCandle.close;
  const tail = Math.abs(candle.close - candle.low);

  const is_downtrend = candle.close < series.ema_200[i]! && series.ema_50[i]! < series.ema_200[i]!;
  const is_uptrend = candle.close > series.ema_200[i]! && series.ema_50[i]! > series.ema_200[i]!;

  // Pump/dump detection
  const lookback = 12;
  let pump_detected = false;
  let dump_detected = false;
  if (i >= lookback) {
    const change = (candle.close - candles[i - lookback]!.close) / candles[i - lookback]!.close;
    pump_detected = change > 0.03;
    dump_detected = change < -0.03;
  }

  return {
    rsi_3: series.rsi_3[i]!,
    rsi_14: series.rsi_14[i]!,
    rsi_3_change: i > 0 ? series.rsi_3[i]! - series.rsi_3[i - 1]! : 0,
    stoch_rsi_k: series.stoch_k[i]!,
    stoch_rsi_d: series.stoch_d[i]!,
    ema_12: series.ema_12[i]!,
    ema_26: series.ema_26[i]!,
    ema_50: series.ema_50[i]!,
    ema_200: series.ema_200[i]!,
    sma_9: series.sma_9[i]!,
    sma_200: series.sma_200[i]!,
    bb_upper: series.bb_upper[i]!,
    bb_middle: series.bb_middle[i]!,
    bb_lower: series.bb_lower[i]!,
    bb_width: series.bb_width[i]!,
    bb_delta,
    close_delta,
    tail,
    ewo: series.ewo[i]!,
    cti: series.cti[i]!,
    cmf: series.cmf[i]!,
    mfi: series.mfi[i]!,
    williams_r: series.williams_r[i]!,
    cci: series.cci[i]!,
    roc_2: series.roc_2[i]!,
    roc_9: series.roc_9[i]!,

    // 15m (approximate with 5m)
    rsi_3_15m: series.rsi_3[i]!,
    rsi_14_15m: series.rsi_14[i]!,
    ema_200_15m: series.ema_200[i]!,
    cti_15m: series.cti[i]!,
    cmf_15m: series.cmf[i]!,

    // 1h
    rsi_3_1h: series.rsi_14_1h[i]!,
    rsi_14_1h: series.rsi_14_1h[i]!,
    ema_50_1h: series.ema_200_1h[i]!,
    ema_200_1h: series.ema_200_1h[i]!,
    cti_1h: series.cti[i]!,
    cmf_1h: series.cmf[i]!,
    ssl_up_1h: candle.close,
    ssl_down_1h: candle.close,

    // 4h (approximate)
    rsi_14_4h: series.rsi_14_1h[i]!,
    ema_200_4h: series.ema_200_1h[i]!,
    cti_4h: series.cti[i]!,
    roc_9_4h: series.roc_9[i]!,

    // 1d (approximate)
    rsi_14_1d: series.rsi_14_1h[i]!,
    ema_200_1d: series.ema_200_1h[i]!,
    cti_1d: series.cti[i]!,

    is_downtrend,
    is_uptrend,
    pump_detected,
    dump_detected,
  };
}

/**
 * Run trading simulation
 */
function runSimulation(
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams
): Trade[] {
  const trades: Trade[] = [];
  const warmup = 250;
  const cooldownBars = params.risk.cooldownBars;
  const maxBarsInTrade = params.risk.maxBarsInTrade;
  const slPct = params.stopLoss.percentage;

  const roiTimes = Object.keys(params.dynamicROI).map(Number).sort((a, b) => b - a);

  let position: {
    entryIndex: number;
    entryPrice: number;
    direction: 'CALL' | 'PUT';
    entryTag: string;
  } | null = null;
  let lastExitBar = -cooldownBars;
  let consecutiveLosses = 0;
  let pauseUntilBar = -1;

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i]!;

    if (position) {
      const barsHeld = i - position.entryIndex;
      const minutesHeld = barsHeld * 5;

      const pnlPct = position.direction === 'CALL'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;

      let shouldExit = false;
      let exitReason = '';

      // Stop Loss
      if (pnlPct <= -slPct * 100) {
        shouldExit = true;
        exitReason = `STOP_LOSS (${pnlPct.toFixed(2)}%)`;
      }

      // Dynamic ROI
      if (!shouldExit) {
        for (const time of roiTimes) {
          if (minutesHeld >= time) {
            const target = params.dynamicROI[time]!;
            if (pnlPct >= target) {
              shouldExit = true;
              exitReason = `ROI_${time}min (${pnlPct.toFixed(2)}% >= ${target}%)`;
            }
            break;
          }
        }
      }

      // Time limit
      if (!shouldExit && barsHeld >= maxBarsInTrade) {
        shouldExit = true;
        exitReason = `TIME_LIMIT (${barsHeld} bars)`;
      }

      // Signal exits (if in profit) - Only if enabled
      const useSignalExits = params.exitSignals.use_signal_exits !== false;
      if (!shouldExit && pnlPct > 0.5 && useSignalExits) {
        if (position.direction === 'CALL') {
          if (series.rsi_14[i]! > params.exitSignals.rsi_overbought) {
            shouldExit = true;
            exitReason = `RSI_OVERBOUGHT (${series.rsi_14[i]!.toFixed(0)})`;
          } else if (params.exitSignals.bb_overbought && candle.close > series.bb_upper[i]!) {
            shouldExit = true;
            exitReason = 'BB_UPPER_TOUCH';
          } else if (series.stoch_k[i]! > params.exitSignals.stoch_overbought) {
            shouldExit = true;
            exitReason = `STOCH_OVERBOUGHT (${series.stoch_k[i]!.toFixed(0)})`;
          }
        }
      }

      if (shouldExit) {
        const pnl = (INITIAL_CAPITAL * STAKE_PCT * MULTIPLIER) * (pnlPct / 100);

        trades.push({
          entryTime: candles[position.entryIndex]!.timestamp * 1000,
          exitTime: candle.timestamp * 1000,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          direction: position.direction,
          pnl,
          pnlPct,
          exitReason,
          entryTag: position.entryTag,
          barsHeld,
        });

        if (pnl > 0) {
          consecutiveLosses = 0;
        } else {
          consecutiveLosses++;
          if (consecutiveLosses >= params.risk.maxConsecutiveLosses) {
            pauseUntilBar = i + params.risk.pauseBarsAfterMaxLosses;
            consecutiveLosses = 0;
          }
        }

        lastExitBar = i;
        position = null;
      }
    } else {
      if (i - lastExitBar < cooldownBars) continue;
      if (i < pauseUntilBar) continue;

      const indicators = getIndicatorsAtIndex(i, candles, series);
      const conditions = checkEntryConditions(candle, indicators, params, 'CALL');
      const bestCondition = getBestEntryCondition(conditions);

      if (bestCondition) {
        position = {
          entryIndex: i,
          entryPrice: candle.close,
          direction: bestCondition.tag.startsWith('short') ? 'PUT' : 'CALL',
          entryTag: bestCondition.tag,
        };
      }
    }
  }

  return trades;
}

function calculateMetrics(trades: Trade[]) {
  if (trades.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      grossProfit: 0, grossLoss: 0, netPnl: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, maxDrawdown: 0, maxDrawdownPct: 0,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0, avgBarsHeld: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  let peak = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  let balance = INITIAL_CAPITAL;
  for (const trade of trades) {
    balance += trade.pnl;
    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  let maxConsecWins = 0, maxConsecLosses = 0, consecWins = 0, consecLosses = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      consecWins++;
      consecLosses = 0;
      if (consecWins > maxConsecWins) maxConsecWins = consecWins;
    } else {
      consecLosses++;
      consecWins = 0;
      if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
    }
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    grossProfit,
    grossLoss,
    netPnl: grossProfit - grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    maxDrawdown,
    maxDrawdownPct: (maxDrawdown / peak) * 100,
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    avgBarsHeld: trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length,
  };
}

function printResults(trades: Trade[], metrics: any, candles: Candle[], params: NFIParams) {
  const startDate = new Date(candles[0]!.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString().split('T')[0];

  const expectancy = trades.length > 0 ? metrics.netPnl / trades.length : 0;
  const pnls = trades.map(t => t.pnl);
  const mean = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const variance = pnls.length > 0 ? pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnls.length : 0;
  const pnlStd = Math.sqrt(variance);
  const sqn = pnlStd > 0 ? (expectancy / pnlStd) * Math.sqrt(trades.length) : 0;

  console.log('═'.repeat(70));
  console.log('  NFI BACKTEST RESULTS');
  console.log('═'.repeat(70));
  console.log('');

  console.log('📊 CONFIGURATION');
  console.log('─'.repeat(70));
  console.log(`  Asset:        ${ASSET}`);
  console.log(`  Timeframe:    5m`);
  console.log(`  Period:       ${startDate} → ${endDate}`);
  console.log(`  Candles:      ${candles.length.toLocaleString()}`);
  console.log(`  Initial:      $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  Stake:        ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`  Multiplier:   ${MULTIPLIER}x`);
  console.log(`  Stop Loss:    ${(params.stopLoss.percentage * 100).toFixed(1)}%`);
  console.log('');

  console.log('📈 PERFORMANCE');
  console.log('─'.repeat(70));
  console.log(`  Trades:       ${metrics.totalTrades} (${metrics.wins}W / ${metrics.losses}L)`);
  console.log(`  Win Rate:     ${metrics.winRate.toFixed(1)}%`);
  console.log(`  Net P&L:      $${metrics.netPnl.toFixed(2)}`);
  console.log(`  ROI:          ${((metrics.netPnl / INITIAL_CAPITAL) * 100).toFixed(1)}%`);
  console.log(`  Profit Factor: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}`);
  console.log('');

  console.log('💰 P&L BREAKDOWN');
  console.log('─'.repeat(70));
  console.log(`  Gross Profit: $${metrics.grossProfit.toFixed(2)}`);
  console.log(`  Gross Loss:   $${metrics.grossLoss.toFixed(2)}`);
  console.log(`  Avg Win:      $${metrics.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:     $${metrics.avgLoss.toFixed(2)}`);
  console.log(`  Avg Trade:    $${expectancy.toFixed(2)}`);
  console.log('');

  console.log('⚠️  RISK METRICS');
  console.log('─'.repeat(70));
  console.log(`  Max Drawdown: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPct.toFixed(1)}%)`);
  console.log(`  Max Consec W: ${metrics.maxConsecutiveWins}`);
  console.log(`  Max Consec L: ${metrics.maxConsecutiveLosses}`);
  console.log(`  Expectancy:   $${expectancy.toFixed(2)}`);
  console.log(`  SQN:          ${sqn.toFixed(2)}`);
  console.log('');

  console.log('🔍 TRADE QUALITY');
  console.log('─'.repeat(70));
  console.log(`  Avg Duration: ${metrics.avgBarsHeld.toFixed(1)} bars (${(metrics.avgBarsHeld * 5).toFixed(0)} min)`);
  console.log(`  Trades/Day:   ${(trades.length / DAYS).toFixed(1)}`);
  console.log('');

  const exitReasons: Record<string, number> = {};
  for (const trade of trades) {
    const reason = trade.exitReason.split(' ')[0] ?? trade.exitReason;
    exitReasons[reason] = (exitReasons[reason] ?? 0) + 1;
  }

  console.log('📊 EXIT REASONS');
  console.log('─'.repeat(70));
  for (const [reason, count] of Object.entries(exitReasons).sort((a, b) => b[1] - a[1])) {
    const pct = (count / trades.length) * 100;
    console.log(`  ${reason.padEnd(22)}: ${String(count).padStart(4)} (${pct.toFixed(1)}%)`);
  }
  console.log('');

  console.log('═'.repeat(70));
}

function analyzeEntryTags(trades: Trade[]) {
  const tagStats: Record<string, { count: number; wins: number; totalPnl: number }> = {};

  for (const trade of trades) {
    const tag = trade.entryTag || 'unknown';
    if (!tagStats[tag]) {
      tagStats[tag] = { count: 0, wins: 0, totalPnl: 0 };
    }
    tagStats[tag]!.count++;
    if (trade.pnl > 0) tagStats[tag]!.wins++;
    tagStats[tag]!.totalPnl += trade.pnl;
  }

  const sorted = Object.entries(tagStats).sort((a, b) => b[1].count - a[1].count);

  console.log('🏷️  ENTRY TAG ANALYSIS');
  console.log('─'.repeat(70));
  console.log('  Tag                          Count   WinRate   Avg P&L');
  console.log('  ' + '-'.repeat(55));

  for (const [tag, stats] of sorted.slice(0, 15)) {
    const winRate = stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
    const avgPnl = stats.count > 0 ? stats.totalPnl / stats.count : 0;
    console.log(
      `  ${tag.padEnd(28)} ${String(stats.count).padStart(5)}   ${winRate.toFixed(1).padStart(5)}%   $${avgPnl.toFixed(2).padStart(7)}`
    );
  }
  console.log('');
}

function runMonteCarloSimulation(trades: Trade[]) {
  console.log('🎲 MONTE CARLO SIMULATION');
  console.log('─'.repeat(70));

  const iterations = 1000;
  const pnls = trades.map(t => t.pnl);
  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let balance = INITIAL_CAPITAL;
    const shuffled = [...pnls].sort(() => Math.random() - 0.5);
    for (const pnl of shuffled) balance += pnl;
    results.push(balance - INITIAL_CAPITAL);
  }

  results.sort((a, b) => a - b);

  console.log(`  Iterations:  ${iterations}`);
  console.log(`  5th pctl:    $${results[Math.floor(iterations * 0.05)]!.toFixed(2)}`);
  console.log(`  25th pctl:   $${results[Math.floor(iterations * 0.25)]!.toFixed(2)}`);
  console.log(`  Median:      $${results[Math.floor(iterations * 0.5)]!.toFixed(2)}`);
  console.log(`  75th pctl:   $${results[Math.floor(iterations * 0.75)]!.toFixed(2)}`);
  console.log(`  95th pctl:   $${results[Math.floor(iterations * 0.95)]!.toFixed(2)}`);
  console.log('');
}

function saveResultsToJSON(trades: Trade[], metrics: any, candles: Candle[]): string {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nfi-backtest-${ASSET}-${DAYS}d-${timestamp}.json`;
  const outputPath = path.join(outputDir, filename);

  fs.writeFileSync(outputPath, JSON.stringify({
    strategy: 'NostalgiaForInfinity',
    asset: ASSET,
    days: DAYS,
    preset: PRESET,
    config: { stakePct: STAKE_PCT, multiplier: MULTIPLIER, initialCapital: INITIAL_CAPITAL },
    period: {
      start: new Date(candles[0]!.timestamp * 1000).toISOString(),
      end: new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString(),
      candles: candles.length,
    },
    metrics,
    trades,
  }, null, 2));

  return outputPath;
}

main().catch(console.error);
