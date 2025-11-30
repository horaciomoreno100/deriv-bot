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
import { BollingerBands, ADX, SMA, RSI, ATR } from 'technicalindicators';

/**
 * Hybrid MTF Strategy Parameters
 */
interface HybridMTFParams {
  // 15m Context (Macro Trend Detection) - v3.0.0: Normalized slope
  ctxAdxPeriod: number;       // ADX period for trend strength (default: 10)
  ctxAdxThreshold: number;    // ADX threshold for trend (default: 20)
  ctxSmaPeriod: number;       // SMA period for trend direction (default: 20)
  ctxSlopeThreshold: number;  // Normalized slope threshold (default: 0.5 = 0.5x ATR)
  ctxSlopeRegressionPeriod: number; // Linear regression period (default: 5)

  // 5m Filter (Intermediate RSI)
  midRsiPeriod: number;
  midRsiOverbought: number;   // 5m RSI overbought (default: 70)
  midRsiOversold: number;     // 5m RSI oversold (default: 30)

  // 1m Execution (BB + RSI)
  bbPeriod: number;
  bbStdDev: number;
  bbWidthMin: number;         // Min BB width to avoid low volatility (default: 0.003)
  bbWidthMax: number;         // v3.2.0: Max BB width to avoid high volatility (default: 0.025)
  rsiPeriod: number;
  rsiOverbought: number;      // 1m RSI overbought (default: 70)
  rsiOversold: number;        // 1m RSI oversold (default: 30)

  // Risk Management - v3.0.0: ATR-based dynamic TP/SL
  atrPeriod: number;              // ATR period (default: 14)
  atrStopLossMultiplier: number;  // SL = ATR * multiplier (default: 2.0)
  atrTakeProfitMultiplier: number; // TP = ATR * multiplier (default: 3.0) -> 1.5:1 ratio
  cooldownBars: number;
  minCandles: number;

  // Confirmation
  confirmationCandles: number; // Candles to wait for MR confirmation (default: 2)

  // Reversal Confirmation (v3.0.0)
  requireReversalCandle: boolean; // Require bullish/bearish candle
  requireRSICross: boolean;       // Require RSI cross confirmation

  // RSI Divergence Filter (v3.0.0)
  enableRSIDivergence: boolean;   // Enable for RANGE regime
  divergenceLookback: number;     // Lookback period (default: 10)

  // v3.2.0: Time-based filters (ML analysis showed 00-06h has 25.5% WR vs 29% others)
  enableTimeFilter: boolean;      // Enable time-of-day filtering
  avoidHourStart: number;         // Start hour to avoid (UTC)
  avoidHourEnd: number;           // End hour to avoid (UTC)

  // v3.3.0: Additional time filter (ML v3.2.0 showed 12-18h has 28.0% WR - worst)
  avoidHourStart2: number;        // Second time window to avoid (start)
  avoidHourEnd2: number;          // Second time window to avoid (end)

  // v3.2.0: ADX strength filter (ML showed ADX<20 has 30.4% WR vs 25.4% strong)
  preferWeakADX: boolean;         // Prefer weak ADX conditions
  maxADXForEntry: number;         // Maximum ADX for entry (0 = disabled)

  // v3.3.0: Regime filter (ML v3.2.0 showed BULLISH has 23.1% WR - very low)
  avoidBullishRegime: boolean;    // Avoid trades in BULLISH_TREND regime
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
  atr: number | null;  // v3.0.0: ATR for dynamic TP/SL
  atrPercent: number | null;  // v3.0.0: ATR as % for slope normalization
  adx15m: number | null;  // v3.2.0: ADX for filtering
}

const DEFAULT_PARAMS: HybridMTFParams = {
  // 15m Context - v3.1.0: Reduced slope threshold based on ML analysis
  // ML showed 100% trades were RANGE because 0.5 was too strict
  ctxAdxPeriod: 10,
  ctxAdxThreshold: 20,
  ctxSmaPeriod: 20,
  ctxSlopeThreshold: 0.15,       // v3.1.0: Reduced from 0.5 to detect more trends
  ctxSlopeRegressionPeriod: 5,   // Linear regression on last 5 points

  // 5m Filter - 70/30 are useful extremes (80/20 rarely triggers)
  midRsiPeriod: 14,
  midRsiOverbought: 70,
  midRsiOversold: 30,

  // 1m Execution - v3.2.0: Added bbWidthMax based on ML (high vol = 24.7% WR)
  bbPeriod: 20,
  bbStdDev: 2,
  bbWidthMin: 0.003,  // Min BB width to avoid low volatility
  bbWidthMax: 0.025,  // v3.2.0: Max BB width to avoid high volatility (24.7% WR)
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,

  // Risk Management - v3.1.0: Adjusted ATR multipliers for better R:R
  atrPeriod: 14,
  atrStopLossMultiplier: 1.5,    // v3.1.0: Tighter SL (was 2.0)
  atrTakeProfitMultiplier: 2.5,  // v3.1.0: Adjusted TP (was 3.0) -> 1.67:1 ratio
  cooldownBars: 5,
  minCandles: 100,

  // Confirmation - 2 candles for Mean Reversion
  confirmationCandles: 2,

  // Reversal Confirmation (v3.1.0) - ML showed RSI cross was too restrictive
  requireReversalCandle: true,
  requireRSICross: false,        // v3.1.0: Disabled - was filtering too many trades

  // RSI Divergence Filter (v3.1.0) - ML showed it hurt performance (15% WR vs 28%)
  enableRSIDivergence: false,    // v3.1.0: Disabled based on ML analysis
  divergenceLookback: 10,

  // v3.2.0: Time-based filters - ML showed 00-06h UTC has 25.5% WR vs 29% others
  enableTimeFilter: true,        // Enable time filtering
  avoidHourStart: 0,             // Start avoiding at midnight UTC
  avoidHourEnd: 6,               // Stop avoiding at 6am UTC

  // v3.3.0: Additional time filter - ML v3.2.0 showed 12-18h has 28.0% WR (worst)
  avoidHourStart2: 12,           // Also avoid 12-18h UTC
  avoidHourEnd2: 18,

  // v3.2.0: ADX strength filter - ML showed ADX<20 has 30.4% WR vs 25.4% strong
  preferWeakADX: true,           // Prefer weak ADX for better performance
  maxADXForEntry: 35,            // Avoid very strong trends (>35)

  // v3.3.0: Regime filter - ML v3.2.0 showed BULLISH has 23.1% WR (very low)
  avoidBullishRegime: true,      // Avoid trades in BULLISH_TREND regime
};

const ASSET_CONFIGS: Record<string, Partial<HybridMTFParams>> = {
  // v3.0.0: ATR-based TP/SL adapts automatically, no asset-specific configs needed
  // But we can adjust multipliers if needed
};

/**
 * Hybrid Multi-Timeframe Strategy for Backtesting (OPTIMIZED)
 */
export class HybridMTFBacktestStrategy implements BacktestableStrategy {
  readonly name = 'Hybrid-MTF';
  readonly version = '3.3.0'; // v3.3.0: Avoid 12-18h + BULLISH regime based on ML v3.2.0 analysis

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
    // v3.0.0: TP/SL are calculated dynamically from ATR, so we return defaults
    // The actual TP/SL will be calculated per-trade in checkEntry
    return {
      asset: this.asset,
      cooldownBars: this.params.cooldownBars,
      // Note: takeProfitPct and stopLossPct are now calculated dynamically from ATR
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

    // 4. Calculate 1m indicators (BB + RSI + ATR) - v3.0.0
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
    // v3.0.0: Calculate ATR for dynamic TP/SL
    const atr1m = ATR.calculate({
      high: highs1m,
      low: lows1m,
      close: closes1m,
      period: this.params.atrPeriod,
    });
    
    // v3.0.0: Calculate ATR for 15m (for slope normalization)
    const atr15m = ATR.calculate({
      high: highs15m,
      low: lows15m,
      close: closes15m,
      period: this.params.atrPeriod,
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
    const atr1mOffset = candles.length - atr1m.length;
    const atr15mOffset = candles15m.length - atr15m.length;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!;

      // Find corresponding 5m and 15m slot timestamps
      const slot5m = Math.floor(candle.timestamp / 300) * 300;
      const slot15m = Math.floor(candle.timestamp / 900) * 900;

      // Get indices in resampled arrays
      const idx5m = ts5mToIndex.get(slot5m);
      const idx15m = ts15mToIndex.get(slot15m);

      // Calculate regime from 15m - v3.0.0: Normalized slope
      let regime: MacroRegime | null = null;
      let atrPercent15m: number | null = null;
      if (idx15m !== undefined) {
        const adxIdx = idx15m - adxOffset;
        const smaIdx = idx15m - smaOffset;
        const atr15mIdx = idx15m - atr15mOffset;

        // Get ATR for normalization
        if (atr15mIdx >= 0 && atr15m[atr15mIdx] !== undefined && candles15m[idx15m]) {
          const atr15mVal = atr15m[atr15mIdx]!;
          const price15m = candles15m[idx15m]!.close;
          atrPercent15m = (atr15mVal / price15m) * 100;
        }

        if (adxIdx >= 0 && smaIdx >= this.params.ctxSlopeRegressionPeriod && adx15m[adxIdx] && atrPercent15m !== null) {
          const adx = adx15m[adxIdx]!.adx;
          
          // v3.0.0: Calculate normalized slope using linear regression
          const smaSlice = sma15m.slice(smaIdx - this.params.ctxSlopeRegressionPeriod + 1, smaIdx + 1);
          if (smaSlice.length === this.params.ctxSlopeRegressionPeriod) {
            const n = this.params.ctxSlopeRegressionPeriod;
            const x = Array.from({ length: n }, (_, i) => i);
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
              const normalizedSlope = rawSlope / (atrDecimal * smaSlice[smaSlice.length - 1]!);

              if (adx > this.params.ctxAdxThreshold) {
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

      // Get 5m RSI
      let rsi5m: number | null = null;
      if (idx5m !== undefined) {
        const rsiIdx = idx5m - rsi5mOffset;
        if (rsiIdx >= 0 && rsi5mAll[rsiIdx] !== undefined) {
          rsi5m = rsi5mAll[rsiIdx]!;
        }
      }

      // v3.2.0: Get 15m ADX for filtering
      let adx15mVal: number | null = null;
      if (idx15m !== undefined) {
        const adxIdx = idx15m - adx15mOffset;
        if (adxIdx >= 0 && adx15m[adxIdx]) {
          adx15mVal = adx15m[adxIdx]!.adx;
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

      // v3.0.0: Get 1m ATR for dynamic TP/SL
      let atr1mVal: number | null = null;
      let atrPercent1m: number | null = null;
      const atrIdx = i - atr1mOffset;
      if (atrIdx >= 0 && atr1m[atrIdx] !== undefined) {
        atr1mVal = atr1m[atrIdx]!;
        atrPercent1m = (atr1mVal / candle.close) * 100;
      }

      this.preCalculated[i] = {
        regime,
        rsi5m,
        bb,
        rsi1m: rsi1mVal,
        atr: atr1mVal,
        atrPercent: atrPercent1m,
        adx15m: adx15mVal,
      };
    }

    this.isPreCalculated = true;
    const elapsed = Date.now() - startTime;
    console.log(`[Hybrid-MTF] Pre-calculation completed in ${elapsed}ms`);
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

  /**
   * Check for RSI Divergence (v3.0.0)
   */
  private checkRSIDivergence(candles: Candle[], rsiValues: number[], currentIndex: number): 'BULLISH' | 'BEARISH' | null {
    if (!this.params.enableRSIDivergence || currentIndex < this.params.divergenceLookback) {
      return null;
    }

    const lookback = this.params.divergenceLookback;
    const startIdx = Math.max(0, currentIndex - lookback + 1);
    const priceSlice = candles.slice(startIdx, currentIndex + 1).map(c => c.close);
    const rsiSlice = rsiValues.slice(startIdx, currentIndex + 1);

    // Find extremes
    let priceLowestIdx = 0;
    let priceHighestIdx = 0;
    for (let i = 1; i < priceSlice.length; i++) {
      if (priceSlice[i]! < priceSlice[priceLowestIdx]!) priceLowestIdx = i;
      if (priceSlice[i]! > priceSlice[priceHighestIdx]!) priceHighestIdx = i;
    }

    // Check bullish divergence
    if (priceLowestIdx >= 3) {
      const recentLow = priceSlice[priceLowestIdx]!;
      const recentRSI = rsiSlice[priceLowestIdx]!;
      let prevLow = priceSlice[0]!;
      let prevLowIdx = 0;
      for (let i = 0; i < priceLowestIdx; i++) {
        if (priceSlice[i]! < prevLow) {
          prevLow = priceSlice[i]!;
          prevLowIdx = i;
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
      for (let i = 0; i < priceHighestIdx; i++) {
        if (priceSlice[i]! > prevHigh) {
          prevHigh = priceSlice[i]!;
          prevHighIdx = i;
        }
      }
      const prevRSI = rsiSlice[prevHighIdx]!;
      if (recentHigh > prevHigh && recentRSI < prevRSI) return 'BEARISH';
    }

    return null;
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
    if (!data || !data.regime || data.rsi5m === null || !data.bb || data.rsi1m === null || data.atr === null) {
      return null;
    }

    const { regime, rsi5m, bb, rsi1m: rsi, atr, adx15m } = data;

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

    // BB width filter: avoid low volatility environments
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

          // v3.0.0: Calculate dynamic TP/SL from ATR
          const { tpPct, slPct } = this.calculateDynamicTPSL(price, atr);

          return {
            timestamp: candle.timestamp,
            direction: pending.direction,
            price,
            confidence: 80,
            reason: `Hybrid-MTF MEAN_REVERSION (confirmed): ${pending.direction} after ${pending.candlesWaited} candles, regime=${regime}`,
            strategyName: this.name,
            strategyVersion: this.version,
            snapshot,
            suggestedTpPct: tpPct,
            suggestedSlPct: slPct,
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
      // 15m BULLISH: Only CALLs (Momentum) - v3.0.0: With reversal confirmation
      if (rsi5m < this.params.midRsiOverbought) {
        if (priceNearLowerBand && rsi < this.params.rsiOversold) {
          // v3.0.0: Check reversal confirmation
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
          // v3.0.0: Check reversal confirmation
          if (this.checkReversalConfirmation(candle, prevCandle, rsi, prevRSI, 'PUT')) {
            signal = 'PUT';
            strategyUsed = 'MOMENTUM';
          }
        }
      }
    } else {
      // RANGE: Mean Reversion with POST_CONFIRM + RSI Divergence (v3.0.0)
      strategyUsed = 'MEAN_REVERSION';

      // v3.0.0: Check for RSI divergence
      const startIdx = Math.max(0, currentIndex - this.params.divergenceLookback + 1);
      const candlesSlice = candles.slice(startIdx, currentIndex + 1);
      const rsiSlice = this.preCalculated.slice(startIdx, currentIndex + 1)
        .map(d => d.rsi1m).filter((r): r is number => r !== null);
      const divergence = candlesSlice.length >= this.params.divergenceLookback && rsiSlice.length >= this.params.divergenceLookback
        ? this.checkRSIDivergence(candlesSlice, rsiSlice, rsiSlice.length - 1)
        : null;

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

    // For Momentum: Execute immediately - v3.0.0: Use dynamic ATR-based TP/SL
    if (strategyUsed === 'MOMENTUM') {
      this.lastTradeIndex = currentIndex;
      const { tpPct, slPct } = this.calculateDynamicTPSL(price, atr);
      
      return {
        timestamp: candle.timestamp,
        direction: signal,
        price,
        confidence: 85,
        reason: `Hybrid-MTF MOMENTUM v3.0.0: ${signal} in ${regime}, RSI(1m)=${rsi.toFixed(1)}, RSI(5m)=${rsi5m.toFixed(1)}, ATR=${atr.toFixed(4)}`,
        strategyName: this.name,
        strategyVersion: this.version,
        snapshot,
        suggestedTpPct: tpPct,
        suggestedSlPct: slPct,
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
