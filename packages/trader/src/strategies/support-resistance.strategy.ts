/**
 * Support/Resistance Bounce Strategy
 *
 * Strategy: Trades bounces from key support/resistance levels
 * Best backtest result: 67.22% ROI, 41.9% WR, 4446 trades
 *
 * Logic:
 * - Identifies support (lowest lows) and resistance (highest highs) from recent price action
 * - CALL when price bounces from support level (within 0.2% tolerance)
 * - PUT when price bounces from resistance level (within 0.2% tolerance)
 *
 * TP/SL: 2:1 ratio (0.5% TP / 0.25% SL)
 * Contract Type: Multipliers with TP/SL
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';

/**
 * Support/Resistance Strategy Parameters
 */
export interface SupportResistanceParams {
  /** Lookback period for support/resistance levels (default: 20) */
  lookbackPeriod: number;
  /** Tolerance for support/resistance touch (default: 0.002 = 0.2%) */
  touchTolerancePct: number;
  /** Take Profit percentage (default: 0.005 = 0.5%) */
  takeProfitPct: number;
  /** Stop Loss percentage (default: 0.0025 = 0.25%) */
  stopLossPct: number;
  /** Cooldown between trades in seconds (default: 60) */
  cooldownSeconds: number;
}

/**
 * Default parameters (based on backtest with 67.22% ROI)
 */
const DEFAULT_PARAMS: SupportResistanceParams = {
  lookbackPeriod: 20,
  touchTolerancePct: 0.002, // 0.2%
  takeProfitPct: 0.005,      // 0.5% TP
  stopLossPct: 0.0025,       // 0.25% SL (2:1 ratio)
  cooldownSeconds: 60,       // 1 minute cooldown
};

/**
 * Support/Resistance Bounce Strategy
 *
 * Trades bounces from key price levels
 */
export class SupportResistanceStrategy extends BaseStrategy {
  private params: SupportResistanceParams;
  private lastTradeTime: number = 0;

  constructor(config: StrategyConfig) {
    super(config);

    // Merge user params with defaults
    this.params = {
      ...DEFAULT_PARAMS,
      ...(config.parameters as Partial<SupportResistanceParams>),
    };
  }

  async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    const { candles } = context;

    console.log(`[SupportResistance] 🔍 onCandle called for ${candle.asset} | price=${candle.close.toFixed(2)}, high=${candle.high.toFixed(2)}, low=${candle.low.toFixed(2)}`);

    // Need enough candles for lookback
    const minCandles = this.params.lookbackPeriod + 5;
    if (!candles || candles.length < minCandles) {
      console.log(`[SupportResistance] ⏭️  Not enough candles: ${candles?.length || 0} < ${minCandles}`);
      return null;
    }

    // Check cooldown
    const now = Date.now();
    const timeSinceLastTrade = now - this.lastTradeTime;
    const cooldownMs = this.params.cooldownSeconds * 1000;

    if (timeSinceLastTrade < cooldownMs) {
      console.log(`[SupportResistance] ⏱️  Cooldown active: ${Math.ceil((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`);
      return null;
    }

    // Calculate support/resistance from recent price action
    const lookbackCandles = candles.slice(-this.params.lookbackPeriod);
    const highs = lookbackCandles.map(c => c.high);
    const lows = lookbackCandles.map(c => c.low);

    const resistance = Math.max(...highs);
    const support = Math.min(...lows);

    const price = candle.close;
    const high = candle.high;
    const low = candle.low;

    console.log(`[SupportResistance] 📊 S/R Levels: support=${support.toFixed(2)}, resistance=${resistance.toFixed(2)}, candles=${candles.length}, lookback=${this.params.lookbackPeriod}`);

    // Calculate distance to support/resistance as percentage
    const distToSupport = Math.abs((low - support) / support);
    const distToResistance = Math.abs((high - resistance) / resistance);

    console.log(`[SupportResistance] 📏 Distances: toSupport=${(distToSupport * 100).toFixed(4)}%, toResistance=${(distToResistance * 100).toFixed(4)}%, tolerance=${(this.params.touchTolerancePct * 100).toFixed(2)}%`);

    // CALL Signal: Price bounces from support
    const supportBounce = distToSupport <= this.params.touchTolerancePct;
    console.log(`[SupportResistance] 🎯 Support bounce check: ${supportBounce} (${(distToSupport * 100).toFixed(4)}% ${supportBounce ? '<=' : '>'} ${(this.params.touchTolerancePct * 100).toFixed(2)}%)`);

    if (supportBounce) {
      console.log(
        `[SupportResistance] 🔍 SUPPORT BOUNCE: low=${low.toFixed(2)}, support=${support.toFixed(2)}, dist=${(distToSupport * 100).toFixed(2)}% <= ${(this.params.touchTolerancePct * 100).toFixed(2)}%`
      );
    }

    if (supportBounce) {
      console.log(
        `[SupportResistance] ✅ CALL SIGNAL: Bounce from support ${support.toFixed(2)}`
      );
      this.lastTradeTime = now;

      // Calculate TP/SL prices
      const tpPrice = price * (1 + this.params.takeProfitPct);
      const slPrice = price * (1 - this.params.stopLossPct);

      const signal = this.createSignal(
        'CALL',
        0.85,
        {
          price,
          support: support.toFixed(2),
          resistance: resistance.toFixed(2),
          distToSupport: (distToSupport * 100).toFixed(2) + '%',
          tpPrice,
          slPrice,
          tpPct: this.params.takeProfitPct * 100,
          slPct: this.params.stopLossPct * 100,
        },
        candle.asset
      );

      console.log(`[SupportResistance] 📤 EMITTING CALL SIGNAL for ${candle.asset}`);
      return signal;
    }

    // PUT Signal: Price bounces from resistance
    const resistanceBounce = distToResistance <= this.params.touchTolerancePct;
    console.log(`[SupportResistance] 🎯 Resistance bounce check: ${resistanceBounce} (${(distToResistance * 100).toFixed(4)}% ${resistanceBounce ? '<=' : '>'} ${(this.params.touchTolerancePct * 100).toFixed(2)}%)`);

    if (resistanceBounce) {
      console.log(
        `[SupportResistance] 🔍 RESISTANCE BOUNCE: high=${high.toFixed(2)}, resistance=${resistance.toFixed(2)}, dist=${(distToResistance * 100).toFixed(2)}% <= ${(this.params.touchTolerancePct * 100).toFixed(2)}%`
      );
    }

    if (resistanceBounce) {
      console.log(
        `[SupportResistance] ✅ PUT SIGNAL: Bounce from resistance ${resistance.toFixed(2)}`
      );
      this.lastTradeTime = now;

      // Calculate TP/SL prices
      const tpPrice = price * (1 - this.params.takeProfitPct);
      const slPrice = price * (1 + this.params.stopLossPct);

      const signal = this.createSignal(
        'PUT',
        0.85,
        {
          price,
          support: support.toFixed(2),
          resistance: resistance.toFixed(2),
          distToResistance: (distToResistance * 100).toFixed(2) + '%',
          tpPrice,
          slPrice,
          tpPct: this.params.takeProfitPct * 100,
          slPct: this.params.stopLossPct * 100,
        },
        candle.asset
      );

      console.log(`[SupportResistance] 📤 EMITTING PUT SIGNAL for ${candle.asset}`);
      return signal;
    }

    return null;
  }

  /**
   * Get signal readiness for dashboard
   */
  getSignalReadiness(candles: Candle[]): {
    asset: string;
    direction: 'call' | 'put' | 'neutral';
    overallProximity: number;
    criteria: Record<string, { met: boolean; value: string }>;
    readyToSignal: boolean;
    missingCriteria: string[];
  } | null {
    const minCandles = this.params.lookbackPeriod + 5;
    if (!candles || candles.length < minCandles) {
      return null;
    }

    // Check cooldown
    const now = Date.now();
    const timeSinceLastTrade = now - this.lastTradeTime;
    const cooldownMs = this.params.cooldownSeconds * 1000;
    const cooldownOk = timeSinceLastTrade >= cooldownMs;

    // Calculate S/R levels
    const lookbackCandles = candles.slice(-this.params.lookbackPeriod);
    const highs = lookbackCandles.map(c => c.high);
    const lows = lookbackCandles.map(c => c.low);

    const resistance = Math.max(...highs);
    const support = Math.min(...lows);

    const currentCandle = candles[candles.length - 1];
    if (!currentCandle) {
      return null;
    }

    const high = currentCandle.high;
    const low = currentCandle.low;

    // Calculate distances
    const distToSupport = Math.abs((low - support) / support);
    const distToResistance = Math.abs((high - resistance) / resistance);

    // Check conditions
    const supportBounce = distToSupport <= this.params.touchTolerancePct;
    const resistanceBounce = distToResistance <= this.params.touchTolerancePct;

    const callReady = supportBounce && cooldownOk;
    const putReady = resistanceBounce && cooldownOk;

    // Determine direction and proximity
    let direction: 'call' | 'put' | 'neutral' = 'neutral';
    let overallProximity = 0;

    if (callReady) {
      direction = 'call';
      overallProximity = 100;
    } else if (putReady) {
      direction = 'put';
      overallProximity = 100;
    } else {
      // Calculate proximity to signal
      const callProximity = Math.max(
        0,
        (supportBounce ? 100 : Math.max(0, 100 - (distToSupport / this.params.touchTolerancePct) * 100)) * 0.7 +
        (cooldownOk ? 100 : (timeSinceLastTrade / cooldownMs) * 100) * 0.3
      );

      const putProximity = Math.max(
        0,
        (resistanceBounce ? 100 : Math.max(0, 100 - (distToResistance / this.params.touchTolerancePct) * 100)) * 0.7 +
        (cooldownOk ? 100 : (timeSinceLastTrade / cooldownMs) * 100) * 0.3
      );

      if (callProximity > putProximity) {
        direction = 'call';
        overallProximity = Math.min(100, callProximity);
      } else {
        direction = 'put';
        overallProximity = Math.min(100, putProximity);
      }
    }

    // Criteria
    const criteria = {
      'Support Level': {
        met: supportBounce,
        value: `${support.toFixed(2)} (dist: ${(distToSupport * 100).toFixed(2)}%)`,
      },
      'Resistance Level': {
        met: resistanceBounce,
        value: `${resistance.toFixed(2)} (dist: ${(distToResistance * 100).toFixed(2)}%)`,
      },
      'Cooldown': {
        met: cooldownOk,
        value: cooldownOk ? 'Ready' : `${Math.ceil((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`,
      },
    };

    const missingCriteria: string[] = [];
    if (!supportBounce && direction === 'call') missingCriteria.push(`Support bounce (<${(this.params.touchTolerancePct * 100).toFixed(2)}%)`);
    if (!resistanceBounce && direction === 'put') missingCriteria.push(`Resistance bounce (<${(this.params.touchTolerancePct * 100).toFixed(2)}%)`);
    if (!cooldownOk) missingCriteria.push('Cooldown active');

    return {
      asset: currentCandle.asset,
      direction,
      overallProximity: Math.round(overallProximity),
      criteria,
      readyToSignal: callReady || putReady,
      missingCriteria,
    };
  }
}
