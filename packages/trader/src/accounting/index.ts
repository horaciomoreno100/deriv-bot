/**
 * Accounting Module
 *
 * Exports for per-strategy balance allocation and P/L tracking
 */

export {
  StrategyAccountant,
  createStrategyAccountant,
  type StrategyStats,
  type RiskContext,
  type StrategyAccount,
  type TradeRecord,
  type StrategyAccountantEvents,
} from './strategy-accountant.js';
