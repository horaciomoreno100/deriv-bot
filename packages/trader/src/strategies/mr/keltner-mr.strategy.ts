/**
 * Keltner Channel Mean Reversion Strategy
 *
 * Mean reversion using Keltner Channels (ATR-based, more adaptive to volatility).
 * Better than BB in trending markets due to ATR-based bands.
 *
 * Entry Conditions:
 * - LONG: Close <= Lower Keltner (EMA - mult×ATR) + RSI < 35 + ADX < 25
 * - SHORT: Close >= Upper Keltner (EMA + mult×ATR) + RSI > 65 + ADX < 25
 *
 * Exit Conditions:
 * - Take Profit: EMA (central line)
 * - Stop Loss: 1.5 × ATR
 * - Time Exit: 15 bars
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
import { ATR, EMA } from 'technicalindicators';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Keltner MR specific parameters
 */
export interface KeltnerMRParams extends MRStrategyParams {
  // Keltner Channel
  kcEmaPeriod: number;
  kcAtrPeriod: number;
  kcMultiplier: number;

  // RSI thresholds (more lenient than pure RSI strategy)
  rsiOversold: number;
  rsiOverbought: number;
}

/**
 * Extended indicators for Keltner MR
 */
interface KeltnerMRIndicators extends IndicatorSnapshot {
  kcUpper: number;
  kcMiddle: number;
  kcLower: number;
  kcWidth: number;
  kcAtr: number;
}

// ============================================================================
// STRATEGY IMPLEMENTATION
// ============================================================================

export class KeltnerMRStrategy extends MRStrategyBase {
  private specificParams: KeltnerMRParams;

  constructor(params: Partial<KeltnerMRParams> = {}) {
    super(params);

    this.specificParams = {
      ...this.params,
      kcEmaPeriod: params.kcEmaPeriod ?? 20,
      kcAtrPeriod: params.kcAtrPeriod ?? 14,
      kcMultiplier: params.kcMultiplier ?? 2.0,
      rsiOversold: params.rsiOversold ?? 35,
      rsiOverbought: params.rsiOverbought ?? 65,
    };
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================================

  getName(): string {
    return 'KELTNER_MR';
  }

  getDefaultParams(): Partial<MRStrategyParams> {
    return {
      atrPeriod: 14,
      adxPeriod: 14,
      rsiPeriod: 14,
      emaPeriod: 20,
      adxThreshold: 25,
      slMultiplier: 1.5,
      maxBars: 15,
      minCandles: 40,
    };
  }

  checkEntry(candles: Candle[], indicators: IndicatorSnapshot): MRTradeSignal | null {
    // Calculate Keltner specific indicators
    const keltnerIndicators = this.calculateKeltnerIndicators(candles, indicators);
    if (!keltnerIndicators) return null;

    const { price, rsi, adx, kcUpper, kcMiddle, kcLower, kcAtr } = keltnerIndicators;

    // Must be in ranging market
    if (!this.isRangingMarket(adx)) {
      return null;
    }

    // LONG: Price at lower Keltner + RSI shows oversold
    if (price <= kcLower && rsi < this.specificParams.rsiOversold) {
      const stopLoss = price - kcAtr * this.params.slMultiplier;
      const takeProfit = kcMiddle; // Target is EMA (central line)

      return {
        direction: 'LONG',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(rsi, adx, price, kcLower, 'LONG'),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          rsi,
          adx,
          kcLower,
          kcMiddle,
          kcUpper,
          kcAtr,
          distanceFromBand: (kcLower - price) / price,
        },
      };
    }

    // SHORT: Price at upper Keltner + RSI shows overbought
    if (price >= kcUpper && rsi > this.specificParams.rsiOverbought) {
      const stopLoss = price + kcAtr * this.params.slMultiplier;
      const takeProfit = kcMiddle; // Target is EMA (central line)

      return {
        direction: 'SHORT',
        entryPrice: price,
        stopLoss,
        takeProfit,
        confidence: this.calculateConfidence(rsi, adx, price, kcUpper, 'SHORT'),
        maxBars: this.params.maxBars,
        metadata: {
          strategy: this.getName(),
          rsi,
          adx,
          kcLower,
          kcMiddle,
          kcUpper,
          kcAtr,
          distanceFromBand: (price - kcUpper) / price,
        },
      };
    }

    return null;
  }

  checkExit(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    trade: ActiveTrade
  ): ExitReason | null {
    // Recalculate Keltner for current EMA
    const keltnerIndicators = this.calculateKeltnerIndicators(candles, indicators);
    if (!keltnerIndicators) return null;

    const { price, kcMiddle } = keltnerIndicators;

    // Exit when price returns to EMA (mean)
    if (trade.direction === 'LONG') {
      if (price >= kcMiddle) {
        return 'SIGNAL';
      }
    } else {
      if (price <= kcMiddle) {
        return 'SIGNAL';
      }
    }

    return null;
  }

  // ============================================================================
  // KELTNER SPECIFIC METHODS
  // ============================================================================

  /**
   * Calculate Keltner Channel indicators
   */
  private calculateKeltnerIndicators(
    candles: Candle[],
    baseIndicators: IndicatorSnapshot
  ): KeltnerMRIndicators | null {
    try {
      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);

      // Calculate EMA (middle line)
      const emaResult = EMA.calculate({
        period: this.specificParams.kcEmaPeriod,
        values: closes,
      });

      // Calculate ATR for channel width
      const atrResult = ATR.calculate({
        period: this.specificParams.kcAtrPeriod,
        high: highs,
        low: lows,
        close: closes,
      });

      if (emaResult.length === 0 || atrResult.length === 0) {
        return null;
      }

      const ema = emaResult[emaResult.length - 1]!;
      const atr = atrResult[atrResult.length - 1]!;

      const kcUpper = ema + atr * this.specificParams.kcMultiplier;
      const kcLower = ema - atr * this.specificParams.kcMultiplier;
      const kcWidth = (kcUpper - kcLower) / ema;

      return {
        ...baseIndicators,
        ema,
        kcUpper,
        kcMiddle: ema,
        kcLower,
        kcWidth,
        kcAtr: atr,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate signal confidence
   */
  private calculateConfidence(
    rsi: number,
    adx: number,
    price: number,
    band: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    let confidence = 0.5;

    // More extreme RSI = higher confidence
    if (direction === 'LONG') {
      if (rsi < 25) confidence += 0.15;
      else if (rsi < 30) confidence += 0.1;
    } else {
      if (rsi > 75) confidence += 0.15;
      else if (rsi > 70) confidence += 0.1;
    }

    // Price further beyond band = higher confidence (but more risk)
    const distancePct = Math.abs((price - band) / band);
    if (distancePct > 0.005) confidence += 0.1;

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

  getKeltnerMRParams(): KeltnerMRParams {
    return { ...this.specificParams };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create Keltner MR strategy with default or custom parameters
 */
export function createKeltnerMR(params?: Partial<KeltnerMRParams>): KeltnerMRStrategy {
  return new KeltnerMRStrategy(params);
}

/**
 * Parameter ranges for optimization
 */
export const KELTNER_MR_PARAM_RANGES = {
  kcEmaPeriod: [15, 20, 25],
  kcAtrPeriod: [10, 14, 20],
  kcMultiplier: [1.5, 2.0, 2.5, 3.0],
  rsiOversold: [30, 35, 40],
  rsiOverbought: [60, 65, 70],
  slMultiplier: [1.0, 1.5, 2.0],
  maxBars: [10, 15, 20],
  adxThreshold: [20, 25, 30],
};
