/**
 * Alpaca Markets API Client
 *
 * Provides access to:
 * - Real-time stock and crypto prices
 * - Historical bars with REAL volume data
 * - Order execution (paper and live)
 * - WebSocket streaming
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Alpaca = require('@alpacahq/alpaca-trade-api');

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  paper?: boolean; // default true for safety
}

export interface Bar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // REAL volume!
  vwap?: number;  // Volume Weighted Average Price
  tradeCount?: number;
}

export interface Quote {
  timestamp: Date;
  askPrice: number;
  askSize: number;
  bidPrice: number;
  bidSize: number;
}

export interface Trade {
  timestamp: Date;
  price: number;
  size: number;
  exchange: string;
}

export type Timeframe = '1Min' | '5Min' | '15Min' | '30Min' | '1Hour' | '4Hour' | '1Day' | '1Week' | '1Month';

export class AlpacaClient {
  private alpaca: any;
  private dataStream: any = null;

  constructor(config: AlpacaConfig) {
    this.alpaca = new Alpaca({
      keyId: config.keyId,
      secretKey: config.secretKey,
      paper: config.paper ?? true, // Default to paper for safety
    });
  }

  /**
   * Get account information
   */
  async getAccount(): Promise<any> {
    return this.alpaca.getAccount();
  }

  /**
   * Get historical bars for a STOCK symbol
   * Returns bars with REAL volume data
   */
  async getStockBars(
    symbol: string,
    timeframe: Timeframe,
    options: {
      start?: Date;
      end?: Date;
      limit?: number;
    } = {}
  ): Promise<Bar[]> {
    const start = options.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const end = options.end || new Date();

    const bars = await this.alpaca.getBarsV2(
      symbol,
      {
        start: start.toISOString(),
        end: end.toISOString(),
        timeframe: this.convertTimeframe(timeframe),
        limit: options.limit || 1000,
      }
    );

    const result: Bar[] = [];
    for await (const bar of bars) {
      result.push({
        timestamp: new Date(bar.Timestamp),
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume, // REAL volume!
        vwap: bar.VWAP,
        tradeCount: bar.TradeCount,
      });
    }

    return result;
  }

  /**
   * Get historical bars for a CRYPTO symbol
   * Returns bars with REAL volume data
   */
  async getCryptoBars(
    symbol: string, // e.g., 'BTC/USD', 'ETH/USD'
    timeframe: Timeframe,
    options: {
      start?: Date;
      end?: Date;
      limit?: number;
    } = {}
  ): Promise<Bar[]> {
    const start = options.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = options.end || new Date();

    const bars = await this.alpaca.getCryptoBars(
      symbol,
      {
        start: start.toISOString(),
        end: end.toISOString(),
        timeframe: this.convertTimeframe(timeframe),
        limit: options.limit || 1000,
      }
    );

    const result: Bar[] = [];
    for await (const bar of bars) {
      result.push({
        timestamp: new Date(bar.Timestamp),
        open: bar.Open,
        high: bar.High,
        low: bar.Low,
        close: bar.Close,
        volume: bar.Volume, // REAL volume!
        vwap: bar.VWAP,
        tradeCount: bar.TradeCount,
      });
    }

    return result;
  }

  /**
   * Get latest quote for a stock
   */
  async getStockQuote(symbol: string): Promise<Quote> {
    const quote = await this.alpaca.getLatestQuote(symbol);
    return {
      timestamp: new Date(quote.Timestamp),
      askPrice: quote.AskPrice,
      askSize: quote.AskSize,
      bidPrice: quote.BidPrice,
      bidSize: quote.BidSize,
    };
  }

  /**
   * Get latest trade for a stock
   */
  async getStockTrade(symbol: string): Promise<Trade> {
    const trade = await this.alpaca.getLatestTrade(symbol);
    return {
      timestamp: new Date(trade.Timestamp),
      price: trade.Price,
      size: trade.Size,
      exchange: trade.Exchange,
    };
  }

  /**
   * Subscribe to real-time stock data via WebSocket
   */
  subscribeStocks(
    symbols: string[],
    callbacks: {
      onTrade?: (trade: Trade & { symbol: string }) => void;
      onQuote?: (quote: Quote & { symbol: string }) => void;
      onBar?: (bar: Bar & { symbol: string }) => void;
    }
  ): void {
    this.dataStream = this.alpaca.data_stream_v2;

    this.dataStream.onConnect(() => {
      console.log('Connected to Alpaca data stream');

      if (callbacks.onTrade) {
        this.dataStream.subscribeForTrades(symbols);
      }
      if (callbacks.onQuote) {
        this.dataStream.subscribeForQuotes(symbols);
      }
      if (callbacks.onBar) {
        this.dataStream.subscribeForBars(symbols);
      }
    });

    if (callbacks.onTrade) {
      this.dataStream.onStockTrade((trade: any) => {
        callbacks.onTrade!({
          symbol: trade.Symbol,
          timestamp: new Date(trade.Timestamp),
          price: trade.Price,
          size: trade.Size,
          exchange: trade.Exchange,
        });
      });
    }

    if (callbacks.onQuote) {
      this.dataStream.onStockQuote((quote: any) => {
        callbacks.onQuote!({
          symbol: quote.Symbol,
          timestamp: new Date(quote.Timestamp),
          askPrice: quote.AskPrice,
          askSize: quote.AskSize,
          bidPrice: quote.BidPrice,
          bidSize: quote.BidSize,
        });
      });
    }

    if (callbacks.onBar) {
      this.dataStream.onStockBar((bar: any) => {
        callbacks.onBar!({
          symbol: bar.Symbol,
          timestamp: new Date(bar.Timestamp),
          open: bar.OpenPrice,
          high: bar.HighPrice,
          low: bar.LowPrice,
          close: bar.ClosePrice,
          volume: bar.Volume,
          vwap: bar.VWAP,
          tradeCount: bar.TradeCount,
        });
      });
    }

    this.dataStream.onError((err: Error) => {
      console.error('Alpaca stream error:', err);
    });

    this.dataStream.onDisconnect(() => {
      console.log('Disconnected from Alpaca data stream');
    });

    this.dataStream.connect();
  }

  /**
   * Subscribe to real-time crypto data via WebSocket
   */
  subscribeCrypto(
    symbols: string[],
    callbacks: {
      onTrade?: (trade: Trade & { symbol: string }) => void;
      onQuote?: (quote: Quote & { symbol: string }) => void;
      onBar?: (bar: Bar & { symbol: string }) => void;
    }
  ): void {
    this.dataStream = this.alpaca.crypto_stream_v2;

    this.dataStream.onConnect(() => {
      console.log('Connected to Alpaca crypto stream');

      if (callbacks.onTrade) {
        this.dataStream.subscribeForTrades(symbols);
      }
      if (callbacks.onQuote) {
        this.dataStream.subscribeForQuotes(symbols);
      }
      if (callbacks.onBar) {
        this.dataStream.subscribeForBars(symbols);
      }
    });

    if (callbacks.onTrade) {
      this.dataStream.onCryptoTrade((trade: any) => {
        callbacks.onTrade!({
          symbol: trade.Symbol,
          timestamp: new Date(trade.Timestamp),
          price: trade.Price,
          size: trade.Size,
          exchange: trade.Exchange,
        });
      });
    }

    if (callbacks.onQuote) {
      this.dataStream.onCryptoQuote((quote: any) => {
        callbacks.onQuote!({
          symbol: quote.Symbol,
          timestamp: new Date(quote.Timestamp),
          askPrice: quote.AskPrice,
          askSize: quote.AskSize,
          bidPrice: quote.BidPrice,
          bidSize: quote.BidSize,
        });
      });
    }

    if (callbacks.onBar) {
      this.dataStream.onCryptoBar((bar: any) => {
        callbacks.onBar!({
          symbol: bar.Symbol,
          timestamp: new Date(bar.Timestamp),
          open: bar.Open,
          high: bar.High,
          low: bar.Low,
          close: bar.Close,
          volume: bar.Volume,
          vwap: bar.VWAP,
          tradeCount: bar.TradeCount,
        });
      });
    }

    this.dataStream.onError((err: Error) => {
      console.error('Alpaca crypto stream error:', err);
    });

    this.dataStream.connect();
  }

  /**
   * Disconnect from WebSocket stream
   */
  disconnect(): void {
    if (this.dataStream) {
      this.dataStream.disconnect();
      this.dataStream = null;
    }
  }

  /**
   * Convert our timeframe format to Alpaca's format
   */
  private convertTimeframe(tf: Timeframe): string {
    const mapping: Record<Timeframe, string> = {
      '1Min': '1Min',
      '5Min': '5Min',
      '15Min': '15Min',
      '30Min': '30Min',
      '1Hour': '1Hour',
      '4Hour': '4Hour',
      '1Day': '1Day',
      '1Week': '1Week',
      '1Month': '1Month',
    };
    return mapping[tf];
  }

  // ============ Trading Methods ============

  /**
   * Place a market order
   */
  async placeMarketOrder(
    symbol: string,
    qty: number,
    side: 'buy' | 'sell'
  ): Promise<any> {
    return this.alpaca.createOrder({
      symbol,
      qty,
      side,
      type: 'market',
      time_in_force: 'day',
    });
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(
    symbol: string,
    qty: number,
    side: 'buy' | 'sell',
    limitPrice: number
  ): Promise<any> {
    return this.alpaca.createOrder({
      symbol,
      qty,
      side,
      type: 'limit',
      time_in_force: 'day',
      limit_price: limitPrice,
    });
  }

  /**
   * Get all open positions
   */
  async getPositions(): Promise<any[]> {
    return this.alpaca.getPositions();
  }

  /**
   * Close a position
   */
  async closePosition(symbol: string): Promise<any> {
    return this.alpaca.closePosition(symbol);
  }

  /**
   * Get all orders
   */
  async getOrders(status: 'open' | 'closed' | 'all' = 'open'): Promise<any[]> {
    return this.alpaca.getOrders({ status });
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<void> {
    return this.alpaca.cancelOrder(orderId);
  }
}
