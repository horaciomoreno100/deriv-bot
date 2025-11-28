#!/usr/bin/env tsx
/**
 * Analizar trades para optimizar TP/SL y calcular esperanza matemática
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
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '7', 10);

interface TradeAnalysis {
  direction: 'CALL' | 'PUT';
  outcome: 'WIN' | 'LOSS';
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  duration: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  exitReason: string;
  atr: number;
  rsi: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS TP/SL Y ESPERANZA MATEMÁTICA');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Días: ${DAYS_TO_ANALYZE}\n`);

  // Load data
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

  console.log(`📅 Analizando ${candles.length} velas (${DAYS_TO_ANALYZE} días)\n`);

  // Run backtest with best combination
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
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  });

  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  console.log(`Total trades: ${trades.length}`);
  console.log(`Wins: ${trades.filter(t => t.result?.outcome === 'WIN').length}`);
  console.log(`Losses: ${trades.filter(t => t.result?.outcome === 'LOSS').length}`);
  console.log(`Win Rate: ${result.metrics.winRate.toFixed(1)}%\n`);

  // Analyze trades
  const analyses: TradeAnalysis[] = [];

  for (const trade of trades) {
    const entry = trade.entry;
    const exit = trade.exit;
    const indicators = entry.snapshot.indicators || {};
    
    analyses.push({
      direction: trade.direction,
      outcome: trade.result?.outcome || 'LOSS',
      pnl: trade.result?.pnl || 0,
      entryPrice: entry.executedPrice,
      exitPrice: exit.executedPrice,
      duration: exit.snapshot.candle?.index! - entry.snapshot.candle?.index!,
      maxFavorablePct: trade.result?.maxFavorablePct || 0,
      maxAdversePct: trade.result?.maxAdversePct || 0,
      exitReason: trade.result?.exitReason || 'unknown',
      atr: (indicators.atr as number) || 0,
      rsi: (indicators.rsi as number) || 50,
    });
  }

  const wins = analyses.filter(a => a.outcome === 'WIN');
  const losses = analyses.filter(a => a.outcome === 'LOSS');

  // 1. ESPERANZA MATEMÁTICA ACTUAL
  console.log('='.repeat(80));
  console.log('1. ESPERANZA MATEMÁTICA ACTUAL');
  console.log('='.repeat(80));
  
  const winRate = wins.length / trades.length;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
  
  // Esperanza matemática = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
  const expectedValue = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  
  console.log(`Win Rate: ${(winRate * 100).toFixed(1)}%`);
  console.log(`Promedio Win: $${avgWin.toFixed(2)}`);
  console.log(`Promedio Loss: $${avgLoss.toFixed(2)}`);
  console.log(`Esperanza Matemática: $${expectedValue.toFixed(2)} por trade`);
  console.log(`Esperanza en ${trades.length} trades: $${(expectedValue * trades.length).toFixed(2)}`);
  console.log('');

  // 2. ANÁLISIS DE WINS
  console.log('='.repeat(80));
  console.log('2. ANÁLISIS DE WINS - ¿Podemos maximizar?');
  console.log('='.repeat(80));
  
  const winMaxFav = wins.map(t => t.maxFavorablePct);
  const avgMaxFavWin = winMaxFav.reduce((a, b) => a + b, 0) / winMaxFav.length;
  const maxMaxFavWin = Math.max(...winMaxFav);
  const minMaxFavWin = Math.min(...winMaxFav);
  
  console.log(`Max Favorable promedio en WINS: ${avgMaxFavWin.toFixed(2)}%`);
  console.log(`Max Favorable máximo: ${maxMaxFavWin.toFixed(2)}%`);
  console.log(`Max Favorable mínimo: ${minMaxFavWin.toFixed(2)}%`);
  console.log(`TP actual: 0.4%`);
  
  // Analizar cuántos wins alcanzaron el TP
  const winsReachedTP = wins.filter(t => t.maxFavorablePct >= 0.4).length;
  const winsDidNotReachTP = wins.length - winsReachedTP;
  console.log(`Wins que alcanzaron TP (0.4%): ${winsReachedTP} / ${wins.length}`);
  console.log(`Wins que NO alcanzaron TP: ${winsDidNotReachTP} / ${wins.length}`);
  
  if (avgMaxFavWin < 0.4) {
    console.log(`⚠️  TP actual (0.4%) es MAYOR que max favorable promedio (${avgMaxFavWin.toFixed(2)}%)`);
    console.log(`   → Muchos wins no alcanzan el TP, salen por timeout o SL`);
  } else {
    const opportunityLost = avgMaxFavWin - 0.4;
    console.log(`Oportunidad perdida promedio: ${opportunityLost.toFixed(2)}%`);
    console.log(`Si TP fuera ${avgMaxFavWin.toFixed(2)}%: +${((opportunityLost / 0.4) * avgWin).toFixed(2)} por win`);
  }
  console.log('');

  // 3. ANÁLISIS DE LOSSES
  console.log('='.repeat(80));
  console.log('3. ANÁLISIS DE LOSSES - ¿Podemos reducir?');
  console.log('='.repeat(80));
  
  const lossMaxAdv = losses.map(t => t.maxAdversePct);
  const avgMaxAdvLoss = lossMaxAdv.reduce((a, b) => a + b, 0) / lossMaxAdv.length;
  const maxMaxAdvLoss = Math.max(...lossMaxAdv);
  const minMaxAdvLoss = Math.min(...lossMaxAdv);
  
  console.log(`Max Adverse promedio en LOSSES: ${avgMaxAdvLoss.toFixed(2)}%`);
  console.log(`Max Adverse máximo: ${maxMaxAdvLoss.toFixed(2)}%`);
  console.log(`Max Adverse mínimo: ${minMaxAdvLoss.toFixed(2)}%`);
  console.log(`SL actual: 0.3%`);
  console.log(`Pérdida promedio: $${avgLoss.toFixed(2)}`);
  console.log('');

  // 4. ANÁLISIS DE DURACIÓN
  console.log('='.repeat(80));
  console.log('4. ANÁLISIS DE DURACIÓN');
  console.log('='.repeat(80));
  
  const winDurations = wins.map(t => t.duration);
  const lossDurations = losses.map(t => t.duration);
  
  const avgWinDuration = winDurations.reduce((a, b) => a + b, 0) / winDurations.length;
  const avgLossDuration = lossDurations.reduce((a, b) => a + b, 0) / lossDurations.length;
  
  console.log(`Duración promedio WINS: ${avgWinDuration.toFixed(1)} velas`);
  console.log(`Duración promedio LOSSES: ${avgLossDuration.toFixed(1)} velas`);
  console.log('');

  // 5. ANÁLISIS POR DIRECCIÓN
  console.log('='.repeat(80));
  console.log('5. ANÁLISIS POR DIRECCIÓN');
  console.log('='.repeat(80));
  
  const callWins = wins.filter(t => t.direction === 'CALL');
  const callLosses = losses.filter(t => t.direction === 'CALL');
  const putWins = wins.filter(t => t.direction === 'PUT');
  const putLosses = losses.filter(t => t.direction === 'PUT');
  
  if (callWins.length > 0 || callLosses.length > 0) {
    const callWR = callWins.length / (callWins.length + callLosses.length);
    const callAvgWin = callWins.reduce((sum, t) => sum + t.pnl, 0) / callWins.length;
    const callAvgLoss = callLosses.length > 0 ? Math.abs(callLosses.reduce((sum, t) => sum + t.pnl, 0) / callLosses.length) : 0;
    console.log(`CALL: ${callWins.length}W / ${callLosses.length}L (WR: ${(callWR * 100).toFixed(1)}%)`);
    console.log(`  Avg Win: $${callAvgWin.toFixed(2)}, Avg Loss: $${callAvgLoss.toFixed(2)}`);
  }
  
  if (putWins.length > 0 || putLosses.length > 0) {
    const putWR = putWins.length / (putWins.length + putLosses.length);
    const putAvgWin = putWins.reduce((sum, t) => sum + t.pnl, 0) / putWins.length;
    const putAvgLoss = putLosses.length > 0 ? Math.abs(putLosses.reduce((sum, t) => sum + t.pnl, 0) / putLosses.length) : 0;
    console.log(`PUT: ${putWins.length}W / ${putLosses.length}L (WR: ${(putWR * 100).toFixed(1)}%)`);
    console.log(`  Avg Win: $${putAvgWin.toFixed(2)}, Avg Loss: $${putAvgLoss.toFixed(2)}`);
  }
  console.log('');

  // 6. RECOMENDACIONES
  console.log('='.repeat(80));
  console.log('6. RECOMENDACIONES PARA OPTIMIZAR');
  console.log('='.repeat(80));
  
  // Si el max favorable promedio es menor que el TP actual, reducir TP
  // Si es mayor, considerar trailing stop o TP más alto
  let optimalTP = 0.004; // Mantener actual por defecto
  let tpRecommendation = '';
  
  if (avgMaxFavWin < 0.004) { // 0.4% en decimal
    // TP muy alto, muchos no lo alcanzan
    optimalTP = Math.max(avgMaxFavWin * 0.9, 0.002); // 90% del max favorable, mínimo 0.2%
    tpRecommendation = `Reducir TP a ${(optimalTP * 100).toFixed(2)}% para capturar más wins`;
  } else if (avgMaxFavWin > 0.005) { // 0.5% en decimal
    // Hay espacio para más ganancia
    optimalTP = Math.min(avgMaxFavWin * 0.85, 0.006); // 85% del max favorable, máximo 0.6%
    tpRecommendation = `Aumentar TP a ${(optimalTP * 100).toFixed(2)}% o usar trailing stop`;
  } else {
    tpRecommendation = `TP actual (0.4%) está bien, considerar trailing stop`;
  }
  
  // SL: reducir si el max adverse promedio es menor
  let optimalSL = 0.003; // Mantener actual por defecto
  let slRecommendation = '';
  
  if (avgMaxAdvLoss < 0.003) { // 0.3% en decimal
    optimalSL = Math.max(avgMaxAdvLoss * 1.1, 0.002); // 10% más que max adverse, mínimo 0.2%
    slRecommendation = `Reducir SL a ${(optimalSL * 100).toFixed(2)}% para reducir pérdidas`;
  } else {
    slRecommendation = `SL actual (0.3%) está bien`;
  }
  
  console.log(`TP actual: 0.4%`);
  console.log(`Max Favorable promedio: ${(avgMaxFavWin * 100).toFixed(2)}%`);
  console.log(`Recomendación: ${tpRecommendation}`);
  console.log('');
  
  console.log(`SL actual: 0.3%`);
  console.log(`Max Adverse promedio: ${(avgMaxAdvLoss * 100).toFixed(2)}%`);
  console.log(`Recomendación: ${slRecommendation}`);
  console.log('');
  
  // Calcular nueva esperanza matemática solo si hay cambios significativos
  if (Math.abs(optimalTP - 0.004) > 0.001 || Math.abs(optimalSL - 0.003) > 0.001) {
    // Si reducimos TP, cada win ganará menos pero capturaremos más wins
    // Estimación: si TP baja, avgWin baja proporcionalmente
    // TP actual es 0.4% (0.004), nuevo TP es optimalTP (ya en decimal)
    const newAvgWin = avgWin * (optimalTP / 0.004);
    
    // Si reducimos SL, cada loss perderá menos
    // SL actual es 0.3% (0.003), nuevo SL es optimalSL (ya en decimal)
    const newAvgLoss = avgLoss * (optimalSL / 0.003);
    
    // Si reducimos TP, más trades alcanzarán el TP (aumenta win rate)
    // Estimación conservadora: si TP baja de 0.4% a 0.23%, win rate podría subir 5-10%
    let newWinRate = winRate;
    if (optimalTP < 0.004) {
      // Si TP es más alcanzable, más wins
      const tpReduction = (0.004 - optimalTP) / 0.004; // % de reducción
      newWinRate = Math.min(winRate + (tpReduction * 0.1), 0.75); // Máximo 75% WR
    }
    
    const newExpectedValue = (newWinRate * newAvgWin) - ((1 - newWinRate) * newAvgLoss);
    
    console.log(`Esperanza Matemática ACTUAL: $${expectedValue.toFixed(2)} por trade`);
    console.log(`  Win Rate: ${(winRate * 100).toFixed(1)}%, Avg Win: $${avgWin.toFixed(2)}, Avg Loss: $${avgLoss.toFixed(2)}`);
    console.log(`Esperanza Matemática con TP=${(optimalTP * 100).toFixed(2)}% / SL=${(optimalSL * 100).toFixed(2)}%: $${newExpectedValue.toFixed(2)} por trade`);
    console.log(`  Win Rate estimado: ${(newWinRate * 100).toFixed(1)}%, Avg Win: $${newAvgWin.toFixed(2)}, Avg Loss: $${newAvgLoss.toFixed(2)}`);
    console.log(`Mejora estimada: +$${(newExpectedValue - expectedValue).toFixed(2)} por trade`);
    console.log(`Mejora en ${trades.length} trades: +$${((newExpectedValue - expectedValue) * trades.length).toFixed(2)}`);
    console.log('');
    console.log(`⚠️  NOTA: Estos son cálculos estimados. Probar en backtest para validar.`);
  } else {
    console.log(`TP/SL actuales están bien optimizados`);
  }
  console.log('');

  // 7. ANÁLISIS DE EXIT REASONS
  console.log('='.repeat(80));
  console.log('7. RAZONES DE SALIDA');
  console.log('='.repeat(80));
  
  const exitReasons: Record<string, { wins: number; losses: number; totalPnl: number }> = {};
  
  for (const a of analyses) {
    if (!exitReasons[a.exitReason]) {
      exitReasons[a.exitReason] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    if (a.outcome === 'WIN') exitReasons[a.exitReason].wins++;
    else exitReasons[a.exitReason].losses++;
    exitReasons[a.exitReason].totalPnl += a.pnl;
  }
  
  for (const [reason, stats] of Object.entries(exitReasons)) {
    const total = stats.wins + stats.losses;
    const wr = (stats.wins / total) * 100;
    console.log(`${reason.padEnd(20)}: ${stats.wins}W / ${stats.losses}L (${total} total) - WR: ${wr.toFixed(1)}% - PnL: $${stats.totalPnl.toFixed(2)}`);
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

