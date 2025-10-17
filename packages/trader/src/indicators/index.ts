/**
 * Technical Indicators
 *
 * Wrapper around technicalindicators library
 * Provides type-safe, Candle-compatible API
 */

import {
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
  ATR,
  ADX,
} from 'technicalindicators';
import type { Candle } from '@deriv-bot/shared';

/**
 * Extract values from candles
 */
function extractValues(
  candles: Candle[],
  field: 'open' | 'high' | 'low' | 'close' | 'volume'
): number[] {
  return candles.map((c) => c[field] as number);
}

/**
 * Simple Moving Average
 */
export function calculateSMA(
  candles: Candle[],
  period: number,
  field: 'open' | 'high' | 'low' | 'close' = 'close'
): number[] {
  return SMA.calculate({
    period,
    values: extractValues(candles, field),
  });
}

/**
 * Exponential Moving Average
 */
export function calculateEMA(
  candles: Candle[],
  period: number,
  field: 'open' | 'high' | 'low' | 'close' = 'close'
): number[] {
  return EMA.calculate({
    period,
    values: extractValues(candles, field),
  });
}

/**
 * Relative Strength Index
 */
export function calculateRSI(
  candles: Candle[],
  period: number = 14,
  field: 'open' | 'high' | 'low' | 'close' = 'close'
): number[] {
  return RSI.calculate({
    period,
    values: extractValues(candles, field),
  });
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
  field: 'open' | 'high' | 'low' | 'close' = 'close'
): any[] {
  return MACD.calculate({
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
    values: extractValues(candles, field),
  }) as any[];
}

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDev: number = 2,
  field: 'open' | 'high' | 'low' | 'close' = 'close'
): any[] {
  return BollingerBands.calculate({
    period,
    stdDev,
    values: extractValues(candles, field),
  }) as any[];
}

/**
 * Stochastic Oscillator
 */
export function calculateStochastic(
  candles: Candle[],
  period: number = 14,
  signalPeriod: number = 3
): any[] {
  return Stochastic.calculate({
    period,
    signalPeriod,
    high: extractValues(candles, 'high'),
    low: extractValues(candles, 'low'),
    close: extractValues(candles, 'close'),
  }) as any[];
}

/**
 * Average True Range (Volatility)
 */
export function calculateATR(
  candles: Candle[],
  period: number = 14
): number[] {
  return ATR.calculate({
    period,
    high: extractValues(candles, 'high'),
    low: extractValues(candles, 'low'),
    close: extractValues(candles, 'close'),
  }) as number[];
}

/**
 * Average Directional Index (Trend Strength)
 */
export function calculateADX(
  candles: Candle[],
  period: number = 14
): any[] {
  return ADX.calculate({
    period,
    high: extractValues(candles, 'high'),
    low: extractValues(candles, 'low'),
    close: extractValues(candles, 'close'),
  }) as any[];
}

/**
 * Get latest indicator value
 */
export function getLatest<T>(values: T[]): T | null {
  return values.length > 0 ? (values[values.length - 1] ?? null) : null;
}

/**
 * Check if price crosses above a line
 */
export function crossesAbove(
  values: number[],
  line: number[] | number,
  index: number
): boolean {
  if (index === 0 || index >= values.length) return false;

  const current = values[index];
  const previous = values[index - 1];

  if (current === undefined || previous === undefined) return false;

  const currentLine = Array.isArray(line) ? line[index] : line;
  const previousLine = Array.isArray(line) ? line[index - 1] : line;

  if (currentLine === undefined || previousLine === undefined) return false;

  return previous <= previousLine && current > currentLine;
}

/**
 * Check if price crosses below a line
 */
export function crossesBelow(
  values: number[],
  line: number[] | number,
  index: number
): boolean {
  if (index === 0 || index >= values.length) return false;

  const current = values[index];
  const previous = values[index - 1];

  if (current === undefined || previous === undefined) return false;

  const currentLine = Array.isArray(line) ? line[index] : line;
  const previousLine = Array.isArray(line) ? line[index - 1] : line;

  if (currentLine === undefined || previousLine === undefined) return false;

  return previous >= previousLine && current < currentLine;
}
