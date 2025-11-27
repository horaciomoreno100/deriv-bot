/**
 * Mean Reversion Strategies
 *
 * Exports all MR strategies and their factories
 */

// Base
import {
  MRStrategyBase,
  type MRStrategyParams,
  type MRTradeSignal,
  type IndicatorSnapshot,
  type ActiveTrade,
  type ClosedTrade,
  type TradeDirection,
  type ExitReason,
  type FilterResult,
  DEFAULT_MR_PARAMS,
} from '../../strategy/mr-strategy-base.js';

// BB Squeeze MR
import {
  BBSqueezeMRStrategy,
  createBBSqueezeMR,
  type BBSqueezeMRParams,
  BB_SQUEEZE_MR_PARAM_RANGES,
} from './bb-squeeze-mr.strategy.js';

// RSI MR
import {
  RSIMRStrategy,
  createRSIMR,
  type RSIMRParams,
  RSI_MR_PARAM_RANGES,
} from './rsi-mr.strategy.js';

// BB Bounce
import {
  BBBounceStrategy,
  createBBBounce,
  type BBBounceParams,
  BB_BOUNCE_PARAM_RANGES,
} from './bb-bounce.strategy.js';

// Keltner MR
import {
  KeltnerMRStrategy,
  createKeltnerMR,
  type KeltnerMRParams,
  KELTNER_MR_PARAM_RANGES,
} from './keltner-mr.strategy.js';

// Re-export everything
export {
  MRStrategyBase,
  type MRStrategyParams,
  type MRTradeSignal,
  type IndicatorSnapshot,
  type ActiveTrade,
  type ClosedTrade,
  type TradeDirection,
  type ExitReason,
  type FilterResult,
  DEFAULT_MR_PARAMS,
  BBSqueezeMRStrategy,
  createBBSqueezeMR,
  type BBSqueezeMRParams,
  BB_SQUEEZE_MR_PARAM_RANGES,
  RSIMRStrategy,
  createRSIMR,
  type RSIMRParams,
  RSI_MR_PARAM_RANGES,
  BBBounceStrategy,
  createBBBounce,
  type BBBounceParams,
  BB_BOUNCE_PARAM_RANGES,
  KeltnerMRStrategy,
  createKeltnerMR,
  type KeltnerMRParams,
  KELTNER_MR_PARAM_RANGES,
};

// ============================================================================
// STRATEGY REGISTRY
// ============================================================================

/**
 * All available MR strategy names
 */
export const MR_STRATEGY_NAMES = [
  'BB_SQUEEZE_MR',
  'RSI_MR',
  'BB_BOUNCE',
  'KELTNER_MR',
] as const;

export type MRStrategyName = (typeof MR_STRATEGY_NAMES)[number];

/**
 * Create strategy by name
 */
export function createMRStrategy(
  name: MRStrategyName,
  params?: Record<string, unknown>
): MRStrategyBase {
  switch (name) {
    case 'BB_SQUEEZE_MR':
      return createBBSqueezeMR(params);
    case 'RSI_MR':
      return createRSIMR(params);
    case 'BB_BOUNCE':
      return createBBBounce(params);
    case 'KELTNER_MR':
      return createKeltnerMR(params);
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}

/**
 * Get parameter ranges for optimization
 */
export function getParamRanges(name: MRStrategyName): Record<string, number[]> {
  switch (name) {
    case 'BB_SQUEEZE_MR':
      return BB_SQUEEZE_MR_PARAM_RANGES;
    case 'RSI_MR':
      return RSI_MR_PARAM_RANGES;
    case 'BB_BOUNCE':
      return BB_BOUNCE_PARAM_RANGES;
    case 'KELTNER_MR':
      return KELTNER_MR_PARAM_RANGES;
    default:
      return {};
  }
}
