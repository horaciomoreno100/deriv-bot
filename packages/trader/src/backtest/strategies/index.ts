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
