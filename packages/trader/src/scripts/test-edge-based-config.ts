#!/usr/bin/env tsx
/**
 * Probar configuraciones basadas en los edges encontrados
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
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '30', 10);

interface TestResult {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnL: number;
  profitFactor: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
  expectedValue: number;
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
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  
  const avgWin = wins.length > 0 
    ? wins.reduce((sum, t) => sum + (t.result?.pnl || 0), 0) / wins.length 
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, t) => sum + (t.result?.pnl || 0), 0) / losses.length)
    : 0;
  
  const winRateDecimal = wins.length / trades.length;
  const expectedValue = (winRateDecimal * avgWin) - ((1 - winRateDecimal) * avgLoss);

  return {
    name,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    netPnL: result.metrics?.netPnL ?? 0,
    profitFactor: result.metrics?.profitFactor ?? 0,
    maxDrawdown: result.metrics?.maxDrawdownPct ?? 0,
    avgWin,
    avgLoss,
    expectedValue,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PROBANDO CONFIGURACIONES BASADAS EN EDGES');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Días: ${DAYS_TO_ANALYZE}\n`);

  const results: TestResult[] = [];

  // 1. BASE ORIGINAL (referencia)
  console.log('📊 Probando BASE ORIGINAL...');
  results.push(await runTest('BASE ORIGINAL', {
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
    requireStrongLevelAgainstTrend: false,
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  }));

  // 2. EDGE 1: Solo nivel fuerte (5m+15m) - el edge más robusto
  console.log('📊 Probando EDGE 1: Solo nivel fuerte (5m+15m)...');
  results.push(await runTest('EDGE 1: Solo nivel fuerte', {
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
    requireStrongLevelAgainstTrend: true, // Solo niveles 5m+15m
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  }));

  // 3. EDGE 2: Preferir RSI mid (40-60) - pero necesitamos implementar esto
  // Por ahora, no podemos filtrar por RSI mid directamente, pero podemos
  // evitar las otras zonas. Sin embargo, el análisis mostró que mid es mejor,
  // así que no agreguemos filtros de RSI.

  // 4. EDGE 3: Solo PUT (mejor edge en banda alta)
  console.log('📊 Probando EDGE 3: Solo PUT...');
  results.push(await runTest('EDGE 3: Solo PUT', {
    requireTrendAlignment: false,
    allowedDirection: 'PUT',
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationBarsPUT: 1,
    confirmationMinMove: 0.2,
    confirmationMinMoveAgainstTrend: 0.25,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    requireStrongLevelAgainstTrend: false,
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  }));

  // 5. EDGE 4: Nivel fuerte + Solo PUT
  console.log('📊 Probando EDGE 4: Nivel fuerte + Solo PUT...');
  results.push(await runTest('EDGE 4: Nivel fuerte + PUT', {
    requireTrendAlignment: false,
    allowedDirection: 'PUT',
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
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  }));

  // 6. EDGE 5: Nivel fuerte + Contra tendencia preferido
  // Esto es más complejo, pero podemos requerir nivel fuerte cuando vamos contra tendencia
  console.log('📊 Probando EDGE 5: Nivel fuerte requerido...');
  results.push(await runTest('EDGE 5: Nivel fuerte requerido', {
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
    requireStrongLevelAgainstTrend: true, // Requerir nivel fuerte siempre
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  }));

  // 7. EDGE COMBINADO: Todos los edges juntos
  console.log('📊 Probando EDGE COMBINADO: Todos los edges...');
  results.push(await runTest('EDGE COMBINADO', {
    requireTrendAlignment: false,
    allowedDirection: 'PUT', // PUT tiene mejor edge
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationBarsPUT: 1,
    confirmationMinMove: 0.2,
    confirmationMinMoveAgainstTrend: 0.25,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    requireStrongLevelAgainstTrend: true, // Solo niveles fuertes
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  }));

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('RESULTADOS');
  console.log('='.repeat(80));
  console.log('');

  const formatNumber = (n: number, decimals: number = 2) => {
    return n >= 0 ? `+${n.toFixed(decimals)}` : n.toFixed(decimals);
  };

  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Configuración          │ Trades │ WR%   │ Avg Win │ Avg Loss │ PnL      │ PF   │ DD%    │ Esperanza │');
  console.log('├────────────────────────────────────────────────────────────────────────────────────────────────────┤');
  
  for (const result of results) {
    const name = result.name.padEnd(22);
    const trades = result.trades.toString().padStart(6);
    const wr = result.winRate.toFixed(1).padStart(5);
    const avgWin = `$${result.avgWin.toFixed(0)}`.padStart(8);
    const avgLoss = `$${result.avgLoss.toFixed(0)}`.padStart(9);
    const pnl = formatNumber(result.netPnL, 0).padStart(9);
    const pf = result.profitFactor.toFixed(2).padStart(5);
    const dd = result.maxDrawdown.toFixed(1).padStart(6);
    const ev = formatNumber(result.expectedValue, 0).padStart(9);
    
    console.log(`│ ${name} │ ${trades} │ ${wr}% │ ${avgWin} │ ${avgLoss} │ ${pnl} │ ${pf} │ ${dd}% │ ${ev} │`);
  }
  
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Compare with base
  const base = results[0]!;
  console.log('Comparación con BASE ORIGINAL:');
  console.log('');
  
  for (let i = 1; i < results.length; i++) {
    const result = results[i]!;
    const tradesDiff = result.trades - base.trades;
    const wrDiff = result.winRate - base.winRate;
    const pnlDiff = result.netPnL - base.netPnL;
    const evDiff = result.expectedValue - base.expectedValue;
    
    const tradesEmoji = tradesDiff > 0 ? '📈' : tradesDiff < 0 ? '📉' : '➡️';
    const wrEmoji = wrDiff > 0 ? '✅' : wrDiff < 0 ? '❌' : '➡️';
    const pnlEmoji = pnlDiff > 0 ? '✅' : pnlDiff < 0 ? '❌' : '➡️';
    const evEmoji = evDiff > 0 ? '✅' : evDiff < 0 ? '❌' : '➡️';
    
    console.log(`${result.name}:`);
    console.log(`  ${tradesEmoji} Trades: ${formatNumber(tradesDiff)} (${base.trades} → ${result.trades})`);
    console.log(`  ${wrEmoji} Win Rate: ${formatNumber(wrDiff, 1)}% (${base.winRate.toFixed(1)}% → ${result.winRate.toFixed(1)}%)`);
    console.log(`  ${pnlEmoji} Net PnL: ${formatNumber(pnlDiff, 0)} (${formatNumber(base.netPnL, 0)} → ${formatNumber(result.netPnL, 0)})`);
    console.log(`  ${evEmoji} Esperanza: ${formatNumber(evDiff, 0)} (${formatNumber(base.expectedValue, 0)} → ${formatNumber(result.expectedValue, 0)})`);
    console.log('');
  }

  // Find best
  const best = results.reduce((best, curr) => {
    // Priorizar Profit Factor > 1.0 y Win Rate > 50%
    if (curr.profitFactor > 1.0 && curr.winRate > 50) {
      if (best.profitFactor <= 1.0 || best.winRate <= 50) return curr;
      return curr.expectedValue > best.expectedValue ? curr : best;
    }
    if (best.profitFactor > 1.0 && best.winRate > 50) return best;
    return curr.expectedValue > best.expectedValue ? curr : best;
  }, results[0]!);

  console.log('='.repeat(80));
  console.log('🏆 MEJOR CONFIGURACIÓN:');
  console.log('='.repeat(80));
  console.log(`${best.name}`);
  console.log(`Win Rate: ${best.winRate.toFixed(1)}%`);
  console.log(`Profit Factor: ${best.profitFactor.toFixed(2)}`);
  console.log(`Net PnL: $${best.netPnL.toFixed(2)}`);
  console.log(`Esperanza Matemática: $${best.expectedValue.toFixed(2)} por trade`);
  console.log(`Max Drawdown: ${best.maxDrawdown.toFixed(1)}%`);
  console.log(`Trades: ${best.trades}`);
  console.log('='.repeat(80));
}

main().catch(console.error);

