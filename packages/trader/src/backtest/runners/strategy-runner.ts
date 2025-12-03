/**
 * Strategy Runner for Backtest Engine
 *
 * Unified runner that accepts any BacktestableStrategy and produces
 * a complete BacktestResult with full context for visualization.
 */

import type { Candle, IndicatorSnapshot, TradeWithContext } from '@deriv-bot/shared';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestMetrics,
  BacktestableStrategy,
  EntrySignal,
  MonteCarloResult,
  WalkForwardResult,
  OOSResult,
} from '../types.js';
import { DEFAULT_BACKTEST_CONFIG } from '../types.js';
import { createEventCollector, EventCollector } from '../engine/event-collector.js';
import { executeTradeWithContext, createTradeEntry } from '../engine/trade-executor.js';
import { createIndicatorCache, CachedIndicators } from '../data/indicator-cache.js';

/**
 * Options for running a backtest
 */
export interface RunBacktestOptions {
  /** Enable Monte Carlo analysis */
  runMonteCarlo?: boolean;
  monteCarloSimulations?: number;

  /** Enable Walk-Forward analysis */
  runWalkForward?: boolean;
  walkForwardWindows?: number;

  /** Enable Out-of-Sample test */
  runOOS?: boolean;
  oosRatio?: number;

  /** Progress callback */
  onProgress?: (progress: { current: number; total: number; phase: string }) => void;

  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Run a backtest with the given strategy and candles
 */
export function runBacktest(
  strategy: BacktestableStrategy,
  candles: Candle[],
  config?: Partial<BacktestConfig>,
  options?: RunBacktestOptions
): BacktestResult {
  const opts = options ?? {};
  const fullConfig: BacktestConfig = {
    ...DEFAULT_BACKTEST_CONFIG,
    ...strategy.getDefaultConfig?.(),
    ...config,
  };

  // Create event collector
  const collector = createEventCollector(
    fullConfig.asset,
    fullConfig.timeframe,
    strategy.name,
    strategy.version,
    fullConfig
  );

  // Pre-calculate indicators
  if (opts.verbose) {
    console.log(`Pre-calculating indicators for ${candles.length} candles...`);
  }

  const indicatorCache = createIndicatorCache(
    candles,
    strategy.requiredIndicators(),
    fullConfig.indicators ?? {}
  );

  // Reset strategy state before running
  if (strategy.reset) {
    strategy.reset();
  }

  // Pre-calculate MTF data if strategy supports it (optimization)
  if ('preCalculate' in strategy && typeof (strategy as any).preCalculate === 'function') {
    (strategy as any).preCalculate(candles);
  }

  // Run backtest loop
  if (opts.verbose) {
    console.log('Running backtest...');
  }

  const trades = runBacktestLoop(
    strategy,
    candles,
    indicatorCache,
    fullConfig,
    collector,
    opts
  );

  // Calculate metrics
  const metrics = calculateMetricsFromTrades(trades, fullConfig);

  // Run additional analysis if requested
  let monteCarlo: MonteCarloResult | undefined;
  let walkForward: WalkForwardResult | undefined;
  let oosTest: OOSResult | undefined;

  if (opts.runMonteCarlo && trades.length > 0) {
    if (opts.verbose) {
      console.log('Running Monte Carlo simulation...');
    }
    monteCarlo = runMonteCarloAnalysis(
      trades,
      fullConfig,
      opts.monteCarloSimulations ?? 1000
    );
  }

  if (opts.runWalkForward && trades.length > 20) {
    if (opts.verbose) {
      console.log('Running Walk-Forward analysis...');
    }
    walkForward = runWalkForwardAnalysis(
      trades,
      fullConfig,
      opts.walkForwardWindows ?? 5
    );
  }

  if (opts.runOOS && trades.length > 20) {
    if (opts.verbose) {
      console.log('Running Out-of-Sample test...');
    }
    oosTest = runOOSAnalysis(trades, fullConfig, opts.oosRatio ?? 0.7);
  }

  // Build result
  return collector.toBacktestResult(metrics, monteCarlo, walkForward, oosTest);
}

/**
 * Main backtest loop
 */
function runBacktestLoop(
  strategy: BacktestableStrategy,
  candles: Candle[],
  indicatorCache: CachedIndicators,
  config: BacktestConfig,
  collector: EventCollector,
  options: RunBacktestOptions
): TradeWithContext[] {
  const trades: TradeWithContext[] = [];
  let cooldownUntil = 0;
  let inTrade = false;
  let currentTradeExitIndex = 0;

  const total = candles.length;
  const reportInterval = Math.max(1, Math.floor(total / 100));

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const indicators = indicatorCache.getSnapshot(i);

    // Record candle
    collector.onCandle(candle, i, indicators);

    // Progress reporting
    if (options.onProgress && i % reportInterval === 0) {
      options.onProgress({
        current: i,
        total,
        phase: 'backtest',
      });
    }

    // Skip if in cooldown or in trade
    if (i < cooldownUntil || (inTrade && i < currentTradeExitIndex)) {
      continue;
    }

    inTrade = false;

    // Check for entry signal
    const signal = strategy.checkEntry(candles.slice(0, i + 1), indicators, i);

    if (signal) {
      // Record signal
      collector.onSignal(signal);

      // Create trade entry
      const entry = createTradeEntry(signal, config);

      // Get future candles for trade simulation
      const futureCandles = candles.slice(i + 1);
      const futureIndicators: IndicatorSnapshot[] = [];

      for (let j = i + 1; j < candles.length; j++) {
        futureIndicators.push(indicatorCache.getSnapshot(j));
      }

      // Execute trade
      const trade = executeTradeWithContext(
        entry,
        futureCandles,
        futureIndicators,
        config,
        i
      );

      if (trade) {
        // Record trade
        collector.onTradeComplete(trade);
        trades.push(trade);

        // Calculate exit index
        const entryTs = entry.timestamp;
        const exitTs = trade.exit?.snapshot.timestamp ?? entryTs;
        const barsHeld = Math.ceil((exitTs - entryTs * 1000) / (config.timeframe * 1000));

        inTrade = true;
        currentTradeExitIndex = i + barsHeld + 1;
        cooldownUntil = currentTradeExitIndex + config.cooldownBars;
      }
    }
  }

  return trades;
}

/**
 * Calculate metrics from trades
 */
function calculateMetricsFromTrades(
  trades: TradeWithContext[],
  config: BacktestConfig
): BacktestMetrics {
  if (trades.length === 0) {
    return createEmptyMetrics();
  }

  const wins = trades.filter((t) => t.result.outcome === 'WIN');
  const losses = trades.filter((t) => t.result.outcome === 'LOSS');

  const grossProfit = wins.reduce((sum, t) => sum + t.result.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.result.pnl, 0));
  const netPnl = grossProfit - grossLoss;

  // Equity curve and drawdown
  const equityCurve: number[] = [];
  let equity = config.initialBalance;
  let peak = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  for (const trade of trades) {
    equity += trade.result.pnl;
    equityCurve.push(equity);
    peak = Math.max(peak, equity);
    const currentDrawdown = peak - equity;
    const currentDrawdownPct = peak > 0 ? (currentDrawdown / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    maxDrawdownPct = Math.max(maxDrawdownPct, currentDrawdownPct);
  }

  // Consecutive wins/losses
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  for (const trade of trades) {
    if (trade.result.outcome === 'WIN') {
      consecutiveWins++;
      consecutiveLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
    } else {
      consecutiveLosses++;
      consecutiveWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    }
  }

  // Quality metrics
  const tpPct = config.takeProfitPct * 100;
  const nearMisses = losses.filter(
    (t) => t.result.maxFavorablePct >= tpPct * 0.5
  ).length;

  // Calculate bars held from duration
  const avgDurationMs =
    trades.reduce((sum, t) => sum + (t.exit?.durationMs ?? 0), 0) / trades.length;
  const avgBarsHeld = avgDurationMs / (config.timeframe * 1000);

  const immediateReversals = losses.filter((t) => {
    const barsHeld = (t.exit?.durationMs ?? 0) / (config.timeframe * 1000);
    return barsHeld <= 3;
  }).length;

  // Expectancy and SQN
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const winRate = (wins.length / trades.length) * 100;
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  const avgPnl = netPnl / trades.length;
  const pnlStdDev = Math.sqrt(
    trades.reduce((sum, t) => sum + Math.pow(t.result.pnl - avgPnl, 2), 0) /
      trades.length
  );
  const sqn = pnlStdDev > 0 ? (avgPnl / pnlStdDev) * Math.sqrt(trades.length) : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    avgPnl,
    maxDrawdown,
    maxDrawdownPct,  // Now calculated as % of peak, not initial balance
    maxConsecutiveWins,
    maxConsecutiveLosses,
    nearMisses,
    immediateReversals,
    avgBarsHeld,
    expectancy,
    sqn,
    equityCurve,
    peakEquity: peak,
  };
}

/**
 * Create empty metrics
 */
function createEmptyMetrics(): BacktestMetrics {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    netPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 0,
    avgWin: 0,
    avgLoss: 0,
    avgPnl: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    nearMisses: 0,
    immediateReversals: 0,
    avgBarsHeld: 0,
    expectancy: 0,
    sqn: 0,
  };
}

/**
 * Monte Carlo analysis (simplified)
 */
function runMonteCarloAnalysis(
  trades: TradeWithContext[],
  config: BacktestConfig,
  simulations: number
): MonteCarloResult {
  const pnls = trades.map((t) => t.result.pnl);
  const originalMetrics = calculateMetricsFromTrades(trades, config);

  const netPnls: number[] = [];
  const maxDrawdowns: number[] = [];
  let bankruptcies = 0;
  let profitable = 0;

  for (let sim = 0; sim < simulations; sim++) {
    const shuffled = [...pnls].sort(() => Math.random() - 0.5);

    let equity = config.initialBalance;
    let peak = equity;
    let maxDD = 0;
    let bankrupt = false;

    for (const pnl of shuffled) {
      equity += pnl;
      if (equity <= 0) {
        bankrupt = true;
        break;
      }
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, peak - equity);
    }

    netPnls.push(equity - config.initialBalance);
    maxDrawdowns.push(maxDD);

    if (bankrupt) bankruptcies++;
    if (equity > config.initialBalance) profitable++;
  }

  netPnls.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) => {
    const idx = Math.floor((p / 100) * (arr.length - 1));
    return arr[idx] ?? 0;
  };

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stdDev = (arr: number[]) => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / arr.length);
  };

  return {
    simulations,
    original: {
      netPnl: originalMetrics.netPnl,
      maxDrawdown: originalMetrics.maxDrawdown,
      maxDrawdownPct: originalMetrics.maxDrawdownPct,
    },
    distribution: {
      netPnl: {
        p5: percentile(netPnls, 5),
        p25: percentile(netPnls, 25),
        p50: percentile(netPnls, 50),
        p75: percentile(netPnls, 75),
        p95: percentile(netPnls, 95),
        mean: mean(netPnls),
        stdDev: stdDev(netPnls),
      },
      maxDrawdown: {
        p5: percentile(maxDrawdowns, 5),
        p25: percentile(maxDrawdowns, 25),
        p50: percentile(maxDrawdowns, 50),
        p75: percentile(maxDrawdowns, 75),
        p95: percentile(maxDrawdowns, 95),
        mean: mean(maxDrawdowns),
      },
      maxDrawdownPct: {
        p5: (percentile(maxDrawdowns, 5) / config.initialBalance) * 100,
        p25: (percentile(maxDrawdowns, 25) / config.initialBalance) * 100,
        p50: (percentile(maxDrawdowns, 50) / config.initialBalance) * 100,
        p75: (percentile(maxDrawdowns, 75) / config.initialBalance) * 100,
        p95: (percentile(maxDrawdowns, 95) / config.initialBalance) * 100,
        mean: (mean(maxDrawdowns) / config.initialBalance) * 100,
      },
      finalEquity: {
        p5: config.initialBalance + percentile(netPnls, 5),
        p25: config.initialBalance + percentile(netPnls, 25),
        p50: config.initialBalance + percentile(netPnls, 50),
        p75: config.initialBalance + percentile(netPnls, 75),
        p95: config.initialBalance + percentile(netPnls, 95),
        mean: config.initialBalance + mean(netPnls),
      },
    },
    riskOfRuin: (bankruptcies / simulations) * 100,
    profitProbability: (profitable / simulations) * 100,
    confidence95: {
      minProfit: percentile(netPnls, 2.5),
      maxProfit: percentile(netPnls, 97.5),
    },
  };
}

/**
 * Walk-Forward analysis (simplified)
 */
function runWalkForwardAnalysis(
  trades: TradeWithContext[],
  config: BacktestConfig,
  windows: number
): WalkForwardResult {
  const tradesPerWindow = Math.floor(trades.length / windows);
  const windowResults: WalkForwardResult['windows'] = [];

  for (let w = 0; w < windows; w++) {
    const start = w * tradesPerWindow;
    const end = w === windows - 1 ? trades.length : (w + 1) * tradesPerWindow;
    const windowTrades = trades.slice(start, end);

    const trainSize = Math.floor(windowTrades.length * 0.7);
    const trainTrades = windowTrades.slice(0, trainSize);
    const testTrades = windowTrades.slice(trainSize);

    if (trainTrades.length === 0 || testTrades.length === 0) continue;

    const trainMetrics = calculateMetricsFromTrades(trainTrades, config);
    const testMetrics = calculateMetricsFromTrades(testTrades, config);

    windowResults.push({
      windowNumber: w + 1,
      trainStart: trainTrades[0]?.entry.snapshot.timestamp ?? 0,
      trainEnd: trainTrades[trainTrades.length - 1]?.entry.snapshot.timestamp ?? 0,
      testStart: testTrades[0]?.entry.snapshot.timestamp ?? 0,
      testEnd: testTrades[testTrades.length - 1]?.entry.snapshot.timestamp ?? 0,
      trainTrades: trainTrades.length,
      testTrades: testTrades.length,
      trainWinRate: trainMetrics.winRate,
      testWinRate: testMetrics.winRate,
      trainNetPnl: trainMetrics.netPnl,
      testNetPnl: testMetrics.netPnl,
      trainPF: trainMetrics.profitFactor === Infinity ? 10 : trainMetrics.profitFactor,
      testPF: testMetrics.profitFactor === Infinity ? 10 : testMetrics.profitFactor,
    });
  }

  const avgTrainWR = windowResults.reduce((s, w) => s + w.trainWinRate, 0) / windowResults.length;
  const avgTestWR = windowResults.reduce((s, w) => s + w.testWinRate, 0) / windowResults.length;
  const totalTrainPnl = windowResults.reduce((s, w) => s + w.trainNetPnl, 0);
  const totalTestPnl = windowResults.reduce((s, w) => s + w.testNetPnl, 0);

  return {
    windows: windowResults,
    totalTrainTrades: windowResults.reduce((s, w) => s + w.trainTrades, 0),
    totalTestTrades: windowResults.reduce((s, w) => s + w.testTrades, 0),
    avgTrainWinRate: avgTrainWR,
    avgTestWinRate: avgTestWR,
    totalTrainPnl,
    totalTestPnl,
    avgTrainPF: windowResults.reduce((s, w) => s + w.trainPF, 0) / windowResults.length,
    avgTestPF: windowResults.reduce((s, w) => s + w.testPF, 0) / windowResults.length,
    winRateDegradation: avgTrainWR - avgTestWR,
    pnlDegradation: totalTrainPnl > 0 ? ((totalTrainPnl - totalTestPnl) / totalTrainPnl) * 100 : 0,
    consistencyScore: (windowResults.filter((w) => w.testNetPnl > 0).length / windowResults.length) * 100,
    robustnessRatio: totalTrainPnl > 0 ? totalTestPnl / totalTrainPnl : 0,
  };
}

/**
 * Out-of-Sample analysis (simplified)
 */
function runOOSAnalysis(
  trades: TradeWithContext[],
  config: BacktestConfig,
  inSampleRatio: number
): OOSResult {
  const splitIdx = Math.floor(trades.length * inSampleRatio);
  const isTrades = trades.slice(0, splitIdx);
  const oosTrades = trades.slice(splitIdx);

  const isMetrics = calculateMetricsFromTrades(isTrades, config);
  const oosMetrics = calculateMetricsFromTrades(oosTrades, config);

  const winRateDelta = isMetrics.winRate - oosMetrics.winRate;
  const isPnlPerTrade = isTrades.length > 0 ? isMetrics.netPnl / isTrades.length : 0;
  const oosPnlPerTrade = oosTrades.length > 0 ? oosMetrics.netPnl / oosTrades.length : 0;

  let overfitScore = 0;
  if (winRateDelta > 0) overfitScore += Math.min(30, winRateDelta * 3);
  if (isPnlPerTrade > 0 && oosPnlPerTrade < isPnlPerTrade) {
    overfitScore += Math.min(40, ((isPnlPerTrade - oosPnlPerTrade) / isPnlPerTrade) * 80);
  }
  if (oosPnlPerTrade < 0 && isPnlPerTrade > 0) overfitScore += 30;

  const isOverfit = overfitScore > 40 || (oosMetrics.netPnl < 0 && isMetrics.netPnl > 0);

  let recommendation: string;
  if (overfitScore < 20 && oosMetrics.netPnl > 0) {
    recommendation = 'ROBUSTO: La estrategia funciona bien fuera de muestra';
  } else if (overfitScore < 40 && oosMetrics.netPnl > 0) {
    recommendation = 'ACEPTABLE: Leve degradacion pero sigue rentable';
  } else if (oosMetrics.netPnl > 0) {
    recommendation = 'PRECAUCION: Alta degradacion, posible overfitting';
  } else if (isMetrics.netPnl > 0) {
    recommendation = 'OVERFIT: Rentable en IS pero pierde en OOS';
  } else {
    recommendation = 'NO VIABLE: No es rentable ni en IS ni en OOS';
  }

  return {
    inSample: {
      trades: isTrades.length,
      winRate: isMetrics.winRate,
      netPnl: isMetrics.netPnl,
      profitFactor: isMetrics.profitFactor === Infinity ? 10 : isMetrics.profitFactor,
      maxDrawdownPct: isMetrics.maxDrawdownPct,
    },
    outOfSample: {
      trades: oosTrades.length,
      winRate: oosMetrics.winRate,
      netPnl: oosMetrics.netPnl,
      profitFactor: oosMetrics.profitFactor === Infinity ? 10 : oosMetrics.profitFactor,
      maxDrawdownPct: oosMetrics.maxDrawdownPct,
    },
    winRateDelta,
    pnlPerTradeDelta: isPnlPerTrade - oosPnlPerTrade,
    isOverfit,
    overfitScore: Math.min(100, overfitScore),
    recommendation,
  };
}
