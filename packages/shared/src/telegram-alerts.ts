/**
 * Telegram Alerts - Simple alerting for connection and trading events
 *
 * Usage:
 * const alerter = new TelegramAlerter();
 * await alerter.sendConnectionAlert('disconnected', 'Gateway connection lost');
 */

import TelegramBot from 'node-telegram-bot-api';

export type AlertType =
  | 'connection_lost'
  | 'connection_restored'
  | 'resubscribed'
  | 'health_stale'
  | 'trade_executed'
  | 'trade_closed'
  | 'error'
  | 'warning'
  | 'info';

export interface TelegramAlerterConfig {
  /** Bot token (defaults to TELEGRAM_BOT_TOKEN env) */
  botToken?: string;
  /** Chat ID to send alerts to (defaults to TELEGRAM_CHAT_ID env) */
  chatId?: string;
  /** Service name for context */
  serviceName?: string;
  /** Enable/disable alerts (defaults to true) */
  enabled?: boolean;
}

/**
 * TelegramAlerter - Send alerts to Telegram for important events
 */
export class TelegramAlerter {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private serviceName: string;
  private enabled: boolean;

  constructor(config: TelegramAlerterConfig = {}) {
    const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = config.chatId || process.env.TELEGRAM_CHAT_ID || null;
    this.serviceName = config.serviceName || 'trader';
    this.enabled = config.enabled ?? true;

    if (botToken && this.chatId && this.enabled) {
      try {
        this.bot = new TelegramBot(botToken, { polling: false });
      } catch (error) {
        console.warn('[TelegramAlerter] Failed to initialize:', error);
      }
    }
  }

  /**
   * Check if alerter is ready to send messages
   */
  isReady(): boolean {
    return this.bot !== null && this.chatId !== null && this.enabled;
  }

  /**
   * Send a connection-related alert
   */
  async sendConnectionAlert(
    type: 'disconnected' | 'reconnecting' | 'connected' | 'resubscribed' | 'health_stale',
    details?: string
  ): Promise<void> {
    const emoji = this.getConnectionEmoji(type);
    const title = this.getConnectionTitle(type);

    let message = `${emoji} <b>${title}</b>\n`;
    message += `\n<b>Service:</b> ${this.serviceName}`;

    if (details) {
      message += `\n<b>Details:</b> ${this.escapeHtml(details)}`;
    }

    message += `\n\n🕐 ${new Date().toISOString()}`;

    await this.send(message);
  }

  /**
   * Send a trade alert
   */
  async sendTradeAlert(
    type: 'executed' | 'closed' | 'error',
    data: {
      asset?: string;
      direction?: string;
      stake?: number;
      profit?: number;
      result?: 'WIN' | 'LOSS';
      error?: string;
    }
  ): Promise<void> {
    const emoji = type === 'executed' ? '📈' : type === 'closed' ? (data.result === 'WIN' ? '✅' : '❌') : '⚠️';
    const title = type === 'executed' ? 'Trade Executed' : type === 'closed' ? 'Trade Closed' : 'Trade Error';

    let message = `${emoji} <b>${title}</b>\n`;
    message += `\n<b>Service:</b> ${this.serviceName}`;

    if (data.asset) message += `\n<b>Asset:</b> ${data.asset}`;
    if (data.direction) message += `\n<b>Direction:</b> ${data.direction}`;
    if (data.stake) message += `\n<b>Stake:</b> $${data.stake.toFixed(2)}`;
    if (data.profit !== undefined) message += `\n<b>Profit:</b> $${data.profit.toFixed(2)}`;
    if (data.result) message += `\n<b>Result:</b> ${data.result}`;
    if (data.error) message += `\n<b>Error:</b> ${this.escapeHtml(data.error)}`;

    message += `\n\n🕐 ${new Date().toISOString()}`;

    await this.send(message);
  }

  /**
   * Send a generic alert
   */
  async sendAlert(
    type: 'error' | 'warning' | 'info',
    title: string,
    details?: string | Record<string, any>
  ): Promise<void> {
    const emoji = type === 'error' ? '🔴' : type === 'warning' ? '⚠️' : 'ℹ️';

    let message = `${emoji} <b>${this.escapeHtml(title)}</b>\n`;
    message += `\n<b>Service:</b> ${this.serviceName}`;

    if (details) {
      if (typeof details === 'string') {
        message += `\n<b>Details:</b> ${this.escapeHtml(details)}`;
      } else {
        message += `\n<b>Details:</b>\n<code>${this.escapeHtml(JSON.stringify(details, null, 2))}</code>`;
      }
    }

    message += `\n\n🕐 ${new Date().toISOString()}`;

    await this.send(message);
  }

  /**
   * Send raw message to Telegram
   */
  private async send(message: string): Promise<void> {
    if (!this.bot || !this.chatId) {
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        disable_notification: false,
      });
    } catch (error: any) {
      console.error('[TelegramAlerter] Failed to send message:', error.message);
    }
  }

  /**
   * Get emoji for connection type
   */
  private getConnectionEmoji(type: string): string {
    switch (type) {
      case 'disconnected': return '🔴';
      case 'reconnecting': return '🔄';
      case 'connected': return '🟢';
      case 'resubscribed': return '📡';
      case 'health_stale': return '🏥';
      default: return '📝';
    }
  }

  /**
   * Get title for connection type
   */
  private getConnectionTitle(type: string): string {
    switch (type) {
      case 'disconnected': return 'Connection Lost';
      case 'reconnecting': return 'Reconnecting...';
      case 'connected': return 'Connection Restored';
      case 'resubscribed': return 'Re-subscribed to Assets';
      case 'health_stale': return 'Stale Tick Stream Detected';
      default: return 'Connection Event';
    }
  }

  /**
   * Escape HTML for Telegram
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

/**
 * Create a singleton instance for easy use
 */
let defaultAlerter: TelegramAlerter | null = null;

export function getTelegramAlerter(config?: TelegramAlerterConfig): TelegramAlerter {
  if (!defaultAlerter) {
    defaultAlerter = new TelegramAlerter(config);
  }
  return defaultAlerter;
}
