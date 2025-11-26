/**
 * Market data types for Deriv API
 */

/**
 * Represents a single tick/price point
 */
export interface Tick {
  /** Asset symbol (e.g., "R_100", "frxEURUSD") */
  asset: string;
  /** Price value */
  price: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Price direction: 1 (up), -1 (down), 0 (neutral) */
  direction?: number;
}

/**
 * Represents an OHLC candle
 */
export interface Candle {
  /** Asset symbol */
  asset: string;
  /** Timeframe in seconds (60, 300, 900, 3600, etc.) */
  timeframe: number;
  /** Candle start time (Unix timestamp in seconds) */
  timestamp: number;
  /** Opening price */
  open: number;
  /** Highest price */
  high: number;
  /** Lowest price */
  low: number;
  /** Closing price */
  close: number;
  /** Volume (if available) */
  volume?: number;
}

/**
 * Trading symbol information
 */
export interface Symbol {
  /** Symbol identifier (e.g., "R_100") */
  symbol: string;
  /** Display name (e.g., "Volatility 100 Index") */
  displayName: string;
  /** Market category (forex, synthetic_index, etc.) */
  market: string;
  /** Submarket (major_pairs, random_index, etc.) */
  submarket: string;
  /** Whether trading is currently allowed */
  isTradingAllowed: boolean;
  /** Whether market is currently open */
  isOpen: boolean;
  /** Pip size for this symbol */
  pipSize: number;
}

/**
 * Balance information
 */
export interface Balance {
  /** Current balance */
  amount: number;
  /** Currency code (USD, EUR, etc.) */
  currency: string;
  /** Account type (demo, real) */
  accountType: 'demo' | 'real';
  /** Login ID (e.g., "VRT1234567" for demo, "CR1234567" for real) */
  loginid?: string;
  /** Timestamp */
  timestamp: number;
}
