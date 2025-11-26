/**
 * Validation Test Strategy - Ultra High Frequency
 *
 * Purpose: Generate MANY signals quickly to validate live trading infrastructure
 * NOT for real trading - only for testing
 *
 * Expected: 30-50 signals per hour
 * Parameters: Very relaxed to maximize signal generation
 */

import { BaseStrategy } from '../strategy/base-strategy';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';

export class ValidationTestStrategy extends BaseStrategy {
  // EXTREME parameters for MAXIMUM signal generation (simulation only!)
  private readonly RSI_OVERSOLD = 45;  // VERY relaxed - almost always triggers
  private readonly RSI_OVERBOUGHT = 55; // VERY relaxed - almost always triggers
  private readonly COOLDOWN_MS = 1000;  // Only 1 second! (generates every candle)
  private readonly MAX_CONCURRENT = 10;  // Many concurrent trades

  private lastSignalTime = 0;
  private activeTrades = 0;

  constructor() {
    super({
      name: 'Validation-Test',
      description: 'Ultra high-frequency strategy for testing live trading infrastructure',
      parameters: {},
    });
  }

  protected async onCandle(candle: Candle, context: any): Promise<Signal | null> {
    const { candles } = context;

    // Need at least 20 candles for RSI
    if (candles.length < 20) {
      return null;
    }

    // Cooldown check
    const now = Date.now();
    if (now - this.lastSignalTime < this.COOLDOWN_MS) {
      return null;
    }

    // Concurrent trades limit
    if (this.activeTrades >= this.MAX_CONCURRENT) {
      return null;
    }

    // Calculate RSI (simple calculation)
    const rsi = this.calculateRSI(candles, 14);
    const currentPrice = candle.close;

    console.log(`[Validation] RSI: ${rsi.toFixed(2)}, Price: ${currentPrice}`);

    // CALL signal (very easy to trigger)
    if (rsi < this.RSI_OVERSOLD) {
      this.lastSignalTime = now;
      this.activeTrades++;

      console.log(`[Validation] 🔵 CALL signal generated - RSI: ${rsi.toFixed(2)} < ${this.RSI_OVERSOLD}`);

      return {
        direction: 'CALL',
        confidence: 0.7,
        entry: currentPrice,
        metadata: {
          rsi,
          reason: 'RSI oversold (validation test)',
          timestamp: new Date().toISOString(),
        },
      };
    }

    // PUT signal (very easy to trigger)
    if (rsi > this.RSI_OVERBOUGHT) {
      this.lastSignalTime = now;
      this.activeTrades++;

      console.log(`[Validation] 🔴 PUT signal generated - RSI: ${rsi.toFixed(2)} > ${this.RSI_OVERBOUGHT}`);

      return {
        direction: 'PUT',
        confidence: 0.7,
        entry: currentPrice,
        metadata: {
          rsi,
          reason: 'RSI overbought (validation test)',
          timestamp: new Date().toISOString(),
        },
      };
    }

    return null;
  }

  /**
   * Simple RSI calculation
   */
  private calculateRSI(candles: Candle[], period: number): number {
    if (candles.length < period + 1) {
      return 50; // Neutral if not enough data
    }

    const recentCandles = candles.slice(-period - 1);
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      const change = recentCandles[i].close - recentCandles[i - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) {
      return 100; // All gains
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  /**
   * Called when a trade completes
   */
  onTradeComplete(tradeId: string, result: 'won' | 'lost'): void {
    this.activeTrades = Math.max(0, this.activeTrades - 1);
    console.log(`[Validation] Trade ${tradeId} completed: ${result.toUpperCase()} (active: ${this.activeTrades})`);
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      activeTrades: this.activeTrades,
      lastSignalTime: this.lastSignalTime,
      cooldownMs: this.COOLDOWN_MS,
      parameters: {
        rsiOversold: this.RSI_OVERSOLD,
        rsiOverbought: this.RSI_OVERBOUGHT,
        cooldownMs: this.COOLDOWN_MS,
        maxConcurrent: this.MAX_CONCURRENT,
      },
    };
  }
}
