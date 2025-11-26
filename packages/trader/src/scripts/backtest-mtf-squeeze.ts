/**
 * BB Squeeze Strategy - Multi-Timeframe Backtest
 *
 * Uses 3 timeframes for better signal quality:
 * - 15m: Trend context (avoid counter-trend trades)
 * - 5m: Squeeze confirmation
 * - 1m: Entry timing
 *
 * Usage: ASSET="R_100" DAYS="90" npx tsx src/scripts/backtest-mtf-squeeze.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

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
  trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  squeeze5m: boolean;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';
const STAKE = 200;
const MULTIPLIER = 100;

const params = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  rsiPeriod: 7,
  rsiOverbought: 60,
  rsiOversold: 40,
  takeProfitPct: 0.004,
  stopLossPct: 0.002,
  cooldownBars: 3,
  // MTF settings
  trendPeriod: 20, // SMA period for trend detection
};

// =============================================================================
// INDICATORS
// =============================================================================

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

function isInSqueeze(closes: number[], candles: Candle[], bbPeriod: number, bbStdDev: number, kcPeriod: number, kcMultiplier: number): boolean {
  const sma = calculateSMA(closes, bbPeriod);
  const std = calculateStdDev(closes, bbPeriod);
  const bbUpper = sma + (std * bbStdDev);
  const bbLower = sma - (std * bbStdDev);

  const ema = calculateSMA(closes, kcPeriod);
  const atr = calculateATR(candles, kcPeriod);
  const kcUpper = ema + (atr * kcMultiplier);
  const kcLower = ema - (atr * kcMultiplier);

  return bbUpper < kcUpper && bbLower > kcLower;
}

function getTrend(closes: number[], period: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (closes.length < period + 10) return 'NEUTRAL';

  const currentSMA = calculateSMA(closes, period);
  const prevSMA = calculateSMA(closes.slice(0, -5), period);
  const currentPrice = closes[closes.length - 1];

  // Trend based on SMA slope and price position
  const smaSlope = (currentSMA - prevSMA) / prevSMA;

  if (currentPrice > currentSMA && smaSlope > 0.0005) return 'BULLISH';
  if (currentPrice < currentSMA && smaSlope < -0.0005) return 'BEARISH';
  return 'NEUTRAL';
}

// =============================================================================
// DATA LOADING
// =============================================================================

function loadCandles(asset: string, timeframe: string, days: string): Candle[] | null {
  const csvPath = join(process.cwd(), 'backtest-data', `${asset}_${timeframe}_${days}d.csv`);

  if (!existsSync(csvPath)) {
    console.log(`   ⚠️  CSV not found: ${csvPath}`);
    return null;
  }

  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1);

  const candles = lines.map(line => {
    const [timestamp, open, high, low, close] = line.split(',');
    const ts = parseInt(timestamp);
    return {
      timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
    };
  }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close));

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

// Find the corresponding higher timeframe candle for a given 1m timestamp
function getHTFCandle(htfCandles: Candle[], timestamp: number): Candle | null {
  // Find the HTF candle that contains this timestamp
  for (let i = htfCandles.length - 1; i >= 0; i--) {
    if (htfCandles[i].timestamp <= timestamp) {
      return htfCandles[i];
    }
  }
  return null;
}

// Get historical HTF candles up to a timestamp
function getHTFCandlesUpTo(htfCandles: Candle[], timestamp: number, count: number): Candle[] {
  const result: Candle[] = [];
  for (let i = htfCandles.length - 1; i >= 0 && result.length < count; i--) {
    if (htfCandles[i].timestamp <= timestamp) {
      result.unshift(htfCandles[i]);
    }
  }
  return result;
}

// =============================================================================
// BACKTEST ENGINE
// =============================================================================

function runMTFBacktest(
  candles1m: Candle[],
  candles5m: Candle[],
  candles15m: Candle[]
): { trades: Trade[], stats: any } {
  const trades: Trade[] = [];
  const closes1m = candles1m.map(c => c.close);

  let inSqueeze1m = false;
  let squeezeEndBar = -1;
  let lastTradeBar = -Infinity;

  const minBars = 30;

  for (let i = minBars; i < candles1m.length - 30; i++) {
    if (i - lastTradeBar < params.cooldownBars) continue;

    const candle = candles1m[i];
    const timestamp = candle.timestamp;
    const closeSlice = closes1m.slice(0, i + 1);
    const candleSlice = candles1m.slice(0, i + 1);

    // ===========================================
    // 1. Get 15m trend context
    // ===========================================
    const htf15mCandles = getHTFCandlesUpTo(candles15m, timestamp, params.trendPeriod + 10);
    if (htf15mCandles.length < params.trendPeriod) continue;

    const closes15m = htf15mCandles.map(c => c.close);
    const trend15m = getTrend(closes15m, params.trendPeriod);

    // ===========================================
    // 2. Check 5m squeeze status
    // ===========================================
    const htf5mCandles = getHTFCandlesUpTo(candles5m, timestamp, params.bbPeriod + 5);
    if (htf5mCandles.length < params.bbPeriod) continue;

    const closes5m = htf5mCandles.map(c => c.close);
    const squeeze5m = isInSqueeze(closes5m, htf5mCandles, params.bbPeriod, params.bbStdDev, params.kcPeriod, params.kcMultiplier);

    // ===========================================
    // 3. Check 1m squeeze and breakout
    // ===========================================
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

    const currentSqueeze1m = bbUpper < kcUpper && bbLower > kcLower;

    if (currentSqueeze1m && !inSqueeze1m) inSqueeze1m = true;
    else if (!currentSqueeze1m && inSqueeze1m) {
      inSqueeze1m = false;
      squeezeEndBar = i;
    }

    if (squeezeEndBar < 0 || i - squeezeEndBar > 10) continue;

    const price = candle.close;
    let signal: 'CALL' | 'PUT' | null = null;

    // ===========================================
    // 4. Signal with MTF filter
    // ===========================================
    if (price > bbUpper && rsi > params.rsiOverbought) {
      // Bullish breakout - only take if 15m trend is not bearish
      if (trend15m !== 'BEARISH') {
        signal = 'CALL';
      }
    } else if (price < bbLower && rsi < params.rsiOversold) {
      // Bearish breakout - only take if 15m trend is not bullish
      if (trend15m !== 'BULLISH') {
        signal = 'PUT';
      }
    }

    if (!signal) continue;

    // ===========================================
    // 5. Execute trade
    // ===========================================
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

    for (let j = i + 1; j < Math.min(i + 30, candles1m.length); j++) {
      const fc = candles1m[j];
      const futureSMA = calculateSMA(closes1m.slice(0, j + 1), params.bbPeriod);

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
      trend15m,
      squeeze5m,
    });

    lastTradeBar = i;
  }

  // Calculate stats
  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const tpExits = trades.filter(t => t.exitReason === 'TP');
  const slExits = trades.filter(t => t.exitReason === 'SL');
  const bbExits = trades.filter(t => t.exitReason === 'BB_MIDDLE');

  const stats = {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    tpExits: tpExits.length,
    slExits: slExits.length,
    bbExits: bbExits.length,
    tpProfit: tpExits.reduce((s, t) => s + t.profit, 0),
    slProfit: slExits.reduce((s, t) => s + t.profit, 0),
    bbProfit: bbExits.reduce((s, t) => s + t.profit, 0),
    netProfit: trades.reduce((s, t) => s + t.profit, 0),
    // By trend
    bullishTrades: trades.filter(t => t.trend15m === 'BULLISH').length,
    bearishTrades: trades.filter(t => t.trend15m === 'BEARISH').length,
    neutralTrades: trades.filter(t => t.trend15m === 'NEUTRAL').length,
  };

  return { trades, stats };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log(`📊 BB SQUEEZE MTF BACKTEST - ${ASSET}`);
  console.log('='.repeat(70));
  console.log(`\nTimeframes: 1m (entry) + 5m (squeeze) + 15m (trend)`);
  console.log(`Period: ${DAYS} days\n`);

  // Load data for all timeframes
  // Note: 1m files use "60s" naming convention from earlier downloads
  console.log('Loading data...');
  let candles1m = loadCandles(ASSET, '1m', DAYS);
  if (!candles1m) candles1m = loadCandles(ASSET, '60s', DAYS); // Try legacy naming
  const candles5m = loadCandles(ASSET, '5m', DAYS);
  const candles15m = loadCandles(ASSET, '15m', DAYS);

  if (!candles1m) {
    console.log('❌ 1m data not found');
    process.exit(1);
  }
  if (!candles5m) {
    console.log('❌ 5m data not found');
    process.exit(1);
  }
  if (!candles15m) {
    console.log('❌ 15m data not found');
    process.exit(1);
  }

  console.log(`   1m: ${candles1m.length} candles`);
  console.log(`   5m: ${candles5m.length} candles`);
  console.log(`   15m: ${candles15m.length} candles`);

  // Run MTF backtest
  console.log('\nRunning MTF backtest...');
  const { trades, stats } = runMTFBacktest(candles1m, candles5m, candles15m);

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('📈 MTF BACKTEST RESULTS');
  console.log('='.repeat(70));

  console.log(`\nTotal Trades: ${stats.totalTrades}`);
  console.log(`Win Rate: ${stats.winRate.toFixed(1)}%`);
  console.log(`\nExit Reasons:`);
  console.log(`   TP: ${stats.tpExits} (${(stats.tpExits/stats.totalTrades*100).toFixed(1)}%) | Profit: $${stats.tpProfit.toFixed(2)}`);
  console.log(`   SL: ${stats.slExits} (${(stats.slExits/stats.totalTrades*100).toFixed(1)}%) | Profit: $${stats.slProfit.toFixed(2)}`);
  console.log(`   BB: ${stats.bbExits} (${(stats.bbExits/stats.totalTrades*100).toFixed(1)}%) | Profit: $${stats.bbProfit.toFixed(2)}`);

  console.log(`\n15m Trend Distribution:`);
  console.log(`   Bullish: ${stats.bullishTrades} trades`);
  console.log(`   Bearish: ${stats.bearishTrades} trades`);
  console.log(`   Neutral: ${stats.neutralTrades} trades`);

  console.log('\n' + '='.repeat(70));
  console.log(`💰 NET PROFIT: $${stats.netProfit.toFixed(2)}`);
  console.log('='.repeat(70));

  // Compare with baseline (run single TF for comparison)
  console.log('\n📊 Running single-timeframe baseline for comparison...');

  // Simple single TF backtest (same logic but without MTF filter)
  const baselineTrades: Trade[] = [];
  const closes1m = candles1m.map(c => c.close);
  let inSqueeze = false;
  let squeezeEndBar = -1;
  let lastTradeBar = -Infinity;

  for (let i = 30; i < candles1m.length - 30; i++) {
    if (i - lastTradeBar < params.cooldownBars) continue;

    const candle = candles1m[i];
    const closeSlice = closes1m.slice(0, i + 1);
    const candleSlice = candles1m.slice(0, i + 1);

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
    let exitReason: 'TP' | 'SL' | 'BB_MIDDLE' = 'BB_MIDDLE';

    for (let j = i + 1; j < Math.min(i + 30, candles1m.length); j++) {
      const fc = candles1m[j];
      const futureSMA = calculateSMA(closes1m.slice(0, j + 1), params.bbPeriod);

      if (signal === 'CALL' && fc.high >= tpPrice) { exitPrice = tpPrice; exitReason = 'TP'; break; }
      if (signal === 'PUT' && fc.low <= tpPrice) { exitPrice = tpPrice; exitReason = 'TP'; break; }
      if (signal === 'CALL' && fc.low <= slPrice) { exitPrice = slPrice; exitReason = 'SL'; break; }
      if (signal === 'PUT' && fc.high >= slPrice) { exitPrice = slPrice; exitReason = 'SL'; break; }
      if (signal === 'CALL' && fc.close <= futureSMA) { exitPrice = fc.close; exitReason = 'BB_MIDDLE'; break; }
      if (signal === 'PUT' && fc.close >= futureSMA) { exitPrice = fc.close; exitReason = 'BB_MIDDLE'; break; }
      exitPrice = fc.close;
    }

    const priceChangePct = signal === 'CALL'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    const profit = priceChangePct * STAKE * MULTIPLIER;

    baselineTrades.push({
      entryTime: candle.timestamp,
      exitTime: 0,
      direction: signal,
      entryPrice,
      exitPrice,
      profit,
      result: profit > 0 ? 'WIN' : 'LOSS',
      exitReason,
      trend15m: 'NEUTRAL',
      squeeze5m: false,
    });

    lastTradeBar = i;
  }

  const baselineWins = baselineTrades.filter(t => t.result === 'WIN').length;
  const baselineNet = baselineTrades.reduce((s, t) => s + t.profit, 0);

  console.log('\n' + '='.repeat(70));
  console.log('📊 COMPARISON: MTF vs SINGLE TIMEFRAME');
  console.log('='.repeat(70));
  console.log(`\n${'Metric'.padEnd(20)} | ${'Single TF'.padEnd(15)} | ${'MTF'.padEnd(15)} | Change`);
  console.log('-'.repeat(70));
  console.log(`${'Trades'.padEnd(20)} | ${baselineTrades.length.toString().padEnd(15)} | ${stats.totalTrades.toString().padEnd(15)} | ${stats.totalTrades - baselineTrades.length}`);
  console.log(`${'Win Rate'.padEnd(20)} | ${(baselineWins/baselineTrades.length*100).toFixed(1).padEnd(14)}% | ${stats.winRate.toFixed(1).padEnd(14)}% | ${(stats.winRate - baselineWins/baselineTrades.length*100).toFixed(1)}%`);
  console.log(`${'Net Profit'.padEnd(20)} | $${baselineNet.toFixed(2).padStart(13)} | $${stats.netProfit.toFixed(2).padStart(13)} | $${(stats.netProfit - baselineNet).toFixed(2)}`);

  const improvement = baselineNet !== 0 ? ((stats.netProfit - baselineNet) / Math.abs(baselineNet) * 100).toFixed(1) : 'N/A';
  console.log(`\n🎯 MTF Improvement: ${improvement}%`);
}

main().catch(console.error);
