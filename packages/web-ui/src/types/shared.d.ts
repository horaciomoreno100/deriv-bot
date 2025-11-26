/**
 * Type declarations for @deriv-bot/shared
 * Temporary until we can properly import from shared package
 */

declare module '@deriv-bot/shared' {
  export interface Tick {
    asset: string;
    price: number;
    timestamp: number;
  }

  export interface Candle {
    asset: string;
    timeframe: number;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }

  export interface Balance {
    amount: number;
    currency: string;
  }

  export interface Symbol {
    symbol: string;
    displayName: string;
    market: string;
    submarket: string;
  }
}
