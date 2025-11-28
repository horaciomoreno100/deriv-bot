#!/usr/bin/env tsx
/**
 * Analizar por qué la estrategia está perdiendo en 30 días
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

async function runTest(days: number, label: string) {
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (days * oneDaySeconds);
  const candles = allCandles.filter(c => c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime);

  const strategy = createMTFLevelsStrategy(ASSET, {
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
    avoidRSIMidRange: true,
    takeProfitPct: 0.0023,
    stopLossPct: 0.0025,
  });

  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');
  
  // Analizar por períodos
  const tradesPerDay = Math.floor(trades.length / days);
  const firstHalf = trades.slice(0, Math.floor(trades.length / 2));
  const secondHalf = trades.slice(Math.floor(trades.length / 2));
  
  const firstHalfWins = firstHalf.filter(t => t.result?.outcome === 'WIN').length;
  const secondHalfWins = secondHalf.filter(t => t.result?.outcome === 'WIN').length;
  
  return {
    label,
    days,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    netPnL: result.metrics?.netPnL ?? 0,
    profitFactor: result.metrics?.profitFactor ?? 0,
    maxDrawdown: result.metrics?.maxDrawdownPct ?? 0,
    tradesPerDay,
    firstHalfWR: (firstHalfWins / firstHalf.length) * 100,
    secondHalfWR: (secondHalfWins / secondHalf.length) * 100,
    avgWin: wins.length > 0 ? wins.reduce((sum, t) => sum + (t.result?.pnl || 0), 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + (t.result?.pnl || 0), 0) / losses.length) : 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS: ¿POR QUÉ LA ESTRATEGIA ESTÁ PERDIENDO?');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}\n`);

  // Comparar diferentes períodos
  const results = [];
  results.push(await runTest(7, '7 días'));
  results.push(await runTest(14, '14 días'));
  results.push(await runTest(30, '30 días'));

  console.log('='.repeat(80));
  console.log('COMPARACIÓN POR PERÍODO');
  console.log('='.repeat(80));
  console.log('');

  const formatNumber = (n: number, decimals: number = 2) => {
    return n >= 0 ? `+${n.toFixed(decimals)}` : n.toFixed(decimals);
  };

  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Período │ Trades │ WR%   │ PnL      │ PF   │ DD%    │ Trades/día │ 1ra mitad WR │ 2da mitad WR │');
  console.log('├────────────────────────────────────────────────────────────────────────────────────────────────────┤');
  
  for (const r of results) {
    const label = r.label.padEnd(8);
    const trades = r.totalTrades.toString().padStart(6);
    const wr = r.winRate.toFixed(1).padStart(5);
    const pnl = formatNumber(r.netPnL, 0).padStart(9);
    const pf = r.profitFactor.toFixed(2).padStart(5);
    const dd = r.maxDrawdown.toFixed(1).padStart(6);
    const tpd = r.tradesPerDay.toFixed(1).padStart(11);
    const wr1 = r.firstHalfWR.toFixed(1).padStart(13);
    const wr2 = r.secondHalfWR.toFixed(1).padStart(13);
    
    console.log(`│ ${label} │ ${trades} │ ${wr}% │ ${pnl} │ ${pf} │ ${dd}% │ ${tpd} │ ${wr1}% │ ${wr2}% │`);
  }
  
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Análisis detallado de 30 días
  console.log('='.repeat(80));
  console.log('ANÁLISIS DETALLADO - 30 DÍAS');
  console.log('='.repeat(80));
  
  const result30 = results[2]!;
  console.log(`Total trades: ${result30.totalTrades}`);
  console.log(`Win Rate: ${result30.winRate.toFixed(1)}%`);
  console.log(`Net PnL: $${result30.netPnL.toFixed(2)}`);
  console.log(`Profit Factor: ${result30.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${result30.maxDrawdown.toFixed(1)}%`);
  console.log('');
  console.log(`Primera mitad (días 1-15): ${result30.firstHalfWR.toFixed(1)}% WR`);
  console.log(`Segunda mitad (días 16-30): ${result30.secondHalfWR.toFixed(1)}% WR`);
  console.log(`Diferencia: ${(result30.secondHalfWR - result30.firstHalfWR).toFixed(1)}%`);
  console.log('');
  console.log(`Promedio Win: $${result30.avgWin.toFixed(2)}`);
  console.log(`Promedio Loss: $${result30.avgLoss.toFixed(2)}`);
  console.log(`Ratio Win/Loss: ${(result30.avgWin / result30.avgLoss).toFixed(2)}`);
  console.log('');

  // Diagnóstico
  console.log('='.repeat(80));
  console.log('DIAGNÓSTICO');
  console.log('='.repeat(80));
  
  const problems: string[] = [];
  
  if (result30.winRate < 50) {
    problems.push(`❌ Win Rate ${result30.winRate.toFixed(1)}% < 50% - La estrategia no es rentable`);
  }
  
  if (result30.profitFactor < 1.0) {
    problems.push(`❌ Profit Factor ${result30.profitFactor.toFixed(2)} < 1.0 - Pérdidas > Ganancias`);
  }
  
  if (result30.avgWin < result30.avgLoss) {
    problems.push(`❌ Avg Win ($${result30.avgWin.toFixed(2)}) < Avg Loss ($${result30.avgLoss.toFixed(2)}) - Pérdidas mayores que ganancias`);
  }
  
  if (result30.secondHalfWR < result30.firstHalfWR - 5) {
    problems.push(`❌ Win Rate decay: ${result30.firstHalfWR.toFixed(1)}% → ${result30.secondHalfWR.toFixed(1)}% - La estrategia empeora con el tiempo`);
  }
  
  if (result30.maxDrawdown > 50) {
    problems.push(`❌ Drawdown extremo: ${result30.maxDrawdown.toFixed(1)}% - Riesgo muy alto`);
  }

  if (problems.length === 0) {
    console.log('✅ No se detectaron problemas obvios');
  } else {
    problems.forEach(p => console.log(p));
  }
  console.log('');

  // Comparación con 7 días
  console.log('='.repeat(80));
  console.log('COMPARACIÓN: 7 DÍAS vs 30 DÍAS');
  console.log('='.repeat(80));
  
  const result7 = results[0]!;
  const wrDiff = result30.winRate - result7.winRate;
  const pfDiff = result30.profitFactor - result7.profitFactor;
  
  console.log(`Win Rate: ${result7.winRate.toFixed(1)}% (7d) → ${result30.winRate.toFixed(1)}% (30d) = ${wrDiff >= 0 ? '+' : ''}${wrDiff.toFixed(1)}%`);
  console.log(`Profit Factor: ${result7.profitFactor.toFixed(2)} (7d) → ${result30.profitFactor.toFixed(2)} (30d) = ${pfDiff >= 0 ? '+' : ''}${pfDiff.toFixed(2)}`);
  console.log(`Net PnL: $${result7.netPnL.toFixed(2)} (7d) → $${result30.netPnL.toFixed(2)} (30d)`);
  console.log('');
  
  if (result7.winRate > 55 && result30.winRate < 50) {
    console.log('⚠️  PROBLEMA: La estrategia funciona bien en 7 días pero falla en 30 días');
    console.log('   Posibles causas:');
    console.log('   1. Overfitting a condiciones específicas de los primeros días');
    console.log('   2. Cambio en las condiciones de mercado');
    console.log('   3. Las condiciones de entrada no son suficientemente estrictas');
    console.log('   4. Necesitamos más filtros para evitar trades en malas condiciones');
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

