/**
 * CryptoScalp Strategy v2 Index
 *
 * Re-exports all modules for the CryptoScalp strategy.
 */

// Main strategy
export { CryptoScalpStrategy, createCryptoScalpStrategy } from './crypto-scalp.strategy.js';

// Types
export type {
  CryptoScalpParams,
  CryptoScalpStrategyState,
  CryptoScalpEntrySignal,
  CryptoScalpExitSignal,
  CryptoScalpIndicators,
  CryptoScalpTradeResult,
  CryptoScalpState,
  Direction,
  VWAPBias,
  TrendStrength,
  BBZone,
  ExitReason,
  DCALevel,
  TakeProfitLevel,
  RSIConfig,
  VWAPConfig,
  ADXConfig,
  ATRConfig,
  BBConfig,
  VolumeConfig,
  TrailingStopConfig,
} from './crypto-scalp.types.js';

// Parameters
export {
  DEFAULT_CRYPTO_SCALP_PARAMS,
  DEFAULT_RSI_CONFIG,
  DEFAULT_VWAP_CONFIG,
  DEFAULT_ADX_CONFIG,
  DEFAULT_ATR_CONFIG,
  DEFAULT_BB_CONFIG,
  DEFAULT_VOLUME_CONFIG,
  DEFAULT_TRAILING_STOP_CONFIG,
  AGGRESSIVE_PRESET,
  CONSERVATIVE_PRESET,
  SCALP_PRESET,
  SWING_PRESET,
  HIGH_PF_PRESET,
  BTC_CONFIG,
  ETH_CONFIG,
  getPreset,
  getAssetConfig,
  mergeParams,
  getParamsForAsset,
} from './crypto-scalp.params.js';

// Indicators
export {
  // VWAP
  calculateVWAP,
  calculateVWAPSeries,
  calculateVWAPBands,
  analyzeVWAPTrend,
  type VWAPResult,
  // ADX
  calculateADX,
  calculateADXSeries,
  classifyTrendStrength,
  isTrending,
  isRanging,
  detectDICrossover,
  type ADXResult,
  // ATR
  calculateATR,
  calculateATRSeries,
  calculateTrueRange,
  classifyVolatility,
  calculateAdaptivePositionSize,
  calculateATRTrailingStop,
  isVolatilitySuitable,
  calculateNormalizedATR,
  detectVolatilityExpansion,
  detectVolatilityContraction,
  type ATRResult,
  // Bollinger Bands
  calculateBollingerBands,
  calculateBBSeries,
  classifyBBZone,
  detectSqueeze,
  detectBandTouch,
  detectBandWalk,
  detectBBPattern,
  type BBResult,
  // Volume
  analyzeVolume,
  calculateVolumeSeries,
  volumeConfirmsPrice,
  detectVolumeSpike,
  detectVolumeDivergence,
  calculateOBV,
  calculateMFI,
  type VolumeResult,
} from './indicators/index.js';
