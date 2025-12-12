#!/usr/bin/env npx tsx
/**
 * FVG Liquidity Sweep Backtest Runner
 *
 * Tests the FVG Liquidity Sweep strategy on synthetic indices.
 *
 * Usage:
 *   ASSET="R_100" DAYS=7 npx tsx src/scripts/backtest-fvg-liquidity-sweep.ts
 *   ASSET="R_75,R_100" DAYS=7 npx tsx src/scripts/backtest-fvg-liquidity-sweep.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  quickExportChart,
  createFVGLiquiditySweepStrategy,
} from '../backtest/index.js';
import {
  SCALPING_AGGRESSIVE_PARAMS,
  ULTRA_SCALPING_PARAMS,
  FOREX_PARAMS,
  type FVGLiquiditySweepParams,
} from '../strategies/fvg-liquidity-sweep.params.js';

// Configuration from environment
const ASSETS = (process.env.ASSET ?? 'R_75,R_100').split(',').map(a => a.trim());
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE ?? '1000');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER ?? '100');
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');
const PRESET = process.env.PRESET ?? 'default'; // default, scalping_aggressive, ultra_scalping

// Analysis flags
const RUN_MONTE_CARLO = process.env.MONTE_CARLO !== 'false';
const EXPORT_CHART = process.env.CHART !== 'false';
const EXPORT_JSON = process.env.JSON !== 'false';

// Session Filter Presets (Killzones)
const SESSION_LONDON_NY_PARAMS: Partial<FVGLiquiditySweepParams> = {
  useSessionFilter: true,
  sessionStartHour: 7,   // London pre-market
  sessionEndHour: 20,    // NY close
};

const SESSION_LONDON_ONLY_PARAMS: Partial<FVGLiquiditySweepParams> = {
  useSessionFilter: true,
  sessionStartHour: 7,   // London open
  sessionEndHour: 16,    // London close
};

// RSI Divergence Preset
const RSI_DIVERGENCE_PARAMS: Partial<FVGLiquiditySweepParams> = {
  useRsiDivergence: true,
  rsiPeriod: 14,
  minRsiDivergence: 5,
};

// Strong Rejection Preset
const STRONG_REJECTION_PARAMS: Partial<FVGLiquiditySweepParams> = {
  requireStrongRejection: true,
  minSweepDepthPct: 0.0002, // 0.02% minimum penetration
};

// Combined Quality Filters
const HIGH_QUALITY_PARAMS: Partial<FVGLiquiditySweepParams> = {
  useSessionFilter: true,
  sessionStartHour: 7,
  sessionEndHour: 20,
  requireStrongRejection: true,
  minSweepDepthPct: 0.0002,
};

// Dynamic TP/SL based on Support/Resistance
const DYNAMIC_TPSL_PARAMS: Partial<FVGLiquiditySweepParams> = {
  useDynamicTPSL: true,
  minDynamicRR: 2.0,   // Minimum 2:1 R:R to maintain profitability
  maxDynamicRR: 6.0,   // Allow up to 6:1 for strong zones
  targetZoneBufferPct: 0.0003, // 3 pips buffer for forex
};

// Multi-Timeframe (MTF) Analysis
const MTF_PARAMS: Partial<FVGLiquiditySweepParams> = {
  useMTF: true,
  htfMultiplier: 60,              // H1 from M1 data
  htfSwingLength: 3,              // 3 H1 candles for swing (more zones)
  htfConfluenceDistancePct: 0.005, // 0.5% max distance for confluence (wider)
  htfMinSwingsForZone: 1,         // 1+ swings for HTF zone (more zones)
  htfConfluenceConfidenceBoost: 10,
};

// ============================================================================
// WIN RATE OPTIMIZATION PRESETS
// Based on research: stronger zones, impulsive FVGs, larger gaps = higher WR
// ============================================================================

// Preset 1: Stronger Liquidity Zones (3+ swings)
const STRONG_ZONES_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // 3+ swings = much stronger zone
  liquidityRangePct: 0.004,       // Slightly wider to group more swings
};

// Preset 2: Impulsive FVGs Only (large body candles)
const IMPULSIVE_FVG_PARAMS: Partial<FVGLiquiditySweepParams> = {
  requireImpulsiveFVG: true,      // Only FVGs from strong moves
  minImpulseBodyAtrMultiple: 0.8, // Body must be 0.8x ATR (significant)
};

// Preset 3: Larger FVGs (more significant gaps)
const LARGE_FVG_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minFVGSizePct: 0.0001,          // 0.01% minimum gap (double default)
};

// Preset 4: Lower R:R for Higher Win Rate (1.5:1)
const LOW_RR_PARAMS: Partial<FVGLiquiditySweepParams> = {
  takeProfitRR: 1.5,              // Lower TP = easier to hit = higher WR
};

// Preset 5: Combined High Win Rate (all quality filters)
const HIGH_WINRATE_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Stronger zones
  requireImpulsiveFVG: true,      // Impulsive FVGs only
  minImpulseBodyAtrMultiple: 0.6, // Body must be 0.6x ATR
  takeProfitRR: 1.5,              // Lower R:R for higher WR
  minConfidence: 0.75,            // Higher confidence threshold
};

// Preset 6: Entry at FVG 50% with confirmation
const FVG_50_ENTRY_PARAMS: Partial<FVGLiquiditySweepParams> = {
  entryZone: 'midpoint',          // Enter at 50% (already default)
  requireEntryConfirmation: true, // Wait for rejection candle
  minRejectionWickRatio: 0.5,     // Wick must be 0.5x body (relaxed)
};

// Preset 7: Fibonacci Confluence (only FVGs at key levels)
// This requires implementing Fib detection - for now use larger FVGs + strong zones
const FIB_CONFLUENCE_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones (often at Fib levels)
  minFVGSizePct: 0.00008,         // Larger FVGs
  requireStrongRejection: true,   // Strong rejection = likely at key level
  minSweepDepthPct: 0.0003,       // Deeper sweep = more significant
};

// Preset 8: Fib + Lower R:R (combine best filters with easier TP)
const FIB_LOW_RR_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones
  minFVGSizePct: 0.00008,         // Larger FVGs
  requireStrongRejection: true,   // Strong rejection
  minSweepDepthPct: 0.0003,       // Deeper sweep
  takeProfitRR: 2.0,              // Lower R:R for higher WR (vs 3.0 default forex)
};

// Preset 9: Fib + Very Low R:R (maximize win rate)
const FIB_VERY_LOW_RR_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones
  minFVGSizePct: 0.00008,         // Larger FVGs
  requireStrongRejection: true,   // Strong rejection
  minSweepDepthPct: 0.0003,       // Deeper sweep
  takeProfitRR: 1.5,              // Very low R:R for max WR
};

// Preset 10: Optimized High Win Rate
// Best combination based on testing
const OPTIMIZED_HWR_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones = better reversals
  minFVGSizePct: 0.00006,         // Slightly larger FVGs
  requireStrongRejection: true,   // Strong rejection confirms reversal
  minSweepDepthPct: 0.00025,      // Moderate sweep depth
  takeProfitRR: 2.5,              // Balanced R:R
};

// ============================================================================
// TIGHT TP/SL PRESETS - Faster trades, less exposure
// ============================================================================

// Preset 11: Tight TP/SL with quality filters (scalping style)
const TIGHT_TPSL_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones
  minFVGSizePct: 0.00008,         // Larger FVGs
  requireStrongRejection: true,   // Strong rejection
  minSweepDepthPct: 0.0003,       // Deeper sweep
  stopLossBufferPct: 0.0005,      // 0.05% SL (~5 pips) - TIGHTER
  takeProfitRR: 1.5,              // 1.5:1 R:R = ~7.5 pips TP
};

// Preset 12: Very Tight (ultra scalping)
const VERY_TIGHT_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones
  minFVGSizePct: 0.00008,         // Larger FVGs
  requireStrongRejection: true,   // Strong rejection
  minSweepDepthPct: 0.0003,       // Deeper sweep
  stopLossBufferPct: 0.0004,      // 0.04% SL (~4 pips) - VERY TIGHT
  takeProfitRR: 1.2,              // 1.2:1 R:R = ~5 pips TP
};

// Preset 13: Tight with 1:1 R:R (max win rate)
const TIGHT_1TO1_PARAMS: Partial<FVGLiquiditySweepParams> = {
  minSwingsForZone: 3,            // Strong zones
  minFVGSizePct: 0.00008,         // Larger FVGs
  requireStrongRejection: true,   // Strong rejection
  minSweepDepthPct: 0.0003,       // Deeper sweep
  stopLossBufferPct: 0.0005,      // 0.05% SL (~5 pips)
  takeProfitRR: 1.0,              // 1:1 R:R = ~5 pips TP (same as SL)
};

// Preset mapping
function getPresetParams(preset: string): Partial<FVGLiquiditySweepParams> | undefined {
  switch (preset.toLowerCase()) {
    case 'scalping_aggressive':
      return SCALPING_AGGRESSIVE_PARAMS;
    case 'ultra_scalping':
      return ULTRA_SCALPING_PARAMS;
    case 'forex':
      return FOREX_PARAMS;
    case 'session':
    case 'killzone':
      return SESSION_LONDON_NY_PARAMS;
    case 'session_london':
      return SESSION_LONDON_ONLY_PARAMS;
    case 'rsi_div':
    case 'divergence':
      return RSI_DIVERGENCE_PARAMS;
    case 'rejection':
      return STRONG_REJECTION_PARAMS;
    case 'high_quality':
    case 'hq':
      return HIGH_QUALITY_PARAMS;
    case 'dynamic':
    case 'dynamic_tpsl':
      return DYNAMIC_TPSL_PARAMS;
    case 'mtf':
    case 'multi_timeframe':
      return MTF_PARAMS;
    // Win Rate Optimization Presets
    case 'strong_zones':
    case 'sz':
      return STRONG_ZONES_PARAMS;
    case 'impulsive':
    case 'impulse':
      return IMPULSIVE_FVG_PARAMS;
    case 'large_fvg':
    case 'lfvg':
      return LARGE_FVG_PARAMS;
    case 'low_rr':
    case 'lrr':
      return LOW_RR_PARAMS;
    case 'high_wr':
    case 'hwr':
      return HIGH_WINRATE_PARAMS;
    case 'fvg50':
    case 'confirm':
      return FVG_50_ENTRY_PARAMS;
    case 'fib':
    case 'fibonacci':
      return FIB_CONFLUENCE_PARAMS;
    case 'fib_lrr':
    case 'fib_low_rr':
      return FIB_LOW_RR_PARAMS;
    case 'fib_vlrr':
    case 'fib_very_low_rr':
      return FIB_VERY_LOW_RR_PARAMS;
    case 'opt':
    case 'optimized':
      return OPTIMIZED_HWR_PARAMS;
    // Tight TP/SL Presets
    case 'tight':
    case 'tight_tpsl':
      return TIGHT_TPSL_PARAMS;
    case 'very_tight':
    case 'vt':
      return VERY_TIGHT_PARAMS;
    case 'tight_1to1':
    case 't1to1':
      return TIGHT_1TO1_PARAMS;
    case 'default':
    default:
      return undefined; // Use asset-specific defaults
  }
}

interface AssetResult {
  asset: string;
  trades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  avgRR: number;
}

async function runBacktestForAsset(asset: string): Promise<AssetResult | null> {
  console.log('\n' + '═'.repeat(60));
  console.log(`BACKTESTING: ${asset}`);
  console.log('═'.repeat(60));

  // Try to find data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${asset}_1m_${DAYS}d.csv`,
    `${asset}_60s_${DAYS}d.csv`,
    `${asset}_1m_7d.csv`,
    `${asset}_60s_7d.csv`,
    `${asset}_1m_30d.csv`,
    `${asset}_60s_30d.csv`,
    `${asset}_1m_90d.csv`,
    `${asset}_60s_90d.csv`,
  ];

  let dataPath: string | null = null;
  for (const file of possibleFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      dataPath = fullPath;
      break;
    }
  }

  // Also check analysis-output
  if (!dataPath) {
    const analysisDir = path.join(process.cwd(), 'analysis-output');
    for (const file of possibleFiles) {
      const fullPath = path.join(analysisDir, file);
      if (fs.existsSync(fullPath)) {
        dataPath = fullPath;
        break;
      }
    }
  }

  if (!dataPath) {
    console.log(`\n❌ No data file found for ${asset}`);
    console.log('Please fetch data first with:');
    console.log(`  SYMBOLS="${asset}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    return null;
  }

  console.log(`\n📂 Loading data from: ${path.basename(dataPath)}`);

  let candles;
  try {
    candles = loadCandlesFromCSV(dataPath, {
      asset,
      timeframe: 60,
      timestampColumn: 'timestamp',
      openColumn: 'open',
      highColumn: 'high',
      lowColumn: 'low',
      closeColumn: 'close',
      timestampFormat: 'unix_ms',
    });
  } catch (error) {
    console.error(`❌ Failed to load CSV: ${error}`);
    return null;
  }

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  if (candles.length < 100) {
    console.log(`❌ Not enough candles (need at least 100)`);
    return null;
  }

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);

  // Create strategy
  console.log(`\n📊 Strategy: FVG-Liquidity-Sweep for ${asset}`);
  const presetParams = getPresetParams(PRESET);
  const strategy = createFVGLiquiditySweepStrategy(asset, presetParams);
  console.log(`   Preset: ${PRESET}${presetParams ? ' (custom params)' : ' (asset defaults)'}`);
  console.log(`   Required indicators: ${strategy.requiredIndicators().join(', ')}`);

  // Run backtest
  console.log('\n🚀 Running backtest...');
  const startTime = Date.now();

  const result = runBacktest(strategy, candles, {
    asset,
    timeframe: 60,
    initialBalance: INITIAL_BALANCE,
    stakeMode: 'percentage',
    stakePct: STAKE_PCT,
    stakeAmount: INITIAL_BALANCE * STAKE_PCT,
    multiplier: MULTIPLIER,
  }, {
    runMonteCarlo: RUN_MONTE_CARLO,
    monteCarloSimulations: 500,
    runOOS: false,
    verbose: false,
  });

  const elapsed = Date.now() - startTime;
  console.log(`   Completed in ${elapsed}ms`);

  // Print results
  printBacktestResult(result);

  // Calculate average R:R
  let totalRR = 0;
  for (const trade of result.trades) {
    if (trade.result === 'WIN') {
      totalRR += Math.abs(trade.pnl) / (INITIAL_BALANCE * STAKE_PCT);
    }
  }
  const avgRR = result.metrics.wins > 0 ? totalRR / result.metrics.wins : 0;

  // Export
  if (EXPORT_JSON && result.trades.length > 0) {
    console.log('\n📄 Exporting JSON...');
    const jsonPath = quickExport(result);
    console.log(`   Saved to: ${jsonPath}`);
  }

  if (EXPORT_CHART && result.trades.length > 0) {
    console.log('\n📈 Generating chart...');
    const chartPath = quickExportChart(result, undefined, {
      title: `FVG-Liquidity-Sweep - ${asset}`,
      showIndicators: ['rsi'],
    });
    console.log(`   Saved to: ${chartPath}`);
  }

  return {
    asset,
    trades: result.metrics.totalTrades,
    winRate: result.metrics.winRate,
    netPnl: result.metrics.netPnl,
    profitFactor: result.metrics.profitFactor,
    maxDrawdown: result.metrics.maxDrawdownPct,
    avgRR,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FVG LIQUIDITY SWEEP BACKTEST                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Assets: ${ASSETS.join(', ')}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Preset: ${PRESET}`);
  console.log(`Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`Multiplier: x${MULTIPLIER}`);

  const results: AssetResult[] = [];

  for (const asset of ASSETS) {
    const result = await runBacktestForAsset(asset);
    if (result) {
      results.push(result);
    }
  }

  // Summary table
  if (results.length > 0) {
    console.log('\n\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log();
    console.log('┌──────────┬────────┬──────────┬────────────┬────────────┬───────────┬────────┐');
    console.log('│ Asset    │ Trades │ Win Rate │ Net P&L    │ PF         │ Max DD    │ Avg RR │');
    console.log('├──────────┼────────┼──────────┼────────────┼────────────┼───────────┼────────┤');

    for (const r of results) {
      const pf = r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2);
      console.log(
        `│ ${r.asset.padEnd(8)} │ ${r.trades.toString().padStart(6)} │ ${(r.winRate.toFixed(1) + '%').padStart(8)} │ ${('$' + r.netPnl.toFixed(2)).padStart(10)} │ ${pf.padStart(10)} │ ${(r.maxDrawdown.toFixed(1) + '%').padStart(9)} │ ${r.avgRR.toFixed(2).padStart(6)} │`
      );
    }

    console.log('└──────────┴────────┴──────────┴────────────┴────────────┴───────────┴────────┘');

    // Totals
    const totalTrades = results.reduce((sum, r) => sum + r.trades, 0);
    const totalPnl = results.reduce((sum, r) => sum + r.netPnl, 0);
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;

    console.log();
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`Avg Win Rate: ${avgWinRate.toFixed(1)}%`);
  }

  console.log('\n✅ Backtest complete!');
}

main().catch(console.error);
