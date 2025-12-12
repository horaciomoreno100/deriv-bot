/**
 * Fresh Sweep Detector
 *
 * Detects HIGH QUALITY trading opportunities based on:
 * 1. FRESH liquidity sweep (within last 1-3 candles)
 * 2. Immediate confirmation (rejection candle, engulfing, pin bar)
 * 3. Clear structure (swing highs/lows to define entry/SL/TP)
 *
 * This is the cleanest SMC pattern:
 * - Price sweeps liquidity (stops get hunted)
 * - Immediate reversal shows smart money entering
 * - Entry on the reversal candle or next candle
 */

import type { Candle } from '@deriv-bot/shared';

// ============================================================================
// TYPES
// ============================================================================

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: number;
  strength: number; // How many candles on each side confirm it
}

export interface FreshSweep {
  // Identification
  id: string;
  timestamp: number;
  index: number;

  // Sweep details
  sweptSwing: SwingPoint;
  sweepExtreme: number; // How far past the swing it went
  sweepCandle: Candle;

  // Direction (opposite of sweep - we trade the reversal)
  direction: 'long' | 'short'; // long after sellside sweep, short after buyside sweep

  // Confirmation
  confirmationType: 'pin_bar' | 'engulfing' | 'rejection' | 'wick_rejection';
  confirmationCandle: Candle;
  confirmationIndex: number;

  // Entry zone
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskRewardRatio: number;

  // Quality metrics
  sweepSize: number; // How much past the level (in %)
  rejectionSize: number; // Wick size relative to body
  bodyToWickRatio: number;
  quality: 'A+' | 'A' | 'B';
}

export interface FreshSweepDetectorConfig {
  // Swing detection
  swingLookback: number; // Candles to look back for swing detection
  minSwingStrength: number; // Minimum candles on each side for valid swing

  // Sweep detection
  maxSweepAge: number; // Max candles since sweep for it to be "fresh"
  minSweepSize: number; // Min % past the swing level

  // Confirmation requirements
  minWickRatio: number; // Min wick/body ratio for pin bar
  minRejectionPct: number; // Min rejection from extreme

  // Risk management
  slBufferPct: number; // Buffer beyond sweep extreme for SL
  minRR: number; // Minimum risk/reward ratio

  // Trend filter
  useTrendFilter: boolean; // Only trade in direction of trend
  trendEMAPeriod: number; // EMA period for trend detection
}

const DEFAULT_CONFIG: FreshSweepDetectorConfig = {
  swingLookback: 15, // Strong swing points
  minSwingStrength: 8, // Swing must be highest/lowest of 8 candles on each side
  maxSweepAge: 2, // Within last 2 candles
  minSweepSize: 0.001, // 0.1% minimum sweep
  minWickRatio: 2.5, // Wick must be 2.5x the body
  minRejectionPct: 0.6, // Must reject at least 60% of the sweep
  slBufferPct: 0.002, // 0.2% buffer for SL
  minRR: 2.0, // Minimum 2:1 R:R
  useTrendFilter: false, // Disabled - doesn't work well with synthetic indices
  trendEMAPeriod: 50, // 50-period EMA for trend
};

// ============================================================================
// DETECTOR CLASS
// ============================================================================

export class FreshSweepDetector {
  private config: FreshSweepDetectorConfig;

  constructor(config?: Partial<FreshSweepDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(candles: Candle[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        ema.push(candles[i]!.close);
      } else if (i < period) {
        // Simple average for first 'period' candles
        const sum = candles.slice(0, i + 1).reduce((s, c) => s + c.close, 0);
        ema.push(sum / (i + 1));
      } else {
        ema.push((candles[i]!.close - ema[i - 1]!) * multiplier + ema[i - 1]!);
      }
    }

    return ema;
  }

  /**
   * Get trend direction at a specific index
   */
  private getTrendDirection(
    candles: Candle[],
    ema: number[],
    index: number
  ): 'bullish' | 'bearish' | 'neutral' {
    if (index < this.config.trendEMAPeriod) return 'neutral';

    const currentPrice = candles[index]!.close;
    const currentEma = ema[index]!;
    const prevEma = ema[index - 10] ?? currentEma;

    // Price above EMA and EMA rising = bullish
    if (currentPrice > currentEma && currentEma > prevEma) {
      return 'bullish';
    }
    // Price below EMA and EMA falling = bearish
    if (currentPrice < currentEma && currentEma < prevEma) {
      return 'bearish';
    }

    return 'neutral';
  }

  /**
   * Detect fresh sweep opportunities
   */
  detect(candles: Candle[]): FreshSweep[] {
    if (candles.length < this.config.swingLookback * 2 + 10) {
      return [];
    }

    // Calculate EMA for trend filter
    const ema = this.config.useTrendFilter
      ? this.calculateEMA(candles, this.config.trendEMAPeriod)
      : [];

    // Find all swing points
    const swings = this.findSwingPoints(candles);
    if (swings.length < 2) return [];

    const opportunities: FreshSweep[] = [];
    const currentIndex = candles.length - 1;

    // Look at recent candles for fresh sweeps
    for (let i = currentIndex; i >= Math.max(0, currentIndex - this.config.maxSweepAge); i--) {
      // Get trend at this candle
      const trend = this.config.useTrendFilter
        ? this.getTrendDirection(candles, ema, i)
        : 'neutral';

      // Check for sellside sweep (price went below swing low then reversed)
      // Only valid if trend is bullish or neutral (we want to buy the dip)
      if (trend !== 'bearish') {
        const sellsideSweep = this.detectSellsideSweep(candles, swings, i);
        if (sellsideSweep) {
          opportunities.push(sellsideSweep);
        }
      }

      // Check for buyside sweep (price went above swing high then reversed)
      // Only valid if trend is bearish or neutral (we want to sell the rally)
      if (trend !== 'bullish') {
        const buysideSweep = this.detectBuysideSweep(candles, swings, i);
        if (buysideSweep) {
          opportunities.push(buysideSweep);
        }
      }
    }

    // Sort by quality
    opportunities.sort((a, b) => {
      const qualityOrder = { 'A+': 0, A: 1, B: 2 };
      return qualityOrder[a.quality] - qualityOrder[b.quality];
    });

    return opportunities;
  }

  /**
   * Find swing highs and lows
   */
  private findSwingPoints(candles: Candle[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const lookback = this.config.swingLookback;

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i]!;

      // Check for swing high
      let isSwingHigh = true;
      let highStrength = 0;
      for (let j = 1; j <= lookback; j++) {
        const before = candles[i - j]!;
        const after = candles[i + j];
        if (!after) break;

        if (current.high <= before.high || current.high <= after.high) {
          isSwingHigh = false;
          break;
        }
        highStrength = j;
      }

      // Only add if strength meets minimum requirement
      if (isSwingHigh && highStrength >= this.config.minSwingStrength) {
        swings.push({
          index: i,
          price: current.high,
          type: 'high',
          timestamp: current.timestamp,
          strength: highStrength,
        });
      }

      // Check for swing low
      let isSwingLow = true;
      let lowStrength = 0;
      for (let j = 1; j <= lookback; j++) {
        const before = candles[i - j]!;
        const after = candles[i + j];
        if (!after) break;

        if (current.low >= before.low || current.low >= after.low) {
          isSwingLow = false;
          break;
        }
        lowStrength = j;
      }

      // Only add if strength meets minimum requirement
      if (isSwingLow && lowStrength >= this.config.minSwingStrength) {
        swings.push({
          index: i,
          price: current.low,
          type: 'low',
          timestamp: current.timestamp,
          strength: lowStrength,
        });
      }
    }

    return swings;
  }

  /**
   * Detect sellside liquidity sweep (sweep below swing low, then reverse up)
   * This creates a LONG opportunity
   */
  private detectSellsideSweep(
    candles: Candle[],
    swings: SwingPoint[],
    candleIndex: number
  ): FreshSweep | null {
    const candle = candles[candleIndex]!;

    // Find recent swing lows that could have been swept
    const recentSwingLows = swings
      .filter(
        (s) =>
          s.type === 'low' &&
          s.index < candleIndex - 1 && // Must be before the sweep candle
          s.index > candleIndex - 50 // Not too old
      )
      .sort((a, b) => b.index - a.index); // Most recent first

    for (const swing of recentSwingLows) {
      // Check if this candle swept the swing low
      if (candle.low >= swing.price) continue; // Didn't sweep

      const sweepSize = (swing.price - candle.low) / swing.price;
      if (sweepSize < this.config.minSweepSize) continue; // Sweep too small

      // Check for bullish confirmation
      const confirmation = this.checkBullishConfirmation(candle, candles, candleIndex);
      if (!confirmation) continue;

      // Calculate entry, SL, TP
      const entryPrice = candle.close; // Enter at close of confirmation candle
      const stopLoss = candle.low * (1 - this.config.slBufferPct); // Below sweep extreme

      // Find target (next swing high)
      const nextSwingHigh = swings.find(
        (s) => s.type === 'high' && s.index < candleIndex && s.price > entryPrice
      );
      const takeProfit1 = nextSwingHigh ? nextSwingHigh.price : entryPrice * 1.01;

      // Second target
      const furtherSwingHigh = swings.find(
        (s) =>
          s.type === 'high' &&
          s.index < candleIndex &&
          s.price > takeProfit1
      );
      const takeProfit2 = furtherSwingHigh ? furtherSwingHigh.price : takeProfit1 * 1.005;

      const risk = entryPrice - stopLoss;
      const reward = takeProfit1 - entryPrice;
      const rr = risk > 0 ? reward / risk : 0;

      if (rr < this.config.minRR) continue; // R:R too low

      // Calculate quality
      const quality = this.calculateQuality(
        sweepSize,
        confirmation.rejectionSize,
        rr,
        swing.strength
      );

      return {
        id: `sweep-long-${candleIndex}-${swing.index}`,
        timestamp: candle.timestamp,
        index: candleIndex,
        sweptSwing: swing,
        sweepExtreme: candle.low,
        sweepCandle: candle,
        direction: 'long',
        confirmationType: confirmation.type,
        confirmationCandle: confirmation.candle,
        confirmationIndex: confirmation.index,
        entryPrice,
        stopLoss,
        takeProfit1,
        takeProfit2,
        riskRewardRatio: rr,
        sweepSize: sweepSize * 100,
        rejectionSize: confirmation.rejectionSize,
        bodyToWickRatio: confirmation.bodyToWickRatio,
        quality,
      };
    }

    return null;
  }

  /**
   * Detect buyside liquidity sweep (sweep above swing high, then reverse down)
   * This creates a SHORT opportunity
   */
  private detectBuysideSweep(
    candles: Candle[],
    swings: SwingPoint[],
    candleIndex: number
  ): FreshSweep | null {
    const candle = candles[candleIndex]!;

    // Find recent swing highs that could have been swept
    const recentSwingHighs = swings
      .filter(
        (s) =>
          s.type === 'high' &&
          s.index < candleIndex - 1 &&
          s.index > candleIndex - 50
      )
      .sort((a, b) => b.index - a.index);

    for (const swing of recentSwingHighs) {
      // Check if this candle swept the swing high
      if (candle.high <= swing.price) continue; // Didn't sweep

      const sweepSize = (candle.high - swing.price) / swing.price;
      if (sweepSize < this.config.minSweepSize) continue; // Sweep too small

      // Check for bearish confirmation
      const confirmation = this.checkBearishConfirmation(candle, candles, candleIndex);
      if (!confirmation) continue;

      // Calculate entry, SL, TP
      const entryPrice = candle.close;
      const stopLoss = candle.high * (1 + this.config.slBufferPct);

      // Find target (next swing low)
      const nextSwingLow = swings.find(
        (s) => s.type === 'low' && s.index < candleIndex && s.price < entryPrice
      );
      const takeProfit1 = nextSwingLow ? nextSwingLow.price : entryPrice * 0.99;

      // Second target
      const furtherSwingLow = swings.find(
        (s) =>
          s.type === 'low' &&
          s.index < candleIndex &&
          s.price < takeProfit1
      );
      const takeProfit2 = furtherSwingLow ? furtherSwingLow.price : takeProfit1 * 0.995;

      const risk = stopLoss - entryPrice;
      const reward = entryPrice - takeProfit1;
      const rr = risk > 0 ? reward / risk : 0;

      if (rr < this.config.minRR) continue;

      const quality = this.calculateQuality(
        sweepSize,
        confirmation.rejectionSize,
        rr,
        swing.strength
      );

      return {
        id: `sweep-short-${candleIndex}-${swing.index}`,
        timestamp: candle.timestamp,
        index: candleIndex,
        sweptSwing: swing,
        sweepExtreme: candle.high,
        sweepCandle: candle,
        direction: 'short',
        confirmationType: confirmation.type,
        confirmationCandle: confirmation.candle,
        confirmationIndex: confirmation.index,
        entryPrice,
        stopLoss,
        takeProfit1,
        takeProfit2,
        riskRewardRatio: rr,
        sweepSize: sweepSize * 100,
        rejectionSize: confirmation.rejectionSize,
        bodyToWickRatio: confirmation.bodyToWickRatio,
        quality,
      };
    }

    return null;
  }

  /**
   * Check for bullish confirmation (for long entries after sellside sweep)
   * STRICT: Only engulfing patterns with strong bodies
   */
  private checkBullishConfirmation(
    sweepCandle: Candle,
    candles: Candle[],
    sweepIndex: number
  ): {
    type: 'pin_bar' | 'engulfing' | 'rejection' | 'wick_rejection';
    candle: Candle;
    index: number;
    rejectionSize: number;
    bodyToWickRatio: number;
  } | null {
    const body = Math.abs(sweepCandle.close - sweepCandle.open);
    const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
    const totalRange = sweepCandle.high - sweepCandle.low;

    // Only accept VERY strong pin bars (wick must be 3x body and 60% of range)
    if (
      sweepCandle.close > sweepCandle.open && // Bullish close
      lowerWick > body * 3 && // Very long lower wick
      lowerWick > totalRange * 0.6 && // Wick dominates
      body > totalRange * 0.1 // But still has a decent body
    ) {
      return {
        type: 'pin_bar',
        candle: sweepCandle,
        index: sweepIndex,
        rejectionSize: lowerWick / totalRange,
        bodyToWickRatio: body > 0 ? lowerWick / body : 3,
      };
    }

    // Check next candle for STRONG engulfing
    const nextCandle = candles[sweepIndex + 1];
    if (nextCandle) {
      const nextBody = Math.abs(nextCandle.close - nextCandle.open);
      const nextRange = nextCandle.high - nextCandle.low;

      // Strong engulfing: next candle must be bullish and completely engulf sweep candle body
      if (
        nextCandle.close > nextCandle.open && // Bullish
        nextCandle.close > sweepCandle.high && // Closes ABOVE sweep high (strong)
        nextCandle.open <= sweepCandle.low && // Opens at or below sweep low
        nextBody > body * 1.5 && // Next body is 1.5x bigger
        nextBody > nextRange * 0.5 // Body is at least half of next candle range
      ) {
        return {
          type: 'engulfing',
          candle: nextCandle,
          index: sweepIndex + 1,
          rejectionSize: nextBody / (body || 1),
          bodyToWickRatio: nextBody / (body || 1),
        };
      }
    }

    return null;
  }

  /**
   * Check for bearish confirmation (for short entries after buyside sweep)
   * STRICT: Only strong pin bars and engulfing patterns
   */
  private checkBearishConfirmation(
    sweepCandle: Candle,
    candles: Candle[],
    sweepIndex: number
  ): {
    type: 'pin_bar' | 'engulfing' | 'rejection' | 'wick_rejection';
    candle: Candle;
    index: number;
    rejectionSize: number;
    bodyToWickRatio: number;
  } | null {
    const body = Math.abs(sweepCandle.close - sweepCandle.open);
    const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);
    const totalRange = sweepCandle.high - sweepCandle.low;

    // Only accept VERY strong pin bars (wick must be 3x body and 60% of range)
    if (
      sweepCandle.close < sweepCandle.open && // Bearish close
      upperWick > body * 3 && // Very long upper wick
      upperWick > totalRange * 0.6 && // Wick dominates
      body > totalRange * 0.1 // But still has a decent body
    ) {
      return {
        type: 'pin_bar',
        candle: sweepCandle,
        index: sweepIndex,
        rejectionSize: upperWick / totalRange,
        bodyToWickRatio: body > 0 ? upperWick / body : 3,
      };
    }

    // Check next candle for STRONG engulfing
    const nextCandle = candles[sweepIndex + 1];
    if (nextCandle) {
      const nextBody = Math.abs(nextCandle.close - nextCandle.open);
      const nextRange = nextCandle.high - nextCandle.low;

      // Strong engulfing: next candle must be bearish and completely engulf sweep candle body
      if (
        nextCandle.close < nextCandle.open && // Bearish
        nextCandle.close < sweepCandle.low && // Closes BELOW sweep low (strong)
        nextCandle.open >= sweepCandle.high && // Opens at or above sweep high
        nextBody > body * 1.5 && // Next body is 1.5x bigger
        nextBody > nextRange * 0.5 // Body is at least half of next candle range
      ) {
        return {
          type: 'engulfing',
          candle: nextCandle,
          index: sweepIndex + 1,
          rejectionSize: nextBody / (body || 1),
          bodyToWickRatio: nextBody / (body || 1),
        };
      }
    }

    return null;
  }

  /**
   * Calculate opportunity quality
   */
  private calculateQuality(
    sweepSize: number,
    rejectionSize: number,
    rr: number,
    swingStrength: number
  ): 'A+' | 'A' | 'B' {
    let score = 0;

    // Sweep size (0-2 points)
    if (sweepSize > 0.002) score += 2;
    else if (sweepSize > 0.001) score += 1;

    // Rejection size (0-2 points)
    if (rejectionSize > 0.7) score += 2;
    else if (rejectionSize > 0.5) score += 1;

    // R:R (0-2 points)
    if (rr > 2.5) score += 2;
    else if (rr > 1.8) score += 1;

    // Swing strength (0-2 points)
    if (swingStrength >= 8) score += 2;
    else if (swingStrength >= 5) score += 1;

    if (score >= 6) return 'A+';
    if (score >= 4) return 'A';
    return 'B';
  }
}

/**
 * Quick detection function
 */
export function detectFreshSweeps(
  candles: Candle[],
  config?: Partial<FreshSweepDetectorConfig>
): FreshSweep[] {
  const detector = new FreshSweepDetector(config);
  return detector.detect(candles);
}
