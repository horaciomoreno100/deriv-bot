/**
 * Market Structure Chart Generator
 *
 * Generates interactive Plotly charts with:
 * - Support/Resistance zones as rectangles
 * - Trend lines
 * - Swing point markers
 * - Market phase backgrounds
 *
 * Usage:
 *   const chart = generateMarketStructureChart(candles, structure, options);
 *   fs.writeFileSync('chart.html', chart);
 */

import type { Candle } from '@deriv-bot/shared';
import type {
  MarketStructure,
  SRZone,
  TrendLine,
  SwingPoint,
  MarketPhasePeriod,
} from '@deriv-bot/shared';
import type { MTFZone, MTFMarketStructure } from './mtf-market-structure.js';
import type { OrderBlock } from './order-block-detector.js';
import type { LiquiditySweep } from './liquidity-sweep-detector.js';
import type { FairValueGap } from './fvg-detector.js';
import type { SMCOpportunity } from './smc-opportunity-detector.js';

/**
 * Chart generation options
 */
export interface MarketStructureChartOptions {
  /** Chart title */
  title?: string;

  /** Width in pixels */
  width?: number;

  /** Height in pixels */
  height?: number;

  /** Theme */
  theme?: 'dark' | 'light';

  /** Show S/R zones */
  showZones?: boolean;

  /** Show trend lines */
  showTrendLines?: boolean;

  /** Show swing points */
  showSwings?: boolean;

  /** Show market phases as background */
  showPhases?: boolean;

  /** Show only unbroken zones/lines */
  hidebroken?: boolean;

  /** Zone opacity (0-1) */
  zoneOpacity?: number;

  /** Phase background opacity (0-1) */
  phaseOpacity?: number;

  /** Show order blocks */
  showOrderBlocks?: boolean;

  /** Order blocks to display */
  orderBlocks?: OrderBlock[];

  /** Show volume bars */
  showVolume?: boolean;

  /** Show liquidity sweeps */
  showLiquiditySweeps?: boolean;

  /** Liquidity sweeps to display */
  liquiditySweeps?: LiquiditySweep[];

  /** Show fair value gaps */
  showFVGs?: boolean;

  /** Fair value gaps to display */
  fvgs?: FairValueGap[];

  /** Show SMC opportunities */
  showOpportunities?: boolean;

  /** SMC opportunities to display */
  opportunities?: SMCOpportunity[];
}

const DEFAULT_OPTIONS: Required<MarketStructureChartOptions> = {
  title: 'Market Structure Analysis',
  width: 1600,
  height: 900,
  theme: 'dark',
  showZones: true,
  showTrendLines: true,
  showSwings: true,
  showPhases: true,
  hidebroken: false,
  zoneOpacity: 0.35,
  phaseOpacity: 0.1,
  showOrderBlocks: true,
  orderBlocks: [],
  showVolume: true,
  showLiquiditySweeps: true,
  liquiditySweeps: [],
  showFVGs: true,
  fvgs: [],
  showOpportunities: true,
  opportunities: [],
};

/**
 * Color schemes
 */
const COLORS = {
  dark: {
    background: '#0e0e0e',
    paper: '#1a1a1a',
    text: '#e0e0e0',
    grid: '#2a2a2a',
    candleUp: '#22c55e',
    candleDown: '#ef4444',
    resistanceZone: 'rgba(239, 68, 68, 0.45)',
    supportZone: 'rgba(34, 197, 94, 0.45)',
    resistanceLine: '#ef4444',
    supportLine: '#22c55e',
    ascendingTrend: '#22c55e',
    descendingTrend: '#ef4444',
    swingHigh: '#f59e0b',
    swingLow: '#3b82f6',
    phaseMarkup: 'rgba(34, 197, 94, 0.08)',
    phaseMarkdown: 'rgba(239, 68, 68, 0.08)',
    phaseAccumulation: 'rgba(59, 130, 246, 0.08)',
    phaseDistribution: 'rgba(249, 115, 22, 0.08)',
    phaseRanging: 'rgba(156, 163, 175, 0.05)',
    // Order Block colors (distinct from S/R zones)
    bullishOB: 'rgba(14, 165, 233, 0.35)', // sky blue fill
    bullishOBBorder: '#0ea5e9',
    bearishOB: 'rgba(236, 72, 153, 0.35)', // pink fill
    bearishOBBorder: '#ec4899',
    // Volume colors
    volumeUp: 'rgba(34, 197, 94, 0.5)',
    volumeDown: 'rgba(239, 68, 68, 0.5)',
    // FVG colors
    bullishFVG: 'rgba(134, 239, 172, 0.25)', // light green
    bullishFVGBorder: '#86efac',
    bearishFVG: 'rgba(252, 165, 165, 0.25)', // light red
    bearishFVGBorder: '#fca5a5',
    // Liquidity Sweep colors
    buysideSweep: '#f59e0b', // amber
    sellsideSweep: '#8b5cf6', // violet
    // SMC Opportunity colors
    opportunityLong: '#10b981', // emerald
    opportunityShort: '#f43f5e', // rose
    opportunityEntry: '#fbbf24', // amber
    opportunityAPlusBg: 'rgba(16, 185, 129, 0.15)',
    opportunityABg: 'rgba(59, 130, 246, 0.12)',
    opportunityBBg: 'rgba(156, 163, 175, 0.08)',
  },
  light: {
    background: '#ffffff',
    paper: '#f9fafb',
    text: '#1f2937',
    grid: '#e5e7eb',
    candleUp: '#16a34a',
    candleDown: '#dc2626',
    resistanceZone: 'rgba(220, 38, 38, 0.35)',
    supportZone: 'rgba(22, 163, 74, 0.35)',
    resistanceLine: '#dc2626',
    supportLine: '#16a34a',
    ascendingTrend: '#16a34a',
    descendingTrend: '#dc2626',
    swingHigh: '#d97706',
    swingLow: '#2563eb',
    phaseMarkup: 'rgba(22, 163, 74, 0.1)',
    phaseMarkdown: 'rgba(220, 38, 38, 0.1)',
    phaseAccumulation: 'rgba(37, 99, 235, 0.1)',
    phaseDistribution: 'rgba(234, 88, 12, 0.1)',
    phaseRanging: 'rgba(107, 114, 128, 0.05)',
    // Order Block colors
    bullishOB: 'rgba(14, 165, 233, 0.3)',
    bullishOBBorder: '#0284c7',
    bearishOB: 'rgba(219, 39, 119, 0.3)',
    bearishOBBorder: '#db2777',
    // Volume colors
    volumeUp: 'rgba(22, 163, 74, 0.5)',
    volumeDown: 'rgba(220, 38, 38, 0.5)',
    // FVG colors
    bullishFVG: 'rgba(74, 222, 128, 0.2)',
    bullishFVGBorder: '#4ade80',
    bearishFVG: 'rgba(248, 113, 113, 0.2)',
    bearishFVGBorder: '#f87171',
    // Liquidity Sweep colors
    buysideSweep: '#d97706',
    sellsideSweep: '#7c3aed',
    // SMC Opportunity colors
    opportunityLong: '#059669',
    opportunityShort: '#e11d48',
    opportunityEntry: '#d97706',
    opportunityAPlusBg: 'rgba(5, 150, 105, 0.12)',
    opportunityABg: 'rgba(37, 99, 235, 0.1)',
    opportunityBBg: 'rgba(107, 114, 128, 0.06)',
  },
};

/**
 * Convert timestamp to ISO string for Plotly
 */
function toISOString(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Generate shapes for S/R zones
 * Returns both shapes and annotations (for labels)
 */
function generateZoneShapes(
  zones: SRZone[],
  colors: typeof COLORS.dark,
  options: Required<MarketStructureChartOptions>
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  for (const zone of zones) {
    if (options.hidebroken && zone.broken) continue;

    const fillColor = zone.type === 'resistance'
      ? colors.resistanceZone
      : colors.supportZone;

    const borderColor = zone.type === 'resistance'
      ? colors.resistanceLine
      : colors.supportLine;

    const x0 = toISOString(zone.startTime);
    const x1 = zone.endTime ? toISOString(zone.endTime) : toISOString(Date.now() / 1000);

    // Calculate opacity based on zone strength (more touches = more important)
    // Base opacity + bonus for strong zones (many touches)
    const strengthBonus = Math.min(zone.touchCount, 10) * 0.03; // Up to 0.3 extra
    const baseOpacity = zone.broken ? 0.15 : options.zoneOpacity;
    const finalOpacity = Math.min(baseOpacity + strengthBonus, 0.7);

    // Rectangle shape - Plotly requires xref/yref to be set
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: x0,
      x1: x1,
      y0: zone.priceLow,
      y1: zone.priceHigh,
      fillcolor: fillColor,
      opacity: finalOpacity,
      line: {
        color: borderColor,
        width: zone.broken ? 1 : Math.min(2 + zone.touchCount * 0.3, 4),
        dash: zone.broken ? 'dot' : 'solid',
      },
    });

    // Label as annotation (Plotly shapes don't support labels directly)
    annotations.push({
      x: x0,
      y: zone.priceHigh,
      xref: 'x',
      yref: 'y',
      text: `${zone.type.toUpperCase()} (${zone.touchCount}x)`,
      showarrow: false,
      font: {
        size: 10,
        color: zone.type === 'resistance' ? colors.resistanceLine : colors.supportLine,
      },
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: colors.paper,
      borderpad: 2,
    });
  }

  return { shapes, annotations };
}

/**
 * Generate shapes for MTF zones with differentiated styles
 * HTF zones are thicker and more prominent
 */
function generateMTFZoneShapes(
  zones: MTFZone[],
  colors: typeof COLORS.dark,
  options: Required<MarketStructureChartOptions>
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  // Style config by timeframe
  const tfStyles: Record<string, { lineWidth: number; opacity: number; fontSize: number }> = {
    '1M': { lineWidth: 1.5, opacity: 0.25, fontSize: 9 },
    '5M': { lineWidth: 2.5, opacity: 0.35, fontSize: 10 },
    '15M': { lineWidth: 4, opacity: 0.45, fontSize: 11 },
  };

  // Different colors for HTF zones (purple/gold tones to differentiate)
  const htfColors: Record<string, { resistance: string; support: string }> = {
    '1M': {
      resistance: colors.resistanceZone,
      support: colors.supportZone,
    },
    '5M': {
      resistance: 'rgba(168, 85, 247, 0.4)', // purple
      support: 'rgba(34, 211, 238, 0.4)', // cyan
    },
    '15M': {
      resistance: 'rgba(251, 191, 36, 0.5)', // amber/gold
      support: 'rgba(52, 211, 153, 0.5)', // emerald
    },
  };

  const htfBorderColors: Record<string, { resistance: string; support: string }> = {
    '1M': {
      resistance: colors.resistanceLine,
      support: colors.supportLine,
    },
    '5M': {
      resistance: '#a855f7', // purple
      support: '#22d3ee', // cyan
    },
    '15M': {
      resistance: '#fbbf24', // amber
      support: '#34d399', // emerald
    },
  };

  for (const zone of zones) {
    if (options.hidebroken && zone.broken) continue;

    const style = tfStyles[zone.tfLabel] ?? tfStyles['1M']!;
    const zoneColors = htfColors[zone.tfLabel] ?? htfColors['1M']!;
    const borderColors = htfBorderColors[zone.tfLabel] ?? htfBorderColors['1M']!;

    const fillColor = zone.type === 'resistance' ? zoneColors.resistance : zoneColors.support;
    const borderColor = zone.type === 'resistance' ? borderColors.resistance : borderColors.support;

    const x0 = toISOString(zone.startTime);
    const x1 = zone.endTime ? toISOString(zone.endTime) : toISOString(Date.now() / 1000);

    // Opacity increases with TF weight
    const baseOpacity = zone.broken ? 0.1 : style.opacity;
    const strengthBonus = Math.min(zone.touchCount, 5) * 0.02;
    const finalOpacity = Math.min(baseOpacity + strengthBonus, 0.6);

    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: x0,
      x1: x1,
      y0: zone.priceLow,
      y1: zone.priceHigh,
      fillcolor: fillColor,
      opacity: finalOpacity,
      line: {
        color: borderColor,
        width: zone.broken ? 1 : style.lineWidth,
        dash: zone.broken ? 'dot' : 'solid',
      },
    });

    // Label with TF prefix
    annotations.push({
      x: x0,
      y: zone.priceHigh,
      xref: 'x',
      yref: 'y',
      text: `<b>[${zone.tfLabel}]</b> ${zone.type.toUpperCase()} (${zone.touchCount}x)`,
      showarrow: false,
      font: {
        size: style.fontSize,
        color: borderColor,
      },
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: colors.paper,
      bordercolor: borderColor,
      borderwidth: zone.tfLabel === '15M' ? 1 : 0,
      borderpad: 2,
    });
  }

  return { shapes, annotations };
}

/**
 * Generate shapes and annotations for Order Blocks
 * Uses distinct colors (blue/pink) to differentiate from S/R zones
 */
function generateOrderBlockShapes(
  orderBlocks: OrderBlock[],
  candles: Candle[],
  colors: typeof COLORS.dark,
  options: Required<MarketStructureChartOptions>
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) return { shapes, annotations };

  // Only show active (unmitigated) order blocks by default
  const activeOBs = options.hidebroken
    ? orderBlocks.filter((ob) => !ob.mitigated)
    : orderBlocks;

  // Limit to most recent/strongest order blocks to reduce clutter
  const sortedOBs = [...activeOBs]
    .sort((a, b) => b.strength - a.strength || b.timestamp - a.timestamp)
    .slice(0, 8); // Max 8 OBs shown

  for (const ob of sortedOBs) {
    const isBullish = ob.type === 'bullish';
    const fillColor = isBullish ? colors.bullishOB : colors.bearishOB;
    const borderColor = isBullish ? colors.bullishOBBorder : colors.bearishOBBorder;

    const x0 = toISOString(ob.timestamp);
    // Extend OB to current time (or until mitigated)
    const x1 = ob.mitigatedAt
      ? toISOString(ob.mitigatedAt)
      : toISOString(lastCandle.timestamp);

    // Opacity based on strength and mitigation status
    const baseOpacity = ob.mitigated ? 0.15 : 0.4;
    const strengthBonus = ob.strength * 0.05;
    const finalOpacity = Math.min(baseOpacity + strengthBonus, 0.6);

    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: x0,
      x1: x1,
      y0: ob.priceLow,
      y1: ob.priceHigh,
      fillcolor: fillColor,
      opacity: finalOpacity,
      line: {
        color: borderColor,
        width: ob.mitigated ? 1 : 2,
        dash: ob.mitigated ? 'dot' : 'solid',
      },
    });

    // Label with OB type and strength
    const strengthStars = '★'.repeat(Math.min(ob.strength, 5));
    annotations.push({
      x: x0,
      y: isBullish ? ob.priceLow : ob.priceHigh,
      xref: 'x',
      yref: 'y',
      text: `<b>OB ${isBullish ? '🔵' : '🔴'}</b> ${strengthStars}`,
      showarrow: false,
      font: {
        size: 9,
        color: borderColor,
      },
      xanchor: 'left',
      yanchor: isBullish ? 'top' : 'bottom',
      bgcolor: colors.paper,
      bordercolor: borderColor,
      borderwidth: 1,
      borderpad: 2,
    });
  }

  return { shapes, annotations };
}

/**
 * Generate shapes for Fair Value Gaps
 * Shows unfilled gaps as horizontal rectangles with dashed borders
 */
function generateFVGShapes(
  fvgs: FairValueGap[],
  candles: Candle[],
  colors: typeof COLORS.dark,
  _options: Required<MarketStructureChartOptions>
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) return { shapes, annotations };

  // Only show unfilled FVGs to reduce clutter
  const unfilledFVGs = fvgs.filter((f) => !f.filled);

  // Limit to most recent/strongest
  const sortedFVGs = [...unfilledFVGs]
    .sort((a, b) => b.strength - a.strength || b.timestamp - a.timestamp)
    .slice(0, 6); // Max 6 FVGs shown

  for (const fvg of sortedFVGs) {
    const isBullish = fvg.type === 'bullish';
    const fillColor = isBullish ? colors.bullishFVG : colors.bearishFVG;
    const borderColor = isBullish ? colors.bullishFVGBorder : colors.bearishFVGBorder;

    const x0 = toISOString(fvg.timestamp);
    const x1 = toISOString(lastCandle.timestamp);

    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: x0,
      x1: x1,
      y0: fvg.low,
      y1: fvg.high,
      fillcolor: fillColor,
      opacity: 0.5,
      line: {
        color: borderColor,
        width: 1,
        dash: 'dash',
      },
    });

    // Small label
    const strengthStars = '★'.repeat(Math.min(fvg.strength, 3));
    annotations.push({
      x: x0,
      y: fvg.midpoint,
      xref: 'x',
      yref: 'y',
      text: `FVG ${strengthStars}`,
      showarrow: false,
      font: {
        size: 8,
        color: borderColor,
      },
      xanchor: 'left',
      yanchor: 'middle',
      bgcolor: colors.paper,
      borderpad: 1,
    });
  }

  return { shapes, annotations };
}

/**
 * Generate markers for Liquidity Sweeps
 * Shows sweeps as arrow annotations pointing at the swept level
 */
function generateLiquiditySweepShapes(
  sweeps: LiquiditySweep[],
  candles: Candle[],
  colors: typeof COLORS.dark
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  // Limit to most recent/strongest sweeps
  const sortedSweeps = [...sweeps]
    .sort((a, b) => b.strength - a.strength || b.timestamp - a.timestamp)
    .slice(0, 8);

  for (const sweep of sortedSweeps) {
    const isBuyside = sweep.type === 'buyside';
    const color = isBuyside ? colors.buysideSweep : colors.sellsideSweep;
    const emoji = isBuyside ? '🔺' : '🔻';
    const label = isBuyside ? 'BSL' : 'SSL'; // Buy-Side Liquidity / Sell-Side Liquidity

    const x = toISOString(sweep.timestamp);

    // Line showing the swept level
    const candle = candles[sweep.index];
    if (!candle) continue;

    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: x,
      x1: x,
      y0: sweep.sweptLevel,
      y1: sweep.sweepExtreme,
      line: {
        color: color,
        width: 2,
        dash: 'dot',
      },
    });

    // Arrow annotation pointing at the sweep
    annotations.push({
      x: x,
      y: sweep.sweepExtreme,
      xref: 'x',
      yref: 'y',
      text: `${emoji} ${label}`,
      showarrow: true,
      arrowhead: 2,
      arrowsize: 1,
      arrowwidth: 2,
      arrowcolor: color,
      ax: isBuyside ? 30 : 30,
      ay: isBuyside ? -25 : 25,
      font: {
        size: 9,
        color: color,
        family: 'Arial Black',
      },
      bgcolor: colors.paper,
      bordercolor: color,
      borderwidth: 1,
      borderpad: 2,
    });
  }

  return { shapes, annotations };
}

/**
 * Generate shapes and annotations for SMC Opportunities
 * Shows entry zones, SL/TP levels, origin connection, and quality indicators
 * Only displays A+ and A quality signals for clean visualization
 */
function generateSMCOpportunityShapes(
  opportunities: SMCOpportunity[],
  candles: Candle[],
  colors: typeof COLORS.dark
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) return { shapes, annotations };

  // Only show A+ and A quality signals (filter out B and C)
  const highQualityOpps = opportunities.filter(
    (o) => o.quality === 'A+' || o.quality === 'A'
  );

  // Sort by quality and limit to top 3 setups
  const sortedOpps = [...highQualityOpps]
    .sort((a, b) => {
      const qualityOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3 };
      return (qualityOrder[a.quality] ?? 4) - (qualityOrder[b.quality] ?? 4);
    })
    .slice(0, 3); // Show max 3 high quality opportunities

  for (const opp of sortedOpps) {
    const isLong = opp.direction === 'long';
    const dirColor = isLong ? colors.opportunityLong : colors.opportunityShort;

    // Background color based on quality
    const bgColor = opp.quality === 'A+' ? colors.opportunityAPlusBg : colors.opportunityABg;

    // Get origin candle timestamp
    const originCandle = candles[opp.originIndex];
    const originX = originCandle
      ? toISOString(originCandle.timestamp)
      : toISOString(candles[0]!.timestamp);
    const x1 = toISOString(lastCandle.timestamp);

    // 1. ORIGIN MARKER - Circle at the origin point
    annotations.push({
      x: originX,
      y: opp.originPrice,
      xref: 'x',
      yref: 'y',
      text: opp.quality === 'A+' ? '🌟' : '⭐',
      showarrow: false,
      font: { size: 16 },
    });

    // 2. CONNECTION LINE - From origin to entry zone
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: originX,
      x1: x1,
      y0: opp.originPrice,
      y1: opp.idealEntry,
      line: {
        color: dirColor,
        width: 2,
        dash: 'dot',
      },
    });

    // 3. ENTRY ZONE rectangle (smaller, at the end)
    const entryZoneStart = candles[Math.max(0, candles.length - 20)];
    const entryX0 = entryZoneStart
      ? toISOString(entryZoneStart.timestamp)
      : originX;

    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: entryX0,
      x1: x1,
      y0: opp.entryZoneLow,
      y1: opp.entryZoneHigh,
      fillcolor: bgColor,
      opacity: 0.9,
      line: {
        color: dirColor,
        width: 3,
        dash: 'solid',
      },
    });

    // 4. IDEAL ENTRY line (bright yellow)
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: entryX0,
      x1: x1,
      y0: opp.idealEntry,
      y1: opp.idealEntry,
      line: {
        color: '#fbbf24', // amber
        width: 3,
        dash: 'solid',
      },
    });

    // 5. STOP LOSS line
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: entryX0,
      x1: x1,
      y0: opp.structuralSL,
      y1: opp.structuralSL,
      line: {
        color: '#ef4444', // red
        width: 2,
        dash: 'dash',
      },
    });

    // 6. TP1 line
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: entryX0,
      x1: x1,
      y0: opp.structuralTP1,
      y1: opp.structuralTP1,
      line: {
        color: '#22c55e', // green
        width: 2,
        dash: 'dash',
      },
    });

    // 7. SETUP LABEL at entry zone
    const dirEmoji = isLong ? '📈' : '📉';
    const setupLabel = opp.setupType.replace(/_/g, ' ').toUpperCase();
    const qualityLabel = opp.quality === 'A+' ? '🌟 A+' : '⭐ A';

    annotations.push({
      x: x1,
      y: opp.idealEntry,
      xref: 'x',
      yref: 'y',
      text: `${qualityLabel} ${dirEmoji} ${setupLabel}`,
      showarrow: true,
      arrowhead: 2,
      arrowsize: 1,
      arrowwidth: 2,
      arrowcolor: dirColor,
      ax: 100,
      ay: 0,
      font: {
        size: 12,
        color: '#ffffff',
        family: 'Arial Black',
      },
      bgcolor: dirColor,
      bordercolor: dirColor,
      borderwidth: 2,
      borderpad: 6,
    });

    // 8. R:R and TP1 label
    annotations.push({
      x: x1,
      y: opp.structuralTP1,
      xref: 'x',
      yref: 'y',
      text: `TP1 (R:R ${opp.riskRewardRatio.toFixed(1)})`,
      showarrow: false,
      font: {
        size: 10,
        color: '#22c55e',
        family: 'Arial Black',
      },
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: colors.paper,
      borderpad: 3,
    });

    // 9. SL label
    annotations.push({
      x: x1,
      y: opp.structuralSL,
      xref: 'x',
      yref: 'y',
      text: 'SL',
      showarrow: false,
      font: {
        size: 10,
        color: '#ef4444',
        family: 'Arial Black',
      },
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: colors.paper,
      borderpad: 3,
    });

    // 10. Origin label (at the origin point)
    annotations.push({
      x: originX,
      y: opp.originPrice,
      xref: 'x',
      yref: 'y',
      text: `ORIGIN: ${opp.setupType.replace(/_/g, ' ')}`,
      showarrow: true,
      arrowhead: 2,
      arrowcolor: dirColor,
      ax: -60,
      ay: isLong ? 30 : -30,
      font: {
        size: 9,
        color: dirColor,
      },
      bgcolor: colors.paper,
      bordercolor: dirColor,
      borderwidth: 1,
      borderpad: 3,
    });

    // 11. Confluence count at entry zone
    annotations.push({
      x: entryX0,
      y: opp.entryZoneHigh,
      xref: 'x',
      yref: 'y',
      text: `${opp.confluenceCount} confluences`,
      showarrow: false,
      font: {
        size: 8,
        color: colors.text,
      },
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: colors.paper,
      borderpad: 2,
    });
  }

  return { shapes, annotations };
}

/**
 * Generate volume bar trace
 * Creates a bar chart trace for volume data
 */
function generateVolumeTrace(
  candles: Candle[],
  colors: typeof COLORS.dark
): unknown | null {
  // Check if we have real volume data (not tick volume which is usually 1)
  const hasRealVolume = candles.some((c) => c.volume && c.volume > 1);
  if (!hasRealVolume) return null;

  const volumeColors = candles.map((c) =>
    c.close >= c.open ? colors.volumeUp : colors.volumeDown
  );

  return {
    type: 'bar',
    name: 'Volume',
    x: candles.map((c) => toISOString(c.timestamp)),
    y: candles.map((c) => c.volume ?? 0),
    marker: {
      color: volumeColors,
    },
    yaxis: 'y2',
    hovertemplate: 'Volume: %{y:,.0f}<extra></extra>',
  };
}

/**
 * Generate current phase indicator annotation
 */
function generatePhaseIndicator(
  structure: MarketStructure,
  colors: typeof COLORS.dark
): unknown {
  const phaseColors: Record<string, string> = {
    markup: colors.candleUp,
    markdown: colors.candleDown,
    accumulation: '#3b82f6', // blue
    distribution: '#f97316', // orange
    ranging: '#9ca3af', // gray
  };

  const phaseEmojis: Record<string, string> = {
    markup: '📈',
    markdown: '📉',
    accumulation: '🔄',
    distribution: '🔄',
    ranging: '↔️',
  };

  const phaseDescriptions: Record<string, string> = {
    markup: 'BULLISH TREND',
    markdown: 'BEARISH TREND',
    accumulation: 'ACCUMULATION',
    distribution: 'DISTRIBUTION',
    ranging: 'RANGING',
  };

  const color = phaseColors[structure.currentPhase] ?? '#9ca3af';
  const emoji = phaseEmojis[structure.currentPhase] ?? '❓';
  const description = phaseDescriptions[structure.currentPhase] ?? structure.currentPhase.toUpperCase();

  return {
    x: 1,
    y: 1.08,
    xref: 'paper',
    yref: 'paper',
    text: `${emoji} <b>CURRENT PHASE: ${description}</b> | Trend: ${structure.trend.toUpperCase()} (${structure.trendStrength}%)`,
    showarrow: false,
    font: {
      size: 14,
      color: color,
    },
    xanchor: 'right',
    yanchor: 'bottom',
    bgcolor: colors.paper,
    bordercolor: color,
    borderwidth: 2,
    borderpad: 6,
  };
}

/**
 * Generate shapes for trend lines
 */
function generateTrendLineShapes(
  trendLines: TrendLine[],
  candles: Candle[],
  colors: typeof COLORS.dark,
  options: Required<MarketStructureChartOptions>
): unknown[] {
  const shapes: unknown[] = [];
  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) return shapes;

  for (const line of trendLines) {
    if (options.hidebroken && line.broken) continue;

    const color = line.type === 'ascending'
      ? colors.ascendingTrend
      : colors.descendingTrend;

    // Extend line to current time
    const extendedEndTime = lastCandle.timestamp;
    const timeDiff = extendedEndTime - line.start.timestamp;
    const extendedEndPrice = line.start.price + line.slope * timeDiff;

    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: toISOString(line.start.timestamp),
      x1: toISOString(extendedEndTime),
      y0: line.start.price,
      y1: extendedEndPrice,
      line: {
        color: color,
        width: line.broken ? 1 : line.lineWidth ?? 2,
        dash: line.broken ? 'dot' : 'solid',
      },
    });
  }

  return shapes;
}

/**
 * Generate shapes and annotations for the CURRENT market phase only
 * Shows a subtle rectangle covering only the recent portion of the chart (last ~20%)
 */
function generateCurrentPhaseShape(
  phases: MarketPhasePeriod[],
  candles: Candle[],
  colors: typeof COLORS.dark,
  _options: Required<MarketStructureChartOptions>
): { shapes: unknown[]; annotations: unknown[] } {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  // Only show the last (current) phase
  const currentPhase = phases[phases.length - 1];
  if (!currentPhase || candles.length < 10) return { shapes, annotations };

  const phaseColors: Record<string, { fill: string; border: string }> = {
    markup: { fill: 'rgba(34, 197, 94, 0.25)', border: colors.candleUp },
    markdown: { fill: 'rgba(239, 68, 68, 0.25)', border: colors.candleDown },
    accumulation: { fill: 'rgba(59, 130, 246, 0.25)', border: '#3b82f6' },
    distribution: { fill: 'rgba(249, 115, 22, 0.25)', border: '#f97316' },
    ranging: { fill: 'rgba(156, 163, 175, 0.18)', border: '#9ca3af' },
  };

  const phaseLabels: Record<string, string> = {
    markup: '📈 MARKUP',
    markdown: '📉 MARKDOWN',
    accumulation: '🔄 ACCUMULATION',
    distribution: '🔄 DISTRIBUTION',
    ranging: '↔️ RANGING',
  };

  const colorConfig = phaseColors[currentPhase.phase] ?? phaseColors['ranging']!;
  const label = phaseLabels[currentPhase.phase] ?? currentPhase.phase.toUpperCase();

  // Only show the last 15% of candles for the phase zone (recent context)
  const recentCount = Math.max(50, Math.floor(candles.length * 0.15));
  const recentCandles = candles.slice(-recentCount);

  // Calculate price range from recent candles only
  const recentHigh = Math.max(...recentCandles.map(c => c.high));
  const recentLow = Math.min(...recentCandles.map(c => c.low));

  const x0 = toISOString(recentCandles[0]!.timestamp);
  const x1 = toISOString(recentCandles[recentCandles.length - 1]!.timestamp);

  // Rectangle covering the price range of recent candles
  shapes.push({
    type: 'rect',
    x0: x0,
    x1: x1,
    y0: recentLow,
    y1: recentHigh,
    xref: 'x',
    yref: 'y',
    fillcolor: colorConfig.fill,
    opacity: 0.6,
    line: {
      color: colorConfig.border,
      width: 3,
      dash: 'dash',
    },
  });

  // Label at the start of the phase zone
  annotations.push({
    x: x0,
    y: recentHigh,
    xref: 'x',
    yref: 'y',
    text: `<b>${label}</b>`,
    showarrow: false,
    font: {
      size: 11,
      color: colorConfig.border,
    },
    xanchor: 'left',
    yanchor: 'bottom',
    bgcolor: colors.paper,
    bordercolor: colorConfig.border,
    borderwidth: 1,
    borderpad: 4,
  });

  return { shapes, annotations };
}

/**
 * Generate traces for swing points
 */
function generateSwingTraces(
  swings: SwingPoint[],
  colors: typeof COLORS.dark
): unknown[] {
  const highs = swings.filter((s) => s.type === 'high');
  const lows = swings.filter((s) => s.type === 'low');

  const traces: unknown[] = [];

  if (highs.length > 0) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: 'Swing Highs',
      x: highs.map((s) => toISOString(s.timestamp)),
      y: highs.map((s) => s.price),
      marker: {
        symbol: 'triangle-down',
        size: highs.map((s) => 8 + s.strength * 2),
        color: highs.map((s) => (s.broken ? 'rgba(245, 158, 11, 0.4)' : colors.swingHigh)),
        line: { width: 1, color: colors.text },
      },
      text: highs.map(
        (s) =>
          `<b>Swing High</b><br>` +
          `Price: ${s.price.toFixed(4)}<br>` +
          `Strength: ${s.strength}/5<br>` +
          `${s.broken ? '❌ Broken' : '✅ Active'}`
      ),
      hoverinfo: 'text',
    });
  }

  if (lows.length > 0) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: 'Swing Lows',
      x: lows.map((s) => toISOString(s.timestamp)),
      y: lows.map((s) => s.price),
      marker: {
        symbol: 'triangle-up',
        size: lows.map((s) => 8 + s.strength * 2),
        color: lows.map((s) => (s.broken ? 'rgba(59, 130, 246, 0.4)' : colors.swingLow)),
        line: { width: 1, color: colors.text },
      },
      text: lows.map(
        (s) =>
          `<b>Swing Low</b><br>` +
          `Price: ${s.price.toFixed(4)}<br>` +
          `Strength: ${s.strength}/5<br>` +
          `${s.broken ? '❌ Broken' : '✅ Active'}`
      ),
      hoverinfo: 'text',
    });
  }

  return traces;
}

/**
 * Generate the main chart HTML
 */
export function generateMarketStructureChart(
  candles: Candle[],
  structure: MarketStructure,
  options: MarketStructureChartOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const colors = COLORS[opts.theme];

  const traces: unknown[] = [];
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  // 1. Add current market phase background (first so it's behind everything)
  if (opts.showPhases && structure.phases.length > 0) {
    const phaseResult = generateCurrentPhaseShape(structure.phases, candles, colors, opts);
    shapes.push(...phaseResult.shapes);
    annotations.push(...phaseResult.annotations);
  }

  // 2. Add S/R zones (returns shapes and annotations separately)
  if (opts.showZones && structure.zones.length > 0) {
    const zoneResult = generateZoneShapes(structure.zones, colors, opts);
    shapes.push(...zoneResult.shapes);
    annotations.push(...zoneResult.annotations);
  }

  // 3. Add trend lines
  if (opts.showTrendLines && structure.trendLines.length > 0) {
    shapes.push(...generateTrendLineShapes(structure.trendLines, candles, colors, opts));
  }

  // 4. Candlestick trace
  traces.push({
    type: 'candlestick',
    name: 'Price',
    x: candles.map((c) => toISOString(c.timestamp)),
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    increasing: { line: { color: colors.candleUp } },
    decreasing: { line: { color: colors.candleDown } },
  });

  // 5. Add swing point markers
  if (opts.showSwings && structure.swingPoints.length > 0) {
    traces.push(...generateSwingTraces(structure.swingPoints, colors));
  }

  // 6. Add current phase indicator
  annotations.push(generatePhaseIndicator(structure, colors));

  // Layout configuration - no fixed width for responsive behavior
  const layout = {
    title: {
      text: opts.title || `${structure.asset} - Market Structure`,
      font: { color: colors.text, size: 18 },
    },
    autosize: true,
    height: opts.height,
    margin: { t: 80, r: 60, b: 50, l: 60 }, // Extra top margin for phase indicator
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.background,
    font: { color: colors.text },
    showlegend: true,
    legend: {
      orientation: 'h',
      y: 1.12,
      x: 0,
      xanchor: 'left',
      font: { size: 11 },
    },
    xaxis: {
      type: 'date',
      rangeslider: { visible: false },
      gridcolor: colors.grid,
      showgrid: true,
    },
    yaxis: {
      title: 'Price',
      side: 'right',
      gridcolor: colors.grid,
      showgrid: true,
    },
    shapes: shapes,
    annotations: annotations,
    hovermode: 'x unified',
    dragmode: 'zoom',
  };

  const config = {
    responsive: true,
    scrollZoom: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  };

  // Generate summary panel HTML
  const summaryHtml = generateSummaryPanel(structure);

  // Generate legend panel HTML
  const legendHtml = generateLegendPanel(colors);

  return `<!DOCTYPE html>
<html>
<head>
  <title>${opts.title}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      overflow-x: hidden;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${colors.background};
      color: ${colors.text};
      padding: 15px;
    }
    .container {
      width: 100%;
      max-width: 100%;
    }
    .header { margin-bottom: 15px; }
    .panels {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin-bottom: 15px;
    }
    .panel {
      background: ${colors.paper};
      border-radius: 8px;
      padding: 15px;
      flex: 1;
      min-width: 280px;
    }
    .panel h3 {
      font-size: 14px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid ${colors.grid};
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      gap: 10px;
    }
    .stat {
      text-align: center;
    }
    .stat-value {
      font-size: 16px;
      font-weight: bold;
      white-space: nowrap;
    }
    .stat-label {
      font-size: 10px;
      color: ${opts.theme === 'dark' ? '#9ca3af' : '#6b7280'};
    }
    .levels-list {
      font-size: 12px;
      line-height: 1.8;
    }
    .level-resistance { color: ${colors.resistanceLine}; }
    .level-support { color: ${colors.supportLine}; }
    .trend-up { color: ${colors.candleUp}; }
    .trend-down { color: ${colors.candleDown}; }
    .trend-sideways { color: #9ca3af; }
    .legend-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      font-size: 11px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .legend-color {
      width: 16px;
      height: 12px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .legend-line {
      width: 16px;
      height: 2px;
      flex-shrink: 0;
    }
    .legend-marker {
      width: 0;
      height: 0;
      flex-shrink: 0;
    }
    .triangle-up {
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 10px solid ${colors.swingLow};
    }
    .triangle-down {
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 10px solid ${colors.swingHigh};
    }
    #chart {
      width: 100%;
      height: ${opts.height}px;
    }
    .phase-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="panels">
      ${summaryHtml}
      ${legendHtml}
    </div>
    <div id="chart"></div>
  </div>
  <script>
    const traces = ${JSON.stringify(traces)};
    const layout = ${JSON.stringify(layout)};
    const config = ${JSON.stringify(config)};
    Plotly.newPlot('chart', traces, layout, config);
  </script>
</body>
</html>`;
}

/**
 * Generate summary panel HTML
 */
function generateSummaryPanel(structure: MarketStructure): string {
  const trendClass =
    structure.trend === 'up'
      ? 'trend-up'
      : structure.trend === 'down'
      ? 'trend-down'
      : 'trend-sideways';

  const trendEmoji =
    structure.trend === 'up' ? '📈' : structure.trend === 'down' ? '📉' : '↔️';

  const phaseEmoji: Record<string, string> = {
    markup: '🟢',
    markdown: '🔴',
    accumulation: '🔵',
    distribution: '🟠',
    ranging: '⚪',
  };

  const activeZones = structure.zones.filter((z: SRZone) => !z.broken);
  const activeLines = structure.trendLines.filter((l: TrendLine) => !l.broken);

  return `
    <div class="panel">
      <h3>📊 Market Structure Summary</h3>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value ${trendClass}">${trendEmoji} ${structure.trend.toUpperCase()}</div>
          <div class="stat-label">Trend</div>
        </div>
        <div class="stat">
          <div class="stat-value">${structure.trendStrength}%</div>
          <div class="stat-label">Strength</div>
        </div>
        <div class="stat">
          <div class="stat-value">${phaseEmoji[structure.currentPhase] ?? '⚪'} ${structure.currentPhase}</div>
          <div class="stat-label">Phase</div>
        </div>
        <div class="stat">
          <div class="stat-value">${structure.swingPoints.length}</div>
          <div class="stat-label">Swings</div>
        </div>
      </div>
      <div style="margin-top: 15px;">
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-value">${activeZones.filter((z: SRZone) => z.type === 'resistance').length}</div>
            <div class="stat-label">Resistance Zones</div>
          </div>
          <div class="stat">
            <div class="stat-value">${activeZones.filter((z: SRZone) => z.type === 'support').length}</div>
            <div class="stat-label">Support Zones</div>
          </div>
          <div class="stat">
            <div class="stat-value">${activeLines.filter((l: TrendLine) => l.type === 'descending').length}</div>
            <div class="stat-label">Descending Lines</div>
          </div>
          <div class="stat">
            <div class="stat-value">${activeLines.filter((l: TrendLine) => l.type === 'ascending').length}</div>
            <div class="stat-label">Ascending Lines</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate legend panel HTML
 */
function generateLegendPanel(colors: typeof COLORS.dark): string {
  return `
    <div class="panel">
      <h3>🎨 Legend</h3>
      <div class="legend-grid">
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.resistanceZone}; border: 1px solid ${colors.resistanceLine};"></div>
          <span>Resistance Zone</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.supportZone}; border: 1px solid ${colors.supportLine};"></div>
          <span>Support Zone</span>
        </div>
        <div class="legend-item">
          <div class="legend-line" style="background: ${colors.descendingTrend};"></div>
          <span>Descending Line</span>
        </div>
        <div class="legend-item">
          <div class="legend-line" style="background: ${colors.ascendingTrend};"></div>
          <span>Ascending Line</span>
        </div>
        <div class="legend-item">
          <div class="legend-marker triangle-down"></div>
          <span>Swing High</span>
        </div>
        <div class="legend-item">
          <div class="legend-marker triangle-up"></div>
          <span>Swing Low</span>
        </div>
      </div>
      <div style="margin-top: 12px; border-top: 1px solid ${colors.grid}; padding-top: 10px;">
        <div style="font-size: 11px; margin-bottom: 6px;">Market Phases:</div>
        <div class="legend-grid">
          <div class="legend-item">
            <div class="legend-color" style="background: ${colors.phaseMarkup};"></div>
            <span class="phase-label">Markup</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background: ${colors.phaseMarkdown};"></div>
            <span class="phase-label">Markdown</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background: ${colors.phaseAccumulation};"></div>
            <span class="phase-label">Accumulation</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background: ${colors.phaseDistribution};"></div>
            <span class="phase-label">Distribution</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Export chart to file
 */
export async function exportMarketStructureChart(
  candles: Candle[],
  structure: MarketStructure,
  outputPath: string,
  options?: MarketStructureChartOptions
): Promise<string> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { dirname } = await import('path');

  // Ensure directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  const html = generateMarketStructureChart(candles, structure, options);
  await writeFile(outputPath, html, 'utf-8');

  return outputPath;
}

/**
 * Generate MTF Market Structure Chart
 * Shows zones from multiple timeframes with differentiated styles
 */
export function generateMTFMarketStructureChart(
  candles: Candle[],
  mtfStructure: MTFMarketStructure,
  options: MarketStructureChartOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const colors = COLORS[opts.theme];

  const traces: unknown[] = [];
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  // 1. Market phase background DISABLED - too much visual clutter
  // if (opts.showPhases && mtfStructure.tf1m.phases.length > 0) {
  //   const phaseResult = generateCurrentPhaseShape(mtfStructure.tf1m.phases, candles, colors, opts);
  //   shapes.push(...phaseResult.shapes);
  //   annotations.push(...phaseResult.annotations);
  // }

  // 2. Add MTF zones (only 5M and 15M for cleaner chart)
  if (opts.showZones && mtfStructure.allZones.length > 0) {
    // Filter out 1M zones to reduce clutter - focus on HTF
    const htfZones = mtfStructure.allZones.filter(z => z.tfLabel !== '1M');
    const zoneResult = generateMTFZoneShapes(htfZones, colors, opts);
    shapes.push(...zoneResult.shapes);
    annotations.push(...zoneResult.annotations);
  }

  // 3. Trend lines DISABLED - too many lines cause clutter
  // const allTrendLines = [
  //   ...mtfStructure.tf15m.trendLines,
  //   ...mtfStructure.tf5m.trendLines,
  //   ...mtfStructure.tf1m.trendLines,
  // ];
  // if (opts.showTrendLines && allTrendLines.length > 0) {
  //   shapes.push(...generateTrendLineShapes(allTrendLines, candles, colors, opts));
  // }

  // 3b. Add Order Blocks if provided
  if (opts.showOrderBlocks && opts.orderBlocks && opts.orderBlocks.length > 0) {
    const obResult = generateOrderBlockShapes(opts.orderBlocks, candles, colors, opts);
    shapes.push(...obResult.shapes);
    annotations.push(...obResult.annotations);
  }

  // 3c. Add Fair Value Gaps if provided
  if (opts.showFVGs && opts.fvgs && opts.fvgs.length > 0) {
    const fvgResult = generateFVGShapes(opts.fvgs, candles, colors, opts);
    shapes.push(...fvgResult.shapes);
    annotations.push(...fvgResult.annotations);
  }

  // 3d. Add Liquidity Sweeps if provided
  if (opts.showLiquiditySweeps && opts.liquiditySweeps && opts.liquiditySweeps.length > 0) {
    const sweepResult = generateLiquiditySweepShapes(opts.liquiditySweeps, candles, colors);
    shapes.push(...sweepResult.shapes);
    annotations.push(...sweepResult.annotations);
  }

  // 3e. Add SMC Opportunities if provided
  if (opts.showOpportunities && opts.opportunities && opts.opportunities.length > 0) {
    const oppResult = generateSMCOpportunityShapes(opts.opportunities, candles, colors);
    shapes.push(...oppResult.shapes);
    annotations.push(...oppResult.annotations);
  }

  // 4. Candlestick trace
  traces.push({
    type: 'candlestick',
    name: 'Price (1M)',
    x: candles.map((c) => toISOString(c.timestamp)),
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    increasing: { line: { color: colors.candleUp } },
    decreasing: { line: { color: colors.candleDown } },
  });

  // 5. Add swing point markers (only from 1m for clarity)
  if (opts.showSwings && mtfStructure.tf1m.swingPoints.length > 0) {
    traces.push(...generateSwingTraces(mtfStructure.tf1m.swingPoints, colors));
  }

  // 5b. Add volume bars if available (real volume from Binance)
  let hasVolume = false;
  if (opts.showVolume) {
    const volumeTrace = generateVolumeTrace(candles, colors);
    if (volumeTrace) {
      traces.push(volumeTrace);
      hasVolume = true;
    }
  }

  // 6. HTF bias indicator moved to summary panel (no longer overlapping chart)

  // Layout configuration - with optional volume subplot
  const layout: Record<string, unknown> = {
    title: {
      text: opts.title || `${mtfStructure.asset} - MTF Market Structure (1M/5M/15M)`,
      font: { color: colors.text, size: 18 },
    },
    autosize: true,
    height: opts.height,
    margin: { t: 80, r: 60, b: 50, l: 60 },
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.background,
    font: { color: colors.text },
    showlegend: true,
    legend: {
      orientation: 'h',
      y: 1.12,
      x: 0,
      xanchor: 'left',
      font: { size: 11 },
    },
    xaxis: {
      type: 'date',
      rangeslider: { visible: false },
      gridcolor: colors.grid,
      showgrid: true,
    },
    yaxis: {
      title: 'Price',
      side: 'right',
      gridcolor: colors.grid,
      showgrid: true,
      domain: hasVolume ? [0.25, 1] : [0, 1], // Leave room for volume
    },
    shapes: shapes,
    annotations: annotations,
    hovermode: 'x unified',
    dragmode: 'zoom',
  };

  // Add volume y-axis if we have volume data
  if (hasVolume) {
    layout.yaxis2 = {
      title: 'Volume',
      side: 'right',
      gridcolor: colors.grid,
      showgrid: false,
      domain: [0, 0.2], // Bottom 20%
      anchor: 'x',
    };
  }

  const config = {
    responsive: true,
    scrollZoom: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  };

  // Generate MTF summary panel
  const summaryHtml = generateMTFSummaryPanel(mtfStructure, colors);

  // Track what's displayed for legend
  const hasOrderBlocks = opts.showOrderBlocks && opts.orderBlocks && opts.orderBlocks.length > 0;
  const hasFVGs = opts.showFVGs && opts.fvgs && opts.fvgs.length > 0;
  const hasSweeps = opts.showLiquiditySweeps && opts.liquiditySweeps && opts.liquiditySweeps.length > 0;

  // Generate MTF legend panel
  const legendHtml = generateMTFLegendPanel(colors, hasOrderBlocks, hasVolume, hasFVGs, hasSweeps);

  return `<!DOCTYPE html>
<html>
<head>
  <title>${opts.title || 'MTF Market Structure'}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; overflow-x: hidden; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${colors.background};
      color: ${colors.text};
      padding: 15px;
    }
    .container { width: 100%; max-width: 100%; }
    .header { margin-bottom: 15px; }
    .panels { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px; }
    .panel {
      background: ${colors.paper};
      border-radius: 8px;
      padding: 15px;
      flex: 1;
      min-width: 280px;
    }
    .panel h3 {
      font-size: 14px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid ${colors.grid};
    }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; }
    .stat { text-align: center; padding: 8px; background: ${colors.background}; border-radius: 6px; }
    .stat-value { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .stat-label { font-size: 11px; color: #888; text-transform: uppercase; }
    .bullish { color: ${colors.candleUp}; }
    .bearish { color: ${colors.candleDown}; }
    .neutral { color: #9ca3af; }
    .legend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .legend-color { width: 24px; height: 14px; border-radius: 3px; }
    .legend-line { width: 24px; height: 3px; border-radius: 2px; }
    #chart { width: 100%; border-radius: 8px; overflow: hidden; }
    .tf-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-right: 4px; }
    .tf-1m { background: rgba(107, 114, 128, 0.3); color: #9ca3af; }
    .tf-5m { background: rgba(168, 85, 247, 0.3); color: #a855f7; }
    .tf-15m { background: rgba(251, 191, 36, 0.3); color: #fbbf24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="panels">
      ${summaryHtml}
      ${legendHtml}
    </div>
    <div id="chart"></div>
  </div>
  <script>
    const traces = ${JSON.stringify(traces)};
    const layout = ${JSON.stringify(layout)};
    const config = ${JSON.stringify(config)};
    Plotly.newPlot('chart', traces, layout, config);
    window.addEventListener('resize', () => Plotly.Plots.resize('chart'));
  </script>
</body>
</html>`;
}

/**
 * Generate MTF bias indicator annotation
 * @deprecated Moved to summary panel - kept for reference/future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _generateMTFBiasIndicator(
  mtfStructure: MTFMarketStructure,
  colors: typeof COLORS.dark
): unknown {
  const biasColors: Record<string, string> = {
    bullish: colors.candleUp,
    bearish: colors.candleDown,
    neutral: '#9ca3af',
  };

  const biasEmojis: Record<string, string> = {
    bullish: '🟢',
    bearish: '🔴',
    neutral: '⚪',
  };

  const color = biasColors[mtfStructure.htfBias];
  const emoji = biasEmojis[mtfStructure.htfBias];

  return {
    x: 1,
    y: 1.08,
    xref: 'paper',
    yref: 'paper',
    text: `${emoji} <b>HTF BIAS: ${mtfStructure.htfBias.toUpperCase()}</b> | 15M: ${mtfStructure.tf15m.trend} | 5M: ${mtfStructure.tf5m.trend} | 1M: ${mtfStructure.tf1m.trend}`,
    showarrow: false,
    font: { size: 14, color: color },
    xanchor: 'right',
    yanchor: 'bottom',
    bgcolor: colors.paper,
    bordercolor: color,
    borderwidth: 2,
    borderpad: 6,
  };
}

/**
 * Generate MTF summary panel
 */
function generateMTFSummaryPanel(
  mtfStructure: MTFMarketStructure,
  colors: typeof COLORS.dark
): string {
  const biasClass = mtfStructure.htfBias === 'bullish' ? 'bullish' : mtfStructure.htfBias === 'bearish' ? 'bearish' : 'neutral';

  const zones1m = mtfStructure.allZones.filter(z => z.tfLabel === '1M' && !z.broken).length;
  const zones5m = mtfStructure.allZones.filter(z => z.tfLabel === '5M' && !z.broken).length;
  const zones15m = mtfStructure.allZones.filter(z => z.tfLabel === '15M' && !z.broken).length;

  // Trend classes for each TF
  const trend15mClass = mtfStructure.tf15m.trend === 'up' ? 'bullish' : mtfStructure.tf15m.trend === 'down' ? 'bearish' : 'neutral';
  const trend5mClass = mtfStructure.tf5m.trend === 'up' ? 'bullish' : mtfStructure.tf5m.trend === 'down' ? 'bearish' : 'neutral';
  const trend1mClass = mtfStructure.tf1m.trend === 'up' ? 'bullish' : mtfStructure.tf1m.trend === 'down' ? 'bearish' : 'neutral';

  return `
    <div class="panel">
      <h3>📊 MTF Market Structure</h3>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value ${biasClass}">${mtfStructure.htfBias.toUpperCase()}</div>
          <div class="stat-label">HTF Bias</div>
        </div>
        <div class="stat">
          <div class="stat-value ${trend15mClass}"><span class="tf-badge tf-15m">15M</span>${mtfStructure.tf15m.trend.toUpperCase()}</div>
          <div class="stat-label">15M Trend</div>
        </div>
        <div class="stat">
          <div class="stat-value ${trend5mClass}"><span class="tf-badge tf-5m">5M</span>${mtfStructure.tf5m.trend.toUpperCase()}</div>
          <div class="stat-label">5M Trend</div>
        </div>
        <div class="stat">
          <div class="stat-value ${trend1mClass}"><span class="tf-badge tf-1m">1M</span>${mtfStructure.tf1m.trend.toUpperCase()}</div>
          <div class="stat-label">1M Trend</div>
        </div>
        <div class="stat">
          <div class="stat-value">${mtfStructure.confluenceZones.length}</div>
          <div class="stat-label">Confluences</div>
        </div>
        <div class="stat">
          <div class="stat-value">${mtfStructure.htfKeyLevels.resistance.length}</div>
          <div class="stat-label">HTF Resistance</div>
        </div>
        <div class="stat">
          <div class="stat-value">${mtfStructure.htfKeyLevels.support.length}</div>
          <div class="stat-label">HTF Support</div>
        </div>
      </div>
      <div style="margin-top: 15px; border-top: 1px solid ${colors.grid}; padding-top: 10px;">
        <div style="font-size: 11px; margin-bottom: 8px; text-transform: uppercase; color: #888;">Active Zones by Timeframe</div>
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-value"><span class="tf-badge tf-1m">1M</span> ${zones1m}</div>
            <div class="stat-label">Zones</div>
          </div>
          <div class="stat">
            <div class="stat-value"><span class="tf-badge tf-5m">5M</span> ${zones5m}</div>
            <div class="stat-label">Zones</div>
          </div>
          <div class="stat">
            <div class="stat-value"><span class="tf-badge tf-15m">15M</span> ${zones15m}</div>
            <div class="stat-label">Zones</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate MTF legend panel
 */
function generateMTFLegendPanel(
  colors: typeof COLORS.dark,
  hasOrderBlocks: boolean = false,
  hasVolume: boolean = false,
  hasFVGs: boolean = false,
  hasSweeps: boolean = false
): string {
  return `
    <div class="panel">
      <h3>🎨 MTF Legend</h3>
      <div class="legend-grid">
        <div class="legend-item">
          <div class="legend-color" style="background: rgba(168, 85, 247, 0.4); border: 2px solid #a855f7;"></div>
          <span><span class="tf-badge tf-5m">5M</span> Resistance</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: rgba(34, 211, 238, 0.4); border: 2px solid #22d3ee;"></div>
          <span><span class="tf-badge tf-5m">5M</span> Support</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: rgba(251, 191, 36, 0.5); border: 3px solid #fbbf24;"></div>
          <span><span class="tf-badge tf-15m">15M</span> Resistance</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: rgba(52, 211, 153, 0.5); border: 3px solid #34d399;"></div>
          <span><span class="tf-badge tf-15m">15M</span> Support</span>
        </div>
        ${hasOrderBlocks ? `
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.bullishOB}; border: 2px solid ${colors.bullishOBBorder};"></div>
          <span>🔵 Bullish OB</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.bearishOB}; border: 2px solid ${colors.bearishOBBorder};"></div>
          <span>🔴 Bearish OB</span>
        </div>
        ` : ''}
        ${hasFVGs ? `
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.bullishFVG}; border: 1px dashed ${colors.bullishFVGBorder};"></div>
          <span>📗 Bullish FVG</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.bearishFVG}; border: 1px dashed ${colors.bearishFVGBorder};"></div>
          <span>📕 Bearish FVG</span>
        </div>
        ` : ''}
        ${hasSweeps ? `
        <div class="legend-item">
          <div class="legend-line" style="background: ${colors.buysideSweep}; border-style: dotted;"></div>
          <span>🔺 BSL Sweep</span>
        </div>
        <div class="legend-item">
          <div class="legend-line" style="background: ${colors.sellsideSweep}; border-style: dotted;"></div>
          <span>🔻 SSL Sweep</span>
        </div>
        ` : ''}
        ${hasVolume ? `
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.volumeUp};"></div>
          <span>📊 Volume Up</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.volumeDown};"></div>
          <span>📊 Volume Down</span>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}
