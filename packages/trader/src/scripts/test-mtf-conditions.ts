#!/usr/bin/env tsx
/**
 * Probar condiciones lógicas y generalizables (no overfitting)
 * Probar en múltiples días para validar generalización
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
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '7', 10); // Probar en 7 días

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
  console.log('PROBANDO CONDICIONES LÓGICAS (NO OVERFITTING)');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Días: ${DAYS_TO_ANALYZE} (para validar generalización)\n`);

  // Base configuration (best combination actual)
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

  // Test 1: Agregar filtro RSI (evitar zona neutral 40-60)
  // CONDICIÓN LÓGICA: La zona 40-60 es neutral, sin momentum claro
  // Es mejor entrar cuando hay momentum (RSI < 40 o > 60)
  console.log('📊 Ejecutando Test 1: Evitar RSI 40-60 (zona neutral)...');
  results.push(await runTest('CONDICIÓN: Evitar RSI zona neutral (40-60)', {
    ...baseConfig,
    avoidRSIMidRange: true,
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
    
    const tradesEmoji = tradesDiff > 0 ? '📈' : tradesDiff < 0 ? '📉' : '➡️';
    const wrEmoji = wrDiff > 0 ? '✅' : wrDiff < 0 ? '❌' : '➡️';
    const pnlEmoji = pnlDiff > 0 ? '✅' : pnlDiff < 0 ? '❌' : '➡️';
    const pfEmoji = pfDiff > 0 ? '✅' : pfDiff < 0 ? '❌' : '➡️';
    
    console.log(`${result.name}:`);
    console.log(`  ${tradesEmoji} Trades: ${formatNumber(tradesDiff)} (${base.trades} → ${result.trades})`);
    console.log(`  ${wrEmoji} Win Rate: ${formatNumber(wrDiff, 1)}% (${base.winRate.toFixed(1)}% → ${result.winRate.toFixed(1)}%)`);
    console.log(`  ${pnlEmoji} PnL: ${formatNumber(pnlDiff, 0)} (${formatNumber(base.netPnL, 0)} → ${formatNumber(result.netPnL, 0)})`);
    console.log(`  ${pfEmoji} Profit Factor: ${formatNumber(pfDiff, 2)} (${base.profitFactor.toFixed(2)} → ${result.profitFactor.toFixed(2)})`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('NOTA: Probando en múltiples días para validar generalización');
  console.log('='.repeat(80));
}

main().catch(console.error);

