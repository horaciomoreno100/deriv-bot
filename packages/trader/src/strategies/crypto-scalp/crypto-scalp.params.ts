/**
 * CryptoScalp Strategy v2 Parameters
 *
 * Default configurations and presets for different trading styles
 * and crypto assets.
 */

import type {
  CryptoScalpParams,
  RSIConfig,
  VWAPConfig,
  ADXConfig,
  ATRConfig,
  BBConfig,
  VolumeConfig,
  TrailingStopConfig,
  VolatilityFilterConfig,
  DCALevel,
  TakeProfitLevel,
  TrendStrength,
} from './crypto-scalp.types.js';

/**
 * Default RSI configuration
 */
export const DEFAULT_RSI_CONFIG: RSIConfig = {
  period: 14,
  oversoldThreshold: 30,
  overboughtThreshold: 70,
  useAsFilter: true,
};

/**
 * Default VWAP configuration
 */
export const DEFAULT_VWAP_CONFIG: VWAPConfig = {
  periods: 20,
  biasThreshold: 0.1, // 0.1% from VWAP
  useAsFilter: true,
};

/**
 * Default ADX configuration
 */
export const DEFAULT_ADX_CONFIG: ADXConfig = {
  period: 14,
  noTrendThreshold: 15,
  weakThreshold: 20,
  strongThreshold: 25,
  veryStrongThreshold: 40,
  useAsFilter: true,
  minStrengthForEntry: 'NO_TREND' as TrendStrength, // Mean reversion works in ranging markets
};

/**
 * Default ATR configuration
 */
export const DEFAULT_ATR_CONFIG: ATRConfig = {
  period: 14,
  tpMultiplier: 2.0, // TP = 2x ATR
  slMultiplier: 1.0, // SL = 1x ATR
  minTpPct: 0.2, // Minimum 0.2% TP
  maxTpPct: 1.0, // Maximum 1% TP
  minSlPct: 0.1, // Minimum 0.1% SL
  maxSlPct: 0.5, // Maximum 0.5% SL
};

/**
 * Default Bollinger Bands configuration
 */
export const DEFAULT_BB_CONFIG: BBConfig = {
  period: 20,
  stdDev: 2.0,
  extremeThreshold: 5, // 5% beyond bands = extreme
  useForEntry: true,
  useForExit: true,
};

/**
 * Default volume configuration
 */
export const DEFAULT_VOLUME_CONFIG: VolumeConfig = {
  smaPeriod: 20,
  minRatioForEntry: 0.8, // At least 80% of average volume
  highVolumeThreshold: 1.5, // 150% of average = high volume
  enabled: true,
};

/**
 * Default trailing stop configuration
 */
export const DEFAULT_TRAILING_STOP_CONFIG: TrailingStopConfig = {
  enabled: true,
  activationPct: 0.3, // Activate after 0.3% profit
  trailPct: 0.15, // Trail 0.15% from peak
  useATR: true,
  atrMultiplier: 0.5,
};

/**
 * Default volatility filter configuration
 * Prevents trading during extreme volatility spikes (e.g., flash crashes)
 */
export const DEFAULT_VOLATILITY_FILTER_CONFIG: VolatilityFilterConfig = {
  enabled: true,
  maxBBWidthPct: 3.0, // Skip if BB width > 3% (extreme volatility)
  maxATRRatio: 2.5, // Skip if current ATR > 2.5x average ATR
  atrAvgPeriod: 50, // Use 50 periods for average ATR calculation
};

/**
 * Default DCA levels
 */
export const DEFAULT_DCA_LEVELS: DCALevel[] = [
  { priceDeviationPct: 0, sizePercent: 50, enabled: true }, // Initial entry
  { priceDeviationPct: 0.2, sizePercent: 30, enabled: true }, // DCA 1
  { priceDeviationPct: 0.4, sizePercent: 20, enabled: true }, // DCA 2
];

/**
 * Default take profit levels
 */
export const DEFAULT_TP_LEVELS: TakeProfitLevel[] = [
  { profitPercent: 0.3, exitPercent: 50 }, // 50% at 0.3%
  { profitPercent: 0.5, exitPercent: 30 }, // 30% at 0.5%
  { profitPercent: 0.8, exitPercent: 20 }, // 20% at 0.8%
];

/**
 * Default strategy parameters
 */
export const DEFAULT_CRYPTO_SCALP_PARAMS: CryptoScalpParams = {
  // Indicators
  rsi: DEFAULT_RSI_CONFIG,
  vwap: DEFAULT_VWAP_CONFIG,
  adx: DEFAULT_ADX_CONFIG,
  atr: DEFAULT_ATR_CONFIG,
  bb: DEFAULT_BB_CONFIG,
  volume: DEFAULT_VOLUME_CONFIG,
  trailingStop: DEFAULT_TRAILING_STOP_CONFIG,
  volatilityFilter: DEFAULT_VOLATILITY_FILTER_CONFIG,

  // Entry
  dcaLevels: DEFAULT_DCA_LEVELS,
  minConfidence: 0.6,
  requireAllIndicatorsAligned: false,

  // Exit
  takeProfitLevels: DEFAULT_TP_LEVELS,
  baseStopLossPct: 0.3,

  // Risk management
  cooldownBars: 10,
  maxBarsInTrade: 60, // Max 1 hour in position (60 1-min bars)
  maxConsecutiveLosses: 3,
  pauseDurationBars: 30, // 30-minute pause after 3 losses

  // Session filters (empty = 24/7)
  tradingHours: [],
  avoidDays: [],
};

// ============== PRESETS ==============

/**
 * Aggressive preset - more trades, higher risk/reward
 */
export const AGGRESSIVE_PRESET: Partial<CryptoScalpParams> = {
  rsi: {
    ...DEFAULT_RSI_CONFIG,
    oversoldThreshold: 25,
    overboughtThreshold: 75,
  },
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 2.5,
    slMultiplier: 0.8,
    maxTpPct: 1.5,
  },
  minConfidence: 0.5,
  cooldownBars: 5,
  maxBarsInTrade: 45,
  trailingStop: {
    ...DEFAULT_TRAILING_STOP_CONFIG,
    activationPct: 0.2,
  },
};

/**
 * Conservative preset - fewer trades, lower risk
 */
export const CONSERVATIVE_PRESET: Partial<CryptoScalpParams> = {
  rsi: {
    ...DEFAULT_RSI_CONFIG,
    oversoldThreshold: 20,
    overboughtThreshold: 80,
  },
  adx: {
    ...DEFAULT_ADX_CONFIG,
    minStrengthForEntry: 'WEAK' as TrendStrength,
  },
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 1.5,
    slMultiplier: 1.2,
    maxTpPct: 0.8,
  },
  volume: {
    ...DEFAULT_VOLUME_CONFIG,
    minRatioForEntry: 1.0, // Require at least average volume
  },
  minConfidence: 0.7,
  cooldownBars: 15,
  maxConsecutiveLosses: 2,
  requireAllIndicatorsAligned: true,
};

/**
 * Scalp preset - very short trades, tight TP/SL
 */
export const SCALP_PRESET: Partial<CryptoScalpParams> = {
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 1.5,
    slMultiplier: 1.0,
    minTpPct: 0.15,
    maxTpPct: 0.5,
    minSlPct: 0.08,
    maxSlPct: 0.3,
  },
  takeProfitLevels: [
    { profitPercent: 0.2, exitPercent: 70 },
    { profitPercent: 0.35, exitPercent: 30 },
  ],
  trailingStop: {
    ...DEFAULT_TRAILING_STOP_CONFIG,
    enabled: false, // Too tight for trailing
  },
  maxBarsInTrade: 30,
  cooldownBars: 5,
};

/**
 * Swing preset - longer holds, bigger targets
 */
export const SWING_PRESET: Partial<CryptoScalpParams> = {
  rsi: {
    ...DEFAULT_RSI_CONFIG,
    oversoldThreshold: 25,
    overboughtThreshold: 75,
  },
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 3.0,
    slMultiplier: 1.5,
    minTpPct: 0.5,
    maxTpPct: 2.0,
    minSlPct: 0.2,
    maxSlPct: 1.0,
  },
  takeProfitLevels: [
    { profitPercent: 0.5, exitPercent: 40 },
    { profitPercent: 1.0, exitPercent: 40 },
    { profitPercent: 1.5, exitPercent: 20 },
  ],
  trailingStop: {
    ...DEFAULT_TRAILING_STOP_CONFIG,
    activationPct: 0.5,
    trailPct: 0.3,
  },
  maxBarsInTrade: 120, // 2 hours
  cooldownBars: 20,
};

/**
 * High PF preset - optimized for profit factor based on RSI v1 findings
 */
export const HIGH_PF_PRESET: Partial<CryptoScalpParams> = {
  rsi: {
    ...DEFAULT_RSI_CONFIG,
    period: 14,
    oversoldThreshold: 15, // Extreme oversold
    overboughtThreshold: 85, // Extreme overbought
  },
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 2.5,
    slMultiplier: 1.0,
    minTpPct: 0.4,
    maxTpPct: 0.8,
    minSlPct: 0.15,
    maxSlPct: 0.25,
  },
  takeProfitLevels: [{ profitPercent: 0.5, exitPercent: 100, rsiThreshold: 50 }],
  baseStopLossPct: 0.2,
  cooldownBars: 20,
  minConfidence: 0.7,
};

// ============== ASSET-SPECIFIC CONFIGS ==============

/**
 * BTC-specific optimizations
 */
export const BTC_CONFIG: Partial<CryptoScalpParams> = {
  rsi: {
    ...DEFAULT_RSI_CONFIG,
    oversoldThreshold: 12, // BTC needs more extreme RSI
    overboughtThreshold: 88,
  },
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 2.5,
    slMultiplier: 1.0,
    minTpPct: 0.3,
    maxTpPct: 0.8,
    minSlPct: 0.1,
    maxSlPct: 0.3,
  },
  cooldownBars: 20,
};

/**
 * ETH-specific optimizations
 */
export const ETH_CONFIG: Partial<CryptoScalpParams> = {
  rsi: {
    ...DEFAULT_RSI_CONFIG,
    oversoldThreshold: 15,
    overboughtThreshold: 85,
  },
  atr: {
    ...DEFAULT_ATR_CONFIG,
    tpMultiplier: 2.0,
    slMultiplier: 1.0,
    minTpPct: 0.25,
    maxTpPct: 0.6,
    minSlPct: 0.1,
    maxSlPct: 0.25,
  },
  cooldownBars: 15,
};

// ============== OPTIMIZED PRESETS (Post-Backtest Optimization) ==============

/**
 * ETH Optimized Preset - Final configuration after ML optimization
 *
 * Backtest Results (90 days, Dec 2025):
 * - Net PnL: $9,498
 * - Profit Factor: 1.16
 * - Win Rate: 54%
 * - Max Drawdown: 18.3%
 * - Trades: 3,827
 *
 * Best preset: AGGRESSIVE
 * Key: More trades, wider RSI thresholds, faster cooldown
 *
 * Live Adjustment (Dec 2025):
 * - SL widened from 0.2% to 0.4% to reduce whipsaws in volatile crypto markets
 */
export const ETH_OPTIMIZED_PRESET: Partial<CryptoScalpParams> = {
  ...AGGRESSIVE_PRESET,
  takeProfitLevels: [{ profitPercent: 0.5, exitPercent: 100 }],
  baseStopLossPct: 0.4, // Widened from 0.2% to 0.4% - crypto needs room to breathe
  cooldownBars: 5,
  maxBarsInTrade: 45,
  minConfidence: 0.5,
};

/**
 * BTC Optimized Preset - Final configuration after ML optimization
 *
 * Backtest Results (90 days, Dec 2025):
 * - Net PnL: $2,919
 * - Profit Factor: 1.14
 * - Win Rate: 53%
 * - Max Drawdown: 17.6%
 * - Trades: 2,976
 *
 * Best preset: AGGRESSIVE
 * Key: More trades, wider RSI thresholds, faster cooldown
 *
 * Live Adjustment (Dec 2025):
 * - SL widened from 0.2% to 0.4% to reduce whipsaws in volatile crypto markets
 */
export const BTC_OPTIMIZED_PRESET: Partial<CryptoScalpParams> = {
  ...AGGRESSIVE_PRESET,
  takeProfitLevels: [{ profitPercent: 0.5, exitPercent: 100 }],
  baseStopLossPct: 0.4, // Widened from 0.2% to 0.4% - crypto needs room to breathe
  cooldownBars: 5,
  maxBarsInTrade: 45,
  minConfidence: 0.5,
};

// ============== HELPERS ==============

/**
 * Get preset by name
 */
export function getPreset(
  name: 'aggressive' | 'conservative' | 'scalp' | 'swing' | 'highPF' | 'ethOptimized' | 'btcOptimized'
): Partial<CryptoScalpParams> {
  switch (name) {
    case 'aggressive':
      return AGGRESSIVE_PRESET;
    case 'conservative':
      return CONSERVATIVE_PRESET;
    case 'scalp':
      return SCALP_PRESET;
    case 'swing':
      return SWING_PRESET;
    case 'highPF':
      return HIGH_PF_PRESET;
    case 'ethOptimized':
      return ETH_OPTIMIZED_PRESET;
    case 'btcOptimized':
      return BTC_OPTIMIZED_PRESET;
    default:
      return {};
  }
}

/**
 * Get asset-specific config
 */
export function getAssetConfig(asset: string): Partial<CryptoScalpParams> {
  if (asset.includes('BTC')) return BTC_CONFIG;
  if (asset.includes('ETH')) return ETH_CONFIG;
  return {};
}

/**
 * Merge params with defaults
 */
export function mergeParams(
  customParams?: Partial<CryptoScalpParams>
): CryptoScalpParams {
  if (!customParams) return { ...DEFAULT_CRYPTO_SCALP_PARAMS };

  return {
    ...DEFAULT_CRYPTO_SCALP_PARAMS,
    ...customParams,
    rsi: { ...DEFAULT_RSI_CONFIG, ...customParams.rsi },
    vwap: { ...DEFAULT_VWAP_CONFIG, ...customParams.vwap },
    adx: { ...DEFAULT_ADX_CONFIG, ...customParams.adx },
    atr: { ...DEFAULT_ATR_CONFIG, ...customParams.atr },
    bb: { ...DEFAULT_BB_CONFIG, ...customParams.bb },
    volume: { ...DEFAULT_VOLUME_CONFIG, ...customParams.volume },
    trailingStop: { ...DEFAULT_TRAILING_STOP_CONFIG, ...customParams.trailingStop },
    volatilityFilter: { ...DEFAULT_VOLATILITY_FILTER_CONFIG, ...customParams.volatilityFilter },
    dcaLevels: customParams.dcaLevels ?? DEFAULT_DCA_LEVELS,
    takeProfitLevels: customParams.takeProfitLevels ?? DEFAULT_TP_LEVELS,
    tradingHours: customParams.tradingHours ?? [],
    avoidDays: customParams.avoidDays ?? [],
  };
}

/**
 * Get fully resolved params for an asset
 */
export function getParamsForAsset(
  asset: string,
  customParams?: Partial<CryptoScalpParams>
): CryptoScalpParams {
  const assetConfig = getAssetConfig(asset);
  const merged = mergeParams({ ...assetConfig, ...customParams });
  return merged;
}
