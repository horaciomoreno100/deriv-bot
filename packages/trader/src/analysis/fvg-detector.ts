/**
 * Fair Value Gap (FVG) Detector
 *
 * Detects imbalances in price action where:
 * - Bullish FVG: Gap between candle 1's high and candle 3's low (in an up move)
 * - Bearish FVG: Gap between candle 1's low and candle 3's high (in a down move)
 *
 * FVGs often act as magnets - price tends to return to fill them.
 * They represent areas where price moved too fast, leaving unfilled orders.
 */

import type { Candle } from '@deriv-bot/shared';

export interface FairValueGap {
  /** Unique identifier */
  id: string;

  /** Type of FVG */
  type: 'bullish' | 'bearish';

  /** Upper boundary of the gap */
  high: number;

  /** Lower boundary of the gap */
  low: number;

  /** Midpoint of the gap */
  midpoint: number;

  /** Size of the gap in price */
  gapSize: number;

  /** Size of the gap as % of price */
  gapSizePct: number;

  /** Timestamp of the middle candle (the impulse) */
  timestamp: number;

  /** Index of the middle candle */
  index: number;

  /** Whether the gap has been filled (price returned to it) */
  filled: boolean;

  /** How much of the gap has been filled (0-100%) */
  fillPct: number;

  /** Timestamp when filled */
  filledAt?: number;

  /** Whether this is a "respected" FVG (price bounced from it) */
  respected: boolean;

  /** Strength rating (1-5) based on size and context */
  strength: number;
}

export interface FVGConfig {
  /** Minimum gap size as % of price (default: 0.05%) */
  minGapPct: number;

  /** Track whether gaps get filled (default: true) */
  trackFill: boolean;

  /** Consider gap filled if this % is covered (default: 50) */
  fillThresholdPct: number;

  /** Look for respected gaps (price bounced) (default: true) */
  trackRespected: boolean;
}

const DEFAULT_CONFIG: FVGConfig = {
  minGapPct: 0.05,
  trackFill: true,
  fillThresholdPct: 50,
  trackRespected: true,
};

export class FVGDetector {
  private config: FVGConfig;

  constructor(config: Partial<FVGConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect Fair Value Gaps in candle data
   */
  detect(candles: Candle[]): FairValueGap[] {
    const fvgs: FairValueGap[] = [];

    // Need at least 3 candles
    if (candles.length < 3) return fvgs;

    for (let i = 1; i < candles.length - 1; i++) {
      const candle1 = candles[i - 1]!; // First candle
      const candle2 = candles[i]!; // Middle candle (impulse)
      const candle3 = candles[i + 1]!; // Third candle

      // Check for Bullish FVG (gap up)
      // The low of candle 3 is above the high of candle 1
      if (candle3.low > candle1.high) {
        const gapHigh = candle3.low;
        const gapLow = candle1.high;
        const gapSize = gapHigh - gapLow;
        const gapSizePct = (gapSize / candle2.close) * 100;

        if (gapSizePct >= this.config.minGapPct) {
          fvgs.push({
            id: `bullish-fvg-${i}`,
            type: 'bullish',
            high: gapHigh,
            low: gapLow,
            midpoint: (gapHigh + gapLow) / 2,
            gapSize,
            gapSizePct,
            timestamp: candle2.timestamp,
            index: i,
            filled: false,
            fillPct: 0,
            respected: false,
            strength: this.calculateStrength(gapSizePct, candle2),
          });
        }
      }

      // Check for Bearish FVG (gap down)
      // The high of candle 3 is below the low of candle 1
      if (candle3.high < candle1.low) {
        const gapHigh = candle1.low;
        const gapLow = candle3.high;
        const gapSize = gapHigh - gapLow;
        const gapSizePct = (gapSize / candle2.close) * 100;

        if (gapSizePct >= this.config.minGapPct) {
          fvgs.push({
            id: `bearish-fvg-${i}`,
            type: 'bearish',
            high: gapHigh,
            low: gapLow,
            midpoint: (gapHigh + gapLow) / 2,
            gapSize,
            gapSizePct,
            timestamp: candle2.timestamp,
            index: i,
            filled: false,
            fillPct: 0,
            respected: false,
            strength: this.calculateStrength(gapSizePct, candle2),
          });
        }
      }
    }

    // Track fills and respected gaps
    if (this.config.trackFill || this.config.trackRespected) {
      this.trackFillsAndRespect(fvgs, candles);
    }

    return fvgs;
  }

  /**
   * Track which FVGs have been filled or respected
   */
  private trackFillsAndRespect(fvgs: FairValueGap[], candles: Candle[]): void {
    for (const fvg of fvgs) {
      let maxFillPct = 0;
      let wasRespected = false;

      // Check candles after the FVG
      for (let i = fvg.index + 2; i < candles.length; i++) {
        const candle = candles[i]!;

        if (fvg.type === 'bullish') {
          // For bullish FVG, check if price came down into it
          if (candle.low <= fvg.high) {
            // Price entered the gap
            const penetration = fvg.high - Math.max(candle.low, fvg.low);
            const fillPct = (penetration / fvg.gapSize) * 100;
            maxFillPct = Math.max(maxFillPct, fillPct);

            // Check if respected (price bounced up from the gap)
            if (candle.close > fvg.midpoint && candle.low >= fvg.low) {
              wasRespected = true;
            }

            // Fully filled if price went through
            if (candle.low <= fvg.low) {
              fvg.filled = true;
              fvg.fillPct = 100;
              fvg.filledAt = candle.timestamp;
              break;
            }
          }
        } else {
          // For bearish FVG, check if price came up into it
          if (candle.high >= fvg.low) {
            // Price entered the gap
            const penetration = Math.min(candle.high, fvg.high) - fvg.low;
            const fillPct = (penetration / fvg.gapSize) * 100;
            maxFillPct = Math.max(maxFillPct, fillPct);

            // Check if respected (price bounced down from the gap)
            if (candle.close < fvg.midpoint && candle.high <= fvg.high) {
              wasRespected = true;
            }

            // Fully filled if price went through
            if (candle.high >= fvg.high) {
              fvg.filled = true;
              fvg.fillPct = 100;
              fvg.filledAt = candle.timestamp;
              break;
            }
          }
        }
      }

      // Update fill percentage if not fully filled
      if (!fvg.filled) {
        fvg.fillPct = maxFillPct;
        fvg.filled = maxFillPct >= this.config.fillThresholdPct;
      }

      fvg.respected = wasRespected;
    }
  }

  /**
   * Calculate FVG strength (1-5)
   */
  private calculateStrength(gapSizePct: number, impulseCandle: Candle): number {
    let score = 1;

    // Larger gaps are stronger
    if (gapSizePct >= 0.5) score += 2;
    else if (gapSizePct >= 0.2) score += 1;

    // Strong impulse candles indicate more significance
    const candleBodyPct =
      Math.abs(impulseCandle.close - impulseCandle.open) /
      (impulseCandle.high - impulseCandle.low);
    if (candleBodyPct >= 0.7) score += 1; // Strong body

    // High volume on impulse (if available)
    if (impulseCandle.volume && impulseCandle.volume > 0) {
      score += 1; // Volume present
    }

    return Math.min(5, score);
  }

  /**
   * Get unfilled FVGs only
   */
  getUnfilledFVGs(fvgs: FairValueGap[]): FairValueGap[] {
    return fvgs.filter((f) => !f.filled);
  }

  /**
   * Get FVGs near current price
   */
  getFVGsNearPrice(fvgs: FairValueGap[], currentPrice: number, withinPct: number = 1): FairValueGap[] {
    return fvgs.filter((fvg) => {
      const distancePct = Math.abs(currentPrice - fvg.midpoint) / currentPrice * 100;
      return distancePct <= withinPct;
    });
  }

  /**
   * Get recent FVGs (within last N candles)
   */
  getRecentFVGs(fvgs: FairValueGap[], totalCandles: number, withinCandles: number = 50): FairValueGap[] {
    const lastIndex = totalCandles - 1;
    return fvgs.filter((f) => lastIndex - f.index <= withinCandles);
  }
}

/**
 * Quick helper function
 */
export function detectFVGs(
  candles: Candle[],
  config?: Partial<FVGConfig>
): FairValueGap[] {
  const detector = new FVGDetector(config);
  return detector.detect(candles);
}
