/**
 * OpenObserve Logger
 * Sends logs to OpenObserve for centralized observability
 */

interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

interface OpenObserveConfig {
  url: string;
  org: string;
  stream: string;
  username: string;
  password: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class OpenObserveLogger {
  private config: OpenObserveConfig;
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private enabled: boolean;

  constructor(config: Partial<OpenObserveConfig> = {}) {
    this.config = {
      url: config.url || process.env.OPENOBSERVE_URL || 'http://localhost:5080',
      org: config.org || process.env.OPENOBSERVE_ORG || 'default',
      stream: config.stream || process.env.OPENOBSERVE_STREAM || 'deriv-bot',
      username: config.username || process.env.OPENOBSERVE_USER || '',
      password: config.password || process.env.OPENOBSERVE_PASSWORD || '',
      batchSize: config.batchSize || 10,
      flushIntervalMs: config.flushIntervalMs || 5000,
    };

    this.enabled = !!(this.config.username && this.config.password);

    if (this.enabled) {
      this.startFlushTimer();
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const logs = [...this.buffer];
    this.buffer = [];

    try {
      const endpoint = `${this.config.url}/api/${this.config.org}/${this.config.stream}/_json`;
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        body: JSON.stringify(logs),
      });

      if (!response.ok) {
        console.error(`[OpenObserve] Failed to send logs: ${response.status}`);
        // Re-add logs to buffer on failure
        this.buffer.unshift(...logs);
      }
    } catch (error) {
      console.error('[OpenObserve] Error sending logs:', error);
      // Re-add logs to buffer on error
      this.buffer.unshift(...logs);
    }
  }

  log(entry: LogEntry): void {
    if (!this.enabled) return;

    const logEntry: LogEntry = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    this.buffer.push(logEntry);

    if (this.buffer.length >= (this.config.batchSize || 10)) {
      this.flush();
    }
  }

  debug(service: string, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'debug', service, message, ...meta });
  }

  info(service: string, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'info', service, message, ...meta });
  }

  warn(service: string, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'warn', service, message, ...meta });
  }

  error(service: string, message: string, meta?: Record<string, unknown>): void {
    this.log({ level: 'error', service, message, ...meta });
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

// Singleton instance
let instance: OpenObserveLogger | null = null;

export function getOpenObserveLogger(config?: Partial<OpenObserveConfig>): OpenObserveLogger {
  if (!instance) {
    instance = new OpenObserveLogger(config);
  }
  return instance;
}

export function createOpenObserveLogger(config?: Partial<OpenObserveConfig>): OpenObserveLogger {
  return new OpenObserveLogger(config);
}
