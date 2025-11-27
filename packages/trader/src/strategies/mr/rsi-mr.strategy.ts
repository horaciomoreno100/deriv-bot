/**
 * RSI Mean Reversion Strategy
 *
 * Pure RSI-based mean reversion strategy.
 * Enters on extreme RSI readings with confirmation of recent cross.
 *
 * Entry Conditions:
 * - LONG: RSI < 25 + RSI crossed below 30 in last 3 bars + ADX < 25
 * - SHORT: RSI > 75 + RSI crossed above 70 in last 3 bars + ADX < 25
 *
 * Exit Conditions:
 * - Take Profit: RSI crosses level 50
 * - Stop Loss: 2.0 × ATR
 * - Time Exit: 20 bars
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
import { RSI } from 'technicalindicators';

// ============================================================================
// TYPES
// ============================================================================

/**
 * RSI MR specific parameters
 */
export interface RSIMRParams extends MRStrategyParams {
  // RSI thresholds
  rsiOversold: number;
  rsiOverbought: number;
  rsiExitLevel: number;

  // Entry confirmation
  rsiCrossLookback: number;
  rsiCrossThreshold: number;
}

/**
 * Extended indicators for RSI MR
 */
interface RSIMRIndicators extends IndicatorSnapshot {
  rsiHistory: number[];
  hadRecentOversoldCross: boolean;
  hadRecentOverboughtCross: boolean;
}

// ============================================================================
// STRATEGY IMPLEMENTATION
// ============================================================================

export class RSIMRStrategy extends MRStrategyBase {
  private rsiHistory: number[] = [];
  private specificParams: RSIMRParams;

  constructor(params: Partial<RSIMRParams> = {}) {
    super(params);

    this.specificParams = {
      ...this.params,
      rsiOversold: params.rsiOversold ?? 25,
      rsiOverbought: params.rsiOverbought ?? 75,
      rsiExitLevel: params.rsiExitLevel ?? 50,
      rsiCrossLookback: params.rsiCrossLookback ?? 3,
      rsiCrossThreshold: params.rsiCrossThreshold ?? 30,
    };
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================================

  getName(): string {
    return 'RSI_MR';
  }

  getDefaultParams(): Partial<MRStrategyParams> {
    return {
      atrPeriod: 14,
      adxPeriod: 14,
      rsiPeriod: 14,
      emaPeriod: 20,
      adxThreshold: 25,
      slMultiplier: 2.0,
      maxBars: 20,
      minCandles: 50,
    };
  }

  checkEntry(candles: Candle[], indicators: IndicatorSnapshot): MRTradeSignal | null {
    // Calculate RSI MR specific indicators
    const rsiIndicators = this.calculateRSIMRIndicators(candles, indicators);
    if (!rsiIndicators) return null;

    const { price, rsi, adx, atr, ema } = rsiIndicators;
    const { hadRecentOversoldCross, hadRecentOverboughtCross } = rsiIndicators;

    // Must be in ranging market
    if (!this.isRangingMarket(adx)) {
      return null;
    }

    // LONG: RSI extremely oversold + recent cross below threshold
    if (rsi < this.specificParams.rsiOversold && hadRecentOversoldCross) {
      const stopLoss = this.calculateSL('LONG', price, atr);
      const takeProfit = ema; // Target is EMA (mean)

      return {
        direction: 'LONG',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(rsi, adx, 'LONG'),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          rsi,
          adx,
          atr,
          hadRecentOversoldCross,
          rsiExitLevel: this.specificParams.rsiExitLevel,
        },
      };
    }

    // SHORT: RSI extremely overbought + recent cross above threshold
    if (rsi > this.specificParams.rsiOverbought && hadRecentOverboughtCross) {
      const stopLoss = this.calculateSL('SHORT', price, atr);
      const takeProfit = ema; // Target is EMA (mean)

      return {
        direction: 'SHORT',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(rsi, adx, 'SHORT'),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          rsi,
          adx,
          atr,
          hadRecentOverboughtCross,
          rsiExitLevel: this.specificParams.rsiExitLevel,
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
    const { rsi } = indicators;

    // Exit when RSI crosses the exit level (mean reversion complete)
    if (trade.direction === 'LONG') {
      // RSI rose back above exit level
      if (rsi >= this.specificParams.rsiExitLevel) {
        return 'SIGNAL';
      }
    } else {
      // RSI fell back below exit level
      if (rsi <= this.specificParams.rsiExitLevel) {
        return 'SIGNAL';
      }
    }

    return null;
  }

  // ============================================================================
  // RSI MR SPECIFIC METHODS
  // ============================================================================

  /**
   * Calculate RSI MR specific indicators
   */
  private calculateRSIMRIndicators(
    candles: Candle[],
    baseIndicators: IndicatorSnapshot
  ): RSIMRIndicators | null {
    try {
      const closes = candles.map((c) => c.close);

      // Calculate RSI
      const rsiResult = RSI.calculate({
        period: this.params.rsiPeriod,
        values: closes,
      });

      if (rsiResult.length < this.specificParams.rsiCrossLookback + 1) {
        return null;
      }

      // Get recent RSI history
      const recentRSI = rsiResult.slice(-this.specificParams.rsiCrossLookback - 1);

      // Update internal RSI history
      this.rsiHistory.push(baseIndicators.rsi);
      if (this.rsiHistory.length > 10) {
        this.rsiHistory.shift();
      }

      // Check for recent crosses
      const hadRecentOversoldCross = this.checkRecentCrossBelow(
        recentRSI,
        this.specificParams.rsiCrossThreshold
      );

      const hadRecentOverboughtCross = this.checkRecentCrossAbove(
        recentRSI,
        100 - this.specificParams.rsiCrossThreshold
      );

      return {
        ...baseIndicators,
        rsiHistory: [...this.rsiHistory],
        hadRecentOversoldCross,
        hadRecentOverboughtCross,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if RSI crossed below a threshold in recent bars
   */
  private checkRecentCrossBelow(rsiValues: number[], threshold: number): boolean {
    for (let i = 1; i < rsiValues.length; i++) {
      const prev = rsiValues[i - 1];
      const curr = rsiValues[i];
      if (prev !== undefined && curr !== undefined) {
        if (prev >= threshold && curr < threshold) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if RSI crossed above a threshold in recent bars
   */
  private checkRecentCrossAbove(rsiValues: number[], threshold: number): boolean {
    for (let i = 1; i < rsiValues.length; i++) {
      const prev = rsiValues[i - 1];
      const curr = rsiValues[i];
      if (prev !== undefined && curr !== undefined) {
        if (prev <= threshold && curr > threshold) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Calculate signal confidence
   */
  private calculateConfidence(
    rsi: number,
    adx: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    let confidence = 0.5;

    // More extreme RSI = higher confidence
    if (direction === 'LONG') {
      if (rsi < 15) confidence += 0.2;
      else if (rsi < 20) confidence += 0.15;
      else if (rsi < 25) confidence += 0.1;
    } else {
      if (rsi > 85) confidence += 0.2;
      else if (rsi > 80) confidence += 0.15;
      else if (rsi > 75) confidence += 0.1;
    }

    // Lower ADX (more ranging) = higher confidence
    if (adx < 15) {
      confidence += 0.15;
    } else if (adx < 20) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95);
  }

  // ============================================================================
  // PARAMETER GETTERS
  // ============================================================================

  getRSIMRParams(): RSIMRParams {
    return { ...this.specificParams };
  }

  override reset(): void {
    super.reset();
    this.rsiHistory = [];
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create RSI MR strategy with default or custom parameters
 */
export function createRSIMR(params?: Partial<RSIMRParams>): RSIMRStrategy {
  return new RSIMRStrategy(params);
}

/**
 * Parameter ranges for optimization
 */
export const RSI_MR_PARAM_RANGES = {
  rsiPeriod: [7, 10, 14, 21],
  rsiOversold: [20, 25, 30],
  rsiOverbought: [70, 75, 80],
  rsiExitLevel: [45, 50, 55],
  slMultiplier: [1.5, 2.0, 2.5],
  maxBars: [12, 20, 30],
  adxThreshold: [20, 25, 30],
};
