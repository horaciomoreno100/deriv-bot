#!/usr/bin/env tsx
/**
 * Análisis Detallado de Pérdidas - MTF Levels Strategy
 * 
 * Analiza cuándo y por qué perdemos para mejorar la estrategia
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

interface LossPattern {
  // Trade info
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  barsHeld: number;
  exitReason: string;
  
  // Market conditions at entry
  rsi: number;
  atr: number;
  levelType: 'high' | 'low';
  levelStrength: number;
  levelPrice: number;
  trend5m: string;
  trend15m: string;
  
  // Price action
  maxFavorablePct: number;
  maxAdversePct: number;
  nearMiss: boolean; // Llegó a >50% del TP antes de perder
  immediateReversal: boolean; // Perdió en ≤3 velas
  
  // Time context
  hour: number; // UTC
  dayOfWeek: number; // 0=Sunday
  timestamp: number;
  
  // Distance to level
  distanceToLevel: number; // % desde precio de entrada al nivel
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS DETALLADO DE PÉRDIDAS - MTF Levels Strategy');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data: ${DATA_FILE}\n`);

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    process.exit(1);
  }

  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`✅ Cargadas ${candles.length} velas\n`);

  // Run backtest with "Both Directions No Trend Moderate" config
  const strategy = createMTFLevelsStrategy(ASSET, {
    requireTrendAlignment: false,
    allowedDirection: 'both',
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationMinMove: 0.2,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
  });

  console.log('🔄 Ejecutando backtest...\n');
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');

  console.log('='.repeat(80));
  console.log('RESUMEN GENERAL');
  console.log('='.repeat(80));
  console.log(`Total trades: ${trades.length}`);
  console.log(`Wins: ${wins.length} (${((wins.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Losses: ${losses.length} (${((losses.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%\n`);

  // Build detailed loss patterns
  const lossPatterns: LossPattern[] = [];

  for (const trade of losses) {
    const entry = trade.entry;
    const exit = trade.exit;
    const indicators = entry?.snapshot?.indicators || {};
    
    if (!entry || !exit) continue;

    const entryTime = new Date(entry.snapshot.timestamp);
    const barsHeld = Math.ceil((exit.durationMs || 0) / (60 * 1000));
    
    const levelPrice = (indicators.nearestLevel as number) || entry.executedPrice;
    const distanceToLevel = Math.abs(entry.executedPrice - levelPrice) / entry.executedPrice * 100;
    
    const maxFavorablePct = trade.result?.maxFavorablePct || 0;
    const maxAdversePct = Math.abs(trade.result?.maxAdversePct || 0);
    const nearMiss = maxFavorablePct >= 0.5 * 0.5 * 100; // 50% del TP (0.5%)
    const immediateReversal = barsHeld <= 3;

    lossPatterns.push({
      direction: trade.direction,
      entryPrice: entry.executedPrice,
      exitPrice: exit.executedPrice,
      pnl: trade.result?.pnl || 0,
      barsHeld,
      exitReason: exit.reason || 'UNKNOWN',
      rsi: (indicators.rsi as number) || 50,
      atr: (indicators.atr as number) || 0,
      levelType: (indicators.levelType as 'high' | 'low') || 'low',
      levelStrength: (indicators.levelStrength as number) || 0,
      levelPrice,
      trend5m: (indicators.trend5m as string) || 'sideways',
      trend15m: (indicators.trend15m as string) || 'sideways',
      maxFavorablePct,
      maxAdversePct,
      nearMiss,
      immediateReversal,
      hour: entryTime.getUTCHours(),
      dayOfWeek: entryTime.getUTCDay(),
      timestamp: entry.snapshot.timestamp,
      distanceToLevel,
    });
  }

  // ============================================================================
  // ANÁLISIS POR DIRECCIÓN
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR DIRECCIÓN');
  console.log('='.repeat(80));
  
  const callLosses = lossPatterns.filter(l => l.direction === 'CALL');
  const putLosses = lossPatterns.filter(l => l.direction === 'PUT');
  
  const callWins = wins.filter(w => w.direction === 'CALL');
  const putWins = wins.filter(w => w.direction === 'PUT');
  
  const callWR = callWins.length / (callWins.length + callLosses.length) * 100;
  const putWR = putWins.length / (putWins.length + putLosses.length) * 100;
  
  console.log(`CALL: ${callWins.length} wins, ${callLosses.length} losses (WR: ${callWR.toFixed(1)}%)`);
  console.log(`PUT:  ${putWins.length} wins, ${putLosses.length} losses (WR: ${putWR.toFixed(1)}%)`);
  console.log(`Avg Loss CALL: $${(callLosses.reduce((s, l) => s + l.pnl, 0) / callLosses.length || 0).toFixed(2)}`);
  console.log(`Avg Loss PUT:  $${(putLosses.reduce((s, l) => s + l.pnl, 0) / putLosses.length || 0).toFixed(2)}\n`);

  // ============================================================================
  // ANÁLISIS POR HORARIO
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR HORARIO (UTC)');
  console.log('='.repeat(80));
  
  const lossesByHour: Record<number, { count: number; totalPnl: number; avgPnl: number }> = {};
  
  for (const loss of lossPatterns) {
    if (!lossesByHour[loss.hour]) {
      lossesByHour[loss.hour] = { count: 0, totalPnl: 0, avgPnl: 0 };
    }
    lossesByHour[loss.hour].count++;
    lossesByHour[loss.hour].totalPnl += loss.pnl;
  }
  
  for (const hour in lossesByHour) {
    const h = parseInt(hour);
    const data = lossesByHour[h]!;
    data.avgPnl = data.totalPnl / data.count;
    console.log(`Hora ${h.toString().padStart(2, '0')}:00 - ${(h + 1).toString().padStart(2, '0')}:00: ${data.count} pérdidas, avg: $${data.avgPnl.toFixed(2)}`);
  }
  
  // Find worst hours
  const worstHours = Object.entries(lossesByHour)
    .sort((a, b) => a[1].avgPnl - b[1].avgPnl)
    .slice(0, 5);
  
  console.log(`\n⚠️  Peores horas para trading:`);
  worstHours.forEach(([hour, data]) => {
    console.log(`   ${hour}:00 - ${data.count} pérdidas, avg: $${data.avgPnl.toFixed(2)}`);
  });
  console.log('');

  // ============================================================================
  // ANÁLISIS POR DÍA DE SEMANA
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR DÍA DE SEMANA');
  console.log('='.repeat(80));
  
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const lossesByDay: Record<number, { count: number; totalPnl: number; avgPnl: number }> = {};
  
  for (const loss of lossPatterns) {
    if (!lossesByDay[loss.dayOfWeek]) {
      lossesByDay[loss.dayOfWeek] = { count: 0, totalPnl: 0, avgPnl: 0 };
    }
    lossesByDay[loss.dayOfWeek].count++;
    lossesByDay[loss.dayOfWeek].totalPnl += loss.pnl;
  }
  
  for (let day = 0; day < 7; day++) {
    const data = lossesByDay[day] || { count: 0, totalPnl: 0, avgPnl: 0 };
    if (data.count > 0) {
      data.avgPnl = data.totalPnl / data.count;
      console.log(`${dayNames[day]}: ${data.count} pérdidas, avg: $${data.avgPnl.toFixed(2)}`);
    }
  }
  console.log('');

  // ============================================================================
  // ANÁLISIS POR TIPO DE NIVEL
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR TIPO DE NIVEL');
  console.log('='.repeat(80));
  
  const supportLosses = lossPatterns.filter(l => l.levelType === 'low');
  const resistanceLosses = lossPatterns.filter(l => l.levelType === 'high');
  
  console.log(`Support (CALL): ${supportLosses.length} pérdidas`);
  console.log(`  Avg PnL: $${(supportLosses.reduce((s, l) => s + l.pnl, 0) / supportLosses.length || 0).toFixed(2)}`);
  console.log(`  Avg bars held: ${(supportLosses.reduce((s, l) => s + l.barsHeld, 0) / supportLosses.length || 0).toFixed(1)}`);
  
  console.log(`Resistance (PUT): ${resistanceLosses.length} pérdidas`);
  console.log(`  Avg PnL: $${(resistanceLosses.reduce((s, l) => s + l.pnl, 0) / resistanceLosses.length || 0).toFixed(2)}`);
  console.log(`  Avg bars held: ${(resistanceLosses.reduce((s, l) => s + l.barsHeld, 0) / resistanceLosses.length || 0).toFixed(1)}`);
  
  // By level strength
  const strength1 = lossPatterns.filter(l => l.levelStrength === 1); // 5m only
  const strength2 = lossPatterns.filter(l => l.levelStrength === 2); // 15m only
  const strength3 = lossPatterns.filter(l => l.levelStrength === 3); // both
  
  console.log(`\nPor fuerza del nivel:`);
  console.log(`  5m only: ${strength1.length} pérdidas, avg: $${(strength1.reduce((s, l) => s + l.pnl, 0) / strength1.length || 0).toFixed(2)}`);
  console.log(`  15m only: ${strength2.length} pérdidas, avg: $${(strength2.reduce((s, l) => s + l.pnl, 0) / strength2.length || 0).toFixed(2)}`);
  console.log(`  Both (5m+15m): ${strength3.length} pérdidas, avg: $${(strength3.reduce((s, l) => s + l.pnl, 0) / strength3.length || 0).toFixed(2)}`);
  console.log('');

  // ============================================================================
  // ANÁLISIS POR TENDENCIA
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR TENDENCIA');
  console.log('='.repeat(80));
  
  const trend5mGroups: Record<string, number[]> = {};
  const trend15mGroups: Record<string, number[]> = {};
  
  for (const loss of lossPatterns) {
    if (!trend5mGroups[loss.trend5m]) trend5mGroups[loss.trend5m] = [];
    if (!trend15mGroups[loss.trend15m]) trend15mGroups[loss.trend15m] = [];
    trend5mGroups[loss.trend5m].push(loss.pnl);
    trend15mGroups[loss.trend15m].push(loss.pnl);
  }
  
  console.log('Tendencia 5m:');
  for (const trend in trend5mGroups) {
    const pnls = trend5mGroups[trend]!;
    const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    console.log(`  ${trend}: ${pnls.length} pérdidas, avg: $${avg.toFixed(2)}`);
  }
  
  console.log('\nTendencia 15m:');
  for (const trend in trend15mGroups) {
    const pnls = trend15mGroups[trend]!;
    const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    console.log(`  ${trend}: ${pnls.length} pérdidas, avg: $${avg.toFixed(2)}`);
  }
  
  // Trades contra tendencia
  const callInDowntrend = lossPatterns.filter(l => 
    l.direction === 'CALL' && (l.trend15m === 'down' || l.trend5m === 'down')
  );
  const putInUptrend = lossPatterns.filter(l => 
    l.direction === 'PUT' && (l.trend15m === 'up' || l.trend5m === 'up')
  );
  
  console.log(`\n⚠️  Trades contra tendencia:`);
  console.log(`  CALL en downtrend: ${callInDowntrend.length} pérdidas, avg: $${(callInDowntrend.reduce((s, l) => s + l.pnl, 0) / callInDowntrend.length || 0).toFixed(2)}`);
  console.log(`  PUT en uptrend: ${putInUptrend.length} pérdidas, avg: $${(putInUptrend.reduce((s, l) => s + l.pnl, 0) / putInUptrend.length || 0).toFixed(2)}`);
  console.log('');

  // ============================================================================
  // ANÁLISIS POR RSI
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR RSI');
  console.log('='.repeat(80));
  
  const rsiZones = {
    oversold: lossPatterns.filter(l => l.rsi < 30),
    neutralLow: lossPatterns.filter(l => l.rsi >= 30 && l.rsi < 50),
    neutralHigh: lossPatterns.filter(l => l.rsi >= 50 && l.rsi <= 70),
    overbought: lossPatterns.filter(l => l.rsi > 70),
  };
  
  console.log(`Oversold (<30): ${rsiZones.oversold.length} pérdidas, avg: $${(rsiZones.oversold.reduce((s, l) => s + l.pnl, 0) / rsiZones.oversold.length || 0).toFixed(2)}`);
  console.log(`Neutral Low (30-50): ${rsiZones.neutralLow.length} pérdidas, avg: $${(rsiZones.neutralLow.reduce((s, l) => s + l.pnl, 0) / rsiZones.neutralLow.length || 0).toFixed(2)}`);
  console.log(`Neutral High (50-70): ${rsiZones.neutralHigh.length} pérdidas, avg: $${(rsiZones.neutralHigh.reduce((s, l) => s + l.pnl, 0) / rsiZones.neutralHigh.length || 0).toFixed(2)}`);
  console.log(`Overbought (>70): ${rsiZones.overbought.length} pérdidas, avg: $${(rsiZones.overbought.reduce((s, l) => s + l.pnl, 0) / rsiZones.overbought.length || 0).toFixed(2)}`);
  console.log('');

  // ============================================================================
  // ANÁLISIS DE COMPORTAMIENTO DEL TRADE
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS DE COMPORTAMIENTO DEL TRADE');
  console.log('='.repeat(80));
  
  const nearMisses = lossPatterns.filter(l => l.nearMiss);
  const immediateReversals = lossPatterns.filter(l => l.immediateReversal);
  
  console.log(`Near Misses (>50% TP antes de perder): ${nearMisses.length} (${((nearMisses.length / lossPatterns.length) * 100).toFixed(1)}%)`);
  console.log(`  Avg PnL: $${(nearMisses.reduce((s, l) => s + l.pnl, 0) / nearMisses.length || 0).toFixed(2)}`);
  console.log(`  Avg Max Favorable: ${(nearMisses.reduce((s, l) => s + l.maxFavorablePct, 0) / nearMisses.length || 0).toFixed(2)}%`);
  
  console.log(`\nImmediate Reversals (≤3 velas): ${immediateReversals.length} (${((immediateReversals.length / lossPatterns.length) * 100).toFixed(1)}%)`);
  console.log(`  Avg PnL: $${(immediateReversals.reduce((s, l) => s + l.pnl, 0) / immediateReversals.length || 0).toFixed(2)}`);
  
  // Exit reasons
  const exitReasons: Record<string, number> = {};
  for (const loss of lossPatterns) {
    exitReasons[loss.exitReason] = (exitReasons[loss.exitReason] || 0) + 1;
  }
  
  console.log(`\nRazones de salida:`);
  for (const reason in exitReasons) {
    console.log(`  ${reason}: ${exitReasons[reason]} (${((exitReasons[reason]! / lossPatterns.length) * 100).toFixed(1)}%)`);
  }
  console.log('');

  // ============================================================================
  // ANÁLISIS DE DISTANCIA AL NIVEL
  // ============================================================================
  console.log('='.repeat(80));
  console.log('ANÁLISIS DE DISTANCIA AL NIVEL');
  console.log('='.repeat(80));
  
  const closeToLevel = lossPatterns.filter(l => l.distanceToLevel < 0.1); // <0.1%
  const mediumDistance = lossPatterns.filter(l => l.distanceToLevel >= 0.1 && l.distanceToLevel < 0.3);
  const farFromLevel = lossPatterns.filter(l => l.distanceToLevel >= 0.3);
  
  console.log(`Muy cerca del nivel (<0.1%): ${closeToLevel.length} pérdidas, avg: $${(closeToLevel.reduce((s, l) => s + l.pnl, 0) / closeToLevel.length || 0).toFixed(2)}`);
  console.log(`Distancia media (0.1-0.3%): ${mediumDistance.length} pérdidas, avg: $${(mediumDistance.reduce((s, l) => s + l.pnl, 0) / mediumDistance.length || 0).toFixed(2)}`);
  console.log(`Lejos del nivel (>0.3%): ${farFromLevel.length} pérdidas, avg: $${(farFromLevel.reduce((s, l) => s + l.pnl, 0) / farFromLevel.length || 0).toFixed(2)}`);
  console.log('');

  // ============================================================================
  // RECOMENDACIONES
  // ============================================================================
  console.log('='.repeat(80));
  console.log('RECOMENDACIONES');
  console.log('='.repeat(80));
  
  const recommendations: string[] = [];
  
  // Direction filter
  if (Math.abs(callWR - putWR) > 5) {
    const better = callWR > putWR ? 'CALL' : 'PUT';
    recommendations.push(`✅ Considerar filtrar ${better === 'CALL' ? 'PUT' : 'CALL'}: ${better} tiene ${Math.abs(callWR - putWR).toFixed(1)}% mejor WR`);
  }
  
  // Trend filter
  if (callInDowntrend.length > lossPatterns.length * 0.15) {
    recommendations.push(`✅ Evitar CALL en downtrend: ${callInDowntrend.length} pérdidas (${((callInDowntrend.length / lossPatterns.length) * 100).toFixed(1)}%)`);
  }
  if (putInUptrend.length > lossPatterns.length * 0.15) {
    recommendations.push(`✅ Evitar PUT en uptrend: ${putInUptrend.length} pérdidas (${((putInUptrend.length / lossPatterns.length) * 100).toFixed(1)}%)`);
  }
  
  // Time filter
  if (worstHours.length > 0) {
    const worstHour = worstHours[0]!;
    recommendations.push(`✅ Considerar evitar hora ${worstHour[0]}:00 UTC: ${worstHour[1].count} pérdidas, avg $${worstHour[1].avgPnl.toFixed(2)}`);
  }
  
  // Level strength filter
  if (strength1.length > strength3.length * 2) {
    recommendations.push(`✅ Considerar filtrar niveles solo de 5m: ${strength1.length} pérdidas vs ${strength3.length} en niveles de ambos timeframes`);
  }
  
  // Distance to level
  if (farFromLevel.length > closeToLevel.length) {
    recommendations.push(`✅ Aumentar levelTolerance o mejorar detección: muchas pérdidas lejos del nivel`);
  }
  
  // Immediate reversals
  if (immediateReversals.length > lossPatterns.length * 0.2) {
    recommendations.push(`✅ Aumentar confirmationBars: ${((immediateReversals.length / lossPatterns.length) * 100).toFixed(1)}% son reversiones inmediatas`);
  }
  
  if (recommendations.length === 0) {
    console.log('No hay recomendaciones específicas basadas en el análisis.');
  } else {
    recommendations.forEach(r => console.log(r));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

