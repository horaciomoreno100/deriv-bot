/**
 * FVG Liquidity Sweep Strategy - Backtest Adapter
 *
 * Combines Liquidity Sweep detection with FVG entry for backtesting
 *
 * OPTIMIZATION: Pre-calculates all swings, liquidity zones, and FVGs ONCE
 *
 * FILTERS:
 * - Session Filter (Killzones): Only trade during London/NY sessions
 * - RSI Divergence: Confirm reversals with RSI divergence
 * - Sweep Quality: Minimum depth and strong rejection
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { getParamsForAsset } from '../../strategies/fvg-liquidity-sweep.params.js';
import type {
  SwingPoint,
  LiquidityZone,
  FairValueGap,
  FVGLiquiditySweepParams,
} from '../../strategies/fvg-liquidity-sweep.types.js';

/**
 * State machine phases
 *
 * ICT Flow: SCANNING -> SWEEP_DETECTED -> MSS_CONFIRMED -> WAITING_ENTRY
 */
type Phase = 'SCANNING' | 'SWEEP_DETECTED' | 'MSS_CONFIRMED' | 'WAITING_ENTRY';

/**
 * Active sweep data
 */
interface ActiveSweep {
  type: 'BSL' | 'SSL';
  zone: LiquidityZone;
  sweepIndex: number;
  sweepLow?: number;
  sweepHigh?: number;
  expectedDirection: 'CALL' | 'PUT';
  barsSinceSweep: number;
  sweepRsi?: number; // RSI at sweep for divergence check
  // MSS fields
  mssConfirmed?: boolean;
  mssIndex?: number;
  mssLevel?: number;
}

/**
 * FVG Liquidity Sweep Strategy for Backtesting
 */
export class FVGLiquiditySweepBacktestStrategy implements BacktestableStrategy {
  readonly name = 'FVG-Liquidity-Sweep';
  readonly version = '2.0.0';

  private params: FVGLiquiditySweepParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  // State machine
  private phase: Phase = 'SCANNING';
  private activeSweep?: ActiveSweep;
  private activeFVG?: FairValueGap;
  private barsInPhase: number = 0;

  // Pre-calculated data (LTF - M1)
  private allSwings: SwingPoint[] = [];
  private allLiquidityZones: LiquidityZone[] = [];
  private allFVGs: FairValueGap[] = [];
  private rsiValues: number[] = [];
  private atrValues: number[] = [];
  private isPreCalculated: boolean = false;

  // HTF (Higher Timeframe) data for MTF analysis
  private htfCandles: Candle[] = [];
  private htfSwings: SwingPoint[] = [];
  private htfLiquidityZones: LiquidityZone[] = [];
  private ltfToHtfIndexMap: number[] = []; // Maps LTF index to HTF candle index

  constructor(asset: string, customParams?: Partial<FVGLiquiditySweepParams>) {
    this.asset = asset;
    this.params = getParamsForAsset(asset, customParams);
  }

  requiredIndicators(): string[] {
    return ['rsi'];
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      cooldownBars: Math.ceil(this.params.cooldownSeconds / 60),
    };
  }

  /**
   * Calculate RSI series
   */
  private calculateRSI(candles: Candle[], period: number): number[] {
    const rsi: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        rsi.push(50); // Neutral for first candle
        continue;
      }

      const change = candles[i]!.close - candles[i - 1]!.close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      gains.push(gain);
      losses.push(loss);

      if (i < period) {
        rsi.push(50); // Not enough data yet
        continue;
      }

      // Calculate average gain/loss
      let avgGain: number;
      let avgLoss: number;

      if (i === period) {
        // First calculation - simple average
        avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
        avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
      } else {
        // Smoothed average
        const prevAvgGain = gains.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
        const prevAvgLoss = losses.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
        avgGain = (prevAvgGain * (period - 1) + gain) / period;
        avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
      }

      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
      }
    }

    return rsi;
  }

  /**
   * Calculate ATR series
   */
  private calculateATR(candles: Candle[], period: number): number[] {
    const atr: number[] = [];
    const trueRanges: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        const tr = candles[i]!.high - candles[i]!.low;
        trueRanges.push(tr);
        atr.push(tr);
        continue;
      }

      const prevClose = candles[i - 1]!.close;
      const high = candles[i]!.high;
      const low = candles[i]!.low;

      // True Range = max(high-low, |high-prevClose|, |low-prevClose|)
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);

      if (i < period) {
        // Simple average until we have enough data
        const sum = trueRanges.reduce((a, b) => a + b, 0);
        atr.push(sum / trueRanges.length);
      } else {
        // Smoothed ATR
        const prevAtr = atr[i - 1] ?? tr;
        atr.push((prevAtr * (period - 1) + tr) / period);
      }
    }

    return atr;
  }

  /**
   * Pre-calculate all data ONCE before the backtest loop
   */
  preCalculate(candles: Candle[]): void {
    console.log(`[FVG-LS] Pre-calculating for ${candles.length} candles...`);
    const startTime = Date.now();

    // 1. Detect all swing points
    this.allSwings = this.detectAllSwings(candles);
    console.log(`[FVG-LS] Detected ${this.allSwings.length} swing points`);

    // 2. Detect all liquidity zones
    this.allLiquidityZones = this.detectAllLiquidityZones(candles);
    console.log(`[FVG-LS] Detected ${this.allLiquidityZones.length} liquidity zones`);

    // 3. Detect all FVGs
    this.allFVGs = this.detectAllFVGs(candles);
    console.log(`[FVG-LS] Detected ${this.allFVGs.length} FVGs`);

    // 4. Pre-calculate RSI if divergence filter is enabled
    if (this.params.useRsiDivergence) {
      this.rsiValues = this.calculateRSI(candles, this.params.rsiPeriod);
      console.log(`[FVG-LS] Calculated RSI (${this.params.rsiPeriod} period)`);
    }

    // 5. Pre-calculate ATR for momentum filters
    this.atrValues = this.calculateATR(candles, this.params.atrPeriod);
    console.log(`[FVG-LS] Calculated ATR (${this.params.atrPeriod} period)`);

    // 6. Pre-calculate HTF data if MTF is enabled
    if (this.params.useMTF) {
      this.aggregateHTFCandles(candles);
      console.log(`[FVG-LS] Aggregated ${this.htfCandles.length} HTF candles (${this.params.htfMultiplier}x)`);

      this.htfSwings = this.detectHTFSwings();
      console.log(`[FVG-LS] Detected ${this.htfSwings.length} HTF swing points`);

      this.htfLiquidityZones = this.detectHTFLiquidityZones();
      console.log(`[FVG-LS] Detected ${this.htfLiquidityZones.length} HTF liquidity zones`);
    }

    this.isPreCalculated = true;
    const elapsed = Date.now() - startTime;
    console.log(`[FVG-LS] Pre-calculation completed in ${elapsed}ms`);
  }

  /**
   * Aggregate LTF candles into HTF candles
   * E.g., 60 M1 candles -> 1 H1 candle
   */
  private aggregateHTFCandles(candles: Candle[]): void {
    const multiplier = this.params.htfMultiplier;
    this.htfCandles = [];
    this.ltfToHtfIndexMap = [];

    for (let i = 0; i < candles.length; i += multiplier) {
      const chunk = candles.slice(i, Math.min(i + multiplier, candles.length));
      if (chunk.length === 0) continue;

      // Aggregate OHLC
      const htfCandle: Candle = {
        timestamp: chunk[0]!.timestamp,
        open: chunk[0]!.open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1]!.close,
      };

      const htfIndex = this.htfCandles.length;
      this.htfCandles.push(htfCandle);

      // Map each LTF candle in this chunk to this HTF candle
      for (let j = 0; j < chunk.length; j++) {
        this.ltfToHtfIndexMap.push(htfIndex);
      }
    }
  }

  /**
   * Detect swing points on HTF candles
   */
  private detectHTFSwings(): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const swingLength = this.params.htfSwingLength;

    if (this.htfCandles.length < swingLength * 2 + 1) {
      return swings;
    }

    for (let i = swingLength; i < this.htfCandles.length - swingLength; i++) {
      const current = this.htfCandles[i]!;
      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= swingLength; j++) {
        const left = this.htfCandles[i - j]!;
        const right = this.htfCandles[i + j]!;

        if (current.high <= left.high || current.high <= right.high) {
          isSwingHigh = false;
        }
        if (current.low >= left.low || current.low >= right.low) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) {
        swings.push({
          index: i,
          type: 'high',
          level: current.high,
          timestamp: current.timestamp,
        });
      }
      if (isSwingLow) {
        swings.push({
          index: i,
          type: 'low',
          level: current.low,
          timestamp: current.timestamp,
        });
      }
    }

    return swings;
  }

  /**
   * Detect liquidity zones on HTF
   */
  private detectHTFLiquidityZones(): LiquidityZone[] {
    const zones: LiquidityZone[] = [];

    if (this.htfCandles.length === 0 || this.htfSwings.length === 0) {
      return zones;
    }

    // Calculate price range for tolerance
    let maxPrice = this.htfCandles[0]!.high;
    let minPrice = this.htfCandles[0]!.low;
    for (const c of this.htfCandles) {
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.low < minPrice) minPrice = c.low;
    }
    const priceRange = maxPrice - minPrice;
    // Use wider tolerance for HTF zones
    const tolerance = priceRange * this.params.liquidityRangePct * 2;

    // Group swing highs (BSL)
    const swingHighs = this.htfSwings.filter(s => s.type === 'high');
    const groupedHighs = this.groupHTFSwings(swingHighs, tolerance);

    for (const group of groupedHighs) {
      if (group.length >= this.params.htfMinSwingsForZone) {
        const avgLevel = group.reduce((sum, s) => sum + s.level, 0) / group.length;
        zones.push({
          type: 'BSL',
          level: avgLevel,
          swings: group,
          startIndex: Math.min(...group.map(s => s.index)),
          endIndex: Math.max(...group.map(s => s.index)),
          swept: false,
        });
      }
    }

    // Group swing lows (SSL)
    const swingLows = this.htfSwings.filter(s => s.type === 'low');
    const groupedLows = this.groupHTFSwings(swingLows, tolerance);

    for (const group of groupedLows) {
      if (group.length >= this.params.htfMinSwingsForZone) {
        const avgLevel = group.reduce((sum, s) => sum + s.level, 0) / group.length;
        zones.push({
          type: 'SSL',
          level: avgLevel,
          swings: group,
          startIndex: Math.min(...group.map(s => s.index)),
          endIndex: Math.max(...group.map(s => s.index)),
          swept: false,
        });
      }
    }

    return zones;
  }

  /**
   * Group nearby HTF swing points
   */
  private groupHTFSwings(swings: SwingPoint[], tolerance: number): SwingPoint[][] {
    if (swings.length === 0) return [];

    const groups: SwingPoint[][] = [];
    const used = new Set<number>();

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const group: SwingPoint[] = [swings[i]!];
      used.add(i);

      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;

        const baseSwing = swings[i]!;
        const candidateSwing = swings[j]!;
        const isClose = Math.abs(baseSwing.level - candidateSwing.level) <= tolerance;

        if (isClose) {
          group.push(candidateSwing);
          used.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Check if LTF zone has HTF confluence
   * Returns true if there's a matching HTF zone nearby
   *
   * NOTE: When useMTF=true, this is used as a FILTER (requires confluence)
   * The confidence boost is applied separately in calculateConfidence
   */
  private hasHTFConfluence(ltfZone: LiquidityZone, currentLtfIndex: number): boolean {
    if (!this.params.useMTF || this.htfLiquidityZones.length === 0) {
      return true; // No MTF filter, always pass
    }

    const htfIndex = this.ltfToHtfIndexMap[currentLtfIndex] ?? 0;
    const confluenceDistance = ltfZone.level * this.params.htfConfluenceDistancePct;

    for (const htfZone of this.htfLiquidityZones) {
      // HTF zone must be confirmed (not in the future)
      if (htfZone.endIndex + this.params.htfSwingLength > htfIndex) continue;

      // Must be same type (BSL aligns with BSL, SSL with SSL)
      if (htfZone.type !== ltfZone.type) continue;

      // Check if levels are close enough
      const distance = Math.abs(htfZone.level - ltfZone.level);
      if (distance <= confluenceDistance) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get confidence boost if HTF confluence exists
   * This is called even when useMTF=false to allow optional boost
   */
  private getHTFConfluenceBoost(ltfZone: LiquidityZone, currentLtfIndex: number): number {
    if (this.htfLiquidityZones.length === 0) {
      return 0;
    }

    const htfIndex = this.ltfToHtfIndexMap[currentLtfIndex] ?? 0;
    const confluenceDistance = ltfZone.level * this.params.htfConfluenceDistancePct;

    for (const htfZone of this.htfLiquidityZones) {
      if (htfZone.endIndex + this.params.htfSwingLength > htfIndex) continue;
      if (htfZone.type !== ltfZone.type) continue;

      const distance = Math.abs(htfZone.level - ltfZone.level);
      if (distance <= confluenceDistance) {
        return this.params.htfConfluenceConfidenceBoost;
      }
    }

    return 0;
  }

  /**
   * Detect all swing points
   */
  private detectAllSwings(candles: Candle[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const swingLength = this.params.swingLength;

    if (candles.length < swingLength * 2 + 1) {
      return swings;
    }

    for (let i = swingLength; i < candles.length - swingLength; i++) {
      const current = candles[i]!;
      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= swingLength; j++) {
        const left = candles[i - j]!;
        const right = candles[i + j]!;

        if (current.high <= left.high || current.high <= right.high) {
          isSwingHigh = false;
        }
        if (current.low >= left.low || current.low >= right.low) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) {
        swings.push({
          index: i,
          type: 'high',
          level: current.high,
          timestamp: current.timestamp,
        });
      }
      if (isSwingLow) {
        swings.push({
          index: i,
          type: 'low',
          level: current.low,
          timestamp: current.timestamp,
        });
      }
    }

    return swings;
  }

  /**
   * Detect all liquidity zones from swings
   */
  private detectAllLiquidityZones(candles: Candle[]): LiquidityZone[] {
    const zones: LiquidityZone[] = [];

    if (candles.length === 0 || this.allSwings.length === 0) {
      return zones;
    }

    // Calculate price range for tolerance
    let maxPrice = candles[0].high;
    let minPrice = candles[0].low;
    for (const c of candles) {
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.low < minPrice) minPrice = c.low;
    }
    const priceRange = maxPrice - minPrice;
    const tolerance = priceRange * this.params.liquidityRangePct;

    // Group swing highs (BSL)
    const swingHighs = this.allSwings.filter(s => s.type === 'high');
    const groupedHighs = this.groupNearbySwings(swingHighs, tolerance);

    for (const group of groupedHighs) {
      if (group.length >= this.params.minSwingsForZone) {
        const avgLevel = group.reduce((sum, s) => sum + s.level, 0) / group.length;
        zones.push({
          type: 'BSL',
          level: avgLevel,
          swings: group,
          startIndex: Math.min(...group.map(s => s.index)),
          endIndex: Math.max(...group.map(s => s.index)),
          swept: false,
        });
      }
    }

    // Group swing lows (SSL)
    const swingLows = this.allSwings.filter(s => s.type === 'low');
    const groupedLows = this.groupNearbySwings(swingLows, tolerance);

    for (const group of groupedLows) {
      if (group.length >= this.params.minSwingsForZone) {
        const avgLevel = group.reduce((sum, s) => sum + s.level, 0) / group.length;
        zones.push({
          type: 'SSL',
          level: avgLevel,
          swings: group,
          startIndex: Math.min(...group.map(s => s.index)),
          endIndex: Math.max(...group.map(s => s.index)),
          swept: false,
        });
      }
    }

    return zones;
  }

  /**
   * Group nearby swing points
   */
  private groupNearbySwings(swings: SwingPoint[], tolerance: number): SwingPoint[][] {
    if (swings.length === 0) return [];

    const groups: SwingPoint[][] = [];
    const used = new Set<number>();
    const maxIndexDiff = this.params.maxZoneAgeBars;

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const group: SwingPoint[] = [swings[i]!];
      used.add(i);

      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;

        const baseSwing = swings[i]!;
        const candidateSwing = swings[j]!;
        const indexDiff = Math.abs(candidateSwing.index - baseSwing.index);

        if (indexDiff > maxIndexDiff) continue;

        const isClose = Math.abs(baseSwing.level - candidateSwing.level) <= tolerance;

        if (isClose) {
          group.push(candidateSwing);
          used.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Detect all FVGs
   */
  private detectAllFVGs(candles: Candle[]): FairValueGap[] {
    const fvgs: FairValueGap[] = [];

    for (let i = 2; i < candles.length; i++) {
      const candle1 = candles[i - 2]!;
      const candle3 = candles[i]!;
      const avgPrice = (candle3.high + candle3.low) / 2;

      // Bullish FVG
      if (candle3.low > candle1.high) {
        const gapSize = candle3.low - candle1.high;
        const gapSizePct = gapSize / avgPrice;

        if (gapSizePct >= this.params.minFVGSizePct) {
          fvgs.push({
            type: 'bullish',
            top: candle3.low,
            bottom: candle1.high,
            midpoint: (candle3.low + candle1.high) / 2,
            formationIndex: i,
            formationTimestamp: candle3.timestamp,
            touched: false,
            mitigationPct: 0,
            gapSizePct,
          });
        }
      }

      // Bearish FVG
      if (candle3.high < candle1.low) {
        const gapSize = candle1.low - candle3.high;
        const gapSizePct = gapSize / avgPrice;

        if (gapSizePct >= this.params.minFVGSizePct) {
          fvgs.push({
            type: 'bearish',
            top: candle1.low,
            bottom: candle3.high,
            midpoint: (candle1.low + candle3.high) / 2,
            formationIndex: i,
            formationTimestamp: candle3.timestamp,
            touched: false,
            mitigationPct: 0,
            gapSizePct,
          });
        }
      }
    }

    return fvgs;
  }

  /**
   * Check if current time is within trading session
   */
  private isWithinSession(timestamp: number): boolean {
    if (!this.params.useSessionFilter) return true;

    const date = new Date(timestamp * 1000);
    const hour = date.getUTCHours();

    // Handle overnight sessions (e.g., 20-7 would be invalid range)
    if (this.params.sessionStartHour <= this.params.sessionEndHour) {
      return hour >= this.params.sessionStartHour && hour < this.params.sessionEndHour;
    } else {
      // Overnight session (e.g., 22-6)
      return hour >= this.params.sessionStartHour || hour < this.params.sessionEndHour;
    }
  }

  /**
   * Check RSI divergence at sweep
   * For SSL sweep (bullish): Price made lower low, RSI made higher low
   * For BSL sweep (bearish): Price made higher high, RSI made lower high
   */
  private checkRsiDivergence(
    sweepType: 'BSL' | 'SSL',
    zone: LiquidityZone,
    currentIndex: number,
    sweepPrice: number
  ): boolean {
    if (!this.params.useRsiDivergence || this.rsiValues.length === 0) {
      return true; // Pass if filter disabled
    }

    const currentRsi = this.rsiValues[currentIndex];
    if (currentRsi === undefined) return false;

    // Find the RSI value at the zone's last swing
    const lastSwing = zone.swings[zone.swings.length - 1];
    if (!lastSwing) return false;

    const swingRsi = this.rsiValues[lastSwing.index];
    if (swingRsi === undefined) return false;

    const rsiDiff = currentRsi - swingRsi;

    if (sweepType === 'SSL') {
      // Bullish divergence: Price made lower low but RSI made higher low
      const priceMadeLowerLow = sweepPrice < zone.level;
      const rsiMadeHigherLow = rsiDiff >= this.params.minRsiDivergence;
      return priceMadeLowerLow && rsiMadeHigherLow;
    } else {
      // Bearish divergence: Price made higher high but RSI made lower high
      const priceMadeHigherHigh = sweepPrice > zone.level;
      const rsiMadeLowerHigh = rsiDiff <= -this.params.minRsiDivergence;
      return priceMadeHigherHigh && rsiMadeLowerHigh;
    }
  }

  /**
   * Check sweep quality (depth and rejection)
   */
  private checkSweepQuality(
    candle: Candle,
    zone: LiquidityZone,
    sweepType: 'BSL' | 'SSL'
  ): boolean {
    const zoneLevel = zone.level;

    if (sweepType === 'SSL') {
      // Check minimum sweep depth
      const sweepDepth = (zoneLevel - candle.low) / zoneLevel;
      if (sweepDepth < this.params.minSweepDepthPct) return false;

      // Check strong rejection (close in upper half of candle)
      if (this.params.requireStrongRejection) {
        const candleRange = candle.high - candle.low;
        const candleMid = candle.low + candleRange / 2;
        if (candle.close < candleMid) return false;
      }
    } else {
      // BSL sweep
      const sweepDepth = (candle.high - zoneLevel) / zoneLevel;
      if (sweepDepth < this.params.minSweepDepthPct) return false;

      // Check strong rejection (close in lower half of candle)
      if (this.params.requireStrongRejection) {
        const candleRange = candle.high - candle.low;
        const candleMid = candle.low + candleRange / 2;
        if (candle.close > candleMid) return false;
      }
    }

    return true;
  }

  /**
   * Check for liquidity sweep at current candle
   *
   * LOOK-AHEAD BIAS FIX: A swing at index T is only confirmed at T + swingLength
   */
  private checkForSweep(
    candle: Candle,
    currentIndex: number
  ): ActiveSweep | null {
    for (const zone of this.allLiquidityZones) {
      // Skip already swept zones
      if (zone.swept) continue;

      // Skip zones that are too old
      if (currentIndex - zone.endIndex > this.params.maxZoneAgeBars) continue;

      // LOOK-AHEAD BIAS FIX: Zone is only confirmed after endIndex + swingLength
      const zoneConfirmationIndex = zone.endIndex + this.params.swingLength;
      if (currentIndex <= zoneConfirmationIndex) continue;

      if (zone.type === 'SSL') {
        // SSL Sweep: Price breaks below AND closes above
        const brokeBelow = candle.low < zone.level;
        const closedAbove = !this.params.requireCloseBack || candle.close > zone.level;

        if (brokeBelow && closedAbove) {
          // Check sweep quality
          if (!this.checkSweepQuality(candle, zone, 'SSL')) continue;

          // Check RSI divergence
          if (!this.checkRsiDivergence('SSL', zone, currentIndex, candle.low)) continue;

          // Check MTF confluence (HTF zone must align)
          if (!this.hasHTFConfluence(zone, currentIndex)) continue;

          zone.swept = true;
          zone.sweptIndex = currentIndex;
          zone.sweptPrice = candle.low;

          return {
            type: 'SSL',
            zone,
            sweepIndex: currentIndex,
            sweepLow: candle.low,
            expectedDirection: 'CALL',
            barsSinceSweep: 0,
            sweepRsi: this.rsiValues[currentIndex],
          };
        }
      } else {
        // BSL Sweep: Price breaks above AND closes below
        const brokeAbove = candle.high > zone.level;
        const closedBelow = !this.params.requireCloseBack || candle.close < zone.level;

        if (brokeAbove && closedBelow) {
          // Check sweep quality
          if (!this.checkSweepQuality(candle, zone, 'BSL')) continue;

          // Check RSI divergence
          if (!this.checkRsiDivergence('BSL', zone, currentIndex, candle.high)) continue;

          // Check MTF confluence (HTF zone must align)
          if (!this.hasHTFConfluence(zone, currentIndex)) continue;

          zone.swept = true;
          zone.sweptIndex = currentIndex;
          zone.sweptPrice = candle.high;

          return {
            type: 'BSL',
            zone,
            sweepIndex: currentIndex,
            sweepHigh: candle.high,
            expectedDirection: 'PUT',
            barsSinceSweep: 0,
            sweepRsi: this.rsiValues[currentIndex],
          };
        }
      }
    }

    return null;
  }

  /**
   * Detect Market Structure Shift (MSS) after sweep
   *
   * MSS is the CRITICAL ICT element that confirms the reversal:
   * - For SSL sweep (bullish): Price must break a recent swing HIGH
   * - For BSL sweep (bearish): Price must break a recent swing LOW
   */
  private detectMSS(
    candles: Candle[],
    sweep: ActiveSweep,
    currentIndex: number
  ): { confirmed: boolean; level: number; index: number } | null {
    const sweepIndex = sweep.sweepIndex;
    const lookbackStart = Math.max(0, sweepIndex - this.params.mssLookbackBars);

    if (sweep.type === 'SSL') {
      // SSL sweep (bullish) - need to break a recent swing HIGH
      let nearestSwingHigh = -Infinity;
      let swingHighIndex = -1;

      // Find the most recent swing high before sweep
      for (let i = lookbackStart; i < sweepIndex; i++) {
        if (i > 0 && i < candles.length - 1) {
          const prevHigh = candles[i - 1]?.high ?? 0;
          const currHigh = candles[i]?.high ?? 0;
          const nextHigh = candles[i + 1]?.high ?? 0;

          if (currHigh > prevHigh && currHigh > nextHigh) {
            if (i > swingHighIndex) {
              nearestSwingHigh = currHigh;
              swingHighIndex = i;
            }
          }
        }
      }

      // Fallback: find highest high in lookback
      if (swingHighIndex === -1) {
        for (let i = lookbackStart; i < sweepIndex; i++) {
          const high = candles[i]?.high ?? 0;
          if (high > nearestSwingHigh) {
            nearestSwingHigh = high;
            swingHighIndex = i;
          }
        }
      }

      if (nearestSwingHigh === -Infinity) return null;

      // Check if any candle after sweep breaks this swing high
      for (let i = sweepIndex + 1; i <= currentIndex; i++) {
        const candle = candles[i];
        if (!candle) continue;

        if (candle.high > nearestSwingHigh && candle.close > nearestSwingHigh) {
          return { confirmed: true, level: nearestSwingHigh, index: i };
        }
      }
    } else {
      // BSL sweep (bearish) - need to break a recent swing LOW
      let nearestSwingLow = Infinity;
      let swingLowIndex = -1;

      for (let i = lookbackStart; i < sweepIndex; i++) {
        if (i > 0 && i < candles.length - 1) {
          const prevLow = candles[i - 1]?.low ?? Infinity;
          const currLow = candles[i]?.low ?? Infinity;
          const nextLow = candles[i + 1]?.low ?? Infinity;

          if (currLow < prevLow && currLow < nextLow) {
            if (i > swingLowIndex) {
              nearestSwingLow = currLow;
              swingLowIndex = i;
            }
          }
        }
      }

      // Fallback: find lowest low in lookback
      if (swingLowIndex === -1) {
        for (let i = lookbackStart; i < sweepIndex; i++) {
          const low = candles[i]?.low ?? Infinity;
          if (low < nearestSwingLow) {
            nearestSwingLow = low;
            swingLowIndex = i;
          }
        }
      }

      if (nearestSwingLow === Infinity) return null;

      // Check if any candle after sweep breaks this swing low
      for (let i = sweepIndex + 1; i <= currentIndex; i++) {
        const candle = candles[i];
        if (!candle) continue;

        if (candle.low < nearestSwingLow && candle.close < nearestSwingLow) {
          return { confirmed: true, level: nearestSwingLow, index: i };
        }
      }
    }

    return null;
  }

  /**
   * Check if FVG was created by an impulsive candle
   */
  private isImpulsiveFVG(fvg: FairValueGap, candles: Candle[]): boolean {
    if (!this.params.requireImpulsiveFVG) return true;

    // The impulsive candle is candle[2] (candle3) that creates the FVG
    const impulseCandle = candles[fvg.formationIndex];
    if (!impulseCandle) return false;

    const bodySize = Math.abs(impulseCandle.close - impulseCandle.open);
    const atr = this.atrValues[fvg.formationIndex] ?? 0;

    if (atr === 0) return true; // No ATR data, pass the filter

    // Body must be at least minImpulseBodyAtrMultiple * ATR
    return bodySize >= atr * this.params.minImpulseBodyAtrMultiple;
  }

  /**
   * Find FVG formed after sweep (or after MSS if required)
   */
  private findPostSweepFVG(sweep: ActiveSweep, _currentIndex: number, candles: Candle[]): FairValueGap | null {
    // If MSS is confirmed, FVG should form after MSS for better confirmation
    const searchStartIndex = sweep.mssConfirmed && sweep.mssIndex
      ? sweep.mssIndex
      : sweep.sweepIndex;

    for (const fvg of this.allFVGs) {
      // FVG must be formed after the search start point
      if (fvg.formationIndex <= searchStartIndex) continue;

      // FVG must be within search window from the sweep
      if (fvg.formationIndex > sweep.sweepIndex + this.params.fvgSearchBars) continue;

      // Must match expected direction
      if (sweep.expectedDirection === 'CALL' && fvg.type !== 'bullish') continue;
      if (sweep.expectedDirection === 'PUT' && fvg.type !== 'bearish') continue;

      // Check if FVG is impulsive (created by strong candle)
      if (!this.isImpulsiveFVG(fvg, candles)) continue;

      return fvg;
    }

    return null;
  }

  /**
   * Check if candle shows rejection at the entry level
   * A rejection candle has a long wick in the direction of the FVG
   */
  private hasRejectionConfirmation(candle: Candle, fvg: FairValueGap): boolean {
    if (!this.params.requireEntryConfirmation) return true;

    const bodySize = Math.abs(candle.close - candle.open);
    const bodyTop = Math.max(candle.open, candle.close);
    const bodyBottom = Math.min(candle.open, candle.close);

    if (fvg.type === 'bullish') {
      // For bullish FVG, we want a long lower wick (rejection from below)
      const lowerWick = bodyBottom - candle.low;
      // Also check if it's a bullish engulfing (close > open significantly)
      const isBullishCandle = candle.close > candle.open;
      const hasLongLowerWick = bodySize > 0 && lowerWick >= bodySize * this.params.minRejectionWickRatio;

      return hasLongLowerWick || (isBullishCandle && bodySize > 0);
    } else {
      // For bearish FVG, we want a long upper wick (rejection from above)
      const upperWick = candle.high - bodyTop;
      // Also check if it's a bearish engulfing (close < open significantly)
      const isBearishCandle = candle.close < candle.open;
      const hasLongUpperWick = bodySize > 0 && upperWick >= bodySize * this.params.minRejectionWickRatio;

      return hasLongUpperWick || (isBearishCandle && bodySize > 0);
    }
  }

  /**
   * Check if candle enters FVG with proper confirmation
   */
  private checkFVGEntry(candle: Candle, fvg: FairValueGap): boolean {
    let entryLevel: number;

    switch (this.params.entryZone) {
      case 'top':
        entryLevel = fvg.top;
        break;
      case 'bottom':
        entryLevel = fvg.bottom;
        break;
      case 'midpoint':
      default:
        entryLevel = fvg.midpoint;
    }

    // First check if price touched the FVG
    let touched = false;
    if (fvg.type === 'bullish') {
      touched = candle.low <= entryLevel;
    } else {
      touched = candle.high >= entryLevel;
    }

    if (!touched) return false;

    // Then check for rejection confirmation
    return this.hasRejectionConfirmation(candle, fvg);
  }

  /**
   * Find nearest target zone for dynamic TP
   *
   * For CALL: Find nearest BSL (resistance) above entry
   * For PUT: Find nearest SSL (support) below entry
   */
  private findNearestTargetZone(
    entryPrice: number,
    direction: 'CALL' | 'PUT',
    currentIndex: number,
    excludeZone: LiquidityZone
  ): LiquidityZone | null {
    let nearestZone: LiquidityZone | null = null;
    let nearestDistance = Infinity;

    for (const zone of this.allLiquidityZones) {
      // Skip the zone that was just swept
      if (zone === excludeZone) continue;

      // Skip zones that are too old or already swept
      if (zone.swept) continue;
      if (currentIndex - zone.endIndex > this.params.maxZoneAgeBars) continue;

      // Zone must be confirmed (not look-ahead)
      const zoneConfirmationIndex = zone.endIndex + this.params.swingLength;
      if (currentIndex <= zoneConfirmationIndex) continue;

      if (direction === 'CALL') {
        // For CALL trades, find BSL (resistance) ABOVE entry
        if (zone.type !== 'BSL') continue;
        if (zone.level <= entryPrice) continue;

        const distance = zone.level - entryPrice;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestZone = zone;
        }
      } else {
        // For PUT trades, find SSL (support) BELOW entry
        if (zone.type !== 'SSL') continue;
        if (zone.level >= entryPrice) continue;

        const distance = entryPrice - zone.level;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestZone = zone;
        }
      }
    }

    return nearestZone;
  }

  /**
   * Calculate TP/SL prices and percentages
   *
   * When useDynamicTPSL is enabled:
   * - TP is set to nearest opposite liquidity zone (with buffer)
   * - Falls back to fixed R:R if no suitable zone found or R:R outside bounds
   */
  private calculateTPSL(
    sweep: ActiveSweep,
    fvg: FairValueGap,
    currentIndex: number
  ): { tpPct: number; slPct: number; tpPrice: number; slPrice: number; dynamicTarget?: string } {
    const entryPrice = fvg.midpoint;
    let stopLoss: number;
    let takeProfit: number;
    let dynamicTarget: string | undefined;

    // Calculate stop loss (same logic for both modes)
    if (sweep.expectedDirection === 'CALL') {
      const sweepLow = sweep.sweepLow ?? sweep.zone.level;
      stopLoss = sweepLow * (1 - this.params.stopLossBufferPct);
    } else {
      const sweepHigh = sweep.sweepHigh ?? sweep.zone.level;
      stopLoss = sweepHigh * (1 + this.params.stopLossBufferPct);
    }

    const riskAmount = Math.abs(entryPrice - stopLoss);

    // Dynamic TP calculation
    if (this.params.useDynamicTPSL) {
      const targetZone = this.findNearestTargetZone(
        entryPrice,
        sweep.expectedDirection,
        currentIndex,
        sweep.zone
      );

      if (targetZone) {
        // Calculate TP at zone level with buffer
        if (sweep.expectedDirection === 'CALL') {
          // TP just below the BSL zone (resistance)
          takeProfit = targetZone.level * (1 - this.params.targetZoneBufferPct);
        } else {
          // TP just above the SSL zone (support)
          takeProfit = targetZone.level * (1 + this.params.targetZoneBufferPct);
        }

        // Calculate effective R:R
        const rewardAmount = Math.abs(takeProfit - entryPrice);
        const effectiveRR = rewardAmount / riskAmount;

        // Check R:R bounds
        if (effectiveRR >= this.params.minDynamicRR && effectiveRR <= this.params.maxDynamicRR) {
          dynamicTarget = `${targetZone.type}@${targetZone.level.toFixed(5)} (${targetZone.swings.length} swings, R:R=${effectiveRR.toFixed(2)})`;
        } else if (effectiveRR < this.params.minDynamicRR) {
          // Zone too close - use minimum R:R
          takeProfit = sweep.expectedDirection === 'CALL'
            ? entryPrice + riskAmount * this.params.minDynamicRR
            : entryPrice - riskAmount * this.params.minDynamicRR;
          dynamicTarget = `min_rr (zone too close)`;
        } else {
          // Zone too far - use maximum R:R
          takeProfit = sweep.expectedDirection === 'CALL'
            ? entryPrice + riskAmount * this.params.maxDynamicRR
            : entryPrice - riskAmount * this.params.maxDynamicRR;
          dynamicTarget = `max_rr (zone too far)`;
        }
      } else {
        // No target zone found - use fallback fixed R:R
        takeProfit = sweep.expectedDirection === 'CALL'
          ? entryPrice + riskAmount * this.params.takeProfitRR
          : entryPrice - riskAmount * this.params.takeProfitRR;
        dynamicTarget = `fallback_rr (no zone)`;
      }
    } else {
      // Fixed R:R mode (original logic)
      takeProfit = sweep.expectedDirection === 'CALL'
        ? entryPrice + riskAmount * this.params.takeProfitRR
        : entryPrice - riskAmount * this.params.takeProfitRR;
    }

    const tpPct = Math.abs(takeProfit - entryPrice) / entryPrice;
    const slPct = Math.abs(stopLoss - entryPrice) / entryPrice;

    return { tpPct, slPct, tpPrice: takeProfit, slPrice: stopLoss, dynamicTarget };
  }

  /**
   * Calculate confidence based on setup quality
   */
  private calculateConfidence(sweep: ActiveSweep, fvg: FairValueGap, currentIndex: number): number {
    let confidence = 70;

    // More swings = stronger zone
    if (sweep.zone.swings.length >= 3) confidence += 10;

    // Quick FVG formation = stronger momentum
    if (sweep.barsSinceSweep <= 5) confidence += 10;

    // Larger FVG = more significant
    if (fvg.gapSizePct >= this.params.minFVGSizePct * 2) confidence += 5;

    // RSI divergence confirmed = higher confidence
    if (this.params.useRsiDivergence && sweep.sweepRsi !== undefined) {
      confidence += 5;
    }

    // HTF confluence boost (even when useMTF=false, if HTF data exists)
    const htfBoost = this.getHTFConfluenceBoost(sweep.zone, currentIndex);
    if (htfBoost > 0) {
      confidence += htfBoost;
    }

    return Math.min(confidence, 95);
  }

  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Ensure pre-calculation
    if (!this.isPreCalculated) {
      this.preCalculate(candles);
    }

    // Minimum candles
    const minCandles = this.params.swingLength * 2 + 10;
    if (currentIndex < minCandles) return null;

    // Cooldown
    const cooldownBars = Math.ceil(this.params.cooldownSeconds / 60);
    if (currentIndex - this.lastTradeIndex < cooldownBars) return null;

    const candle = candles[currentIndex];
    if (!candle) return null;

    // Session filter
    if (!this.isWithinSession(candle.timestamp)) return null;

    // Hour filter (legacy)
    if (this.params.hourFilterEnabled && this.params.badHoursUTC.length > 0) {
      const hour = new Date(candle.timestamp * 1000).getUTCHours();
      if (this.params.badHoursUTC.includes(hour)) return null;
    }

    this.barsInPhase++;

    // State machine
    switch (this.phase) {
      case 'SCANNING': {
        const sweep = this.checkForSweep(candle, currentIndex);
        if (sweep) {
          this.phase = 'SWEEP_DETECTED';
          this.activeSweep = sweep;
          this.barsInPhase = 0;
        }
        return null;
      }

      case 'SWEEP_DETECTED': {
        if (!this.activeSweep) {
          this.phase = 'SCANNING';
          return null;
        }

        this.activeSweep.barsSinceSweep++;

        // Check if MSS is required
        if (this.params.requireMSS) {
          // Check expiration for MSS
          if (this.activeSweep.barsSinceSweep > this.params.maxBarsForMSS) {
            this.phase = 'SCANNING';
            this.activeSweep = undefined;
            return null;
          }

          // Look for MSS
          const mss = this.detectMSS(candles, this.activeSweep, currentIndex);
          if (mss && mss.confirmed) {
            this.activeSweep.mssConfirmed = true;
            this.activeSweep.mssIndex = mss.index;
            this.activeSweep.mssLevel = mss.level;
            this.phase = 'MSS_CONFIRMED';
            this.barsInPhase = 0;
          }
          return null;
        } else {
          // MSS not required - look for FVG directly
          if (this.activeSweep.barsSinceSweep > this.params.maxBarsAfterSweep) {
            this.phase = 'SCANNING';
            this.activeSweep = undefined;
            return null;
          }

          const fvg = this.findPostSweepFVG(this.activeSweep, currentIndex, candles);
          if (fvg) {
            this.phase = 'WAITING_ENTRY';
            this.activeFVG = fvg;
            this.barsInPhase = 0;
          }
          return null;
        }
      }

      case 'MSS_CONFIRMED': {
        if (!this.activeSweep) {
          this.phase = 'SCANNING';
          return null;
        }

        this.activeSweep.barsSinceSweep++;

        // Check expiration for FVG after MSS
        if (this.activeSweep.barsSinceSweep > this.params.maxBarsAfterSweep) {
          this.phase = 'SCANNING';
          this.activeSweep = undefined;
          return null;
        }

        // Look for FVG after MSS confirmation
        const fvg = this.findPostSweepFVG(this.activeSweep, currentIndex, candles);
        if (fvg) {
          this.phase = 'WAITING_ENTRY';
          this.activeFVG = fvg;
          this.barsInPhase = 0;
        }
        return null;
      }

      case 'WAITING_ENTRY': {
        if (!this.activeSweep || !this.activeFVG) {
          this.phase = 'SCANNING';
          return null;
        }

        this.activeSweep.barsSinceSweep++;

        // Check expiration
        if (this.barsInPhase > this.params.maxBarsForEntry) {
          this.phase = 'SCANNING';
          this.activeSweep = undefined;
          this.activeFVG = undefined;
          return null;
        }

        // Check entry
        if (this.checkFVGEntry(candle, this.activeFVG)) {
          const confidence = this.calculateConfidence(this.activeSweep, this.activeFVG, currentIndex);

          if (confidence < this.params.minConfidence * 100) {
            this.phase = 'SCANNING';
            this.activeSweep = undefined;
            this.activeFVG = undefined;
            return null;
          }

          const { tpPct, slPct, dynamicTarget } = this.calculateTPSL(
            this.activeSweep,
            this.activeFVG,
            currentIndex
          );

          const direction = this.activeSweep.expectedDirection;
          const price = this.activeFVG.midpoint;

          // Reset state
          this.lastTradeIndex = currentIndex;
          const sweep = this.activeSweep;
          const fvg = this.activeFVG;

          this.phase = 'SCANNING';
          this.activeSweep = undefined;
          this.activeFVG = undefined;
          this.barsInPhase = 0;

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
              sweepLevel: sweep.zone.level,
              sweepType: sweep.type === 'SSL' ? 1 : -1,
              fvgTop: fvg.top,
              fvgBottom: fvg.bottom,
              fvgMid: fvg.midpoint,
              rsi: this.rsiValues[currentIndex] ?? 50,
            },
          };

          return {
            timestamp: candle.timestamp,
            direction,
            price,
            confidence,
            reason: `${sweep.type} sweep → ${fvg.type} FVG | Swings: ${sweep.zone.swings.length}${dynamicTarget ? ` | Target: ${dynamicTarget}` : ` | R:R ${this.params.takeProfitRR}`}`,
            strategyName: this.name,
            strategyVersion: this.version,
            snapshot,
            suggestedTpPct: tpPct,
            suggestedSlPct: slPct,
          };
        }
        return null;
      }

      default:
        this.phase = 'SCANNING';
        return null;
    }
  }

  reset(): void {
    this.lastTradeIndex = -1;
    this.phase = 'SCANNING';
    this.activeSweep = undefined;
    this.activeFVG = undefined;
    this.barsInPhase = 0;

    // Reset zone sweep status
    for (const zone of this.allLiquidityZones) {
      zone.swept = false;
      zone.sweptIndex = undefined;
      zone.sweptPrice = undefined;
    }
  }
}

/**
 * Factory function
 */
export function createFVGLiquiditySweepStrategy(
  asset: string,
  params?: Partial<FVGLiquiditySweepParams>
): FVGLiquiditySweepBacktestStrategy {
  return new FVGLiquiditySweepBacktestStrategy(asset, params);
}
