#!/usr/bin/env npx tsx
/**
 * Strategy Matrix Backtest
 *
 * Runs all available strategies against all available assets
 * and generates a comparison matrix.
 *
 * Usage:
 *   npx tsx src/scripts/strategy-matrix-backtest.ts
 *
 * Environment:
 *   DAYS=90              # Number of days to backtest (default: 90)
 *   VERBOSE=true         # Show detailed output
 */

import * as path from 'path';
import * as fs from 'fs';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import type { BacktestableStrategy } from '../backtest/types.js';

// Import all backtest strategies
import { BBSqueezeBacktestStrategy } from '../backtest/strategies/bb-squeeze-backtest.strategy.js';
import { BBSqueezeMRBacktestStrategy } from '../backtest/strategies/bb-squeeze-mr-backtest.strategy.js';
import { KeltnerMRBacktestStrategy } from '../backtest/strategies/keltner-mr-backtest.strategy.js';
import { HybridMTFBacktestStrategy } from '../backtest/strategies/hybrid-mtf-backtest.strategy.js';
import { FVGLiquiditySweepBacktestStrategy } from '../backtest/strategies/fvg-liquidity-sweep-backtest.strategy.js';
import { CryptoScalpBacktestStrategy } from '../backtest/strategies/crypto-scalp-backtest.strategy.js';
import { PullbackWindowBacktestStrategy } from '../backtest/strategies/pullback-window-backtest.strategy.js';

// Configuration
const DAYS = parseInt(process.env.DAYS || '90', 10);
const VERBOSE = process.env.VERBOSE === 'true';
const INITIAL_BALANCE = 1000;

// Asset categories
const ASSETS = {
  synthetic: ['R_100', 'R_75', 'R_50'],
  forex: ['frxEURUSD', 'frxGBPUSD', 'frxAUDUSD'],
  crypto: ['cryETHUSD', 'cryBTCUSD'],
  indices: ['OTC_GDAXI'],
};

// Strategy definitions
interface StrategyDef {
  name: string;
  shortName: string;
  create: (asset: string) => BacktestableStrategy;
  compatibleWith: string[]; // Asset categories
}

const STRATEGIES: StrategyDef[] = [
  {
    name: 'BB-Squeeze',
    shortName: 'BBS',
    create: (asset) => new BBSqueezeBacktestStrategy(asset),
    compatibleWith: ['synthetic', 'forex', 'crypto', 'indices'],
  },
  {
    name: 'BB-Squeeze-MR',
    shortName: 'BSMR',
    create: (asset) => new BBSqueezeMRBacktestStrategy(asset),
    compatibleWith: ['synthetic', 'forex', 'crypto', 'indices'],
  },
  // Keltner-MR and Hybrid-MTF are very slow, skip for fast runs
  // Use INCLUDE_SLOW=true to include them
  ...(process.env.INCLUDE_SLOW === 'true' ? [
    {
      name: 'Keltner-MR',
      shortName: 'KMR',
      create: (asset: string) => new KeltnerMRBacktestStrategy(asset),
      compatibleWith: ['synthetic', 'forex', 'crypto', 'indices'],
    },
    {
      name: 'Hybrid-MTF',
      shortName: 'MTF',
      create: (asset: string) => new HybridMTFBacktestStrategy(asset),
      compatibleWith: ['synthetic', 'forex', 'crypto', 'indices'],
    },
  ] : []),
  {
    name: 'FVG-Liquidity-Sweep',
    shortName: 'FVGLS',
    create: (asset) => new FVGLiquiditySweepBacktestStrategy(asset),
    compatibleWith: ['synthetic', 'forex', 'crypto', 'indices'],
  },
  {
    name: 'Crypto-Scalp-V2',
    shortName: 'CS2',
    create: (asset) => new CryptoScalpBacktestStrategy(asset),
    compatibleWith: ['crypto'],
  },
  {
    name: 'Pullback-Window',
    shortName: 'PBW',
    create: (asset) => new PullbackWindowBacktestStrategy(asset),
    compatibleWith: ['synthetic', 'forex', 'crypto', 'indices'],
  },
];

// Results storage
interface BacktestResult {
  asset: string;
  strategy: string;
  trades: number;
  winRate: number;
  profitFactor: number;
  netPnl: number;
  maxDD: number;
  sharpe: number;
  score: number; // Combined ranking score
}

const results: BacktestResult[] = [];

// Helper to find data file
function findDataFile(asset: string): string | null {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) return null;

  const files = fs.readdirSync(dataDir);

  // Prefer 90d or 180d 1m data
  const preferred = files.find(f =>
    f.includes(asset) &&
    f.includes('1m') &&
    (f.includes('90d') || f.includes('180d'))
  );

  if (preferred) return path.join(dataDir, preferred);

  // Fallback to any 1m data
  const fallback = files.find(f => f.includes(asset) && f.includes('1m'));
  if (fallback) return path.join(dataDir, fallback);

  return null;
}

// Calculate combined score
function calculateScore(result: Omit<BacktestResult, 'score'>): number {
  // Weighted scoring:
  // - Profit Factor (30%): Higher is better, cap at 3
  // - Win Rate (20%): Higher is better
  // - Sharpe (20%): Higher is better, cap at 2
  // - Max DD (20%): Lower is better (inverted)
  // - Trade count (10%): More trades = more reliable

  const pfScore = Math.min(result.profitFactor, 3) / 3 * 30;
  const wrScore = result.winRate / 100 * 20;
  const sharpeScore = Math.min(Math.max(result.sharpe, 0), 2) / 2 * 20;
  const ddScore = Math.max(0, (20 - result.maxDD)) / 20 * 20; // 0% DD = 20, 20%+ DD = 0
  const tradeScore = Math.min(result.trades / 100, 1) * 10;

  return pfScore + wrScore + sharpeScore + ddScore + tradeScore;
}

// Run backtest for strategy + asset
async function runStrategyBacktest(
  strategy: StrategyDef,
  asset: string,
  dataFile: string
): Promise<BacktestResult | null> {
  try {
    let candles = loadCandlesFromCSV(dataFile, {
      asset,
      timeframe: 60,
      timestampColumn: 'timestamp',
      openColumn: 'open',
      highColumn: 'high',
      lowColumn: 'low',
      closeColumn: 'close',
      timestampFormat: 'unix_ms',
    });

    // Filter to last N days
    const candlesPerDay = 24 * 60;
    const maxCandles = DAYS * candlesPerDay;
    if (candles.length > maxCandles) {
      candles = candles.slice(-maxCandles);
    }

    if (candles.length < 1000) {
      if (VERBOSE) console.log(`    ⚠️ Not enough data for ${asset}`);
      return null;
    }

    const strategyInstance = strategy.create(asset);
    const result = runBacktest(strategyInstance, candles, {
      asset,
      timeframe: 60,
      initialBalance: INITIAL_BALANCE,
      stakeMode: 'percentage',
      stakePct: 0.02,
      stakeAmount: 20,
      multiplier: 100,
    }, { runMonteCarlo: false, runOOS: false, verbose: false });

    const { totalTrades, winRate, profitFactor, netPnl, maxDrawdownPct, sharpeRatio } = result.metrics;

    const baseResult = {
      asset,
      strategy: strategy.shortName,
      trades: totalTrades,
      winRate,
      profitFactor: profitFactor === Infinity ? 10 : (profitFactor || 0),
      netPnl: netPnl || 0,
      maxDD: maxDrawdownPct || 0,
      sharpe: sharpeRatio || 0,
    };

    return {
      ...baseResult,
      score: calculateScore(baseResult),
    };
  } catch (error) {
    if (VERBOSE) console.log(`    ❌ Error: ${error}`);
    return null;
  }
}

// Main
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     STRATEGY MATRIX BACKTEST                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Configuration: ${DAYS} days, $${INITIAL_BALANCE} initial balance, 2% risk per trade`);
  console.log();

  // Collect all assets to test
  const allAssets = [
    ...ASSETS.synthetic,
    ...ASSETS.forex,
    ...ASSETS.crypto,
    ...ASSETS.indices,
  ];

  // Run backtests
  for (const strategy of STRATEGIES) {
    console.log(`\n📊 Testing ${strategy.name}...`);

    for (const [category, assets] of Object.entries(ASSETS)) {
      if (!strategy.compatibleWith.includes(category)) continue;

      for (const asset of assets) {
        const dataFile = findDataFile(asset);
        if (!dataFile) {
          if (VERBOSE) console.log(`  ⚠️ No data for ${asset}`);
          continue;
        }

        process.stdout.write(`  ${asset}... `);
        const result = await runStrategyBacktest(strategy, asset, dataFile);

        if (result) {
          results.push(result);
          const pfStr = result.profitFactor >= 10 ? '∞' : result.profitFactor.toFixed(2);
          console.log(`✅ ${result.trades} trades, WR: ${result.winRate.toFixed(1)}%, PF: ${pfStr}, Score: ${result.score.toFixed(1)}`);
        } else {
          console.log('⚠️ skipped');
        }
      }
    }
  }

  // Generate matrix report
  console.log('\n\n' + '═'.repeat(90));
  console.log('                              RESULTS MATRIX');
  console.log('═'.repeat(90));

  // Header row
  const strategyNames = [...new Set(results.map(r => r.strategy))];
  const assetNames = [...new Set(results.map(r => r.asset))];

  // Print header
  console.log('\n' + 'Asset'.padEnd(12) + '│' + strategyNames.map(s => s.padStart(10)).join('│'));
  console.log('─'.repeat(12) + '┼' + strategyNames.map(() => '─'.repeat(10)).join('┼'));

  // Print matrix (using Score)
  for (const asset of assetNames) {
    const row = [asset.padEnd(12)];
    for (const strategy of strategyNames) {
      const result = results.find(r => r.asset === asset && r.strategy === strategy);
      if (result) {
        row.push(result.score.toFixed(1).padStart(10));
      } else {
        row.push('-'.padStart(10));
      }
    }
    console.log(row.join('│'));
  }

  // Best combinations
  console.log('\n\n' + '═'.repeat(90));
  console.log('                        TOP 10 STRATEGY-ASSET COMBINATIONS');
  console.log('═'.repeat(90));

  const sorted = [...results].sort((a, b) => b.score - a.score);
  console.log('\nRank │ Strategy   │ Asset       │ Trades │ WinRate │   PF   │ Net P&L │ Max DD │ Score');
  console.log('─────┼────────────┼─────────────┼────────┼─────────┼────────┼─────────┼────────┼──────');

  sorted.slice(0, 10).forEach((r, i) => {
    const pfStr = r.profitFactor >= 10 ? '  Inf' : r.profitFactor.toFixed(2).padStart(5);
    console.log(
      `${(i + 1).toString().padStart(4)} │ ${r.strategy.padEnd(10)} │ ${r.asset.padEnd(11)} │ ` +
      `${r.trades.toString().padStart(6)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${pfStr}  │ ` +
      `$${r.netPnl.toFixed(0).padStart(6)} │ ${r.maxDD.toFixed(1).padStart(5)}% │ ${r.score.toFixed(1).padStart(5)}`
    );
  });

  // Best by category
  console.log('\n\n' + '═'.repeat(90));
  console.log('                          BEST BY ASSET CATEGORY');
  console.log('═'.repeat(90));

  for (const [category, assets] of Object.entries(ASSETS)) {
    const categoryResults = results.filter(r => assets.includes(r.asset));
    if (categoryResults.length === 0) continue;

    const best = categoryResults.sort((a, b) => b.score - a.score)[0];
    console.log(`\n${category.toUpperCase()}:`);
    console.log(`  Best: ${best.strategy} on ${best.asset}`);
    console.log(`    Score: ${best.score.toFixed(1)}, WR: ${best.winRate.toFixed(1)}%, PF: ${best.profitFactor.toFixed(2)}, Net: $${best.netPnl.toFixed(0)}`);
  }

  // Best strategy overall (by average score)
  console.log('\n\n' + '═'.repeat(90));
  console.log('                        STRATEGY RANKING (Avg Score)');
  console.log('═'.repeat(90));

  const strategyAvg = strategyNames.map(s => {
    const stratResults = results.filter(r => r.strategy === s);
    const avgScore = stratResults.reduce((sum, r) => sum + r.score, 0) / stratResults.length;
    const avgPF = stratResults.reduce((sum, r) => sum + r.profitFactor, 0) / stratResults.length;
    const avgWR = stratResults.reduce((sum, r) => sum + r.winRate, 0) / stratResults.length;
    return { strategy: s, avgScore, avgPF, avgWR, count: stratResults.length };
  }).sort((a, b) => b.avgScore - a.avgScore);

  console.log('\nRank │ Strategy   │ Avg Score │ Avg WR   │ Avg PF  │ Assets Tested');
  console.log('─────┼────────────┼───────────┼──────────┼─────────┼──────────────');

  strategyAvg.forEach((s, i) => {
    console.log(
      `${(i + 1).toString().padStart(4)} │ ${s.strategy.padEnd(10)} │ ` +
      `${s.avgScore.toFixed(1).padStart(9)} │ ${s.avgWR.toFixed(1).padStart(7)}% │ ` +
      `${s.avgPF.toFixed(2).padStart(7)} │ ${s.count.toString().padStart(13)}`
    );
  });

  // Summary
  console.log('\n\n' + '═'.repeat(90));
  console.log('                              SUMMARY');
  console.log('═'.repeat(90));
  console.log(`\nTotal backtests run: ${results.length}`);
  console.log(`Strategies tested: ${strategyNames.length}`);
  console.log(`Assets tested: ${assetNames.length}`);

  const profitable = results.filter(r => r.profitFactor > 1);
  console.log(`\nProfitable combinations (PF > 1): ${profitable.length}/${results.length} (${(profitable.length/results.length*100).toFixed(0)}%)`);

  const highScore = results.filter(r => r.score > 50);
  console.log(`High score combinations (Score > 50): ${highScore.length}`);

  console.log('\n✅ Matrix backtest complete!');
}

main().catch(console.error);
