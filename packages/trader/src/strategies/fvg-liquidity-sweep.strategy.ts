/**
 * FVG Liquidity Sweep Strategy v1.0.0
 *
 * Strategy: Combine Liquidity Sweep detection with FVG entry
 *
 * THEORY (ICT Smart Money Concepts):
 * 1. Institutions push price to liquidity zones (where stops accumulate)
 * 2. They sweep the liquidity (trigger stops) and reverse
 * 3. The impulse after the sweep creates a Fair Value Gap (FVG)
 * 4. Price returns to the FVG before continuing in the sweep direction
 *
 * LOGIC:
 * 1. Detect swing points (local highs/lows)
 * 2. Identify liquidity zones (clusters of swings)
 * 3. Detect liquidity sweep (break + close back)
 * 4. Find FVG formed after the sweep
 * 5. Enter when price returns to FVG
 *
 * STATE MACHINE:
 * SCANNING -> SWEEP_DETECTED -> WAITING_ENTRY -> SIGNAL
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import {
  DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS,
  getParamsForAsset,
} from './fvg-liquidity-sweep.params.js';
import type {
  SwingPoint,
  LiquidityZone,
  FairValueGap,
  ActiveSweep,
  StrategyState,
  FVGLiquiditySweepParams,
  TradeSetup,
} from './fvg-liquidity-sweep.types.js';

/**
 * FVG Liquidity Sweep Strategy
 */
export class FVGLiquiditySweepStrategy extends BaseStrategy {
  private params: FVGLiquiditySweepParams;

  // State per asset
  private states: Record<string, StrategyState> = {};
  private lastTradeTime: Record<string, number> = {};
  private barIndex: Record<string, number> = {};

  // Dynamic cooldown state
  private consecutiveLosses: Record<string, number> = {};
  private dynamicCooldownUntil: Record<string, number> = {};

  constructor(config: StrategyConfig) {
    super(config);
    this.params = {
      ...DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS,
      ...(config.parameters as Partial<FVGLiquiditySweepParams>),
    };
  }

  /**
   * Initialize state for an asset
   */
  private initializeState(asset: string): void {
    if (!this.states[asset]) {
      this.states[asset] = {
        phase: 'SCANNING',
        swings: [],
        liquidityZones: [],
        activeSweep: undefined,
        activeFVG: undefined,
        barsInState: 0,
      };
    }
    if (this.lastTradeTime[asset] === undefined) this.lastTradeTime[asset] = 0;
    if (this.barIndex[asset] === undefined) this.barIndex[asset] = 0;
    if (this.consecutiveLosses[asset] === undefined) this.consecutiveLosses[asset] = 0;
    if (this.dynamicCooldownUntil[asset] === undefined) this.dynamicCooldownUntil[asset] = 0;
  }

  /**
   * Detect swing highs and lows
   *
   * A swing high is where high[i] > high[i-n..i-1] AND high[i] > high[i+1..i+n]
   * A swing low is where low[i] < low[i-n..i-1] AND low[i] < low[i+1..i+n]
   */
  private detectSwings(candles: Candle[], swingLength: number): SwingPoint[] {
    const swings: SwingPoint[] = [];

    // Need at least swingLength * 2 + 1 candles
    if (candles.length < swingLength * 2 + 1) {
      return swings;
    }

    for (let i = swingLength; i < candles.length - swingLength; i++) {
      const current = candles[i]!;
      let isSwingHigh = true;
      let isSwingLow = true;

      // Check left and right
      for (let j = 1; j <= swingLength; j++) {
        const left = candles[i - j]!;
        const right = candles[i + j]!;

        // Swing high check
        if (current.high <= left.high || current.high <= right.high) {
          isSwingHigh = false;
        }

        // Swing low check
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
   * Group nearby swing points into liquidity zones
   */
  private detectLiquidityZones(
    swings: SwingPoint[],
    candles: Candle[],
    params: FVGLiquiditySweepParams
  ): LiquidityZone[] {
    const zones: LiquidityZone[] = [];

    if (candles.length === 0 || swings.length === 0) {
      return zones;
    }

    // Calculate price range for tolerance
    const maxPrice = Math.max(...candles.map(c => c.high));
    const minPrice = Math.min(...candles.map(c => c.low));
    const priceRange = maxPrice - minPrice;
    const tolerance = priceRange * params.liquidityRangePct;

    // Group swing highs (BSL - Buyside Liquidity)
    const swingHighs = swings.filter(s => s.type === 'high');
    const groupedHighs = this.groupNearbySwings(swingHighs, tolerance);

    for (const group of groupedHighs) {
      if (group.length >= params.minSwingsForZone) {
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

    // Group swing lows (SSL - Sellside Liquidity)
    const swingLows = swings.filter(s => s.type === 'low');
    const groupedLows = this.groupNearbySwings(swingLows, tolerance);

    for (const group of groupedLows) {
      if (group.length >= params.minSwingsForZone) {
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
   * Group swings that are within tolerance of each other
   */
  private groupNearbySwings(swings: SwingPoint[], tolerance: number): SwingPoint[][] {
    if (swings.length === 0) return [];

    const groups: SwingPoint[][] = [];
    const used = new Set<number>();

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const group: SwingPoint[] = [swings[i]!];
      used.add(i);

      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;

        // Check if this swing is close to any swing in the group
        const isClose = group.some(
          g => Math.abs(g.level - swings[j]!.level) <= tolerance
        );

        if (isClose) {
          group.push(swings[j]!);
          used.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Detect if current candle represents a liquidity sweep
   *
   * SSL Sweep (LONG signal): Price breaks below zone level but closes above it
   * BSL Sweep (SHORT signal): Price breaks above zone level but closes below it
   */
  private detectLiquiditySweep(
    currentCandle: Candle,
    currentIndex: number,
    zones: LiquidityZone[],
    params: FVGLiquiditySweepParams
  ): ActiveSweep | null {
    for (const zone of zones) {
      // Skip already swept zones
      if (zone.swept) continue;

      // Skip zones that are too old
      if (currentIndex - zone.endIndex > params.maxZoneAgeBars) continue;

      if (zone.type === 'SSL') {
        // SSL Sweep: Price breaks below AND closes above
        const brokeBelow = currentCandle.low < zone.level;
        const closedAbove = !params.requireCloseBack || currentCandle.close > zone.level;

        if (brokeBelow && closedAbove) {
          // Check minimum sweep depth
          const sweepDepth = (zone.level - currentCandle.low) / zone.level;
          if (sweepDepth < params.minSweepDepthPct) {
            continue; // Sweep not deep enough
          }

          // Check for strong rejection (close in upper half of candle for bullish rejection)
          if (params.requireStrongRejection) {
            const candleRange = currentCandle.high - currentCandle.low;
            const candleMidpoint = currentCandle.low + candleRange / 2;
            if (currentCandle.close < candleMidpoint) {
              continue; // Not a strong rejection - close in lower half
            }
          }

          // Mark zone as swept
          zone.swept = true;
          zone.sweptIndex = currentIndex;
          zone.sweptPrice = currentCandle.low;

          return {
            type: 'SSL',
            zone,
            sweepIndex: currentIndex,
            sweepTimestamp: currentCandle.timestamp,
            sweepLow: currentCandle.low,
            expectedDirection: 'CALL',
            barsSinceSweep: 0,
          };
        }
      } else {
        // BSL Sweep: Price breaks above AND closes below
        const brokeAbove = currentCandle.high > zone.level;
        const closedBelow = !params.requireCloseBack || currentCandle.close < zone.level;

        if (brokeAbove && closedBelow) {
          // Check minimum sweep depth
          const sweepDepth = (currentCandle.high - zone.level) / zone.level;
          if (sweepDepth < params.minSweepDepthPct) {
            continue; // Sweep not deep enough
          }

          // Check for strong rejection (close in lower half of candle for bearish rejection)
          if (params.requireStrongRejection) {
            const candleRange = currentCandle.high - currentCandle.low;
            const candleMidpoint = currentCandle.low + candleRange / 2;
            if (currentCandle.close > candleMidpoint) {
              continue; // Not a strong rejection - close in upper half
            }
          }

          // Mark zone as swept
          zone.swept = true;
          zone.sweptIndex = currentIndex;
          zone.sweptPrice = currentCandle.high;

          return {
            type: 'BSL',
            zone,
            sweepIndex: currentIndex,
            sweepTimestamp: currentCandle.timestamp,
            sweepHigh: currentCandle.high,
            expectedDirection: 'PUT',
            barsSinceSweep: 0,
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
   * - For SSL sweep (bullish): Price must break a recent swing HIGH (break of bearish structure)
   * - For BSL sweep (bearish): Price must break a recent swing LOW (break of bullish structure)
   *
   * This confirms that the sweep was indeed a "stop hunt" and price is reversing
   */
  private detectMarketStructureShift(
    candles: Candle[],
    sweep: ActiveSweep,
    currentIndex: number,
    params: FVGLiquiditySweepParams
  ): { confirmed: boolean; level: number; index: number } | null {
    // Find recent swings between sweep and current candle
    const sweepIndex = sweep.sweepIndex;
    const lookbackStart = Math.max(0, sweepIndex - params.mssLookbackBars);

    if (sweep.type === 'SSL') {
      // SSL sweep (bullish) - need to break a recent swing HIGH
      // Find the most recent swing high between lookbackStart and sweep
      let nearestSwingHigh = -Infinity;
      let swingHighIndex = -1;

      for (let i = lookbackStart; i < sweepIndex; i++) {
        // Check if this is a swing high (simple check: higher than neighbors)
        if (i > 0 && i < candles.length - 1) {
          const prevHigh = candles[i - 1]?.high ?? 0;
          const currHigh = candles[i]?.high ?? 0;
          const nextHigh = candles[i + 1]?.high ?? 0;

          if (currHigh > prevHigh && currHigh > nextHigh) {
            // This is a swing high - take the most recent one
            if (i > swingHighIndex) {
              nearestSwingHigh = currHigh;
              swingHighIndex = i;
            }
          }
        }
      }

      // If no swing high found, use the high of the sweep candle area
      if (swingHighIndex === -1) {
        // Find highest high in lookback period
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

        // MSS confirmed when HIGH breaks above the swing high AND close is above
        if (candle.high > nearestSwingHigh && candle.close > nearestSwingHigh) {
          return {
            confirmed: true,
            level: nearestSwingHigh,
            index: i,
          };
        }
      }
    } else {
      // BSL sweep (bearish) - need to break a recent swing LOW
      // Find the most recent swing low between lookbackStart and sweep
      let nearestSwingLow = Infinity;
      let swingLowIndex = -1;

      for (let i = lookbackStart; i < sweepIndex; i++) {
        // Check if this is a swing low (simple check: lower than neighbors)
        if (i > 0 && i < candles.length - 1) {
          const prevLow = candles[i - 1]?.low ?? Infinity;
          const currLow = candles[i]?.low ?? Infinity;
          const nextLow = candles[i + 1]?.low ?? Infinity;

          if (currLow < prevLow && currLow < nextLow) {
            // This is a swing low - take the most recent one
            if (i > swingLowIndex) {
              nearestSwingLow = currLow;
              swingLowIndex = i;
            }
          }
        }
      }

      // If no swing low found, use the low of the sweep candle area
      if (swingLowIndex === -1) {
        // Find lowest low in lookback period
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

        // MSS confirmed when LOW breaks below the swing low AND close is below
        if (candle.low < nearestSwingLow && candle.close < nearestSwingLow) {
          return {
            confirmed: true,
            level: nearestSwingLow,
            index: i,
          };
        }
      }
    }

    return null;
  }

  /**
   * Scan for FVG formed after MSS confirmation
   *
   * For LONG (SSL sweep): Look for bullish FVG (candle[i].low > candle[i-2].high)
   * For SHORT (BSL sweep): Look for bearish FVG (candle[i].high < candle[i-2].low)
   */
  private scanForPostSweepFVG(
    candles: Candle[],
    sweep: ActiveSweep,
    currentIndex: number,
    params: FVGLiquiditySweepParams
  ): FairValueGap | null {
    // Search from sweep index to current
    const searchStart = Math.max(sweep.sweepIndex + 2, 2);
    const searchEnd = Math.min(
      sweep.sweepIndex + params.fvgSearchBars,
      currentIndex
    );

    for (let i = searchStart; i <= searchEnd; i++) {
      if (i >= candles.length || i - 2 < 0) continue;

      const candle1 = candles[i - 2]!;
      const candle3 = candles[i]!;
      const avgPrice = (candle3.high + candle3.low) / 2;

      if (sweep.expectedDirection === 'CALL') {
        // Look for bullish FVG
        if (candle3.low > candle1.high) {
          const gapSize = candle3.low - candle1.high;
          const gapSizePct = gapSize / avgPrice;

          if (gapSizePct >= params.minFVGSizePct) {
            return {
              type: 'bullish',
              top: candle3.low,
              bottom: candle1.high,
              midpoint: (candle3.low + candle1.high) / 2,
              formationIndex: i,
              formationTimestamp: candle3.timestamp,
              touched: false,
              mitigationPct: 0,
              gapSizePct,
            };
          }
        }
      } else {
        // Look for bearish FVG
        if (candle3.high < candle1.low) {
          const gapSize = candle1.low - candle3.high;
          const gapSizePct = gapSize / avgPrice;

          if (gapSizePct >= params.minFVGSizePct) {
            return {
              type: 'bearish',
              top: candle1.low,
              bottom: candle3.high,
              midpoint: (candle1.low + candle3.high) / 2,
              formationIndex: i,
              formationTimestamp: candle3.timestamp,
              touched: false,
              mitigationPct: 0,
              gapSizePct,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if current candle enters the FVG zone
   */
  private checkFVGEntry(
    currentCandle: Candle,
    fvg: FairValueGap,
    params: FVGLiquiditySweepParams
  ): boolean {
    let entryLevel: number;

    switch (params.entryZone) {
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
      // For bullish FVG, price should come down to touch it
      return currentCandle.low <= entryLevel;
    } else {
      // For bearish FVG, price should come up to touch it
      return currentCandle.high >= entryLevel;
    }
  }

  /**
   * Generate trade setup with TP/SL
   */
  private generateSignal(
    sweep: ActiveSweep,
    fvg: FairValueGap,
    _currentCandle: Candle,
    params: FVGLiquiditySweepParams
  ): TradeSetup {
    const direction = sweep.expectedDirection;
    const entryPrice = fvg.midpoint;

    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'CALL') {
      // LONG: SL below sweep low
      const sweepLow = sweep.sweepLow ?? sweep.zone.level;
      stopLoss = sweepLow * (1 - params.stopLossBufferPct);
      const riskAmount = entryPrice - stopLoss;
      takeProfit = entryPrice + riskAmount * params.takeProfitRR;
    } else {
      // SHORT: SL above sweep high
      const sweepHigh = sweep.sweepHigh ?? sweep.zone.level;
      stopLoss = sweepHigh * (1 + params.stopLossBufferPct);
      const riskAmount = stopLoss - entryPrice;
      takeProfit = entryPrice - riskAmount * params.takeProfitRR;
    }

    const riskRewardRatio =
      Math.abs(takeProfit - entryPrice) / Math.abs(stopLoss - entryPrice);

    // Calculate confidence based on setup quality
    let confidence = 0.7;

    // More swings in zone = stronger liquidity
    if (sweep.zone.swings.length >= 3) confidence += 0.1;

    // Quick FVG formation = stronger momentum
    if (sweep.barsSinceSweep <= 5) confidence += 0.1;

    // Larger FVG = more significant
    if (fvg.gapSizePct >= params.minFVGSizePct * 2) confidence += 0.05;

    confidence = Math.min(confidence, 0.95);

    return {
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      confidence,
      metadata: {
        sweepType: sweep.type,
        sweepIndex: sweep.sweepIndex,
        sweepLevel: sweep.zone.level,
        sweepLow: sweep.sweepLow,
        sweepHigh: sweep.sweepHigh,
        fvgTop: fvg.top,
        fvgBottom: fvg.bottom,
        fvgMidpoint: fvg.midpoint,
        riskRewardRatio,
        swingsInZone: sweep.zone.swings.length,
        barsSinceSweep: sweep.barsSinceSweep,
      },
    };
  }

  /**
   * Main candle processing - State machine implementation
   */
  async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    const { candles } = context;
    const asset = candle.asset;
    const price = candle.close;

    // Initialize state
    this.initializeState(asset);

    // Get asset-specific params
    const params = getParamsForAsset(asset, this.params);

    // Use array index (not absolute counter) - critical for rotating buffers
    // currentIndex is the position of the CURRENT candle in the candles array
    const currentIndex = candles.length - 1;

    // Increment bar counter (only for logging/cooldown purposes)
    this.barIndex[asset] = (this.barIndex[asset] ?? 0) + 1;

    const state = this.states[asset]!;
    state.barsInState++;

    const now = Date.now();

    // Check cooldowns
    if (this.isInCooldown(asset, now, params)) {
      return null;
    }

    // Hour filter - skip trading during bad hours
    if (params.hourFilterEnabled && params.badHoursUTC.length > 0) {
      const candleHour = new Date(candle.timestamp * 1000).getUTCHours();
      if (params.badHoursUTC.includes(candleHour)) {
        // Only log occasionally to avoid spam
        if (this.barIndex[asset]! % 60 === 0) {
          console.log(`[FVG-LS] ${asset} | Hour ${candleHour}:00 UTC filtered - skipping`);
        }
        return null;
      }
    }

    // Need minimum candles
    const minCandles = params.swingLength * 2 + 10;
    if (!candles || candles.length < minCandles) {
      return null;
    }

    // Update swings and zones periodically
    if (this.barIndex[asset]! % 5 === 0 || state.swings.length === 0) {
      state.swings = this.detectSwings(candles, params.swingLength);
      state.liquidityZones = this.detectLiquidityZones(
        state.swings,
        candles,
        params
      );
    }

    // Log state
    const activeZones = state.liquidityZones.filter(z => !z.swept).length;
    console.log(
      `[FVG-LS] ${asset} | Phase: ${state.phase} | ` +
        `Price: ${price.toFixed(2)} | Swings: ${state.swings.length} | ` +
        `Zones: ${activeZones}/${state.liquidityZones.length}`
    );

    // State machine
    switch (state.phase) {
      case 'SCANNING': {
        // Look for liquidity sweep
        const sweep = this.detectLiquiditySweep(
          candle,
          currentIndex,
          state.liquidityZones,
          params
        );

        if (sweep) {
          state.phase = 'SWEEP_DETECTED';
          state.activeSweep = sweep;
          state.barsInState = 0;
          console.log(
            `[FVG-LS] SWEEP DETECTED: ${sweep.type} at ${sweep.zone.level.toFixed(2)} ` +
              `(${sweep.zone.swings.length} swings) -> ${sweep.expectedDirection}`
          );
        }
        return null;
      }

      case 'SWEEP_DETECTED': {
        if (!state.activeSweep) {
          state.phase = 'SCANNING';
          return null;
        }

        state.activeSweep.barsSinceSweep++;

        // Check if MSS is required
        if (params.requireMSS) {
          // Check if too many bars waiting for MSS
          if (state.activeSweep.barsSinceSweep > params.maxBarsForMSS) {
            console.log(
              `[FVG-LS] MSS not confirmed after ${state.activeSweep.barsSinceSweep} bars - resetting`
            );
            state.phase = 'SCANNING';
            state.activeSweep = undefined;
            return null;
          }

          // Look for Market Structure Shift
          const mss = this.detectMarketStructureShift(
            candles,
            state.activeSweep,
            currentIndex,
            params
          );

          if (mss && mss.confirmed) {
            // MSS confirmed! Update sweep and move to next phase
            state.activeSweep.mssConfirmed = true;
            state.activeSweep.mssIndex = mss.index;
            state.activeSweep.mssLevel = mss.level;
            state.phase = 'MSS_CONFIRMED';
            state.barsInState = 0;
            console.log(
              `[FVG-LS] MSS CONFIRMED: ${state.activeSweep.type} sweep -> ` +
                `Break of ${mss.level.toFixed(5)} at bar ${mss.index} -> ${state.activeSweep.expectedDirection}`
            );
          }
          return null;
        } else {
          // MSS not required - skip directly to FVG search (legacy behavior)
          // Check if too many bars since sweep
          if (state.activeSweep.barsSinceSweep > params.maxBarsAfterSweep) {
            console.log(
              `[FVG-LS] Sweep expired after ${state.activeSweep.barsSinceSweep} bars`
            );
            state.phase = 'SCANNING';
            state.activeSweep = undefined;
            return null;
          }

          // Look for FVG formed after sweep
          const fvg = this.scanForPostSweepFVG(
            candles,
            state.activeSweep,
            currentIndex,
            params
          );

          if (fvg) {
            state.phase = 'WAITING_ENTRY';
            state.activeFVG = fvg;
            state.barsInState = 0;
            console.log(
              `[FVG-LS] FVG FOUND: ${fvg.type} [${fvg.bottom.toFixed(2)} - ${fvg.top.toFixed(2)}] ` +
                `midpoint: ${fvg.midpoint.toFixed(2)}`
            );
          }
          return null;
        }
      }

      case 'MSS_CONFIRMED': {
        if (!state.activeSweep) {
          state.phase = 'SCANNING';
          return null;
        }

        state.activeSweep.barsSinceSweep++;

        // Check if too many bars since MSS for FVG
        if (state.activeSweep.barsSinceSweep > params.maxBarsAfterSweep) {
          console.log(
            `[FVG-LS] FVG not found after MSS - expired after ${state.activeSweep.barsSinceSweep} bars`
          );
          state.phase = 'SCANNING';
          state.activeSweep = undefined;
          return null;
        }

        // Look for FVG formed after MSS
        const fvg = this.scanForPostSweepFVG(
          candles,
          state.activeSweep,
          currentIndex,
          params
        );

        if (fvg) {
          state.phase = 'WAITING_ENTRY';
          state.activeFVG = fvg;
          state.barsInState = 0;
          console.log(
            `[FVG-LS] FVG FOUND (post-MSS): ${fvg.type} [${fvg.bottom.toFixed(5)} - ${fvg.top.toFixed(5)}] ` +
              `midpoint: ${fvg.midpoint.toFixed(5)}`
          );
        }
        return null;
      }

      case 'WAITING_ENTRY': {
        if (!state.activeSweep || !state.activeFVG) {
          state.phase = 'SCANNING';
          return null;
        }

        state.activeSweep.barsSinceSweep++;

        // Check if too many bars waiting for entry
        if (state.barsInState > params.maxBarsForEntry) {
          console.log(`[FVG-LS] Entry expired after ${state.barsInState} bars`);
          state.phase = 'SCANNING';
          state.activeSweep = undefined;
          state.activeFVG = undefined;
          return null;
        }

        // Check if price enters FVG
        const entered = this.checkFVGEntry(candle, state.activeFVG, params);

        if (entered) {
          // Generate signal
          const setup = this.generateSignal(
            state.activeSweep,
            state.activeFVG,
            candle,
            params
          );

          // Check minimum confidence
          if (setup.confidence < params.minConfidence) {
            console.log(
              `[FVG-LS] Confidence too low: ${(setup.confidence * 100).toFixed(1)}% < ${(params.minConfidence * 100).toFixed(1)}%`
            );
            state.phase = 'SCANNING';
            state.activeSweep = undefined;
            state.activeFVG = undefined;
            return null;
          }

          console.log(
            `[FVG-LS] SIGNAL: ${setup.direction} @ ${setup.entryPrice.toFixed(2)} | ` +
              `SL: ${setup.stopLoss.toFixed(2)} | TP: ${setup.takeProfit.toFixed(2)} | ` +
              `R:R ${setup.metadata.riskRewardRatio.toFixed(2)} | ` +
              `Confidence: ${(setup.confidence * 100).toFixed(1)}%`
          );

          // Reset state
          this.lastTradeTime[asset] = now;
          state.phase = 'SCANNING';
          state.activeSweep = undefined;
          state.activeFVG = undefined;
          state.barsInState = 0;

          return this.createSignal(setup.direction, setup.confidence, {
            strategy: 'FVG-Liquidity-Sweep',
            ...setup.metadata,
            entryPrice: setup.entryPrice,
            stopLoss: setup.stopLoss,
            takeProfit: setup.takeProfit,
            tpPct: Math.abs(setup.takeProfit - setup.entryPrice) / setup.entryPrice,
            slPct: Math.abs(setup.stopLoss - setup.entryPrice) / setup.entryPrice,
          }, asset);
        }

        return null;
      }

      default:
        state.phase = 'SCANNING';
        return null;
    }
  }

  /**
   * Check if in cooldown period
   */
  private isInCooldown(
    asset: string,
    now: number,
    params: FVGLiquiditySweepParams
  ): boolean {
    // Check dynamic cooldown
    const dynamicUntil = this.dynamicCooldownUntil[asset] ?? 0;
    if (params.dynamicCooldownEnabled && now < dynamicUntil) {
      const remainingSec = Math.round((dynamicUntil - now) / 1000);
      console.log(`[FVG-LS] Dynamic cooldown: ${remainingSec}s remaining`);
      return true;
    }

    // Check regular cooldown
    const lastTrade = this.lastTradeTime[asset] ?? 0;
    const cooldownMs = params.cooldownSeconds * 1000;
    if (now - lastTrade < cooldownMs) {
      const remainingSec = Math.round((cooldownMs - (now - lastTrade)) / 1000);
      console.log(`[FVG-LS] Cooldown: ${remainingSec}s remaining`);
      return true;
    }

    return false;
  }

  /**
   * Report trade result for dynamic cooldown
   */
  reportTradeResult(asset: string, pnl: number, isWin: boolean): void {
    this.initializeState(asset);

    if (isWin) {
      if ((this.consecutiveLosses[asset] ?? 0) > 0) {
        console.log(
          `[FVG-LS] WIN - Reset consecutive losses (was ${this.consecutiveLosses[asset]})`
        );
      }
      this.consecutiveLosses[asset] = 0;
      this.dynamicCooldownUntil[asset] = 0;
    } else {
      this.consecutiveLosses[asset] = (this.consecutiveLosses[asset] ?? 0) + 1;
      console.log(`[FVG-LS] LOSS #${this.consecutiveLosses[asset]} (PnL: ${pnl})`);

      if (this.params.dynamicCooldownEnabled) {
        let cooldownSeconds = 0;

        if ((this.consecutiveLosses[asset] ?? 0) >= 4) {
          cooldownSeconds = this.params.cooldownAfter4PlusLosses;
        } else if (this.consecutiveLosses[asset] === 3) {
          cooldownSeconds = this.params.cooldownAfter3Losses;
        } else if (this.consecutiveLosses[asset] === 2) {
          cooldownSeconds = this.params.cooldownAfter2Losses;
        }

        if (cooldownSeconds > 0) {
          this.dynamicCooldownUntil[asset] = Date.now() + cooldownSeconds * 1000;
          console.log(
            `[FVG-LS] Dynamic cooldown: ${cooldownSeconds}s (${this.consecutiveLosses[asset]} consecutive losses)`
          );
        }
      }
    }
  }

  /**
   * Get current state for monitoring
   */
  getState(asset: string): StrategyState | undefined {
    return this.states[asset];
  }

  /**
   * Get all liquidity zones for an asset
   */
  getLiquidityZones(asset: string): LiquidityZone[] {
    return this.states[asset]?.liquidityZones ?? [];
  }

  /**
   * Get strategy parameters
   */
  getParams(): FVGLiquiditySweepParams {
    return { ...this.params };
  }

  /**
   * Get signal readiness for proximity display
   * Shows how close the strategy is to generating a signal
   */
  getSignalReadiness(
    candles: Candle[],
    asset: string
  ): {
    asset: string;
    direction: 'call' | 'put' | 'neutral';
    overallProximity: number;
    criteria: Array<{
      name: string;
      current: number | string;
      target: number | string;
      unit: string;
      passed: boolean;
      distance: number;
    }>;
    readyToSignal: boolean;
    missingCriteria: string[];
  } | null {
    if (!candles || candles.length < 50) {
      return null;
    }

    // Initialize state if needed
    this.initializeState(asset);
    const state = this.states[asset]!;
    const params = getParamsForAsset(asset, this.params);

    const criteria: Array<{
      name: string;
      current: number | string;
      target: number | string;
      unit: string;
      passed: boolean;
      distance: number;
    }> = [];
    const missingCriteria: string[] = [];

    // Check cooldown
    const now = Date.now();
    const lastTrade = this.lastTradeTime[asset] ?? 0;
    const cooldownMs = params.cooldownSeconds * 1000;
    const timeSinceTrade = now - lastTrade;
    const cooldownOk = timeSinceTrade >= cooldownMs;

    criteria.push({
      name: 'Cooldown',
      current: Math.round(timeSinceTrade / 1000),
      target: params.cooldownSeconds,
      unit: 's',
      passed: cooldownOk,
      distance: cooldownOk ? 0 : Math.round((cooldownMs - timeSinceTrade) / 1000),
    });

    if (!cooldownOk) {
      missingCriteria.push(`Cooldown: ${Math.round((cooldownMs - timeSinceTrade) / 1000)}s remaining`);
    }

    // Check hour filter
    const candleHour = new Date().getUTCHours();
    const hourFilterOk = !params.hourFilterEnabled || !params.badHoursUTC.includes(candleHour);

    criteria.push({
      name: 'Hour Filter',
      current: `${candleHour}:00 UTC`,
      target: hourFilterOk ? 'OK' : 'Bad Hour',
      unit: '',
      passed: hourFilterOk,
      distance: hourFilterOk ? 0 : 1,
    });

    if (!hourFilterOk) {
      missingCriteria.push(`Hour ${candleHour}:00 UTC is filtered`);
    }

    // Check liquidity zones
    const activeZones = state.liquidityZones.filter(z => !z.swept);
    const hasZones = activeZones.length > 0;

    criteria.push({
      name: 'Liquidity Zones',
      current: activeZones.length,
      target: 1,
      unit: 'zones',
      passed: hasZones,
      distance: hasZones ? 0 : 1,
    });

    if (!hasZones) {
      missingCriteria.push('No active liquidity zones detected');
    }

    // Determine direction based on state and zones
    let direction: 'call' | 'put' | 'neutral' = 'neutral';
    let phaseProgress = 0;

    // State machine progress
    if (state.phase === 'SCANNING') {
      phaseProgress = 33;
      // Check proximity to nearest zone for potential sweep
      if (activeZones.length > 0 && candles.length > 0) {
        const currentPrice = candles[candles.length - 1]!.close;
        const sslZones = activeZones.filter(z => z.type === 'SSL');
        const bslZones = activeZones.filter(z => z.type === 'BSL');

        // Find nearest SSL (below price) and BSL (above price)
        let nearestSSL: typeof sslZones[0] | null = null;
        let nearestBSL: typeof bslZones[0] | null = null;
        let minSSLDist = Infinity;
        let minBSLDist = Infinity;

        for (const zone of sslZones) {
          const dist = currentPrice - zone.level;
          if (dist > 0 && dist < minSSLDist) {
            minSSLDist = dist;
            nearestSSL = zone;
          }
        }

        for (const zone of bslZones) {
          const dist = zone.level - currentPrice;
          if (dist > 0 && dist < minBSLDist) {
            minBSLDist = dist;
            nearestBSL = zone;
          }
        }

        // Calculate proximity to sweep
        const priceRange = Math.max(...candles.slice(-50).map(c => c.high)) -
                          Math.min(...candles.slice(-50).map(c => c.low));

        if (nearestSSL && nearestBSL) {
          // Both zones exist - show proximity to nearest
          if (minSSLDist < minBSLDist) {
            direction = 'call'; // SSL sweep would lead to CALL
            const proximityPct = Math.max(0, 100 - (minSSLDist / priceRange) * 100);
            criteria.push({
              name: 'Distance to SSL',
              current: minSSLDist.toFixed(5),
              target: nearestSSL.level.toFixed(5),
              unit: '',
              passed: minSSLDist < priceRange * 0.01,
              distance: Math.round(100 - proximityPct),
            });
          } else {
            direction = 'put'; // BSL sweep would lead to PUT
            const proximityPct = Math.max(0, 100 - (minBSLDist / priceRange) * 100);
            criteria.push({
              name: 'Distance to BSL',
              current: minBSLDist.toFixed(5),
              target: nearestBSL.level.toFixed(5),
              unit: '',
              passed: minBSLDist < priceRange * 0.01,
              distance: Math.round(100 - proximityPct),
            });
          }
        } else if (nearestSSL) {
          direction = 'call';
          const proximityPct = Math.max(0, 100 - (minSSLDist / priceRange) * 100);
          criteria.push({
            name: 'Distance to SSL',
            current: minSSLDist.toFixed(5),
            target: nearestSSL.level.toFixed(5),
            unit: '',
            passed: minSSLDist < priceRange * 0.01,
            distance: Math.round(100 - proximityPct),
          });
        } else if (nearestBSL) {
          direction = 'put';
          const proximityPct = Math.max(0, 100 - (minBSLDist / priceRange) * 100);
          criteria.push({
            name: 'Distance to BSL',
            current: minBSLDist.toFixed(5),
            target: nearestBSL.level.toFixed(5),
            unit: '',
            passed: minBSLDist < priceRange * 0.01,
            distance: Math.round(100 - proximityPct),
          });
        }
      }

      criteria.push({
        name: 'Phase',
        current: 'SCANNING',
        target: 'SWEEP_DETECTED',
        unit: '',
        passed: false,
        distance: 67,
      });
      missingCriteria.push('Waiting for liquidity sweep');

    } else if (state.phase === 'SWEEP_DETECTED') {
      phaseProgress = 66;
      direction = state.activeSweep?.expectedDirection === 'CALL' ? 'call' : 'put';

      criteria.push({
        name: 'Phase',
        current: 'SWEEP_DETECTED',
        target: 'WAITING_ENTRY',
        unit: '',
        passed: true,
        distance: 34,
      });

      criteria.push({
        name: 'Sweep Type',
        current: state.activeSweep?.type || 'N/A',
        target: state.activeSweep?.expectedDirection || 'N/A',
        unit: '',
        passed: true,
        distance: 0,
      });

      criteria.push({
        name: 'Bars Since Sweep',
        current: state.activeSweep?.barsSinceSweep || 0,
        target: params.fvgSearchBars,
        unit: 'bars',
        passed: (state.activeSweep?.barsSinceSweep || 0) <= params.fvgSearchBars,
        distance: 0,
      });

      missingCriteria.push('Waiting for FVG formation after sweep');

    } else if (state.phase === 'WAITING_ENTRY') {
      phaseProgress = 90;
      direction = state.activeSweep?.expectedDirection === 'CALL' ? 'call' : 'put';

      criteria.push({
        name: 'Phase',
        current: 'WAITING_ENTRY',
        target: 'SIGNAL',
        unit: '',
        passed: true,
        distance: 10,
      });

      if (state.activeFVG) {
        const currentPrice = candles[candles.length - 1]?.close || 0;
        const fvgMid = state.activeFVG.midpoint;
        const distToFVG = Math.abs(currentPrice - fvgMid);
        const fvgSize = state.activeFVG.top - state.activeFVG.bottom;

        criteria.push({
          name: 'FVG Zone',
          current: `${state.activeFVG.bottom.toFixed(5)} - ${state.activeFVG.top.toFixed(5)}`,
          target: fvgMid.toFixed(5),
          unit: '',
          passed: true,
          distance: 0,
        });

        criteria.push({
          name: 'Distance to FVG',
          current: distToFVG.toFixed(5),
          target: '0',
          unit: '',
          passed: distToFVG <= fvgSize,
          distance: Math.round((distToFVG / fvgSize) * 100),
        });

        if (distToFVG > fvgSize) {
          missingCriteria.push(`Price needs to enter FVG zone (${distToFVG.toFixed(5)} away)`);
        }
      }

      criteria.push({
        name: 'Bars Waiting',
        current: state.barsInState,
        target: params.maxBarsForEntry,
        unit: 'bars',
        passed: state.barsInState <= params.maxBarsForEntry,
        distance: 0,
      });

      missingCriteria.push('Waiting for price to enter FVG zone');
    }

    // Calculate overall proximity
    const passedCriteria = criteria.filter(c => c.passed).length;
    const totalCriteria = criteria.length;
    const baseProximity = (passedCriteria / totalCriteria) * 100;
    const overallProximity = Math.round(Math.min(100, (baseProximity + phaseProgress) / 2));

    return {
      asset,
      direction,
      overallProximity,
      criteria,
      readyToSignal: state.phase === 'WAITING_ENTRY' && cooldownOk && hourFilterOk,
      missingCriteria,
    };
  }
}
