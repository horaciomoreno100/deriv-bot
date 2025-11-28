#!/usr/bin/env tsx
/**
 * Análisis Profundo de Problemas en Entradas - MTF Levels Strategy
 * 
 * Entender exactamente por qué fallan las entradas
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
} from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '1', 10);

interface EntryAnalysis {
  tradeIndex: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  outcome: 'WIN' | 'LOSS';
  pnl: number;
  
  // Conditions at entry
  rsi: number;
  bbPosition: number; // 0-100% position in BB
  levelType: string;
  levelStrength: number;
  distanceToLevel: number;
  trend5m: string;
  trend15m: string;
  againstTrend: boolean;
  
  // Price action BEFORE entry (last 5 candles)
  priceBeforeEntry: number[];
  bbPositionBefore: number[];
  
  // Price action AFTER entry (first 5 candles)
  priceAfterEntry: number[];
  priceChangeAfter: number[]; // % change in expected direction
  wentAgainstImmediately: boolean; // Went against in first 2 candles
  
  // What went wrong
  problems: string[];
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS PROFUNDO DE PROBLEMAS EN ENTRADAS');
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

  // Run backtest
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
    requireStrongLevelAgainstTrend: false,
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  });

  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');
  
  console.log(`Total trades: ${trades.length}`);
  console.log(`Losses: ${losses.length}\n`);

  // Analyze each loss in detail
  const analyses: EntryAnalysis[] = [];

  for (let i = 0; i < losses.length; i++) {
    const trade = losses[i]!;
    const entry = trade.entry;
    const indicators = entry.snapshot.indicators || {};
    const entryIndex = entry.snapshot.candle?.index || 0;
    
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
    
    // Price action BEFORE entry (last 5 candles)
    const priceBefore: number[] = [];
    const bbPositionBefore: number[] = [];
    for (let j = Math.max(0, entryIndex - 5); j < entryIndex; j++) {
      priceBefore.push(candles[j]!.close);
      // Calculate BB position for each candle (simplified - using current BB)
      if (bbUpper && bbLower) {
        const pos = ((candles[j]!.close - bbLower) / (bbUpper - bbLower)) * 100;
        bbPositionBefore.push(pos);
      }
    }
    
    // Price action AFTER entry (first 5 candles)
    const priceAfter: number[] = [];
    const priceChangeAfter: number[] = [];
    let wentAgainstImmediately = false;
    
    for (let j = 1; j <= 5 && entryIndex + j < candles.length; j++) {
      const futureCandle = candles[entryIndex + j]!;
      priceAfter.push(futureCandle.close);
      
      const change = trade.direction === 'CALL'
        ? ((futureCandle.close - entry.executedPrice) / entry.executedPrice) * 100
        : ((entry.executedPrice - futureCandle.close) / entry.executedPrice) * 100;
      priceChangeAfter.push(change);
      
      if (j <= 2 && change < -0.1) {
        wentAgainstImmediately = true;
      }
    }
    
    // Identify problems
    const problems: string[] = [];
    
    if (againstTrend) {
      problems.push('Contra tendencia');
    }
    
    if (indicators.levelStrength === 1) {
      problems.push('Nivel débil (solo 5m)');
    }
    
    if (wentAgainstImmediately) {
      problems.push('Se fue en contra inmediatamente');
    }
    
    const maxFavorablePct = trade.result?.maxFavorablePct || 0;
    if (maxFavorablePct < 0.2) {
      problems.push(`Bounce muy débil (max ${maxFavorablePct.toFixed(2)}%)`);
    }
    
    if (trade.direction === 'CALL' && bbPosition > 30) {
      problems.push(`CALL pero precio no muy cerca de banda baja (${bbPosition.toFixed(1)}%)`);
    }
    
    if (trade.direction === 'PUT' && bbPosition < 70) {
      problems.push(`PUT pero precio no muy cerca de banda alta (${bbPosition.toFixed(1)}%)`);
    }
    
    // Check if price was moving against before entry
    if (priceBefore.length >= 2) {
      const recentTrend = priceBefore[priceBefore.length - 1]! - priceBefore[0]!;
      if (trade.direction === 'CALL' && recentTrend < 0) {
        problems.push('Precio bajando antes de entrada CALL');
      }
      if (trade.direction === 'PUT' && recentTrend > 0) {
        problems.push('Precio subiendo antes de entrada PUT');
      }
    }
    
    analyses.push({
      tradeIndex: i + 1,
      direction: trade.direction,
      entryPrice: entry.executedPrice,
      outcome: 'LOSS',
      pnl: trade.result?.pnl || 0,
      rsi: (indicators.rsi as number) || 50,
      bbPosition,
      levelType: (indicators.levelType as string) || 'unknown',
      levelStrength: (indicators.levelStrength as number) || 0,
      distanceToLevel: Math.abs(entry.executedPrice - ((indicators.nearestLevel as number) || entry.executedPrice)) / entry.executedPrice * 100,
      trend5m,
      trend15m,
      againstTrend,
      priceBeforeEntry: priceBefore,
      bbPositionBefore,
      priceAfterEntry: priceAfter,
      priceChangeAfter,
      wentAgainstImmediately,
      problems,
    });
  }

  // Print detailed analysis
  console.log('='.repeat(80));
  console.log('ANÁLISIS DETALLADO DE ENTRADAS PERDEDORAS');
  console.log('='.repeat(80));
  console.log('');

  for (const analysis of analyses.slice(0, 5)) {
    console.log(`${'='.repeat(80)}`);
    console.log(`ENTRADA #${analysis.tradeIndex} - ${analysis.direction} - ❌ LOSS`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Precio entrada: $${analysis.entryPrice.toFixed(2)}`);
    console.log(`PnL: $${analysis.pnl.toFixed(2)}`);
    console.log('');
    
    console.log('📊 CONDICIONES EN LA ENTRADA:');
    console.log(`  RSI: ${analysis.rsi.toFixed(1)}`);
    console.log(`  Posición en BB: ${analysis.bbPosition.toFixed(1)}% (${analysis.direction === 'CALL' ? 'baja' : 'alta'})`);
    console.log(`  Nivel: ${analysis.levelType} (fuerza: ${analysis.levelStrength})`);
    console.log(`  Distancia al nivel: ${analysis.distanceToLevel.toFixed(3)}%`);
    console.log(`  Tendencia 5m: ${analysis.trend5m}, 15m: ${analysis.trend15m}`);
    console.log(`  Contra tendencia: ${analysis.againstTrend ? 'SÍ ⚠️' : 'NO ✅'}`);
    console.log('');
    
    console.log('📉 PRECIO ANTES DE ENTRADA (últimas 5 velas):');
    if (analysis.priceBeforeEntry.length > 0) {
      const prices = analysis.priceBeforeEntry.map(p => `$${p.toFixed(2)}`).join(' → ');
      console.log(`  ${prices}`);
      const trend = analysis.priceBeforeEntry[analysis.priceBeforeEntry.length - 1]! - analysis.priceBeforeEntry[0]!;
      const trendDir = trend > 0 ? '📈 Subiendo' : trend < 0 ? '📉 Bajando' : '➡️ Lateral';
      console.log(`  Tendencia: ${trendDir} (${trend > 0 ? '+' : ''}${trend.toFixed(2)})`);
    }
    console.log('');
    
    console.log('📈 PRECIO DESPUÉS DE ENTRADA (primeras 5 velas):');
    if (analysis.priceAfterEntry.length > 0) {
      for (let i = 0; i < analysis.priceAfterEntry.length; i++) {
        const change = analysis.priceChangeAfter[i]!;
        const emoji = change >= 0 ? '✅' : '❌';
        console.log(`  Vela ${i + 1}: $${analysis.priceAfterEntry[i]!.toFixed(2)} (${emoji} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
      }
      console.log(`  Se fue en contra inmediatamente: ${analysis.wentAgainstImmediately ? 'SÍ ❌' : 'NO ✅'}`);
    }
    console.log('');
    
    console.log('🔍 PROBLEMAS IDENTIFICADOS:');
    if (analysis.problems.length === 0) {
      console.log('  (No se identificaron problemas obvios)');
    } else {
      analysis.problems.forEach(p => console.log(`  ❌ ${p}`));
    }
    console.log('');
  }

  // Pattern analysis
  console.log('='.repeat(80));
  console.log('ANÁLISIS DE PATRONES');
  console.log('='.repeat(80));
  console.log('');
  
  const againstTrendCount = analyses.filter(a => a.againstTrend).length;
  const weakLevelCount = analyses.filter(a => a.levelStrength === 1).length;
  const immediateReversalCount = analyses.filter(a => a.wentAgainstImmediately).length;
  const weakBounceCount = analyses.filter(a => {
    const trade = losses[analyses.indexOf(a)]!;
    return (trade.result?.maxFavorablePct || 0) < 0.2;
  }).length;
  
  console.log(`Trades contra tendencia: ${againstTrendCount} (${((againstTrendCount / analyses.length) * 100).toFixed(1)}%)`);
  console.log(`Niveles débiles: ${weakLevelCount} (${((weakLevelCount / analyses.length) * 100).toFixed(1)}%)`);
  console.log(`Reversiones inmediatas: ${immediateReversalCount} (${((immediateReversalCount / analyses.length) * 100).toFixed(1)}%)`);
  console.log(`Bounces débiles: ${weakBounceCount} (${((weakBounceCount / analyses.length) * 100).toFixed(1)}%)`);
  console.log('');
  
  // BB position analysis
  const callBBPositions = analyses.filter(a => a.direction === 'CALL').map(a => a.bbPosition);
  const putBBPositions = analyses.filter(a => a.direction === 'PUT').map(a => a.bbPosition);
  
  if (callBBPositions.length > 0) {
    const avgCallBB = callBBPositions.reduce((a, b) => a + b, 0) / callBBPositions.length;
    console.log(`CALL - Posición promedio en BB: ${avgCallBB.toFixed(1)}% (ideal: <15%)`);
  }
  
  if (putBBPositions.length > 0) {
    const avgPutBB = putBBPositions.reduce((a, b) => a + b, 0) / putBBPositions.length;
    console.log(`PUT - Posición promedio en BB: ${avgPutBB.toFixed(1)}% (ideal: >85%)`);
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

