/**
 * Mean Reversion Strategy - Optimized for R_75
 *
 * Based on extensive backtesting (90-day period):
 * - Win Rate: 63.87%
 * - ROI: 54.09%
 * - Total Profit: $540.92
 * - Trades: 119 (1.3/day)
 *
 * Strategy Logic:
 * - Uses RSI (17/83 thresholds) + Bollinger Bands (20, 2.0)
 * - ATR filter to avoid over-filtering
 * - Cooldown to prevent over-trading
 * - Progressive Anti-Martingale money management
 *
 * Optimal for: R_75 (Volatility 75 Index)
 * Expiry: 3 minutes
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import {
  calculateRSI,
  calculateBollingerBands,
  calculateATR,
  getLatest,
} from '../indicators/index.js';

/**
 * Mean Reversion Strategy Parameters
 */
export interface MeanReversionParams {
  /** RSI period (default: 14) */
  rsiPeriod: number;
  /** RSI oversold threshold (default: 17) */
  rsiOversold: number;
  /** RSI overbought threshold (default: 83) */
  rsiOverbought: number;
  /** Bollinger Bands period (default: 20) */
  bbPeriod: number;
  /** Bollinger Bands standard deviation (default: 2.0) */
  bbStdDev: number;
  /** ATR period (default: 14) */
  atrPeriod: number;
  /** ATR multiplier for volatility filter (default: 1.0) */
  atrMultiplier: number;
  /** Expiry time in minutes (default: 3) */
  expiryMinutes: number;
  /** Cooldown between trades in minutes (default: 2) */
  cooldownMinutes: number;
  /** Max win streak before reset (default: 2) */
  maxWinStreak: number;
  /** Max loss streak before reset (default: 3) */
  maxLossStreak: number;
}

/**
 * Default parameters (optimized through backtesting)
 */
const DEFAULT_PARAMS: MeanReversionParams = {
  rsiPeriod: 14,
  rsiOversold: 17, // Test #5: Tighter threshold
  rsiOverbought: 83, // Test #5: Tighter threshold
  bbPeriod: 20,
  bbStdDev: 2.0,
  atrPeriod: 14,
  atrMultiplier: 1.0, // Standard ATR (1.2x over-filtered)
  expiryMinutes: 3,
  cooldownMinutes: 2,
  maxWinStreak: 2,
  maxLossStreak: 3,
};

/**
 * Mean Reversion Strategy
 *
 * Detects extreme oversold/overbought conditions and trades the reversion
 */
export class MeanReversionStrategy extends BaseStrategy {
  private params: MeanReversionParams;
  private lastTradeTime: number = 0;
  private winStreak: number = 0;
  private lossStreak: number = 0;
  private currentStake: number | null = null;

  constructor(config: StrategyConfig) {
    super(config);

    // Merge user params with defaults
    this.params = {
      ...DEFAULT_PARAMS,
      ...(config.parameters as Partial<MeanReversionParams>),
    };
  }

  /**
   * Called when a candle closes - main strategy logic
   */
  protected async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    const { candles } = context;

    // Need enough candles for indicators
    const minCandles = Math.max(
      this.params.rsiPeriod + 1,
      this.params.bbPeriod,
      this.params.atrPeriod
    );

    if (candles.length < minCandles) {
      return null;
    }

    // Check cooldown
    const now = Date.now();
    const cooldownMs = this.params.cooldownMinutes * 60 * 1000;

    if (this.lastTradeTime && now - this.lastTradeTime < cooldownMs) {
      return null;
    }

    // Calculate indicators
    const rsiValues = calculateRSI(candles, this.params.rsiPeriod);
    const bbValues = calculateBollingerBands(
      candles,
      this.params.bbPeriod,
      this.params.bbStdDev
    );
    const atrValues = calculateATR(candles, this.params.atrPeriod);

    const currentRSI = getLatest(rsiValues);
    const currentBB = getLatest(bbValues);
    const currentATR = getLatest(atrValues);

    // Validate indicator values
    if (currentRSI === null || currentBB === null || currentATR === null) {
      return null;
    }

    const price = candle.close;
    const { lower: bbLower, upper: bbUpper, middle: bbMiddle } = currentBB;

    // ATR filter: Calculate average ATR
    const avgATR =
      atrValues.slice(-20).reduce((sum, val) => sum + val, 0) / Math.min(20, atrValues.length);

    // Only trade if current ATR is within normal range
    if (currentATR > avgATR * this.params.atrMultiplier) {
      return null; // Volatility too high
    }

    // CALL Signal: RSI oversold + price near/below lower BB
    if (currentRSI < this.params.rsiOversold && price <= bbLower * 1.001) {
      this.lastTradeTime = now;

      return this.createSignal('CALL', 0.85, {
        rsi: currentRSI,
        price,
        bbLower,
        bbMiddle,
        atr: currentATR,
        reason: `RSI oversold (${currentRSI.toFixed(1)}) + price at BB lower (${price.toFixed(
          2
        )})`,
      });
    }

    // PUT Signal: RSI overbought + price near/above upper BB
    if (currentRSI > this.params.rsiOverbought && price >= bbUpper * 0.999) {
      this.lastTradeTime = now;

      return this.createSignal('PUT', 0.85, {
        rsi: currentRSI,
        price,
        bbUpper,
        bbMiddle,
        atr: currentATR,
        reason: `RSI overbought (${currentRSI.toFixed(1)}) + price at BB upper (${price.toFixed(
          2
        )})`,
      });
    }

    return null;
  }

  /**
   * Update anti-martingale state after trade result
   *
   * Progressive Anti-Martingale:
   * - Win: next_stake = current_stake + profit
   * - Loss: next_stake = current_stake / 2
   * - Reset after max win/loss streak
   */
  public updateAntiMartingale(won: boolean, profit: number, stake: number): void {
    if (won) {
      this.winStreak++;
      this.lossStreak = 0;
      this.currentStake = stake + profit; // Add profit to next stake

      // Reset after max win streak
      if (this.winStreak >= this.params.maxWinStreak) {
        this.winStreak = 0;
        this.currentStake = null;
      }
    } else {
      this.lossStreak++;
      this.winStreak = 0;
      this.currentStake = stake / 2.0; // Halve stake on loss

      // Reset after max loss streak
      if (this.lossStreak >= this.params.maxLossStreak) {
        this.lossStreak = 0;
        this.currentStake = null;
      }
    }
  }

  /**
   * Get current stake amount (for progressive staking)
   */
  public getCurrentStake(baseStake: number): number {
    return this.currentStake ?? baseStake;
  }

  /**
   * Get strategy parameters
   */
  public getParams(): MeanReversionParams {
    return { ...this.params };
  }

  /**
   * Get current streak info
   */
  public getStreakInfo(): { winStreak: number; lossStreak: number; currentStake: number | null } {
    return {
      winStreak: this.winStreak,
      lossStreak: this.lossStreak,
      currentStake: this.currentStake,
    };
  }
}
