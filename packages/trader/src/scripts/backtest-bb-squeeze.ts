/**
 * BB Squeeze Strategy Backtester
 *
 * Fetches historical data from Deriv API and runs the BB Squeeze strategy
 * to calculate win rate, ROI, profit factor, and other metrics
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { BBSqueezeStrategy } from '../strategies/bb-squeeze.strategy.js';
import type { Candle, Signal } from '@deriv-bot/shared';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load environment variables
dotenv.config();

// Configuration
const SYMBOLS = process.env.SYMBOL?.split(',') || ['R_75', 'R_100'];
const TIMEFRAME = 60; // 1 minute
const DAYS_TO_BACKTEST = parseInt(process.env.BACKTEST_DAYS || '7', 10); // Default 7 days
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const RISK_PERCENTAGE = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2%

// TP/SL from strategy
const TP_PCT = 0.004; // 0.4%
const SL_PCT = 0.002; // 0.2%

// Trade tracking
interface Trade {
  id: string;
  asset: string;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  stake: number;
  profit: number;
  result: 'WIN' | 'LOSS';
  exitReason: 'TP' | 'SL' | 'BB_MIDDLE';
  metadata?: any;
}

interface BacktestResult {
  symbol: string;
  totalTrades: number;
  wonTrades: number;
  lostTrades: number;
  winRate: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  roi: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: Trade[];
  equity: number[];
  timestamps: number[];
}

// Global state
let balance = INITIAL_BALANCE;
let peakBalance = INITIAL_BALANCE;
let maxDrawdown = 0;
const allTrades: Trade[] = [];
const equityCurve: number[] = [INITIAL_BALANCE];
const equityTimestamps: number[] = [];

/**
 * Load candles from CSV file
 */
function loadCandlesFromCSV(symbol: string): Candle[] | null {
  const csvPath = join(process.cwd(), 'backtest-data', `${symbol}_60s_30d.csv`);

  if (!existsSync(csvPath)) {
    console.log(`   ⚠️  CSV not found: ${csvPath}`);
    return null;
  }

  console.log(`   📂 Loading from: ${csvPath}`);
  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  // Skip header
  const dataLines = lines.slice(1);

  const candles: Candle[] = dataLines.map(line => {
    const [timestamp, open, high, low, close] = line.split(',');
    // CSV has timestamps in milliseconds, convert to seconds
    const ts = parseInt(timestamp);
    const timestampSeconds = ts > 10000000000 ? Math.floor(ts / 1000) : ts;
    return {
      asset: symbol,
      timeframe: TIMEFRAME,
      timestamp: timestampSeconds,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
    };
  }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close));

  // Sort by timestamp
  candles.sort((a, b) => a.timestamp - b.timestamp);

  return candles;
}

/**
 * Calculate position size based on risk percentage
 */
function calculateStake(price: number): number {
  const riskAmount = balance * RISK_PERCENTAGE;
  const maxLoss = price * SL_PCT;
  const stake = Math.max(1, Math.min(riskAmount / maxLoss, balance * 0.10));
  return Math.floor(stake * 100) / 100; // Round to 2 decimals
}

/**
 * Simulate trade execution and outcome
 */
function simulateTrade(
  signal: Signal,
  candles: Candle[],
  currentIndex: number
): Trade | null {
  const entryCandle = candles[currentIndex];
  const entryPrice = entryCandle.close;
  const stake = calculateStake(entryPrice);

  if (stake < 1 || stake > balance) {
    console.log(`   ⚠️  Insufficient balance or invalid stake: ${stake.toFixed(2)}`);
    return null;
  }

  // Calculate TP/SL prices
  const tpPrice = signal.direction === 'CALL'
    ? entryPrice * (1 + TP_PCT)
    : entryPrice * (1 - TP_PCT);

  const slPrice = signal.direction === 'CALL'
    ? entryPrice * (1 - SL_PCT)
    : entryPrice * (1 + SL_PCT);

  // Extract BB_Middle from signal metadata
  const bbMiddle = signal.metadata?.bbMiddle ? parseFloat(signal.metadata.bbMiddle) : null;

  // Simulate trade execution over next candles (max 30 candles = 30 minutes)
  const maxCandles = Math.min(30, candles.length - currentIndex - 1);
  let exitPrice = entryPrice;
  let exitTime = entryCandle.timestamp;
  let exitReason: 'TP' | 'SL' | 'BB_MIDDLE' = 'SL';
  let hitTarget = false;

  for (let i = 1; i <= maxCandles; i++) {
    const nextCandle = candles[currentIndex + i];
    if (!nextCandle) break;

    // Check for TP hit
    if (signal.direction === 'CALL') {
      if (nextCandle.high >= tpPrice) {
        exitPrice = tpPrice;
        exitTime = nextCandle.timestamp;
        exitReason = 'TP';
        hitTarget = true;
        break;
      }
      // Check for SL hit
      if (nextCandle.low <= slPrice) {
        exitPrice = slPrice;
        exitTime = nextCandle.timestamp;
        exitReason = 'SL';
        hitTarget = true;
        break;
      }
      // Check for BB_Middle hit (smart exit)
      if (bbMiddle && nextCandle.low <= bbMiddle) {
        exitPrice = bbMiddle;
        exitTime = nextCandle.timestamp;
        exitReason = 'BB_MIDDLE';
        hitTarget = true;
        break;
      }
    } else {
      // PUT
      if (nextCandle.low <= tpPrice) {
        exitPrice = tpPrice;
        exitTime = nextCandle.timestamp;
        exitReason = 'TP';
        hitTarget = true;
        break;
      }
      // Check for SL hit
      if (nextCandle.high >= slPrice) {
        exitPrice = slPrice;
        exitTime = nextCandle.timestamp;
        exitReason = 'SL';
        hitTarget = true;
        break;
      }
      // Check for BB_Middle hit (smart exit)
      if (bbMiddle && nextCandle.high >= bbMiddle) {
        exitPrice = bbMiddle;
        exitTime = nextCandle.timestamp;
        exitReason = 'BB_MIDDLE';
        hitTarget = true;
        break;
      }
    }
  }

  // If no target hit, close at current price (timeout)
  if (!hitTarget) {
    const lastCandle = candles[currentIndex + maxCandles] || entryCandle;
    exitPrice = lastCandle.close;
    exitTime = lastCandle.timestamp;
  }

  // Calculate profit/loss
  const priceChange = signal.direction === 'CALL'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  const profit = (priceChange / entryPrice) * stake;
  const result: 'WIN' | 'LOSS' = profit > 0 ? 'WIN' : 'LOSS';

  // Update balance
  balance += profit;

  // Track drawdown
  if (balance > peakBalance) {
    peakBalance = balance;
  }
  const drawdown = (peakBalance - balance) / peakBalance;
  if (drawdown > maxDrawdown) {
    maxDrawdown = drawdown;
  }

  // Record equity
  equityCurve.push(balance);
  equityTimestamps.push(exitTime);

  const trade: Trade = {
    id: `${signal.symbol}_${entryCandle.timestamp}_${Date.now()}`,
    asset: signal.symbol,
    direction: signal.direction,
    entryPrice,
    entryTime: entryCandle.timestamp,
    exitPrice,
    exitTime,
    stake,
    profit,
    result,
    exitReason,
    metadata: signal.metadata,
  };

  allTrades.push(trade);

  return trade;
}

/**
 * Run backtest for a single symbol
 */
async function backtestSymbol(
  symbol: string,
  candles: Candle[]
): Promise<BacktestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 BACKTESTING ${symbol}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Candles: ${candles.length}`);
  console.log(`   Period: ${new Date(candles[0].timestamp * 1000).toISOString()} to ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()}`);
  console.log(`   Initial Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Risk per Trade: ${(RISK_PERCENTAGE * 100).toFixed(1)}%`);
  console.log();

  // Initialize strategy
  const strategy = new BBSqueezeStrategy({
    name: 'bb-squeeze-backtest',
    enabled: true,
    assets: [symbol],
    maxConcurrentTrades: 1,
    amount: 100,
    amountType: 'fixed',
    cooldownSeconds: 60,
    minConfidence: 0.7,
    parameters: {
      bbPeriod: 20,
      bbStdDev: 2,
      kcPeriod: 20,
      kcMultiplier: 1.5,
      takeProfitPct: TP_PCT,
      stopLossPct: SL_PCT,
      cooldownSeconds: 60,
      minCandles: 50,
    },
  });

  await strategy.start();

  // Reset state for this symbol
  const symbolTrades: Trade[] = [];
  let symbolBalance = INITIAL_BALANCE;
  balance = INITIAL_BALANCE;
  peakBalance = INITIAL_BALANCE;
  maxDrawdown = 0;

  // Process candles
  let signalCount = 0;
  for (let i = 50; i < candles.length - 30; i++) {
    const candle = candles[i];
    const candleBuffer = candles.slice(0, i + 1);

    // Generate signal
    const context = {
      candles: candleBuffer,
      latestTick: null,
      balance: symbolBalance,
      openPositions: 0,
    };

    const signal = await (strategy as any).onCandle(candle, context);

    if (signal) {
      signalCount++;
      console.log(`\n🎯 Signal #${signalCount}: ${signal.direction} at ${new Date(candle.timestamp * 1000).toISOString()}`);
      console.log(`   Entry Price: ${candle.close.toFixed(2)}`);
      console.log(`   Balance: $${balance.toFixed(2)}`);

      // Simulate trade
      const trade = simulateTrade(signal, candles, i);

      if (trade) {
        symbolTrades.push(trade);
        symbolBalance = balance;

        console.log(`   ${trade.result === 'WIN' ? '✅' : '❌'} ${trade.result}: Exit at ${trade.exitPrice.toFixed(2)} (${trade.exitReason})`);
        console.log(`   P&L: $${trade.profit.toFixed(2)} | New Balance: $${balance.toFixed(2)}`);
      }
    }

    // Progress indicator every 100 candles
    if (i % 100 === 0) {
      const progress = ((i / candles.length) * 100).toFixed(1);
      process.stdout.write(`\r   Progress: ${progress}% | Signals: ${signalCount} | Trades: ${symbolTrades.length}`);
    }
  }

  console.log(`\n\n✅ Backtest complete for ${symbol}`);

  // Calculate metrics
  const wonTrades = symbolTrades.filter(t => t.result === 'WIN').length;
  const lostTrades = symbolTrades.filter(t => t.result === 'LOSS').length;
  const totalProfit = symbolTrades.filter(t => t.result === 'WIN').reduce((sum, t) => sum + t.profit, 0);
  const totalLoss = Math.abs(symbolTrades.filter(t => t.result === 'LOSS').reduce((sum, t) => sum + t.profit, 0));
  const netProfit = symbolBalance - INITIAL_BALANCE;
  const roi = (netProfit / INITIAL_BALANCE) * 100;
  const winRate = symbolTrades.length > 0 ? (wonTrades / symbolTrades.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
  const avgWin = wonTrades > 0 ? totalProfit / wonTrades : 0;
  const avgLoss = lostTrades > 0 ? totalLoss / lostTrades : 0;

  // Calculate Sharpe Ratio (simplified)
  const returns = symbolTrades.map(t => (t.profit / t.stake));
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  return {
    symbol,
    totalTrades: symbolTrades.length,
    wonTrades,
    lostTrades,
    winRate,
    totalProfit,
    totalLoss,
    netProfit,
    roi,
    profitFactor,
    avgWin,
    avgLoss,
    maxDrawdown: maxDrawdown * 100,
    sharpeRatio,
    trades: symbolTrades,
    equity: equityCurve,
    timestamps: equityTimestamps,
  };
}

/**
 * Print backtest results
 */
function printResults(results: BacktestResult[]) {
  console.log('\n' + '='.repeat(80));
  console.log('📈 BACKTEST RESULTS - BB SQUEEZE STRATEGY');
  console.log('='.repeat(80));
  console.log();

  for (const result of results) {
    console.log(`\n🎯 ${result.symbol}`);
    console.log('─'.repeat(80));
    console.log(`   Total Trades:    ${result.totalTrades}`);
    console.log(`   Won Trades:      ${result.wonTrades} (${result.winRate.toFixed(2)}%)`);
    console.log(`   Lost Trades:     ${result.lostTrades}`);
    console.log();
    console.log(`   Total Profit:    $${result.totalProfit.toFixed(2)}`);
    console.log(`   Total Loss:      $${result.totalLoss.toFixed(2)}`);
    console.log(`   Net Profit:      $${result.netProfit.toFixed(2)}`);
    console.log(`   ROI:             ${result.roi.toFixed(2)}%`);
    console.log();
    console.log(`   Profit Factor:   ${result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}`);
    console.log(`   Avg Win:         $${result.avgWin.toFixed(2)}`);
    console.log(`   Avg Loss:        $${result.avgLoss.toFixed(2)}`);
    console.log(`   Risk/Reward:     ${result.avgLoss > 0 ? (result.avgWin / result.avgLoss).toFixed(2) : 'N/A'}`);
    console.log();
    console.log(`   Max Drawdown:    ${result.maxDrawdown.toFixed(2)}%`);
    console.log(`   Sharpe Ratio:    ${result.sharpeRatio.toFixed(2)}`);
    console.log();

    // Exit reason breakdown
    const tpExits = result.trades.filter(t => t.exitReason === 'TP').length;
    const slExits = result.trades.filter(t => t.exitReason === 'SL').length;
    const bbMiddleExits = result.trades.filter(t => t.exitReason === 'BB_MIDDLE').length;

    console.log(`   Exit Reasons:`);
    console.log(`     TP:          ${tpExits} (${((tpExits / result.totalTrades) * 100).toFixed(1)}%)`);
    console.log(`     SL:          ${slExits} (${((slExits / result.totalTrades) * 100).toFixed(1)}%)`);
    console.log(`     BB_Middle:   ${bbMiddleExits} (${((bbMiddleExits / result.totalTrades) * 100).toFixed(1)}%)`);
  }

  // Combined results
  if (results.length > 1) {
    console.log('\n' + '='.repeat(80));
    console.log('🌍 COMBINED RESULTS');
    console.log('='.repeat(80));

    const totalTrades = results.reduce((sum, r) => sum + r.totalTrades, 0);
    const wonTrades = results.reduce((sum, r) => sum + r.wonTrades, 0);
    const lostTrades = results.reduce((sum, r) => sum + r.lostTrades, 0);
    const netProfit = results.reduce((sum, r) => sum + r.netProfit, 0);
    const totalProfit = results.reduce((sum, r) => sum + r.totalProfit, 0);
    const totalLoss = results.reduce((sum, r) => sum + r.totalLoss, 0);
    const avgROI = results.reduce((sum, r) => sum + r.roi, 0) / results.length;
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;

    console.log(`   Total Trades:    ${totalTrades}`);
    console.log(`   Won:             ${wonTrades} (${avgWinRate.toFixed(2)}%)`);
    console.log(`   Lost:            ${lostTrades}`);
    console.log(`   Net Profit:      $${netProfit.toFixed(2)}`);
    console.log(`   Avg ROI:         ${avgROI.toFixed(2)}%`);
    console.log(`   Profit Factor:   ${totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : '∞'}`);
  }

  console.log('\n' + '='.repeat(80));
}

/**
 * Main backtest function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 BB SQUEEZE STRATEGY BACKTESTER');
  console.log('='.repeat(80));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Days: ${DAYS_TO_BACKTEST}`);
  console.log(`   Initial Capital: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Risk per Trade: ${(RISK_PERCENTAGE * 100).toFixed(1)}%`);
  console.log(`   TP: ${(TP_PCT * 100).toFixed(2)}% | SL: ${(SL_PCT * 100).toFixed(2)}%`);
  console.log();

  const results: BacktestResult[] = [];

  // Backtest each symbol
  for (const symbol of SYMBOLS) {
    try {
      console.log(`📥 Loading historical data for ${symbol}...`);

      // Try to load from CSV first
      let candles = loadCandlesFromCSV(symbol);

      // If no CSV, try Gateway
      if (!candles) {
        console.log(`   📡 CSV not found, trying Gateway...`);
        const gatewayClient = new GatewayClient({
          url: process.env.GATEWAY_WS_URL || 'ws://localhost:3000',
          autoReconnect: false,
          enableLogging: false,
        });

        try {
          await gatewayClient.connect();
          const candlesNeeded = DAYS_TO_BACKTEST * 24 * 60;
          candles = await gatewayClient.getCandles(symbol, TIMEFRAME, candlesNeeded);
          await gatewayClient.disconnect();
        } catch (err) {
          console.error(`   ❌ Gateway connection failed`);
          continue;
        }
      }

      if (!candles || candles.length < 100) {
        console.error(`❌ Insufficient data for ${symbol}: ${candles?.length || 0} candles`);
        continue;
      }

      console.log(`✅ Loaded ${candles.length} candles`);

      // Run backtest
      const result = await backtestSymbol(symbol, candles);
      results.push(result);

    } catch (error: any) {
      console.error(`❌ Error backtesting ${symbol}:`, error.message);
    }
  }

  // Print results
  if (results.length > 0) {
    printResults(results);

    // Save results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backtest_bb_squeeze_${timestamp}.json`;
    const fs = await import('fs/promises');
    await fs.writeFile(
      filename,
      JSON.stringify(results, null, 2)
    );
    console.log(`\n💾 Results saved to: ${filename}`);
  } else {
    console.error('\n❌ No results to display');
  }

  console.log('\n✅ Backtest complete');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
