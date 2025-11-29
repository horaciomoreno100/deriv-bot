#!/usr/bin/env npx tsx
/**
 * Test Alternative Improvements - One by One
 *
 * Prueba estrategias alternativas una por una:
 * 1. BB Middle como trailing stop
 * 2. Take profit parcial (50% BB Middle, 50% TP)
 * 3. Zombie Killer más inteligente (solo si está yendo en contra)
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
  console.log('  TESTING ALTERNATIVE IMPROVEMENTS - ONE BY ONE');
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
    const entryFnBase = createCryptoScalpV2EntryFn(candles, preset);

    // 1. BASE
    console.log('\n1. Testing BASE...');
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
    });

    // 2. BB Middle as Trailing Stop
    console.log('2. Testing BB Middle as Trailing Stop...');
    const resultTrailing = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      bbMiddleTrailingStop: true,
    });
    const scoreTrailing = resultTrailing.profitFactor > 1
      ? (resultTrailing.profitFactor - 1) * Math.sqrt(resultTrailing.trades) * (1 - resultTrailing.maxDrawdownPct / 100)
      : -Math.abs(resultTrailing.netPnl);
    
    results.push({
      name: 'BB Middle Trailing Stop',
      trades: resultTrailing.trades,
      wins: resultTrailing.wins,
      losses: resultTrailing.losses,
      netPnl: resultTrailing.netPnl,
      pf: resultTrailing.profitFactor,
      maxDD: resultTrailing.maxDrawdownPct,
      winRate: resultTrailing.winRate,
      expectancy: resultTrailing.expectancy,
      score: scoreTrailing,
    });

    // 3. Partial TP (50% at BB Middle, 50% at TP)
    console.log('3. Testing Partial TP (50% BB Middle, 50% TP)...');
    const resultPartial = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      partialTP: {
        enabled: true,
        exitAtBBMiddle: true,
      },
    });
    const scorePartial = resultPartial.profitFactor > 1
      ? (resultPartial.profitFactor - 1) * Math.sqrt(resultPartial.trades) * (1 - resultPartial.maxDrawdownPct / 100)
      : -Math.abs(resultPartial.netPnl);
    
    results.push({
      name: 'Partial TP (50% BB Middle)',
      trades: resultPartial.trades,
      wins: resultPartial.wins,
      losses: resultPartial.losses,
      netPnl: resultPartial.netPnl,
      pf: resultPartial.profitFactor,
      maxDD: resultPartial.maxDrawdownPct,
      winRate: resultPartial.winRate,
      expectancy: resultPartial.expectancy,
      score: scorePartial,
    });

    // 4. Zombie Killer Inteligente (solo si está yendo en contra)
    console.log('4. Testing Smart Zombie Killer (only if reversing)...');
    const resultSmartZombie = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.05,
        onlyIfReversing: true, // Solo cerrar si está yendo en contra
      },
    });
    const scoreSmartZombie = resultSmartZombie.profitFactor > 1
      ? (resultSmartZombie.profitFactor - 1) * Math.sqrt(resultSmartZombie.trades) * (1 - resultSmartZombie.maxDrawdownPct / 100)
      : -Math.abs(resultSmartZombie.netPnl);
    
    results.push({
      name: 'Smart Zombie (reversing only)',
      trades: resultSmartZombie.trades,
      wins: resultSmartZombie.wins,
      losses: resultSmartZombie.losses,
      netPnl: resultSmartZombie.netPnl,
      pf: resultSmartZombie.profitFactor,
      maxDD: resultSmartZombie.maxDrawdownPct,
      winRate: resultSmartZombie.winRate,
      expectancy: resultSmartZombie.expectancy,
      score: scoreSmartZombie,
    });

    // 5. Zombie Killer con threshold más alto
    console.log('5. Testing Zombie Killer (higher threshold 0.1%)...');
    const resultZombieHigh = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.1, // Threshold más alto
      },
    });
    const scoreZombieHigh = resultZombieHigh.profitFactor > 1
      ? (resultZombieHigh.profitFactor - 1) * Math.sqrt(resultZombieHigh.trades) * (1 - resultZombieHigh.maxDrawdownPct / 100)
      : -Math.abs(resultZombieHigh.netPnl);
    
    results.push({
      name: 'Zombie Killer (0.1% threshold)',
      trades: resultZombieHigh.trades,
      wins: resultZombieHigh.wins,
      losses: resultZombieHigh.losses,
      netPnl: resultZombieHigh.netPnl,
      pf: resultZombieHigh.profitFactor,
      maxDD: resultZombieHigh.maxDrawdownPct,
      winRate: resultZombieHigh.winRate,
      expectancy: resultZombieHigh.expectancy,
      score: scoreZombieHigh,
    });

    // 6. BASE sin MTF (para comparar)
    console.log('6. Testing BASE without MTF Filter...');
    const entryFnNoMTF = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: false });
    const resultNoMTF = backtester.run({
      ...baseConfig,
      entryFn: entryFnNoMTF,
    });
    const scoreNoMTF = resultNoMTF.profitFactor > 1
      ? (resultNoMTF.profitFactor - 1) * Math.sqrt(resultNoMTF.trades) * (1 - resultNoMTF.maxDrawdownPct / 100)
      : -Math.abs(resultNoMTF.netPnl);
    
    results.push({
      name: 'BASE (no MTF)',
      trades: resultNoMTF.trades,
      wins: resultNoMTF.wins,
      losses: resultNoMTF.losses,
      netPnl: resultNoMTF.netPnl,
      pf: resultNoMTF.profitFactor,
      maxDD: resultNoMTF.maxDrawdownPct,
      winRate: resultNoMTF.winRate,
      expectancy: resultNoMTF.expectancy,
      score: scoreNoMTF,
    });

    // 7. MTF Filter (15m EMA 50 trend bias)
    console.log('7. Testing MTF Filter (15m EMA 50 trend bias)...');
    const entryFnWithMTF = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: true });
    const resultMTF = backtester.run({
      ...baseConfig,
      entryFn: entryFnWithMTF,
    });
    const scoreMTF = resultMTF.profitFactor > 1
      ? (resultMTF.profitFactor - 1) * Math.sqrt(resultMTF.trades) * (1 - resultMTF.maxDrawdownPct / 100)
      : -Math.abs(resultMTF.netPnl);
    
    results.push({
      name: 'MTF Filter (15m EMA)',
      trades: resultMTF.trades,
      wins: resultMTF.wins,
      losses: resultMTF.losses,
      netPnl: resultMTF.netPnl,
      pf: resultMTF.profitFactor,
      maxDD: resultMTF.maxDrawdownPct,
      winRate: resultMTF.winRate,
      expectancy: resultMTF.expectancy,
      score: scoreMTF,
    });

    // 8. Combinación: Partial TP + Smart Zombie
    console.log('8. Testing Partial TP + Smart Zombie...');
    const resultCombo = backtester.run({
      ...baseConfig,
      entryFn: entryFnBase,
      partialTP: {
        enabled: true,
        exitAtBBMiddle: true,
      },
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.05,
        onlyIfReversing: true,
      },
    });
    const scoreCombo = resultCombo.profitFactor > 1
      ? (resultCombo.profitFactor - 1) * Math.sqrt(resultCombo.trades) * (1 - resultCombo.maxDrawdownPct / 100)
      : -Math.abs(resultCombo.netPnl);
    
    results.push({
      name: 'Partial TP + Smart Zombie',
      trades: resultCombo.trades,
      wins: resultCombo.wins,
      losses: resultCombo.losses,
      netPnl: resultCombo.netPnl,
      pf: resultCombo.profitFactor,
      maxDD: resultCombo.maxDrawdownPct,
      winRate: resultCombo.winRate,
      expectancy: resultCombo.expectancy,
      score: scoreCombo,
    });

    // Print comparison
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS COMPARISON');
    console.log('='.repeat(80));
    console.log('Config'.padEnd(30) + '| Trades | W/L   | Net$  | PF   | DD%  | WR%  | Score | vs Base');
    console.log('-'.repeat(80));

    const baseResult = results[0]!;

    for (const r of results) {
      const wrDelta = r.winRate - baseResult.winRate;
      const pfDelta = r.profitFactor - baseResult.profitFactor;
      const pnlDelta = r.netPnl - baseResult.netPnl;
      const tradesDelta = r.trades - baseResult.trades;
      
      const vsBase = r.name === baseResult.name 
        ? 'BASE'
        : `WR:${wrDelta > 0 ? '+' : ''}${wrDelta.toFixed(1)}% PF:${pfDelta > 0 ? '+' : ''}${pfDelta.toFixed(3)}`;
      
      const marker = r.score > baseResult.score ? ' ✅' : 
                     r.pf > baseResult.pf && r.winRate >= baseResult.winRate * 0.95 ? ' +' : '';
      
      console.log(
        r.name.padEnd(30) + '| ' +
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

    // Find improvements
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
        scoreDelta: r.score - baseResult.score,
      }))
      .sort((a, b) => b.scoreDelta - a.scoreDelta);

    const positiveImprovements = improvements.filter(imp => imp.scoreDelta > 0);

    if (positiveImprovements.length > 0) {
      console.log('\n✅ IMPROVEMENTS FOUND:');
      for (const imp of positiveImprovements) {
        console.log(`\n  ${imp.name}:`);
        console.log(`    Score: +${imp.scoreDelta.toFixed(1)}`);
        console.log(`    Win Rate: ${imp.wrDelta > 0 ? '+' : ''}${imp.wrDelta.toFixed(1)}%`);
        console.log(`    Profit Factor: ${imp.pfDelta > 0 ? '+' : ''}${imp.pfDelta.toFixed(3)}`);
        console.log(`    Net PnL: ${imp.pnlDelta > 0 ? '+' : ''}$${imp.pnlDelta.toFixed(0)}`);
        console.log(`    Trades: ${imp.tradesPct > 0 ? '+' : ''}${imp.tradesPct.toFixed(1)}% (${imp.tradesDelta > 0 ? '+' : ''}${imp.tradesDelta})`);
      }
      
      const best = positiveImprovements[0]!;
      console.log(`\n🎯 BEST IMPROVEMENT: "${best.name}"`);
      console.log(`   Improves score by ${best.scoreDelta.toFixed(1)} points`);
    } else {
      console.log('\n⚠️  NO IMPROVEMENTS FOUND');
      console.log('   All alternative strategies perform worse than base.');
    }
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('Done!');
  console.log('='.repeat(80));
}

main().catch(console.error);

