/**
 * Trading Strategies
 */

export { MeanReversionStrategy, type MeanReversionParams } from './mean-reversion.strategy.js';
export { SupportResistanceStrategy, type SupportResistanceParams } from './support-resistance.strategy.js';
export { BBSqueezeStrategy, type BBSqueezeParams } from './bb-squeeze.strategy.js';
export { BBSqueezeMRStrategy, type BBSqueezeMRParams } from './bb-squeeze-mr.strategy.js';
export { HybridMTFStrategy } from './hybrid-mtf.strategy.js';
export { FVGStrategy, type FVGStrategyParams, type FairValueGap } from './fvg.strategy.js';
export { FVGLiquiditySweepStrategy } from './fvg-liquidity-sweep.strategy.js';
export type {
  SwingPoint,
  LiquidityZone,
  FairValueGap as FVGLiquiditySweepFVG,
  ActiveSweep,
  StrategyState as FVGLiquiditySweepState,
  FVGLiquiditySweepParams,
  TradeSetup as FVGLiquiditySweepTradeSetup,
} from './fvg-liquidity-sweep.types.js';
export {
  DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS,
  SYNTHETIC_INDEX_PARAMS,
  FOREX_PARAMS,
  GOLD_PARAMS,
  CRYPTO_PARAMS,
  BTC_PARAMS,
  ETH_PARAMS,
  getParamsForAsset,
} from './fvg-liquidity-sweep.params.js';
