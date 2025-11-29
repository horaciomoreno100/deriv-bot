/**
 * FVG Liquidity Sweep Strategy - Backtest Adapter
 *
 * Combines Liquidity Sweep detection with FVG entry for backtesting
 *
 * OPTIMIZATION: Pre-calculates all swings, liquidity zones, and FVGs ONCE
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import {
  DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS,
  getParamsForAsset,
} from '../../strategies/fvg-liquidity-sweep.params.js';
import type {
  SwingPoint,
  LiquidityZone,
  FairValueGap,
  FVGLiquiditySweepParams,
} from '../../strategies/fvg-liquidity-sweep.types.js';

/**
 * State machine phases
 */
type Phase = 'SCANNING' | 'SWEEP_DETECTED' | 'WAITING_ENTRY';

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
}

/**
 * Pre-calculated data for each candle
 */
interface PreCalculatedData {
  swings: SwingPoint[];
  liquidityZones: LiquidityZone[];
  sweep?: ActiveSweep;
  fvg?: FairValueGap;
}

/**
 * FVG Liquidity Sweep Strategy for Backtesting
 */
export class FVGLiquiditySweepBacktestStrategy implements BacktestableStrategy {
  readonly name = 'FVG-Liquidity-Sweep';
  readonly version = '1.0.0';

  private params: FVGLiquiditySweepParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  // State machine
  private phase: Phase = 'SCANNING';
  private activeSweep?: ActiveSweep;
  private activeFVG?: FairValueGap;
  private barsInPhase: number = 0;

  // Pre-calculated data
  private allSwings: SwingPoint[] = [];
  private allLiquidityZones: LiquidityZone[] = [];
  private allFVGs: FairValueGap[] = [];
  private isPreCalculated: boolean = false;

  constructor(asset: string, customParams?: Partial<FVGLiquiditySweepParams>) {
    this.asset = asset;
    this.params = getParamsForAsset(asset, customParams);
  }

  requiredIndicators(): string[] {
    return ['rsi']; // Optional but useful for logging
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      cooldownBars: Math.ceil(this.params.cooldownSeconds / 60),
    };
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

    this.isPreCalculated = true;
    const elapsed = Date.now() - startTime;
    console.log(`[FVG-LS] Pre-calculation completed in ${elapsed}ms`);
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

    // Calculate price range for tolerance (avoid spread for large arrays)
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
   * Groups swings that are close in BOTH price AND time (within maxZoneAgeBars)
   */
  private groupNearbySwings(swings: SwingPoint[], tolerance: number): SwingPoint[][] {
    if (swings.length === 0) return [];

    const groups: SwingPoint[][] = [];
    const used = new Set<number>();
    const maxIndexDiff = this.params.maxZoneAgeBars; // Max bars between swings in same zone

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const group: SwingPoint[] = [swings[i]!];
      used.add(i);

      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;

        // Check temporal proximity (swings must be within maxZoneAgeBars of each other)
        const baseSwing = swings[i]!;
        const candidateSwing = swings[j]!;
        const indexDiff = Math.abs(candidateSwing.index - baseSwing.index);

        if (indexDiff > maxIndexDiff) continue; // Too far apart in time

        // Check price proximity
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
   * Check for liquidity sweep at current candle
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

      // Zone must be formed before current candle
      if (zone.endIndex >= currentIndex) continue;

      if (zone.type === 'SSL') {
        // SSL Sweep: Price breaks below AND closes above
        const brokeBelow = candle.low < zone.level;
        const closedAbove = !this.params.requireCloseBack || candle.close > zone.level;

        if (brokeBelow && closedAbove) {
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
          };
        }
      } else {
        // BSL Sweep: Price breaks above AND closes below
        const brokeAbove = candle.high > zone.level;
        const closedBelow = !this.params.requireCloseBack || candle.close < zone.level;

        if (brokeAbove && closedBelow) {
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
          };
        }
      }
    }

    return null;
  }

  /**
   * Find FVG formed after sweep
   */
  private findPostSweepFVG(sweep: ActiveSweep, currentIndex: number): FairValueGap | null {
    for (const fvg of this.allFVGs) {
      // FVG must be formed after sweep
      if (fvg.formationIndex <= sweep.sweepIndex) continue;

      // FVG must be within search window
      if (fvg.formationIndex > sweep.sweepIndex + this.params.fvgSearchBars) continue;

      // Must match expected direction
      if (sweep.expectedDirection === 'CALL' && fvg.type !== 'bullish') continue;
      if (sweep.expectedDirection === 'PUT' && fvg.type !== 'bearish') continue;

      return fvg;
    }

    return null;
  }

  /**
   * Check if candle enters FVG
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

    if (fvg.type === 'bullish') {
      return candle.low <= entryLevel;
    } else {
      return candle.high >= entryLevel;
    }
  }

  /**
   * Calculate TP/SL prices and percentages
   */
  private calculateTPSL(
    sweep: ActiveSweep,
    fvg: FairValueGap
  ): { tpPct: number; slPct: number; tpPrice: number; slPrice: number } {
    const entryPrice = fvg.midpoint;
    let stopLoss: number;
    let takeProfit: number;

    if (sweep.expectedDirection === 'CALL') {
      const sweepLow = sweep.sweepLow ?? sweep.zone.level;
      stopLoss = sweepLow * (1 - this.params.stopLossBufferPct);
      const riskAmount = entryPrice - stopLoss;
      takeProfit = entryPrice + riskAmount * this.params.takeProfitRR;
    } else {
      const sweepHigh = sweep.sweepHigh ?? sweep.zone.level;
      stopLoss = sweepHigh * (1 + this.params.stopLossBufferPct);
      const riskAmount = stopLoss - entryPrice;
      takeProfit = entryPrice - riskAmount * this.params.takeProfitRR;
    }

    const tpPct = Math.abs(takeProfit - entryPrice) / entryPrice;
    const slPct = Math.abs(stopLoss - entryPrice) / entryPrice;

    return { tpPct, slPct, tpPrice: takeProfit, slPrice: stopLoss };
  }

  /**
   * Calculate confidence based on setup quality
   */
  private calculateConfidence(sweep: ActiveSweep, fvg: FairValueGap): number {
    let confidence = 70;

    // More swings = stronger zone
    if (sweep.zone.swings.length >= 3) confidence += 10;

    // Quick FVG formation = stronger momentum
    if (sweep.barsSinceSweep <= 5) confidence += 10;

    // Larger FVG = more significant
    if (fvg.gapSizePct >= this.params.minFVGSizePct * 2) confidence += 5;

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

        // Check expiration
        if (this.activeSweep.barsSinceSweep > this.params.maxBarsAfterSweep) {
          this.phase = 'SCANNING';
          this.activeSweep = undefined;
          return null;
        }

        // Look for FVG
        const fvg = this.findPostSweepFVG(this.activeSweep, currentIndex);
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
          const confidence = this.calculateConfidence(this.activeSweep, this.activeFVG);

          if (confidence < this.params.minConfidence * 100) {
            this.phase = 'SCANNING';
            this.activeSweep = undefined;
            this.activeFVG = undefined;
            return null;
          }

          const { tpPct, slPct, tpPrice, slPrice } = this.calculateTPSL(
            this.activeSweep,
            this.activeFVG
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
            },
          };

          return {
            timestamp: candle.timestamp,
            direction,
            price,
            confidence,
            reason: `${sweep.type} sweep → ${fvg.type} FVG | Swings: ${sweep.zone.swings.length} | R:R ${this.params.takeProfitRR}`,
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

    // Note: We keep pre-calculated data (swings, zones, fvgs)
    // Only reset runtime state
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
