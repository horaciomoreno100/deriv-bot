/**
 * Gateway Client - WebSocket client to connect to Gateway
 *
 * Provides high-level API for Trader to interact with Gateway
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type {
  Tick,
  Candle,
  Balance,
  Symbol,
} from '@deriv-bot/shared';
import type {
  CommandMessage,
  EventMessage,
  ResponseMessage,
  GatewayMessage,
} from '@deriv-bot/gateway';

/**
 * Configuration for GatewayClient
 */
export interface GatewayClientConfig {
  /** Gateway WebSocket URL */
  url: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in ms */
  reconnectInterval?: number;
  /** Enable debug logging */
  enableLogging?: boolean;
}

/**
 * Gateway Client Events
 */
export interface GatewayClientEvents {
  // Connection events
  'connected': () => void;
  'disconnected': () => void;
  'reconnecting': () => void;
  'error': (error: Error) => void;

  // Market data events
  'tick': (tick: Tick) => void;
  'candle:update': (data: { asset: string; timeframe: number; candle: Candle }) => void;
  'candle:closed': (data: { asset: string; timeframe: number; candle: Candle }) => void;

  // Trade events
  'trade:executed': (data: any) => void;
  'trade:result': (data: any) => void;

  // Other events
  'balance': (balance: Balance) => void;
  'instruments': (data: { instruments: Symbol[]; timestamp: number }) => void;
}

/**
 * GatewayClient - WebSocket client for connecting to Gateway
 *
 * Handles:
 * - Connection and reconnection
 * - Command/response pattern
 * - Event broadcasting
 * - Type-safe API
 *
 * @example
 * ```typescript
 * const client = new GatewayClient({ url: 'ws://localhost:3000' });
 *
 * // Listen for ticks
 * client.on('tick', (tick) => {
 *   console.log('Tick:', tick);
 * });
 *
 * // Connect
 * await client.connect();
 *
 * // Subscribe to asset
 * await client.follow(['R_100']);
 * ```
 */
export class GatewayClient extends EventEmitter {
  private config: Required<GatewayClientConfig>;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;

  constructor(config: GatewayClientConfig) {
    super();
    this.config = {
      url: config.url,
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 5000,
      enableLogging: config.enableLogging ?? false,
    };
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to Gateway
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.log(`Connecting to ${this.config.url}...`);

      this.ws = new WebSocket(this.config.url);

      this.ws.on('open', () => {
        this.connected = true;
        this.log('Connected to Gateway');
        this.emit('connected');
        resolve();
      });

      this.ws.on('error', (error) => {
        this.log('Connection error:', error);
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', () => {
        this.handleDisconnect();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });
    });
  }

  /**
   * Disconnect from Gateway
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Subscribe to assets (follow)
   */
  async follow(assets: string[]): Promise<void> {
    await this.sendCommand('follow', { assets });
  }

  /**
   * Unsubscribe from assets (unfollow)
   */
  async unfollow(assets: string[]): Promise<void> {
    await this.sendCommand('unfollow', { assets });
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<Balance> {
    return await this.sendCommand('balance');
  }

  /**
   * Get available instruments
   */
  async getInstruments(): Promise<Symbol[]> {
    const result = await this.sendCommand('instruments');
    return result.instruments;
  }

  /**
   * Get historical candles
   */
  async getHistory(params: {
    asset: string;
    timeframe: number;
    count: number;
    end?: 'latest' | number;
  }): Promise<Candle[]> {
    const result = await this.sendCommand('history', params);
    return result.candles;
  }

  /**
   * Execute a trade
   */
  async trade(params: {
    asset: string;
    direction: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    durationUnit: 's' | 'm' | 'h' | 'd';
  }): Promise<any> {
    return await this.sendCommand('trade', params);
  }

  /**
   * Get tracked assets
   */
  async getAssets(): Promise<string[]> {
    const result = await this.sendCommand('get_assets');
    return result.assets;
  }

  /**
   * Get recent ticks from cache
   */
  async getTicks(asset: string, count?: number): Promise<Tick[]> {
    const result = await this.sendCommand('get_ticks', { asset, count });
    return result.ticks;
  }

  /**
   * Get recent candles from cache
   */
  async getCandles(asset: string, timeframe: number, count?: number): Promise<Candle[]> {
    const result = await this.sendCommand('get_candles', { asset, timeframe, count });
    return result.candles;
  }

  /**
   * Ping Gateway (keep-alive)
   */
  async ping(): Promise<void> {
    await this.sendCommand('ping');
  }

  /**
   * Get daily statistics
   */
  async getStats(date?: string): Promise<any> {
    return await this.sendCommand('get_stats', { date });
  }

  /**
   * Get trades with optional filters
   */
  async getTrades(filters?: {
    limit?: number;
    asset?: string;
    strategy?: string;
    result?: 'WIN' | 'LOSS' | 'PENDING';
    from?: string;
    to?: string;
  }): Promise<any[]> {
    const result = await this.sendCommand('get_trades', filters);
    return result.trades;
  }

  /**
   * Send command to Gateway and wait for response
   */
  private async sendCommand(command: string, params?: any): Promise<any> {
    if (!this.isConnected()) {
      throw new Error('Not connected to Gateway');
    }

    return new Promise((resolve, reject) => {
      const reqId = (++this.requestId).toString();

      const message: CommandMessage = {
        type: 'command',
        command,
        params,
        requestId: reqId,
        timestamp: Date.now(),
      };

      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Command timeout: ${command}`));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout,
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message: GatewayMessage = JSON.parse(data);

      // Handle response
      if (message.type === 'response') {
        this.handleResponse(message as ResponseMessage);
        return;
      }

      // Handle event
      if (message.type === 'error') {
        this.log('Gateway error:', message);
        this.emit('error', new Error((message as any).message));
        return;
      }

      // Handle other event types
      this.handleEvent(message as EventMessage);
    } catch (error) {
      this.log('Failed to parse message:', error);
    }
  }

  /**
   * Handle response message
   */
  private handleResponse(message: ResponseMessage): void {
    const { requestId: msgRequestId, success, data, error } = message;

    if (!msgRequestId) {
      return;
    }

    const pending = this.pendingRequests.get(msgRequestId);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msgRequestId);

      if (success) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(error?.message || 'Command failed'));
      }
    }
  }

  /**
   * Handle event message
   */
  private handleEvent(message: EventMessage): void {
    const { type, data } = message;

    // Emit typed event
    this.emit(type as any, data);
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(): void {
    this.connected = false;
    this.log('Disconnected from Gateway');
    this.emit('disconnected');

    // Reject all pending requests
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    // Auto-reconnect
    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.log(`Reconnecting in ${this.config.reconnectInterval}ms...`);
    this.emit('reconnecting');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        this.log('Reconnection failed:', error);
        // Will schedule another attempt via handleDisconnect
      }
    }, this.config.reconnectInterval);
  }

  /**
   * Log message (if enabled)
   */
  private log(...args: any[]): void {
    if (this.config.enableLogging) {
      console.log('[GatewayClient]', ...args);
    }
  }

  /**
   * Type-safe event listener
   */
  override on<K extends keyof GatewayClientEvents>(
    event: K,
    listener: GatewayClientEvents[K]
  ): this {
    return super.on(event as string, listener);
  }

  /**
   * Type-safe event emitter
   */
  override emit<K extends keyof GatewayClientEvents>(
    event: K,
    ...args: Parameters<GatewayClientEvents[K]>
  ): boolean {
    return super.emit(event as string, ...args);
  }
}
