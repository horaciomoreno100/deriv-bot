/**
 * VWAP (Volume Weighted Average Price) Indicator
 *
 * Calculates VWAP and provides bias analysis for institutional-level
 * price direction assessment.
 */

import type { Candle } from '@deriv-bot/shared';
import type { VWAPBias, VWAPConfig } from '../crypto-scalp.types.js';

/**
 * VWAP calculation result
 */
export interface VWAPResult {
  vwap: number;
  bias: VWAPBias;
  distancePercent: number;
}

/**
 * Calculate VWAP for a series of candles
 *
 * VWAP = Σ(Typical Price × Volume) / Σ(Volume)
 * where Typical Price = (High + Low + Close) / 3
 */
export function calculateVWAP(
  candles: Candle[],
  config: VWAPConfig
): VWAPResult | null {
  if (candles.length < config.periods) {
    return null;
  }

  // Use last N periods
  const relevantCandles = candles.slice(-config.periods);

  let sumTPV = 0; // Sum of (Typical Price × Volume)
  let sumVolume = 0;

  for (const candle of relevantCandles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume ?? 1; // Default to 1 if no volume data
    sumTPV += typicalPrice * volume;
    sumVolume += volume;
  }

  if (sumVolume === 0) {
    return null;
  }

  const vwap = sumTPV / sumVolume;
  const currentPrice = relevantCandles[relevantCandles.length - 1]!.close;
  const distancePercent = ((currentPrice - vwap) / vwap) * 100;

  // Determine bias
  let bias: VWAPBias;
  if (distancePercent > config.biasThreshold) {
    bias = 'BULLISH'; // Price above VWAP = bullish
  } else if (distancePercent < -config.biasThreshold) {
    bias = 'BEARISH'; // Price below VWAP = bearish
  } else {
    bias = 'NEUTRAL';
  }

  return {
    vwap,
    bias,
    distancePercent,
  };
}

/**
 * Calculate rolling VWAP for an array of candles
 * Returns VWAP value for each candle starting from index (periods-1)
 */
export function calculateVWAPSeries(
  candles: Candle[],
  config: VWAPConfig
): (VWAPResult | null)[] {
  const results: (VWAPResult | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < config.periods - 1) {
      results.push(null);
    } else {
      const windowCandles = candles.slice(i - config.periods + 1, i + 1);
      results.push(calculateVWAP(windowCandles, config));
    }
  }

  return results;
}

/**
 * Get VWAP standard deviation bands
 * Used for identifying potential support/resistance levels
 */
export function calculateVWAPBands(
  candles: Candle[],
  config: VWAPConfig,
  stdDevMultiplier: number = 2
): { vwap: number; upper: number; lower: number } | null {
  const vwapResult = calculateVWAP(candles, config);
  if (!vwapResult) return null;

  const relevantCandles = candles.slice(-config.periods);

  // Calculate standard deviation of typical prices from VWAP
  let sumSquaredDiff = 0;
  for (const candle of relevantCandles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    sumSquaredDiff += Math.pow(typicalPrice - vwapResult.vwap, 2);
  }

  const stdDev = Math.sqrt(sumSquaredDiff / relevantCandles.length);

  return {
    vwap: vwapResult.vwap,
    upper: vwapResult.vwap + stdDev * stdDevMultiplier,
    lower: vwapResult.vwap - stdDev * stdDevMultiplier,
  };
}

/**
 * Analyze VWAP trend (rising or falling)
 */
export function analyzeVWAPTrend(
  candles: Candle[],
  config: VWAPConfig,
  lookbackPeriods: number = 5
): 'RISING' | 'FALLING' | 'FLAT' | null {
  if (candles.length < config.periods + lookbackPeriods) {
    return null;
  }

  const vwapValues: number[] = [];

  for (let i = 0; i < lookbackPeriods; i++) {
    const endIndex = candles.length - i;
    const windowCandles = candles.slice(endIndex - config.periods, endIndex);
    const result = calculateVWAP(windowCandles, config);
    if (result) {
      vwapValues.unshift(result.vwap);
    }
  }

  if (vwapValues.length < 2) return null;

  // Calculate slope
  const firstVWAP = vwapValues[0]!;
  const lastVWAP = vwapValues[vwapValues.length - 1]!;
  const changePercent = ((lastVWAP - firstVWAP) / firstVWAP) * 100;

  const threshold = 0.05; // 0.05% threshold for flat
  if (changePercent > threshold) return 'RISING';
  if (changePercent < -threshold) return 'FALLING';
  return 'FLAT';
}
