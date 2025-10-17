import WebSocket from 'ws';
import type { Tick, Symbol, Balance, Candle } from '@deriv-bot/shared';

/**
 * Configuration for DerivClient
 */
export interface DerivClientConfig {
  /** App ID from Deriv */
  appId: number;
  /** WebSocket endpoint */
  endpoint?: string;
  /** API token for authenticated requests */
  apiToken?: string;
  /** Keep-alive interval in ms */
  keepAliveInterval?: number;
}

/**
 * Subscription object
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string;
  /** Callback function */
  callback: (data: any) => void;
}

/**
 * DerivClient - WebSocket client for Deriv API
 *
 * Handles connection, subscriptions, and message routing.
 *
 * @example
 * ```typescript
 * const client = new DerivClient({
 *   appId: 1089,
 *   endpoint: 'wss://ws.derivws.com/websockets/v3'
 * });
 *
 * await client.connect();
 *
 * const symbols = await client.getActiveSymbols();
 * console.log(symbols);
 * ```
 */
export class DerivClient {
  private config: Required<DerivClientConfig>;
  private ws: WebSocket | null = null;
  private connected = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, Subscription>();
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
  }>();
  private requestId = 0;

  constructor(config: DerivClientConfig) {
    this.config = {
      appId: config.appId,
      endpoint: config.endpoint || 'wss://ws.derivws.com/websockets/v3',
      apiToken: config.apiToken || '',
      keepAliveInterval: config.keepAliveInterval || 60000, // 60 seconds
    };
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to Deriv WebSocket API
   *
   * @throws {Error} If connection fails
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Use existing ws if already set (for testing)
      if (!this.ws) {
        const url = `${this.config.endpoint}?app_id=${this.config.appId}`;
        this.ws = new WebSocket(url);
      }

      this.ws.on('open', async () => {
        this.connected = true;
        this.startKeepAlive();

        // Auto-authorize if token is provided
        console.log('[DerivClient] API Token configured:', this.config.apiToken ? 'YES' : 'NO');
        if (this.config.apiToken) {
          try {
            console.log('[DerivClient] Attempting authorization...');
            await this.authorize(this.config.apiToken);
            console.log('[DerivClient] ✅ Authorized successfully');
          } catch (error) {
            console.error('[DerivClient] ❌ Authorization failed:', error);
          }
        } else {
          console.warn('[DerivClient] ⚠️  No API token configured - running without authorization');
        }

        resolve();
      });

      this.ws.on('error', (error) => {
        this.connected = false;
        reject(error);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.stopKeepAlive();
      });
    });
  }

  /**
   * Authorize with API token
   *
   * @param token - Deriv API token
   * @throws {Error} If authorization fails
   */
  async authorize(token: string): Promise<any> {
    const response = await this.request({
      authorize: token,
    });

    if (!response.authorize) {
      throw new Error('Authorization failed');
    }

    return response.authorize;
  }

  /**
   * Disconnect from Deriv API
   */
  disconnect(): void {
    this.stopKeepAlive();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.subscriptions.clear();
    this.pendingRequests.clear();
  }

  /**
   * Send ping to keep connection alive
   */
  async ping(): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    this.send({ ping: 1 });
  }

  /**
   * Get list of active trading symbols
   *
   * @returns Array of active symbols
   */
  async getActiveSymbols(): Promise<Symbol[]> {
    const response = await this.request({
      active_symbols: 'brief',
      product_type: 'basic',
    });

    return response.active_symbols.map((symbol: any) => ({
      symbol: symbol.symbol,
      displayName: symbol.display_name,
      market: symbol.market,
      submarket: symbol.submarket,
      isTradingAllowed: !symbol.is_trading_suspended,
      isOpen: symbol.exchange_is_open === 1,
      pipSize: symbol.pip,
    }));
  }

  /**
   * Subscribe to tick stream for an asset
   *
   * @param symbol - Asset symbol (e.g., "R_100")
   * @param callback - Callback function for tick updates
   * @returns Subscription object
   */
  async subscribeTicks(
    symbol: string,
    callback: (tick: Tick) => void
  ): Promise<Subscription> {
    const response = await this.request({
      ticks: symbol,
      subscribe: 1,
    });

    const subscriptionId = response.subscription?.id || response.tick?.id;

    if (!subscriptionId) {
      throw new Error('Failed to get subscription ID from response');
    }

    const subscription: Subscription = {
      id: subscriptionId,
      callback: (data: any) => {
        if (data.tick) {
          const tick: Tick = {
            asset: data.tick.symbol,
            price: data.tick.quote,
            timestamp: data.tick.epoch * 1000, // Convert to ms
          };
          callback(tick);
        }
      },
    };

    this.subscriptions.set(subscriptionId, subscription);

    return subscription;
  }

  /**
   * Unsubscribe from a subscription
   *
   * @param subscriptionId - Subscription ID to cancel
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.request({
      forget: subscriptionId,
    });

    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get account balance
   *
   * @returns Balance information
   * @throws {Error} If not authorized or request fails
   */
  async getBalance(): Promise<Balance> {
    const response = await this.request({
      balance: 1,
      account: 'current',
    });

    if (!response.balance) {
      throw new Error('Invalid balance response');
    }

    return {
      amount: parseFloat(response.balance.balance),
      currency: response.balance.currency,
      accountType: response.balance.loginid?.startsWith('VRT') ? 'demo' : 'real',
      timestamp: Date.now(),
    };
  }

  /**
   * Get historical candles
   *
   * @param symbol - Asset symbol
   * @param options - Candle options
   * @returns Array of candles
   * @throws {Error} If request fails
   */
  async getCandles(
    symbol: string,
    options: {
      granularity: number; // in seconds (60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400)
      count: number;
      end?: number | 'latest'; // timestamp in seconds or 'latest'
      start?: number; // timestamp in seconds
    }
  ): Promise<Candle[]> {
    // Build request, only include end/start if provided
    const request: any = {
      ticks_history: symbol,
      style: 'candles',
      granularity: options.granularity,
      count: options.count,
    };

    // Only add end/start if explicitly provided
    if (options.end !== undefined) {
      request.end = options.end;
    } else {
      // Default to 'latest' for most recent data
      request.end = 'latest';
    }

    if (options.start !== undefined) {
      request.start = options.start;
    }

    const response = await this.request(request);

    if (!response.candles) {
      throw new Error('Invalid candles response');
    }

    return response.candles.map((c: any) => ({
      asset: symbol,
      timeframe: options.granularity,
      timestamp: c.epoch * 1000, // Convert to milliseconds
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    }));
  }

  /**
   * Buy a contract (place trade)
   *
   * @param options - Trade options
   * @returns Contract purchase response
   * @throws {Error} If purchase fails
   */
  async buyContract(options: {
    symbol: string;
    contractType: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    durationUnit: 's' | 'm' | 'h' | 'd';
    basis?: 'stake' | 'payout';
  }): Promise<{
    contractId: string;
    buyPrice: number;
    payout: number;
    startTime: number;
    purchaseTime: number;
    longcode: string;
  }> {
    const response = await this.request({
      buy: 1,
      price: options.amount,
      parameters: {
        contract_type: options.contractType,
        symbol: options.symbol,
        duration: options.duration,
        duration_unit: options.durationUnit,
        basis: options.basis || 'stake',
        amount: options.amount,
      },
    });

    if (!response.buy) {
      throw new Error('Invalid buy response');
    }

    return {
      contractId: response.buy.contract_id.toString(),
      buyPrice: parseFloat(response.buy.buy_price),
      payout: parseFloat(response.buy.payout),
      startTime: response.buy.start_time,
      purchaseTime: response.buy.purchase_time,
      longcode: response.buy.longcode,
    };
  }

  /**
   * Get price proposal for a contract (without buying)
   *
   * @param options - Proposal options
   * @returns Price proposal
   * @throws {Error} If request fails
   */
  async getProposal(options: {
    symbol: string;
    contractType: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    durationUnit: 's' | 'm' | 'h' | 'd';
    basis?: 'stake' | 'payout';
  }): Promise<{
    askPrice: number;
    payout: number;
    spotPrice: number;
  }> {
    const response = await this.request({
      proposal: 1,
      contract_type: options.contractType,
      symbol: options.symbol,
      duration: options.duration,
      duration_unit: options.durationUnit,
      basis: options.basis || 'stake',
      amount: options.amount,
    });

    if (!response.proposal) {
      throw new Error('Invalid proposal response');
    }

    return {
      askPrice: parseFloat(response.proposal.ask_price),
      payout: parseFloat(response.proposal.payout),
      spotPrice: parseFloat(response.proposal.spot),
    };
  }

  /**
   * Subscribe to contract updates
   *
   * @param contractId - Contract ID to track
   * @param callback - Callback for contract updates
   * @returns Subscription object
   */
  async subscribeToContract(
    contractId: string,
    callback: (update: any) => void
  ): Promise<Subscription> {
    const response = await this.request({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
    });

    const subscriptionId = response.subscription?.id || response.proposal_open_contract?.id;

    if (!subscriptionId) {
      throw new Error('Failed to get subscription ID for contract');
    }

    const subscription: Subscription = {
      id: subscriptionId,
      callback,
    };

    this.subscriptions.set(subscriptionId, subscription);

    return subscription;
  }

  /**
   * Send a request and wait for response
   *
   * @param payload - Request payload
   * @returns Response data
   */
  private async request(payload: any): Promise<any> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const reqId = ++this.requestId;
      const requestPayload = { ...payload, req_id: reqId };

      this.pendingRequests.set(reqId.toString(), { resolve, reject });

      this.send(requestPayload);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(reqId.toString())) {
          this.pendingRequests.delete(reqId.toString());
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Send data to WebSocket
   */
  private send(data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }

    this.ws.send(JSON.stringify(data));
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle errors
      if (message.error) {
        this.handleError(message);
        return;
      }

      // Handle subscription updates (this includes initial subscription response)
      if (message.subscription) {
        // Check if this is a response to a pending request
        if (message.echo_req?.req_id) {
          this.handleResponse(message);
        }
        // Also handle as subscription update
        this.handleSubscription(message);
        return;
      }

      // Handle regular responses
      if (message.req_id || message.echo_req?.req_id) {
        this.handleResponse(message);
        return;
      }

      // Handle other messages (ping response, etc)
      if (message.msg_type === 'ping') {
        // Ping response, ignore
        return;
      }

    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  /**
   * Handle error message
   */
  private handleError(message: any): void {
    const error = new Error(message.error.message);

    // Reject pending request if has req_id
    if (message.req_id) {
      const pending = this.pendingRequests.get(message.req_id.toString());
      if (pending) {
        pending.reject(error);
        this.pendingRequests.delete(message.req_id.toString());
      }
    }
  }

  /**
   * Handle subscription update
   */
  private handleSubscription(message: any): void {
    const subscriptionId = message.subscription.id;
    const subscription = this.subscriptions.get(subscriptionId);

    if (subscription) {
      subscription.callback(message);
    }
  }

  /**
   * Handle regular response
   */
  private handleResponse(message: any): void {
    const reqId = message.req_id?.toString();

    if (!reqId) {
      // Some messages don't have req_id, check if it's an echo_req
      if (message.echo_req?.req_id) {
        const echoReqId = message.echo_req.req_id.toString();
        const pending = this.pendingRequests.get(echoReqId);

        if (pending) {
          pending.resolve(message);
          this.pendingRequests.delete(echoReqId);
        }
      }
      return;
    }

    const pending = this.pendingRequests.get(reqId);

    if (pending) {
      pending.resolve(message);
      this.pendingRequests.delete(reqId);
    }
  }

  /**
   * Start keep-alive timer
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();

    this.keepAliveTimer = setInterval(() => {
      if (this.isConnected()) {
        this.ping().catch((error) => {
          console.error('Keep-alive ping failed:', error);
        });
      }
    }, this.config.keepAliveInterval);
  }

  /**
   * Stop keep-alive timer
   */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}
