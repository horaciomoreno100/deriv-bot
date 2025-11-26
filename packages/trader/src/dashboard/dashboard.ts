/**
 * Interactive Trading Dashboard
 * 
 * Displays real-time trading information in an ASCII dashboard format
 */

import readline from 'readline';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { GatewayClient } from '@deriv-bot/shared';
import type { Balance } from '@deriv-bot/shared';

export interface DashboardConfig {
  /** Update interval in milliseconds */
  updateInterval?: number;
  /** Compact mode (less information) */
  compact?: boolean;
  /** Show colors */
  colors?: boolean;
}

export interface Position {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number;
  currentPrice: number;
  profit: number;
  profitPercentage: number;
  purchaseTime: Date;
  status: 'open' | 'sold';
}

export interface StrategyInfo {
  name: string;
  assets: string[];
  status: 'active' | 'paused';
  signalsToday: number;
}

export interface SignalProximity {
  asset: string;
  proximity: number; // 0-100
  direction: 'CALL' | 'PUT' | null;
  conditions: {
    name: string;
    status: 'met' | 'not_met' | 'warning';
    value?: string | number;
  }[];
}

export class TradingDashboard {
  private config: Required<DashboardConfig>;
  private rl: readline.Interface;
  private updateTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastUpdate = new Date();

  private portfolioCache: { positions: Position[]; timestamp: number } | null = null;
  private portfolioCacheTTL = 3000; // 3 seconds (reduced to get fresher data)

  constructor(
    private engine: StrategyEngine | null, // Optional - dashboard can work without it
    private gatewayClient: GatewayClient,
    config: DashboardConfig = {}
  ) {
    this.config = {
      updateInterval: config.updateInterval || 3000, // 3 seconds (reduced from 2 to avoid rate limits)
      compact: config.compact || false,
      colors: config.colors !== false, // default true
    };

    // Setup readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Handle terminal resize
    process.stdout.on('resize', () => {
      if (this.isRunning) {
        this.render();
      }
    });
  }

  /**
   * Start the dashboard
   */
  async start(): Promise<void> {
    this.isRunning = true;

    // Clear screen and hide cursor
    this.clearScreen();
    this.hideCursor();

    // Setup keyboard handlers
    this.setupKeyboardHandlers();

    // Initial render
    await this.render();

    // Start update loop
    this.startUpdateLoop();

    // Handle cleanup on exit
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * Stop the dashboard
   */
  stop(): void {
    this.isRunning = false;

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    this.showCursor();
    this.rl.close();

    // Clear screen and show cursor
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write('\x1b[?25h'); // Show cursor
  }

  /**
   * Clear the screen
   */
  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /**
   * Hide cursor
   */
  private hideCursor(): void {
    process.stdout.write('\x1b[?25l');
  }

  /**
   * Show cursor
   */
  private showCursor(): void {
    process.stdout.write('\x1b[?25h');
  }

  /**
   * Setup keyboard handlers
   */
  private setupKeyboardHandlers(): void {
    // Handle raw mode for immediate key press
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on('data', async (key: Buffer) => {
      const char = key.toString();

      // Ctrl+C
      if (char === '\u0003') {
        this.stop();
        process.exit(0);
      }

      switch (char.toLowerCase()) {
        case 'q':
          this.stop();
          process.exit(0);
        case 'r':
          await this.render();
          break;
        case 'p':
          await this.showPortfolio();
          break;
        case 'b':
          await this.showBalance();
          break;
        case 's':
          await this.showStrategies();
          break;
        case 'h':
          await this.showHelp();
          break;
        case 'c':
          this.config.compact = !this.config.compact;
          await this.render();
          break;
      }
    });
  }

  /**
   * Start the update loop
   */
  private startUpdateLoop(): void {
    this.updateTimer = setInterval(async () => {
      if (this.isRunning) {
        await this.render();
      }
    }, this.config.updateInterval);
  }

  /**
   * Render the dashboard
   */
  private async render(): Promise<void> {
    this.lastUpdate = new Date();

    // Move cursor to top-left
    process.stdout.write('\x1b[H');

    try {
      // Fetch data
      const [balance, positions, strategies, signalProximity, assets] = await Promise.all([
        this.getBalance(),
        this.getPositions(),
        this.getStrategies(),
        this.getSignalProximity(),
        this.getMonitoredAssets(),
      ]);

      // Render dashboard
      const dashboard = this.buildDashboard(balance, positions, strategies, signalProximity, assets);
      process.stdout.write(dashboard);
    } catch (error) {
      const errorMsg = `Error rendering dashboard: ${error instanceof Error ? error.message : String(error)}`;
      process.stdout.write(`\x1b[31m${errorMsg}\x1b[0m\n`);
    }
  }

  /**
   * Build the dashboard string
   */
  private buildDashboard(
    balance: Balance | null,
    positions: Position[],
    strategies: StrategyInfo[],
    signalProximity: SignalProximity[],
    assets: Array<{ symbol: string; price: number; change: number; status: string }>
  ): string {
    const width = process.stdout.columns || 120;
    const header = '🚀 DERIV BOT TRADING DASHBOARD';
    const headerPadding = Math.max(0, Math.floor((width - header.length - 2) / 2));

    let output = '';

    // Header
    output += '╔' + '═'.repeat(width - 2) + '╗\n';
    output += '║' + ' '.repeat(headerPadding) + header + ' '.repeat(width - headerPadding - header.length - 2) + '║\n';
    output += '╠' + '═'.repeat(width - 2) + '╣\n';

    if (this.config.compact) {
      output += this.buildCompactView(balance, positions, strategies, signalProximity, assets, width);
    } else {
      output += this.buildFullView(balance, positions, strategies, signalProximity, assets, width);
    }

    // Footer
    output += '╚' + '═'.repeat(width - 2) + '╝\n';

    return output;
  }

  /**
   * Build full view
   */
  private buildFullView(
    balance: Balance | null,
    positions: Position[],
    strategies: StrategyInfo[],
    signalProximity: SignalProximity[],
    assets: Array<{ symbol: string; price: number; change: number; status: string }>,
    width: number
  ): string {
    const colWidth = Math.floor((width - 3) / 2);
    let output = '';

    // Account Status + Open Positions
    const accountStatus = this.buildAccountStatus(balance, colWidth);
    const openPositions = this.buildOpenPositions(positions, colWidth);
    output += this.mergeTwoColumns(accountStatus, openPositions, colWidth);

    // Strategies + Signal Proximity
    output += '╠' + '═'.repeat(width - 2) + '╣\n';
    const strategiesPanel = this.buildStrategies(strategies, colWidth);
    const signalProximityPanel = this.buildSignalProximity(signalProximity, colWidth);
    output += this.mergeTwoColumns(strategiesPanel, signalProximityPanel, colWidth);

    // Assets + Commands
    output += '╠' + '═'.repeat(width - 2) + '╣\n';
    const assetsPanel = this.buildMonitoredAssets(assets, colWidth);
    const commandsPanel = this.buildCommands(colWidth);
    output += this.mergeTwoColumns(assetsPanel, commandsPanel, colWidth);

    return output;
  }

  /**
   * Merge two column panels side by side
   */
  private mergeTwoColumns(leftPanel: string, rightPanel: string, colWidth: number): string {
    const leftLines = leftPanel.split('\n').filter(line => line.length > 0);
    const rightLines = rightPanel.split('\n').filter(line => line.length > 0);
    const maxLines = Math.max(leftLines.length, rightLines.length);
    
    let output = '';
    for (let i = 0; i < maxLines; i++) {
      const leftLine = leftLines[i] || '';
      const rightLine = rightLines[i] || '';
      
      // Remove trailing '║' from left line and '║ ' from right line start
      const leftContent = leftLine.replace(/║\s*$/, '');
      const rightContent = rightLine.replace(/^║\s*/, '');
      
      // Calculate padding for right content
      const leftWidth = leftContent.length;
      const padding = colWidth - leftWidth;
      
      output += leftContent + ' '.repeat(Math.max(0, padding)) + '║ ' + rightContent + '\n';
    }
    
    return output;
  }

  /**
   * Build compact view
   */
  private buildCompactView(
    balance: Balance | null,
    positions: Position[],
    _strategies: StrategyInfo[],
    signalProximity: SignalProximity[],
    _assets: Array<{ symbol: string; price: number; change: number; status: string }>,
    width: number
  ): string {
    let output = '';

    // Single column layout
    output += this.buildAccountStatus(balance, width - 2);
    output += '\n';
    output += '╠' + '═'.repeat(width - 2) + '╣\n';
    output += this.buildOpenPositions(positions, width - 2);
    output += '\n';
    output += '╠' + '═'.repeat(width - 2) + '╣\n';
    output += this.buildSignalProximity(signalProximity, width - 2);
    output += '\n';

    return output;
  }

  /**
   * Build account status panel
   */
  private buildAccountStatus(balance: Balance | null, width: number): string {
    let output = '║ ';
    output += '📊 ACCOUNT STATUS';
    output += ' '.repeat(width - '📊 ACCOUNT STATUS'.length - 1) + '║\n';
    output += '║ ' + '─'.repeat(width - 2) + ' ║\n';

    if (balance) {
      output += `║ Account: ${balance.loginid || 'N/A'} (${balance.accountType.toUpperCase()})`;
      output += ' '.repeat(width - `Account: ${balance.loginid || 'N/A'} (${balance.accountType.toUpperCase()})`.length - 1) + '║\n';
      output += `║ Balance: $${balance.amount.toFixed(2)} ${balance.currency}`;
      output += ' '.repeat(width - `Balance: $${balance.amount.toFixed(2)} ${balance.currency}`.length - 1) + '║\n';
    } else {
      output += '║ ' + 'Loading...'.padEnd(width - 2) + ' ║\n';
    }

    output += '║ ' + ' '.repeat(width - 2) + ' ║\n';
    output += `║ Last Update: ${this.lastUpdate.toLocaleTimeString()}`;
    output += ' '.repeat(width - `Last Update: ${this.lastUpdate.toLocaleTimeString()}`.length - 1) + '║\n';

    return output;
  }

  /**
   * Build open positions panel
   */
  private buildOpenPositions(positions: Position[], width: number): string {
    let output = '║ ';
    output += `📈 OPEN POSITIONS (${positions.length})`;
    output += ' '.repeat(width - `📈 OPEN POSITIONS (${positions.length})`.length - 1) + '║\n';
    output += '║ ' + '─'.repeat(width - 2) + ' ║\n';

    if (positions.length === 0) {
      output += '║ ' + 'No open positions'.padEnd(width - 2) + ' ║\n';
    } else {
      positions.slice(0, 3).forEach((pos) => {
        const icon = pos.profit >= 0 ? '🟢' : '🔴';
        const profitSign = pos.profit >= 0 ? '+' : '';
        output += `║ ${icon} ${pos.symbol} ${pos.contractType} @ ${pos.currentPrice.toFixed(2)}`;
        output += ' '.repeat(width - `${icon} ${pos.symbol} ${pos.contractType} @ ${pos.currentPrice.toFixed(2)}`.length - 1) + '║\n';
        output += `║    ${profitSign}$${pos.profit.toFixed(2)} (${profitSign}${pos.profitPercentage.toFixed(2)}%)`;
        output += ' '.repeat(width - `   ${profitSign}$${pos.profit.toFixed(2)} (${profitSign}${pos.profitPercentage.toFixed(2)}%)`.length - 1) + '║\n';
        output += `║    Entry: ${pos.buyPrice.toFixed(2)} | Current: ${pos.currentPrice.toFixed(2)}`;
        output += ' '.repeat(width - `   Entry: ${pos.buyPrice.toFixed(2)} | Current: ${pos.currentPrice.toFixed(2)}`.length - 1) + '║\n';
        output += '║ ' + '─'.repeat(width - 2) + ' ║\n';
      });
    }

    return output;
  }

  /**
   * Build strategies panel
   */
  private buildStrategies(strategies: StrategyInfo[], width: number): string {
    let output = '║ ';
    output += `🎯 ACTIVE STRATEGIES (${strategies.length})`;
    output += ' '.repeat(width - `🎯 ACTIVE STRATEGIES (${strategies.length})`.length - 1) + '║\n';
    output += '║ ' + '─'.repeat(width - 2) + ' ║\n';

    if (strategies.length === 0) {
      output += '║ ' + 'No active strategies'.padEnd(width - 2) + ' ║\n';
    } else {
      strategies.forEach((strategy) => {
        output += `║ ✓ ${strategy.name}`;
        output += ' '.repeat(width - `✓ ${strategy.name}`.length - 1) + '║\n';
        output += `║   Assets: ${strategy.assets.join(', ')}`;
        output += ' '.repeat(width - `  Assets: ${strategy.assets.join(', ')}`.length - 1) + '║\n';
        output += `║   Status: ${strategy.status.toUpperCase()} | Signals: ${strategy.signalsToday} today`;
        output += ' '.repeat(width - `  Status: ${strategy.status.toUpperCase()} | Signals: ${strategy.signalsToday} today`.length - 1) + '║\n';
        output += '║ ' + ' '.repeat(width - 2) + ' ║\n';
      });
    }

    return output;
  }

  /**
   * Build signal proximity panel
   */
  private buildSignalProximity(proximity: SignalProximity[], width: number): string {
    let output = '║ ';
    output += '📡 SIGNAL PROXIMITY';
    output += ' '.repeat(width - '📡 SIGNAL PROXIMITY'.length - 1) + '║\n';
    output += '║ ' + '─'.repeat(width - 2) + ' ║\n';

    if (proximity.length === 0) {
      output += '║ ' + 'No signals available'.padEnd(width - 2) + ' ║\n';
    } else {
      proximity.forEach((sig) => {
        const barLength = Math.floor((sig.proximity / 100) * 20);
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        const direction = sig.direction ? ` (${sig.direction})` : '';
        output += `║ ${sig.asset}: ${bar} ${sig.proximity}%${direction}`;
        output += ' '.repeat(width - `${sig.asset}: ${bar} ${sig.proximity}%${direction}`.length - 1) + '║\n';

        sig.conditions.slice(0, 2).forEach((cond) => {
          const icon = cond.status === 'met' ? '✓' : cond.status === 'warning' ? '⚠️' : '✗';
          const value = cond.value ? `: ${cond.value}` : '';
          output += `║   ${icon} ${cond.name}${value}`;
          output += ' '.repeat(width - `  ${icon} ${cond.name}${value}`.length - 1) + '║\n';
        });
        output += '║ ' + '─'.repeat(width - 2) + ' ║\n';
      });
    }

    return output;
  }

  /**
   * Build monitored assets panel
   */
  private buildMonitoredAssets(
    assets: Array<{ symbol: string; price: number; change: number; status: string }>,
    width: number
  ): string {
    let output = '║ ';
    output += `📊 MONITORED ASSETS (${assets.length})`;
    output += ' '.repeat(width - `📊 MONITORED ASSETS (${assets.length})`.length - 1) + '║\n';
    output += '║ ' + '─'.repeat(width - 2) + ' ║\n';

    assets.forEach((asset) => {
      const changeIcon = asset.change >= 0 ? '▲' : '▼';
      const changeSign = asset.change >= 0 ? '+' : '';
      const line = `${asset.symbol}: ${asset.price.toFixed(2)}  ${changeIcon} ${changeSign}${asset.change.toFixed(2)}%  [${asset.status}]`;
      output += `║ ${line}`;
      output += ' '.repeat(width - line.length - 1) + '║\n';
    });

    return output;
  }

  /**
   * Build commands panel
   */
  private buildCommands(width: number): string {
    let output = '║ ';
    output += '⏱️  COMMANDS';
    output += ' '.repeat(width - '⏱️  COMMANDS'.length - 1) + '║\n';
    output += '║ ' + '─'.repeat(width - 2) + ' ║\n';
    output += '║ ' + '• q - Quit'.padEnd(width - 2) + ' ║\n';
    output += '║ ' + '• p - Portfolio'.padEnd(width - 2) + ' ║\n';
    output += '║ ' + '• b - Balance'.padEnd(width - 2) + ' ║\n';
    output += '║ ' + '• s - Strategies'.padEnd(width - 2) + ' ║\n';
    output += '║ ' + '• r - Refresh'.padEnd(width - 2) + ' ║\n';
    output += '║ ' + '• c - Compact mode'.padEnd(width - 2) + ' ║\n';
    output += '║ ' + '• h - Help'.padEnd(width - 2) + ' ║\n';

    return output;
  }

  // Data fetching methods (to be implemented)
  private async getBalance(): Promise<Balance | null> {
    try {
      return await this.gatewayClient.getBalance();
    } catch {
      return null;
    }
  }

  private async getPositions(): Promise<Position[]> {
    // Use local cache to avoid too frequent API calls
    const now = Date.now();
    if (this.portfolioCache && (now - this.portfolioCache.timestamp) < this.portfolioCacheTTL) {
      // Return cached data but log if we have positions
      if (this.portfolioCache.positions.length > 0) {
        console.log(`[Dashboard] Using cached portfolio: ${this.portfolioCache.positions.length} position(s)`);
      }
      return this.portfolioCache.positions;
    }

    try {
      console.log('[Dashboard] Fetching portfolio from Gateway...');
      const positions = await this.gatewayClient.getPortfolio();
      
      // Log for debugging
      console.log(`[Dashboard] Received ${positions.length} position(s) from Gateway`);
      if (positions.length > 0) {
        console.log(`[Dashboard] Positions:`, positions.map(p => ({
          contractId: p.contractId,
          symbol: p.symbol,
          contractType: p.contractType,
          buyPrice: p.buyPrice,
          currentPrice: p.currentPrice,
          profit: p.profit,
        })));
      }
      
      // Convert purchaseTime to Date if it's a string or number
      const normalizedPositions = positions.map(pos => ({
        ...pos,
        purchaseTime: pos.purchaseTime instanceof Date 
          ? pos.purchaseTime 
          : typeof pos.purchaseTime === 'string' || typeof pos.purchaseTime === 'number'
          ? new Date(pos.purchaseTime)
          : new Date(),
      }));
      
      // Update cache
      this.portfolioCache = {
        positions: normalizedPositions,
        timestamp: now,
      };
      return normalizedPositions;
    } catch (error) {
      console.error('[Dashboard] Error getting portfolio:', error);
      // If error but we have cached data, return it
      if (this.portfolioCache) {
        console.log(`[Dashboard] Using stale cache due to error: ${this.portfolioCache.positions.length} position(s)`);
        return this.portfolioCache.positions;
      }
      return [];
    }
  }

  private async getStrategies(): Promise<StrategyInfo[]> {
    if (!this.engine) {
      // Dashboard is decoupled - strategies are running in the trader
      const symbols = (process.env.SYMBOL || 'R_75').split(',').map(s => s.trim());
      return [{
        name: 'RSI + BB Scalping (Running in Trader)',
        assets: symbols,
        status: 'active' as const,
        signalsToday: 0,
      }];
    }
    const strategies = this.engine.getAllStrategies();
    return strategies.map((strategy) => {
      const config = strategy.getConfig();
      return {
        name: strategy.getName(),
        assets: config.assets || [],
        status: strategy.isRunning() ? 'active' : 'paused',
        signalsToday: 0, // TODO: Track signals per strategy
      };
    });
  }

  private async getSignalProximity(): Promise<SignalProximity[]> {
    // Dashboard is decoupled - signal proximity is calculated by the trader
    // Return empty array or show a message that this info is only available in the trader
    if (!this.engine) {
      return [{
        asset: 'N/A',
        proximity: 0,
        direction: null,
        conditions: [{
          name: 'Signal proximity available in trader logs',
          status: 'warning' as const,
          value: 'Run trader:rsi-bb to see signal proximity',
        }],
      }];
    }

    const strategies = this.engine.getAllStrategies();
    const proximity: SignalProximity[] = [];
    const monitoredAssets = this.engine.getMonitoredAssets();

    for (const asset of monitoredAssets) {
      for (const strategy of strategies) {
        try {
          // Try to get signal proximity if strategy supports it
          if (typeof (strategy as any).getSignalProximity === 'function') {
            const candles = this.engine.getCandleDataForAsset(strategy.getName(), asset);
            if (candles.length >= 50) { // Need enough candles for indicators
              // getSignalProximity only takes candles array, not asset
              const prox = (strategy as any).getSignalProximity(candles);
              if (prox) {
                proximity.push({
                  asset,
                  proximity: prox.overallProximity || prox.proximity || 0,
                  direction: prox.direction ? (prox.direction.toUpperCase() as 'CALL' | 'PUT') : null,
                  conditions: (prox.criteria || []).map((c: any) => ({
                    name: c.name || '',
                    status: c.passed ? 'met' : 'not_met',
                    value: c.current !== undefined ? String(c.current) : undefined,
                  })),
                });
                break; // Only show one proximity per asset
              }
            }
          }
        } catch (error) {
          // Strategy doesn't support proximity or error, skip silently
          // console.error(`Error getting proximity for ${asset}:`, error);
        }
      }
    }

    return proximity;
  }

  private async getMonitoredAssets(): Promise<Array<{ symbol: string; price: number; change: number; status: string }>> {
    const result: Array<{ symbol: string; price: number; change: number; status: string }> = [];
    
    if (!this.engine) {
      // Dashboard is decoupled - get assets from environment
      const symbols = (process.env.SYMBOL || 'R_75').split(',').map(s => s.trim());
      for (const symbol of symbols) {
        result.push({
          symbol,
          price: 0, // Price will be updated from Gateway tick stream
          change: 0,
          status: 'MONITORING',
        });
      }
      return result;
    }

    const assets = this.engine.getMonitoredAssets();

    for (const asset of assets) {
      try {
        // Try to get latest tick price first (most up-to-date)
        let latestPrice = 0;
        let previousPrice = 0;

        // Get latest tick from engine (if available)
        const strategies = this.engine.getAllStrategies();
        for (const strategy of strategies) {
          // Try to get latest tick price
          const latestTick = (this.engine as any).getLatestTick?.(strategy.getName());
          if (latestTick && latestTick.asset === asset) {
            latestPrice = latestTick.price;
          }

          // Fallback to candle close price
          if (latestPrice === 0) {
            const candles = this.engine.getCandleDataForAsset(strategy.getName(), asset);
            if (candles.length > 0) {
              const lastCandle = candles[candles.length - 1];
              if (lastCandle) {
                latestPrice = lastCandle.close;
                if (candles.length > 1) {
                  const prevCandle = candles[candles.length - 2];
                  if (prevCandle) {
                    previousPrice = prevCandle.close;
                  }
                }
              }
            }
          } else {
            // If we have tick price, get previous candle for change calculation
            const candles = this.engine.getCandleDataForAsset(strategy.getName(), asset);
            if (candles.length > 0) {
              const lastCandle = candles[candles.length - 1];
              if (lastCandle) {
                previousPrice = lastCandle.close;
              }
            }
          }
          break;
        }

        const change = previousPrice > 0 ? ((latestPrice - previousPrice) / previousPrice) * 100 : 0;

        result.push({
          symbol: asset,
          price: latestPrice,
          change,
          status: latestPrice > 0 ? 'ACTIVE' : 'WAITING',
        });
      } catch {
        result.push({
          symbol: asset,
          price: 0,
          change: 0,
          status: 'UNKNOWN',
        });
      }
    }

    return result;
  }

  // Command handlers
  private async showPortfolio(): Promise<void> {
    // TODO: Show detailed portfolio
  }

  private async showBalance(): Promise<void> {
    // TODO: Show detailed balance
  }

  private async showStrategies(): Promise<void> {
    // TODO: Show detailed strategies
  }

  private async showHelp(): Promise<void> {
    // TODO: Show help
  }
}

