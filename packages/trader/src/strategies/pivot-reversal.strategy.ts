/**
 * Pivot Reversal Strategy - Real-time pivot detection for Binary Options
 *
 * Based on TradingView Pine Script implementation with Anti-Martingale
 *
 * Strategy Logic:
 * - Detects potential pivot lows/highs in real-time (no lag)
 * - Confirms with candlestick reversal patterns
 * - Uses Anti-Martingale money management (reduce on loss, reset on win)
 * - Optimized for 1-minute expiry binary options
 *
 * Optimal for: Volatility indices (R_75, R_100)
 * Expiry: 1 minute (1 candle)
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';

/**
 * Pivot Reversal Strategy Parameters
 */
export interface PivotReversalParams {
  /** Number of bars to check before current bar for pivot (default: 4) */
  leftBars: number;
  /** Expiry time in minutes (default: 1) */
  expiryMinutes: number;
  /** Max consecutive losses before reset (default: 2) */
  maxLossStreak: number;
}

/**
 * Default parameters
 */
const DEFAULT_PARAMS: PivotReversalParams = {
  leftBars: 4,
  expiryMinutes: 1,
  maxLossStreak: 2,
};

/**
 * Pivot Reversal Strategy
 *
 * Detects potential reversals at pivot points using real-time price action
 */
export class PivotReversalStrategy extends BaseStrategy {
  private params: PivotReversalParams;
  private consecutiveWins: number = 0;
  private consecutiveLosses: number = 0;
  private currentStake: number | null = null;

  constructor(config: StrategyConfig) {
    super(config);

    // Merge user params with defaults
    this.params = {
      ...DEFAULT_PARAMS,
      ...(config.parameters as Partial<PivotReversalParams>),
    };
  }

  /**
   * Called when a candle closes - main strategy logic
   */
  protected async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    console.log('[PivotReversal] onCandle called for', candle.asset, 'candles.length:', context.candles.length);
    const { candles } = context;

    // Need enough candles for pivot detection
    const minCandles = this.params.leftBars + 1;

    if (candles.length < minCandles) {
      console.log('[PivotReversal] Not enough candles:', candles.length, '<', minCandles);
      return null;
    }

    // Check if current bar is a potential pivot low (lowest of last N bars)
    const isPotentialPivotLow = this.isPotentialPivotLow(candles);

    // Check if current bar is a potential pivot high (highest of last N bars)
    const isPotentialPivotHigh = this.isPotentialPivotHigh(candles);

    // Get current and previous candle
    const currentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];

    // Detect reversal patterns
    const isBullishReversal = this.isBullishReversal(currentCandle, previousCandle);
    const isBearishReversal = this.isBearishReversal(currentCandle, previousCandle);

    // CALL Signal: Potential pivot low + bullish reversal
    if (isPotentialPivotLow && isBullishReversal) {
      console.log('[PivotReversal] CALL signal detected:', {
        close: currentCandle.close,
        open: currentCandle.open,
        prevClose: previousCandle.close,
        prevOpen: previousCandle.open,
      });

      return this.createSignal('CALL', 0.80, {
        price: currentCandle.close,
        pivotLow: currentCandle.low,
        reason: `Pivot low detected + bullish reversal (green after red)`,
      });
    }

    // PUT Signal: Potential pivot high + bearish reversal
    if (isPotentialPivotHigh && isBearishReversal) {
      console.log('[PivotReversal] PUT signal detected:', {
        close: currentCandle.close,
        open: currentCandle.open,
        prevClose: previousCandle.close,
        prevOpen: previousCandle.open,
      });

      return this.createSignal('PUT', 0.80, {
        price: currentCandle.close,
        pivotHigh: currentCandle.high,
        reason: `Pivot high detected + bearish reversal (red after green)`,
      });
    }

    return null;
  }

  /**
   * Check if current bar is lowest of last N bars (potential pivot low)
   */
  private isPotentialPivotLow(candles: Candle[]): boolean {
    const current = candles[candles.length - 1];
    const lookback = this.params.leftBars;

    // Check if any of the previous N candles have a lower low
    for (let i = 1; i <= lookback; i++) {
      const idx = candles.length - 1 - i;
      if (idx < 0) break;

      if (candles[idx].low < current.low) {
        return false; // Found a lower low in history
      }
    }

    return true; // Current low is the lowest
  }

  /**
   * Check if current bar is highest of last N bars (potential pivot high)
   */
  private isPotentialPivotHigh(candles: Candle[]): boolean {
    const current = candles[candles.length - 1];
    const lookback = this.params.leftBars;

    // Check if any of the previous N candles have a higher high
    for (let i = 1; i <= lookback; i++) {
      const idx = candles.length - 1 - i;
      if (idx < 0) break;

      if (candles[idx].high > current.high) {
        return false; // Found a higher high in history
      }
    }

    return true; // Current high is the highest
  }

  /**
   * Detect bullish reversal pattern: Green candle after red candle
   */
  private isBullishReversal(current: Candle, previous: Candle): boolean {
    const isCurrentGreen = current.close > current.open;
    const isPreviousRed = previous.close < previous.open;

    return isCurrentGreen && isPreviousRed;
  }

  /**
   * Detect bearish reversal pattern: Red candle after green candle
   */
  private isBearishReversal(current: Candle, previous: Candle): boolean {
    const isCurrentRed = current.close < current.open;
    const isPreviousGreen = previous.close > previous.open;

    return isCurrentRed && isPreviousGreen;
  }

  /**
   * Update anti-martingale state after trade result
   *
   * Anti-Martingale:
   * - Win: reset stake to base
   * - Loss: next_stake = current_stake / 2
   * - Reset after max loss streak
   */
  public updateAntiMartingale(won: boolean, _profit: number, stake: number): void {
    if (won) {
      this.consecutiveWins++;
      this.consecutiveLosses = 0;
      this.currentStake = null; // Reset to base stake on win
    } else {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;
      this.currentStake = stake / 2.0; // Halve stake on loss

      // Reset after max loss streak
      if (this.consecutiveLosses >= this.params.maxLossStreak) {
        this.consecutiveLosses = 0;
        this.currentStake = null;
      }
    }
  }

  /**
   * Get current stake amount (for anti-martingale)
   */
  public getCurrentStake(baseStake: number): number {
    return this.currentStake ?? baseStake;
  }

  /**
   * Get strategy parameters
   */
  public getParams(): PivotReversalParams {
    return { ...this.params };
  }

  /**
   * Get current streak info
   */
  public getStreakInfo(): {
    consecutiveWins: number;
    consecutiveLosses: number;
    currentStake: number | null;
  } {
    return {
      consecutiveWins: this.consecutiveWins,
      consecutiveLosses: this.consecutiveLosses,
      currentStake: this.currentStake,
    };
  }
}
