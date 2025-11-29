/**
 * CryptoScalp Strategy v2 Types
 *
 * Advanced crypto scalping strategy with VWAP, ADX, ATR-based TP/SL,
 * Bollinger Bands, and volume confirmation.
 */

/**
 * VWAP bias direction
 */
export type VWAPBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

/**
 * ADX trend strength classification
 */
export type TrendStrength = 'NO_TREND' | 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';

/**
 * Bollinger Band zone
 */
export type BBZone = 'UPPER_EXTREME' | 'UPPER' | 'MIDDLE' | 'LOWER' | 'LOWER_EXTREME';

/**
 * Strategy state machine states
 */
export type CryptoScalpState = 'SCANNING' | 'IN_POSITION' | 'COOLING_DOWN';

/**
 * Trade direction
 */
export type Direction = 'CALL' | 'PUT';

/**
 * Entry signal for a trade
 */
export interface CryptoScalpEntrySignal {
  direction: Direction;
  price: number;
  timestamp: number;
  confidence: number;
  reason: string;
  indicators: {
    vwap: number;
    vwapBias: VWAPBias;
    adx: number;
    plusDI: number;
    minusDI: number;
    trendStrength: TrendStrength;
    atr: number;
    rsi: number;
    bbUpper: number;
    bbMiddle: number;
    bbLower: number;
    bbZone: BBZone;
    volumeRatio: number;
  };
  suggestedTP: number;
  suggestedSL: number;
  trailingStopActivation: number;
}

/**
 * Exit reason types
 */
export type ExitReason =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'SIGNAL_REVERSAL'
  | 'TIME_LIMIT'
  | 'MANUAL';

/**
 * Exit signal for closing a trade
 */
export interface CryptoScalpExitSignal {
  price: number;
  timestamp: number;
  reason: ExitReason;
  pnlPercent: number;
}

/**
 * DCA entry level configuration
 */
export interface DCALevel {
  /** Price deviation from entry to trigger this level (percent) */
  priceDeviationPct: number;
  /** Position size for this level (percent of total allocation) */
  sizePercent: number;
  /** Whether this level is enabled */
  enabled: boolean;
}

/**
 * Take profit level configuration
 */
export interface TakeProfitLevel {
  /** Profit percent to trigger this level */
  profitPercent: number;
  /** Percent of position to exit at this level */
  exitPercent: number;
  /** RSI threshold to trigger early exit (optional) */
  rsiThreshold?: number;
}

/**
 * VWAP configuration
 */
export interface VWAPConfig {
  /** Number of periods for VWAP calculation */
  periods: number;
  /** Distance threshold for bias determination (percent) */
  biasThreshold: number;
  /** Whether to use VWAP as entry filter */
  useAsFilter: boolean;
}

/**
 * ADX configuration
 */
export interface ADXConfig {
  /** ADX period */
  period: number;
  /** Threshold for "no trend" */
  noTrendThreshold: number;
  /** Threshold for "weak trend" */
  weakThreshold: number;
  /** Threshold for "strong trend" */
  strongThreshold: number;
  /** Threshold for "very strong trend" */
  veryStrongThreshold: number;
  /** Whether to filter entries by trend strength */
  useAsFilter: boolean;
  /** Minimum trend strength required for entry */
  minStrengthForEntry: TrendStrength;
}

/**
 * ATR configuration for dynamic TP/SL
 */
export interface ATRConfig {
  /** ATR period */
  period: number;
  /** Take profit multiplier (TP = ATR * multiplier) */
  tpMultiplier: number;
  /** Stop loss multiplier (SL = ATR * multiplier) */
  slMultiplier: number;
  /** Minimum TP percent (floor) */
  minTpPct: number;
  /** Maximum TP percent (ceiling) */
  maxTpPct: number;
  /** Minimum SL percent (floor) */
  minSlPct: number;
  /** Maximum SL percent (ceiling) */
  maxSlPct: number;
}

/**
 * Bollinger Bands configuration
 */
export interface BBConfig {
  /** BB period */
  period: number;
  /** Standard deviation multiplier */
  stdDev: number;
  /** Percent beyond bands to consider "extreme" */
  extremeThreshold: number;
  /** Use BB for entry signals */
  useForEntry: boolean;
  /** Use BB for exit signals */
  useForExit: boolean;
}

/**
 * Volume filter configuration
 */
export interface VolumeConfig {
  /** Period for volume SMA */
  smaPeriod: number;
  /** Minimum volume ratio vs SMA for entry */
  minRatioForEntry: number;
  /** High volume threshold (for stronger signals) */
  highVolumeThreshold: number;
  /** Whether volume filter is enabled */
  enabled: boolean;
}

/**
 * Trailing stop configuration
 */
export interface TrailingStopConfig {
  /** Whether trailing stop is enabled */
  enabled: boolean;
  /** Profit percent to activate trailing stop */
  activationPct: number;
  /** Trail distance (percent from highest PnL) */
  trailPct: number;
  /** Use ATR-based trailing instead of fixed percent */
  useATR: boolean;
  /** ATR multiplier for trail distance */
  atrMultiplier: number;
}

/**
 * RSI configuration
 */
export interface RSIConfig {
  /** RSI period */
  period: number;
  /** Oversold threshold for LONG entries */
  oversoldThreshold: number;
  /** Overbought threshold for SHORT entries */
  overboughtThreshold: number;
  /** Whether RSI is required for entry */
  useAsFilter: boolean;
}

/**
 * Main strategy parameters
 */
export interface CryptoScalpParams {
  // Core settings
  /** RSI configuration */
  rsi: RSIConfig;
  /** VWAP configuration */
  vwap: VWAPConfig;
  /** ADX configuration */
  adx: ADXConfig;
  /** ATR configuration */
  atr: ATRConfig;
  /** Bollinger Bands configuration */
  bb: BBConfig;
  /** Volume configuration */
  volume: VolumeConfig;
  /** Trailing stop configuration */
  trailingStop: TrailingStopConfig;

  // Entry configuration
  /** DCA entry levels */
  dcaLevels: DCALevel[];
  /** Minimum confidence score for entry */
  minConfidence: number;
  /** Require all indicators to align */
  requireAllIndicatorsAligned: boolean;

  // Exit configuration
  /** Take profit levels */
  takeProfitLevels: TakeProfitLevel[];
  /** Base stop loss percent (before ATR adjustment) */
  baseStopLossPct: number;

  // Risk management
  /** Cooldown bars after trade close */
  cooldownBars: number;
  /** Maximum bars to hold position */
  maxBarsInTrade: number;
  /** Maximum consecutive losses before pause */
  maxConsecutiveLosses: number;
  /** Pause duration after max losses (bars) */
  pauseDurationBars: number;

  // Session filters
  /** Trading hours (UTC) - empty means 24/7 */
  tradingHours: { start: number; end: number }[];
  /** Days to avoid (0=Sunday, 6=Saturday) */
  avoidDays: number[];
}

/**
 * Strategy state for tracking position and history
 */
export interface CryptoScalpStrategyState {
  state: CryptoScalpState;
  currentPosition: {
    direction: Direction;
    entryPrice: number;
    entryTimestamp: number;
    dcaLevel: number;
    averagePrice: number;
    totalSize: number;
    highestPnlPct: number;
    trailingStopPrice: number | null;
  } | null;
  lastTradeIndex: number;
  consecutiveLosses: number;
  pauseUntilIndex: number;
  indicatorValues: {
    vwap: number;
    adx: number;
    plusDI: number;
    minusDI: number;
    atr: number;
    rsi: number;
    bbUpper: number;
    bbMiddle: number;
    bbLower: number;
    volumeSMA: number;
  } | null;
}

/**
 * Trade result for backtesting
 */
export interface CryptoScalpTradeResult {
  entrySignal: CryptoScalpEntrySignal;
  exitSignal: CryptoScalpExitSignal;
  entryPrice: number;
  exitPrice: number;
  direction: Direction;
  pnl: number;
  pnlPercent: number;
  barsHeld: number;
  dcaLevelsUsed: number;
  maxDrawdownPct: number;
  maxProfitPct: number;
}

/**
 * Indicator snapshot at a point in time
 */
export interface CryptoScalpIndicators {
  timestamp: number;
  vwap: number;
  vwapBias: VWAPBias;
  adx: number;
  plusDI: number;
  minusDI: number;
  trendStrength: TrendStrength;
  atr: number;
  rsi: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbZone: BBZone;
  bbWidth: number;
  volume: number;
  volumeSMA: number;
  volumeRatio: number;
}
