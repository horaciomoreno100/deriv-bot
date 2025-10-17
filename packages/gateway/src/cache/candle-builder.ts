import { EventEmitter } from 'events';
import type { Tick, Candle } from '@deriv-bot/shared';

/**
 * Configuration for CandleBuilder
 */
export interface CandleBuilderConfig {
  /** Asset symbol */
  asset: string;
  /** Timeframe in seconds (60, 300, 900, 3600, etc) */
  timeframe: number;
  /** Maximum closed candles to keep in memory */
  maxClosedCandles?: number;
}

/**
 * CandleBuilder - Builds OHLC candles from tick stream
 *
 * Converts real-time tick data into candles of specified timeframe.
 * Emits events when candles update or close.
 *
 * @example
 * ```typescript
 * const builder = new CandleBuilder({
 *   asset: 'R_100',
 *   timeframe: 60 // 1 minute
 * });
 *
 * builder.on('candle:update', (candle) => {
 *   console.log('Candle updating:', candle);
 * });
 *
 * builder.on('candle:closed', (candle) => {
 *   console.log('Candle closed:', candle);
 * });
 *
 * // Feed ticks
 * builder.addTick(tick);
 * ```
 *
 * @fires candle:update - When candle is updated with new tick
 * @fires candle:closed - When candle closes (new period starts)
 */
export class CandleBuilder extends EventEmitter {
  private config: Required<CandleBuilderConfig>;
  private currentCandle: Candle | null = null;
  private closedCandles: Candle[] = [];

  constructor(config: CandleBuilderConfig) {
    super();

    this.config = {
      asset: config.asset,
      timeframe: config.timeframe,
      maxClosedCandles: config.maxClosedCandles || 1000,
    };
  }

  /**
   * Add tick to builder
   *
   * Updates current candle or creates new one if timeframe expired
   */
  addTick(tick: Tick): void {
    const candleTimestamp = this.getCandleTimestamp(tick.timestamp);

    // Check if we need to close current candle and start new one
    if (this.currentCandle && this.currentCandle.timestamp !== candleTimestamp) {
      this.closeCurrentCandle();
    }

    // Create new candle if needed
    if (!this.currentCandle) {
      this.currentCandle = {
        asset: this.config.asset,
        timeframe: this.config.timeframe,
        timestamp: candleTimestamp,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      };
    } else {
      // Update existing candle
      this.currentCandle.high = Math.max(this.currentCandle.high, tick.price);
      this.currentCandle.low = Math.min(this.currentCandle.low, tick.price);
      this.currentCandle.close = tick.price;
    }

    // Emit update event
    this.emit('candle:update', { ...this.currentCandle });
  }

  /**
   * Get current (open) candle
   */
  getCurrentCandle(): Candle | null {
    return this.currentCandle ? { ...this.currentCandle } : null;
  }

  /**
   * Get closed candles
   */
  getClosedCandles(count?: number): Candle[] {
    if (count) {
      return this.closedCandles.slice(-count);
    }
    return [...this.closedCandles];
  }

  /**
   * Get all candles (closed + current)
   */
  getAllCandles(): Candle[] {
    const candles = [...this.closedCandles];
    if (this.currentCandle) {
      candles.push({ ...this.currentCandle });
    }
    return candles;
  }

  /**
   * Clear all candles
   */
  clear(): void {
    this.currentCandle = null;
    this.closedCandles = [];
  }

  /**
   * Close current candle and save it
   */
  private closeCurrentCandle(): void {
    if (!this.currentCandle) {
      return;
    }

    // Save closed candle
    this.closedCandles.push({ ...this.currentCandle });

    // Limit closed candles in memory
    if (this.closedCandles.length > this.config.maxClosedCandles) {
      this.closedCandles.shift(); // Remove oldest
    }

    // Emit closed event
    this.emit('candle:closed', { ...this.currentCandle });

    // Reset current candle
    this.currentCandle = null;
  }

  /**
   * Calculate candle timestamp from tick timestamp
   *
   * Rounds down to nearest timeframe interval
   *
   * @param tickTimestamp - Tick timestamp in milliseconds
   * @returns Candle timestamp in seconds
   */
  private getCandleTimestamp(tickTimestamp: number): number {
    const tickSeconds = Math.floor(tickTimestamp / 1000);
    const timeframeSeconds = this.config.timeframe;

    // Round down to nearest timeframe interval
    return Math.floor(tickSeconds / timeframeSeconds) * timeframeSeconds;
  }
}
