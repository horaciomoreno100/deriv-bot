/**
 * BB Squeeze Mean Reversion Strategy - Backtest Adapter
 *
 * Wraps the live BBSqueezeMRStrategy to implement BacktestableStrategy interface.
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';

/**
 * BB Squeeze MR specific parameters
 */
interface BBSqueezeMRParams {
  // Bollinger Bands
  bbPeriod: number;
  bbStdDev: number;

  // Keltner Channel
  kcPeriod: number;
  kcMultiplier: number;

  // RSI & ADX
  rsiPeriod: number;
  adxPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  adxThreshold: number;

  // Risk
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
  minCandles: number;
  maxBars: number;
  squeezeRecencyBars: number;
}

const DEFAULT_PARAMS: BBSqueezeMRParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  rsiPeriod: 14,
  adxPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  adxThreshold: 25,
  takeProfitPct: 0.006,  // 0.6% (optimized from backtest)
  stopLossPct: 0.004,    // 0.4% (1.5:1 ratio - better win rate)
  cooldownBars: 1,
  minCandles: 50,
  maxBars: 12,
  squeezeRecencyBars: 5,
};

const ASSET_CONFIGS: Record<string, Partial<BBSqueezeMRParams>> = {
  'R_75': {
    kcMultiplier: 1.5,
    takeProfitPct: 0.006,  // 0.6% (optimized from backtest: best config)
    stopLossPct: 0.004,    // 0.4% (1.5:1 ratio)
  },
  'R_100': {
    kcMultiplier: 1.5,
    takeProfitPct: 0.006,  // 0.6% (optimized from backtest)
    stopLossPct: 0.004,    // 0.4% (1.5:1 ratio)
  },
};

/**
 * BB Squeeze Mean Reversion Strategy for Backtesting
 */
export class BBSqueezeMRBacktestStrategy implements BacktestableStrategy {
  readonly name = 'BB-Squeeze-MR';
  readonly version = '1.0.0';

  private params: BBSqueezeMRParams;
  private asset: string;
  private squeezeHistory: boolean[] = [];
  private lastTradeIndex: number = -1;

  constructor(asset: string, customParams?: Partial<BBSqueezeMRParams>) {
    this.asset = asset;
    const assetConfig = ASSET_CONFIGS[asset] ?? {};
    this.params = { ...DEFAULT_PARAMS, ...assetConfig, ...customParams };
  }

  requiredIndicators(): string[] {
    return ['rsi', 'adx', 'bbUpper', 'bbMiddle', 'bbLower', 'kcUpper', 'kcMiddle', 'kcLower', 'atr', 'squeezeOn'];
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      takeProfitPct: this.params.takeProfitPct,
      stopLossPct: this.params.stopLossPct,
      cooldownBars: this.params.cooldownBars,
    };
  }

  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    if (currentIndex < this.params.minCandles) return null;

    // Cooldown check
    if (this.lastTradeIndex >= 0 && currentIndex - this.lastTradeIndex < this.params.cooldownBars) {
      return null;
    }

    const candle = candles[currentIndex];
    if (!candle) return null;

    const price = candle.close;

    // Use cached indicators from the snapshot
    const rsi = indicators.rsi;
    const adx = indicators.adx;
    const bbUpper = indicators.bbUpper;
    const bbMiddle = indicators.bbMiddle;
    const bbLower = indicators.bbLower;
    const kcUpper = indicators.kcUpper;
    const kcMiddle = indicators.kcMiddle;
    const kcLower = indicators.kcLower;
    const atr = indicators.atr;
    const isInSqueeze = indicators.squeezeOn ?? false;

    // Validate all required indicators are present
    if (
      rsi === undefined ||
      adx === undefined ||
      bbUpper === undefined ||
      bbMiddle === undefined ||
      bbLower === undefined ||
      kcUpper === undefined ||
      kcMiddle === undefined ||
      kcLower === undefined ||
      atr === undefined
    ) {
      return null;
    }

    // Update squeeze history
    this.squeezeHistory.push(isInSqueeze);
    if (this.squeezeHistory.length > this.params.squeezeRecencyBars) {
      this.squeezeHistory.shift();
    }

    const wasRecentlyInSqueeze = this.squeezeHistory.some(s => s);

    // Must be in or recently exited squeeze
    if (!isInSqueeze && !wasRecentlyInSqueeze) return null;

    // Must be in ranging market
    if (adx > this.params.adxThreshold) return null;

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
        ...indicators,
        rsi,
        adx,
        bbUpper,
        bbMiddle,
        bbLower,
        kcUpper,
        kcMiddle,
        kcLower,
        atr,
        isInSqueeze,
        wasRecentlyInSqueeze,
      },
    };

    // LONG: Price at lower BB + RSI oversold
    if (price <= bbLower && rsi < this.params.rsiOversold) {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: 'CALL',
        price,
        confidence: this.calculateConfidence(rsi, adx, isInSqueeze),
        reason: `BB Squeeze MR LONG: Price (${price.toFixed(2)}) <= BB_Lower (${bbLower.toFixed(2)}), RSI=${rsi.toFixed(1)}, ADX=${adx.toFixed(1)}, Squeeze=${isInSqueeze}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    // SHORT: Price at upper BB + RSI overbought
    if (price >= bbUpper && rsi > this.params.rsiOverbought) {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: 'PUT',
        price,
        confidence: this.calculateConfidence(rsi, adx, isInSqueeze),
        reason: `BB Squeeze MR SHORT: Price (${price.toFixed(2)}) >= BB_Upper (${bbUpper.toFixed(2)}), RSI=${rsi.toFixed(1)}, ADX=${adx.toFixed(1)}, Squeeze=${isInSqueeze}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    return null;
  }


  private calculateConfidence(rsi: number, adx: number, isInSqueeze: boolean): number {
    let confidence = 50;

    // RSI extremes increase confidence
    if (rsi < 20 || rsi > 80) confidence += 15;
    else if (rsi < 25 || rsi > 75) confidence += 10;

    // Lower ADX increases confidence
    if (adx < 15) confidence += 15;
    else if (adx < 20) confidence += 10;

    // Active squeeze increases confidence
    if (isInSqueeze) confidence += 10;

    return Math.min(confidence, 95);
  }

  reset(): void {
    this.squeezeHistory = [];
    this.lastTradeIndex = -1;
  }
}

export function createBBSqueezeMRStrategy(
  asset: string,
  params?: Partial<BBSqueezeMRParams>
): BBSqueezeMRBacktestStrategy {
  return new BBSqueezeMRBacktestStrategy(asset, params);
}
