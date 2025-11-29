/**
 * RSI Scalp Strategy Types
 *
 * Interfaces for the RSI-based scalping strategy with DCA entries.
 * Designed for crypto markets (BTC, ETH) on 1m-5m timeframes.
 */

/**
 * Individual entry in a DCA position
 */
export interface ScalpEntry {
  /** Entry price */
  price: number;
  /** Size as percentage of total allocation (0-100) */
  sizePercent: number;
  /** RSI value at time of entry */
  rsiAtEntry: number;
  /** Timestamp of entry */
  timestamp: number;
  /** Entry level index (0, 1, 2) */
  levelIndex: number;
}

/**
 * Active position with multiple DCA entries
 */
export interface ScalpPosition {
  /** Unique position ID */
  id: string;
  /** Trading symbol */
  symbol: string;
  /** Position direction */
  direction: 'LONG' | 'SHORT';

  /** All entries in this position */
  entries: ScalpEntry[];

  /** Weighted average entry price */
  averageEntry: number;
  /** Total size as percentage (sum of all entries) */
  totalSizePercent: number;

  /** Unrealized P&L in currency */
  unrealizedPnl: number;
  /** Unrealized P&L as percentage */
  unrealizedPnlPercent: number;

  /** Whether TP1 has been hit (partial exit) */
  tp1Hit: boolean;
  /** Whether TP2 has been hit (full exit) */
  tp2Hit: boolean;

  /** Remaining size after partial exits (0-100) */
  remainingSizePercent: number;

  /** Position open timestamp */
  openTime: number;
}

/**
 * Entry level configuration for DCA
 */
export interface EntryLevel {
  /** RSI threshold to trigger this level */
  rsiThreshold: number;
  /** Size as percentage of total allocation */
  sizePercent: number;
  /** Whether this level is enabled */
  enabled: boolean;
}

/**
 * Take profit level configuration
 */
export interface TakeProfitLevel {
  /** Profit percentage to trigger this TP */
  profitPercent: number;
  /** Alternative RSI threshold to trigger (optional) */
  rsiThreshold?: number;
  /** Percentage of position to exit at this level */
  exitPercent: number;
}

/**
 * Strategy state machine phases
 */
export type RSIScalpPhase = 'SCANNING' | 'IN_POSITION' | 'COOLING_DOWN';

/**
 * Full strategy state
 */
export interface RSIScalpState {
  /** Current phase */
  phase: RSIScalpPhase;
  /** Active position (if any) */
  position?: ScalpPosition;
  /** Last calculated RSI value */
  lastRSI: number;
  /** Last calculated EMA value */
  emaValue: number;
  /** Timestamp of last completed trade */
  lastTradeTime?: number;
  /** Bars since last trade */
  barsSinceLastTrade: number;
  /** Number of trades today */
  dailyTrades: number;
  /** P&L for today */
  dailyPnL: number;
  /** Date string for daily reset (YYYY-MM-DD) */
  dailyResetDate: string;
}

/**
 * Strategy parameters
 */
export interface RSIScalpParams {
  // === RSI Settings ===
  /** RSI calculation period */
  rsiPeriod: number;

  // === Entry Levels (DCA) ===
  /** Entry levels for LONG and SHORT */
  entryLevels: {
    long: EntryLevel[];
    short: EntryLevel[];
  };

  // === Take Profit Levels ===
  /** Take profit configuration */
  takeProfitLevels: TakeProfitLevel[];

  // === Stop Loss ===
  /** Stop loss percentage from average entry */
  stopLossPercent: number;
  /** Enable trailing stop */
  useTrailingStop: boolean;
  /** Trailing stop percentage (if enabled) */
  trailingStopPercent: number;

  // === Trend Filter (EMA) ===
  /** Use EMA as trend filter */
  useTrendFilter: boolean;
  /** EMA period for trend filter */
  emaPeriod: number;

  // === Volume Filter ===
  /** Use volume filter */
  useVolumeFilter: boolean;
  /** Volume must be X times average */
  volumeMultiplier: number;
  /** Period for volume average */
  volumePeriod: number;

  // === Timing ===
  /** Timeframe in seconds */
  timeframe: number;
  /** Bars to wait after trade before new entry */
  cooldownBars: number;

  // === Risk Management ===
  /** Maximum trades per day */
  maxDailyTrades: number;
  /** Maximum daily loss percentage */
  maxDailyLossPercent: number;
  /** Maximum position size as percentage of capital */
  maxPositionSizePercent: number;

  // === Symbols ===
  /** Symbols to trade */
  symbols: string[];

  // === Confidence ===
  /** Minimum confidence to generate signal */
  minConfidence: number;
}

/**
 * Position metrics calculated in real-time
 */
export interface PositionMetrics {
  /** Weighted average entry price */
  averageEntry: number;
  /** Unrealized P&L in currency */
  unrealizedPnl: number;
  /** Unrealized P&L as percentage */
  unrealizedPnlPercent: number;
  /** Risk amount (distance to SL) */
  riskAmount: number;
  /** Current R multiple */
  currentR: number;
}

/**
 * Exit check result
 */
export interface ExitCheckResult {
  /** Action to take */
  action: 'PARTIAL_EXIT' | 'FULL_EXIT' | 'NONE';
  /** Percentage of position to exit */
  exitPercent: number;
  /** Reason for exit */
  reason: string;
  /** Which TP level triggered (if any) */
  tpLevel?: number;
}

/**
 * Trade setup ready for execution
 */
export interface RSIScalpTradeSetup {
  /** Trade direction */
  direction: 'CALL' | 'PUT';
  /** Entry price */
  entryPrice: number;
  /** Stop loss price */
  stopLoss: number;
  /** Take profit price (TP1) */
  takeProfit: number;
  /** Signal confidence (0-1) */
  confidence: number;
  /** Action type */
  action: 'ENTRY' | 'DCA' | 'PARTIAL_EXIT' | 'FULL_EXIT';
  /** Size as percentage of allocation */
  sizePercent: number;
  /** Metadata for logging */
  metadata: {
    rsi: number;
    ema: number;
    entryLevel?: number;
    tpLevel?: number;
    averageEntry?: number;
    unrealizedPnlPercent?: number;
    reason: string;
  };
}

/**
 * Indicator values snapshot
 */
export interface IndicatorSnapshot {
  rsi: number;
  ema: number;
  price: number;
  volume?: number;
  avgVolume?: number;
}
