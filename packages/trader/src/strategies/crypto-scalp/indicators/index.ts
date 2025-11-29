/**
 * Indicators Index
 *
 * Re-exports all indicator modules for the CryptoScalp strategy.
 */

// VWAP
export {
  calculateVWAP,
  calculateVWAPSeries,
  calculateVWAPBands,
  analyzeVWAPTrend,
  type VWAPResult,
} from './vwap.js';

// ADX
export {
  calculateADX,
  calculateADXSeries,
  classifyTrendStrength,
  isTrending,
  isRanging,
  detectDICrossover,
  type ADXResult,
} from './adx.js';

// ATR
export {
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
} from './atr.js';

// Bollinger Bands
export {
  calculateBollingerBands,
  calculateBBSeries,
  classifyBBZone,
  detectSqueeze,
  detectBandTouch,
  detectBandWalk,
  detectBBPattern,
  type BBResult,
} from './bollinger.js';

// Volume
export {
  analyzeVolume,
  calculateVolumeSeries,
  volumeConfirmsPrice,
  detectVolumeSpike,
  detectVolumeDivergence,
  calculateOBV,
  calculateMFI,
  type VolumeResult,
} from './volume.js';
