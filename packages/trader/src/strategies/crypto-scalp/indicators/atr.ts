/**
 * ATR (Average True Range) Indicator
 *
 * Measures market volatility. Used for dynamic TP/SL calculation
 * and position sizing.
 */

import type { Candle } from '@deriv-bot/shared';
import type { ATRConfig } from '../crypto-scalp.types.js';

/**
 * ATR calculation result with TP/SL levels
 */
export interface ATRResult {
  atr: number;
  atrPercent: number;
  suggestedTP: number;
  suggestedSL: number;
  volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
}

/**
 * Calculate True Range for a single candle
 */
export function calculateTrueRange(candle: Candle, prevCandle: Candle): number {
  const highLow = candle.high - candle.low;
  const highPrevClose = Math.abs(candle.high - prevCandle.close);
  const lowPrevClose = Math.abs(candle.low - prevCandle.close);
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Calculate ATR for a series of candles
 */
export function calculateATR(candles: Candle[], config: ATRConfig): ATRResult | null {
  if (candles.length < config.period + 1) {
    return null;
  }

  // Calculate True Range values
  const trValues: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trValues.push(calculateTrueRange(candles[i]!, candles[i - 1]!));
  }

  // Use Wilder's smoothing (similar to EMA)
  let atr = 0;
  const period = config.period;

  // Initial ATR is simple average
  for (let i = 0; i < period && i < trValues.length; i++) {
    atr += trValues[i]!;
  }
  atr /= Math.min(period, trValues.length);

  // Apply smoothing for remaining values
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]!) / period;
  }

  const currentPrice = candles[candles.length - 1]!.close;
  const atrPercent = (atr / currentPrice) * 100;

  // Calculate dynamic TP/SL
  const rawTP = atrPercent * config.tpMultiplier;
  const rawSL = atrPercent * config.slMultiplier;

  // Apply min/max constraints
  const suggestedTP = Math.min(Math.max(rawTP, config.minTpPct), config.maxTpPct);
  const suggestedSL = Math.min(Math.max(rawSL, config.minSlPct), config.maxSlPct);

  // Classify volatility level
  const volatilityLevel = classifyVolatility(atrPercent);

  return {
    atr,
    atrPercent,
    suggestedTP,
    suggestedSL,
    volatilityLevel,
  };
}

/**
 * Classify volatility based on ATR percent
 */
export function classifyVolatility(
  atrPercent: number
): 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' {
  // These thresholds are tuned for 1-minute crypto charts
  if (atrPercent < 0.05) return 'LOW';
  if (atrPercent < 0.15) return 'NORMAL';
  if (atrPercent < 0.3) return 'HIGH';
  return 'EXTREME';
}

/**
 * Calculate ATR series for backtesting
 */
export function calculateATRSeries(
  candles: Candle[],
  config: ATRConfig
): (ATRResult | null)[] {
  const results: (ATRResult | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < config.period) {
      results.push(null);
    } else {
      const windowCandles = candles.slice(0, i + 1);
      results.push(calculateATR(windowCandles, config));
    }
  }

  return results;
}

/**
 * Calculate adaptive position size based on ATR
 * Higher volatility = smaller position size
 */
export function calculateAdaptivePositionSize(
  atrResult: ATRResult,
  basePositionPct: number,
  riskPct: number = 2
): number {
  // Target risk amount determines position size
  // Position Size = Risk Amount / (ATR * multiplier)
  const adjustedSize = (riskPct / atrResult.atrPercent) * basePositionPct;

  // Cap between 50% and 150% of base position
  return Math.min(Math.max(adjustedSize, basePositionPct * 0.5), basePositionPct * 1.5);
}

/**
 * Calculate trailing stop distance based on ATR
 */
export function calculateATRTrailingStop(
  atr: number,
  multiplier: number,
  _currentPrice: number
): number {
  return atr * multiplier;
}

/**
 * Check if volatility is suitable for trading
 */
export function isVolatilitySuitable(
  atrResult: ATRResult,
  minLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' = 'LOW',
  maxLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' = 'HIGH'
): boolean {
  const levels = ['LOW', 'NORMAL', 'HIGH', 'EXTREME'];
  const currentIndex = levels.indexOf(atrResult.volatilityLevel);
  const minIndex = levels.indexOf(minLevel);
  const maxIndex = levels.indexOf(maxLevel);

  return currentIndex >= minIndex && currentIndex <= maxIndex;
}

/**
 * Calculate normalized ATR for comparing across different assets
 */
export function calculateNormalizedATR(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;

  const config: ATRConfig = {
    period,
    tpMultiplier: 1,
    slMultiplier: 1,
    minTpPct: 0,
    maxTpPct: 100,
    minSlPct: 0,
    maxSlPct: 100,
  };

  const result = calculateATR(candles, config);
  return result?.atrPercent ?? null;
}

/**
 * Detect volatility expansion (breakout potential)
 */
export function detectVolatilityExpansion(
  currentATR: number,
  previousATRs: number[],
  threshold: number = 1.5
): boolean {
  if (previousATRs.length === 0) return false;

  const avgATR = previousATRs.reduce((a, b) => a + b, 0) / previousATRs.length;
  return currentATR > avgATR * threshold;
}

/**
 * Detect volatility contraction (consolidation)
 */
export function detectVolatilityContraction(
  currentATR: number,
  previousATRs: number[],
  threshold: number = 0.7
): boolean {
  if (previousATRs.length === 0) return false;

  const avgATR = previousATRs.reduce((a, b) => a + b, 0) / previousATRs.length;
  return currentATR < avgATR * threshold;
}
