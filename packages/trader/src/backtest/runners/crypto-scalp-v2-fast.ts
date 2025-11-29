/**
 * CryptoScalp v2 Fast Backtester Helper
 *
 * Optimized entry function for CryptoScalp v2 strategy using FastBacktester.
 * Pre-calculates VWAP and implements the scoring logic from CryptoScalp v2.
 */

import type { Candle } from '@deriv-bot/shared';
import type { FastEntrySignal } from './fast-backtester.js';
import type {
  CryptoScalpParams,
  VWAPBias,
  BBZone,
  TrendStrength,
} from '../../strategies/crypto-scalp/crypto-scalp.types.js';
import { DEFAULT_CRYPTO_SCALP_PARAMS } from '../../strategies/crypto-scalp/crypto-scalp.params.js';
import { calculateVWAPSeries } from '../../strategies/crypto-scalp/indicators/vwap.js';
import { classifyTrendStrength, isTrending } from '../../strategies/crypto-scalp/indicators/adx.js';
import { classifyBBZone } from '../../strategies/crypto-scalp/indicators/bollinger.js';

/**
 * Calculate EMA
 */
function calculateEMA(values: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      result.push(values[i]!);
    } else if (i < period) {
      // Use SMA for initial period
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += values[j]!;
      }
      result.push(sum / (i + 1));
    } else {
      const ema = (values[i]! - result[i - 1]!) * multiplier + result[i - 1]!;
      result.push(ema);
    }
  }

  return result;
}

/**
 * Resample 1m candles to 15m
 */
function resampleTo15m(candles: Candle[]): Candle[] {
  const resampled: Candle[] = [];
  const intervalSeconds = 15 * 60; // 15 minutes

  for (const candle of candles) {
    const slotStartSeconds = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;

    // Find or create resampled candle for this slot
    let resampledCandle = resampled.find(c => c.timestamp === slotStartSeconds);

    if (!resampledCandle) {
      // New slot
      resampledCandle = {
        timestamp: slotStartSeconds,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
      resampled.push(resampledCandle);
    } else {
      // Update existing slot
      resampledCandle.high = Math.max(resampledCandle.high, candle.high);
      resampledCandle.low = Math.min(resampledCandle.low, candle.low);
      resampledCandle.close = candle.close; // Last close
      resampledCandle.volume = (resampledCandle.volume ?? 0) + (candle.volume ?? 0);
    }
  }

  return resampled.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Pre-calculate 15m trend direction mapping
 * Returns array where index corresponds to 1m candle index, value is trend direction
 */
function precalculate15mTrend(
  candles1m: Candle[],
  candles15m: Candle[],
  ema50_15m: number[]
): ('UP' | 'DOWN' | 'NEUTRAL')[] {
  const trendMap: ('UP' | 'DOWN' | 'NEUTRAL')[] = [];
  const intervalSeconds = 15 * 60;

  // Create mapping: 15m timestamp -> index in 15m array
  const timestampToIndex15m = new Map<number, number>();
  candles15m.forEach((c, i) => {
    timestampToIndex15m.set(c.timestamp, i);
  });

  // For each 1m candle, find its 15m trend
  for (let i = 0; i < candles1m.length; i++) {
    const candle1m = candles1m[i]!;
    const slotStartSeconds = Math.floor(candle1m.timestamp / intervalSeconds) * intervalSeconds;
    
    const index15m = timestampToIndex15m.get(slotStartSeconds);
    
    if (index15m === undefined || index15m < 0 || index15m >= ema50_15m.length || index15m >= candles15m.length) {
      trendMap[i] = 'NEUTRAL';
      continue;
    }

    const ema50 = ema50_15m[index15m]!;
    const price15m = candles15m[index15m]!.close;

    // Compare current price with EMA 50
    const diff = ((price15m - ema50) / ema50) * 100;

    // Use larger threshold (0.1%) to avoid too many NEUTRAL
    if (diff > 0.1) {
      trendMap[i] = 'UP'; // Price > 0.1% above EMA = uptrend
    } else if (diff < -0.1) {
      trendMap[i] = 'DOWN'; // Price < 0.1% below EMA = downtrend
    } else {
      trendMap[i] = 'NEUTRAL';
    }
  }

  return trendMap;
}

/**
 * Pre-calculated VWAP data
 */
interface VWAPData {
  vwap: number[];
  bias: VWAPBias[];
  distancePercent: number[];
}

/**
 * Pre-calculated volume data
 */
interface VolumeData {
  volumeSMA: number[];
  volumeRatio: number[];
}

/**
 * CryptoScalp v2 Fast Entry Function Factory
 *
 * Creates an optimized entry function that implements CryptoScalp v2 logic
 * using pre-calculated indicators.
 */
export interface CryptoScalpV2EntryFnOptions {
  /** Enable MTF filter (15m EMA 50 trend bias) */
  enableMTF?: boolean;
}

export function createCryptoScalpV2EntryFn(
  candles: Candle[],
  params: Partial<CryptoScalpParams> = {},
  options: CryptoScalpV2EntryFnOptions = {}
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
  const { enableMTF = true } = options;
  // Store candles reference for price access
  const candlesRef = candles;
  const fullParams = { ...DEFAULT_CRYPTO_SCALP_PARAMS, ...params };

  // Pre-calculate VWAP series ONCE
  const vwapSeries = calculateVWAPSeries(candles, fullParams.vwap);
  const vwapData: VWAPData = {
    vwap: [],
    bias: [],
    distancePercent: [],
  };

  for (let i = 0; i < candles.length; i++) {
    const vwapResult = vwapSeries[i];
    if (vwapResult) {
      vwapData.vwap[i] = vwapResult.vwap;
      vwapData.bias[i] = vwapResult.bias;
      vwapData.distancePercent[i] = vwapResult.distancePercent;
    } else {
      vwapData.vwap[i] = candles[i]!.close;
      vwapData.bias[i] = 'NEUTRAL';
      vwapData.distancePercent[i] = 0;
    }
  }

  // Pre-calculate volume data ONCE
  const volumeData = precalculateVolume(candles, fullParams.volume.smaPeriod);

  // Pre-calculate 15m EMA 50 for MTF filter (only if enabled)
  let trend15mMap: ('UP' | 'DOWN' | 'NEUTRAL')[] = [];
  
  if (enableMTF) {
    const candles15m = resampleTo15m(candles);
    const closes15m = candles15m.map(c => c.close);
    const ema50_15m = calculateEMA(closes15m, 50);
    
    // Pre-calculate 15m trend direction for each 1m candle
    trend15mMap = precalculate15mTrend(candles, candles15m, ema50_15m);
    
    // Debug: Count trend directions
    const trendCounts = { UP: 0, DOWN: 0, NEUTRAL: 0 };
    let validTrends = 0;
    for (let i = 50; i < Math.min(5000, trend15mMap.length); i++) {
      const trend = trend15mMap[i];
      if (trend) {
        trendCounts[trend]++;
        validTrends++;
      }
    }
    const upPct = validTrends > 0 ? (trendCounts.UP / validTrends * 100).toFixed(1) : '0';
    const downPct = validTrends > 0 ? (trendCounts.DOWN / validTrends * 100).toFixed(1) : '0';
    const neutralPct = validTrends > 0 ? (trendCounts.NEUTRAL / validTrends * 100).toFixed(1) : '0';
    console.log(`[MTF] Enabled - Trend distribution: UP=${upPct}%, DOWN=${downPct}%, NEUTRAL=${neutralPct}%`);
  } else {
    console.log(`[MTF] Disabled`);
  }

  return (index: number, indicators: Record<string, number | boolean>) => {
    // Get price from candle (not from indicators)
    const candle = candlesRef[index];
    if (!candle) return null;
    const price = candle.close;

    // Get indicator values
    const rsi = indicators.rsi as number;
    const adx = indicators.adx as number;
    const plusDI = indicators.plusDI as number;
    const minusDI = indicators.minusDI as number;
    const atr = indicators.atr as number;
    const bbUpper = indicators.bbUpper as number;
    const bbMiddle = indicators.bbMiddle as number;
    const bbLower = indicators.bbLower as number;

    if (
      typeof rsi !== 'number' ||
      typeof adx !== 'number' ||
      typeof plusDI !== 'number' ||
      typeof minusDI !== 'number' ||
      typeof atr !== 'number' ||
      typeof bbUpper !== 'number' ||
      typeof bbMiddle !== 'number' ||
      typeof bbLower !== 'number'
    ) {
      return null;
    }

    // Get VWAP data
    const vwap = vwapData.vwap[index] ?? price;
    const vwapBias = vwapData.bias[index] ?? 'NEUTRAL';
    const volumeRatio = volumeData.volumeRatio[index] ?? 1;

    // Calculate BB Zone
    const bbWidth = bbUpper - bbLower;
    const percentB = bbWidth > 0 ? (price - bbLower) / bbWidth : 0.5;
    const bbZone = classifyBBZone(percentB, fullParams.bb.extremeThreshold);

    // Calculate trend strength
    const trendStrength = classifyTrendStrength(adx, fullParams.adx);

    // Get 15m trend direction for MTF filter (pre-calculated)
    const trend15m = enableMTF ? (trend15mMap[index] ?? 'NEUTRAL') : 'NEUTRAL';
    
    // Adjust score thresholds based on 15m trend (only if MTF enabled)
    // If 15m is up: easier to go LONG (score 2), harder to go SHORT (score 4)
    // If 15m is down: easier to go SHORT (score 2), harder to go LONG (score 4)
    // If neutral or MTF disabled: use default (score 3)
    const longScoreThreshold = enableMTF 
      ? (trend15m === 'UP' ? 2 : trend15m === 'DOWN' ? 4 : 3)
      : 3;
    const shortScoreThreshold = enableMTF
      ? (trend15m === 'DOWN' ? 2 : trend15m === 'UP' ? 4 : 3)
      : 3;

    // Check LONG conditions
    const longScore = checkLongConditions(
      {
        rsi,
        bbZone,
        vwapBias,
        adx,
        plusDI,
        minusDI,
        trendStrength,
        volumeRatio,
        price,
        vwap,
      },
      fullParams
    );

    if (longScore.score >= longScoreThreshold) {
      return {
        direction: 'CALL',
        price: 0, // Will use candle close
      };
    }

    // Check SHORT conditions
    const shortScore = checkShortConditions(
      {
        rsi,
        bbZone,
        vwapBias,
        adx,
        plusDI,
        minusDI,
        trendStrength,
        volumeRatio,
        price,
        vwap,
      },
      fullParams
    );

    if (shortScore.score >= shortScoreThreshold) {
      return {
        direction: 'PUT',
        price: 0, // Will use candle close
      };
    }

    return null;
  };
}

/**
 * Check LONG entry conditions (from CryptoScalp v2)
 */
function checkLongConditions(
  data: {
    rsi: number;
    bbZone: BBZone;
    vwapBias: VWAPBias;
    adx: number;
    plusDI: number;
    minusDI: number;
    trendStrength: TrendStrength;
    volumeRatio: number;
    price: number;
    vwap: number;
  },
  params: CryptoScalpParams
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. RSI oversold
  if (data.rsi <= params.rsi.oversoldThreshold) {
    score += 2;
    reasons.push(`RSI oversold (${data.rsi.toFixed(1)})`);
  } else if (data.rsi <= params.rsi.oversoldThreshold + 5) {
    score += 1;
    reasons.push(`RSI near oversold (${data.rsi.toFixed(1)})`);
  }

  // 2. Bollinger Band position
  if (data.bbZone === 'LOWER_EXTREME') {
    score += 2;
    reasons.push('BB lower extreme');
  } else if (data.bbZone === 'LOWER') {
    score += 1;
    reasons.push('BB lower zone');
  }

  // 3. VWAP bias
  if (params.vwap.useAsFilter) {
    if (data.vwapBias === 'BULLISH') {
      score += 1;
      reasons.push('VWAP bullish');
    } else if (data.vwapBias === 'BEARISH') {
      score -= 1; // Counter-trend, reduce confidence
    }
  }

  // 4. ADX trend filter
  if (params.adx.useAsFilter) {
    const adxResult = {
      adx: data.adx,
      plusDI: data.plusDI,
      minusDI: data.minusDI,
      trendStrength: data.trendStrength,
      trendDirection: 'NEUTRAL' as const,
    };

    // Mean reversion works better in ranging markets
    if (!isTrending(adxResult, 'MODERATE')) {
      score += 1;
      reasons.push('Ranging market');
    }

    // But also check DI for potential reversal
    if (data.minusDI > data.plusDI + 10) {
      score += 1;
      reasons.push('Strong -DI (reversal potential)');
    }
  }

  // 5. Volume confirmation
  if (params.volume.enabled) {
    if (data.volumeRatio >= params.volume.highVolumeThreshold) {
      score += 1;
      reasons.push('High volume');
    } else if (data.volumeRatio < params.volume.minRatioForEntry) {
      score -= 1;
      reasons.push('Low volume');
    }
  }

  return { score, reasons };
}

/**
 * Check SHORT entry conditions (from CryptoScalp v2)
 */
function checkShortConditions(
  data: {
    rsi: number;
    bbZone: BBZone;
    vwapBias: VWAPBias;
    adx: number;
    plusDI: number;
    minusDI: number;
    trendStrength: TrendStrength;
    volumeRatio: number;
    price: number;
    vwap: number;
  },
  params: CryptoScalpParams
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. RSI overbought
  if (data.rsi >= params.rsi.overboughtThreshold) {
    score += 2;
    reasons.push(`RSI overbought (${data.rsi.toFixed(1)})`);
  } else if (data.rsi >= params.rsi.overboughtThreshold - 5) {
    score += 1;
    reasons.push(`RSI near overbought (${data.rsi.toFixed(1)})`);
  }

  // 2. Bollinger Band position
  if (data.bbZone === 'UPPER_EXTREME') {
    score += 2;
    reasons.push('BB upper extreme');
  } else if (data.bbZone === 'UPPER') {
    score += 1;
    reasons.push('BB upper zone');
  }

  // 3. VWAP bias
  if (params.vwap.useAsFilter) {
    if (data.vwapBias === 'BEARISH') {
      score += 1;
      reasons.push('VWAP bearish');
    } else if (data.vwapBias === 'BULLISH') {
      score -= 1; // Counter-trend
    }
  }

  // 4. ADX trend filter
  if (params.adx.useAsFilter) {
    const adxResult = {
      adx: data.adx,
      plusDI: data.plusDI,
      minusDI: data.minusDI,
      trendStrength: data.trendStrength,
      trendDirection: 'NEUTRAL' as const,
    };

    // Mean reversion works better in ranging markets
    if (!isTrending(adxResult, 'MODERATE')) {
      score += 1;
      reasons.push('Ranging market');
    }

    // But also check DI for potential reversal
    if (data.plusDI > data.minusDI + 10) {
      score += 1;
      reasons.push('Strong +DI (reversal potential)');
    }
  }

  // 5. Volume confirmation
  if (params.volume.enabled) {
    if (data.volumeRatio >= params.volume.highVolumeThreshold) {
      score += 1;
      reasons.push('High volume');
    } else if (data.volumeRatio < params.volume.minRatioForEntry) {
      score -= 1;
      reasons.push('Low volume');
    }
  }

  return { score, reasons };
}

/**
 * Pre-calculate volume data
 */
function precalculateVolume(candles: Candle[], smaPeriod: number): VolumeData {
  const volumeSMA: number[] = [];
  const volumeRatio: number[] = [];

  // Calculate volume SMA
  for (let i = 0; i < candles.length; i++) {
    if (i < smaPeriod - 1) {
      volumeSMA[i] = candles[i]?.volume ?? 1;
      volumeRatio[i] = 1;
      continue;
    }

    let sum = 0;
    for (let j = i - smaPeriod + 1; j <= i; j++) {
      sum += candles[j]?.volume ?? 1;
    }
    const sma = sum / smaPeriod;
    volumeSMA[i] = sma;

    const currentVolume = candles[i]?.volume ?? 1;
    volumeRatio[i] = sma > 0 ? currentVolume / sma : 1;
  }

  return { volumeSMA, volumeRatio };
}

