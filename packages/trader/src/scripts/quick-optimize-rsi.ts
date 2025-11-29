#!/usr/bin/env npx tsx
/**
 * Quick RSI Optimization - Finds best balance between trades and profitability
 *
 * Usage: npx tsx src/scripts/quick-optimize-rsi.ts
 */

import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { RSIScalpBacktestStrategy } from '../backtest/strategies/rsi-scalp-backtest.strategy.js';
import type { RSIScalpParams } from '../strategies/rsi-scalp.types.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

interface Result {
  config: string;
  trades: number;
  winRate: number;
  netPnl: number;
  pf: number;
  dd: number;
  avgTrade: number;
  score: number; // Combined metric
}

async function main() {
  console.log('='.repeat(80));
  console.log('  QUICK RSI OPTIMIZATION - Finding optimal trade frequency vs profitability');
  console.log('='.repeat(80));

  const assets = ['cryBTCUSD', 'cryETHUSD'];

  for (const ASSET of assets) {
    const dataFile = path.join(dataDir, `${ASSET}_1m_90d.csv`);

    let candles;
    try {
      candles = loadCandlesFromCSV(dataFile, {
        asset: ASSET,
        timeframe: 60,
        timestampColumn: 'timestamp',
        openColumn: 'open',
        highColumn: 'high',
        lowColumn: 'low',
        closeColumn: 'close',
        timestampFormat: 'unix_ms',
      });
    } catch {
      console.log(`\nSkipping ${ASSET} - data file not found`);
      continue;
    }

    console.log(`\n\n${ASSET} - ${candles.length.toLocaleString()} candles`);
    console.log('-'.repeat(80));

    const results: Result[] = [];

    // Grid search - focus on finding more trades while keeping PF > 1.2
    const rsiLevels = [
      { os: 25, ob: 75 }, // Very relaxed - most trades
      { os: 23, ob: 77 },
      { os: 20, ob: 80 }, // Standard
      { os: 18, ob: 82 },
      { os: 17, ob: 83 },
      { os: 15, ob: 85 }, // Conservative
      { os: 12, ob: 88 }, // Very conservative - best PF
    ];

    const tpSlConfigs = [
      { tp: 0.25, sl: 0.25 }, // 1:1
      { tp: 0.3, sl: 0.2 },   // 1.5:1
      { tp: 0.4, sl: 0.2 },   // 2:1
      { tp: 0.5, sl: 0.25 },  // 2:1
      { tp: 0.6, sl: 0.2 },   // 3:1
    ];

    const cooldowns = [3, 5, 10, 15];

    let tested = 0;
    const total = rsiLevels.length * tpSlConfigs.length * cooldowns.length;

    for (const rsi of rsiLevels) {
      for (const tpsl of tpSlConfigs) {
        for (const cd of cooldowns) {
          tested++;
          if (tested % 20 === 0) {
            process.stdout.write(`\rTesting ${tested}/${total}...`);
          }

          const configName = `RSI ${rsi.os}/${rsi.ob}, TP ${tpsl.tp}% SL ${tpsl.sl}%, CD ${cd}`;

          const params: Partial<RSIScalpParams> = {
            entryLevels: {
              long: [{ rsiThreshold: rsi.os, sizePercent: 100, enabled: true }],
              short: [{ rsiThreshold: rsi.ob, sizePercent: 100, enabled: true }],
            },
            takeProfitLevels: [
              { profitPercent: tpsl.tp, rsiThreshold: 50, exitPercent: 100 },
            ],
            stopLossPercent: tpsl.sl,
            cooldownBars: cd,
            useTrendFilter: false,
          };

          const strategy = new RSIScalpBacktestStrategy(ASSET, params);

          try {
            const result = runBacktest(strategy, candles, {
              asset: ASSET,
              timeframe: 60,
              initialBalance: INITIAL_CAPITAL,
              multiplier: MULTIPLIER,
              stakeAmount: INITIAL_CAPITAL * STAKE_PCT,
              takeProfitPct: tpsl.tp / 100,
              stopLossPct: tpsl.sl / 100,
            });

            const m = result.metrics;
            const avgTrade = m.totalTrades > 0 ? m.netPnl / m.totalTrades : 0;

            // Score: prioritize PF > 1.2 AND more trades
            // Formula: (PF - 1) * sqrt(trades) * (1 - DD/100)
            const score = m.profitFactor > 1
              ? (m.profitFactor - 1) * Math.sqrt(m.totalTrades) * (1 - m.maxDrawdownPct / 100)
              : -Math.abs(m.netPnl);

            results.push({
              config: configName,
              trades: m.totalTrades,
              winRate: m.winRate,
              netPnl: m.netPnl,
              pf: m.profitFactor,
              dd: m.maxDrawdownPct,
              avgTrade,
              score,
            });
          } catch {
            // Skip errors
          }
        }
      }
    }

    console.log('\r' + ' '.repeat(40) + '\r');

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Print top 15
    console.log('\nTOP 15 CONFIGURATIONS (by combined score)');
    console.log('Score = (PF-1) * sqrt(trades) * (1 - DD%)');
    console.log('-'.repeat(80));
    console.log('Config'.padEnd(45) + '| Trades | Win%  | Net$  | PF   | DD%  | Score');
    console.log('-'.repeat(80));

    for (const r of results.slice(0, 15)) {
      const marker = r.pf >= 1.5 ? ' *' : r.pf >= 1.3 ? ' +' : '';
      console.log(
        r.config.padEnd(45) + '| ' +
        String(r.trades).padStart(6) + ' | ' +
        r.winRate.toFixed(1).padStart(5) + '% | ' +
        ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
        r.pf.toFixed(2).padStart(4) + ' | ' +
        r.dd.toFixed(1).padStart(4) + '% | ' +
        r.score.toFixed(1).padStart(5) + marker
      );
    }

    // Summary stats
    const profitable = results.filter(r => r.pf > 1);
    const highPF = results.filter(r => r.pf >= 1.5);
    const manyTrades = results.filter(r => r.trades >= 200 && r.pf > 1);

    console.log('\n📊 SUMMARY');
    console.log(`  Total configs tested: ${results.length}`);
    console.log(`  Profitable (PF > 1): ${profitable.length}`);
    console.log(`  High PF (>= 1.5): ${highPF.length}`);
    console.log(`  200+ trades & profitable: ${manyTrades.length}`);

    if (manyTrades.length > 0) {
      console.log('\n🎯 BEST HIGH-VOLUME CONFIGS (200+ trades, PF > 1):');
      const bestVolume = manyTrades.sort((a, b) => b.pf - a.pf).slice(0, 3);
      for (const r of bestVolume) {
        console.log(`  ${r.config}`);
        console.log(`    → ${r.trades} trades, PF ${r.pf.toFixed(2)}, $${r.netPnl.toFixed(0)} net, ${r.dd.toFixed(1)}% DD`);
      }
    }
  }

  console.log('\n\n* = PF >= 1.5, + = PF >= 1.3');
  console.log('Done!');
}

main().catch(console.error);
