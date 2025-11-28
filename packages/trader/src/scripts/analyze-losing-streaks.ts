#!/usr/bin/env tsx
/**
 * Analizar rachas perdedoras y cómo manejarlas
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

interface Streak {
  type: 'winning' | 'losing';
  length: number;
  startIndex: number;
  endIndex: number;
  totalPnL: number;
  maxDrawdown: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS DE RACHAS PERDEDORAS');
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

  // Run backtest with optimized settings
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
    takeProfitPct: 0.0023, // Optimizado
    stopLossPct: 0.0025,   // Optimizado
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
  console.log(`Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%\n`);

  // 1. ANALIZAR RACHAS
  console.log('='.repeat(80));
  console.log('1. ANÁLISIS DE RACHAS');
  console.log('='.repeat(80));
  
  const streaks: Streak[] = [];
  let currentStreak: Streak | null = null;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!;
    const outcome = trade.result?.outcome || 'LOSS';
    const pnl = trade.result?.pnl || 0;
    const isWin = outcome === 'WIN';
    const streakType = isWin ? 'winning' : 'losing';

    if (!currentStreak || currentStreak.type !== streakType) {
      // Nueva racha
      if (currentStreak) {
        streaks.push(currentStreak);
      }
      currentStreak = {
        type: streakType,
        length: 1,
        startIndex: i,
        endIndex: i,
        totalPnL: pnl,
        maxDrawdown: isWin ? 0 : Math.abs(pnl),
      };
    } else {
      // Continuar racha
      currentStreak.length++;
      currentStreak.endIndex = i;
      currentStreak.totalPnL += pnl;
      if (!isWin) {
        currentStreak.maxDrawdown = Math.max(currentStreak.maxDrawdown, Math.abs(currentStreak.totalPnL));
      }
    }
  }
  
  if (currentStreak) {
    streaks.push(currentStreak);
  }

  const losingStreaks = streaks.filter(s => s.type === 'losing');
  const winningStreaks = streaks.filter(s => s.type === 'winning');

  console.log(`Total rachas: ${streaks.length}`);
  console.log(`Rachas ganadoras: ${winningStreaks.length}`);
  console.log(`Rachas perdedoras: ${losingStreaks.length}`);
  console.log('');

  // Estadísticas de rachas perdedoras
  if (losingStreaks.length > 0) {
    const maxLosingStreak = Math.max(...losingStreaks.map(s => s.length));
    const avgLosingStreak = losingStreaks.reduce((sum, s) => sum + s.length, 0) / losingStreaks.length;
    const maxLosingStreakPnL = Math.min(...losingStreaks.map(s => s.totalPnL));
    const avgLosingStreakPnL = losingStreaks.reduce((sum, s) => sum + s.totalPnL, 0) / losingStreaks.length;

    console.log('RACHAS PERDEDORAS:');
    console.log(`  Máxima racha perdedora: ${maxLosingStreak} trades consecutivos`);
    console.log(`  Promedio de rachas perdedoras: ${avgLosingStreak.toFixed(1)} trades`);
    console.log(`  Pérdida máxima en una racha: $${Math.abs(maxLosingStreakPnL).toFixed(2)}`);
    console.log(`  Pérdida promedio por racha: $${Math.abs(avgLosingStreakPnL).toFixed(2)}`);
    console.log('');

    // Mostrar las peores rachas
    const worstStreaks = [...losingStreaks].sort((a, b) => a.totalPnL - b.totalPnL).slice(0, 5);
    console.log('PEORES RACHAS PERDEDORAS:');
    for (let i = 0; i < worstStreaks.length; i++) {
      const streak = worstStreaks[i]!;
      console.log(`  ${i + 1}. ${streak.length} trades consecutivos: -$${Math.abs(streak.totalPnL).toFixed(2)} (trades ${streak.startIndex + 1}-${streak.endIndex + 1})`);
    }
    console.log('');
  }

  // Estadísticas de rachas ganadoras
  if (winningStreaks.length > 0) {
    const maxWinningStreak = Math.max(...winningStreaks.map(s => s.length));
    const avgWinningStreak = winningStreaks.reduce((sum, s) => sum + s.length, 0) / winningStreaks.length;
    const maxWinningStreakPnL = Math.max(...winningStreaks.map(s => s.totalPnL));
    const avgWinningStreakPnL = winningStreaks.reduce((sum, s) => sum + s.totalPnL, 0) / winningStreaks.length;

    console.log('RACHAS GANADORAS:');
    console.log(`  Máxima racha ganadora: ${maxWinningStreak} trades consecutivos`);
    console.log(`  Promedio de rachas ganadoras: ${avgWinningStreak.toFixed(1)} trades`);
    console.log(`  Ganancia máxima en una racha: $${maxWinningStreakPnL.toFixed(2)}`);
    console.log(`  Ganancia promedio por racha: $${avgWinningStreakPnL.toFixed(2)}`);
    console.log('');
  }

  // 2. ANÁLISIS DE DRAWDOWN
  console.log('='.repeat(80));
  console.log('2. ANÁLISIS DE DRAWDOWN');
  console.log('='.repeat(80));
  
  let balance = 1000;
  let peak = balance;
  let maxDrawdown = 0;
  let maxDrawdownStart = 0;
  let maxDrawdownEnd = 0;
  let currentDrawdown = 0;
  let currentDrawdownStart = 0;
  const drawdowns: Array<{ start: number; end: number; depth: number; pct: number }> = [];

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!;
    const pnl = trade.result?.pnl || 0;
    balance += pnl;

    if (balance > peak) {
      peak = balance;
      if (currentDrawdown > 0) {
        // Drawdown terminó
        drawdowns.push({
          start: currentDrawdownStart,
          end: i,
          depth: currentDrawdown,
          pct: (currentDrawdown / (balance - currentDrawdown)) * 100,
        });
        currentDrawdown = 0;
      }
    } else {
      const dd = peak - balance;
      if (currentDrawdown === 0) {
        currentDrawdownStart = i;
      }
      currentDrawdown = dd;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownStart = currentDrawdownStart;
        maxDrawdownEnd = i;
      }
    }
  }

  console.log(`Drawdown máximo: $${maxDrawdown.toFixed(2)} (${((maxDrawdown / 1000) * 100).toFixed(1)}%)`);
  console.log(`Drawdown máximo: trades ${maxDrawdownStart + 1} a ${maxDrawdownEnd + 1}`);
  console.log(`Total de drawdowns: ${drawdowns.length}`);
  
  if (drawdowns.length > 0) {
    const avgDrawdown = drawdowns.reduce((sum, dd) => sum + dd.depth, 0) / drawdowns.length;
    const maxDrawdownPct = Math.max(...drawdowns.map(dd => dd.pct));
    console.log(`Drawdown promedio: $${avgDrawdown.toFixed(2)} (${(avgDrawdown / 1000 * 100).toFixed(1)}%)`);
    console.log(`Drawdown máximo %: ${maxDrawdownPct.toFixed(1)}%`);
  }
  console.log('');

  // 3. DISTRIBUCIÓN DE PÉRDIDAS
  console.log('='.repeat(80));
  console.log('3. DISTRIBUCIÓN DE PÉRDIDAS');
  console.log('='.repeat(80));
  
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');
  const lossAmounts = losses.map(t => Math.abs(t.result?.pnl || 0)).sort((a, b) => a - b);
  
  if (lossAmounts.length > 0) {
    const medianLoss = lossAmounts[Math.floor(lossAmounts.length / 2)]!;
    const q75Loss = lossAmounts[Math.floor(lossAmounts.length * 0.75)]!;
    const q90Loss = lossAmounts[Math.floor(lossAmounts.length * 0.9)]!;
    const maxLoss = Math.max(...lossAmounts);

    console.log(`Pérdida mediana: $${medianLoss.toFixed(2)}`);
    console.log(`Pérdida percentil 75: $${q75Loss.toFixed(2)}`);
    console.log(`Pérdida percentil 90: $${q90Loss.toFixed(2)}`);
    console.log(`Pérdida máxima: $${maxLoss.toFixed(2)}`);
    console.log('');
  }

  // 4. RECOMENDACIONES
  console.log('='.repeat(80));
  console.log('4. RECOMENDACIONES PARA MANEJAR RACHAS PERDEDORAS');
  console.log('='.repeat(80));
  
  if (losingStreaks.length > 0) {
    const maxLosingStreak = Math.max(...losingStreaks.map(s => s.length));
    const maxLosingStreakPnL = Math.min(...losingStreaks.map(s => s.totalPnL));
    
    console.log('ESTRATEGIAS DE PROTECCIÓN:');
    console.log('');
    
    console.log('1. REDUCCIÓN DE TAMAÑO DE POSICIÓN:');
    console.log(`   • Después de ${Math.floor(maxLosingStreak * 0.5)} pérdidas consecutivas, reducir stake a 50%`);
    console.log(`   • Después de ${maxLosingStreak} pérdidas consecutivas, reducir stake a 25%`);
    console.log('');
    
    console.log('2. PAUSA DESPUÉS DE RACHAS PERDEDORAS:');
    console.log(`   • Después de ${maxLosingStreak} pérdidas consecutivas, pausar trading por 1-2 horas`);
    console.log(`   • Re-evaluar condiciones de mercado antes de continuar`);
    console.log('');
    
    console.log('3. LÍMITE DE DRAWDOWN:');
    console.log(`   • Si drawdown excede ${((maxDrawdown / 1000) * 100).toFixed(0)}%, reducir tamaño de posición`);
    console.log(`   • Si drawdown excede ${((maxDrawdown / 1000) * 100 * 1.5).toFixed(0)}%, pausar trading`);
    console.log('');
    
    console.log('4. GESTIÓN DE CAPITAL:');
    console.log(`   • Pérdida máxima en racha: $${Math.abs(maxLosingStreakPnL).toFixed(2)}`);
    console.log(`   • Asegurar que el capital pueda soportar ${maxLosingStreak} pérdidas consecutivas`);
    console.log(`   • Capital mínimo recomendado: $${(Math.abs(maxLosingStreakPnL) * 3).toFixed(2)}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

