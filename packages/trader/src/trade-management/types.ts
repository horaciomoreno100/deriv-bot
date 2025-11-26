/**
 * Types for Trade Management System
 */

export interface Trade {
  contractId: string;
  asset: string;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  timestamp: number;
  closed: boolean;
  stake?: number;
  mode?: 'binary' | 'cfd';
  metadata?: {
    tpPct?: number;
    slPct?: number;
    recovered?: boolean;
    protectModeActive?: boolean;      // Flag: Breakeven protection activated (profit reached 1R)
    protectModeActivatedAt?: number;  // Timestamp when protect mode was activated
    [key: string]: any;
  };
}

export interface TrailingStopInfo {
  contractId: string;
  asset: string;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  currentTP: number;
  highestProfit: number;
  isTrailingActive: boolean;
  trailingActivatedAt?: number;
}

export interface SmartExitConfig {
  maxTradeDuration: number;        // 40 minutes
  extremeMaxDuration: number;       // 120 minutes
  minTradeDuration: number;         // 1 minute
  earlyExitTpPct: number;          // 75% of TP
  stagnationDuration: number;       // 15 minutes - duration for stagnation exit
  stagnationMinProfit: number;      // 0.1% - minimum profit for stagnation exit
  breakevenEnabled: boolean;        // Enable breakeven protection (1R lock-in)
}

export interface TrailingStopConfig {
  activationThreshold: number;      // 20% of TP
  buffer: number;                   // 0.1%
}

export interface RiskConfig {
  maxOpenTrades: number;            // Global limit (3)
  maxTradesPerSymbol: number;       // Per-symbol limit (1)
  riskPercentageCFD: number;        // 2%
  riskPercentageBinary: number;     // 1%
  minStake: number;                 // $1
  maxStake: number;                 // $500 max per trade
  maxStakePercentage: number;       // 10% of balance

  // Daily Loss Limit (Backtest-optimized)
  dailyLossLimitPct: number;        // 5% - Max loss per day before pausing
  dailyLossLimitEnabled: boolean;   // Enable/disable daily loss limit
}

/**
 * Daily trading statistics for loss limit tracking
 */
export interface DailyTradingStats {
  date: string;                     // YYYY-MM-DD format
  startBalance: number;             // Balance at start of day
  currentLoss: number;              // Total losses today
  tradesExecuted: number;           // Number of trades today
  tradesPaused: number;             // Signals skipped due to limit
  limitReached: boolean;            // Whether limit was hit today
}

export interface ExitSignal {
  shouldExit: boolean;
  reason: string;
  contractId: string;
  profitPct: number;
  timeInTrade: number;
}

export interface PositionUpdate {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number;
  currentPrice: number;
  profit: number;
  profitPercentage: number;
  purchaseTime: Date;
  status: 'open' | 'sold';
  multiplier?: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface ClosedPositionDetails {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  profitPercentage: number;
  purchaseTime: Date;
  sellTime: Date;
  duration: number;
  durationUnit: string;
  transactionId: string;
  longcode?: string;
}
