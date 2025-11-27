#!/usr/bin/env tsx
/**
 * Analyze BB_BOUNCE Losses
 * 
 * Deep analysis of losing trades to identify patterns and improvement opportunities.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Candle } from '@deriv-bot/shared';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import { calculateATR, calculateADX, calculateRSI, calculateBollingerBands } from '../indicators/index.js';
import { SessionFilterService } from '../services/session-filter.service.js';

// ============================================================================
// TYPES
// ============================================================================

interface DetailedTrade {
  // Basic trade info
  entryTimestamp: number;
  exitTimestamp: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  tpPrice: number;
  slPrice: number;
  pnl: number;
  exitReason: string;
  barsHeld: number;
  
  // Market conditions at entry
  adx: number;
  rsi: number;
  atr: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number; // (upper - lower) / middle
  
  // Entry conditions
  touchedBand: boolean;
  rejectionCandle: boolean;
  cleanApproach: boolean;
  
  // Price action
  distanceToTP: number; // % distance from entry to TP
  distanceToSL: number; // % distance from entry to SL
  tpSlRatio: number; // TP distance / SL distance
  
  // Trade behavior
  maxFavorableExcursion: number; // Best % reached
  maxAdverseExcursion: number;   // Worst % reached
  reachedTP: boolean; // Did price ever reach TP?
  nearMiss: boolean;  // Reached >50% of TP before losing
  
  // Time context
  hour: number; // UTC hour
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  session: string; // ASIAN, LONDON, NY, OVERLAP, CLOSED
}

interface LossAnalysis {
  totalLosses: number;
  totalWins: number;
  avgLoss: number;
  avgWin: number;
  
  // Exit reason breakdown
  exitReasons: Record<string, number>;
  
  // Time analysis
  lossesByHour: Record<number, number>;
  lossesByDay: Record<number, number>;
  lossesBySession: Record<string, number>;
  
  // Market condition analysis
  lossesByADX: { range: string; count: number; avgLoss: number }[];
  lossesByRSI: { range: string; count: number; avgLoss: number }[];
  lossesByBBWidth: { range: string; count: number; avgLoss: number }[];
  
  // Trade behavior analysis
  nearMisses: number;
  immediateReversals: number; // Lost in ≤3 bars
  reachedTPButLost: number;
  
  // TP/SL analysis
  avgTPDistance: number;
  avgSLDistance: number;
  avgTPRatio: number;
  
  // Recommendations
  recommendations: string[];
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const dataPath = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
  const asset = process.env.ASSET || 'frxEURUSD';
  
  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🔍 BB_BOUNCE LOSS ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Asset: ${asset}`);
  console.log(`Data: ${dataPath}\n`);
  
  // Run backtest
  const config: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance: 10000,
    stakePct: 0.02,
    multiplier: 100,
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableSessionFilter: process.env.SESSION_FILTER === 'true',
  };
  
  console.log('Running BB_BOUNCE backtest...\n');
  const result = await runMRBacktest('BB_BOUNCE', config);
  
  // Load candles for detailed analysis
  const candles = loadCandles(dataPath, asset);
  const sessionFilter = new SessionFilterService();
  
  // Analyze losing trades in detail
  console.log('Analyzing losing trades...\n');
  const detailedLosses = analyzeLosses(result.trades, candles, sessionFilter);
  
  // Generate analysis report
  const analysis = generateAnalysis(detailedLosses, result.trades);
  
  // Print report
  printReport(analysis, detailedLosses);
  
  // Save detailed data
  const outputPath = join(process.cwd(), 'analysis-output', 'bb_bounce_loss_analysis.json');
  writeFileSync(outputPath, JSON.stringify({
    analysis,
    detailedLosses: detailedLosses.slice(0, 50), // Save first 50 for inspection
  }, null, 2));
  
  console.log(`\n💾 Detailed analysis saved to: ${outputPath}\n`);
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

function analyzeLosses(
  trades: any[],
  candles: Candle[],
  sessionFilter: SessionFilterService
): DetailedTrade[] {
  const losses: DetailedTrade[] = [];
  const candleMap = new Map(candles.map(c => [c.timestamp, c]));
  
  // Pre-calculate indicators
  const atrValues = calculateATR(candles, 14);
  const adxValues = calculateADX(candles, 14);
  const rsiValues = calculateRSI(candles, 14);
  const bbValues = calculateBollingerBands(candles, 20, 2);
  
  // Create index maps
  const atrMap = new Map<number, number>();
  const adxMap = new Map<number, number>();
  const rsiMap = new Map<number, number>();
  const bbMap = new Map<number, typeof bbValues[0]>();
  
  for (let i = 0; i < candles.length; i++) {
    const ts = candles[i]!.timestamp;
    if (atrValues[i]) atrMap.set(ts, atrValues[i]!);
    if (adxValues[i]) adxMap.set(ts, adxValues[i]!.adx);
    if (rsiValues[i] !== undefined) rsiMap.set(ts, rsiValues[i]!);
    if (bbValues[i]) bbMap.set(ts, bbValues[i]!);
  }
  
  for (const trade of trades) {
    if (trade.result !== 'LOSS') continue;
    
    const entryCandle = candleMap.get(trade.timestamp);
    if (!entryCandle) continue;
    
    const adx = adxMap.get(trade.timestamp) ?? 0;
    const rsi = rsiMap.get(trade.timestamp) ?? 50;
    const atr = atrMap.get(trade.timestamp) ?? 0;
    const bb = bbMap.get(trade.timestamp);
    
    if (!bb) continue;
    
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    
    // Calculate distances
    const tpDistance = trade.direction === 'CALL'
      ? (trade.tpPrice - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - trade.tpPrice) / trade.entryPrice;
    
    const slDistance = trade.direction === 'CALL'
      ? (trade.entryPrice - trade.slPrice) / trade.entryPrice
      : (trade.slPrice - trade.entryPrice) / trade.entryPrice;
    
    const tpSlRatio = tpDistance / slDistance;
    
    // Check if reached TP
    const entryIdx = candles.findIndex(c => c.timestamp === trade.timestamp);
    const reachedTP = entryIdx >= 0 && checkIfReachedTP(
      trade,
      candles.slice(entryIdx, entryIdx + trade.barsHeld + 1)
    );
    
    // Time context
    const entryDate = new Date(trade.timestamp * 1000);
    const hour = entryDate.getUTCHours();
    const dayOfWeek = entryDate.getUTCDay();
    const session = sessionFilter.getSession(trade.timestamp);
    
    // Entry conditions (simplified - would need full strategy context)
    const touchedBand = trade.direction === 'CALL'
      ? entryCandle.low <= bb.lower
      : entryCandle.high >= bb.upper;
    
    const detailed: DetailedTrade = {
      entryTimestamp: trade.timestamp,
      exitTimestamp: trade.exitTimestamp,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      tpPrice: trade.tpPrice,
      slPrice: trade.slPrice,
      pnl: trade.pnl,
      exitReason: trade.exitReason,
      barsHeld: trade.barsHeld,
      
      adx,
      rsi,
      atr,
      bbUpper: bb.upper,
      bbMiddle: bb.middle,
      bbLower: bb.lower,
      bbWidth,
      
      touchedBand,
      rejectionCandle: false, // Would need more context
      cleanApproach: false,    // Would need more context
      
      distanceToTP: tpDistance * 100,
      distanceToSL: slDistance * 100,
      tpSlRatio,
      
      maxFavorableExcursion: trade.maxFavorableExcursion * 100,
      maxAdverseExcursion: trade.maxAdverseExcursion * 100,
      reachedTP,
      nearMiss: trade.maxFavorableExcursion >= tpDistance * 0.5,
      
      hour,
      dayOfWeek,
      session,
    };
    
    losses.push(detailed);
  }
  
  return losses;
}

function checkIfReachedTP(trade: any, futureCandles: Candle[]): boolean {
  for (const candle of futureCandles) {
    if (trade.direction === 'CALL' && candle.high >= trade.tpPrice) {
      return true;
    }
    if (trade.direction === 'PUT' && candle.low <= trade.tpPrice) {
      return true;
    }
  }
  return false;
}

function generateAnalysis(losses: DetailedTrade[], allTrades: any[]): LossAnalysis {
  const wins = allTrades.filter(t => t.result === 'WIN');
  
  // Exit reasons
  const exitReasons: Record<string, number> = {};
  for (const loss of losses) {
    exitReasons[loss.exitReason] = (exitReasons[loss.exitReason] || 0) + 1;
  }
  
  // Time analysis
  const lossesByHour: Record<number, number> = {};
  const lossesByDay: Record<number, number> = {};
  const lossesBySession: Record<string, number> = {};
  
  for (const loss of losses) {
    lossesByHour[loss.hour] = (lossesByHour[loss.hour] || 0) + 1;
    lossesByDay[loss.dayOfWeek] = (lossesByDay[loss.dayOfWeek] || 0) + 1;
    lossesBySession[loss.session] = (lossesBySession[loss.session] || 0) + 1;
  }
  
  // Market conditions
  const lossesByADX = analyzeByRange(losses, l => l.adx, [
    [0, 15, 'Low (0-15)'],
    [15, 25, 'Medium (15-25)'],
    [25, 50, 'High (25-50)'],
    [50, 100, 'Very High (50+)'],
  ]);
  
  const lossesByRSI = analyzeByRange(losses, l => l.rsi, [
    [0, 30, 'Oversold (0-30)'],
    [30, 40, 'Lower (30-40)'],
    [40, 60, 'Neutral (40-60)'],
    [60, 70, 'Upper (60-70)'],
    [70, 100, 'Overbought (70+)'],
  ]);
  
  const lossesByBBWidth = analyzeByRange(losses, l => l.bbWidth * 100, [
    [0, 0.5, 'Tight (0-0.5%)'],
    [0.5, 1.0, 'Normal (0.5-1%)'],
    [1.0, 2.0, 'Wide (1-2%)'],
    [2.0, 10, 'Very Wide (2%+)'],
  ]);
  
  // Trade behavior
  const nearMisses = losses.filter(l => l.nearMiss).length;
  const immediateReversals = losses.filter(l => l.barsHeld <= 3).length;
  const reachedTPButLost = losses.filter(l => l.reachedTP).length;
  
  // TP/SL analysis
  const avgTPDistance = losses.reduce((sum, l) => sum + l.distanceToTP, 0) / losses.length;
  const avgSLDistance = losses.reduce((sum, l) => sum + l.distanceToSL, 0) / losses.length;
  const avgTPRatio = losses.reduce((sum, l) => sum + l.tpSlRatio, 0) / losses.length;
  
  // Generate recommendations
  const recommendations = generateRecommendations({
    losses,
    wins,
    exitReasons,
    lossesBySession,
    lossesByADX,
    lossesByRSI,
    lossesByBBWidth,
    nearMisses,
    immediateReversals,
    reachedTPButLost,
    avgTPRatio,
  });
  
  return {
    totalLosses: losses.length,
    totalWins: wins.length,
    avgLoss: losses.reduce((sum, l) => sum + Math.abs(l.pnl), 0) / losses.length,
    avgWin: wins.reduce((sum, w) => sum + w.pnl, 0) / wins.length,
    exitReasons,
    lossesByHour,
    lossesByDay,
    lossesBySession,
    lossesByADX,
    lossesByRSI,
    lossesByBBWidth,
    nearMisses,
    immediateReversals,
    reachedTPButLost,
    avgTPDistance,
    avgSLDistance,
    avgTPRatio,
    recommendations,
  };
}

function analyzeByRange(
  losses: DetailedTrade[],
  getValue: (loss: DetailedTrade) => number,
  ranges: Array<[number, number, string]>
): Array<{ range: string; count: number; avgLoss: number }> {
  return ranges.map(([min, max, label]) => {
    const inRange = losses.filter(l => {
      const val = getValue(l);
      return val >= min && val < max;
    });
    
    return {
      range: label,
      count: inRange.length,
      avgLoss: inRange.length > 0
        ? inRange.reduce((sum, l) => sum + Math.abs(l.pnl), 0) / inRange.length
        : 0,
    };
  });
}

function generateRecommendations(data: any): string[] {
  const recs: string[] = [];
  
  // TP/SL ratio
  if (data.avgTPRatio < 0.6) {
    recs.push(`⚠️ TP/SL ratio muy bajo (${data.avgTPRatio.toFixed(2)}:1). Los ganadores son muy pequeños comparados con perdedores. Considera aumentar TP o reducir SL.`);
  }
  
  // Immediate reversals
  const immediateRevPct = (data.immediateReversals / data.losses.length) * 100;
  if (immediateRevPct > 30) {
    recs.push(`⚠️ ${immediateRevPct.toFixed(1)}% de pérdidas son reversiones inmediatas (≤3 barras). El SL puede estar muy cerca o las condiciones de entrada no son suficientemente fuertes.`);
  }
  
  // Reached TP but lost
  const reachedTPPct = (data.reachedTPButLost / data.losses.length) * 100;
  if (reachedTPPct > 20) {
    recs.push(`⚠️ ${reachedTPPct.toFixed(1)}% de pérdidas alcanzaron el TP pero luego revirtieron. Considera trailing stop o salida parcial.`);
  }
  
  // Session analysis
  const worstSession = Object.entries(data.lossesBySession)
    .sort((a, b) => b[1] - a[1])[0];
  if (worstSession && worstSession[1] > data.losses.length * 0.3) {
    recs.push(`⚠️ Sesión ${worstSession[0]} tiene ${worstSession[1]} pérdidas (${((worstSession[1] / data.losses.length) * 100).toFixed(1)}%). Considera filtrar esta sesión.`);
  }
  
  // ADX analysis
  const highADX = data.lossesByADX.find((r: any) => r.range.includes('High') || r.range.includes('Very High'));
  if (highADX && highADX.count > data.losses.length * 0.2) {
    recs.push(`⚠️ ${highADX.count} pérdidas (${((highADX.count / data.losses.length) * 100).toFixed(1)}%) ocurrieron en mercados con ADX alto. BB_BOUNCE funciona mejor en rangos.`);
  }
  
  // BB Width
  const wideBB = data.lossesByBBWidth.find((r: any) => r.range.includes('Wide') || r.range.includes('Very Wide'));
  if (wideBB && wideBB.count > data.losses.length * 0.25) {
    recs.push(`⚠️ ${wideBB.count} pérdidas (${((wideBB.count / data.losses.length) * 100).toFixed(1)}%) ocurrieron con BB muy anchas. Considera filtrar cuando volatilidad es muy alta.`);
  }
  
  return recs;
}

function printReport(analysis: LossAnalysis, detailedLosses: DetailedTrade[]) {
  console.log('='.repeat(80));
  console.log('📊 ANÁLISIS DE PÉRDIDAS');
  console.log('='.repeat(80));
  console.log(`\nTotal Pérdidas: ${analysis.totalLosses}`);
  console.log(`Total Ganancias: ${analysis.totalWins}`);
  console.log(`Avg Loss: $${analysis.avgLoss.toFixed(2)}`);
  console.log(`Avg Win: $${analysis.avgWin.toFixed(2)}`);
  console.log(`Ratio Win/Loss: ${(analysis.avgWin / analysis.avgLoss).toFixed(2)}:1`);
  
  console.log('\n' + '='.repeat(80));
  console.log('🚪 RAZONES DE SALIDA');
  console.log('='.repeat(80));
  for (const [reason, count] of Object.entries(analysis.exitReasons)) {
    const pct = (count / analysis.totalLosses) * 100;
    console.log(`  ${reason.padEnd(15)}: ${count.toString().padStart(4)} (${pct.toFixed(1)}%)`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('⏰ ANÁLISIS POR SESIÓN');
  console.log('='.repeat(80));
  for (const [session, count] of Object.entries(analysis.lossesBySession).sort((a, b) => b[1] - a[1])) {
    const pct = (count / analysis.totalLosses) * 100;
    console.log(`  ${session.padEnd(15)}: ${count.toString().padStart(4)} (${pct.toFixed(1)}%)`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📈 CONDICIONES DE MERCADO');
  console.log('='.repeat(80));
  console.log('\nPor ADX:');
  for (const item of analysis.lossesByADX) {
    if (item.count > 0) {
      console.log(`  ${item.range.padEnd(20)}: ${item.count.toString().padStart(4)} pérdidas | Avg: $${item.avgLoss.toFixed(2)}`);
    }
  }
  
  console.log('\nPor RSI:');
  for (const item of analysis.lossesByRSI) {
    if (item.count > 0) {
      console.log(`  ${item.range.padEnd(20)}: ${item.count.toString().padStart(4)} pérdidas | Avg: $${item.avgLoss.toFixed(2)}`);
    }
  }
  
  console.log('\nPor BB Width:');
  for (const item of analysis.lossesByBBWidth) {
    if (item.count > 0) {
      console.log(`  ${item.range.padEnd(20)}: ${item.count.toString().padStart(4)} pérdidas | Avg: $${item.avgLoss.toFixed(2)}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🎯 COMPORTAMIENTO DE TRADES');
  console.log('='.repeat(80));
  console.log(`  Near Misses (>50% TP): ${analysis.nearMisses} (${((analysis.nearMisses / analysis.totalLosses) * 100).toFixed(1)}%)`);
  console.log(`  Reversiones Inmediatas (≤3 barras): ${analysis.immediateReversals} (${((analysis.immediateReversals / analysis.totalLosses) * 100).toFixed(1)}%)`);
  console.log(`  Alcanzaron TP pero perdieron: ${analysis.reachedTPButLost} (${((analysis.reachedTPButLost / analysis.totalLosses) * 100).toFixed(1)}%)`);
  
  console.log('\n' + '='.repeat(80));
  console.log('📏 TP/SL ANALYSIS');
  console.log('='.repeat(80));
  console.log(`  Avg TP Distance: ${analysis.avgTPDistance.toFixed(3)}%`);
  console.log(`  Avg SL Distance: ${analysis.avgSLDistance.toFixed(3)}%`);
  console.log(`  Avg TP/SL Ratio: ${analysis.avgTPRatio.toFixed(2)}:1`);
  
  console.log('\n' + '='.repeat(80));
  console.log('💡 RECOMENDACIONES');
  console.log('='.repeat(80));
  for (const rec of analysis.recommendations) {
    console.log(`\n${rec}`);
  }
  
  if (analysis.recommendations.length === 0) {
    console.log('\n✅ No se identificaron problemas obvios. Revisa los datos detallados para patrones más sutiles.');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function loadCandles(filepath: string, asset: string): Candle[] {
  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.split('\n').filter((line) => line.trim() !== '');
  const header = lines[0]!.toLowerCase();
  const hasHeader = header.includes('timestamp') || header.includes('time') || header.includes('open');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  
  const candles: Candle[] = [];
  
  for (const line of dataLines) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    
    try {
      let timestamp: number;
      const tsStr = parts[0]!.trim();
      
      if (tsStr.includes('-') || tsStr.includes('/')) {
        timestamp = Math.floor(new Date(tsStr).getTime() / 1000);
      } else {
        timestamp = parseInt(tsStr, 10);
        if (timestamp > 1e12) {
          timestamp = Math.floor(timestamp / 1000);
        }
      }
      
      const candle: Candle = {
        asset,
        timeframe: 300,
        timestamp,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts[5] ? parseFloat(parts[5]) : 0,
      };
      
      if (!isNaN(candle.timestamp) && !isNaN(candle.close)) {
        candles.push(candle);
      }
    } catch {
      // Skip invalid lines
    }
  }
  
  candles.sort((a, b) => a.timestamp - b.timestamp);
  
  if (candles.length >= 2) {
    const gap = candles[1]!.timestamp - candles[0]!.timestamp;
    for (const candle of candles) {
      candle.timeframe = gap;
    }
  }
  
  return candles;
}

main().catch(console.error);

