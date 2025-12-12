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

export {
  FVGBacktestStrategy,
  createFVGStrategy,
} from './fvg-backtest.strategy.js';

export {
  FVGLiquiditySweepBacktestStrategy,
  createFVGLiquiditySweepStrategy,
} from './fvg-liquidity-sweep-backtest.strategy.js';

export {
  HybridMTFBacktestMLStrategy,
  createHybridMTFMLStrategy,
} from './hybrid-mtf-backtest-ml.strategy.js';

export {
  ReturnToBaseBacktestStrategy,
  createReturnToBaseStrategy,
  createReturnToBaseForAsset,
  DEFAULT_RTB_PARAMS,
  RTB_AGGRESSIVE_PRESET,
  RTB_CONSERVATIVE_PRESET,
  RTB_CRYPTO_PRESET,
  RTB_FOREX_PRESET,
} from './return-to-base.strategy.js';

export {
  SMCOpportunityBacktestStrategy,
  createSMCBacktestStrategy,
  type SMCBacktestParams,
} from './smc-opportunity-backtest.strategy.js';
