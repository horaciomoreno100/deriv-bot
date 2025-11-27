/**
 * Telegram Bot Service
 *
 * Handles Telegram commands and sends notifications
 * Inspired by FreqTrade's Telegram implementation
 */

import TelegramBot from 'node-telegram-bot-api';
import type { GatewayBridge } from './gateway-bridge.js';
import { formatBalance, formatStatus, formatProfit, formatStats, formatTrade, formatBotInfo, formatSignalProximities } from './formatters.js';
import { getOpenObserveLogger, loadEnvFromRoot, type OpenObserveLogger } from '@deriv-bot/shared';

// Lazy initialization of logger - will be initialized when first used
// This ensures environment variables are loaded first
let ooLogger: OpenObserveLogger | null = null;

function getLogger(): OpenObserveLogger {
  if (!ooLogger) {
    // Ensure environment variables are loaded before initializing logger
    if (!process.env.OPENOBSERVE_USER) {
      loadEnvFromRoot();
    }
    ooLogger = getOpenObserveLogger({ service: 'telegram' });
  }
  return ooLogger;
}

export interface TelegramBotConfig {
  token: string;
  chatId: string;
  authorizedUsers?: number[]; // User IDs allowed to send commands
}

export class TelegramBotService {
  private bot: TelegramBot;
  private config: TelegramBotConfig;
  private gateway: GatewayBridge;
  private isRunning = false;

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

    // /stats - Daily statistics
    this.bot.onText(/\/stats/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) return;
      try {
        const stats = await this.gateway.getStats();
        this.sendMessage(formatStats(stats));
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

    console.log('[TelegramBot] Commands registered');
  }

  /**
   * Setup event listeners from Gateway
   */
  private setupGatewayEvents(): void {
    // Trade opened
    this.gateway.on('trade:executed', (data) => {
      this.sendMessage(formatTrade(data, 'opened'));
      getLogger().info('telegram', 'Trade notification sent', { type: 'opened', asset: data.asset });
    });

    // Trade closed
    this.gateway.on('trade:result', (data) => {
      this.sendMessage(formatTrade(data, 'closed'));
      getLogger().info('telegram', 'Trade notification sent', { type: 'closed', profit: data.profit });
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
   */
  async sendMessage(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.config.chatId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('[TelegramBot] Failed to send message:', error);
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
    console.log('[TelegramBot] Bot is running');

    // Send startup message
    await this.sendMessage(
      `*Bot Started*\n\n` +
      `Trading bot is now online.\n` +
      `Use /help to see available commands.`
    );
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('[TelegramBot] Stopping...');

    // Send shutdown message
    await this.sendMessage(`*Bot Stopped*\nTrading bot is now offline.`);

    // Disconnect from gateway
    await this.gateway.disconnect();

    // Stop polling
    await this.bot.stopPolling();

    this.isRunning = false;
    console.log('[TelegramBot] Bot stopped');
  }
}
