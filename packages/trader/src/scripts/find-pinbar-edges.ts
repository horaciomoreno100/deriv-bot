#!/usr/bin/env npx tsx
/**
 * Find Pin Bar Strategy Edges
 * 
 * Busca condiciones específicas donde la estrategia funciona mejor
 * para identificar y explotar los "edges" reales
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  createPinBarStrategy,
} from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

const ASSET = 'frxXAUUSD';
const DATA_FILE = 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_TEST = 30;
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface TradeEdge {
  // Trade info
  direction: 'CALL' | 'PUT';
  result: 'WIN' | 'LOSS';
  pnl: number;
  
  // Entry conditions
  rsi: number;
  rsiCategory: 'oversold' | 'lower' | 'neutral' | 'upper' | 'overbought';
  ema20: number;
  price: number;
  priceVsEma: 'above' | 'below' | 'at';
  distanceFromEma: number; // % distance
  
  // Pin bar characteristics
  wickRatio: number;
  bodyRatio: number;
  nearBB: boolean;
  pinBarType: 'bullish' | 'bearish';
  
  // Market conditions
  volatility: 'low' | 'medium' | 'high';
  trend: 'up' | 'down' | 'sideways';
  
  // Time context
  hour: number;
  dayOfWeek: number;
  dayName: string;
  
  // BB position
  bbPosition: 'upper' | 'middle' | 'lower' | 'outside';
}

function categorizeRSI(rsi: number): 'oversold' | 'lower' | 'neutral' | 'upper' | 'overbought' {
  if (rsi < 30) return 'oversold';
  if (rsi < 40) return 'lower';
  if (rsi < 60) return 'neutral';
  if (rsi < 70) return 'upper';
  return 'overbought';
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

function getBBPosition(price: number, bbUpper: number, bbLower: number, bbMiddle: number): 'upper' | 'middle' | 'lower' | 'outside' {
  if (price >= bbUpper) return 'upper';
  if (price <= bbLower) return 'lower';
  if (Math.abs(price - bbMiddle) / bbMiddle < 0.001) return 'middle';
  return 'outside';
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
  console.log('║   FINDING PIN BAR STRATEGY EDGES                          ║');
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
  const lastCandleTime = firstCandleTime + (DAYS_TO_TEST * oneDaySeconds);

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

  console.log(`   ✅ Backtest completado: ${result.trades.length} trades\n`);

  // Build edge analysis
  console.log('🔍 Analizando edges...\n');
  
  const edges: TradeEdge[] = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  
  for (const trade of result.trades) {
    const entry = trade.entry;
    if (!entry) continue;

    const indicators = entry.snapshot.indicators || {};
    const entryPrice = entry.executedPrice;
    const rsi = (indicators.rsi as number) || 50;
    const ema20 = (indicators.ema20 as number) || entryPrice;
    const bbUpper = (indicators.bbUpper as number) || entryPrice;
    const bbLower = (indicators.bbLower as number) || entryPrice;
    const bbMiddle = (indicators.bbMiddle as number) || entryPrice;
    const atr = (indicators.atr as number) || 0;
    
    // Find entry candle
    const entryCandleIndex = candles.findIndex(c => 
      Math.abs(c.timestamp * 1000 - entry.snapshot.timestamp) < 60000
    );
    
    if (entryCandleIndex === -1) continue;
    const entryCandle = candles[entryCandleIndex]!;
    const pinBarInfo = analyzePinBar(entryCandle);
    
    const priceVsEma = entryPrice > ema20 * 1.001 ? 'above' : 
                       entryPrice < ema20 * 0.999 ? 'below' : 'at';
    const distanceFromEma = Math.abs((entryPrice - ema20) / ema20) * 100;
    
    const nearBB = trade.direction === 'CALL' 
      ? entryPrice >= bbLower * 0.999 && entryPrice <= bbLower * 1.001
      : entryPrice >= bbUpper * 0.999 && entryPrice <= bbUpper * 1.001;
    
    const entryTime = new Date(entry.snapshot.timestamp);
    
    edges.push({
      direction: trade.direction,
      result: trade.result?.outcome || 'LOSS',
      pnl: trade.result?.pnl || 0,
      rsi,
      rsiCategory: categorizeRSI(rsi),
      ema20,
      price: entryPrice,
      priceVsEma,
      distanceFromEma,
      wickRatio: pinBarInfo.wickRatio,
      bodyRatio: pinBarInfo.bodyRatio,
      nearBB,
      pinBarType: pinBarInfo.type,
      volatility: getVolatility(atr, entryPrice),
      trend: getTrend(entryPrice, ema20),
      hour: entryTime.getUTCHours(),
      dayOfWeek: entryTime.getUTCDay(),
      dayName: dayNames[entryTime.getUTCDay()]!,
      bbPosition: getBBPosition(entryPrice, bbUpper, bbLower, bbMiddle),
    });
  }

  // Analyze edges by different dimensions
  console.log('═'.repeat(80));
  console.log('EDGE ANALYSIS - WIN RATE BY CONDITION');
  console.log('═'.repeat(80));
  console.log();

  // 1. RSI Category
  console.log('1. RSI CATEGORY');
  console.log('-'.repeat(80));
  const rsiGroups: Record<string, { wins: number; total: number; pnl: number }> = {};
  for (const edge of edges) {
    const key = edge.rsiCategory;
    if (!rsiGroups[key]) rsiGroups[key] = { wins: 0, total: 0, pnl: 0 };
    rsiGroups[key]!.total++;
    if (edge.result === 'WIN') rsiGroups[key]!.wins++;
    rsiGroups[key]!.pnl += edge.pnl;
  }
  
  for (const [category, data] of Object.entries(rsiGroups)) {
    const wr = (data.wins / data.total) * 100;
    const avgPnl = data.pnl / data.total;
    const emoji = wr > 55 ? '✅' : wr < 45 ? '❌' : '⚪';
    console.log(`${emoji} ${category.padEnd(12)}: ${data.total.toString().padStart(4)} trades | WR: ${wr.toFixed(1)}% | Avg P&L: $${avgPnl.toFixed(2)}`);
  }
  console.log();

  // 2. Price vs EMA
  console.log('2. PRICE vs EMA (Trend Alignment)');
  console.log('-'.repeat(80));
  const trendGroups: Record<string, { wins: number; total: number; pnl: number }> = {};
  for (const edge of edges) {
    const key = `${edge.direction} ${edge.priceVsEma} EMA`;
    if (!trendGroups[key]) trendGroups[key] = { wins: 0, total: 0, pnl: 0 };
    trendGroups[key]!.total++;
    if (edge.result === 'WIN') trendGroups[key]!.wins++;
    trendGroups[key]!.pnl += edge.pnl;
  }
  
  for (const [condition, data] of Object.entries(trendGroups).sort((a, b) => 
    (b[1]!.wins / b[1]!.total) - (a[1]!.wins / a[1]!.total)
  )) {
    const wr = (data.wins / data.total) * 100;
    const avgPnl = data.pnl / data.total;
    const emoji = wr > 55 ? '✅' : wr < 45 ? '❌' : '⚪';
    console.log(`${emoji} ${condition.padEnd(20)}: ${data.total.toString().padStart(4)} trades | WR: ${wr.toFixed(1)}% | Avg P&L: $${avgPnl.toFixed(2)}`);
  }
  console.log();

  // 3. Near BB
  console.log('3. NEAR BOLLINGER BAND');
  console.log('-'.repeat(80));
  const bbGroups: Record<string, { wins: number; total: number; pnl: number }> = {};
  for (const edge of edges) {
    const key = edge.nearBB ? 'Near BB' : 'Not Near BB';
    if (!bbGroups[key]) bbGroups[key] = { wins: 0, total: 0, pnl: 0 };
    bbGroups[key]!.total++;
    if (edge.result === 'WIN') bbGroups[key]!.wins++;
    bbGroups[key]!.pnl += edge.pnl;
  }
  
  for (const [condition, data] of Object.entries(bbGroups)) {
    const wr = (data.wins / data.total) * 100;
    const avgPnl = data.pnl / data.total;
    const emoji = wr > 55 ? '✅' : wr < 45 ? '❌' : '⚪';
    console.log(`${emoji} ${condition.padEnd(20)}: ${data.total.toString().padStart(4)} trades | WR: ${wr.toFixed(1)}% | Avg P&L: $${avgPnl.toFixed(2)}`);
  }
  console.log();

  // 4. Pin Bar Quality (Wick Ratio)
  console.log('4. PIN BAR QUALITY (Wick Ratio)');
  console.log('-'.repeat(80));
  const wickGroups: Record<string, { wins: number; total: number; pnl: number }> = {};
  for (const edge of edges) {
    let key: string;
    if (edge.wickRatio >= 0.7) key = 'Very Strong (≥70%)';
    else if (edge.wickRatio >= 0.6) key = 'Strong (60-70%)';
    else if (edge.wickRatio >= 0.5) key = 'Good (50-60%)';
    else key = 'Weak (<50%)';
    
    if (!wickGroups[key]) wickGroups[key] = { wins: 0, total: 0, pnl: 0 };
    wickGroups[key]!.total++;
    if (edge.result === 'WIN') wickGroups[key]!.wins++;
    wickGroups[key]!.pnl += edge.pnl;
  }
  
  for (const [quality, data] of Object.entries(wickGroups).sort((a, b) => 
    (b[1]!.wins / b[1]!.total) - (a[1]!.wins / a[1]!.total)
  )) {
    const wr = (data.wins / data.total) * 100;
    const avgPnl = data.pnl / data.total;
    const emoji = wr > 55 ? '✅' : wr < 45 ? '❌' : '⚪';
    console.log(`${emoji} ${quality.padEnd(20)}: ${data.total.toString().padStart(4)} trades | WR: ${wr.toFixed(1)}% | Avg P&L: $${avgPnl.toFixed(2)}`);
  }
  console.log();

  // 5. Time-based edges
  console.log('5. TIME-BASED EDGES');
  console.log('-'.repeat(80));
  const hourGroups: Record<number, { wins: number; total: number; pnl: number }> = {};
  for (const edge of edges) {
    if (!hourGroups[edge.hour]) hourGroups[edge.hour] = { wins: 0, total: 0, pnl: 0 };
    hourGroups[edge.hour]!.total++;
    if (edge.result === 'WIN') hourGroups[edge.hour]!.wins++;
    hourGroups[edge.hour]!.pnl += edge.pnl;
  }
  
  const bestHours = Object.entries(hourGroups)
    .map(([hour, data]) => ({
      hour: parseInt(hour),
      wr: (data.wins / data.total) * 100,
      total: data.total,
      avgPnl: data.pnl / data.total,
    }))
    .filter(h => h.total >= 10) // At least 10 trades
    .sort((a, b) => b.wr - a.wr)
    .slice(0, 5);
  
  console.log('Mejores horas (UTC):');
  for (const h of bestHours) {
    const emoji = h.wr > 55 ? '✅' : h.wr < 45 ? '❌' : '⚪';
    console.log(`${emoji} ${h.hour.toString().padStart(2)}:00 - ${h.total.toString().padStart(3)} trades | WR: ${h.wr.toFixed(1)}% | Avg P&L: $${h.avgPnl.toFixed(2)}`);
  }
  console.log();

  const dayGroups: Record<string, { wins: number; total: number; pnl: number }> = {};
  for (const edge of edges) {
    if (!dayGroups[edge.dayName]) dayGroups[edge.dayName] = { wins: 0, total: 0, pnl: 0 };
    dayGroups[edge.dayName]!.total++;
    if (edge.result === 'WIN') dayGroups[edge.dayName]!.wins++;
    dayGroups[edge.dayName]!.pnl += edge.pnl;
  }
  
  console.log('Por día de la semana:');
  for (const [day, data] of Object.entries(dayGroups).sort((a, b) => 
    (b[1]!.wins / b[1]!.total) - (a[1]!.wins / a[1]!.total)
  )) {
    const wr = (data.wins / data.total) * 100;
    const avgPnl = data.pnl / data.total;
    const emoji = wr > 55 ? '✅' : wr < 45 ? '❌' : '⚪';
    console.log(`${emoji} ${day.padEnd(4)}: ${data.total.toString().padStart(4)} trades | WR: ${wr.toFixed(1)}% | Avg P&L: $${avgPnl.toFixed(2)}`);
  }
  console.log();

  // 6. Combined edges (best combinations)
  console.log('═'.repeat(80));
  console.log('TOP EDGES - BEST COMBINATIONS');
  console.log('═'.repeat(80));
  console.log();

  // Find best combinations
  const combinations: Record<string, { wins: number; total: number; pnl: number }> = {};
  
  for (const edge of edges) {
    // Combination 1: Direction + Price vs EMA
    const combo1 = `${edge.direction} ${edge.priceVsEma} EMA`;
    if (!combinations[combo1]) combinations[combo1] = { wins: 0, total: 0, pnl: 0 };
    combinations[combo1]!.total++;
    if (edge.result === 'WIN') combinations[combo1]!.wins++;
    combinations[combo1]!.pnl += edge.pnl;
    
    // Combination 2: RSI Category + Near BB
    const combo2 = `${edge.rsiCategory} RSI + ${edge.nearBB ? 'Near BB' : 'Not Near BB'}`;
    if (!combinations[combo2]) combinations[combo2] = { wins: 0, total: 0, pnl: 0 };
    combinations[combo2]!.total++;
    if (edge.result === 'WIN') combinations[combo2]!.wins++;
    combinations[combo2]!.pnl += edge.pnl;
    
    // Combination 3: Direction + RSI Category
    const combo3 = `${edge.direction} + ${edge.rsiCategory} RSI`;
    if (!combinations[combo3]) combinations[combo3] = { wins: 0, total: 0, pnl: 0 };
    combinations[combo3]!.total++;
    if (edge.result === 'WIN') combinations[combo3]!.wins++;
    combinations[combo3]!.pnl += edge.pnl;
  }

  const topCombos = Object.entries(combinations)
    .map(([combo, data]) => ({
      combo,
      wr: (data.wins / data.total) * 100,
      total: data.total,
      avgPnl: data.pnl / data.total,
      totalPnl: data.pnl,
    }))
    .filter(c => c.total >= 15) // At least 15 trades for statistical significance
    .sort((a, b) => b.wr - a.wr)
    .slice(0, 10);

  console.log('Top 10 combinaciones (por Win Rate):');
  for (const combo of topCombos) {
    const emoji = combo.wr > 60 ? '🔥' : combo.wr > 55 ? '✅' : '⚪';
    console.log(`${emoji} ${combo.combo.padEnd(40)}: ${combo.total.toString().padStart(3)} trades | WR: ${combo.wr.toFixed(1)}% | Avg: $${combo.avgPnl.toFixed(2)} | Total: $${combo.totalPnl.toFixed(2)}`);
  }
  console.log();

  // Export detailed data
  const csvPath = path.join(process.cwd(), 'analysis-output', `pinbar_edges_${ASSET}_${Date.now()}.csv`);
  const csvHeader = [
    'Direction', 'Result', 'PnL', 'RSI', 'RSICategory', 'PriceVsEma', 'DistanceFromEma',
    'WickRatio', 'BodyRatio', 'NearBB', 'Volatility', 'Trend', 'Hour', 'Day', 'BBPosition',
  ].join(',');
  
  const csvRows = edges.map(e => [
    e.direction,
    e.result,
    e.pnl.toFixed(2),
    e.rsi.toFixed(1),
    e.rsiCategory,
    e.priceVsEma,
    e.distanceFromEma.toFixed(3),
    (e.wickRatio * 100).toFixed(1),
    (e.bodyRatio * 100).toFixed(1),
    e.nearBB ? 'Yes' : 'No',
    e.volatility,
    e.trend,
    e.hour,
    e.dayName,
    e.bbPosition,
  ].join(','));
  
  const csvContent = [csvHeader, ...csvRows].join('\n');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, csvContent);
  
  console.log('═'.repeat(80));
  console.log(`📄 Datos detallados exportados: ${csvPath}`);
  console.log('═'.repeat(80));
}

main().catch(console.error);

