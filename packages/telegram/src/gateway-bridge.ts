/**
 * Gateway Bridge
 *
 * Connects to the Gateway WebSocket and provides typed methods
 * for sending commands and receiving events
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface GatewayBridgeConfig {
  url: string;
  reconnectInterval?: number;
}

export interface GatewayBridgeEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'trade:executed': (data: any) => void;
  'trade:result': (data: any) => void;
}

export class GatewayBridge extends EventEmitter {
  private config: Required<GatewayBridgeConfig>;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;

  constructor(config: GatewayBridgeConfig) {
    super();
    this.config = {
      url: config.url,
      reconnectInterval: config.reconnectInterval ?? 5000,
    };
  }

  /**
   * Connect to Gateway
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      console.log(`[GatewayBridge] Connecting to ${this.config.url}...`);

      this.ws = new WebSocket(this.config.url);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        console.log('[GatewayBridge] Connected');
        this.emit('connected');
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error('[GatewayBridge] Error:', error);
        this.emit('error', error);
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
   * Handle disconnect
   */
  private handleDisconnect(): void {
    this.connected = false;
    console.log('[GatewayBridge] Disconnected');
    this.emit('disconnected');

    // Auto-reconnect
    this.reconnectTimer = setTimeout(() => {
      console.log('[GatewayBridge] Reconnecting...');
      this.connect().catch(console.error);
    }, this.config.reconnectInterval);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw);

      // Handle response to our command
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        const pending = this.pendingRequests.get(message.requestId)!;
        this.pendingRequests.delete(message.requestId);
        clearTimeout(pending.timeout);

        if (message.success) {
          pending.resolve(message.data);
        } else {
          pending.reject(new Error(message.error?.message || 'Command failed'));
        }
        return;
      }

      // Handle events
      if (message.type === 'trade:executed') {
        this.emit('trade:executed', message.data);
      } else if (message.type === 'trade:result') {
        this.emit('trade:result', message.data);
      }
    } catch (error) {
      console.error('[GatewayBridge] Failed to parse message:', error);
    }
  }

  /**
   * Send command and wait for response
   */
  private async sendCommand(command: string, params?: any): Promise<any> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected to Gateway');
    }

    return new Promise((resolve, reject) => {
      const requestId = `tg-${++this.requestId}-${Date.now()}`;

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Command timeout'));
      }, 15000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify({
        type: 'command',
        command,
        params,
        requestId,
        timestamp: Date.now(),
      }));
    });
  }

  // ============================================
  // Public API Methods
  // ============================================

  /**
   * Ping gateway
   */
  async ping(): Promise<void> {
    await this.sendCommand('ping');
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<{ amount: number; currency: string }> {
    return await this.sendCommand('balance');
  }

  /**
   * Get open positions
   */
  async getPortfolio(): Promise<{
    positions: any[];
    count: number;
    totalProfit: number;
  }> {
    return await this.sendCommand('portfolio');
  }

  /**
   * Get profit table (closed trades)
   */
  async getProfitTable(hours: number = 24): Promise<{
    contracts: any[];
    count: number;
    totalProfit: number;
    wins: number;
    losses: number;
    winRate: number;
  }> {
    const dateFrom = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
    return await this.sendCommand('profit_table', {
      dateFrom,
      limit: 100,
    });
  }

  /**
   * Get daily stats
   */
  async getStats(date?: string): Promise<{
    stats: {
      date: string;
      totalTrades: number;
      wins: number;
      losses: number;
      pending: number;
      winRate: number;
      totalStake: number;
      totalPayout: number;
      netPnL: number;
    };
  }> {
    return await this.sendCommand('get_stats', { date });
  }

  /**
   * Get monitored assets
   */
  async getAssets(): Promise<string[]> {
    const result = await this.sendCommand('get_assets');
    return result.assets || [];
  }

  /**
   * Get trade history
   */
  async getTrades(limit: number = 10): Promise<any[]> {
    const result = await this.sendCommand('get_trades', { limit });
    return result.trades || [];
  }

  /**
   * Get bot info (traders, strategies, uptime)
   */
  async getBotInfo(): Promise<{
    traders: Array<{
      id: string;
      name: string;
      strategy: string;
      symbols: string[];
      uptime: number;
      uptimeFormatted: string;
      isActive: boolean;
    }>;
    system: {
      connectedTraders: number;
      activeStrategies: string[];
      gatewayUptime: number;
      gatewayUptimeFormatted: string;
    };
    todayStats: {
      totalTrades: number;
      wins: number;
      losses: number;
      winRate: number;
      netPnL: number;
    } | null;
  }> {
    return await this.sendCommand('get_bot_info');
  }

  /**
   * Get signal proximities for all tracked assets
   */
  async getSignalProximities(): Promise<{
    proximities: Array<{
      asset: string;
      direction: 'call' | 'put' | 'neutral';
      proximity: number;
      criteria?: Array<{
        name: string;
        current: number;
        target: number;
        unit: string;
        passed: boolean;
        distance: number;
      }>;
      readyToSignal: boolean;
      missingCriteria?: string[];
      timestamp: number;
      age: number;
      ageFormatted: string;
    }>;
    count: number;
    timestamp: number;
  }> {
    return await this.sendCommand('get_signal_proximities');
  }

  /**
   * Get server status (CPU, RAM, disk, PM2 processes)
   */
  async getServerStatus(): Promise<{
    cpu: {
      count: number;
      usage: number;
      model: string;
    };
    memory: {
      total: number;
      used: number;
      free: number;
      usagePct: number;
      totalFormatted: string;
      usedFormatted: string;
      freeFormatted: string;
    };
    disk: {
      total: number;
      used: number;
      available: number;
      usagePct: number;
      totalFormatted: string;
      usedFormatted: string;
      availableFormatted: string;
    };
    system: {
      platform: string;
      hostname: string;
      uptime: number;
      uptimeFormatted: string;
      loadAvg: number[];
    };
    processes: Array<{
      name: string;
      status: string;
      cpu: number;
      memory: number;
      memoryFormatted: string;
      uptime: number;
      uptimeFormatted: string;
      restarts: number;
    }>;
    timestamp: number;
  }> {
    return await this.sendCommand('get_server_status');
  }

  /**
   * Get logs from PM2
   */
  async getLogs(params?: {
    service?: 'gateway' | 'trader' | 'telegram' | 'all';
    lines?: number;
    type?: 'out' | 'error' | 'all';
  }): Promise<{
    logs: Array<{
      service: string;
      type: string;
      content: string;
    }>;
    service: string;
    lines: number;
    type: string;
    timestamp: number;
  }> {
    return await this.sendCommand('get_logs', params);
  }
}
