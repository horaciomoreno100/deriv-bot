/**
 * Fast Backtester for Optimization
 *
 * Ultra-fast backtesting engine designed for parameter optimization.
 * Pre-calculates all indicators once, uses minimal object creation,
 * and only computes essential metrics.
 *
 * Target: <100ms per config for 130k candles
 *
 * Usage:
 * ```ts
 * const backtester = new FastBacktester(candles, ['rsi', 'atr', 'bb']);
 * const result = backtester.run({
 *   entryFn: (i, indicators) => {
 *     if (indicators.rsi < 20) return { direction: 'CALL', price: candles[i].close };
 *     return null;
 *   },
 *   tpPct: 0.25,
 *   slPct: 0.25,
 *   cooldown: 5,
 * });
 * ```
 */

import type { Candle } from '@deriv-bot/shared';
import type { IndicatorConfig, IndicatorName } from '../types.js';
import { createIndicatorCache, type CachedIndicators } from '../data/indicator-cache.js';
import { DEFAULT_INDICATOR_CONFIG } from '../types.js';

/**
 * Entry signal from strategy function
 */
export interface FastEntrySignal {
  direction: 'CALL' | 'PUT';
  price: number;
}

/**
 * Fast backtest configuration
 */
export interface FastBacktestConfig {
  /** Entry function: (index, indicators) => signal | null */
  entryFn: (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null;
  
  /** Take profit percentage (e.g., 0.25 = 0.25%) */
  tpPct: number;
  
  /** Stop loss percentage (e.g., 0.25 = 0.25%) */
  slPct: number;
  
  /** Cooldown bars between trades */
  cooldown: number;
  
  /** Maximum bars to hold a trade */
  maxBarsInTrade?: number;
  
  /** Initial balance */
  initialBalance?: number;
  
  /** Stake percentage of balance */
  stakePct?: number;
  
  /** Multiplier for binary options */
  multiplier?: number;
  
  /** Start index (for warmup period) */
  startIndex?: number;
  
  /** End index (for testing specific range) */
  endIndex?: number;
  
  /** Exit on Bollinger Middle Band (mean reversion exit) */
  exitOnBBMiddle?: boolean;
  
  /** Exit on Bollinger Upper Band (for CALL trades - take profit early) */
  exitOnBBUpper?: boolean;
  
  /** Exit on Bollinger Lower Band (for PUT trades - take profit early) */
  exitOnBBLower?: boolean;
  
  /** Minimum PnL % to close at BB Upper/Lower (default: 0, close even at loss) */
  bbUpperLowerMinPnl?: number;
  
  /** Exit on VWAP cross (mean reversion exit) */
  exitOnVWAP?: boolean;
  
  /** BB Middle as trailing stop (only exit if price crosses back) */
  bbMiddleTrailingStop?: boolean;
  
  /** Partial take profit: close 50% at BB Middle, 50% at TP */
  partialTP?: {
    enabled: boolean;
    exitAtBBMiddle?: boolean; // Close 50% at BB Middle
    exitAtVWAP?: boolean; // Close 50% at VWAP
  };
  
  /** Time-based stop loss: close if PnL < threshold after N bars */
  zombieKiller?: {
    enabled: boolean;
    bars: number; // Close after N bars if not profitable
    minPnlPct: number; // Minimum PnL to keep trade open (default: 0.05%)
    onlyIfReversing?: boolean; // Only close if price is going against us
  };
}

/**
 * Fast backtest result
 */
export interface FastBacktestResult {
  /** Total trades executed */
  trades: number;
  
  /** Winning trades */
  wins: number;
  
  /** Losing trades */
  losses: number;
  
  /** Win rate percentage */
  winRate: number;
  
  /** Net PnL */
  netPnl: number;
  
  /** Gross profit */
  grossProfit: number;
  
  /** Gross loss */
  grossLoss: number;
  
  /** Profit factor */
  profitFactor: number;
  
  /** Average win */
  avgWin: number;
  
  /** Average loss */
  avgLoss: number;
  
  /** Average PnL per trade */
  avgPnl: number;
  
  /** Maximum drawdown */
  maxDrawdown: number;
  
  /** Maximum drawdown percentage */
  maxDrawdownPct: number;
  
  /** Maximum consecutive wins */
  maxConsecutiveWins: number;
  
  /** Maximum consecutive losses */
  maxConsecutiveLosses: number;
  
  /** Expectancy (expected profit per $1 risked) */
  expectancy: number;
  
  /** Risk:Reward ratio */
  riskRewardRatio: number;
  
  /** Final equity */
  finalEquity: number;
  
  /** Peak equity */
  peakEquity: number;
}

/**
 * Fast Backtester Class
 */
export class FastBacktester {
  private candles: Candle[];
  private indicatorCache: CachedIndicators;
  private requiredIndicators: string[];

  /**
   * Create a new FastBacktester instance
   *
   * @param candles - Array of candles
   * @param requiredIndicators - List of indicator names to pre-calculate
   * @param indicatorConfig - Optional indicator configuration
   */
  constructor(
    candles: Candle[],
    requiredIndicators: string[],
    indicatorConfig?: Partial<IndicatorConfig>
  ) {
    this.candles = candles;
    this.requiredIndicators = requiredIndicators;

    // Pre-calculate all indicators ONCE
    this.indicatorCache = createIndicatorCache(
      candles,
      requiredIndicators,
      indicatorConfig ?? DEFAULT_INDICATOR_CONFIG
    );
  }

  /**
   * Run a fast backtest with the given configuration
   *
   * @param config - Backtest configuration
   * @returns Fast backtest result
   */
  run(config: FastBacktestConfig): FastBacktestResult {
    const {
      entryFn,
      tpPct,
      slPct,
      cooldown,
      maxBarsInTrade = 50,
      initialBalance = 1000,
      stakePct = 0.03,
      multiplier = 100,
      startIndex = 0,
      endIndex = this.candles.length,
    } = config;

    // State variables
    let equity = initialBalance;
    let peak = initialBalance;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let cooldownUntil = startIndex;
    let inTrade = false;
    let currentTradeExitIndex = 0;

    // Trade tracking
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;

    // Main loop - NO slices, NO object creation
    for (let i = startIndex; i < endIndex; i++) {
      // Skip if in cooldown or in trade
      if (i < cooldownUntil || (inTrade && i < currentTradeExitIndex)) {
        continue;
      }

      inTrade = false;

      // Get indicators at current index (pre-calculated)
      const indicators = this.indicatorCache.getSnapshot(i);
      
      // Convert to simple record for entry function
      const indicatorRecord: Record<string, number | boolean> = {};
      for (const [key, value] of Object.entries(indicators)) {
        indicatorRecord[key] = value as number | boolean;
      }

      // Check for entry signal
      const signal = entryFn(i, indicatorRecord);
      
      if (!signal) {
        continue;
      }

      // Enter trade - use signal price if provided, otherwise use candle close
      const entryPrice = signal.price > 0 ? signal.price : this.candles[i]!.close;
      const stake = equity * stakePct;
      const tpPrice = signal.direction === 'CALL'
        ? entryPrice * (1 + tpPct / 100)
        : entryPrice * (1 - tpPct / 100);
      const slPrice = signal.direction === 'CALL'
        ? entryPrice * (1 - slPct / 100)
        : entryPrice * (1 + slPct / 100);

      // Simulate trade exit - iterate forward WITHOUT creating slices
      let exitPrice = entryPrice;
      let outcome: 'WIN' | 'LOSS' = 'LOSS';
      let exitIndex = i;
      let exitReason: 'TP' | 'SL' | 'BB_MIDDLE' | 'VWAP' | 'ZOMBIE' | 'TIMEOUT' = 'TIMEOUT';
      
      // For partial TP tracking
      let partialTPClosed = false;
      let partialTPPrice = entryPrice;
      let partialTPStake = stake * 0.5; // 50% for partial
      let remainingStake = stake * 0.5; // 50% remaining
      
      // For trailing stop tracking
      let highestPrice = entryPrice; // For LONG
      let lowestPrice = entryPrice; // For SHORT
      let bbMiddleTouched = false; // Track if BB Middle was touched

      for (let j = i + 1; j < Math.min(i + maxBarsInTrade + 1, endIndex); j++) {
        const candle = this.candles[j]!;
        const barsHeld = j - i;
        
        // Get indicators for exit conditions
        const exitIndicators = this.indicatorCache.getSnapshot(j);
        const bbUpper = exitIndicators.bbUpper as number | undefined;
        const bbMiddle = exitIndicators.bbMiddle as number | undefined;
        const bbLower = exitIndicators.bbLower as number | undefined;
        const vwap = exitIndicators.vwap as number | undefined;
        const currentPrice = candle.close;
        
        // Update highest/lowest for trailing stop
        if (signal.direction === 'CALL') {
          highestPrice = Math.max(highestPrice, candle.high);
        } else {
          lowestPrice = Math.min(lowestPrice, candle.low);
        }

        if (signal.direction === 'CALL') {
          // Long position
          
          // 1. Stop Loss (check first)
          if (candle.low <= slPrice) {
            exitPrice = slPrice;
            outcome = 'LOSS';
            exitIndex = j;
            exitReason = 'SL';
            break;
          }
          
          // 2a. Exit on BB Upper (for CALL trades - take profit early)
          if (config.exitOnBBUpper && typeof bbUpper === 'number') {
            if (candle.high >= bbUpper) {
              const exitPriceAtBB = Math.min(candle.high, bbUpper);
              const pnlAtBB = ((exitPriceAtBB - entryPrice) / entryPrice) * 100;
              const minPnl = config.bbUpperLowerMinPnl ?? 0;
              
              // Only close if PnL meets minimum threshold
              if (pnlAtBB >= minPnl) {
                exitPrice = exitPriceAtBB;
                outcome = pnlAtBB > 0 ? 'WIN' : 'LOSS';
                exitIndex = j;
                exitReason = 'BB_UPPER';
                break;
              }
            }
          }
          
          // 2b. Partial TP at BB Middle (close 50%, let 50% run)
          if (config.partialTP?.enabled && config.partialTP.exitAtBBMiddle && !partialTPClosed && typeof bbMiddle === 'number') {
            if (candle.high >= bbMiddle && entryPrice < bbMiddle) {
              // Close 50% at BB Middle
              partialTPClosed = true;
              partialTPPrice = Math.min(candle.high, bbMiddle);
              // Continue with remaining 50%
            }
          }
          
          // 2c. BB Middle as trailing stop (only exit if price crosses back below)
          if (config.bbMiddleTrailingStop && typeof bbMiddle === 'number') {
            if (candle.high >= bbMiddle && entryPrice < bbMiddle) {
              bbMiddleTouched = true;
            }
            // If we touched BB Middle and now price goes back below, exit
            if (bbMiddleTouched && candle.low < bbMiddle) {
              exitPrice = bbMiddle;
              outcome = 'WIN';
              exitIndex = j;
              exitReason = 'BB_MIDDLE';
              break;
            }
          }
          
          // 2d. Exit on BB Middle (mean reversion exit) - original
          if (config.exitOnBBMiddle && !config.bbMiddleTrailingStop && typeof bbMiddle === 'number') {
            if (candle.high >= bbMiddle && entryPrice < bbMiddle) {
              // Price touched or crossed BB Middle
              exitPrice = Math.min(candle.high, bbMiddle);
              outcome = 'WIN';
              exitIndex = j;
              exitReason = 'BB_MIDDLE';
              break;
            }
          }
          
          // 3. Exit on VWAP cross
          if (config.exitOnVWAP && typeof vwap === 'number') {
            if (candle.high >= vwap && entryPrice < vwap) {
              // Price crossed above VWAP
              exitPrice = Math.min(candle.high, vwap);
              outcome = 'WIN';
              exitIndex = j;
              exitReason = 'VWAP';
              break;
            }
          }
          
          // 4. Take Profit
          if (candle.high >= tpPrice) {
            exitPrice = tpPrice;
            outcome = 'WIN';
            exitIndex = j;
            exitReason = 'TP';
            break;
          }
          
          // 5. Zombie Killer (time-based stop)
          if (config.zombieKiller?.enabled && barsHeld >= config.zombieKiller.bars) {
            const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
            const prevCandle = j > i + 1 ? this.candles[j - 1] : null;
            const isReversing = config.zombieKiller.onlyIfReversing && prevCandle
              ? (signal.direction === 'CALL' ? currentPrice < prevCandle.close : currentPrice > prevCandle.close)
              : true;
            
            if (pnlPct < config.zombieKiller.minPnlPct && (!config.zombieKiller.onlyIfReversing || isReversing)) {
              exitPrice = currentPrice;
              outcome = pnlPct >= 0 ? 'WIN' : 'LOSS';
              exitIndex = j;
              exitReason = 'ZOMBIE';
              break;
            }
          }
        } else {
          // Short position
          
          // 1. Stop Loss (check first)
          if (candle.high >= slPrice) {
            exitPrice = slPrice;
            outcome = 'LOSS';
            exitIndex = j;
            exitReason = 'SL';
            break;
          }
          
          // 2a. Exit on BB Lower (for PUT trades - take profit early)
          if (config.exitOnBBLower && typeof bbLower === 'number') {
            if (candle.low <= bbLower) {
              const exitPriceAtBB = Math.max(candle.low, bbLower);
              const pnlAtBB = ((entryPrice - exitPriceAtBB) / entryPrice) * 100;
              const minPnl = config.bbUpperLowerMinPnl ?? 0;
              
              // Only close if PnL meets minimum threshold
              if (pnlAtBB >= minPnl) {
                exitPrice = exitPriceAtBB;
                outcome = pnlAtBB > 0 ? 'WIN' : 'LOSS';
                exitIndex = j;
                exitReason = 'BB_LOWER';
                break;
              }
            }
          }
          
          // 2b. Partial TP at BB Middle (close 50%, let 50% run)
          if (config.partialTP?.enabled && config.partialTP.exitAtBBMiddle && !partialTPClosed && typeof bbMiddle === 'number') {
            if (candle.low <= bbMiddle && entryPrice > bbMiddle) {
              // Close 50% at BB Middle
              partialTPClosed = true;
              partialTPPrice = Math.max(candle.low, bbMiddle);
              // Continue with remaining 50%
            }
          }
          
          // 2c. BB Middle as trailing stop (only exit if price crosses back above)
          if (config.bbMiddleTrailingStop && typeof bbMiddle === 'number') {
            if (candle.low <= bbMiddle && entryPrice > bbMiddle) {
              bbMiddleTouched = true;
            }
            // If we touched BB Middle and now price goes back above, exit
            if (bbMiddleTouched && candle.high > bbMiddle) {
              exitPrice = bbMiddle;
              outcome = 'WIN';
              exitIndex = j;
              exitReason = 'BB_MIDDLE';
              break;
            }
          }
          
          // 2d. Exit on BB Middle (mean reversion exit) - original
          if (config.exitOnBBMiddle && !config.bbMiddleTrailingStop && typeof bbMiddle === 'number') {
            if (candle.low <= bbMiddle && entryPrice > bbMiddle) {
              // Price touched or crossed BB Middle
              exitPrice = Math.max(candle.low, bbMiddle);
              outcome = 'WIN';
              exitIndex = j;
              exitReason = 'BB_MIDDLE';
              break;
            }
          }
          
          // 3. Exit on VWAP cross
          if (config.exitOnVWAP && typeof vwap === 'number') {
            if (candle.low <= vwap && entryPrice > vwap) {
              // Price crossed below VWAP
              exitPrice = Math.max(candle.low, vwap);
              outcome = 'WIN';
              exitIndex = j;
              exitReason = 'VWAP';
              break;
            }
          }
          
          // 4. Take Profit
          if (candle.low <= tpPrice) {
            exitPrice = tpPrice;
            outcome = 'WIN';
            exitIndex = j;
            exitReason = 'TP';
            break;
          }
          
          // 5. Zombie Killer (time-based stop)
          if (config.zombieKiller?.enabled && barsHeld >= config.zombieKiller.bars) {
            const pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
            const prevCandle = j > i + 1 ? this.candles[j - 1] : null;
            const isReversing = config.zombieKiller.onlyIfReversing && prevCandle
              ? (signal.direction === 'PUT' ? currentPrice > prevCandle.close : currentPrice < prevCandle.close)
              : true;
            
            if (pnlPct < config.zombieKiller.minPnlPct && (!config.zombieKiller.onlyIfReversing || isReversing)) {
              exitPrice = currentPrice;
              outcome = pnlPct >= 0 ? 'WIN' : 'LOSS';
              exitIndex = j;
              exitReason = 'ZOMBIE';
              break;
            }
          }
        }
      }

      // If no exit, use last candle close
      if (exitIndex === i) {
        exitIndex = Math.min(i + maxBarsInTrade, endIndex - 1);
        exitPrice = this.candles[exitIndex]!.close;
        // Determine outcome based on final price
        if (signal.direction === 'CALL') {
          outcome = exitPrice >= entryPrice ? 'WIN' : 'LOSS';
        } else {
          outcome = exitPrice <= entryPrice ? 'WIN' : 'LOSS';
        }
      }

      // Calculate PnL (with partial TP if applicable)
      let pnl = 0;
      
      if (partialTPClosed) {
        // Calculate PnL for partial TP (50% closed at BB Middle)
        const partialPriceDiff = signal.direction === 'CALL'
          ? (partialTPPrice - entryPrice) / entryPrice
          : (entryPrice - partialTPPrice) / entryPrice;
        const partialPnl = partialTPStake * multiplier * partialPriceDiff;
        
        // Calculate PnL for remaining 50% (closed at exitPrice)
        const remainingPriceDiff = signal.direction === 'CALL'
          ? (exitPrice - entryPrice) / entryPrice
          : (entryPrice - exitPrice) / entryPrice;
        const remainingPnl = remainingStake * multiplier * remainingPriceDiff;
        
        pnl = partialPnl + remainingPnl;
      } else {
        // Normal PnL calculation
        const priceDiff = signal.direction === 'CALL'
          ? (exitPrice - entryPrice) / entryPrice
          : (entryPrice - exitPrice) / entryPrice;
        pnl = stake * multiplier * priceDiff;
      }

      // Update statistics
      trades++;
      equity += pnl;

      if (outcome === 'WIN') {
        wins++;
        grossProfit += pnl;
        consecutiveWins++;
        consecutiveLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
      } else {
        losses++;
        grossLoss += Math.abs(pnl);
        consecutiveLosses++;
        consecutiveWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
      }

      // Track drawdown
      if (equity > peak) {
        peak = equity;
      }
      const currentDrawdown = peak - equity;
      const currentDrawdownPct = peak > 0 ? (currentDrawdown / peak) * 100 : 0;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }
      if (currentDrawdownPct > maxDrawdownPct) {
        maxDrawdownPct = currentDrawdownPct;
      }

      // Set cooldown
      inTrade = true;
      currentTradeExitIndex = exitIndex + 1;
      cooldownUntil = exitIndex + cooldown + 1;
    }

    // Calculate final metrics
    const netPnl = grossProfit - grossLoss;
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const avgPnl = trades > 0 ? netPnl / trades : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    
    // Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss) per $1 risked
    const winRateDecimal = winRate / 100;
    const lossRateDecimal = 1 - winRateDecimal;
    const avgStake = initialBalance * stakePct;
    const expectancy = avgStake > 0 
      ? ((winRateDecimal * avgWin) - (lossRateDecimal * avgLoss)) / avgStake
      : 0;

    return {
      trades,
      wins,
      losses,
      winRate,
      netPnl,
      grossProfit,
      grossLoss,
      profitFactor: profitFactor === Infinity ? 999 : profitFactor,
      avgWin,
      avgLoss,
      avgPnl,
      maxDrawdown,
      maxDrawdownPct,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      expectancy,
      riskRewardRatio,
      finalEquity: equity,
      peakEquity: peak,
    };
  }

  /**
   * Get pre-calculated indicator series
   */
  getIndicatorSeries(name: IndicatorName): number[] {
    return this.indicatorCache.getSeries(name);
  }

  /**
   * Get indicator snapshot at specific index
   */
  getIndicatorSnapshot(index: number): Record<string, number | boolean> {
    const snapshot = this.indicatorCache.getSnapshot(index);
    const record: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(snapshot)) {
      record[key] = value as number | boolean;
    }
    return record;
  }

  /**
   * Get number of candles
   */
  get length(): number {
    return this.candles.length;
  }
}

/**
 * Helper function to create a fast backtester
 */
export function createFastBacktester(
  candles: Candle[],
  requiredIndicators: string[],
  indicatorConfig?: Partial<IndicatorConfig>
): FastBacktester {
  return new FastBacktester(candles, requiredIndicators, indicatorConfig);
}

