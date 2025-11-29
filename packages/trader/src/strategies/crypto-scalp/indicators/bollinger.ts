/**
 * Bollinger Bands Indicator
 *
 * Measures price volatility and identifies overbought/oversold conditions.
 * Bands expand during high volatility and contract during low volatility.
 */

import type { Candle } from '@deriv-bot/shared';
import type { BBZone, BBConfig } from '../crypto-scalp.types.js';

/**
 * Bollinger Bands calculation result
 */
export interface BBResult {
  upper: number;
  middle: number;
  lower: number;
  width: number;
  widthPercent: number;
  percentB: number;
  zone: BBZone;
  isSqueeze: boolean;
}

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;

  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate Standard Deviation
 */
function calculateStdDev(values: number[], period: number, mean?: number): number | null {
  if (values.length < period) return null;

  const slice = values.slice(-period);
  const avg = mean ?? (slice.reduce((a, b) => a + b, 0) / period);

  const squaredDiffs = slice.map((v) => Math.pow(v - avg, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;

  return Math.sqrt(variance);
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  candles: Candle[],
  config: BBConfig
): BBResult | null {
  if (candles.length < config.period) {
    return null;
  }

  // Get close prices
  const closes = candles.map((c) => c.close);

  // Calculate SMA (middle band)
  const middle = calculateSMA(closes, config.period);
  if (middle === null) return null;

  // Calculate standard deviation
  const stdDev = calculateStdDev(closes, config.period, middle);
  if (stdDev === null) return null;

  // Calculate upper and lower bands
  const upper = middle + stdDev * config.stdDev;
  const lower = middle - stdDev * config.stdDev;

  // Calculate width
  const width = upper - lower;
  const widthPercent = (width / middle) * 100;

  // Calculate %B (position within bands)
  const currentPrice = candles[candles.length - 1]!.close;
  const percentB = width > 0 ? (currentPrice - lower) / width : 0.5;

  // Determine zone
  const zone = classifyBBZone(percentB, config.extremeThreshold);

  // Note: isSqueeze is set to false here to avoid recursion
  // Use detectSqueeze separately when needed
  const isSqueeze = false;

  return {
    upper,
    middle,
    lower,
    width,
    widthPercent,
    percentB,
    zone,
    isSqueeze,
  };
}

/**
 * Classify position within Bollinger Bands
 */
export function classifyBBZone(percentB: number, extremeThreshold: number): BBZone {
  // percentB: 0 = at lower band, 1 = at upper band
  const extremeUpper = 1 + extremeThreshold / 100;
  const extremeLower = -extremeThreshold / 100;

  if (percentB >= extremeUpper) return 'UPPER_EXTREME';
  if (percentB > 0.7) return 'UPPER';
  if (percentB >= 0.3 && percentB <= 0.7) return 'MIDDLE';
  if (percentB > extremeLower) return 'LOWER';
  return 'LOWER_EXTREME';
}

/**
 * Calculate BB width percent (helper to avoid recursion)
 */
function calculateBBWidthPercent(candles: Candle[], config: BBConfig): number | null {
  if (candles.length < config.period) return null;

  const closes = candles.map((c) => c.close);
  const slice = closes.slice(-config.period);
  const middle = slice.reduce((a, b) => a + b, 0) / config.period;

  const squaredDiffs = slice.map((v) => Math.pow(v - middle, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / config.period;
  const stdDevVal = Math.sqrt(variance);

  const upper = middle + stdDevVal * config.stdDev;
  const lower = middle - stdDevVal * config.stdDev;
  const width = upper - lower;

  return (width / middle) * 100;
}

/**
 * Detect Bollinger Band squeeze (low volatility)
 */
export function detectSqueeze(
  candles: Candle[],
  config: BBConfig,
  lookback: number = 20
): boolean {
  if (candles.length < config.period + lookback) {
    return false;
  }

  // Calculate current width using helper
  const currentWidth = calculateBBWidthPercent(candles, config);
  if (currentWidth === null) return false;

  // Calculate historical widths
  const historicalWidths: number[] = [];
  for (let i = lookback; i > 0; i--) {
    const historicalCandles = candles.slice(0, -i);
    const width = calculateBBWidthPercent(historicalCandles, config);
    if (width !== null) {
      historicalWidths.push(width);
    }
  }

  if (historicalWidths.length === 0) return false;

  // Squeeze if current width is less than 50% of average
  const avgWidth = historicalWidths.reduce((a, b) => a + b, 0) / historicalWidths.length;
  return currentWidth < avgWidth * 0.5;
}

/**
 * Calculate BB series for backtesting
 */
export function calculateBBSeries(
  candles: Candle[],
  config: BBConfig
): (BBResult | null)[] {
  const results: (BBResult | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < config.period - 1) {
      results.push(null);
    } else {
      const windowCandles = candles.slice(0, i + 1);
      results.push(calculateBollingerBands(windowCandles, config));
    }
  }

  return results;
}

/**
 * Detect band touches (potential reversal points)
 */
export function detectBandTouch(
  candles: Candle[],
  config: BBConfig
): 'UPPER_TOUCH' | 'LOWER_TOUCH' | null {
  if (candles.length < 2) return null;

  const current = calculateBollingerBands(candles, config);
  if (!current) return null;

  const currentCandle = candles[candles.length - 1]!;

  // Upper band touch
  if (currentCandle.high >= current.upper) {
    return 'UPPER_TOUCH';
  }

  // Lower band touch
  if (currentCandle.low <= current.lower) {
    return 'LOWER_TOUCH';
  }

  return null;
}

/**
 * Detect band walk (strong trend)
 */
export function detectBandWalk(
  candles: Candle[],
  config: BBConfig,
  consecutiveBars: number = 3
): 'UPPER_WALK' | 'LOWER_WALK' | null {
  if (candles.length < config.period + consecutiveBars) {
    return null;
  }

  let upperTouches = 0;
  let lowerTouches = 0;

  for (let i = 0; i < consecutiveBars; i++) {
    const idx = candles.length - 1 - i;
    const windowCandles = candles.slice(0, idx + 1);
    const result = calculateBollingerBands(windowCandles, config);
    if (!result) continue;

    const candle = candles[idx]!;

    if (candle.close >= result.upper * 0.99) {
      upperTouches++;
    } else if (candle.close <= result.lower * 1.01) {
      lowerTouches++;
    }
  }

  if (upperTouches >= consecutiveBars - 1) return 'UPPER_WALK';
  if (lowerTouches >= consecutiveBars - 1) return 'LOWER_WALK';

  return null;
}

/**
 * Detect W-bottom or M-top patterns
 */
export function detectBBPattern(
  candles: Candle[],
  config: BBConfig,
  lookback: number = 10
): 'W_BOTTOM' | 'M_TOP' | null {
  if (candles.length < config.period + lookback) {
    return null;
  }

  // Get last N results
  const results: (BBResult | null)[] = [];
  for (let i = lookback - 1; i >= 0; i--) {
    const windowCandles = candles.slice(0, candles.length - i);
    results.push(calculateBollingerBands(windowCandles, config));
  }

  // Look for pattern characteristics
  const validResults = results.filter((r) => r !== null) as BBResult[];
  if (validResults.length < lookback * 0.8) return null;

  // Count lower extreme and upper extreme occurrences
  const lowerExtremes = validResults.filter(
    (r) => r.zone === 'LOWER_EXTREME' || r.zone === 'LOWER'
  ).length;
  const upperExtremes = validResults.filter(
    (r) => r.zone === 'UPPER_EXTREME' || r.zone === 'UPPER'
  ).length;

  // W-bottom: multiple touches of lower band
  if (lowerExtremes >= lookback * 0.3) {
    const lastZone = validResults[validResults.length - 1]?.zone;
    if (lastZone === 'MIDDLE' || lastZone === 'UPPER') {
      return 'W_BOTTOM';
    }
  }

  // M-top: multiple touches of upper band
  if (upperExtremes >= lookback * 0.3) {
    const lastZone = validResults[validResults.length - 1]?.zone;
    if (lastZone === 'MIDDLE' || lastZone === 'LOWER') {
      return 'M_TOP';
    }
  }

  return null;
}
