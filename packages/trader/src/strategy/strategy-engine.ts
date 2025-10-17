/**
 * Strategy Engine
 *
 * Manages and executes multiple trading strategies
 */

import { EventEmitter } from 'events';
import type { BaseStrategy } from './base-strategy.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';
import type { StrategyContext } from './base-strategy.js';

/**
 * Strategy Engine Events
 */
export interface StrategyEngineEvents {
  'signal': (signal: Signal, strategy: BaseStrategy) => void;
  'strategy:started': (strategy: BaseStrategy) => void;
  'strategy:stopped': (strategy: BaseStrategy) => void;
  'strategy:error': (error: Error, strategy: BaseStrategy) => void;
}

/**
 * Strategy Engine - Manages multiple strategies
 *
 * Features:
 * - Run multiple strategies in parallel
 * - Independent candle/tick data per strategy
 * - Signal aggregation
 * - Lifecycle management
 *
 * @example
 * ```typescript
 * const engine = new StrategyEngine();
 *
 * // Add strategies
 * engine.addStrategy(new SMAStrategy({ ... }));
 * engine.addStrategy(new RSIStrategy({ ... }));
 *
 * // Listen for signals
 * engine.on('signal', (signal, strategy) => {
 *   console.log(`Signal from ${strategy.getName()}:`, signal);
 * });
 *
 * // Start all strategies
 * await engine.startAll();
 *
 * // Feed data
 * engine.processTick(tick);
 * engine.processCandle(candle);
 * ```
 */
export class StrategyEngine extends EventEmitter {
  private strategies = new Map<string, BaseStrategy>();
  private candleData = new Map<string, Candle[]>(); // Per-strategy candle buffers
  private latestTicks = new Map<string, Tick>(); // Per-strategy latest tick
  private balance: number = 0;
  private openPositions: number = 0;

  /**
   * Add a strategy to the engine
   */
  addStrategy(strategy: BaseStrategy): void {
    const name = strategy.getName();

    if (this.strategies.has(name)) {
      throw new Error(`Strategy '${name}' already exists`);
    }

    this.strategies.set(name, strategy);
    this.candleData.set(name, []);
    this.latestTicks.set(name, null as any);

    // Forward strategy events
    strategy.on('signal', (signal) => {
      this.emit('signal', signal, strategy);
    });

    strategy.on('error', (error) => {
      this.emit('strategy:error', error, strategy);
    });
  }

  /**
   * Remove a strategy
   */
  async removeStrategy(name: string): Promise<void> {
    const strategy = this.strategies.get(name);

    if (!strategy) {
      return;
    }

    // Stop if running
    if (strategy.isRunning()) {
      await strategy.stop();
    }

    this.strategies.delete(name);
    this.candleData.delete(name);
    this.latestTicks.delete(name);
  }

  /**
   * Get a strategy by name
   */
  getStrategy(name: string): BaseStrategy | undefined {
    return this.strategies.get(name);
  }

  /**
   * Get all strategies
   */
  getAllStrategies(): BaseStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Start a specific strategy
   */
  async startStrategy(name: string): Promise<void> {
    const strategy = this.strategies.get(name);

    if (!strategy) {
      throw new Error(`Strategy '${name}' not found`);
    }

    await strategy.start();
    this.emit('strategy:started', strategy);
  }

  /**
   * Stop a specific strategy
   */
  async stopStrategy(name: string): Promise<void> {
    const strategy = this.strategies.get(name);

    if (!strategy) {
      throw new Error(`Strategy '${name}' not found`);
    }

    await strategy.stop();
    this.emit('strategy:stopped', strategy);
  }

  /**
   * Start all strategies
   */
  async startAll(): Promise<void> {
    const promises = Array.from(this.strategies.values()).map((strategy) =>
      strategy.start()
    );

    await Promise.all(promises);

    this.strategies.forEach((strategy) => {
      this.emit('strategy:started', strategy);
    });
  }

  /**
   * Stop all strategies
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.strategies.values()).map((strategy) =>
      strategy.stop()
    );

    await Promise.all(promises);

    this.strategies.forEach((strategy) => {
      this.emit('strategy:stopped', strategy);
    });
  }

  /**
   * Process a new tick (distribute to all strategies)
   */
  async processTick(tick: Tick): Promise<void> {
    const promises: Promise<void>[] = [];

    this.strategies.forEach((strategy, name) => {
      // Update latest tick for this strategy
      this.latestTicks.set(name, tick);

      // Create context
      const context: StrategyContext = {
        candles: this.candleData.get(name) || [],
        latestTick: tick,
        balance: this.balance,
        openPositions: this.openPositions,
      };

      // Process tick
      promises.push(strategy.processTick(tick, context));
    });

    await Promise.all(promises);
  }

  /**
   * Process a new candle (distribute to all strategies)
   */
  async processCandle(candle: Candle): Promise<void> {
    const promises: Promise<void>[] = [];

    this.strategies.forEach((strategy, name) => {
      // Add candle to strategy's buffer
      const candles = this.candleData.get(name) || [];
      candles.push(candle);

      // Keep last 500 candles per strategy
      if (candles.length > 500) {
        candles.shift();
      }

      this.candleData.set(name, candles);

      // Create context
      const context: StrategyContext = {
        candles,
        latestTick: this.latestTicks.get(name) || null,
        balance: this.balance,
        openPositions: this.openPositions,
      };

      // Process candle
      promises.push(strategy.processCandle(candle, context));
    });

    await Promise.all(promises);
  }

  /**
   * Update balance (for context)
   */
  updateBalance(balance: number): void {
    this.balance = balance;
  }

  /**
   * Update open positions count (for context)
   */
  updateOpenPositions(count: number): void {
    this.openPositions = count;
  }

  /**
   * Get candle data for a strategy
   */
  getCandleData(strategyName: string): Candle[] {
    return this.candleData.get(strategyName) || [];
  }

  /**
   * Clear candle data for a strategy
   */
  clearCandleData(strategyName: string): void {
    this.candleData.set(strategyName, []);
  }

  /**
   * Type-safe event listener
   */
  override on<K extends keyof StrategyEngineEvents>(
    event: K,
    listener: StrategyEngineEvents[K]
  ): this {
    return super.on(event as string, listener);
  }

  /**
   * Type-safe event emitter
   */
  override emit<K extends keyof StrategyEngineEvents>(
    event: K,
    ...args: Parameters<StrategyEngineEvents[K]>
  ): boolean {
    return super.emit(event as string, ...args);
  }
}
