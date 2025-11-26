/**
 * Diagnose Low Win Rate
 *
 * Analiza por qué el win rate es tan bajo (36%) y qué podemos mejorar
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradeAnalysis {
  signal: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  exitReason: 'TP' | 'SL' | 'SMA' | 'TIMEOUT';
  profit: number;
  result: 'WIN' | 'LOSS';
  rsiAtEntry: number;
  maxFavorable: number;  // Máximo movimiento a favor
  maxAdverse: number;    // Máximo movimiento en contra
  barsToExit: number;
  hitTPFirst: boolean;   // Si tocó TP antes que SL
  hitSLFirst: boolean;   // Si tocó SL antes que TP
}

function loadCandles(asset: string, timeframe: string = '1m', days: string = '90'): Candle[] | null {
  const tfLabel = timeframe === '1m' ? '1m' : timeframe;
  let csvPath = join(process.cwd(), 'backtest-data', `${asset}_${tfLabel}_${days}d.csv`);
  if (!existsSync(csvPath)) csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`);
  if (!existsSync(csvPath)) csvPath = join(process.cwd(), 'backtest-data', `${asset}_1m_30d.csv`);
  if (!existsSync(csvPath)) return null;

  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1);

  return lines.map(line => {
    const [timestamp, open, high, low, close] = line.split(',');
    const ts = parseInt(timestamp!);
    return {
      timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
      open: parseFloat(open!),
      high: parseFloat(high!),
      low: parseFloat(low!),
      close: parseFloat(close!),
    };
  }).filter(c => !isNaN(c.timestamp));
}

function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateStdDev(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  return Math.sqrt(slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period);
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return NaN;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i]!;
    const prevClose = candles[i - 1]?.close || curr.open;
    const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + (gains / period) / (losses / period)));
}

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';

// Strategy parameters
const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

console.log('='.repeat(70));
console.log('🔍 DIAGNÓSTICO DE WIN RATE BAJO');
console.log('='.repeat(70));

const candles = loadCandles(ASSET, '1m', DAYS);
if (!candles) {
  console.log('❌ No se encontraron datos');
  process.exit(1);
}

console.log(`\nAsset: ${ASSET} | Period: ${DAYS} days | Candles: ${candles.length}`);
console.log(`TP: ${params.takeProfitPct * 100}% | SL: ${params.stopLossPct * 100}%`);

const closes = candles.map(c => c.close);
let inSqueeze = false;
let squeezeEndBar = -1;
let lastTradeBar = -Infinity;
const minBars = 30;

const trades: TradeAnalysis[] = [];

for (let i = minBars; i < candles.length - 30; i++) {
  if (i - lastTradeBar < params.cooldownBars) continue;

  const candle = candles[i]!;
  const closeSlice = closes.slice(0, i + 1);
  const candleSlice = candles.slice(0, i + 1);

  const sma = calculateSMA(closeSlice, params.bbPeriod);
  const std = calculateStdDev(closeSlice, params.bbPeriod);
  const bbUpper = sma + (std * params.bbStdDev);
  const bbLower = sma - (std * params.bbStdDev);

  const atr = calculateATR(candleSlice, params.kcPeriod);
  const kcUpper = sma + (atr * params.kcMultiplier);
  const kcLower = sma - (atr * params.kcMultiplier);

  const rsi = calculateRSI(closeSlice, params.rsiPeriod);

  const currentSqueeze = bbUpper < kcUpper && bbLower > kcLower;

  if (currentSqueeze && !inSqueeze) {
    inSqueeze = true;
  } else if (!currentSqueeze && inSqueeze) {
    inSqueeze = false;
    squeezeEndBar = i;
  }

  if (squeezeEndBar < 0 || i - squeezeEndBar > 10) continue;

  const price = candle.close;

  // Señal actual (la que tiene problemas)
  let signal: 'CALL' | 'PUT' | null = null;
  if (price > bbUpper && rsi > params.rsiOverbought) {
    signal = 'CALL';
  } else if (price < bbLower && rsi < params.rsiOversold) {
    signal = 'PUT';
  }

  if (!signal) continue;

  const entryPrice = candle.close;
  const tpPrice = signal === 'CALL'
    ? entryPrice * (1 + params.takeProfitPct)
    : entryPrice * (1 - params.takeProfitPct);
  const slPrice = signal === 'CALL'
    ? entryPrice * (1 - params.stopLossPct)
    : entryPrice * (1 + params.stopLossPct);

  let exitPrice = entryPrice;
  let exitReason: 'TP' | 'SL' | 'SMA' | 'TIMEOUT' = 'TIMEOUT';
  let barsToExit = 0;
  let maxFavorable = 0;
  let maxAdverse = 0;
  let hitTPFirst = false;
  let hitSLFirst = false;
  let tpBar = -1;
  let slBar = -1;

  for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
    const fc = candles[j]!;
    barsToExit = j - i;

    // Track max favorable/adverse
    if (signal === 'CALL') {
      maxFavorable = Math.max(maxFavorable, (fc.high - entryPrice) / entryPrice);
      maxAdverse = Math.max(maxAdverse, (entryPrice - fc.low) / entryPrice);
    } else {
      maxFavorable = Math.max(maxFavorable, (entryPrice - fc.low) / entryPrice);
      maxAdverse = Math.max(maxAdverse, (fc.high - entryPrice) / entryPrice);
    }

    // Track first touch
    if (tpBar < 0 && signal === 'CALL' && fc.high >= tpPrice) tpBar = j;
    if (tpBar < 0 && signal === 'PUT' && fc.low <= tpPrice) tpBar = j;
    if (slBar < 0 && signal === 'CALL' && fc.low <= slPrice) slBar = j;
    if (slBar < 0 && signal === 'PUT' && fc.high >= slPrice) slBar = j;

    // Simulación de salida actual
    const futureSMA = calculateSMA(closes.slice(0, j + 1), params.bbPeriod);

    if (signal === 'CALL' && fc.high >= tpPrice) { exitPrice = tpPrice; exitReason = 'TP'; break; }
    if (signal === 'PUT' && fc.low <= tpPrice) { exitPrice = tpPrice; exitReason = 'TP'; break; }
    if (signal === 'CALL' && fc.low <= slPrice) { exitPrice = slPrice; exitReason = 'SL'; break; }
    if (signal === 'PUT' && fc.high >= slPrice) { exitPrice = slPrice; exitReason = 'SL'; break; }
    if (signal === 'CALL' && fc.close <= futureSMA) { exitPrice = fc.close; exitReason = 'SMA'; break; }
    if (signal === 'PUT' && fc.close >= futureSMA) { exitPrice = fc.close; exitReason = 'SMA'; break; }
    exitPrice = fc.close;
  }

  hitTPFirst = tpBar > 0 && (slBar < 0 || tpBar < slBar);
  hitSLFirst = slBar > 0 && (tpBar < 0 || slBar < tpBar);

  const priceChangePct = signal === 'CALL'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const profit = priceChangePct * 100 * 100;  // stake * multiplier simplified

  trades.push({
    signal,
    entryPrice,
    exitPrice,
    exitReason,
    profit,
    result: profit > 0 ? 'WIN' : 'LOSS',
    rsiAtEntry: rsi,
    maxFavorable: maxFavorable * 100,
    maxAdverse: maxAdverse * 100,
    barsToExit,
    hitTPFirst,
    hitSLFirst,
  });

  lastTradeBar = i;
}

// Análisis
console.log(`\n${'='.repeat(70)}`);
console.log('📊 RESULTADOS GENERALES');
console.log('='.repeat(70));

const wins = trades.filter(t => t.result === 'WIN').length;
const losses = trades.filter(t => t.result === 'LOSS').length;
const winRate = (wins / trades.length) * 100;

console.log(`Total trades: ${trades.length}`);
console.log(`Wins: ${wins} | Losses: ${losses}`);
console.log(`Win Rate: ${winRate.toFixed(1)}%`);

// Análisis por razón de salida
console.log(`\n📤 RAZONES DE SALIDA:`);
const exitReasons = { TP: 0, SL: 0, SMA: 0, TIMEOUT: 0 };
trades.forEach(t => exitReasons[t.exitReason]++);
Object.entries(exitReasons).forEach(([reason, count]) => {
  const pct = (count / trades.length * 100).toFixed(1);
  console.log(`   ${reason}: ${count} (${pct}%)`);
});

// Análisis de oportunidades perdidas
console.log(`\n🎯 ANÁLISIS DE MOVIMIENTOS:`);
const avgMaxFavorable = trades.reduce((sum, t) => sum + t.maxFavorable, 0) / trades.length;
const avgMaxAdverse = trades.reduce((sum, t) => sum + t.maxAdverse, 0) / trades.length;
const tpPct = params.takeProfitPct * 100;
const slPct = params.stopLossPct * 100;

console.log(`   TP target: ${tpPct.toFixed(2)}% | SL target: ${slPct.toFixed(2)}%`);
console.log(`   Promedio max favorable: ${avgMaxFavorable.toFixed(3)}%`);
console.log(`   Promedio max adverse: ${avgMaxAdverse.toFixed(3)}%`);

// ¿Cuántos tocaron TP vs SL primero?
const touchedTPFirst = trades.filter(t => t.hitTPFirst).length;
const touchedSLFirst = trades.filter(t => t.hitSLFirst).length;
const touchedBoth = trades.filter(t => t.hitTPFirst && t.hitSLFirst).length;
const touchedNeither = trades.filter(t => !t.hitTPFirst && !t.hitSLFirst).length;

console.log(`\n🔄 ORDEN DE HITS (TP vs SL):`);
console.log(`   TP primero: ${touchedTPFirst} (${(touchedTPFirst/trades.length*100).toFixed(1)}%)`);
console.log(`   SL primero: ${touchedSLFirst} (${(touchedSLFirst/trades.length*100).toFixed(1)}%)`);
console.log(`   Ambos: ${touchedBoth} | Ninguno: ${touchedNeither}`);

// ¿Cuántos hubieran sido ganadores sin la salida por SMA?
const smaExits = trades.filter(t => t.exitReason === 'SMA');
const smaWouldWin = smaExits.filter(t => t.hitTPFirst).length;
console.log(`\n⚠️  SALIDAS POR SMA (problema potencial):`);
console.log(`   Total: ${smaExits.length}`);
console.log(`   Que tocaron TP después: ${smaWouldWin} (OPORTUNIDADES PERDIDAS)`);

// Análisis por RSI al entry
console.log(`\n📈 RSI AL MOMENTO DE ENTRY:`);
const rsiRanges = {
  '0-30': trades.filter(t => t.rsiAtEntry < 30),
  '30-40': trades.filter(t => t.rsiAtEntry >= 30 && t.rsiAtEntry < 40),
  '40-50': trades.filter(t => t.rsiAtEntry >= 40 && t.rsiAtEntry < 50),
  '50-60': trades.filter(t => t.rsiAtEntry >= 50 && t.rsiAtEntry < 60),
  '60-70': trades.filter(t => t.rsiAtEntry >= 60 && t.rsiAtEntry < 70),
  '70-100': trades.filter(t => t.rsiAtEntry >= 70),
};

Object.entries(rsiRanges).forEach(([range, rangeTradesArray]) => {
  if (rangeTradesArray.length === 0) return;
  const rangeWins = rangeTradesArray.filter(t => t.result === 'WIN').length;
  const rangeWR = (rangeWins / rangeTradesArray.length * 100).toFixed(1);
  console.log(`   RSI ${range}: ${rangeTradesArray.length} trades, WR ${rangeWR}%`);
});

// Análisis CALL vs PUT
console.log(`\n📊 CALL vs PUT:`);
const calls = trades.filter(t => t.signal === 'CALL');
const puts = trades.filter(t => t.signal === 'PUT');
const callWR = calls.length > 0 ? (calls.filter(t => t.result === 'WIN').length / calls.length * 100).toFixed(1) : 'N/A';
const putWR = puts.length > 0 ? (puts.filter(t => t.result === 'WIN').length / puts.length * 100).toFixed(1) : 'N/A';
console.log(`   CALL: ${calls.length} trades, WR ${callWR}%`);
console.log(`   PUT: ${puts.length} trades, WR ${putWR}%`);

// Conclusiones
console.log(`\n${'='.repeat(70)}`);
console.log('💡 DIAGNÓSTICO');
console.log('='.repeat(70));

if (exitReasons.SMA > trades.length * 0.3) {
  console.log(`\n⚠️  PROBLEMA 1: Demasiadas salidas por SMA (${(exitReasons.SMA/trades.length*100).toFixed(0)}%)`);
  console.log(`   Solución: Quitar o relajar la salida por SMA`);
}

if (avgMaxFavorable > tpPct * 1.5) {
  console.log(`\n⚠️  PROBLEMA 2: El precio se mueve ${(avgMaxFavorable/tpPct).toFixed(1)}x más que el TP`);
  console.log(`   Solución: Considerar TP más amplio o trailing stop`);
}

if (avgMaxAdverse > slPct * 1.2) {
  console.log(`\n⚠️  PROBLEMA 3: El drawdown promedio (${avgMaxAdverse.toFixed(2)}%) excede el SL (${slPct.toFixed(2)}%)`);
  console.log(`   Solución: SL muy ajustado, considerar ampliarlo`);
}

const callRSI = calls.length > 0 ? calls.reduce((s, t) => s + t.rsiAtEntry, 0) / calls.length : 0;
const putRSI = puts.length > 0 ? puts.reduce((s, t) => s + t.rsiAtEntry, 0) / puts.length : 0;

if (callRSI > 60) {
  console.log(`\n⚠️  PROBLEMA 4: Entramos CALL con RSI alto (${callRSI.toFixed(0)})`);
  console.log(`   Esto significa que compramos cuando ya está sobrecomprado!`);
  console.log(`   Solución: Invertir la lógica o esperar pullback`);
}

if (putRSI < 40) {
  console.log(`\n⚠️  PROBLEMA 5: Entramos PUT con RSI bajo (${putRSI.toFixed(0)})`);
  console.log(`   Esto significa que vendemos cuando ya está sobrevendido!`);
  console.log(`   Solución: Invertir la lógica o esperar rally`);
}

console.log('\n');
