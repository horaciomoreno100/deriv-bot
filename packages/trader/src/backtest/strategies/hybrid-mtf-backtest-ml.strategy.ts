/**
 * Hybrid Multi-Timeframe (MTF) Strategy - Backtest Adapter with ML Data Collection
 *
 * This version extends the base HybridMTFBacktestStrategy with data collection
 * capabilities for ML model training.
 *
 * USAGE:
 * 1. Use this strategy instead of HybridMTFBacktestStrategy in your backtest script
 * 2. After backtest completes, call strategy.exportMLData() to save training data
 *
 * FEATURES COLLECTED:
 * - 50+ features per trade entry
 * - Time-based features (hour, day, session)
 * - Multi-timeframe indicators (1m, 5m, 15m)
 * - Engineered features (BB width, RSI delta, price position, etc.)
 * - Target labels (WIN/LOSS based on trade outcome)
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { BollingerBands, ADX, SMA, RSI, ATR } from 'technicalindicators';
import { DataCollector, createDataCollector } from '../data-collector.js';

/**
 * Hybrid MTF Strategy Parameters
 */
interface HybridMTFParams {
  // 15m Context
  ctxAdxPeriod: number;
  ctxAdxThreshold: number;
  ctxSmaPeriod: number;
  ctxSlopeThreshold: number;

  // 5m Filter
  midRsiPeriod: number;
  midRsiOverbought: number;
  midRsiOversold: number;

  // 1m Execution
  bbPeriod: number;
  bbStdDev: number;
  bbWidthMin: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  atrPeriod: number;

  // Risk Management
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
  minCandles: number;
  confirmationCandles: number;
}

type MacroRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE';

interface PendingSignal {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  timestamp: number;
  candleIndex: number;
  candlesWaited: number;
  mlTradeId?: string; // Track ML data entry
}

interface PreCalculatedData {
  regime: MacroRegime | null;
  rsi5m: number | null;
  rsi5mPrev: number | null;
  bb: { upper: number; middle: number; lower: number } | null;
  rsi1m: number | null;
  rsi1mPrev: number | null;
  adx15m: number | null;
  sma15m: number | null;
  sma15mPrev: number | null;
  atr1m: number | null;
}

const DEFAULT_PARAMS: HybridMTFParams = {
  ctxAdxPeriod: 10,
  ctxAdxThreshold: 20,
  ctxSmaPeriod: 20,
  ctxSlopeThreshold: 0.0002,

  midRsiPeriod: 14,
  midRsiOverbought: 70,
  midRsiOversold: 30,

  bbPeriod: 20,
  bbStdDev: 2,
  bbWidthMin: 0.003,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  atrPeriod: 14,

  takeProfitPct: 0.008,
  stopLossPct: 0.005,
  cooldownBars: 5,
  minCandles: 100,
  confirmationCandles: 2,
};

const ASSET_CONFIGS: Record<string, Partial<HybridMTFParams>> = {
  'R_75': { takeProfitPct: 0.008, stopLossPct: 0.005 },
  'R_100': { takeProfitPct: 0.008, stopLossPct: 0.005 },
  'R_25': { takeProfitPct: 0.006, stopLossPct: 0.004 },
};

/**
 * Hybrid MTF Strategy with ML Data Collection
 */
export class HybridMTFBacktestMLStrategy implements BacktestableStrategy {
  readonly name = 'Hybrid-MTF-ML';
  readonly version = '2.1.0';

  private params: HybridMTFParams;
  private asset: string;
  private lastTradeIndex: number = -1;
  private pendingSignal: PendingSignal | null = null;

  // Pre-calculated data
  private preCalculated: PreCalculatedData[] = [];
  private isPreCalculated: boolean = false;
  private candles: Candle[] = [];

  // ML Data Collection
  private dataCollector: DataCollector;
  private activeTradeId: string | null = null;

  constructor(asset: string, customParams?: Partial<HybridMTFParams>) {
    this.asset = asset;
    const assetConfig = ASSET_CONFIGS[asset] ?? {};
    this.params = { ...DEFAULT_PARAMS, ...assetConfig, ...customParams };
    this.dataCollector = createDataCollector(asset);
  }

  requiredIndicators(): string[] {
    return ['rsi', 'bbUpper', 'bbMiddle', 'bbLower', 'adx', 'sma', 'atr'];
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
   * Extended to include additional features for ML
   */
  preCalculate(candles: Candle[]): void {
    console.log(`[Hybrid-MTF-ML] Pre-calculating MTF data for ${candles.length} candles...`);
    const startTime = Date.now();

    this.candles = candles;

    // Resample to 5m and 15m
    const candles5m = this.resampleAllCandles(candles, 5);
    const candles15m = this.resampleAllCandles(candles, 15);

    console.log(`[Hybrid-MTF-ML] Resampled: ${candles5m.length} x 5m, ${candles15m.length} x 15m`);

    // Calculate 15m indicators
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

    // Calculate 5m RSI
    const closes5m = candles5m.map(c => c.close);
    const rsi5mAll = RSI.calculate({
      period: this.params.midRsiPeriod,
      values: closes5m,
    });

    // Calculate 1m indicators
    const closes1m = candles.map(c => c.close);
    const highs1m = candles.map(c => c.high);
    const lows1m = candles.map(c => c.low);

    const bb1m = BollingerBands.calculate({
      period: this.params.bbPeriod,
      values: closes1m,
      stdDev: this.params.bbStdDev,
    });

    const rsi1m = RSI.calculate({
      period: this.params.rsiPeriod,
      values: closes1m,
    });

    const atr1m = ATR.calculate({
      high: highs1m,
      low: lows1m,
      close: closes1m,
      period: this.params.atrPeriod,
    });

    // Build timestamp index mappings
    const ts5mToIndex = new Map<number, number>();
    const ts15mToIndex = new Map<number, number>();

    candles5m.forEach((c, i) => ts5mToIndex.set(c.timestamp, i));
    candles15m.forEach((c, i) => ts15mToIndex.set(c.timestamp, i));

    // Calculate offsets
    const adxOffset = candles15m.length - adx15m.length;
    const smaOffset = candles15m.length - sma15m.length;
    const rsi5mOffset = candles5m.length - rsi5mAll.length;
    const bbOffset = candles.length - bb1m.length;
    const rsi1mOffset = candles.length - rsi1m.length;
    const atrOffset = candles.length - atr1m.length;

    // Pre-calculate data for each 1m candle
    this.preCalculated = new Array(candles.length);

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!;

      const slot5m = Math.floor(candle.timestamp / 300) * 300;
      const slot15m = Math.floor(candle.timestamp / 900) * 900;

      const idx5m = ts5mToIndex.get(slot5m);
      const idx15m = ts15mToIndex.get(slot15m);

      // Calculate regime from 15m
      let regime: MacroRegime | null = null;
      let adx15mVal: number | null = null;
      let sma15mVal: number | null = null;
      let sma15mPrev: number | null = null;

      if (idx15m !== undefined) {
        const adxIdx = idx15m - adxOffset;
        const smaIdx = idx15m - smaOffset;

        if (adxIdx >= 0 && smaIdx >= 1 && adx15m[adxIdx] && sma15m[smaIdx] !== undefined && sma15m[smaIdx - 1] !== undefined) {
          adx15mVal = adx15m[adxIdx]!.adx;
          sma15mVal = sma15m[smaIdx]!;
          sma15mPrev = sma15m[smaIdx - 1]!;
          const smaSlope = (sma15mVal - sma15mPrev) / sma15mPrev;

          if (adx15mVal > this.params.ctxAdxThreshold) {
            if (smaSlope > this.params.ctxSlopeThreshold) regime = 'BULLISH_TREND';
            else if (smaSlope < -this.params.ctxSlopeThreshold) regime = 'BEARISH_TREND';
            else regime = 'RANGE';
          } else {
            regime = 'RANGE';
          }
        }
      }

      // Get 5m RSI (current and previous)
      let rsi5m: number | null = null;
      let rsi5mPrev: number | null = null;

      if (idx5m !== undefined) {
        const rsiIdx = idx5m - rsi5mOffset;
        if (rsiIdx >= 0 && rsi5mAll[rsiIdx] !== undefined) {
          rsi5m = rsi5mAll[rsiIdx]!;
        }
        if (rsiIdx >= 1 && rsi5mAll[rsiIdx - 1] !== undefined) {
          rsi5mPrev = rsi5mAll[rsiIdx - 1]!;
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

      // Get 1m RSI (current and previous)
      let rsi1mVal: number | null = null;
      let rsi1mPrev: number | null = null;
      const rsiIdx = i - rsi1mOffset;
      if (rsiIdx >= 0 && rsi1m[rsiIdx] !== undefined) {
        rsi1mVal = rsi1m[rsiIdx]!;
      }
      if (rsiIdx >= 1 && rsi1m[rsiIdx - 1] !== undefined) {
        rsi1mPrev = rsi1m[rsiIdx - 1]!;
      }

      // Get 1m ATR
      let atr1mVal: number | null = null;
      const atrIdx = i - atrOffset;
      if (atrIdx >= 0 && atr1m[atrIdx] !== undefined) {
        atr1mVal = atr1m[atrIdx]!;
      }

      this.preCalculated[i] = {
        regime,
        rsi5m,
        rsi5mPrev,
        bb,
        rsi1m: rsi1mVal,
        rsi1mPrev,
        adx15m: adx15mVal,
        sma15m: sma15mVal,
        sma15mPrev,
        atr1m: atr1mVal,
      };
    }

    this.isPreCalculated = true;
    const elapsed = Date.now() - startTime;
    console.log(`[Hybrid-MTF-ML] Pre-calculation completed in ${elapsed}ms`);
  }

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
    if (!this.isPreCalculated) {
      this.preCalculate(candles);
    }

    if (currentIndex < this.params.minCandles) return null;

    const candle = candles[currentIndex];
    if (!candle) return null;

    const price = candle.close;

    const data = this.preCalculated[currentIndex];
    if (!data || !data.regime || data.rsi5m === null || !data.bb || data.rsi1m === null) {
      return null;
    }

    const { regime, rsi5m, bb, rsi1m: rsi } = data;

    // BB width filter
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    if (bbWidth < this.params.bbWidthMin) {
      return null;
    }

    const breakoutAbove = price > bb.upper;
    const breakoutBelow = price < bb.lower;
    const priceNearLowerBand = price <= bb.lower * 1.005;
    const priceNearUpperBand = price >= bb.upper * 0.995;

    // Handle pending confirmation
    if (this.pendingSignal) {
      this.pendingSignal.candlesWaited++;

      if (this.pendingSignal.candlesWaited >= this.params.confirmationCandles) {
        const pending = this.pendingSignal;
        const confirmed = pending.direction === 'CALL'
          ? price > pending.entryPrice
          : price < pending.entryPrice;

        if (confirmed) {
          // Capture ML data for confirmed signal
          const mlTradeId = this.dataCollector.captureEntry({
            candles,
            currentIndex,
            direction: pending.direction,
            entryPrice: price,
            confidence: 80,
            regime,
            strategyType: 'MEAN_REVERSION',
            indicators: {
              rsi1m: data.rsi1m,
              rsi1mPrev: data.rsi1mPrev,
              rsi5m: data.rsi5m,
              rsi5mPrev: data.rsi5mPrev,
              bbUpper: data.bb?.upper ?? null,
              bbMiddle: data.bb?.middle ?? null,
              bbLower: data.bb?.lower ?? null,
              adx15m: data.adx15m,
              sma15m: data.sma15m,
              sma15mPrev: data.sma15mPrev,
              atr1m: data.atr1m,
            },
          });

          this.activeTradeId = mlTradeId;
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
          this.pendingSignal = null;
        }
      }
      return null;
    }

    // Generate new signal based on regime
    let signal: 'CALL' | 'PUT' | null = null;
    let strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION' = 'MOMENTUM';

    if (regime === 'BULLISH_TREND') {
      if (rsi5m < this.params.midRsiOverbought) {
        if (priceNearLowerBand && rsi < this.params.rsiOversold) {
          signal = 'CALL';
          strategyUsed = 'MOMENTUM';
        }
      }
    } else if (regime === 'BEARISH_TREND') {
      if (rsi5m > this.params.midRsiOversold) {
        if (priceNearUpperBand && rsi > this.params.rsiOverbought) {
          signal = 'PUT';
          strategyUsed = 'MOMENTUM';
        }
      }
    } else {
      // RANGE: Mean Reversion with confirmation
      strategyUsed = 'MEAN_REVERSION';

      if (breakoutAbove && rsi > this.params.rsiOverbought) {
        signal = 'PUT';
      } else if (breakoutBelow && rsi < this.params.rsiOversold) {
        signal = 'CALL';
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

    // For Momentum: Execute immediately and capture ML data
    if (strategyUsed === 'MOMENTUM') {
      const mlTradeId = this.dataCollector.captureEntry({
        candles,
        currentIndex,
        direction: signal,
        entryPrice: price,
        confidence: 85,
        regime,
        strategyType: 'MOMENTUM',
        indicators: {
          rsi1m: data.rsi1m,
          rsi1mPrev: data.rsi1mPrev,
          rsi5m: data.rsi5m,
          rsi5mPrev: data.rsi5mPrev,
          bbUpper: data.bb?.upper ?? null,
          bbMiddle: data.bb?.middle ?? null,
          bbLower: data.bb?.lower ?? null,
          adx15m: data.adx15m,
          sma15m: data.sma15m,
          sma15mPrev: data.sma15mPrev,
          atr1m: data.atr1m,
        },
      });

      this.activeTradeId = mlTradeId;
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

    // For Mean Reversion: Wait for confirmation (don't capture ML data yet)
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
   * Report trade outcome for ML data collection
   * Call this from the backtest runner after each trade closes
   */
  reportTradeOutcome(params: {
    exitReason: 'TP' | 'SL' | 'TIMEOUT' | 'TRAILING_STOP';
    pnl: number;
    barsHeld: number;
  }): void {
    if (this.activeTradeId) {
      this.dataCollector.updateOutcome({
        tradeId: this.activeTradeId,
        exitReason: params.exitReason,
        pnl: params.pnl,
        barsHeld: params.barsHeld,
      });
      this.activeTradeId = null;
    }
  }

  /**
   * Get the DataCollector instance for direct access
   */
  getDataCollector(): DataCollector {
    return this.dataCollector;
  }

  /**
   * Export ML training data to CSV
   */
  exportMLData(outputDir?: string): string {
    const stats = this.dataCollector.getStats();
    console.log(`[Hybrid-MTF-ML] ML Data Stats: ${stats.completed} completed trades, ${stats.winRate.toFixed(1)}% win rate`);
    return this.dataCollector.exportToCSV(outputDir);
  }

  /**
   * Export ML training data to JSON
   */
  exportMLDataJSON(outputDir?: string): string {
    return this.dataCollector.exportToJSON(outputDir);
  }

  reset(): void {
    this.lastTradeIndex = -1;
    this.pendingSignal = null;
    this.preCalculated = [];
    this.isPreCalculated = false;
    this.candles = [];
    this.activeTradeId = null;
    this.dataCollector.reset();
  }
}

export function createHybridMTFMLStrategy(
  asset: string,
  params?: Partial<HybridMTFParams>
): HybridMTFBacktestMLStrategy {
  return new HybridMTFBacktestMLStrategy(asset, params);
}
