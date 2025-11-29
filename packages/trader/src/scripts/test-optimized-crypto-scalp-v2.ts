#!/usr/bin/env npx tsx
/**
 * Test Optimized CryptoScalp v2 - Best Configurations per Asset
 *
 * Aplica las mejores optimizaciones encontradas para cada asset:
 * - ETH: MTF Filter + Smart Zombie (reversing only)
 * - BTC: MTF Filter + Zombie Killer (0.1% threshold)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import type { CryptoScalpParams } from '../strategies/crypto-scalp/crypto-scalp.types.js';
import { HIGH_PF_PRESET, CONSERVATIVE_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

interface TestResult {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  pf: number;
  maxDD: number;
  winRate: number;
  expectancy: number;
  riskRewardRatio: number;
  score: number;
  avgWin: number;
  avgLoss: number;
  avgPnl: number;
}

// Load CSV fast
function loadCandles(filepath: string): Candle[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts.length > 5 ? parseFloat(parts[5]!) : undefined,
      });
    }
  }

  return candles;
}

async function main() {
  console.log('='.repeat(80));
  console.log('  OPTIMIZED CRYPTOSCALP V2 - FINAL RESULTS');
  console.log('='.repeat(80));

  const assets = [
    { name: 'cryETHUSD', preset: HIGH_PF_PRESET, presetName: 'High PF' },
    { name: 'cryBTCUSD', preset: CONSERVATIVE_PRESET, presetName: 'Conservative' },
  ];

  const allResults: Array<{ asset: string; results: TestResult[] }> = [];

  for (const { name: asset, preset, presetName } of assets) {
    const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);

    if (!fs.existsSync(filepath)) {
      console.log(`\nSkipping ${asset} - data not found`);
      continue;
    }

    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`${asset} - ${presetName}`);
    console.log('='.repeat(80));

    // Load data once
    console.log('Loading candles...');
    const candles = loadCandles(filepath);
    console.log(`Loaded ${candles.length.toLocaleString()} candles`);

    // Create FastBacktester
    console.log('Pre-calculating indicators...');
    const backtester = new FastBacktester(candles, ['rsi', 'atr', 'adx', 'bb'], {
      rsiPeriod: 14,
      atrPeriod: 14,
      adxPeriod: 14,
      bbPeriod: 20,
      bbStdDev: 2,
    });
    console.log('Indicators ready!');

    const baseConfig = {
      tpPct: preset.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
      slPct: preset.baseStopLossPct ?? 0.2,
      cooldown: preset.cooldownBars ?? 20,
      maxBarsInTrade: preset.maxBarsInTrade ?? 60,
      initialBalance: INITIAL_CAPITAL,
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      startIndex: 50,
    };

    const results: TestResult[] = [];

    // 1. BASE (sin optimizaciones, sin MTF)
    console.log('\n1. Testing BASE (no optimizations)...');
    const entryFnBase = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: false });
    const resultBase = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
    });
    const scoreBase = resultBase.profitFactor > 1
      ? (resultBase.profitFactor - 1) * Math.sqrt(resultBase.trades) * (1 - resultBase.maxDrawdownPct / 100)
      : -Math.abs(resultBase.netPnl);
    
    results.push({
      name: 'BASE (Original)',
      trades: resultBase.trades,
      wins: resultBase.wins,
      losses: resultBase.losses,
      netPnl: resultBase.netPnl,
      pf: resultBase.profitFactor,
      maxDD: resultBase.maxDrawdownPct,
      winRate: resultBase.winRate,
      expectancy: resultBase.expectancy,
      riskRewardRatio: resultBase.riskRewardRatio,
      score: scoreBase,
      avgWin: resultBase.avgWin,
      avgLoss: resultBase.avgLoss,
      avgPnl: resultBase.avgPnl,
    });

    // 2. BASE con MTF (mejora base)
    console.log('2. Testing BASE + MTF Filter...');
    const entryFnMTF = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: true });
    const resultMTF = backtester.run({
      ...baseConfig,
      entryFn: entryFnMTF,
    });
    const scoreMTF = resultMTF.profitFactor > 1
      ? (resultMTF.profitFactor - 1) * Math.sqrt(resultMTF.trades) * (1 - resultMTF.maxDrawdownPct / 100)
      : -Math.abs(resultMTF.netPnl);
    
    results.push({
      name: 'BASE + MTF Filter',
      trades: resultMTF.trades,
      wins: resultMTF.wins,
      losses: resultMTF.losses,
      netPnl: resultMTF.netPnl,
      pf: resultMTF.profitFactor,
      maxDD: resultMTF.maxDrawdownPct,
      winRate: resultMTF.winRate,
      expectancy: resultMTF.expectancy,
      riskRewardRatio: resultMTF.riskRewardRatio,
      score: scoreMTF,
      avgWin: resultMTF.avgWin,
      avgLoss: resultMTF.avgLoss,
      avgPnl: resultMTF.avgPnl,
    });

    // 3. OPTIMIZED (mejor combinación por asset)
    let optimizedConfig: any;
    let optimizedName: string;
    
    if (asset.includes('ETH')) {
      // ETH: MTF + Smart Zombie
      console.log('3. Testing OPTIMIZED (MTF + Smart Zombie)...');
      optimizedName = 'OPTIMIZED (MTF + Smart Zombie)';
      optimizedConfig = {
        ...baseConfig,
        entryFn: entryFnMTF,
        zombieKiller: {
          enabled: true,
          bars: 15,
          minPnlPct: 0.05,
          onlyIfReversing: true,
        },
      };
    } else {
      // BTC: MTF + Zombie Killer (0.1%)
      console.log('3. Testing OPTIMIZED (MTF + Zombie 0.1%)...');
      optimizedName = 'OPTIMIZED (MTF + Zombie 0.1%)';
      optimizedConfig = {
        ...baseConfig,
        entryFn: entryFnMTF,
        zombieKiller: {
          enabled: true,
          bars: 15,
          minPnlPct: 0.1,
        },
      };
    }

    const resultOptimized = backtester.run(optimizedConfig);
    const scoreOptimized = resultOptimized.profitFactor > 1
      ? (resultOptimized.profitFactor - 1) * Math.sqrt(resultOptimized.trades) * (1 - resultOptimized.maxDrawdownPct / 100)
      : -Math.abs(resultOptimized.netPnl);
    
    results.push({
      name: optimizedName,
      trades: resultOptimized.trades,
      wins: resultOptimized.wins,
      losses: resultOptimized.losses,
      netPnl: resultOptimized.netPnl,
      pf: resultOptimized.profitFactor,
      maxDD: resultOptimized.maxDrawdownPct,
      winRate: resultOptimized.winRate,
      expectancy: resultOptimized.expectancy,
      riskRewardRatio: resultOptimized.riskRewardRatio,
      score: scoreOptimized,
      avgWin: resultOptimized.avgWin,
      avgLoss: resultOptimized.avgLoss,
      avgPnl: resultOptimized.avgPnl,
    });

    allResults.push({ asset, results });

    // Print comparison
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS COMPARISON');
    console.log('='.repeat(80));
    console.log('Config'.padEnd(35) + '| Trades | W/L   | Net$  | PF   | DD%  | WR%  | R:R  | Score');
    console.log('-'.repeat(80));

    const baseResult = results[0]!;

    for (const r of results) {
      const marker = r.score > baseResult.score ? ' ✅' : '';
      
      console.log(
        r.name.padEnd(35) + '| ' +
        String(r.trades).padStart(6) + ' | ' +
        `${r.wins}/${r.losses}`.padStart(5) + ' | ' +
        ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
        r.pf.toFixed(2).padStart(4) + ' | ' +
        r.maxDD.toFixed(1).padStart(4) + '% | ' +
        r.winRate.toFixed(0).padStart(4) + '% | ' +
        r.riskRewardRatio.toFixed(2).padStart(4) + ' | ' +
        r.score.toFixed(1).padStart(5) + marker
      );
    }

    // Detailed comparison
    const optimized = results[results.length - 1]!;
    const base = results[0]!;
    const withMTF = results[1]!;

    console.log('\n' + '='.repeat(80));
    console.log('IMPROVEMENT BREAKDOWN');
    console.log('='.repeat(80));
    console.log(`\n📊 BASE → OPTIMIZED:`);
    console.log(`   Net PnL: $${base.netPnl.toFixed(0)} → $${optimized.netPnl.toFixed(0)} (${((optimized.netPnl - base.netPnl) / Math.abs(base.netPnl) * 100).toFixed(0)}% improvement)`);
    console.log(`   Profit Factor: ${base.pf.toFixed(2)} → ${optimized.pf.toFixed(2)} (${((optimized.pf - base.pf) / base.pf * 100).toFixed(0)}% improvement)`);
    console.log(`   Win Rate: ${base.winRate.toFixed(1)}% → ${optimized.winRate.toFixed(1)}% (+${(optimized.winRate - base.winRate).toFixed(1)}%)`);
    console.log(`   Max Drawdown: ${base.maxDD.toFixed(1)}% → ${optimized.maxDD.toFixed(1)}% (${((base.maxDD - optimized.maxDD) / base.maxDD * 100).toFixed(0)}% reduction)`);
    console.log(`   Trades: ${base.trades} → ${optimized.trades} (${((optimized.trades - base.trades) / base.trades * 100).toFixed(0)}% change)`);
    console.log(`   Score: ${base.score.toFixed(1)} → ${optimized.score.toFixed(1)} (+${(optimized.score - base.score).toFixed(1)})`);

    console.log(`\n📈 MTF Filter Contribution:`);
    console.log(`   Net PnL: $${base.netPnl.toFixed(0)} → $${withMTF.netPnl.toFixed(0)} (+$${(withMTF.netPnl - base.netPnl).toFixed(0)})`);
    console.log(`   Profit Factor: ${base.pf.toFixed(2)} → ${withMTF.pf.toFixed(2)} (+${(withMTF.pf - base.pf).toFixed(2)})`);

    console.log(`\n⚡ Optimization Contribution:`);
    console.log(`   Net PnL: $${withMTF.netPnl.toFixed(0)} → $${optimized.netPnl.toFixed(0)} (+$${(optimized.netPnl - withMTF.netPnl).toFixed(0)})`);
    console.log(`   Profit Factor: ${withMTF.pf.toFixed(2)} → ${optimized.pf.toFixed(2)} (+${(optimized.pf - withMTF.pf).toFixed(2)})`);
    console.log(`   Win Rate: ${withMTF.winRate.toFixed(1)}% → ${optimized.winRate.toFixed(1)}% (+${(optimized.winRate - withMTF.winRate).toFixed(1)}%)`);

    // Trade analysis
    console.log(`\n💰 TRADE ANALYSIS:`);
    console.log(`   Avg Win: $${optimized.avgWin.toFixed(2)}`);
    console.log(`   Avg Loss: $${Math.abs(optimized.avgLoss).toFixed(2)}`);
    console.log(`   Avg PnL per trade: $${optimized.avgPnl.toFixed(2)}`);
    console.log(`   Risk:Reward Ratio: ${optimized.riskRewardRatio.toFixed(2)}:1`);
    console.log(`   Expectancy: ${optimized.expectancy.toFixed(3)} (profit per $1 risked)`);
  }

  // Summary across all assets
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY ACROSS ALL ASSETS');
  console.log('='.repeat(80));

  for (const { asset, results } of allResults) {
    const base = results[0]!;
    const optimized = results[results.length - 1]!;
    
    console.log(`\n${asset}:`);
    console.log(`  BASE: $${base.netPnl.toFixed(0)}, PF ${base.pf.toFixed(2)}, WR ${base.winRate.toFixed(0)}%`);
    console.log(`  OPTIMIZED: $${optimized.netPnl.toFixed(0)}, PF ${optimized.pf.toFixed(2)}, WR ${optimized.winRate.toFixed(0)}%`);
    console.log(`  Improvement: +$${(optimized.netPnl - base.netPnl).toFixed(0)} (${((optimized.netPnl - base.netPnl) / Math.abs(base.netPnl) * 100).toFixed(0)}%)`);
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('Done!');
  console.log('='.repeat(80));
}

main().catch(console.error);

