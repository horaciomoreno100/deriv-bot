/**
 * CryptoScalp Backtest Strategy Adapter
 *
 * Implements BacktestableStrategy for running CryptoScalp v2 in backtesting environment.
 */

import type { Candle, IndicatorSnapshot as SharedIndicatorSnapshot } from '@deriv-bot/shared';
import type {
  BacktestableStrategy,
  EntrySignal,
  BacktestConfig,
  MarketSnapshot,
} from '../types.js';
import {
  CryptoScalpStrategy,
  type CryptoScalpParams,
  type CryptoScalpIndicators,
} from '../../strategies/crypto-scalp/index.js';

type Direction = 'CALL' | 'PUT';

/**
 * CryptoScalp strategy adapter for backtesting
 */
export class CryptoScalpBacktestStrategy implements BacktestableStrategy {
  readonly name = 'CryptoScalp';
  readonly version = '2.0.0';

  private strategy: CryptoScalpStrategy;
  private asset: string;
  private lastIndicators: CryptoScalpIndicators | null = null;

  constructor(asset: string, customParams?: Partial<CryptoScalpParams>) {
    this.asset = asset;
    this.strategy = new CryptoScalpStrategy(asset, customParams);
  }

  /**
   * Required indicators for backtest engine
   */
  requiredIndicators(): string[] {
    // CryptoScalp calculates its own indicators internally
    // But we list them for reference
    return ['rsi', 'vwap', 'adx', 'atr', 'bbands', 'volume'];
  }

  /**
   * Get default backtest configuration
   */
  getDefaultConfig(): Partial<BacktestConfig> {
    const params = this.strategy.getParams();
    const tp1 = params.takeProfitLevels[0];

    return {
      asset: this.asset,
      takeProfitPct: tp1 ? tp1.profitPercent / 100 : 0.005,
      stopLossPct: params.baseStopLossPct / 100,
      cooldownBars: params.cooldownBars,
      maxBarsInTrade: params.maxBarsInTrade,
    };
  }

  /**
   * Check for entry signal
   */
  checkEntry(
    candles: Candle[],
    _indicators: SharedIndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Update strategy state
    this.strategy.updateState(currentIndex);

    // Check for entry
    const signal = this.strategy.checkEntry(candles, currentIndex);
    if (!signal) return null;

    // Store indicators for reference
    this.lastIndicators = this.strategy.calculateIndicators(
      candles.slice(0, currentIndex + 1)
    );

    const candle = candles[currentIndex]!;

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
      price: candle.close,
      indicators: {
        rsi: signal.indicators.rsi,
        vwap: signal.indicators.vwap,
        adx: signal.indicators.adx,
        plusDI: signal.indicators.plusDI,
        minusDI: signal.indicators.minusDI,
        atr: signal.indicators.atr,
        bbUpper: signal.indicators.bbUpper,
        bbMiddle: signal.indicators.bbMiddle,
        bbLower: signal.indicators.bbLower,
        volumeRatio: signal.indicators.volumeRatio,
      },
    };

    return {
      timestamp: candle.timestamp,
      direction: signal.direction,
      price: signal.price,
      confidence: signal.confidence,
      reason: signal.reason,
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot,
      suggestedTpPct: signal.suggestedTP / 100,
      suggestedSlPct: signal.suggestedSL / 100,
      metadata: {
        vwapBias: signal.indicators.vwapBias,
        trendStrength: signal.indicators.trendStrength,
        bbZone: signal.indicators.bbZone,
        trailingStopActivation: signal.trailingStopActivation,
      },
    };
  }

  /**
   * Check for exit signal (optional - backtest engine handles basic TP/SL)
   */
  checkExit(
    candles: Candle[],
    currentIndex: number,
    entryPrice: number,
    direction: Direction,
    barsHeld: number,
    highestPnlPct: number
  ): { reason: string; pnlPercent: number } | null {
    const signal = this.strategy.checkExit(
      candles,
      currentIndex,
      entryPrice,
      direction,
      barsHeld,
      highestPnlPct
    );

    if (!signal) return null;

    return {
      reason: signal.reason,
      pnlPercent: signal.pnlPercent,
    };
  }

  /**
   * Notify strategy of trade close
   */
  onTradeClose(isWin: boolean, currentIndex: number): void {
    this.strategy.onTradeClose(isWin, currentIndex);
  }

  /**
   * Get strategy parameters
   */
  getParams(): CryptoScalpParams {
    return this.strategy.getParams();
  }

  /**
   * Get last calculated indicators
   */
  getLastIndicators(): CryptoScalpIndicators | null {
    return this.lastIndicators;
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    this.strategy.reset();
    this.lastIndicators = null;
  }

  /**
   * Get warmup period
   */
  getWarmupPeriod(): number {
    return this.strategy.getWarmupPeriod();
  }
}

/**
 * Factory function
 */
export function createCryptoScalpBacktestStrategy(
  asset: string,
  params?: Partial<CryptoScalpParams>
): CryptoScalpBacktestStrategy {
  return new CryptoScalpBacktestStrategy(asset, params);
}
