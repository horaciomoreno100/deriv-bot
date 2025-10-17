/**
 * @deriv-bot/gateway - Gateway for Deriv API
 *
 * Provides WebSocket connection to Deriv API and exposes
 * a WebSocket server for Trader clients.
 */

// Main Gateway
export { Gateway, type GatewayConfig } from './main.js';

// API Client
export { DerivClient, type DerivClientConfig, type Subscription } from './api/deriv-client.js';

// WebSocket Server
export { GatewayServer, type GatewayServerConfig } from './ws/gateway-server.js';

// Protocol
export * from './ws/protocol.js';

// Cache
export { MarketDataCache, type MarketDataCacheConfig } from './cache/market-data-cache.js';
export { CandleBuilder, type CandleBuilderConfig } from './cache/candle-builder.js';

// Events
export { EventBus } from './events/event-bus.js';

// Command Handlers
export { handleCommand, type CommandHandlerContext } from './handlers/command-handlers.js';
