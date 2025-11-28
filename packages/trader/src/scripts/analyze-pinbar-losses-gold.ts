#!/usr/bin/env npx tsx
/**
 * Análisis Profundo de Pérdidas - Pin Bar Strategy en Oro
 * 
 * Analiza por qué perdemos y cómo mejorar la estrategia
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createPinBarStrategy,
  type Trade,
} from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

const ASSET = 'frxXAUUSD';
const DATA_FILE = 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = 30;
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface DetailedLoss {
  // Trade info
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  tpPrice: number;
  slPrice: number;
  pnl: number;
  barsHeld: number;
  exitReason: string;
  
  // Entry conditions
  rsi: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  ema20: number;
  atr: number;
  price: number;
  
  // Pin bar characteristics
  pinBarType: 'bullish' | 'bearish' | 'unknown';
  wickRatio: number; // Wick size / total range
  bodyRatio: number; // Body size / total range
  nearBB: boolean; // Near Bollinger Band
  
  // Price action during trade
  maxFavorablePct: number; // % máximo a favor (hacia TP)
  maxAdversePct: number;   // % máximo en contra (hacia SL)
  reachedTP: boolean;
  reachedSL: boolean;
  priceAtBar1: number;
  priceAtBar2: number;
  priceAtBar3: number;
  
  // What went wrong
  immediateReversal: boolean; // Perdió en ≤3 velas
  nearMiss: boolean; // Llegó a >50% del TP antes de perder
  falsePinBar: boolean; // Pin bar que no funcionó
  againstTrend: boolean; // Precio contra EMA
  
  // Time context
  hour: number; // UTC
  dayOfWeek: number; // 0=Sunday
  timestamp: number;
  
  // Market context
  volatility: 'low' | 'medium' | 'high'; // Basado en ATR
  trend: 'up' | 'down' | 'sideways'; // Basado en EMA
}

function getVolatility(atr: number, price: number): 'low' | 'medium' | 'high' {
  const atrPct = (atr / price) * 100;
  if (atrPct < 0.1) return 'low';
  if (atrPct < 0.2) return 'medium';
  return 'high';
}

function getTrend(price: number, ema: number): 'up' | 'down' | 'sideways' {
  const diff = (price - ema) / ema * 100;
  if (diff > 0.1) return 'up';
  if (diff < -0.1) return 'down';
  return 'sideways';
}

function analyzePinBar(candle: Candle): {
  type: 'bullish' | 'bearish' | 'unknown';
  wickRatio: number;
  bodyRatio: number;
} {
  const range = candle.high - candle.low;
  if (range === 0) return { type: 'unknown', wickRatio: 0, bodyRatio: 0 };
  
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  
  const bodyRatio = body / range;
  const wickRatio = Math.max(upperWick, lowerWick) / range;
  
  let type: 'bullish' | 'bearish' | 'unknown' = 'unknown';
  if (lowerWick / range >= 0.5 && bodyRatio <= 0.4) {
    type = 'bullish';
  } else if (upperWick / range >= 0.5 && bodyRatio <= 0.4) {
    type = 'bearish';
  }
  
  return { type, wickRatio, bodyRatio };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   ANÁLISIS PROFUNDO DE PÉRDIDAS - PIN BAR EN ORO          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    process.exit(1);
  }

  console.log(`📂 Cargando datos de: ${DATA_FILE}`);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  // Filter to first N days
  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_ANALYZE * oneDaySeconds);

  const candles = allCandles.filter(c => {
    return c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime;
  });

  console.log(`   ✅ Cargadas ${candles.length.toLocaleString()} velas\n`);

  // Run backtest
  console.log('🔄 Ejecutando backtest...');
  const strategy = createPinBarStrategy(ASSET, {
    rsiPeriod: 14,
    rsiOversold: 35,
    rsiOverbought: 65,
    pinBarWickRatio: 0.5,
    pinBarBodyRatio: 0.4,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
    cooldownBars: 2,
  });

  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_BALANCE,
    stakeMode: 'percentage',
    stakePct: STAKE_PCT,
    stakeAmount: INITIAL_BALANCE * STAKE_PCT,
    multiplier: MULTIPLIER,
  }, {
    runMonteCarlo: false,
    runOOS: false,
    verbose: false,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');

  console.log(`   ✅ Backtest completado: ${trades.length} trades (${wins.length}W / ${losses.length}L)\n`);

  // Build detailed loss analysis
  console.log('🔍 Analizando pérdidas en detalle...\n');
  
  const detailedLosses: DetailedLoss[] = [];
  
  for (const trade of losses) {
    const entry = trade.entry;
    const exit = trade.exit;
    if (!entry || !exit) continue;

    const entrySnapshot = entry.snapshot;
    const indicators = entrySnapshot.indicators || {};
    
    const entryPrice = entry.executedPrice;
    const exitPrice = exit.executedPrice;
    const tpPrice = trade.tpPrice || entryPrice * (trade.direction === 'CALL' ? 1.005 : 0.995);
    const slPrice = trade.slPrice || entryPrice * (trade.direction === 'CALL' ? 0.997 : 1.003);
    
    const barsHeld = Math.ceil((exit.durationMs || 0) / (60 * 1000));
    
    // Find entry candle
    const entryCandleIndex = candles.findIndex(c => 
      Math.abs(c.timestamp * 1000 - entrySnapshot.timestamp) < 60000
    );
    
    if (entryCandleIndex === -1) continue;
    const entryCandle = candles[entryCandleIndex]!;
    const pinBarInfo = analyzePinBar(entryCandle);
    
    // Price action during trade
    const futureCandles = candles.slice(entryCandleIndex + 1, entryCandleIndex + 1 + barsHeld);
    let maxFavorable = 0;
    let maxAdverse = 0;
    let reachedTP = false;
    let reachedSL = false;
    
    for (const candle of futureCandles) {
      if (trade.direction === 'CALL') {
        const favorable = (candle.high - entryPrice) / entryPrice * 100;
        const adverse = (entryPrice - candle.low) / entryPrice * 100;
        maxFavorable = Math.max(maxFavorable, favorable);
        maxAdverse = Math.max(maxAdverse, adverse);
        if (candle.high >= tpPrice) reachedTP = true;
        if (candle.low <= slPrice) reachedSL = true;
      } else {
        const favorable = (entryPrice - candle.low) / entryPrice * 100;
        const adverse = (candle.high - entryPrice) / entryPrice * 100;
        maxFavorable = Math.max(maxFavorable, favorable);
        maxAdverse = Math.max(maxAdverse, adverse);
        if (candle.low <= tpPrice) reachedTP = true;
        if (candle.high >= slPrice) reachedSL = true;
      }
    }
    
    const rsi = (indicators.rsi as number) || 50;
    const bbUpper = (indicators.bbUpper as number) || entryPrice;
    const bbLower = (indicators.bbLower as number) || entryPrice;
    const bbMiddle = (indicators.bbMiddle as number) || entryPrice;
    const ema20 = (indicators.ema20 as number) || entryPrice;
    const atr = (indicators.atr as number) || 0;
    
    const nearBB = trade.direction === 'CALL' 
      ? entryPrice >= bbLower * 0.999 && entryPrice <= bbLower * 1.001
      : entryPrice >= bbUpper * 0.999 && entryPrice <= bbUpper * 1.001;
    
    const againstTrend = trade.direction === 'CALL'
      ? entryPrice < ema20
      : entryPrice > ema20;
    
    const entryTime = new Date(entrySnapshot.timestamp);
    const priceAtBar1 = futureCandles[0]?.close || entryPrice;
    const priceAtBar2 = futureCandles[1]?.close || entryPrice;
    const priceAtBar3 = futureCandles[2]?.close || entryPrice;
    
    const immediateReversal = barsHeld <= 3;
    const nearMiss = maxFavorable >= 0.25; // 50% del TP (0.5% TP = 0.25% es 50%)
    
    detailedLosses.push({
      direction: trade.direction,
      entryPrice,
      exitPrice,
      tpPrice,
      slPrice,
      pnl: trade.result?.pnl || 0,
      barsHeld,
      exitReason: exit.reason || 'UNKNOWN',
      rsi,
      bbUpper,
      bbLower,
      bbMiddle,
      ema20,
      atr,
      price: entryPrice,
      pinBarType: pinBarInfo.type,
      wickRatio: pinBarInfo.wickRatio,
      bodyRatio: pinBarInfo.bodyRatio,
      nearBB,
      maxFavorablePct: maxFavorable,
      maxAdversePct: maxAdverse,
      reachedTP,
      reachedSL,
      priceAtBar1,
      priceAtBar2,
      priceAtBar3,
      immediateReversal,
      nearMiss,
      falsePinBar: !nearBB && pinBarInfo.type !== 'unknown',
      againstTrend,
      hour: entryTime.getUTCHours(),
      dayOfWeek: entryTime.getUTCDay(),
      timestamp: entrySnapshot.timestamp,
      volatility: getVolatility(atr, entryPrice),
      trend: getTrend(entryPrice, ema20),
    });
  }

  // Analysis
  console.log('═'.repeat(80));
  console.log('RESUMEN GENERAL');
  console.log('═'.repeat(80));
  console.log(`Total trades: ${trades.length}`);
  console.log(`Wins: ${wins.length} (${((wins.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Losses: ${losses.length} (${((losses.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%\n`);

  // 1. Immediate Reversals
  const immediateReversals = detailedLosses.filter(l => l.immediateReversal);
  console.log('═'.repeat(80));
  console.log('1. REVERSIONES INMEDIATAS (≤3 velas)');
  console.log('═'.repeat(80));
  console.log(`Total: ${immediateReversals.length} (${((immediateReversals.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas)`);
  console.log(`Promedio RSI: ${(immediateReversals.reduce((s, l) => s + l.rsi, 0) / immediateReversals.length).toFixed(1)}`);
  console.log(`Contra tendencia: ${immediateReversals.filter(l => l.againstTrend).length} (${((immediateReversals.filter(l => l.againstTrend).length / immediateReversals.length) * 100).toFixed(1)}%)`);
  console.log(`Cerca de BB: ${immediateReversals.filter(l => l.nearBB).length} (${((immediateReversals.filter(l => l.nearBB).length / immediateReversals.length) * 100).toFixed(1)}%)\n`);

  // 2. Near Misses
  const nearMisses = detailedLosses.filter(l => l.nearMiss);
  console.log('═'.repeat(80));
  console.log('2. NEAR MISSES (llegaron >50% del TP)');
  console.log('═'.repeat(80));
  console.log(`Total: ${nearMisses.length} (${((nearMisses.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas)`);
  console.log(`Promedio máximo favorable: ${(nearMisses.reduce((s, l) => s + l.maxFavorablePct, 0) / nearMisses.length).toFixed(2)}%`);
  console.log(`Promedio velas: ${(nearMisses.reduce((s, l) => s + l.barsHeld, 0) / nearMisses.length).toFixed(1)}\n`);

  // 3. RSI Analysis
  console.log('═'.repeat(80));
  console.log('3. ANÁLISIS POR RSI');
  console.log('═'.repeat(80));
  const rsiRanges = [
    { name: 'Oversold (0-30)', min: 0, max: 30 },
    { name: 'Lower (30-40)', min: 30, max: 40 },
    { name: 'Neutral (40-60)', min: 40, max: 60 },
    { name: 'Upper (60-70)', min: 60, max: 70 },
    { name: 'Overbought (70+)', min: 70, max: 100 },
  ];
  
  for (const range of rsiRanges) {
    const inRange = detailedLosses.filter(l => l.rsi >= range.min && l.rsi < range.max);
    if (inRange.length > 0) {
      console.log(`${range.name}: ${inRange.length} pérdidas (${((inRange.length / detailedLosses.length) * 100).toFixed(1)}%)`);
    }
  }
  console.log();

  // 4. Trend Analysis
  console.log('═'.repeat(80));
  console.log('4. ANÁLISIS POR TENDENCIA');
  console.log('═'.repeat(80));
  const againstTrend = detailedLosses.filter(l => l.againstTrend);
  const withTrend = detailedLosses.filter(l => !l.againstTrend);
  console.log(`Contra tendencia: ${againstTrend.length} (${((againstTrend.length / detailedLosses.length) * 100).toFixed(1)}%)`);
  console.log(`A favor de tendencia: ${withTrend.length} (${((withTrend.length / detailedLosses.length) * 100).toFixed(1)}%)\n`);

  // 5. Volatility Analysis
  console.log('═'.repeat(80));
  console.log('5. ANÁLISIS POR VOLATILIDAD');
  console.log('═'.repeat(80));
  const lowVol = detailedLosses.filter(l => l.volatility === 'low');
  const medVol = detailedLosses.filter(l => l.volatility === 'medium');
  const highVol = detailedLosses.filter(l => l.volatility === 'high');
  console.log(`Baja: ${lowVol.length} (${((lowVol.length / detailedLosses.length) * 100).toFixed(1)}%)`);
  console.log(`Media: ${medVol.length} (${((medVol.length / detailedLosses.length) * 100).toFixed(1)}%)`);
  console.log(`Alta: ${highVol.length} (${((highVol.length / detailedLosses.length) * 100).toFixed(1)}%)\n`);

  // 6. Time Analysis
  console.log('═'.repeat(80));
  console.log('6. ANÁLISIS TEMPORAL');
  console.log('═'.repeat(80));
  const hours: Record<number, number> = {};
  const days: Record<number, number> = {};
  
  for (const loss of detailedLosses) {
    hours[loss.hour] = (hours[loss.hour] || 0) + 1;
    days[loss.dayOfWeek] = (days[loss.dayOfWeek] || 0) + 1;
  }
  
  const worstHours = Object.entries(hours)
    .sort((a, b) => b[1]! - a[1]!)
    .slice(0, 5);
  
  console.log('Peores horas (UTC):');
  for (const [hour, count] of worstHours) {
    console.log(`  ${hour}:00 - ${count} pérdidas`);
  }
  
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  console.log('\nPérdidas por día:');
  for (let i = 0; i < 7; i++) {
    if (days[i]) {
      console.log(`  ${dayNames[i]}: ${days[i]} pérdidas`);
    }
  }
  console.log();

  // 7. Pin Bar Quality
  console.log('═'.repeat(80));
  console.log('7. CALIDAD DE PIN BARS');
  console.log('═'.repeat(80));
  const avgWickRatio = detailedLosses.reduce((s, l) => s + l.wickRatio, 0) / detailedLosses.length;
  const avgBodyRatio = detailedLosses.reduce((s, l) => s + l.bodyRatio, 0) / detailedLosses.length;
  console.log(`Promedio wick ratio: ${(avgWickRatio * 100).toFixed(1)}%`);
  console.log(`Promedio body ratio: ${(avgBodyRatio * 100).toFixed(1)}%`);
  console.log(`Cerca de BB: ${detailedLosses.filter(l => l.nearBB).length} (${((detailedLosses.filter(l => l.nearBB).length / detailedLosses.length) * 100).toFixed(1)}%)\n`);

  // 8. Recommendations
  console.log('═'.repeat(80));
  console.log('8. RECOMENDACIONES DE MEJORA');
  console.log('═'.repeat(80));
  
  const recommendations: string[] = [];
  
  if (immediateReversals.length / detailedLosses.length > 0.3) {
    recommendations.push(`✅ Agregar confirmación post-entrada: ${((immediateReversals.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas son reversiones inmediatas`);
  }
  
  if (nearMisses.length / detailedLosses.length > 0.2) {
    recommendations.push(`✅ Implementar trailing stop: ${((nearMisses.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas llegaron a >50% del TP`);
  }
  
  if (againstTrend.length / detailedLosses.length > 0.4) {
    recommendations.push(`✅ Filtrar trades contra tendencia: ${((againstTrend.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas fueron contra tendencia`);
  }
  
  if (detailedLosses.filter(l => !l.nearBB).length / detailedLosses.length > 0.5) {
    recommendations.push(`✅ Mejorar detección de pin bars cerca de BB: ${((detailedLosses.filter(l => !l.nearBB).length / detailedLosses.length) * 100).toFixed(1)}% no estaban cerca de BB`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('✅ La estrategia parece estar bien calibrada. Considera optimizar parámetros menores.');
  }
  
  for (const rec of recommendations) {
    console.log(rec);
  }
  console.log();

  // Export CSV
  const csvPath = path.join(process.cwd(), 'analysis-output', `pinbar_losses_${ASSET}_${Date.now()}.csv`);
  const csvHeader = [
    'Direction', 'EntryPrice', 'ExitPrice', 'PnL', 'BarsHeld', 'ExitReason',
    'RSI', 'ATR', 'Volatility', 'Trend', 'AgainstTrend',
    'PinBarType', 'WickRatio', 'BodyRatio', 'NearBB',
    'MaxFavorable%', 'MaxAdverse%', 'ReachedTP', 'ReachedSL',
    'ImmediateReversal', 'NearMiss', 'Hour', 'DayOfWeek',
  ].join(',');
  
  const csvRows = detailedLosses.map(l => [
    l.direction,
    l.entryPrice.toFixed(2),
    l.exitPrice.toFixed(2),
    l.pnl.toFixed(2),
    l.barsHeld,
    l.exitReason,
    l.rsi.toFixed(1),
    l.atr.toFixed(4),
    l.volatility,
    l.trend,
    l.againstTrend ? 'Yes' : 'No',
    l.pinBarType,
    (l.wickRatio * 100).toFixed(1),
    (l.bodyRatio * 100).toFixed(1),
    l.nearBB ? 'Yes' : 'No',
    l.maxFavorablePct.toFixed(2),
    l.maxAdversePct.toFixed(2),
    l.reachedTP ? 'Yes' : 'No',
    l.reachedSL ? 'Yes' : 'No',
    l.immediateReversal ? 'Yes' : 'No',
    l.nearMiss ? 'Yes' : 'No',
    l.hour,
    l.dayOfWeek,
  ].join(','));
  
  const csvContent = [csvHeader, ...csvRows].join('\n');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, csvContent);
  
  console.log('═'.repeat(80));
  console.log(`📄 CSV exportado: ${csvPath}`);
  console.log('═'.repeat(80));
}

main().catch(console.error);

