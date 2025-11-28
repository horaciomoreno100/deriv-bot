/**
 * Backtest Engine - Core Components
 */

export { EventCollector, createEventCollector } from './event-collector.js';
export {
  executeTradeWithContext,
  createTradeEntry,
  createMarketSnapshot,
  calculateStake,
  calculateTpSlPrices,
} from './trade-executor.js';
