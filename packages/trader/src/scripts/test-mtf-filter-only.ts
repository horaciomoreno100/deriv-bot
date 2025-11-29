#!/usr/bin/env npx tsx
/**
 * Test MTF Filter Only
 *
 * Prueba específicamente el MTF Filter para ver si está funcionando
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import type { CryptoScalpParams } from '../strategies/crypto-scalp/crypto-scalp.types.js';
import { HIGH_PF_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

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
  console.log('  TESTING MTF FILTER - DETAILED ANALYSIS');
  console.log('='.repeat(80));

  const asset = 'cryETHUSD';
  const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);

  if (!fs.existsSync(filepath)) {
    console.log(`\nFile not found: ${filepath}`);
    return;
  }

  console.log(`\n${asset}`);
  console.log('-'.repeat(80));

  // Load data
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
    tpPct: HIGH_PF_PRESET.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
    slPct: HIGH_PF_PRESET.baseStopLossPct ?? 0.2,
    cooldown: HIGH_PF_PRESET.cooldownBars ?? 20,
    maxBarsInTrade: HIGH_PF_PRESET.maxBarsInTrade ?? 60,
    initialBalance: INITIAL_CAPITAL,
    stakePct: STAKE_PCT,
    multiplier: MULTIPLIER,
    startIndex: 50,
  };

  // Test BASE (sin MTF - pero el MTF está siempre activo en la función)
  // Necesitamos crear una versión sin MTF para comparar
  console.log('\n1. Testing with MTF Filter (built-in)...');
  const entryFnWithMTF = createCryptoScalpV2EntryFn(candles, HIGH_PF_PRESET);
  const resultWithMTF = backtester.run({
    ...baseConfig,
    entryFn: entryFnWithMTF,
  });

  console.log(`\nResults with MTF Filter:`);
  console.log(`  Trades: ${resultWithMTF.trades}`);
  console.log(`  Wins: ${resultWithMTF.wins}, Losses: ${resultWithMTF.losses}`);
  console.log(`  Win Rate: ${resultWithMTF.winRate.toFixed(1)}%`);
  console.log(`  Net PnL: $${resultWithMTF.netPnl.toFixed(2)}`);
  console.log(`  PF: ${resultWithMTF.profitFactor.toFixed(2)}`);
  console.log(`  Max DD: ${resultWithMTF.maxDrawdownPct.toFixed(1)}%`);

  // El problema es que el MTF está siempre activo en createCryptoScalpV2EntryFn
  // Necesitamos verificar si realmente está cambiando los umbrales
  console.log('\n[Note] MTF Filter is always active in the entry function.');
  console.log('If results are identical to base, the filter might not be working.');
}

main().catch(console.error);

