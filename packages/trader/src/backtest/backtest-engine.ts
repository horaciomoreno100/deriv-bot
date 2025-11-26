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
