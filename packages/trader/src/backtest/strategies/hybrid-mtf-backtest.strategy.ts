/**
 * Hybrid Multi-Timeframe (MTF) Strategy - Backtest Adapter (OPTIMIZED)
 *
 * Combines Momentum and Mean Reversion based on multi-timeframe regime detection.
 *
 * OPTIMIZATION: Pre-calculates 5m and 15m candles + indicators ONCE before backtest
 * instead of resampling on every candle (O(n) vs O(n²))
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
  ctxAdxPeriod: number;       // ADX period for trend strength (default: 10)
  ctxAdxThreshold: number;    // ADX threshold for trend (default: 20)
  ctxSmaPeriod: number;       // SMA period for trend direction (default: 20)
  ctxSlopeThreshold: number;  // Min slope for trend confirmation

  // 5m Filter (Intermediate RSI)
  midRsiPeriod: number;
  midRsiOverbought: number;   // 5m RSI overbought (default: 70)
  midRsiOversold: number;     // 5m RSI oversold (default: 30)

  // 1m Execution (BB + RSI)
  bbPeriod: number;
  bbStdDev: number;
  bbWidthMin: number;         // Min BB width to avoid low volatility (default: 0.003)
  rsiPeriod: number;
  rsiOverbought: number;      // 1m RSI overbought (default: 70)
  rsiOversold: number;        // 1m RSI oversold (default: 30)

  // Risk Management
  takeProfitPct: number;      // TP % (default: 0.008 = 0.8%)
  stopLossPct: number;        // SL % (default: 0.005 = 0.5%) -> 1.6:1 ratio
  cooldownBars: number;
  minCandles: number;

  // Confirmation
  confirmationCandles: number; // Candles to wait for MR confirmation (default: 2)
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

/**
 * Pre-calculated data for a specific 1m candle index
 */
interface PreCalculatedData {
  regime: MacroRegime | null;
  rsi5m: number | null;
  bb: { upper: number; middle: number; lower: number } | null;
  rsi1m: number | null;
}

const DEFAULT_PARAMS: HybridMTFParams = {
  // 15m Context - ADX 10 is faster than 14 for regime detection
  ctxAdxPeriod: 10,
  ctxAdxThreshold: 20,
  ctxSmaPeriod: 20,
  ctxSlopeThreshold: 0.0002,

  // 5m Filter - 70/30 are useful extremes (80/20 rarely triggers)
  midRsiPeriod: 14,
  midRsiOverbought: 70,
  midRsiOversold: 30,

  // 1m Execution - 70/30 for real overbought/oversold (55/45 is neutral zone)
  bbPeriod: 20,
  bbStdDev: 2,
  bbWidthMin: 0.003, // Min BB width to avoid low volatility environments
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,

  // Risk Management - 1.6:1 ratio (TP 0.8% / SL 0.5%)
  takeProfitPct: 0.008,
  stopLossPct: 0.005,
  cooldownBars: 5,
  minCandles: 100,

  // Confirmation - 2 candles for Mean Reversion (1 is too aggressive)
  confirmationCandles: 2,
};

const ASSET_CONFIGS: Record<string, Partial<HybridMTFParams>> = {
  'R_75': {
    takeProfitPct: 0.008,
    stopLossPct: 0.005,
  },
  'R_100': {
    takeProfitPct: 0.008,
    stopLossPct: 0.005,
  },
  'R_25': {
    takeProfitPct: 0.006,
    stopLossPct: 0.004,
  },
};

/**
 * Hybrid Multi-Timeframe Strategy for Backtesting (OPTIMIZED)
 */
export class HybridMTFBacktestStrategy implements BacktestableStrategy {
  readonly name = 'Hybrid-MTF';
  readonly version = '2.0.0'; // Major update: fixed logic + improved params

  private params: HybridMTFParams;
  private asset: string;
  private lastTradeIndex: number = -1;
  private pendingSignal: PendingSignal | null = null;

  // Pre-calculated data (populated in preCalculate)
  private preCalculated: PreCalculatedData[] = [];
  private isPreCalculated: boolean = false;

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

  /**
   * Pre-calculate all MTF data ONCE before the backtest loop
   * This is called by the runner before starting the backtest
   */
  preCalculate(candles: Candle[]): void {
    console.log(`[Hybrid-MTF] Pre-calculating MTF data for ${candles.length} candles...`);
    const startTime = Date.now();

    // 1. Resample all candles to 5m and 15m ONCE
    const candles5m = this.resampleAllCandles(candles, 5);
    const candles15m = this.resampleAllCandles(candles, 15);

    console.log(`[Hybrid-MTF] Resampled: ${candles5m.length} x 5m, ${candles15m.length} x 15m`);

    // 2. Calculate 15m regime indicators (ADX + SMA)
    const closes15m = candles15m.map(c => c.close);
    const highs15m = candles15m.map(c => c.high);
    const lows15m = candles15m.map(c => c.low);

    const adx15m = ADX.calculate({
      high: highs15m,
      low: lows15m,
      close: closes15m,
      period: this.params.ctxAdxPeriod,
    });

    const sma15m = SMA.calculate({
      period: this.params.ctxSmaPeriod,
      values: closes15m,
    });

    // 3. Calculate 5m RSI
    const closes5m = candles5m.map(c => c.close);
    const rsi5mAll = RSI.calculate({
      period: this.params.midRsiPeriod,
      values: closes5m,
    });

    // 4. Calculate 1m indicators (BB + RSI)
    const closes1m = candles.map(c => c.close);
    const bb1m = BollingerBands.calculate({
      period: this.params.bbPeriod,
      values: closes1m,
      stdDev: this.params.bbStdDev,
    });
    const rsi1m = RSI.calculate({
      period: this.params.rsiPeriod,
      values: closes1m,
    });

    // 5. Build index mappings: 1m timestamp -> 5m/15m candle index
    const ts5mToIndex = new Map<number, number>();
    const ts15mToIndex = new Map<number, number>();

    candles5m.forEach((c, i) => ts5mToIndex.set(c.timestamp, i));
    candles15m.forEach((c, i) => ts15mToIndex.set(c.timestamp, i));

    // 6. Pre-calculate data for each 1m candle
    this.preCalculated = new Array(candles.length);

    // Offsets for indicator arrays (they start after warmup period)
    const adxOffset = candles15m.length - adx15m.length;
    const smaOffset = candles15m.length - sma15m.length;
    const rsi5mOffset = candles5m.length - rsi5mAll.length;
    const bbOffset = candles.length - bb1m.length;
    const rsi1mOffset = candles.length - rsi1m.length;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!;

      // Find corresponding 5m and 15m slot timestamps
      const slot5m = Math.floor(candle.timestamp / 300) * 300;
      const slot15m = Math.floor(candle.timestamp / 900) * 900;

      // Get indices in resampled arrays
      const idx5m = ts5mToIndex.get(slot5m);
      const idx15m = ts15mToIndex.get(slot15m);

      // Calculate regime from 15m
      let regime: MacroRegime | null = null;
      if (idx15m !== undefined) {
        const adxIdx = idx15m - adxOffset;
        const smaIdx = idx15m - smaOffset;

        if (adxIdx >= 0 && smaIdx >= 1 && adx15m[adxIdx] && sma15m[smaIdx] !== undefined && sma15m[smaIdx - 1] !== undefined) {
          const adx = adx15m[adxIdx]!.adx;
          const sma = sma15m[smaIdx]!;
          const prevSma = sma15m[smaIdx - 1]!;
          const smaSlope = (sma - prevSma) / prevSma;

          if (adx > this.params.ctxAdxThreshold) {
            if (smaSlope > this.params.ctxSlopeThreshold) regime = 'BULLISH_TREND';
            else if (smaSlope < -this.params.ctxSlopeThreshold) regime = 'BEARISH_TREND';
            else regime = 'RANGE';
          } else {
            regime = 'RANGE';
          }
        }
      }

      // Get 5m RSI
      let rsi5m: number | null = null;
      if (idx5m !== undefined) {
        const rsiIdx = idx5m - rsi5mOffset;
        if (rsiIdx >= 0 && rsi5mAll[rsiIdx] !== undefined) {
          rsi5m = rsi5mAll[rsiIdx]!;
        }
      }

      // Get 1m BB
      let bb: { upper: number; middle: number; lower: number } | null = null;
      const bbIdx = i - bbOffset;
      if (bbIdx >= 0 && bb1m[bbIdx]) {
        bb = {
          upper: bb1m[bbIdx]!.upper,
          middle: bb1m[bbIdx]!.middle,
          lower: bb1m[bbIdx]!.lower,
        };
      }

      // Get 1m RSI
      let rsi1mVal: number | null = null;
      const rsiIdx = i - rsi1mOffset;
      if (rsiIdx >= 0 && rsi1m[rsiIdx] !== undefined) {
        rsi1mVal = rsi1m[rsiIdx]!;
      }

      this.preCalculated[i] = {
        regime,
        rsi5m,
        bb,
        rsi1m: rsi1mVal,
      };
    }

    this.isPreCalculated = true;
    const elapsed = Date.now() - startTime;
    console.log(`[Hybrid-MTF] Pre-calculation completed in ${elapsed}ms`);
  }

  /**
   * Resample all 1m candles to higher timeframe
   */
  private resampleAllCandles(candles1m: Candle[], intervalMinutes: number): Candle[] {
    const resampled: Map<number, Candle> = new Map();
    const intervalSeconds = intervalMinutes * 60;

    for (const candle of candles1m) {
      const slotStart = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;

      const existing = resampled.get(slotStart);
      if (!existing) {
        resampled.set(slotStart, {
          timestamp: slotStart,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          asset: candle.asset,
          timeframe: intervalMinutes * 60,
        });
      } else {
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
      }
    }

    return Array.from(resampled.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Ensure pre-calculation is done
    if (!this.isPreCalculated) {
      this.preCalculate(candles);
    }

    if (currentIndex < this.params.minCandles) return null;

    const candle = candles[currentIndex];
    if (!candle) return null;

    const price = candle.close;

    // Get pre-calculated data for this index
    const data = this.preCalculated[currentIndex];
    if (!data || !data.regime || data.rsi5m === null || !data.bb || data.rsi1m === null) {
      return null;
    }

    const { regime, rsi5m, bb, rsi1m: rsi } = data;

    // BB width filter: avoid low volatility environments
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    if (bbWidth < this.params.bbWidthMin) {
      return null;
    }

    const breakoutAbove = price > bb.upper;
    const breakoutBelow = price < bb.lower;

    // Pullback zones for Momentum strategy
    const priceNearLowerBand = price <= bb.lower * 1.005; // Within 0.5% of lower
    const priceNearUpperBand = price >= bb.upper * 0.995; // Within 0.5% of upper

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
      // FIXED: Enter on PULLBACKS (price near lower BB, RSI oversold), not on extensions
      // 5m Filter: Avoid extreme overbought (trend exhaustion)
      if (rsi5m < this.params.midRsiOverbought) {
        // Buy the dip: price pulls back to lower BB with oversold RSI in bullish trend
        if (priceNearLowerBand && rsi < this.params.rsiOversold) {
          signal = 'CALL';
          strategyUsed = 'MOMENTUM';
        }
      }
    } else if (regime === 'BEARISH_TREND') {
      // 15m BEARISH: Only PUTs (Momentum)
      // FIXED: Enter on PULLBACKS (price near upper BB, RSI overbought), not on extensions
      // 5m Filter: Avoid extreme oversold (trend exhaustion)
      if (rsi5m > this.params.midRsiOversold) {
        // Sell the rally: price pulls back to upper BB with overbought RSI in bearish trend
        if (priceNearUpperBand && rsi > this.params.rsiOverbought) {
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

  reset(): void {
    this.lastTradeIndex = -1;
    this.pendingSignal = null;
    this.preCalculated = [];
    this.isPreCalculated = false;
  }
}

export function createHybridMTFStrategy(
  asset: string,
  params?: Partial<HybridMTFParams>
): HybridMTFBacktestStrategy {
  return new HybridMTFBacktestStrategy(asset, params);
}
