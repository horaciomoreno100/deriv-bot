/**
 * Binance API Client
 *
 * Provides access to:
 * - Real-time crypto prices with REAL volume
 * - Historical klines/candles with REAL volume
 * - Order book depth (DOM)
 * - Order execution (spot and futures)
 * - WebSocket streaming
 *
 * NO API KEY needed for public data (prices, volume, order book)
 * API KEY needed only for trading
 */

import {
  MainClient,
  USDMClient,
  WebsocketClient,
  type Kline,
  type KlineInterval,
  type OrderBookResponse,
} from 'binance';

export interface BinanceConfig {
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean; // Use testnet for paper trading
}

export interface Bar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // REAL volume!
  quoteVolume: number; // Volume in quote currency (USDT)
  trades: number; // Number of trades
  takerBuyVolume: number; // Taker buy base asset volume
  takerBuyQuoteVolume: number; // Taker buy quote asset volume
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  lastUpdateId: number;
  bids: OrderBookLevel[]; // Buy orders
  asks: OrderBookLevel[]; // Sell orders
}

export interface Trade {
  id: number;
  price: number;
  quantity: number;
  quoteQuantity: number;
  time: Date;
  isBuyerMaker: boolean;
}

export type Timeframe =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '8h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M';

export class BinanceClient {
  private spot: MainClient;
  private futures: USDMClient;
  private ws: WebsocketClient | null = null;
  private config: BinanceConfig;

  constructor(config: BinanceConfig = {}) {
    this.config = config;

    // Spot client (for spot trading and data)
    this.spot = new MainClient({
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      beautifyResponses: true,
    });

    // Futures client (USDT-M futures)
    this.futures = new USDMClient({
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      beautifyResponses: true,
    });
  }

  // ============ PUBLIC DATA (No API Key Required) ============

  /**
   * Get historical klines/candles for SPOT
   * Returns bars with REAL volume data
   */
  async getSpotKlines(
    symbol: string, // e.g., 'BTCUSDT', 'ETHUSDT'
    timeframe: Timeframe,
    options: {
      startTime?: Date;
      endTime?: Date;
      limit?: number; // max 1000
    } = {}
  ): Promise<Bar[]> {
    const klines = await this.spot.getKlines({
      symbol: symbol.toUpperCase(),
      interval: timeframe as KlineInterval,
      startTime: options.startTime?.getTime(),
      endTime: options.endTime?.getTime(),
      limit: options.limit || 500,
    });

    return this.parseKlines(klines as Kline[]);
  }

  /**
   * Get historical klines/candles for FUTURES
   * Returns bars with REAL volume data
   */
  async getFuturesKlines(
    symbol: string, // e.g., 'BTCUSDT', 'ETHUSDT'
    timeframe: Timeframe,
    options: {
      startTime?: Date;
      endTime?: Date;
      limit?: number; // max 1500
    } = {}
  ): Promise<Bar[]> {
    const klines = await this.futures.getKlines({
      symbol: symbol.toUpperCase(),
      interval: timeframe as KlineInterval,
      startTime: options.startTime?.getTime(),
      endTime: options.endTime?.getTime(),
      limit: options.limit || 500,
    });

    return this.parseKlines(klines as Kline[]);
  }

  /**
   * Get order book depth (DOM)
   * Shows real buy/sell orders at each price level
   */
  async getOrderBook(
    symbol: string,
    limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 20
  ): Promise<OrderBook> {
    const book = (await this.spot.getOrderBook({
      symbol: symbol.toUpperCase(),
      limit,
    })) as OrderBookResponse;

    return {
      lastUpdateId: book.lastUpdateId,
      bids: book.bids.map((b) => ({
        price: parseFloat(String(b[0])),
        quantity: parseFloat(String(b[1])),
      })),
      asks: book.asks.map((a) => ({
        price: parseFloat(String(a[0])),
        quantity: parseFloat(String(a[1])),
      })),
    };
  }

  /**
   * Get recent trades
   */
  async getRecentTrades(symbol: string, limit: number = 500): Promise<Trade[]> {
    const trades = await this.spot.getRecentTrades({
      symbol: symbol.toUpperCase(),
      limit,
    });

    return trades.map((t) => ({
      id: t.id,
      price: parseFloat(String(t.price)),
      quantity: parseFloat(String(t.qty)),
      quoteQuantity: parseFloat(String(t.quoteQty)),
      time: new Date(t.time),
      isBuyerMaker: t.isBuyerMaker,
    }));
  }

  /**
   * Get current price
   */
  async getPrice(symbol: string): Promise<number> {
    const ticker = await this.spot.getSymbolPriceTicker({ symbol: symbol.toUpperCase() });
    if (Array.isArray(ticker)) {
      return parseFloat(String(ticker[0].price));
    }
    return parseFloat(String(ticker.price));
  }

  /**
   * Get 24h ticker with volume
   */
  async get24hTicker(symbol: string): Promise<{
    symbol: string;
    priceChange: number;
    priceChangePercent: number;
    lastPrice: number;
    volume: number;
    quoteVolume: number;
    trades: number;
  }> {
    const ticker = await this.spot.get24hrChangeStatististics({ symbol: symbol.toUpperCase() });
    const t = Array.isArray(ticker) ? ticker[0] : ticker;

    return {
      symbol: t.symbol,
      priceChange: parseFloat(String(t.priceChange)),
      priceChangePercent: parseFloat(String(t.priceChangePercent)),
      lastPrice: parseFloat(String(t.lastPrice)),
      volume: parseFloat(String(t.volume)),
      quoteVolume: parseFloat(String(t.quoteVolume)),
      trades: t.count,
    };
  }

  // ============ WEBSOCKET STREAMING ============

  /**
   * Subscribe to real-time kline updates
   */
  subscribeKlines(
    symbol: string,
    timeframe: Timeframe,
    callback: (bar: Bar) => void
  ): void {
    if (!this.ws) {
      this.ws = new WebsocketClient({
        api_key: this.config.apiKey,
        api_secret: this.config.apiSecret,
        beautify: true,
      });

      this.ws.on('error', (err) => {
        console.error('Binance WS error:', err);
      });
    }

    this.ws.on('formattedMessage' as any, (data: any) => {
      if (data.eventType !== 'kline') return;
      if (data.symbol === symbol.toUpperCase() && data.kline.interval === timeframe) {
        const k = data.kline;
        callback({
          timestamp: new Date(k.startTime),
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: parseFloat(k.volume),
          quoteVolume: parseFloat(k.quoteVolume),
          trades: k.trades,
          takerBuyVolume: parseFloat(k.takerBuyBaseAssetVolume),
          takerBuyQuoteVolume: parseFloat(k.takerBuyQuoteAssetVolume),
        });
      }
    });

    this.ws.subscribeSpotKline(symbol.toUpperCase(), timeframe);
  }

  /**
   * Subscribe to real-time trades
   */
  subscribeTrades(
    symbol: string,
    callback: (trade: Trade) => void
  ): void {
    if (!this.ws) {
      this.ws = new WebsocketClient({
        api_key: this.config.apiKey,
        api_secret: this.config.apiSecret,
        beautify: true,
      });
    }

    this.ws.on('formattedMessage' as any, (data: any) => {
      if (data.eventType !== 'trade') return;
      if (data.symbol === symbol.toUpperCase()) {
        callback({
          id: data.tradeId,
          price: parseFloat(data.price),
          quantity: parseFloat(data.quantity),
          quoteQuantity: parseFloat(data.price) * parseFloat(data.quantity),
          time: new Date(data.time),
          isBuyerMaker: data.isBuyerMaker,
        });
      }
    });

    this.ws.subscribeSpotTrades(symbol.toUpperCase());
  }

  /**
   * Subscribe to order book updates
   */
  subscribeOrderBook(
    symbol: string,
    callback: (book: OrderBook) => void
  ): void {
    if (!this.ws) {
      this.ws = new WebsocketClient({
        api_key: this.config.apiKey,
        api_secret: this.config.apiSecret,
        beautify: true,
      });
    }

    this.ws.on('formattedMessage' as any, (data: any) => {
      if (data.eventType !== 'partialBookDepth') return;
      if (data.symbol === symbol.toUpperCase()) {
        callback({
          lastUpdateId: data.lastUpdateId,
          bids: data.bids.map((b: any) => ({
            price: parseFloat(b[0]),
            quantity: parseFloat(b[1]),
          })),
          asks: data.asks.map((a: any) => ({
            price: parseFloat(a[0]),
            quantity: parseFloat(a[1]),
          })),
        });
      }
    });

    this.ws.subscribeSpotPartialBookDepth(symbol.toUpperCase(), 20, 100);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.closeAll();
      this.ws = null;
    }
  }

  // ============ TRADING (Requires API Key) ============

  /**
   * Get account balances
   */
  async getBalances(): Promise<{ asset: string; free: number; locked: number }[]> {
    const account = await this.spot.getAccountInformation();
    return account.balances
      .filter((b) => parseFloat(String(b.free)) > 0 || parseFloat(String(b.locked)) > 0)
      .map((b) => ({
        asset: b.asset,
        free: parseFloat(String(b.free)),
        locked: parseFloat(String(b.locked)),
      }));
  }

  /**
   * Place a market order
   */
  async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<any> {
    return this.spot.submitNewOrder({
      symbol: symbol.toUpperCase(),
      side,
      type: 'MARKET',
      quantity,
    });
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number
  ): Promise<any> {
    return this.spot.submitNewOrder({
      symbol: symbol.toUpperCase(),
      side,
      type: 'LIMIT',
      quantity,
      price,
      timeInForce: 'GTC',
    });
  }

  /**
   * Cancel an order
   */
  async cancelOrder(symbol: string, orderId: number): Promise<any> {
    return this.spot.cancelOrder({
      symbol: symbol.toUpperCase(),
      orderId,
    });
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol?: string): Promise<any[]> {
    return this.spot.getOpenOrders({ symbol: symbol?.toUpperCase() });
  }

  // ============ HELPERS ============

  private parseKlines(klines: Kline[]): Bar[] {
    return klines.map((k) => ({
      timestamp: new Date(k[0] as number),
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string), // REAL volume!
      quoteVolume: parseFloat(k[7] as string),
      trades: k[8] as number,
      takerBuyVolume: parseFloat(k[9] as string),
      takerBuyQuoteVolume: parseFloat(k[10] as string),
    }));
  }
}
