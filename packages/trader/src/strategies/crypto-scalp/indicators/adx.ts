/**
 * ADX (Average Directional Index) Indicator
 *
 * Measures trend strength using +DI and -DI directional indicators.
 * ADX > 25 indicates a trending market, < 20 indicates ranging.
 */

import type { Candle } from '@deriv-bot/shared';
import type { TrendStrength, ADXConfig } from '../crypto-scalp.types.js';

/**
 * ADX calculation result
 */
export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  trendStrength: TrendStrength;
  trendDirection: 'UP' | 'DOWN' | 'NEUTRAL';
}

/**
 * Calculate True Range
 */
function calculateTR(candle: Candle, prevCandle: Candle): number {
  const highLow = candle.high - candle.low;
  const highPrevClose = Math.abs(candle.high - prevCandle.close);
  const lowPrevClose = Math.abs(candle.low - prevCandle.close);
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Calculate +DM (Plus Directional Movement)
 */
function calculatePlusDM(candle: Candle, prevCandle: Candle): number {
  const upMove = candle.high - prevCandle.high;
  const downMove = prevCandle.low - candle.low;

  if (upMove > downMove && upMove > 0) {
    return upMove;
  }
  return 0;
}

/**
 * Calculate -DM (Minus Directional Movement)
 */
function calculateMinusDM(candle: Candle, prevCandle: Candle): number {
  const upMove = candle.high - prevCandle.high;
  const downMove = prevCandle.low - candle.low;

  if (downMove > upMove && downMove > 0) {
    return downMove;
  }
  return 0;
}

/**
 * Wilders smoothing (exponential moving average variant)
 */
function wildersSmooth(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      sum += values[i]!;
      if (i === period - 1) {
        result.push(sum / period);
      } else {
        result.push(0);
      }
    } else {
      const prev = result[result.length - 1]!;
      const smoothed = prev - prev / period + values[i]!;
      result.push(smoothed);
    }
  }

  return result;
}

/**
 * Calculate ADX for a series of candles
 */
export function calculateADX(candles: Candle[], config: ADXConfig): ADXResult | null {
  const period = config.period;

  // Need at least 2 * period + 1 candles for reliable ADX
  if (candles.length < period * 2 + 1) {
    return null;
  }

  // Calculate TR, +DM, -DM for each candle
  const trValues: number[] = [];
  const plusDMValues: number[] = [];
  const minusDMValues: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]!;
    const prevCandle = candles[i - 1]!;

    trValues.push(calculateTR(candle, prevCandle));
    plusDMValues.push(calculatePlusDM(candle, prevCandle));
    minusDMValues.push(calculateMinusDM(candle, prevCandle));
  }

  // Apply Wilders smoothing
  const smoothedTR = wildersSmooth(trValues, period);
  const smoothedPlusDM = wildersSmooth(plusDMValues, period);
  const smoothedMinusDM = wildersSmooth(minusDMValues, period);

  // Calculate +DI and -DI
  const plusDIValues: number[] = [];
  const minusDIValues: number[] = [];

  for (let i = 0; i < smoothedTR.length; i++) {
    const tr = smoothedTR[i]!;
    if (tr === 0) {
      plusDIValues.push(0);
      minusDIValues.push(0);
    } else {
      plusDIValues.push((smoothedPlusDM[i]! / tr) * 100);
      minusDIValues.push((smoothedMinusDM[i]! / tr) * 100);
    }
  }

  // Calculate DX
  const dxValues: number[] = [];
  for (let i = 0; i < plusDIValues.length; i++) {
    const plusDI = plusDIValues[i]!;
    const minusDI = minusDIValues[i]!;
    const sum = plusDI + minusDI;

    if (sum === 0) {
      dxValues.push(0);
    } else {
      dxValues.push((Math.abs(plusDI - minusDI) / sum) * 100);
    }
  }

  // Apply Wilders smoothing to DX to get ADX
  const adxValues = wildersSmooth(dxValues, period);

  // Get last values
  const lastIndex = adxValues.length - 1;
  if (lastIndex < 0) return null;

  const adx = adxValues[lastIndex]!;
  const plusDI = plusDIValues[lastIndex]!;
  const minusDI = minusDIValues[lastIndex]!;

  // Determine trend strength
  const trendStrength = classifyTrendStrength(adx, config);

  // Determine trend direction
  let trendDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  if (plusDI > minusDI + 5) {
    trendDirection = 'UP';
  } else if (minusDI > plusDI + 5) {
    trendDirection = 'DOWN';
  } else {
    trendDirection = 'NEUTRAL';
  }

  return {
    adx,
    plusDI,
    minusDI,
    trendStrength,
    trendDirection,
  };
}

/**
 * Classify trend strength based on ADX value
 */
export function classifyTrendStrength(adx: number, config: ADXConfig): TrendStrength {
  if (adx >= config.veryStrongThreshold) return 'VERY_STRONG';
  if (adx >= config.strongThreshold) return 'STRONG';
  if (adx >= config.weakThreshold) return 'MODERATE';
  if (adx >= config.noTrendThreshold) return 'WEAK';
  return 'NO_TREND';
}

/**
 * Calculate ADX series for backtesting
 */
export function calculateADXSeries(
  candles: Candle[],
  config: ADXConfig
): (ADXResult | null)[] {
  const results: (ADXResult | null)[] = [];
  const minCandles = config.period * 2 + 1;

  for (let i = 0; i < candles.length; i++) {
    if (i < minCandles - 1) {
      results.push(null);
    } else {
      const windowCandles = candles.slice(0, i + 1);
      results.push(calculateADX(windowCandles, config));
    }
  }

  return results;
}

/**
 * Check if market is trending (good for trend-following)
 */
export function isTrending(adxResult: ADXResult, minStrength: TrendStrength): boolean {
  const strengthOrder: TrendStrength[] = [
    'NO_TREND',
    'WEAK',
    'MODERATE',
    'STRONG',
    'VERY_STRONG',
  ];

  const currentIndex = strengthOrder.indexOf(adxResult.trendStrength);
  const minIndex = strengthOrder.indexOf(minStrength);

  return currentIndex >= minIndex;
}

/**
 * Check if market is ranging (good for mean reversion)
 */
export function isRanging(adxResult: ADXResult, config: ADXConfig): boolean {
  return adxResult.adx < config.weakThreshold;
}

/**
 * Detect potential trend reversals using DI crossovers
 */
export function detectDICrossover(
  current: ADXResult,
  previous: ADXResult
): 'BULLISH_CROSS' | 'BEARISH_CROSS' | null {
  // Bullish crossover: +DI crosses above -DI
  if (previous.plusDI < previous.minusDI && current.plusDI > current.minusDI) {
    return 'BULLISH_CROSS';
  }

  // Bearish crossover: -DI crosses above +DI
  if (previous.minusDI < previous.plusDI && current.minusDI > current.plusDI) {
    return 'BEARISH_CROSS';
  }

  return null;
}
