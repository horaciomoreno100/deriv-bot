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

import dotenv from 'dotenv';
import { DerivClient } from './api/deriv-client.js';
import { GatewayServer } from './ws/gateway-server.js';
import { MarketDataCache } from './cache/market-data-cache.js';
import { EventBus } from './events/event-bus.js';
import { handleCommand, type CommandHandlerContext } from './handlers/command-handlers.js';
import { parseMessage } from './ws/protocol.js';
import type { CommandMessage } from './ws/protocol.js';

// Load environment variables from root
dotenv.config({ path: '../../.env' });

/**
 * Gateway configuration from environment
 */
interface GatewayConfig {
  // Deriv API
  derivAppId: number;
  derivApiToken: string;
  derivEndpoint: string;

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

  return {
    // Deriv API
    derivAppId: parseInt(process.env.DERIV_APP_ID || '1089', 10),
    derivApiToken: process.env.DERIV_API_TOKEN || '',
    derivEndpoint: process.env.DERIV_ENDPOINT || 'wss://ws.derivws.com/websockets/v3',

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
  private derivClient: DerivClient;
  private gatewayServer: GatewayServer;
  private marketCache: MarketDataCache;
  private eventBus: EventBus;
  private handlerContext: CommandHandlerContext;

  constructor(config: GatewayConfig) {
    this.config = config;

    // Initialize DerivClient
    this.derivClient = new DerivClient({
      appId: config.derivAppId,
      endpoint: config.derivEndpoint,
      apiToken: config.derivApiToken,
    });

    // Initialize GatewayServer
    this.gatewayServer = new GatewayServer({
      port: config.gatewayPort,
      host: config.gatewayHost,
    });

    // Initialize MarketDataCache
    this.marketCache = new MarketDataCache({
      maxTicksPerAsset: config.maxTicksPerAsset,
      maxCandlesPerAsset: config.maxCandlesPerAsset,
      enablePersistence: config.enablePersistence,
    });

    // Get EventBus singleton
    this.eventBus = EventBus.getInstance();

    // Create handler context
    this.handlerContext = {
      derivClient: this.derivClient,
      marketCache: this.marketCache,
      gatewayServer: this.gatewayServer,
      eventBus: this.eventBus,
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
        console.log('[Gateway] Handling command:', data.command.command);
        await handleCommand(data.ws, data.command, this.handlerContext);
        console.log('[Gateway] Command handled');
      } catch (error) {
        console.error('Failed to handle command:', error);
      }
    });

    // Handle client connections
    this.gatewayServer.on('client:connected', () => {
      console.log('✅ Trader client connected');
    });

    // Handle client disconnections
    this.gatewayServer.on('client:disconnected', () => {
      console.log('❌ Trader client disconnected');
    });
  }

  /**
   * Start the Gateway
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Gateway...\n');

    // 1. Connect to Deriv API
    console.log('📡 Connecting to Deriv API...');
    await this.derivClient.connect();
    console.log('✅ Connected to Deriv API\n');

    // 2. Start Gateway WebSocket server
    console.log(`🌐 Starting Gateway WebSocket server on ${this.config.gatewayHost}:${this.config.gatewayPort}...`);
    await this.gatewayServer.start();
    console.log(`✅ Gateway server listening on ws://${this.config.gatewayHost}:${this.config.gatewayPort}\n`);

    // 3. Print configuration
    this.printConfig();

    console.log('✨ Gateway is ready!\n');
  }

  /**
   * Stop the Gateway
   */
  async stop(): Promise<void> {
    console.log('\n🛑 Stopping Gateway...\n');

    // 1. Disconnect from Deriv API
    console.log('📡 Disconnecting from Deriv API...');
    await this.derivClient.disconnect();
    console.log('✅ Disconnected from Deriv API\n');

    // 2. Stop Gateway server
    console.log('🌐 Stopping Gateway server...');
    await this.gatewayServer.close();
    console.log('✅ Gateway server stopped\n');

    // 3. Disconnect from database
    if (this.config.enablePersistence) {
      console.log('💾 Disconnecting from database...');
      await this.marketCache.disconnect();
      console.log('✅ Database disconnected\n');
    }

    console.log('👋 Gateway stopped gracefully\n');
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
    console.log();
  }
}

/**
 * Main entry point
 */
async function main() {
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
