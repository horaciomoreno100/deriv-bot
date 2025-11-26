/**
 * Backtest with Compound Interest
 *
 * Starts with $1000 capital and reinvests profits
 * Stake is calculated as a % of current balance
 *
 * Run: ASSET="R_100" DAYS="180" npx tsx src/scripts/backtest-compound.ts
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

interface TradeResult {
  tradeNum: number;
  timestamp: number;
  direction: 'CALL' | 'PUT';
  balanceBefore: number;
  stake: number;
  profit: number;
  balanceAfter: number;
  result: 'WIN' | 'LOSS';
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
const BAD_TIME_WINDOWS = new Set([
  '0-4', '0-5', '0-15', '0-16', '1-1', '2-1', '2-5', '2-10',
  '3-21', '4-14', '5-6', '5-15', '6-3', '6-9', '6-11',
]);

function isGoodTimeWindow(dayOfWeek: number, hourOfDay: number): boolean {
  return !BAD_TIME_WINDOWS.has(`${dayOfWeek}-${hourOfDay}`);
}

function isGoodRSIZone(rsi: number): boolean {
  return rsi < 30 || rsi > 40;
}

// === CONFIGURATION ===
const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '180';

// Capital and risk management
const INITIAL_CAPITAL = 1000;
const STAKE_PERCENT = parseFloat(process.env.STAKE_PCT || '5');  // % of balance per trade
const MAX_STAKE = 500;           // Maximum stake cap
const MIN_STAKE = 5;             // Minimum stake
const MULTIPLIER = parseInt(process.env.MULT || '100', 10);  // Multiplier (100, 200, 500, etc)

// Strategy parameters
const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

console.log('='.repeat(80));
console.log(`📊 COMPOUND INTEREST BACKTEST - ${ASSET}`);
console.log('='.repeat(80));
console.log(`\nCapital inicial: $${INITIAL_CAPITAL}`);
console.log(`Stake por trade: ${STAKE_PERCENT}% del balance (min: $${MIN_STAKE}, max: $${MAX_STAKE})`);
console.log(`Multiplicador: x${MULTIPLIER}`);
console.log(`TP: ${(params.takeProfitPct * 100).toFixed(1)}% | SL: ${(params.stopLossPct * 100).toFixed(1)}%`);
console.log(`Periodo: ${DAYS} días\n`);

const candles = loadCandles(ASSET, '1m', DAYS);
if (!candles) {
  console.log('No data found');
  process.exit(1);
}

const candles15m = loadCandles(ASSET, '15m', DAYS);
console.log(`Loaded ${candles.length} 1m candles`);
if (candles15m) console.log(`Loaded ${candles15m.length} 15m candles`);

// Trading state
let balance = INITIAL_CAPITAL;
let peakBalance = INITIAL_CAPITAL;
let maxDrawdown = 0;
let wins = 0;
let losses = 0;
let maxConsecutiveLosses = 0;
let currentLossStreak = 0;
let trades: TradeResult[] = [];

// Daily loss limit (5% of balance at start of day)
const DAILY_LOSS_LIMIT_PCT = 5;
let currentDay = '';
let dailyStartBalance = INITIAL_CAPITAL;
let dailyLoss = 0;
let daysPaused = 0;

const closes = candles.map(c => c.close);
let inSqueeze = false;
let squeezeEndBar = -1;
let lastTradeBar = -Infinity;
const minBars = 30;

console.log('\nExecuting trades with compound interest...\n');

for (let i = minBars; i < candles.length - 30; i++) {
  if (i - lastTradeBar < params.cooldownBars) continue;
  if (balance < MIN_STAKE) {
    console.log(`💀 Balance insuficiente ($${balance.toFixed(2)}). Terminando...`);
    break;
  }

  const candle = candles[i];
  const entryDate = new Date(candle.timestamp * 1000);
  const dayKey = entryDate.toISOString().slice(0, 10);

  // Reset daily tracking at start of new day
  if (dayKey !== currentDay) {
    currentDay = dayKey;
    dailyStartBalance = balance;
    dailyLoss = 0;
  }

  // Check daily loss limit - skip if exceeded 5% loss for the day
  const dailyLossPct = (dailyLoss / dailyStartBalance) * 100;
  if (dailyLossPct >= DAILY_LOSS_LIMIT_PCT) {
    daysPaused++;
    continue;
  }

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
  const hourOfDay = entryDate.getUTCHours();
  const dayOfWeek = entryDate.getUTCDay();

  // Apply filters
  if (!isGoodTimeWindow(dayOfWeek, hourOfDay)) continue;
  if (!isGoodRSIZone(rsi)) continue;

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

  // Calculate stake based on current balance (compound interest)
  const calculatedStake = balance * (STAKE_PERCENT / 100);
  const stake = Math.min(MAX_STAKE, Math.max(MIN_STAKE, calculatedStake));

  // Execute trade
  const entryPrice = candle.close;
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
  const profit = priceChangePct * stake * MULTIPLIER;

  const balanceBefore = balance;
  balance += profit;
  const result: 'WIN' | 'LOSS' = profit > 0 ? 'WIN' : 'LOSS';

  if (profit > 0) {
    wins++;
    currentLossStreak = 0;
  } else {
    losses++;
    currentLossStreak++;
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
    // Track daily loss for limit
    dailyLoss += Math.abs(profit);
  }

  // Track peak and drawdown
  if (balance > peakBalance) {
    peakBalance = balance;
  }
  const currentDrawdown = ((peakBalance - balance) / peakBalance) * 100;
  maxDrawdown = Math.max(maxDrawdown, currentDrawdown);

  trades.push({
    tradeNum: trades.length + 1,
    timestamp: candle.timestamp,
    direction: signal,
    balanceBefore,
    stake,
    profit,
    balanceAfter: balance,
    result,
  });

  lastTradeBar = i;
}

// Print summary
console.log('='.repeat(80));
console.log('RESULTADOS CON INTERES COMPUESTO');
console.log('='.repeat(80));

const totalTrades = wins + losses;
const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
const totalProfit = balance - INITIAL_CAPITAL;
const roi = (totalProfit / INITIAL_CAPITAL) * 100;

console.log(`\n💰 CAPITAL:`);
console.log(`   Inicial:     $${INITIAL_CAPITAL.toFixed(2)}`);
console.log(`   Final:       $${balance.toFixed(2)}`);
console.log(`   Ganancia:    $${totalProfit.toFixed(2)} (${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%)`);
console.log(`   Pico máximo: $${peakBalance.toFixed(2)}`);

console.log(`\n📊 ESTADÍSTICAS:`);
console.log(`   Total trades: ${totalTrades}`);
console.log(`   Wins: ${wins} | Losses: ${losses}`);
console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
console.log(`   Max Drawdown: ${maxDrawdown.toFixed(1)}%`);
console.log(`   Max Pérdidas consecutivas: ${maxConsecutiveLosses}`);

console.log(`\n🛡️ GESTIÓN DE RIESGO:`);
console.log(`   Límite diario: ${DAILY_LOSS_LIMIT_PCT}% del balance`);
console.log(`   Señales saltadas por límite: ${daysPaused}`);

// Monthly breakdown
const daysInBacktest = parseInt(DAYS);
const monthlyROI = roi / (daysInBacktest / 30);
console.log(`\n📅 PROYECCIÓN MENSUAL:`);
console.log(`   ROI mensual promedio: ${monthlyROI.toFixed(1)}%`);

// Compare with fixed stake
const fixedStakeProfit = trades.reduce((sum, t) => {
  // Calculate what profit would have been with fixed $200 stake
  const fixedProfit = (t.profit / t.stake) * 200;
  return sum + fixedProfit;
}, 0);

console.log(`\n🔄 COMPARACIÓN:`);
console.log(`   Con stake fijo ($200):     $${(INITIAL_CAPITAL + fixedStakeProfit).toFixed(2)} (+$${fixedStakeProfit.toFixed(2)})`);
console.log(`   Con interés compuesto:     $${balance.toFixed(2)} (+$${totalProfit.toFixed(2)})`);
console.log(`   Diferencia:                +$${(totalProfit - fixedStakeProfit).toFixed(2)}`);

// Show equity curve milestones
console.log(`\n📈 HITOS DEL BALANCE:`);
const milestones = [1500, 2000, 3000, 5000, 10000, 20000, 50000];
milestones.forEach(milestone => {
  const hitTrade = trades.find(t => t.balanceAfter >= milestone);
  if (hitTrade) {
    const date = new Date(hitTrade.timestamp * 1000).toISOString().slice(0, 10);
    console.log(`   $${milestone.toLocaleString().padEnd(6)} alcanzado en trade #${hitTrade.tradeNum} (${date})`);
  }
});

// Show last 10 trades
console.log(`\n📋 ÚLTIMOS 10 TRADES:`);
console.log('Trade | Balance Antes |  Stake  | Profit  | Balance Después | Result');
console.log('-'.repeat(75));
trades.slice(-10).forEach(t => {
  const profitStr = t.profit >= 0 ? `+$${t.profit.toFixed(0)}` : `-$${Math.abs(t.profit).toFixed(0)}`;
  console.log(
    `#${t.tradeNum.toString().padStart(4)} | ` +
    `$${t.balanceBefore.toFixed(0).padStart(11)} | ` +
    `$${t.stake.toFixed(0).padStart(5)} | ` +
    `${profitStr.padStart(7)} | ` +
    `$${t.balanceAfter.toFixed(0).padStart(13)} | ` +
    `${t.result}`
  );
});

console.log('\n');
