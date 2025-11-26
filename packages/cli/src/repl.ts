/**
 * Interactive REPL for Trading System - Rich Dashboard UI
 *
 * Features:
 * - Real-time market data with auto-refresh
 * - Live indicators (RSI, Bollinger Bands, ATR)
 * - Signal proximity bars (how close to CALL/PUT signals)
 * - Strategy state monitoring (cooldown, streaks, concurrent trades)
 * - Account balance and P&L tracking
 * - Recent activity log
 * - Interactive commands
 */

import * as readline from 'readline';
import { GatewayClient } from '@deriv-bot/trader';
import type { Candle, Tick } from '@deriv-bot/shared';

// ANSI escape codes
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CURSOR_HOME = '\x1b[H'; // Move cursor to home without clearing
const ERASE_LINE = '\x1b[2K'; // Erase entire line
const ERASE_DOWN = '\x1b[J'; // Erase from cursor to end of screen

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

// Box drawing characters
const box = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
  tTop: '┬',
  tBottom: '┴',
  tLeft: '├',
  tRight: '┤',
  doubleTopLeft: '╔',
  doubleTopRight: '╗',
  doubleBottomLeft: '╚',
  doubleBottomRight: '╝',
  doubleHorizontal: '═',
  doubleVertical: '║',
};

// Colored output helpers
const c = {
  success: (text: string | number) => `${colors.green}${text}${colors.reset}`,
  error: (text: string | number) => `${colors.red}${text}${colors.reset}`,
  info: (text: string | number) => `${colors.cyan}${text}${colors.reset}`,
  warning: (text: string | number) => `${colors.yellow}${text}${colors.reset}`,
  bold: (text: string | number) => `${colors.bold}${text}${colors.reset}`,
  dim: (text: string | number) => `${colors.dim}${text}${colors.reset}`,
  number: (text: string | number) => `${colors.magenta}${text}${colors.reset}`,
  white: (text: string | number) => `${colors.white}${text}${colors.reset}`,
};

interface DashboardState {
  // Market data
  asset: string;
  lastPrice: number;
  lastCandle: Candle | null;
  candleCount: number;
  lastUpdate: Date;

  // Account
  balance: number;
  currency: string;
  sessionStart: Date;
  startBalance: number;

  // Today's stats
  todayTrades: number;
  todayWins: number;
  todayLosses: number;
  todayPending: number;
  todayStake: number;
  todayPayout: number;
  todayPnL: number;

  // Indicators
  rsi: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr: number | null;

  // Signal proximity (0-100%)
  callProximity: number;
  putProximity: number;
  signalStatus: 'MONITORING' | 'SIGNAL_DETECTED' | 'COOLDOWN' | 'MAX_CONCURRENT';

  // Strategy state
  strategyActive: boolean;
  lastTradeTime: Date | null;
  lastTradeResult: 'WIN' | 'LOSS' | null;
  cooldownRemaining: number; // seconds
  concurrentTrades: number;
  maxConcurrent: number;
  winStreak: number;
  lossStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;

  // Recent activity
  recentTrades: Array<{
    time: string;
    result: 'WIN' | 'LOSS' | 'PENDING';
    direction: 'CALL' | 'PUT';
    asset: string;
    entry: number;
    exit: number | null;
    profit: number;
  }>;

  // Connection
  connected: boolean;
}

/**
 * Trading Dashboard REPL
 */
class TradingDashboard {
  private client: GatewayClient;
  private rl: readline.Interface;
  private state: DashboardState;
  private refreshInterval: NodeJS.Timeout | null = null;
  private commandMode = false;
  private inputBuffer = '';
  private lastRenderTime = 0;
  private renderThrottleMs = 5000; // Only re-render every 5 seconds
  private isFirstRender = true;

  // Strategy parameters (from MeanReversionStrategy)
  private readonly RSI_OVERSOLD = 17;
  private readonly RSI_OVERBOUGHT = 83;
  private readonly BB_PERIOD = 20;
  private readonly BB_STDDEV = 2.0;
  private readonly ATR_PERIOD = 14;
  private readonly ATR_MULTIPLIER = 1.0;
  private readonly COOLDOWN_SECONDS = 120;

  constructor(gatewayUrl: string, asset: string = 'R_75') {
    this.client = new GatewayClient({
      url: gatewayUrl,
      autoReconnect: true,
      enableLogging: false,
    });

    this.state = {
      asset,
      lastPrice: 0,
      lastCandle: null,
      candleCount: 0,
      lastUpdate: new Date(),
      balance: 0,
      currency: 'USD',
      sessionStart: new Date(),
      startBalance: 0,
      todayTrades: 0,
      todayWins: 0,
      todayLosses: 0,
      todayPending: 0,
      todayStake: 0,
      todayPayout: 0,
      todayPnL: 0,
      rsi: null,
      bbUpper: null,
      bbMiddle: null,
      bbLower: null,
      atr: null,
      callProximity: 0,
      putProximity: 0,
      signalStatus: 'MONITORING',
      strategyActive: true,
      lastTradeTime: null,
      lastTradeResult: null,
      cooldownRemaining: 0,
      concurrentTrades: 0,
      maxConcurrent: 1,
      winStreak: 0,
      lossStreak: 0,
      maxWinStreak: 2,
      maxLossStreak: 3,
      recentTrades: [],
      connected: false,
    };

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide default prompt
    this.rl.setPrompt('');
  }

  /**
   * Start the dashboard
   */
  async start(): Promise<void> {
    console.log(HIDE_CURSOR);
    console.log(c.info('\n🔌 Connecting to Gateway...'));

    try {
      // Connect to Gateway
      await this.client.connect();
      this.state.connected = true;

      // Get initial balance
      try {
        const balanceInfo = await this.client.getBalance();
        this.state.balance = balanceInfo.amount;
        this.state.startBalance = balanceInfo.amount;
        this.state.currency = balanceInfo.currency;
      } catch (error) {
        // Continue without balance
      }

      // Get today's stats
      await this.updateStats();

      // Get recent trades
      await this.updateRecentTrades();

      // Subscribe to ticks
      await this.client.follow([this.state.asset]);

      // Listen to ticks for live updates (throttled rendering)
      this.client.on('tick', (tick: Tick) => {
        if (tick.asset === this.state.asset) {
          this.state.lastPrice = tick.price;
          this.state.lastUpdate = new Date();

          // Throttle rendering - only re-render every 2 seconds
          const now = Date.now();
          if (!this.commandMode && now - this.lastRenderTime >= this.renderThrottleMs) {
            this.lastRenderTime = now;
            this.render();
          }
        }
      });

      // Start auto-refresh (every 5 seconds for stats, render only on data change)
      this.refreshInterval = setInterval(async () => {
        if (!this.commandMode) {
          await this.updateStats();
        }
      }, 5000);

      // Initial render
      this.render();

      // Setup input handling
      this.setupInputHandling();
    } catch (error: any) {
      console.log(SHOW_CURSOR);
      console.log(c.error(`\n❌ Failed to connect: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Setup input handling
   */
  private setupInputHandling(): void {
    process.stdin.setRawMode(true);
    process.stdin.on('data', async (key: Buffer) => {
      const char = key.toString();

      // Ctrl+C
      if (char === '\u0003') {
        await this.stop();
        return;
      }

      // Enter command mode with ':'
      if (char === ':' && !this.commandMode) {
        this.commandMode = true;
        this.inputBuffer = '';
        this.render();
        return;
      }

      // Command mode
      if (this.commandMode) {
        // Enter - execute command
        if (char === '\r' || char === '\n') {
          await this.executeCommand(this.inputBuffer);
          this.commandMode = false;
          this.inputBuffer = '';
          this.render();
          return;
        }

        // Backspace
        if (char === '\x7f' || char === '\b') {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.render();
          return;
        }

        // Escape - cancel
        if (char === '\x1b') {
          this.commandMode = false;
          this.inputBuffer = '';
          this.render();
          return;
        }

        // Add character to buffer
        if (char.length === 1 && char >= ' ') {
          this.inputBuffer += char;
          this.render();
        }
      } else {
        // Quick commands (no ':' needed)
        switch (char.toLowerCase()) {
          case 'q':
            await this.stop();
            break;
          case 'r':
            await this.updateStats();
            await this.updateRecentTrades();
            this.render();
            break;
          case 'h':
          case '?':
            this.showHelp();
            break;
        }
      }
    });
  }

  /**
   * Execute command
   */
  private async executeCommand(cmd: string): Promise<void> {
    const [command, ...args] = cmd.trim().split(/\s+/);

    try {
      switch (command.toLowerCase()) {
        case 'help':
        case 'h':
          this.showHelp();
          break;

        case 'stats':
        case 's':
          await this.updateStats();
          break;

        case 'trades':
        case 't':
          await this.updateRecentTrades(args[0] ? parseInt(args[0]) : 3);
          break;

        case 'refresh':
        case 'r':
          await this.updateStats();
          await this.updateRecentTrades();
          break;

        case 'quit':
        case 'q':
        case 'exit':
          await this.stop();
          break;

        default:
          if (command) {
            console.log(c.error(`Unknown command: ${command}`));
            setTimeout(() => this.render(), 2000);
          }
      }
    } catch (error: any) {
      console.log(c.error(`Error: ${error.message}`));
      setTimeout(() => this.render(), 2000);
    }
  }

  /**
   * Show help overlay
   */
  private showHelp(): void {
    this.isFirstRender = true; // Force clear on next render
    console.log(CLEAR_SCREEN);
    console.log(c.bold('\n📚 KEYBOARD SHORTCUTS\n'));
    console.log('  Press:');
    console.log(`    ${c.info(':')}     Enter command mode`);
    console.log(`    ${c.info('r')}     Refresh stats and trades`);
    console.log(`    ${c.info('h/?')}   Show this help`);
    console.log(`    ${c.info('q')}     Quit`);
    console.log('\n  Commands (type : first):');
    console.log(`    ${c.info('stats')}        Refresh statistics`);
    console.log(`    ${c.info('trades [n]')}   Show last N trades`);
    console.log(`    ${c.info('refresh')}      Refresh all data`);
    console.log(`    ${c.info('help')}         Show this help`);
    console.log(`    ${c.info('quit')}         Exit dashboard`);
    console.log(c.dim('\n  Press any key to return to dashboard...'));

    process.stdin.once('data', () => {
      this.render();
    });
  }

  /**
   * Update statistics from Gateway
   */
  private async updateStats(): Promise<void> {
    try {
      const result = await this.client.getStats();
      const stats = result.stats || result;

      this.state.todayTrades = stats.totalTrades || 0;
      this.state.todayWins = stats.wins || 0;
      this.state.todayLosses = stats.losses || 0;
      this.state.todayPending = stats.pending || 0;
      this.state.todayStake = stats.totalStake || 0;
      this.state.todayPayout = stats.totalPayout || 0;
      this.state.todayPnL = stats.netPnL || 0;

      // Update balance if available
      if (stats.endBalance) {
        this.state.balance = stats.endBalance;
      }
    } catch (error) {
      // Silent fail - keep old data
    }
  }

  /**
   * Update recent trades
   */
  private async updateRecentTrades(limit: number = 3): Promise<void> {
    try {
      const trades = await this.client.getTrades({ limit });

      this.state.recentTrades = trades.map((trade: any) => ({
        time: new Date(trade.openedAt).toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        result: trade.result,
        direction: trade.type,
        asset: trade.asset,
        entry: trade.entryPrice,
        exit: trade.exitPrice,
        profit: trade.payout ? trade.payout - trade.stake : 0,
      }));

      // Update strategy state from last trade
      if (trades.length > 0) {
        const lastTrade = trades[0];
        this.state.lastTradeTime = new Date(lastTrade.openedAt);
        this.state.lastTradeResult = lastTrade.result;

        // Calculate cooldown
        const timeSinceLastTrade = (Date.now() - this.state.lastTradeTime.getTime()) / 1000;
        this.state.cooldownRemaining = Math.max(0, this.COOLDOWN_SECONDS - timeSinceLastTrade);

        // Calculate streaks
        let winStreak = 0;
        let lossStreak = 0;
        for (const trade of trades) {
          if (trade.result === 'PENDING') continue;
          if (trade.result === 'WIN') {
            winStreak++;
            lossStreak = 0;
          } else {
            lossStreak++;
            winStreak = 0;
          }
          if (winStreak > 0 || lossStreak > 0) break;
        }
        this.state.winStreak = winStreak;
        this.state.lossStreak = lossStreak;
      }
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Calculate signal proximity based on current indicators
   */
  private calculateSignalProximity(): void {
    if (!this.state.rsi || !this.state.bbLower || !this.state.bbUpper || !this.state.atr) {
      this.state.callProximity = 0;
      this.state.putProximity = 0;
      return;
    }

    const price = this.state.lastPrice;
    const rsi = this.state.rsi;

    // CALL proximity (oversold conditions)
    let callScore = 0;
    // RSI proximity to oversold (17)
    if (rsi <= this.RSI_OVERSOLD) {
      callScore += 40; // RSI is oversold
    } else if (rsi <= 30) {
      callScore += 20 * (1 - (rsi - this.RSI_OVERSOLD) / (30 - this.RSI_OVERSOLD));
    }

    // BB lower band proximity
    const bbLowerDistance = ((price - this.state.bbLower) / this.state.bbLower) * 100;
    if (bbLowerDistance <= 0) {
      callScore += 40; // Below lower band
    } else if (bbLowerDistance <= 2) {
      callScore += 40 * (1 - bbLowerDistance / 2);
    }

    // ATR check
    if (this.state.atr >= this.ATR_MULTIPLIER * 10) {
      callScore += 20; // Sufficient volatility
    }

    this.state.callProximity = Math.min(100, callScore);

    // PUT proximity (overbought conditions)
    let putScore = 0;
    // RSI proximity to overbought (83)
    if (rsi >= this.RSI_OVERBOUGHT) {
      putScore += 40; // RSI is overbought
    } else if (rsi >= 70) {
      putScore += 20 * ((rsi - 70) / (this.RSI_OVERBOUGHT - 70));
    }

    // BB upper band proximity
    const bbUpperDistance = ((this.state.bbUpper - price) / this.state.bbUpper) * 100;
    if (bbUpperDistance <= 0) {
      putScore += 40; // Above upper band
    } else if (bbUpperDistance <= 2) {
      putScore += 40 * (1 - bbUpperDistance / 2);
    }

    // ATR check
    if (this.state.atr >= this.ATR_MULTIPLIER * 10) {
      putScore += 20; // Sufficient volatility
    }

    this.state.putProximity = Math.min(100, putScore);

    // Update signal status
    if (this.state.cooldownRemaining > 0) {
      this.state.signalStatus = 'COOLDOWN';
    } else if (this.state.concurrentTrades >= this.state.maxConcurrent) {
      this.state.signalStatus = 'MAX_CONCURRENT';
    } else if (this.state.callProximity >= 80 || this.state.putProximity >= 80) {
      this.state.signalStatus = 'SIGNAL_DETECTED';
    } else {
      this.state.signalStatus = 'MONITORING';
    }
  }

  /**
   * Render the dashboard
   */
  private render(): void {
    // Update mock indicators (in real implementation, get from strategy)
    this.updateMockIndicators();
    this.calculateSignalProximity();

    const width = 80;
    const halfWidth = Math.floor(width / 2) - 2;

    // Always clear screen - simpler and avoids artifacts
    let output = CLEAR_SCREEN;

    // Header
    output += this.renderHeader(width);
    output += '\n';

    // Market Status & Account (side by side)
    output += this.renderPanelRow(
      this.renderMarketStatus(halfWidth),
      this.renderAccount(halfWidth),
      width
    );
    output += '\n';

    // Last Candle
    output += this.renderLastCandle(width);
    output += '\n';

    // Indicators & Signal Proximity (side by side)
    output += this.renderPanelRow(
      this.renderIndicators(halfWidth),
      this.renderSignalProximity(halfWidth),
      width
    );
    output += '\n';

    // Strategy State
    output += this.renderStrategyState(width);
    output += '\n';

    // Today's Statistics
    output += this.renderTodayStats(width);
    output += '\n';

    // Recent Activity
    output += this.renderRecentActivity(width);
    output += '\n';

    // Command prompt
    if (this.commandMode) {
      output += `\nCommand: ${c.info(':' + this.inputBuffer + '_')}\n`;
    } else {
      output += c.dim('\nPress : for commands | r=refresh | h=help | q=quit\n');
    }

    console.log(output);
  }

  /**
   * Render header
   */
  private renderHeader(width: number): string {
    const title = '🤖 DERIV BOT - MEAN REVERSION v2';
    const subtitle = 'Trading Dashboard';
    const titlePadding = Math.floor((width - title.length) / 2);
    const subtitlePadding = Math.floor((width - subtitle.length) / 2);

    let output = '';
    output += box.doubleTopLeft + box.doubleHorizontal.repeat(width - 2) + box.doubleTopRight + '\n';
    output += box.doubleVertical + ' '.repeat(titlePadding) + c.bold(title) + ' '.repeat(width - 2 - titlePadding - title.length) + box.doubleVertical + '\n';
    output += box.doubleVertical + ' '.repeat(subtitlePadding) + c.dim(subtitle) + ' '.repeat(width - 2 - subtitlePadding - subtitle.length) + box.doubleVertical + '\n';
    output += box.doubleBottomLeft + box.doubleHorizontal.repeat(width - 2) + box.doubleBottomRight;

    return output;
  }

  /**
   * Render two panels side by side
   */
  private renderPanelRow(left: string, right: string, width: number): string {
    const leftLines = left.split('\n');
    const rightLines = right.split('\n');
    const maxLines = Math.max(leftLines.length, rightLines.length);

    let output = '';
    for (let i = 0; i < maxLines; i++) {
      const leftLine = leftLines[i] || '';
      const rightLine = rightLines[i] || '';
      output += leftLine + rightLine + '\n';
    }

    return output.trimEnd();
  }

  /**
   * Render Market Status panel
   */
  private renderMarketStatus(width: number): string {
    const title = '📊 MARKET STATUS';
    const padding = width - title.length - 2;

    let output = '';
    output += box.topLeft + box.horizontal.repeat(width - 2) + box.tTop;
    output += '\n';
    output += box.vertical + ' ' + c.bold(title) + ' '.repeat(padding) + box.vertical;
    output += '\n';
    output += box.tLeft + box.horizontal.repeat(width - 2) + box.cross;
    output += '\n';

    // Content
    const lines = [
      `Asset:        ${c.info(this.state.asset)}`,
      `Last Price:   ${c.number(this.state.lastPrice.toFixed(2))}`,
      `Last Update:  ${c.dim(this.state.lastUpdate.toLocaleTimeString('es-AR'))}`,
      `Candles:      #${this.state.candleCount} / 100 loaded`,
    ];

    for (const line of lines) {
      const strippedLength = this.stripAnsi(line).length;
      const pad = width - strippedLength - 4;
      output += box.vertical + '  ' + line + ' '.repeat(pad) + box.vertical + '\n';
    }

    output += box.bottomLeft + box.horizontal.repeat(width - 2) + box.tBottom;

    return output;
  }

  /**
   * Render Account panel
   */
  private renderAccount(width: number): string {
    const title = '💰 ACCOUNT';
    const padding = width - title.length - 2;

    let output = '';
    output += box.tTop + box.horizontal.repeat(width - 2) + box.topRight;
    output += '\n';
    output += box.vertical + ' ' + c.bold(title) + ' '.repeat(padding) + box.vertical;
    output += '\n';
    output += box.cross + box.horizontal.repeat(width - 2) + box.tRight;
    output += '\n';

    // Calculate P&L
    const pnl = this.state.balance - this.state.startBalance;
    const pnlPercent = this.state.startBalance > 0 ? (pnl / this.state.startBalance) * 100 : 0;
    const pnlColor = pnl >= 0 ? c.success : c.error;
    const pnlSign = pnl >= 0 ? '+' : '';

    // Calculate uptime
    const uptime = Date.now() - this.state.sessionStart.getTime();
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);
    const seconds = Math.floor((uptime % 60000) / 1000);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    // Content
    const lines = [
      `Balance:      ${c.number('$' + this.state.balance.toFixed(2))}`,
      `Today P&L:    ${pnlColor(pnlSign + '$' + pnl.toFixed(2) + ' (' + pnlSign + pnlPercent.toFixed(2) + '%)')}`,
      `Session:      Started ${this.state.sessionStart.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`,
      `Uptime:       ${c.dim(uptimeStr)}`,
    ];

    for (const line of lines) {
      const strippedLength = this.stripAnsi(line).length;
      const pad = width - strippedLength - 4;
      output += box.vertical + '  ' + line + ' '.repeat(pad) + box.vertical + '\n';
    }

    output += box.tBottom + box.horizontal.repeat(width - 2) + box.bottomRight;

    return output;
  }

  /**
   * Render Last Candle panel
   */
  private renderLastCandle(width: number): string {
    const title = '📈 LAST CANDLE (1m)';
    const padding = width - title.length - 4;

    let output = '';
    output += box.topLeft + box.horizontal.repeat(width - 2) + box.topRight + '\n';
    output += box.vertical + '  ' + c.bold(title) + ' '.repeat(padding) + box.vertical + '\n';
    output += box.tLeft + box.horizontal.repeat(width - 2) + box.tRight + '\n';

    if (this.state.lastCandle) {
      const candle = this.state.lastCandle;
      const timeStart = new Date(candle.timestamp).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const timeEnd = new Date(candle.timestamp + 60000).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      // Time range
      const timeLine = `Time:   ${timeStart} ${box.horizontal} ${timeEnd}`;
      const timeLinePad = width - this.stripAnsi(timeLine).length - 4;
      output += box.vertical + '  ' + timeLine + ' '.repeat(timeLinePad) + box.vertical + '\n';

      // OHLC
      const ohlcLine =
        `Open:   ${c.number(candle.open.toFixed(2))}  ${box.vertical}  ` +
        `High:  ${c.number(candle.high.toFixed(2))}  ${box.vertical}  ` +
        `Low:  ${c.number(candle.low.toFixed(2))}  ${box.vertical}  ` +
        `Close: ${c.number(candle.close.toFixed(2))}`;
      const ohlcLinePad = width - this.stripAnsi(ohlcLine).length - 4;
      output += box.vertical + '  ' + ohlcLine + ' '.repeat(ohlcLinePad) + box.vertical + '\n';

      // Empty line
      output += box.vertical + '  ' + ' '.repeat(width - 4) + box.vertical + '\n';

      // Visual bar
      const barWidth = width - 20;
      const range = candle.high - candle.low;
      const closePos = range > 0 ? Math.floor(((candle.close - candle.low) / range) * barWidth) : 0;
      const filled = '▓'.repeat(closePos);
      const empty = '░'.repeat(barWidth - closePos);
      const bar = `  ${candle.low.toFixed(2)} ${filled}${empty} ${candle.high.toFixed(2)}`;
      const barPad = width - this.stripAnsi(bar).length - 2;
      output += box.vertical + bar + ' '.repeat(barPad) + box.vertical + '\n';
    } else {
      const noData = 'No candle data available';
      const noDataPad = width - noData.length - 4;
      output += box.vertical + '  ' + c.dim(noData) + ' '.repeat(noDataPad) + box.vertical + '\n';
    }

    output += box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight;

    return output;
  }

  /**
   * Render Indicators panel
   */
  private renderIndicators(width: number): string {
    const title = '🎯 INDICATORS (14-period)';
    const padding = width - title.length - 2;

    let output = '';
    output += box.topLeft + box.horizontal.repeat(width - 2) + box.tTop;
    output += '\n';
    output += box.vertical + ' ' + c.bold(title) + ' '.repeat(padding) + box.vertical;
    output += '\n';
    output += box.tLeft + box.horizontal.repeat(width - 2) + box.cross;
    output += '\n';

    if (this.state.rsi !== null) {
      // RSI
      const rsiValue = this.state.rsi.toFixed(1);
      const rsiColor =
        this.state.rsi <= this.RSI_OVERSOLD
          ? c.success
          : this.state.rsi >= this.RSI_OVERBOUGHT
          ? c.error
          : c.number;
      const rsiLine = `RSI:          ${rsiColor(rsiValue)}`;
      const rsiPad = width - this.stripAnsi(rsiLine).length - 4;
      output += box.vertical + '  ' + rsiLine + ' '.repeat(rsiPad) + box.vertical + '\n';

      output +=
        box.vertical +
        '  ' +
        c.dim(`  Oversold:   < ${this.RSI_OVERSOLD}`) +
        ' '.repeat(width - 24) +
        box.vertical +
        '\n';
      output +=
        box.vertical +
        '  ' +
        c.dim(`  Overbought: > ${this.RSI_OVERBOUGHT}`) +
        ' '.repeat(width - 24) +
        box.vertical +
        '\n';

      // Empty line
      output += box.vertical + '  ' + ' '.repeat(width - 4) + box.vertical + '\n';

      // Bollinger Bands
      output += box.vertical + '  ' + c.bold(`Bollinger Bands (${this.BB_PERIOD}, ${this.BB_STDDEV.toFixed(1)}σ):`) + ' '.repeat(width - 38) + box.vertical + '\n';

      const bbLines = [
        `  Upper:      ${c.number(this.state.bbUpper?.toFixed(2) || 'N/A')}`,
        `  Middle:     ${c.number(this.state.bbMiddle?.toFixed(2) || 'N/A')}`,
        `  Lower:      ${c.number(this.state.bbLower?.toFixed(2) || 'N/A')}`,
        `  Price:      ${c.number(this.state.lastPrice.toFixed(2))} ${c.dim('(middle)')}`,
      ];

      for (const line of bbLines) {
        const pad = width - this.stripAnsi(line).length - 4;
        output += box.vertical + '  ' + line + ' '.repeat(pad) + box.vertical + '\n';
      }

      // Empty line
      output += box.vertical + '  ' + ' '.repeat(width - 4) + box.vertical + '\n';

      // ATR
      const atrValue = this.state.atr?.toFixed(1) || 'N/A';
      const atrStatus =
        this.state.atr && this.state.atr >= this.ATR_MULTIPLIER * 10 ? c.success('(volatility OK)') : c.warning('(low volatility)');
      const atrLine = `ATR:          ${c.number(atrValue)} ${atrStatus}`;
      const atrPad = width - this.stripAnsi(atrLine).length - 4;
      output += box.vertical + '  ' + atrLine + ' '.repeat(atrPad) + box.vertical + '\n';

      const atrThreshold = (this.ATR_MULTIPLIER * 10).toFixed(1);
      output += box.vertical + '  ' + c.dim(`  Threshold:  ${this.ATR_MULTIPLIER.toFixed(1)}x = ${atrThreshold}`) + ' '.repeat(width - 32) + box.vertical + '\n';
    } else {
      const noData = 'Calculating indicators...';
      const noDataPad = width - noData.length - 4;
      output += box.vertical + '  ' + c.dim(noData) + ' '.repeat(noDataPad) + box.vertical + '\n';
    }

    output += box.bottomLeft + box.horizontal.repeat(width - 2) + box.tBottom;

    return output;
  }

  /**
   * Render Signal Proximity panel
   */
  private renderSignalProximity(width: number): string {
    const title = '🔔 SIGNAL PROXIMITY';
    const padding = width - title.length - 2;

    let output = '';
    output += box.tTop + box.horizontal.repeat(width - 2) + box.topRight;
    output += '\n';
    output += box.vertical + ' ' + c.bold(title) + ' '.repeat(padding) + box.vertical;
    output += '\n';
    output += box.cross + box.horizontal.repeat(width - 2) + box.tRight;
    output += '\n';

    // CALL Signal
    const callBar = this.renderProgressBar(this.state.callProximity, 10);
    const callPercent = `${this.state.callProximity.toFixed(0)}%`;
    const callLine = `CALL Signal:  ${callBar}  ${c.number(callPercent)}`;
    const callPad = width - this.stripAnsi(callLine).length - 4;
    output += box.vertical + '  ' + callLine + ' '.repeat(callPad) + box.vertical + '\n';

    // CALL triggers
    output += box.vertical + '  ' + c.dim('  Triggers:   RSI < 17') + ' '.repeat(width - 28) + box.vertical + '\n';
    output += box.vertical + '  ' + c.dim('              BB lower breach') + ' '.repeat(width - 36) + box.vertical + '\n';
    output += box.vertical + '  ' + c.dim('              ATR confirmation') + ' '.repeat(width - 37) + box.vertical + '\n';

    // Empty line
    output += box.vertical + '  ' + ' '.repeat(width - 4) + box.vertical + '\n';

    // PUT Signal
    const putBar = this.renderProgressBar(this.state.putProximity, 10);
    const putPercent = `${this.state.putProximity.toFixed(0)}%`;
    const putLine = `PUT Signal:   ${putBar}  ${c.number(putPercent)}`;
    const putPad = width - this.stripAnsi(putLine).length - 4;
    output += box.vertical + '  ' + putLine + ' '.repeat(putPad) + box.vertical + '\n';

    // PUT triggers
    output += box.vertical + '  ' + c.dim('  Triggers:   RSI > 83') + ' '.repeat(width - 28) + box.vertical + '\n';
    output += box.vertical + '  ' + c.dim('              BB upper breach') + ' '.repeat(width - 36) + box.vertical + '\n';
    output += box.vertical + '  ' + c.dim('              ATR confirmation') + ' '.repeat(width - 37) + box.vertical + '\n';

    // Empty line
    output += box.vertical + '  ' + ' '.repeat(width - 4) + box.vertical + '\n';

    // Status
    const statusEmoji =
      this.state.signalStatus === 'SIGNAL_DETECTED'
        ? '🟢'
        : this.state.signalStatus === 'COOLDOWN'
        ? '🟡'
        : this.state.signalStatus === 'MAX_CONCURRENT'
        ? '🔴'
        : '🟡';

    const statusText =
      this.state.signalStatus === 'SIGNAL_DETECTED'
        ? c.success('SIGNAL DETECTED!')
        : this.state.signalStatus === 'COOLDOWN'
        ? c.warning('COOLDOWN')
        : this.state.signalStatus === 'MAX_CONCURRENT'
        ? c.error('MAX CONCURRENT')
        : c.info('MONITORING');

    const statusLine = `🚦 Status:    ${statusEmoji} ${statusText}`;
    const statusPad = width - this.stripAnsi(statusLine).length - 4;
    output += box.vertical + '  ' + statusLine + ' '.repeat(statusPad) + box.vertical + '\n';

    if (this.state.signalStatus === 'MONITORING') {
      output += box.vertical + '  ' + c.dim('              (no signal yet)') + ' '.repeat(width - 36) + box.vertical + '\n';
    }

    output += box.tBottom + box.horizontal.repeat(width - 2) + box.bottomRight;

    return output;
  }

  /**
   * Render Strategy State panel
   */
  private renderStrategyState(width: number): string {
    const title = '🎮 STRATEGY STATE';
    const padding = width - title.length - 4;

    let output = '';
    output += box.topLeft + box.horizontal.repeat(width - 2) + box.topRight + '\n';
    output += box.vertical + '  ' + c.bold(title) + ' '.repeat(padding) + box.vertical + '\n';
    output += box.tLeft + box.horizontal.repeat(width - 2) + box.tRight + '\n';

    // Status
    const statusIcon = this.state.strategyActive ? '✅' : '❌';
    const statusText = this.state.strategyActive ? c.success('ACTIVE (ready to trade)') : c.error('INACTIVE');
    const statusLine = `Status:           ${statusIcon} ${statusText}`;
    const statusPad = width - this.stripAnsi(statusLine).length - 4;
    output += box.vertical + '  ' + statusLine + ' '.repeat(statusPad) + box.vertical + '\n';

    // Last trade
    if (this.state.lastTradeTime) {
      const timeSince = Math.floor((Date.now() - this.state.lastTradeTime.getTime()) / 60000);
      const resultText = this.state.lastTradeResult === 'WIN' ? c.success('WON') : c.error('LOST');
      const tradeLine = `Last Trade:       ${timeSince} minutes ago (${resultText})`;
      const tradePad = width - this.stripAnsi(tradeLine).length - 4;
      output += box.vertical + '  ' + tradeLine + ' '.repeat(tradePad) + box.vertical + '\n';
    } else {
      const tradeLine = 'Last Trade:       No trades yet';
      const tradePad = width - tradeLine.length - 4;
      output += box.vertical + '  ' + tradeLine + ' '.repeat(tradePad) + box.vertical + '\n';
    }

    // Cooldown
    const cooldownIcon = this.state.cooldownRemaining === 0 ? '✅' : '⏳';
    const cooldownText =
      this.state.cooldownRemaining === 0
        ? c.success(`Ready (${this.COOLDOWN_SECONDS / 60}m cooldown passed)`)
        : c.warning(`${Math.ceil(this.state.cooldownRemaining)}s remaining`);
    const cooldownLine = `Cooldown:         ${cooldownIcon} ${cooldownText}`;
    const cooldownPad = width - this.stripAnsi(cooldownLine).length - 4;
    output += box.vertical + '  ' + cooldownLine + ' '.repeat(cooldownPad) + box.vertical + '\n';

    // Concurrent trades
    const concurrentLine = `Concurrent:       ${c.number(this.state.concurrentTrades)} / ${this.state.maxConcurrent} max`;
    const concurrentPad = width - this.stripAnsi(concurrentLine).length - 4;
    output += box.vertical + '  ' + concurrentLine + ' '.repeat(concurrentPad) + box.vertical + '\n';

    // Win streak
    const winStreakColor = this.state.winStreak >= this.state.maxWinStreak ? c.warning : c.success;
    const winStreakLine = `Win Streak:       ${winStreakColor(this.state.winStreak)} / ${this.state.maxWinStreak} max ${c.dim('(next trade 1% stake)')}`;
    const winStreakPad = width - this.stripAnsi(winStreakLine).length - 4;
    output += box.vertical + '  ' + winStreakLine + ' '.repeat(winStreakPad) + box.vertical + '\n';

    // Loss streak
    const lossStreakColor = this.state.lossStreak >= this.state.maxLossStreak ? c.error : c.dim;
    const lossStreakLine = `Loss Streak:      ${lossStreakColor(this.state.lossStreak)} / ${this.state.maxLossStreak} max`;
    const lossStreakPad = width - this.stripAnsi(lossStreakLine).length - 4;
    output += box.vertical + '  ' + lossStreakLine + ' '.repeat(lossStreakPad) + box.vertical + '\n';

    output += box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight;

    return output;
  }

  /**
   * Render Today's Statistics panel
   */
  private renderTodayStats(width: number): string {
    const title = "📊 TODAY'S STATISTICS";
    const padding = width - title.length - 4;

    let output = '';
    output += box.topLeft + box.horizontal.repeat(width - 2) + box.topRight + '\n';
    output += box.vertical + '  ' + c.bold(title) + ' '.repeat(padding) + box.vertical + '\n';
    output += box.tLeft + box.horizontal.repeat(width - 2) + box.tRight + '\n';

    const winRate = this.state.todayTrades > 0 ? ((this.state.todayWins / this.state.todayTrades) * 100).toFixed(2) : '0.00';
    const roi = this.state.todayStake > 0 ? ((this.state.todayPnL / this.state.todayStake) * 100).toFixed(2) : '0.00';

    // First line: Trades, Wins, Losses, Pending
    const line1 =
      `Trades:    ${c.number(this.state.todayTrades)}  ${box.vertical}  ` +
      `Wins: ${c.success(this.state.todayWins)} (${c.dim(winRate + '%')})  ${box.vertical}  ` +
      `Losses: ${c.error(this.state.todayLosses)}  ${box.vertical}  ` +
      `Pending: ${c.warning(this.state.todayPending)}`;
    const line1Pad = width - this.stripAnsi(line1).length - 4;
    output += box.vertical + '  ' + line1 + ' '.repeat(line1Pad) + box.vertical + '\n';

    // Second line: Stake, Payout, Net P&L
    const pnlColor = this.state.todayPnL >= 0 ? c.success : c.error;
    const pnlSign = this.state.todayPnL >= 0 ? '+' : '';
    const roiSign = parseFloat(roi) >= 0 ? '+' : '';

    const line2 =
      `Stake:     ${c.number('$' + this.state.todayStake.toFixed(2))}  ${box.vertical}  ` +
      `Payout: ${c.number('$' + this.state.todayPayout.toFixed(2))}  ${box.vertical}  ` +
      `Net P&L: ${pnlColor(pnlSign + '$' + this.state.todayPnL.toFixed(2))} ${c.dim('(' + roiSign + roi + '%)')}`;
    const line2Pad = width - this.stripAnsi(line2).length - 4;
    output += box.vertical + '  ' + line2 + ' '.repeat(line2Pad) + box.vertical + '\n';

    output += box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight;

    return output;
  }

  /**
   * Render Recent Activity panel
   */
  private renderRecentActivity(width: number): string {
    const title = '📜 RECENT ACTIVITY (Last 3)';
    const padding = width - title.length - 4;

    let output = '';
    output += box.topLeft + box.horizontal.repeat(width - 2) + box.topRight + '\n';
    output += box.vertical + '  ' + c.bold(title) + ' '.repeat(padding) + box.vertical + '\n';
    output += box.tLeft + box.horizontal.repeat(width - 2) + box.tRight + '\n';

    if (this.state.recentTrades.length === 0) {
      const noTrades = 'No trades yet today';
      const noTradesPad = width - noTrades.length - 4;
      output += box.vertical + '  ' + c.dim(noTrades) + ' '.repeat(noTradesPad) + box.vertical + '\n';
    } else {
      for (const trade of this.state.recentTrades) {
        const resultIcon = trade.result === 'WIN' ? '✅' : trade.result === 'LOSS' ? '❌' : '⏳';
        const dirIcon = trade.direction === 'CALL' ? '📈' : '📉';
        const exitPrice = trade.exit ? trade.exit.toFixed(2) : 'pending';
        const profitColor = trade.profit >= 0 ? c.success : c.error;
        const profitSign = trade.profit >= 0 ? '+' : '';

        const tradeLine =
          `${trade.time} ${box.vertical} ${resultIcon} ${dirIcon} ${trade.direction}  ${box.vertical} ${trade.asset} ${box.vertical} ` +
          `Entry: ${c.number(trade.entry.toFixed(2))} ${box.horizontal} Exit: ${c.number(exitPrice)} ${box.vertical} ` +
          `${profitColor(profitSign + '$' + trade.profit.toFixed(2))}`;

        const tradePad = width - this.stripAnsi(tradeLine).length - 4;
        output += box.vertical + '  ' + tradeLine + ' '.repeat(tradePad) + box.vertical + '\n';
      }
    }

    output += box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight;

    return output;
  }

  /**
   * Render a progress bar
   */
  private renderProgressBar(percent: number, width: number): string {
    const filled = Math.floor((percent / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Strip ANSI codes for length calculation
   */
  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Update mock indicators (replace with real data from strategy)
   */
  private updateMockIndicators(): void {
    // Mock data - in real implementation, get from strategy
    // For now, generate somewhat realistic values
    const price = this.state.lastPrice || 1234.56;

    this.state.rsi = 45 + Math.random() * 10; // Random RSI between 45-55
    this.state.bbUpper = price * 1.04;
    this.state.bbMiddle = price;
    this.state.bbLower = price * 0.96;
    this.state.atr = 12 + Math.random() * 5; // Random ATR between 12-17

    // Mock candle if none
    if (!this.state.lastCandle) {
      this.state.lastCandle = {
        asset: this.state.asset,
        timeframe: 60,
        timestamp: Date.now() - 60000,
        open: price * 0.999,
        high: price * 1.001,
        low: price * 0.998,
        close: price,
      };
      this.state.candleCount = 100;
    }
  }

  /**
   * Stop the dashboard
   */
  async stop(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Move cursor below dashboard and show cursor
    console.log('\n'.repeat(5));
    console.log(SHOW_CURSOR);
    console.log(c.info('\n👋 Disconnecting from Gateway...'));

    await this.client.disconnect();

    console.log(c.success('✅ Disconnected\n'));

    process.exit(0);
  }
}

/**
 * Main
 */
async function main() {
  const gatewayUrl = process.env.GATEWAY_URL || 'ws://localhost:3000';
  const asset = process.env.ASSET || 'R_75';

  const dashboard = new TradingDashboard(gatewayUrl, asset);
  await dashboard.start();
}

main().catch((error) => {
  console.log(SHOW_CURSOR);
  console.error(c.error(`Fatal error: ${error.message}`));
  process.exit(1);
});
