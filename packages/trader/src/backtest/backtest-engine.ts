/**
 * Motor de Backtest Sólido y Testeable
 *
 * Principios:
 * 1. Cálculos determinísticos y verificables
 * 2. Sin efectos secundarios (funciones puras)
 * 3. Separación clara: datos, señales, ejecución, métricas
 * 4. Stake fijo por trade (no compound por defecto)
 */

// =============================================================================
// TYPES
// =============================================================================

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Direction = 'CALL' | 'PUT';
export type TradeResult = 'WIN' | 'LOSS';
export type ExitReason = 'TP' | 'SL' | 'TRAILING_STOP' | 'TIMEOUT';

export interface TradeEntry {
  timestamp: number;
  direction: Direction;
  entryPrice: number;
  stake: number;
  tpPrice: number;
  slPrice: number;
}

export interface Trade extends TradeEntry {
  exitTimestamp: number;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;              // Profit/Loss in $
  pnlPct: number;           // Profit/Loss in %
  result: TradeResult;
  barsHeld: number;
  maxFavorableExcursion: number;  // Best price % reached
  maxAdverseExcursion: number;    // Worst price % reached
}

export interface BacktestConfig {
  initialBalance: number;
  stakeAmount: number;        // Fixed $ stake per trade
  stakePct?: number;          // If set, use % of initial balance (not compound)
  multiplier: number;         // Deriv multiplier
  takeProfitPct: number;      // e.g., 0.005 = 0.5%
  stopLossPct: number;        // e.g., 0.005 = 0.5%
  maxBarsInTrade: number;     // Timeout after N bars
  cooldownBars: number;       // Min bars between trades
  useTrailingStop?: boolean;
  trailingActivationPct?: number; // Activate after reaching this % of TP
  trailingDistancePct?: number;   // Trail distance from peak
}

export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgPnl: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  // Quality metrics
  nearMisses: number;           // Lost but reached >50% of TP
  immediateReversals: number;   // Lost in ≤3 bars
  avgBarsHeld: number;
  expectancy: number;           // Avg $ per trade
  sqn: number;                  // System Quality Number
}

// =============================================================================
// TRADE EXECUTION (Pure function - no side effects)
// =============================================================================

/**
 * Simulate a single trade from entry to exit
 * Returns the completed trade with all metrics
 */
export function executeTrade(
  entry: TradeEntry,
  candles: Candle[],
  config: BacktestConfig,
): Trade | null {
  if (candles.length === 0) return null;

  const { direction, entryPrice, stake, tpPrice, slPrice } = entry;

  let exitPrice = entryPrice;
  let exitTimestamp = candles[0].timestamp;
  let exitReason: ExitReason = 'TIMEOUT';
  let barsHeld = 0;

  // Track excursions
  let maxFavorable = 0;
  let maxAdverse = 0;

  // Trailing stop state
  let trailingActive = false;
  let trailingStopPrice = slPrice;

  for (let i = 0; i < Math.min(candles.length, config.maxBarsInTrade); i++) {
    const candle = candles[i];
    barsHeld = i + 1;

    // Calculate current excursions
    if (direction === 'CALL') {
      const favorablePct = (candle.high - entryPrice) / entryPrice;
      const adversePct = (entryPrice - candle.low) / entryPrice;
      maxFavorable = Math.max(maxFavorable, favorablePct);
      maxAdverse = Math.max(maxAdverse, adversePct);
    } else {
      const favorablePct = (entryPrice - candle.low) / entryPrice;
      const adversePct = (candle.high - entryPrice) / entryPrice;
      maxFavorable = Math.max(maxFavorable, favorablePct);
      maxAdverse = Math.max(maxAdverse, adversePct);
    }

    // Check Trailing Stop activation and execution
    if (config.useTrailingStop && config.trailingActivationPct && config.trailingDistancePct) {
      const currentFavorablePct = direction === 'CALL'
        ? (candle.high - entryPrice) / entryPrice
        : (entryPrice - candle.low) / entryPrice;

      if (!trailingActive && currentFavorablePct >= config.trailingActivationPct) {
        trailingActive = true;
      }

      if (trailingActive) {
        if (direction === 'CALL') {
          const newStop = candle.high * (1 - config.trailingDistancePct);
          trailingStopPrice = Math.max(trailingStopPrice, newStop);

          if (candle.low <= trailingStopPrice) {
            exitPrice = trailingStopPrice;
            exitReason = 'TRAILING_STOP';
            exitTimestamp = candle.timestamp;
            break;
          }
        } else {
          const newStop = candle.low * (1 + config.trailingDistancePct);
          trailingStopPrice = Math.min(trailingStopPrice, newStop);

          if (candle.high >= trailingStopPrice) {
            exitPrice = trailingStopPrice;
            exitReason = 'TRAILING_STOP';
            exitTimestamp = candle.timestamp;
            break;
          }
        }
      }
    }

    // Check TP hit (check this BEFORE SL for same candle - optimistic)
    if (direction === 'CALL' && candle.high >= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'TP';
      exitTimestamp = candle.timestamp;
      break;
    }
    if (direction === 'PUT' && candle.low <= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'TP';
      exitTimestamp = candle.timestamp;
      break;
    }

    // Check SL hit (only if trailing not active)
    if (!trailingActive) {
      if (direction === 'CALL' && candle.low <= slPrice) {
        exitPrice = slPrice;
        exitReason = 'SL';
        exitTimestamp = candle.timestamp;
        break;
      }
      if (direction === 'PUT' && candle.high >= slPrice) {
        exitPrice = slPrice;
        exitReason = 'SL';
        exitTimestamp = candle.timestamp;
        break;
      }
    }

    // Update exit price for timeout case
    exitPrice = candle.close;
    exitTimestamp = candle.timestamp;
  }

  // Calculate P&L
  const priceChangePct = direction === 'CALL'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;

  const pnl = priceChangePct * stake * config.multiplier;
  const result: TradeResult = pnl > 0 ? 'WIN' : 'LOSS';

  return {
    ...entry,
    exitTimestamp,
    exitPrice,
    exitReason,
    pnl,
    pnlPct: priceChangePct * 100,
    result,
    barsHeld,
    maxFavorableExcursion: maxFavorable * 100,
    maxAdverseExcursion: maxAdverse * 100,
  };
}

// =============================================================================
// METRICS CALCULATION (Pure function)
// =============================================================================

/**
 * Calculate all backtest metrics from a list of trades
 */
export function calculateMetrics(
  trades: Trade[],
  config: BacktestConfig,
): BacktestMetrics {
  if (trades.length === 0) {
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

  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = grossProfit - grossLoss;

  // Drawdown calculation
  let peak = config.initialBalance;
  let maxDrawdown = 0;
  let equity = config.initialBalance;

  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const drawdown = peak - equity;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // Consecutive wins/losses
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  for (const trade of trades) {
    if (trade.result === 'WIN') {
      consecutiveWins++;
      consecutiveLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
    } else {
      consecutiveLosses++;
      consecutiveWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    }
  }

  // Near misses: Lost trades that reached >50% of TP
  const tpPct = config.takeProfitPct * 100;
  const nearMisses = losses.filter(t => t.maxFavorableExcursion >= (tpPct * 0.5)).length;

  // Immediate reversals: Lost in ≤3 bars
  const immediateReversals = losses.filter(t => t.barsHeld <= 3).length;

  // Avg bars held
  const avgBarsHeld = trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length;

  // Expectancy
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const winRate = (wins.length / trades.length) * 100;
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  // SQN (System Quality Number)
  const avgPnl = netPnl / trades.length;
  const pnlStdDev = Math.sqrt(
    trades.reduce((sum, t) => sum + Math.pow(t.pnl - avgPnl, 2), 0) / trades.length
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
    maxDrawdownPct: (maxDrawdown / config.initialBalance) * 100,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    nearMisses,
    immediateReversals,
    avgBarsHeld,
    expectancy,
    sqn,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Create a trade entry from signal
 */
export function createTradeEntry(
  timestamp: number,
  direction: Direction,
  price: number,
  config: BacktestConfig,
): TradeEntry {
  const stake = config.stakePct
    ? config.initialBalance * config.stakePct
    : config.stakeAmount;

  const tpPrice = direction === 'CALL'
    ? price * (1 + config.takeProfitPct)
    : price * (1 - config.takeProfitPct);

  const slPrice = direction === 'CALL'
    ? price * (1 - config.stopLossPct)
    : price * (1 + config.stopLossPct);

  return {
    timestamp,
    direction,
    entryPrice: price,
    stake,
    tpPrice,
    slPrice,
  };
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: BacktestMetrics): string {
  const lines = [
    `Trades: ${metrics.totalTrades} (${metrics.wins}W / ${metrics.losses}L)`,
    `Win Rate: ${metrics.winRate.toFixed(1)}%`,
    `Net P&L: $${metrics.netPnl.toFixed(2)}`,
    `Profit Factor: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}`,
    `Avg Win: $${metrics.avgWin.toFixed(2)} | Avg Loss: $${metrics.avgLoss.toFixed(2)}`,
    `Max Drawdown: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPct.toFixed(1)}%)`,
    `Consecutive: ${metrics.maxConsecutiveWins}W / ${metrics.maxConsecutiveLosses}L`,
    `Near Misses: ${metrics.nearMisses} | Immediate Reversals: ${metrics.immediateReversals}`,
    `Avg Bars Held: ${metrics.avgBarsHeld.toFixed(1)}`,
    `Expectancy: $${metrics.expectancy.toFixed(2)} | SQN: ${metrics.sqn.toFixed(2)}`,
  ];
  return lines.join('\n');
}

// =============================================================================
// MONTE CARLO SIMULATION
// =============================================================================

export interface MonteCarloResult {
  simulations: number;
  original: {
    netPnl: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
  };
  distribution: {
    netPnl: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number; stdDev: number };
    maxDrawdown: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
    maxDrawdownPct: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
    finalEquity: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  };
  riskOfRuin: number;          // % of simulations that went bankrupt
  profitProbability: number;   // % of simulations that ended profitable
  confidence95: {
    minProfit: number;
    maxProfit: number;
  };
}

/**
 * Fisher-Yates shuffle (in-place, returns same array)
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] * (upper - index) + sortedArr[upper] * (index - lower);
}

/**
 * Run Monte Carlo simulation on trade results
 *
 * This shuffles the order of trades N times and calculates metrics for each
 * permutation to understand the distribution of possible outcomes.
 *
 * Key insight: The same trades in different orders produce different drawdowns
 * and equity curves. This helps assess if results are robust or luck-dependent.
 */
export function runMonteCarloSimulation(
  trades: Trade[],
  config: BacktestConfig,
  simulations: number = 1000,
  seed?: number,
): MonteCarloResult {
  if (trades.length === 0) {
    return {
      simulations: 0,
      original: { netPnl: 0, maxDrawdown: 0, maxDrawdownPct: 0 },
      distribution: {
        netPnl: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0, stdDev: 0 },
        maxDrawdown: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 },
        maxDrawdownPct: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 },
        finalEquity: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 },
      },
      riskOfRuin: 0,
      profitProbability: 0,
      confidence95: { minProfit: 0, maxProfit: 0 },
    };
  }

  // Seed random for reproducibility if provided
  if (seed !== undefined) {
    // Simple seeded random - not cryptographically secure but fine for simulations
    let s = seed;
    Math.random = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  // Calculate original metrics
  const originalMetrics = calculateMetrics(trades, config);

  // Arrays to store simulation results
  const netPnls: number[] = [];
  const maxDrawdowns: number[] = [];
  const maxDrawdownPcts: number[] = [];
  const finalEquities: number[] = [];
  let bankruptcies = 0;
  let profitable = 0;

  // Extract just the PnL values for shuffling
  const pnls = trades.map(t => t.pnl);

  for (let sim = 0; sim < simulations; sim++) {
    // Shuffle PnLs
    const shuffledPnls = shuffleArray([...pnls]);

    // Calculate equity curve for this permutation
    let equity = config.initialBalance;
    let peak = config.initialBalance;
    let maxDD = 0;
    let wentBankrupt = false;

    for (const pnl of shuffledPnls) {
      equity += pnl;

      // Track bankruptcy (equity <= 0)
      if (equity <= 0) {
        wentBankrupt = true;
        equity = 0;
        break;
      }

      // Track drawdown
      peak = Math.max(peak, equity);
      const dd = peak - equity;
      maxDD = Math.max(maxDD, dd);
    }

    netPnls.push(equity - config.initialBalance);
    maxDrawdowns.push(maxDD);
    maxDrawdownPcts.push((maxDD / config.initialBalance) * 100);
    finalEquities.push(equity);

    if (wentBankrupt) bankruptcies++;
    if (equity > config.initialBalance) profitable++;
  }

  // Sort arrays for percentile calculations
  netPnls.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);
  maxDrawdownPcts.sort((a, b) => a - b);
  finalEquities.sort((a, b) => a - b);

  // Calculate mean and std dev for net PnL
  const meanPnl = netPnls.reduce((a, b) => a + b, 0) / netPnls.length;
  const stdDevPnl = Math.sqrt(
    netPnls.reduce((sum, p) => sum + Math.pow(p - meanPnl, 2), 0) / netPnls.length
  );

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
        mean: meanPnl,
        stdDev: stdDevPnl,
      },
      maxDrawdown: {
        p5: percentile(maxDrawdowns, 5),
        p25: percentile(maxDrawdowns, 25),
        p50: percentile(maxDrawdowns, 50),
        p75: percentile(maxDrawdowns, 75),
        p95: percentile(maxDrawdowns, 95),
        mean: maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length,
      },
      maxDrawdownPct: {
        p5: percentile(maxDrawdownPcts, 5),
        p25: percentile(maxDrawdownPcts, 25),
        p50: percentile(maxDrawdownPcts, 50),
        p75: percentile(maxDrawdownPcts, 75),
        p95: percentile(maxDrawdownPcts, 95),
        mean: maxDrawdownPcts.reduce((a, b) => a + b, 0) / maxDrawdownPcts.length,
      },
      finalEquity: {
        p5: percentile(finalEquities, 5),
        p25: percentile(finalEquities, 25),
        p50: percentile(finalEquities, 50),
        p75: percentile(finalEquities, 75),
        p95: percentile(finalEquities, 95),
        mean: finalEquities.reduce((a, b) => a + b, 0) / finalEquities.length,
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
 * Format Monte Carlo results for display
 */
export function formatMonteCarloResults(mc: MonteCarloResult): string {
  const lines = [
    `Monte Carlo Simulation (${mc.simulations} runs)`,
    '─'.repeat(50),
    '',
    'ORIGINAL RESULTS:',
    `  Net P&L: $${mc.original.netPnl.toFixed(2)}`,
    `  Max Drawdown: $${mc.original.maxDrawdown.toFixed(2)} (${mc.original.maxDrawdownPct.toFixed(1)}%)`,
    '',
    'SIMULATED DISTRIBUTION:',
    '',
    'Net P&L:',
    `  5th percentile:  $${mc.distribution.netPnl.p5.toFixed(2)}`,
    `  25th percentile: $${mc.distribution.netPnl.p25.toFixed(2)}`,
    `  Median (50th):   $${mc.distribution.netPnl.p50.toFixed(2)}`,
    `  75th percentile: $${mc.distribution.netPnl.p75.toFixed(2)}`,
    `  95th percentile: $${mc.distribution.netPnl.p95.toFixed(2)}`,
    `  Mean ± StdDev:   $${mc.distribution.netPnl.mean.toFixed(2)} ± $${mc.distribution.netPnl.stdDev.toFixed(2)}`,
    '',
    'Max Drawdown:',
    `  5th percentile:  $${mc.distribution.maxDrawdown.p5.toFixed(2)} (${mc.distribution.maxDrawdownPct.p5.toFixed(1)}%)`,
    `  Median (50th):   $${mc.distribution.maxDrawdown.p50.toFixed(2)} (${mc.distribution.maxDrawdownPct.p50.toFixed(1)}%)`,
    `  95th percentile: $${mc.distribution.maxDrawdown.p95.toFixed(2)} (${mc.distribution.maxDrawdownPct.p95.toFixed(1)}%)`,
    '',
    'RISK METRICS:',
    `  Probability of Profit: ${mc.profitProbability.toFixed(1)}%`,
    `  Risk of Ruin: ${mc.riskOfRuin.toFixed(2)}%`,
    `  95% Confidence Interval: $${mc.confidence95.minProfit.toFixed(2)} to $${mc.confidence95.maxProfit.toFixed(2)}`,
  ];
  return lines.join('\n');
}

// =============================================================================
// WALK-FORWARD ANALYSIS
// =============================================================================

export interface WalkForwardWindow {
  windowNumber: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainTrades: number;
  testTrades: number;
  trainWinRate: number;
  testWinRate: number;
  trainNetPnl: number;
  testNetPnl: number;
  trainPF: number;
  testPF: number;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  totalTrainTrades: number;
  totalTestTrades: number;
  avgTrainWinRate: number;
  avgTestWinRate: number;
  totalTrainPnl: number;
  totalTestPnl: number;
  avgTrainPF: number;
  avgTestPF: number;
  // Key metrics for overfitting detection
  winRateDegradation: number;      // Train WR - Test WR (lower is better)
  pnlDegradation: number;          // % drop from train to test
  consistencyScore: number;        // % of windows where test is profitable
  robustnessRatio: number;         // Test PnL / Train PnL (closer to 1 is better)
}

/**
 * Run Walk-Forward Analysis
 *
 * Splits data into rolling windows of train/test periods to simulate
 * real-world scenario of periodic re-optimization.
 *
 * @param trades - All trades with timestamps
 * @param config - Backtest config
 * @param windowCount - Number of walk-forward windows (default: 5)
 * @param trainRatio - Ratio of window used for training (default: 0.7 = 70%)
 */
export function runWalkForwardAnalysis(
  trades: Trade[],
  config: BacktestConfig,
  windowCount: number = 5,
  trainRatio: number = 0.7,
): WalkForwardResult {
  if (trades.length < windowCount * 10) {
    return {
      windows: [],
      totalTrainTrades: 0,
      totalTestTrades: 0,
      avgTrainWinRate: 0,
      avgTestWinRate: 0,
      totalTrainPnl: 0,
      totalTestPnl: 0,
      avgTrainPF: 0,
      avgTestPF: 0,
      winRateDegradation: 0,
      pnlDegradation: 0,
      consistencyScore: 0,
      robustnessRatio: 0,
    };
  }

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const tradesPerWindow = Math.floor(sortedTrades.length / windowCount);

  const windows: WalkForwardWindow[] = [];

  for (let i = 0; i < windowCount; i++) {
    const windowStart = i * tradesPerWindow;
    const windowEnd = i === windowCount - 1
      ? sortedTrades.length
      : (i + 1) * tradesPerWindow;

    const windowTrades = sortedTrades.slice(windowStart, windowEnd);
    const trainSize = Math.floor(windowTrades.length * trainRatio);

    const trainTrades = windowTrades.slice(0, trainSize);
    const testTrades = windowTrades.slice(trainSize);

    if (trainTrades.length === 0 || testTrades.length === 0) continue;

    const trainMetrics = calculateMetrics(trainTrades, config);
    const testMetrics = calculateMetrics(testTrades, config);

    windows.push({
      windowNumber: i + 1,
      trainStart: trainTrades[0].timestamp,
      trainEnd: trainTrades[trainTrades.length - 1].timestamp,
      testStart: testTrades[0].timestamp,
      testEnd: testTrades[testTrades.length - 1].timestamp,
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

  // Aggregate metrics
  const totalTrainTrades = windows.reduce((s, w) => s + w.trainTrades, 0);
  const totalTestTrades = windows.reduce((s, w) => s + w.testTrades, 0);
  const totalTrainPnl = windows.reduce((s, w) => s + w.trainNetPnl, 0);
  const totalTestPnl = windows.reduce((s, w) => s + w.testNetPnl, 0);

  const avgTrainWinRate = windows.reduce((s, w) => s + w.trainWinRate, 0) / windows.length;
  const avgTestWinRate = windows.reduce((s, w) => s + w.testWinRate, 0) / windows.length;
  const avgTrainPF = windows.reduce((s, w) => s + w.trainPF, 0) / windows.length;
  const avgTestPF = windows.reduce((s, w) => s + w.testPF, 0) / windows.length;

  // Overfitting detection metrics
  const winRateDegradation = avgTrainWinRate - avgTestWinRate;
  const pnlDegradation = totalTrainPnl > 0
    ? ((totalTrainPnl - totalTestPnl) / totalTrainPnl) * 100
    : 0;
  const profitableWindows = windows.filter(w => w.testNetPnl > 0).length;
  const consistencyScore = (profitableWindows / windows.length) * 100;
  const robustnessRatio = totalTrainPnl > 0 ? totalTestPnl / totalTrainPnl : 0;

  return {
    windows,
    totalTrainTrades,
    totalTestTrades,
    avgTrainWinRate,
    avgTestWinRate,
    totalTrainPnl,
    totalTestPnl,
    avgTrainPF,
    avgTestPF,
    winRateDegradation,
    pnlDegradation,
    consistencyScore,
    robustnessRatio,
  };
}

// =============================================================================
// OUT-OF-SAMPLE TESTING
// =============================================================================

export interface OOSResult {
  inSample: {
    trades: number;
    winRate: number;
    netPnl: number;
    profitFactor: number;
    maxDrawdownPct: number;
  };
  outOfSample: {
    trades: number;
    winRate: number;
    netPnl: number;
    profitFactor: number;
    maxDrawdownPct: number;
  };
  // Overfitting indicators
  winRateDelta: number;          // IS WR - OOS WR
  pnlPerTradeDelta: number;      // IS pnl/trade - OOS pnl/trade
  isOverfit: boolean;            // True if OOS significantly worse
  overfitScore: number;          // 0-100, higher = more overfit
  recommendation: string;
}

/**
 * Run Out-of-Sample Test
 *
 * Splits trades chronologically: first X% for in-sample, rest for out-of-sample.
 * This simulates using historical data to build a strategy and testing on "future" data.
 *
 * @param trades - All trades with timestamps
 * @param config - Backtest config
 * @param inSampleRatio - Ratio for in-sample (default: 0.7 = 70%)
 */
export function runOutOfSampleTest(
  trades: Trade[],
  config: BacktestConfig,
  inSampleRatio: number = 0.7,
): OOSResult {
  if (trades.length < 20) {
    return {
      inSample: { trades: 0, winRate: 0, netPnl: 0, profitFactor: 0, maxDrawdownPct: 0 },
      outOfSample: { trades: 0, winRate: 0, netPnl: 0, profitFactor: 0, maxDrawdownPct: 0 },
      winRateDelta: 0,
      pnlPerTradeDelta: 0,
      isOverfit: false,
      overfitScore: 0,
      recommendation: 'Not enough trades for OOS analysis',
    };
  }

  // Sort by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const splitIndex = Math.floor(sortedTrades.length * inSampleRatio);

  const inSampleTrades = sortedTrades.slice(0, splitIndex);
  const outOfSampleTrades = sortedTrades.slice(splitIndex);

  const isMetrics = calculateMetrics(inSampleTrades, config);
  const oosMetrics = calculateMetrics(outOfSampleTrades, config);

  const winRateDelta = isMetrics.winRate - oosMetrics.winRate;
  const isPnlPerTrade = isMetrics.totalTrades > 0 ? isMetrics.netPnl / isMetrics.totalTrades : 0;
  const oosPnlPerTrade = oosMetrics.totalTrades > 0 ? oosMetrics.netPnl / oosMetrics.totalTrades : 0;
  const pnlPerTradeDelta = isPnlPerTrade - oosPnlPerTrade;

  // Calculate overfit score (0-100)
  // Factors: WR degradation, PnL degradation, PF degradation
  let overfitScore = 0;

  // Win rate degradation (max 30 points)
  if (winRateDelta > 0) {
    overfitScore += Math.min(30, winRateDelta * 3);
  }

  // PnL per trade degradation (max 40 points)
  if (isPnlPerTrade > 0 && oosPnlPerTrade < isPnlPerTrade) {
    const pnlDegradePct = ((isPnlPerTrade - oosPnlPerTrade) / isPnlPerTrade) * 100;
    overfitScore += Math.min(40, pnlDegradePct * 0.8);
  }
  if (oosPnlPerTrade < 0 && isPnlPerTrade > 0) {
    overfitScore += 30; // Big penalty for going from profitable to unprofitable
  }

  // Profit factor degradation (max 30 points)
  const isPF = isMetrics.profitFactor === Infinity ? 10 : isMetrics.profitFactor;
  const oosPF = oosMetrics.profitFactor === Infinity ? 10 : oosMetrics.profitFactor;
  if (isPF > oosPF && isPF > 0) {
    const pfDegradePct = ((isPF - oosPF) / isPF) * 100;
    overfitScore += Math.min(30, pfDegradePct * 0.5);
  }

  overfitScore = Math.min(100, overfitScore);

  // Determine if overfit
  const isOverfit = overfitScore > 40 || (oosMetrics.netPnl < 0 && isMetrics.netPnl > 0);

  // Generate recommendation
  let recommendation: string;
  if (overfitScore < 20 && oosMetrics.netPnl > 0) {
    recommendation = '✅ ROBUSTO: La estrategia funciona bien fuera de muestra';
  } else if (overfitScore < 40 && oosMetrics.netPnl > 0) {
    recommendation = '⚠️ ACEPTABLE: Leve degradación pero sigue rentable';
  } else if (oosMetrics.netPnl > 0) {
    recommendation = '⚠️ PRECAUCIÓN: Alta degradación, posible overfitting';
  } else if (isMetrics.netPnl > 0) {
    recommendation = '❌ OVERFIT: Rentable en IS pero pierde en OOS';
  } else {
    recommendation = '❌ NO VIABLE: No es rentable ni en IS ni en OOS';
  }

  return {
    inSample: {
      trades: isMetrics.totalTrades,
      winRate: isMetrics.winRate,
      netPnl: isMetrics.netPnl,
      profitFactor: isPF,
      maxDrawdownPct: isMetrics.maxDrawdownPct,
    },
    outOfSample: {
      trades: oosMetrics.totalTrades,
      winRate: oosMetrics.winRate,
      netPnl: oosMetrics.netPnl,
      profitFactor: oosPF,
      maxDrawdownPct: oosMetrics.maxDrawdownPct,
    },
    winRateDelta,
    pnlPerTradeDelta,
    isOverfit,
    overfitScore,
    recommendation,
  };
}

// =============================================================================
// SENSITIVITY ANALYSIS
// =============================================================================

export interface SensitivityPoint {
  paramName: string;
  paramValue: number;
  baselineValue: number;
  percentChange: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  pnlChange: number;       // vs baseline
  pnlChangePct: number;    // % change vs baseline
}

export interface SensitivityResult {
  paramName: string;
  baselineValue: number;
  baselinePnl: number;
  points: SensitivityPoint[];
  // Stability metrics
  profitableRange: number;     // % of variations that stay profitable
  avgPnlChange: number;        // Average absolute PnL change
  maxPnlDrop: number;          // Worst case PnL drop
  stabilityScore: number;      // 0-100, higher = more stable
  isPlateau: boolean;          // True if stable across variations
}

/**
 * Helper to run sensitivity analysis on a single parameter
 * Note: This requires a callback that can re-run the strategy with modified params
 */
export function analyzeSensitivityResults(
  paramName: string,
  baselineValue: number,
  baselinePnl: number,
  variationResults: Array<{ value: number; pnl: number; winRate: number; pf: number }>,
): SensitivityResult {
  const points: SensitivityPoint[] = variationResults.map(v => ({
    paramName,
    paramValue: v.value,
    baselineValue,
    percentChange: ((v.value - baselineValue) / baselineValue) * 100,
    winRate: v.winRate,
    netPnl: v.pnl,
    profitFactor: v.pf,
    pnlChange: v.pnl - baselinePnl,
    pnlChangePct: baselinePnl !== 0 ? ((v.pnl - baselinePnl) / Math.abs(baselinePnl)) * 100 : 0,
  }));

  // Calculate stability metrics
  const profitablePoints = points.filter(p => p.netPnl > 0).length;
  const profitableRange = (profitablePoints / points.length) * 100;

  const pnlChanges = points.map(p => Math.abs(p.pnlChange));
  const avgPnlChange = pnlChanges.reduce((a, b) => a + b, 0) / pnlChanges.length;
  const maxPnlDrop = Math.min(...points.map(p => p.pnlChange));

  // Stability score: high if all variations are profitable and PnL doesn't swing much
  let stabilityScore = 0;
  stabilityScore += profitableRange * 0.5; // 50 points for profitability
  stabilityScore += Math.max(0, 30 - (avgPnlChange / Math.abs(baselinePnl)) * 100); // 30 points for low variance
  stabilityScore += maxPnlDrop > -Math.abs(baselinePnl) * 0.3 ? 20 : 0; // 20 points if max drop < 30%

  stabilityScore = Math.min(100, Math.max(0, stabilityScore));

  // Is it a plateau? (stable across variations)
  const isPlateau = profitableRange >= 80 && avgPnlChange < Math.abs(baselinePnl) * 0.2;

  return {
    paramName,
    baselineValue,
    baselinePnl,
    points,
    profitableRange,
    avgPnlChange,
    maxPnlDrop,
    stabilityScore,
    isPlateau,
  };
}
