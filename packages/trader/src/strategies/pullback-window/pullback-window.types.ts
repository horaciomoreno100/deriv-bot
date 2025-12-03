/**
 * Pullback Window Strategy Types
 *
 * State machine-based scalping strategy that:
 * 1. Detects EMA crossovers (SCANNING)
 * 2. Waits for pullback against trend (ARMED)
 * 3. Opens entry window at breakout level (WINDOW_OPEN)
 * 4. Enters on breakout confirmation (ENTRY)
 */

/**
 * Trading phases in the state machine
 */
export enum TradingPhase {
  SCANNING = 'SCANNING',         // Looking for EMA crossover
  ARMED = 'ARMED',               // Waiting for pullback
  WINDOW_OPEN = 'WINDOW_OPEN',   // Waiting for breakout
  ENTRY = 'ENTRY',               // Signal confirmed
}

/**
 * Trade direction
 */
export type TradeDirection = 'LONG' | 'SHORT' | null;

/**
 * State machine state
 */
export interface PhaseState {
  phase: TradingPhase;
  direction: TradeDirection;
  pullbackCount: number;
  windowStart: number | null;         // Index when window opened
  windowCandlesRemaining: number;     // Candles left in window
  breakoutLevel: number | null;       // Price level to break for entry
  invalidationLevel: number | null;   // Price level that invalidates setup
  armingCandle: number | null;        // Index when phase went to ARMED
  pullbackHigh: number | null;        // Highest price during pullback (for LONG)
  pullbackLow: number | null;         // Lowest price during pullback (for SHORT)
}

/**
 * Strategy parameters
 */
export interface PullbackWindowParams {
  // EMAs for trend detection
  emaConfirmPeriod: number;      // 1 (fast confirmation EMA)
  emaFastPeriod: number;         // 14
  emaMediumPeriod: number;       // 18
  emaSlowPeriod: number;         // 24

  // Pullback settings
  longPullbackMaxCandles: number;    // Max pullback candles for LONG (default: 3)
  shortPullbackMaxCandles: number;   // Max pullback candles for SHORT (default: 3)
  minPullbackCandles: number;        // Min pullback before opening window (default: 1)

  // Window settings
  longEntryWindowPeriods: number;    // How many candles window stays open for LONG (default: 2)
  shortEntryWindowPeriods: number;   // How many candles window stays open for SHORT (default: 2)
  windowOffsetMultiplier: number;    // ATR multiplier for breakout offset (default: 1.0)

  // Risk management (ATR-based)
  slAtrMultiplier: number;       // Stop loss = ATR * multiplier (default: 2.5)
  tpAtrMultiplier: number;       // Take profit = ATR * multiplier (default: 8.0)

  // Filters
  minAdx: number;                // Minimum ADX for trend strength (default: 20)
  atrPeriod: number;             // ATR period for calculations (default: 14)

  // Session filters (optional)
  tradingHours: Array<{ start: string; end: string }>;
  avoidDays: number[];           // Days to avoid (0=Sunday, 6=Saturday)
}

/**
 * Signal metadata for debugging and logging
 */
export interface PullbackWindowSignalMetadata {
  phase: TradingPhase;
  pullbackCandles: number;
  breakoutLevel: number;
  invalidationLevel: number;
  atr: number;
  slPrice: number;
  tpPrice: number;
  adx?: number;
  ema1?: number;
  ema14?: number;
  ema18?: number;
  ema24?: number;
  [key: string]: unknown; // Index signature for compatibility with Record<string, unknown>
}

/**
 * Phase transition reason (for logging)
 */
export interface PhaseTransition {
  from: TradingPhase;
  to: TradingPhase;
  reason: string;
  candleIndex: number;
  price: number;
}
