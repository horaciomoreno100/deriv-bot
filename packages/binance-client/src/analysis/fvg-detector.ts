/**
 * Fair Value Gap (FVG) Detector
 *
 * An FVG occurs when there's a gap between:
 * - Bullish FVG: candle[i-2].high < candle[i].low (gap up)
 * - Bearish FVG: candle[i-2].low > candle[i].high (gap down)
 *
 * The middle candle (i-1) is the impulse candle that creates the gap.
 */

import type { Bar } from '../binance-client.js';

export interface FVG {
  index: number; // Index of the impulse candle (middle)
  timestamp: Date;
  type: 'bullish' | 'bearish';
  top: number; // Upper boundary of the gap
  bottom: number; // Lower boundary of the gap
  size: number; // Size of the gap in price
  sizePercent: number; // Size as percentage of price
  mitigated: boolean; // Has price returned to fill the gap?
  mitigatedIndex: number | null; // Index where mitigation occurred
  mitigatedTimestamp: Date | null;
  mitigatedPercent: number; // How much of the FVG was filled (0-100)
}

export interface FVGConfig {
  minSizePercent: number; // Minimum FVG size in % (default: 0.05%)
  maxSizePercent: number; // Maximum FVG size in % (default: 5%)
  lookbackBars: number; // How many bars back to detect FVGs (default: 100)
  trackMitigation: boolean; // Track if FVGs get filled (default: true)
}

const DEFAULT_CONFIG: FVGConfig = {
  minSizePercent: 0.05,
  maxSizePercent: 5,
  lookbackBars: 100,
  trackMitigation: true,
};

export class FVGDetector {
  private config: FVGConfig;

  constructor(config: Partial<FVGConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect all FVGs in the candle data
   */
  detect(candles: Bar[]): FVG[] {
    const fvgs: FVG[] = [];

    // Need at least 3 candles
    if (candles.length < 3) {
      return fvgs;
    }

    // Start from lookback or beginning
    const startIndex = Math.max(2, candles.length - this.config.lookbackBars);

    for (let i = startIndex; i < candles.length; i++) {
      const candleBefore = candles[i - 2]; // First candle
      const impulseCandle = candles[i - 1]; // Middle (impulse) candle
      const candleAfter = candles[i]; // Third candle

      // Check for Bullish FVG (gap up)
      // The low of current candle is higher than the high of candle two bars ago
      if (candleAfter.low > candleBefore.high) {
        const top = candleAfter.low;
        const bottom = candleBefore.high;
        const size = top - bottom;
        const sizePercent = (size / impulseCandle.close) * 100;

        if (
          sizePercent >= this.config.minSizePercent &&
          sizePercent <= this.config.maxSizePercent
        ) {
          const fvg: FVG = {
            index: i - 1,
            timestamp: impulseCandle.timestamp,
            type: 'bullish',
            top,
            bottom,
            size,
            sizePercent,
            mitigated: false,
            mitigatedIndex: null,
            mitigatedTimestamp: null,
            mitigatedPercent: 0,
          };

          // Check for mitigation
          if (this.config.trackMitigation) {
            this.checkMitigation(fvg, candles, i);
          }

          fvgs.push(fvg);
        }
      }

      // Check for Bearish FVG (gap down)
      // The high of current candle is lower than the low of candle two bars ago
      if (candleAfter.high < candleBefore.low) {
        const top = candleBefore.low;
        const bottom = candleAfter.high;
        const size = top - bottom;
        const sizePercent = (size / impulseCandle.close) * 100;

        if (
          sizePercent >= this.config.minSizePercent &&
          sizePercent <= this.config.maxSizePercent
        ) {
          const fvg: FVG = {
            index: i - 1,
            timestamp: impulseCandle.timestamp,
            type: 'bearish',
            top,
            bottom,
            size,
            sizePercent,
            mitigated: false,
            mitigatedIndex: null,
            mitigatedTimestamp: null,
            mitigatedPercent: 0,
          };

          // Check for mitigation
          if (this.config.trackMitigation) {
            this.checkMitigation(fvg, candles, i);
          }

          fvgs.push(fvg);
        }
      }
    }

    return fvgs;
  }

  /**
   * Get only unmitigated (open) FVGs
   */
  getOpenFVGs(candles: Bar[]): FVG[] {
    return this.detect(candles).filter((fvg) => !fvg.mitigated);
  }

  /**
   * Get FVGs that are partially mitigated (touched but not fully filled)
   */
  getPartiallyMitigatedFVGs(candles: Bar[], threshold: number = 50): FVG[] {
    return this.detect(candles).filter(
      (fvg) => fvg.mitigatedPercent > 0 && fvg.mitigatedPercent < threshold
    );
  }

  /**
   * Check if price has mitigated (filled) the FVG
   */
  private checkMitigation(fvg: FVG, candles: Bar[], fvgEndIndex: number): void {
    // Look at candles after the FVG
    for (let i = fvgEndIndex + 1; i < candles.length; i++) {
      const candle = candles[i];

      if (fvg.type === 'bullish') {
        // Bullish FVG mitigated when price drops into the gap
        if (candle.low <= fvg.top) {
          const penetration = fvg.top - Math.max(candle.low, fvg.bottom);
          const mitigatedPercent = Math.min(100, (penetration / fvg.size) * 100);

          if (mitigatedPercent > fvg.mitigatedPercent) {
            fvg.mitigatedPercent = mitigatedPercent;
            fvg.mitigatedIndex = i;
            fvg.mitigatedTimestamp = candle.timestamp;
          }

          // Fully mitigated if price goes through the entire gap
          if (candle.low <= fvg.bottom) {
            fvg.mitigated = true;
            fvg.mitigatedPercent = 100;
            break;
          }
        }
      } else {
        // Bearish FVG mitigated when price rises into the gap
        if (candle.high >= fvg.bottom) {
          const penetration = Math.min(candle.high, fvg.top) - fvg.bottom;
          const mitigatedPercent = Math.min(100, (penetration / fvg.size) * 100);

          if (mitigatedPercent > fvg.mitigatedPercent) {
            fvg.mitigatedPercent = mitigatedPercent;
            fvg.mitigatedIndex = i;
            fvg.mitigatedTimestamp = candle.timestamp;
          }

          // Fully mitigated if price goes through the entire gap
          if (candle.high >= fvg.top) {
            fvg.mitigated = true;
            fvg.mitigatedPercent = 100;
            break;
          }
        }
      }
    }
  }

  /**
   * Find the nearest FVG to current price
   */
  findNearestFVG(
    candles: Bar[],
    direction?: 'bullish' | 'bearish'
  ): FVG | null {
    const openFVGs = this.getOpenFVGs(candles);
    if (openFVGs.length === 0) return null;

    const currentPrice = candles[candles.length - 1].close;

    let nearest: FVG | null = null;
    let minDistance = Infinity;

    for (const fvg of openFVGs) {
      if (direction && fvg.type !== direction) continue;

      // Distance to center of FVG
      const center = (fvg.top + fvg.bottom) / 2;
      const distance = Math.abs(currentPrice - center);

      if (distance < minDistance) {
        minDistance = distance;
        nearest = fvg;
      }
    }

    return nearest;
  }
}
