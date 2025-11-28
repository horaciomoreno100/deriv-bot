/**
 * BB Squeeze Strategy - Backtest Adapter
 *
 * Wraps the live BBSqueezeStrategy to implement BacktestableStrategy interface.
 * This allows using the same strategy logic for both live trading and backtesting.
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';

/**
 * Asset-specific parameters (copied from bb-squeeze.strategy.ts)
 */
interface BBSqueezeParams {
  bbPeriod: number;
  bbStdDev: number;
  kcPeriod: number;
  kcMultiplier: number;
  rsiPeriod: number;
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
  minCandles: number;
  skipSaturday: boolean;
  enableTimeFilter: boolean;
  enableRSIFilter: boolean;
}

const DEFAULT_PARAMS: BBSqueezeParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  rsiPeriod: 7,
  takeProfitPct: 0.004,
  stopLossPct: 0.002,
  cooldownBars: 1,
  minCandles: 50,
  skipSaturday: true,
  enableTimeFilter: true,
  enableRSIFilter: true,
};

const ASSET_CONFIGS: Record<string, Partial<BBSqueezeParams>> = {
  'R_50': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.006,
    stopLossPct: 0.003,
  },
  'R_75': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.004,
    stopLossPct: 0.002,
  },
  'R_100': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.006,
    stopLossPct: 0.003,
  },
};

/**
 * Bad time windows (day-hour combinations with <20% win rate)
 */
const BAD_TIME_WINDOWS = new Set([
  '0-4', '0-5', '0-15', '0-16',
  '1-1', '2-1', '2-5', '2-10',
  '3-21', '4-14', '5-6', '5-15',
  '6-3', '6-9', '6-11',
]);

/**
 * BB Squeeze Strategy for Backtesting
 */
export class BBSqueezeBacktestStrategy implements BacktestableStrategy {
  readonly name = 'BB-Squeeze';
  readonly version = '2.1.0';

  private params: BBSqueezeParams;
  private asset: string;

  // State tracking
  private lastSqueezeIndex: number = -1;
  private lastTradeIndex: number = -1;

  constructor(asset: string, customParams?: Partial<BBSqueezeParams>) {
    this.asset = asset;
    const assetConfig = ASSET_CONFIGS[asset] ?? {};
    this.params = { ...DEFAULT_PARAMS, ...assetConfig, ...customParams };
  }

  /**
   * Required indicators for this strategy
   */
  requiredIndicators(): string[] {
    return [
      'rsi',
      'bbUpper', 'bbMiddle', 'bbLower',
      'kcUpper', 'kcMiddle', 'kcLower',
      'squeezeOn',
    ];
  }

  /**
   * Default backtest configuration
   */
  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      takeProfitPct: this.params.takeProfitPct,
      stopLossPct: this.params.stopLossPct,
      cooldownBars: this.params.cooldownBars,
    };
  }

  /**
   * Check entry conditions at current candle
   */
  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Need minimum candles
    if (currentIndex < this.params.minCandles) {
      return null;
    }

    // Check cooldown
    if (this.lastTradeIndex >= 0 && currentIndex - this.lastTradeIndex < this.params.cooldownBars) {
      return null;
    }

    const candle = candles[currentIndex];
    if (!candle) return null;

    // Get indicator values
    const rsi = indicators.rsi as number | undefined;
    const bbUpper = indicators.bbUpper as number | undefined;
    const bbLower = indicators.bbLower as number | undefined;
    const bbMiddle = indicators.bbMiddle as number | undefined;
    const kcUpper = indicators.kcUpper as number | undefined;
    const kcLower = indicators.kcLower as number | undefined;
    const squeezeOn = indicators.squeezeOn as boolean | number | undefined;

    if (
      rsi === undefined ||
      bbUpper === undefined ||
      bbLower === undefined ||
      bbMiddle === undefined ||
      kcUpper === undefined ||
      kcLower === undefined
    ) {
      return null;
    }

    const price = candle.close;

    // Time filters
    if (this.params.skipSaturday || this.params.enableTimeFilter) {
      const date = new Date(candle.timestamp * 1000);
      const dayOfWeek = date.getUTCDay();
      const hourUTC = date.getUTCHours();

      // Skip Saturday
      if (this.params.skipSaturday && dayOfWeek === 6) {
        return null;
      }

      // Bad time windows
      if (this.params.enableTimeFilter) {
        const key = `${dayOfWeek}-${hourUTC}`;
        if (BAD_TIME_WINDOWS.has(key)) {
          return null;
        }
      }
    }

    // RSI zone filter (avoid 30-40 indecision zone)
    if (this.params.enableRSIFilter && rsi >= 30 && rsi <= 40) {
      return null;
    }

    // Detect squeeze
    const isInSqueeze = squeezeOn === true || squeezeOn === 1;

    // Track squeeze
    if (isInSqueeze) {
      this.lastSqueezeIndex = currentIndex;
    }

    // Check if recently in squeeze (within 5 bars)
    const barsSinceSqueeze = currentIndex - this.lastSqueezeIndex;
    const wasRecentlyInSqueeze = this.lastSqueezeIndex >= 0 && barsSinceSqueeze <= 5;

    if (!wasRecentlyInSqueeze) {
      return null;
    }

    // Create market snapshot for signal
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
      indicators,
    };

    // CALL Signal: Breakout above BB_Upper + RSI bullish
    const breakoutAbove = price > bbUpper;
    const rsiBullish = rsi > 55;

    if (breakoutAbove && rsiBullish) {
      this.lastTradeIndex = currentIndex;

      return {
        timestamp: candle.timestamp,
        direction: 'CALL',
        price,
        confidence: 85,
        reason: `Breakout above BB (${price.toFixed(2)} > ${bbUpper.toFixed(2)}) + RSI bullish (${rsi.toFixed(1)} > 55)`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    // PUT Signal: Breakout below BB_Lower + RSI bearish
    const breakoutBelow = price < bbLower;
    const rsiBearish = rsi < 45;

    if (breakoutBelow && rsiBearish) {
      this.lastTradeIndex = currentIndex;

      return {
        timestamp: candle.timestamp,
        direction: 'PUT',
        price,
        confidence: 85,
        reason: `Breakout below BB (${price.toFixed(2)} < ${bbLower.toFixed(2)}) + RSI bearish (${rsi.toFixed(1)} < 45)`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    return null;
  }

  /**
   * Reset state between backtest runs
   */
  reset(): void {
    this.lastSqueezeIndex = -1;
    this.lastTradeIndex = -1;
  }
}

/**
 * Factory function to create BB Squeeze strategy for backtesting
 */
export function createBBSqueezeStrategy(
  asset: string,
  params?: Partial<BBSqueezeParams>
): BBSqueezeBacktestStrategy {
  return new BBSqueezeBacktestStrategy(asset, params);
}
