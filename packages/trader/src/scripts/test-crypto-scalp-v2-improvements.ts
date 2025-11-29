#!/usr/bin/env npx tsx
/**
 * Test CryptoScalp v2 Improvements
 *
 * Prueba cada optimización individualmente para ver cuáles realmente mejoran
 * los resultados sin sacrificar volumen de trades.
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
  score: number;
  config: any;
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
  console.log('  TESTING CRYPTOSCALP V2 IMPROVEMENTS');
  console.log('='.repeat(80));

  const assets = ['cryETHUSD', 'cryBTCUSD'];

  for (const asset of assets) {
    const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);

    if (!fs.existsSync(filepath)) {
      console.log(`\nSkipping ${asset} - data not found`);
      continue;
    }

    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`${asset}`);
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

    // Select preset based on asset
    const preset = asset.includes('ETH') ? HIGH_PF_PRESET : CONSERVATIVE_PRESET;
    const presetName = asset.includes('ETH') ? 'High PF' : 'Conservative';

    // Base configuration
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

    // 1. BASE (sin optimizaciones)
    console.log('\n1. Testing BASE configuration...');
    const entryFnBase = createCryptoScalpV2EntryFn(candles, preset);
    const resultBase = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
    });
    const scoreBase = resultBase.profitFactor > 1
      ? (resultBase.profitFactor - 1) * Math.sqrt(resultBase.trades) * (1 - resultBase.maxDrawdownPct / 100)
      : -Math.abs(resultBase.netPnl);
    
    results.push({
      name: `BASE (${presetName})`,
      trades: resultBase.trades,
      wins: resultBase.wins,
      losses: resultBase.losses,
      netPnl: resultBase.netPnl,
      pf: resultBase.profitFactor,
      maxDD: resultBase.maxDrawdownPct,
      winRate: resultBase.winRate,
      expectancy: resultBase.expectancy,
      score: scoreBase,
      config: { ...baseConfig },
    });

    // 2. BB Middle Exit
    console.log('2. Testing BB Middle Exit...');
    const resultBBMiddle = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      exitOnBBMiddle: true,
    });
    const scoreBBMiddle = resultBBMiddle.profitFactor > 1
      ? (resultBBMiddle.profitFactor - 1) * Math.sqrt(resultBBMiddle.trades) * (1 - resultBBMiddle.maxDrawdownPct / 100)
      : -Math.abs(resultBBMiddle.netPnl);
    
    results.push({
      name: 'BB Middle Exit',
      trades: resultBBMiddle.trades,
      wins: resultBBMiddle.wins,
      losses: resultBBMiddle.losses,
      netPnl: resultBBMiddle.netPnl,
      pf: resultBBMiddle.profitFactor,
      maxDD: resultBBMiddle.maxDrawdownPct,
      winRate: resultBBMiddle.winRate,
      expectancy: resultBBMiddle.expectancy,
      score: scoreBBMiddle,
      config: { ...baseConfig, exitOnBBMiddle: true },
    });

    // 3. VWAP Exit (necesitamos agregar VWAP al cache primero, por ahora skip)
    // console.log('3. Testing VWAP Exit...');
    // const resultVWAP = backtester.run({
    //   ...baseConfig,
    //   entryFn: entryFnBase,
    //   exitOnVWAP: true,
    // });

    // 4. Zombie Killer
    console.log('3. Testing Zombie Killer (15 bars, 0.05% min)...');
    const resultZombie = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.05,
      },
    });
    const scoreZombie = resultZombie.profitFactor > 1
      ? (resultZombie.profitFactor - 1) * Math.sqrt(resultZombie.trades) * (1 - resultZombie.maxDrawdownPct / 100)
      : -Math.abs(resultZombie.netPnl);
    
    results.push({
      name: 'Zombie Killer (15b)',
      trades: resultZombie.trades,
      wins: resultZombie.wins,
      losses: resultZombie.losses,
      netPnl: resultZombie.netPnl,
      pf: resultZombie.profitFactor,
      maxDD: resultZombie.maxDrawdownPct,
      winRate: resultZombie.winRate,
      expectancy: resultZombie.expectancy,
      score: scoreZombie,
      config: { ...baseConfig, zombieKiller: { enabled: true, bars: 15, minPnlPct: 0.05 } },
    });

    // 5. BB Middle + Zombie Killer (combinado)
    console.log('4. Testing BB Middle + Zombie Killer...');
    const resultCombo = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      exitOnBBMiddle: true,
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.05,
      },
    });
    const scoreCombo = resultCombo.profitFactor > 1
      ? (resultCombo.profitFactor - 1) * Math.sqrt(resultCombo.trades) * (1 - resultCombo.maxDrawdownPct / 100)
      : -Math.abs(resultCombo.netPnl);
    
    results.push({
      name: 'BB Middle + Zombie',
      trades: resultCombo.trades,
      wins: resultCombo.wins,
      losses: resultCombo.losses,
      netPnl: resultCombo.netPnl,
      pf: resultCombo.profitFactor,
      maxDD: resultCombo.maxDrawdownPct,
      winRate: resultCombo.winRate,
      expectancy: resultCombo.expectancy,
      score: scoreCombo,
      config: { ...baseConfig, exitOnBBMiddle: true, zombieKiller: { enabled: true, bars: 15, minPnlPct: 0.05 } },
    });

    // 6. Zombie Killer más agresivo (10 bars)
    console.log('5. Testing Zombie Killer (10 bars, más agresivo)...');
    const resultZombie10 = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      zombieKiller: {
        enabled: true,
        bars: 10,
        minPnlPct: 0.05,
      },
    });
    const scoreZombie10 = resultZombie10.profitFactor > 1
      ? (resultZombie10.profitFactor - 1) * Math.sqrt(resultZombie10.trades) * (1 - resultZombie10.maxDrawdownPct / 100)
      : -Math.abs(resultZombie10.netPnl);
    
    results.push({
      name: 'Zombie Killer (10b)',
      trades: resultZombie10.trades,
      wins: resultZombie10.wins,
      losses: resultZombie10.losses,
      netPnl: resultZombie10.netPnl,
      pf: resultZombie10.profitFactor,
      maxDD: resultZombie10.maxDrawdownPct,
      winRate: resultZombie10.winRate,
      expectancy: resultZombie10.expectancy,
      score: scoreZombie10,
      config: { ...baseConfig, zombieKiller: { enabled: true, bars: 10, minPnlPct: 0.05 } },
    });

    // Print comparison
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS COMPARISON');
    console.log('='.repeat(80));
    console.log('Config'.padEnd(25) + '| Trades | W/L   | Net$  | PF   | DD%  | WR%  | Score | vs Base');
    console.log('-'.repeat(80));

    const baseResult = results[0]!;

    for (const r of results) {
      const vsBase = r.name === baseResult.name 
        ? 'BASE'
        : `${((r.winRate - baseResult.winRate) / baseResult.winRate * 100).toFixed(1)}% WR, ${((r.pf - baseResult.pf) / baseResult.pf * 100).toFixed(1)}% PF`;
      
      const marker = r.pf > baseResult.pf && r.winRate >= baseResult.winRate * 0.95 ? ' ✅' : 
                     r.pf > baseResult.pf ? ' +' : 
                     r.winRate > baseResult.winRate * 1.05 ? ' ⚠️' : '';
      
      console.log(
        r.name.padEnd(25) + '| ' +
        String(r.trades).padStart(6) + ' | ' +
        `${r.wins}/${r.losses}`.padStart(5) + ' | ' +
        ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
        r.pf.toFixed(2).padStart(4) + ' | ' +
        r.maxDD.toFixed(1).padStart(4) + '% | ' +
        r.winRate.toFixed(0).padStart(4) + '% | ' +
        r.score.toFixed(1).padStart(5) + ' | ' +
        vsBase.padEnd(20) + marker
      );
    }

    // Find best improvements
    console.log('\n' + '='.repeat(80));
    console.log('IMPROVEMENTS ANALYSIS');
    console.log('='.repeat(80));

    const improvements = results
      .filter(r => r.name !== baseResult.name)
      .map(r => ({
        name: r.name,
        wrDelta: r.winRate - baseResult.winRate,
        pfDelta: r.profitFactor - baseResult.profitFactor,
        pnlDelta: r.netPnl - baseResult.netPnl,
        tradesDelta: r.trades - baseResult.trades,
        tradesPct: ((r.trades - baseResult.trades) / baseResult.trades) * 100,
        score: r.score - baseResult.score,
      }))
      .sort((a, b) => b.score - a.score);

    console.log('\n📈 BEST IMPROVEMENTS (by Score):');
    for (const imp of improvements.slice(0, 3)) {
      const tradesChange = imp.tradesPct > 0 ? `+${imp.tradesPct.toFixed(1)}%` : `${imp.tradesPct.toFixed(1)}%`;
      const wrChange = imp.wrDelta > 0 ? `+${imp.wrDelta.toFixed(1)}%` : `${imp.wrDelta.toFixed(1)}%`;
      const pfChange = imp.pfDelta > 0 ? `+${imp.pfDelta.toFixed(3)}` : `${imp.pfDelta.toFixed(3)}`;
      const pnlChange = imp.pnlDelta > 0 ? `+$${imp.pnlDelta.toFixed(0)}` : `$${imp.pnlDelta.toFixed(0)}`;
      
      console.log(`\n  ${imp.name}:`);
      console.log(`    Score: ${imp.score > 0 ? '+' : ''}${imp.score.toFixed(1)}`);
      console.log(`    Win Rate: ${wrChange}`);
      console.log(`    Profit Factor: ${pfChange}`);
      console.log(`    Net PnL: ${pnlChange}`);
      console.log(`    Trades: ${tradesChange} (${imp.tradesDelta > 0 ? '+' : ''}${imp.tradesDelta})`);
    }

    // Summary
    const best = improvements[0];
    if (best && best.score > 0) {
      console.log(`\n🎯 RECOMMENDATION: Use "${best.name}"`);
      console.log(`   Improves score by ${best.score.toFixed(1)} points`);
      if (best.tradesPct > -5) {
        console.log(`   ✅ Maintains volume (only ${Math.abs(best.tradesPct).toFixed(1)}% change)`);
      } else {
        console.log(`   ⚠️  Reduces volume by ${Math.abs(best.tradesPct).toFixed(1)}%`);
      }
    } else {
      console.log(`\n⚠️  No significant improvements found. Base configuration is best.`);
    }
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('Done!');
  console.log('='.repeat(80));
}

main().catch(console.error);

