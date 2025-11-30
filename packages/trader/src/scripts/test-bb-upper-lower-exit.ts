#!/usr/bin/env npx tsx
/**
 * Test BB Upper/Lower Exit Optimization
 * 
 * Prueba cerrar CALLs en BB Superior y PUTs en BB Inferior
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { HIGH_PF_PRESET, CONSERVATIVE_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

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
  console.log('  TEST: BB UPPER/LOWER EXIT OPTIMIZATION');
  console.log('='.repeat(80));

  const assets = [
    { name: 'cryETHUSD', preset: HIGH_PF_PRESET, presetName: 'High PF' },
    { name: 'cryBTCUSD', preset: CONSERVATIVE_PRESET, presetName: 'Conservative' },
  ];

  for (const { name: asset, preset, presetName } of assets) {
    const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);

    if (!fs.existsSync(filepath)) {
      console.log(`\nSkipping ${asset} - data not found`);
      continue;
    }

    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`${asset} - ${presetName}`);
    console.log('='.repeat(80));

    console.log('Loading candles...');
    const candles = loadCandles(filepath);
    console.log(`Loaded ${candles.length.toLocaleString()} candles`);

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
      zombieKiller: asset.includes('ETH')
        ? { enabled: true, bars: 15, minPnlPct: 0.05, onlyIfReversing: true }
        : { enabled: true, bars: 15, minPnlPct: 0.1 },
    };

    // 1. BASE (sin BB Upper/Lower exit)
    console.log('\n1. Testing BASE (current config)...');
    const entryFn = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: true });
    const resultBase = backtester.run({
      ...baseConfig,
      entryFn,
    });

    // 2. CON BB UPPER/LOWER EXIT (solo si hay ganancia)
    console.log('2. Testing with BB Upper/Lower Exit (only if profitable)...');
    const resultBBExit = backtester.run({
      ...baseConfig,
      entryFn,
      exitOnBBUpper: true,  // Cerrar CALLs en BB Superior
      exitOnBBLower: true,  // Cerrar PUTs en BB Inferior
      bbUpperLowerMinPnl: 0.05, // Solo cerrar si hay al menos 0.05% de ganancia
    });

    // Print comparison
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS COMPARISON');
    console.log('='.repeat(80));
    console.log('Config'.padEnd(40) + '| Trades | W/L   | Net$  | PF   | DD%  | WR%  | R:R');
    console.log('-'.repeat(80));

    const baseResult = resultBase;
    const bbExitResult = resultBBExit;

    console.log(
      'BASE (Current)'.padEnd(40) + '| ' +
      String(baseResult.trades).padStart(6) + ' | ' +
      `${baseResult.wins}/${baseResult.losses}`.padStart(5) + ' | ' +
      ('$' + baseResult.netPnl.toFixed(0)).padStart(5) + ' | ' +
      baseResult.profitFactor.toFixed(2).padStart(4) + ' | ' +
      baseResult.maxDrawdownPct.toFixed(1).padStart(4) + '% | ' +
      baseResult.winRate.toFixed(0).padStart(4) + '% | ' +
      baseResult.riskRewardRatio.toFixed(2).padStart(4)
    );

    const improvement = bbExitResult.netPnl - baseResult.netPnl;
    const marker = improvement > 0 ? ' ✅' : '';
    
    console.log(
      ('BB Upper/Lower Exit' + marker).padEnd(40) + '| ' +
      String(bbExitResult.trades).padStart(6) + ' | ' +
      `${bbExitResult.wins}/${bbExitResult.losses}`.padStart(5) + ' | ' +
      ('$' + bbExitResult.netPnl.toFixed(0)).padStart(5) + ' | ' +
      bbExitResult.profitFactor.toFixed(2).padStart(4) + ' | ' +
      bbExitResult.maxDrawdownPct.toFixed(1).padStart(4) + '% | ' +
      bbExitResult.winRate.toFixed(0).padStart(4) + '% | ' +
      bbExitResult.riskRewardRatio.toFixed(2).padStart(4)
    );

    // Detailed comparison
    console.log('\n' + '='.repeat(80));
    console.log('IMPROVEMENT BREAKDOWN');
    console.log('='.repeat(80));
    console.log(`\n📊 BASE → BB Upper/Lower Exit:`);
    console.log(`   Net PnL: $${baseResult.netPnl.toFixed(0)} → $${bbExitResult.netPnl.toFixed(0)} (${improvement > 0 ? '+' : ''}$${improvement.toFixed(0)}, ${((improvement / Math.abs(baseResult.netPnl)) * 100).toFixed(0)}% change)`);
    console.log(`   Profit Factor: ${baseResult.profitFactor.toFixed(2)} → ${bbExitResult.profitFactor.toFixed(2)} (${((bbExitResult.profitFactor - baseResult.profitFactor) / baseResult.profitFactor * 100).toFixed(0)}% change)`);
    console.log(`   Win Rate: ${baseResult.winRate.toFixed(1)}% → ${bbExitResult.winRate.toFixed(1)}% (${(bbExitResult.winRate - baseResult.winRate).toFixed(1)}% change)`);
    console.log(`   Max Drawdown: ${baseResult.maxDrawdownPct.toFixed(1)}% → ${bbExitResult.maxDrawdownPct.toFixed(1)}% (${((baseResult.maxDrawdownPct - bbExitResult.maxDrawdownPct) / baseResult.maxDrawdownPct * 100).toFixed(0)}% change)`);
    console.log(`   Trades: ${baseResult.trades} → ${bbExitResult.trades} (${((bbExitResult.trades - baseResult.trades) / baseResult.trades * 100).toFixed(0)}% change)`);
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('Done!');
  console.log('='.repeat(80));
}

main().catch(console.error);

