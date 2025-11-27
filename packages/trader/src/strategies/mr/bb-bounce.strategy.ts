/**
 * BB Bounce Mean Reversion Strategy
 *
 * Classic Bollinger Band bounce strategy with rejection candle confirmation.
 * Does NOT require squeeze - enters on band touch with rejection pattern.
 *
 * Entry Conditions:
 * - LONG: Low <= Lower BB + Close > Open (bullish candle) + Close > Lower BB
 *         + Previous candle did NOT touch band + ADX < 25
 * - SHORT: High >= Upper BB + Close < Open (bearish candle) + Close < Upper BB
 *          + Previous candle did NOT touch band + ADX < 25
 *
 * Exit Conditions:
 * - Take Profit: Middle BB (SMA 20)
 * - Stop Loss: Low/High of entry candle ± 0.3×ATR (optimized from 0.5×)
 * - Time Exit: 10 bars
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
import { BollingerBands } from 'technicalindicators';

// ============================================================================
// TYPES
// ============================================================================

/**
 * BB Bounce specific parameters
 */
export interface BBBounceParams extends MRStrategyParams {
  // Bollinger Bands
  bbPeriod: number;
  bbStdDev: number;

  // Stop loss buffer (x ATR added to candle high/low)
  slBuffer: number;

  // Take profit percentage (if set, use fixed % instead of BB Middle)
  takeProfitPct?: number; // e.g., 0.005 = 0.5%

  // RSI filter thresholds (if set, only enter when RSI is extreme)
  rsiOversold?: number; // e.g., 30 - only LONG when RSI < this
  rsiOverbought?: number; // e.g., 70 - only SHORT when RSI > this

  // Require rejection candle (close back inside band)
  requireRejection: boolean;

  // Require previous candle NOT touching band
  requireCleanApproach: boolean;
}

/**
 * Extended indicators for BB Bounce
 */
interface BBBounceIndicators extends IndicatorSnapshot {
  // Current candle info
  isRejectionBullish: boolean;
  isRejectionBearish: boolean;
  candleLow: number;
  candleHigh: number;
  candleOpen: number;

  // Previous candle info
  prevTouchedLower: boolean;
  prevTouchedUpper: boolean;
}

// ============================================================================
// STRATEGY IMPLEMENTATION
// ============================================================================

export class BBBounceStrategy extends MRStrategyBase {
  private specificParams: BBBounceParams;

  constructor(params: Partial<BBBounceParams> = {}) {
    super(params);

    this.specificParams = {
      ...this.params,
      bbPeriod: params.bbPeriod ?? 20,
      bbStdDev: params.bbStdDev ?? 2,
      slBuffer: params.slBuffer ?? 0.3, // Optimized: reduced from 0.5 to 0.3 based on backtest analysis
      requireRejection: params.requireRejection ?? true,
      requireCleanApproach: params.requireCleanApproach ?? true,
    };
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================================

  getName(): string {
    return 'BB_BOUNCE';
  }

  getDefaultParams(): Partial<MRStrategyParams> {
    return {
      atrPeriod: 14,
      adxPeriod: 14,
      rsiPeriod: 14,
      emaPeriod: 20,
      adxThreshold: 25,
      slMultiplier: 1.0, // Will be overridden by candle-based SL
      maxBars: 10,
      minCandles: 30,
    };
  }

  checkEntry(candles: Candle[], indicators: IndicatorSnapshot): MRTradeSignal | null {
    // Calculate BB Bounce specific indicators
    const bounceIndicators = this.calculateBBBounceIndicators(candles, indicators);
    if (!bounceIndicators) return null;

    const {
      price,
      adx,
      atr,
      rsi,
      bbUpper,
      bbLower,
      bbMiddle,
      isRejectionBullish,
      isRejectionBearish,
      candleLow,
      candleHigh,
      prevTouchedLower,
      prevTouchedUpper,
    } = bounceIndicators;

    // Must be in ranging market
    if (!this.isRangingMarket(adx)) {
      return null;
    }

    // RSI filter: only enter when RSI is extreme (if thresholds are set)
    const rsiFilterLong = !this.specificParams.rsiOversold || (rsi !== undefined && rsi < this.specificParams.rsiOversold);
    const rsiFilterShort = !this.specificParams.rsiOverbought || (rsi !== undefined && rsi > this.specificParams.rsiOverbought);

    // LONG: Touch lower band with bullish rejection
    const touchedLower = candleLow <= bbLower;
    const closedAboveLower = price > bbLower;
    const cleanApproachLong = !this.specificParams.requireCleanApproach || !prevTouchedLower;
    const validRejectionLong = !this.specificParams.requireRejection || isRejectionBullish;

    if (touchedLower && closedAboveLower && cleanApproachLong && validRejectionLong && rsiFilterLong) {
      // SL below candle low with buffer
      const stopLoss = candleLow - atr * this.specificParams.slBuffer;
      // Use fixed TP percentage if set, otherwise use BB Middle
      const takeProfit = this.specificParams.takeProfitPct
        ? price * (1 + this.specificParams.takeProfitPct)
        : bbMiddle;

      return {
        direction: 'LONG',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(adx, isRejectionBullish),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          adx,
          atr,
          bbLower,
          bbMiddle,
          bbUpper,
          candleLow,
          isRejectionBullish,
          prevTouchedLower,
        },
      };
    }

    // SHORT: Touch upper band with bearish rejection
    const touchedUpper = candleHigh >= bbUpper;
    const closedBelowUpper = price < bbUpper;
    const cleanApproachShort = !this.specificParams.requireCleanApproach || !prevTouchedUpper;
    const validRejectionShort = !this.specificParams.requireRejection || isRejectionBearish;

    if (touchedUpper && closedBelowUpper && cleanApproachShort && validRejectionShort && rsiFilterShort) {
      // SL above candle high with buffer
      const stopLoss = candleHigh + atr * this.specificParams.slBuffer;
      // Use fixed TP percentage if set, otherwise use BB Middle
      const takeProfit = this.specificParams.takeProfitPct
        ? price * (1 - this.specificParams.takeProfitPct)
        : bbMiddle;

      return {
        direction: 'SHORT',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(adx, isRejectionBearish),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          adx,
          atr,
          bbLower,
          bbMiddle,
          bbUpper,
          candleHigh,
          isRejectionBearish,
          prevTouchedUpper,
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
    const { price, bbMiddle } = indicators;

    // Exit at middle BB (target reached)
    if (trade.direction === 'LONG') {
      if (price >= bbMiddle) {
        return 'SIGNAL';
      }
    } else {
      if (price <= bbMiddle) {
        return 'SIGNAL';
      }
    }

    return null;
  }

  // ============================================================================
  // BB BOUNCE SPECIFIC METHODS
  // ============================================================================

  /**
   * Calculate BB Bounce specific indicators
   */
  private calculateBBBounceIndicators(
    candles: Candle[],
    baseIndicators: IndicatorSnapshot
  ): BBBounceIndicators | null {
    try {
      if (candles.length < 2) return null;

      const closes = candles.map((c) => c.close);

      // Calculate Bollinger Bands
      const bbResult = BollingerBands.calculate({
        period: this.specificParams.bbPeriod,
        values: closes,
        stdDev: this.specificParams.bbStdDev,
      });

      if (bbResult.length < 2) return null;

      const currentBB = bbResult[bbResult.length - 1]!;
      const prevBB = bbResult[bbResult.length - 2]!;

      const currentCandle = candles[candles.length - 1]!;
      const prevCandle = candles[candles.length - 2]!;

      // Check rejection pattern (close vs open)
      const isRejectionBullish = currentCandle.close > currentCandle.open;
      const isRejectionBearish = currentCandle.close < currentCandle.open;

      // Check if previous candle touched bands
      const prevTouchedLower = prevCandle.low <= prevBB.lower;
      const prevTouchedUpper = prevCandle.high >= prevBB.upper;

      return {
        ...baseIndicators,
        bbUpper: currentBB.upper,
        bbMiddle: currentBB.middle,
        bbLower: currentBB.lower,
        isRejectionBullish,
        isRejectionBearish,
        candleLow: currentCandle.low,
        candleHigh: currentCandle.high,
        candleOpen: currentCandle.open,
        prevTouchedLower,
        prevTouchedUpper,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate signal confidence
   */
  private calculateConfidence(adx: number, hasRejection: boolean): number {
    let confidence = 0.5;

    // Strong rejection pattern increases confidence
    if (hasRejection) {
      confidence += 0.15;
    }

    // Lower ADX (more ranging) = higher confidence
    if (adx < 15) {
      confidence += 0.15;
    } else if (adx < 20) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.9);
  }

  // ============================================================================
  // PARAMETER GETTERS
  // ============================================================================

  getBBBounceParams(): BBBounceParams {
    return { ...this.specificParams };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create BB Bounce strategy with default or custom parameters
 */
export function createBBBounce(params?: Partial<BBBounceParams>): BBBounceStrategy {
  return new BBBounceStrategy(params);
}

/**
 * Parameter ranges for optimization
 */
export const BB_BOUNCE_PARAM_RANGES = {
  bbPeriod: [15, 20, 25, 30],
  bbStdDev: [1.5, 2.0, 2.5, 3.0],
  slBuffer: [0.3, 0.5, 0.8, 1.0],
  maxBars: [6, 10, 15],
  adxThreshold: [20, 25, 30],
};
