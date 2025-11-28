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
  /** Default account to use (loginid or 'current') */
  defaultAccount?: string;
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
  private config: {
    appId: number;
    endpoint: string;
    apiToken: string;
    keepAliveInterval: number;
  };
  private ws: WebSocket | null = null;
  private connected = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, Subscription>();
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
  }>();
  private requestId = 0;

  private defaultAccount: string;

  // Auto-reconnect properties
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // Start with 5 seconds
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activeSubscriptions: Array<{ type: string; symbol?: string; account?: string }> = [];

  constructor(config: DerivClientConfig) {
    this.config = {
      appId: config.appId,
      endpoint: config.endpoint || 'wss://ws.derivws.com/websockets/v3',
      apiToken: config.apiToken || '',
      keepAliveInterval: config.keepAliveInterval || 60000, // 60 seconds
    };
    this.defaultAccount = config.defaultAccount || 'current';
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
        console.log('[DerivClient] WebSocket connection closed');
        this.connected = false;
        this.stopKeepAlive();

        // Attempt to reconnect if not intentionally disconnected
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[DerivClient] Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff: 5s, 10s, 20s, 40s, ... up to max 5 minutes
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 300000);

    console.log(`[DerivClient] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        console.log('[DerivClient] Attempting to reconnect...');
        await this.reconnect();
        console.log('[DerivClient] Reconnection successful!');

        // Reset reconnect counter on success
        this.reconnectAttempts = 0;
      } catch (error) {
        console.error('[DerivClient] Reconnection failed:', error);

        // Schedule another reconnect attempt
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Reconnect to Deriv API and restore subscriptions
   */
  private async reconnect(): Promise<void> {
    // Reset WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    // Reconnect
    await this.connect();

    // Re-authorize if we have a token
    if (this.config.apiToken) {
      try {
        await this.authorize(this.config.apiToken);
        console.log('[DerivClient] Re-authorization successful');
      } catch (error) {
        console.error('[DerivClient] Re-authorization failed:', error);
        throw error;
      }
    }

    // Restore subscriptions
    console.log(`[DerivClient] Restoring ${this.activeSubscriptions.length} subscription(s)...`);

    // Note: Subscriptions need to be manually re-established by the caller
    // because we don't store the callbacks. The Gateway should listen for
    // reconnection events and re-subscribe as needed.

    console.log('[DerivClient] ⚠️  Active subscriptions need to be re-established by the caller');
    console.log('[DerivClient] Subscriptions that were active:', this.activeSubscriptions);
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
    console.log('[DerivClient] Disconnecting (intentional)...');

    // Disable auto-reconnect for intentional disconnects
    this.shouldReconnect = false;

    // Clear reconnect timer if any
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopKeepAlive();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.subscriptions.clear();
    this.pendingRequests.clear();
    this.activeSubscriptions = [];
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

    // Track active subscription for reconnect
    this.activeSubscriptions.push({
      type: 'ticks',
      symbol,
    });

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
   * @param account - Account to query: 'current' or specific loginid (e.g., 'CR1234567'). If not specified, uses defaultAccount from config.
   * @returns Balance information
   * @throws {Error} If not authorized or request fails
   */
  async getBalance(account?: string): Promise<Balance> {
    const accountToUse = account || this.defaultAccount;

    try {
    const response = await this.request({
      balance: 1,
        account: accountToUse,
    });

    if (!response.balance) {
      throw new Error('Invalid balance response');
    }

      const loginid = response.balance.loginid || '';
      const accountType = loginid.startsWith('VRT') ? 'demo' : 'real';

      // Log account information for debugging
      console.log('[DerivClient] Account info:', {
        loginid,
        accountType,
        balance: response.balance.balance,
        currency: response.balance.currency,
      });

    return {
      amount: parseFloat(response.balance.balance),
      currency: response.balance.currency,
        accountType,
        loginid: loginid || undefined,
      timestamp: Date.now(),
    };
    } catch (error: any) {
      // If permission denied and we're not using 'current', try with 'current' as fallback
      if (error.message?.includes('Permission denied') && accountToUse !== 'current') {
        console.warn(`[DerivClient] ⚠️  Permission denied for account '${accountToUse}', falling back to 'current'`);
        return this.getBalance('current');
      }
      throw error;
    }
  }

  /**
   * Get list of available accounts
   * 
   * @returns List of account information with platform type and details
   * @throws {Error} If not authorized or request fails
   */
  async getAccounts(): Promise<Array<{
    loginid: string;
    accountType: 'demo' | 'real';
    currency: string;
    balance: number;
    platform?: string; // MT5, cTrader, Binary Options, etc.
    accountName?: string;
    marketType?: string; // synthetic, forex, etc.
  }>> {
    const response = await this.request({
      account_list: 1,
    });

    if (!response.account_list) {
      throw new Error('Invalid account_list response');
    }

    return response.account_list.map((acc: any) => {
      const loginid = acc.loginid || '';
      const isDemo = loginid.startsWith('VRT');

      // Determine platform type based on loginid prefix
      // VRT = Demo, CR = Real (Binary Options/CFD), MF = Real (MT5), etc.
      let platformType = 'Unknown';

      if (loginid.startsWith('VRT')) {
        platformType = 'Binary Options/CFD (Demo)';
      } else if (loginid.startsWith('CR')) {
        platformType = 'Binary Options/CFD (Real)';
      } else if (loginid.startsWith('MF')) {
        platformType = 'MT5 (Real)';
      } else if (loginid.startsWith('CT')) {
        platformType = 'cTrader (Real)';
      } else if (loginid.startsWith('DX')) {
        platformType = 'Deriv X (Real)';
      }

      // Use API response fields if available, otherwise use inferred values
      return {
        loginid,
        accountType: isDemo ? 'demo' : 'real',
        currency: acc.currency || 'USD',
        balance: parseFloat(acc.balance || '0'),
        platform: acc.account_type || acc.platform || acc.market_type || platformType,
        accountName: acc.account_name || acc.name || acc.display_name || undefined,
        marketType: acc.market_type || acc.submarket || acc.market || undefined,
      };
    });
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
      timestamp: c.epoch, // Already in seconds (Unix timestamp)
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
    // Get balance to retrieve currency
    const balance = await this.getBalance();

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
        currency: balance.currency,
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
   * Buy a CFD/Multiplier contract
   *
   * @param options - CFD trade options
   * @returns Contract purchase response
   * @throws {Error} If purchase fails
   */
  async buyCFD(options: {
    symbol: string;
    contractType: 'MULTUP' | 'MULTDOWN';
    amount: number;
    multiplier: number;
    duration?: number;
    durationUnit?: 's' | 'm' | 'h' | 'd';
    basis?: 'stake' | 'payout';
    stopLoss?: number;
    takeProfit?: number;
    account?: string; // Optional: specific loginid or 'current' (default)
  }): Promise<{
    contractId: string;
    buyPrice: number;
    startTime: number;
    purchaseTime: number;
    longcode: string;
  }> {
    // Get balance to retrieve currency (use specified account, or defaultAccount from config, or 'current')
    const accountToUse = options.account || this.defaultAccount;
    const balance = await this.getBalance(accountToUse);

    // Format amount to 2 decimal places (Deriv API requirement)
    const formattedAmount = Math.round(options.amount * 100) / 100;

    const parameters: any = {
      contract_type: options.contractType,
      symbol: options.symbol,
      basis: options.basis || 'stake',
      amount: formattedAmount,
      multiplier: options.multiplier,
      currency: balance.currency,
    };

    // Add account parameter if specified (Deriv API allows account: loginid or 'current')
    if (accountToUse !== 'current') {
      parameters.account = accountToUse;
    }

    // Duration is optional for CFDs (they can be closed manually)
    if (options.duration && options.durationUnit) {
      parameters.duration = options.duration;
      parameters.duration_unit = options.durationUnit;
    }

    // NOTE: TP/SL will be added AFTER we get spot price from initial proposal
    // For multipliers, TP/SL must be dollar amounts, not price levels
    // We need spot price first to calculate the dollar amounts

    console.log('[DerivClient] buyCFD parameters:', JSON.stringify(parameters, null, 2));
    console.log(`[DerivClient] Using account: ${accountToUse}`);

    try {
      // STEP 1: Get initial proposal WITHOUT TP/SL to get spot price
      const initialProposal: any = {
        proposal: 1,
        ...parameters,
        // NO limit_order yet - we need spot price first
      };

      if (accountToUse !== 'current') {
        initialProposal.account = accountToUse;
      }

      console.log('[DerivClient] Getting initial proposal (no TP/SL):', JSON.stringify(initialProposal, null, 2));
      const initialResponse = await this.request(initialProposal);

      if (!initialResponse.proposal || !initialResponse.proposal.spot) {
        throw new Error('Invalid proposal response - no spot price');
      }

      const spotPrice = parseFloat(initialResponse.proposal.spot);
      console.log(`[DerivClient] Spot price from initial proposal: ${spotPrice}`);

      // STEP 2: Calculate TP/SL as DOLLAR AMOUNTS if provided
      // For multipliers, TP/SL in limit_order must be profit/loss in dollars, NOT price levels
      if ((options.stopLoss !== undefined && options.stopLoss !== null) ||
          (options.takeProfit !== undefined && options.takeProfit !== null)) {

        const positionSize = formattedAmount * options.multiplier;
        parameters.limit_order = {};

        if (options.takeProfit !== undefined && options.takeProfit !== null) {
          // Convert TP price level to dollar profit amount
          const tpPriceLevel = options.takeProfit;
          let dollarProfit: number;

          if (options.contractType === 'MULTUP') {
            // For BUY: profit = ((TP - Spot) / Spot) × Position Size
            dollarProfit = ((tpPriceLevel - spotPrice) / spotPrice) * positionSize;
          } else {
            // For SELL: profit = ((Spot - TP) / Spot) × Position Size
            dollarProfit = ((spotPrice - tpPriceLevel) / spotPrice) * positionSize;
          }

          // Round to 2 decimal places and ensure positive
          parameters.limit_order.take_profit = Math.max(0.10, Math.round(dollarProfit * 100) / 100);
          console.log(`[DerivClient] TP: ${tpPriceLevel} (price) → $${parameters.limit_order.take_profit} (profit)`);
        }

        if (options.stopLoss !== undefined && options.stopLoss !== null) {
          // Convert SL price level to dollar loss amount
          const slPriceLevel = options.stopLoss;
          let dollarLoss: number;

          if (options.contractType === 'MULTUP') {
            // For BUY: loss = ((Spot - SL) / Spot) × Position Size
            dollarLoss = ((spotPrice - slPriceLevel) / spotPrice) * positionSize;
          } else {
            // For SELL: loss = ((SL - Spot) / Spot) × Position Size
            dollarLoss = ((slPriceLevel - spotPrice) / spotPrice) * positionSize;
          }

          // Round to 2 decimal places, ensure positive, and cap at stake amount
          // Deriv requires minimum SL of ~3.50 USD depending on symbol, using 5.00 as safe minimum
          parameters.limit_order.stop_loss = Math.min(
            formattedAmount,
            Math.max(5.00, Math.round(dollarLoss * 100) / 100)
          );
          console.log(`[DerivClient] SL: ${slPriceLevel} (price) → $${parameters.limit_order.stop_loss} (loss)`);
        }
      }

      // STEP 3: Get final proposal WITH TP/SL (as dollar amounts)
      const proposalRequest: any = {
        proposal: 1,
        ...parameters,
      };

      if (accountToUse !== 'current') {
        proposalRequest.account = accountToUse;
      }

      console.log('[DerivClient] Getting final proposal with TP/SL:', JSON.stringify(proposalRequest, null, 2));
      const proposalResponse = await this.request(proposalRequest);

      if (!proposalResponse.proposal || !proposalResponse.proposal.id) {
        throw new Error('Invalid proposal response - no proposal ID');
      }

      const proposalId = proposalResponse.proposal.id;
      const askPrice = parseFloat(proposalResponse.proposal.ask_price);

      console.log(`[DerivClient] Final proposal received: id=${proposalId}, ask_price=${askPrice}`);

      // Now buy using the proposal ID and ask price
      const requestPayload: any = {
        buy: proposalId,  // Use proposal ID, not just '1'
        price: askPrice,  // Use ask_price from proposal, not options.amount
      };

      // Add account parameter at request level if specified (Deriv API allows this)
      if (accountToUse !== 'current') {
        requestPayload.account = accountToUse;
      }

      console.log('[DerivClient] Buying with proposal:', JSON.stringify(requestPayload, null, 2));
      const response = await this.request(requestPayload);

      if (!response.buy) {
        throw new Error('Invalid buy response');
      }

      return {
        contractId: response.buy.contract_id.toString(),
        buyPrice: parseFloat(response.buy.buy_price),
        startTime: response.buy.start_time,
        purchaseTime: response.buy.purchase_time,
        longcode: response.buy.longcode,
      };
    } catch (error: any) {
      // If permission denied and we're not using 'current', try with 'current' as fallback
      if (error.message?.includes('Permission denied') && accountToUse !== 'current') {
        console.warn(`[DerivClient] ⚠️  Permission denied for account '${accountToUse}', retrying with 'current'`);
        // Retry with 'current' account
        const retryOptions = { ...options, account: 'current' };
        return this.buyCFD(retryOptions);
      }

      console.error('[DerivClient] ❌ buyCFD error:', error);
      console.error('[DerivClient] 📤 Parameters sent:', JSON.stringify(parameters, null, 2));
      console.error('[DerivClient] 🔍 Full error object:', JSON.stringify(error, null, 2));
      console.error('[DerivClient] 🔍 Error details:', {
        message: error.message,
        errorMessage: error.error?.message,
        errorCode: error.error?.code,
        errorDetails: error.error?.details,
      });
      
      // Provide clearer error messages for common issues
      const errorMessage = error.message || error.error?.message || 'Unknown error';
      let userFriendlyMessage = errorMessage;
      
      // Check for minimum amount errors
      if (errorMessage.includes('Enter an amount equal to or higher than')) {
        const minAmountMatch = errorMessage.match(/higher than ([\d.]+)/);
        const minAmount = minAmountMatch ? minAmountMatch[1] : '5.00';
        userFriendlyMessage = `CFD buy failed: Amount too low. Minimum required: $${minAmount}. Provided: $${formattedAmount.toFixed(2)}. Please increase stake to at least $${minAmount}.`;
      } else if (errorMessage.includes('Enter an amount equal to or lower than')) {
        userFriendlyMessage = `CFD buy failed: Amount too high. ${errorMessage}`;
      }
      
      throw new Error(userFriendlyMessage);
    }
  }

  /**
   * Sell a contract (close position)
   *
   * @param contractId - Contract ID to sell
   * @param price - Sell price (0 for market price)
   * @returns Sell response
   * @throws {Error} If sell fails
   */
  async sellContract(contractId: string, price: number = 0): Promise<{
    sellPrice: number;
    profit: number;
    sellTime: number;
  }> {
    const response = await this.request({
      sell: contractId,
      price: price,
    });

    if (!response.sell) {
      throw new Error('Invalid sell response');
    }

    return {
      sellPrice: parseFloat(response.sell.sold_for),
      profit: parseFloat(response.sell.profit),
      sellTime: response.sell.sold_time,
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
   * Get portfolio (all open positions)
   *
   * @param account - Account loginid (optional, uses defaultAccount if not provided)
   * @returns Array of open positions
   * @throws {Error} If request fails
   */
  async getPortfolio(account?: string): Promise<Array<{
    contractId: string;
    symbol: string;
    contractType: string;
    buyPrice: number;
    currentPrice: number;
    profit: number;
    profitPercentage: number;
    purchaseTime: Date;
    duration: number;
    durationUnit: string;
    status: 'open' | 'sold';
    isSold: boolean;
    multiplier?: number;
    takeProfit?: number;
    stopLoss?: number;
  }>> {
    const accountToUse = account || this.defaultAccount;
    const requestPayload: any = {
      portfolio: 1,
    };

    // Add account if specified and not 'current'
    if (accountToUse && accountToUse !== 'current') {
      requestPayload.account = accountToUse;
    }

    const response = await this.request(requestPayload);

    console.log('[DerivClient] Portfolio response:', JSON.stringify(response, null, 2));

    if (!response.portfolio) {
      // Portfolio might be empty array or null
      console.log('[DerivClient] No portfolio in response');
      return [];
    }

    // Handle different response structures:
    // 1. response.portfolio.contracts (array of contracts)
    // 2. response.portfolio is directly an array
    let contracts: any[] = [];
    
    if (Array.isArray(response.portfolio)) {
      contracts = response.portfolio;
    } else if (response.portfolio.contracts && Array.isArray(response.portfolio.contracts)) {
      contracts = response.portfolio.contracts;
    } else {
      console.warn('[DerivClient] Unexpected portfolio structure:', response.portfolio);
      return [];
    }

    console.log(`[DerivClient] Found ${contracts.length} contract(s) in portfolio response`);

    // Filter only open contracts (not sold) and map to our format
    const openPositions = contracts
      .filter((contract: any) => {
        const isSold = contract.is_sold === 1 || contract.is_sold === true || contract.is_sold === '1';
        const isOpen = !isSold;
        if (isOpen) {
          console.log(`[DerivClient] Open contract found: ${contract.contract_id} - ${contract.underlying || contract.symbol} - ${contract.contract_type}`);
        }
        return isOpen; // Only return open positions
      })
      .map((contract: any) => {
        const buyPrice = parseFloat(contract.buy_price || '0');
        const currentPrice = parseFloat(contract.current_spot || contract.current_spot_display_value || '0');
        const profit = parseFloat(contract.profit || '0');
        const profitPercentage = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;

        return {
          contractId: contract.contract_id?.toString() || '',
          symbol: contract.underlying || contract.symbol || '',
          contractType: contract.contract_type || '',
          buyPrice,
          currentPrice,
          profit,
          profitPercentage,
          purchaseTime: new Date((contract.purchase_time || contract.date_start) * 1000),
          duration: contract.duration || 0,
          durationUnit: contract.duration_unit || 's',
          status: 'open' as const, // We already filtered out sold contracts
          isSold: false,
          multiplier: contract.multiplier ? parseFloat(contract.multiplier) : undefined,
          takeProfit: contract.limit_order?.take_profit ? parseFloat(contract.limit_order.take_profit.amount) : undefined,
          stopLoss: contract.limit_order?.stop_loss ? parseFloat(contract.limit_order.stop_loss.amount) : undefined,
        };
      });

    console.log(`[DerivClient] Returning ${openPositions.length} open position(s)`);
    return openPositions;
  }

  /**
   * Get Multiplier positions by Contract IDs
   *
   * Uses proposal_open_contract API which DOES support Multiplier contracts (MULTUP/MULTDOWN).
   * The portfolio API does NOT return Multipliers, so this method is essential for CFD mode.
   *
   * @param contractIds - Array of Contract IDs to query
   * @returns Array of position updates in same format as getPortfolio()
   */
  async getMultiplierPositions(contractIds: string[]): Promise<Array<{
    contractId: string;
    symbol: string;
    contractType: string;
    buyPrice: number;
    currentPrice: number;
    profit: number;
    profitPercentage: number;
    purchaseTime: Date;
    duration: number;
    durationUnit: string;
    status: 'open' | 'sold';
    isSold: boolean;
    multiplier?: number;
    takeProfit?: number;
    stopLoss?: number;
  }>> {
    if (!contractIds || contractIds.length === 0) {
      return [];
    }

    console.log(`[DerivClient] Querying ${contractIds.length} Multiplier contract(s): ${contractIds.join(', ')}`);

    const positions: Array<any> = [];

    // Query each contract individually using proposal_open_contract
    for (const contractId of contractIds) {
      try {
        console.log(`[DerivClient] 🔍 Querying contract ${contractId}...`);

        const response = await this.request({
          proposal_open_contract: 1,
          contract_id: contractId,
        });

        console.log(`[DerivClient] 📥 Raw API response for ${contractId}:`, JSON.stringify(response, null, 2));

        if (!response.proposal_open_contract) {
          console.warn(`[DerivClient] ⚠️  No proposal_open_contract in response for ${contractId}`);
          console.warn(`[DerivClient] Response keys:`, Object.keys(response));
          continue;
        }

        const contract = response.proposal_open_contract;
        console.log(`[DerivClient] 📊 Contract data:`, {
          contract_id: contract.contract_id,
          underlying: contract.underlying,
          contract_type: contract.contract_type,
          is_sold: contract.is_sold,
          status: contract.status,
          buy_price: contract.buy_price,
          current_spot: contract.current_spot,
          profit: contract.profit,
        });

        // Check if contract is still open
        const isSold = contract.is_sold === 1 || contract.is_sold === true || contract.status === 'sold';

        if (isSold) {
          console.log(`[DerivClient] Contract ${contractId} is SOLD - skipping`);
          continue;
        }

        console.log(`[DerivClient] Open Multiplier contract found: ${contractId} - ${contract.underlying} - ${contract.contract_type}`);

        // Parse contract data
        const buyPrice = parseFloat(contract.buy_price || '0');
        const currentPrice = parseFloat(contract.current_spot || contract.bid_price || '0');
        const profit = parseFloat(contract.profit || '0');
        const profitPercentage = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;

        positions.push({
          contractId: contract.contract_id?.toString() || contractId,
          symbol: contract.underlying || contract.symbol || '',
          contractType: contract.contract_type || '',
          buyPrice,
          currentPrice,
          profit,
          profitPercentage,
          purchaseTime: new Date((contract.purchase_time || contract.date_start) * 1000),
          duration: 0, // Multipliers don't have duration
          durationUnit: '',
          status: 'open' as const,
          isSold: false,
          multiplier: contract.multiplier ? parseFloat(contract.multiplier) : undefined,
          takeProfit: contract.limit_order?.take_profit?.order_amount
            ? parseFloat(contract.limit_order.take_profit.order_amount)
            : undefined,
          stopLoss: contract.limit_order?.stop_loss?.order_amount
            ? parseFloat(contract.limit_order.stop_loss.order_amount)
            : undefined,
        });
      } catch (error: any) {
        console.error(`[DerivClient] Error querying contract ${contractId}: ${error.message}`);
        // Continue with other contracts
      }
    }

    console.log(`[DerivClient] Returning ${positions.length} open Multiplier position(s)`);
    return positions;
  }

  /**
   * Get Profit Table - Closed contracts history
   *
   * Retrieves a summary of closed contracts according to specified criteria.
   * Useful for tracking completed trades and their profit/loss.
   *
   * @param options - Filtering options
   * @returns Array of closed contracts with full details
   */
  async getProfitTable(options?: {
    limit?: number;       // Max number of transactions (default: 50)
    offset?: number;      // Number of transactions to skip (default: 0)
    dateFrom?: number;    // Start date (epoch timestamp)
    dateTo?: number;      // End date (epoch timestamp)
    sort?: 'ASC' | 'DESC'; // Sort order (default: DESC - newest first)
    contractType?: string[]; // Filter by contract types (e.g., ['CALL', 'PUT'])
  }): Promise<Array<{
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
  }>> {
    const requestPayload: any = {
      profit_table: 1,
      description: 1, // Include contract descriptions
      sort: options?.sort || 'DESC',
    };

    // Add optional filters
    if (options?.limit !== undefined) {
      requestPayload.limit = options.limit;
    }
    if (options?.offset !== undefined) {
      requestPayload.offset = options.offset;
    }
    if (options?.dateFrom !== undefined) {
      requestPayload.date_from = options.dateFrom;
    }
    if (options?.dateTo !== undefined) {
      requestPayload.date_to = options.dateTo;
    }
    if (options?.contractType && options.contractType.length > 0) {
      requestPayload.contract_type = options.contractType;
    }

    console.log('[DerivClient] 📊 Requesting profit_table with options:', requestPayload);

    const response = await this.request(requestPayload);

    console.log('[DerivClient] 📥 Profit table response:', JSON.stringify(response, null, 2));

    if (!response.profit_table) {
      console.log('[DerivClient] No profit_table in response');
      return [];
    }

    const transactions = response.profit_table.transactions || [];
    console.log(`[DerivClient] Found ${transactions.length} closed contract(s)`);

    // Log raw transactions for debugging
    if (transactions.length > 0) {
      console.log(`[DerivClient] Raw profit_table transactions sample:`, JSON.stringify(transactions[0], null, 2));
    }

    return transactions.map((transaction: any) => {
      const buyPrice = parseFloat(transaction.buy_price || '0');
      const sellPrice = parseFloat(transaction.sell_price || '0');

      // Use the API's profit field directly if available, otherwise calculate
      // NOTE: For Multipliers, the API returns profit directly
      const profit = transaction.profit !== undefined
        ? parseFloat(transaction.profit)
        : (sellPrice - buyPrice);

      const profitPercentage = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;

      // Parse symbol - try multiple sources
      // For Multipliers, shortcode format is like "MULTUP_R_100_10.00_10_1732543895_5734547996_0.00_N1"
      // We need to extract "R_100" from position [1] and [2]
      let symbol = transaction.underlying || '';
      if (!symbol && transaction.shortcode) {
        const parts = transaction.shortcode.split('_');
        // For MULTUP/MULTDOWN, symbol is at parts[1]_parts[2] (e.g., "R_100")
        if (parts[0] === 'MULTUP' || parts[0] === 'MULTDOWN') {
          symbol = `${parts[1]}_${parts[2]}`;
        } else {
          symbol = parts[0];
        }
      }

      console.log(`[DerivClient] Parsed transaction: contract=${transaction.contract_id}, symbol=${symbol}, profit=${profit}, shortcode=${transaction.shortcode?.substring(0, 50)}`);

      return {
        contractId: transaction.contract_id?.toString() || '',
        symbol,
        contractType: transaction.contract_type || '',
        buyPrice,
        sellPrice,
        profit,
        profitPercentage,
        purchaseTime: new Date((transaction.purchase_time || 0) * 1000),
        sellTime: new Date((transaction.sell_time || 0) * 1000),
        duration: transaction.duration || 0,
        durationUnit: transaction.duration_unit || '',
        transactionId: transaction.transaction_id?.toString() || '',
        longcode: transaction.longcode,
      };
    });
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

      // Handle proposal_open_contract updates that may come without subscription field
      // This happens when: 1) one-time query (no subscribe:1), or 2) contract closes (is_sold: true)
      if (message.msg_type === 'proposal_open_contract' && message.proposal_open_contract) {
        const contract = message.proposal_open_contract;
        console.log(`[DerivClient] 📦 proposal_open_contract update: ${contract.contract_id} | is_sold: ${contract.is_sold}`);

        // If this is a response to a pending request (one-time query), handle it
        if (message.echo_req?.req_id) {
          this.handleResponse(message);
          // Don't return - also notify subscriptions if any
        }

        // Find the subscription by contract_id and call its callback
        for (const sub of this.subscriptions.values()) {
          // Call the callback - it will check if is_sold
          sub.callback(message);
        }
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
