/**
 * Backtest Strategies
 *
 * Pre-built strategies that implement BacktestableStrategy interface.
 */

export {
  BBSqueezeBacktestStrategy,
  createBBSqueezeStrategy,
} from './bb-squeeze-backtest.strategy.js';

export {
  BBSqueezeMRBacktestStrategy,
  createBBSqueezeMRStrategy,
} from './bb-squeeze-mr-backtest.strategy.js';

export {
  KeltnerMRBacktestStrategy,
  createKeltnerMRStrategy,
} from './keltner-mr-backtest.strategy.js';

export {
  HybridMTFBacktestStrategy,
  createHybridMTFStrategy,
} from './hybrid-mtf-backtest.strategy.js';

export {
  TrendExhaustionBacktestStrategy,
  createTrendExhaustionStrategy,
  createRSIDivergenceStrategy,
  createPinBarStrategy,
  createEngulfingStrategy,
  createEMADistanceStrategy,
  createExhaustionCandlesStrategy,
  createMultiComboStrategy,
  createZigZagReversalStrategy,
  createRSIDivergenceConfirmedStrategy,
  createZigZagRSIComboStrategy,
  createCHoCHStrategy,
  createCHoCHPullbackStrategy,
  createZigZagStrongStrategy,
  createZigZagPutOnlyStrategy,
  type DetectionMethod,
  type TrendExhaustionParams,
} from './trend-exhaustion-backtest.strategy.js';

export {
  MTFLevelsBacktestStrategy,
  createMTFLevelsStrategy,
  type MTFLevelsParams,
} from './mtf-levels-backtest.strategy.js';
