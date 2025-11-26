/**
 * Backtest: Momentum vs Mean Reversion Comparison (COMPREHENSIVE)
 *
 * Complete analysis with professional metrics:
 * - Sharpe Ratio, Sortino Ratio, Calmar Ratio
 * - Max Drawdown with duration
 * - Trade duration analysis
 * - Hourly performance breakdown
 * - Risk-adjusted returns
 *
 * Usage:
 *   ASSET="R_100" DAYS="90" MULT="200" npx tsx src/scripts/backtest-momentum-vs-mr.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from environment
const ASSET = process.env.ASSET || 'R_100';
const DAYS = parseInt(process.env.DAYS || '90', 10);
const MULTIPLIER = parseInt(process.env.MULT || '200', 10);
const STAKE_PCT = parseFloat(process.env.STAKE_PCT || '2') / 100;
const INITIAL_BALANCE = parseFloat(process.env.BALANCE || '1000');

// Strategy Parameters
const BB_PERIOD = 20;
const BB_STD_DEV = 2;
const KC_PERIOD = 20;
const KC_MULTIPLIER = 2.0;
const RSI_PERIOD = 14;

// TP/SL for both strategies
const MOMENTUM_TP = 0.004; // 0.4%
const MOMENTUM_SL = 0.002; // 0.2%
const MR_TP = 0.005;       // 0.5%
const MR_SL = 0.005;       // 0.5%

// RSI Thresholds
const RSI_OVERBOUGHT = 55;
const RSI_OVERSOLD = 45;

// Risk-free rate for Sharpe calculation (annualized)
const RISK_FREE_RATE = 0.05; // 5% annual

interface RawCandle {
  epoch?: number;
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  asset?: string;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  asset: string;
}

interface Trade {
  id: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnl: number;           // $ P&L
  pnlPct: number;        // % return on stake
  returnOnEquity: number; // % return on total equity
  rsiAtEntry: number;
  reason: string;
  durationMinutes: number;
  hourOfDay: number;
  dayOfWeek: number;
  equityBefore: number;
  equityAfter: number;
}

interface DrawdownInfo {
  maxDrawdownPct: number;
  maxDrawdownDollars: number;
  drawdownDurationMinutes: number;
  peakEquity: number;
  troughEquity: number;
  recoveryTime: number | null; // null if not recovered
}

interface HourlyStats {
  hour: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}

interface BacktestResult {
  strategyName: string;
  config: {
    tpPct: number;
    slPct: number;
    multiplier: number;
    stakePct: number;
  };

  // Basic Metrics
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;

  // Return Metrics
  totalPnlDollars: number;
  totalPnlPct: number;        // Simple return
  compoundReturn: number;      // Compound return
  avgPnlPerTrade: number;
  avgWinDollars: number;
  avgLossDollars: number;
  avgWinPct: number;
  avgLossPct: number;

  // Risk Metrics
  profitFactor: number;
  maxConsecutiveLosses: number;
  maxConsecutiveWins: number;

  // Drawdown
  drawdown: DrawdownInfo;

  // Risk-Adjusted Returns (Freqtrade-style)
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  sqn: number;                  // System Quality Number (Van Tharp)
  expectancy: number;           // Expected $ per trade
  expectancyRatio: number;      // Expectancy / Avg Loss
  cagr: number;                 // Compound Annual Growth Rate

  // Trade Duration
  avgTradeDurationMinutes: number;
  minTradeDurationMinutes: number;
  maxTradeDurationMinutes: number;

  // Timeframe Analysis
  hourlyStats: HourlyStats[];
  bestHour: { hour: number; winRate: number; avgPnl: number };
  worstHour: { hour: number; winRate: number; avgPnl: number };

  // Equity Curve
  finalEquity: number;
  trades: Trade[];
  equityCurve: { timestamp: number; equity: number }[];
}

/**
 * Calculate EMA
 */
function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emaArray.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }
  return emaArray;
}

/**
 * Calculate Keltner Channels
 */
function calculateKeltnerChannels(
  candles: Candle[],
  period: number,
  multiplier: number
): { upper: number; middle: number; lower: number }[] {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const ema = calculateEMA(closes, period);
  const atrValues = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
  });

  const kc: { upper: number; middle: number; lower: number }[] = [];
  const offset = closes.length - atrValues.length;

  for (let i = 0; i < atrValues.length; i++) {
    const middle = ema[i + offset];
    const atr = atrValues[i];
    if (middle !== undefined && atr !== undefined) {
      kc.push({
        upper: middle + atr * multiplier,
        middle,
        lower: middle - atr * multiplier,
      });
    }
  }

  return kc;
}

/**
 * Calculate standard deviation
 */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Calculate downside deviation (for Sortino)
 */
function downsideDeviation(returns: number[], targetReturn: number = 0): number {
  const negativeReturns = returns.filter(r => r < targetReturn);
  if (negativeReturns.length === 0) return 0;
  const squaredDiffs = negativeReturns.map(r => Math.pow(r - targetReturn, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / returns.length);
}

/**
 * Simulate trade outcome with TP/SL
 */
function simulateTrade(
  candles: Candle[],
  startIdx: number,
  direction: 'CALL' | 'PUT',
  tpPct: number,
  slPct: number,
  multiplier: number
): { exitPrice: number; exitIdx: number; result: 'WIN' | 'LOSS' | 'BREAKEVEN'; pnlPct: number; reason: string } {
  const entryPrice = candles[startIdx].close;
  const tpPrice = direction === 'CALL'
    ? entryPrice * (1 + tpPct)
    : entryPrice * (1 - tpPct);
  const slPrice = direction === 'CALL'
    ? entryPrice * (1 - slPct)
    : entryPrice * (1 + slPct);

  const maxLookahead = Math.min(60, candles.length - startIdx - 1);

  for (let j = 1; j <= maxLookahead; j++) {
    const candle = candles[startIdx + j];

    if (direction === 'CALL') {
      if (candle.low <= slPrice) {
        const priceDiff = slPrice - entryPrice;
        const pnlPct = (priceDiff / entryPrice) * multiplier;
        return { exitPrice: slPrice, exitIdx: startIdx + j, result: 'LOSS', pnlPct, reason: 'SL' };
      }
      if (candle.high >= tpPrice) {
        const priceDiff = tpPrice - entryPrice;
        const pnlPct = (priceDiff / entryPrice) * multiplier;
        return { exitPrice: tpPrice, exitIdx: startIdx + j, result: 'WIN', pnlPct, reason: 'TP' };
      }
    } else {
      if (candle.high >= slPrice) {
        const priceDiff = entryPrice - slPrice;
        const pnlPct = (priceDiff / entryPrice) * multiplier;
        return { exitPrice: slPrice, exitIdx: startIdx + j, result: 'LOSS', pnlPct, reason: 'SL' };
      }
      if (candle.low <= tpPrice) {
        const priceDiff = entryPrice - tpPrice;
        const pnlPct = (priceDiff / entryPrice) * multiplier;
        return { exitPrice: tpPrice, exitIdx: startIdx + j, result: 'WIN', pnlPct, reason: 'TP' };
      }
    }
  }

  const exitCandle = candles[startIdx + maxLookahead];
  const priceDiff = direction === 'CALL'
    ? exitCandle.close - entryPrice
    : entryPrice - exitCandle.close;
  const pnlPct = (priceDiff / entryPrice) * multiplier;

  return {
    exitPrice: exitCandle.close,
    exitIdx: startIdx + maxLookahead,
    result: pnlPct > 0.001 ? 'WIN' : pnlPct < -0.001 ? 'LOSS' : 'BREAKEVEN',
    pnlPct,
    reason: 'TIMEOUT',
  };
}

/**
 * Run comprehensive backtest
 */
function runBacktest(
  candles: Candle[],
  strategyType: 'MOMENTUM' | 'MEAN_REVERSION'
): BacktestResult {
  const tpPct = strategyType === 'MOMENTUM' ? MOMENTUM_TP : MR_TP;
  const slPct = strategyType === 'MOMENTUM' ? MOMENTUM_SL : MR_SL;

  const closes = candles.map(c => c.close);

  const bbResult = BollingerBands.calculate({
    period: BB_PERIOD,
    values: closes,
    stdDev: BB_STD_DEV,
  });

  const kcResult = calculateKeltnerChannels(candles, KC_PERIOD, KC_MULTIPLIER);

  const rsiResult = RSI.calculate({
    period: RSI_PERIOD,
    values: closes,
  });

  const minLen = Math.min(bbResult.length, kcResult.length, rsiResult.length);
  const offset = candles.length - minLen;

  const trades: Trade[] = [];
  const equityCurve: { timestamp: number; equity: number }[] = [];
  let equity = INITIAL_BALANCE;
  let inSqueeze = false;
  let lastSqueezeIdx = -1;
  let lastTradeIdx = -1;
  const cooldownBars = 5;
  let tradeId = 0;

  equityCurve.push({ timestamp: candles[offset]?.timestamp || 0, equity });

  for (let i = 0; i < minLen; i++) {
    const candleIdx = offset + i;
    const candle = candles[candleIdx];
    const bb = bbResult[i];
    const kc = kcResult[i];
    const rsi = rsiResult[i];

    if (!bb || !kc || rsi === undefined) continue;

    const price = candle.close;

    const bbUpperInsideKC = bb.upper < kc.upper;
    const bbLowerInsideKC = bb.lower > kc.lower;
    const isInSqueeze = bbUpperInsideKC && bbLowerInsideKC;

    if (isInSqueeze && !inSqueeze) {
      lastSqueezeIdx = candleIdx;
    }
    inSqueeze = isInSqueeze;

    const wasRecentlyInSqueeze = lastSqueezeIdx > 0 && (candleIdx - lastSqueezeIdx) < 5;
    if (!wasRecentlyInSqueeze) continue;

    if (lastTradeIdx > 0 && (candleIdx - lastTradeIdx) < cooldownBars) continue;

    const breakoutAbove = price > bb.upper;
    const breakoutBelow = price < bb.lower;

    let signal: 'CALL' | 'PUT' | null = null;

    if (strategyType === 'MOMENTUM') {
      if (breakoutAbove && rsi > RSI_OVERBOUGHT) {
        signal = 'CALL';
      } else if (breakoutBelow && rsi < RSI_OVERSOLD) {
        signal = 'PUT';
      }
    } else {
      if (breakoutBelow && rsi < RSI_OVERSOLD) {
        signal = 'CALL';
      } else if (breakoutAbove && rsi > RSI_OVERBOUGHT) {
        signal = 'PUT';
      }
    }

    if (signal) {
      const tradeResult = simulateTrade(candles, candleIdx, signal, tpPct, slPct, MULTIPLIER);

      const stake = equity * STAKE_PCT;
      const pnlDollars = tradeResult.pnlPct * stake;
      const equityBefore = equity;
      equity += pnlDollars;
      const equityAfter = equity;

      const entryDate = new Date(candle.timestamp);
      const exitDate = new Date(candles[tradeResult.exitIdx].timestamp);
      const durationMinutes = (exitDate.getTime() - entryDate.getTime()) / (1000 * 60);

      trades.push({
        id: ++tradeId,
        direction: signal,
        entryPrice: price,
        entryTime: candle.timestamp,
        exitPrice: tradeResult.exitPrice,
        exitTime: candles[tradeResult.exitIdx].timestamp,
        result: tradeResult.result,
        pnl: pnlDollars,
        pnlPct: tradeResult.pnlPct * 100,
        returnOnEquity: (pnlDollars / equityBefore) * 100,
        rsiAtEntry: rsi,
        reason: tradeResult.reason,
        durationMinutes,
        hourOfDay: entryDate.getUTCHours(),
        dayOfWeek: entryDate.getUTCDay(),
        equityBefore,
        equityAfter,
      });

      equityCurve.push({ timestamp: candles[tradeResult.exitIdx].timestamp, equity });
      lastTradeIdx = candleIdx;
    }
  }

  // Calculate all metrics
  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  const winTrades = trades.filter(t => t.result === 'WIN');
  const lossTrades = trades.filter(t => t.result === 'LOSS');

  const totalPnlDollars = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnlPct = (totalPnlDollars / INITIAL_BALANCE) * 100;
  const compoundReturn = ((equity - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;

  const avgPnlPerTrade = trades.length > 0 ? totalPnlDollars / trades.length : 0;
  const avgWinDollars = winTrades.length > 0 ? winTrades.reduce((s, t) => s + t.pnl, 0) / winTrades.length : 0;
  const avgLossDollars = lossTrades.length > 0 ? lossTrades.reduce((s, t) => s + t.pnl, 0) / lossTrades.length : 0;
  const avgWinPct = winTrades.length > 0 ? winTrades.reduce((s, t) => s + t.pnlPct, 0) / winTrades.length : 0;
  const avgLossPct = lossTrades.length > 0 ? lossTrades.reduce((s, t) => s + t.pnlPct, 0) / lossTrades.length : 0;

  const grossWins = winTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(lossTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Max consecutive
  let maxConsecLosses = 0, maxConsecWins = 0, currentConsecLosses = 0, currentConsecWins = 0;
  for (const trade of trades) {
    if (trade.result === 'LOSS') {
      currentConsecLosses++;
      currentConsecWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, currentConsecLosses);
    } else if (trade.result === 'WIN') {
      currentConsecWins++;
      currentConsecLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, currentConsecWins);
    }
  }

  // Drawdown calculation
  let peak = INITIAL_BALANCE;
  let maxDrawdownPct = 0;
  let maxDrawdownDollars = 0;
  let peakEquity = INITIAL_BALANCE;
  let troughEquity = INITIAL_BALANCE;
  let drawdownStartTime = 0;
  let maxDrawdownDuration = 0;
  let currentEquity = INITIAL_BALANCE;

  for (const trade of trades) {
    currentEquity = trade.equityAfter;
    if (currentEquity > peak) {
      peak = currentEquity;
      drawdownStartTime = trade.exitTime;
    }
    const drawdownPct = (peak - currentEquity) / peak;
    if (drawdownPct > maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      maxDrawdownDollars = peak - currentEquity;
      peakEquity = peak;
      troughEquity = currentEquity;
      maxDrawdownDuration = trade.exitTime - drawdownStartTime;
    }
  }

  const drawdown: DrawdownInfo = {
    maxDrawdownPct: maxDrawdownPct * 100,
    maxDrawdownDollars,
    drawdownDurationMinutes: maxDrawdownDuration / (1000 * 60),
    peakEquity,
    troughEquity,
    recoveryTime: equity >= peakEquity ? maxDrawdownDuration : null,
  };

  // Risk-adjusted returns
  const returns = trades.map(t => t.returnOnEquity / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnStdDev = stdDev(returns);
  const downsideDev = downsideDeviation(returns);

  // Annualize (assuming ~10 trades/day, 365 days)
  const tradesPerYear = (trades.length / DAYS) * 365;
  const annualizedReturn = avgReturn * tradesPerYear;
  const annualizedStdDev = returnStdDev * Math.sqrt(tradesPerYear);
  const annualizedDownsideDev = downsideDev * Math.sqrt(tradesPerYear);

  const sharpeRatio = annualizedStdDev > 0
    ? (annualizedReturn - RISK_FREE_RATE) / annualizedStdDev
    : 0;
  const sortinoRatio = annualizedDownsideDev > 0
    ? (annualizedReturn - RISK_FREE_RATE) / annualizedDownsideDev
    : 0;
  const calmarRatio = maxDrawdownPct > 0
    ? (compoundReturn / 100) / maxDrawdownPct
    : 0;

  // SQN (System Quality Number) - Van Tharp
  // SQN = (Avg R / Std Dev of R) * sqrt(N)
  // Where R = trade return / risk (we use return on equity)
  const sqn = returnStdDev > 0
    ? (avgReturn / returnStdDev) * Math.sqrt(Math.min(trades.length, 100))
    : 0;

  // Expectancy = (Win% * Avg Win) + (Loss% * Avg Loss)
  const winPct = trades.length > 0 ? wins / trades.length : 0;
  const lossPct = trades.length > 0 ? losses / trades.length : 0;
  const expectancy = (winPct * avgWinDollars) + (lossPct * avgLossDollars);

  // Expectancy Ratio = Expectancy / |Avg Loss|
  const expectancyRatio = avgLossDollars !== 0
    ? expectancy / Math.abs(avgLossDollars)
    : 0;

  // CAGR (Compound Annual Growth Rate)
  // CAGR = (Final/Initial)^(365/days) - 1
  const cagr = equity > 0 && INITIAL_BALANCE > 0
    ? (Math.pow(equity / INITIAL_BALANCE, 365 / DAYS) - 1) * 100
    : 0;

  // Trade duration
  const durations = trades.map(t => t.durationMinutes);
  const avgTradeDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const minTradeDuration = durations.length > 0 ? Math.min(...durations) : 0;
  const maxTradeDuration = durations.length > 0 ? Math.max(...durations) : 0;

  // Hourly stats
  const hourlyStats: HourlyStats[] = [];
  for (let h = 0; h < 24; h++) {
    const hourTrades = trades.filter(t => t.hourOfDay === h);
    const hourWins = hourTrades.filter(t => t.result === 'WIN').length;
    const hourLosses = hourTrades.filter(t => t.result === 'LOSS').length;
    const hourPnl = hourTrades.reduce((s, t) => s + t.pnl, 0);
    hourlyStats.push({
      hour: h,
      trades: hourTrades.length,
      wins: hourWins,
      losses: hourLosses,
      winRate: hourTrades.length > 0 ? (hourWins / hourTrades.length) * 100 : 0,
      totalPnl: hourPnl,
      avgPnl: hourTrades.length > 0 ? hourPnl / hourTrades.length : 0,
    });
  }

  const activeHours = hourlyStats.filter(h => h.trades >= 2);
  const bestHour = activeHours.length > 0
    ? activeHours.reduce((best, h) => h.avgPnl > best.avgPnl ? h : best)
    : { hour: 0, winRate: 0, avgPnl: 0 };
  const worstHour = activeHours.length > 0
    ? activeHours.reduce((worst, h) => h.avgPnl < worst.avgPnl ? h : worst)
    : { hour: 0, winRate: 0, avgPnl: 0 };

  return {
    strategyName: strategyType,
    config: { tpPct: tpPct * 100, slPct: slPct * 100, multiplier: MULTIPLIER, stakePct: STAKE_PCT * 100 },
    totalTrades: trades.length,
    wins,
    losses,
    winRate,
    totalPnlDollars,
    totalPnlPct,
    compoundReturn,
    avgPnlPerTrade,
    avgWinDollars,
    avgLossDollars,
    avgWinPct,
    avgLossPct,
    profitFactor,
    maxConsecutiveLosses: maxConsecLosses,
    maxConsecutiveWins: maxConsecWins,
    drawdown,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    sqn,
    expectancy,
    expectancyRatio,
    cagr,
    avgTradeDurationMinutes: avgTradeDuration,
    minTradeDurationMinutes: minTradeDuration,
    maxTradeDurationMinutes: maxTradeDuration,
    hourlyStats,
    bestHour: { hour: bestHour.hour, winRate: bestHour.winRate, avgPnl: bestHour.avgPnl },
    worstHour: { hour: worstHour.hour, winRate: worstHour.winRate, avgPnl: worstHour.avgPnl },
    finalEquity: equity,
    trades,
    equityCurve,
  };
}

/**
 * Print comprehensive results
 */
function printResults(momentum: BacktestResult, mr: BacktestResult): void {
  const fmt = (n: number, decimals: number = 2) => n.toFixed(decimals);
  const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const fmtDollar = (n: number) => (n >= 0 ? '+' : '') + '$' + n.toFixed(2);

  console.log('\n' + '═'.repeat(90));
  console.log('  COMPREHENSIVE BACKTEST: MOMENTUM vs MEAN REVERSION');
  console.log('═'.repeat(90));
  console.log(`  Asset: ${ASSET} | Days: ${DAYS} | Initial: $${INITIAL_BALANCE}`);
  console.log('═'.repeat(90));

  // Config comparison
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                              CONFIGURATION                                          │');
  console.log('├─────────────────────────────┬────────────────────┬──────────────────────────────────┤');
  console.log('│ Parameter                   │ MOMENTUM           │ MEAN REVERSION                   │');
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Take Profit                 │ ${fmt(momentum.config.tpPct)}%              │ ${fmt(mr.config.tpPct)}%                            │`);
  console.log(`│ Stop Loss                   │ ${fmt(momentum.config.slPct)}%              │ ${fmt(mr.config.slPct)}%                            │`);
  console.log(`│ Multiplier                  │ x${momentum.config.multiplier}               │ x${mr.config.multiplier}                             │`);
  console.log(`│ Stake per Trade             │ ${fmt(momentum.config.stakePct)}%              │ ${fmt(mr.config.stakePct)}%                            │`);
  console.log('└─────────────────────────────┴────────────────────┴──────────────────────────────────┘');

  // Performance metrics
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                           PERFORMANCE METRICS                                       │');
  console.log('├─────────────────────────────┬────────────────────┬──────────────────────────────────┤');
  console.log('│ Metric                      │ MOMENTUM           │ MEAN REVERSION                   │');
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Total Trades                │ ${momentum.totalTrades.toString().padStart(18)} │ ${mr.totalTrades.toString().padStart(32)} │`);
  console.log(`│ Wins / Losses               │ ${(momentum.wins + '/' + momentum.losses).padStart(18)} │ ${(mr.wins + '/' + mr.losses).padStart(32)} │`);
  console.log(`│ Win Rate                    │ ${fmt(momentum.winRate, 1).padStart(17)}% │ ${fmt(mr.winRate, 1).padStart(31)}% │`);
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Total P&L ($)               │ ${fmtDollar(momentum.totalPnlDollars).padStart(18)} │ ${fmtDollar(mr.totalPnlDollars).padStart(32)} │`);
  console.log(`│ Compound Return             │ ${fmtPct(momentum.compoundReturn).padStart(18)} │ ${fmtPct(mr.compoundReturn).padStart(32)} │`);
  console.log(`│ Final Equity                │ ${'$' + fmt(momentum.finalEquity).padStart(17)} │ ${'$' + fmt(mr.finalEquity).padStart(31)} │`);
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Avg P&L per Trade           │ ${fmtDollar(momentum.avgPnlPerTrade).padStart(18)} │ ${fmtDollar(mr.avgPnlPerTrade).padStart(32)} │`);
  console.log(`│ Avg Win                     │ ${fmtDollar(momentum.avgWinDollars).padStart(18)} │ ${fmtDollar(mr.avgWinDollars).padStart(32)} │`);
  console.log(`│ Avg Loss                    │ ${fmtDollar(momentum.avgLossDollars).padStart(18)} │ ${fmtDollar(mr.avgLossDollars).padStart(32)} │`);
  console.log('└─────────────────────────────┴────────────────────┴──────────────────────────────────┘');

  // Risk metrics
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                              RISK METRICS                                           │');
  console.log('├─────────────────────────────┬────────────────────┬──────────────────────────────────┤');
  console.log('│ Metric                      │ MOMENTUM           │ MEAN REVERSION                   │');
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Profit Factor               │ ${fmt(momentum.profitFactor).padStart(18)} │ ${fmt(mr.profitFactor).padStart(32)} │`);
  console.log(`│ Max Drawdown (%)            │ ${fmt(momentum.drawdown.maxDrawdownPct, 1).padStart(17)}% │ ${fmt(mr.drawdown.maxDrawdownPct, 1).padStart(31)}% │`);
  console.log(`│ Max Drawdown ($)            │ ${fmtDollar(-momentum.drawdown.maxDrawdownDollars).padStart(18)} │ ${fmtDollar(-mr.drawdown.maxDrawdownDollars).padStart(32)} │`);
  console.log(`│ DD Duration (min)           │ ${fmt(momentum.drawdown.drawdownDurationMinutes, 0).padStart(18)} │ ${fmt(mr.drawdown.drawdownDurationMinutes, 0).padStart(32)} │`);
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Max Consec. Losses          │ ${momentum.maxConsecutiveLosses.toString().padStart(18)} │ ${mr.maxConsecutiveLosses.toString().padStart(32)} │`);
  console.log(`│ Max Consec. Wins            │ ${momentum.maxConsecutiveWins.toString().padStart(18)} │ ${mr.maxConsecutiveWins.toString().padStart(32)} │`);
  console.log('└─────────────────────────────┴────────────────────┴──────────────────────────────────┘');

  // Risk-adjusted returns
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                         RISK-ADJUSTED RETURNS                                       │');
  console.log('├─────────────────────────────┬────────────────────┬──────────────────────────────────┤');
  console.log('│ Ratio                       │ MOMENTUM           │ MEAN REVERSION                   │');
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Sharpe Ratio (annualized)   │ ${fmt(momentum.sharpeRatio).padStart(18)} │ ${fmt(mr.sharpeRatio).padStart(32)} │`);
  console.log(`│ Sortino Ratio (annualized)  │ ${fmt(momentum.sortinoRatio).padStart(18)} │ ${fmt(mr.sortinoRatio).padStart(32)} │`);
  console.log(`│ Calmar Ratio                │ ${fmt(momentum.calmarRatio).padStart(18)} │ ${fmt(mr.calmarRatio).padStart(32)} │`);
  console.log(`│ SQN (System Quality)        │ ${fmt(momentum.sqn).padStart(18)} │ ${fmt(mr.sqn).padStart(32)} │`);
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Expectancy ($/trade)        │ ${fmtDollar(momentum.expectancy).padStart(18)} │ ${fmtDollar(mr.expectancy).padStart(32)} │`);
  console.log(`│ Expectancy Ratio            │ ${fmt(momentum.expectancyRatio).padStart(18)} │ ${fmt(mr.expectancyRatio).padStart(32)} │`);
  console.log(`│ CAGR (Annual %)             │ ${fmtPct(momentum.cagr).padStart(18)} │ ${fmtPct(mr.cagr).padStart(32)} │`);
  console.log('├─────────────────────────────┴────────────────────┴──────────────────────────────────┤');
  console.log('│ Interpretation (Freqtrade-style):                                                   │');
  console.log('│   Sharpe > 1.0 = Good, > 2.0 = Excellent | Sortino > 2.0 = Good                    │');
  console.log('│   Calmar > 1.0 = Good | SQN: 1.6-2.0 Below avg, 2.0-2.5 Avg, 2.5-3.0 Good, >3 Exc. │');
  console.log('│   Expectancy > 0 = Profitable system | Exp. Ratio > 0.1 = Good edge                │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────┘');

  // Trade duration
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                           TRADE DURATION                                            │');
  console.log('├─────────────────────────────┬────────────────────┬──────────────────────────────────┤');
  console.log('│ Duration                    │ MOMENTUM           │ MEAN REVERSION                   │');
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Average (minutes)           │ ${fmt(momentum.avgTradeDurationMinutes, 1).padStart(18)} │ ${fmt(mr.avgTradeDurationMinutes, 1).padStart(32)} │`);
  console.log(`│ Minimum (minutes)           │ ${fmt(momentum.minTradeDurationMinutes, 1).padStart(18)} │ ${fmt(mr.minTradeDurationMinutes, 1).padStart(32)} │`);
  console.log(`│ Maximum (minutes)           │ ${fmt(momentum.maxTradeDurationMinutes, 1).padStart(18)} │ ${fmt(mr.maxTradeDurationMinutes, 1).padStart(32)} │`);
  console.log('└─────────────────────────────┴────────────────────┴──────────────────────────────────┘');

  // Best/Worst hours
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                         HOURLY PERFORMANCE                                          │');
  console.log('├─────────────────────────────┬────────────────────┬──────────────────────────────────┤');
  console.log('│ Hour Analysis               │ MOMENTUM           │ MEAN REVERSION                   │');
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Best Hour (UTC)             │ ${(momentum.bestHour.hour + ':00').padStart(18)} │ ${(mr.bestHour.hour + ':00').padStart(32)} │`);
  console.log(`│   Win Rate                  │ ${fmt(momentum.bestHour.winRate, 1).padStart(17)}% │ ${fmt(mr.bestHour.winRate, 1).padStart(31)}% │`);
  console.log(`│   Avg P&L                   │ ${fmtDollar(momentum.bestHour.avgPnl).padStart(18)} │ ${fmtDollar(mr.bestHour.avgPnl).padStart(32)} │`);
  console.log('├─────────────────────────────┼────────────────────┼──────────────────────────────────┤');
  console.log(`│ Worst Hour (UTC)            │ ${(momentum.worstHour.hour + ':00').padStart(18)} │ ${(mr.worstHour.hour + ':00').padStart(32)} │`);
  console.log(`│   Win Rate                  │ ${fmt(momentum.worstHour.winRate, 1).padStart(17)}% │ ${fmt(mr.worstHour.winRate, 1).padStart(31)}% │`);
  console.log(`│   Avg P&L                   │ ${fmtDollar(momentum.worstHour.avgPnl).padStart(18)} │ ${fmtDollar(mr.worstHour.avgPnl).padStart(32)} │`);
  console.log('└─────────────────────────────┴────────────────────┴──────────────────────────────────┘');

  // Winner determination
  console.log('\n' + '═'.repeat(90));
  const momScore = (momentum.compoundReturn > 0 ? 1 : 0) +
                   (momentum.sharpeRatio > mr.sharpeRatio ? 1 : 0) +
                   (momentum.sortinoRatio > mr.sortinoRatio ? 1 : 0) +
                   (momentum.drawdown.maxDrawdownPct < mr.drawdown.maxDrawdownPct ? 1 : 0);
  const mrScore = (mr.compoundReturn > 0 ? 1 : 0) +
                  (mr.sharpeRatio > momentum.sharpeRatio ? 1 : 0) +
                  (mr.sortinoRatio > momentum.sortinoRatio ? 1 : 0) +
                  (mr.drawdown.maxDrawdownPct < momentum.drawdown.maxDrawdownPct ? 1 : 0);

  if (mrScore > momScore) {
    console.log(`  🏆 WINNER: MEAN REVERSION (Score: ${mrScore} vs ${momScore})`);
    console.log(`     - Compound Return: ${fmtPct(mr.compoundReturn)} vs ${fmtPct(momentum.compoundReturn)}`);
    console.log(`     - Sharpe Ratio: ${fmt(mr.sharpeRatio)} vs ${fmt(momentum.sharpeRatio)}`);
    console.log(`     - Max Drawdown: ${fmt(mr.drawdown.maxDrawdownPct)}% vs ${fmt(momentum.drawdown.maxDrawdownPct)}%`);
  } else if (momScore > mrScore) {
    console.log(`  🏆 WINNER: MOMENTUM (Score: ${momScore} vs ${mrScore})`);
  } else {
    console.log('  🤝 TIE: Both strategies have similar risk-adjusted performance');
  }
  console.log('═'.repeat(90));

  // Monthly projection
  const daysInPeriod = DAYS;
  const momMonthlyReturn = (momentum.compoundReturn / daysInPeriod) * 30;
  const mrMonthlyReturn = (mr.compoundReturn / daysInPeriod) * 30;
  const momYearlyReturn = (momentum.compoundReturn / daysInPeriod) * 365;
  const mrYearlyReturn = (mr.compoundReturn / daysInPeriod) * 365;

  console.log('\n  PROJECTIONS (based on backtest period):');
  console.log('  ───────────────────────────────────────');
  console.log(`  MOMENTUM:     Monthly: ${fmtPct(momMonthlyReturn)} | Yearly: ${fmtPct(momYearlyReturn)}`);
  console.log(`  MEAN REVERSION: Monthly: ${fmtPct(mrMonthlyReturn)} | Yearly: ${fmtPct(mrYearlyReturn)}`);
  console.log('\n  ⚠️  Past performance does not guarantee future results');
  console.log('═'.repeat(90));
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const files = fs.readdirSync(dataDir).filter(f =>
    f.includes(ASSET) && f.endsWith('.json')
  );

  if (files.length === 0) {
    console.error(`\n❌ No data files found for ${ASSET}`);
    process.exit(1);
  }

  const dataFile = files.sort().pop()!;
  console.log(`\nLoading: ${dataFile}`);

  const rawData = JSON.parse(fs.readFileSync(path.join(dataDir, dataFile), 'utf-8'));
  const rawCandles: RawCandle[] = rawData.candles || rawData;

  const candles: Candle[] = rawCandles.map(c => ({
    timestamp: (c.epoch ? c.epoch * 1000 : c.timestamp) || 0,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    asset: c.asset || ASSET,
  }));

  const latestTime = candles[candles.length - 1]?.timestamp || Date.now();
  const cutoffTime = latestTime - DAYS * 24 * 60 * 60 * 1000;
  const filteredCandles = candles.filter(c => c.timestamp >= cutoffTime);

  console.log(`Candles: ${filteredCandles.length} (${DAYS} days)`);

  if (filteredCandles.length < 100) {
    console.error('\n❌ Not enough candles');
    process.exit(1);
  }

  const momentumResult = runBacktest(filteredCandles, 'MOMENTUM');
  const mrResult = runBacktest(filteredCandles, 'MEAN_REVERSION');

  printResults(momentumResult, mrResult);
}

main().catch(console.error);
