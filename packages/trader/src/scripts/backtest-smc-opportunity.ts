#!/usr/bin/env npx tsx
/**
 * SMC Opportunity Backtest Runner
 *
 * Tests the SMC (Smart Money Concepts) opportunity detection system historically.
 *
 * Usage:
 *   ASSET="R_100" DAYS=7 npx tsx src/scripts/backtest-smc-opportunity.ts
 *   ASSET="frxEURUSD" DAYS=30 QUALITY="A+" npx tsx src/scripts/backtest-smc-opportunity.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExport,
  quickExportChart,
} from '../backtest/index.js';
import { createSMCBacktestStrategy, type SMCBacktestParams } from '../backtest/strategies/smc-opportunity-backtest.strategy.js';

// Configuration from environment
const ASSETS = (process.env.ASSET ?? 'R_100').split(',').map(a => a.trim());
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE ?? '1000');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER ?? '100');
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');
const MIN_QUALITY = (process.env.QUALITY ?? 'A') as SMCBacktestParams['minQuality'];

// Analysis flags
const RUN_MONTE_CARLO = process.env.MONTE_CARLO !== 'false';
const EXPORT_CHART = process.env.CHART !== 'false';
const EXPORT_JSON = process.env.JSON !== 'false';
const USE_STRUCTURAL_TPSL = process.env.STRUCTURAL !== 'false';

// Presets for different trading styles
const PRESETS: Record<string, Partial<SMCBacktestParams>> = {
  // Default: A+ and A quality only with structural TP/SL
  default: {
    minQuality: 'A',
    useStructuralTPSL: true,
    maxBarsInTrade: 30,
    cooldownBars: 5,
  },

  // High Quality: Only A+ setups
  premium: {
    minQuality: 'A+',
    useStructuralTPSL: true,
    maxBarsInTrade: 50,
    cooldownBars: 10,
  },

  // Aggressive: Include B quality signals
  aggressive: {
    minQuality: 'B',
    useStructuralTPSL: true,
    maxBarsInTrade: 20,
    cooldownBars: 3,
  },

  // Conservative: Fixed TP/SL
  conservative: {
    minQuality: 'A',
    useStructuralTPSL: false,
    fixedTPPct: 0.3,
    fixedSLPct: 0.2,
    maxBarsInTrade: 15,
    cooldownBars: 5,
  },

  // Scalping: Quick trades with tight stops
  scalping: {
    minQuality: 'A',
    useStructuralTPSL: false,
    fixedTPPct: 0.15,
    fixedSLPct: 0.1,
    maxBarsInTrade: 10,
    cooldownBars: 2,
  },
};

const PRESET = process.env.PRESET ?? 'default';

interface AssetResult {
  asset: string;
  trades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  avgBarsHeld: number;
}

async function runBacktestForAsset(asset: string): Promise<AssetResult | null> {
  console.log('\n' + '═'.repeat(60));
  console.log(`BACKTESTING SMC: ${asset}`);
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

  if (candles.length < 200) {
    console.log(`❌ Not enough candles for SMC analysis (need at least 200)`);
    return null;
  }

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  console.log(`   Period: ${new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0]} → ${new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0]}`);

  // Get preset params
  const presetParams = PRESETS[PRESET] ?? PRESETS.default;

  // Override minQuality if specified in env
  const params: Partial<SMCBacktestParams> = {
    ...presetParams,
    minQuality: MIN_QUALITY,
    useStructuralTPSL: USE_STRUCTURAL_TPSL,
  };

  // Create strategy
  console.log(`\n📊 Strategy: SMC-Opportunity for ${asset}`);
  const strategy = createSMCBacktestStrategy(asset, params);
  console.log(`   Preset: ${PRESET}`);
  console.log(`   Min Quality: ${params.minQuality}`);
  console.log(`   Structural TP/SL: ${params.useStructuralTPSL}`);
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

  // Export
  if (EXPORT_JSON && result.trades.length > 0) {
    console.log('\n📄 Exporting JSON...');
    const jsonPath = quickExport(result);
    console.log(`   Saved to: ${jsonPath}`);
  }

  if (EXPORT_CHART && result.trades.length > 0) {
    console.log('\n📈 Generating chart...');
    const chartPath = quickExportChart(result, undefined, {
      title: `SMC-Opportunity - ${asset}`,
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
    avgBarsHeld: result.metrics.avgBarsHeld,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     SMC OPPORTUNITY BACKTEST                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Assets: ${ASSETS.join(', ')}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Preset: ${PRESET}`);
  console.log(`Min Quality: ${MIN_QUALITY}`);
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
    console.log('\n\n' + '═'.repeat(90));
    console.log('SUMMARY');
    console.log('═'.repeat(90));
    console.log();
    console.log('┌──────────┬────────┬──────────┬────────────┬────────────┬───────────┬───────────┐');
    console.log('│ Asset    │ Trades │ Win Rate │ Net P&L    │ PF         │ Max DD    │ Avg Bars  │');
    console.log('├──────────┼────────┼──────────┼────────────┼────────────┼───────────┼───────────┤');

    for (const r of results) {
      const pf = r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2);
      console.log(
        `│ ${r.asset.padEnd(8)} │ ${r.trades.toString().padStart(6)} │ ${(r.winRate.toFixed(1) + '%').padStart(8)} │ ${('$' + r.netPnl.toFixed(2)).padStart(10)} │ ${pf.padStart(10)} │ ${(r.maxDrawdown.toFixed(1) + '%').padStart(9)} │ ${r.avgBarsHeld.toFixed(1).padStart(9)} │`
      );
    }

    console.log('└──────────┴────────┴──────────┴────────────┴────────────┴───────────┴───────────┘');

    // Totals
    const totalTrades = results.reduce((sum, r) => sum + r.trades, 0);
    const totalPnl = results.reduce((sum, r) => sum + r.netPnl, 0);
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;

    console.log();
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`Avg Win Rate: ${avgWinRate.toFixed(1)}%`);
  }

  console.log('\n✅ SMC Backtest complete!');
}

main().catch(console.error);
