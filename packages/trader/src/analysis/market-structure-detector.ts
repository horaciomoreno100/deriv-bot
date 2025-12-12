/**
 * Market Structure Detector
 *
 * Detects key market structure elements:
 * - Swing highs and lows
 * - Support and resistance zones
 * - Trend lines
 * - Market phases
 *
 * Usage:
 *   const detector = new MarketStructureDetector(options);
 *   const structure = detector.analyze(candles);
 */

import type { Candle } from '@deriv-bot/shared';
import {
  type SwingPoint,
  type SRZone,
  type TrendLine,
  type MarketPhase,
  type MarketPhasePeriod,
  type MarketStructure,
  type MarketStructureOptions,
  DEFAULT_MARKET_STRUCTURE_OPTIONS,
} from '@deriv-bot/shared';

/**
 * Market Structure Detector
 */
export class MarketStructureDetector {
  private options: Required<MarketStructureOptions>;

  constructor(options: MarketStructureOptions = {}) {
    this.options = { ...DEFAULT_MARKET_STRUCTURE_OPTIONS, ...options };
  }

  /**
   * Analyze candles and detect market structure
   */
  analyze(candles: Candle[], asset: string, timeframe: number): MarketStructure {
    // Use only the lookback period
    const lookback = Math.min(this.options.lookbackPeriod, candles.length);
    const recentCandles = candles.slice(-lookback);

    // Detect swing points
    const swingPoints = this.detectSwingPoints(recentCandles);

    // Detect S/R zones from swing points
    const zones = this.detectZones(recentCandles, swingPoints, timeframe);

    // Detect trend lines
    const trendLines = this.detectTrendLines(recentCandles, swingPoints, timeframe);

    // Detect market phases
    const phases = this.options.detectPhases
      ? this.detectPhases(recentCandles, swingPoints)
      : [];

    // Determine current phase and trend
    const currentPhase = this.getCurrentPhase(recentCandles, swingPoints);
    const { trend, strength } = this.analyzeTrend(swingPoints, recentCandles);

    // Calculate key levels
    const currentPrice = recentCandles[recentCandles.length - 1]?.close ?? 0;
    const keyLevels = this.calculateKeyLevels(zones, currentPrice);

    return {
      asset,
      timeframe,
      swingPoints,
      zones,
      trendLines,
      phases,
      currentPhase,
      trend,
      trendStrength: strength,
      keyLevels,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Detect swing points (local highs and lows)
   */
  private detectSwingPoints(candles: Candle[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const depth = this.options.swingDepth;

    for (let i = depth; i < candles.length - depth; i++) {
      const candle = candles[i]!;
      let isHigh = true;
      let isLow = true;
      let strength = 0;

      // Check if it's a swing point
      for (let j = 1; j <= depth; j++) {
        const left = candles[i - j]!;
        const right = candles[i + j]!;

        if (candle.high <= left.high || candle.high <= right.high) isHigh = false;
        if (candle.low >= left.low || candle.low >= right.low) isLow = false;

        // Count how many candles confirm this swing
        if (isHigh && candle.high > left.high && candle.high > right.high) strength++;
        if (isLow && candle.low < left.low && candle.low < right.low) strength++;
      }

      if (isHigh) {
        swings.push({
          index: i,
          timestamp: candle.timestamp,
          price: candle.high,
          type: 'high',
          strength: Math.min(5, Math.max(1, strength)),
          broken: false,
        });
      } else if (isLow) {
        swings.push({
          index: i,
          timestamp: candle.timestamp,
          price: candle.low,
          type: 'low',
          strength: Math.min(5, Math.max(1, strength)),
          broken: false,
        });
      }
    }

    // Filter consecutive same-type swings, keeping strongest
    const filtered = this.filterConsecutiveSwings(swings);

    // Mark broken swings
    this.markBrokenSwings(filtered, candles);

    return filtered;
  }

  /**
   * Filter consecutive same-type swings
   */
  private filterConsecutiveSwings(swings: SwingPoint[]): SwingPoint[] {
    const filtered: SwingPoint[] = [];

    for (const swing of swings) {
      const last = filtered[filtered.length - 1];

      if (!last || last.type !== swing.type) {
        filtered.push(swing);
      } else if (swing.type === 'high' && swing.price > last.price) {
        filtered[filtered.length - 1] = swing;
      } else if (swing.type === 'low' && swing.price < last.price) {
        filtered[filtered.length - 1] = swing;
      }
    }

    return filtered;
  }

  /**
   * Mark swings that have been broken by subsequent price action
   */
  private markBrokenSwings(swings: SwingPoint[], candles: Candle[]): void {
    for (const swing of swings) {
      const subsequentCandles = candles.slice(swing.index + 1);

      for (const candle of subsequentCandles) {
        if (swing.type === 'high' && candle.close > swing.price) {
          swing.broken = true;
          swing.brokenAt = candle.timestamp;
          break;
        }
        if (swing.type === 'low' && candle.close < swing.price) {
          swing.broken = true;
          swing.brokenAt = candle.timestamp;
          break;
        }
      }
    }
  }

  /**
   * Detect support and resistance zones from swing points
   */
  private detectZones(
    candles: Candle[],
    swingPoints: SwingPoint[],
    timeframe: number
  ): SRZone[] {
    const zones: SRZone[] = [];
    const avgPrice = candles.reduce((s, c) => s + c.close, 0) / candles.length;

    // Calculate ATR for adaptive zone width
    const atrs = this.calculateATR(candles, 14);
    const avgATR = atrs.length > 0 ? atrs.reduce((s, v) => s + v, 0) / atrs.length : avgPrice * 0.001;

    // Zone width based on ATR - thin horizontal bands
    const zoneWidth = avgATR * 0.5; // Half ATR width
    const maxClusterDistance = avgATR * 1.5; // Max distance to cluster swings

    // Include ALL swings (not just unbroken) - broken zones are still important
    const highs = swingPoints.filter((s) => s.type === 'high');
    const lows = swingPoints.filter((s) => s.type === 'low');

    // Create resistance zones from highs
    const resistanceZones = this.clusterSwingsIntoZones(
      highs,
      'resistance',
      zoneWidth,
      maxClusterDistance,
      timeframe,
      candles
    );

    // Create support zones from lows
    const supportZones = this.clusterSwingsIntoZones(
      lows,
      'support',
      zoneWidth,
      maxClusterDistance,
      timeframe,
      candles
    );

    zones.push(...resistanceZones, ...supportZones);

    // Count additional touches
    this.countZoneTouches(zones, candles);

    // Filter zones with enough touches
    return zones.filter((z) => z.touchCount >= this.options.minZoneTouches);
  }

  /**
   * Cluster nearby swing points into zones
   * @param zoneWidth - The vertical thickness of each zone
   * @param maxClusterDistance - Maximum price distance to group swings together
   */
  private clusterSwingsIntoZones(
    swings: SwingPoint[],
    type: 'support' | 'resistance',
    zoneWidth: number,
    maxClusterDistance: number,
    timeframe: number,
    candles: Candle[]
  ): SRZone[] {
    const zones: SRZone[] = [];
    const used = new Set<number>();
    const lastCandle = candles[candles.length - 1];

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const swing = swings[i]!;
      const cluster = [swing];
      used.add(i);

      // Find nearby swings within cluster distance
      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;

        const other = swings[j]!;
        const distance = Math.abs(swing.price - other.price);

        if (distance <= maxClusterDistance) {
          cluster.push(other);
          used.add(j);
        }
      }

      if (cluster.length >= 1) {
        const prices = cluster.map((s) => s.price);
        const timestamps = cluster.map((s) => s.timestamp);

        // Calculate zone center from clustered prices
        const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;

        // Create thin horizontal band around the average price
        const priceHigh = avgPrice + zoneWidth / 2;
        const priceLow = avgPrice - zoneWidth / 2;

        zones.push({
          id: `${type}-${zones.length + 1}`,
          type,
          priceHigh,
          priceLow,
          startTime: Math.min(...timestamps),
          endTime: lastCandle?.timestamp ?? null,
          touchCount: cluster.length,
          touches: timestamps,
          strength: Math.min(5, cluster.length),
          broken: false,
          timeframe,
          color: type === 'resistance' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)',
          opacity: 0.4,
        });
      }
    }

    return zones;
  }

  /**
   * Count how many times price has touched each zone
   */
  private countZoneTouches(zones: SRZone[], candles: Candle[]): void {
    const tolerancePct = this.options.touchTolerancePct / 100;

    for (const zone of zones) {
      const zoneWidth = zone.priceHigh - zone.priceLow;
      const tolerance = zoneWidth * tolerancePct;

      for (const candle of candles) {
        // Skip candles before zone was established
        if (candle.timestamp < zone.startTime) continue;

        // Check if price touched the zone
        const touchedFromBelow =
          zone.type === 'resistance' &&
          candle.high >= zone.priceLow - tolerance &&
          candle.high <= zone.priceHigh + tolerance;

        const touchedFromAbove =
          zone.type === 'support' &&
          candle.low >= zone.priceLow - tolerance &&
          candle.low <= zone.priceHigh + tolerance;

        if (touchedFromBelow || touchedFromAbove) {
          // Only count if not already counted (minimum 5 candles apart)
          const lastTouch = zone.touches[zone.touches.length - 1];
          if (!lastTouch || candle.timestamp - lastTouch > 5 * 60) {
            zone.touches.push(candle.timestamp);
            zone.touchCount = zone.touches.length;
            zone.strength = Math.min(5, zone.touchCount);
          }
        }

        // Check if zone is broken
        if (!zone.broken) {
          if (zone.type === 'resistance' && candle.close > zone.priceHigh) {
            zone.broken = true;
            zone.brokenAt = candle.timestamp;
          } else if (zone.type === 'support' && candle.close < zone.priceLow) {
            zone.broken = true;
            zone.brokenAt = candle.timestamp;
          }
        }
      }
    }
  }

  /**
   * Detect trend lines from swing points
   */
  private detectTrendLines(
    candles: Candle[],
    swingPoints: SwingPoint[],
    timeframe: number
  ): TrendLine[] {
    const trendLines: TrendLine[] = [];

    // Get ascending trend lines from lows
    const lows = swingPoints.filter((s) => s.type === 'low');
    const ascendingLines = this.findTrendLinesFromSwings(
      lows,
      'ascending',
      candles,
      timeframe
    );

    // Get descending trend lines from highs
    const highs = swingPoints.filter((s) => s.type === 'high');
    const descendingLines = this.findTrendLinesFromSwings(
      highs,
      'descending',
      candles,
      timeframe
    );

    trendLines.push(...ascendingLines, ...descendingLines);

    return trendLines.filter((l) => l.touchCount >= this.options.minTrendLineTouches);
  }

  /**
   * Find trend lines connecting swing points
   */
  private findTrendLinesFromSwings(
    swings: SwingPoint[],
    type: 'ascending' | 'descending',
    candles: Candle[],
    timeframe: number
  ): TrendLine[] {
    const lines: TrendLine[] = [];

    for (let i = 0; i < swings.length - 1; i++) {
      const start = swings[i]!;

      for (let j = i + 1; j < swings.length; j++) {
        const end = swings[j]!;

        // Calculate slope
        const timeDiff = end.timestamp - start.timestamp;
        if (timeDiff <= 0) continue;

        const slope = (end.price - start.price) / timeDiff;

        // For ascending lines, slope should be positive
        // For descending lines, slope should be negative
        if (type === 'ascending' && slope <= 0) continue;
        if (type === 'descending' && slope >= 0) continue;

        // Count touches along this line
        const touches = this.countLineTouch(start, end, slope, candles);

        if (touches.length >= this.options.minTrendLineTouches) {
          // Check if line is broken
          const { broken, brokenAt } = this.checkLineBroken(
            start,
            slope,
            candles,
            type
          );

          lines.push({
            id: `${type}-${lines.length + 1}`,
            type,
            start: {
              timestamp: start.timestamp,
              price: start.price,
              index: start.index,
            },
            end: {
              timestamp: end.timestamp,
              price: end.price,
              index: end.index,
            },
            slope,
            touchCount: touches.length,
            touches,
            strength: Math.min(5, touches.length),
            broken,
            brokenAt,
            timeframe,
            color: type === 'ascending' ? '#22c55e' : '#ef4444',
            lineWidth: 2,
          });
        }
      }
    }

    // Return only the strongest non-overlapping lines
    return this.filterOverlappingLines(lines);
  }

  /**
   * Count touches along a trend line
   */
  private countLineTouch(
    start: SwingPoint,
    end: SwingPoint,
    slope: number,
    candles: Candle[]
  ): number[] {
    const touches: number[] = [];
    const avgPrice = (start.price + end.price) / 2;
    const tolerance = avgPrice * 0.002; // 0.2% tolerance

    for (const candle of candles) {
      if (candle.timestamp < start.timestamp) continue;
      if (candle.timestamp > end.timestamp) continue;

      // Calculate expected price at this point
      const timeDiff = candle.timestamp - start.timestamp;
      const expectedPrice = start.price + slope * timeDiff;

      // Check if candle touched the line
      const touchedHigh = Math.abs(candle.high - expectedPrice) <= tolerance;
      const touchedLow = Math.abs(candle.low - expectedPrice) <= tolerance;

      if (touchedHigh || touchedLow) {
        // Avoid counting consecutive touches
        const lastTouch = touches[touches.length - 1];
        if (!lastTouch || candle.timestamp - lastTouch > 60 * 3) {
          touches.push(candle.timestamp);
        }
      }
    }

    return touches;
  }

  /**
   * Check if a trend line has been broken
   */
  private checkLineBroken(
    start: SwingPoint,
    slope: number,
    candles: Candle[],
    type: 'ascending' | 'descending'
  ): { broken: boolean; brokenAt?: number } {
    for (const candle of candles) {
      if (candle.timestamp <= start.timestamp) continue;

      const timeDiff = candle.timestamp - start.timestamp;
      const expectedPrice = start.price + slope * timeDiff;

      // Ascending line (support) is broken when close goes below
      if (type === 'ascending' && candle.close < expectedPrice * 0.998) {
        return { broken: true, brokenAt: candle.timestamp };
      }

      // Descending line (resistance) is broken when close goes above
      if (type === 'descending' && candle.close > expectedPrice * 1.002) {
        return { broken: true, brokenAt: candle.timestamp };
      }
    }

    return { broken: false };
  }

  /**
   * Filter overlapping trend lines, keeping only the strongest
   * More aggressive filtering to reduce clutter
   */
  private filterOverlappingLines(lines: TrendLine[]): TrendLine[] {
    // Only keep lines with 3+ touches (more significant)
    const significant = lines.filter((l) => l.touchCount >= 3);

    // Sort by touch count (descending), then by whether broken (unbroken first)
    const sorted = [...significant].sort((a, b) => {
      // Prioritize unbroken lines
      if (a.broken !== b.broken) return a.broken ? 1 : -1;
      // Then by touch count
      return b.touchCount - a.touchCount;
    });

    const result: TrendLine[] = [];

    for (const line of sorted) {
      // Check if this line overlaps with any already selected
      // More aggressive overlap detection
      const overlaps = result.some((existing) => {
        const slopeDiff = Math.abs(line.slope - existing.slope);
        const priceDiff = Math.abs(line.start.price - existing.start.price);
        const avgPrice = (line.start.price + existing.start.price) / 2;

        // Increased tolerance to filter more aggressively
        return slopeDiff < 0.00005 && priceDiff / avgPrice < 0.02;
      });

      if (!overlaps) {
        result.push(line);
      }
    }

    // Keep only top 2 lines (1 ascending, 1 descending ideally)
    return result.slice(0, 2);
  }

  /**
   * Detect market phases
   */
  private detectPhases(
    candles: Candle[],
    _swings: SwingPoint[]
  ): MarketPhasePeriod[] {
    const phases: MarketPhasePeriod[] = [];
    const windowSize = 20;

    // Calculate ATR for volatility
    const atrs = this.calculateATR(candles, this.options.atrPeriod);

    for (let i = windowSize; i < candles.length; i += windowSize) {
      const windowCandles = candles.slice(i - windowSize, i);
      const windowATR = atrs.slice(i - windowSize, i);
      const avgATR = windowATR.reduce((s, v) => s + v, 0) / windowATR.length || 0;
      const avgPrice = windowCandles.reduce((s, c) => s + c.close, 0) / windowCandles.length;
      const volatility = avgATR / avgPrice;

      const priceHigh = Math.max(...windowCandles.map((c) => c.high));
      const priceLow = Math.min(...windowCandles.map((c) => c.low));
      const priceChange = (windowCandles[windowCandles.length - 1]!.close - windowCandles[0]!.open) / windowCandles[0]!.open;

      // Determine phase
      let phase: MarketPhase;
      let color: string;

      const isLowVolatility = volatility < 0.005;
      const isTrending = Math.abs(priceChange) > 0.02;

      if (isTrending && priceChange > 0) {
        phase = 'markup';
        color = 'rgba(34, 197, 94, 0.15)';
      } else if (isTrending && priceChange < 0) {
        phase = 'markdown';
        color = 'rgba(239, 68, 68, 0.15)';
      } else if (isLowVolatility && phases.length > 0) {
        const lastPhase = phases[phases.length - 1]?.phase;
        if (lastPhase === 'markup' || lastPhase === 'distribution') {
          phase = 'distribution';
          color = 'rgba(249, 115, 22, 0.15)';
        } else {
          phase = 'accumulation';
          color = 'rgba(59, 130, 246, 0.15)';
        }
      } else {
        phase = 'ranging';
        color = 'rgba(156, 163, 175, 0.15)';
      }

      phases.push({
        phase,
        startTime: windowCandles[0]!.timestamp,
        endTime: windowCandles[windowCandles.length - 1]!.timestamp,
        startIndex: i - windowSize,
        endIndex: i - 1,
        priceHigh,
        priceLow,
        avgVolatility: volatility,
        color,
      });
    }

    // Merge consecutive same phases
    return this.mergeConsecutivePhases(phases);
  }

  /**
   * Calculate ATR
   */
  private calculateATR(candles: Candle[], period: number): number[] {
    const trs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i]!;
      const prev = candles[i - 1]!;

      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );

      trs.push(tr);
    }

    // Calculate ATR using SMA
    const atrs: number[] = [trs[0] ?? 0];

    for (let i = 1; i < trs.length; i++) {
      if (i < period) {
        const avg = trs.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
        atrs.push(avg);
      } else {
        const avg = trs.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
        atrs.push(avg);
      }
    }

    return atrs;
  }

  /**
   * Merge consecutive same phases
   */
  private mergeConsecutivePhases(phases: MarketPhasePeriod[]): MarketPhasePeriod[] {
    if (phases.length === 0) return [];

    const merged: MarketPhasePeriod[] = [phases[0]!];

    for (let i = 1; i < phases.length; i++) {
      const curr = phases[i]!;
      const last = merged[merged.length - 1]!;

      if (curr.phase === last.phase) {
        // Merge
        last.endTime = curr.endTime;
        last.endIndex = curr.endIndex;
        last.priceHigh = Math.max(last.priceHigh, curr.priceHigh);
        last.priceLow = Math.min(last.priceLow, curr.priceLow);
        last.avgVolatility = (last.avgVolatility + curr.avgVolatility) / 2;
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }

  /**
   * Get current market phase
   */
  private getCurrentPhase(candles: Candle[], _swings: SwingPoint[]): MarketPhase {
    if (candles.length < 20) return 'ranging';

    const recent = candles.slice(-20);
    const atrs = this.calculateATR(candles, 14).slice(-20);
    const avgATR = atrs.reduce((s, v) => s + v, 0) / atrs.length;
    const avgPrice = recent.reduce((s, c) => s + c.close, 0) / recent.length;
    const volatility = avgATR / avgPrice;

    const priceChange = (recent[recent.length - 1]!.close - recent[0]!.open) / recent[0]!.open;

    if (Math.abs(priceChange) > 0.02 && priceChange > 0) return 'markup';
    if (Math.abs(priceChange) > 0.02 && priceChange < 0) return 'markdown';
    if (volatility < 0.003) return priceChange > 0 ? 'distribution' : 'accumulation';
    return 'ranging';
  }

  /**
   * Analyze overall trend from swing points
   */
  private analyzeTrend(
    swings: SwingPoint[],
    _candles: Candle[]
  ): { trend: 'up' | 'down' | 'sideways'; strength: number } {
    if (swings.length < 4) {
      return { trend: 'sideways', strength: 0 };
    }

    const recent = swings.slice(-6);
    const highs = recent.filter((s) => s.type === 'high');
    const lows = recent.filter((s) => s.type === 'low');

    if (highs.length < 2 || lows.length < 2) {
      return { trend: 'sideways', strength: 0 };
    }

    // Check for higher highs and higher lows (uptrend)
    // Or lower highs and lower lows (downtrend)
    let hhCount = 0;
    let hlCount = 0;
    let lhCount = 0;
    let llCount = 0;

    for (let i = 1; i < highs.length; i++) {
      if (highs[i]!.price > highs[i - 1]!.price) hhCount++;
      else lhCount++;
    }

    for (let i = 1; i < lows.length; i++) {
      if (lows[i]!.price > lows[i - 1]!.price) hlCount++;
      else llCount++;
    }

    const upScore = hhCount + hlCount;
    const downScore = lhCount + llCount;

    if (upScore > downScore + 1) {
      return { trend: 'up', strength: Math.min(100, upScore * 25) };
    } else if (downScore > upScore + 1) {
      return { trend: 'down', strength: Math.min(100, downScore * 25) };
    } else {
      return { trend: 'sideways', strength: 0 };
    }
  }

  /**
   * Calculate key levels from zones
   */
  private calculateKeyLevels(
    zones: SRZone[],
    currentPrice: number
  ): MarketStructure['keyLevels'] {
    const activeZones = zones.filter((z) => !z.broken);

    const resistances = activeZones
      .filter((z) => z.type === 'resistance')
      .map((z) => (z.priceHigh + z.priceLow) / 2)
      .filter((p) => p > currentPrice)
      .sort((a, b) => a - b);

    const supports = activeZones
      .filter((z) => z.type === 'support')
      .map((z) => (z.priceHigh + z.priceLow) / 2)
      .filter((p) => p < currentPrice)
      .sort((a, b) => b - a);

    return {
      nearestResistance: resistances[0] ?? null,
      nearestSupport: supports[0] ?? null,
      majorResistance: resistances.slice(0, 3),
      majorSupport: supports.slice(0, 3),
    };
  }
}

/**
 * Factory function for quick analysis
 */
export function analyzeMarketStructure(
  candles: Candle[],
  asset: string,
  timeframe: number,
  options?: MarketStructureOptions
): MarketStructure {
  const detector = new MarketStructureDetector(options);
  return detector.analyze(candles, asset, timeframe);
}
