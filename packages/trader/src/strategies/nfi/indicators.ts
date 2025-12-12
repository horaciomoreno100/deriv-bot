/**
 * NFI Indicators Module
 *
 * All technical indicators used by NostalgiaForInfinity strategy.
 * Supports multi-timeframe analysis.
 */

import type { Candle } from '@deriv-bot/shared';
import type { NFIIndicators, NFIParams } from './nfi.types.js';

/**
 * Calculate RSI
 */
export function calculateRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // Initial average
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculate Stochastic RSI
 */
export function calculateStochRSI(
  closes: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kSmooth: number = 3,
  dSmooth: number = 3
): { k: number; d: number } | null {
  if (closes.length < rsiPeriod + stochPeriod + kSmooth + dSmooth) return null;

  // Calculate RSI series
  const rsiValues: number[] = [];
  for (let i = rsiPeriod; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const rsi = calculateRSI(slice, rsiPeriod);
    if (rsi !== null) rsiValues.push(rsi);
  }

  if (rsiValues.length < stochPeriod) return null;

  // Calculate Stochastic of RSI
  const recentRSI = rsiValues.slice(-stochPeriod);
  const minRSI = Math.min(...recentRSI);
  const maxRSI = Math.max(...recentRSI);
  const currentRSI = rsiValues[rsiValues.length - 1]!;

  const rawK = maxRSI === minRSI ? 50 : ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100;

  // Smooth K (using simple average for simplicity)
  const k = rawK; // Could implement SMA smoothing

  // D is SMA of K
  const d = k; // Simplified

  return { k, d };
}

/**
 * Calculate EMA
 */
export function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i]! - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate SMA
 */
export function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number; width: number } | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;

  const squaredDiffs = slice.map(v => Math.pow(v - middle, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const width = (upper - lower) / middle;

  return { upper, middle, lower, width };
}

/**
 * Calculate Elliott Wave Oscillator (EWO)
 * EWO = EMA(fast) - EMA(slow) normalized
 */
export function calculateEWO(
  closes: number[],
  fastPeriod: number = 5,
  slowPeriod: number = 35
): number | null {
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  if (fastEMA === null || slowEMA === null) return null;

  // Normalize by price
  const currentPrice = closes[closes.length - 1]!;
  return ((fastEMA - slowEMA) / currentPrice) * 100;
}

/**
 * Calculate Correlation Trend Indicator (CTI)
 * Measures correlation between price and time
 */
export function calculateCTI(closes: number[], period: number = 20): number | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const n = slice.length;

  // Time series: 1, 2, 3, ..., n
  const times = Array.from({ length: n }, (_, i) => i + 1);

  // Calculate means
  const meanPrice = slice.reduce((a, b) => a + b, 0) / n;
  const meanTime = times.reduce((a, b) => a + b, 0) / n;

  // Calculate correlation
  let numerator = 0;
  let denomPrices = 0;
  let denomTimes = 0;

  for (let i = 0; i < n; i++) {
    const priceDiff = slice[i]! - meanPrice;
    const timeDiff = times[i]! - meanTime;
    numerator += priceDiff * timeDiff;
    denomPrices += priceDiff * priceDiff;
    denomTimes += timeDiff * timeDiff;
  }

  const denom = Math.sqrt(denomPrices * denomTimes);
  if (denom === 0) return 0;

  return numerator / denom;
}

/**
 * Calculate Chaikin Money Flow (CMF)
 */
export function calculateCMF(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) return null;

  const slice = candles.slice(-period);

  let mfvSum = 0;
  let volumeSum = 0;

  for (const candle of slice) {
    const highLow = candle.high - candle.low;
    if (highLow === 0) continue;

    const volume = candle.volume ?? 0;
    const mfMultiplier = ((candle.close - candle.low) - (candle.high - candle.close)) / highLow;
    const mfVolume = mfMultiplier * volume;

    mfvSum += mfVolume;
    volumeSum += volume;
  }

  if (volumeSum === 0) return 0;
  return mfvSum / volumeSum;
}

/**
 * Calculate Money Flow Index (MFI)
 */
export function calculateMFI(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  let positiveFlow = 0;
  let negativeFlow = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;

    const typicalPrice = (current.high + current.low + current.close) / 3;
    const prevTypicalPrice = (previous.high + previous.low + previous.close) / 3;
    const volume = current.volume ?? 0;
    const rawMoneyFlow = typicalPrice * volume;

    if (typicalPrice > prevTypicalPrice) {
      positiveFlow += rawMoneyFlow;
    } else {
      negativeFlow += rawMoneyFlow;
    }
  }

  if (negativeFlow === 0) return 100;
  const moneyRatio = positiveFlow / negativeFlow;
  return 100 - 100 / (1 + moneyRatio);
}

/**
 * Calculate Williams %R
 */
export function calculateWilliamsR(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period) return null;

  const slice = candles.slice(-period);
  const highs = slice.map(c => c.high);
  const lows = slice.map(c => c.low);

  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const currentClose = candles[candles.length - 1]!.close;

  if (highestHigh === lowestLow) return -50;

  return ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
}

/**
 * Calculate CCI (Commodity Channel Index)
 */
export function calculateCCI(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) return null;

  const slice = candles.slice(-period);
  const typicalPrices = slice.map(c => (c.high + c.low + c.close) / 3);

  const meanTP = typicalPrices.reduce((a, b) => a + b, 0) / period;
  const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - meanTP), 0) / period;

  if (meanDeviation === 0) return 0;

  const currentTP = typicalPrices[typicalPrices.length - 1]!;
  return (currentTP - meanTP) / (0.015 * meanDeviation);
}

/**
 * Calculate Rate of Change (ROC)
 */
export function calculateROC(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;

  const current = closes[closes.length - 1]!;
  const previous = closes[closes.length - period - 1]!;

  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Calculate SSL Channel
 * SSL = Smoothed Simple Moving Average Channel
 */
export function calculateSSL(
  candles: Candle[],
  period: number = 10
): { up: number; down: number } | null {
  if (candles.length < period * 2) return null;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const smaHigh = calculateSMA(highs, period);
  const smaLow = calculateSMA(lows, period);
  const currentClose = closes[closes.length - 1]!;

  if (smaHigh === null || smaLow === null) return null;

  // Determine trend
  const hlv = currentClose > smaHigh ? 1 : currentClose < smaLow ? -1 : 0;

  return {
    up: hlv >= 0 ? smaHigh : smaLow,
    down: hlv >= 0 ? smaLow : smaHigh,
  };
}

/**
 * Detect pump (rapid price increase)
 */
export function detectPump(candles: Candle[], lookback: number = 12, threshold: number = 0.03): boolean {
  if (candles.length < lookback) return false;

  const recent = candles.slice(-lookback);
  const firstClose = recent[0]!.close;
  const lastClose = recent[recent.length - 1]!.close;

  const change = (lastClose - firstClose) / firstClose;
  return change > threshold;
}

/**
 * Detect dump (rapid price decrease)
 */
export function detectDump(candles: Candle[], lookback: number = 12, threshold: number = 0.03): boolean {
  if (candles.length < lookback) return false;

  const recent = candles.slice(-lookback);
  const firstClose = recent[0]!.close;
  const lastClose = recent[recent.length - 1]!.close;

  const change = (lastClose - firstClose) / firstClose;
  return change < -threshold;
}

/**
 * Resample candles to higher timeframe
 * Example: 5m candles -> 15m candles
 */
export function resampleCandles(candles: Candle[], factor: number): Candle[] {
  const resampled: Candle[] = [];

  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;

    const firstCandle = chunk[0]!;
    const lastCandle = chunk[chunk.length - 1]!;

    const open = firstCandle.open;
    const close = lastCandle.close;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    const volume = chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0);
    const timestamp = lastCandle.timestamp;

    resampled.push({
      open,
      high,
      low,
      close,
      volume,
      timestamp,
      asset: firstCandle.asset,
      timeframe: firstCandle.timeframe * factor,
    });
  }

  return resampled;
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  // Calculate ATR as SMA of TR
  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate ADX (Average Directional Index)
 * Simplified version - calculates directional movement and ADX
 */
function calculateADX(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period * 2) return null;

  // Calculate +DM and -DM
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;

    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
      minusDM.push(0);
    } else if (downMove > upMove && downMove > 0) {
      plusDM.push(0);
      minusDM.push(downMove);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    trueRanges.push(tr);
  }

  if (plusDM.length < period || minusDM.length < period) return null;

  // Smooth DM and TR using Wilder's smoothing
  let plusDMSmooth = plusDM.slice(-period).reduce((a, b) => a + b, 0) / period;
  let minusDMSmooth = minusDM.slice(-period).reduce((a, b) => a + b, 0) / period;
  let trSmooth = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;

  // Calculate DI+ and DI-
  const plusDI = trSmooth > 0 ? (plusDMSmooth / trSmooth) * 100 : 0;
  const minusDI = trSmooth > 0 ? (minusDMSmooth / trSmooth) * 100 : 0;

  // Calculate DX
  const diSum = plusDI + minusDI;
  const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

  // ADX is smoothed DX (simplified - using current DX as approximation)
  return dx;
}

/**
 * Calculate all NFI indicators from candle data
 */
export function calculateAllIndicators(
  candles5m: Candle[],
  params: NFIParams
): NFIIndicators | null {
  if (candles5m.length < 200) return null;

  const closes = candles5m.map(c => c.close);
  const currentCandle = candles5m[candles5m.length - 1]!;
  const prevCandle = candles5m[candles5m.length - 2]!;

  // Calculate 5m indicators
  const rsi_3 = calculateRSI(closes, 3);
  const rsi_14 = calculateRSI(closes, 14);
  const stochRSI = calculateStochRSI(closes);
  const bb = calculateBollingerBands(closes, params.bb.period, params.bb.stdDev);
  const ewo = calculateEWO(closes, params.ewo.period_fast, params.ewo.period_slow);
  const cti = calculateCTI(closes);
  const cmf = calculateCMF(candles5m);
  const mfi = calculateMFI(candles5m);
  const williamsR = calculateWilliamsR(candles5m);
  const cci = calculateCCI(candles5m);

  // EMAs
  const ema_12 = calculateEMA(closes, 12);
  const ema_26 = calculateEMA(closes, 26);
  const ema_50 = calculateEMA(closes, 50);
  const ema_200 = calculateEMA(closes, 200);
  const sma_9 = calculateSMA(closes, 9);
  const sma_200 = calculateSMA(closes, 200);

  // ROC
  const roc_2 = calculateROC(closes, 2);
  const roc_9 = calculateROC(closes, 9);

  // ATR and ADX
  const atr = calculateATR(candles5m, 14);
  const adx = calculateADX(candles5m, 14);

  if (
    rsi_3 === null || rsi_14 === null || bb === null ||
    ema_12 === null || ema_26 === null || ema_50 === null || ema_200 === null ||
    sma_9 === null || sma_200 === null || atr === null || adx === null
  ) {
    return null;
  }

  // Calculate RSI change
  const prevCloses = closes.slice(0, -1);
  const prevRsi3 = calculateRSI(prevCloses, 3);
  const rsi_3_change = prevRsi3 !== null ? rsi_3 - prevRsi3 : 0;

  // BB delta and close delta
  const bb_delta = bb.middle - bb.lower;
  const close_delta = currentCandle.close - prevCandle.close;
  const tail = Math.abs(currentCandle.close - currentCandle.low);

  // Resample to higher timeframes
  const candles15m = resampleCandles(candles5m, 3);
  const candles1h = resampleCandles(candles5m, 12);
  const candles4h = resampleCandles(candles5m, 48);
  const candles1d = resampleCandles(candles5m, 288);

  // 15m indicators
  const closes15m = candles15m.map(c => c.close);
  const rsi_3_15m = calculateRSI(closes15m, 3) ?? 50;
  const rsi_14_15m = calculateRSI(closes15m, 14) ?? 50;
  const ema_200_15m = calculateEMA(closes15m, 200) ?? currentCandle.close;
  const cti_15m = calculateCTI(closes15m) ?? 0;
  const cmf_15m = calculateCMF(candles15m) ?? 0;

  // 1h indicators
  const closes1h = candles1h.map(c => c.close);
  const rsi_3_1h = calculateRSI(closes1h, 3) ?? 50;
  const rsi_14_1h = calculateRSI(closes1h, 14) ?? 50;
  const ema_50_1h = calculateEMA(closes1h, 50) ?? currentCandle.close;
  const ema_200_1h = calculateEMA(closes1h, 200) ?? currentCandle.close;
  const cti_1h = calculateCTI(closes1h) ?? 0;
  const cmf_1h = calculateCMF(candles1h) ?? 0;
  const ssl_1h = calculateSSL(candles1h) ?? { up: currentCandle.close, down: currentCandle.close };

  // 4h indicators
  const closes4h = candles4h.map(c => c.close);
  const rsi_14_4h = calculateRSI(closes4h, 14) ?? 50;
  const ema_200_4h = calculateEMA(closes4h, 200) ?? currentCandle.close;
  const cti_4h = calculateCTI(closes4h) ?? 0;
  const roc_9_4h = calculateROC(closes4h, 9) ?? 0;

  // 1d indicators
  const closes1d = candles1d.map(c => c.close);
  const rsi_14_1d = calculateRSI(closes1d, 14) ?? 50;
  const ema_200_1d = calculateEMA(closes1d, 200) ?? currentCandle.close;
  const cti_1d = calculateCTI(closes1d) ?? 0;

  // Trend detection
  const is_downtrend = currentCandle.close < ema_200 && ema_50 < ema_200;
  const is_uptrend = currentCandle.close > ema_200 && ema_50 > ema_200;

  // Pump/dump detection
  const pump_detected = detectPump(candles5m);
  const dump_detected = detectDump(candles5m);

  return {
    // 5m
    rsi_3,
    rsi_14,
    rsi_3_change,
    stoch_rsi_k: stochRSI?.k ?? 50,
    stoch_rsi_d: stochRSI?.d ?? 50,
    ema_12,
    ema_26,
    ema_50,
    ema_200,
    sma_9,
    sma_200,
    bb_upper: bb.upper,
    bb_middle: bb.middle,
    bb_lower: bb.lower,
    bb_width: bb.width,
    bb_delta,
    close_delta,
    tail,
    ewo: ewo ?? 0,
    cti: cti ?? 0,
    cmf: cmf ?? 0,
    mfi: mfi ?? 50,
    williams_r: williamsR ?? -50,
    cci: cci ?? 0,
    roc_2: roc_2 ?? 0,
    roc_9: roc_9 ?? 0,
    atr: atr,
    adx: adx,

    // 15m
    rsi_3_15m,
    rsi_14_15m,
    ema_200_15m,
    cti_15m,
    cmf_15m,

    // 1h
    rsi_3_1h,
    rsi_14_1h,
    ema_50_1h,
    ema_200_1h,
    cti_1h,
    cmf_1h,
    ssl_up_1h: ssl_1h.up,
    ssl_down_1h: ssl_1h.down,

    // 4h
    rsi_14_4h,
    ema_200_4h,
    cti_4h,
    roc_9_4h,

    // 1d
    rsi_14_1d,
    ema_200_1d,
    cti_1d,

    // Derived
    is_downtrend,
    is_uptrend,
    pump_detected,
    dump_detected,
  };
}
