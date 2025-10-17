/**
 * Structured Logger with Winston
 *
 * Features:
 * - Multiple log levels (error, warn, info, debug)
 * - File logging with daily rotation
 * - Console output for development
 * - Telegram alerts for critical errors
 * - Structured JSON logs
 * - Context injection (service, clientId, tradeId, etc)
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import TelegramBot from 'node-telegram-bot-api';
import * as path from 'path';
import * as fs from 'fs';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LoggerConfig {
  /** Service name (gateway, trader, cli) */
  service: string;
  /** Log level */
  level?: LogLevel;
  /** Enable console output */
  console?: boolean;
  /** Enable file logging */
  file?: boolean;
  /** Log directory */
  logDir?: string;
  /** Telegram bot token */
  telegramToken?: string;
  /** Telegram chat ID to send alerts to */
  telegramChatId?: string;
  /** Only alert on these levels */
  telegramLevels?: LogLevel[];
}

export interface LogContext {
  [key: string]: any;
}

/**
 * Logger class with structured logging
 */
export class Logger {
  private logger: winston.Logger;
  private service: string;
  private telegramBot?: TelegramBot;
  private telegramChatId?: string;
  private telegramLevels: Set<string>;

  constructor(config: LoggerConfig) {
    this.service = config.service;
    this.telegramLevels = new Set(config.telegramLevels || ['error']);

    // Initialize Telegram bot if provided
    if (config.telegramToken && config.telegramChatId) {
      this.telegramBot = new TelegramBot(config.telegramToken, { polling: false });
      this.telegramChatId = config.telegramChatId;
    }

    // Create log directory
    const logDir = config.logDir || path.join(process.cwd(), 'logs', config.service);
    if (config.file !== false) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'service'] }),
      winston.format.json()
    );

    // Console format (pretty print for dev)
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
        return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
      })
    );

    // Create transports
    const transports: winston.transport[] = [];

    // Console transport (always enabled in dev)
    if (config.console !== false) {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat,
        })
      );
    }

    // File transports (with daily rotation)
    if (config.file !== false) {
      // Combined logs
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, `${config.service}-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: logFormat,
        })
      );

      // Error logs (separate file)
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, `${config.service}-error-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          level: 'error',
          format: logFormat,
        })
      );
    }

    // Create Winston logger
    this.logger = winston.createLogger({
      level: config.level || 'info',
      defaultMeta: { service: config.service },
      transports,
    });
  }

  /**
   * Log error
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Log warning
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log info
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log debug
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log with level and context
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    // Log to Winston
    this.logger.log(level, message, context);

    // Send to Telegram if enabled and level matches
    if (this.telegramBot && this.telegramChatId && this.telegramLevels.has(level)) {
      this.sendTelegramAlert(level, message, context).catch((error) => {
        // Don't fail the app if Telegram fails
        this.logger.error('Failed to send Telegram alert', { error: error.message });
      });
    }
  }

  /**
   * Send alert to Telegram
   */
  private async sendTelegramAlert(level: LogLevel, message: string, context?: LogContext): Promise<void> {
    if (!this.telegramBot || !this.telegramChatId) return;

    const emoji = this.getLevelEmoji(level);
    const timestamp = new Date().toISOString();

    let telegramMessage = `${emoji} <b>${level.toUpperCase()}: ${this.service}</b>\n\n`;
    telegramMessage += `<b>Message:</b>\n<code>${this.escapeHtml(message)}</code>\n\n`;

    if (context && Object.keys(context).length > 0) {
      telegramMessage += `<b>Context:</b>\n<code>${this.escapeHtml(JSON.stringify(context, null, 2))}</code>\n\n`;
    }

    telegramMessage += `🕐 ${timestamp}`;

    await this.telegramBot.sendMessage(this.telegramChatId, telegramMessage, {
      parse_mode: 'HTML',
    });
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

  /**
   * Get emoji for log level
   */
  private getLevelEmoji(level: LogLevel): string {
    switch (level) {
      case 'error':
        return '🔴';
      case 'warn':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      case 'debug':
        return '🐛';
      default:
        return '📝';
    }
  }

  /**
   * Create child logger with additional context
   */
  child(context: LogContext): Logger {
    // Create a new logger instance with merged context
    const childLogger = Object.create(Logger.prototype);
    childLogger.logger = this.logger.child(context);
    childLogger.service = this.service;
    childLogger.telegramBot = this.telegramBot;
    childLogger.telegramChatId = this.telegramChatId;
    childLogger.telegramLevels = this.telegramLevels;
    return childLogger;
  }

  /**
   * Close logger and flush logs
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.close();
      // Give it a moment to flush
      setTimeout(resolve, 100);
    });
  }
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}
