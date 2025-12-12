/**
 * Liquidity Sweep Detector
 *
 * Detects when price "sweeps" liquidity by:
 * - Breaking above a swing high (taking buy-side liquidity)
 * - Breaking below a swing low (taking sell-side liquidity)
 * - Then reversing back into the range
 *
 * This is a key SMC concept - smart money hunts stop losses before reversing.
 */

import type { Candle } from '@deriv-bot/shared';
import type { SwingPoint } from '@deriv-bot/shared';

export interface LiquiditySweep {
  /** Unique identifier */
  id: string;

  /** Type of sweep */
  type: 'buyside' | 'sellside';

  /** The swing point that was swept */
  sweptLevel: number;

  /** Timestamp of the sweep candle */
  timestamp: number;

  /** Index of the sweep candle */
  index: number;

  /** How far price went beyond the level (in %) */
  sweepDepthPct: number;

  /** The high/low of the sweep candle */
  sweepExtreme: number;

  /** Whether price has reversed after the sweep */
  reversed: boolean;

  /** How much price reversed after sweep (in %) */
  reversalPct: number;

  /** Strength rating (1-5) based on depth and reversal */
  strength: number;

  /** The original swing point that was swept */
  swingPoint?: SwingPoint;
}

export interface LiquiditySweepConfig {
  /** Minimum sweep depth in % to consider valid (default: 0.05%) */
  minSweepDepthPct: number;

  /** Candles to look back for swing points (default: 50) */
  swingLookback: number;

  /** Minimum swing point strength to consider (default: 1) */
  minSwingStrength: number;

  /** Candles to check for reversal after sweep (default: 5) */
  reversalCandles: number;

  /** Minimum reversal % to confirm sweep (default: 0.1%) */
  minReversalPct: number;
}

const DEFAULT_CONFIG: LiquiditySweepConfig = {
  minSweepDepthPct: 0.05,
  swingLookback: 50,
  minSwingStrength: 1,
  reversalCandles: 5,
  minReversalPct: 0.1,
};

export class LiquiditySweepDetector {
  private config: LiquiditySweepConfig;

  constructor(config: Partial<LiquiditySweepConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect liquidity sweeps from candles and swing points
   */
  detect(candles: Candle[], swingPoints: SwingPoint[]): LiquiditySweep[] {
    const sweeps: LiquiditySweep[] = [];

    // Get swing highs and lows separately
    const swingHighs = swingPoints
      .filter((s) => s.type === 'high' && s.strength >= this.config.minSwingStrength)
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

    const swingLows = swingPoints
      .filter((s) => s.type === 'low' && s.strength >= this.config.minSwingStrength)
      .sort((a, b) => b.timestamp - a.timestamp);

    // Check each candle for potential sweeps
    for (let i = this.config.swingLookback; i < candles.length; i++) {
      const candle = candles[i]!;

      // Check for buyside sweep (price breaks above swing high then reverses)
      const buysideSweep = this.checkBuysideSweep(candle, i, candles, swingHighs);
      if (buysideSweep) {
        sweeps.push(buysideSweep);
      }

      // Check for sellside sweep (price breaks below swing low then reverses)
      const sellsideSweep = this.checkSellsideSweep(candle, i, candles, swingLows);
      if (sellsideSweep) {
        sweeps.push(sellsideSweep);
      }
    }

    return sweeps;
  }

  /**
   * Check for buyside liquidity sweep (sweep of swing high)
   */
  private checkBuysideSweep(
    candle: Candle,
    index: number,
    candles: Candle[],
    swingHighs: SwingPoint[]
  ): LiquiditySweep | null {
    // Find swing highs that are within lookback period and below current candle high
    const relevantHighs = swingHighs.filter((sh) => {
      const swingIndex = candles.findIndex((c) => c.timestamp === sh.timestamp);
      return (
        swingIndex >= 0 &&
        swingIndex < index &&
        index - swingIndex <= this.config.swingLookback &&
        candle.high > sh.price
      );
    });

    if (relevantHighs.length === 0) return null;

    // Take the most recent/closest swing high
    const sweptSwing = relevantHighs[0]!;

    // Calculate sweep depth
    const sweepDepthPct = ((candle.high - sweptSwing.price) / sweptSwing.price) * 100;
    if (sweepDepthPct < this.config.minSweepDepthPct) return null;

    // Check for reversal (candle closes back below the swing high)
    // This is key - a sweep should show rejection
    const reversedOnSameCandle = candle.close < sweptSwing.price;

    // Also check next candles for reversal
    let reversalPct = 0;
    let reversed = reversedOnSameCandle;

    if (!reversed) {
      // Check subsequent candles for reversal
      for (let j = 1; j <= this.config.reversalCandles && index + j < candles.length; j++) {
        const nextCandle = candles[index + j]!;
        if (nextCandle.close < sweptSwing.price) {
          reversed = true;
          reversalPct = ((candle.high - nextCandle.close) / candle.high) * 100;
          break;
        }
      }
    } else {
      reversalPct = ((candle.high - candle.close) / candle.high) * 100;
    }

    // Only count as sweep if there's a reversal
    if (!reversed || reversalPct < this.config.minReversalPct) return null;

    return {
      id: `buyside-${index}`,
      type: 'buyside',
      sweptLevel: sweptSwing.price,
      timestamp: candle.timestamp,
      index,
      sweepDepthPct,
      sweepExtreme: candle.high,
      reversed,
      reversalPct,
      strength: this.calculateStrength(sweepDepthPct, reversalPct, sweptSwing.strength),
      swingPoint: sweptSwing,
    };
  }

  /**
   * Check for sellside liquidity sweep (sweep of swing low)
   */
  private checkSellsideSweep(
    candle: Candle,
    index: number,
    candles: Candle[],
    swingLows: SwingPoint[]
  ): LiquiditySweep | null {
    // Find swing lows that are within lookback period and above current candle low
    const relevantLows = swingLows.filter((sl) => {
      const swingIndex = candles.findIndex((c) => c.timestamp === sl.timestamp);
      return (
        swingIndex >= 0 &&
        swingIndex < index &&
        index - swingIndex <= this.config.swingLookback &&
        candle.low < sl.price
      );
    });

    if (relevantLows.length === 0) return null;

    // Take the most recent/closest swing low
    const sweptSwing = relevantLows[0]!;

    // Calculate sweep depth
    const sweepDepthPct = ((sweptSwing.price - candle.low) / sweptSwing.price) * 100;
    if (sweepDepthPct < this.config.minSweepDepthPct) return null;

    // Check for reversal (candle closes back above the swing low)
    const reversedOnSameCandle = candle.close > sweptSwing.price;

    let reversalPct = 0;
    let reversed = reversedOnSameCandle;

    if (!reversed) {
      // Check subsequent candles for reversal
      for (let j = 1; j <= this.config.reversalCandles && index + j < candles.length; j++) {
        const nextCandle = candles[index + j]!;
        if (nextCandle.close > sweptSwing.price) {
          reversed = true;
          reversalPct = ((nextCandle.close - candle.low) / candle.low) * 100;
          break;
        }
      }
    } else {
      reversalPct = ((candle.close - candle.low) / candle.low) * 100;
    }

    // Only count as sweep if there's a reversal
    if (!reversed || reversalPct < this.config.minReversalPct) return null;

    return {
      id: `sellside-${index}`,
      type: 'sellside',
      sweptLevel: sweptSwing.price,
      timestamp: candle.timestamp,
      index,
      sweepDepthPct,
      sweepExtreme: candle.low,
      reversed,
      reversalPct,
      strength: this.calculateStrength(sweepDepthPct, reversalPct, sweptSwing.strength),
      swingPoint: sweptSwing,
    };
  }

  /**
   * Calculate sweep strength (1-5)
   */
  private calculateStrength(
    sweepDepthPct: number,
    reversalPct: number,
    swingStrength: number
  ): number {
    let score = 0;

    // Deeper sweeps are stronger
    if (sweepDepthPct >= 0.5) score += 2;
    else if (sweepDepthPct >= 0.2) score += 1;

    // Stronger reversals are better
    if (reversalPct >= 0.5) score += 2;
    else if (reversalPct >= 0.2) score += 1;

    // Higher swing strength means more significant level
    if (swingStrength >= 3) score += 1;

    return Math.min(5, Math.max(1, score));
  }

  /**
   * Get recent sweeps (within last N candles)
   */
  getRecentSweeps(sweeps: LiquiditySweep[], candles: Candle[], withinCandles: number = 20): LiquiditySweep[] {
    const lastIndex = candles.length - 1;
    return sweeps.filter((s) => lastIndex - s.index <= withinCandles);
  }
}

/**
 * Quick helper function
 */
export function detectLiquiditySweeps(
  candles: Candle[],
  swingPoints: SwingPoint[],
  config?: Partial<LiquiditySweepConfig>
): LiquiditySweep[] {
  const detector = new LiquiditySweepDetector(config);
  return detector.detect(candles, swingPoints);
}
