/**
 * Loss Pattern Analysis Script
 *
 * Analyzes WHEN and WHY trades lose:
 * - Losing streak patterns
 * - Time-of-day analysis
 * - Market condition analysis (trend vs range)
 * - Entry signal quality analysis
 * - Comparison of winning vs losing trades
 *
 * Run: ASSET="R_100" DAYS="90" npx tsx src/scripts/analyze-loss-patterns.ts
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Trade {
  entryBar: number;
  entryTime: number;
  exitTime: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  profit: number;
  result: 'WIN' | 'LOSS';
  exitReason: 'TP' | 'SL' | 'BB_MIDDLE';
  // Analysis fields
  rsiAtEntry: number;
  bbWidthAtEntry: number;
  trendStrength: number;
  barsInSqueeze: number;
  volatility: number;
  hourOfDay: number;
  dayOfWeek: number;
  trend15m?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

interface LossStreak {
  startIndex: number;
  length: number;
  totalLoss: number;
  trades: Trade[];
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

// === MAIN ANALYSIS ===
const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';
const STAKE = 200;
const MULTIPLIER = 100;

console.log('='.repeat(80));
console.log(`LOSS PATTERN ANALYSIS - ${ASSET}`);
console.log('='.repeat(80));

// Load 1m data
const candles = loadCandles(ASSET, '1m', DAYS);
if (!candles) {
  console.log('No 1m data found');
  process.exit(1);
}

// Load 15m data for trend context
const candles15m = loadCandles(ASSET, '15m', DAYS);
console.log(`Loaded ${candles.length} 1m candles`);
if (candles15m) {
  console.log(`Loaded ${candles15m.length} 15m candles`);
}

const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

// Run backtest with detailed tracking
const trades: Trade[] = [];
const closes = candles.map(c => c.close);
let inSqueeze = false;
let squeezeStartBar = -1;
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
  const bbWidth = (bbUpper - bbLower) / sma;

  const ema = calculateSMA(closeSlice, params.kcPeriod);
  const atr = calculateATR(candleSlice, params.kcPeriod);
  const kcUpper = ema + (atr * params.kcMultiplier);
  const kcLower = ema - (atr * params.kcMultiplier);

  const rsi = calculateRSI(closeSlice, params.rsiPeriod);

  if (isNaN(bbUpper) || isNaN(kcUpper) || isNaN(rsi)) continue;

  const currentSqueeze = bbUpper < kcUpper && bbLower > kcLower;

  if (currentSqueeze && !inSqueeze) {
    inSqueeze = true;
    squeezeStartBar = i;
  } else if (!currentSqueeze && inSqueeze) {
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
  let exitTime = candle.timestamp;
  let exitReason: 'TP' | 'SL' | 'BB_MIDDLE' = 'BB_MIDDLE';

  for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
    const fc = candles[j];
    const futureSMA = calculateSMA(closes.slice(0, j + 1), params.bbPeriod);

    if (signal === 'CALL' && fc.high >= tpPrice) {
      exitPrice = tpPrice; exitReason = 'TP'; exitTime = fc.timestamp; break;
    }
    if (signal === 'PUT' && fc.low <= tpPrice) {
      exitPrice = tpPrice; exitReason = 'TP'; exitTime = fc.timestamp; break;
    }
    if (signal === 'CALL' && fc.low <= slPrice) {
      exitPrice = slPrice; exitReason = 'SL'; exitTime = fc.timestamp; break;
    }
    if (signal === 'PUT' && fc.high >= slPrice) {
      exitPrice = slPrice; exitReason = 'SL'; exitTime = fc.timestamp; break;
    }
    if (signal === 'CALL' && fc.close <= futureSMA) {
      exitPrice = fc.close; exitReason = 'BB_MIDDLE'; exitTime = fc.timestamp; break;
    }
    if (signal === 'PUT' && fc.close >= futureSMA) {
      exitPrice = fc.close; exitReason = 'BB_MIDDLE'; exitTime = fc.timestamp; break;
    }
    exitPrice = fc.close;
    exitTime = fc.timestamp;
  }

  const priceChangePct = signal === 'CALL'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const profit = priceChangePct * STAKE * MULTIPLIER;

  // Calculate trend strength (how far EMA8 is from EMA21)
  const ema8 = calculateEMA(closeSlice, 8);
  const ema21 = calculateEMA(closeSlice, 21);
  const trendStrength = Math.abs((ema8 - ema21) / ema21) * 100;

  // Calculate bars in squeeze before signal
  const barsInSqueeze = squeezeEndBar - squeezeStartBar;

  // Time analysis
  const entryDate = new Date(candle.timestamp * 1000);
  const hourOfDay = entryDate.getUTCHours();
  const dayOfWeek = entryDate.getUTCDay();

  trades.push({
    entryBar: i,
    entryTime: candle.timestamp,
    exitTime,
    direction: signal,
    entryPrice,
    exitPrice,
    profit,
    result: profit > 0 ? 'WIN' : 'LOSS',
    exitReason,
    rsiAtEntry: rsi,
    bbWidthAtEntry: bbWidth * 100,
    trendStrength,
    barsInSqueeze,
    volatility: atr / price * 100,
    hourOfDay,
    dayOfWeek,
    trend15m,
  });

  lastTradeBar = i;
}

console.log(`\nTotal trades: ${trades.length}`);

// === ANALYSIS 1: LOSING STREAKS ===
console.log('\n' + '='.repeat(80));
console.log('1. LOSING STREAK ANALYSIS');
console.log('='.repeat(80));

const streaks: LossStreak[] = [];
let currentStreak: Trade[] = [];
let streakStart = 0;

for (let i = 0; i < trades.length; i++) {
  if (trades[i].result === 'LOSS') {
    if (currentStreak.length === 0) streakStart = i;
    currentStreak.push(trades[i]);
  } else {
    if (currentStreak.length >= 2) {
      streaks.push({
        startIndex: streakStart,
        length: currentStreak.length,
        totalLoss: currentStreak.reduce((s, t) => s + t.profit, 0),
        trades: [...currentStreak],
      });
    }
    currentStreak = [];
  }
}
if (currentStreak.length >= 2) {
  streaks.push({
    startIndex: streakStart,
    length: currentStreak.length,
    totalLoss: currentStreak.reduce((s, t) => s + t.profit, 0),
    trades: [...currentStreak],
  });
}

streaks.sort((a, b) => b.length - a.length);

console.log(`\nTotal losing streaks (2+ consecutive): ${streaks.length}`);
console.log(`\nTop 10 longest losing streaks:`);
streaks.slice(0, 10).forEach((streak, idx) => {
  const firstTrade = streak.trades[0];
  const lastTrade = streak.trades[streak.trades.length - 1];
  console.log(
    `  ${idx + 1}. ${streak.length} losses | $${streak.totalLoss.toFixed(0)} lost | ` +
    `${new Date(firstTrade.entryTime * 1000).toISOString().slice(0, 16)} - ` +
    `${new Date(lastTrade.entryTime * 1000).toISOString().slice(0, 16)}`
  );
});

// Streak length distribution
const streakDist = new Map<number, number>();
streaks.forEach(s => {
  streakDist.set(s.length, (streakDist.get(s.length) || 0) + 1);
});
console.log(`\nStreak length distribution:`);
Array.from(streakDist.entries()).sort((a, b) => a[0] - b[0]).forEach(([len, count]) => {
  console.log(`  ${len} losses: ${count} times`);
});

// === ANALYSIS 2: TIME OF DAY ===
console.log('\n' + '='.repeat(80));
console.log('2. TIME OF DAY ANALYSIS (UTC)');
console.log('='.repeat(80));

const hourlyStats = new Map<number, { wins: number; losses: number; profit: number }>();
for (let h = 0; h < 24; h++) {
  hourlyStats.set(h, { wins: 0, losses: 0, profit: 0 });
}

trades.forEach(t => {
  const stats = hourlyStats.get(t.hourOfDay)!;
  if (t.result === 'WIN') stats.wins++;
  else stats.losses++;
  stats.profit += t.profit;
});

console.log('\nHour | Trades | Wins | Losses | WinRate | Net Profit');
console.log('-'.repeat(60));

const sortedHours = Array.from(hourlyStats.entries())
  .map(([hour, s]) => ({ hour, total: s.wins + s.losses, ...s }))
  .filter(h => h.total > 0)
  .sort((a, b) => b.profit - a.profit);

sortedHours.forEach(h => {
  const wr = h.total > 0 ? (h.wins / h.total * 100).toFixed(1) : '0.0';
  console.log(
    `${h.hour.toString().padStart(2, '0')}:00 | ${h.total.toString().padStart(6)} | ` +
    `${h.wins.toString().padStart(4)} | ${h.losses.toString().padStart(6)} | ` +
    `${wr.padStart(6)}% | $${h.profit.toFixed(0).padStart(7)}`
  );
});

// Best and worst hours
const profitableHours = sortedHours.filter(h => h.profit > 0);
const losingHours = sortedHours.filter(h => h.profit < 0);
console.log(`\nProfitable hours: ${profitableHours.map(h => h.hour + ':00').join(', ')}`);
console.log(`Losing hours: ${losingHours.map(h => h.hour + ':00').join(', ')}`);

// === ANALYSIS 3: DAY OF WEEK ===
console.log('\n' + '='.repeat(80));
console.log('3. DAY OF WEEK ANALYSIS');
console.log('='.repeat(80));

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dailyStats = new Map<number, { wins: number; losses: number; profit: number }>();
for (let d = 0; d < 7; d++) {
  dailyStats.set(d, { wins: 0, losses: 0, profit: 0 });
}

trades.forEach(t => {
  const stats = dailyStats.get(t.dayOfWeek)!;
  if (t.result === 'WIN') stats.wins++;
  else stats.losses++;
  stats.profit += t.profit;
});

console.log('\nDay       | Trades | Wins | Losses | WinRate | Net Profit');
console.log('-'.repeat(65));

dailyStats.forEach((s, day) => {
  const total = s.wins + s.losses;
  if (total === 0) return;
  const wr = (s.wins / total * 100).toFixed(1);
  console.log(
    `${dayNames[day].padEnd(10)}| ${total.toString().padStart(6)} | ` +
    `${s.wins.toString().padStart(4)} | ${s.losses.toString().padStart(6)} | ` +
    `${wr.padStart(6)}% | $${s.profit.toFixed(0).padStart(7)}`
  );
});

// === ANALYSIS 4: WINNING VS LOSING TRADE CHARACTERISTICS ===
console.log('\n' + '='.repeat(80));
console.log('4. WINNING VS LOSING TRADE CHARACTERISTICS');
console.log('='.repeat(80));

const wins = trades.filter(t => t.result === 'WIN');
const losses = trades.filter(t => t.result === 'LOSS');

function avgStat(arr: Trade[], getter: (t: Trade) => number): number {
  return arr.reduce((s, t) => s + getter(t), 0) / arr.length;
}

console.log('\n                     |   Winners   |   Losers    | Difference');
console.log('-'.repeat(65));

const stats = [
  { name: 'RSI at entry', getter: (t: Trade) => t.rsiAtEntry },
  { name: 'BB Width (%)', getter: (t: Trade) => t.bbWidthAtEntry },
  { name: 'Trend strength (%)', getter: (t: Trade) => t.trendStrength },
  { name: 'Bars in squeeze', getter: (t: Trade) => t.barsInSqueeze },
  { name: 'Volatility (%)', getter: (t: Trade) => t.volatility },
];

stats.forEach(({ name, getter }) => {
  const winAvg = avgStat(wins, getter);
  const lossAvg = avgStat(losses, getter);
  const diff = ((winAvg - lossAvg) / lossAvg * 100).toFixed(1);
  console.log(
    `${name.padEnd(20)} | ${winAvg.toFixed(2).padStart(11)} | ${lossAvg.toFixed(2).padStart(11)} | ${diff.padStart(10)}%`
  );
});

// === ANALYSIS 5: EXIT REASON BY OUTCOME ===
console.log('\n' + '='.repeat(80));
console.log('5. EXIT REASON ANALYSIS');
console.log('='.repeat(80));

const exitStats = {
  TP: { wins: 0, losses: 0, profit: 0 },
  SL: { wins: 0, losses: 0, profit: 0 },
  BB_MIDDLE: { wins: 0, losses: 0, profit: 0 },
};

trades.forEach(t => {
  const s = exitStats[t.exitReason];
  if (t.result === 'WIN') s.wins++;
  else s.losses++;
  s.profit += t.profit;
});

console.log('\nExit Reason | Wins   | Losses | Win Rate | Net Profit | Avg Profit');
console.log('-'.repeat(70));

Object.entries(exitStats).forEach(([reason, s]) => {
  const total = s.wins + s.losses;
  const wr = total > 0 ? (s.wins / total * 100).toFixed(1) : '0.0';
  const avg = total > 0 ? s.profit / total : 0;
  console.log(
    `${reason.padEnd(11)} | ${s.wins.toString().padStart(6)} | ${s.losses.toString().padStart(6)} | ` +
    `${wr.padStart(7)}% | $${s.profit.toFixed(0).padStart(9)} | $${avg.toFixed(2).padStart(9)}`
  );
});

// === ANALYSIS 6: TREND ALIGNMENT ===
console.log('\n' + '='.repeat(80));
console.log('6. 15-MINUTE TREND ALIGNMENT');
console.log('='.repeat(80));

const trendStats = {
  BULLISH: { wins: 0, losses: 0, profit: 0, calls: 0, puts: 0 },
  BEARISH: { wins: 0, losses: 0, profit: 0, calls: 0, puts: 0 },
  NEUTRAL: { wins: 0, losses: 0, profit: 0, calls: 0, puts: 0 },
};

trades.forEach(t => {
  const trend = t.trend15m || 'NEUTRAL';
  const s = trendStats[trend];
  if (t.result === 'WIN') s.wins++;
  else s.losses++;
  s.profit += t.profit;
  if (t.direction === 'CALL') s.calls++;
  else s.puts++;
});

console.log('\n15m Trend | Trades | Wins | Losses | Win Rate | Net Profit | CALLs | PUTs');
console.log('-'.repeat(80));

Object.entries(trendStats).forEach(([trend, s]) => {
  const total = s.wins + s.losses;
  if (total === 0) return;
  const wr = (s.wins / total * 100).toFixed(1);
  console.log(
    `${trend.padEnd(9)} | ${total.toString().padStart(6)} | ${s.wins.toString().padStart(4)} | ` +
    `${s.losses.toString().padStart(6)} | ${wr.padStart(7)}% | $${s.profit.toFixed(0).padStart(9)} | ` +
    `${s.calls.toString().padStart(5)} | ${s.puts.toString().padStart(4)}`
  );
});

// === ANALYSIS 7: DIRECTION PERFORMANCE ===
console.log('\n' + '='.repeat(80));
console.log('7. DIRECTION ANALYSIS (CALL vs PUT)');
console.log('='.repeat(80));

const calls = trades.filter(t => t.direction === 'CALL');
const puts = trades.filter(t => t.direction === 'PUT');

const callWins = calls.filter(t => t.result === 'WIN').length;
const putWins = puts.filter(t => t.result === 'WIN').length;
const callProfit = calls.reduce((s, t) => s + t.profit, 0);
const putProfit = puts.reduce((s, t) => s + t.profit, 0);

console.log(`\nCALL trades: ${calls.length}`);
console.log(`  Win rate: ${(callWins / calls.length * 100).toFixed(1)}%`);
console.log(`  Net profit: $${callProfit.toFixed(2)}`);
console.log(`  Avg profit: $${(callProfit / calls.length).toFixed(2)}/trade`);

console.log(`\nPUT trades: ${puts.length}`);
console.log(`  Win rate: ${(putWins / puts.length * 100).toFixed(1)}%`);
console.log(`  Net profit: $${putProfit.toFixed(2)}`);
console.log(`  Avg profit: $${(putProfit / puts.length).toFixed(2)}/trade`);

// === ANALYSIS 8: RSI ZONES ===
console.log('\n' + '='.repeat(80));
console.log('8. RSI ZONE ANALYSIS');
console.log('='.repeat(80));

const rsiZones = [
  { name: '< 30 (Oversold)', min: 0, max: 30 },
  { name: '30-40', min: 30, max: 40 },
  { name: '40-50', min: 40, max: 50 },
  { name: '50-60', min: 50, max: 60 },
  { name: '60-70', min: 60, max: 70 },
  { name: '> 70 (Overbought)', min: 70, max: 100 },
];

console.log('\nRSI Zone          | Trades | Wins | Losses | Win Rate | Net Profit');
console.log('-'.repeat(70));

rsiZones.forEach(zone => {
  const zoneTrades = trades.filter(t => t.rsiAtEntry >= zone.min && t.rsiAtEntry < zone.max);
  if (zoneTrades.length === 0) return;
  const zoneWins = zoneTrades.filter(t => t.result === 'WIN').length;
  const zoneProfit = zoneTrades.reduce((s, t) => s + t.profit, 0);
  const wr = (zoneWins / zoneTrades.length * 100).toFixed(1);
  console.log(
    `${zone.name.padEnd(18)}| ${zoneTrades.length.toString().padStart(6)} | ` +
    `${zoneWins.toString().padStart(4)} | ${(zoneTrades.length - zoneWins).toString().padStart(6)} | ` +
    `${wr.padStart(7)}% | $${zoneProfit.toFixed(0).padStart(9)}`
  );
});

// === ANALYSIS 9: VOLATILITY ZONES ===
console.log('\n' + '='.repeat(80));
console.log('9. VOLATILITY ZONE ANALYSIS (ATR/Price %)');
console.log('='.repeat(80));

const volZones = [
  { name: 'Very Low (< 0.05%)', min: 0, max: 0.05 },
  { name: 'Low (0.05-0.1%)', min: 0.05, max: 0.1 },
  { name: 'Medium (0.1-0.15%)', min: 0.1, max: 0.15 },
  { name: 'High (0.15-0.2%)', min: 0.15, max: 0.2 },
  { name: 'Very High (> 0.2%)', min: 0.2, max: 100 },
];

console.log('\nVolatility Zone    | Trades | Wins | Losses | Win Rate | Net Profit');
console.log('-'.repeat(70));

volZones.forEach(zone => {
  const zoneTrades = trades.filter(t => t.volatility >= zone.min && t.volatility < zone.max);
  if (zoneTrades.length === 0) return;
  const zoneWins = zoneTrades.filter(t => t.result === 'WIN').length;
  const zoneProfit = zoneTrades.reduce((s, t) => s + t.profit, 0);
  const wr = (zoneWins / zoneTrades.length * 100).toFixed(1);
  console.log(
    `${zone.name.padEnd(19)}| ${zoneTrades.length.toString().padStart(6)} | ` +
    `${zoneWins.toString().padStart(4)} | ${(zoneTrades.length - zoneWins).toString().padStart(6)} | ` +
    `${wr.padStart(7)}% | $${zoneProfit.toFixed(0).padStart(9)}`
  );
});

// === SUMMARY ===
console.log('\n' + '='.repeat(80));
console.log('SUMMARY: KEY INSIGHTS');
console.log('='.repeat(80));

const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
const winRate = wins.length / trades.length * 100;

console.log(`\n📊 Overall Performance:`);
console.log(`   Total trades: ${trades.length}`);
console.log(`   Win rate: ${winRate.toFixed(1)}%`);
console.log(`   Net profit: $${totalProfit.toFixed(2)}`);

console.log(`\n🔴 Key Loss Patterns:`);
console.log(`   - Max losing streak: ${streaks[0]?.length || 0} trades ($${Math.abs(streaks[0]?.totalLoss || 0).toFixed(0)} lost)`);
console.log(`   - Worst hours: ${losingHours.slice(0, 3).map(h => h.hour + ':00').join(', ')}`);
console.log(`   - SL exits: ${exitStats.SL.losses} losses totaling $${Math.abs(exitStats.SL.profit).toFixed(0)}`);

const avgWinRSI = avgStat(wins, t => t.rsiAtEntry);
const avgLossRSI = avgStat(losses, t => t.rsiAtEntry);
const avgWinVol = avgStat(wins, t => t.volatility);
const avgLossVol = avgStat(losses, t => t.volatility);

console.log(`\n🎯 Potential Improvements:`);
if (Math.abs(avgWinRSI - avgLossRSI) > 2) {
  console.log(`   - RSI: Winners avg ${avgWinRSI.toFixed(1)} vs Losers ${avgLossRSI.toFixed(1)}`);
}
if (Math.abs(avgWinVol - avgLossVol) > 0.01) {
  console.log(`   - Volatility: Winners avg ${avgWinVol.toFixed(3)}% vs Losers ${avgLossVol.toFixed(3)}%`);
}
if (profitableHours.length > 0 && losingHours.length > 0) {
  console.log(`   - Consider filtering hours: avoid ${losingHours.slice(-3).map(h => h.hour + ':00').join(', ')}`);
}

console.log('\n');
