/**
 * Trade Management System
 *
 * Exports all trade management components
 */

export { TradeManager, type TradeManagerConfig } from './trade-manager.js';
export { SmartExitManager } from './smart-exit-manager.js';
export { TrailingStopManager } from './trailing-stop-manager.js';
export { RiskManager } from './risk-manager.js';
export { PositionMonitor } from './position-monitor.js';
export type {
  Trade,
  TrailingStopInfo,
  SmartExitConfig,
  TrailingStopConfig,
  RiskConfig,
  ExitSignal,
  PositionUpdate,
} from './types.js';
