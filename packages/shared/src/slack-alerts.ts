/**
 * Slack Alerts Module
 *
 * Sends alerts to Slack via Incoming Webhooks.
 * Used for monitoring trading bot events: trades, errors, system status.
 */

export type AlertLevel = 'error' | 'warning' | 'info' | 'success';

export interface SlackAlertConfig {
  /** Slack Incoming Webhook URL */
  webhookUrl: string;
  /** Service name for context */
  service: string;
  /** Environment (production, development) */
  environment?: string;
  /** Enable/disable alerts */
  enabled?: boolean;
}

export interface TradeAlert {
  symbol: string;
  direction: 'CALL' | 'PUT';
  stake: number;
  entryPrice?: number;
  confidence?: number;
  strategy?: string;
}

export interface TradeResultAlert {
  symbol: string;
  direction: 'CALL' | 'PUT';
  stake: number;
  profit: number;
  entryPrice?: number;
  exitPrice?: number;
  duration?: number;
}

export interface SystemAlert {
  event: string;
  details?: Record<string, unknown>;
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: Array<{
    type: string;
    text: string;
  }>;
}

interface SlackPayload {
  blocks: SlackBlock[];
  text?: string;
}

/**
 * Slack Alerter class for sending notifications
 */
export class SlackAlerter {
  private webhookUrl: string;
  private service: string;
  private environment: string;
  private enabled: boolean;

  constructor(config: SlackAlertConfig) {
    this.webhookUrl = config.webhookUrl;
    this.service = config.service;
    this.environment = config.environment || 'production';
    this.enabled = config.enabled !== false;
  }

  /**
   * Send trade opened alert
   */
  async tradeOpened(trade: TradeAlert): Promise<void> {
    const emoji = trade.direction === 'CALL' ? '🟢' : '🔴';
    const dirEmoji = trade.direction === 'CALL' ? '📈' : '📉';

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} Trade Opened - ${trade.symbol}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Direction:*\n${dirEmoji} ${trade.direction}`,
          },
          {
            type: 'mrkdwn',
            text: `*Stake:*\n$${trade.stake.toFixed(2)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Entry Price:*\n${trade.entryPrice?.toFixed(5) || 'N/A'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Confidence:*\n${trade.confidence ? `${(trade.confidence * 100).toFixed(0)}%` : 'N/A'}`,
          },
        ],
      },
      this.createContextBlock(),
    ];

    await this.send({ blocks, text: `Trade opened: ${trade.direction} ${trade.symbol}` });
  }

  /**
   * Send trade closed alert
   */
  async tradeClosed(result: TradeResultAlert): Promise<void> {
    const isWin = result.profit > 0;
    const emoji = isWin ? '✅' : '❌';
    const profitEmoji = isWin ? '💰' : '💸';

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} Trade Closed - ${result.symbol}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Result:*\n${isWin ? 'WIN' : 'LOSS'}`,
          },
          {
            type: 'mrkdwn',
            text: `*P/L:*\n${profitEmoji} $${result.profit >= 0 ? '+' : ''}${result.profit.toFixed(2)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Direction:*\n${result.direction}`,
          },
          {
            type: 'mrkdwn',
            text: `*Stake:*\n$${result.stake.toFixed(2)}`,
          },
        ],
      },
      this.createContextBlock(),
    ];

    await this.send({ blocks, text: `Trade closed: ${isWin ? 'WIN' : 'LOSS'} $${result.profit.toFixed(2)}` });
  }

  /**
   * Send error alert
   */
  async error(message: string, details?: Record<string, unknown>): Promise<void> {
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 Error Alert',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Message:*\n\`\`\`${message}\`\`\``,
        },
      },
    ];

    if (details && Object.keys(details).length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:*\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\``,
        },
      });
    }

    blocks.push(this.createContextBlock());

    await this.send({ blocks, text: `Error: ${message}` });
  }

  /**
   * Send warning alert
   */
  async warning(message: string, details?: Record<string, unknown>): Promise<void> {
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Warning',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Message:*\n${message}`,
        },
      },
    ];

    if (details && Object.keys(details).length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:*\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\``,
        },
      });
    }

    blocks.push(this.createContextBlock());

    await this.send({ blocks, text: `Warning: ${message}` });
  }

  /**
   * Send info alert
   */
  async info(message: string, details?: Record<string, unknown>): Promise<void> {
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'ℹ️ Info',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: message,
        },
      },
    ];

    if (details && Object.keys(details).length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:*\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\``,
        },
      });
    }

    blocks.push(this.createContextBlock());

    await this.send({ blocks, text: message });
  }

  /**
   * Send system event alert
   */
  async systemEvent(alert: SystemAlert): Promise<void> {
    const eventEmojis: Record<string, string> = {
      startup: '🚀',
      shutdown: '🛑',
      connected: '🔗',
      disconnected: '🔌',
      reconnecting: '🔄',
      balance_update: '💵',
      daily_summary: '📊',
    };

    const emoji = eventEmojis[alert.event] || '📌';

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} ${this.formatEventName(alert.event)}`,
          emoji: true,
        },
      },
    ];

    if (alert.details && Object.keys(alert.details).length > 0) {
      const fields = Object.entries(alert.details).map(([key, value]) => ({
        type: 'mrkdwn' as const,
        text: `*${this.formatKey(key)}:*\n${this.formatValue(value)}`,
      }));

      blocks.push({
        type: 'section',
        fields: fields.slice(0, 10), // Slack limit
      });
    }

    blocks.push(this.createContextBlock());

    await this.send({ blocks, text: `System: ${alert.event}` });
  }

  /**
   * Send daily summary
   */
  async dailySummary(stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    profit: number;
    winRate: number;
    balance: number;
  }): Promise<void> {
    const isPositive = stats.profit >= 0;
    const emoji = isPositive ? '📈' : '📉';

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} Daily Summary`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Total Trades:*\n${stats.totalTrades}`,
          },
          {
            type: 'mrkdwn',
            text: `*Win Rate:*\n${(stats.winRate * 100).toFixed(1)}%`,
          },
          {
            type: 'mrkdwn',
            text: `*Wins/Losses:*\n✅ ${stats.wins} / ❌ ${stats.losses}`,
          },
          {
            type: 'mrkdwn',
            text: `*P/L:*\n${isPositive ? '💰' : '💸'} $${stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Current Balance:* $${stats.balance.toFixed(2)}`,
        },
      },
      this.createContextBlock(),
    ];

    await this.send({ blocks, text: `Daily Summary: ${stats.totalTrades} trades, P/L: $${stats.profit.toFixed(2)}` });
  }

  /**
   * Create context block with service and timestamp
   */
  private createContextBlock(): SlackBlock {
    return {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🤖 *${this.service}* | 🌐 ${this.environment} | 🕐 ${new Date().toISOString()}`,
        },
      ],
    };
  }

  /**
   * Format event name for display
   */
  private formatEventName(event: string): string {
    return event
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Format key for display
   */
  private formatKey(key: string): string {
    return key
      .split(/(?=[A-Z])|_/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Format value for display
   */
  private formatValue(value: unknown): string {
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    if (typeof value === 'boolean') {
      return value ? '✅ Yes' : '❌ No';
    }
    if (value === null || value === undefined) {
      return 'N/A';
    }
    return String(value);
  }

  /**
   * Send payload to Slack webhook
   */
  private async send(payload: SlackPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Slack alert failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
    }
  }
}

/**
 * Create a Slack alerter instance
 */
export function createSlackAlerter(config: SlackAlertConfig): SlackAlerter {
  return new SlackAlerter(config);
}

/**
 * Create Slack alerter from environment variables
 */
export function createSlackAlerterFromEnv(service: string): SlackAlerter | null {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL not set, Slack alerts disabled');
    return null;
  }

  return new SlackAlerter({
    webhookUrl,
    service,
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
  });
}

/**
 * Setup global error handlers that send alerts to Slack
 * Call this at the start of your service to catch all crashes
 */
export function setupGlobalErrorHandlers(alerter: SlackAlerter, serviceName: string): void {
  // Handle uncaught exceptions (sync errors that weren't caught)
  process.on('uncaughtException', async (error: Error) => {
    console.error('Uncaught Exception:', error);

    try {
      await alerter.error(`Uncaught Exception in ${serviceName}`, {
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      });
    } catch (alertError) {
      console.error('Failed to send Slack alert:', alertError);
    }

    // Give time for the alert to be sent before crashing
    setTimeout(() => process.exit(1), 1000);
  });

  // Handle unhandled promise rejections (async errors that weren't caught)
  process.on('unhandledRejection', async (reason: unknown) => {
    console.error('Unhandled Rejection:', reason);

    const errorInfo =
      reason instanceof Error
        ? {
            name: reason.name,
            message: reason.message,
            stack: reason.stack?.split('\n').slice(0, 5).join('\n'),
          }
        : { reason: String(reason) };

    try {
      await alerter.error(`Unhandled Promise Rejection in ${serviceName}`, errorInfo);
    } catch (alertError) {
      console.error('Failed to send Slack alert:', alertError);
    }
  });

  // Handle SIGTERM (graceful shutdown)
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal');

    try {
      await alerter.systemEvent({
        event: 'shutdown',
        details: { reason: 'SIGTERM received', service: serviceName },
      });
    } catch (alertError) {
      console.error('Failed to send shutdown alert:', alertError);
    }

    process.exit(0);
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal');

    try {
      await alerter.systemEvent({
        event: 'shutdown',
        details: { reason: 'SIGINT received (Ctrl+C)', service: serviceName },
      });
    } catch (alertError) {
      console.error('Failed to send shutdown alert:', alertError);
    }

    process.exit(0);
  });

  // Log that error handlers are set up
  console.log(`Global error handlers configured for ${serviceName}`);
}

/**
 * Quick setup: create alerter from env and setup global handlers
 * Returns the alerter for use in the service, or null if not configured
 */
export function initSlackAlerts(serviceName: string): SlackAlerter | null {
  const alerter = createSlackAlerterFromEnv(serviceName);

  if (alerter) {
    setupGlobalErrorHandlers(alerter, serviceName);

    // Send startup notification
    alerter.systemEvent({
      event: 'startup',
      details: {
        service: serviceName,
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
      },
    });
  }

  return alerter;
}
