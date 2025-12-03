/**
 * Pullback Window Strategy Parameters and Presets
 *
 * Optimized configurations for Gold (XAUUSD) and Silver (XAGUSD)
 */

import type { PullbackWindowParams } from './pullback-window.types.js';

/**
 * Default parameters (baseline from paper)
 */
export const DEFAULT_PULLBACK_WINDOW_PARAMS: PullbackWindowParams = {
  // EMAs
  emaConfirmPeriod: 1,
  emaFastPeriod: 14,
  emaMediumPeriod: 18,
  emaSlowPeriod: 24,

  // Pullback
  longPullbackMaxCandles: 3,
  shortPullbackMaxCandles: 3,
  minPullbackCandles: 1,

  // Window
  longEntryWindowPeriods: 2,
  shortEntryWindowPeriods: 2,
  windowOffsetMultiplier: 1.0,

  // Risk (ATR-based)
  slAtrMultiplier: 2.5,
  tpAtrMultiplier: 8.0,  // Conservative (paper used 12.0)

  // Filters
  minAdx: 20,
  atrPeriod: 14,

  // Session
  tradingHours: [],
  avoidDays: [],
};

/**
 * Gold (XAUUSD) Optimized Preset
 *
 * Gold characteristics:
 * - Higher volatility than forex
 * - Strong trends during market hours
 * - Responds well to pullback strategies
 */
export const GOLD_OPTIMIZED_PRESET: Partial<PullbackWindowParams> = {
  // Standard EMAs work well for gold
  emaConfirmPeriod: 1,
  emaFastPeriod: 14,
  emaMediumPeriod: 18,
  emaSlowPeriod: 24,

  // Gold can have deeper pullbacks
  longPullbackMaxCandles: 4,
  shortPullbackMaxCandles: 4,
  minPullbackCandles: 2,  // Require at least 2 pullback candles

  // Wider window for gold volatility
  longEntryWindowPeriods: 3,
  shortEntryWindowPeriods: 3,
  windowOffsetMultiplier: 1.2,  // Slightly wider breakout level

  // Tighter SL, wider TP for gold's momentum
  slAtrMultiplier: 2.0,    // Tighter stop
  tpAtrMultiplier: 10.0,   // Wider target

  // Higher ADX requirement (gold trends strongly)
  minAdx: 25,
  atrPeriod: 14,

  // Avoid low-liquidity hours for gold
  tradingHours: [
    { start: '00:00', end: '23:59' },  // 24/7 but filtered by avoidDays
  ],
  avoidDays: [],  // Gold trades 24/5
};

/**
 * Silver (XAGUSD) Optimized Preset
 *
 * Silver characteristics:
 * - More volatile than gold
 * - Follows gold but with exaggerated moves
 * - Needs slightly different parameters
 */
export const SILVER_OPTIMIZED_PRESET: Partial<PullbackWindowParams> = {
  // Same EMAs
  emaConfirmPeriod: 1,
  emaFastPeriod: 14,
  emaMediumPeriod: 18,
  emaSlowPeriod: 24,

  // Silver can have even deeper pullbacks
  longPullbackMaxCandles: 5,
  shortPullbackMaxCandles: 5,
  minPullbackCandles: 2,

  // Wider window for silver's volatility
  longEntryWindowPeriods: 3,
  shortEntryWindowPeriods: 3,
  windowOffsetMultiplier: 1.5,  // Much wider for silver's whipsaws

  // Even tighter SL, much wider TP
  slAtrMultiplier: 1.8,    // Very tight stop
  tpAtrMultiplier: 12.0,   // Very wide target (silver can run)

  // Same ADX
  minAdx: 25,
  atrPeriod: 14,

  // Same hours as gold
  tradingHours: [
    { start: '00:00', end: '23:59' },
  ],
  avoidDays: [],
};

/**
 * Conservative preset (lower risk, lower reward)
 */
export const CONSERVATIVE_PRESET: Partial<PullbackWindowParams> = {
  // Slower EMAs for stronger trend confirmation
  emaConfirmPeriod: 2,
  emaFastPeriod: 18,
  emaMediumPeriod: 24,
  emaSlowPeriod: 32,

  // Stricter pullback requirements
  longPullbackMaxCandles: 2,
  shortPullbackMaxCandles: 2,
  minPullbackCandles: 2,

  // Shorter window (less risk of false breakouts)
  longEntryWindowPeriods: 1,
  shortEntryWindowPeriods: 1,
  windowOffsetMultiplier: 0.8,

  // Wider SL, moderate TP
  slAtrMultiplier: 3.0,
  tpAtrMultiplier: 6.0,

  // Higher ADX requirement
  minAdx: 30,
  atrPeriod: 14,
};

/**
 * Aggressive preset (higher risk, higher reward)
 */
export const AGGRESSIVE_PRESET: Partial<PullbackWindowParams> = {
  // Faster EMAs for quicker entries
  emaConfirmPeriod: 1,
  emaFastPeriod: 10,
  emaMediumPeriod: 14,
  emaSlowPeriod: 18,

  // Allow more pullback candles
  longPullbackMaxCandles: 6,
  shortPullbackMaxCandles: 6,
  minPullbackCandles: 1,

  // Longer window
  longEntryWindowPeriods: 4,
  shortEntryWindowPeriods: 4,
  windowOffsetMultiplier: 1.5,

  // Tighter SL, much wider TP
  slAtrMultiplier: 1.5,
  tpAtrMultiplier: 15.0,

  // Lower ADX (more entries)
  minAdx: 15,
  atrPeriod: 14,
};

/**
 * Forex 1m Optimized Preset
 *
 * Designed for Gold/Silver on 1-minute timeframe with high volatility
 */
export const FOREX_1M_PRESET: Partial<PullbackWindowParams> = {
  // Shorter EMAs for faster reaction on 1m
  emaConfirmPeriod: 1,
  emaFastPeriod: 5,
  emaMediumPeriod: 8,
  emaSlowPeriod: 13,

  // Allow 1-3 pullback candles (fast scalping)
  longPullbackMaxCandles: 3,
  shortPullbackMaxCandles: 3,
  minPullbackCandles: 1,

  // Short entry window (1-2 candles)
  longEntryWindowPeriods: 2,
  shortEntryWindowPeriods: 2,
  windowOffsetMultiplier: 0.5, // Tighter breakout level

  // Tight SL, moderate TP for scalping
  slAtrMultiplier: 1.5,
  tpAtrMultiplier: 4.0,

  // No ADX filter (accept all trends)
  minAdx: 0,
  atrPeriod: 14,

  // No session filters
  tradingHours: [],
  avoidDays: [],
};

/**
 * Paper M5 Preset (Academic Paper Baseline)
 *
 * Exact parameters from academic paper (M5 timeframe)
 * - Win Rate: 55.43%
 * - Profit Factor: 1.64
 * - Timeframe: 5 minutes (300s)
 */
export const PAPER_M5_PRESET: Partial<PullbackWindowParams> = {
  // EMAs - EXACT from paper
  emaConfirmPeriod: 1,
  emaFastPeriod: 14,
  emaMediumPeriod: 18,
  emaSlowPeriod: 24,

  // Pullback - paper allows up to 3
  longPullbackMaxCandles: 3,
  shortPullbackMaxCandles: 3,
  minPullbackCandles: 1,

  // Window - 2 periods as per paper
  longEntryWindowPeriods: 2,
  shortEntryWindowPeriods: 2,
  windowOffsetMultiplier: 1.0,

  // Risk Management - EXACT from paper
  slAtrMultiplier: 2.5,    // Paper SL
  tpAtrMultiplier: 12.0,   // Paper TP (ratio 1:4.8)

  // Filters - permissive ADX
  minAdx: 20,
  atrPeriod: 14,

  // No session filters
  tradingHours: [],
  avoidDays: [],
};

/**
 * Gold M5 Optimized Preset
 *
 * Optimized for real Gold trading on M5 timeframe
 * - More permissive ADX filter (15 vs 20)
 * - More achievable TP target (8x vs 12x ATR)
 * - Expected: WR ~35-40%, PF ~1.4-1.5
 */
export const GOLD_M5_OPTIMIZED: Partial<PullbackWindowParams> = {
  // EMAs - same as paper
  emaConfirmPeriod: 1,
  emaFastPeriod: 14,
  emaMediumPeriod: 18,
  emaSlowPeriod: 24,

  // Pullback - same as paper
  longPullbackMaxCandles: 3,
  shortPullbackMaxCandles: 3,
  minPullbackCandles: 1,

  // Window - same as paper
  longEntryWindowPeriods: 2,
  shortEntryWindowPeriods: 2,
  windowOffsetMultiplier: 1.0,

  // Risk Management - OPTIMIZED
  slAtrMultiplier: 2.5,    // Keep paper SL
  tpAtrMultiplier: 8.0,    // Reduced from 12 → 8 (ratio 3.2:1)

  // Filters - MORE PERMISSIVE
  minAdx: 15,              // Reduced from 20 → 15 (more trades)
  atrPeriod: 14,

  // No session filters
  tradingHours: [],
  avoidDays: [],
};

/**
 * Helper to merge params with defaults
 */
export function mergeParams(
  customParams?: Partial<PullbackWindowParams>
): PullbackWindowParams {
  if (!customParams) return { ...DEFAULT_PULLBACK_WINDOW_PARAMS };

  return {
    ...DEFAULT_PULLBACK_WINDOW_PARAMS,
    ...customParams,
    tradingHours: customParams.tradingHours ?? DEFAULT_PULLBACK_WINDOW_PARAMS.tradingHours,
    avoidDays: customParams.avoidDays ?? DEFAULT_PULLBACK_WINDOW_PARAMS.avoidDays,
  };
}

/**
 * Get preset by name
 */
export function getPreset(
  name: 'default' | 'gold' | 'silver' | 'conservative' | 'aggressive' | 'forex_1m' | 'paper_m5' | 'gold_m5_opt'
): Partial<PullbackWindowParams> {
  switch (name) {
    case 'gold':
      return GOLD_OPTIMIZED_PRESET;
    case 'silver':
      return SILVER_OPTIMIZED_PRESET;
    case 'conservative':
      return CONSERVATIVE_PRESET;
    case 'aggressive':
      return AGGRESSIVE_PRESET;
    case 'forex_1m':
      return FOREX_1M_PRESET;
    case 'paper_m5':
      return PAPER_M5_PRESET;
    case 'gold_m5_opt':
      return GOLD_M5_OPTIMIZED;
    case 'default':
    default:
      return {};
  }
}

/**
 * Get asset-specific config
 */
export function getAssetConfig(asset: string): Partial<PullbackWindowParams> {
  if (asset.includes('XAUUSD') || asset.includes('XAU')) {
    return GOLD_OPTIMIZED_PRESET;
  }
  if (asset.includes('XAGUSD') || asset.includes('XAG')) {
    return SILVER_OPTIMIZED_PRESET;
  }
  return {};
}

/**
 * Get fully resolved params for an asset
 */
export function getParamsForAsset(
  asset: string,
  customParams?: Partial<PullbackWindowParams>
): PullbackWindowParams {
  const assetConfig = getAssetConfig(asset);
  const merged = mergeParams({ ...assetConfig, ...customParams });
  return merged;
}
