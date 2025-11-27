/**
 * Visualization types for backtest and live trading analysis
 *
 * These types capture the complete context of a trade for visual debugging:
 * - What were the indicator values at signal, entry, and exit?
 * - How much latency/slippage occurred (live only)?
 * - What was the market state at each moment?
 */

import type { Candle } from './market.js';
import type { ContractDirection } from './trade.js';

/**
 * Complete snapshot of market state at a specific moment
 * Used to capture indicator values and price at signal/entry/exit
 */
export interface MarketSnapshot {
  /** Unix timestamp in milliseconds */
  timestamp: number;

  /** The candle this snapshot corresponds to */
  candle: {
    /** Candle index in the series */
    index: number;
    /** Candle start timestamp (seconds) */
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
  };

  /** Current price at this exact moment */
  price: number;

  /** Indicator values at this moment */
  indicators: IndicatorSnapshot;
}

/**
 * All indicator values at a specific moment
 */
export interface IndicatorSnapshot {
  // RSI
  rsi?: number;

  // Bollinger Bands
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  bbWidth?: number;
  bbPercentB?: number; // Where price is within bands (0-1)

  // Keltner Channels
  kcUpper?: number;
  kcMiddle?: number;
  kcLower?: number;

  // Squeeze
  squeezeOn?: boolean;
  squeezeHistogram?: number; // Momentum histogram value

  // ATR
  atr?: number;
  atrPercent?: number; // ATR as % of price

  // Moving Averages
  ema20?: number;
  ema50?: number;
  sma20?: number;
  sma50?: number;

  // MACD
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;

  // Stochastic
  stochK?: number;
  stochD?: number;

  // ADX
  adx?: number;
  plusDI?: number;
  minusDI?: number;

  // Custom/strategy-specific
  [key: string]: number | boolean | undefined;
}

/**
 * Signal information with full context
 */
export interface SignalWithContext {
  /** Market state when signal was generated */
  snapshot: MarketSnapshot;

  /** Trade direction */
  direction: ContractDirection;

  /** Confidence level (0-100) */
  confidence: number;

  /** Human-readable reason */
  reason: string;

  /** Strategy that generated this signal */
  strategyName: string;

  /** Strategy version for reproducibility */
  strategyVersion?: string;
}

/**
 * Entry execution details
 */
export interface EntryWithContext {
  /** Market state at entry execution */
  snapshot: MarketSnapshot;

  /** Price requested (from signal) */
  requestedPrice: number;

  /** Price actually filled */
  executedPrice: number;

  /** Time from signal to execution (ms) - only for live */
  latencyMs: number;

  /** Price difference (executed - requested) */
  slippage: number;

  /** Slippage as percentage */
  slippagePct: number;

  /** Stake amount */
  stake: number;

  /** Take profit price */
  tpPrice: number;

  /** Stop loss price */
  slPrice: number;

  /** Take profit percentage */
  tpPct: number;

  /** Stop loss percentage */
  slPct: number;
}

/**
 * Exit execution details
 */
export interface ExitWithContext {
  /** Market state at exit */
  snapshot: MarketSnapshot;

  /** Exit reason */
  reason: 'TP' | 'SL' | 'TRAILING_STOP' | 'MANUAL' | 'TIMEOUT' | 'SIGNAL';

  /** Price actually filled */
  executedPrice: number;

  /** Time from entry to exit (ms) */
  durationMs: number;
}

/**
 * Complete trade with all context for visualization
 *
 * This is the main type for chart visualization - contains everything
 * needed to understand what happened and why
 */
export interface TradeWithContext {
  /** Unique trade identifier */
  id: string;

  /** Asset traded */
  asset: string;

  /** Trade direction */
  direction: ContractDirection;

  /** Source of this trade data */
  source: 'backtest' | 'demo' | 'live';

  /** Correlation ID to link signal → entry → exit */
  correlationId: string;

  /** Signal that triggered this trade */
  signal: SignalWithContext;

  /** Entry execution */
  entry: EntryWithContext;

  /** Exit execution (null if trade still open) */
  exit: ExitWithContext | null;

  /** Trade result */
  result: {
    /** Profit/loss in currency */
    pnl: number;

    /** Profit/loss as percentage */
    pnlPct: number;

    /** WIN or LOSS */
    outcome: 'WIN' | 'LOSS' | 'OPEN';

    /** Maximum favorable excursion (best unrealized P/L) */
    maxFavorable: number;
    maxFavorablePct: number;

    /** Maximum adverse excursion (worst unrealized P/L) */
    maxAdverse: number;
    maxAdversePct: number;
  };
}

/**
 * Chart annotation for visual markers
 */
export interface ChartAnnotation {
  /** Type of annotation */
  type: 'signal' | 'entry' | 'exit' | 'indicator_trigger';

  /** X position (candle timestamp in seconds) */
  x: number;

  /** Y position (price level) */
  y: number;

  /** Display text */
  text: string;

  /** Arrow/marker direction */
  arrowDirection: 'up' | 'down' | 'none';

  /** Color */
  color: string;

  /** Associated trade ID */
  tradeId?: string;

  /** Full tooltip data */
  tooltip: {
    title: string;
    timestamp: string;
    price: string;
    indicators: Array<{
      name: string;
      value: string;
      status: 'normal' | 'trigger' | 'warning';
    }>;
    details: string[];
  };
}

/**
 * Complete data for chart visualization
 */
export interface ChartVisualizationData {
  /** Asset symbol */
  asset: string;

  /** Timeframe in seconds */
  timeframe: number;

  /** Title for the chart */
  title: string;

  /** Candle data */
  candles: Candle[];

  /** Trades with full context */
  trades: TradeWithContext[];

  /** Annotations for markers */
  annotations: ChartAnnotation[];

  /** Indicator series for plotting */
  indicatorSeries: {
    /** Series name (e.g., "bbUpper", "rsi") */
    name: string;
    /** Data points: [timestamp, value] */
    data: Array<[number, number]>;
    /** Which panel to plot on (main chart or separate) */
    panel: 'main' | 'oscillator' | 'volume';
    /** Line color */
    color: string;
    /** Line style */
    style: 'solid' | 'dashed' | 'dotted';
  }[];

  /** Summary statistics */
  summary: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    avgLatencyMs?: number;
    avgSlippagePct?: number;
    maxDrawdown: number;
    profitFactor: number;
  };
}
