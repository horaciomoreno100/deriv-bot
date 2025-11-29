#!/usr/bin/env npx tsx
/**
 * FastBacktester Example
 *
 * Example showing how to use FastBacktester for rapid optimization.
 * This replaces the old fast-rsi-optimize.ts with a more flexible approach.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createRSIEntryFn, createRSIWithEMAEntryFn } from '../backtest/runners/fast-backtester-helpers.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

interface Result {
  config: string;
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

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000, // Convert ms to s
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
  console.log('  FAST BACKTESTER EXAMPLE - RSI Optimization');
  console.log('='.repeat(80));

  const assets = ['cryBTCUSD', 'cryETHUSD'];

  for (const asset of assets) {
    const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);

    if (!fs.existsSync(filepath)) {
      console.log(`\nSkipping ${asset} - data not found`);
      continue;
    }

    console.log(`\n\n${asset}`);
    console.log('-'.repeat(80));

    // Load data once
    console.log('Loading candles...');
    const candles = loadCandles(filepath);
    console.log(`Loaded ${candles.length.toLocaleString()} candles`);

    // Create FastBacktester with RSI indicator
    console.log('Pre-calculating indicators...');
    const backtester = new FastBacktester(candles, ['rsi'], {
      rsiPeriod: 14,
    });
    console.log('Indicators ready!');

    // Test configs
    console.log('Testing configurations...');
    const results: Result[] = [];

    const rsiConfigs = [
      { os: 25, ob: 75 },
      { os: 23, ob: 77 },
      { os: 20, ob: 80 },
      { os: 18, ob: 82 },
      { os: 17, ob: 83 },
      { os: 15, ob: 85 },
      { os: 12, ob: 88 },
    ];

    const tpslConfigs = [
      { tp: 0.25, sl: 0.25 },
      { tp: 0.3, sl: 0.2 },
      { tp: 0.4, sl: 0.2 },
      { tp: 0.5, sl: 0.25 },
      { tp: 0.6, sl: 0.2 },
    ];

    const cooldowns = [3, 5, 10, 15];

    const startTime = Date.now();

    for (const rsiCfg of rsiConfigs) {
      for (const tpsl of tpslConfigs) {
        for (const cd of cooldowns) {
          // Create entry function for this RSI config
          const entryFn = createRSIEntryFn(rsiCfg.os, rsiCfg.ob);

          // Run fast backtest
          const result = backtester.run({
            entryFn,
            tpPct: tpsl.tp,
            slPct: tpsl.sl,
            cooldown: cd,
            initialBalance: INITIAL_CAPITAL,
            stakePct: STAKE_PCT,
            multiplier: MULTIPLIER,
            maxBarsInTrade: 50,
            startIndex: 20, // Skip warmup period
          });

          // Calculate score
          const score = result.profitFactor > 1
            ? (result.profitFactor - 1) * Math.sqrt(result.trades) * (1 - result.maxDrawdownPct / 100)
            : -Math.abs(result.netPnl);

          results.push({
            config: `RSI ${rsiCfg.os}/${rsiCfg.ob}, TP ${tpsl.tp}% SL ${tpsl.sl}%, CD ${cd}`,
            trades: result.trades,
            wins: result.wins,
            losses: result.losses,
            netPnl: result.netPnl,
            pf: result.profitFactor,
            maxDD: result.maxDrawdownPct,
            winRate: result.winRate,
            expectancy: result.expectancy,
            score,
          });
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Tested ${results.length} configs in ${elapsed}ms (${(elapsed / results.length).toFixed(2)}ms per config)`);

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Print results
    console.log('\nTOP 15 CONFIGURATIONS');
    console.log('-'.repeat(80));
    console.log('Config'.padEnd(42) + '| Trades | W/L   | Net$  | PF   | DD%  | WR%  | Score');
    console.log('-'.repeat(80));

    for (const r of results.slice(0, 15)) {
      const marker = r.pf >= 1.5 ? ' *' : r.pf >= 1.3 ? ' +' : '';
      console.log(
        r.config.padEnd(42) + '| ' +
        String(r.trades).padStart(6) + ' | ' +
        `${r.wins}/${r.losses}`.padStart(5) + ' | ' +
        ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
        r.pf.toFixed(2).padStart(4) + ' | ' +
        r.maxDD.toFixed(1).padStart(4) + '% | ' +
        r.winRate.toFixed(0).padStart(4) + '% | ' +
        r.score.toFixed(1).padStart(5) + marker
      );
    }

    // Summary
    const profitable = results.filter(r => r.pf > 1);
    const manyTrades = results.filter(r => r.trades >= 200 && r.pf > 1);

    console.log('\n📊 SUMMARY');
    console.log(`  Profitable: ${profitable.length}/${results.length}`);
    console.log(`  200+ trades & profitable: ${manyTrades.length}`);

    if (manyTrades.length > 0) {
      console.log('\n🎯 BEST HIGH-VOLUME (200+ trades, PF > 1):');
      const best = manyTrades.sort((a, b) => b.pf - a.pf).slice(0, 3);
      for (const r of best) {
        console.log(`  ${r.config} → ${r.trades} trades, PF ${r.pf.toFixed(2)}, $${r.netPnl.toFixed(0)}, WR ${r.winRate.toFixed(0)}%`);
      }
    }
  }

  console.log('\n\n* = PF >= 1.5, + = PF >= 1.3');
  console.log('Done!');
}

main().catch(console.error);

