/**
 * BB Squeeze Mean Reversion Strategy - Backtest Adapter
 *
 * Wraps the live BBSqueezeMRStrategy to implement BacktestableStrategy interface.
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { BollingerBands, ATR, RSI, ADX } from 'technicalindicators';

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
  takeProfitPct: 0.005,
  stopLossPct: 0.003,
  cooldownBars: 1,
  minCandles: 50,
  maxBars: 12,
  squeezeRecencyBars: 5,
};

const ASSET_CONFIGS: Record<string, Partial<BBSqueezeMRParams>> = {
  'R_75': {
    kcMultiplier: 1.5,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
  },
  'R_100': {
    kcMultiplier: 1.5,
    takeProfitPct: 0.006,
    stopLossPct: 0.003,
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
    return ['rsi', 'adx', 'bbUpper', 'bbMiddle', 'bbLower', 'kcUpper', 'kcMiddle', 'kcLower', 'atr'];
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

    // Calculate indicators
    const slice = candles.slice(0, currentIndex + 1);
    const closes = slice.map(c => c.close);
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);

    // Bollinger Bands
    const bbResult = BollingerBands.calculate({
      period: this.params.bbPeriod,
      values: closes,
      stdDev: this.params.bbStdDev,
    });

    // RSI
    const rsiResult = RSI.calculate({
      period: this.params.rsiPeriod,
      values: closes,
    });

    // ADX
    const adxResult = ADX.calculate({
      period: this.params.adxPeriod,
      high: highs,
      low: lows,
      close: closes,
    });

    // ATR
    const atrResult = ATR.calculate({
      period: 14,
      high: highs,
      low: lows,
      close: closes,
    });

    if (!bbResult.length || !rsiResult.length || !adxResult.length || !atrResult.length) {
      return null;
    }

    const bb = bbResult[bbResult.length - 1]!;
    const rsi = rsiResult[rsiResult.length - 1]!;
    const adxData = adxResult[adxResult.length - 1];
    const atr = atrResult[atrResult.length - 1]!;

    if (!bb || rsi === undefined || !adxData) return null;

    const adx = adxData.adx;

    // Calculate Keltner Channels
    const kc = this.calculateKeltnerChannel(closes, atr);
    if (!kc) return null;

    // Detect squeeze
    const isInSqueeze = bb.upper < kc.upper && bb.lower > kc.lower;

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
        bbUpper: bb.upper,
        bbMiddle: bb.middle,
        bbLower: bb.lower,
        kcUpper: kc.upper,
        kcMiddle: kc.middle,
        kcLower: kc.lower,
        isInSqueeze,
        wasRecentlyInSqueeze,
      },
    };

    // LONG: Price at lower BB + RSI oversold
    if (price <= bb.lower && rsi < this.params.rsiOversold) {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: 'CALL',
        price,
        confidence: this.calculateConfidence(rsi, adx, isInSqueeze),
        reason: `BB Squeeze MR LONG: Price (${price.toFixed(2)}) <= BB_Lower (${bb.lower.toFixed(2)}), RSI=${rsi.toFixed(1)}, ADX=${adx.toFixed(1)}, Squeeze=${isInSqueeze}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    // SHORT: Price at upper BB + RSI overbought
    if (price >= bb.upper && rsi > this.params.rsiOverbought) {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: 'PUT',
        price,
        confidence: this.calculateConfidence(rsi, adx, isInSqueeze),
        reason: `BB Squeeze MR SHORT: Price (${price.toFixed(2)}) >= BB_Upper (${bb.upper.toFixed(2)}), RSI=${rsi.toFixed(1)}, ADX=${adx.toFixed(1)}, Squeeze=${isInSqueeze}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    return null;
  }

  private calculateKeltnerChannel(closes: number[], atr: number): { upper: number; middle: number; lower: number } | null {
    // Simple EMA calculation
    const period = this.params.kcPeriod;
    if (closes.length < period) return null;

    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < closes.length; i++) {
      ema = closes[i]! * k + ema * (1 - k);
    }

    return {
      upper: ema + atr * this.params.kcMultiplier,
      middle: ema,
      lower: ema - atr * this.params.kcMultiplier,
    };
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
