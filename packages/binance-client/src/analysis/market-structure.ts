/**
 * Market Structure Detector
 *
 * Detects:
 * - Swing Highs (HH, LH)
 * - Swing Lows (HL, LL)
 * - Break of Structure (BOS)
 * - Change of Character (CHoCH)
 * - Current trend/bias
 */

import type { Bar } from '../binance-client.js';

export interface SwingPoint {
  index: number;
  timestamp: Date;
  price: number;
  type: 'high' | 'low';
  label: 'HH' | 'LH' | 'HL' | 'LL' | null; // null for first points
}

export interface StructureBreak {
  index: number;
  timestamp: Date;
  price: number;
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  brokenLevel: number;
  swingIndex: number; // Index of the broken swing point
}

export interface MarketStructure {
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  structureBreaks: StructureBreak[];
  currentTrend: 'bullish' | 'bearish' | 'neutral';
  lastHH: SwingPoint | null;
  lastHL: SwingPoint | null;
  lastLH: SwingPoint | null;
  lastLL: SwingPoint | null;
}

export interface MarketStructureConfig {
  swingStrength: number; // Number of candles on each side to confirm swing (default: 3)
  minSwingSize: number; // Minimum size of swing in % (default: 0.1%)
}

const DEFAULT_CONFIG: MarketStructureConfig = {
  swingStrength: 3,
  minSwingSize: 0.1,
};

export class MarketStructureDetector {
  private config: MarketStructureConfig;

  constructor(config: Partial<MarketStructureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze market structure from candles
   */
  analyze(candles: Bar[]): MarketStructure {
    if (candles.length < this.config.swingStrength * 2 + 1) {
      return {
        swingHighs: [],
        swingLows: [],
        structureBreaks: [],
        currentTrend: 'neutral',
        lastHH: null,
        lastHL: null,
        lastLH: null,
        lastLL: null,
      };
    }

    // Step 1: Find all swing points
    const swingHighs = this.findSwingHighs(candles);
    const swingLows = this.findSwingLows(candles);

    // Step 2: Label swing points (HH, LH, HL, LL)
    this.labelSwingHighs(swingHighs);
    this.labelSwingLows(swingLows);

    // Step 3: Detect structure breaks (BOS, CHoCH)
    const structureBreaks = this.detectStructureBreaks(candles, swingHighs, swingLows);

    // Step 4: Determine current trend
    const currentTrend = this.determineTrend(swingHighs, swingLows, structureBreaks);

    // Get last labeled swings
    const lastHH = this.findLastByLabel(swingHighs, 'HH');
    const lastHL = this.findLastByLabel(swingLows, 'HL');
    const lastLH = this.findLastByLabel(swingHighs, 'LH');
    const lastLL = this.findLastByLabel(swingLows, 'LL');

    return {
      swingHighs,
      swingLows,
      structureBreaks,
      currentTrend,
      lastHH,
      lastHL,
      lastLH,
      lastLL,
    };
  }

  /**
   * Find swing highs (local maxima)
   */
  private findSwingHighs(candles: Bar[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const strength = this.config.swingStrength;

    for (let i = strength; i < candles.length - strength; i++) {
      const current = candles[i];
      let isSwingHigh = true;

      // Check left side
      for (let j = 1; j <= strength; j++) {
        if (candles[i - j].high >= current.high) {
          isSwingHigh = false;
          break;
        }
      }

      // Check right side
      if (isSwingHigh) {
        for (let j = 1; j <= strength; j++) {
          if (candles[i + j].high >= current.high) {
            isSwingHigh = false;
            break;
          }
        }
      }

      if (isSwingHigh) {
        swings.push({
          index: i,
          timestamp: current.timestamp,
          price: current.high,
          type: 'high',
          label: null,
        });
      }
    }

    return swings;
  }

  /**
   * Find swing lows (local minima)
   */
  private findSwingLows(candles: Bar[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const strength = this.config.swingStrength;

    for (let i = strength; i < candles.length - strength; i++) {
      const current = candles[i];
      let isSwingLow = true;

      // Check left side
      for (let j = 1; j <= strength; j++) {
        if (candles[i - j].low <= current.low) {
          isSwingLow = false;
          break;
        }
      }

      // Check right side
      if (isSwingLow) {
        for (let j = 1; j <= strength; j++) {
          if (candles[i + j].low <= current.low) {
            isSwingLow = false;
            break;
          }
        }
      }

      if (isSwingLow) {
        swings.push({
          index: i,
          timestamp: current.timestamp,
          price: current.low,
          type: 'low',
          label: null,
        });
      }
    }

    return swings;
  }

  /**
   * Label swing highs as HH (Higher High) or LH (Lower High)
   */
  private labelSwingHighs(swings: SwingPoint[]): void {
    for (let i = 1; i < swings.length; i++) {
      const current = swings[i];
      const previous = swings[i - 1];

      if (current.price > previous.price) {
        current.label = 'HH';
      } else {
        current.label = 'LH';
      }
    }
  }

  /**
   * Label swing lows as HL (Higher Low) or LL (Lower Low)
   */
  private labelSwingLows(swings: SwingPoint[]): void {
    for (let i = 1; i < swings.length; i++) {
      const current = swings[i];
      const previous = swings[i - 1];

      if (current.price > previous.price) {
        current.label = 'HL';
      } else {
        current.label = 'LL';
      }
    }
  }

  /**
   * Detect Break of Structure (BOS) and Change of Character (CHoCH)
   */
  private detectStructureBreaks(
    candles: Bar[],
    swingHighs: SwingPoint[],
    swingLows: SwingPoint[]
  ): StructureBreak[] {
    const breaks: StructureBreak[] = [];

    // Track the trend state
    let currentTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    // Combine and sort all swings by index
    const allSwings = [...swingHighs, ...swingLows].sort((a, b) => a.index - b.index);

    // For each candle after each swing, check if it breaks the swing level
    for (let i = 0; i < allSwings.length; i++) {
      const swing = allSwings[i];

      // Look for breaks of this swing in subsequent candles
      for (let j = swing.index + 1; j < candles.length; j++) {
        const candle = candles[j];

        if (swing.type === 'high') {
          // Check if price breaks above the swing high
          if (candle.close > swing.price) {
            // Determine if this is BOS or CHoCH
            const isCHoCH = currentTrend === 'bearish';
            const breakType = isCHoCH ? 'CHoCH' : 'BOS';

            // Only record if this swing hasn't been broken before
            const alreadyBroken = breaks.some(
              (b) => b.swingIndex === swing.index && b.direction === 'bullish'
            );

            if (!alreadyBroken) {
              breaks.push({
                index: j,
                timestamp: candle.timestamp,
                price: candle.close,
                type: breakType,
                direction: 'bullish',
                brokenLevel: swing.price,
                swingIndex: swing.index,
              });

              if (isCHoCH) {
                currentTrend = 'bullish';
              } else if (currentTrend === 'neutral') {
                currentTrend = 'bullish';
              }
            }
            break; // Move to next swing
          }
        } else {
          // swing.type === 'low'
          // Check if price breaks below the swing low
          if (candle.close < swing.price) {
            // Determine if this is BOS or CHoCH
            const isCHoCH = currentTrend === 'bullish';
            const breakType = isCHoCH ? 'CHoCH' : 'BOS';

            // Only record if this swing hasn't been broken before
            const alreadyBroken = breaks.some(
              (b) => b.swingIndex === swing.index && b.direction === 'bearish'
            );

            if (!alreadyBroken) {
              breaks.push({
                index: j,
                timestamp: candle.timestamp,
                price: candle.close,
                type: breakType,
                direction: 'bearish',
                brokenLevel: swing.price,
                swingIndex: swing.index,
              });

              if (isCHoCH) {
                currentTrend = 'bearish';
              } else if (currentTrend === 'neutral') {
                currentTrend = 'bearish';
              }
            }
            break; // Move to next swing
          }
        }
      }
    }

    return breaks.sort((a, b) => a.index - b.index);
  }

  /**
   * Determine current market trend based on structure
   */
  private determineTrend(
    swingHighs: SwingPoint[],
    swingLows: SwingPoint[],
    structureBreaks: StructureBreak[]
  ): 'bullish' | 'bearish' | 'neutral' {
    // Get recent swings (last 4 of each)
    const recentHighs = swingHighs.slice(-4);
    const recentLows = swingLows.slice(-4);

    // Count HH/LH and HL/LL
    const hhCount = recentHighs.filter((s) => s.label === 'HH').length;
    const lhCount = recentHighs.filter((s) => s.label === 'LH').length;
    const hlCount = recentLows.filter((s) => s.label === 'HL').length;
    const llCount = recentLows.filter((s) => s.label === 'LL').length;

    // Check last CHoCH
    const lastChoch = structureBreaks.filter((b) => b.type === 'CHoCH').pop();

    if (lastChoch) {
      return lastChoch.direction;
    }

    // Bullish: HH + HL pattern
    if (hhCount >= 2 && hlCount >= 2) {
      return 'bullish';
    }

    // Bearish: LH + LL pattern
    if (lhCount >= 2 && llCount >= 2) {
      return 'bearish';
    }

    return 'neutral';
  }

  /**
   * Find last swing with specific label
   */
  private findLastByLabel(
    swings: SwingPoint[],
    label: 'HH' | 'LH' | 'HL' | 'LL'
  ): SwingPoint | null {
    for (let i = swings.length - 1; i >= 0; i--) {
      if (swings[i].label === label) {
        return swings[i];
      }
    }
    return null;
  }
}
