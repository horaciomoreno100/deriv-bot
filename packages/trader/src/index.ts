/**
 * @deriv-bot/trader - Trading logic, strategies, and risk management
 *
 * Core trading components for executing automated trading strategies
 *
 * NOTE: Some exports are commented out because those modules have TypeScript
 * errors that need to be fixed. Only the essential, working modules are exported.
 */

// Main Trader
// export { Trader, type TraderConfig } from './main.js';

// Gateway Client
export { GatewayClient, type GatewayClientConfig, type GatewayClientEvents } from '@deriv-bot/shared';

// Strategy (WORKING ✅)
export { BaseStrategy, type StrategyContext, type StrategyEvents } from './strategy/base-strategy.js';
export { StrategyEngine, type StrategyEngineEvents } from './strategy/strategy-engine.js';

// Risk Management
// export { RiskManager, type RiskConfig, type TradeDecision } from './risk/risk-manager.js';

// Position Management
// export {
//   PositionManager,
//   type PositionManagerEvents,
//   type DailyStats,
// } from './position/position-manager.js';

// Indicators (WORKING ✅)
export * from './indicators/index.js';

// Built-in Strategies (WORKING ✅)
// export { SMACrossoverStrategy, type SMACrossoverConfig } from './strategies/sma-crossover-strategy.js';
// export { RSIStrategy, type RSIStrategyConfig } from './strategies/rsi-strategy.js';
export { MeanReversionStrategy, type MeanReversionParams } from './strategies/mean-reversion.strategy.js';
export { SupportResistanceStrategy, type SupportResistanceParams } from './strategies/support-resistance.strategy.js';
export { BBSqueezeStrategy, type BBSqueezeParams } from './strategies/bb-squeeze.strategy.js';

// Trade Adapters (WORKING ✅)
export {
  UnifiedTradeAdapter,
  BinaryOptionsAdapter,
  CFDAdapter,
  type TradeMode,
  type TradeDirection,
  type TradeParams,
  type TradeResult,
  type BinaryTradeParams,
  type CFDTradeParams,
} from './adapters/trade-adapter.js';

// Backtesting
// export * from './backtest/index.js';
