/**
 * Multi-Timeframe Market Structure Analyzer
 *
 * Analyzes market structure across multiple timeframes:
 * - 1m (base) - entry timeframe
 * - 5m - intermediate context
 * - 15m - higher timeframe context
 *
 * Usage:
 *   const analyzer = new MTFMarketStructureAnalyzer();
 *   const mtfStructure = analyzer.analyze(candles1m, 'frxEURUSD');
 */

import type { Candle } from '@deriv-bot/shared';
import type { MarketStructure, SRZone, MarketStructureOptions } from '@deriv-bot/shared';
import { MarketStructureDetector } from './market-structure-detector.js';
import { aggregateCandles } from '../utils/candle-aggregator.js';

/**
 * MTF Analysis Result
 */
export interface MTFMarketStructure {
  /** Asset symbol */
  asset: string;

  /** Structure for each timeframe */
  tf1m: MarketStructure;
  tf5m: MarketStructure;
  tf15m: MarketStructure;

  /** Combined zones from all timeframes (with TF label) */
  allZones: MTFZone[];

  /** Key levels from HTF */
  htfKeyLevels: {
    resistance: number[];
    support: number[];
  };

  /** Confluence zones (where multiple TF zones overlap) */
  confluenceZones: ConfluenceZone[];

  /** Overall bias based on HTF */
  htfBias: 'bullish' | 'bearish' | 'neutral';

  /** Analysis timestamp */
  analyzedAt: number;
}

/**
 * Zone with timeframe information
 */
export interface MTFZone extends SRZone {
  /** Source timeframe label */
  tfLabel: '1M' | '5M' | '15M';

  /** Timeframe weight (higher TF = higher weight) */
  tfWeight: number;
}

/**
 * Zone where multiple timeframes overlap
 */
export interface ConfluenceZone {
  /** Price range */
  priceHigh: number;
  priceLow: number;

  /** Type */
  type: 'support' | 'resistance';

  /** Contributing timeframes */
  timeframes: string[];

  /** Combined strength (sum of individual strengths * weights) */
  combinedStrength: number;
}

/**
 * Options for MTF analysis
 */
export interface MTFAnalysisOptions {
  /** Options for 1m analysis */
  tf1mOptions?: MarketStructureOptions;

  /** Options for 5m analysis */
  tf5mOptions?: MarketStructureOptions;

  /** Options for 15m analysis */
  tf15mOptions?: MarketStructureOptions;

  /** Minimum overlap % to consider confluence */
  confluenceOverlapPct?: number;
}

const DEFAULT_MTF_OPTIONS: Required<MTFAnalysisOptions> = {
  tf1mOptions: {
    swingDepth: 3,
    lookbackPeriod: 200,
    minZoneTouches: 1,
  },
  tf5mOptions: {
    swingDepth: 4,
    lookbackPeriod: 100,
    minZoneTouches: 1,
  },
  tf15mOptions: {
    swingDepth: 5,
    lookbackPeriod: 50,
    minZoneTouches: 1,
  },
  confluenceOverlapPct: 50,
};

/**
 * Multi-Timeframe Market Structure Analyzer
 */
export class MTFMarketStructureAnalyzer {
  private options: Required<MTFAnalysisOptions>;
  private detector1m: MarketStructureDetector;
  private detector5m: MarketStructureDetector;
  private detector15m: MarketStructureDetector;

  constructor(options: MTFAnalysisOptions = {}) {
    this.options = { ...DEFAULT_MTF_OPTIONS, ...options };

    this.detector1m = new MarketStructureDetector(this.options.tf1mOptions);
    this.detector5m = new MarketStructureDetector(this.options.tf5mOptions);
    this.detector15m = new MarketStructureDetector(this.options.tf15mOptions);
  }

  /**
   * Analyze market structure across all timeframes
   */
  analyze(candles1m: Candle[], asset: string): MTFMarketStructure {
    // Aggregate to higher timeframes
    const candles5m = aggregateCandles(candles1m, 5);
    const candles15m = aggregateCandles(candles1m, 15);

    // Analyze each timeframe
    const tf1m = this.detector1m.analyze(candles1m, asset, 60);
    const tf5m = this.detector5m.analyze(candles5m, asset, 300);
    const tf15m = this.detector15m.analyze(candles15m, asset, 900);

    // Combine zones with TF labels
    const allZones = this.combineZones(tf1m.zones, tf5m.zones, tf15m.zones);

    // Find confluence zones
    const confluenceZones = this.findConfluenceZones(allZones);

    // Get HTF key levels
    const htfKeyLevels = this.getHTFKeyLevels(tf5m, tf15m);

    // Determine HTF bias
    const htfBias = this.determineHTFBias(tf5m, tf15m);

    return {
      asset,
      tf1m,
      tf5m,
      tf15m,
      allZones,
      htfKeyLevels,
      confluenceZones,
      htfBias,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Combine zones from all timeframes with labels and weights
   */
  private combineZones(
    zones1m: SRZone[],
    zones5m: SRZone[],
    zones15m: SRZone[]
  ): MTFZone[] {
    const allZones: MTFZone[] = [];

    // Add 1m zones (weight 1)
    for (const zone of zones1m) {
      allZones.push({
        ...zone,
        id: `1m-${zone.id}`,
        tfLabel: '1M',
        tfWeight: 1,
      });
    }

    // Add 5m zones (weight 2)
    for (const zone of zones5m) {
      allZones.push({
        ...zone,
        id: `5m-${zone.id}`,
        tfLabel: '5M',
        tfWeight: 2,
      });
    }

    // Add 15m zones (weight 3)
    for (const zone of zones15m) {
      allZones.push({
        ...zone,
        id: `15m-${zone.id}`,
        tfLabel: '15M',
        tfWeight: 3,
      });
    }

    return allZones;
  }

  /**
   * Find zones where multiple timeframes overlap
   */
  private findConfluenceZones(zones: MTFZone[]): ConfluenceZone[] {
    const confluences: ConfluenceZone[] = [];
    const used = new Set<string>();

    for (let i = 0; i < zones.length; i++) {
      if (used.has(zones[i]!.id)) continue;

      const zone1 = zones[i]!;
      const overlapping: MTFZone[] = [zone1];
      used.add(zone1.id);

      // Find overlapping zones of same type
      for (let j = i + 1; j < zones.length; j++) {
        if (used.has(zones[j]!.id)) continue;

        const zone2 = zones[j]!;
        if (zone2.type !== zone1.type) continue;

        // Check overlap
        const overlapPct = this.calculateOverlap(zone1, zone2);
        if (overlapPct >= this.options.confluenceOverlapPct) {
          overlapping.push(zone2);
          used.add(zone2.id);
        }
      }

      // Only create confluence if multiple TFs involved
      const uniqueTFs = new Set(overlapping.map((z) => z.tfLabel));
      if (uniqueTFs.size >= 2) {
        const prices = overlapping.flatMap((z) => [z.priceHigh, z.priceLow]);
        confluences.push({
          priceHigh: Math.max(...prices),
          priceLow: Math.min(...prices),
          type: zone1.type,
          timeframes: Array.from(uniqueTFs),
          combinedStrength: overlapping.reduce(
            (sum, z) => sum + z.strength * z.tfWeight,
            0
          ),
        });
      }
    }

    return confluences.sort((a, b) => b.combinedStrength - a.combinedStrength);
  }

  /**
   * Calculate overlap percentage between two zones
   */
  private calculateOverlap(zone1: SRZone, zone2: SRZone): number {
    const overlapHigh = Math.min(zone1.priceHigh, zone2.priceHigh);
    const overlapLow = Math.max(zone1.priceLow, zone2.priceLow);

    if (overlapHigh <= overlapLow) return 0;

    const overlapSize = overlapHigh - overlapLow;
    const smallerZoneSize = Math.min(
      zone1.priceHigh - zone1.priceLow,
      zone2.priceHigh - zone2.priceLow
    );

    return (overlapSize / smallerZoneSize) * 100;
  }

  /**
   * Get key levels from higher timeframes
   */
  private getHTFKeyLevels(
    tf5m: MarketStructure,
    tf15m: MarketStructure
  ): { resistance: number[]; support: number[] } {
    const resistance: number[] = [];
    const support: number[] = [];

    // 15m levels are most important
    for (const zone of tf15m.zones.filter((z) => !z.broken)) {
      const midPrice = (zone.priceHigh + zone.priceLow) / 2;
      if (zone.type === 'resistance') {
        resistance.push(midPrice);
      } else {
        support.push(midPrice);
      }
    }

    // Add strong 5m levels
    for (const zone of tf5m.zones.filter((z) => !z.broken && z.touchCount >= 2)) {
      const midPrice = (zone.priceHigh + zone.priceLow) / 2;
      if (zone.type === 'resistance') {
        resistance.push(midPrice);
      } else {
        support.push(midPrice);
      }
    }

    // Sort and deduplicate
    return {
      resistance: [...new Set(resistance)].sort((a, b) => a - b),
      support: [...new Set(support)].sort((a, b) => b - a),
    };
  }

  /**
   * Determine overall bias from HTF
   */
  private determineHTFBias(
    tf5m: MarketStructure,
    tf15m: MarketStructure
  ): 'bullish' | 'bearish' | 'neutral' {
    let score = 0;

    // 15m trend has more weight
    if (tf15m.trend === 'up') score += 2;
    else if (tf15m.trend === 'down') score -= 2;

    // 5m trend
    if (tf5m.trend === 'up') score += 1;
    else if (tf5m.trend === 'down') score -= 1;

    // 15m phase
    if (tf15m.currentPhase === 'markup' || tf15m.currentPhase === 'accumulation') {
      score += 1;
    } else if (tf15m.currentPhase === 'markdown' || tf15m.currentPhase === 'distribution') {
      score -= 1;
    }

    if (score >= 2) return 'bullish';
    if (score <= -2) return 'bearish';
    return 'neutral';
  }
}

/**
 * Quick helper function
 */
export function analyzeMTFStructure(
  candles1m: Candle[],
  asset: string,
  options?: MTFAnalysisOptions
): MTFMarketStructure {
  const analyzer = new MTFMarketStructureAnalyzer(options);
  return analyzer.analyze(candles1m, asset);
}
