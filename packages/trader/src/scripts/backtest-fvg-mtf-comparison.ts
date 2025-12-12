#!/usr/bin/env npx tsx
/**
 * FVG Liquidity Sweep MTF Comparison Backtest
 *
 * Compares single timeframe vs multiple MTF configurations
 * using the full backtest engine.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  FVGLiquiditySweepBacktestStrategy,
} from '../backtest/index.js';
import type { FVGLiquiditySweepParams } from '../strategies/fvg-liquidity-sweep.types.js';
import { getParamsForAsset } from '../strategies/fvg-liquidity-sweep.params.js';

const dataDir = path.join(process.cwd(), 'data');

// Configuration
const ASSET = process.env.ASSET || 'frxEURUSD';
const DAYS = parseInt(process.env.DAYS || '7');
const INITIAL_BALANCE = 1000;
const STAKE_PCT = 0.02;
const MULTIPLIER = 100;

interface ConfigResult {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pf: number;
  netPnl: number;
  maxDD: number;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FVG LIQUIDITY SWEEP - MTF COMPARISON                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Asset: ${ASSET}`);
  console.log(`Period: ${DAYS} days`);
  console.log('');

  // Find data file
  const files = fs.readdirSync(dataDir);
  const dataFile = files.find(f => f.includes(ASSET) && f.includes('1m'));

  if (!dataFile) {
    console.log(`❌ No data file found for ${ASSET}`);
    return;
  }

  const filepath = path.join(dataDir, dataFile);
  console.log(`📂 Loading: ${dataFile}`);

  let candles = loadCandlesFromCSV(filepath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Total candles: ${candles.length}`);

  // Filter to last N days
  const candlesPerDay = 24 * 60;
  const maxCandles = DAYS * candlesPerDay;
  if (candles.length > maxCandles) {
    candles = candles.slice(-maxCandles);
  }
  console.log(`   Using last ${DAYS} days: ${candles.length} candles`);
  console.log('');

  // Get base params for asset
  const baseParams = getParamsForAsset(ASSET);

  // Define test configurations
  const configs: { name: string; params: Partial<FVGLiquiditySweepParams> }[] = [
    {
      name: 'Single TF (baseline)',
      params: { mtfEnabled: false },
    },
    {
      name: 'MTF 5m swings only',
      params: {
        mtfEnabled: true,
        htfMultiplier: 5,
        htfSwingsEnabled: true,
        htfFVGEnabled: false,
        htfTrendFilterEnabled: false,
      },
    },
    {
      name: 'MTF 5m + trend filter',
      params: {
        mtfEnabled: true,
        htfMultiplier: 5,
        htfSwingsEnabled: true,
        htfFVGEnabled: false,
        htfTrendFilterEnabled: true,
        htfEmaPeriod: 20,
      },
    },
    {
      name: 'MTF 15m swings only',
      params: {
        mtfEnabled: true,
        htfMultiplier: 15,
        htfSwingsEnabled: true,
        htfFVGEnabled: false,
        htfTrendFilterEnabled: false,
      },
    },
    {
      name: 'MTF 15m + trend filter',
      params: {
        mtfEnabled: true,
        htfMultiplier: 15,
        htfSwingsEnabled: true,
        htfFVGEnabled: false,
        htfTrendFilterEnabled: true,
        htfEmaPeriod: 20,
      },
    },
    {
      name: 'MTF 30m swings only',
      params: {
        mtfEnabled: true,
        htfMultiplier: 30,
        htfSwingsEnabled: true,
        htfFVGEnabled: false,
        htfTrendFilterEnabled: false,
      },
    },
    {
      name: 'MTF 5m + EMA50 trend',
      params: {
        mtfEnabled: true,
        htfMultiplier: 5,
        htfSwingsEnabled: true,
        htfFVGEnabled: false,
        htfTrendFilterEnabled: true,
        htfEmaPeriod: 50,
      },
    },
  ];

  console.log('════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('════════════════════════════════════════════════════════════');
  console.log('');

  const results: ConfigResult[] = [];

  for (const config of configs) {
    process.stdout.write(`Testing: ${config.name.padEnd(25)} `);

    // Create strategy with merged params
    const mergedParams = { ...baseParams, ...config.params };
    const strategy = new FVGLiquiditySweepBacktestStrategy(ASSET, mergedParams);

    // Run full backtest
    const result = runBacktest(strategy, candles, {
      asset: ASSET,
      timeframe: 60,
      initialBalance: INITIAL_BALANCE,
      stakeMode: 'percentage',
      stakePct: STAKE_PCT,
      stakeAmount: INITIAL_BALANCE * STAKE_PCT,
      multiplier: MULTIPLIER,
    }, {
      runMonteCarlo: false,
      runOOS: false,
      verbose: false,
    });

    const configResult: ConfigResult = {
      name: config.name,
      trades: result.metrics.totalTrades,
      wins: result.metrics.wins,
      losses: result.metrics.losses,
      winRate: result.metrics.winRate,
      pf: result.metrics.profitFactor,
      netPnl: result.metrics.netPnl,
      maxDD: result.metrics.maxDrawdownPct,
    };
    results.push(configResult);

    const marker = configResult.pf >= 1.5 ? '✅' : configResult.pf >= 1.0 ? '⚠️' : '❌';
    console.log(
      `${marker} | Trades: ${configResult.trades.toString().padStart(4)} | ` +
      `WR: ${configResult.winRate.toFixed(1).padStart(5)}% | ` +
      `PF: ${configResult.pf.toFixed(2).padStart(5)} | ` +
      `Net: $${configResult.netPnl.toFixed(0).padStart(6)} | ` +
      `DD: ${configResult.maxDD.toFixed(1)}%`
    );
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('════════════════════════════════════════════════════════════');

  // Sort by PF
  results.sort((a, b) => b.pf - a.pf);

  console.log('');
  console.log('Best configurations by Profit Factor:');
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i]!;
    console.log(`  ${i + 1}. ${r.name}: PF ${r.pf.toFixed(2)}, WR ${r.winRate.toFixed(1)}%, ${r.trades} trades, $${r.netPnl.toFixed(0)}`);
  }

  // Compare baseline vs best MTF
  const baseline = results.find(r => r.name.includes('baseline'));
  const bestMTF = results.find(r => r.name.includes('MTF') && r.pf >= 1.0);

  if (baseline && bestMTF) {
    console.log('');
    console.log('MTF vs Baseline:');
    const pfImprovement = ((bestMTF.pf - baseline.pf) / baseline.pf * 100).toFixed(1);
    console.log(`  PF: ${baseline.pf.toFixed(2)} → ${bestMTF.pf.toFixed(2)} (${pfImprovement}%)`);
    console.log(`  Trades: ${baseline.trades} → ${bestMTF.trades}`);
    console.log(`  Win Rate: ${baseline.winRate.toFixed(1)}% → ${bestMTF.winRate.toFixed(1)}%`);
  }

  console.log('');
  console.log('✅ Comparison complete!');
}

main().catch(console.error);
