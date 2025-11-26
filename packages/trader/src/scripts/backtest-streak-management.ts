/**
 * Backtest with Streak Management Strategies
 *
 * Tests different approaches to handle losing streaks:
 * 1. Base (no management) - just compound interest
 * 2. Pause after N losses - stop trading after consecutive losses
 * 3. Reduce stake after losses - decrease risk during drawdown
 * 4. Daily loss limit - stop trading for the day after X% loss
 * 5. Cooldown increase - longer wait between trades during losing streaks
 *
 * Run: ASSET="R_100" DAYS="180" npx tsx src/scripts/backtest-streak-management.ts
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
  lossStreak: number;
}

interface StrategyResult {
  name: string;
  finalBalance: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  roi: number;
  tradesSkipped: number;
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
const INITIAL_CAPITAL = 1000;
const BASE_STAKE_PERCENT = 2;  // 2% base stake
const MAX_STAKE = 500;
const MIN_STAKE = 5;
const MULTIPLIER = 100;

const params = {
  bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
  rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
  takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
};

interface StreakConfig {
  name: string;
  // Pause trading after N consecutive losses (0 = no pause)
  pauseAfterLosses: number;
  // Number of bars to pause
  pauseBars: number;
  // Reduce stake by this % after each loss (0 = no reduction)
  stakeReductionPerLoss: number;
  // Minimum stake multiplier (e.g., 0.25 = reduce to 25% max)
  minStakeMultiplier: number;
  // Daily loss limit as % of balance (0 = no limit)
  dailyLossLimit: number;
  // Increase cooldown by this many bars per loss in streak
  cooldownIncreasePerLoss: number;
  // Max additional cooldown bars
  maxAdditionalCooldown: number;
  // Require N wins to reset to normal trading
  winsToReset: number;
}

const STRATEGIES: StreakConfig[] = [
  {
    name: '1. Base (sin gestión)',
    pauseAfterLosses: 0,
    pauseBars: 0,
    stakeReductionPerLoss: 0,
    minStakeMultiplier: 1,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 0,
  },
  {
    name: '2. Pausa 3 pérdidas (30 bars)',
    pauseAfterLosses: 3,
    pauseBars: 30,
    stakeReductionPerLoss: 0,
    minStakeMultiplier: 1,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 1,
  },
  {
    name: '3. Pausa 5 pérdidas (60 bars)',
    pauseAfterLosses: 5,
    pauseBars: 60,
    stakeReductionPerLoss: 0,
    minStakeMultiplier: 1,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 1,
  },
  {
    name: '4. Reducir stake 25%/pérdida',
    pauseAfterLosses: 0,
    pauseBars: 0,
    stakeReductionPerLoss: 25,
    minStakeMultiplier: 0.25,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 2,
  },
  {
    name: '5. Reducir stake 50%/pérdida',
    pauseAfterLosses: 0,
    pauseBars: 0,
    stakeReductionPerLoss: 50,
    minStakeMultiplier: 0.125,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 2,
  },
  {
    name: '6. Límite diario 5%',
    pauseAfterLosses: 0,
    pauseBars: 0,
    stakeReductionPerLoss: 0,
    minStakeMultiplier: 1,
    dailyLossLimit: 5,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 0,
  },
  {
    name: '7. Límite diario 10%',
    pauseAfterLosses: 0,
    pauseBars: 0,
    stakeReductionPerLoss: 0,
    minStakeMultiplier: 1,
    dailyLossLimit: 10,
    cooldownIncreasePerLoss: 0,
    cooldownIncreasePerLoss: 0,
    maxAdditionalCooldown: 0,
    winsToReset: 0,
  },
  {
    name: '8. Cooldown progresivo',
    pauseAfterLosses: 0,
    pauseBars: 0,
    stakeReductionPerLoss: 0,
    minStakeMultiplier: 1,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 5,
    maxAdditionalCooldown: 30,
    winsToReset: 2,
  },
  {
    name: '9. Combinado (reducir + pausa)',
    pauseAfterLosses: 5,
    pauseBars: 30,
    stakeReductionPerLoss: 30,
    minStakeMultiplier: 0.25,
    dailyLossLimit: 0,
    cooldownIncreasePerLoss: 3,
    maxAdditionalCooldown: 15,
    winsToReset: 2,
  },
  {
    name: '10. Conservador extremo',
    pauseAfterLosses: 3,
    pauseBars: 60,
    stakeReductionPerLoss: 50,
    minStakeMultiplier: 0.1,
    dailyLossLimit: 5,
    cooldownIncreasePerLoss: 10,
    maxAdditionalCooldown: 60,
    winsToReset: 3,
  },
];

function runBacktest(
  candles: Candle[],
  candles15m: Candle[] | null,
  config: StreakConfig
): StrategyResult {
  let balance = INITIAL_CAPITAL;
  let peakBalance = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  let wins = 0;
  let losses = 0;
  let maxConsecutiveLosses = 0;
  let currentLossStreak = 0;
  let currentWinStreak = 0;
  let tradesSkipped = 0;

  // Daily tracking
  let currentDay = '';
  let dailyStartBalance = INITIAL_CAPITAL;
  let dailyLoss = 0;
  let dayPaused = false;

  // Pause tracking
  let pauseUntilBar = -1;
  let stakeMultiplier = 1;

  const closes = candles.map(c => c.close);
  let inSqueeze = false;
  let squeezeEndBar = -1;
  let lastTradeBar = -Infinity;
  const minBars = 30;

  for (let i = minBars; i < candles.length - 30; i++) {
    const candle = candles[i];
    const entryDate = new Date(candle.timestamp * 1000);
    const dayKey = entryDate.toISOString().slice(0, 10);

    // Reset daily tracking
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      dailyStartBalance = balance;
      dailyLoss = 0;
      dayPaused = false;
    }

    // Calculate dynamic cooldown
    const additionalCooldown = Math.min(
      config.maxAdditionalCooldown,
      currentLossStreak * config.cooldownIncreasePerLoss
    );
    const effectiveCooldown = params.cooldownBars + additionalCooldown;

    if (i - lastTradeBar < effectiveCooldown) continue;
    if (balance < MIN_STAKE) break;

    // Check if paused
    if (i < pauseUntilBar) {
      continue;
    }

    // Check daily loss limit
    if (config.dailyLossLimit > 0) {
      const dailyLossPct = (dailyLoss / dailyStartBalance) * 100;
      if (dailyLossPct >= config.dailyLossLimit) {
        dayPaused = true;
      }
    }
    if (dayPaused) {
      tradesSkipped++;
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

    let signal: 'CALL' | 'PUT' | null = null;
    if (price > bbUpper && rsi > params.rsiOverbought) {
      if (trend15m !== 'BEARISH') signal = 'CALL';
    } else if (price < bbLower && rsi < params.rsiOversold) {
      if (trend15m !== 'BULLISH') signal = 'PUT';
    }

    if (!signal) continue;

    // Calculate stake with multiplier
    const baseStake = balance * (BASE_STAKE_PERCENT / 100);
    const adjustedStake = baseStake * stakeMultiplier;
    const stake = Math.min(MAX_STAKE, Math.max(MIN_STAKE, adjustedStake));

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

    balance += profit;

    if (profit > 0) {
      wins++;
      currentWinStreak++;

      // Check if we should reset to normal trading
      if (currentWinStreak >= config.winsToReset) {
        currentLossStreak = 0;
        stakeMultiplier = 1;
      }
    } else {
      losses++;
      currentLossStreak++;
      currentWinStreak = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);

      // Track daily loss
      dailyLoss += Math.abs(profit);

      // Apply stake reduction
      if (config.stakeReductionPerLoss > 0) {
        stakeMultiplier = Math.max(
          config.minStakeMultiplier,
          stakeMultiplier * (1 - config.stakeReductionPerLoss / 100)
        );
      }

      // Check if we should pause
      if (config.pauseAfterLosses > 0 && currentLossStreak >= config.pauseAfterLosses) {
        pauseUntilBar = i + config.pauseBars;
        tradesSkipped++;
      }
    }

    if (balance > peakBalance) {
      peakBalance = balance;
    }
    const currentDrawdown = ((peakBalance - balance) / peakBalance) * 100;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);

    lastTradeBar = i;
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const roi = ((balance - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

  return {
    name: config.name,
    finalBalance: balance,
    totalTrades,
    wins,
    losses,
    winRate,
    maxDrawdown,
    maxConsecutiveLosses,
    roi,
    tradesSkipped,
  };
}

// Main execution
console.log('='.repeat(80));
console.log(`📊 ANÁLISIS DE GESTIÓN DE RACHAS NEGATIVAS - ${ASSET}`);
console.log('='.repeat(80));
console.log(`\nCapital inicial: $${INITIAL_CAPITAL}`);
console.log(`Stake base: ${BASE_STAKE_PERCENT}% del balance`);
console.log(`Periodo: ${DAYS} días\n`);

const candles = loadCandles(ASSET, '1m', DAYS);
if (!candles) {
  console.log('No data found');
  process.exit(1);
}

const candles15m = loadCandles(ASSET, '15m', DAYS);
console.log(`Loaded ${candles.length} 1m candles`);
if (candles15m) console.log(`Loaded ${candles15m.length} 15m candles`);

console.log('\nEjecutando estrategias...\n');

const results: StrategyResult[] = [];

for (const strategy of STRATEGIES) {
  const result = runBacktest(candles, candles15m, strategy);
  results.push(result);
}

// Sort by final balance
results.sort((a, b) => b.finalBalance - a.finalBalance);

// Print results
console.log('='.repeat(100));
console.log('RESULTADOS COMPARATIVOS');
console.log('='.repeat(100));
console.log();

console.log('Estrategia'.padEnd(35) +
  'Balance'.padStart(10) +
  'ROI'.padStart(10) +
  'Trades'.padStart(8) +
  'WR%'.padStart(8) +
  'MaxDD'.padStart(8) +
  'MaxLoss'.padStart(8) +
  'Skip'.padStart(8));
console.log('-'.repeat(100));

for (const r of results) {
  console.log(
    r.name.padEnd(35) +
    `$${r.finalBalance.toFixed(0)}`.padStart(10) +
    `${r.roi >= 0 ? '+' : ''}${r.roi.toFixed(1)}%`.padStart(10) +
    r.totalTrades.toString().padStart(8) +
    `${r.winRate.toFixed(1)}%`.padStart(8) +
    `${r.maxDrawdown.toFixed(1)}%`.padStart(8) +
    r.maxConsecutiveLosses.toString().padStart(8) +
    r.tradesSkipped.toString().padStart(8)
  );
}

console.log();
console.log('='.repeat(100));
console.log('ANÁLISIS');
console.log('='.repeat(100));

const best = results[0];
const base = results.find(r => r.name.includes('Base'))!;

console.log(`\n🏆 MEJOR ESTRATEGIA: ${best.name}`);
console.log(`   Balance final: $${best.finalBalance.toFixed(2)} (${best.roi >= 0 ? '+' : ''}${best.roi.toFixed(1)}% ROI)`);
console.log(`   Max Drawdown: ${best.maxDrawdown.toFixed(1)}%`);
console.log(`   Max pérdidas consecutivas: ${best.maxConsecutiveLosses}`);

console.log(`\n📊 VS BASE (sin gestión):`);
console.log(`   Balance: $${base.finalBalance.toFixed(2)} → $${best.finalBalance.toFixed(2)} (${((best.finalBalance - base.finalBalance) / base.finalBalance * 100).toFixed(1)}% mejor)`);
console.log(`   Max DD: ${base.maxDrawdown.toFixed(1)}% → ${best.maxDrawdown.toFixed(1)}% (${(base.maxDrawdown - best.maxDrawdown).toFixed(1)}% menos)`);

// Find strategy with lowest drawdown
const lowestDD = results.reduce((min, r) => r.maxDrawdown < min.maxDrawdown ? r : min, results[0]);
console.log(`\n🛡️ MENOR DRAWDOWN: ${lowestDD.name}`);
console.log(`   Max Drawdown: ${lowestDD.maxDrawdown.toFixed(1)}%`);
console.log(`   Balance final: $${lowestDD.finalBalance.toFixed(2)}`);

// Find best risk-adjusted return (ROI / MaxDD)
const bestRiskAdjusted = results.reduce((best, r) => {
  const riskAdj = r.roi / (r.maxDrawdown || 1);
  const bestRiskAdj = best.roi / (best.maxDrawdown || 1);
  return riskAdj > bestRiskAdj ? r : best;
}, results[0]);

console.log(`\n⚖️ MEJOR RELACIÓN RIESGO/RETORNO: ${bestRiskAdjusted.name}`);
console.log(`   ROI: ${bestRiskAdjusted.roi.toFixed(1)}% / DD: ${bestRiskAdjusted.maxDrawdown.toFixed(1)}% = ${(bestRiskAdjusted.roi / bestRiskAdjusted.maxDrawdown).toFixed(2)} ratio`);

console.log('\n');
