/**
 * RSI Divergence Detector
 *
 * Detects bullish and bearish divergences between price and RSI.
 * - Bullish Divergence: Price makes lower low, RSI makes higher low
 * - Bearish Divergence: Price makes higher high, RSI makes lower high
 *
 * These divergences are especially powerful when occurring at HTF support/resistance zones.
 */

import type { Candle } from '@deriv-bot/shared';
import { calculateRSI } from '../indicators/index.js';

/**
 * Types of RSI divergences
 */
export type DivergenceType = 'bullish' | 'bearish' | 'hidden_bullish' | 'hidden_bearish';

/**
 * A detected divergence
 */
export interface RSIDivergence {
  type: DivergenceType;
  // Price swing points
  pricePoint1: { index: number; value: number; timestamp: number };
  pricePoint2: { index: number; value: number; timestamp: number };
  // RSI swing points
  rsiPoint1: { index: number; value: number };
  rsiPoint2: { index: number; value: number };
  // Strength of the divergence (0-100)
  strength: number;
  // Expected direction after divergence
  expectedDirection: 'up' | 'down';
  // Confirmation status
  confirmed: boolean;
}

/**
 * Options for divergence detection
 */
export interface DivergenceDetectorOptions {
  // RSI period (default: 14)
  rsiPeriod?: number;
  // Minimum bars between swing points (default: 5)
  minSwingDistance?: number;
  // Maximum bars between swing points (default: 50)
  maxSwingDistance?: number;
  // Swing detection lookback (default: 3)
  swingLookback?: number;
  // Minimum RSI difference for divergence (default: 3)
  minRSIDifference?: number;
  // RSI oversold level for bullish divergence (default: 40)
  oversoldLevel?: number;
  // RSI overbought level for bearish divergence (default: 60)
  overboughtLevel?: number;
  // Require confirmation candle (default: true)
  requireConfirmation?: boolean;
}

const DEFAULT_OPTIONS: Required<DivergenceDetectorOptions> = {
  rsiPeriod: 14,
  minSwingDistance: 5,
  maxSwingDistance: 50,
  swingLookback: 3,
  minRSIDifference: 3,
  oversoldLevel: 40,
  overboughtLevel: 60,
  requireConfirmation: true,
};

/**
 * Swing point for internal use
 */
interface SwingPoint {
  index: number;
  price: number;
  rsi: number;
  type: 'high' | 'low';
  timestamp: number;
}

/**
 * RSI Divergence Detector
 *
 * Detects regular and hidden divergences between price and RSI.
 *
 * @example
 * ```typescript
 * const detector = new RSIDivergenceDetector({ rsiPeriod: 14 });
 * const divergences = detector.detect(candles);
 *
 * for (const div of divergences) {
 *   if (div.type === 'bullish' && div.strength > 70) {
 *     console.log('Strong bullish divergence detected!');
 *   }
 * }
 * ```
 */
export class RSIDivergenceDetector {
  private options: Required<DivergenceDetectorOptions>;

  constructor(options: DivergenceDetectorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Detect all divergences in the candle data
   */
  detect(candles: Candle[]): RSIDivergence[] {
    if (candles.length < this.options.rsiPeriod + this.options.maxSwingDistance) {
      return [];
    }

    // Calculate RSI
    const rsiValues = calculateRSI(candles, this.options.rsiPeriod);

    // Align RSI with candles (RSI has offset due to period)
    const rsiOffset = candles.length - rsiValues.length;

    // Find swing points
    const swingHighs = this.findSwingHighs(candles, rsiValues, rsiOffset);
    const swingLows = this.findSwingLows(candles, rsiValues, rsiOffset);

    const divergences: RSIDivergence[] = [];

    // Detect bearish divergences (price HH, RSI LH)
    divergences.push(...this.detectBearishDivergences(swingHighs, candles, rsiValues, rsiOffset));

    // Detect bullish divergences (price LL, RSI HL)
    divergences.push(...this.detectBullishDivergences(swingLows, candles, rsiValues, rsiOffset));

    // Detect hidden bearish divergences (price LH, RSI HH)
    divergences.push(...this.detectHiddenBearishDivergences(swingHighs, candles, rsiValues, rsiOffset));

    // Detect hidden bullish divergences (price HL, RSI LL)
    divergences.push(...this.detectHiddenBullishDivergences(swingLows, candles, rsiValues, rsiOffset));

    // Sort by most recent first
    divergences.sort((a, b) => b.pricePoint2.index - a.pricePoint2.index);

    return divergences;
  }

  /**
   * Detect only the most recent divergence (for real-time use)
   */
  detectLatest(candles: Candle[]): RSIDivergence | null {
    const divergences = this.detect(candles);
    return divergences.length > 0 ? divergences[0]! : null;
  }

  /**
   * Check if there's a divergence at a specific zone
   */
  detectAtZone(
    candles: Candle[],
    zoneLow: number,
    zoneHigh: number,
    zoneType: 'support' | 'resistance'
  ): RSIDivergence | null {
    const divergences = this.detect(candles);

    for (const div of divergences) {
      const price = div.pricePoint2.value;

      // Check if the divergence point is at the zone
      if (price >= zoneLow && price <= zoneHigh) {
        // For support zones, we want bullish divergences
        if (zoneType === 'support' && (div.type === 'bullish' || div.type === 'hidden_bullish')) {
          return div;
        }
        // For resistance zones, we want bearish divergences
        if (zoneType === 'resistance' && (div.type === 'bearish' || div.type === 'hidden_bearish')) {
          return div;
        }
      }
    }

    return null;
  }

  /**
   * Find swing highs in price data
   */
  private findSwingHighs(candles: Candle[], rsiValues: number[], rsiOffset: number): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const lookback = this.options.swingLookback;

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i]!;
      let isSwingHigh = true;

      // Check if current high is higher than surrounding bars
      for (let j = 1; j <= lookback; j++) {
        const left = candles[i - j];
        const right = candles[i + j];
        if (!left || !right || current.high <= left.high || current.high <= right.high) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        const rsiIndex = i - rsiOffset;
        if (rsiIndex >= 0 && rsiIndex < rsiValues.length) {
          swings.push({
            index: i,
            price: current.high,
            rsi: rsiValues[rsiIndex]!,
            type: 'high',
            timestamp: current.timestamp,
          });
        }
      }
    }

    return swings;
  }

  /**
   * Find swing lows in price data
   */
  private findSwingLows(candles: Candle[], rsiValues: number[], rsiOffset: number): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const lookback = this.options.swingLookback;

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i]!;
      let isSwingLow = true;

      // Check if current low is lower than surrounding bars
      for (let j = 1; j <= lookback; j++) {
        const left = candles[i - j];
        const right = candles[i + j];
        if (!left || !right || current.low >= left.low || current.low >= right.low) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        const rsiIndex = i - rsiOffset;
        if (rsiIndex >= 0 && rsiIndex < rsiValues.length) {
          swings.push({
            index: i,
            price: current.low,
            rsi: rsiValues[rsiIndex]!,
            type: 'low',
            timestamp: current.timestamp,
          });
        }
      }
    }

    return swings;
  }

  /**
   * Detect regular bearish divergences
   * Price makes Higher High, RSI makes Lower High
   */
  private detectBearishDivergences(
    swingHighs: SwingPoint[],
    candles: Candle[],
    rsiValues: number[],
    _rsiOffset: number
  ): RSIDivergence[] {
    const divergences: RSIDivergence[] = [];

    for (let i = 1; i < swingHighs.length; i++) {
      const point2 = swingHighs[i]!;
      const point1 = swingHighs[i - 1]!;

      const distance = point2.index - point1.index;
      if (distance < this.options.minSwingDistance || distance > this.options.maxSwingDistance) {
        continue;
      }

      // Regular bearish: Price HH, RSI LH
      if (point2.price > point1.price && point2.rsi < point1.rsi) {
        const rsiDiff = point1.rsi - point2.rsi;
        if (rsiDiff < this.options.minRSIDifference) continue;

        // Check if RSI is in overbought territory
        if (point2.rsi < this.options.overboughtLevel - 20) continue;

        const confirmed = this.isConfirmed(candles, point2.index, 'down');

        divergences.push({
          type: 'bearish',
          pricePoint1: { index: point1.index, value: point1.price, timestamp: point1.timestamp },
          pricePoint2: { index: point2.index, value: point2.price, timestamp: point2.timestamp },
          rsiPoint1: { index: point1.index, value: point1.rsi },
          rsiPoint2: { index: point2.index, value: point2.rsi },
          strength: this.calculateStrength(point1, point2, 'bearish'),
          expectedDirection: 'down',
          confirmed: this.options.requireConfirmation ? confirmed : true,
        });
      }
    }

    return divergences;
  }

  /**
   * Detect regular bullish divergences
   * Price makes Lower Low, RSI makes Higher Low
   */
  private detectBullishDivergences(
    swingLows: SwingPoint[],
    candles: Candle[],
    rsiValues: number[],
    _rsiOffset: number
  ): RSIDivergence[] {
    const divergences: RSIDivergence[] = [];

    for (let i = 1; i < swingLows.length; i++) {
      const point2 = swingLows[i]!;
      const point1 = swingLows[i - 1]!;

      const distance = point2.index - point1.index;
      if (distance < this.options.minSwingDistance || distance > this.options.maxSwingDistance) {
        continue;
      }

      // Regular bullish: Price LL, RSI HL
      if (point2.price < point1.price && point2.rsi > point1.rsi) {
        const rsiDiff = point2.rsi - point1.rsi;
        if (rsiDiff < this.options.minRSIDifference) continue;

        // Check if RSI is in oversold territory
        if (point2.rsi > this.options.oversoldLevel + 20) continue;

        const confirmed = this.isConfirmed(candles, point2.index, 'up');

        divergences.push({
          type: 'bullish',
          pricePoint1: { index: point1.index, value: point1.price, timestamp: point1.timestamp },
          pricePoint2: { index: point2.index, value: point2.price, timestamp: point2.timestamp },
          rsiPoint1: { index: point1.index, value: point1.rsi },
          rsiPoint2: { index: point2.index, value: point2.rsi },
          strength: this.calculateStrength(point1, point2, 'bullish'),
          expectedDirection: 'up',
          confirmed: this.options.requireConfirmation ? confirmed : true,
        });
      }
    }

    return divergences;
  }

  /**
   * Detect hidden bearish divergences (continuation)
   * Price makes Lower High, RSI makes Higher High
   */
  private detectHiddenBearishDivergences(
    swingHighs: SwingPoint[],
    candles: Candle[],
    rsiValues: number[],
    _rsiOffset: number
  ): RSIDivergence[] {
    const divergences: RSIDivergence[] = [];

    for (let i = 1; i < swingHighs.length; i++) {
      const point2 = swingHighs[i]!;
      const point1 = swingHighs[i - 1]!;

      const distance = point2.index - point1.index;
      if (distance < this.options.minSwingDistance || distance > this.options.maxSwingDistance) {
        continue;
      }

      // Hidden bearish: Price LH, RSI HH (trend continuation in downtrend)
      if (point2.price < point1.price && point2.rsi > point1.rsi) {
        const rsiDiff = point2.rsi - point1.rsi;
        if (rsiDiff < this.options.minRSIDifference) continue;

        const confirmed = this.isConfirmed(candles, point2.index, 'down');

        divergences.push({
          type: 'hidden_bearish',
          pricePoint1: { index: point1.index, value: point1.price, timestamp: point1.timestamp },
          pricePoint2: { index: point2.index, value: point2.price, timestamp: point2.timestamp },
          rsiPoint1: { index: point1.index, value: point1.rsi },
          rsiPoint2: { index: point2.index, value: point2.rsi },
          strength: this.calculateStrength(point1, point2, 'hidden_bearish'),
          expectedDirection: 'down',
          confirmed: this.options.requireConfirmation ? confirmed : true,
        });
      }
    }

    return divergences;
  }

  /**
   * Detect hidden bullish divergences (continuation)
   * Price makes Higher Low, RSI makes Lower Low
   */
  private detectHiddenBullishDivergences(
    swingLows: SwingPoint[],
    candles: Candle[],
    rsiValues: number[],
    _rsiOffset: number
  ): RSIDivergence[] {
    const divergences: RSIDivergence[] = [];

    for (let i = 1; i < swingLows.length; i++) {
      const point2 = swingLows[i]!;
      const point1 = swingLows[i - 1]!;

      const distance = point2.index - point1.index;
      if (distance < this.options.minSwingDistance || distance > this.options.maxSwingDistance) {
        continue;
      }

      // Hidden bullish: Price HL, RSI LL (trend continuation in uptrend)
      if (point2.price > point1.price && point2.rsi < point1.rsi) {
        const rsiDiff = point1.rsi - point2.rsi;
        if (rsiDiff < this.options.minRSIDifference) continue;

        const confirmed = this.isConfirmed(candles, point2.index, 'up');

        divergences.push({
          type: 'hidden_bullish',
          pricePoint1: { index: point1.index, value: point1.price, timestamp: point1.timestamp },
          pricePoint2: { index: point2.index, value: point2.price, timestamp: point2.timestamp },
          rsiPoint1: { index: point1.index, value: point1.rsi },
          rsiPoint2: { index: point2.index, value: point2.rsi },
          strength: this.calculateStrength(point1, point2, 'hidden_bullish'),
          expectedDirection: 'up',
          confirmed: this.options.requireConfirmation ? confirmed : true,
        });
      }
    }

    return divergences;
  }

  /**
   * Calculate divergence strength (0-100)
   */
  private calculateStrength(
    point1: SwingPoint,
    point2: SwingPoint,
    type: DivergenceType
  ): number {
    let strength = 50; // Base strength

    // RSI difference contributes to strength
    const rsiDiff = Math.abs(point2.rsi - point1.rsi);
    strength += Math.min(rsiDiff * 2, 20); // Up to +20 for RSI divergence

    // Price move magnitude
    const priceMove = Math.abs(point2.price - point1.price) / point1.price;
    strength += Math.min(priceMove * 1000, 15); // Up to +15 for price move

    // RSI extreme levels boost strength
    if (type === 'bullish' || type === 'hidden_bullish') {
      if (point2.rsi < 30) strength += 15;
      else if (point2.rsi < 40) strength += 10;
    } else {
      if (point2.rsi > 70) strength += 15;
      else if (point2.rsi > 60) strength += 10;
    }

    return Math.min(Math.round(strength), 100);
  }

  /**
   * Check if divergence is confirmed by subsequent price action
   */
  private isConfirmed(
    candles: Candle[],
    divergenceIndex: number,
    expectedDirection: 'up' | 'down'
  ): boolean {
    // Look at candles after the divergence point
    const confirmationWindow = 3;
    const startIndex = divergenceIndex + 1;

    if (startIndex >= candles.length) return false;

    for (let i = startIndex; i < Math.min(startIndex + confirmationWindow, candles.length); i++) {
      const candle = candles[i]!;
      const prevCandle = candles[i - 1]!;

      if (expectedDirection === 'up') {
        // Bullish confirmation: Close above previous close, preferably bullish candle
        if (candle.close > prevCandle.close && candle.close > candle.open) {
          return true;
        }
      } else {
        // Bearish confirmation: Close below previous close, preferably bearish candle
        if (candle.close < prevCandle.close && candle.close < candle.open) {
          return true;
        }
      }
    }

    return false;
  }
}

/**
 * Quick function to detect divergences
 */
export function detectRSIDivergences(
  candles: Candle[],
  options: DivergenceDetectorOptions = {}
): RSIDivergence[] {
  const detector = new RSIDivergenceDetector(options);
  return detector.detect(candles);
}

/**
 * Check for divergence at a specific zone
 */
export function checkDivergenceAtZone(
  candles: Candle[],
  zoneLow: number,
  zoneHigh: number,
  zoneType: 'support' | 'resistance',
  options: DivergenceDetectorOptions = {}
): RSIDivergence | null {
  const detector = new RSIDivergenceDetector(options);
  return detector.detectAtZone(candles, zoneLow, zoneHigh, zoneType);
}
