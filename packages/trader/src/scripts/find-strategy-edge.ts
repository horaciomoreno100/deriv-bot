#!/usr/bin/env tsx
/**
 * Encontrar el edge de la estrategia - condiciones específicas donde es rentable
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

interface TradeCondition {
  direction: 'CALL' | 'PUT';
  outcome: 'WIN' | 'LOSS';
  pnl: number;
  
  // Entry conditions
  rsi: number;
  rsiZone: 'oversold' | 'low' | 'mid' | 'high' | 'overbought';
  bbPosition: number; // 0-100%
  bbZone: 'lower' | 'middle' | 'upper';
  levelType: 'high' | 'low';
  levelStrength: number;
  trend5m: string;
  trend15m: string;
  againstTrend: boolean;
  
  // Market conditions
  atr: number;
  volatility: 'low' | 'medium' | 'high';
  
  // Time
  hour: number;
  dayOfWeek: number;
}

function getRSIZone(rsi: number): 'oversold' | 'low' | 'mid' | 'high' | 'overbought' {
  if (rsi < 30) return 'oversold';
  if (rsi < 40) return 'low';
  if (rsi < 60) return 'mid';
  if (rsi < 70) return 'high';
  return 'overbought';
}

function getBBZone(bbPosition: number): 'lower' | 'middle' | 'upper' {
  if (bbPosition < 20) return 'lower';
  if (bbPosition > 80) return 'upper';
  return 'middle';
}

function getVolatility(atr: number, avgAtr: number): 'low' | 'medium' | 'high' {
  if (atr < avgAtr * 0.8) return 'low';
  if (atr > avgAtr * 1.2) return 'high';
  return 'medium';
}

async function main() {
  console.log('='.repeat(80));
  console.log('BUSCANDO EL EDGE DE LA ESTRATEGIA');
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
  console.log(`Total trades: ${trades.length}\n`);

  // Calculate average ATR for volatility classification
  let totalAtr = 0;
  let atrCount = 0;
  for (const trade of trades) {
    const atr = trade.entry.snapshot.indicators?.atr as number | undefined;
    if (atr) {
      totalAtr += atr;
      atrCount++;
    }
  }
  const avgAtr = atrCount > 0 ? totalAtr / atrCount : 0;

  // Analyze each trade
  const conditions: TradeCondition[] = [];

  for (const trade of trades) {
    const entry = trade.entry;
    const indicators = entry.snapshot.indicators || {};
    
    const rsi = (indicators.rsi as number) || 50;
    const atr = (indicators.atr as number) || 0;
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
    
    // Get time info
    const entryTime = new Date(entry.executedAt);
    const hour = entryTime.getUTCHours();
    const dayOfWeek = entryTime.getUTCDay();
    
    conditions.push({
      direction: trade.direction,
      outcome: trade.result?.outcome || 'LOSS',
      pnl: trade.result?.pnl || 0,
      rsi,
      rsiZone: getRSIZone(rsi),
      bbPosition,
      bbZone: getBBZone(bbPosition),
      levelType,
      levelStrength,
      trend5m,
      trend15m,
      againstTrend,
      atr,
      volatility: getVolatility(atr, avgAtr),
      hour,
      dayOfWeek,
    });
  }

  const wins = conditions.filter(c => c.outcome === 'WIN');
  const losses = conditions.filter(c => c.outcome === 'LOSS');

  // 1. ANALIZAR POR COMBINACIONES DE CONDICIONES
  console.log('='.repeat(80));
  console.log('1. EDGE POR COMBINACIONES DE CONDICIONES');
  console.log('='.repeat(80));
  console.log('');

  interface ConditionStats {
    count: number;
    wins: number;
    losses: number;
    totalPnL: number;
    avgPnL: number;
  }

  const combinations: Map<string, ConditionStats> = new Map();

  for (const cond of conditions) {
    // Crear clave de combinación
    const key = `${cond.direction}_${cond.rsiZone}_${cond.bbZone}_${cond.levelStrength}_${cond.againstTrend ? 'against' : 'with'}_${cond.volatility}`;
    
    if (!combinations.has(key)) {
      combinations.set(key, { count: 0, wins: 0, losses: 0, totalPnL: 0, avgPnL: 0 });
    }
    
    const stats = combinations.get(key)!;
    stats.count++;
    if (cond.outcome === 'WIN') stats.wins++;
    else stats.losses++;
    stats.totalPnL += cond.pnl;
    stats.avgPnL = stats.totalPnL / stats.count;
  }

  // Ordenar por mejor rendimiento
  const sortedCombos = Array.from(combinations.entries())
    .filter(([_, stats]) => stats.count >= 5) // Mínimo 5 trades
    .map(([key, stats]) => ({
      key,
      ...stats,
      winRate: (stats.wins / stats.count) * 100,
      profitFactor: stats.losses > 0 ? Math.abs(stats.wins * stats.avgPnL) / Math.abs(stats.losses * stats.avgPnL) : Infinity,
    }))
    .sort((a, b) => b.avgPnL - a.avgPnL);

  console.log('TOP 10 COMBINACIONES CON MEJOR EDGE:');
  console.log('');
  for (let i = 0; i < Math.min(10, sortedCombos.length); i++) {
    const combo = sortedCombos[i]!;
    console.log(`${i + 1}. ${combo.key}`);
    console.log(`   Trades: ${combo.count} | WR: ${combo.winRate.toFixed(1)}% | Avg PnL: $${combo.avgPnL.toFixed(2)} | PF: ${combo.profitFactor.toFixed(2)}`);
    console.log('');
  }

  // 2. ANALIZAR POR CONDICIONES INDIVIDUALES
  console.log('='.repeat(80));
  console.log('2. EDGE POR CONDICIONES INDIVIDUALES');
  console.log('='.repeat(80));
  console.log('');

  // RSI Zones
  console.log('RSI ZONES:');
  const rsiZones = ['oversold', 'low', 'mid', 'high', 'overbought'] as const;
  for (const zone of rsiZones) {
    const zoneTrades = conditions.filter(c => c.rsiZone === zone);
    if (zoneTrades.length > 0) {
      const wins = zoneTrades.filter(c => c.outcome === 'WIN').length;
      const wr = (wins / zoneTrades.length) * 100;
      const avgPnL = zoneTrades.reduce((sum, c) => sum + c.pnl, 0) / zoneTrades.length;
      console.log(`  ${zone.padEnd(10)}: ${zoneTrades.length} trades | WR: ${wr.toFixed(1)}% | Avg PnL: $${avgPnL.toFixed(2)}`);
    }
  }
  console.log('');

  // BB Zones
  console.log('BOLLINGER BANDS ZONES:');
  const bbZones = ['lower', 'middle', 'upper'] as const;
  for (const zone of bbZones) {
    const zoneTrades = conditions.filter(c => c.bbZone === zone);
    if (zoneTrades.length > 0) {
      const wins = zoneTrades.filter(c => c.outcome === 'WIN').length;
      const wr = (wins / zoneTrades.length) * 100;
      const avgPnL = zoneTrades.reduce((sum, c) => sum + c.pnl, 0) / zoneTrades.length;
      console.log(`  ${zone.padEnd(10)}: ${zoneTrades.length} trades | WR: ${wr.toFixed(1)}% | Avg PnL: $${avgPnL.toFixed(2)}`);
    }
  }
  console.log('');

  // Level Strength
  console.log('LEVEL STRENGTH:');
  for (let strength = 1; strength <= 3; strength++) {
    const strengthTrades = conditions.filter(c => c.levelStrength === strength);
    if (strengthTrades.length > 0) {
      const wins = strengthTrades.filter(c => c.outcome === 'WIN').length;
      const wr = (wins / strengthTrades.length) * 100;
      const avgPnL = strengthTrades.reduce((sum, c) => sum + c.pnl, 0) / strengthTrades.length;
      const label = strength === 1 ? 'Solo 5m' : strength === 2 ? 'Solo 15m' : '5m + 15m';
      console.log(`  ${label.padEnd(10)}: ${strengthTrades.length} trades | WR: ${wr.toFixed(1)}% | Avg PnL: $${avgPnL.toFixed(2)}`);
    }
  }
  console.log('');

  // Trend Alignment
  console.log('TREND ALIGNMENT:');
  const withTrend = conditions.filter(c => !c.againstTrend);
  const againstTrend = conditions.filter(c => c.againstTrend);
  
  if (withTrend.length > 0) {
    const wins = withTrend.filter(c => c.outcome === 'WIN').length;
    const wr = (wins / withTrend.length) * 100;
    const avgPnL = withTrend.reduce((sum, c) => sum + c.pnl, 0) / withTrend.length;
    console.log(`  A favor     : ${withTrend.length} trades | WR: ${wr.toFixed(1)}% | Avg PnL: $${avgPnL.toFixed(2)}`);
  }
  
  if (againstTrend.length > 0) {
    const wins = againstTrend.filter(c => c.outcome === 'WIN').length;
    const wr = (wins / againstTrend.length) * 100;
    const avgPnL = againstTrend.reduce((sum, c) => sum + c.pnl, 0) / againstTrend.length;
    console.log(`  Contra      : ${againstTrend.length} trades | WR: ${wr.toFixed(1)}% | Avg PnL: $${avgPnL.toFixed(2)}`);
  }
  console.log('');

  // Volatility
  console.log('VOLATILITY:');
  const volatilities = ['low', 'medium', 'high'] as const;
  for (const vol of volatilities) {
    const volTrades = conditions.filter(c => c.volatility === vol);
    if (volTrades.length > 0) {
      const wins = volTrades.filter(c => c.outcome === 'WIN').length;
      const wr = (wins / volTrades.length) * 100;
      const avgPnL = volTrades.reduce((sum, c) => sum + c.pnl, 0) / volTrades.length;
      console.log(`  ${vol.padEnd(10)}: ${volTrades.length} trades | WR: ${wr.toFixed(1)}% | Avg PnL: $${avgPnL.toFixed(2)}`);
    }
  }
  console.log('');

  // 3. ENCONTRAR EL MEJOR EDGE
  console.log('='.repeat(80));
  console.log('3. EL EDGE ENCONTRADO');
  console.log('='.repeat(80));
  console.log('');

  // Buscar combinaciones con mejor edge
  const bestEdges = sortedCombos
    .filter(c => c.winRate > 55 && c.avgPnL > 0 && c.profitFactor > 1.2)
    .slice(0, 5);

  if (bestEdges.length > 0) {
    console.log('MEJORES EDGES IDENTIFICADOS:');
    console.log('');
    for (let i = 0; i < bestEdges.length; i++) {
      const edge = bestEdges[i]!;
      console.log(`${i + 1}. ${edge.key}`);
      console.log(`   Trades: ${edge.count} | WR: ${edge.winRate.toFixed(1)}% | Avg PnL: $${edge.avgPnL.toFixed(2)} | PF: ${edge.profitFactor.toFixed(2)}`);
      console.log('');
    }
  } else {
    console.log('⚠️  No se encontraron edges claros con los criterios estrictos.');
    console.log('Mostrando mejores combinaciones disponibles:');
    console.log('');
    for (let i = 0; i < Math.min(5, sortedCombos.length); i++) {
      const edge = sortedCombos[i]!;
      console.log(`${i + 1}. ${edge.key}`);
      console.log(`   Trades: ${edge.count} | WR: ${edge.winRate.toFixed(1)}% | Avg PnL: $${edge.avgPnL.toFixed(2)} | PF: ${edge.profitFactor.toFixed(2)}`);
      console.log('');
    }
  }

  // 4. RECOMENDACIONES
  console.log('='.repeat(80));
  console.log('4. RECOMENDACIONES PARA EXPLOTAR EL EDGE');
  console.log('='.repeat(80));
  console.log('');

  // Analizar qué condiciones tienen mejor rendimiento
  const bestRSIZone = rsiZones.reduce((best, zone) => {
    const zoneTrades = conditions.filter(c => c.rsiZone === zone);
    if (zoneTrades.length < 10) return best;
    const avgPnL = zoneTrades.reduce((sum, c) => sum + c.pnl, 0) / zoneTrades.length;
    return !best || avgPnL > best.avgPnL ? { zone, avgPnL } : best;
  }, null as { zone: typeof rsiZones[number]; avgPnL: number } | null);

  const bestBBZone = bbZones.reduce((best, zone) => {
    const zoneTrades = conditions.filter(c => c.bbZone === zone);
    if (zoneTrades.length < 10) return best;
    const avgPnL = zoneTrades.reduce((sum, c) => sum + c.pnl, 0) / zoneTrades.length;
    return !best || avgPnL > best.avgPnL ? { zone, avgPnL } : best;
  }, null as { zone: typeof bbZones[number]; avgPnL: number } | null);

  if (bestRSIZone) {
    console.log(`✅ RSI Zone con mejor edge: ${bestRSIZone.zone} (Avg PnL: $${bestRSIZone.avgPnL.toFixed(2)})`);
  }
  if (bestBBZone) {
    console.log(`✅ BB Zone con mejor edge: ${bestBBZone.zone} (Avg PnL: $${bestBBZone.avgPnL.toFixed(2)})`);
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

