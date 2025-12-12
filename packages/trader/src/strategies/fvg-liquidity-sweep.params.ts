/**
 * FVG Liquidity Sweep Strategy Parameters
 *
 * Default parameters and asset-specific presets
 */

import type { FVGLiquiditySweepParams } from './fvg-liquidity-sweep.types.js';

/**
 * Default parameters (conservative settings)
 */
export const DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS: FVGLiquiditySweepParams = {
  // Swing Detection
  swingLength: 5,                    // 5 bars left/right to confirm swing

  // Liquidity Zone Detection
  liquidityRangePct: 0.01,           // 1% range to group swing points
  minSwingsForZone: 2,               // At least 2 swings to form zone
  maxZoneAgeBars: 200,               // Zone expires after 200 bars

  // Sweep Detection
  requireCloseBack: true,            // Must close back inside zone
  maxBarsAfterSweep: 20,             // Max bars to wait for FVG after sweep

  // FVG Detection
  minFVGSizePct: 0.001,              // 0.1% minimum gap size
  fvgSearchBars: 10,                 // Search last 10 bars for FVG

  // Entry
  entryZone: 'midpoint',             // Enter at 50% of FVG
  requireConfirmation: false,        // Don't wait for confirmation candle
  maxBarsForEntry: 15,               // Max bars to wait for entry after FVG

  // Risk Management
  stopLossBufferPct: 0.002,          // 0.2% buffer beyond sweep
  takeProfitRR: 2.0,                 // 2:1 risk-reward
  minConfidence: 0.7,                // Minimum 70% confidence

  // Cooldown
  cooldownSeconds: 60,               // 1 minute between trades

  // Dynamic Cooldown
  dynamicCooldownEnabled: true,
  cooldownAfter2Losses: 600,         // 10 minutes after 2 losses
  cooldownAfter3Losses: 1800,        // 30 minutes after 3 losses
  cooldownAfter4PlusLosses: 3600,    // 1 hour after 4+ losses

  // Hour Filter (disabled by default)
  hourFilterEnabled: false,
  badHoursUTC: [],

  // Session Filter (Killzones) - disabled by default
  useSessionFilter: false,
  sessionStartHour: 7,        // 7 UTC = London pre-market
  sessionEndHour: 20,         // 20 UTC = NY close

  // RSI Divergence Filter - disabled by default
  useRsiDivergence: false,
  rsiPeriod: 14,
  minRsiDivergence: 5,        // Minimum 5 points difference

  // Sweep Quality Filters
  minSweepDepthPct: 0.0002,   // 0.02% minimum penetration (slightly deeper)
  requireStrongRejection: true,  // Close must be in opposite half of candle

  // Market Structure Shift (MSS) - CRITICAL ICT ELEMENT
  requireMSS: true,           // ENABLED by default - this is the key fix!
  mssLookbackBars: 15,        // Look back 15 bars for swing to break (wider)
  maxBarsForMSS: 20,          // Max 20 bars after sweep to confirm MSS

  // Entry Confirmation Filters
  requireEntryConfirmation: false,  // Disabled - too restrictive for forex
  minRejectionWickRatio: 1.0,       // Wick must be 1x body for rejection

  // Momentum/Impulse Filters
  requireImpulsiveFVG: false,       // Disabled - too restrictive for forex
  minImpulseBodyAtrMultiple: 0.5,   // Body must be 0.5x ATR
  atrPeriod: 14,                    // 14-period ATR

  // Dynamic TP/SL based on Support/Resistance
  useDynamicTPSL: false,            // Disabled by default - use fixed R:R
  minDynamicRR: 1.5,                // Minimum 1.5:1 R:R even with dynamic
  maxDynamicRR: 5.0,                // Maximum 5:1 R:R to avoid unrealistic targets
  targetZoneBufferPct: 0.0005,      // 0.05% buffer before zone (5 pips for forex)

  // Multi-Timeframe (MTF) Analysis
  useMTF: false,                    // Disabled by default
  htfMultiplier: 60,                // H1 from M1 data (60 candles = 1 H1 candle)
  htfSwingLength: 5,                // 5 H1 candles for swing detection
  htfConfluenceDistancePct: 0.002,  // 0.2% max distance for confluence
  htfMinSwingsForZone: 2,           // 2+ swings for HTF zone
  htfConfluenceConfidenceBoost: 10, // +10% confidence when HTF aligns
};

/**
 * Synthetic Indices preset (R_75, R_100, etc.)
 *
 * Higher volatility, tighter gaps
 */
export const SYNTHETIC_INDEX_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 5,
  liquidityRangePct: 0.008,          // 0.8% range
  minFVGSizePct: 0.0008,             // 0.08% minimum gap
  stopLossBufferPct: 0.0015,         // 0.15% buffer
  takeProfitRR: 1.5,                 // 1.5:1 R:R (faster moves)
  cooldownSeconds: 45,
};

/**
 * Forex pairs preset (base config)
 *
 * Forex moves much less than synthetics - need smaller gap thresholds
 * EUR/USD typical daily range: 0.5-1%, 1-min ATR: ~0.005%
 *
 * Win Rate Optimization Results (Dec 2025, 365 days EUR/USD):
 * - Baseline: 55.7% WR, PF 1.43, $81.37
 * - fib_lrr (2:1 RR): 58.9% WR, PF 1.46, $50.23, MaxDD 2.1%
 * - tight_1to1 (1:1 RR): 60.6% WR, PF 1.51, $50.29, MaxDD 1.2% ← BEST
 *
 * tight_1to1 wins: +1.7% WR, +3% PF, -43% drawdown, faster trades
 */
export const FOREX_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 5,                    // Faster swings
  liquidityRangePct: 0.003,          // 0.3% range (tighter)
  minSwingsForZone: 3,               // 3+ swings = stronger liquidity zone (WR+)
  minFVGSizePct: 0.00008,            // 0.008% minimum gap - larger FVGs (WR+)
  maxBarsAfterSweep: 30,
  maxBarsForEntry: 20,
  fvgSearchBars: 15,
  stopLossBufferPct: 0.0005,         // 0.05% SL (~5 pips) - TIGHT for scalping
  takeProfitRR: 1.0,                 // 1:1 R:R - max WR, same TP as SL (~5 pips)
  cooldownSeconds: 60,               // 1 min cooldown
  minConfidence: 0.75,               // Higher confidence threshold
  maxZoneAgeBars: 300,
  // Hour filter enabled for forex
  hourFilterEnabled: true,
  badHoursUTC: [4, 5, 9, 17, 21, 23], // Common bad hours across forex pairs
  // Sweep Quality Filters (WR+)
  requireStrongRejection: true,      // Strong rejection = better reversals
  minSweepDepthPct: 0.0003,          // Deeper sweep = more significant
};

/**
 * frxAUDUSD specific params
 * Best performer with +11% improvement from hour filter
 */
export const AUDUSD_PARAMS: Partial<FVGLiquiditySweepParams> = {
  ...FOREX_PARAMS,
  badHoursUTC: [5, 8, 9, 11, 16, 17, 21],
};

/**
 * frxEURUSD specific params
 * +39.6% improvement from hour filter
 */
export const EURUSD_PARAMS: Partial<FVGLiquiditySweepParams> = {
  ...FOREX_PARAMS,
  badHoursUTC: [4, 5, 10, 15],
};

/**
 * frxGBPUSD specific params
 * +81.8% improvement from hour filter
 */
export const GBPUSD_PARAMS: Partial<FVGLiquiditySweepParams> = {
  ...FOREX_PARAMS,
  badHoursUTC: [1, 5, 7, 17, 19, 23],
};

/**
 * frxUSDCHF specific params
 * +13.5% improvement from hour filter
 */
export const USDCHF_PARAMS: Partial<FVGLiquiditySweepParams> = {
  ...FOREX_PARAMS,
  badHoursUTC: [4, 9, 21, 23],
};

/**
 * Gold preset (frxXAUUSD)
 *
 * Gold is more volatile than forex but less than synthetics
 * Typical 1-min ATR: ~0.02-0.03%
 */
export const GOLD_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 5,                    // Faster swings
  liquidityRangePct: 0.005,          // 0.5% range
  minSwingsForZone: 2,
  minFVGSizePct: 0.0001,             // 0.01% minimum gap
  maxBarsAfterSweep: 25,
  maxBarsForEntry: 15,
  fvgSearchBars: 12,
  stopLossBufferPct: 0.0015,         // 0.15% buffer
  takeProfitRR: 1.5,                 // 1.5:1 R:R
  cooldownSeconds: 60,
  minConfidence: 0.65,
  maxZoneAgeBars: 250,
};

/**
 * Crypto preset (cryBTCUSD, cryETHUSD, etc.)
 *
 * Lower volatility than synthetics, smaller gaps, more frequent FVGs
 * Based on analysis: BTC ATR ~0.06%, ETH ATR ~0.10%, Gap Size ~0.03-0.05%
 */
export const CRYPTO_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 8,                      // More confirmation needed for crypto
  liquidityRangePct: 0.006,            // 0.6% range (narrower - less volatile)
  minSwingsForZone: 2,                 // Standard
  minFVGSizePct: 0.0002,               // 0.02% minimum gap (smaller gaps)
  maxBarsAfterSweep: 25,               // Longer window - crypto moves slower
  maxBarsForEntry: 20,                 // More time for entry
  fvgSearchBars: 15,                   // Search more bars for FVG
  stopLossBufferPct: 0.0015,           // 0.15% buffer (~2x ATR)
  takeProfitRR: 1.2,                   // Lower R:R for higher win rate (was 1.5)
  cooldownSeconds: 180,                // 3 min cooldown - slower market
  minConfidence: 0.65,                 // Slightly lower threshold
  maxZoneAgeBars: 300,                 // Zones last longer in crypto
};

/**
 * Bitcoin-specific preset
 * BTC has lower ATR (0.06%) and smaller gaps
 */
export const BTC_PARAMS: Partial<FVGLiquiditySweepParams> = {
  ...CRYPTO_PARAMS,
  minFVGSizePct: 0.00015,              // 0.015% - even smaller gaps
  liquidityRangePct: 0.005,            // 0.5% range
  takeProfitRR: 1.3,                   // Slightly higher for BTC
};

/**
 * Ethereum-specific preset
 * ETH is more volatile (ATR ~0.10%) than BTC
 */
export const ETH_PARAMS: Partial<FVGLiquiditySweepParams> = {
  ...CRYPTO_PARAMS,
  minFVGSizePct: 0.0003,               // 0.03% - slightly larger gaps
  liquidityRangePct: 0.007,            // 0.7% range
  stopLossBufferPct: 0.002,            // 0.2% buffer - more volatile
  takeProfitRR: 1.0,                   // 1:1 R:R - high near misses suggest lower TP
  minSwingsForZone: 3,                 // More swings needed for quality
};

/**
 * Basket Indices preset (WLDUSD, WLDEUR, etc.)
 *
 * Baskets behave similar to forex - low volatility
 * WLDUSD: ATR ~0.009%, Gap Size ~0.0014%
 * WLDEUR: ATR ~0.007%, Gap Size ~0.0011%
 */
export const BASKET_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 5,                      // Standard swing detection
  liquidityRangePct: 0.003,            // 0.3% range (similar to forex)
  minSwingsForZone: 2,
  minFVGSizePct: 0.00005,              // 0.005% minimum gap (very small gaps)
  maxBarsAfterSweep: 30,               // Longer window
  maxBarsForEntry: 20,
  fvgSearchBars: 15,
  stopLossBufferPct: 0.0008,           // 0.08% buffer (~1x ATR)
  takeProfitRR: 1.5,                   // 1.5:1 R:R
  cooldownSeconds: 60,
  minConfidence: 0.65,
  maxZoneAgeBars: 300,
};

/**
 * Aggressive preset (higher frequency, lower R:R)
 */
export const AGGRESSIVE_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 3,
  liquidityRangePct: 0.012,          // 1.2% range (more zones)
  minSwingsForZone: 2,
  minFVGSizePct: 0.0005,             // 0.05% minimum gap
  maxBarsAfterSweep: 30,
  maxBarsForEntry: 20,
  stopLossBufferPct: 0.001,          // 0.1% buffer
  takeProfitRR: 1.2,                 // 1.2:1 R:R
  minConfidence: 0.6,
  cooldownSeconds: 30,
};

/**
 * SCALPING AGGRESSIVE preset (5-10 min max duration)
 *
 * Ultra-fast scalping for forex with tight TP/SL
 * - Max trade duration: 10 minutes
 * - TP: 0.2% | SL: 0.15%
 * - Early exit at 40% TP
 */
export const SCALPING_AGGRESSIVE_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 3,                    // Fast swing detection
  liquidityRangePct: 0.003,          // 0.3% range (tight zones)
  minSwingsForZone: 2,
  minFVGSizePct: 0.00003,            // 0.003% minimum gap (3 pips)
  maxBarsAfterSweep: 10,             // Quick entry window
  maxBarsForEntry: 5,                // 5 bars max to enter
  fvgSearchBars: 8,                  // Search less bars
  stopLossBufferPct: 0.0015,         // 0.15% SL buffer
  takeProfitRR: 1.33,                // 0.2% TP / 0.15% SL = 1.33:1
  minConfidence: 0.60,               // Lower threshold for more trades
  cooldownSeconds: 30,               // 30 seconds between trades
  hourFilterEnabled: true,
  badHoursUTC: [4, 5, 9, 17, 21, 23],
};

/**
 * ULTRA SCALPING preset (3-5 min max duration)
 *
 * Hyper-fast scalping for maximum frequency
 * - Max trade duration: 5 minutes
 * - TP: 0.15% | SL: 0.10%
 * - Early exit at 30% TP
 */
export const ULTRA_SCALPING_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 3,                    // Fast swing detection
  liquidityRangePct: 0.002,          // 0.2% range (very tight)
  minSwingsForZone: 2,
  minFVGSizePct: 0.00002,            // 0.002% minimum gap (2 pips)
  maxBarsAfterSweep: 8,              // Very quick entry window
  maxBarsForEntry: 3,                // 3 bars max to enter
  fvgSearchBars: 5,                  // Search very few bars
  stopLossBufferPct: 0.001,          // 0.10% SL buffer
  takeProfitRR: 1.5,                 // 0.15% TP / 0.10% SL = 1.5:1
  minConfidence: 0.55,               // Even lower threshold
  cooldownSeconds: 20,               // 20 seconds between trades
  hourFilterEnabled: true,
  badHoursUTC: [4, 5, 9, 17, 21, 23],
};

/**
 * Conservative preset (higher quality setups)
 */
export const CONSERVATIVE_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 10,
  liquidityRangePct: 0.006,          // 0.6% range (fewer zones)
  minSwingsForZone: 3,               // Need 3 swings
  minFVGSizePct: 0.002,              // 0.2% minimum gap
  maxBarsAfterSweep: 10,             // Shorter window
  maxBarsForEntry: 10,
  stopLossBufferPct: 0.003,          // 0.3% buffer
  takeProfitRR: 2.5,                 // 2.5:1 R:R
  minConfidence: 0.8,
  cooldownSeconds: 180,
  requireConfirmation: true,
};

/**
 * Get parameters for a specific asset
 */
export function getParamsForAsset(
  asset: string,
  overrides?: Partial<FVGLiquiditySweepParams>
): FVGLiquiditySweepParams {
  let baseParams = DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS;

  // Apply asset-specific presets
  if (asset.startsWith('R_') || asset.includes('Volatility')) {
    baseParams = { ...baseParams, ...SYNTHETIC_INDEX_PARAMS };
  } else if (asset.includes('BTC') || asset === 'cryBTCUSD') {
    baseParams = { ...baseParams, ...BTC_PARAMS };
  } else if (asset.includes('ETH') || asset === 'cryETHUSD') {
    baseParams = { ...baseParams, ...ETH_PARAMS };
  } else if (asset.startsWith('cry') || asset.includes('Crypto')) {
    baseParams = { ...baseParams, ...CRYPTO_PARAMS };
  } else if (asset.includes('XAU') || asset.includes('Gold')) {
    baseParams = { ...baseParams, ...GOLD_PARAMS };
  } else if (asset.startsWith('WLD') || asset.includes('Basket')) {
    // Basket indices (WLDUSD, WLDEUR, etc.)
    baseParams = { ...baseParams, ...BASKET_PARAMS };
  } else if (asset === 'frxAUDUSD') {
    // AUD/USD with specific hour filter
    baseParams = { ...baseParams, ...AUDUSD_PARAMS };
  } else if (asset === 'frxEURUSD') {
    // EUR/USD with specific hour filter
    baseParams = { ...baseParams, ...EURUSD_PARAMS };
  } else if (asset === 'frxGBPUSD') {
    // GBP/USD with specific hour filter
    baseParams = { ...baseParams, ...GBPUSD_PARAMS };
  } else if (asset === 'frxUSDCHF') {
    // USD/CHF with specific hour filter
    baseParams = { ...baseParams, ...USDCHF_PARAMS };
  } else if (asset.startsWith('frx')) {
    // Other forex pairs use generic forex params
    baseParams = { ...baseParams, ...FOREX_PARAMS };
  }

  // Apply user overrides
  if (overrides) {
    baseParams = { ...baseParams, ...overrides };
  }

  return baseParams;
}
