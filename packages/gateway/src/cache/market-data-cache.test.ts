import { describe, it, expect, beforeEach } from 'vitest';
import { MarketDataCache } from './market-data-cache.js';
import type { Tick } from '@deriv-bot/shared';

describe('MarketDataCache', () => {
  let cache: MarketDataCache;

  beforeEach(() => {
    cache = new MarketDataCache({
      maxTicksPerAsset: 100,
      maxCandlesPerAsset: 500,
      enablePersistence: false, // Disable DB for unit tests
    });
  });

  describe('Ticks', () => {
    it('should store ticks', () => {
      const tick: Tick = {
        asset: 'R_100',
        price: 1234.56,
        timestamp: Date.now(),
      };

      cache.addTick(tick);

      const ticks = cache.getTicks('R_100');
      expect(ticks).toHaveLength(1);
      expect(ticks[0]).toEqual(tick);
    });

    it('should store multiple ticks', () => {
      for (let i = 0; i < 10; i++) {
        cache.addTick({
          asset: 'R_100',
          price: 1234 + i,
          timestamp: Date.now() + i * 1000,
        });
      }

      const ticks = cache.getTicks('R_100');
      expect(ticks).toHaveLength(10);
    });

    it('should limit ticks per asset', () => {
      const smallCache = new MarketDataCache({
        maxTicksPerAsset: 5,
        maxCandlesPerAsset: 100,
        enablePersistence: false,
      });

      // Add 10 ticks
      for (let i = 0; i < 10; i++) {
        smallCache.addTick({
          asset: 'R_100',
          price: 1234 + i,
          timestamp: Date.now() + i * 1000,
        });
      }

      const ticks = smallCache.getTicks('R_100');

      // Should only keep last 5
      expect(ticks).toHaveLength(5);
      expect(ticks[0].price).toBe(1239); // tick #5
      expect(ticks[4].price).toBe(1243); // tick #9
    });

    it('should get ticks with limit', () => {
      for (let i = 0; i < 100; i++) {
        cache.addTick({
          asset: 'R_100',
          price: 1234 + i,
          timestamp: Date.now() + i * 1000,
        });
      }

      const last10 = cache.getTicks('R_100', 10);
      expect(last10).toHaveLength(10);
      expect(last10[9].price).toBe(1333); // Last tick
    });

    it('should handle multiple assets', () => {
      cache.addTick({
        asset: 'R_100',
        price: 1234.56,
        timestamp: Date.now(),
      });

      cache.addTick({
        asset: 'R_50',
        price: 5678.90,
        timestamp: Date.now(),
      });

      expect(cache.getTicks('R_100')).toHaveLength(1);
      expect(cache.getTicks('R_50')).toHaveLength(1);
      expect(cache.getTicks('R_100')[0].price).toBe(1234.56);
      expect(cache.getTicks('R_50')[0].price).toBe(5678.90);
    });
  });

  describe('Candles', () => {
    it('should build candles from ticks', () => {
      // Add ticks over 2 minutes
      const baseTime = 1704067200000; // 2024-01-01 00:00:00

      // Minute 1
      cache.addTick({
        asset: 'R_100',
        price: 1234.0,
        timestamp: baseTime + 1000, // 00:00:01
      });

      cache.addTick({
        asset: 'R_100',
        price: 1235.0,
        timestamp: baseTime + 30000, // 00:00:30
      });

      // Minute 2
      cache.addTick({
        asset: 'R_100',
        price: 1236.0,
        timestamp: baseTime + 60000, // 00:01:00
      });

      // Get 1-minute candles
      const candles = cache.getCandles('R_100', 60);
      expect(candles.length).toBeGreaterThan(0);
    });

    it('should get candles with count limit', () => {
      const baseTime = Date.now();

      // Add ticks for 5 minutes
      for (let minute = 0; minute < 5; minute++) {
        cache.addTick({
          asset: 'R_100',
          price: 1234 + minute,
          timestamp: baseTime + minute * 60000,
        });
      }

      const candles = cache.getCandles('R_100', 60, 3);

      // Should get last 3 candles
      expect(candles.length).toBeLessThanOrEqual(3);
    });

    it('should handle multiple timeframes', () => {
      const baseTime = Date.now();

      // Add ticks for 10 minutes
      for (let i = 0; i < 600; i++) {
        // 600 seconds
        cache.addTick({
          asset: 'R_100',
          price: 1234 + Math.random() * 10,
          timestamp: baseTime + i * 1000,
        });
      }

      const candles1m = cache.getCandles('R_100', 60); // 1 min
      const candles5m = cache.getCandles('R_100', 300); // 5 min

      expect(candles1m.length).toBeGreaterThan(0);
      expect(candles5m.length).toBeGreaterThan(0);
      expect(candles1m.length).toBeGreaterThan(candles5m.length);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache for asset', () => {
      cache.addTick({
        asset: 'R_100',
        price: 1234.56,
        timestamp: Date.now(),
      });

      cache.addTick({
        asset: 'R_50',
        price: 5678.90,
        timestamp: Date.now(),
      });

      cache.clearAsset('R_100');

      expect(cache.getTicks('R_100')).toHaveLength(0);
      expect(cache.getTicks('R_50')).toHaveLength(1);
    });

    it('should clear all cache', () => {
      cache.addTick({
        asset: 'R_100',
        price: 1234.56,
        timestamp: Date.now(),
      });

      cache.addTick({
        asset: 'R_50',
        price: 5678.90,
        timestamp: Date.now(),
      });

      cache.clearAll();

      expect(cache.getTicks('R_100')).toHaveLength(0);
      expect(cache.getTicks('R_50')).toHaveLength(0);
    });

    it('should get list of tracked assets', () => {
      cache.addTick({
        asset: 'R_100',
        price: 1234.56,
        timestamp: Date.now(),
      });

      cache.addTick({
        asset: 'R_50',
        price: 5678.90,
        timestamp: Date.now(),
      });

      const assets = cache.getTrackedAssets();
      expect(assets).toContain('R_100');
      expect(assets).toContain('R_50');
    });
  });
});
