/**
 * NostalgiaForInfinity (NFI) Parameters
 *
 * Default parameters and asset-specific presets.
 * Based on NFI X5 configuration with adaptations for Deriv futures.
 */

import type { NFIParams, NFIDynamicROI, NFIGrindLevel, NFIEntryConditionsConfig } from './nfi.types.js';

/**
 * Default entry conditions - All enabled
 */
export const DEFAULT_ENTRY_CONDITIONS: NFIEntryConditionsConfig = {
  // Normal mode (1-13) - Classic dip buying
  condition_1_enable: true,   // BB40 + RSI + EMA trend
  condition_2_enable: true,   // BB20 + Volume
  condition_3_enable: true,   // SSL + RSI divergence
  condition_4_enable: true,   // EWO + RSI oversold
  condition_5_enable: true,   // BB touch + momentum
  condition_6_enable: true,   // Multi-TF RSI alignment
  condition_7_enable: true,   // CMF + RSI
  condition_8_enable: true,   // Williams %R extreme
  condition_9_enable: true,   // CCI oversold
  condition_10_enable: true,  // Stoch RSI oversold
  condition_11_enable: true,  // EMA cross + RSI
  condition_12_enable: true,  // BB squeeze breakout
  condition_13_enable: true,  // MFI + RSI combo

  // Pump mode (21-26) - After pump detection
  condition_21_enable: true,
  condition_22_enable: true,
  condition_23_enable: true,
  condition_24_enable: true,
  condition_25_enable: true,
  condition_26_enable: true,

  // Quick mode (41-53) - Fast scalping
  condition_41_enable: true,
  condition_42_enable: true,
  condition_43_enable: true,
  condition_44_enable: true,
  condition_45_enable: true,
  condition_46_enable: true,
  condition_47_enable: true,
  condition_48_enable: true,
  condition_49_enable: true,
  condition_50_enable: true,
  condition_51_enable: true,
  condition_52_enable: true,
  condition_53_enable: true,

  // Rebuy mode (61-62) - DCA entries
  condition_61_enable: false,  // Disabled by default for futures
  condition_62_enable: false,

  // High profit mode (81-82)
  condition_81_enable: true,
  condition_82_enable: true,

  // Rapid mode (101-110) - Ultra-fast
  condition_101_enable: true,
  condition_102_enable: true,
  condition_103_enable: true,
  condition_104_enable: true,
  condition_105_enable: true,
  condition_106_enable: true,
  condition_107_enable: true,
  condition_108_enable: true,
  condition_109_enable: true,
  condition_110_enable: true,

  // Grind mode (120)
  condition_120_enable: true,

  // Top coins mode (141-143) - BTC/ETH specific
  condition_141_enable: true,
  condition_142_enable: true,
  condition_143_enable: true,

  // Derisk mode (161)
  condition_161_enable: true,
};

/**
 * Dynamic ROI - Time-based profit targets
 * Original NFI uses very patient targets
 */
export const DEFAULT_DYNAMIC_ROI: NFIDynamicROI = {
  0: 4.0,      // First 0 min: Take 4%+ profit immediately
  10: 3.0,     // After 10 min: Take 3%+
  30: 2.0,     // After 30 min: Take 2%+
  60: 1.5,     // After 1 hour: Take 1.5%+
  120: 1.0,    // After 2 hours: Take 1%+
  240: 0.75,   // After 4 hours: Take 0.75%+
  480: 0.5,    // After 8 hours: Take 0.5%+
  720: 0.3,    // After 12 hours: Take 0.3%+
  1440: 0.1,   // After 24 hours: Take any profit
};

/**
 * Aggressive ROI for crypto volatility
 */
export const AGGRESSIVE_DYNAMIC_ROI: NFIDynamicROI = {
  0: 2.0,      // First 0 min: Take 2%+ profit
  5: 1.5,      // After 5 min: Take 1.5%+
  15: 1.0,     // After 15 min: Take 1%+
  30: 0.75,    // After 30 min: Take 0.75%+
  60: 0.5,     // After 1 hour: Take 0.5%+
  120: 0.3,    // After 2 hours: Take 0.3%+
  240: 0.2,    // After 4 hours: Take 0.2%+
};

/**
 * Default grinding levels - Conservative for futures
 */
export const DEFAULT_GRIND_LEVELS: NFIGrindLevel[] = [
  { deviation: -0.03, stakeMultiplier: 1.5, maxEntries: 1 },  // -3%: Add 1.5x
  { deviation: -0.06, stakeMultiplier: 2.0, maxEntries: 1 },  // -6%: Add 2x
  { deviation: -0.10, stakeMultiplier: 2.5, maxEntries: 1 },  // -10%: Add 2.5x
];

/**
 * Aggressive grinding - Use with caution
 */
export const AGGRESSIVE_GRIND_LEVELS: NFIGrindLevel[] = [
  { deviation: -0.02, stakeMultiplier: 1.5, maxEntries: 1 },
  { deviation: -0.04, stakeMultiplier: 2.0, maxEntries: 1 },
  { deviation: -0.06, stakeMultiplier: 2.5, maxEntries: 1 },
  { deviation: -0.09, stakeMultiplier: 3.0, maxEntries: 1 },
  { deviation: -0.12, stakeMultiplier: 3.5, maxEntries: 1 },
  { deviation: -0.15, stakeMultiplier: 4.0, maxEntries: 1 },
];

/**
 * Default NFI parameters - Adapted for Deriv futures
 */
export const DEFAULT_NFI_PARAMS: NFIParams = {
  timeframe: '5m',

  entryConditions: DEFAULT_ENTRY_CONDITIONS,

  rsi: {
    oversold_extreme: 20,
    oversold: 30,
    neutral_low: 40,
    neutral_high: 60,
    overbought: 70,
    overbought_extreme: 80,
  },

  bb: {
    period: 20,
    stdDev: 2.0,
    deltaThreshold: 0.017,   // BB delta > close * 0.017
    closeThreshold: 0.013,   // Close delta > close * 0.013
    tailThreshold: 0.445,    // Tail < BB delta * 0.445
  },

  ema: {
    fast: 12,
    slow: 26,
    mid: 50,
    long: 200,
    openMult: 0.02,  // EMA26 - EMA12 > open * 0.02
  },

  ewo: {
    period_fast: 5,
    period_slow: 35,
    high_threshold: 2.0,
    low_threshold: -2.0,
  },

  dynamicROI: DEFAULT_DYNAMIC_ROI,

  stopLoss: {
    percentage: 0.05,         // 5% stop loss (much tighter than NFI's -99%)
    useTrailing: true,
    trailingActivation: 0.02, // Activate at 2% profit
    trailingDistance: 0.01,   // Trail by 1%
  },

  grinding: {
    enabled: false,           // Disabled by default for safety
    levels: DEFAULT_GRIND_LEVELS,
    maxTotalEntries: 4,
    minProfitToGrind: 0.005,  // Need 0.5% profit before grind exit
  },

  exitSignals: {
    rsi_overbought: 78,
    bb_overbought: true,
    stoch_overbought: 80,
    use_signal_exits: true,
  },

  risk: {
    maxOpenTrades: 3,
    maxBarsInTrade: 288,      // 24 hours at 5m
    cooldownBars: 6,          // 30 min cooldown
    maxConsecutiveLosses: 3,
    pauseBarsAfterMaxLosses: 24, // 2 hour pause
  },

  doomMode: {
    enabled: true,
    profitThreshold: -0.10,   // Exit if unrealized loss > 10%
    maxLoss: 0.05,            // Hard stop at 5%
  },
};

/**
 * ETH optimized parameters
 */
export const ETH_NFI_PARAMS: Partial<NFIParams> = {
  dynamicROI: AGGRESSIVE_DYNAMIC_ROI,

  stopLoss: {
    percentage: 0.04,         // 4% SL - ETH more volatile
    useTrailing: true,
    trailingActivation: 0.015,
    trailingDistance: 0.008,
  },

  rsi: {
    oversold_extreme: 18,
    oversold: 28,
    neutral_low: 40,
    neutral_high: 60,
    overbought: 72,
    overbought_extreme: 82,
  },

  exitSignals: {
    rsi_overbought: 75,
    bb_overbought: true,
    stoch_overbought: 78,
    use_signal_exits: true,
  },

  risk: {
    maxOpenTrades: 2,
    maxBarsInTrade: 144,      // 12 hours
    cooldownBars: 3,          // 15 min
    maxConsecutiveLosses: 3,
    pauseBarsAfterMaxLosses: 12,
  },
};

/**
 * BTC optimized parameters
 */
export const BTC_NFI_PARAMS: Partial<NFIParams> = {
  dynamicROI: {
    0: 3.0,
    10: 2.0,
    30: 1.5,
    60: 1.0,
    120: 0.75,
    240: 0.5,
    480: 0.3,
  },

  stopLoss: {
    percentage: 0.03,         // 3% SL - BTC less volatile
    useTrailing: true,
    trailingActivation: 0.01,
    trailingDistance: 0.006,
  },

  rsi: {
    oversold_extreme: 22,
    oversold: 32,
    neutral_low: 42,
    neutral_high: 58,
    overbought: 68,
    overbought_extreme: 78,
  },

  exitSignals: {
    rsi_overbought: 72,
    bb_overbought: true,
    stoch_overbought: 75,
    use_signal_exits: true,
  },

  risk: {
    maxOpenTrades: 2,
    maxBarsInTrade: 288,
    cooldownBars: 4,
    maxConsecutiveLosses: 3,
    pauseBarsAfterMaxLosses: 18,
  },
};

/**
 * Conservative mode - Lower risk, lower reward
 */
export const CONSERVATIVE_NFI_PARAMS: Partial<NFIParams> = {
  dynamicROI: {
    0: 5.0,
    30: 3.0,
    60: 2.0,
    120: 1.5,
    240: 1.0,
    480: 0.75,
  },

  stopLoss: {
    percentage: 0.03,
    useTrailing: true,
    trailingActivation: 0.015,
    trailingDistance: 0.01,
  },

  grinding: {
    enabled: false,
    levels: [],
    maxTotalEntries: 1,
    minProfitToGrind: 0,
  },

  entryConditions: {
    // Disable risky modes
    condition_41_enable: false, // Quick mode
    condition_42_enable: false,
    condition_43_enable: false,
    condition_44_enable: false,
    condition_45_enable: false,
    condition_46_enable: false,
    condition_47_enable: false,
    condition_48_enable: false,
    condition_49_enable: false,
    condition_50_enable: false,
    condition_51_enable: false,
    condition_52_enable: false,
    condition_53_enable: false,
    condition_61_enable: false, // Rebuy
    condition_62_enable: false,
    condition_101_enable: false, // Rapid mode
    condition_102_enable: false,
    condition_103_enable: false,
    condition_104_enable: false,
    condition_105_enable: false,
    condition_106_enable: false,
    condition_107_enable: false,
    condition_108_enable: false,
    condition_109_enable: false,
    condition_110_enable: false,
  },

  risk: {
    maxOpenTrades: 1,
    maxBarsInTrade: 576,        // 48 hours
    cooldownBars: 12,           // 1 hour
    maxConsecutiveLosses: 2,
    pauseBarsAfterMaxLosses: 48, // 4 hours
  },
};

/**
 * Get parameters for specific asset
 */
export function getParamsForAsset(
  asset: string,
  customParams?: Partial<NFIParams>
): NFIParams {
  let baseParams = { ...DEFAULT_NFI_PARAMS };

  // Apply asset-specific overrides
  const assetUpper = asset.toUpperCase();

  if (assetUpper.includes('ETH')) {
    baseParams = mergeParams(baseParams, ETH_NFI_PARAMS);
  } else if (assetUpper.includes('BTC')) {
    baseParams = mergeParams(baseParams, BTC_NFI_PARAMS);
  }

  // Apply custom overrides
  if (customParams) {
    baseParams = mergeParams(baseParams, customParams);
  }

  return baseParams;
}

/**
 * Deep merge parameters
 */
function mergeParams(base: NFIParams, override: Partial<NFIParams>): NFIParams {
  const result = { ...base };

  for (const key of Object.keys(override) as (keyof NFIParams)[]) {
    const overrideValue = override[key];
    if (overrideValue === undefined) continue;

    if (typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
      (result as Record<string, unknown>)[key] = {
        ...(base[key] as object),
        ...(overrideValue as object),
      };
    } else {
      (result as Record<string, unknown>)[key] = overrideValue;
    }
  }

  return result;
}

/**
 * Validate parameters
 */
export function validateParams(params: NFIParams): string[] {
  const errors: string[] = [];

  if (params.stopLoss.percentage <= 0) {
    errors.push('Stop loss percentage must be positive');
  }

  if (params.stopLoss.percentage > 0.20) {
    errors.push('Stop loss too wide (>20%) - dangerous for futures');
  }

  if (params.risk.maxOpenTrades < 1) {
    errors.push('maxOpenTrades must be at least 1');
  }

  if (params.risk.maxBarsInTrade < 1) {
    errors.push('maxBarsInTrade must be at least 1');
  }

  const roiTimes = Object.keys(params.dynamicROI).map(Number);
  if (roiTimes.length === 0) {
    errors.push('dynamicROI must have at least one entry');
  }

  return errors;
}
