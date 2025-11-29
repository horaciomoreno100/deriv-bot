#!/usr/bin/env npx tsx
/**
 * Fast CryptoScalp v2 Optimization
 *
 * Example showing how to optimize CryptoScalp v2 using FastBacktester.
 * This is much faster than using the full backtest framework.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import type { CryptoScalpParams } from '../strategies/crypto-scalp/crypto-scalp.types.js';
import { AGGRESSIVE_PRESET, CONSERVATIVE_PRESET, HIGH_PF_PRESET, BTC_CONFIG, ETH_CONFIG } from '../strategies/crypto-scalp/crypto-scalp.params.js';

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
  console.log('  FAST CRYPTOSCALP V2 OPTIMIZATION');
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

    // Create FastBacktester with required indicators
    console.log('Pre-calculating indicators...');
    const backtester = new FastBacktester(candles, ['rsi', 'atr', 'adx', 'bb'], {
      rsiPeriod: 14,
      atrPeriod: 14,
      adxPeriod: 14,
      bbPeriod: 20,
      bbStdDev: 2,
    });
    console.log('Indicators ready!');

    // Test different presets
    console.log('Testing presets...');
    const results: Result[] = [];

    const presets: Array<{ name: string; params: Partial<CryptoScalpParams> }> = [
      { name: 'Default', params: {} },
      { name: 'Aggressive', params: AGGRESSIVE_PRESET },
      { name: 'Conservative', params: CONSERVATIVE_PRESET },
      { name: 'High PF', params: HIGH_PF_PRESET },
      { name: 'Asset-Specific', params: asset.includes('BTC') ? BTC_CONFIG : ETH_CONFIG },
    ];

    const startTime = Date.now();

    for (const preset of presets) {
      // Create entry function with preset
      const entryFn = createCryptoScalpV2EntryFn(candles, preset.params);

      // Get TP/SL from preset (use defaults if not specified)
      const tpPct = preset.params.takeProfitLevels?.[0]?.profitPercent ?? 0.3;
      const slPct = preset.params.baseStopLossPct ?? 0.3;
      const cooldown = preset.params.cooldownBars ?? 10;

      // Run fast backtest
      const result = backtester.run({
        entryFn,
        tpPct,
        slPct,
        cooldown,
        initialBalance: INITIAL_CAPITAL,
        stakePct: STAKE_PCT,
        multiplier: MULTIPLIER,
        maxBarsInTrade: preset.params.maxBarsInTrade ?? 60,
        startIndex: 50, // Skip warmup period
      });

      // Calculate score
      const score = result.profitFactor > 1
        ? (result.profitFactor - 1) * Math.sqrt(result.trades) * (1 - result.maxDrawdownPct / 100)
        : -Math.abs(result.netPnl);

      results.push({
        config: preset.name,
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

    const elapsed = Date.now() - startTime;
    console.log(`Tested ${results.length} presets in ${elapsed}ms (${(elapsed / results.length).toFixed(2)}ms per preset)`);

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Print results
    console.log('\nPRESET COMPARISON');
    console.log('-'.repeat(80));
    console.log('Preset'.padEnd(20) + '| Trades | W/L   | Net$  | PF   | DD%  | WR%  | Score');
    console.log('-'.repeat(80));

    for (const r of results) {
      const marker = r.pf >= 1.5 ? ' *' : r.pf >= 1.3 ? ' +' : '';
      console.log(
        r.config.padEnd(20) + '| ' +
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
    console.log('\n📊 SUMMARY');
    console.log(`  Profitable presets: ${profitable.length}/${results.length}`);

    if (profitable.length > 0) {
      console.log('\n🎯 BEST PRESET:');
      const best = results[0]!;
      console.log(`  ${best.config} → ${best.trades} trades, PF ${best.pf.toFixed(2)}, $${best.netPnl.toFixed(0)}, WR ${best.winRate.toFixed(0)}%`);
    }
  }

  console.log('\n\n* = PF >= 1.5, + = PF >= 1.3');
  console.log('Done!');
}

main().catch(console.error);

