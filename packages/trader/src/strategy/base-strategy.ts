/**
 * Base Strategy Class
 *
 * All trading strategies must extend this class
 */

import { EventEmitter } from 'events';
import type { Candle, Tick, Signal, StrategyConfig } from '@deriv-bot/shared';

/**
 * Strategy Context - Data available to strategy
 */
export interface StrategyContext {
  /** Current candles */
  candles: Candle[];
  /** Latest tick */
  latestTick: Tick | null;
  /** Current balance */
  balance: number;
  /** Open positions count */
  openPositions: number;
}

/**
 * Strategy Events
 */
export interface StrategyEvents {
  'signal': (signal: Signal) => void;
  'error': (error: Error) => void;
  'indicators': (indicators: {
    rsi: number;
    bbUpper: number;
    bbMiddle: number;
    bbLower: number;
    atr: number;
    asset: string;
    timestamp: number;
  }) => void;
}

/**
 * Base Strategy Class
 *
 * Provides common functionality for all strategies:
 * - Lifecycle hooks (onStart, onStop, onTick, onCandle)
 * - Signal generation
 * - Configuration management
 *
 * @example
 * ```typescript
 * class MyStrategy extends BaseStrategy {
 *   async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
 *     const sma = calculateSMA(context.candles, 20);
 *     const price = candle.close;
 *
 *     if (price > sma[sma.length - 1]) {
 *       return this.createSignal('CALL', 0.8);
 *     }
 *
 *     return null;
 *   }
 * }
 * ```
 */
export abstract class BaseStrategy extends EventEmitter {
  protected config: StrategyConfig;
  protected running = false;

  constructor(config: StrategyConfig) {
    super();
    this.config = config;
  }

  /**
   * Get strategy name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get strategy configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Check if strategy is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the strategy
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.onStart();
  }

  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    await this.onStop();
  }

  /**
   * Process a new tick
   */
  async processTick(tick: Tick, context: StrategyContext): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      await this.onTick(tick, context);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Process a new candle (closed)
   */
  async processCandle(candle: Candle, context: StrategyContext): Promise<void> {
    console.log('[BaseStrategy] processCandle called, running:', this.running, 'asset:', candle.asset);
    if (!this.running) {
      console.log('[BaseStrategy] Strategy not running, skipping');
      return;
    }

    try {
      console.log('[BaseStrategy] Calling onCandle...');
      const signal = await this.onCandle(candle, context);

      if (signal) {
        console.log('[BaseStrategy] ✅ SIGNAL CREATED - Emitting signal:', signal.direction, 'for', signal.asset || signal.symbol);
        console.log('[BaseStrategy] Signal details:', {
          direction: signal.direction,
          asset: signal.asset || signal.symbol,
          confidence: signal.confidence,
          timestamp: new Date(signal.timestamp).toISOString(),
          metadata: signal.metadata
        });
        this.emit('signal', signal);
        console.log('[BaseStrategy] ✅ Signal emitted successfully');
      } else {
        console.log('[BaseStrategy] ⏳ No signal generated for', candle.asset);
      }
    } catch (error) {
      console.log('[BaseStrategy] Error in onCandle:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Create a signal
   */
  protected createSignal(
    direction: 'CALL' | 'PUT',
    confidence: number,
    metadata?: Record<string, any>,
    asset?: string // Optional: specify asset explicitly
  ): Signal {
    // Use provided asset, or first asset from config, or empty string
    const signalAsset = asset || this.config.assets?.[0] || '';
    
    return {
      strategyName: this.config.name,
      symbol: signalAsset,
      asset: signalAsset, // Also include asset for compatibility
      direction,
      confidence,
      timestamp: Date.now(),
      metadata,
    };
  }

  // ============================================
  // Lifecycle Hooks (override in subclass)
  // ============================================

  /**
   * Called when strategy starts
   * Override to initialize strategy state
   */
  protected async onStart(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when strategy stops
   * Override to cleanup strategy state
   */
  protected async onStop(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called on every tick
   * Override for tick-based strategies
   */
  protected async onTick(_tick: Tick, _context: StrategyContext): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when a candle closes
   * Override for candle-based strategies
   *
   * @returns Signal if strategy wants to trade, null otherwise
   */
  protected abstract onCandle(
    candle: Candle,
    context: StrategyContext
  ): Promise<Signal | null>;

  /**
   * Type-safe event listener
   */
  override on<K extends keyof StrategyEvents>(
    event: K,
    listener: StrategyEvents[K]
  ): this {
    return super.on(event as string, listener);
  }

  /**
   * Type-safe event emitter
   */
  override emit<K extends keyof StrategyEvents>(
    event: K,
    ...args: Parameters<StrategyEvents[K]>
  ): boolean {
    return super.emit(event as string, ...args);
  }
}
