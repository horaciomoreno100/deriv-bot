/**
 * FVG Liquidity Sweep Strategy Types
 *
 * Interfaces for the hybrid strategy combining:
 * - Liquidity Sweep detection (ICT concept)
 * - Fair Value Gap entry after sweep
 */

/**
 * Swing Point - Local high or low in price action
 */
export interface SwingPoint {
  /** Index in the candle array */
  index: number;
  /** Type of swing */
  type: 'high' | 'low';
  /** Price level of the swing */
  level: number;
  /** Timestamp of the swing candle */
  timestamp: number;
}

/**
 * Liquidity Zone - Area where stops accumulate
 *
 * BSL (Buyside Liquidity): Stops from shorts above swing highs
 * SSL (Sellside Liquidity): Stops from longs below swing lows
 */
export interface LiquidityZone {
  /** Zone type */
  type: 'BSL' | 'SSL';
  /** Average price level of the zone */
  level: number;
  /** Swing points that form this zone */
  swings: SwingPoint[];
  /** First swing index */
  startIndex: number;
  /** Last swing index */
  endIndex: number;
  /** Whether the zone has been swept */
  swept: boolean;
  /** Index when the zone was swept */
  sweptIndex?: number;
  /** Price at which the sweep occurred */
  sweptPrice?: number;
}

/**
 * Fair Value Gap - Price imbalance zone
 */
export interface FairValueGap {
  /** Gap type */
  type: 'bullish' | 'bearish';
  /** Top of the gap */
  top: number;
  /** Bottom of the gap */
  bottom: number;
  /** Midpoint (50% level) */
  midpoint: number;
  /** Index when the gap formed (candle 3) */
  formationIndex: number;
  /** Timestamp of formation */
  formationTimestamp: number;
  /** Whether the gap has been touched */
  touched: boolean;
  /** Index when price first touched the gap */
  touchedIndex?: number;
  /** Percentage of gap that has been filled (0-100) */
  mitigationPct: number;
  /** Gap size as percentage of price */
  gapSizePct: number;
}

/**
 * Active Sweep - Detected liquidity sweep waiting for FVG entry
 */
export interface ActiveSweep {
  /** Type of liquidity swept */
  type: 'BSL' | 'SSL';
  /** Liquidity zone that was swept */
  zone: LiquidityZone;
  /** Index of the sweep candle */
  sweepIndex: number;
  /** Timestamp of the sweep */
  sweepTimestamp: number;
  /** Low of the sweep candle (for SSL sweep) */
  sweepLow?: number;
  /** High of the sweep candle (for BSL sweep) */
  sweepHigh?: number;
  /** Direction of expected trade */
  expectedDirection: 'CALL' | 'PUT';
  /** Candles since sweep occurred */
  barsSinceSweep: number;
}

/**
 * Strategy State Machine
 */
export type StrategyPhase =
  | 'SCANNING'        // Looking for liquidity zones and sweeps
  | 'SWEEP_DETECTED'  // Sweep detected, waiting for FVG formation
  | 'WAITING_ENTRY';  // FVG found, waiting for price to enter

/**
 * Full Strategy State
 */
export interface StrategyState {
  /** Current phase */
  phase: StrategyPhase;
  /** Detected swing points */
  swings: SwingPoint[];
  /** Detected liquidity zones */
  liquidityZones: LiquidityZone[];
  /** Active sweep (if any) */
  activeSweep?: ActiveSweep;
  /** Active FVG for entry (if any) */
  activeFVG?: FairValueGap;
  /** Bars since state changed */
  barsInState: number;
}

/**
 * Strategy Parameters
 */
export interface FVGLiquiditySweepParams {
  // Swing Detection
  /** Number of bars to look left/right for swing confirmation */
  swingLength: number;

  // Liquidity Zone Detection
  /** Max distance between swings to be grouped (as % of price) */
  liquidityRangePct: number;
  /** Minimum number of swing points to form a valid zone */
  minSwingsForZone: number;
  /** Maximum age of zone in bars before it expires */
  maxZoneAgeBars: number;

  // Sweep Detection
  /** Require candle to close back inside the zone */
  requireCloseBack: boolean;
  /** Max bars after sweep to wait for FVG */
  maxBarsAfterSweep: number;

  // FVG Detection
  /** Minimum gap size as percentage of price */
  minFVGSizePct: number;
  /** Max bars to search for FVG after sweep */
  fvgSearchBars: number;

  // Entry
  /** Where to enter in the FVG */
  entryZone: 'top' | 'midpoint' | 'bottom';
  /** Require confirmation candle after touching FVG */
  requireConfirmation: boolean;
  /** Max bars to wait after FVG forms for entry */
  maxBarsForEntry: number;

  // Risk Management
  /** Buffer beyond sweep low/high for stop loss */
  stopLossBufferPct: number;
  /** Risk-reward ratio for take profit */
  takeProfitRR: number;
  /** Minimum confidence to generate signal */
  minConfidence: number;

  // Cooldown
  /** Seconds between trades */
  cooldownSeconds: number;

  // Dynamic Cooldown
  /** Enable exponential cooldown after losses */
  dynamicCooldownEnabled: boolean;
  /** Cooldown after 2 consecutive losses */
  cooldownAfter2Losses: number;
  /** Cooldown after 3 consecutive losses */
  cooldownAfter3Losses: number;
  /** Cooldown after 4+ consecutive losses */
  cooldownAfter4PlusLosses: number;

  // Hour Filter
  /** Enable hour-based trade filtering */
  hourFilterEnabled: boolean;
  /** Hours to avoid trading (UTC, 0-23) */
  badHoursUTC: number[];
}

/**
 * Trade Setup - Ready to execute
 */
export interface TradeSetup {
  /** Trade direction */
  direction: 'CALL' | 'PUT';
  /** Entry price (FVG midpoint or edge) */
  entryPrice: number;
  /** Stop loss level */
  stopLoss: number;
  /** Take profit level */
  takeProfit: number;
  /** Signal confidence (0-1) */
  confidence: number;
  /** Metadata for logging */
  metadata: {
    sweepType: 'BSL' | 'SSL';
    sweepIndex: number;
    sweepLevel: number;
    sweepLow?: number;
    sweepHigh?: number;
    fvgTop: number;
    fvgBottom: number;
    fvgMidpoint: number;
    riskRewardRatio: number;
    swingsInZone: number;
    barsSinceSweep: number;
  };
}
