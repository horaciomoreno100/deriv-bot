/**
 * NostalgiaForInfinity (NFI) Strategy Module
 *
 * Full port of the legendary Freqtrade NFI strategy.
 * Adapted for Deriv futures trading.
 *
 * Original: https://github.com/iterativv/NostalgiaForInfinity
 */

// Main strategy
export { NFIStrategy, createNFIStrategy } from './nfi.strategy.js';

// Types
export type {
  NFIParams,
  NFIState,
  NFIPosition,
  NFIIndicators,
  NFIEntryCondition,
  NFIExitSignal,
  NFITradeResult,
  NFIEntryMode,
  NFIExitReason,
  NFIDynamicROI,
  NFIGrindLevel,
  Direction,
} from './nfi.types.js';

// Parameters and presets
export {
  DEFAULT_NFI_PARAMS,
  ETH_NFI_PARAMS,
  BTC_NFI_PARAMS,
  CONSERVATIVE_NFI_PARAMS,
  DEFAULT_ENTRY_CONDITIONS,
  DEFAULT_DYNAMIC_ROI,
  AGGRESSIVE_DYNAMIC_ROI,
  DEFAULT_GRIND_LEVELS,
  AGGRESSIVE_GRIND_LEVELS,
  getParamsForAsset,
  validateParams,
} from './nfi.params.js';

// Indicators
export {
  calculateAllIndicators,
  calculateRSI,
  calculateEMA,
  calculateSMA,
  calculateBollingerBands,
  calculateEWO,
  calculateCTI,
  calculateCMF,
  calculateMFI,
  calculateWilliamsR,
  calculateCCI,
  calculateROC,
  calculateSSL,
  calculateStochRSI,
  detectPump,
  detectDump,
  resampleCandles,
} from './indicators.js';

// Entry conditions
export {
  checkEntryConditions,
  getBestEntryCondition,
} from './entry-conditions.js';

// Exit conditions
export {
  checkExitConditions,
  checkDerisk,
  getCurrentROITarget,
  calculateStopLossPrice,
  calculateTakeProfitPrice,
  formatExitReason,
} from './exit-conditions.js';
