/**
 * Hybrid Multi-Timeframe (MTF) Strategy v3.0.0 - Backtest Adapter with ML Data Collection
 *
 * This version extends the base HybridMTFBacktestStrategy with data collection
 * capabilities for ML model training.
 *
 * v3.0.0 Features:
 * - ATR-based dynamic TP/SL
 * - Normalized slope via linear regression
 * - Reversal confirmation (bullish/bearish candle + RSI cross)
 * - RSI divergence detection
 *
 * USAGE:
 * 1. Use this strategy instead of HybridMTFBacktestStrategy in your backtest script
 * 2. After backtest completes, call strategy.exportMLData() to save training data
 *
 * FEATURES COLLECTED:
 * - 60+ features per trade entry (expanded from v2.1.0)
 * - Time-based features (hour, day, 6-hour blocks for synthetic indices)
 * - Multi-timeframe indicators (1m, 5m, 15m)
 * - Engineered features (BB width, RSI delta, price position, etc.)
 * - v3.0.0 specific: ATR, normalized slope, RSI divergence, reversal confirmation
 * - Target labels (WIN/LOSS based on trade outcome)
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { BollingerBands, ADX, SMA, RSI, ATR } from 'technicalindicators';
import { DataCollector, createDataCollector } from '../data-collector.js';

/**
 * Hybrid MTF Strategy Parameters (v3.2.0)
 */
interface HybridMTFParams {
  // 15m Context (Macro Trend Detection) - v3.0.0: Normalized slope
  ctxAdxPeriod: number;
  ctxAdxThreshold: number;
  ctxSmaPeriod: number;
  ctxSlopeThreshold: number;        // Normalized slope threshold (default: 0.5 = 0.5x ATR)
  ctxSlopeRegressionPeriod: number; // Linear regression period (default: 5)

  // 5m Filter
  midRsiPeriod: number;
  midRsiOverbought: number;
  midRsiOversold: number;

  // 1m Execution
  bbPeriod: number;
  bbStdDev: number;
  bbWidthMin: number;
  bbWidthMax: number;               // v3.2.0: Max BB width to avoid high volatility
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  // Risk Management - v3.0.0: ATR-based dynamic TP/SL
  atrPeriod: number;
  atrStopLossMultiplier: number;    // SL = ATR * multiplier (default: 2.0)
  atrTakeProfitMultiplier: number;  // TP = ATR * multiplier (default: 3.0)
  cooldownBars: number;
  minCandles: number;

  // Confirmation
  confirmationCandles: number;

  // Reversal Confirmation (v3.0.0)
  requireReversalCandle: boolean;
  requireRSICross: boolean;

  // RSI Divergence Filter (v3.0.0)
  enableRSIDivergence: boolean;
  divergenceLookback: number;

  // v3.2.0: Time-based filters
  enableTimeFilter: boolean;
  avoidHourStart: number;
  avoidHourEnd: number;

  // v3.3.0: Additional time filter
  avoidHourStart2: number;
  avoidHourEnd2: number;

  // v3.2.0: ADX strength filter
  preferWeakADX: boolean;
  maxADXForEntry: number;

  // v3.3.0: Regime filter
  avoidBullishRegime: boolean;
}

type MacroRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE';

interface PendingSignal {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  timestamp: number;
  candleIndex: number;
  candlesWaited: number;
  mlTradeId?: string;
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
  atrPercent: number | null;        // v3.0.0: ATR as % for normalization
  normalizedSlope: number | null;   // v3.0.0: Linear regression normalized slope
  rsiDivergence: 'BULLISH' | 'BEARISH' | null; // v3.0.0
}

const DEFAULT_PARAMS: HybridMTFParams = {
  // 15m Context - v3.1.0: Reduced slope threshold to detect more trends
  ctxAdxPeriod: 10,
  ctxAdxThreshold: 20,
  ctxSmaPeriod: 20,
  ctxSlopeThreshold: 0.15,           // v3.1.0: Reduced from 0.5 (was too strict, 100% RANGE)
  ctxSlopeRegressionPeriod: 5,

  // 5m Filter
  midRsiPeriod: 14,
  midRsiOverbought: 70,
  midRsiOversold: 30,

  // 1m Execution - v3.2.0: Added bbWidthMax
  bbPeriod: 20,
  bbStdDev: 2,
  bbWidthMin: 0.003,
  bbWidthMax: 0.025,                 // v3.2.0: Max BB width to avoid high volatility (24.7% WR)
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,

  // Risk Management - v3.1.0: Tighter ATR multipliers
  atrPeriod: 14,
  atrStopLossMultiplier: 1.5,        // v3.1.0: Tighter SL (was 2.0)
  atrTakeProfitMultiplier: 2.5,      // v3.1.0: Adjusted TP (was 3.0), keeps 1.67:1 ratio
  cooldownBars: 5,
  minCandles: 100,

  // Confirmation
  confirmationCandles: 2,

  // Reversal Confirmation (v3.1.0)
  requireReversalCandle: true,
  requireRSICross: false,            // v3.1.0: Disabled - was filtering too many trades

  // RSI Divergence Filter (v3.1.0)
  enableRSIDivergence: false,        // v3.1.0: Disabled - ML showed it hurt performance
  divergenceLookback: 10,

  // v3.2.0: Time-based filters - ML showed 00-06h UTC has 25.5% WR vs 29% others
  enableTimeFilter: true,
  avoidHourStart: 0,
  avoidHourEnd: 6,

  // v3.3.0: Additional time filter - ML v3.2.0 showed 12-18h has 28.0% WR (worst)
  avoidHourStart2: 12,
  avoidHourEnd2: 18,

  // v3.2.0: ADX strength filter - ML showed ADX<20 has 30.4% WR vs 25.4% strong
  preferWeakADX: true,
  maxADXForEntry: 35,

  // v3.3.0: Regime filter - ML v3.2.0 showed BULLISH has 23.1% WR (very low)
  avoidBullishRegime: true,
};

/**
 * Hybrid MTF Strategy v3.3.0 with ML Data Collection
 */
export class HybridMTFBacktestMLStrategy implements BacktestableStrategy {
  readonly name = 'Hybrid-MTF-ML';
  readonly version = '3.3.0';

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
    this.params = { ...DEFAULT_PARAMS, ...customParams };
    this.dataCollector = createDataCollector(asset);
  }

  requiredIndicators(): string[] {
    return ['rsi', 'bbUpper', 'bbMiddle', 'bbLower', 'adx', 'sma', 'atr'];
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    // v3.0.0: TP/SL are calculated dynamically from ATR
    return {
      asset: this.asset,
      cooldownBars: this.params.cooldownBars,
    };
  }

  /**
   * Pre-calculate all MTF data ONCE before the backtest loop
   * Extended to include v3.0.0 features for ML
   */
  preCalculate(candles: Candle[]): void {
    console.log(`[Hybrid-MTF-ML v3.0.0] Pre-calculating MTF data for ${candles.length} candles...`);
    const startTime = Date.now();

    this.candles = candles;

    // Resample to 5m and 15m
    const candles5m = this.resampleAllCandles(candles, 5);
    const candles15m = this.resampleAllCandles(candles, 15);

    console.log(`[Hybrid-MTF-ML v3.0.0] Resampled: ${candles5m.length} x 5m, ${candles15m.length} x 15m`);

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

    // v3.0.0: ATR for 15m (for slope normalization)
    const atr15m = ATR.calculate({
      high: highs15m,
      low: lows15m,
      close: closes15m,
      period: this.params.atrPeriod,
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

    // v3.0.0: ATR for dynamic TP/SL
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
    const atr15mOffset = candles15m.length - atr15m.length;
    const rsi5mOffset = candles5m.length - rsi5mAll.length;
    const bbOffset = candles.length - bb1m.length;
    const rsi1mOffset = candles.length - rsi1m.length;
    const atr1mOffset = candles.length - atr1m.length;

    // Pre-calculate data for each 1m candle
    this.preCalculated = new Array(candles.length);

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!;

      const slot5m = Math.floor(candle.timestamp / 300) * 300;
      const slot15m = Math.floor(candle.timestamp / 900) * 900;

      const idx5m = ts5mToIndex.get(slot5m);
      const idx15m = ts15mToIndex.get(slot15m);

      // Calculate regime from 15m - v3.0.0: Normalized slope
      let regime: MacroRegime | null = null;
      let adx15mVal: number | null = null;
      let sma15mVal: number | null = null;
      let sma15mPrev: number | null = null;
      let atrPercent15m: number | null = null;
      let normalizedSlope: number | null = null;

      if (idx15m !== undefined) {
        const adxIdx = idx15m - adxOffset;
        const smaIdx = idx15m - smaOffset;
        const atr15mIdx = idx15m - atr15mOffset;

        // Get ATR for normalization
        if (atr15mIdx >= 0 && atr15m[atr15mIdx] !== undefined && candles15m[idx15m]) {
          const atr15mValRaw = atr15m[atr15mIdx]!;
          const price15m = candles15m[idx15m]!.close;
          atrPercent15m = (atr15mValRaw / price15m) * 100;
        }

        if (adxIdx >= 0 && smaIdx >= this.params.ctxSlopeRegressionPeriod && adx15m[adxIdx] && atrPercent15m !== null) {
          adx15mVal = adx15m[adxIdx]!.adx;
          sma15mVal = sma15m[smaIdx]!;
          sma15mPrev = smaIdx >= 1 ? sma15m[smaIdx - 1]! : null;

          // v3.0.0: Calculate normalized slope using linear regression
          const smaSlice = sma15m.slice(smaIdx - this.params.ctxSlopeRegressionPeriod + 1, smaIdx + 1);
          if (smaSlice.length === this.params.ctxSlopeRegressionPeriod) {
            const n = this.params.ctxSlopeRegressionPeriod;
            const x = Array.from({ length: n }, (_, j) => j);
            const y = smaSlice;

            const xMean = x.reduce((a, b) => a + b, 0) / n;
            const yMean = y.reduce((a, b) => a + b, 0) / n;

            let numerator = 0;
            let denominator = 0;
            for (let j = 0; j < n; j++) {
              const xDiff = x[j]! - xMean;
              const yDiff = y[j]! - yMean;
              numerator += xDiff * yDiff;
              denominator += xDiff * xDiff;
            }

            if (denominator !== 0) {
              const rawSlope = numerator / denominator;
              const atrDecimal = atrPercent15m / 100;
              normalizedSlope = rawSlope / (atrDecimal * smaSlice[smaSlice.length - 1]!);

              if (adx15mVal > this.params.ctxAdxThreshold) {
                if (normalizedSlope > this.params.ctxSlopeThreshold) regime = 'BULLISH_TREND';
                else if (normalizedSlope < -this.params.ctxSlopeThreshold) regime = 'BEARISH_TREND';
                else regime = 'RANGE';
              } else {
                regime = 'RANGE';
              }
            }
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

      // v3.0.0: Get 1m ATR for dynamic TP/SL
      let atr1mVal: number | null = null;
      let atrPercent1m: number | null = null;
      const atrIdx = i - atr1mOffset;
      if (atrIdx >= 0 && atr1m[atrIdx] !== undefined) {
        atr1mVal = atr1m[atrIdx]!;
        atrPercent1m = (atr1mVal / candle.close) * 100;
      }

      // v3.0.0: Check for RSI divergence (pre-calculate for range)
      let rsiDivergence: 'BULLISH' | 'BEARISH' | null = null;
      if (regime === 'RANGE' && this.params.enableRSIDivergence && i >= this.params.divergenceLookback) {
        rsiDivergence = this.checkRSIDivergenceForIndex(candles, rsi1m, rsi1mOffset, i);
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
        atrPercent: atrPercent1m,
        normalizedSlope,
        rsiDivergence,
      };
    }

    this.isPreCalculated = true;
    const elapsed = Date.now() - startTime;
    console.log(`[Hybrid-MTF-ML v3.0.0] Pre-calculation completed in ${elapsed}ms`);
  }

  /**
   * Check for RSI Divergence at a specific index (v3.0.0)
   */
  private checkRSIDivergenceForIndex(
    candles: Candle[],
    rsi1m: number[],
    rsi1mOffset: number,
    currentIndex: number
  ): 'BULLISH' | 'BEARISH' | null {
    const lookback = this.params.divergenceLookback;
    const startIdx = Math.max(0, currentIndex - lookback + 1);

    const priceSlice: number[] = [];
    const rsiSlice: number[] = [];

    for (let j = startIdx; j <= currentIndex; j++) {
      priceSlice.push(candles[j]!.close);
      const rsiIdx = j - rsi1mOffset;
      if (rsiIdx >= 0 && rsi1m[rsiIdx] !== undefined) {
        rsiSlice.push(rsi1m[rsiIdx]!);
      }
    }

    if (priceSlice.length < lookback || rsiSlice.length < lookback) {
      return null;
    }

    // Find extremes
    let priceLowestIdx = 0;
    let priceHighestIdx = 0;
    for (let j = 1; j < priceSlice.length; j++) {
      if (priceSlice[j]! < priceSlice[priceLowestIdx]!) priceLowestIdx = j;
      if (priceSlice[j]! > priceSlice[priceHighestIdx]!) priceHighestIdx = j;
    }

    // Check bullish divergence
    if (priceLowestIdx >= 3) {
      const recentLow = priceSlice[priceLowestIdx]!;
      const recentRSI = rsiSlice[priceLowestIdx]!;
      let prevLow = priceSlice[0]!;
      let prevLowIdx = 0;
      for (let j = 0; j < priceLowestIdx; j++) {
        if (priceSlice[j]! < prevLow) {
          prevLow = priceSlice[j]!;
          prevLowIdx = j;
        }
      }
      const prevRSI = rsiSlice[prevLowIdx]!;
      if (recentLow < prevLow && recentRSI > prevRSI) return 'BULLISH';
    }

    // Check bearish divergence
    if (priceHighestIdx >= 3) {
      const recentHigh = priceSlice[priceHighestIdx]!;
      const recentRSI = rsiSlice[priceHighestIdx]!;
      let prevHigh = priceSlice[0]!;
      let prevHighIdx = 0;
      for (let j = 0; j < priceHighestIdx; j++) {
        if (priceSlice[j]! > prevHigh) {
          prevHigh = priceSlice[j]!;
          prevHighIdx = j;
        }
      }
      const prevRSI = rsiSlice[prevHighIdx]!;
      if (recentHigh > prevHigh && recentRSI < prevRSI) return 'BEARISH';
    }

    return null;
  }

  /**
   * Calculate dynamic TP/SL based on ATR (v3.0.0)
   */
  private calculateDynamicTPSL(entryPrice: number, atr: number): { tpPct: number; slPct: number } {
    const slDistance = atr * this.params.atrStopLossMultiplier;
    const tpDistance = atr * this.params.atrTakeProfitMultiplier;
    return {
      slPct: slDistance / entryPrice,
      tpPct: tpDistance / entryPrice,
    };
  }

  /**
   * Check for reversal confirmation (v3.0.0)
   */
  private checkReversalConfirmation(
    currentCandle: Candle,
    prevCandle: Candle | null,
    currentRSI: number,
    prevRSI: number | null,
    direction: 'CALL' | 'PUT'
  ): boolean {
    if (!this.params.requireReversalCandle && !this.params.requireRSICross) {
      return true;
    }

    if (this.params.requireReversalCandle) {
      if (direction === 'CALL' && currentCandle.close <= currentCandle.open) return false;
      if (direction === 'PUT' && currentCandle.close >= currentCandle.open) return false;
    }

    if (this.params.requireRSICross && prevRSI !== null) {
      if (direction === 'CALL' && !(prevRSI < this.params.rsiOversold && currentRSI >= this.params.rsiOversold)) {
        return false;
      }
      if (direction === 'PUT' && !(prevRSI > this.params.rsiOverbought && currentRSI <= this.params.rsiOverbought)) {
        return false;
      }
    }

    return true;
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
    if (!data || !data.regime || data.rsi5m === null || !data.bb || data.rsi1m === null || data.atr1m === null) {
      return null;
    }

    const { regime, rsi5m, bb, rsi1m: rsi, atr1m: atr, adx15m } = data;

    // v3.2.0: Time-based filter - avoid 00-06h UTC (ML showed 25.5% WR vs 29% others)
    if (this.params.enableTimeFilter) {
      const hour = new Date(candle.timestamp * 1000).getUTCHours();
      if (hour >= this.params.avoidHourStart && hour < this.params.avoidHourEnd) {
        return null;
      }
      // v3.3.0: Also avoid 12-18h UTC (ML v3.2.0 showed 28.0% WR - worst block)
      if (hour >= this.params.avoidHourStart2 && hour < this.params.avoidHourEnd2) {
        return null;
      }
    }

    // v3.3.0: Regime filter - avoid BULLISH regime (ML v3.2.0 showed 23.1% WR)
    if (this.params.avoidBullishRegime && regime === 'BULLISH_TREND') {
      return null;
    }

    // v3.2.0: ADX strength filter - ML showed ADX<20 has 30.4% WR vs 25.4% strong
    if (this.params.maxADXForEntry > 0 && adx15m !== null && adx15m > this.params.maxADXForEntry) {
      return null;
    }

    // Get previous candle and RSI for reversal confirmation
    const prevCandle = currentIndex > 0 ? candles[currentIndex - 1] : null;
    const prevData = currentIndex > 0 ? this.preCalculated[currentIndex - 1] : null;
    const prevRSI = prevData?.rsi1m ?? null;

    // BB width filter
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    if (bbWidth < this.params.bbWidthMin) {
      return null;
    }

    // v3.2.0: BB width max filter - avoid high volatility (ML showed 24.7% WR)
    if (bbWidth > this.params.bbWidthMax) {
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
          // v3.0.0: Calculate dynamic TP/SL
          const { tpPct, slPct } = this.calculateDynamicTPSL(price, atr);

          // Capture ML data for confirmed signal with v3.0.0 features
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
              // v3.0.0 additions
              atrPercent: data.atrPercent,
              normalizedSlope: data.normalizedSlope,
              rsiDivergence: data.rsiDivergence,
              dynamicTpPct: tpPct,
              dynamicSlPct: slPct,
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
            reason: `Hybrid-MTF v3.0.0 MEAN_REVERSION (confirmed): ${pending.direction} after ${pending.candlesWaited} candles, regime=${regime}`,
            strategyName: this.name,
            strategyVersion: this.version,
            snapshot,
            suggestedTpPct: tpPct,
            suggestedSlPct: slPct,
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
      // 15m BULLISH: Only CALLs (Momentum) - v3.0.0: With reversal confirmation
      if (rsi5m < this.params.midRsiOverbought) {
        if (priceNearLowerBand && rsi < this.params.rsiOversold) {
          if (this.checkReversalConfirmation(candle, prevCandle, rsi, prevRSI, 'CALL')) {
            signal = 'CALL';
            strategyUsed = 'MOMENTUM';
          }
        }
      }
    } else if (regime === 'BEARISH_TREND') {
      // 15m BEARISH: Only PUTs (Momentum) - v3.0.0: With reversal confirmation
      if (rsi5m > this.params.midRsiOversold) {
        if (priceNearUpperBand && rsi > this.params.rsiOverbought) {
          if (this.checkReversalConfirmation(candle, prevCandle, rsi, prevRSI, 'PUT')) {
            signal = 'PUT';
            strategyUsed = 'MOMENTUM';
          }
        }
      }
    } else {
      // RANGE: Mean Reversion with POST_CONFIRM + RSI Divergence (v3.0.0)
      strategyUsed = 'MEAN_REVERSION';

      // v3.0.0: Use pre-calculated RSI divergence
      const divergence = data.rsiDivergence;

      if (breakoutAbove && rsi > this.params.rsiOverbought) {
        if (!this.params.enableRSIDivergence || divergence === 'BEARISH' || divergence === null) {
          signal = 'PUT';
        }
      } else if (breakoutBelow && rsi < this.params.rsiOversold) {
        if (!this.params.enableRSIDivergence || divergence === 'BULLISH' || divergence === null) {
          signal = 'CALL';
        }
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

    // For Momentum: Execute immediately with v3.0.0 features
    if (strategyUsed === 'MOMENTUM') {
      // v3.0.0: Calculate dynamic TP/SL
      const { tpPct, slPct } = this.calculateDynamicTPSL(price, atr);

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
          // v3.0.0 additions
          atrPercent: data.atrPercent,
          normalizedSlope: data.normalizedSlope,
          rsiDivergence: data.rsiDivergence,
          dynamicTpPct: tpPct,
          dynamicSlPct: slPct,
        },
      });

      this.activeTradeId = mlTradeId;
      this.lastTradeIndex = currentIndex;

      return {
        timestamp: candle.timestamp,
        direction: signal,
        price,
        confidence: 85,
        reason: `Hybrid-MTF v3.0.0 MOMENTUM: ${signal} in ${regime}, RSI(1m)=${rsi.toFixed(1)}, RSI(5m)=${rsi5m.toFixed(1)}, ATR=${atr.toFixed(4)}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: tpPct,
        suggestedSlPct: slPct,
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
    console.log(`[Hybrid-MTF-ML v3.0.0] ML Data Stats: ${stats.completed} completed trades, ${stats.winRate.toFixed(1)}% win rate`);
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
