/**
 * Market Structure Types
 *
 * Types for representing market structure elements:
 * - Support/Resistance zones (rectangles)
 * - Trend lines
 * - Swing points
 * - Market phases
 */

/**
 * A swing point (local high or low)
 */
export interface SwingPoint {
  /** Index in the candle array */
  index: number;

  /** Unix timestamp in seconds */
  timestamp: number;

  /** Price level */
  price: number;

  /** Type: high or low */
  type: 'high' | 'low';

  /** Strength based on how many candles confirm it (1-5) */
  strength: number;

  /** Whether this swing has been broken/invalidated */
  broken: boolean;

  /** Timestamp when it was broken (if applicable) */
  brokenAt?: number;
}

/**
 * A support or resistance zone (drawn as rectangle)
 */
export interface SRZone {
  /** Unique identifier */
  id: string;

  /** Zone type */
  type: 'support' | 'resistance';

  /** Upper price boundary */
  priceHigh: number;

  /** Lower price boundary */
  priceLow: number;

  /** When the zone was first established (Unix timestamp in seconds) */
  startTime: number;

  /** When the zone ends/expires (Unix timestamp in seconds, or null if active) */
  endTime: number | null;

  /** Number of times price has tested this zone */
  touchCount: number;

  /** Timestamps of each touch */
  touches: number[];

  /** Zone strength (1-5 based on touches and timeframe) */
  strength: number;

  /** Whether the zone has been broken */
  broken: boolean;

  /** Timestamp when broken */
  brokenAt?: number;

  /** Source timeframe in seconds (e.g., 300 for 5m) */
  timeframe: number;

  /** Color for visualization (hex) */
  color?: string;

  /** Opacity for visualization (0-1) */
  opacity?: number;
}

/**
 * A trend line connecting swing points
 */
export interface TrendLine {
  /** Unique identifier */
  id: string;

  /** Type: ascending (support) or descending (resistance) */
  type: 'ascending' | 'descending';

  /** Starting point */
  start: {
    timestamp: number;
    price: number;
    index: number;
  };

  /** Ending point (for calculation, line extends beyond) */
  end: {
    timestamp: number;
    price: number;
    index: number;
  };

  /** Slope: price change per second */
  slope: number;

  /** Number of touches/confirmations */
  touchCount: number;

  /** Timestamps of each touch */
  touches: number[];

  /** Line strength (1-5) */
  strength: number;

  /** Whether the line has been broken */
  broken: boolean;

  /** Timestamp when broken */
  brokenAt?: number;

  /** Source timeframe in seconds */
  timeframe: number;

  /** Color for visualization */
  color?: string;

  /** Line width */
  lineWidth?: number;
}

/**
 * Market phase/regime
 */
export type MarketPhase =
  | 'accumulation' // Low volatility, range-bound after downtrend
  | 'markup' // Uptrend
  | 'distribution' // Low volatility, range-bound after uptrend
  | 'markdown' // Downtrend
  | 'ranging'; // Sideways, no clear direction

/**
 * A period of a specific market phase
 */
export interface MarketPhasePeriod {
  /** Phase type */
  phase: MarketPhase;

  /** Start timestamp */
  startTime: number;

  /** End timestamp (null if current) */
  endTime: number | null;

  /** Start index */
  startIndex: number;

  /** End index */
  endIndex: number | null;

  /** Price range during this period */
  priceHigh: number;
  priceLow: number;

  /** Average volatility (ATR % of price) */
  avgVolatility: number;

  /** Color for visualization */
  color?: string;
}

/**
 * Complete market structure analysis
 */
export interface MarketStructure {
  /** Asset symbol */
  asset: string;

  /** Analysis timeframe */
  timeframe: number;

  /** Detected swing points */
  swingPoints: SwingPoint[];

  /** Support/resistance zones */
  zones: SRZone[];

  /** Trend lines */
  trendLines: TrendLine[];

  /** Market phases */
  phases: MarketPhasePeriod[];

  /** Current market phase */
  currentPhase: MarketPhase;

  /** Overall trend direction */
  trend: 'up' | 'down' | 'sideways';

  /** Trend strength (0-100) */
  trendStrength: number;

  /** Key levels summary */
  keyLevels: {
    nearestResistance: number | null;
    nearestSupport: number | null;
    majorResistance: number[];
    majorSupport: number[];
  };

  /** Analysis timestamp */
  analyzedAt: number;
}

/**
 * Options for market structure detection
 */
export interface MarketStructureOptions {
  /** Swing detection depth (candles on each side) */
  swingDepth?: number;

  /** Minimum zone width as % of price */
  minZoneWidthPct?: number;

  /** Maximum zone width as % of price */
  maxZoneWidthPct?: number;

  /** Minimum touches for a valid zone */
  minZoneTouches?: number;

  /** How close price must be to zone to count as touch (% of zone width) */
  touchTolerancePct?: number;

  /** Minimum touches for a valid trend line */
  minTrendLineTouches?: number;

  /** Whether to detect market phases */
  detectPhases?: boolean;

  /** ATR period for volatility calculation */
  atrPeriod?: number;

  /** Lookback period for analysis (candles) */
  lookbackPeriod?: number;
}

/**
 * Default options for market structure detection
 */
export const DEFAULT_MARKET_STRUCTURE_OPTIONS: Required<MarketStructureOptions> =
  {
    swingDepth: 5,
    minZoneWidthPct: 0.05, // Smaller for forex/small price movements
    maxZoneWidthPct: 1.0,
    minZoneTouches: 1, // Show zone even with single swing point
    touchTolerancePct: 30, // More tolerance for counting touches
    minTrendLineTouches: 2,
    detectPhases: true,
    atrPeriod: 14,
    lookbackPeriod: 200,
  };

/**
 * Chart shape for Plotly (rectangle, line, etc.)
 */
export interface ChartShape {
  type: 'rect' | 'line';
  x0: string | number;
  x1: string | number;
  y0: number;
  y1: number;
  xref?: string;
  yref?: string;
  fillcolor?: string;
  opacity?: number;
  line?: {
    color?: string;
    width?: number;
    dash?: 'solid' | 'dot' | 'dash' | 'longdash' | 'dashdot';
  };
  label?: {
    text: string;
    textposition?: string;
    font?: { size?: number; color?: string };
  };
}
