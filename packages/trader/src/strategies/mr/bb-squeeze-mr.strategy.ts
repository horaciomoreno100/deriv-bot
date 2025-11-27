/**
 * BB Squeeze Mean Reversion Strategy
 *
 * Mean reversion strategy based on Bollinger Band squeeze detection.
 * Enters when BB is inside Keltner Channel (low volatility) and price
 * touches BB bands with RSI confirmation.
 *
 * Entry Conditions:
 * - LONG: Squeeze active + Close <= Lower BB + RSI < 30 + ADX < 25
 * - SHORT: Squeeze active + Close >= Upper BB + RSI > 70 + ADX < 25
 *
 * Exit Conditions:
 * - Take Profit: EMA(20) or Middle BB
 * - Stop Loss: 1.5 × ATR
 * - Time Exit: 12 bars
 */

import type { Candle } from '@deriv-bot/shared';
import {
  MRStrategyBase,
  type MRStrategyParams,
  type MRTradeSignal,
  type IndicatorSnapshot,
  type ActiveTrade,
  type ExitReason,
} from '../../strategy/mr-strategy-base.js';
import { BollingerBands, ATR } from 'technicalindicators';

// ============================================================================
// TYPES
// ============================================================================

/**
 * BB Squeeze specific parameters
 */
export interface BBSqueezeMRParams extends MRStrategyParams {
  // Bollinger Bands
  bbPeriod: number;
  bbStdDev: number;

  // Keltner Channel
  kcPeriod: number;
  kcMultiplier: number;

  // RSI thresholds
  rsiOversold: number;
  rsiOverbought: number;

  // Squeeze detection
  squeezeRecencyBars: number;
}

/**
 * Keltner Channel values
 */
interface KeltnerChannel {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Extended indicators for BB Squeeze
 */
interface BBSqueezeIndicators extends IndicatorSnapshot {
  kcUpper: number;
  kcMiddle: number;
  kcLower: number;
  isInSqueeze: boolean;
  wasRecentlyInSqueeze: boolean;
}

// ============================================================================
// STRATEGY IMPLEMENTATION
// ============================================================================

export class BBSqueezeMRStrategy extends MRStrategyBase {
  private squeezeHistory: boolean[] = [];
  private specificParams: BBSqueezeMRParams;

  constructor(params: Partial<BBSqueezeMRParams> = {}) {
    super(params);

    this.specificParams = {
      ...this.params,
      bbPeriod: params.bbPeriod ?? 20,
      bbStdDev: params.bbStdDev ?? 2,
      kcPeriod: params.kcPeriod ?? 20,
      kcMultiplier: params.kcMultiplier ?? 1.5,
      rsiOversold: params.rsiOversold ?? 30,
      rsiOverbought: params.rsiOverbought ?? 70,
      squeezeRecencyBars: params.squeezeRecencyBars ?? 5,
    };
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================================

  getName(): string {
    return 'BB_SQUEEZE_MR';
  }

  getDefaultParams(): Partial<MRStrategyParams> {
    return {
      atrPeriod: 14,
      adxPeriod: 14,
      rsiPeriod: 14,
      emaPeriod: 20,
      adxThreshold: 25,
      slMultiplier: 1.5,
      maxBars: 12,
      minCandles: 50,
    };
  }

  checkEntry(candles: Candle[], indicators: IndicatorSnapshot): MRTradeSignal | null {
    // Calculate BB Squeeze specific indicators
    const bbsIndicators = this.calculateBBSqueezeIndicators(candles, indicators);
    if (!bbsIndicators) return null;

    const { price, rsi, adx, atr, bbUpper, bbLower, bbMiddle, ema } = bbsIndicators;
    const { isInSqueeze, wasRecentlyInSqueeze, kcUpper, kcLower } = bbsIndicators;

    // Must be in or recently exited a squeeze
    if (!isInSqueeze && !wasRecentlyInSqueeze) {
      return null;
    }

    // Must be in ranging market
    if (!this.isRangingMarket(adx)) {
      return null;
    }

    // LONG: Price at lower BB + RSI oversold
    if (price <= bbLower && rsi < this.specificParams.rsiOversold) {
      const stopLoss = this.calculateSL('LONG', price, atr);
      const takeProfit = Math.min(ema, bbMiddle); // Exit at EMA or middle BB

      return {
        direction: 'LONG',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(rsi, adx, isInSqueeze),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          rsi,
          adx,
          bbLower,
          bbUpper,
          kcLower,
          kcUpper,
          isInSqueeze,
          wasRecentlyInSqueeze,
          atr,
        },
      };
    }

    // SHORT: Price at upper BB + RSI overbought
    if (price >= bbUpper && rsi > this.specificParams.rsiOverbought) {
      const stopLoss = this.calculateSL('SHORT', price, atr);
      const takeProfit = Math.max(ema, bbMiddle); // Exit at EMA or middle BB

      return {
        direction: 'SHORT',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(rsi, adx, isInSqueeze),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          rsi,
          adx,
          bbLower,
          bbUpper,
          kcLower,
          kcUpper,
          isInSqueeze,
          wasRecentlyInSqueeze,
          atr,
        },
      };
    }

    return null;
  }

  checkExit(
    _candles: Candle[],
    indicators: IndicatorSnapshot,
    trade: ActiveTrade
  ): ExitReason | null {
    const { price, ema, bbMiddle } = indicators;

    // Exit at EMA or middle BB (whichever is closer to entry)
    if (trade.direction === 'LONG') {
      // Price reached mean (EMA or middle BB)
      if (price >= ema || price >= bbMiddle) {
        return 'SIGNAL';
      }
    } else {
      // Price reached mean (EMA or middle BB)
      if (price <= ema || price <= bbMiddle) {
        return 'SIGNAL';
      }
    }

    return null;
  }

  // ============================================================================
  // BB SQUEEZE SPECIFIC METHODS
  // ============================================================================

  /**
   * Calculate BB Squeeze specific indicators
   */
  private calculateBBSqueezeIndicators(
    candles: Candle[],
    baseIndicators: IndicatorSnapshot
  ): BBSqueezeIndicators | null {
    try {
      const closes = candles.map((c) => c.close);

      // Calculate Bollinger Bands
      const bbResult = BollingerBands.calculate({
        period: this.specificParams.bbPeriod,
        values: closes,
        stdDev: this.specificParams.bbStdDev,
      });

      // Calculate Keltner Channels
      const kcResult = this.calculateKeltnerChannels(candles);

      if (!bbResult.length || !kcResult.length) return null;

      const bb = bbResult[bbResult.length - 1]!;
      const kc = kcResult[kcResult.length - 1]!;

      // Detect squeeze
      const isInSqueeze = bb.upper < kc.upper && bb.lower > kc.lower;

      // Update squeeze history
      this.squeezeHistory.push(isInSqueeze);
      if (this.squeezeHistory.length > this.specificParams.squeezeRecencyBars) {
        this.squeezeHistory.shift();
      }

      // Check if recently in squeeze
      const wasRecentlyInSqueeze = this.squeezeHistory.some((s) => s);

      return {
        ...baseIndicators,
        bbUpper: bb.upper,
        bbMiddle: bb.middle,
        bbLower: bb.lower,
        kcUpper: kc.upper,
        kcMiddle: kc.middle,
        kcLower: kc.lower,
        isInSqueeze,
        wasRecentlyInSqueeze,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate Keltner Channels
   */
  private calculateKeltnerChannels(candles: Candle[]): KeltnerChannel[] {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    // Calculate EMA for middle line
    const ema = this.calculateEMAValues(closes, this.specificParams.kcPeriod);

    // Calculate ATR
    const atrResult = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.specificParams.kcPeriod,
    });

    const channels: KeltnerChannel[] = [];
    const offset = closes.length - atrResult.length;

    for (let i = 0; i < atrResult.length; i++) {
      const middle = ema[i + offset];
      const atr = atrResult[i];

      if (middle !== undefined && atr !== undefined) {
        channels.push({
          upper: middle + atr * this.specificParams.kcMultiplier,
          middle,
          lower: middle - atr * this.specificParams.kcMultiplier,
        });
      }
    }

    return channels;
  }

  /**
   * Calculate EMA values
   */
  private calculateEMAValues(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray: number[] = [];

    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    emaArray.push(ema);

    for (let i = period; i < values.length; i++) {
      const value = values[i];
      if (value !== undefined) {
        ema = value * k + ema * (1 - k);
        emaArray.push(ema);
      }
    }

    return emaArray;
  }

  /**
   * Calculate signal confidence
   */
  private calculateConfidence(rsi: number, adx: number, isInSqueeze: boolean): number {
    let confidence = 0.5;

    // RSI extremes increase confidence
    if (rsi < 20 || rsi > 80) {
      confidence += 0.15;
    } else if (rsi < 25 || rsi > 75) {
      confidence += 0.1;
    }

    // Lower ADX (more ranging) increases confidence
    if (adx < 15) {
      confidence += 0.15;
    } else if (adx < 20) {
      confidence += 0.1;
    }

    // Active squeeze increases confidence
    if (isInSqueeze) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95);
  }

  // ============================================================================
  // PARAMETER GETTERS
  // ============================================================================

  getBBSqueezeParams(): BBSqueezeMRParams {
    return { ...this.specificParams };
  }

  override reset(): void {
    super.reset();
    this.squeezeHistory = [];
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create BB Squeeze MR strategy with default or custom parameters
 */
export function createBBSqueezeMR(params?: Partial<BBSqueezeMRParams>): BBSqueezeMRStrategy {
  return new BBSqueezeMRStrategy(params);
}

/**
 * Parameter ranges for optimization
 */
export const BB_SQUEEZE_MR_PARAM_RANGES = {
  bbPeriod: [15, 20, 25, 30],
  bbStdDev: [1.5, 2.0, 2.5],
  kcMultiplier: [1.0, 1.5, 2.0, 2.5],
  rsiPeriod: [7, 14, 21],
  rsiOversold: [25, 30, 35],
  rsiOverbought: [65, 70, 75],
  slMultiplier: [1.0, 1.5, 2.0, 2.5],
  maxBars: [6, 12, 18, 24],
  adxThreshold: [20, 25, 30],
};
