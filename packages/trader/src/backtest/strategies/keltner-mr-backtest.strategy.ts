/**
 * Keltner Channel Mean Reversion Strategy - Backtest Adapter
 *
 * Mean reversion using Keltner Channels (ATR-based, more adaptive to volatility).
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { ATR, EMA, RSI, ADX } from 'technicalindicators';

/**
 * Keltner MR specific parameters
 */
interface KeltnerMRParams {
  // Keltner Channel
  kcEmaPeriod: number;
  kcAtrPeriod: number;
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
}

const DEFAULT_PARAMS: KeltnerMRParams = {
  kcEmaPeriod: 20,
  kcAtrPeriod: 14,
  kcMultiplier: 2.0,
  rsiPeriod: 14,
  adxPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 65,
  adxThreshold: 25,
  takeProfitPct: 0.005,
  stopLossPct: 0.003,
  cooldownBars: 1,
  minCandles: 40,
  maxBars: 15,
};

const ASSET_CONFIGS: Record<string, Partial<KeltnerMRParams>> = {
  'R_75': {
    kcMultiplier: 2.0,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
  },
  'R_100': {
    kcMultiplier: 2.0,
    takeProfitPct: 0.006,
    stopLossPct: 0.003,
  },
};

/**
 * Keltner Channel Mean Reversion Strategy for Backtesting
 */
export class KeltnerMRBacktestStrategy implements BacktestableStrategy {
  readonly name = 'Keltner-MR';
  readonly version = '1.0.0';

  private params: KeltnerMRParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  constructor(asset: string, customParams?: Partial<KeltnerMRParams>) {
    this.asset = asset;
    const assetConfig = ASSET_CONFIGS[asset] ?? {};
    this.params = { ...DEFAULT_PARAMS, ...assetConfig, ...customParams };
  }

  requiredIndicators(): string[] {
    return ['rsi', 'adx', 'kcUpper', 'kcMiddle', 'kcLower', 'atr'];
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

    // EMA (Keltner middle)
    const emaResult = EMA.calculate({
      period: this.params.kcEmaPeriod,
      values: closes,
    });

    // ATR
    const atrResult = ATR.calculate({
      period: this.params.kcAtrPeriod,
      high: highs,
      low: lows,
      close: closes,
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

    if (!emaResult.length || !atrResult.length || !rsiResult.length || !adxResult.length) {
      return null;
    }

    const ema = emaResult[emaResult.length - 1]!;
    const atr = atrResult[atrResult.length - 1]!;
    const rsi = rsiResult[rsiResult.length - 1]!;
    const adxData = adxResult[adxResult.length - 1];

    if (ema === undefined || atr === undefined || rsi === undefined || !adxData) {
      return null;
    }

    const adx = adxData.adx;

    // Calculate Keltner Channels
    const kcUpper = ema + atr * this.params.kcMultiplier;
    const kcLower = ema - atr * this.params.kcMultiplier;

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
        kcUpper,
        kcMiddle: ema,
        kcLower,
        atr,
      },
    };

    // LONG: Price at lower Keltner + RSI oversold
    if (price <= kcLower && rsi < this.params.rsiOversold) {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: 'CALL',
        price,
        confidence: this.calculateConfidence(rsi, adx, price, kcLower, 'LONG'),
        reason: `Keltner MR LONG: Price (${price.toFixed(2)}) <= KC_Lower (${kcLower.toFixed(2)}), RSI=${rsi.toFixed(1)}, ADX=${adx.toFixed(1)}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    // SHORT: Price at upper Keltner + RSI overbought
    if (price >= kcUpper && rsi > this.params.rsiOverbought) {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: 'PUT',
        price,
        confidence: this.calculateConfidence(rsi, adx, price, kcUpper, 'SHORT'),
        reason: `Keltner MR SHORT: Price (${price.toFixed(2)}) >= KC_Upper (${kcUpper.toFixed(2)}), RSI=${rsi.toFixed(1)}, ADX=${adx.toFixed(1)}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    return null;
  }

  private calculateConfidence(
    rsi: number,
    adx: number,
    price: number,
    band: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    let confidence = 50;

    // More extreme RSI = higher confidence
    if (direction === 'LONG') {
      if (rsi < 25) confidence += 15;
      else if (rsi < 30) confidence += 10;
    } else {
      if (rsi > 75) confidence += 15;
      else if (rsi > 70) confidence += 10;
    }

    // Price further beyond band = higher confidence
    const distancePct = Math.abs((price - band) / band);
    if (distancePct > 0.005) confidence += 10;

    // Lower ADX = higher confidence
    if (adx < 15) confidence += 15;
    else if (adx < 20) confidence += 10;

    return Math.min(confidence, 90);
  }

  reset(): void {
    this.lastTradeIndex = -1;
  }
}

export function createKeltnerMRStrategy(
  asset: string,
  params?: Partial<KeltnerMRParams>
): KeltnerMRBacktestStrategy {
  return new KeltnerMRBacktestStrategy(asset, params);
}
