/**
 * Trading Strategies
 */

export { MeanReversionStrategy, type MeanReversionParams } from './mean-reversion.strategy.js';
export { SupportResistanceStrategy, type SupportResistanceParams } from './support-resistance.strategy.js';
export { BBSqueezeStrategy, type BBSqueezeParams } from './bb-squeeze.strategy.js';
export { BBSqueezeMRStrategy, type BBSqueezeMRParams } from './bb-squeeze-mr.strategy.js';
export { HybridMTFStrategy } from './hybrid-mtf.strategy.js';
export { FVGStrategy, type FVGStrategyParams, type FairValueGap } from './fvg.strategy.js';

// NostalgiaForInfinity (NFI) Strategy - temporarily disabled (incomplete)
// export {
//   NFIStrategy,
//   createNFIStrategy,
//   type NFIParams,
//   type NFIState,
//   type NFIPosition,
//   type NFIIndicators,
//   type NFIEntryCondition,
//   type NFIExitSignal,
//   type NFITradeResult,
//   type NFIEntryMode,
//   DEFAULT_NFI_PARAMS,
//   ETH_NFI_PARAMS,
//   BTC_NFI_PARAMS,
//   CONSERVATIVE_NFI_PARAMS,
//   getParamsForAsset as getNFIParamsForAsset,
// } from './nfi/index.js';
