/**
 * Hybrid Multi-Timeframe (MTF) Strategy - Backtest Adapter
 *
 * Combines Momentum and Mean Reversion based on multi-timeframe regime detection.
 *
 * LOGIC:
 * - 15m Context: Determines macro regime (BULLISH_TREND / BEARISH_TREND / RANGE)
 * - 5m Filter: RSI extremes filter (avoid buying tops/selling bottoms)
 * - 1m Execution: BB + RSI signals for precise entry
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { BollingerBands, ADX, SMA, RSI } from 'technicalindicators';

/**
 * Hybrid MTF Strategy Parameters
 */
interface HybridMTFParams {
  // 15m Context (Macro Trend Detection)
  ctxAdxPeriod: number;
  ctxAdxThreshold: number;
  ctxSmaPeriod: number;
  ctxSlopeThreshold: number;

  // 5m Filter (Intermediate RSI)
  midRsiPeriod: number;
  midRsiOverbought: number;
  midRsiOversold: number;

  // 1m Execution (BB + RSI)
  bbPeriod: number;
  bbStdDev: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  // Risk Management
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
  minCandles: number;

  // Confirmation
  confirmationCandles: number;
}

/**
 * Macro regime detected from 15m context
 */
type MacroRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE';

/**
 * Pending signal waiting for confirmation (Mean Reversion only)
 */
interface PendingSignal {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  timestamp: number;
  candleIndex: number;
  candlesWaited: number;
}

const DEFAULT_PARAMS: HybridMTFParams = {
  // 15m Context
  ctxAdxPeriod: 14,
  ctxAdxThreshold: 25,
  ctxSmaPeriod: 50,
  ctxSlopeThreshold: 0.0002,

  // 5m Filter
  midRsiPeriod: 14,
  midRsiOverbought: 80,
  midRsiOversold: 20,

  // 1m Execution
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  rsiOverbought: 55,
  rsiOversold: 45,

  // Risk Management
  takeProfitPct: 0.005,
  stopLossPct: 0.005,
  cooldownBars: 60, // 60 candles = 1 min cooldown for 1m timeframe
  minCandles: 100,

  // Confirmation
  confirmationCandles: 1,
};

const ASSET_CONFIGS: Record<string, Partial<HybridMTFParams>> = {
  'R_75': {
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
  },
  'R_100': {
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
  },
  'R_25': {
    takeProfitPct: 0.004,
    stopLossPct: 0.004,
  },
};

/**
 * Hybrid Multi-Timeframe Strategy for Backtesting
 */
export class HybridMTFBacktestStrategy implements BacktestableStrategy {
  readonly name = 'Hybrid-MTF';
  readonly version = '1.0.0';

  private params: HybridMTFParams;
  private asset: string;
  private lastTradeIndex: number = -1;
  private pendingSignal: PendingSignal | null = null;

  constructor(asset: string, customParams?: Partial<HybridMTFParams>) {
    this.asset = asset;
    const assetConfig = ASSET_CONFIGS[asset] ?? {};
    this.params = { ...DEFAULT_PARAMS, ...assetConfig, ...customParams };
  }

  requiredIndicators(): string[] {
    return ['rsi', 'bbUpper', 'bbMiddle', 'bbLower', 'adx', 'sma'];
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

    // Get candle slice for indicator calculation
    const slice = candles.slice(0, currentIndex + 1);
    const closes = slice.map(c => c.close);
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);

    // Resample to 5m and 15m candles
    const candles5m = this.resampleCandles(slice, 5);
    const candles15m = this.resampleCandles(slice, 15);

    // Detect regime from 15m candles
    const regime = this.detectRegime(candles15m);
    if (!regime) return null;

    // Get 5m RSI filter
    const rsi5m = this.calculate5mRSI(candles5m);
    if (rsi5m === null) return null;

    // Calculate 1m indicators
    const bbResult = BollingerBands.calculate({
      period: this.params.bbPeriod,
      values: closes,
      stdDev: this.params.bbStdDev,
    });

    const rsiResult = RSI.calculate({
      period: this.params.rsiPeriod,
      values: closes,
    });

    if (!bbResult.length || !rsiResult.length) return null;

    const bb = bbResult[bbResult.length - 1]!;
    const rsi = rsiResult[rsiResult.length - 1]!;

    if (!bb || rsi === undefined) return null;

    const breakoutAbove = price > bb.upper;
    const breakoutBelow = price < bb.lower;

    // Handle pending confirmation (Mean Reversion only)
    if (this.pendingSignal) {
      this.pendingSignal.candlesWaited++;

      if (this.pendingSignal.candlesWaited >= this.params.confirmationCandles) {
        const pending = this.pendingSignal;
        const confirmed = pending.direction === 'CALL'
          ? price > pending.entryPrice
          : price < pending.entryPrice;

        if (confirmed) {
          this.pendingSignal = null;
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
              ...indicators,
              rsi,
              rsi5m,
              regime,
              bbUpper: bb.upper,
              bbMiddle: bb.middle,
              bbLower: bb.lower,
            },
          };

          return {
            timestamp: candle.timestamp,
            direction: pending.direction,
            price,
            confidence: 80,
            reason: `Hybrid-MTF MEAN_REVERSION (confirmed): ${pending.direction} after ${pending.candlesWaited} candles, regime=${regime}`,
            strategyName: this.name,
            strategyVersion: this.version,
            snapshot,
            suggestedTpPct: this.params.takeProfitPct,
            suggestedSlPct: this.params.stopLossPct,
          };
        } else {
          // Signal cancelled
          this.pendingSignal = null;
        }
      }
      return null;
    }

    // Generate new signal based on regime
    let signal: 'CALL' | 'PUT' | null = null;
    let strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION' = 'MOMENTUM';

    if (regime === 'BULLISH_TREND') {
      // 15m BULLISH: Only CALLs (Momentum)
      // 5m Filter: Avoid extreme overbought
      if (rsi5m < this.params.midRsiOverbought) {
        if (breakoutAbove && rsi > this.params.rsiOverbought) {
          signal = 'CALL';
          strategyUsed = 'MOMENTUM';
        }
      }
    } else if (regime === 'BEARISH_TREND') {
      // 15m BEARISH: Only PUTs (Momentum)
      // 5m Filter: Avoid extreme oversold
      if (rsi5m > this.params.midRsiOversold) {
        if (breakoutBelow && rsi < this.params.rsiOversold) {
          signal = 'PUT';
          strategyUsed = 'MOMENTUM';
        }
      }
    } else {
      // RANGE: Mean Reversion with POST_CONFIRM
      strategyUsed = 'MEAN_REVERSION';

      if (breakoutAbove && rsi > this.params.rsiOverbought) {
        signal = 'PUT'; // Expect reversal DOWN
      } else if (breakoutBelow && rsi < this.params.rsiOversold) {
        signal = 'CALL'; // Expect reversal UP
      }
    }

    if (!signal) return null;

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
        rsi5m,
        regime,
        bbUpper: bb.upper,
        bbMiddle: bb.middle,
        bbLower: bb.lower,
      },
    };

    // For Momentum: Execute immediately
    if (strategyUsed === 'MOMENTUM') {
      this.lastTradeIndex = currentIndex;
      return {
        timestamp: candle.timestamp,
        direction: signal,
        price,
        confidence: 85,
        reason: `Hybrid-MTF MOMENTUM: ${signal} in ${regime}, RSI(1m)=${rsi.toFixed(1)}, RSI(5m)=${rsi5m.toFixed(1)}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: this.params.takeProfitPct,
        suggestedSlPct: this.params.stopLossPct,
      };
    }

    // For Mean Reversion: Wait for confirmation
    this.pendingSignal = {
      direction: signal,
      entryPrice: price,
      timestamp: candle.timestamp,
      candleIndex: currentIndex,
      candlesWaited: 0,
    };

    return null;
  }

  /**
   * Resample 1m candles to higher timeframe
   */
  private resampleCandles(candles1m: Candle[], intervalMinutes: number): Candle[] {
    const resampled: Candle[] = [];
    const intervalSeconds = intervalMinutes * 60;

    for (const candle of candles1m) {
      const slotStartSeconds = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;

      let resampledCandle = resampled.find(c => c.timestamp === slotStartSeconds);

      if (!resampledCandle) {
        resampledCandle = {
          timestamp: slotStartSeconds,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          asset: candle.asset,
        };
        resampled.push(resampledCandle);
      } else {
        resampledCandle.high = Math.max(resampledCandle.high, candle.high);
        resampledCandle.low = Math.min(resampledCandle.low, candle.low);
        resampledCandle.close = candle.close;
      }
    }

    return resampled.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Detect macro regime from 15m context
   */
  private detectRegime(candles15m: Candle[]): MacroRegime | null {
    if (candles15m.length < this.params.ctxSmaPeriod + 1) return null;

    const closes = candles15m.map(c => c.close);
    const highs = candles15m.map(c => c.high);
    const lows = candles15m.map(c => c.low);

    // Calculate ADX
    const adxResult = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.params.ctxAdxPeriod,
    });

    // Calculate SMA
    const smaResult = SMA.calculate({
      period: this.params.ctxSmaPeriod,
      values: closes,
    });

    if (adxResult.length < 2 || smaResult.length < 2) return null;

    const adxData = adxResult[adxResult.length - 1];
    const sma = smaResult[smaResult.length - 1];
    const prevSma = smaResult[smaResult.length - 2];

    if (!adxData || sma === undefined || prevSma === undefined) return null;

    const adx = adxData.adx;
    const smaSlope = (sma - prevSma) / prevSma;

    // Regime detection
    if (adx > this.params.ctxAdxThreshold) {
      if (smaSlope > this.params.ctxSlopeThreshold) return 'BULLISH_TREND';
      if (smaSlope < -this.params.ctxSlopeThreshold) return 'BEARISH_TREND';
    }

    return 'RANGE';
  }

  /**
   * Get 5m RSI for filtering
   */
  private calculate5mRSI(candles5m: Candle[]): number | null {
    if (candles5m.length < this.params.midRsiPeriod + 1) return null;

    const closes = candles5m.map(c => c.close);
    const rsiResult = RSI.calculate({
      period: this.params.midRsiPeriod,
      values: closes,
    });

    const lastRsi = rsiResult[rsiResult.length - 1];
    return lastRsi !== undefined ? lastRsi : null;
  }

  reset(): void {
    this.lastTradeIndex = -1;
    this.pendingSignal = null;
  }
}

export function createHybridMTFStrategy(
  asset: string,
  params?: Partial<HybridMTFParams>
): HybridMTFBacktestStrategy {
  return new HybridMTFBacktestStrategy(asset, params);
}
