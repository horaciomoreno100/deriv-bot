/**
 * Backtest with Progressive Filters
 *
 * Tests each filter independently to measure impact:
 * 1. Baseline (no filters)
 * 2. Time window filter (avoid bad day-hour combinations)
 * 3. RSI zone filter (avoid RSI 30-40)
 * 4. All filters combined
 *
 * Run: ASSET="R_100" DAYS="90" npx tsx src/scripts/backtest-with-filters.ts
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
  profit: number;
  result: 'WIN' | 'LOSS';
  hourOfDay: number;
  dayOfWeek: number;
  rsiAtEntry: number;
}

interface BacktestResult {
  name: string;
  trades: number;
  wins: number;
  winRate: number;
  profit: number;
  avgProfit: number;
  filteredOut: number;
}

function loadCandles(asset: string, timeframe: string = '1m', days: string = '90'): Candle[] | null {
  const tfLabel = timeframe === '1m' ? '1m' : timeframe;
  let csvPath = join(process.cwd(), 'backtest-data', `${asset}_${tfLabel}_${days}d.csv`);

  if (!existsSync(csvPath)) csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`);
  if (!existsSync(csvPath)) csvPath = join(process.cwd(), 'backtest-data', `${asset}_1m_30d.csv`);
  if (!existsSync(csvPath)) csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_30d.csv`);
  if (!existsSync(csvPath)) return null;

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

// === BAD TIME WINDOWS (from analysis) ===
// Format: "day-hour" where day is 0=Sun, 1=Mon, etc.
const BAD_TIME_WINDOWS = new Set([
  '0-4',   // Sun 4:00 - 7% WR, -$440
  '0-5',   // Sun 5:00 - 13% WR, -$345
  '0-15',  // Sun 15:00 - 13% WR, -$398
  '0-16',  // Sun 16:00 - 8% WR, -$360
  '1-1',   // Mon 1:00 - 20% WR, -$320
  '2-1',   // Tue 1:00 - 8% WR, -$400
  '2-5',   // Tue 5:00 - 0% WR, -$341
  '2-10',  // Tue 10:00 - 7% WR, -$440
  '3-21',  // Wed 21:00 - 0% WR, -$480
  '4-14',  // Thu 14:00 - 8% WR, -$311
  '5-6',   // Fri 6:00 - 8% WR, -$400
  '5-15',  // Fri 15:00 - 19% WR, -$318
  '6-3',   // Sat 3:00 - 0% WR, -$351
  '6-9',   // Sat 9:00 - 11% WR, -$480
  '6-11',  // Sat 11:00 - 18% WR, -$320
]);

// === FILTERS ===
function isGoodTimeWindow(dayOfWeek: number, hourOfDay: number): boolean {
  const key = `${dayOfWeek}-${hourOfDay}`;
  return !BAD_TIME_WINDOWS.has(key);
}

function isGoodRSIZone(rsi: number): boolean {
  // Avoid RSI 30-40 zone (25% WR, -$1,493)
  return rsi < 30 || rsi > 40;
}

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';
const STAKE = 200;
const MULTIPLIER = 100;

console.log('='.repeat(80));
console.log(`PROGRESSIVE FILTER BACKTEST - ${ASSET}`);
console.log('='.repeat(80));

const candles = loadCandles(ASSET, '1m', DAYS);
if (!candles) {
  console.log('No data found');
  process.exit(1);
}

const candles15m = loadCandles(ASSET, '15m', DAYS);
console.log(`Loaded ${candles.length} 1m candles`);
if (candles15m) console.log(`Loaded ${candles15m.length} 15m candles`);

const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

// Generate all potential trades first
interface PotentialTrade {
  entryBar: number;
  candle: Candle;
  signal: 'CALL' | 'PUT';
  rsi: number;
  hourOfDay: number;
  dayOfWeek: number;
  trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

const potentialTrades: PotentialTrade[] = [];
const closes = candles.map(c => c.close);
let inSqueeze = false;
let squeezeEndBar = -1;
let lastTradeBar = -Infinity;
const minBars = 30;

console.log('\nScanning for potential trades...');

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

  // Get 15m trend
  let trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (candles15m && candles15m.length > 20) {
    const matching15m = candles15m.filter(c => c.timestamp <= candle.timestamp);
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

  // Check for signal (with MTF filter)
  let signal: 'CALL' | 'PUT' | null = null;
  if (price > bbUpper && rsi > params.rsiOverbought) {
    if (trend15m !== 'BEARISH') signal = 'CALL';
  } else if (price < bbLower && rsi < params.rsiOversold) {
    if (trend15m !== 'BULLISH') signal = 'PUT';
  }

  if (!signal) continue;

  const entryDate = new Date(candle.timestamp * 1000);

  potentialTrades.push({
    entryBar: i,
    candle,
    signal,
    rsi,
    hourOfDay: entryDate.getUTCHours(),
    dayOfWeek: entryDate.getUTCDay(),
    trend15m,
  });

  lastTradeBar = i;
}

console.log(`Found ${potentialTrades.length} potential trades\n`);

// Function to execute trades with filters
function executeTrades(
  trades: PotentialTrade[],
  filterName: string,
  filterFn: (t: PotentialTrade) => boolean
): BacktestResult {
  const filtered = trades.filter(filterFn);
  const filteredOut = trades.length - filtered.length;

  let wins = 0;
  let totalProfit = 0;

  filtered.forEach(t => {
    const i = t.entryBar;
    const entryPrice = t.candle.close;
    const tpPrice = t.signal === 'CALL'
      ? entryPrice * (1 + params.takeProfitPct)
      : entryPrice * (1 - params.takeProfitPct);
    const slPrice = t.signal === 'CALL'
      ? entryPrice * (1 - params.stopLossPct)
      : entryPrice * (1 + params.stopLossPct);

    let exitPrice = entryPrice;

    for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
      const fc = candles[j];
      const futureSMA = calculateSMA(closes.slice(0, j + 1), params.bbPeriod);

      if (t.signal === 'CALL' && fc.high >= tpPrice) { exitPrice = tpPrice; break; }
      if (t.signal === 'PUT' && fc.low <= tpPrice) { exitPrice = tpPrice; break; }
      if (t.signal === 'CALL' && fc.low <= slPrice) { exitPrice = slPrice; break; }
      if (t.signal === 'PUT' && fc.high >= slPrice) { exitPrice = slPrice; break; }
      if (t.signal === 'CALL' && fc.close <= futureSMA) { exitPrice = fc.close; break; }
      if (t.signal === 'PUT' && fc.close >= futureSMA) { exitPrice = fc.close; break; }
      exitPrice = fc.close;
    }

    const priceChangePct = t.signal === 'CALL'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    const profit = priceChangePct * STAKE * MULTIPLIER;

    if (profit > 0) wins++;
    totalProfit += profit;
  });

  return {
    name: filterName,
    trades: filtered.length,
    wins,
    winRate: filtered.length > 0 ? (wins / filtered.length) * 100 : 0,
    profit: totalProfit,
    avgProfit: filtered.length > 0 ? totalProfit / filtered.length : 0,
    filteredOut,
  };
}

// Run backtests with different filters
const results: BacktestResult[] = [];

// 1. Baseline (no additional filters - only MTF)
console.log('Running backtest scenarios...\n');
results.push(executeTrades(
  potentialTrades,
  '1. Baseline (MTF only)',
  () => true
));

// 2. Time window filter only
results.push(executeTrades(
  potentialTrades,
  '2. + Time Window Filter',
  (t) => isGoodTimeWindow(t.dayOfWeek, t.hourOfDay)
));

// 3. RSI zone filter only
results.push(executeTrades(
  potentialTrades,
  '3. + RSI Zone Filter',
  (t) => isGoodRSIZone(t.rsi)
));

// 4. Both filters combined
results.push(executeTrades(
  potentialTrades,
  '4. ALL FILTERS COMBINED',
  (t) => isGoodTimeWindow(t.dayOfWeek, t.hourOfDay) && isGoodRSIZone(t.rsi)
));

// Print results
console.log('='.repeat(80));
console.log('BACKTEST RESULTS COMPARISON');
console.log('='.repeat(80));
console.log('\nScenario                    | Trades | Filtered | Win Rate |   Profit  | Avg/Trade');
console.log('-'.repeat(85));

results.forEach(r => {
  const profitStr = r.profit >= 0 ? `+$${r.profit.toFixed(0)}` : `-$${Math.abs(r.profit).toFixed(0)}`;
  const avgStr = r.avgProfit >= 0 ? `+$${r.avgProfit.toFixed(2)}` : `-$${Math.abs(r.avgProfit).toFixed(2)}`;
  console.log(
    `${r.name.padEnd(28)}| ${r.trades.toString().padStart(6)} | ` +
    `${r.filteredOut.toString().padStart(8)} | ${r.winRate.toFixed(1).padStart(7)}% | ` +
    `${profitStr.padStart(9)} | ${avgStr.padStart(9)}`
  );
});

// Improvement summary
const baseline = results[0];
const combined = results[results.length - 1];

console.log('\n' + '='.repeat(80));
console.log('IMPROVEMENT SUMMARY');
console.log('='.repeat(80));

const profitImprovement = combined.profit - baseline.profit;
const profitPct = ((combined.profit / baseline.profit) - 1) * 100;
const wrImprovement = combined.winRate - baseline.winRate;

console.log(`\nBaseline profit: $${baseline.profit.toFixed(2)}`);
console.log(`Combined profit: $${combined.profit.toFixed(2)}`);
console.log(`\nProfit improvement: $${profitImprovement.toFixed(2)} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%)`);
console.log(`Win rate improvement: ${baseline.winRate.toFixed(1)}% -> ${combined.winRate.toFixed(1)}% (${wrImprovement >= 0 ? '+' : ''}${wrImprovement.toFixed(1)}pp)`);
console.log(`Trades filtered out: ${combined.filteredOut} (${((combined.filteredOut / baseline.trades) * 100).toFixed(1)}%)`);

// Monthly projection
const daysInBacktest = parseInt(DAYS);
const monthlyProfit = (combined.profit / daysInBacktest) * 30;
const monthlyTrades = (combined.trades / daysInBacktest) * 30;

console.log(`\n📊 Monthly projection (30 days):`);
console.log(`   Estimated trades: ${Math.round(monthlyTrades)}`);
console.log(`   Estimated profit: $${monthlyProfit.toFixed(2)}`);

// Filter details
console.log('\n' + '='.repeat(80));
console.log('FILTER DETAILS');
console.log('='.repeat(80));

console.log('\n🔴 Bad Time Windows being filtered:');
BAD_TIME_WINDOWS.forEach(window => {
  const [d, h] = window.split('-').map(Number);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  console.log(`   - ${dayNames[d]} ${h}:00`);
});

console.log('\n🔴 RSI Zone being filtered:');
console.log('   - RSI 30-40 (poor performing zone)');

console.log('\n');
