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
  // SIGNAL PROXIMITY
  // ============================================================================

  /**
   * Get signal readiness for dashboard/signal proximity
   */
  getSignalReadiness(candles: Candle[]): {
    asset: string;
    direction: 'call' | 'put' | 'neutral';
    overallProximity: number;
    criteria: Array<{
      name: string;
      current: number;
      target: number;
      unit: string;
      passed: boolean;
      distance: number;
    }>;
    readyToSignal: boolean;
    missingCriteria: string[];
  } | null {
    if (!candles || candles.length < this.params.minCandles) {
      return null;
    }

    const firstCandle = candles[0];
    if (!firstCandle) {
      return null;
    }

    const asset = firstCandle.asset || 'UNKNOWN';

    // Calculate base indicators
    const baseIndicators = this.calculateIndicators(candles);
    if (!baseIndicators) {
      return null;
    }

    // Calculate Keltner indicators
    const keltnerIndicators = this.calculateKeltnerIndicators(candles, baseIndicators);
    if (!keltnerIndicators) {
      return null;
    }

    const { price, rsi, adx, kcUpper, kcMiddle, kcLower } = keltnerIndicators;

    // Check cooldown
    const now = Date.now();
    // Use activeTrade or closedTrades to determine last trade time
    // For simplicity, use 0 if no trade history (will pass cooldown check)
    const lastTradeTime = this.activeTrade?.entryTime ||
      (this.closedTrades.length > 0 ? this.closedTrades[this.closedTrades.length - 1]!.exitTime : 0);
    const timeSinceLastTrade = now - lastTradeTime;
    const cooldownMs = 60 * 1000; // 1 minute cooldown
    const cooldownOk = timeSinceLastTrade >= cooldownMs;

    // Check if in ranging market
    const isRanging = this.isRangingMarket(adx);

    // Calculate distances
    const distToLower = (price - kcLower) / kcLower;
    const distToUpper = (kcUpper - price) / kcUpper;

    // Entry conditions
    const longReady = price <= kcLower && rsi < this.specificParams.rsiOversold && isRanging && cooldownOk;
    const shortReady = price >= kcUpper && rsi > this.specificParams.rsiOverbought && isRanging && cooldownOk;

    // Determine direction and proximity
    let direction: 'call' | 'put' | 'neutral' = 'neutral';
    let overallProximity = 0;

    if (longReady) {
      direction = 'call';
      overallProximity = 100;
    } else if (shortReady) {
      direction = 'put';
      overallProximity = 100;
    } else {
      // Calculate proximity scores
      const callProximity = Math.max(
        0,
        (price <= kcLower ? 100 : Math.max(0, 100 - Math.abs(distToLower) * 5000)) * 0.4 +
        (rsi < this.specificParams.rsiOversold ? 100 : Math.max(0, 100 - Math.abs(rsi - this.specificParams.rsiOversold) * 3)) * 0.3 +
        (isRanging ? 100 : 0) * 0.2 +
        (cooldownOk ? 100 : Math.min(100, (timeSinceLastTrade / cooldownMs) * 100)) * 0.1
      );

      const putProximity = Math.max(
        0,
        (price >= kcUpper ? 100 : Math.max(0, 100 - Math.abs(distToUpper) * 5000)) * 0.4 +
        (rsi > this.specificParams.rsiOverbought ? 100 : Math.max(0, 100 - Math.abs(rsi - this.specificParams.rsiOverbought) * 3)) * 0.3 +
        (isRanging ? 100 : 0) * 0.2 +
        (cooldownOk ? 100 : Math.min(100, (timeSinceLastTrade / cooldownMs) * 100)) * 0.1
      );

      if (callProximity > putProximity && callProximity > 10) {
        direction = 'call';
        overallProximity = Math.min(100, callProximity);
      } else if (putProximity > 10) {
        direction = 'put';
        overallProximity = Math.min(100, putProximity);
      }
    }

    // Build criteria array
    const criteria = [
      {
        name: 'Price vs KC_Lower',
        current: price,
        target: kcLower,
        unit: '',
        passed: price <= kcLower,
        distance: Math.abs(distToLower * 100),
      },
      {
        name: 'Price vs KC_Upper',
        current: price,
        target: kcUpper,
        unit: '',
        passed: price >= kcUpper,
        distance: Math.abs(distToUpper * 100),
      },
      {
        name: 'RSI',
        current: rsi,
        target: direction === 'call' ? this.specificParams.rsiOversold : this.specificParams.rsiOverbought,
        unit: '',
        passed: direction === 'call' ? rsi < this.specificParams.rsiOversold : rsi > this.specificParams.rsiOverbought,
        distance: direction === 'call'
          ? Math.abs(rsi - this.specificParams.rsiOversold)
          : Math.abs(rsi - this.specificParams.rsiOverbought),
      },
      {
        name: 'ADX (Ranging)',
        current: adx,
        target: this.params.adxThreshold,
        unit: '',
        passed: isRanging,
        distance: Math.abs(adx - this.params.adxThreshold),
      },
      {
        name: 'Cooldown',
        current: timeSinceLastTrade / 1000,
        target: cooldownMs / 1000,
        unit: 's',
        passed: cooldownOk,
        distance: cooldownOk ? 0 : (cooldownMs - timeSinceLastTrade) / 1000,
      },
    ];

    const missingCriteria: string[] = [];
    if (direction === 'call') {
      if (price > kcLower) missingCriteria.push('Price must be <= KC_Lower');
      if (rsi >= this.specificParams.rsiOversold) missingCriteria.push(`RSI must be < ${this.specificParams.rsiOversold}`);
    } else if (direction === 'put') {
      if (price < kcUpper) missingCriteria.push('Price must be >= KC_Upper');
      if (rsi <= this.specificParams.rsiOverbought) missingCriteria.push(`RSI must be > ${this.specificParams.rsiOverbought}`);
    }
    if (!isRanging) missingCriteria.push(`ADX must be < ${this.params.adxThreshold} (ranging market)`);
    if (!cooldownOk) missingCriteria.push('Cooldown active');

    return {
      asset,
      direction,
      overallProximity: Math.round(overallProximity),
      criteria,
      readyToSignal: longReady || shortReady,
      missingCriteria,
    };
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
