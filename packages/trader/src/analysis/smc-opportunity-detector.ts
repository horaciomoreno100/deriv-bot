/**
 * SMC (Smart Money Concepts) Opportunity Detector
 *
 * Detects high-probability trading opportunities using SMC principles:
 * - Liquidity Sweep + FVG = Entry zone
 * - Order Block + Zone confluence = Strong level
 * - MTF alignment = Trend confirmation
 *
 * IMPORTANT: This system avoids overfitting by:
 * 1. Using binary confluences (present/not present) instead of optimized thresholds
 * 2. Counting confluences rather than weighting them
 * 3. Requiring multiple independent confirmations
 * 4. Using market structure principles that are time-tested
 */

import type { Candle } from '@deriv-bot/shared';
import type { SwingPoint } from '@deriv-bot/shared';
import type { MTFMarketStructure } from './mtf-market-structure.js';
import type { OrderBlock } from './order-block-detector.js';
import type { FairValueGap } from './fvg-detector.js';
import type { LiquiditySweep } from './liquidity-sweep-detector.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * SMC Trade Setup Type
 */
export type SMCSetupType =
  | 'sweep_to_fvg' // Liquidity sweep followed by FVG entry
  | 'ob_retest' // Order block retest
  | 'fvg_fill' // FVG getting filled (mean reversion)
  | 'zone_confluence' // Multiple zones aligning
  | 'trend_continuation'; // Pullback in trend to key level

/**
 * Trade direction
 */
export type TradeDirection = 'long' | 'short';

/**
 * Confluence factors present in the setup
 */
export interface SMCConfluenceFactors {
  // Structural factors (binary - present or not)
  hasLiquiditySweep: boolean;
  sweepType?: 'buyside' | 'sellside';
  sweepRecency: number; // Candles since sweep (lower = more recent)

  hasFVG: boolean;
  fvgType?: 'bullish' | 'bearish';
  priceInFVG: boolean; // Is current price inside FVG zone

  hasOrderBlock: boolean;
  obType?: 'bullish' | 'bearish';
  priceInOB: boolean; // Is current price inside OB zone

  hasZoneConfluence: boolean;
  zoneTimeframes: string[]; // Which TFs have zones at this level
  zoneType?: 'support' | 'resistance';

  // Trend alignment
  htfBias: 'bullish' | 'bearish' | 'neutral';
  trendAligned: boolean; // Is setup in direction of HTF trend

  // Price action
  hasRejection: boolean; // Rejection candle at level
  hasBreakOfStructure: boolean; // BOS in setup direction
}

/**
 * A detected SMC trading opportunity
 */
export interface SMCOpportunity {
  // Identification
  id: string;
  timestamp: number;
  asset: string;

  // Setup info
  setupType: SMCSetupType;
  direction: TradeDirection;

  // Origin info (where the signal came from)
  originTimestamp: number; // When the setup formed (sweep, OB, FVG timestamp)
  originIndex: number; // Candle index where setup originated
  originPrice: number; // Price level of the origin event

  // Entry zone
  entryZoneHigh: number;
  entryZoneLow: number;
  idealEntry: number;

  // Risk management (based on structure, not optimization)
  structuralSL: number; // SL based on structure (swing low/high)
  structuralTP1: number; // TP1 = nearest opposing zone
  structuralTP2: number; // TP2 = next zone beyond
  riskRewardRatio: number;

  // Confluence count (NOT weighted - just counting)
  confluenceCount: number; // Total number of confluences (0-10)
  confluences: SMCConfluenceFactors;

  // Quality tier based on confluence count
  quality: 'A+' | 'A' | 'B' | 'C';

  // Human-readable reasoning
  reasons: string[];
  warnings: string[];
}

/**
 * Detector input data
 */
export interface SMCDetectorInput {
  candles: Candle[];
  mtfStructure: MTFMarketStructure;
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  sweeps: LiquiditySweep[];
  asset: string;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class SMCOpportunityDetector {
  /**
   * Detect SMC trading opportunities
   * Returns opportunities sorted by quality (A+ first)
   */
  detect(input: SMCDetectorInput): SMCOpportunity[] {
    const opportunities: SMCOpportunity[] = [];
    const currentCandle = input.candles[input.candles.length - 1];
    if (!currentCandle) return opportunities;

    const currentPrice = currentCandle.close;

    // 1. Check for Sweep-to-FVG setups (highest probability)
    const sweepFvgSetups = this.detectSweepToFVG(input, currentPrice);
    opportunities.push(...sweepFvgSetups);

    // 2. Check for Order Block retest setups
    const obSetups = this.detectOrderBlockRetest(input, currentPrice);
    opportunities.push(...obSetups);

    // 3. Check for FVG fill setups (mean reversion)
    const fvgFillSetups = this.detectFVGFill(input, currentPrice);
    opportunities.push(...fvgFillSetups);

    // 4. Check for zone confluence setups
    const zoneSetups = this.detectZoneConfluence(input, currentPrice);
    opportunities.push(...zoneSetups);

    // Sort by quality and confluence count
    return opportunities.sort((a, b) => {
      const qualityOrder = { 'A+': 0, A: 1, B: 2, C: 3 };
      const qualityDiff = qualityOrder[a.quality] - qualityOrder[b.quality];
      if (qualityDiff !== 0) return qualityDiff;
      return b.confluenceCount - a.confluenceCount;
    });
  }

  /**
   * Detect Sweep-to-FVG setups
   * Classic SMC setup: Liquidity sweep followed by move into FVG
   */
  private detectSweepToFVG(
    input: SMCDetectorInput,
    currentPrice: number
  ): SMCOpportunity[] {
    const opportunities: SMCOpportunity[] = [];
    const { sweeps, fvgs, mtfStructure, candles, asset } = input;

    // Get recent sweeps (last 20 candles)
    const recentSweeps = sweeps.filter(
      (s) => candles.length - 1 - s.index <= 20
    );

    for (const sweep of recentSweeps) {
      // Look for FVGs in opposite direction (entry zones after sweep)
      const relevantFVGs = fvgs.filter((fvg) => {
        // Sellside sweep (SSL) -> look for bullish FVG below price
        if (sweep.type === 'sellside') {
          return (
            fvg.type === 'bullish' &&
            !fvg.filled &&
            fvg.high <= currentPrice * 1.005 // Within 0.5% of current price
          );
        }
        // Buyside sweep (BSL) -> look for bearish FVG above price
        if (sweep.type === 'buyside') {
          return (
            fvg.type === 'bearish' &&
            !fvg.filled &&
            fvg.low >= currentPrice * 0.995
          );
        }
        return false;
      });

      for (const fvg of relevantFVGs) {
        const direction: TradeDirection =
          sweep.type === 'sellside' ? 'long' : 'short';

        // Build confluence factors
        const confluences = this.buildConfluences(
          input,
          currentPrice,
          direction,
          { sweep, fvg }
        );

        // Calculate entry zone and risk management
        const entryZone = {
          high: fvg.high,
          low: fvg.low,
          ideal: fvg.midpoint,
        };

        const { sl, tp1, tp2 } = this.calculateRiskManagement(
          input,
          direction,
          entryZone.ideal,
          sweep
        );

        const rr = Math.abs(tp1 - entryZone.ideal) / Math.abs(sl - entryZone.ideal);

        // Count confluences
        const count = this.countConfluences(confluences);
        const quality = this.getQualityTier(count, confluences, rr);

        // Build reasons
        const reasons: string[] = [
          `${sweep.type === 'sellside' ? 'Sellside' : 'Buyside'} liquidity sweep detected`,
          `Unfilled ${fvg.type} FVG at $${fvg.midpoint.toFixed(2)}`,
        ];

        if (confluences.trendAligned) {
          reasons.push(`Aligned with HTF ${mtfStructure.htfBias} bias`);
        }
        if (confluences.hasOrderBlock) {
          reasons.push(`Order Block confluence at entry zone`);
        }
        if (confluences.hasZoneConfluence) {
          reasons.push(`Zone confluence: ${confluences.zoneTimeframes.join('+')}`);
        }

        const warnings: string[] = [];
        if (!confluences.trendAligned) {
          warnings.push('Counter-trend setup - use smaller size');
        }
        if (count < 4) {
          warnings.push('Limited confluences - wait for more confirmation');
        }

        opportunities.push({
          id: `sweep-fvg-${sweep.index}-${fvg.index}`,
          timestamp: Date.now(),
          asset,
          setupType: 'sweep_to_fvg',
          direction,
          // Origin: use sweep timestamp/index as origin
          originTimestamp: sweep.timestamp,
          originIndex: sweep.index,
          originPrice: sweep.sweptLevel,
          entryZoneHigh: entryZone.high,
          entryZoneLow: entryZone.low,
          idealEntry: entryZone.ideal,
          structuralSL: sl,
          structuralTP1: tp1,
          structuralTP2: tp2,
          riskRewardRatio: rr,
          confluenceCount: count,
          confluences,
          quality,
          reasons,
          warnings,
        });
      }
    }

    return opportunities;
  }

  /**
   * Detect Order Block retest setups
   */
  private detectOrderBlockRetest(
    input: SMCDetectorInput,
    currentPrice: number
  ): SMCOpportunity[] {
    const opportunities: SMCOpportunity[] = [];
    const { orderBlocks, mtfStructure, asset } = input;

    // Get active (unmitigated) order blocks
    const activeOBs = orderBlocks.filter((ob) => !ob.mitigated);

    for (const ob of activeOBs) {
      // Check if price is near/in the OB zone
      const distancePct =
        Math.abs(currentPrice - (ob.priceHigh + ob.priceLow) / 2) / currentPrice;
      if (distancePct > 0.005) continue; // Skip if more than 0.5% away

      const direction: TradeDirection = ob.type === 'bullish' ? 'long' : 'short';

      // Only take if aligned with HTF bias
      const htfAligned =
        (direction === 'long' && mtfStructure.htfBias === 'bullish') ||
        (direction === 'short' && mtfStructure.htfBias === 'bearish');

      const confluences = this.buildConfluences(input, currentPrice, direction, {
        orderBlock: ob,
      });

      const entryZone = {
        high: ob.priceHigh,
        low: ob.priceLow,
        ideal: direction === 'long' ? ob.priceLow : ob.priceHigh,
      };

      const { sl, tp1, tp2 } = this.calculateRiskManagement(
        input,
        direction,
        entryZone.ideal
      );

      const rr = Math.abs(tp1 - entryZone.ideal) / Math.abs(sl - entryZone.ideal);
      const count = this.countConfluences(confluences);
      const quality = this.getQualityTier(count, confluences, rr);

      const reasons: string[] = [
        `${ob.type} Order Block retest at $${((ob.priceHigh + ob.priceLow) / 2).toFixed(2)}`,
        `OB strength: ${'★'.repeat(ob.strength)}`,
      ];

      if (htfAligned) {
        reasons.push(`Aligned with ${mtfStructure.htfBias} HTF bias`);
      }

      const warnings: string[] = [];
      if (!htfAligned) {
        warnings.push('Counter-trend OB - higher risk');
      }

      opportunities.push({
        id: `ob-retest-${ob.index}`,
        timestamp: Date.now(),
        asset,
        setupType: 'ob_retest',
        direction,
        // Origin: use OB timestamp/index as origin
        originTimestamp: ob.timestamp,
        originIndex: ob.index,
        originPrice: (ob.priceHigh + ob.priceLow) / 2,
        entryZoneHigh: entryZone.high,
        entryZoneLow: entryZone.low,
        idealEntry: entryZone.ideal,
        structuralSL: sl,
        structuralTP1: tp1,
        structuralTP2: tp2,
        riskRewardRatio: rr,
        confluenceCount: count,
        confluences,
        quality,
        reasons,
        warnings,
      });
    }

    return opportunities;
  }

  /**
   * Detect FVG fill setups (price returning to fill gap)
   */
  private detectFVGFill(
    input: SMCDetectorInput,
    currentPrice: number
  ): SMCOpportunity[] {
    const opportunities: SMCOpportunity[] = [];
    const { fvgs, asset } = input;

    // Get unfilled FVGs that price is approaching
    const approachingFVGs = fvgs.filter((fvg) => {
      if (fvg.filled) return false;

      // Bullish FVG below price = potential long entry
      if (fvg.type === 'bullish' && fvg.high < currentPrice) {
        const distancePct = (currentPrice - fvg.high) / currentPrice;
        return distancePct <= 0.003; // Within 0.3%
      }

      // Bearish FVG above price = potential short entry
      if (fvg.type === 'bearish' && fvg.low > currentPrice) {
        const distancePct = (fvg.low - currentPrice) / currentPrice;
        return distancePct <= 0.003;
      }

      return false;
    });

    for (const fvg of approachingFVGs) {
      const direction: TradeDirection = fvg.type === 'bullish' ? 'long' : 'short';

      const confluences = this.buildConfluences(input, currentPrice, direction, {
        fvg,
      });

      const entryZone = {
        high: fvg.high,
        low: fvg.low,
        ideal: fvg.midpoint,
      };

      const { sl, tp1, tp2 } = this.calculateRiskManagement(
        input,
        direction,
        entryZone.ideal
      );

      const rr = Math.abs(tp1 - entryZone.ideal) / Math.abs(sl - entryZone.ideal);
      const count = this.countConfluences(confluences);
      const quality = this.getQualityTier(count, confluences, rr);

      opportunities.push({
        id: `fvg-fill-${fvg.index}`,
        timestamp: Date.now(),
        asset,
        setupType: 'fvg_fill',
        direction,
        // Origin: use FVG timestamp/index as origin
        originTimestamp: fvg.timestamp,
        originIndex: fvg.index,
        originPrice: fvg.midpoint,
        entryZoneHigh: entryZone.high,
        entryZoneLow: entryZone.low,
        idealEntry: entryZone.ideal,
        structuralSL: sl,
        structuralTP1: tp1,
        structuralTP2: tp2,
        riskRewardRatio: rr,
        confluenceCount: count,
        confluences,
        quality,
        reasons: [
          `${fvg.type} FVG fill opportunity at $${fvg.midpoint.toFixed(2)}`,
          `Gap size: ${fvg.gapSizePct.toFixed(3)}%`,
        ],
        warnings: count < 3 ? ['Limited confluences'] : [],
      });
    }

    return opportunities;
  }

  /**
   * Detect zone confluence setups
   * When multiple timeframes have zones at the same level
   */
  private detectZoneConfluence(
    input: SMCDetectorInput,
    currentPrice: number
  ): SMCOpportunity[] {
    const opportunities: SMCOpportunity[] = [];
    const { mtfStructure, asset, candles } = input;

    // Get confluence zones (zones where multiple TFs agree)
    const strongZones = mtfStructure.confluenceZones.filter(
      (z) => z.timeframes.length >= 2
    );

    for (const zone of strongZones) {
      const zoneMid = (zone.priceHigh + zone.priceLow) / 2;
      const distancePct = Math.abs(currentPrice - zoneMid) / currentPrice;

      if (distancePct > 0.005) continue; // Skip if more than 0.5% away

      // Determine direction based on zone type
      const direction: TradeDirection =
        zone.type === 'support' ? 'long' : 'short';

      const confluences = this.buildConfluences(input, currentPrice, direction, {});

      const entryZone = {
        high: zone.priceHigh,
        low: zone.priceLow,
        ideal: direction === 'long' ? zone.priceLow : zone.priceHigh,
      };

      const { sl, tp1, tp2 } = this.calculateRiskManagement(
        input,
        direction,
        entryZone.ideal
      );

      const rr = Math.abs(tp1 - entryZone.ideal) / Math.abs(sl - entryZone.ideal);
      const count = this.countConfluences(confluences);
      const quality = this.getQualityTier(count, confluences, rr);

      // Find approximate origin index from candles
      const candleAtZone = candles.findIndex(
        (c) => c.low <= zone.priceHigh && c.high >= zone.priceLow
      );
      const originIdx = candleAtZone >= 0 ? candleAtZone : 0;

      opportunities.push({
        id: `zone-confluence-${zone.priceHigh}-${zone.priceLow}`,
        timestamp: Date.now(),
        asset,
        setupType: 'zone_confluence',
        direction,
        // Origin: use first candle that touched the zone
        originTimestamp: candles[originIdx]?.timestamp ?? Date.now() / 1000,
        originIndex: originIdx,
        originPrice: (zone.priceHigh + zone.priceLow) / 2,
        entryZoneHigh: entryZone.high,
        entryZoneLow: entryZone.low,
        idealEntry: entryZone.ideal,
        structuralSL: sl,
        structuralTP1: tp1,
        structuralTP2: tp2,
        riskRewardRatio: rr,
        confluenceCount: count,
        confluences,
        quality,
        reasons: [
          `${zone.type} zone with ${zone.timeframes.length}-TF confluence`,
          `Timeframes: ${zone.timeframes.join(' + ')}`,
          `Combined strength: ${zone.combinedStrength}`,
        ],
        warnings: [],
      });
    }

    return opportunities;
  }

  /**
   * Build confluence factors object
   */
  private buildConfluences(
    input: SMCDetectorInput,
    currentPrice: number,
    direction: TradeDirection,
    context: {
      sweep?: LiquiditySweep;
      fvg?: FairValueGap;
      orderBlock?: OrderBlock;
    }
  ): SMCConfluenceFactors {
    const { mtfStructure, orderBlocks, fvgs, sweeps, candles } = input;

    // Check for liquidity sweep
    const recentSweep =
      context.sweep ||
      sweeps.find((s) => candles.length - 1 - s.index <= 10);

    // Check for FVG
    const nearbyFVG =
      context.fvg ||
      fvgs.find((f) => {
        if (f.filled) return false;
        const mid = f.midpoint;
        const dist = Math.abs(currentPrice - mid) / currentPrice;
        return dist <= 0.005;
      });

    // Check for Order Block
    const nearbyOB =
      context.orderBlock ||
      orderBlocks.find((ob) => {
        if (ob.mitigated) return false;
        const mid = (ob.priceHigh + ob.priceLow) / 2;
        const dist = Math.abs(currentPrice - mid) / currentPrice;
        return dist <= 0.005;
      });

    // Check for zone confluence
    const zoneConfluence = mtfStructure.confluenceZones.find((z) => {
      const mid = (z.priceHigh + z.priceLow) / 2;
      const dist = Math.abs(currentPrice - mid) / currentPrice;
      return dist <= 0.005 && z.timeframes.length >= 2;
    });

    // Check HTF alignment
    const htfBias = mtfStructure.htfBias;
    const trendAligned =
      (direction === 'long' && htfBias === 'bullish') ||
      (direction === 'short' && htfBias === 'bearish');

    // Check for rejection candle
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const hasRejection = lastCandle && prevCandle ? this.isRejectionCandle(lastCandle, prevCandle, direction) : false;

    // Check for break of structure
    const hasBOS = this.hasBreakOfStructure(
      mtfStructure.tf1m.swingPoints,
      candles,
      direction
    );

    return {
      hasLiquiditySweep: !!recentSweep,
      sweepType: recentSweep?.type,
      sweepRecency: recentSweep
        ? candles.length - 1 - recentSweep.index
        : Infinity,

      hasFVG: !!nearbyFVG,
      fvgType: nearbyFVG?.type,
      priceInFVG: nearbyFVG
        ? currentPrice >= nearbyFVG.low && currentPrice <= nearbyFVG.high
        : false,

      hasOrderBlock: !!nearbyOB,
      obType: nearbyOB?.type,
      priceInOB: nearbyOB
        ? currentPrice >= nearbyOB.priceLow && currentPrice <= nearbyOB.priceHigh
        : false,

      hasZoneConfluence: !!zoneConfluence,
      zoneTimeframes: zoneConfluence?.timeframes ?? [],
      zoneType: zoneConfluence?.type,

      htfBias,
      trendAligned,

      hasRejection,
      hasBreakOfStructure: hasBOS,
    };
  }

  /**
   * Count total confluences (simple count, no weighting)
   */
  private countConfluences(c: SMCConfluenceFactors): number {
    let count = 0;

    if (c.hasLiquiditySweep) count++;
    if (c.hasFVG) count++;
    if (c.priceInFVG) count++; // Bonus for being IN the FVG
    if (c.hasOrderBlock) count++;
    if (c.priceInOB) count++; // Bonus for being IN the OB
    if (c.hasZoneConfluence) count++;
    if (c.zoneTimeframes.length >= 3) count++; // Bonus for 3+ TF confluence
    if (c.trendAligned) count++;
    if (c.hasRejection) count++;
    if (c.hasBreakOfStructure) count++;

    return count;
  }

  /**
   * Get quality tier based on confluence count and R:R
   * Adjusted thresholds for more realistic signal generation
   *
   * A+ = Premium setup (6+ confluences, must have sweep + FVG + trend aligned)
   * A  = High quality (4-5 confluences with trend aligned)
   * B  = Moderate (3 confluences)
   * C  = Low quality (<3 confluences)
   */
  private getQualityTier(
    count: number,
    confluences?: SMCConfluenceFactors,
    rr?: number
  ): 'A+' | 'A' | 'B' | 'C' {
    // A+ requires: 6+ confluences, trend aligned, and good R:R
    if (count >= 6 && confluences?.trendAligned && (rr ?? 0) >= 1.5) {
      return 'A+';
    }
    // A requires: 4+ confluences with trend aligned OR 5+ without
    if ((count >= 4 && confluences?.trendAligned) || count >= 5) {
      return 'A';
    }
    // B requires 3+ confluences
    if (count >= 3) return 'B';
    return 'C';
  }

  /**
   * Check if candle is a rejection pattern
   */
  private isRejectionCandle(
    candle: Candle,
    prevCandle: Candle,
    direction: TradeDirection
  ): boolean {
    const bodySize = Math.abs(candle.close - candle.open);
    const totalRange = candle.high - candle.low;

    if (totalRange === 0) return false;

    const bodyRatio = bodySize / totalRange;

    if (direction === 'long') {
      // Bullish rejection: small body, long lower wick, closes higher
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const lowerWickRatio = lowerWick / totalRange;
      return (
        bodyRatio < 0.4 &&
        lowerWickRatio > 0.5 &&
        candle.close > prevCandle.close
      );
    } else {
      // Bearish rejection: small body, long upper wick, closes lower
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const upperWickRatio = upperWick / totalRange;
      return (
        bodyRatio < 0.4 &&
        upperWickRatio > 0.5 &&
        candle.close < prevCandle.close
      );
    }
  }

  /**
   * Check for break of structure in given direction
   */
  private hasBreakOfStructure(
    swingPoints: SwingPoint[],
    candles: Candle[],
    direction: TradeDirection
  ): boolean {
    if (swingPoints.length < 2) return false;

    const recentSwings = swingPoints.slice(-5);
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) return false;

    if (direction === 'long') {
      // BOS = breaking above recent swing high
      const recentHighs = recentSwings
        .filter((s) => s.type === 'high')
        .sort((a, b) => b.timestamp - a.timestamp);
      const lastHigh = recentHighs[0];
      return lastHigh ? lastCandle.close > lastHigh.price : false;
    } else {
      // BOS = breaking below recent swing low
      const recentLows = recentSwings
        .filter((s) => s.type === 'low')
        .sort((a, b) => b.timestamp - a.timestamp);
      const lastLow = recentLows[0];
      return lastLow ? lastCandle.close < lastLow.price : false;
    }
  }

  /**
   * Calculate risk management levels based on structure
   */
  private calculateRiskManagement(
    input: SMCDetectorInput,
    direction: TradeDirection,
    entryPrice: number,
    sweep?: LiquiditySweep
  ): { sl: number; tp1: number; tp2: number } {
    const { mtfStructure } = input;
    const swings = mtfStructure.tf1m.swingPoints;

    // Find structural SL (beyond recent swing)
    let sl: number;
    if (direction === 'long') {
      // SL below recent swing low or sweep extreme
      const recentLows = swings
        .filter((s) => s.type === 'low')
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 3);
      const lowestLow = Math.min(
        ...recentLows.map((s) => s.price),
        sweep?.sweepExtreme ?? Infinity
      );
      sl = lowestLow * 0.9995; // Small buffer
    } else {
      // SL above recent swing high or sweep extreme
      const recentHighs = swings
        .filter((s) => s.type === 'high')
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 3);
      const highestHigh = Math.max(
        ...recentHighs.map((s) => s.price),
        sweep?.sweepExtreme ?? 0
      );
      sl = highestHigh * 1.0005;
    }

    // Find structural TPs (nearest opposing zones)
    const opposingZones = mtfStructure.allZones.filter((z) => {
      if (direction === 'long') {
        return z.type === 'resistance' && z.priceLow > entryPrice;
      } else {
        return z.type === 'support' && z.priceHigh < entryPrice;
      }
    });

    // Sort by distance
    opposingZones.sort((a, b) => {
      const distA = Math.abs((a.priceLow + a.priceHigh) / 2 - entryPrice);
      const distB = Math.abs((b.priceLow + b.priceHigh) / 2 - entryPrice);
      return distA - distB;
    });

    // Default TPs if no opposing zones found
    const riskAmount = Math.abs(entryPrice - sl);

    let tp1 =
      direction === 'long'
        ? entryPrice + riskAmount * 1.5
        : entryPrice - riskAmount * 1.5;

    let tp2 =
      direction === 'long'
        ? entryPrice + riskAmount * 2.5
        : entryPrice - riskAmount * 2.5;

    // Use structural levels if available
    if (opposingZones.length >= 1) {
      const zonePrice =
        direction === 'long'
          ? opposingZones[0]!.priceLow
          : opposingZones[0]!.priceHigh;
      // Only use zone if it's in the right direction
      if (
        (direction === 'long' && zonePrice > entryPrice) ||
        (direction === 'short' && zonePrice < entryPrice)
      ) {
        tp1 = zonePrice;
      }
    }
    if (opposingZones.length >= 2) {
      const zonePrice =
        direction === 'long'
          ? opposingZones[1]!.priceLow
          : opposingZones[1]!.priceHigh;
      // Only use zone if it's in the right direction
      if (
        (direction === 'long' && zonePrice > entryPrice) ||
        (direction === 'short' && zonePrice < entryPrice)
      ) {
        tp2 = zonePrice;
      }
    }

    // Final validation: ensure TP is in correct direction from entry
    if (direction === 'long') {
      // For long: tp1 > entry > sl
      if (tp1 <= entryPrice) tp1 = entryPrice + riskAmount * 1.5;
      if (tp2 <= tp1) tp2 = entryPrice + riskAmount * 2.5;
      if (sl >= entryPrice) sl = entryPrice - riskAmount;
    } else {
      // For short: sl > entry > tp1
      if (tp1 >= entryPrice) tp1 = entryPrice - riskAmount * 1.5;
      if (tp2 >= tp1) tp2 = entryPrice - riskAmount * 2.5;
      if (sl <= entryPrice) sl = entryPrice + riskAmount;
    }

    return { sl, tp1, tp2 };
  }
}

/**
 * Helper function for quick detection
 */
export function detectSMCOpportunities(
  input: SMCDetectorInput
): SMCOpportunity[] {
  const detector = new SMCOpportunityDetector();
  return detector.detect(input);
}

/**
 * Get only A+ and A quality setups
 */
export function getHighQualitySetups(
  opportunities: SMCOpportunity[]
): SMCOpportunity[] {
  return opportunities.filter((o) => o.quality === 'A+' || o.quality === 'A');
}
