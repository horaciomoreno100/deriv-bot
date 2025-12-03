/**
 * Pullback Window Backtest Strategy
 *
 * Implements BacktestableStrategy for running Pullback Window strategy in backtesting environment.
 * Uses state machine with 4 phases: SCANNING → ARMED → WINDOW_OPEN → ENTRY
 */

import type { Candle, IndicatorSnapshot as SharedIndicatorSnapshot } from '@deriv-bot/shared';
import type {
  BacktestableStrategy,
  EntrySignal,
  BacktestConfig,
  MarketSnapshot,
} from '../types.js';
import { PullbackWindowStrategy } from '../../strategies/pullback-window/pullback-window.strategy.js';
import { getParamsForAsset } from '../../strategies/pullback-window/pullback-window.params.js';
import type { PullbackWindowParams } from '../../strategies/pullback-window/pullback-window.types.js';

/**
 * Pullback Window strategy for backtesting
 */
export class PullbackWindowBacktestStrategy implements BacktestableStrategy {
  readonly name = 'PULLBACK-WINDOW';
  readonly version = '1.0.0';

  private params: PullbackWindowParams;
  private asset: string;
  private strategy: PullbackWindowStrategy;

  constructor(asset: string, customParams?: Partial<PullbackWindowParams>) {
    this.asset = asset;
    this.params = getParamsForAsset(asset, customParams);
    this.strategy = new PullbackWindowStrategy(asset, this.params);
  }

  requiredIndicators(): string[] {
    return ['ema', 'atr', 'adx'];
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      takeProfitPct: this.params.tpAtrMultiplier * 0.01, // Convert ATR multiplier to %
      stopLossPct: this.params.slAtrMultiplier * 0.01,
      cooldownBars: 0, // No cooldown - strategy manages state internally
      maxBarsInTrade: 240, // Max 240 candles (4 hours) per trade
      indicators: {
        emaPeriods: [
          this.params.emaConfirmPeriod,
          this.params.emaFastPeriod,
          this.params.emaMediumPeriod,
          this.params.emaSlowPeriod,
        ],
        atrPeriod: this.params.atrPeriod,
        adxPeriod: 14,
      },
    };
  }

  checkEntry(
    candles: Candle[],
    indicators: SharedIndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Need enough history for EMAs
    if (currentIndex < this.params.emaSlowPeriod + 10) {
      return null;
    }

    const candle = candles[currentIndex];
    if (!candle) return null;

    // Get required indicators using actual param periods
    const ema1 = indicators[`ema${this.params.emaConfirmPeriod}`] as number | undefined;
    const ema14 = indicators[`ema${this.params.emaFastPeriod}`] as number | undefined;
    const ema18 = indicators[`ema${this.params.emaMediumPeriod}`] as number | undefined;
    const ema24 = indicators[`ema${this.params.emaSlowPeriod}`] as number | undefined;
    const atr = indicators.atr as number | undefined;
    const adx = indicators.adx as number | undefined;

    if (
      ema1 === undefined ||
      ema14 === undefined ||
      ema18 === undefined ||
      ema24 === undefined ||
      atr === undefined
    ) {
      return null;
    }

    // Build indicator map with all required indicators
    const indicatorMap: Record<string, number> = {
      ema1,
      ema14,
      ema18,
      ema24,
      atr,
      [`ema${this.params.emaConfirmPeriod}`]: ema1,
      [`ema${this.params.emaFastPeriod}`]: ema14,
      [`ema${this.params.emaMediumPeriod}`]: ema18,
      [`ema${this.params.emaSlowPeriod}`]: ema24,
    };

    if (adx !== undefined) {
      indicatorMap.adx = adx;
    }

    // Use strategy to evaluate entry
    const signal = this.strategy.evaluateEntry(candles, currentIndex, indicatorMap);

    if (!signal) return null;

    const price = candle.close;

    const snapshot: MarketSnapshot = {
      timestamp: candle.timestamp * 1000,
      candle: {
        index: currentIndex,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      },
      price,
      indicators: {
        ema1,
        ema14,
        ema18,
        ema24,
        atr,
        adx,
      },
    };

    // Extract TP/SL from signal metadata
    const metadata = signal.metadata as
      | {
          slPrice?: number;
          tpPrice?: number;
          atr?: number;
          [key: string]: unknown;
        }
      | undefined;

    const slPrice = metadata?.slPrice;
    const tpPrice = metadata?.tpPrice;

    // Calculate TP/SL percentages
    const tpPct =
      tpPrice !== undefined ? Math.abs(tpPrice - price) / price : this.params.tpAtrMultiplier * 0.01;
    const slPct =
      slPrice !== undefined ? Math.abs(slPrice - price) / price : this.params.slAtrMultiplier * 0.01;

    return {
      timestamp: candle.timestamp,
      direction: signal.direction,
      price,
      confidence: signal.confidence,
      reason: signal.reason || 'Pullback Window breakout',
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot,
      suggestedTpPct: tpPct,
      suggestedSlPct: slPct,
    };
  }

  /**
   * Get strategy parameters
   */
  getParams(): PullbackWindowParams {
    return this.params;
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    // Create new strategy instance to reset state machine
    this.strategy = new PullbackWindowStrategy(this.asset, this.params);
  }
}

/**
 * Factory function for creating Pullback Window backtest strategy
 */
export function createPullbackWindowBacktestStrategy(
  asset: string,
  params?: Partial<PullbackWindowParams>
): PullbackWindowBacktestStrategy {
  return new PullbackWindowBacktestStrategy(asset, params);
}
