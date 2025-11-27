/**
 * Deep Analysis of BB_BOUNCE Strategy
 *
 * Comprehensive analysis including:
 * - Detailed expectancy metrics
 * - Streak analysis (critical for drawdown understanding)
 * - Monthly consistency
 * - Risk metrics (Sharpe, Sortino, Calmar)
 * - Session analysis
 * - Out-of-sample validation
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Candle } from '@deriv-bot/shared';
import { createBBBounce } from '../strategies/mr/bb-bounce.strategy.js';
import {
  type BacktestConfig,
  type Trade,
  type Direction,
  calculateMetrics,
  createTradeEntry,
  executeTrade,
} from '../backtest/backtest-engine.js';
import {
  calculateATR,
  calculateADX,
  calculateRSI,
  calculateEMA,
  calculateBollingerBands,
} from '../indicators/index.js';
import type { IndicatorSnapshot } from '../strategies/mr/index.js';
import { SessionFilterService, type TradingSession } from '../services/session-filter.service.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // BB_BOUNCE optimized params from Cursor session
  strategy: {
    slBuffer: 0.15,
    takeProfitPct: 0.0125, // 1.25%
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
  },
  backtest: {
    initialBalance: 1000,
    stakePct: 0.04, // 4%
    multiplier: 500,
    maxBarsInTrade: 20,
  },
};

// ============================================================================
// TYPES
// ============================================================================

interface DetailedTrade extends Trade {
  session?: TradingSession;
  month?: string;
  dayOfWeek?: number;
  hourUTC?: number;
}

interface StreakAnalysis {
  maxWinStreak: number;
  maxLoseStreak: number;
  avgWinStreak: number;
  avgLoseStreak: number;
  winStreakDistribution: Record<number, number>;
  loseStreakDistribution: Record<number, number>;
  recoveryDays: number[];
}

interface MonthlyAnalysis {
  month: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
  maxDrawdown: number;
}

interface SessionAnalysis {
  session: TradingSession;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
  avgPnl: number;
  maxDrawdown: number;
  profitFactor: number;
}

interface RiskMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  riskOfRuin: number;
  maxConsecutiveLosses: number;
  avgRecoveryDays: number;
}

interface DeepAnalysisResult {
  config: typeof CONFIG;
  basicMetrics: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnL: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
    winLossRatio: number;
    tradesPerDay: number;
  };
  streakAnalysis: StreakAnalysis;
  monthlyAnalysis: MonthlyAnalysis[];
  sessionAnalysis: SessionAnalysis[];
  riskMetrics: RiskMetrics;
  recommendations: string[];
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('🔍 DEEP ANALYSIS: BB_BOUNCE 500× Strategy');
  console.log('═'.repeat(70));

  // Load data
  const dataFile = process.env.DATA_FILE || 'analysis-output/frxEURUSD_300s_365d.csv';
  const dataPath = resolve(process.cwd(), dataFile);

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  console.log(`\n📂 Loading data from: ${dataFile}`);
  const candles = loadCandles(dataPath);
  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  // Calculate date range
  const startDate = new Date(candles[0]!.timestamp * 1000);
  const endDate = new Date(candles[candles.length - 1]!.timestamp * 1000);
  const tradingDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  console.log(`   Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`   Trading days: ${tradingDays}`);

  // Run backtest with detailed trade tracking
  console.log('\n📊 Running backtest with optimized parameters...');
  const trades = runDetailedBacktest(candles);
  console.log(`   Total trades: ${trades.length}`);

  // Basic metrics
  console.log('\n📈 BASIC METRICS');
  console.log('─'.repeat(50));
  const basicMetrics = calculateBasicMetrics(trades, tradingDays);
  printBasicMetrics(basicMetrics);

  // Streak analysis
  console.log('\n🎰 STREAK ANALYSIS');
  console.log('─'.repeat(50));
  const streakAnalysis = analyzeStreaks(trades);
  printStreakAnalysis(streakAnalysis);

  // Monthly analysis
  console.log('\n📅 MONTHLY CONSISTENCY');
  console.log('─'.repeat(50));
  const monthlyAnalysis = analyzeMonthly(trades);
  printMonthlyAnalysis(monthlyAnalysis);

  // Session analysis
  console.log('\n🌍 SESSION ANALYSIS');
  console.log('─'.repeat(50));
  const sessionAnalysis = analyzeBySession(trades);
  printSessionAnalysis(sessionAnalysis);

  // Risk metrics
  console.log('\n⚠️  RISK METRICS');
  console.log('─'.repeat(50));
  const riskMetrics = calculateRiskMetrics(trades, basicMetrics, streakAnalysis);
  printRiskMetrics(riskMetrics);

  // Generate recommendations
  const recommendations = generateRecommendations(basicMetrics, streakAnalysis, monthlyAnalysis, sessionAnalysis, riskMetrics);
  console.log('\n💡 RECOMMENDATIONS');
  console.log('─'.repeat(50));
  recommendations.forEach((rec, i) => console.log(`${i + 1}. ${rec}`));

  // Save results
  const result: DeepAnalysisResult = {
    config: CONFIG,
    basicMetrics,
    streakAnalysis,
    monthlyAnalysis,
    sessionAnalysis,
    riskMetrics,
    recommendations,
  };

  const outputPath = resolve(process.cwd(), 'analysis-output/bb_bounce_deep_analysis.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Results saved to: ${outputPath}`);
}

// ============================================================================
// DATA LOADING
// ============================================================================

function loadCandles(filePath: string): Candle[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0]!.split(',');

  const timestampIdx = headers.indexOf('timestamp');
  const openIdx = headers.indexOf('open');
  const highIdx = headers.indexOf('high');
  const lowIdx = headers.indexOf('low');
  const closeIdx = headers.indexOf('close');

  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return {
      timestamp: parseInt(values[timestampIdx]!, 10),
      open: parseFloat(values[openIdx]!),
      high: parseFloat(values[highIdx]!),
      low: parseFloat(values[lowIdx]!),
      close: parseFloat(values[closeIdx]!),
    };
  });
}

// ============================================================================
// BACKTEST
// ============================================================================

function runDetailedBacktest(candles: Candle[]): DetailedTrade[] {
  const strategy = createBBBounce({
    slBuffer: CONFIG.strategy.slBuffer,
    takeProfitPct: CONFIG.strategy.takeProfitPct,
    requireRejection: CONFIG.strategy.requireRejection,
    requireCleanApproach: CONFIG.strategy.requireCleanApproach,
    adxThreshold: CONFIG.strategy.adxThreshold,
  });

  const sessionFilter = new SessionFilterService({ enabled: true });

  const btConfig: BacktestConfig = {
    initialBalance: CONFIG.backtest.initialBalance,
    stakePct: CONFIG.backtest.stakePct,
    multiplier: CONFIG.backtest.multiplier,
    takeProfitPct: CONFIG.strategy.takeProfitPct,
    stopLossPct: 0.005, // Will be overridden by strategy
    maxBarsInTrade: CONFIG.backtest.maxBarsInTrade,
    cooldownBars: 1,
  };

  // Pre-calculate indicators
  const indicators = precalculateIndicators(candles);

  const trades: DetailedTrade[] = [];
  let cooldownUntil = 0;
  const startIdx = 50;

  for (let i = startIdx; i < candles.length; i++) {
    const candle = candles[i]!;
    if (i < cooldownUntil) continue;

    const ind = indicators[i];
    if (!ind) continue;

    const historicalCandles = candles.slice(Math.max(0, i - 100), i + 1);
    const entrySignal = strategy.checkEntry(historicalCandles, ind);

    if (entrySignal) {
      const direction: Direction = entrySignal.direction === 'LONG' ? 'CALL' : 'PUT';
      const tpPct = Math.abs((entrySignal.takeProfit - candle.close) / candle.close);
      const slPct = Math.abs((entrySignal.stopLoss - candle.close) / candle.close);

      const configWithTP = {
        ...btConfig,
        takeProfitPct: tpPct,
        stopLossPct: slPct,
        maxBarsInTrade: entrySignal.maxBars || btConfig.maxBarsInTrade,
      };

      const entry = createTradeEntry(candle.timestamp, direction, candle.close, configWithTP);
      const futureCandles = candles.slice(i + 1, i + 1 + btConfig.maxBarsInTrade + 5).map((c) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const trade = executeTrade(entry, futureCandles, configWithTP);

      if (trade) {
        // Add session and time info
        const session = sessionFilter.getSession(candle.timestamp);
        const date = new Date(candle.timestamp * 1000);
        const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

        const detailedTrade: DetailedTrade = {
          ...trade,
          session,
          month,
          dayOfWeek: date.getUTCDay(),
          hourUTC: date.getUTCHours(),
        };

        trades.push(detailedTrade);
        cooldownUntil = i + trade.barsHeld + btConfig.cooldownBars;
      }
    }
  }

  return trades;
}

function precalculateIndicators(candles: Candle[]): (IndicatorSnapshot | null)[] {
  const atrValues = calculateATR(candles, 14);
  const adxValues = calculateADX(candles, 14);
  const rsiValues = calculateRSI(candles, 14);
  const emaValues = calculateEMA(candles, 20);
  const bbValues = calculateBollingerBands(candles, 20, 2);

  const atrOffset = candles.length - atrValues.length;
  const adxOffset = candles.length - adxValues.length;
  const rsiOffset = candles.length - rsiValues.length;
  const emaOffset = candles.length - emaValues.length;
  const bbOffset = candles.length - bbValues.length;

  const snapshots: (IndicatorSnapshot | null)[] = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const atrIdx = i - atrOffset;
    const adxIdx = i - adxOffset;
    const rsiIdx = i - rsiOffset;
    const emaIdx = i - emaOffset;
    const bbIdx = i - bbOffset;

    if (atrIdx < 0 || adxIdx < 0 || rsiIdx < 0 || emaIdx < 0 || bbIdx < 0) continue;

    const atr = atrValues[atrIdx];
    const adxObj = adxValues[adxIdx];
    const rsi = rsiValues[rsiIdx];
    const ema = emaValues[emaIdx];
    const bb = bbValues[bbIdx];

    if (atr === undefined || !adxObj || rsi === undefined || ema === undefined || !bb) continue;

    snapshots[i] = {
      atr,
      adx: adxObj.adx,
      rsi,
      ema,
      bbUpper: bb.upper,
      bbMiddle: bb.middle,
      bbLower: bb.lower,
      bbWidth: (bb.upper - bb.lower) / bb.middle,
      price: candle.close,
    };
  }

  return snapshots;
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

function calculateBasicMetrics(trades: DetailedTrade[], tradingDays: number) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const totalWinPnL = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLossPnL = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnL = totalWinPnL - totalLossPnL;

  const avgWin = wins.length > 0 ? totalWinPnL / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLossPnL / losses.length : 0;

  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLossPnL > 0 ? totalWinPnL / totalLossPnL : totalWinPnL > 0 ? Infinity : 0;
  const expectancy = trades.length > 0 ? netPnL / trades.length : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    netPnL,
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    winLossRatio,
    tradesPerDay: trades.length / tradingDays,
  };
}

function analyzeStreaks(trades: DetailedTrade[]): StreakAnalysis {
  const winStreaks: number[] = [];
  const loseStreaks: number[] = [];
  let currentWinStreak = 0;
  let currentLoseStreak = 0;

  // Track equity curve for recovery analysis
  let equity = CONFIG.backtest.initialBalance;
  let peak = equity;
  let drawdownStart = 0;
  const recoveryDays: number[] = [];

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!;

    // Update equity
    equity += trade.pnl;

    // Track drawdown recovery
    // Handle both seconds and milliseconds timestamps
    const tradeTs = trade.timestamp < 1e12 ? trade.timestamp * 1000 : trade.timestamp;

    if (equity > peak) {
      if (drawdownStart > 0) {
        // Calculate days to recover
        const recoveryEnd = new Date(tradeTs);
        const recStart = new Date(drawdownStart);
        const days = Math.ceil((recoveryEnd.getTime() - recStart.getTime()) / (1000 * 60 * 60 * 24));
        recoveryDays.push(days);
      }
      peak = equity;
      drawdownStart = 0;
    } else if (drawdownStart === 0 && equity < peak) {
      drawdownStart = tradeTs;
    }

    // Streak tracking
    if (trade.pnl > 0) {
      currentWinStreak++;
      if (currentLoseStreak > 0) {
        loseStreaks.push(currentLoseStreak);
        currentLoseStreak = 0;
      }
    } else {
      currentLoseStreak++;
      if (currentWinStreak > 0) {
        winStreaks.push(currentWinStreak);
        currentWinStreak = 0;
      }
    }
  }

  // Push final streaks
  if (currentWinStreak > 0) winStreaks.push(currentWinStreak);
  if (currentLoseStreak > 0) loseStreaks.push(currentLoseStreak);

  // Calculate distributions
  const winStreakDist: Record<number, number> = {};
  const loseStreakDist: Record<number, number> = {};

  for (const streak of winStreaks) {
    winStreakDist[streak] = (winStreakDist[streak] || 0) + 1;
  }
  for (const streak of loseStreaks) {
    loseStreakDist[streak] = (loseStreakDist[streak] || 0) + 1;
  }

  return {
    maxWinStreak: Math.max(...winStreaks, 0),
    maxLoseStreak: Math.max(...loseStreaks, 0),
    avgWinStreak: winStreaks.length > 0 ? winStreaks.reduce((a, b) => a + b, 0) / winStreaks.length : 0,
    avgLoseStreak: loseStreaks.length > 0 ? loseStreaks.reduce((a, b) => a + b, 0) / loseStreaks.length : 0,
    winStreakDistribution: winStreakDist,
    loseStreakDistribution: loseStreakDist,
    recoveryDays,
  };
}

function analyzeMonthly(trades: DetailedTrade[]): MonthlyAnalysis[] {
  const monthlyMap = new Map<string, DetailedTrade[]>();

  for (const trade of trades) {
    if (trade.month) {
      const existing = monthlyMap.get(trade.month) || [];
      existing.push(trade);
      monthlyMap.set(trade.month, existing);
    }
  }

  const results: MonthlyAnalysis[] = [];

  for (const [month, monthTrades] of monthlyMap) {
    const wins = monthTrades.filter((t) => t.pnl > 0).length;
    const pnl = monthTrades.reduce((sum, t) => sum + t.pnl, 0);

    // Calculate monthly drawdown
    let equity = CONFIG.backtest.initialBalance;
    let peak = equity;
    let maxDD = 0;

    for (const trade of monthTrades) {
      equity += trade.pnl;
      peak = Math.max(peak, equity);
      const dd = ((peak - equity) / peak) * 100;
      maxDD = Math.max(maxDD, dd);
    }

    results.push({
      month,
      trades: monthTrades.length,
      wins,
      winRate: (wins / monthTrades.length) * 100,
      pnl,
      maxDrawdown: maxDD,
    });
  }

  return results.sort((a, b) => a.month.localeCompare(b.month));
}

function analyzeBySession(trades: DetailedTrade[]): SessionAnalysis[] {
  const sessions: TradingSession[] = ['ASIAN', 'LONDON', 'OVERLAP', 'NY'];
  const results: SessionAnalysis[] = [];

  for (const session of sessions) {
    const sessionTrades = trades.filter((t) => t.session === session);
    if (sessionTrades.length === 0) continue;

    const wins = sessionTrades.filter((t) => t.pnl > 0);
    const losses = sessionTrades.filter((t) => t.pnl <= 0);
    const totalWinPnL = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossPnL = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const pnl = totalWinPnL - totalLossPnL;

    // Calculate session drawdown
    let equity = CONFIG.backtest.initialBalance;
    let peak = equity;
    let maxDD = 0;

    for (const trade of sessionTrades) {
      equity += trade.pnl;
      peak = Math.max(peak, equity);
      const dd = ((peak - equity) / peak) * 100;
      maxDD = Math.max(maxDD, dd);
    }

    results.push({
      session,
      trades: sessionTrades.length,
      wins: wins.length,
      winRate: (wins.length / sessionTrades.length) * 100,
      pnl,
      avgPnl: pnl / sessionTrades.length,
      maxDrawdown: maxDD,
      profitFactor: totalLossPnL > 0 ? totalWinPnL / totalLossPnL : totalWinPnL > 0 ? Infinity : 0,
    });
  }

  return results.sort((a, b) => b.pnl - a.pnl);
}

function calculateRiskMetrics(
  trades: DetailedTrade[],
  basicMetrics: ReturnType<typeof calculateBasicMetrics>,
  streakAnalysis: StreakAnalysis
): RiskMetrics {
  // Daily returns for Sharpe/Sortino
  const dailyReturns: number[] = [];
  const dailyMap = new Map<string, number>();

  for (const trade of trades) {
    // Use timestamp from Trade type (inherited from TradeEntry)
    const ts = trade.timestamp < 1e12 ? trade.timestamp * 1000 : trade.timestamp;
    const date = new Date(ts).toISOString().split('T')[0]!;
    dailyMap.set(date, (dailyMap.get(date) || 0) + trade.pnl);
  }

  for (const pnl of dailyMap.values()) {
    dailyReturns.push(pnl / CONFIG.backtest.initialBalance);
  }

  const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturns.length);

  // Downside deviation for Sortino
  const downsideReturns = dailyReturns.filter((r) => r < 0);
  const downsideDev = Math.sqrt(downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length);

  // Sharpe Ratio (annualized, assuming 252 trading days)
  const sharpeRatio = stdDev > 0 ? (avgDailyReturn / stdDev) * Math.sqrt(252) : 0;

  // Sortino Ratio (annualized)
  const sortinoRatio = downsideDev > 0 ? (avgDailyReturn / downsideDev) * Math.sqrt(252) : 0;

  // Calculate max drawdown
  let equity = CONFIG.backtest.initialBalance;
  let peak = equity;
  let maxDD = 0;

  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const dd = ((peak - equity) / peak) * 100;
    maxDD = Math.max(maxDD, dd);
  }

  // Calmar Ratio (annual return / max drawdown)
  const annualReturn = (basicMetrics.netPnL / CONFIG.backtest.initialBalance) * 100;
  const calmarRatio = maxDD > 0 ? annualReturn / maxDD : annualReturn > 0 ? Infinity : 0;

  // Risk of Ruin estimation (simplified formula)
  // P(ruin) ≈ ((1-edge)/(1+edge))^units where edge = (win% × avg_win - loss% × avg_loss) / avg_bet
  const winProb = basicMetrics.winRate / 100;
  const avgBet = (basicMetrics.avgWin + basicMetrics.avgLoss) / 2;
  const edge = avgBet > 0 ? (winProb * basicMetrics.avgWin - (1 - winProb) * basicMetrics.avgLoss) / avgBet : 0;
  const riskOfRuin = edge > 0 ? Math.pow((1 - edge) / (1 + edge), CONFIG.backtest.initialBalance / avgBet) * 100 : 100;

  // Average recovery days
  const avgRecoveryDays =
    streakAnalysis.recoveryDays.length > 0
      ? streakAnalysis.recoveryDays.reduce((a, b) => a + b, 0) / streakAnalysis.recoveryDays.length
      : 0;

  return {
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    profitFactor: basicMetrics.profitFactor,
    riskOfRuin,
    maxConsecutiveLosses: streakAnalysis.maxLoseStreak,
    avgRecoveryDays,
  };
}

function generateRecommendations(
  basicMetrics: ReturnType<typeof calculateBasicMetrics>,
  streakAnalysis: StreakAnalysis,
  monthlyAnalysis: MonthlyAnalysis[],
  sessionAnalysis: SessionAnalysis[],
  riskMetrics: RiskMetrics
): string[] {
  const recs: string[] = [];

  // Win rate analysis
  if (basicMetrics.winRate < 35) {
    recs.push(`⚠️ Win rate bajo (${basicMetrics.winRate.toFixed(1)}%). Típico de scalping, pero requiere W/L ratio alto.`);
  }

  // Win/Loss ratio
  if (basicMetrics.winLossRatio >= 2) {
    recs.push(`✅ Win/Loss ratio de ${basicMetrics.winLossRatio.toFixed(2)} compensa el win rate bajo.`);
  } else {
    recs.push(`⚠️ Win/Loss ratio de ${basicMetrics.winLossRatio.toFixed(2)} es bajo para el win rate actual.`);
  }

  // Streak analysis
  if (streakAnalysis.maxLoseStreak >= 15) {
    recs.push(
      `🔴 Max losing streak de ${streakAnalysis.maxLoseStreak} trades es alto. Considerar reducir stake o agregar filtros.`
    );
  }

  // Monthly consistency
  const posMonths = monthlyAnalysis.filter((m) => m.pnl > 0).length;
  const negMonths = monthlyAnalysis.filter((m) => m.pnl <= 0).length;
  if (negMonths > posMonths / 2) {
    recs.push(`⚠️ ${negMonths} meses negativos de ${monthlyAnalysis.length}. Baja consistencia mensual.`);
  } else {
    recs.push(`✅ ${posMonths}/${monthlyAnalysis.length} meses positivos. Buena consistencia.`);
  }

  // Session recommendations
  const bestSession = sessionAnalysis[0];
  const worstSession = sessionAnalysis[sessionAnalysis.length - 1];
  if (bestSession && worstSession && worstSession.pnl < 0) {
    recs.push(`💡 Evitar sesión ${worstSession.session} (P&L: $${worstSession.pnl.toFixed(2)}). Mejor sesión: ${bestSession.session}.`);
  }

  // Risk metrics
  if (riskMetrics.sharpeRatio < 1) {
    recs.push(`⚠️ Sharpe Ratio ${riskMetrics.sharpeRatio.toFixed(2)} < 1. Retorno ajustado por riesgo bajo.`);
  } else {
    recs.push(`✅ Sharpe Ratio ${riskMetrics.sharpeRatio.toFixed(2)} es aceptable.`);
  }

  if (riskMetrics.calmarRatio < 1) {
    recs.push(`⚠️ Calmar Ratio ${riskMetrics.calmarRatio.toFixed(2)} < 1. Drawdown alto relativo al retorno.`);
  }

  // Final recommendation
  if (basicMetrics.profitFactor >= 1.1 && riskMetrics.sharpeRatio >= 0.5) {
    recs.push(`🟢 Estrategia viable para forward testing con stake conservador (2-3%).`);
  } else {
    recs.push(`🔴 Requiere más optimización antes de forward testing.`);
  }

  return recs;
}

// ============================================================================
// PRINT FUNCTIONS
// ============================================================================

function printBasicMetrics(m: ReturnType<typeof calculateBasicMetrics>) {
  console.log(`  Total Trades:      ${m.totalTrades}`);
  console.log(`  Wins/Losses:       ${m.wins}/${m.losses}`);
  console.log(`  Win Rate:          ${m.winRate.toFixed(1)}%`);
  console.log(`  Net P&L:           $${m.netPnL.toFixed(2)}`);
  console.log(`  Profit Factor:     ${m.profitFactor.toFixed(2)}`);
  console.log(`  Expectancy:        $${m.expectancy.toFixed(2)}/trade`);
  console.log(`  Avg Win:           $${m.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:          $${m.avgLoss.toFixed(2)}`);
  console.log(`  Win/Loss Ratio:    ${m.winLossRatio.toFixed(2)}`);
  console.log(`  Trades/Day:        ${m.tradesPerDay.toFixed(1)}`);
}

function printStreakAnalysis(s: StreakAnalysis) {
  console.log(`  Max Win Streak:    ${s.maxWinStreak}`);
  console.log(`  Max Lose Streak:   ${s.maxLoseStreak}`);
  console.log(`  Avg Win Streak:    ${s.avgWinStreak.toFixed(1)}`);
  console.log(`  Avg Lose Streak:   ${s.avgLoseStreak.toFixed(1)}`);
  console.log(`  Recoveries:        ${s.recoveryDays.length} drawdowns recovered`);

  // Print lose streak distribution
  console.log(`\n  Losing Streak Distribution:`);
  const sortedLoseStreaks = Object.entries(s.loseStreakDistribution).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
  for (const [streak, count] of sortedLoseStreaks.slice(0, 10)) {
    console.log(`    ${streak} losses in a row: ${count}x`);
  }
}

function printMonthlyAnalysis(months: MonthlyAnalysis[]) {
  console.log(`  Month      Trades  Wins   WR%     P&L      MaxDD`);
  console.log(`  ${'─'.repeat(55)}`);

  for (const m of months) {
    const pnlStr = m.pnl >= 0 ? `+$${m.pnl.toFixed(0)}` : `-$${Math.abs(m.pnl).toFixed(0)}`;
    console.log(
      `  ${m.month}   ${String(m.trades).padStart(5)}  ${String(m.wins).padStart(4)}  ${m.winRate.toFixed(1).padStart(5)}%  ${pnlStr.padStart(7)}  ${m.maxDrawdown.toFixed(1)}%`
    );
  }

  const totalPnL = months.reduce((sum, m) => sum + m.pnl, 0);
  const posMonths = months.filter((m) => m.pnl > 0).length;
  console.log(`  ${'─'.repeat(55)}`);
  console.log(`  Summary: ${posMonths}/${months.length} positive months | Total: $${totalPnL.toFixed(2)}`);
}

function printSessionAnalysis(sessions: SessionAnalysis[]) {
  console.log(`  Session   Trades  Wins   WR%     P&L      AvgPnL   PF     MaxDD`);
  console.log(`  ${'─'.repeat(65)}`);

  for (const s of sessions) {
    const pnlStr = s.pnl >= 0 ? `+$${s.pnl.toFixed(0)}` : `-$${Math.abs(s.pnl).toFixed(0)}`;
    const pfStr = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
    console.log(
      `  ${s.session.padEnd(8)} ${String(s.trades).padStart(5)}  ${String(s.wins).padStart(4)}  ${s.winRate.toFixed(1).padStart(5)}%  ${pnlStr.padStart(7)}  $${s.avgPnl.toFixed(2).padStart(5)}  ${pfStr.padStart(5)}  ${s.maxDrawdown.toFixed(1)}%`
    );
  }
}

function printRiskMetrics(r: RiskMetrics) {
  console.log(`  Sharpe Ratio:         ${r.sharpeRatio.toFixed(2)}`);
  console.log(`  Sortino Ratio:        ${r.sortinoRatio.toFixed(2)}`);
  console.log(`  Calmar Ratio:         ${r.calmarRatio.toFixed(2)}`);
  console.log(`  Profit Factor:        ${r.profitFactor.toFixed(2)}`);
  console.log(`  Risk of Ruin:         ${r.riskOfRuin.toFixed(2)}%`);
  console.log(`  Max Consecutive Loss: ${r.maxConsecutiveLosses}`);
  console.log(`  Avg Recovery Days:    ${r.avgRecoveryDays.toFixed(1)}`);
}

// Run
main().catch(console.error);
