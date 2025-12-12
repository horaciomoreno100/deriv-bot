/**
 * Order Block Detector
 *
 * Detects Order Blocks (OB) - institutional footprints in the market.
 *
 * Bullish OB: Last bearish candle before a strong bullish move
 * Bearish OB: Last bullish candle before a strong bearish move
 *
 * These zones often act as strong support/resistance when price returns.
 */

import type { Candle } from '@deriv-bot/shared';

export interface OrderBlock {
  /** Unique identifier */
  id: string;

  /** Type of order block */
  type: 'bullish' | 'bearish';

  /** Index of the OB candle */
  index: number;

  /** Timestamp */
  timestamp: number;

  /** Price zone - high of OB candle */
  priceHigh: number;

  /** Price zone - low of OB candle */
  priceLow: number;

  /** The impulse move size in % that created this OB */
  impulseSizePct: number;

  /** Whether price has returned to mitigate this OB */
  mitigated: boolean;

  /** Timestamp when mitigated */
  mitigatedAt?: number;

  /** Strength based on impulse size (1-5) */
  strength: number;

  /** Volume of the OB candle (if available) */
  volume?: number;

  /** Average volume during impulse (for comparison) */
  impulseAvgVolume?: number;
}

export interface OrderBlockConfig {
  /** Minimum impulse move in % to consider (default: 0.3%) */
  minImpulsePct: number;

  /** Number of candles to check for impulse (default: 3) */
  impulseCandles: number;

  /** Minimum candles in impulse move (default: 2) */
  minImpulseCandles: number;

  /** Whether to track mitigation (default: true) */
  trackMitigation: boolean;
}

const DEFAULT_CONFIG: OrderBlockConfig = {
  minImpulsePct: 0.3,
  impulseCandles: 5,
  minImpulseCandles: 2,
  trackMitigation: true,
};

export class OrderBlockDetector {
  private config: OrderBlockConfig;

  constructor(config: Partial<OrderBlockConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect order blocks in candle data
   */
  detect(candles: Candle[]): OrderBlock[] {
    const orderBlocks: OrderBlock[] = [];

    for (let i = 1; i < candles.length - this.config.impulseCandles; i++) {
      const candle = candles[i]!;

      // Check for Bullish OB: bearish candle followed by strong bullish move
      if (this.isBearishCandle(candle)) {
        const impulse = this.checkBullishImpulse(candles, i);
        if (impulse) {
          orderBlocks.push({
            id: `bullish-ob-${i}`,
            type: 'bullish',
            index: i,
            timestamp: candle.timestamp,
            priceHigh: candle.high,
            priceLow: candle.low,
            impulseSizePct: impulse.sizePct,
            mitigated: false,
            strength: this.calculateStrength(impulse.sizePct),
            volume: candle.volume,
            impulseAvgVolume: impulse.avgVolume,
          });
        }
      }

      // Check for Bearish OB: bullish candle followed by strong bearish move
      if (this.isBullishCandle(candle)) {
        const impulse = this.checkBearishImpulse(candles, i);
        if (impulse) {
          orderBlocks.push({
            id: `bearish-ob-${i}`,
            type: 'bearish',
            index: i,
            timestamp: candle.timestamp,
            priceHigh: candle.high,
            priceLow: candle.low,
            impulseSizePct: impulse.sizePct,
            mitigated: false,
            strength: this.calculateStrength(impulse.sizePct),
            volume: candle.volume,
            impulseAvgVolume: impulse.avgVolume,
          });
        }
      }
    }

    // Track mitigation if enabled
    if (this.config.trackMitigation) {
      this.trackMitigation(orderBlocks, candles);
    }

    return orderBlocks;
  }

  /**
   * Get only unmitigated (active) order blocks
   */
  getActiveOrderBlocks(orderBlocks: OrderBlock[]): OrderBlock[] {
    return orderBlocks.filter((ob) => !ob.mitigated);
  }

  /**
   * Check if candle is bearish
   */
  private isBearishCandle(candle: Candle): boolean {
    return candle.close < candle.open;
  }

  /**
   * Check if candle is bullish
   */
  private isBullishCandle(candle: Candle): boolean {
    return candle.close > candle.open;
  }

  /**
   * Check for bullish impulse after a bearish candle
   */
  private checkBullishImpulse(
    candles: Candle[],
    obIndex: number
  ): { sizePct: number; avgVolume: number } | null {
    const obCandle = candles[obIndex]!;
    let bullishCount = 0;
    let totalMove = 0;
    let totalVolume = 0;
    let volumeCount = 0;

    // Check next candles for bullish impulse
    for (let i = 1; i <= this.config.impulseCandles; i++) {
      const nextCandle = candles[obIndex + i];
      if (!nextCandle) break;

      if (this.isBullishCandle(nextCandle)) {
        bullishCount++;
        totalMove += nextCandle.close - nextCandle.open;
      }

      if (nextCandle.volume) {
        totalVolume += nextCandle.volume;
        volumeCount++;
      }
    }

    // Need minimum bullish candles in impulse
    if (bullishCount < this.config.minImpulseCandles) return null;

    // Calculate total impulse from OB low to highest point
    const impulseCandles = candles.slice(
      obIndex + 1,
      obIndex + 1 + this.config.impulseCandles
    );
    const highestHigh = Math.max(...impulseCandles.map((c) => c.high));
    const impulseSizePct = ((highestHigh - obCandle.low) / obCandle.low) * 100;

    // Check if impulse is strong enough
    if (impulseSizePct < this.config.minImpulsePct) return null;

    return {
      sizePct: impulseSizePct,
      avgVolume: volumeCount > 0 ? totalVolume / volumeCount : 0,
    };
  }

  /**
   * Check for bearish impulse after a bullish candle
   */
  private checkBearishImpulse(
    candles: Candle[],
    obIndex: number
  ): { sizePct: number; avgVolume: number } | null {
    const obCandle = candles[obIndex]!;
    let bearishCount = 0;
    let totalVolume = 0;
    let volumeCount = 0;

    // Check next candles for bearish impulse
    for (let i = 1; i <= this.config.impulseCandles; i++) {
      const nextCandle = candles[obIndex + i];
      if (!nextCandle) break;

      if (this.isBearishCandle(nextCandle)) {
        bearishCount++;
      }

      if (nextCandle.volume) {
        totalVolume += nextCandle.volume;
        volumeCount++;
      }
    }

    // Need minimum bearish candles in impulse
    if (bearishCount < this.config.minImpulseCandles) return null;

    // Calculate total impulse from OB high to lowest point
    const impulseCandles = candles.slice(
      obIndex + 1,
      obIndex + 1 + this.config.impulseCandles
    );
    const lowestLow = Math.min(...impulseCandles.map((c) => c.low));
    const impulseSizePct = ((obCandle.high - lowestLow) / obCandle.high) * 100;

    // Check if impulse is strong enough
    if (impulseSizePct < this.config.minImpulsePct) return null;

    return {
      sizePct: impulseSizePct,
      avgVolume: volumeCount > 0 ? totalVolume / volumeCount : 0,
    };
  }

  /**
   * Track which order blocks have been mitigated
   */
  private trackMitigation(orderBlocks: OrderBlock[], candles: Candle[]): void {
    for (const ob of orderBlocks) {
      // Check candles after the OB
      for (let i = ob.index + this.config.impulseCandles + 1; i < candles.length; i++) {
        const candle = candles[i]!;

        if (ob.type === 'bullish') {
          // Bullish OB mitigated when price returns and touches the zone
          if (candle.low <= ob.priceHigh && candle.low >= ob.priceLow) {
            ob.mitigated = true;
            ob.mitigatedAt = candle.timestamp;
            break;
          }
          // Also mitigated if price goes through it
          if (candle.close < ob.priceLow) {
            ob.mitigated = true;
            ob.mitigatedAt = candle.timestamp;
            break;
          }
        } else {
          // Bearish OB mitigated when price returns and touches the zone
          if (candle.high >= ob.priceLow && candle.high <= ob.priceHigh) {
            ob.mitigated = true;
            ob.mitigatedAt = candle.timestamp;
            break;
          }
          // Also mitigated if price goes through it
          if (candle.close > ob.priceHigh) {
            ob.mitigated = true;
            ob.mitigatedAt = candle.timestamp;
            break;
          }
        }
      }
    }
  }

  /**
   * Calculate strength based on impulse size
   */
  private calculateStrength(impulsePct: number): number {
    if (impulsePct >= 2.0) return 5;
    if (impulsePct >= 1.5) return 4;
    if (impulsePct >= 1.0) return 3;
    if (impulsePct >= 0.5) return 2;
    return 1;
  }
}

/**
 * Quick helper function
 */
export function detectOrderBlocks(
  candles: Candle[],
  config?: Partial<OrderBlockConfig>
): OrderBlock[] {
  const detector = new OrderBlockDetector(config);
  return detector.detect(candles);
}
