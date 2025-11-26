/**
 * Analyze backtest exits - debug script
 * Run: npx tsx src/scripts/analyze-backtest-exits.ts
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

interface Trade {
  entryTime: number;
  exitTime: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  profit: number;
  result: 'WIN' | 'LOSS';
  exitReason: 'TP' | 'SL' | 'BB_MIDDLE';
}

function loadCandles(asset: string): Candle[] | null {
  const days = process.env.DAYS || '30';
  // Try 90d first, then 30d
  let csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`);
  if (!existsSync(csvPath)) {
    csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_30d.csv`);
  }
  if (!existsSync(csvPath)) return null;
  console.log(`Loading from: ${csvPath}`);

  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1);

  return lines.map(line => {
    const [timestamp, open, high, low, close] = line.split(',');
    const ts = parseInt(timestamp);
    return {
      timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
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
    const prevClose = candles[i - 1]?.close || candles[i].open;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + (gains / period) / (losses / period)));
}

const ASSET = process.env.ASSET || 'R_100';
const STAKE = 200; // $200 per trade
const MULTIPLIER = 100; // x100 multiplier

console.log('='.repeat(70));
console.log(`BACKTEST ANALYSIS - ${ASSET}`);
console.log('='.repeat(70));

const candles = loadCandles(ASSET);
if (!candles) {
  console.log('No data found');
  process.exit(1);
}

console.log(`Loaded ${candles.length} candles`);

const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

const trades: Trade[] = [];
const closes = candles.map(c => c.close);
let inSqueeze = false;
let squeezeEndBar = -1;
let lastTradeBar = -Infinity;
const minBars = 30;

for (let i = minBars; i < candles.length - 30; i++) {
  if (i - lastTradeBar < params.cooldownBars) continue;

  const candle = candles[i];
  const closeSlice = closes.slice(0, i + 1);
  const candleSlice = candles.slice(0, i + 1);

  const sma = calculateSMA(closeSlice, params.bbPeriod);
  const std = calculateStdDev(closeSlice, params.bbPeriod);
  const bbUpper = sma + (std * params.bbStdDev);
  const bbLower = sma - (std * params.bbStdDev);
  const bbMiddle = sma;

  const ema = calculateSMA(closeSlice, params.kcPeriod);
  const atr = calculateATR(candleSlice, params.kcPeriod);
  const kcUpper = ema + (atr * params.kcMultiplier);
  const kcLower = ema - (atr * params.kcMultiplier);

  const rsi = calculateRSI(closeSlice, params.rsiPeriod);

  if (isNaN(bbUpper) || isNaN(kcUpper) || isNaN(rsi)) continue;

  const currentSqueeze = bbUpper < kcUpper && bbLower > kcLower;

  if (currentSqueeze && !inSqueeze) inSqueeze = true;
  else if (!currentSqueeze && inSqueeze) {
    inSqueeze = false;
    squeezeEndBar = i;
  }

  if (squeezeEndBar < 0 || i - squeezeEndBar > 10) continue;

  const price = candle.close;
  let signal: 'CALL' | 'PUT' | null = null;

  if (price > bbUpper && rsi > params.rsiOverbought) signal = 'CALL';
  else if (price < bbLower && rsi < params.rsiOversold) signal = 'PUT';

  if (!signal) continue;

  const entryPrice = price;
  const tpPrice = signal === 'CALL'
    ? entryPrice * (1 + params.takeProfitPct)
    : entryPrice * (1 - params.takeProfitPct);
  const slPrice = signal === 'CALL'
    ? entryPrice * (1 - params.stopLossPct)
    : entryPrice * (1 + params.stopLossPct);

  let exitPrice = entryPrice;
  let exitTime = candle.timestamp;
  let exitReason: 'TP' | 'SL' | 'BB_MIDDLE' = 'BB_MIDDLE';

  for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
    const fc = candles[j];
    const futureSMA = calculateSMA(closes.slice(0, j + 1), params.bbPeriod);

    // Check TP first
    if (signal === 'CALL' && fc.high >= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'TP';
      exitTime = fc.timestamp;
      break;
    }
    if (signal === 'PUT' && fc.low <= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'TP';
      exitTime = fc.timestamp;
      break;
    }

    // Check SL
    if (signal === 'CALL' && fc.low <= slPrice) {
      exitPrice = slPrice;
      exitReason = 'SL';
      exitTime = fc.timestamp;
      break;
    }
    if (signal === 'PUT' && fc.high >= slPrice) {
      exitPrice = slPrice;
      exitReason = 'SL';
      exitTime = fc.timestamp;
      break;
    }

    // Check BB Middle
    if (signal === 'CALL' && fc.close <= futureSMA) {
      exitPrice = fc.close;
      exitReason = 'BB_MIDDLE';
      exitTime = fc.timestamp;
      break;
    }
    if (signal === 'PUT' && fc.close >= futureSMA) {
      exitPrice = fc.close;
      exitReason = 'BB_MIDDLE';
      exitTime = fc.timestamp;
      break;
    }

    exitPrice = fc.close;
    exitTime = fc.timestamp;
  }

  // Calculate profit WITH multiplier
  const priceChangePct = signal === 'CALL'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const profit = priceChangePct * STAKE * MULTIPLIER;

  trades.push({
    entryTime: candle.timestamp,
    exitTime,
    direction: signal,
    entryPrice,
    exitPrice,
    profit,
    result: profit > 0 ? 'WIN' : 'LOSS',
    exitReason,
  });

  lastTradeBar = i;
}

// Analyze
const tpExits = trades.filter(t => t.exitReason === 'TP');
const slExits = trades.filter(t => t.exitReason === 'SL');
const bbExits = trades.filter(t => t.exitReason === 'BB_MIDDLE');
const wins = trades.filter(t => t.result === 'WIN');
const losses = trades.filter(t => t.result === 'LOSS');

console.log('\n=== EXIT REASON DISTRIBUTION ===');
console.log(`Total trades: ${trades.length}`);
console.log(`TP exits: ${tpExits.length} (${(tpExits.length/trades.length*100).toFixed(1)}%)`);
console.log(`SL exits: ${slExits.length} (${(slExits.length/trades.length*100).toFixed(1)}%)`);
console.log(`BB_Middle exits: ${bbExits.length} (${(bbExits.length/trades.length*100).toFixed(1)}%)`);

console.log('\n=== WIN RATE ===');
console.log(`Overall: ${wins.length}/${trades.length} = ${(wins.length/trades.length*100).toFixed(1)}%`);
console.log(`TP exits: ${tpExits.filter(t => t.result === 'WIN').length}/${tpExits.length} wins (should be 100%)`);
console.log(`SL exits: ${slExits.filter(t => t.result === 'WIN').length}/${slExits.length} wins (should be 0%)`);
console.log(`BB exits: ${bbExits.filter(t => t.result === 'WIN').length}/${bbExits.length} wins`);

console.log('\n=== PROFIT BY EXIT TYPE (with x100 multiplier) ===');
const tpProfit = tpExits.reduce((s,t) => s + t.profit, 0);
const slProfit = slExits.reduce((s,t) => s + t.profit, 0);
const bbProfit = bbExits.reduce((s,t) => s + t.profit, 0);

console.log(`TP total: $${tpProfit.toFixed(2)} | Avg: $${(tpProfit/tpExits.length).toFixed(2)}/trade`);
console.log(`SL total: $${slProfit.toFixed(2)} | Avg: $${(slProfit/slExits.length).toFixed(2)}/trade`);
console.log(`BB total: $${bbProfit.toFixed(2)} | Avg: $${(bbProfit/bbExits.length).toFixed(2)}/trade`);

const totalProfit = tpProfit + slProfit + bbProfit;
console.log('\n=== TOTAL NET PROFIT ===');
console.log(`$${totalProfit.toFixed(2)}`);

console.log('\n=== EXPECTED VALUES ===');
console.log(`TP win ($200 * 0.4% * 100x): $${(STAKE * 0.004 * MULTIPLIER).toFixed(2)}`);
console.log(`SL loss ($200 * 0.2% * 100x): -$${(STAKE * 0.002 * MULTIPLIER).toFixed(2)}`);

console.log('\n=== SAMPLE TRADES ===');
trades.slice(0, 10).forEach((t, i) => {
  const pctMove = ((t.exitPrice - t.entryPrice) / t.entryPrice * 100).toFixed(3);
  console.log(
    `${(i+1).toString().padStart(2)}. ${t.direction.padEnd(4)} @ ${t.entryPrice.toFixed(2)} -> ` +
    `${t.exitPrice.toFixed(2)} (${pctMove}%) | ${t.exitReason.padEnd(9)} | ` +
    `${t.result.padEnd(4)} | $${t.profit.toFixed(2)}`
  );
});

// Direction analysis
const calls = trades.filter(t => t.direction === 'CALL');
const puts = trades.filter(t => t.direction === 'PUT');
console.log('\n=== DIRECTION ANALYSIS ===');
console.log(`CALL trades: ${calls.length} | Win rate: ${(calls.filter(t=>t.result==='WIN').length/calls.length*100).toFixed(1)}%`);
console.log(`PUT trades: ${puts.length} | Win rate: ${(puts.filter(t=>t.result==='WIN').length/puts.length*100).toFixed(1)}%`);
