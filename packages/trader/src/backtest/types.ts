/**
 * Unified Types for Backtest Engine
 *
 * This file contains all types shared across the backtest system.
 * It imports visualization types from @deriv-bot/shared to ensure
 * compatibility with the chart generator.
 */

import type { Candle } from '@deriv-bot/shared';
import type {
  MarketSnapshot,
  TradeWithContext,
  IndicatorSnapshot,
} from '@deriv-bot/shared';

// Re-export shared types for convenience
export type { Candle, MarketSnapshot, TradeWithContext, IndicatorSnapshot };

// =============================================================================
// CORE TRADING TYPES
// =============================================================================

export type Direction = 'CALL' | 'PUT';
export type TradeResult = 'WIN' | 'LOSS';
export type ExitReason = 'TP' | 'SL' | 'TRAILING_STOP' | 'TIMEOUT';

// =============================================================================
// BACKTEST CONFIGURATION
// =============================================================================

export interface BacktestConfig {
  asset: string;
  timeframe: number;
  initialBalance: number;
  stakeMode: 'fixed' | 'percentage';
  stakeAmount: number;
  stakePct: number;
  multiplier: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxBarsInTrade: number;
  useTrailingStop: boolean;
  trailingActivationPct?: number;
  trailingDistancePct?: number;
  cooldownBars: number;
  filters?: {
    sessionFilter?: boolean;
    newsFilter?: boolean;
    dayHourFilter?: boolean;
  };
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  asset: 'R_100',
  timeframe: 60,
  initialBalance: 1000,
  stakeMode: 'percentage',
  stakeAmount: 10,
  stakePct: 0.02,
  multiplier: 100,
  takeProfitPct: 0.005,
  stopLossPct: 0.003,
  maxBarsInTrade: 30,
  useTrailingStop: false,
  cooldownBars: 1,
};

// =============================================================================
// ENTRY SIGNAL
// =============================================================================

export interface EntrySignal {
  timestamp: number;
  direction: Direction;
  price: number;
  confidence: number;
  reason: string;
  strategyName: string;
  strategyVersion?: string;
  snapshot: MarketSnapshot;
  suggestedTpPct?: number;
  suggestedSlPct?: number;
}

// =============================================================================
// TRADE ENTRY
// =============================================================================

export interface TradeEntry {
  timestamp: number;
  direction: Direction;
  entryPrice: number;
  stake: number;
  tpPrice: number;
  slPrice: number;
  signal: EntrySignal;
}

// =============================================================================
// LEGACY TRADE (backward compatibility)
// =============================================================================

export interface Trade {
  timestamp: number;
  direction: Direction;
  entryPrice: number;
  stake: number;
  tpPrice: number;
  slPrice: number;
  exitTimestamp: number;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;
  pnlPct: number;
  result: TradeResult;
  barsHeld: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
}

// =============================================================================
// BACKTEST METRICS
// =============================================================================

export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgPnl: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  nearMisses: number;
  immediateReversals: number;
  avgBarsHeld: number;
  expectancy: number;
  sqn: number;
  equityCurve?: number[];
  peakEquity?: number;
}

// =============================================================================
// BACKTEST RESULT
// =============================================================================

export interface BacktestResult {
  asset: string;
  timeframe: number;
  strategyName: string;
  strategyVersion?: string;
  config: BacktestConfig;
  dateRange: {
    from: Date;
    to: Date;
    candleCount: number;
  };
  trades: TradeWithContext[];
  metrics: BacktestMetrics;
  candles: Candle[];
  indicatorSeries: Map<string, number[]>;
  monteCarlo?: MonteCarloResult;
  walkForward?: WalkForwardResult;
  oosTest?: OOSResult;
  executedAt: Date;
  executionTimeMs: number;
}

// =============================================================================
// ANALYSIS RESULTS
// =============================================================================

export interface DistributionStats {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  stdDev?: number;
}

export interface MonteCarloResult {
  simulations: number;
  original: { netPnl: number; maxDrawdown: number; maxDrawdownPct: number };
  distribution: {
    netPnl: DistributionStats;
    maxDrawdown: DistributionStats;
    maxDrawdownPct: DistributionStats;
    finalEquity: DistributionStats;
  };
  riskOfRuin: number;
  profitProbability: number;
  confidence95: { minProfit: number; maxProfit: number };
}

export interface WalkForwardWindow {
  windowNumber: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainTrades: number;
  testTrades: number;
  trainWinRate: number;
  testWinRate: number;
  trainNetPnl: number;
  testNetPnl: number;
  trainPF: number;
  testPF: number;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  totalTrainTrades: number;
  totalTestTrades: number;
  avgTrainWinRate: number;
  avgTestWinRate: number;
  totalTrainPnl: number;
  totalTestPnl: number;
  avgTrainPF: number;
  avgTestPF: number;
  winRateDegradation: number;
  pnlDegradation: number;
  consistencyScore: number;
  robustnessRatio: number;
}

export interface OOSMetrics {
  trades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdownPct: number;
}

export interface OOSResult {
  inSample: OOSMetrics;
  outOfSample: OOSMetrics;
  winRateDelta: number;
  pnlPerTradeDelta: number;
  isOverfit: boolean;
  overfitScore: number;
  recommendation: string;
}

// =============================================================================
// BACKTESTABLE STRATEGY INTERFACE
// =============================================================================

export interface BacktestableStrategy {
  name: string;
  version: string;
  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null;
  requiredIndicators(): string[];
  getDefaultConfig?(): Partial<BacktestConfig>;
}

// =============================================================================
// INDICATOR CONFIG
// =============================================================================

export type IndicatorName =
  | 'rsi' | 'bbUpper' | 'bbMiddle' | 'bbLower'
  | 'kcUpper' | 'kcMiddle' | 'kcLower' | 'atr'
  | 'sma' | 'ema' | 'ema20' | 'macd' | 'macdSignal' | 'macdHistogram'
  | 'adx' | 'plusDI' | 'minusDI' | 'stochK' | 'stochD'
  | 'obv' | 'vwap' | 'momentum' | 'squeezeOn' | 'squeezeHistogram'
  | 'zigzagHigh' | 'zigzagLow' | 'zigzagType' | 'lastSwingHigh' | 'lastSwingLow'
  | 'lastSwingHighIdx' | 'lastSwingLowIdx';

export interface IndicatorConfig {
  rsiPeriod?: number;
  bbPeriod?: number;
  bbStdDev?: number;
  kcPeriod?: number;
  kcMultiplier?: number;
  atrPeriod?: number;
  smaPeriod?: number;
  emaPeriod?: number;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  adxPeriod?: number;
  stochKPeriod?: number;
  stochDPeriod?: number;
  zigzagDeviation?: number;
  zigzagDepth?: number;
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  rsiPeriod: 14,
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  atrPeriod: 14,
  smaPeriod: 20,
  emaPeriod: 20,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  adxPeriod: 14,
  stochKPeriod: 14,
  stochDPeriod: 3,
  zigzagDeviation: 0.3,
  zigzagDepth: 5,
};

// =============================================================================
// EVENT TYPES
// =============================================================================

export type BacktestEventType = 'candle' | 'signal' | 'entry' | 'exit' | 'trade_complete';

export interface BacktestEvent {
  type: BacktestEventType;
  timestamp: number;
  data: unknown;
}

export interface CandleEvent extends BacktestEvent {
  type: 'candle';
  data: { candle: Candle; index: number; indicators: IndicatorSnapshot };
}

export interface SignalEvent extends BacktestEvent {
  type: 'signal';
  data: EntrySignal;
}

export interface EntryEvent extends BacktestEvent {
  type: 'entry';
  data: { tradeId: string; entry: TradeEntry; snapshot: MarketSnapshot };
}

export interface ExitEvent extends BacktestEvent {
  type: 'exit';
  data: { tradeId: string; exitPrice: number; exitReason: ExitReason; snapshot: MarketSnapshot };
}

export interface TradeCompleteEvent extends BacktestEvent {
  type: 'trade_complete';
  data: TradeWithContext;
}
