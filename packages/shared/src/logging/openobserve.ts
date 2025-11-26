/**
 * OpenObserve Logger
 * Sends logs to OpenObserve for centralized observability
 * 
 * Supports:
 * - Single stream for all services (default)
 * - Per-service streams (if OPENOBSERVE_STREAM_PER_SERVICE=true)
 * - Service field in all log entries for filtering
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
  service?: string; // Service name for per-service stream configuration
}

export class OpenObserveLogger {
  private config: OpenObserveConfig;
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private enabled: boolean;
  private defaultService: string;

  constructor(config: Partial<OpenObserveConfig> = {}) {
    const usePerServiceStreams = process.env.OPENOBSERVE_STREAM_PER_SERVICE === 'true';
    const baseStream = config.stream || process.env.OPENOBSERVE_STREAM || 'deriv-bot';
    const serviceName = config.service || 'unknown';
    
    // If per-service streams enabled and service name provided, append service to stream name
    const streamName = usePerServiceStreams && serviceName !== 'unknown'
      ? `${baseStream}-${serviceName}`
      : baseStream;

    this.config = {
      url: config.url || process.env.OPENOBSERVE_URL || 'http://localhost:5080',
      org: config.org || process.env.OPENOBSERVE_ORG || 'default',
      stream: streamName,
      username: config.username || process.env.OPENOBSERVE_USER || '',
      password: config.password || process.env.OPENOBSERVE_PASSWORD || '',
      batchSize: config.batchSize || 10,
      flushIntervalMs: config.flushIntervalMs || 5000,
      service: serviceName,
    };

    this.defaultService = serviceName;
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
    // Use provided service or fallback to default
    const serviceName = service || this.defaultService;
    this.log({ level: 'debug', service: serviceName, message, ...meta });
  }

  info(service: string, message: string, meta?: Record<string, unknown>): void {
    // Use provided service or fallback to default
    const serviceName = service || this.defaultService;
    this.log({ level: 'info', service: serviceName, message, ...meta });
  }

  warn(service: string, message: string, meta?: Record<string, unknown>): void {
    // Use provided service or fallback to default
    const serviceName = service || this.defaultService;
    this.log({ level: 'warn', service: serviceName, message, ...meta });
  }

  error(service: string, message: string, meta?: Record<string, unknown>): void {
    // Use provided service or fallback to default
    const serviceName = service || this.defaultService;
    this.log({ level: 'error', service: serviceName, message, ...meta });
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

// Singleton instance (for backward compatibility)
let instance: OpenObserveLogger | null = null;

// Per-service instances (when using per-service streams)
const serviceInstances = new Map<string, OpenObserveLogger>();

/**
 * Get OpenObserve logger instance
 * 
 * If OPENOBSERVE_STREAM_PER_SERVICE=true, creates separate instances per service.
 * Otherwise, returns a singleton instance for all services.
 * 
 * @param config Optional configuration. If service is provided and per-service streams enabled,
 *               returns a service-specific instance.
 */
export function getOpenObserveLogger(config?: Partial<OpenObserveConfig>): OpenObserveLogger {
  const usePerServiceStreams = process.env.OPENOBSERVE_STREAM_PER_SERVICE === 'true';
  const serviceName = config?.service;

  // If per-service streams enabled and service name provided, use service-specific instance
  if (usePerServiceStreams && serviceName) {
    if (!serviceInstances.has(serviceName)) {
      serviceInstances.set(serviceName, new OpenObserveLogger({ ...config, service: serviceName }));
    }
    return serviceInstances.get(serviceName)!;
  }

  // Otherwise, use singleton (backward compatible)
  if (!instance) {
    instance = new OpenObserveLogger(config);
  }
  return instance;
}

/**
 * Create a new OpenObserve logger instance
 * Useful when you need multiple independent loggers
 */
export function createOpenObserveLogger(config?: Partial<OpenObserveConfig>): OpenObserveLogger {
  return new OpenObserveLogger(config);
}

/**
 * Close all logger instances (useful for graceful shutdown)
 */
export async function closeAllLoggers(): Promise<void> {
  const promises: Promise<void>[] = [];
  
  if (instance) {
    promises.push(instance.close());
  }
  
  for (const logger of serviceInstances.values()) {
    promises.push(logger.close());
  }
  
  await Promise.all(promises);
  serviceInstances.clear();
  instance = null;
}
