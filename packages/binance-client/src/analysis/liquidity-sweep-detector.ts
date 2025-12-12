/**
 * Liquidity Sweep Detector
 *
 * Detects:
 * - Sweeps of swing highs (stop hunts above)
 * - Sweeps of swing lows (stop hunts below)
 * - Equal highs/lows (liquidity pools)
 *
 * A liquidity sweep occurs when price briefly breaks a level
 * (taking out stops) and then reverses.
 */

import type { Bar } from '../binance-client.js';
import type { SwingPoint } from './market-structure.js';

export interface LiquiditySweep {
  index: number; // Index of the sweep candle
  timestamp: Date;
  type: 'high' | 'low'; // Which type of liquidity was swept
  sweptLevel: number; // The level that was swept
  sweptSwingIndex: number; // Index of the swing that was swept
  sweepHigh: number; // How far price went past the level
  sweepLow: number;
  rejectionStrength: number; // How strong was the rejection (0-100)
  wickRatio: number; // Ratio of wick to body (higher = stronger rejection)
}

export interface EqualLevel {
  type: 'high' | 'low';
  price: number;
  count: number; // How many times this level was touched
  indices: number[]; // Candle indices that touched this level
  tolerance: number; // Price tolerance used to detect equality
}

export interface LiquiditySweepConfig {
  sweepThreshold: number; // Minimum price movement past level in % (default: 0.02%)
  rejectionBars: number; // Number of bars to confirm rejection (default: 3)
  equalLevelTolerance: number; // Tolerance for equal highs/lows in % (default: 0.05%)
  minEqualCount: number; // Minimum touches to consider equal level (default: 2)
}

const DEFAULT_CONFIG: LiquiditySweepConfig = {
  sweepThreshold: 0.02,
  rejectionBars: 3,
  equalLevelTolerance: 0.05,
  minEqualCount: 2,
};

export class LiquiditySweepDetector {
  private config: LiquiditySweepConfig;

  constructor(config: Partial<LiquiditySweepConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect liquidity sweeps of swing points
   */
  detectSweeps(
    candles: Bar[],
    swingHighs: SwingPoint[],
    swingLows: SwingPoint[]
  ): LiquiditySweep[] {
    const sweeps: LiquiditySweep[] = [];

    // Check each swing high for sweeps
    for (const swing of swingHighs) {
      const sweep = this.checkHighSweep(candles, swing);
      if (sweep) {
        sweeps.push(sweep);
      }
    }

    // Check each swing low for sweeps
    for (const swing of swingLows) {
      const sweep = this.checkLowSweep(candles, swing);
      if (sweep) {
        sweeps.push(sweep);
      }
    }

    return sweeps.sort((a, b) => a.index - b.index);
  }

  /**
   * Detect equal highs (liquidity pools above)
   */
  detectEqualHighs(candles: Bar[]): EqualLevel[] {
    const tolerance = this.config.equalLevelTolerance / 100;
    const equalLevels: EqualLevel[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < candles.length; i++) {
      if (processed.has(i)) continue;

      const high = candles[i].high;
      const indices = [i];

      // Find other candles with similar highs
      for (let j = i + 1; j < candles.length; j++) {
        const diff = Math.abs(candles[j].high - high) / high;
        if (diff <= tolerance) {
          indices.push(j);
          processed.add(j);
        }
      }

      if (indices.length >= this.config.minEqualCount) {
        // Calculate average price
        const avgPrice =
          indices.reduce((sum, idx) => sum + candles[idx].high, 0) / indices.length;

        equalLevels.push({
          type: 'high',
          price: avgPrice,
          count: indices.length,
          indices,
          tolerance: tolerance * 100,
        });
      }
    }

    return equalLevels;
  }

  /**
   * Detect equal lows (liquidity pools below)
   */
  detectEqualLows(candles: Bar[]): EqualLevel[] {
    const tolerance = this.config.equalLevelTolerance / 100;
    const equalLevels: EqualLevel[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < candles.length; i++) {
      if (processed.has(i)) continue;

      const low = candles[i].low;
      const indices = [i];

      // Find other candles with similar lows
      for (let j = i + 1; j < candles.length; j++) {
        const diff = Math.abs(candles[j].low - low) / low;
        if (diff <= tolerance) {
          indices.push(j);
          processed.add(j);
        }
      }

      if (indices.length >= this.config.minEqualCount) {
        // Calculate average price
        const avgPrice =
          indices.reduce((sum, idx) => sum + candles[idx].low, 0) / indices.length;

        equalLevels.push({
          type: 'low',
          price: avgPrice,
          count: indices.length,
          indices,
          tolerance: tolerance * 100,
        });
      }
    }

    return equalLevels;
  }

  /**
   * Check if a swing high was swept
   */
  private checkHighSweep(candles: Bar[], swing: SwingPoint): LiquiditySweep | null {
    const threshold = this.config.sweepThreshold / 100;

    // Look for candles after the swing that go above it
    for (let i = swing.index + 1; i < candles.length; i++) {
      const candle = candles[i];

      // Check if this candle swept above the swing high
      if (candle.high > swing.price) {
        const sweepAmount = (candle.high - swing.price) / swing.price;

        // Must exceed threshold to be considered a sweep
        if (sweepAmount < threshold) continue;

        // Check for rejection (close back below the level)
        const rejected = candle.close < swing.price;

        if (rejected) {
          // Calculate rejection strength
          const bodySize = Math.abs(candle.close - candle.open);
          const upperWick = candle.high - Math.max(candle.open, candle.close);
          const totalRange = candle.high - candle.low;

          const wickRatio = totalRange > 0 ? upperWick / totalRange : 0;
          const rejectionStrength = Math.min(100, wickRatio * 100 + (rejected ? 50 : 0));

          return {
            index: i,
            timestamp: candle.timestamp,
            type: 'high',
            sweptLevel: swing.price,
            sweptSwingIndex: swing.index,
            sweepHigh: candle.high,
            sweepLow: candle.low,
            rejectionStrength,
            wickRatio,
          };
        }

        // If no immediate rejection, check next few candles
        for (let j = i + 1; j < Math.min(i + this.config.rejectionBars, candles.length); j++) {
          const nextCandle = candles[j];
          if (nextCandle.close < swing.price) {
            // Delayed rejection
            const bodySize = Math.abs(candle.close - candle.open);
            const upperWick = candle.high - Math.max(candle.open, candle.close);
            const totalRange = candle.high - candle.low;
            const wickRatio = totalRange > 0 ? upperWick / totalRange : 0;

            return {
              index: i,
              timestamp: candle.timestamp,
              type: 'high',
              sweptLevel: swing.price,
              sweptSwingIndex: swing.index,
              sweepHigh: candle.high,
              sweepLow: candle.low,
              rejectionStrength: Math.min(100, wickRatio * 70 + 20),
              wickRatio,
            };
          }
        }

        // No rejection = not a sweep, it's a breakout
        break;
      }
    }

    return null;
  }

  /**
   * Check if a swing low was swept
   */
  private checkLowSweep(candles: Bar[], swing: SwingPoint): LiquiditySweep | null {
    const threshold = this.config.sweepThreshold / 100;

    // Look for candles after the swing that go below it
    for (let i = swing.index + 1; i < candles.length; i++) {
      const candle = candles[i];

      // Check if this candle swept below the swing low
      if (candle.low < swing.price) {
        const sweepAmount = (swing.price - candle.low) / swing.price;

        // Must exceed threshold to be considered a sweep
        if (sweepAmount < threshold) continue;

        // Check for rejection (close back above the level)
        const rejected = candle.close > swing.price;

        if (rejected) {
          // Calculate rejection strength
          const bodySize = Math.abs(candle.close - candle.open);
          const lowerWick = Math.min(candle.open, candle.close) - candle.low;
          const totalRange = candle.high - candle.low;

          const wickRatio = totalRange > 0 ? lowerWick / totalRange : 0;
          const rejectionStrength = Math.min(100, wickRatio * 100 + (rejected ? 50 : 0));

          return {
            index: i,
            timestamp: candle.timestamp,
            type: 'low',
            sweptLevel: swing.price,
            sweptSwingIndex: swing.index,
            sweepHigh: candle.high,
            sweepLow: candle.low,
            rejectionStrength,
            wickRatio,
          };
        }

        // If no immediate rejection, check next few candles
        for (let j = i + 1; j < Math.min(i + this.config.rejectionBars, candles.length); j++) {
          const nextCandle = candles[j];
          if (nextCandle.close > swing.price) {
            // Delayed rejection
            const lowerWick = Math.min(candle.open, candle.close) - candle.low;
            const totalRange = candle.high - candle.low;
            const wickRatio = totalRange > 0 ? lowerWick / totalRange : 0;

            return {
              index: i,
              timestamp: candle.timestamp,
              type: 'low',
              sweptLevel: swing.price,
              sweptSwingIndex: swing.index,
              sweepHigh: candle.high,
              sweepLow: candle.low,
              rejectionStrength: Math.min(100, wickRatio * 70 + 20),
              wickRatio,
            };
          }
        }

        // No rejection = not a sweep, it's a breakdown
        break;
      }
    }

    return null;
  }
}
