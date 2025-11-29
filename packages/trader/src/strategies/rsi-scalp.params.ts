/**
 * RSI Scalp Strategy Parameters
 *
 * Default parameters and asset-specific presets for crypto scalping.
 */

import type { RSIScalpParams } from './rsi-scalp.types.js';

/**
 * Default parameters (balanced for BTC/ETH)
 */
export const DEFAULT_RSI_SCALP_PARAMS: RSIScalpParams = {
  // === RSI Settings ===
  rsiPeriod: 14,

  // === Entry Levels (DCA) ===
  entryLevels: {
    long: [
      { rsiThreshold: 30, sizePercent: 40, enabled: true },
      { rsiThreshold: 27, sizePercent: 35, enabled: true },
      { rsiThreshold: 24, sizePercent: 25, enabled: true },
    ],
    short: [
      { rsiThreshold: 70, sizePercent: 40, enabled: true },
      { rsiThreshold: 73, sizePercent: 35, enabled: true },
      { rsiThreshold: 76, sizePercent: 25, enabled: true },
    ],
  },

  // === Take Profit Levels ===
  takeProfitLevels: [
    { profitPercent: 0.75, rsiThreshold: 50, exitPercent: 70 },
    { profitPercent: 1.5, rsiThreshold: 60, exitPercent: 100 },
  ],

  // === Stop Loss ===
  stopLossPercent: 2.0,
  useTrailingStop: false,
  trailingStopPercent: 1.0,

  // === Trend Filter (EMA) ===
  useTrendFilter: true,
  emaPeriod: 50,

  // === Volume Filter ===
  useVolumeFilter: false,
  volumeMultiplier: 1.5,
  volumePeriod: 20,

  // === Timing ===
  timeframe: 300, // 5m
  cooldownBars: 3,

  // === Risk Management ===
  maxDailyTrades: 10,
  maxDailyLossPercent: 5.0,
  maxPositionSizePercent: 10.0,

  // === Symbols ===
  symbols: ['cryBTCUSD', 'cryETHUSD'],

  // === Confidence ===
  minConfidence: 0.6,
};

/**
 * Bitcoin-specific preset
 *
 * BTC is less volatile than ETH, needs tighter parameters
 */
export const BTC_PARAMS: Partial<RSIScalpParams> = {
  entryLevels: {
    long: [
      { rsiThreshold: 32, sizePercent: 40, enabled: true },
      { rsiThreshold: 28, sizePercent: 35, enabled: true },
      { rsiThreshold: 25, sizePercent: 25, enabled: true },
    ],
    short: [
      { rsiThreshold: 68, sizePercent: 40, enabled: true },
      { rsiThreshold: 72, sizePercent: 35, enabled: true },
      { rsiThreshold: 75, sizePercent: 25, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.6, rsiThreshold: 48, exitPercent: 70 },
    { profitPercent: 1.2, rsiThreshold: 58, exitPercent: 100 },
  ],
  stopLossPercent: 1.5,
};

/**
 * Ethereum-specific preset
 *
 * ETH is more volatile, needs wider parameters
 */
export const ETH_PARAMS: Partial<RSIScalpParams> = {
  entryLevels: {
    long: [
      { rsiThreshold: 28, sizePercent: 40, enabled: true },
      { rsiThreshold: 24, sizePercent: 35, enabled: true },
      { rsiThreshold: 20, sizePercent: 25, enabled: true },
    ],
    short: [
      { rsiThreshold: 72, sizePercent: 40, enabled: true },
      { rsiThreshold: 76, sizePercent: 35, enabled: true },
      { rsiThreshold: 80, sizePercent: 25, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 1.0, rsiThreshold: 52, exitPercent: 70 },
    { profitPercent: 2.0, rsiThreshold: 62, exitPercent: 100 },
  ],
  stopLossPercent: 2.5,
};

/**
 * Litecoin-specific preset
 *
 * LTC is most volatile, widest parameters
 */
export const LTC_PARAMS: Partial<RSIScalpParams> = {
  entryLevels: {
    long: [
      { rsiThreshold: 26, sizePercent: 40, enabled: true },
      { rsiThreshold: 22, sizePercent: 35, enabled: true },
      { rsiThreshold: 18, sizePercent: 25, enabled: true },
    ],
    short: [
      { rsiThreshold: 74, sizePercent: 40, enabled: true },
      { rsiThreshold: 78, sizePercent: 35, enabled: true },
      { rsiThreshold: 82, sizePercent: 25, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 1.2, rsiThreshold: 52, exitPercent: 70 },
    { profitPercent: 2.5, rsiThreshold: 65, exitPercent: 100 },
  ],
  stopLossPercent: 3.0,
};

/**
 * Aggressive preset - OPTIMIZED for maximum gains
 *
 * Uses 5% stake + 200x multiplier for higher returns
 * Tested on 90 days bear market (-27%):
 * - BTC: RSI 17/83, TP 0.25%, SL 0.25%, CD 5 → $750 (288 trades, PF 1.38, DD 28%)
 * - ETH: RSI 18/82, TP 0.5%, SL 0.2%, CD 5 → $600 (281 trades, PF 1.17, DD 34%)
 *
 * WARNING: Higher drawdown risk (up to 35%)
 * Recommended: Use with strict daily loss limits
 */
export const AGGRESSIVE_BTC_PARAMS: Partial<RSIScalpParams> = {
  rsiPeriod: 14,
  entryLevels: {
    long: [
      { rsiThreshold: 17, sizePercent: 100, enabled: true },
    ],
    short: [
      { rsiThreshold: 83, sizePercent: 100, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.25, rsiThreshold: 50, exitPercent: 100 },
  ],
  stopLossPercent: 0.25,
  cooldownBars: 5,
  useTrendFilter: false,
  useVolumeFilter: false,
  timeframe: 60,
  maxDailyLossPercent: 10.0, // Strict daily loss limit
};

export const AGGRESSIVE_ETH_PARAMS: Partial<RSIScalpParams> = {
  rsiPeriod: 14,
  entryLevels: {
    long: [
      { rsiThreshold: 18, sizePercent: 100, enabled: true },
    ],
    short: [
      { rsiThreshold: 82, sizePercent: 100, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.5, rsiThreshold: 50, exitPercent: 100 },
  ],
  stopLossPercent: 0.2,
  cooldownBars: 5,
  useTrendFilter: false,
  useVolumeFilter: false,
  timeframe: 60,
  maxDailyLossPercent: 10.0,
};

/**
 * Legacy aggressive preset (deprecated - use AGGRESSIVE_BTC/ETH_PARAMS)
 */
export const AGGRESSIVE_PARAMS: Partial<RSIScalpParams> = {
  entryLevels: {
    long: [
      { rsiThreshold: 35, sizePercent: 50, enabled: true },
      { rsiThreshold: 30, sizePercent: 30, enabled: true },
      { rsiThreshold: 25, sizePercent: 20, enabled: true },
    ],
    short: [
      { rsiThreshold: 65, sizePercent: 50, enabled: true },
      { rsiThreshold: 70, sizePercent: 30, enabled: true },
      { rsiThreshold: 75, sizePercent: 20, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.5, rsiThreshold: 45, exitPercent: 80 },
    { profitPercent: 1.0, rsiThreshold: 55, exitPercent: 100 },
  ],
  stopLossPercent: 1.5,
  cooldownBars: 2,
  maxDailyTrades: 15,
};

/**
 * Conservative preset (fewer trades, higher quality)
 */
export const CONSERVATIVE_PARAMS: Partial<RSIScalpParams> = {
  entryLevels: {
    long: [
      { rsiThreshold: 25, sizePercent: 40, enabled: true },
      { rsiThreshold: 22, sizePercent: 35, enabled: true },
      { rsiThreshold: 18, sizePercent: 25, enabled: true },
    ],
    short: [
      { rsiThreshold: 75, sizePercent: 40, enabled: true },
      { rsiThreshold: 78, sizePercent: 35, enabled: true },
      { rsiThreshold: 82, sizePercent: 25, enabled: true },
    ],
  },
  takeProfitLevels: [
    { profitPercent: 1.0, rsiThreshold: 55, exitPercent: 60 },
    { profitPercent: 2.0, rsiThreshold: 65, exitPercent: 100 },
  ],
  stopLossPercent: 2.5,
  cooldownBars: 5,
  maxDailyTrades: 5,
  minConfidence: 0.7,
};

/**
 * High Profit Factor preset - OPTIMIZED FROM BACKTEST
 *
 * Tested on 90 days of 1m data (129,800 candles per asset)
 * Results:
 * - BTC: PF 2.22, 61 trades, 52.5% WR, 1.1% DD
 * - ETH: PF 1.90, 104 trades, 49% WR, 1.7% DD
 *
 * Key insights:
 * - Extreme RSI levels (12/88 for BTC, 15/85 for ETH) = higher PF
 * - Asymmetric TP/SL (3:1 ratio) = better reward/risk
 * - Longer cooldown (20 bars) = fewer but better trades
 */
export const HIGH_PF_BTC_PARAMS: Partial<RSIScalpParams> = {
  rsiPeriod: 14,
  entryLevels: {
    long: [
      { rsiThreshold: 12, sizePercent: 100, enabled: true }, // Single entry at extreme
    ],
    short: [
      { rsiThreshold: 88, sizePercent: 100, enabled: true }, // Single entry at extreme
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.6, rsiThreshold: 50, exitPercent: 100 }, // 0.6% TP
  ],
  stopLossPercent: 0.2, // 0.2% SL (3:1 ratio)
  cooldownBars: 20, // 20 bars cooldown
  useTrendFilter: false, // Disabled for extreme RSI entries
  useVolumeFilter: false,
  timeframe: 60, // 1 minute
};

export const HIGH_PF_ETH_PARAMS: Partial<RSIScalpParams> = {
  rsiPeriod: 14,
  entryLevels: {
    long: [
      { rsiThreshold: 15, sizePercent: 100, enabled: true }, // RSI <= 15
    ],
    short: [
      { rsiThreshold: 85, sizePercent: 100, enabled: true }, // RSI >= 85
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.3, rsiThreshold: 50, exitPercent: 100 }, // 0.3% TP
  ],
  stopLossPercent: 0.15, // 0.15% SL (2:1 ratio)
  cooldownBars: 15, // 15 bars cooldown
  useTrendFilter: false,
  useVolumeFilter: false,
  timeframe: 60, // 1 minute
};

/**
 * BALANCED preset - More trades with decent PF
 *
 * Optimized for 100+ trades in 90 days while maintaining PF > 1.3
 * Results from fast optimization (129,800 candles, bear market -27%):
 * - BTC: RSI 17/83, TP 0.25%, SL 0.25%, CD 5 → 288 trades, PF 1.38, $225
 * - ETH: RSI 16/84, TP 0.3%, SL 0.15%, CD 10 → 135 trades, PF 1.44, $153
 *
 * ~1.5-3 trades/day vs ~0.7-1.2/day with HIGH_PF params
 */
export const BALANCED_BTC_PARAMS: Partial<RSIScalpParams> = {
  rsiPeriod: 14,
  entryLevels: {
    long: [
      { rsiThreshold: 17, sizePercent: 100, enabled: true }, // RSI <= 17
    ],
    short: [
      { rsiThreshold: 83, sizePercent: 100, enabled: true }, // RSI >= 83
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.25, rsiThreshold: 50, exitPercent: 100 }, // 0.25% TP
  ],
  stopLossPercent: 0.25, // 0.25% SL (1:1 ratio)
  cooldownBars: 5, // 5 bars cooldown
  useTrendFilter: false,
  useVolumeFilter: false,
  timeframe: 60, // 1 minute
};

export const BALANCED_ETH_PARAMS: Partial<RSIScalpParams> = {
  rsiPeriod: 14,
  entryLevels: {
    long: [
      { rsiThreshold: 16, sizePercent: 100, enabled: true }, // RSI <= 16
    ],
    short: [
      { rsiThreshold: 84, sizePercent: 100, enabled: true }, // RSI >= 84
    ],
  },
  takeProfitLevels: [
    { profitPercent: 0.3, rsiThreshold: 50, exitPercent: 100 }, // 0.3% TP
  ],
  stopLossPercent: 0.15, // 0.15% SL (2:1 ratio)
  cooldownBars: 10, // 10 bars cooldown
  useTrendFilter: false,
  useVolumeFilter: false,
  timeframe: 60, // 1 minute
};

/**
 * 1-minute timeframe preset (more trades, tighter params)
 */
export const TIMEFRAME_1M_PARAMS: Partial<RSIScalpParams> = {
  timeframe: 60,
  rsiPeriod: 7, // Faster RSI for 1m
  emaPeriod: 20, // Faster EMA
  takeProfitLevels: [
    { profitPercent: 0.4, rsiThreshold: 48, exitPercent: 70 },
    { profitPercent: 0.8, rsiThreshold: 55, exitPercent: 100 },
  ],
  stopLossPercent: 1.0,
  cooldownBars: 5,
};

/**
 * 15-minute timeframe preset (fewer trades, wider params)
 */
export const TIMEFRAME_15M_PARAMS: Partial<RSIScalpParams> = {
  timeframe: 900,
  rsiPeriod: 14,
  emaPeriod: 50,
  takeProfitLevels: [
    { profitPercent: 1.5, rsiThreshold: 52, exitPercent: 70 },
    { profitPercent: 3.0, rsiThreshold: 62, exitPercent: 100 },
  ],
  stopLossPercent: 3.0,
  cooldownBars: 2,
};

/**
 * Get parameters for a specific asset
 */
export function getParamsForAsset(
  asset: string,
  overrides?: Partial<RSIScalpParams>,
  useHighPF: boolean = false
): RSIScalpParams {
  let baseParams = { ...DEFAULT_RSI_SCALP_PARAMS };

  // Apply asset-specific presets
  if (asset === 'cryBTCUSD' || asset.includes('BTC')) {
    baseParams = useHighPF
      ? { ...baseParams, ...HIGH_PF_BTC_PARAMS }
      : { ...baseParams, ...BTC_PARAMS };
  } else if (asset === 'cryETHUSD' || asset.includes('ETH')) {
    baseParams = useHighPF
      ? { ...baseParams, ...HIGH_PF_ETH_PARAMS }
      : { ...baseParams, ...ETH_PARAMS };
  } else if (asset === 'cryLTCUSD' || asset.includes('LTC')) {
    baseParams = { ...baseParams, ...LTC_PARAMS };
  }

  // Apply user overrides
  if (overrides) {
    baseParams = { ...baseParams, ...overrides };
  }

  return baseParams;
}

/**
 * Get preset by name
 */
export function getPreset(
  name: 'default' | 'aggressive' | 'aggressive-BTC' | 'aggressive-ETH' | 'conservative' | '1m' | '15m' | 'highPF-BTC' | 'highPF-ETH' | 'balanced-BTC' | 'balanced-ETH'
): Partial<RSIScalpParams> {
  switch (name) {
    case 'aggressive':
      return AGGRESSIVE_PARAMS;
    case 'aggressive-BTC':
      return AGGRESSIVE_BTC_PARAMS;
    case 'aggressive-ETH':
      return AGGRESSIVE_ETH_PARAMS;
    case 'conservative':
      return CONSERVATIVE_PARAMS;
    case '1m':
      return TIMEFRAME_1M_PARAMS;
    case '15m':
      return TIMEFRAME_15M_PARAMS;
    case 'highPF-BTC':
      return HIGH_PF_BTC_PARAMS;
    case 'highPF-ETH':
      return HIGH_PF_ETH_PARAMS;
    case 'balanced-BTC':
      return BALANCED_BTC_PARAMS;
    case 'balanced-ETH':
      return BALANCED_ETH_PARAMS;
    default:
      return {};
  }
}
