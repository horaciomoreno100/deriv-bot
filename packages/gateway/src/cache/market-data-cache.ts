import type { Tick, Candle } from '@deriv-bot/shared';
import { CandleBuilder } from './candle-builder.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');
import type { EventBus } from '../events/event-bus.js';

/**
 * Configuration for MarketDataCache
 */
export interface MarketDataCacheConfig {
  /** Maximum ticks to keep in memory per asset */
  maxTicksPerAsset: number;
  /** Maximum candles to keep in memory per asset per timeframe */
  maxCandlesPerAsset: number;
  /** Enable persistence to database */
  enablePersistence?: boolean;
  /** EventBus for emitting candle events */
  eventBus?: EventBus;
}

/**
 * MarketDataCache - In-memory cache for market data with DB overflow
 *
 * Stores ticks and builds candles in real-time.
 * When memory limits are reached, oldest data is persisted to database.
 *
 * @example
 * ```typescript
 * const cache = new MarketDataCache({
 *   maxTicksPerAsset: 1000,
 *   maxCandlesPerAsset: 500,
 *   enablePersistence: true
 * });
 *
 * // Add tick
 * cache.addTick({
 *   asset: 'R_100',
 *   price: 1234.56,
 *   timestamp: Date.now()
 * });
 *
 * // Get recent ticks
 * const ticks = cache.getTicks('R_100', 100);
 *
 * // Get candles
 * const candles = cache.getCandles('R_100', 60, 50); // 50 x 1-min candles
 * ```
 */
export class MarketDataCache {
  private config: Required<Omit<MarketDataCacheConfig, 'eventBus'>>;
  private ticks = new Map<string, Tick[]>(); // asset -> ticks[]
  private candleBuilders = new Map<string, Map<number, CandleBuilder>>(); // asset -> timeframe -> builder
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private prisma: any = null;
  private eventBus: EventBus | null = null;

  constructor(config: MarketDataCacheConfig) {
    this.config = {
      maxTicksPerAsset: config.maxTicksPerAsset,
      maxCandlesPerAsset: config.maxCandlesPerAsset,
      enablePersistence: config.enablePersistence ?? false,
    };

    this.eventBus = config.eventBus || null;

    if (this.config.enablePersistence) {
      this.prisma = new PrismaClient();
    }
  }

  /**
   * Add tick to cache
   *
   * Also updates all candle builders for this asset
   */
  addTick(tick: Tick): void {
    // Store tick in memory
    if (!this.ticks.has(tick.asset)) {
      this.ticks.set(tick.asset, []);
    }

    const assetTicks = this.ticks.get(tick.asset)!;
    assetTicks.push(tick);

    // Limit ticks in memory
    if (assetTicks.length > this.config.maxTicksPerAsset) {
      const overflow = assetTicks.splice(0, assetTicks.length - this.config.maxTicksPerAsset);

      // Persist overflow to DB if enabled
      if (this.config.enablePersistence) {
        this.persistTicks(overflow).catch(console.error);
      }
    }

    // Update candle builders
    const builders = this.candleBuilders.get(tick.asset);
    if (builders) {
      builders.forEach((builder) => {
        builder.addTick(tick);
      });
    }
  }

  /**
   * Get ticks for asset
   *
   * @param asset - Asset symbol
   * @param count - Number of recent ticks to get (optional)
   */
  getTicks(asset: string, count?: number): Tick[] {
    const ticks = this.ticks.get(asset) || [];

    if (count) {
      return ticks.slice(-count);
    }

    return [...ticks];
  }

  /**
   * Get candles for asset and timeframe
   *
   * @param asset - Asset symbol
   * @param timeframe - Timeframe in seconds (60, 300, 900, etc)
   * @param count - Number of recent candles to get (optional)
   */
  getCandles(asset: string, timeframe: number, count?: number): Candle[] {
    const builder = this.getCandleBuilder(asset, timeframe);
    return builder.getAllCandles().slice(count ? -count : 0);
  }

  /**
   * Get or create candle builder for asset/timeframe
   */
  private getCandleBuilder(asset: string, timeframe: number): CandleBuilder {
    if (!this.candleBuilders.has(asset)) {
      this.candleBuilders.set(asset, new Map());
    }

    const assetBuilders = this.candleBuilders.get(asset)!;

    if (!assetBuilders.has(timeframe)) {
      const builder = new CandleBuilder({
        asset,
        timeframe,
        maxClosedCandles: this.config.maxCandlesPerAsset,
      });

      // Forward candle events to EventBus
      if (this.eventBus) {
        builder.on('candle:update', (candle: Candle) => {
          this.eventBus!.emitTyped('candle:update', { asset, timeframe, candle });
        });

        builder.on('candle:closed', (candle: Candle) => {
          this.eventBus!.emitTyped('candle:closed', { asset, timeframe, candle });
        });
      }

      // Persist closed candles if enabled
      if (this.config.enablePersistence) {
        builder.on('candle:closed', (candle) => {
          this.persistCandle(candle).catch(console.error);
        });
      }

      assetBuilders.set(timeframe, builder);

      // Feed existing ticks to builder
      const existingTicks = this.getTicks(asset);
      existingTicks.forEach((tick) => builder.addTick(tick));
    }

    return assetBuilders.get(timeframe)!;
  }

  /**
   * Clear cache for asset
   */
  clearAsset(asset: string): void {
    this.ticks.delete(asset);
    this.candleBuilders.delete(asset);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.ticks.clear();
    this.candleBuilders.clear();
  }

  /**
   * Get list of tracked assets
   */
  getTrackedAssets(): string[] {
    return Array.from(this.ticks.keys());
  }

  /**
   * Persist ticks to database
   */
  private async persistTicks(ticks: Tick[]): Promise<void> {
    if (!this.prisma) return;

    await this.prisma.tick.createMany({
      data: ticks.map((tick) => ({
        asset: tick.asset,
        price: tick.price,
        timestamp: BigInt(tick.timestamp),
        direction: tick.direction || null,
      })),
    });
  }

  /**
   * Persist candle to database
   */
  private async persistCandle(candle: Candle): Promise<void> {
    if (!this.prisma) return;

    await this.prisma.candle.upsert({
      where: {
        asset_timeframe_timestamp: {
          asset: candle.asset,
          timeframe: candle.timeframe,
          timestamp: candle.timestamp,
        },
      },
      create: {
        asset: candle.asset,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
      update: {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
    });
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }
}
