#!/usr/bin/env tsx
/**
 * Análisis profundo de la combinación ganadora para aprender más
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

interface TradeAnalysis {
  direction: 'CALL' | 'PUT';
  outcome: 'WIN' | 'LOSS';
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  duration: number;
  
  // Entry conditions
  rsi: number;
  bbPosition: number; // 0-100% position in BB
  levelType: 'high' | 'low';
  levelStrength: number;
  trend5m: string;
  trend15m: string;
  againstTrend: boolean;
  
  // Price action
  maxFavorablePct: number;
  maxAdversePct: number;
  exitReason: string;
  
  // Bounce characteristics
  bounceStrength: number;
  confirmationBars: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS PROFUNDO - COMBINACIÓN GANADORA');
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

  console.log(`📅 Analizando ${candles.length} velas (${DAYS_TO_ANALYZE} día)\n`);

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
  console.log(`Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor.toFixed(2)}\n`);

  // Analyze each trade
  const analyses: TradeAnalysis[] = [];

  for (const trade of trades) {
    const entry = trade.entry;
    const exit = trade.exit;
    const indicators = entry.snapshot.indicators || {};
    
    const bbUpper = indicators.bbUpper as number | undefined;
    const bbLower = indicators.bbLower as number | undefined;
    const bbMiddle = indicators.bbMiddle as number | undefined;
    
    let bbPosition = 50;
    if (bbUpper && bbLower && bbMiddle) {
      bbPosition = ((entry.executedPrice - bbLower) / (bbUpper - bbLower)) * 100;
    }
    
    const trend5m = (indicators.trend5m as string) || 'sideways';
    const trend15m = (indicators.trend15m as string) || 'sideways';
    const againstTrend = 
      (trade.direction === 'CALL' && (trend15m === 'down' || trend5m === 'down')) ||
      (trade.direction === 'PUT' && (trend15m === 'up' || trend5m === 'up'));
    
    const levelType = (indicators.levelType as 'high' | 'low') || 'low';
    const levelStrength = (indicators.levelStrength as number) || 0;
    
    analyses.push({
      direction: trade.direction,
      outcome: trade.result?.outcome || 'LOSS',
      pnl: trade.result?.pnl || 0,
      entryPrice: entry.executedPrice,
      exitPrice: exit.executedPrice,
      duration: exit.snapshot.candle?.index! - entry.snapshot.candle?.index!,
      rsi: (indicators.rsi as number) || 50,
      bbPosition,
      levelType,
      levelStrength,
      trend5m,
      trend15m,
      againstTrend,
      maxFavorablePct: trade.result?.maxFavorablePct || 0,
      maxAdversePct: trade.result?.maxAdversePct || 0,
      exitReason: trade.result?.exitReason || 'unknown',
      bounceStrength: 0.5, // Fixed for this config
      confirmationBars: 1,
    });
  }

  // Analysis 1: RSI distribution
  console.log('='.repeat(80));
  console.log('ANÁLISIS 1: DISTRIBUCIÓN DE RSI');
  console.log('='.repeat(80));
  
  const wins = analyses.filter(a => a.outcome === 'WIN');
  const losses = analyses.filter(a => a.outcome === 'LOSS');
  
  const avgRsiWin = wins.reduce((sum, a) => sum + a.rsi, 0) / wins.length;
  const avgRsiLoss = losses.reduce((sum, a) => sum + a.rsi, 0) / losses.length;
  
  console.log(`RSI promedio en WINS: ${avgRsiWin.toFixed(1)}`);
  console.log(`RSI promedio en LOSSES: ${avgRsiLoss.toFixed(1)}`);
  console.log(`Diferencia: ${(avgRsiWin - avgRsiLoss).toFixed(1)}`);
  console.log('');
  
  // RSI zones
  const rsiZones = {
    oversold: { wins: 0, losses: 0, label: 'RSI < 30' },
    low: { wins: 0, losses: 0, label: 'RSI 30-40' },
    mid: { wins: 0, losses: 0, label: 'RSI 40-60' },
    high: { wins: 0, losses: 0, label: 'RSI 60-70' },
    overbought: { wins: 0, losses: 0, label: 'RSI > 70' },
  };
  
  for (const a of analyses) {
    if (a.rsi < 30) {
      if (a.outcome === 'WIN') rsiZones.oversold.wins++;
      else rsiZones.oversold.losses++;
    } else if (a.rsi < 40) {
      if (a.outcome === 'WIN') rsiZones.low.wins++;
      else rsiZones.low.losses++;
    } else if (a.rsi < 60) {
      if (a.outcome === 'WIN') rsiZones.mid.wins++;
      else rsiZones.mid.losses++;
    } else if (a.rsi < 70) {
      if (a.outcome === 'WIN') rsiZones.high.wins++;
      else rsiZones.high.losses++;
    } else {
      if (a.outcome === 'WIN') rsiZones.overbought.wins++;
      else rsiZones.overbought.losses++;
    }
  }
  
  for (const [key, zone] of Object.entries(rsiZones)) {
    const total = zone.wins + zone.losses;
    if (total > 0) {
      const wr = (zone.wins / total) * 100;
      console.log(`${zone.label.padEnd(15)}: ${zone.wins}W / ${zone.losses}L (${total} total) - WR: ${wr.toFixed(1)}%`);
    }
  }
  console.log('');

  // Analysis 2: BB Position
  console.log('='.repeat(80));
  console.log('ANÁLISIS 2: POSICIÓN EN BOLLINGER BANDS');
  console.log('='.repeat(80));
  
  const callWins = analyses.filter(a => a.direction === 'CALL' && a.outcome === 'WIN');
  const callLosses = analyses.filter(a => a.direction === 'CALL' && a.outcome === 'LOSS');
  const putWins = analyses.filter(a => a.direction === 'PUT' && a.outcome === 'WIN');
  const putLosses = analyses.filter(a => a.direction === 'PUT' && a.outcome === 'LOSS');
  
  if (callWins.length > 0 || callLosses.length > 0) {
    const avgBBWin = callWins.reduce((sum, a) => sum + a.bbPosition, 0) / callWins.length;
    const avgBBLoss = callLosses.reduce((sum, a) => sum + a.bbPosition, 0) / callLosses.length;
    console.log(`CALL - BB Position promedio:`);
    console.log(`  WINS: ${avgBBWin.toFixed(1)}% (más cerca de banda baja = mejor)`);
    console.log(`  LOSSES: ${avgBBLoss.toFixed(1)}%`);
    console.log(`  Diferencia: ${(avgBBWin - avgBBLoss).toFixed(1)}%`);
  }
  
  if (putWins.length > 0 || putLosses.length > 0) {
    const avgBBWin = putWins.reduce((sum, a) => sum + a.bbPosition, 0) / putWins.length;
    const avgBBLoss = putLosses.reduce((sum, a) => sum + a.bbPosition, 0) / putLosses.length;
    console.log(`PUT - BB Position promedio:`);
    console.log(`  WINS: ${avgBBWin.toFixed(1)}% (más cerca de banda alta = mejor)`);
    console.log(`  LOSSES: ${avgBBLoss.toFixed(1)}%`);
    console.log(`  Diferencia: ${(avgBBWin - avgBBLoss).toFixed(1)}%`);
  }
  console.log('');

  // Analysis 3: Level Strength
  console.log('='.repeat(80));
  console.log('ANÁLISIS 3: FUERZA DEL NIVEL');
  console.log('='.repeat(80));
  
  const strengthStats: Record<number, { wins: number; losses: number }> = {
    1: { wins: 0, losses: 0 },
    2: { wins: 0, losses: 0 },
    3: { wins: 0, losses: 0 },
  };
  
  for (const a of analyses) {
    if (a.levelStrength in strengthStats) {
      if (a.outcome === 'WIN') strengthStats[a.levelStrength].wins++;
      else strengthStats[a.levelStrength].losses++;
    }
  }
  
  for (const [strength, stats] of Object.entries(strengthStats)) {
    const total = stats.wins + stats.losses;
    if (total > 0) {
      const wr = (stats.wins / total) * 100;
      const label = strength === '1' ? 'Solo 5m' : strength === '2' ? 'Solo 15m' : '5m + 15m';
      console.log(`${label.padEnd(15)}: ${stats.wins}W / ${stats.losses}L (${total} total) - WR: ${wr.toFixed(1)}%`);
    }
  }
  console.log('');

  // Analysis 4: Trend Alignment
  console.log('='.repeat(80));
  console.log('ANÁLISIS 4: ALINEACIÓN CON TENDENCIA');
  console.log('='.repeat(80));
  
  const withTrend = analyses.filter(a => !a.againstTrend);
  const againstTrend = analyses.filter(a => a.againstTrend);
  
  const withTrendWins = withTrend.filter(a => a.outcome === 'WIN').length;
  const againstTrendWins = againstTrend.filter(a => a.outcome === 'WIN').length;
  
  console.log(`A favor de tendencia: ${withTrendWins}W / ${withTrend.length - withTrendWins}L (${withTrend.length} total) - WR: ${((withTrendWins / withTrend.length) * 100).toFixed(1)}%`);
  console.log(`Contra tendencia: ${againstTrendWins}W / ${againstTrend.length - againstTrendWins}L (${againstTrend.length} total) - WR: ${((againstTrendWins / againstTrend.length) * 100).toFixed(1)}%`);
  console.log('');

  // Analysis 5: Trade Duration
  console.log('='.repeat(80));
  console.log('ANÁLISIS 5: DURACIÓN DE TRADES');
  console.log('='.repeat(80));
  
  const winDurations = wins.map(a => a.duration);
  const lossDurations = losses.map(a => a.duration);
  
  const avgWinDuration = winDurations.reduce((a, b) => a + b, 0) / winDurations.length;
  const avgLossDuration = lossDurations.reduce((a, b) => a + b, 0) / lossDurations.length;
  
  console.log(`Duración promedio WINS: ${avgWinDuration.toFixed(1)} velas`);
  console.log(`Duración promedio LOSSES: ${avgLossDuration.toFixed(1)} velas`);
  console.log(`Diferencia: ${(avgWinDuration - avgLossDuration).toFixed(1)} velas`);
  console.log('');

  // Analysis 6: Exit Reasons
  console.log('='.repeat(80));
  console.log('ANÁLISIS 6: RAZONES DE SALIDA');
  console.log('='.repeat(80));
  
  const exitReasons: Record<string, { wins: number; losses: number }> = {};
  
  for (const a of analyses) {
    if (!exitReasons[a.exitReason]) {
      exitReasons[a.exitReason] = { wins: 0, losses: 0 };
    }
    if (a.outcome === 'WIN') exitReasons[a.exitReason].wins++;
    else exitReasons[a.exitReason].losses++;
  }
  
  for (const [reason, stats] of Object.entries(exitReasons)) {
    const total = stats.wins + stats.losses;
    const wr = (stats.wins / total) * 100;
    console.log(`${reason.padEnd(20)}: ${stats.wins}W / ${stats.losses}L (${total} total) - WR: ${wr.toFixed(1)}%`);
  }
  console.log('');

  // Analysis 7: Max Favorable vs Max Adverse
  console.log('='.repeat(80));
  console.log('ANÁLISIS 7: MOVIMIENTO MÁXIMO FAVORABLE VS ADVERSO');
  console.log('='.repeat(80));
  
  const avgMaxFavWin = wins.reduce((sum, a) => sum + a.maxFavorablePct, 0) / wins.length;
  const avgMaxFavLoss = losses.reduce((sum, a) => sum + a.maxFavorablePct, 0) / losses.length;
  const avgMaxAdvWin = wins.reduce((sum, a) => sum + a.maxAdversePct, 0) / wins.length;
  const avgMaxAdvLoss = losses.reduce((sum, a) => sum + a.maxAdversePct, 0) / losses.length;
  
  console.log(`WINS:`);
  console.log(`  Max Favorable: ${avgMaxFavWin.toFixed(2)}%`);
  console.log(`  Max Adverse: ${avgMaxAdvWin.toFixed(2)}%`);
  console.log(`LOSSES:`);
  console.log(`  Max Favorable: ${avgMaxFavLoss.toFixed(2)}%`);
  console.log(`  Max Adverse: ${avgMaxAdvLoss.toFixed(2)}%`);
  console.log('');

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

