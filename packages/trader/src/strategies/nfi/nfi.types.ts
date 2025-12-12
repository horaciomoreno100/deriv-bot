/**
 * NostalgiaForInfinity (NFI) Strategy Types
 *
 * Port of the legendary Freqtrade NFI strategy to Deriv.
 * Adapted for futures trading with mandatory stop loss.
 *
 * Original: https://github.com/iterativv/NostalgiaForInfinity
 */

/**
 * Entry mode tags - Each mode has specific entry conditions
 */
export type NFIEntryMode =
  | 'normal'      // Tags 1-13: Standard dip buying
  | 'pump'        // Tags 21-26: Momentum after pump detection
  | 'quick'       // Tags 41-53: Fast scalping entries
  | 'rebuy'       // Tags 61-62: DCA/averaging down
  | 'high_profit' // Tags 81-82: Large move potential
  | 'rapid'       // Tags 101-110: Ultra-fast entries
  | 'grind'       // Tag 120: Small consistent profits
  | 'top_coins'   // Tags 141-143: BTC/ETH specific
  | 'derisk';     // Tag 161: Risk-off mode

/**
 * Entry condition result with tag
 */
export interface NFIEntryCondition {
  tag: string;
  mode: NFIEntryMode;
  triggered: boolean;
  confidence: number;
  reasons: string[];
}

/**
 * Exit reason types
 */
export type NFIExitReason =
  | 'roi_target'        // Hit ROI target for current time
  | 'signal_exit'       // Technical exit signal
  | 'stop_loss'         // Hit stop loss
  | 'trailing_stop'     // Trailing stop triggered
  | 'time_limit'        // Max bars in trade
  | 'doom_mode'         // Emergency exit
  | 'derisk'            // Risk reduction exit
  | 'grind_profit'      // Small profit locked
  | 'manual';

/**
 * Exit signal with details
 */
export interface NFIExitSignal {
  shouldExit: boolean;
  reason: NFIExitReason;
  tag: string;
  profitPct: number;
  timeHeld: number;
}

/**
 * Multi-timeframe indicator values
 */
export interface NFIIndicators {
  // Current timeframe (5m)
  rsi_3: number;
  rsi_14: number;
  rsi_3_change: number;  // Rate of change
  stoch_rsi_k: number;
  stoch_rsi_d: number;
  ema_12: number;
  ema_26: number;
  ema_50: number;
  ema_200: number;
  sma_9: number;
  sma_200: number;
  bb_upper: number;
  bb_middle: number;
  bb_lower: number;
  bb_width: number;
  bb_delta: number;     // (middle - lower)
  close_delta: number;  // close change
  tail: number;         // |close - low|
  ewo: number;          // Elliott Wave Oscillator
  cti: number;          // Correlation Trend Indicator
  cmf: number;          // Chaikin Money Flow
  mfi: number;          // Money Flow Index
  williams_r: number;   // Williams %R
  cci: number;          // Commodity Channel Index
  roc_2: number;        // Rate of Change 2
  roc_9: number;        // Rate of Change 9
  atr: number;          // Average True Range
  adx: number;          // Average Directional Index

  // 15m timeframe
  rsi_3_15m: number;
  rsi_14_15m: number;
  ema_200_15m: number;
  cti_15m: number;
  cmf_15m: number;

  // 1h timeframe
  rsi_3_1h: number;
  rsi_14_1h: number;
  ema_50_1h: number;
  ema_200_1h: number;
  cti_1h: number;
  cmf_1h: number;
  ssl_up_1h: number;
  ssl_down_1h: number;

  // 4h timeframe
  rsi_14_4h: number;
  ema_200_4h: number;
  cti_4h: number;
  roc_9_4h: number;

  // 1d timeframe
  rsi_14_1d: number;
  ema_200_1d: number;
  cti_1d: number;

  // Derived
  is_downtrend: boolean;
  is_uptrend: boolean;
  pump_detected: boolean;
  dump_detected: boolean;
}

/**
 * Dynamic ROI configuration
 * Lower profit target as time increases
 */
export interface NFIDynamicROI {
  /** Minutes since entry -> minimum profit % to exit */
  [minutes: number]: number;
}

/**
 * Grinding/DCA level configuration
 */
export interface NFIGrindLevel {
  /** Price deviation to trigger this level (negative = loss) */
  deviation: number;
  /** Stake multiplier for this level */
  stakeMultiplier: number;
  /** Max entries at this level */
  maxEntries: number;
}

/**
 * Entry condition enable/disable configuration
 */
export interface NFIEntryConditionsConfig {
  // Normal mode (1-13)
  condition_1_enable: boolean;
  condition_2_enable: boolean;
  condition_3_enable: boolean;
  condition_4_enable: boolean;
  condition_5_enable: boolean;
  condition_6_enable: boolean;
  condition_7_enable: boolean;
  condition_8_enable: boolean;
  condition_9_enable: boolean;
  condition_10_enable: boolean;
  condition_11_enable: boolean;
  condition_12_enable: boolean;
  condition_13_enable: boolean;

  // Pump mode (21-26)
  condition_21_enable: boolean;
  condition_22_enable: boolean;
  condition_23_enable: boolean;
  condition_24_enable: boolean;
  condition_25_enable: boolean;
  condition_26_enable: boolean;

  // Quick mode (41-53)
  condition_41_enable: boolean;
  condition_42_enable: boolean;
  condition_43_enable: boolean;
  condition_44_enable: boolean;
  condition_45_enable: boolean;
  condition_46_enable: boolean;
  condition_47_enable: boolean;
  condition_48_enable: boolean;
  condition_49_enable: boolean;
  condition_50_enable: boolean;
  condition_51_enable: boolean;
  condition_52_enable: boolean;
  condition_53_enable: boolean;

  // Rebuy mode (61-62)
  condition_61_enable: boolean;
  condition_62_enable: boolean;

  // High profit mode (81-82)
  condition_81_enable: boolean;
  condition_82_enable: boolean;

  // Rapid mode (101-110)
  condition_101_enable: boolean;
  condition_102_enable: boolean;
  condition_103_enable: boolean;
  condition_104_enable: boolean;
  condition_105_enable: boolean;
  condition_106_enable: boolean;
  condition_107_enable: boolean;
  condition_108_enable: boolean;
  condition_109_enable: boolean;
  condition_110_enable: boolean;

  // Grind mode (120)
  condition_120_enable: boolean;

  // Top coins mode (141-143)
  condition_141_enable: boolean;
  condition_142_enable: boolean;
  condition_143_enable: boolean;

  // Derisk mode (161)
  condition_161_enable: boolean;
}

/**
 * Main NFI strategy parameters
 */
export interface NFIParams {
  /** Timeframe for primary analysis */
  timeframe: '5m';

  /** Entry conditions enable/disable */
  entryConditions: Partial<NFIEntryConditionsConfig>;

  /** RSI thresholds */
  rsi: {
    period?: number;            // 14 - RSI period
    oversold_extreme?: number;  // 20 - Very oversold
    oversold: number;           // 30 - Oversold
    neutral_low?: number;       // 40
    neutral_high?: number;      // 60
    overbought: number;         // 70 - Overbought
    overbought_extreme?: number; // 80 - Very overbought
  };

  /** Bollinger Bands */
  bb: {
    period: number;           // 20
    stdDev: number;           // 2.0
    deltaThreshold: number;   // 0.017 - BB delta threshold
    closeThreshold: number;   // 0.013 - Close delta threshold
    tailThreshold: number;    // 0.445 - Tail ratio threshold
  };

  /** EMA settings */
  ema: {
    fast: number;     // 12
    slow: number;     // 26
    mid: number;      // 50
    long: number;     // 200
    openMult: number; // 0.02 - EMA difference threshold
  };

  /** Elliott Wave Oscillator */
  ewo: {
    period_fast: number;   // 5
    period_slow: number;   // 35
    high_threshold?: number; // 2.0
    low_threshold?: number;  // -2.0
    bullish_threshold?: number; // Alternative name for low_threshold
    bearish_threshold?: number; // Alternative name for high_threshold
  };

  /** Dynamic ROI - time-based profit targets */
  dynamicROI: NFIDynamicROI;

  /** Stop Loss - MANDATORY for futures */
  stopLoss: {
    percentage: number;     // -0.05 (-5%) - Much tighter than NFI's -0.99
    useTrailing: boolean;
    trailingActivation: number;  // Profit % to activate trailing
    trailingDistance: number;    // Distance from peak
  };

  /** Grinding/DCA settings */
  grinding: {
    enabled: boolean;
    levels: NFIGrindLevel[];
    maxTotalEntries: number;
    minProfitToGrind: number;  // Minimum profit before enabling grind exit
  };

  /** Exit signal thresholds */
  exitSignals: {
    rsi_overbought: number;    // 78
    bb_overbought: boolean;    // Exit on upper BB touch
    stoch_overbought: number;  // 80
    use_signal_exits: boolean; // Enable/disable technical signal exits
  };

  /** Risk management */
  risk: {
    maxOpenTrades: number;
    maxBarsInTrade: number;
    cooldownBars: number;
    maxConsecutiveLosses: number;
    pauseBarsAfterMaxLosses: number;
  };

  /** Doom mode - Emergency protection */
  doomMode: {
    enabled: boolean;
    profitThreshold: number;  // 0.25 - Exit all if profit drops below this
    maxLoss: number;          // 0.05 - Exit immediately at this loss
  };

  /** Asset-specific overrides */
  assetOverrides?: Partial<NFIParams>;
}

/**
 * Strategy state
 */
export interface NFIState {
  /** Current phase */
  phase: 'SCANNING' | 'IN_POSITION' | 'COOLING_DOWN' | 'PAUSED';

  /** Current position if any */
  position: NFIPosition | null;

  /** Indicator cache */
  indicators: NFIIndicators | null;

  /** Last entry tag used */
  lastEntryTag: string | null;

  /** Bars since last trade */
  barsSinceTrade: number;

  /** Consecutive losses */
  consecutiveLosses: number;

  /** Pause until bar index */
  pauseUntilBar: number;

  /** Grinding state */
  grindingState: {
    entriesCount: number;
    totalStake: number;
    averagePrice: number;
    lastGrindBar: number;
  } | null;
}

/**
 * Position tracking
 */
export interface NFIPosition {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  entryTimestamp: number;
  entryTag: string;
  entryMode: NFIEntryMode;
  stake: number;
  barsHeld: number;
  highestPnl: number;
  lowestPnl: number;
  currentPnl: number;
  trailingStopPrice: number | null;
}

/**
 * Trade result for reporting
 */
export interface NFITradeResult {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  entryTag: string;
  exitReason: NFIExitReason;
  exitTag: string;
  pnlPct: number;
  barsHeld: number;
  grindEntries: number;
  maxDrawdown: number;
  maxProfit: number;
}

/**
 * Direction type
 */
export type Direction = 'CALL' | 'PUT';
