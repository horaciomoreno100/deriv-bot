/**
 * Telegram Bot Service
 *
 * Handles Telegram commands and sends notifications
 * Inspired by FreqTrade's Telegram implementation
 */

import TelegramBot from 'node-telegram-bot-api';
import type { GatewayBridge } from './gateway-bridge.js';
import { formatBalance, formatStatus, formatProfit, formatStatsGrouped, formatTrade, formatBotInfo, formatSignalProximities, formatServerStatus, formatLogs } from './formatters.js';

export interface TelegramBotConfig {
  token: string;
  chatId: string;
  authorizedUsers?: number[]; // User IDs allowed to send commands
  /** Interval for automatic health reports in ms (default: 4 hours, 0 to disable) */
  autoReportInterval?: number;
  /** Interval for health checks in ms (default: 60 seconds) */
  healthCheckInterval?: number;
}

export class TelegramBotService {
  private bot: TelegramBot;
  private config: TelegramBotConfig;
  private gateway: GatewayBridge;
  private isRunning = false;

  // Auto-reporting and health monitoring
  private autoReportTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private lastHealthStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
  private consecutiveFailures = 0;
  private startTime = Date.now();

  constructor(config: TelegramBotConfig, gateway: GatewayBridge) {
    this.config = config;
    this.gateway = gateway;

    // Create bot with polling
    this.bot = new TelegramBot(config.token, { polling: true });

    // Setup command handlers
    this.setupCommands();

    // Setup event listeners from gateway
    this.setupGatewayEvents();
  }

  /**
   * Setup Telegram command handlers
   */
  private setupCommands(): void {
    // /start - Welcome message
    this.bot.onText(/\/start/, (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      this.sendMessage(
        `*Deriv Trading Bot*\n\n` +
        `Available commands:\n` +
        `/info - Bot info & strategies\n` +
        `/balance - Account balance\n` +
        `/status - Open positions\n` +
        `/profit - Today's P/L\n` +
        `/stats - Trading statistics\n` +
        `/signals - Signal proximities\n` +
        `/assets - Monitored assets\n` +
        `/server - Server status (RAM/CPU/disk)\n` +
        `/logs - Recent logs\n` +
        `/health - System health check\n` +
        `/help - Show this message`
      );
    });

    // /help - Help message
    this.bot.onText(/\/help/, (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      this.sendMessage(
        `*Commands:*\n\n` +
        `*Bot Info:*\n` +
        `/info - Bot status, strategies & uptime\n` +
        `/ping - Check gateway connection\n\n` +
        `*Monitoring:*\n` +
        `/balance - Current account balance\n` +
        `/status - Open positions & P/L\n` +
        `/profit - Last 24h performance\n` +
        `/stats - Daily statistics\n` +
        `/signals - Signal proximities by asset\n` +
        `/assets - Assets being monitored\n\n` +
        `*Server:*\n` +
        `/server - RAM, CPU, disk, PM2 status\n` +
        `/logs [n] - Last n lines (default 50)\n` +
        `/health - Gateway + trader health\n\n` +
        `/help - This message`
      );
    });

    // /ping - Health check
    this.bot.onText(/\/ping/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      const start = Date.now();
      try {
        await this.gateway.ping();
        const latency = Date.now() - start;
        this.sendMessage(`*Pong!*\nGateway latency: ${latency}ms`);
      } catch (error) {
        this.sendMessage(`Gateway offline`);
      }
    });

    // /info - Bot information (strategies, uptime, status)
    this.bot.onText(/\/info/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const info = await this.gateway.getBotInfo();
        this.sendMessage(formatBotInfo(info));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /balance - Account balance
    this.bot.onText(/\/balance/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const balance = await this.gateway.getBalance();
        this.sendMessage(formatBalance(balance));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /status - Open positions
    this.bot.onText(/\/status/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const portfolio = await this.gateway.getPortfolio();
        this.sendMessage(formatStatus(portfolio));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /profit - Last 24h performance
    this.bot.onText(/\/profit/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const profitTable = await this.gateway.getProfitTable();
        this.sendMessage(formatProfit(profitTable));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /stats [period] [assets] - Statistics grouped by strategy
    // Periods: daily (default), weekly, monthly, total
    // Add 'assets' to see breakdown by asset within each strategy
    this.bot.onText(/\/stats(\s+\w+)?(\s+\w+)?/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const args = msg.text?.split(/\s+/).slice(1) || []; // Skip /stats itself
        let period: 'daily' | 'weekly' | 'monthly' | 'total' = 'total'; // Default to total
        let groupByAsset = false;

        // Parse arguments
        for (const arg of args) {
          const lowerArg = arg.toLowerCase();
          if (['daily', 'weekly', 'monthly', 'total'].includes(lowerArg)) {
            period = lowerArg as 'daily' | 'weekly' | 'monthly' | 'total';
          } else if (lowerArg === 'assets' || lowerArg === 'asset') {
            groupByAsset = true;
          }
        }

        const stats = await this.gateway.getStatsGrouped({ period, groupByAsset });
        this.sendMessage(formatStatsGrouped(stats));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /assets - Monitored assets
    this.bot.onText(/\/assets/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const assets = await this.gateway.getAssets();
        if (assets.length === 0) {
          this.sendMessage(`*Monitored Assets:* None`);
        } else {
          this.sendMessage(`*Monitored Assets:*\n${assets.map(a => `• ${a}`).join('\n')}`);
        }
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /signals - Signal proximities
    this.bot.onText(/\/signals/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const proximities = await this.gateway.getSignalProximities();
        this.sendMessage(formatSignalProximities(proximities));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /server - Server status (RAM, CPU, disk, PM2)
    this.bot.onText(/\/server/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const status = await this.gateway.getServerStatus();
        this.sendMessage(formatServerStatus(status));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /logs - Recent logs (optionally specify number of lines)
    this.bot.onText(/\/logs(?:\s+(\d+))?/, async (msg, match) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const lines = match?.[1] ? parseInt(match[1], 10) : 50;
        const logs = await this.gateway.getLogs({ lines, type: 'all' });
        this.sendMessage(formatLogs(logs));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /errors - Recent error logs
    this.bot.onText(/\/errors(?:\s+(\d+))?/, async (msg, match) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const lines = match?.[1] ? parseInt(match[1], 10) : 30;
        const logs = await this.gateway.getLogs({ lines, type: 'error' });
        this.sendMessage(formatLogs(logs));
      } catch (error: any) {
        this.sendMessage(`Error: ${error.message}`);
      }
    });

    // /health - System health check
    this.bot.onText(/\/health/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const start = Date.now();
        await this.gateway.ping();
        const latency = Date.now() - start;

        const status = await this.gateway.getServerStatus();
        const botInfo = await this.gateway.getBotInfo();

        // Build health summary
        const gwStatus = latency < 500 ? '🟢' : latency < 1000 ? '🟡' : '🔴';
        const memStatus = status.memory.usagePct < 60 ? '🟢' : status.memory.usagePct < 80 ? '🟡' : '🔴';
        const diskStatus = status.disk.usagePct < 70 ? '🟢' : status.disk.usagePct < 85 ? '🟡' : '🔴';

        // Check PM2 processes
        const pm2Issues = status.processes.filter(p => p.status !== 'online');
        const pm2Status = pm2Issues.length === 0 ? '🟢' : '🔴';

        // Check traders
        const tradersActive = botInfo.traders.filter(t => t.isActive).length;
        const traderStatus = tradersActive > 0 ? '🟢' : '🔴';

        const healthMsg =
          `*System Health*\n\n` +
          `${gwStatus} Gateway: ${latency}ms\n` +
          `${traderStatus} Traders: ${tradersActive}/${botInfo.traders.length} active\n` +
          `${memStatus} Memory: ${status.memory.usagePct.toFixed(0)}%\n` +
          `${diskStatus} Disk: ${status.disk.usagePct.toFixed(0)}%\n` +
          `${pm2Status} PM2: ${status.processes.length - pm2Issues.length}/${status.processes.length} online\n\n` +
          `_Uptime: ${status.system.uptimeFormatted}_`;

        this.sendMessage(healthMsg);
      } catch (error: any) {
        this.sendMessage(`🔴 *Health Check Failed*\n\n${error.message}`);
      }
    });

    console.log('[TelegramBot] Commands registered');
  }

  /**
   * Setup event listeners from Gateway
   */
  private setupGatewayEvents(): void {
    // Trade opened
    this.gateway.on('trade:executed', (data) => {
      this.sendMessage(formatTrade(data, 'opened'));
      console.log('[TelegramBot] Trade notification sent:', { type: 'opened', asset: data.asset });
    });

    // Trade closed
    this.gateway.on('trade:result', (data) => {
      this.sendMessage(formatTrade(data, 'closed'));
      console.log('[TelegramBot] Trade notification sent:', { type: 'closed', profit: data.profit });
    });

    console.log('[TelegramBot] Gateway events registered');
  }

  /**
   * Check if user is authorized
   */
  private isAuthorized(userId?: number): boolean {
    if (!userId) return false;

    // If no authorized users configured, allow all
    if (!this.config.authorizedUsers || this.config.authorizedUsers.length === 0) {
      return true;
    }

    return this.config.authorizedUsers.includes(userId);
  }

  /**
   * Send message to configured chat
   * Automatically splits long messages (Telegram limit: 4096 characters)
   */
  async sendMessage(text: string): Promise<void> {
    try {
      const MAX_LENGTH = 4096;

      // If message is within limit, send as-is
      if (text.length <= MAX_LENGTH) {
        await this.bot.sendMessage(this.config.chatId, text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
        return;
      }

      // Split long message into chunks
      const chunks: string[] = [];
      let currentChunk = '';
      const lines = text.split('\n');

      for (const line of lines) {
        // If adding this line would exceed limit, save current chunk and start new one
        if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = '';
          }

          // If single line is too long, truncate it
          if (line.length > MAX_LENGTH) {
            chunks.push(line.substring(0, MAX_LENGTH - 3) + '...');
            currentChunk = '...' + line.substring(MAX_LENGTH - 3);
          } else {
            currentChunk = line;
          }
        } else {
          currentChunk += (currentChunk ? '\n' : '') + line;
        }
      }

      // Add remaining chunk
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      // Send all chunks
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const prefix = chunks.length > 1 ? `*[Part ${i + 1}/${chunks.length}]*\n\n` : '';
        await this.bot.sendMessage(this.config.chatId, prefix + chunk, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });

        // Small delay between chunks to avoid rate limiting
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error: any) {
      console.error('[TelegramBot] Failed to send message:', error.message || error);
      // If it's a "message too long" error, try sending a truncated version
      if (error.response?.body?.description?.includes('too long')) {
        try {
          const truncated = text.substring(0, 4000) + '\n\n... _(message truncated)_';
          await this.bot.sendMessage(this.config.chatId, truncated, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          });
        } catch (retryError) {
          console.error('[TelegramBot] Failed to send truncated message:', retryError);
        }
      }
    }
  }

  /**
   * Send notification (silent message)
   */
  async sendNotification(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.config.chatId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        disable_notification: true,
      });
    } catch (error) {
      console.error('[TelegramBot] Failed to send notification:', error);
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('[TelegramBot] Starting...');

    // Connect to gateway
    await this.gateway.connect();

    this.isRunning = true;
    this.startTime = Date.now();
    console.log('[TelegramBot] Bot is running');

    // Send startup message
    await this.sendMessage(
      `*Bot Started*\n\n` +
      `Trading bot is now online.\n` +
      `Use /help to see available commands.`
    );

    // Start auto-reporting and health monitoring
    this.startAutoReporting();
    this.startHealthMonitoring();
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('[TelegramBot] Stopping...');

    // Stop timers
    this.stopAutoReporting();
    this.stopHealthMonitoring();

    // Send shutdown message
    await this.sendMessage(`*Bot Stopped*\nTrading bot is now offline.`);

    // Disconnect from gateway
    await this.gateway.disconnect();

    // Stop polling
    await this.bot.stopPolling();

    this.isRunning = false;
    console.log('[TelegramBot] Bot stopped');
  }

  // ============================================
  // Auto-Reporting System
  // ============================================

  /**
   * Start automatic health reporting
   * Sends periodic status reports to keep you informed
   */
  private startAutoReporting(): void {
    const interval = this.config.autoReportInterval ?? 4 * 60 * 60 * 1000; // Default: 4 hours

    if (interval <= 0) {
      console.log('[TelegramBot] Auto-reporting disabled');
      return;
    }

    console.log(`[TelegramBot] Auto-reporting enabled (every ${interval / 1000 / 60} minutes)`);

    this.autoReportTimer = setInterval(async () => {
      await this.sendAutoReport();
    }, interval);

    // Send first report after 5 minutes
    setTimeout(() => this.sendAutoReport(), 5 * 60 * 1000);
  }

  /**
   * Stop automatic reporting
   */
  private stopAutoReporting(): void {
    if (this.autoReportTimer) {
      clearInterval(this.autoReportTimer);
      this.autoReportTimer = null;
    }
  }

  /**
   * Send automatic status report
   */
  private async sendAutoReport(): Promise<void> {
    try {
      const start = Date.now();
      await this.gateway.ping();
      const latency = Date.now() - start;

      const status = await this.gateway.getServerStatus();
      const botInfo = await this.gateway.getBotInfo();
      const balance = await this.gateway.getBalance();

      // Calculate uptime
      const uptimeMs = Date.now() - this.startTime;
      const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

      // Check for issues
      const issues: string[] = [];

      if (latency > 1000) issues.push(`High latency: ${latency}ms`);
      if (status.memory.usagePct > 80) issues.push(`High memory: ${status.memory.usagePct.toFixed(0)}%`);
      if (status.disk.usagePct > 85) issues.push(`High disk: ${status.disk.usagePct.toFixed(0)}%`);

      const offlineProcesses = status.processes.filter(p => p.status !== 'online');
      if (offlineProcesses.length > 0) {
        issues.push(`Offline: ${offlineProcesses.map(p => p.name).join(', ')}`);
      }

      const highRestarts = status.processes.filter(p => p.restarts > 10);
      if (highRestarts.length > 0) {
        issues.push(`High restarts: ${highRestarts.map(p => `${p.name}(${p.restarts})`).join(', ')}`);
      }

      // Build report
      const statusEmoji = issues.length === 0 ? '🟢' : issues.length <= 2 ? '🟡' : '🔴';
      const tradersActive = botInfo.traders.filter(t => t.isActive).length;

      let report = `${statusEmoji} *Auto Status Report*\n\n`;
      report += `*System:*\n`;
      report += `├ Gateway: ${latency}ms\n`;
      report += `├ Traders: ${tradersActive}/${botInfo.traders.length}\n`;
      report += `├ Memory: ${status.memory.usagePct.toFixed(0)}%\n`;
      report += `├ Disk: ${status.disk.usagePct.toFixed(0)}%\n`;
      report += `└ Uptime: ${uptimeHours}h ${uptimeMins}m\n\n`;

      report += `*Account:*\n`;
      report += `└ Balance: ${balance.currency} ${balance.amount.toFixed(2)}\n\n`;

      // Today's performance
      if (botInfo.todayStats && botInfo.todayStats.totalTrades > 0) {
        const stats = botInfo.todayStats;
        const pnlEmoji = stats.netPnL >= 0 ? '📈' : '📉';
        report += `*Today:*\n`;
        report += `├ Trades: ${stats.totalTrades} (${stats.wins}W/${stats.losses}L)\n`;
        report += `├ Win Rate: ${stats.winRate.toFixed(1)}%\n`;
        report += `└ ${pnlEmoji} P/L: $${stats.netPnL.toFixed(2)}\n\n`;
      }

      // PM2 Processes summary
      report += `*Processes:*\n`;
      for (const proc of status.processes.slice(0, 6)) {
        const icon = proc.status === 'online' ? '✅' : '❌';
        report += `${icon} ${proc.name} (${proc.uptimeFormatted}, ↻${proc.restarts})\n`;
      }
      if (status.processes.length > 6) {
        report += `_...and ${status.processes.length - 6} more_\n`;
      }

      // Issues
      if (issues.length > 0) {
        report += `\n⚠️ *Issues:*\n`;
        for (const issue of issues) {
          report += `• ${issue}\n`;
        }
      }

      report += `\n_${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}_`;

      await this.sendNotification(report);
      console.log('[TelegramBot] Auto-report sent');
    } catch (error: any) {
      console.error('[TelegramBot] Failed to send auto-report:', error.message);
    }
  }

  // ============================================
  // Health Monitoring System
  // ============================================

  /**
   * Start continuous health monitoring
   * Sends alerts when issues are detected
   */
  private startHealthMonitoring(): void {
    const interval = this.config.healthCheckInterval ?? 60 * 1000; // Default: 60 seconds

    console.log(`[TelegramBot] Health monitoring enabled (every ${interval / 1000}s)`);

    this.healthCheckTimer = setInterval(async () => {
      await this.checkHealth();
    }, interval);
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check system health and send alerts if needed
   */
  private async checkHealth(): Promise<void> {
    try {
      const start = Date.now();
      await this.gateway.ping();
      const latency = Date.now() - start;

      // Determine health status
      let newStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';

      if (latency > 5000) {
        newStatus = 'critical';
      } else if (latency > 2000) {
        newStatus = 'degraded';
      }

      // Check server status for additional issues
      try {
        const status = await this.gateway.getServerStatus();

        if (status.memory.usagePct > 90 || status.disk.usagePct > 95) {
          newStatus = 'critical';
        } else if (status.memory.usagePct > 80 || status.disk.usagePct > 85) {
          if (newStatus === 'healthy') newStatus = 'degraded';
        }

        const offlineCount = status.processes.filter(p => p.status !== 'online').length;
        if (offlineCount > 0) {
          newStatus = 'critical';
        }
      } catch {
        // Server status check failed - don't change status just for this
      }

      // Reset consecutive failures on success
      this.consecutiveFailures = 0;

      // Alert on status change
      if (newStatus !== this.lastHealthStatus) {
        await this.sendHealthAlert(newStatus, this.lastHealthStatus);
        this.lastHealthStatus = newStatus;
      }
    } catch (error: any) {
      this.consecutiveFailures++;

      // Alert after 3 consecutive failures
      if (this.consecutiveFailures === 3) {
        await this.sendMessage(
          `🔴 *CRITICAL: Gateway Unreachable*\n\n` +
          `The gateway has been unreachable for 3 consecutive checks.\n\n` +
          `Error: ${error.message}\n\n` +
          `_Please check the server immediately._`
        );
        this.lastHealthStatus = 'critical';
      }

      // Send periodic reminders every 10 failures
      if (this.consecutiveFailures > 0 && this.consecutiveFailures % 10 === 0) {
        await this.sendMessage(
          `🔴 *Gateway Still Unreachable*\n\n` +
          `Failed checks: ${this.consecutiveFailures}\n` +
          `Duration: ~${this.consecutiveFailures} minutes\n\n` +
          `_Automatic monitoring continues..._`
        );
      }
    }
  }

  /**
   * Send health status change alert
   */
  private async sendHealthAlert(
    newStatus: 'healthy' | 'degraded' | 'critical',
    oldStatus: 'healthy' | 'degraded' | 'critical'
  ): Promise<void> {
    const icons = {
      healthy: '🟢',
      degraded: '🟡',
      critical: '🔴',
    };

    if (newStatus === 'healthy' && oldStatus !== 'healthy') {
      // Recovery
      await this.sendMessage(
        `${icons.healthy} *System Recovered*\n\n` +
        `Status: ${oldStatus} → ${newStatus}\n\n` +
        `All systems are now operating normally.`
      );
    } else if (newStatus === 'degraded') {
      await this.sendNotification(
        `${icons.degraded} *System Degraded*\n\n` +
        `Performance issues detected.\n` +
        `Monitoring continues...`
      );
    } else if (newStatus === 'critical') {
      await this.sendMessage(
        `${icons.critical} *CRITICAL: System Issues*\n\n` +
        `Serious problems detected!\n\n` +
        `Use /health to check details.`
      );
    }
  }
}
