#!/usr/bin/env npx tsx
/**
 * FVG-LS Forex Parameter Optimization
 *
 * Grid search for optimal takeProfitRR and stopLossBufferPct parameters
 * on forex pairs (frxAUDUSD, frxEURUSD, frxGBPUSD, frxUSDCHF)
 *
 * Usage:
 *   npx tsx src/scripts/optimize-fvg-ls-forex.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
} from '../backtest/index.js';
import { FVGLiquiditySweepBacktestStrategy } from '../backtest/strategies/fvg-liquidity-sweep-backtest.strategy.js';
import type { FVGLiquiditySweepParams } from '../strategies/fvg-liquidity-sweep.types.js';

// Configuration
const ASSETS = ['frxAUDUSD', 'frxEURUSD', 'frxGBPUSD', 'frxUSDCHF'];
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 200;
const STAKE_PCT = 0.04;

// Grid search parameters
const TP_RR_VALUES = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5];
const SL_BUFFER_VALUES = [0.0008, 0.001, 0.0012, 0.0015];

interface OptimizationResult {
  asset: string;
  takeProfitRR: number;
  stopLossBufferPct: number;
  trades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
}

async function loadData(asset: string): Promise<any[] | null> {
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${asset}_1m_90d.csv`,
    `${asset}_60s_90d.csv`,
    `${asset}_1m_30d.csv`,
    `${asset}_60s_30d.csv`,
  ];

  for (const file of possibleFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      return loadCandlesFromCSV(fullPath, {
        asset,
        timeframe: 60,
        timestampColumn: 'timestamp',
        openColumn: 'open',
        highColumn: 'high',
        lowColumn: 'low',
        closeColumn: 'close',
        timestampFormat: 'unix_ms',
      });
    }
  }

  console.log(`❌ No data found for ${asset}`);
  return null;
}

async function runOptimization(
  asset: string,
  candles: any[],
  params: Partial<FVGLiquiditySweepParams>
): Promise<OptimizationResult | null> {
  try {
    const strategy = new FVGLiquiditySweepBacktestStrategy(asset, params);

    const result = runBacktest(strategy, candles, {
      asset,
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

    return {
      asset,
      takeProfitRR: params.takeProfitRR || 1.5,
      stopLossBufferPct: params.stopLossBufferPct || 0.001,
      trades: result.metrics.totalTrades,
      winRate: result.metrics.winRate,
      netPnl: result.metrics.netPnl,
      profitFactor: result.metrics.profitFactor,
      maxDrawdown: result.metrics.maxDrawdownPct * 100,
    };
  } catch (error: any) {
    console.error(`  Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('FVG-LS FOREX PARAMETER OPTIMIZATION');
  console.log('═'.repeat(80));
  console.log(`\nAssets: ${ASSETS.join(', ')}`);
  console.log(`Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`Multiplier: ${MULTIPLIER}x`);
  console.log(`Stake: ${STAKE_PCT * 100}%`);
  console.log(`\nTP R:R Values: ${TP_RR_VALUES.join(', ')}`);
  console.log(`SL Buffer Values: ${SL_BUFFER_VALUES.map(v => `${v * 100}%`).join(', ')}`);
  console.log(`\nTotal combinations per asset: ${TP_RR_VALUES.length * SL_BUFFER_VALUES.length}`);

  const allResults: OptimizationResult[] = [];
  const bestByAsset: Record<string, OptimizationResult> = {};

  for (const asset of ASSETS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`OPTIMIZING: ${asset}`);
    console.log('─'.repeat(80));

    const candles = await loadData(asset);
    if (!candles) continue;

    console.log(`Loaded ${candles.length.toLocaleString()} candles`);

    let bestResult: OptimizationResult | null = null;
    let bestPF = 0;

    for (const tpRR of TP_RR_VALUES) {
      for (const slBuffer of SL_BUFFER_VALUES) {
        process.stdout.write(`  Testing RR=${tpRR}, SL=${(slBuffer * 100).toFixed(2)}%... `);

        const result = await runOptimization(asset, candles, {
          takeProfitRR: tpRR,
          stopLossBufferPct: slBuffer,
        });

        if (result && result.trades > 10) {
          allResults.push(result);
          console.log(`PF=${result.profitFactor.toFixed(2)}, Trades=${result.trades}, WR=${result.winRate.toFixed(1)}%`);

          if (result.profitFactor > bestPF) {
            bestPF = result.profitFactor;
            bestResult = result;
          }
        } else {
          console.log('Not enough trades');
        }
      }
    }

    if (bestResult) {
      bestByAsset[asset] = bestResult;
      console.log(`\n  ✅ BEST for ${asset}: RR=${bestResult.takeProfitRR}, SL=${(bestResult.stopLossBufferPct * 100).toFixed(2)}%`);
      console.log(`     PF=${bestResult.profitFactor.toFixed(2)}, P&L=$${bestResult.netPnl.toFixed(2)}, WR=${bestResult.winRate.toFixed(1)}%`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('OPTIMIZATION SUMMARY');
  console.log('═'.repeat(80));

  console.log('\n📊 Best Parameters by Asset:\n');
  console.log('Asset       | TP R:R | SL Buffer | PF   | P&L     | WR    | Trades');
  console.log('─'.repeat(75));

  for (const asset of ASSETS) {
    const best = bestByAsset[asset];
    if (best) {
      console.log(
        `${asset.padEnd(11)} | ` +
        `${best.takeProfitRR.toFixed(1).padStart(6)} | ` +
        `${(best.stopLossBufferPct * 100).toFixed(2).padStart(8)}% | ` +
        `${best.profitFactor.toFixed(2).padStart(4)} | ` +
        `$${best.netPnl.toFixed(2).padStart(7)} | ` +
        `${best.winRate.toFixed(1).padStart(5)}% | ` +
        `${best.trades}`
      );
    }
  }

  // Find overall best parameters
  const avgByParams: Record<string, { totalPF: number; count: number; params: any }> = {};

  for (const result of allResults) {
    const key = `${result.takeProfitRR}-${result.stopLossBufferPct}`;
    if (!avgByParams[key]) {
      avgByParams[key] = {
        totalPF: 0,
        count: 0,
        params: { takeProfitRR: result.takeProfitRR, stopLossBufferPct: result.stopLossBufferPct },
      };
    }
    avgByParams[key].totalPF += result.profitFactor;
    avgByParams[key].count++;
  }

  let bestOverall = { key: '', avgPF: 0, params: {} as any };
  for (const [key, data] of Object.entries(avgByParams)) {
    const avgPF = data.totalPF / data.count;
    if (avgPF > bestOverall.avgPF) {
      bestOverall = { key, avgPF, params: data.params };
    }
  }

  console.log('\n🏆 Best Overall Parameters (avg across all assets):');
  console.log(`   takeProfitRR: ${bestOverall.params.takeProfitRR}`);
  console.log(`   stopLossBufferPct: ${bestOverall.params.stopLossBufferPct} (${(bestOverall.params.stopLossBufferPct * 100).toFixed(2)}%)`);
  console.log(`   Average PF: ${bestOverall.avgPF.toFixed(2)}`);

  // Generate code suggestion
  console.log('\n📝 Suggested Code Update for fvg-liquidity-sweep.params.ts:\n');
  console.log('```typescript');
  console.log('export const FOREX_PARAMS_OPTIMIZED: Partial<FVGLiquiditySweepParams> = {');
  console.log('  ...FOREX_PARAMS,');
  console.log(`  takeProfitRR: ${bestOverall.params.takeProfitRR},`);
  console.log(`  stopLossBufferPct: ${bestOverall.params.stopLossBufferPct},`);
  console.log('};');
  console.log('```');
}

main().catch(console.error);
