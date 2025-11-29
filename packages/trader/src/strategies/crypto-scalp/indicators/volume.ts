/**
 * Volume Indicator Module
 *
 * Provides volume analysis for confirming price movements
 * and detecting potential reversals.
 */

import type { Candle } from '@deriv-bot/shared';
import type { VolumeConfig } from '../crypto-scalp.types.js';

/**
 * Volume analysis result
 */
export interface VolumeResult {
  currentVolume: number;
  volumeSMA: number;
  volumeRatio: number;
  isHighVolume: boolean;
  isLowVolume: boolean;
  volumeTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
}

/**
 * Calculate volume SMA
 */
function calculateVolumeSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;

  const volumes = candles.slice(-period).map((c) => c.volume ?? 0);
  return volumes.reduce((a, b) => a + b, 0) / period;
}

/**
 * Analyze volume for the current candle
 */
export function analyzeVolume(
  candles: Candle[],
  config: VolumeConfig
): VolumeResult | null {
  if (candles.length < config.smaPeriod) {
    return null;
  }

  const currentCandle = candles[candles.length - 1]!;
  const currentVolume = currentCandle.volume ?? 0;

  // Calculate volume SMA
  const volumeSMA = calculateVolumeSMA(candles, config.smaPeriod);
  if (volumeSMA === null || volumeSMA === 0) {
    return null;
  }

  // Calculate ratio
  const volumeRatio = currentVolume / volumeSMA;

  // Determine volume levels
  const isHighVolume = volumeRatio >= config.highVolumeThreshold;
  const isLowVolume = volumeRatio < 0.5;

  // Analyze volume trend
  const volumeTrend = analyzeVolumeTrend(candles, config.smaPeriod);

  return {
    currentVolume,
    volumeSMA,
    volumeRatio,
    isHighVolume,
    isLowVolume,
    volumeTrend,
  };
}

/**
 * Analyze volume trend over recent bars
 */
function analyzeVolumeTrend(
  candles: Candle[],
  lookback: number = 5
): 'INCREASING' | 'DECREASING' | 'STABLE' {
  if (candles.length < lookback) {
    return 'STABLE';
  }

  const recentVolumes = candles.slice(-lookback).map((c) => c.volume ?? 0);

  // Simple linear regression slope
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  const n = recentVolumes.length;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recentVolumes[i]!;
    sumXY += i * recentVolumes[i]!;
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgVolume = sumY / n;
  const normalizedSlope = avgVolume > 0 ? slope / avgVolume : 0;

  if (normalizedSlope > 0.1) return 'INCREASING';
  if (normalizedSlope < -0.1) return 'DECREASING';
  return 'STABLE';
}

/**
 * Check if volume confirms price movement
 */
export function volumeConfirmsPrice(
  candles: Candle[],
  config: VolumeConfig,
  priceDirection: 'UP' | 'DOWN'
): boolean {
  if (!config.enabled) return true; // If volume filter disabled, always confirm

  const result = analyzeVolume(candles, config);
  if (!result) return false;

  // Require above-average volume for confirmation
  if (result.volumeRatio < config.minRatioForEntry) {
    return false;
  }

  const currentCandle = candles[candles.length - 1]!;
  const priceChange = currentCandle.close - currentCandle.open;

  // Volume should align with price direction
  if (priceDirection === 'UP' && priceChange > 0 && result.isHighVolume) {
    return true;
  }
  if (priceDirection === 'DOWN' && priceChange < 0 && result.isHighVolume) {
    return true;
  }

  // Average volume is acceptable if not requiring high volume
  return result.volumeRatio >= config.minRatioForEntry;
}

/**
 * Calculate volume series for backtesting
 */
export function calculateVolumeSeries(
  candles: Candle[],
  config: VolumeConfig
): (VolumeResult | null)[] {
  const results: (VolumeResult | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < config.smaPeriod - 1) {
      results.push(null);
    } else {
      const windowCandles = candles.slice(0, i + 1);
      results.push(analyzeVolume(windowCandles, config));
    }
  }

  return results;
}

/**
 * Detect volume spike (potential reversal)
 */
export function detectVolumeSpike(
  candles: Candle[],
  config: VolumeConfig,
  spikeThreshold: number = 2.5
): boolean {
  const result = analyzeVolume(candles, config);
  if (!result) return false;

  return result.volumeRatio >= spikeThreshold;
}

/**
 * Detect volume divergence with price
 * (Price making new high/low but volume decreasing)
 */
export function detectVolumeDivergence(
  candles: Candle[],
  lookback: number = 10
): 'BEARISH_DIVERGENCE' | 'BULLISH_DIVERGENCE' | null {
  if (candles.length < lookback + 1) return null;

  const recentCandles = candles.slice(-lookback);
  const currentCandle = candles[candles.length - 1]!;

  // Find highest high and lowest low in lookback period
  const highestHigh = Math.max(...recentCandles.map((c) => c.high));
  const lowestLow = Math.min(...recentCandles.map((c) => c.low));

  // Get volume at those points
  const highestHighCandle = recentCandles.find((c) => c.high === highestHigh);
  const lowestLowCandle = recentCandles.find((c) => c.low === lowestLow);

  const currentVolume = currentCandle.volume ?? 0;
  const highVolume = highestHighCandle?.volume ?? 0;
  const lowVolume = lowestLowCandle?.volume ?? 0;

  // Bearish divergence: new high with lower volume
  if (currentCandle.high >= highestHigh && currentVolume < highVolume * 0.7) {
    return 'BEARISH_DIVERGENCE';
  }

  // Bullish divergence: new low with lower volume
  if (currentCandle.low <= lowestLow && currentVolume < lowVolume * 0.7) {
    return 'BULLISH_DIVERGENCE';
  }

  return null;
}

/**
 * Calculate On-Balance Volume (OBV) simple version
 */
export function calculateOBV(candles: Candle[]): number {
  if (candles.length < 2) return 0;

  let obv = 0;

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    const volume = current.volume ?? 0;

    if (current.close > previous.close) {
      obv += volume;
    } else if (current.close < previous.close) {
      obv -= volume;
    }
    // If equal, OBV stays the same
  }

  return obv;
}

/**
 * Calculate Money Flow Index (simplified)
 */
export function calculateMFI(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  let positiveFlow = 0;
  let negativeFlow = 0;

  const recentCandles = candles.slice(-(period + 1));

  for (let i = 1; i < recentCandles.length; i++) {
    const current = recentCandles[i]!;
    const previous = recentCandles[i - 1]!;

    const typicalPrice = (current.high + current.low + current.close) / 3;
    const prevTypicalPrice = (previous.high + previous.low + previous.close) / 3;
    const rawMoneyFlow = typicalPrice * (current.volume ?? 0);

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
