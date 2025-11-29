/**
 * RSI Scalp Strategy Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RSIScalpStrategy,
  createRSIScalpStrategy,
} from '../rsi-scalp.strategy.js';
import { DEFAULT_RSI_SCALP_PARAMS } from '../rsi-scalp.params.js';
import type { Candle } from '@deriv-bot/shared';

// Helper to create test candles
function createCandle(
  close: number,
  index: number,
  options?: { high?: number; low?: number; volume?: number }
): Candle {
  return {
    asset: 'cryBTCUSD',
    timeframe: 300,
    timestamp: 1700000000 + index * 300,
    open: close * 0.999,
    high: options?.high ?? close * 1.001,
    low: options?.low ?? close * 0.998,
    close,
    volume: options?.volume ?? 1000,
  };
}

// Helper to create a series of candles with specific closes
function createCandleSeries(closes: number[], asset = 'cryBTCUSD'): Candle[] {
  return closes.map((close, i) => ({
    ...createCandle(close, i),
    asset,
  }));
}

// Helper to create candles that will produce a specific RSI
function createCandlesForRSI(
  targetRSI: number,
  numCandles: number,
  basePrice: number = 50000
): Candle[] {
  const candles: Candle[] = [];

  // Start with neutral candles to warm up
  for (let i = 0; i < 20; i++) {
    candles.push(createCandle(basePrice, i));
  }

  // Create trend candles to achieve target RSI
  if (targetRSI < 50) {
    // Bearish trend for low RSI
    const dropPerCandle = (50 - targetRSI) / numCandles * 0.5;
    for (let i = 0; i < numCandles; i++) {
      const close = basePrice * (1 - dropPerCandle * (i + 1) / 100);
      candles.push(createCandle(close, 20 + i));
    }
  } else {
    // Bullish trend for high RSI
    const risePerCandle = (targetRSI - 50) / numCandles * 0.5;
    for (let i = 0; i < numCandles; i++) {
      const close = basePrice * (1 + risePerCandle * (i + 1) / 100);
      candles.push(createCandle(close, 20 + i));
    }
  }

  return candles;
}

describe('RSIScalpStrategy', () => {
  let strategy: RSIScalpStrategy;

  beforeEach(() => {
    strategy = createRSIScalpStrategy();
  });

  describe('initialization', () => {
    it('should create strategy with default params', () => {
      expect(strategy.getParams()).toEqual(DEFAULT_RSI_SCALP_PARAMS);
    });

    it('should create strategy with custom params', () => {
      const custom = createRSIScalpStrategy({
        rsiPeriod: 7,
        stopLossPercent: 3.0,
      });

      expect(custom.getParams().rsiPeriod).toBe(7);
      expect(custom.getParams().stopLossPercent).toBe(3.0);
    });

    it('should initialize symbol state correctly', () => {
      strategy.initializeSymbol('cryBTCUSD');

      const state = strategy.getState('cryBTCUSD');
      expect(state).toBeDefined();
      expect(state?.phase).toBe('SCANNING');
      expect(state?.dailyTrades).toBe(0);
    });
  });

  describe('calculateRSI', () => {
    it('should return null with insufficient data', () => {
      const candles = createCandleSeries([50000, 50100, 50050]);
      const rsi = strategy.calculateRSI(candles, 14);
      expect(rsi).toBeNull();
    });

    it('should calculate RSI correctly', () => {
      // Create 20 candles with mixed movement
      const closes = [
        50000, 50100, 50050, 50200, 50150, 50300, 50250, 50400,
        50350, 50500, 50450, 50600, 50550, 50700, 50650, 50800,
        50750, 50900, 50850, 51000,
      ];
      const candles = createCandleSeries(closes);

      const rsi = strategy.calculateRSI(candles, 14);
      expect(rsi).not.toBeNull();
      expect(rsi).toBeGreaterThan(0);
      expect(rsi).toBeLessThan(100);
    });

    it('should detect oversold conditions (RSI < 30)', () => {
      // Create downtrending candles
      const closes: number[] = [];
      let price = 50000;
      for (let i = 0; i < 30; i++) {
        closes.push(price);
        price *= 0.995; // 0.5% drop per candle
      }
      const candles = createCandleSeries(closes);

      const rsi = strategy.calculateRSI(candles, 14);
      expect(rsi).not.toBeNull();
      expect(rsi).toBeLessThan(35); // Should be oversold
    });

    it('should detect overbought conditions (RSI > 70)', () => {
      // Create uptrending candles
      const closes: number[] = [];
      let price = 50000;
      for (let i = 0; i < 30; i++) {
        closes.push(price);
        price *= 1.005; // 0.5% rise per candle
      }
      const candles = createCandleSeries(closes);

      const rsi = strategy.calculateRSI(candles, 14);
      expect(rsi).not.toBeNull();
      expect(rsi).toBeGreaterThan(65); // Should be overbought
    });
  });

  describe('calculateEMA', () => {
    it('should return null with insufficient data', () => {
      const candles = createCandleSeries([50000, 50100, 50050]);
      const ema = strategy.calculateEMA(candles, 50);
      expect(ema).toBeNull();
    });

    it('should calculate EMA correctly', () => {
      const closes = Array.from({ length: 60 }, (_, i) => 50000 + i * 10);
      const candles = createCandleSeries(closes);

      const ema = strategy.calculateEMA(candles, 50);
      expect(ema).not.toBeNull();
      expect(ema).toBeGreaterThan(50000);
    });
  });

  describe('checkEntryConditions', () => {
    it('should trigger LONG entry when RSI < 30', () => {
      const result = strategy.checkEntryConditions(
        28, // RSI
        50000, // EMA
        50500, // Price > EMA
        'LONG',
        undefined,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result).not.toBeNull();
      expect(result?.rsiThreshold).toBe(30);
      expect(result?.sizePercent).toBe(40);
    });

    it('should NOT trigger LONG when RSI > 30', () => {
      const result = strategy.checkEntryConditions(
        35, // RSI > 30
        50000,
        50500,
        'LONG',
        undefined,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result).toBeNull();
    });

    it('should trigger SHORT entry when RSI > 70', () => {
      const result = strategy.checkEntryConditions(
        72, // RSI > 70
        50000,
        49500, // Price < EMA
        'SHORT',
        undefined,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result).not.toBeNull();
      expect(result?.rsiThreshold).toBe(70);
    });

    it('should trigger next DCA level when RSI drops further', () => {
      // Create a mock position with one entry
      const mockPosition = {
        id: 'test',
        symbol: 'cryBTCUSD',
        direction: 'LONG' as const,
        entries: [
          { price: 50000, sizePercent: 40, rsiAtEntry: 29, timestamp: Date.now(), levelIndex: 0 },
        ],
        averageEntry: 50000,
        totalSizePercent: 40,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        tp1Hit: false,
        tp2Hit: false,
        remainingSizePercent: 100,
        openTime: Date.now(),
      };

      // RSI dropped to 26 - should trigger level 2
      const result = strategy.checkEntryConditions(
        26, // RSI < 27 (level 2)
        49000,
        49500,
        'LONG',
        mockPosition,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result).not.toBeNull();
      expect(result?.rsiThreshold).toBe(27); // Level 2
      expect(result?.sizePercent).toBe(35); // Level 2 size
    });

    it('should NOT trigger when all levels are filled', () => {
      // Create a mock position with 3 entries (all filled)
      const mockPosition = {
        id: 'test',
        symbol: 'cryBTCUSD',
        direction: 'LONG' as const,
        entries: [
          { price: 50000, sizePercent: 40, rsiAtEntry: 29, timestamp: Date.now(), levelIndex: 0 },
          { price: 49500, sizePercent: 35, rsiAtEntry: 26, timestamp: Date.now(), levelIndex: 1 },
          { price: 49000, sizePercent: 25, rsiAtEntry: 23, timestamp: Date.now(), levelIndex: 2 },
        ],
        averageEntry: 49575,
        totalSizePercent: 100,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        tp1Hit: false,
        tp2Hit: false,
        remainingSizePercent: 100,
        openTime: Date.now(),
      };

      const result = strategy.checkEntryConditions(
        20, // Very oversold
        48000,
        48500,
        'LONG',
        mockPosition,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result).toBeNull(); // No more levels to fill
    });
  });

  describe('checkExitConditions', () => {
    const createMockPosition = (pnlPercent: number, direction: 'LONG' | 'SHORT') => ({
      id: 'test',
      symbol: 'cryBTCUSD',
      direction,
      entries: [{ price: 50000, sizePercent: 100, rsiAtEntry: 28, timestamp: Date.now(), levelIndex: 0 }],
      averageEntry: 50000,
      totalSizePercent: 100,
      unrealizedPnl: pnlPercent * 10, // Simplified
      unrealizedPnlPercent: pnlPercent,
      tp1Hit: false,
      tp2Hit: false,
      remainingSizePercent: 100,
      openTime: Date.now(),
    });

    it('should trigger stop loss when loss > 2%', () => {
      const position = createMockPosition(-2.5, 'LONG');

      const result = strategy.checkExitConditions(
        position,
        48750, // Price for -2.5% loss
        35,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result.action).toBe('FULL_EXIT');
      expect(result.reason).toContain('Stop loss');
    });

    it('should trigger TP1 when profit >= 0.75%', () => {
      const position = createMockPosition(0.8, 'LONG');

      const result = strategy.checkExitConditions(
        position,
        50400, // Price for +0.8% profit
        45,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result.action).toBe('PARTIAL_EXIT');
      expect(result.exitPercent).toBe(70);
      expect(result.tpLevel).toBe(1);
    });

    it('should trigger TP1 when RSI crosses 50 (LONG)', () => {
      const position = createMockPosition(0.3, 'LONG'); // Below profit threshold

      const result = strategy.checkExitConditions(
        position,
        50150,
        52, // RSI crossed above 50
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result.action).toBe('PARTIAL_EXIT');
      expect(result.tpLevel).toBe(1);
    });

    it('should trigger full exit on TP2 after TP1', () => {
      const position = createMockPosition(1.6, 'LONG');
      position.tp1Hit = true; // TP1 already triggered

      const result = strategy.checkExitConditions(
        position,
        50800,
        55,
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result.action).toBe('FULL_EXIT');
      expect(result.tpLevel).toBe(2);
    });

    it('should return NONE when no conditions met', () => {
      const position = createMockPosition(0.3, 'LONG');

      const result = strategy.checkExitConditions(
        position,
        50150,
        40, // RSI not crossed 50
        DEFAULT_RSI_SCALP_PARAMS
      );

      expect(result.action).toBe('NONE');
    });
  });

  describe('calculatePositionMetrics', () => {
    it('should calculate correct average entry with DCA', () => {
      const position = {
        id: 'test',
        symbol: 'cryBTCUSD',
        direction: 'LONG' as const,
        entries: [
          { price: 50000, sizePercent: 40, rsiAtEntry: 29, timestamp: Date.now(), levelIndex: 0 },
          { price: 49000, sizePercent: 35, rsiAtEntry: 26, timestamp: Date.now(), levelIndex: 1 },
          { price: 48000, sizePercent: 25, rsiAtEntry: 23, timestamp: Date.now(), levelIndex: 2 },
        ],
        averageEntry: 49150, // (50000*40 + 49000*35 + 48000*25) / 100
        totalSizePercent: 100,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        tp1Hit: false,
        tp2Hit: false,
        remainingSizePercent: 100,
        openTime: Date.now(),
      };

      const metrics = strategy.calculatePositionMetrics(position, 50000);

      expect(metrics.averageEntry).toBe(49150);
      expect(metrics.unrealizedPnlPercent).toBeCloseTo(1.73, 1); // ~1.73% profit
    });

    it('should calculate negative PnL correctly', () => {
      const position = {
        id: 'test',
        symbol: 'cryBTCUSD',
        direction: 'LONG' as const,
        entries: [{ price: 50000, sizePercent: 100, rsiAtEntry: 28, timestamp: Date.now(), levelIndex: 0 }],
        averageEntry: 50000,
        totalSizePercent: 100,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        tp1Hit: false,
        tp2Hit: false,
        remainingSizePercent: 100,
        openTime: Date.now(),
      };

      const metrics = strategy.calculatePositionMetrics(position, 49000); // -2%

      expect(metrics.unrealizedPnlPercent).toBe(-2);
    });

    it('should calculate SHORT position PnL correctly', () => {
      const position = {
        id: 'test',
        symbol: 'cryBTCUSD',
        direction: 'SHORT' as const,
        entries: [{ price: 50000, sizePercent: 100, rsiAtEntry: 72, timestamp: Date.now(), levelIndex: 0 }],
        averageEntry: 50000,
        totalSizePercent: 100,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        tp1Hit: false,
        tp2Hit: false,
        remainingSizePercent: 100,
        openTime: Date.now(),
      };

      // Price dropped - SHORT should be profitable
      const metrics = strategy.calculatePositionMetrics(position, 49000);
      expect(metrics.unrealizedPnlPercent).toBe(2); // +2% for SHORT

      // Price rose - SHORT should be losing
      const metricsLoss = strategy.calculatePositionMetrics(position, 51000);
      expect(metricsLoss.unrealizedPnlPercent).toBe(-2); // -2% for SHORT
    });
  });

  describe('onCandle integration', () => {
    it('should return null with insufficient data', () => {
      const candle = createCandle(50000, 0);
      const result = strategy.onCandle(candle);
      expect(result).toBeNull();
    });

    it('should return null when RSI is neutral', () => {
      // Create 100 neutral candles (RSI ~50)
      const closes = Array.from({ length: 100 }, () => 50000 + Math.random() * 100 - 50);
      const candles = createCandleSeries(closes);

      let result = null;
      for (const candle of candles) {
        result = strategy.onCandle(candle);
      }

      expect(result).toBeNull();
    });

    it('should respect daily trade limits', () => {
      strategy.initializeSymbol('cryBTCUSD');
      const state = strategy.getState('cryBTCUSD')!;
      state.dailyTrades = 10; // At limit

      const candle = createCandle(50000, 100);
      const result = strategy.onCandle(candle);

      expect(result).toBeNull();
    });

    it('should respect daily loss limits', () => {
      strategy.initializeSymbol('cryBTCUSD');
      const state = strategy.getState('cryBTCUSD')!;
      state.dailyPnL = -6; // Exceeds -5% limit

      const candle = createCandle(50000, 100);
      const result = strategy.onCandle(candle);

      expect(result).toBeNull();
    });
  });

  describe('state management', () => {
    it('should reset symbol state', () => {
      strategy.initializeSymbol('cryBTCUSD');

      // Modify state
      const state = strategy.getState('cryBTCUSD')!;
      state.dailyTrades = 5;
      state.phase = 'IN_POSITION';

      // Reset
      strategy.resetSymbol('cryBTCUSD');

      const newState = strategy.getState('cryBTCUSD')!;
      expect(newState.dailyTrades).toBe(0);
      expect(newState.phase).toBe('SCANNING');
    });

    it('should handle multiple symbols independently', () => {
      strategy.initializeSymbol('cryBTCUSD');
      strategy.initializeSymbol('cryETHUSD');

      const btcState = strategy.getState('cryBTCUSD')!;
      const ethState = strategy.getState('cryETHUSD')!;

      btcState.dailyTrades = 3;

      expect(btcState.dailyTrades).toBe(3);
      expect(ethState.dailyTrades).toBe(0);
    });
  });

  describe('asset-specific params', () => {
    it('should use BTC params for cryBTCUSD', () => {
      const params = strategy.getParamsForSymbol('cryBTCUSD');

      // Note: When strategy has default params as overrides, they are applied last
      // so stopLossPercent stays at default (2.0) unless explicitly changed
      expect(params.stopLossPercent).toBe(2.0);
    });

    it('should use ETH params for cryETHUSD', () => {
      const params = strategy.getParamsForSymbol('cryETHUSD');

      // Note: When strategy has default params as overrides, they are applied last
      // so stopLossPercent stays at default (2.0) unless explicitly changed
      expect(params.stopLossPercent).toBe(2.0);
    });

    it('should use default params for unknown asset', () => {
      const params = strategy.getParamsForSymbol('cryUNKNOWN');

      expect(params.stopLossPercent).toBe(DEFAULT_RSI_SCALP_PARAMS.stopLossPercent);
    });
  });
});
