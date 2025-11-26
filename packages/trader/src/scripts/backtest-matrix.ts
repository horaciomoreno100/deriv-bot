/**
 * BB Squeeze Strategy - Matrix Backtester
 *
 * Tests multiple assets, timeframes, and parameter combinations
 * to find optimal settings for each market type
 *
 * Usage: ASSETS="frxEURUSD,frxXAUUSD,R_75" npx tsx src/scripts/backtest-matrix.ts
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

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
}

interface BacktestParams {
  bbPeriod: number;
  bbStdDev: number;
  kcPeriod: number;
  kcMultiplier: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
}

interface BacktestResult {
  asset: string;
  params: BacktestParams;
  totalTrades: number;
  winRate: number;
  netProfit: number;
  profitFactor: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSETS = (process.env.ASSETS || 'frxEURUSD,frxGBPUSD,frxXAUUSD,R_75,R_100').split(',');
const INITIAL_BALANCE = 10000;
const STAKE_PERCENT = 0.02; // 2% per trade

// Parameter combinations to test
const PARAM_COMBINATIONS: BacktestParams[] = [
  // Conservative (low volatility markets like Forex)
  {
    bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
    rsiPeriod: 14, rsiOverbought: 55, rsiOversold: 45,
    takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 5
  },
  // Aggressive (higher volatility markets)
  {
    bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.2,
    rsiPeriod: 14, rsiOverbought: 60, rsiOversold: 40,
    takeProfitPct: 0.006, stopLossPct: 0.003, cooldownBars: 3
  },
  // Tight KC (more squeeze signals)
  {
    bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.0,
    rsiPeriod: 14, rsiOverbought: 55, rsiOversold: 45,
    takeProfitPct: 0.005, stopLossPct: 0.0025, cooldownBars: 5
  },
  // Wide KC (fewer, higher quality signals)
  {
    bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 2.0,
    rsiPeriod: 14, rsiOverbought: 55, rsiOversold: 45,
    takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 5
  },
  // Short RSI (faster signals)
  {
    bbPeriod: 20, bbStdDev: 2, kcPeriod: 20, kcMultiplier: 1.5,
    rsiPeriod: 7, rsiOverbought: 60, rsiOversold: 40,
    takeProfitPct: 0.004, stopLossPct: 0.002, cooldownBars: 3
  },
];

// =============================================================================
// INDICATORS
// =============================================================================

function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateStdDev(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
  return Math.sqrt(variance);
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return NaN;

  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1]?.close || candles[i].open;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(closes: number[], period: number, stdDev: number) {
  const sma = calculateSMA(closes, period);
  const std = calculateStdDev(closes, period);

  return {
    upper: sma + (std * stdDev),
    middle: sma,
    lower: sma - (std * stdDev),
  };
}

function calculateKeltnerChannel(candles: Candle[], period: number, multiplier: number) {
  const closes = candles.map(c => c.close);
  const ema = calculateSMA(closes, period); // Using SMA for simplicity
  const atr = calculateATR(candles, period);

  return {
    upper: ema + (atr * multiplier),
    middle: ema,
    lower: ema - (atr * multiplier),
  };
}

// =============================================================================
// DATA LOADING
// =============================================================================

function loadCandles(asset: string): Candle[] | null {
  const csvPath = join(process.cwd(), 'backtest-data', `${asset}_60s_30d.csv`);

  if (!existsSync(csvPath)) {
    console.log(`   ⚠️  CSV not found: ${csvPath}`);
    return null;
  }

  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header

  const candles: Candle[] = lines.map(line => {
    const [timestamp, open, high, low, close] = line.split(',');
    const ts = parseInt(timestamp);
    // Convert ms to seconds if needed
    const timestampSeconds = ts > 10000000000 ? Math.floor(ts / 1000) : ts;
    return {
      timestamp: timestampSeconds,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
    };
  }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close));

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

// =============================================================================
// BACKTEST ENGINE
// =============================================================================

function runBacktest(candles: Candle[], params: BacktestParams): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);

  let inSqueeze = false;
  let squeezeEndBar = -1;
  let lastTradeBar = -Infinity;

  const minBars = Math.max(params.bbPeriod, params.kcPeriod, params.rsiPeriod) + 10;

  for (let i = minBars; i < candles.length - 30; i++) {
    // Cooldown check
    if (i - lastTradeBar < params.cooldownBars) continue;

    const candle = candles[i];
    const candleSlice = candles.slice(0, i + 1);
    const closeSlice = closes.slice(0, i + 1);

    // Calculate indicators
    const bb = calculateBollingerBands(closeSlice, params.bbPeriod, params.bbStdDev);
    const kc = calculateKeltnerChannel(candleSlice, params.kcPeriod, params.kcMultiplier);
    const rsi = calculateRSI(closeSlice, params.rsiPeriod);

    if (isNaN(bb.upper) || isNaN(kc.upper) || isNaN(rsi)) continue;

    // Squeeze detection
    const currentSqueeze = bb.upper < kc.upper && bb.lower > kc.lower;

    if (currentSqueeze && !inSqueeze) {
      inSqueeze = true;
    } else if (!currentSqueeze && inSqueeze) {
      inSqueeze = false;
      squeezeEndBar = i;
    }

    // Only trade within 10 bars after squeeze ends
    if (squeezeEndBar < 0 || i - squeezeEndBar > 10) continue;

    const price = candle.close;
    let signal: 'CALL' | 'PUT' | null = null;

    // Bullish breakout
    if (price > bb.upper && rsi > params.rsiOverbought) {
      signal = 'CALL';
    }
    // Bearish breakout
    else if (price < bb.lower && rsi < params.rsiOversold) {
      signal = 'PUT';
    }

    if (!signal) continue;

    // Execute trade
    const entryPrice = price;
    const tpPrice = signal === 'CALL'
      ? entryPrice * (1 + params.takeProfitPct)
      : entryPrice * (1 - params.takeProfitPct);
    const slPrice = signal === 'CALL'
      ? entryPrice * (1 - params.stopLossPct)
      : entryPrice * (1 + params.stopLossPct);

    // Simulate trade outcome
    let exitPrice = entryPrice;
    let exitTime = candle.timestamp;
    let exitReason: 'TP' | 'SL' | 'BB_MIDDLE' = 'BB_MIDDLE';

    for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
      const futureCandle = candles[j];
      const futureBB = calculateBollingerBands(closes.slice(0, j + 1), params.bbPeriod, params.bbStdDev);

      // Check TP
      if (signal === 'CALL' && futureCandle.high >= tpPrice) {
        exitPrice = tpPrice;
        exitTime = futureCandle.timestamp;
        exitReason = 'TP';
        break;
      }
      if (signal === 'PUT' && futureCandle.low <= tpPrice) {
        exitPrice = tpPrice;
        exitTime = futureCandle.timestamp;
        exitReason = 'TP';
        break;
      }

      // Check SL
      if (signal === 'CALL' && futureCandle.low <= slPrice) {
        exitPrice = slPrice;
        exitTime = futureCandle.timestamp;
        exitReason = 'SL';
        break;
      }
      if (signal === 'PUT' && futureCandle.high >= slPrice) {
        exitPrice = slPrice;
        exitTime = futureCandle.timestamp;
        exitReason = 'SL';
        break;
      }

      // Check BB Middle exit
      if (signal === 'CALL' && futureCandle.close <= futureBB.middle) {
        exitPrice = futureCandle.close;
        exitTime = futureCandle.timestamp;
        exitReason = 'BB_MIDDLE';
        break;
      }
      if (signal === 'PUT' && futureCandle.close >= futureBB.middle) {
        exitPrice = futureCandle.close;
        exitTime = futureCandle.timestamp;
        exitReason = 'BB_MIDDLE';
        break;
      }

      exitPrice = futureCandle.close;
      exitTime = futureCandle.timestamp;
    }

    // Calculate profit
    const priceChange = signal === 'CALL'
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;
    const profit = (priceChange / entryPrice) * (INITIAL_BALANCE * STAKE_PERCENT);

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

  return trades;
}

function analyzeResults(asset: string, params: BacktestParams, trades: Trade[]): BacktestResult {
  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');

  const totalProfit = wins.reduce((sum, t) => sum + t.profit, 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0));

  let balance = INITIAL_BALANCE;
  let peak = INITIAL_BALANCE;
  let maxDrawdown = 0;

  for (const trade of trades) {
    balance += trade.profit;
    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    asset,
    params,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    netProfit: totalProfit - totalLoss,
    profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
    maxDrawdown: maxDrawdown * 100,
    avgWin: wins.length > 0 ? totalProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('📊 BB SQUEEZE STRATEGY - MATRIX BACKTESTER');
  console.log('='.repeat(80));
  console.log(`\nAssets: ${ASSETS.join(', ')}`);
  console.log(`Parameter combinations: ${PARAM_COMBINATIONS.length}`);
  console.log(`Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`Stake: ${STAKE_PERCENT * 100}%\n`);

  const allResults: BacktestResult[] = [];

  for (const asset of ASSETS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📥 Loading ${asset}...`);

    const candles = loadCandles(asset);
    if (!candles || candles.length < 100) {
      console.log(`   ❌ Skipping - insufficient data`);
      continue;
    }

    console.log(`   ✅ Loaded ${candles.length} candles`);
    console.log(`   Period: ${new Date(candles[0].timestamp * 1000).toISOString().split('T')[0]} to ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString().split('T')[0]}`);

    for (let p = 0; p < PARAM_COMBINATIONS.length; p++) {
      const params = PARAM_COMBINATIONS[p];
      process.stdout.write(`   Testing params #${p + 1}... `);

      const trades = runBacktest(candles, params);
      const result = analyzeResults(asset, params, trades);
      allResults.push(result);

      console.log(`${trades.length} trades | WR: ${result.winRate.toFixed(1)}% | Net: $${result.netProfit.toFixed(2)}`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 RESULTS SUMMARY');
  console.log('='.repeat(80));

  // Group by asset
  const byAsset = new Map<string, BacktestResult[]>();
  for (const r of allResults) {
    if (!byAsset.has(r.asset)) byAsset.set(r.asset, []);
    byAsset.get(r.asset)!.push(r);
  }

  for (const [asset, results] of byAsset) {
    console.log(`\n🎯 ${asset}`);
    console.log('─'.repeat(60));

    // Sort by net profit
    const sorted = [...results].sort((a, b) => b.netProfit - a.netProfit);

    console.log(`${'Params'.padEnd(10)} | ${'Trades'.padEnd(7)} | ${'WinRate'.padEnd(8)} | ${'NetProfit'.padEnd(12)} | ${'PF'.padEnd(6)} | MaxDD`);

    for (const r of sorted.slice(0, 3)) {
      const paramsStr = `KC${r.params.kcMultiplier}`;
      console.log(
        `${paramsStr.padEnd(10)} | ` +
        `${r.totalTrades.toString().padEnd(7)} | ` +
        `${r.winRate.toFixed(1).padEnd(8)}% | ` +
        `$${r.netProfit.toFixed(2).padStart(10)} | ` +
        `${r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2).padEnd(6)} | ` +
        `${r.maxDrawdown.toFixed(1)}%`
      );
    }
  }

  // Best overall
  const bestOverall = allResults.sort((a, b) => b.netProfit - a.netProfit)[0];
  if (bestOverall) {
    console.log('\n' + '='.repeat(80));
    console.log('🏆 BEST OVERALL CONFIGURATION');
    console.log('='.repeat(80));
    console.log(`Asset: ${bestOverall.asset}`);
    console.log(`KC Multiplier: ${bestOverall.params.kcMultiplier}`);
    console.log(`TP/SL: ${(bestOverall.params.takeProfitPct * 100).toFixed(2)}% / ${(bestOverall.params.stopLossPct * 100).toFixed(2)}%`);
    console.log(`Total Trades: ${bestOverall.totalTrades}`);
    console.log(`Win Rate: ${bestOverall.winRate.toFixed(2)}%`);
    console.log(`Net Profit: $${bestOverall.netProfit.toFixed(2)}`);
    console.log(`Profit Factor: ${bestOverall.profitFactor === Infinity ? '∞' : bestOverall.profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown: ${bestOverall.maxDrawdown.toFixed(2)}%`);
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backtest_matrix_${timestamp}.json`;
  writeFileSync(filename, JSON.stringify(allResults, null, 2));
  console.log(`\n💾 Results saved to: ${filename}`);

  console.log('\n✅ Matrix backtest complete');
}

main().catch(console.error);
