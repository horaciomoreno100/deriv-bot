#!/usr/bin/env tsx
/**
 * Probar mejoras individuales basadas en el análisis profundo
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '1', 10);

interface TestResult {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnL: number;
  profitFactor: number;
  maxDrawdown: number;
}

async function runTest(name: string, params: any): Promise<TestResult> {
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_ANALYZE * oneDaySeconds);
  const candles = allCandles.filter(c => c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime);

  const strategy = createMTFLevelsStrategy(ASSET, params);
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN').length;
  const losses = trades.filter(t => t.result?.outcome === 'LOSS').length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const netPnL = result.metrics?.netPnL ?? 0;
  const profitFactor = result.metrics?.profitFactor ?? 0;
  const maxDrawdown = result.metrics?.maxDrawdown ?? 0;

  return {
    name,
    trades: trades.length,
    wins,
    losses,
    winRate,
    netPnL,
    profitFactor,
    maxDrawdown,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PROBANDO MEJORAS INDIVIDUALES');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Días: ${DAYS_TO_ANALYZE}\n`);

  // Base configuration (best combination)
  const baseConfig = {
    requireTrendAlignment: false,
    allowedDirection: 'both',
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationBarsPUT: 1,
    confirmationMinMove: 0.2,
    confirmationMinMoveAgainstTrend: 0.25,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    requireStrongLevelAgainstTrend: true,
    requireBBBand: true,
    bbBandTolerance: 0.15,
    minBounceStrength: 0.5,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  };

  const results: TestResult[] = [];

  // Test 0: Base (best combination)
  console.log('📊 Ejecutando Test 0: BASE (Mejor Combinación)...');
  results.push(await runTest('BASE (Mejor Combinación)', baseConfig));

  // Test 1: Filtrar RSI 40-60 (zona media neutral)
  console.log('📊 Ejecutando Test 1: Filtrar RSI 40-60...');
  // Necesitamos agregar este parámetro a la estrategia primero
  // results.push(await runTest('MEJORA 1: Filtrar RSI 40-60', {
  //   ...baseConfig,
  //   filterRSIMidRange: true,
  //   rsiMin: 60,
  //   rsiMax: 40, // Invertido para evitar 40-60
  // }));

  // Test 2: RSI solo < 40 o > 60
  console.log('📊 Ejecutando Test 2: RSI solo < 40 o > 60...');
  // results.push(await runTest('MEJORA 2: RSI extremos (<40 o >60)', {
  //   ...baseConfig,
  //   rsiFilter: 'extremes',
  // }));

  // Test 3: Aumentar maxBarsInTrade (dar más tiempo)
  console.log('📊 Ejecutando Test 3: Aumentar maxBarsInTrade (más tiempo)...');
  results.push(await runTest('MEJORA 3: MaxBarsInTrade 50 (vs default)', {
    ...baseConfig,
    maxBarsInTrade: 50,
  }));

  // Test 4: Aumentar maxBarsInTrade aún más
  console.log('📊 Ejecutando Test 4: MaxBarsInTrade 75...');
  results.push(await runTest('MEJORA 4: MaxBarsInTrade 75', {
    ...baseConfig,
    maxBarsInTrade: 75,
  }));

  // Test 5: Aumentar TP/SL para dar más espacio
  console.log('📊 Ejecutando Test 5: TP/SL más amplios (0.5%/0.4%)...');
  results.push(await runTest('MEJORA 5: TP 0.5% / SL 0.4%', {
    ...baseConfig,
    takeProfitPct: 0.005,
    stopLossPct: 0.004,
  }));

  // Test 6: TP/SL aún más amplios
  console.log('📊 Ejecutando Test 6: TP/SL muy amplios (0.6%/0.5%)...');
  results.push(await runTest('MEJORA 6: TP 0.6% / SL 0.5%', {
    ...baseConfig,
    takeProfitPct: 0.006,
    stopLossPct: 0.005,
  }));

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('RESULTADOS');
  console.log('='.repeat(80));
  console.log('');

  const formatNumber = (n: number, decimals: number = 2) => {
    return n >= 0 ? `+${n.toFixed(decimals)}` : n.toFixed(decimals);
  };

  console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Test                                              │ Trades │ WR%   │ PnL      │ PF   │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  
  for (const result of results) {
    const name = result.name.padEnd(50);
    const trades = result.trades.toString().padStart(6);
    const wr = result.winRate.toFixed(1).padStart(5);
    const pnl = formatNumber(result.netPnL, 0).padStart(9);
    const pf = result.profitFactor.toFixed(2).padStart(5);
    
    console.log(`│ ${name} │ ${trades} │ ${wr}% │ ${pnl} │ ${pf} │`);
  }
  
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Compare with base
  const base = results[0]!;
  console.log('Comparación con BASE:');
  console.log('');
  
  for (let i = 1; i < results.length; i++) {
    const result = results[i]!;
    const tradesDiff = result.trades - base.trades;
    const wrDiff = result.winRate - base.winRate;
    const pnlDiff = result.netPnL - base.netPnL;
    const pfDiff = result.profitFactor - base.profitFactor;
    
    console.log(`${result.name}:`);
    console.log(`  Trades: ${formatNumber(tradesDiff)} (${base.trades} → ${result.trades})`);
    console.log(`  Win Rate: ${formatNumber(wrDiff, 1)}% (${base.winRate.toFixed(1)}% → ${result.winRate.toFixed(1)}%)`);
    console.log(`  PnL: ${formatNumber(pnlDiff, 0)} (${formatNumber(base.netPnL, 0)} → ${formatNumber(result.netPnL, 0)})`);
    console.log(`  Profit Factor: ${formatNumber(pfDiff, 2)} (${base.profitFactor.toFixed(2)} → ${result.profitFactor.toFixed(2)})`);
    console.log('');
  }
}

main().catch(console.error);

