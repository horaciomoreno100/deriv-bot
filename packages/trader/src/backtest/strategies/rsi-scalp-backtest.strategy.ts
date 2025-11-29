/**
 * RSI Scalp Backtest Strategy
 *
 * Implements BacktestableStrategy for running RSI Scalp in backtesting environment.
 * Uses RSI oversold/overbought detection with EMA trend filter.
 */

import type { Candle, IndicatorSnapshot as SharedIndicatorSnapshot } from '@deriv-bot/shared';
import type {
  BacktestableStrategy,
  EntrySignal,
  BacktestConfig,
  MarketSnapshot,
} from '../types.js';
import { getParamsForAsset } from '../../strategies/rsi-scalp.params.js';
import type { RSIScalpParams } from '../../strategies/rsi-scalp.types.js';

// Direction type for backtest
type Direction = 'CALL' | 'PUT';

/**
 * RSI Scalp strategy for backtesting
 */
export class RSIScalpBacktestStrategy implements BacktestableStrategy {
  readonly name = 'RSI-Scalp';
  readonly version = '1.0.0';

  private params: RSIScalpParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  constructor(asset: string, customParams?: Partial<RSIScalpParams>) {
    this.asset = asset;
    this.params = getParamsForAsset(asset, customParams);
  }

  requiredIndicators(): string[] {
    return ['rsi', 'ema'];
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    const tp1 = this.params.takeProfitLevels[0];
    return {
      asset: this.asset,
      takeProfitPct: tp1 ? tp1.profitPercent / 100 : 0.006,
      stopLossPct: this.params.stopLossPercent / 100,
      cooldownBars: this.params.cooldownBars,
      maxBarsInTrade: 30,
    };
  }

  checkEntry(
    candles: Candle[],
    indicators: SharedIndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    if (currentIndex < Math.max(this.params.rsiPeriod, this.params.emaPeriod) + 10) {
      return null;
    }

    // Cooldown check
    if (
      this.lastTradeIndex >= 0 &&
      currentIndex - this.lastTradeIndex < this.params.cooldownBars
    ) {
      return null;
    }

    const candle = candles[currentIndex];
    if (!candle) return null;

    const rsi = indicators.rsi as number | undefined;
    const ema = indicators.ema as number | undefined;

    if (rsi === undefined || ema === undefined) return null;

    const price = candle.close;

    // Check entry conditions
    const signal = this.evaluateEntry(candle, rsi, ema, price, currentIndex);

    if (!signal) return null;

    this.lastTradeIndex = currentIndex;

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
        rsi,
        ema,
      },
    };

    const tp1 = this.params.takeProfitLevels[0];
    const tpPct = tp1 ? tp1.profitPercent / 100 : 0.006;
    const slPct = this.params.stopLossPercent / 100;

    return {
      timestamp: candle.timestamp,
      direction: signal.direction,
      price,
      confidence: signal.confidence,
      reason: signal.reason,
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot,
      suggestedTpPct: tpPct,
      suggestedSlPct: slPct,
    };
  }

  /**
   * Evaluate entry conditions
   */
  private evaluateEntry(
    candle: Candle,
    rsi: number,
    ema: number,
    price: number,
    _currentIndex: number
  ): { direction: Direction; confidence: number; reason: string } | null {
    // Check for LONG entry (oversold RSI)
    const longEntry = this.checkLongEntry(rsi, ema, price);
    if (longEntry) {
      return longEntry;
    }

    // Check for SHORT entry (overbought RSI)
    const shortEntry = this.checkShortEntry(rsi, ema, price);
    if (shortEntry) {
      return shortEntry;
    }

    return null;
  }

  /**
   * Check LONG entry conditions
   */
  private checkLongEntry(
    rsi: number,
    ema: number,
    price: number
  ): { direction: Direction; confidence: number; reason: string } | null {
    // Find the highest RSI threshold that's triggered
    const longLevels = this.params.entryLevels.long.filter((l) => l.enabled);
    let triggeredLevel: (typeof longLevels)[0] | null = null;
    let entryLevelIndex = -1;

    for (let i = 0; i < longLevels.length; i++) {
      const level = longLevels[i];
      if (level && rsi <= level.rsiThreshold) {
        triggeredLevel = level;
        entryLevelIndex = i;
      }
    }

    if (!triggeredLevel) return null;

    // Trend filter: for LONG, prefer price below EMA (counter-trend) or near EMA
    if (this.params.useTrendFilter) {
      // Allow counter-trend entries when RSI is very oversold
      const emaDistance = (price - ema) / ema;
      if (emaDistance > 0.01 && rsi > 25) {
        // Price too far above EMA and RSI not extremely oversold
        return null;
      }
    }

    // Calculate confidence based on RSI extremity
    let confidence = 0.6;
    if (rsi <= 20) confidence = 0.85;
    else if (rsi <= 25) confidence = 0.75;
    else if (rsi <= 30) confidence = 0.65;

    // Boost confidence for deeper DCA levels
    confidence += entryLevelIndex * 0.05;
    confidence = Math.min(confidence, 0.95);

    return {
      direction: 'CALL',
      confidence,
      reason: `RSI oversold (${rsi.toFixed(1)}) at level ${entryLevelIndex + 1}`,
    };
  }

  /**
   * Check SHORT entry conditions
   */
  private checkShortEntry(
    rsi: number,
    ema: number,
    price: number
  ): { direction: Direction; confidence: number; reason: string } | null {
    // Find the lowest RSI threshold that's triggered
    const shortLevels = this.params.entryLevels.short.filter((l) => l.enabled);
    let triggeredLevel: (typeof shortLevels)[0] | null = null;
    let entryLevelIndex = -1;

    for (let i = 0; i < shortLevels.length; i++) {
      const level = shortLevels[i];
      if (level && rsi >= level.rsiThreshold) {
        triggeredLevel = level;
        entryLevelIndex = i;
      }
    }

    if (!triggeredLevel) return null;

    // Trend filter: for SHORT, prefer price above EMA (counter-trend) or near EMA
    if (this.params.useTrendFilter) {
      // Allow counter-trend entries when RSI is very overbought
      const emaDistance = (price - ema) / ema;
      if (emaDistance < -0.01 && rsi < 75) {
        // Price too far below EMA and RSI not extremely overbought
        return null;
      }
    }

    // Calculate confidence based on RSI extremity
    let confidence = 0.6;
    if (rsi >= 80) confidence = 0.85;
    else if (rsi >= 75) confidence = 0.75;
    else if (rsi >= 70) confidence = 0.65;

    // Boost confidence for deeper DCA levels
    confidence += entryLevelIndex * 0.05;
    confidence = Math.min(confidence, 0.95);

    return {
      direction: 'PUT',
      confidence,
      reason: `RSI overbought (${rsi.toFixed(1)}) at level ${entryLevelIndex + 1}`,
    };
  }

  /**
   * Get strategy parameters
   */
  getParams(): RSIScalpParams {
    return this.params;
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    this.lastTradeIndex = -1;
  }
}

/**
 * Factory function for creating RSI Scalp backtest strategy
 */
export function createRSIScalpBacktestStrategy(
  asset: string,
  params?: Partial<RSIScalpParams>
): RSIScalpBacktestStrategy {
  return new RSIScalpBacktestStrategy(asset, params);
}
