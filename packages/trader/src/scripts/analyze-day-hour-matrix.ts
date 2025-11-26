/**
 * Day x Hour Matrix Analysis
 *
 * Analyzes performance by specific Day + Hour combinations
 * to find the exact windows to avoid or prioritize.
 *
 * Run: ASSET="R_100" DAYS="90" npx tsx src/scripts/analyze-day-hour-matrix.ts
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
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  profit: number;
  result: 'WIN' | 'LOSS';
  hourOfDay: number;
  dayOfWeek: number;
  rsiAtEntry: number;
}

function loadCandles(asset: string, timeframe: string = '1m', days: string = '90'): Candle[] | null {
  const tfLabel = timeframe === '1m' ? '1m' : timeframe;
  let csvPath = join(process.cwd(), 'backtest-data', `${asset}_${tfLabel}_${days}d.csv`);

  if (!existsSync(csvPath)) {
    csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`);
  }
  if (!existsSync(csvPath)) {
    csvPath = join(process.cwd(), 'backtest-data', `${asset}_1m_30d.csv`);
  }
  if (!existsSync(csvPath)) {
    csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_30d.csv`);
  }
  if (!existsSync(csvPath)) return null;

  console.log(`Loading: ${csvPath}`);
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

function calculateEMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';
const STAKE = 200;
const MULTIPLIER = 100;

console.log('='.repeat(80));
console.log(`DAY x HOUR MATRIX ANALYSIS - ${ASSET}`);
console.log('='.repeat(80));

const candles = loadCandles(ASSET, '1m', DAYS);
if (!candles) {
  console.log('No data found');
  process.exit(1);
}

const candles15m = loadCandles(ASSET, '15m', DAYS);
console.log(`Loaded ${candles.length} 1m candles`);

const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

// Run backtest
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

  // Get 15m trend if available
  let trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (candles15m && candles15m.length > 20) {
    const entryTimestamp = candle.timestamp;
    const matching15m = candles15m.filter(c => c.timestamp <= entryTimestamp);
    if (matching15m.length >= 20) {
      const closes15m = matching15m.map(c => c.close);
      const ema8 = calculateEMA(closes15m, 8);
      const ema21 = calculateEMA(closes15m, 21);
      if (!isNaN(ema8) && !isNaN(ema21)) {
        const trendDiff = (ema8 - ema21) / ema21;
        if (trendDiff > 0.001) trend15m = 'BULLISH';
        else if (trendDiff < -0.001) trend15m = 'BEARISH';
      }
    }
  }

  // Apply MTF filter
  if (price > bbUpper && rsi > params.rsiOverbought) {
    if (trend15m !== 'BEARISH') signal = 'CALL';
  } else if (price < bbLower && rsi < params.rsiOversold) {
    if (trend15m !== 'BULLISH') signal = 'PUT';
  }

  if (!signal) continue;

  const entryPrice = price;
  const tpPrice = signal === 'CALL'
    ? entryPrice * (1 + params.takeProfitPct)
    : entryPrice * (1 - params.takeProfitPct);
  const slPrice = signal === 'CALL'
    ? entryPrice * (1 - params.stopLossPct)
    : entryPrice * (1 + params.stopLossPct);

  let exitPrice = entryPrice;

  for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
    const fc = candles[j];
    const futureSMA = calculateSMA(closes.slice(0, j + 1), params.bbPeriod);

    if (signal === 'CALL' && fc.high >= tpPrice) { exitPrice = tpPrice; break; }
    if (signal === 'PUT' && fc.low <= tpPrice) { exitPrice = tpPrice; break; }
    if (signal === 'CALL' && fc.low <= slPrice) { exitPrice = slPrice; break; }
    if (signal === 'PUT' && fc.high >= slPrice) { exitPrice = slPrice; break; }
    if (signal === 'CALL' && fc.close <= futureSMA) { exitPrice = fc.close; break; }
    if (signal === 'PUT' && fc.close >= futureSMA) { exitPrice = fc.close; break; }
    exitPrice = fc.close;
  }

  const priceChangePct = signal === 'CALL'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const profit = priceChangePct * STAKE * MULTIPLIER;

  const entryDate = new Date(candle.timestamp * 1000);

  trades.push({
    entryTime: candle.timestamp,
    direction: signal,
    entryPrice,
    exitPrice,
    profit,
    result: profit > 0 ? 'WIN' : 'LOSS',
    hourOfDay: entryDate.getUTCHours(),
    dayOfWeek: entryDate.getUTCDay(),
    rsiAtEntry: rsi,
  });

  lastTradeBar = i;
}

console.log(`\nTotal trades: ${trades.length}`);

// === DAY x HOUR MATRIX ===
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Initialize matrix
type CellStats = { wins: number; losses: number; profit: number };
const matrix: Map<string, CellStats> = new Map();

for (let d = 0; d < 7; d++) {
  for (let h = 0; h < 24; h++) {
    matrix.set(`${d}-${h}`, { wins: 0, losses: 0, profit: 0 });
  }
}

// Fill matrix
trades.forEach(t => {
  const key = `${t.dayOfWeek}-${t.hourOfDay}`;
  const cell = matrix.get(key)!;
  if (t.result === 'WIN') cell.wins++;
  else cell.losses++;
  cell.profit += t.profit;
});

// === PRINT HEATMAP ===
console.log('\n' + '='.repeat(80));
console.log('DAY x HOUR PROFIT HEATMAP (USD)');
console.log('='.repeat(80));
console.log('\n       ' + Array.from({ length: 24 }, (_, h) => h.toString().padStart(5)).join(' '));
console.log('       ' + '-'.repeat(24 * 6));

for (let d = 0; d < 7; d++) {
  const row = [dayNames[d].padEnd(4)];
  for (let h = 0; h < 24; h++) {
    const cell = matrix.get(`${d}-${h}`)!;
    const total = cell.wins + cell.losses;
    if (total === 0) {
      row.push('    -');
    } else {
      const profitStr = cell.profit >= 0 ? `+${Math.round(cell.profit)}` : `${Math.round(cell.profit)}`;
      row.push(profitStr.padStart(5));
    }
  }
  console.log(row.join(' '));
}

// === WIN RATE HEATMAP ===
console.log('\n' + '='.repeat(80));
console.log('DAY x HOUR WIN RATE HEATMAP (%)');
console.log('='.repeat(80));
console.log('\n       ' + Array.from({ length: 24 }, (_, h) => h.toString().padStart(5)).join(' '));
console.log('       ' + '-'.repeat(24 * 6));

for (let d = 0; d < 7; d++) {
  const row = [dayNames[d].padEnd(4)];
  for (let h = 0; h < 24; h++) {
    const cell = matrix.get(`${d}-${h}`)!;
    const total = cell.wins + cell.losses;
    if (total === 0) {
      row.push('    -');
    } else {
      const wr = Math.round(cell.wins / total * 100);
      row.push(`${wr}%`.padStart(5));
    }
  }
  console.log(row.join(' '));
}

// === BEST AND WORST WINDOWS ===
console.log('\n' + '='.repeat(80));
console.log('TOP 10 BEST DAY-HOUR COMBINATIONS');
console.log('='.repeat(80));

const sortedCells = Array.from(matrix.entries())
  .map(([key, stats]) => {
    const [d, h] = key.split('-').map(Number);
    const total = stats.wins + stats.losses;
    return { day: d, hour: h, ...stats, total, wr: total > 0 ? stats.wins / total * 100 : 0 };
  })
  .filter(c => c.total >= 3) // At least 3 trades
  .sort((a, b) => b.profit - a.profit);

console.log('\nDay       Hour   Trades   Wins   Win Rate   Profit');
console.log('-'.repeat(55));
sortedCells.slice(0, 10).forEach(c => {
  console.log(
    `${dayNames[c.day].padEnd(10)}${c.hour.toString().padStart(2)}:00  ` +
    `${c.total.toString().padStart(6)}   ${c.wins.toString().padStart(4)}   ` +
    `${c.wr.toFixed(1).padStart(6)}%   $${c.profit.toFixed(0).padStart(6)}`
  );
});

console.log('\n' + '='.repeat(80));
console.log('TOP 10 WORST DAY-HOUR COMBINATIONS');
console.log('='.repeat(80));

console.log('\nDay       Hour   Trades   Wins   Win Rate   Profit');
console.log('-'.repeat(55));
sortedCells.slice(-10).reverse().forEach(c => {
  console.log(
    `${dayNames[c.day].padEnd(10)}${c.hour.toString().padStart(2)}:00  ` +
    `${c.total.toString().padStart(6)}   ${c.wins.toString().padStart(4)}   ` +
    `${c.wr.toFixed(1).padStart(6)}%   $${c.profit.toFixed(0).padStart(6)}`
  );
});

// === SUMMARY BY TIME BLOCKS ===
console.log('\n' + '='.repeat(80));
console.log('SUMMARY BY TIME BLOCKS (4-hour windows)');
console.log('='.repeat(80));

const timeBlocks = [
  { name: '00:00-03:59 (Asia)', hours: [0, 1, 2, 3] },
  { name: '04:00-07:59 (Asia/Europe)', hours: [4, 5, 6, 7] },
  { name: '08:00-11:59 (Europe)', hours: [8, 9, 10, 11] },
  { name: '12:00-15:59 (Europe/US)', hours: [12, 13, 14, 15] },
  { name: '16:00-19:59 (US)', hours: [16, 17, 18, 19] },
  { name: '20:00-23:59 (US/Asia)', hours: [20, 21, 22, 23] },
];

console.log('\nTime Block            | Trades | Wins | Win Rate | Net Profit');
console.log('-'.repeat(65));

timeBlocks.forEach(block => {
  let wins = 0, losses = 0, profit = 0;
  for (let d = 0; d < 7; d++) {
    block.hours.forEach(h => {
      const cell = matrix.get(`${d}-${h}`)!;
      wins += cell.wins;
      losses += cell.losses;
      profit += cell.profit;
    });
  }
  const total = wins + losses;
  const wr = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
  console.log(
    `${block.name.padEnd(22)}| ${total.toString().padStart(6)} | ${wins.toString().padStart(4)} | ` +
    `${wr.padStart(7)}% | $${profit.toFixed(0).padStart(9)}`
  );
});

// === ACTIONABLE RECOMMENDATIONS ===
console.log('\n' + '='.repeat(80));
console.log('ACTIONABLE RECOMMENDATIONS');
console.log('='.repeat(80));

// Find consistently bad combinations
const badCombos = sortedCells
  .filter(c => c.profit < -100 && c.total >= 5)
  .slice(-15);

console.log('\n🔴 AVOID THESE SPECIFIC WINDOWS (loss > $100, 5+ trades):');
badCombos.forEach(c => {
  console.log(`   - ${dayNames[c.day]} ${c.hour}:00-${c.hour}:59 (${c.wr.toFixed(0)}% WR, $${c.profit.toFixed(0)})`);
});

// Find consistently good combinations
const goodCombos = sortedCells
  .filter(c => c.profit > 100 && c.total >= 5)
  .slice(0, 15);

console.log('\n🟢 PRIORITIZE THESE WINDOWS (profit > $100, 5+ trades):');
goodCombos.forEach(c => {
  console.log(`   - ${dayNames[c.day]} ${c.hour}:00-${c.hour}:59 (${c.wr.toFixed(0)}% WR, +$${c.profit.toFixed(0)})`);
});

// Calculate potential improvement
const badTotal = badCombos.reduce((s, c) => s + c.profit, 0);
const currentTotal = trades.reduce((s, t) => s + t.profit, 0);
console.log(`\n📊 If we avoid bad windows:`);
console.log(`   Current profit: $${currentTotal.toFixed(0)}`);
console.log(`   Bad windows loss: $${badTotal.toFixed(0)}`);
console.log(`   Potential profit: $${(currentTotal - badTotal).toFixed(0)} (+${((- badTotal / currentTotal) * 100).toFixed(0)}%)`);

console.log('\n');
