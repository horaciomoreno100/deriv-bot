/**
 * Trade Executor for Backtest Engine
 *
 * Executes trades with full context capture for visualization.
 * This is a refactored version of the original executeTrade that
 * produces TradeWithContext instead of simple Trade objects.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Candle, MarketSnapshot, IndicatorSnapshot, TradeWithContext } from '@deriv-bot/shared';
import type {
  BacktestConfig,
  EntrySignal,
  TradeEntry,
  ExitReason,
  Direction,
} from '../types.js';

/**
 * Create a MarketSnapshot from candle and indicators
 */
export function createMarketSnapshot(
  candle: Candle,
  index: number,
  indicators: IndicatorSnapshot
): MarketSnapshot {
  return {
    timestamp: candle.timestamp * 1000, // Convert to ms
    candle: {
      index,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    },
    price: candle.close,
    indicators,
  };
}

/**
 * Create a TradeEntry from an EntrySignal
 */
export function createTradeEntry(
  signal: EntrySignal,
  config: BacktestConfig
): TradeEntry {
  const price = signal.price;
  const stake =
    config.stakeMode === 'percentage'
      ? config.initialBalance * config.stakePct
      : config.stakeAmount;

  // Use strategy-suggested TP/SL or fall back to config
  const tpPct = signal.suggestedTpPct ?? config.takeProfitPct;
  const slPct = signal.suggestedSlPct ?? config.stopLossPct;

  const tpPrice =
    signal.direction === 'CALL' ? price * (1 + tpPct) : price * (1 - tpPct);

  const slPrice =
    signal.direction === 'CALL' ? price * (1 - slPct) : price * (1 + slPct);

  return {
    timestamp: signal.timestamp,
    direction: signal.direction,
    entryPrice: price,
    stake,
    tpPrice,
    slPrice,
    signal,
  };
}

/**
 * Execute a trade and return TradeWithContext with full context
 */
export function executeTradeWithContext(
  entry: TradeEntry,
  futureCandles: Candle[],
  futureIndicators: IndicatorSnapshot[],
  config: BacktestConfig,
  entryIndex: number
): TradeWithContext | null {
  if (futureCandles.length === 0) return null;

  const { direction, entryPrice, stake, tpPrice, slPrice, signal } = entry;

  let exitPrice = entryPrice;
  let exitReason: ExitReason = 'TIMEOUT';
  let exitIndex = 0;
  let barsHeld = 0;

  // Track excursions
  let maxFavorable = 0;
  let maxAdverse = 0;

  // Trailing stop state
  let trailingActive = false;
  let trailingStopPrice = slPrice;

  // Find exit
  for (let i = 0; i < Math.min(futureCandles.length, config.maxBarsInTrade); i++) {
    const candle = futureCandles[i];
    if (!candle) break;

    barsHeld = i + 1;
    exitIndex = i;

    // Calculate excursions
    if (direction === 'CALL') {
      maxFavorable = Math.max(maxFavorable, (candle.high - entryPrice) / entryPrice);
      maxAdverse = Math.max(maxAdverse, (entryPrice - candle.low) / entryPrice);
    } else {
      maxFavorable = Math.max(maxFavorable, (entryPrice - candle.low) / entryPrice);
      maxAdverse = Math.max(maxAdverse, (candle.high - entryPrice) / entryPrice);
    }

    // Check trailing stop
    if (config.useTrailingStop && config.trailingActivationPct && config.trailingDistancePct) {
      const currentFavorable =
        direction === 'CALL'
          ? (candle.high - entryPrice) / entryPrice
          : (entryPrice - candle.low) / entryPrice;

      if (!trailingActive && currentFavorable >= config.trailingActivationPct) {
        trailingActive = true;
      }

      if (trailingActive) {
        if (direction === 'CALL') {
          const newStop = candle.high * (1 - config.trailingDistancePct);
          trailingStopPrice = Math.max(trailingStopPrice, newStop);

          if (candle.low <= trailingStopPrice) {
            exitPrice = trailingStopPrice;
            exitReason = 'TRAILING_STOP';
            break;
          }
        } else {
          const newStop = candle.low * (1 + config.trailingDistancePct);
          trailingStopPrice = Math.min(trailingStopPrice, newStop);

          if (candle.high >= trailingStopPrice) {
            exitPrice = trailingStopPrice;
            exitReason = 'TRAILING_STOP';
            break;
          }
        }
      }
    }

    // Check TP (before SL for same candle - optimistic)
    if (direction === 'CALL' && candle.high >= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'TP';
      break;
    }
    if (direction === 'PUT' && candle.low <= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'TP';
      break;
    }

    // Check SL (only if trailing not active)
    if (!trailingActive) {
      if (direction === 'CALL' && candle.low <= slPrice) {
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
      if (direction === 'PUT' && candle.high >= slPrice) {
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
    }

    // Update for timeout case
    exitPrice = candle.close;
  }

  // Calculate P&L
  const priceChangePct =
    direction === 'CALL'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

  const pnl = priceChangePct * stake * config.multiplier;
  const outcome = pnl > 0 ? 'WIN' : 'LOSS';

  // Get exit candle and indicators
  const exitCandle = futureCandles[exitIndex];
  const exitIndicators = futureIndicators[exitIndex] ?? signal.snapshot.indicators;

  if (!exitCandle) return null;

  // Create exit snapshot
  const exitSnapshot = createMarketSnapshot(
    exitCandle,
    entryIndex + exitIndex + 1,
    exitIndicators
  );

  // Calculate duration
  const durationMs = (exitCandle.timestamp - entry.timestamp) * 1000;

  // Build TradeWithContext
  const trade: TradeWithContext = {
    id: uuidv4(),
    asset: config.asset,
    direction: direction as 'CALL' | 'PUT',
    source: 'backtest',
    correlationId: uuidv4(),
    signal: {
      snapshot: signal.snapshot,
      direction: signal.direction,
      confidence: signal.confidence,
      reason: signal.reason,
      strategyName: signal.strategyName,
      strategyVersion: signal.strategyVersion ?? '1.0.0',
    },
    entry: {
      snapshot: signal.snapshot, // Entry happens at signal candle in backtest
      requestedPrice: entryPrice,
      executedPrice: entryPrice, // No slippage in backtest
      latencyMs: 0,
      slippage: 0,
      slippagePct: 0,
      stake,
      tpPrice,
      slPrice,
      tpPct: config.takeProfitPct,
      slPct: config.stopLossPct,
    },
    exit: {
      snapshot: exitSnapshot,
      reason: exitReason,
      executedPrice: exitPrice,
      durationMs,
    },
    result: {
      pnl,
      pnlPct: priceChangePct * 100,
      outcome,
      maxFavorable: maxFavorable * stake * config.multiplier,
      maxFavorablePct: maxFavorable * 100,
      maxAdverse: maxAdverse * stake * config.multiplier,
      maxAdversePct: maxAdverse * 100,
    },
  };

  return trade;
}

/**
 * Calculate stake based on config
 */
export function calculateStake(config: BacktestConfig): number {
  return config.stakeMode === 'percentage'
    ? config.initialBalance * config.stakePct
    : config.stakeAmount;
}

/**
 * Calculate TP/SL prices
 */
export function calculateTpSlPrices(
  price: number,
  direction: Direction,
  tpPct: number,
  slPct: number
): { tpPrice: number; slPrice: number } {
  const tpPrice = direction === 'CALL' ? price * (1 + tpPct) : price * (1 - tpPct);
  const slPrice = direction === 'CALL' ? price * (1 - slPct) : price * (1 + slPct);
  return { tpPrice, slPrice };
}
