#!/usr/bin/env node
/**
 * Gateway Main - Entry point for the Gateway service
 *
 * Integrates:
 * - DerivClient: Connection to Deriv API
 * - GatewayServer: WebSocket server for Trader clients
 * - MarketDataCache: In-memory cache with DB overflow
 * - EventBus: Event propagation
 * - Command Handlers: Process Trader commands
 */

// PrismaClient is loaded dynamically to avoid ESM/CJS conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PrismaClient: any;
import { createLogger, type Logger, initSlackAlerts, type SlackAlerter, loadEnvFromRoot } from '@deriv-bot/shared';
import { DerivClient } from './api/deriv-client.js';
import { GatewayServer } from './ws/gateway-server.js';
import { MarketDataCache } from './cache/market-data-cache.js';
import { EventBus } from './events/event-bus.js';
import { StateManager } from './state/state-manager.js';
import { handleCommand, type CommandHandlerContext } from './handlers/command-handlers.js';

// Load environment variables from project root
loadEnvFromRoot();

/**
 * Gateway configuration from environment
 */
interface GatewayConfig {
  // Deriv API
  derivAppId: number;
  derivApiToken: string;
  derivEndpoint: string;
  derivAccount: string; // Account loginid or 'current' (default)

  // Gateway Server
  gatewayPort: number;
  gatewayHost: string;

  // Market Data Cache
  maxTicksPerAsset: number;
  maxCandlesPerAsset: number;
  enablePersistence: boolean;
}

/**
 * Load configuration from environment
 */
function loadConfig(): GatewayConfig {
  // Debug: Print environment variables
  console.log('[Gateway] Environment variables:');
  console.log(`  DERIV_APP_ID: ${process.env.DERIV_APP_ID || 'NOT SET'}`);
  console.log(`  DERIV_API_TOKEN: ${process.env.DERIV_API_TOKEN ? 'SET (length: ' + process.env.DERIV_API_TOKEN.length + ')' : 'NOT SET'}`);
  console.log(`  DERIV_ENDPOINT: ${process.env.DERIV_ENDPOINT || 'NOT SET'}`);
  console.log(`  DERIV_ACCOUNT: ${process.env.DERIV_ACCOUNT || 'current (default)'}`);

  return {
    // Deriv API
    derivAppId: parseInt(process.env.DERIV_APP_ID || '1089', 10),
    derivApiToken: process.env.DERIV_API_TOKEN || '',
    derivEndpoint: process.env.DERIV_ENDPOINT || 'wss://ws.derivws.com/websockets/v3',
    derivAccount: process.env.DERIV_ACCOUNT || 'current',

    // Gateway Server
    gatewayPort: parseInt(process.env.GATEWAY_PORT || '3000', 10),
    gatewayHost: process.env.GATEWAY_HOST || '0.0.0.0',

    // Market Data Cache
    maxTicksPerAsset: parseInt(process.env.MAX_TICKS_PER_ASSET || '1000', 10),
    maxCandlesPerAsset: parseInt(process.env.MAX_CANDLES_PER_ASSET || '500', 10),
    enablePersistence: process.env.ENABLE_PERSISTENCE === 'true',
  };
}

/**
 * Main Gateway class
 */
class Gateway {
  private config: GatewayConfig;
  private logger: Logger;
  private slackAlerter: SlackAlerter | null;
  private derivClient: DerivClient;
  private gatewayServer: GatewayServer;
  private marketCache: MarketDataCache;
  private eventBus: EventBus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private prisma: any;
  private stateManager: StateManager;
  private handlerContext: CommandHandlerContext;

  constructor(config: GatewayConfig) {
    this.config = config;

    // Initialize Slack Alerts (with global error handlers)
    this.slackAlerter = initSlackAlerts('gateway');

    // Initialize Logger
    this.logger = createLogger({
      service: 'gateway',
      level: (process.env.LOG_LEVEL as any) || 'info',
      telegramToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      telegramLevels: process.env.TELEGRAM_ALERT_LEVELS?.split(',') as any || ['error', 'warn'],
    });

    // Initialize DerivClient
    this.derivClient = new DerivClient({
      appId: config.derivAppId,
      endpoint: config.derivEndpoint,
      apiToken: config.derivApiToken,
      defaultAccount: config.derivAccount,
    });

    // Initialize GatewayServer
    this.gatewayServer = new GatewayServer({
      port: config.gatewayPort,
      host: config.gatewayHost,
    });

    // Get EventBus singleton (needed for MarketDataCache)
    this.eventBus = EventBus.getInstance();

    // Initialize MarketDataCache with EventBus
    this.marketCache = new MarketDataCache({
      maxTicksPerAsset: config.maxTicksPerAsset,
      maxCandlesPerAsset: config.maxCandlesPerAsset,
      enablePersistence: config.enablePersistence,
      eventBus: this.eventBus,
    });

    // Prisma will be initialized in start() after dynamic import
    this.prisma = null as any;

    // State Manager will be initialized in start() after Prisma
    this.stateManager = null as any;

    // Create handler context
    this.handlerContext = {
      derivClient: this.derivClient,
      marketCache: this.marketCache,
      gatewayServer: this.gatewayServer,
      eventBus: this.eventBus,
      stateManager: this.stateManager,
    };

    // Setup message handlers
    this.setupHandlers();
  }

  /**
   * Setup message handlers
   */
  private setupHandlers(): void {
    // Handle incoming commands from Trader clients
    this.gatewayServer.on('command', async (data: any) => {
      try {
        this.logger.debug('Handling command', { command: data.command.command });
        await handleCommand(data.ws, data.command, this.handlerContext);
        this.logger.debug('Command handled successfully', { command: data.command.command });
      } catch (error) {
        this.logger.error('Failed to handle command', {
          command: data.command.command,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Handle client connections
    this.gatewayServer.on('client:connected', () => {
      this.logger.info('Trader client connected');
    });

    // Handle client disconnections (debug level - no alerts for normal health checks)
    this.gatewayServer.on('client:disconnected', () => {
      this.logger.debug('Trader client disconnected');
    });
  }

  /**
   * Start the Gateway
   */
  async start(): Promise<void> {
    this.logger.info('🚀 Starting Gateway...');

    // 0. Initialize Prisma (dynamic import already done in main())
    this.prisma = new PrismaClient();
    this.stateManager = new StateManager(this.prisma);
    this.handlerContext.stateManager = this.stateManager;

    // 1. Initialize State Manager
    this.logger.info('Initializing State Manager...');
    await this.stateManager.initialize();
    this.logger.info('✅ State Manager initialized');

    // 2. Connect to Deriv API
    this.logger.info('Connecting to Deriv API...');
    await this.derivClient.connect();
    this.logger.info('✅ Connected to Deriv API');

    // 3. Start Gateway WebSocket server
    this.logger.info('Starting Gateway WebSocket server', {
      host: this.config.gatewayHost,
      port: this.config.gatewayPort,
    });
    await this.gatewayServer.start();
    this.logger.info('✅ Gateway server listening', {
      url: `ws://${this.config.gatewayHost}:${this.config.gatewayPort}`,
    });

    // 4. Print configuration
    this.printConfig();

    // 5. Start connection health monitor
    this.startHealthMonitor();

    this.logger.info('✨ Gateway is ready!');
  }

  /**
   * Start connection health monitor
   * Checks Deriv connection health every 30 seconds
   * If unhealthy for 2 consecutive checks, triggers process exit for PM2 restart
   */
  private startHealthMonitor(): void {
    const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
    const MAX_UNHEALTHY_CHECKS = 2; // Exit after 2 consecutive unhealthy checks (1 minute)
    let unhealthyCount = 0;

    setInterval(async () => {
      const health = this.derivClient.getConnectionHealth();

      if (!health.isHealthy) {
        unhealthyCount++;

        const reason = !health.isConnected
          ? 'WebSocket disconnected'
          : health.secondsSinceLastTick > 120
            ? `No ticks for ${health.secondsSinceLastTick}s`
            : `No pong for ${health.secondsSinceLastPong}s`;

        this.logger.warn(`🔴 Deriv connection unhealthy (${unhealthyCount}/${MAX_UNHEALTHY_CHECKS}): ${reason}`, {
          health,
        });

        // Send Telegram alert on first unhealthy check
        if (unhealthyCount === 1) {
          this.logger.error(`⚠️ GATEWAY CONNECTION DEGRADED: ${reason}. Will restart if not recovered.`);
        }

        // Exit process after MAX_UNHEALTHY_CHECKS - PM2 will restart
        if (unhealthyCount >= MAX_UNHEALTHY_CHECKS) {
          this.logger.error(`🚨 GATEWAY UNHEALTHY - Exiting for PM2 restart. Reason: ${reason}`, {
            health,
          });

          // Force exit - PM2 will restart automatically
          process.exit(1);
        }
      } else {
        // Reset counter on healthy check
        if (unhealthyCount > 0) {
          // Send recovery alert to Telegram (using error level to trigger Telegram notification)
          this.logger.error(`✅ GATEWAY CONNECTION RECOVERED after ${unhealthyCount} unhealthy check(s). Ticks: ${health.totalTicksReceived}, Subscriptions: ${health.activeSubscriptionsCount}`);
        }
        unhealthyCount = 0;
      }
    }, HEALTH_CHECK_INTERVAL);

    this.logger.info('✅ Health monitor started (30s interval, auto-restart after 1 min unhealthy)');
  }

  /**
   * Stop the Gateway
   */
  async stop(): Promise<void> {
    this.logger.info('🛑 Stopping Gateway...');

    // 1. Shutdown State Manager
    this.logger.info('Shutting down State Manager...');
    await this.stateManager.shutdown();
    this.logger.info('✅ State Manager shutdown');

    // 2. Disconnect from Deriv API
    this.logger.info('Disconnecting from Deriv API...');
    await this.derivClient.disconnect();
    this.logger.info('✅ Disconnected from Deriv API');

    // 3. Stop Gateway server
    this.logger.info('Stopping Gateway server...');
    await this.gatewayServer.close();
    this.logger.info('✅ Gateway server stopped');

    // 4. Disconnect from database
    if (this.config.enablePersistence) {
      this.logger.info('Disconnecting from database...');
      await this.marketCache.disconnect();
      this.logger.info('✅ Database disconnected');
    }

    // 5. Close logger
    await this.logger.close();
    console.log('👋 Gateway stopped gracefully');
  }

  /**
   * Print configuration
   */
  private printConfig(): void {
    console.log('⚙️  Configuration:');
    console.log(`   Deriv App ID: ${this.config.derivAppId}`);
    console.log(`   Deriv Endpoint: ${this.config.derivEndpoint}`);
    console.log(`   Gateway Port: ${this.config.gatewayPort}`);
    console.log(`   Gateway Host: ${this.config.gatewayHost}`);
    console.log(`   Max Ticks/Asset: ${this.config.maxTicksPerAsset}`);
    console.log(`   Max Candles/Asset: ${this.config.maxCandlesPerAsset}`);
    console.log(`   Persistence: ${this.config.enablePersistence ? 'enabled' : 'disabled'}`);
    console.log(`   Slack Alerts: ${this.slackAlerter ? 'enabled' : 'disabled'}`);
    console.log();
  }
}

/**
 * Main entry point
 */
async function main() {
  // Load PrismaClient dynamically to avoid ESM/CJS conflicts
  const prismaModule = await import('@prisma/client');
  PrismaClient = prismaModule.PrismaClient;

  // Load configuration
  const config = loadConfig();

  // Create Gateway instance
  const gateway = new Gateway(config);

  // Handle graceful shutdown
  const shutdown = async () => {
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start Gateway
  try {
    await gateway.start();
  } catch (error) {
    console.error('❌ Failed to start Gateway:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { Gateway, type GatewayConfig };
