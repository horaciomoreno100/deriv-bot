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
export function createCryptoScalpV2EntryFn(
  candles: Candle[],
  params: Partial<CryptoScalpParams> = {}
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
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

    if (longScore.score >= 3) {
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

    if (shortScore.score >= 3) {
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

