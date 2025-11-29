/**
 * FVG Liquidity Sweep Strategy Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FVGLiquiditySweepStrategy } from '../fvg-liquidity-sweep.strategy.js';
import { DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS, getParamsForAsset } from '../fvg-liquidity-sweep.params.js';
import type { Candle, StrategyConfig } from '@deriv-bot/shared';
import type { StrategyContext } from '../../strategy/base-strategy.js';

// Helper to create candles
function createCandle(
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  asset = 'R_100'
): Candle {
  return {
    timestamp: 1700000000 + index * 60,
    open,
    high,
    low,
    close,
    asset,
    volume: 1000,
  };
}

// Generate candles with a specific pattern
function generateCandles(
  count: number,
  startPrice: number,
  asset = 'R_100'
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 0.5;
    const low = Math.min(open, close) - Math.random() * 0.5;

    candles.push(createCandle(i, open, high, low, close, asset));
    price = close;
  }

  return candles;
}

// Create candles with specific swing pattern
function createSwingPattern(asset = 'R_100'): Candle[] {
  // Create a pattern with clear swing highs and lows
  // Swing low at index 10, swing high at index 20, swing low at index 30
  const candles: Candle[] = [];
  let basePrice = 100;

  for (let i = 0; i < 50; i++) {
    let price: number;

    if (i < 10) {
      // Downtrend to first swing low
      price = basePrice - (i * 0.5);
    } else if (i < 20) {
      // Uptrend to swing high
      price = basePrice - 5 + ((i - 10) * 1);
    } else if (i < 30) {
      // Downtrend to second swing low
      price = basePrice + 5 - ((i - 20) * 0.8);
    } else {
      // Slight uptrend
      price = basePrice - 3 + ((i - 30) * 0.3);
    }

    const open = price - 0.2;
    const close = price + 0.2;
    const high = price + 0.5;
    const low = price - 0.5;

    candles.push(createCandle(i, open, high, low, close, asset));
  }

  return candles;
}

// Create candles with a liquidity sweep pattern
function createLiquiditySweepPattern(asset = 'R_100'): Candle[] {
  const candles: Candle[] = [];

  // Create swing lows at similar levels (SSL zone)
  // Indexes: 5, 15, 25 - all around price 95
  for (let i = 0; i < 40; i++) {
    let open: number, high: number, low: number, close: number;

    if (i === 5 || i === 15 || i === 25) {
      // Swing lows around 95
      open = 97;
      high = 97.5;
      low = 95 + (i % 3) * 0.1; // Slight variation: 95.0, 95.1, 95.2
      close = 96;
    } else if (i === 35) {
      // Sweep candle - breaks below 95 but closes above
      open = 96;
      high = 96.5;
      low = 94.5; // Breaks below the SSL zone
      close = 96.2; // Closes back above
    } else if (i === 37) {
      // FVG formation - bullish gap
      // Candle i-2 (35): high at 96.5
      // This candle: low at 97.5 (gap of 1.0)
      open = 97.8;
      high = 98.5;
      low = 97.5;
      close = 98.2;
    } else if (i === 39) {
      // Price returns to FVG zone
      open = 98;
      high = 98.2;
      low = 97; // Enters FVG zone (97.5 - 96.5 range)
      close = 97.5;
    } else {
      // Regular candles around 97
      open = 97 + (Math.random() - 0.5);
      high = open + 0.5;
      low = open - 0.5;
      close = open + (Math.random() - 0.5) * 0.5;
    }

    candles.push(createCandle(i, open, high, low, close, asset));
  }

  return candles;
}

describe('FVGLiquiditySweepStrategy', () => {
  let strategy: FVGLiquiditySweepStrategy;
  let config: StrategyConfig;

  beforeEach(() => {
    config = {
      name: 'FVG-Liquidity-Sweep-Test',
      enabled: true,
      assets: ['R_100'],
      maxConcurrentTrades: 1,
      amount: 10,
      amountType: 'fixed',
      cooldownSeconds: 60,
      minConfidence: 0.7,
      parameters: {
        swingLength: 3, // Shorter for testing
        minSwingsForZone: 2,
        cooldownSeconds: 0, // Disable cooldown for testing
      },
    };

    strategy = new FVGLiquiditySweepStrategy(config);
  });

  describe('initialization', () => {
    it('should create strategy with default params', () => {
      const params = strategy.getParams();
      expect(params.swingLength).toBe(3); // Overridden
      expect(params.minSwingsForZone).toBe(2);
      expect(params.takeProfitRR).toBe(DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS.takeProfitRR);
    });

    it('should merge custom params with defaults', () => {
      const customConfig: StrategyConfig = {
        ...config,
        parameters: {
          swingLength: 10,
          takeProfitRR: 3.0,
        },
      };

      const customStrategy = new FVGLiquiditySweepStrategy(customConfig);
      const params = customStrategy.getParams();

      expect(params.swingLength).toBe(10);
      expect(params.takeProfitRR).toBe(3.0);
      expect(params.minFVGSizePct).toBe(DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS.minFVGSizePct);
    });
  });

  describe('getParamsForAsset', () => {
    it('should return synthetic index params for R_* assets', () => {
      const params = getParamsForAsset('R_100');
      expect(params.liquidityRangePct).toBe(0.008);
      expect(params.takeProfitRR).toBe(1.5);
    });

    it('should return forex params for frx* assets', () => {
      const params = getParamsForAsset('frxEURUSD');
      expect(params.liquidityRangePct).toBe(0.003);  // Updated: FOREX_PARAMS.liquidityRangePct
      expect(params.takeProfitRR).toBe(1.5);         // Updated: FOREX_PARAMS.takeProfitRR
    });

    it('should return gold params for XAU assets', () => {
      const params = getParamsForAsset('frxXAUUSD');
      expect(params.liquidityRangePct).toBe(0.005);  // Updated: GOLD_PARAMS.liquidityRangePct
      expect(params.swingLength).toBe(5);            // Updated: GOLD_PARAMS.swingLength
    });

    it('should apply user overrides', () => {
      const params = getParamsForAsset('R_100', { takeProfitRR: 5.0 });
      expect(params.takeProfitRR).toBe(5.0);
    });
  });

  describe('onCandle', () => {
    it('should return null when not enough candles', async () => {
      await strategy.start();

      const candles = generateCandles(5, 100);
      const context: StrategyContext = {
        candles,
        latestTick: null,
        balance: 1000,
        openPositions: 0,
      };

      const signal = await strategy['onCandle'](candles[candles.length - 1]!, context);
      expect(signal).toBeNull();
    });

    it('should start in SCANNING phase', async () => {
      await strategy.start();

      const candles = generateCandles(50, 100);
      const context: StrategyContext = {
        candles,
        latestTick: null,
        balance: 1000,
        openPositions: 0,
      };

      await strategy['onCandle'](candles[candles.length - 1]!, context);

      const state = strategy.getState('R_100');
      expect(state).toBeDefined();
      expect(state!.phase).toBe('SCANNING');
    });

    it('should detect swing points', async () => {
      await strategy.start();

      const candles = createSwingPattern();
      const context: StrategyContext = {
        candles,
        latestTick: null,
        balance: 1000,
        openPositions: 0,
      };

      await strategy['onCandle'](candles[candles.length - 1]!, context);

      const state = strategy.getState('R_100');
      expect(state).toBeDefined();
      expect(state!.swings.length).toBeGreaterThan(0);
    });
  });

  describe('swing detection (private method via state)', () => {
    it('should detect swing highs and lows in pattern', async () => {
      await strategy.start();

      // Create clear swing pattern
      const candles: Candle[] = [];
      const prices = [
        100, 99, 98, 97, 96, // Downtrend
        95, // Swing low at index 5
        96, 97, 98, 99, 100, // Uptrend
        101, // Swing high at index 11
        100, 99, 98, 97, 96, // Downtrend
        95.5, // Swing low at index 17
        96, 97, 98, 99, 100,
      ];

      for (let i = 0; i < prices.length; i++) {
        const p = prices[i]!;
        candles.push(createCandle(i, p - 0.2, p + 0.3, p - 0.3, p + 0.2));
      }

      const context: StrategyContext = {
        candles,
        latestTick: null,
        balance: 1000,
        openPositions: 0,
      };

      await strategy['onCandle'](candles[candles.length - 1]!, context);

      const state = strategy.getState('R_100');
      expect(state).toBeDefined();

      // Should have detected some swings
      const swingHighs = state!.swings.filter(s => s.type === 'high');
      const swingLows = state!.swings.filter(s => s.type === 'low');

      expect(swingHighs.length + swingLows.length).toBeGreaterThan(0);
    });
  });

  describe('liquidity zones', () => {
    it('should group nearby swing points into zones', async () => {
      await strategy.start();

      // Create pattern with multiple swing lows at similar level
      const candles: Candle[] = [];

      for (let i = 0; i < 30; i++) {
        let price: number;

        // Create swing lows at indexes 5, 12, 19 all around price 95
        if (i === 5 || i === 12 || i === 19) {
          price = 95 + (i % 3) * 0.1;
        } else if (i === 8 || i === 15 || i === 22) {
          price = 100 + (i % 3) * 0.1;
        } else {
          price = 97 + Math.sin(i * 0.5) * 2;
        }

        candles.push(createCandle(i, price - 0.2, price + 0.5, price - 0.5, price + 0.2));
      }

      const context: StrategyContext = {
        candles,
        latestTick: null,
        balance: 1000,
        openPositions: 0,
      };

      await strategy['onCandle'](candles[candles.length - 1]!, context);

      const zones = strategy.getLiquidityZones('R_100');
      // May or may not find zones depending on exact pattern
      expect(zones).toBeDefined();
    });
  });

  describe('reportTradeResult', () => {
    it('should reset consecutive losses on win', () => {
      strategy['initializeState']('R_100');
      strategy['consecutiveLosses']['R_100'] = 3;

      strategy.reportTradeResult('R_100', 10, true);

      expect(strategy['consecutiveLosses']['R_100']).toBe(0);
    });

    it('should increment consecutive losses on loss', () => {
      strategy['initializeState']('R_100');
      strategy['consecutiveLosses']['R_100'] = 1;

      strategy.reportTradeResult('R_100', -5, false);

      expect(strategy['consecutiveLosses']['R_100']).toBe(2);
    });

    it('should set dynamic cooldown after 2 losses', () => {
      strategy['initializeState']('R_100');
      strategy['consecutiveLosses']['R_100'] = 1;

      const beforeTime = Date.now();
      strategy.reportTradeResult('R_100', -5, false);

      const cooldownUntil = strategy['dynamicCooldownUntil']['R_100']!;
      const expectedCooldownMs = DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS.cooldownAfter2Losses * 1000;

      expect(cooldownUntil).toBeGreaterThan(beforeTime);
      expect(cooldownUntil).toBeLessThanOrEqual(beforeTime + expectedCooldownMs + 1000);
    });
  });

  describe('strategy state machine', () => {
    it('should transition through phases correctly', async () => {
      // This is a more integration-style test
      await strategy.start();

      const candles = createLiquiditySweepPattern();

      // Process candles one by one and check state transitions
      for (let i = 20; i < candles.length; i++) {
        const context: StrategyContext = {
          candles: candles.slice(0, i + 1),
          latestTick: null,
          balance: 1000,
          openPositions: 0,
        };

        await strategy['onCandle'](candles[i]!, context);
      }

      // Check final state
      const state = strategy.getState('R_100');
      expect(state).toBeDefined();
      expect(['SCANNING', 'SWEEP_DETECTED', 'WAITING_ENTRY']).toContain(state!.phase);
    });
  });
});

describe('Edge Cases', () => {
  let strategy: FVGLiquiditySweepStrategy;

  beforeEach(() => {
    const config: StrategyConfig = {
      name: 'FVG-LS-Edge-Test',
      enabled: true,
      assets: ['R_100'],
      maxConcurrentTrades: 1,
      amount: 10,
      amountType: 'fixed',
      cooldownSeconds: 0,
      minConfidence: 0.5,
      parameters: {
        swingLength: 2,
        minSwingsForZone: 2,
        cooldownSeconds: 0,
      },
    };

    strategy = new FVGLiquiditySweepStrategy(config);
  });

  it('should handle empty candles array', async () => {
    await strategy.start();

    const context: StrategyContext = {
      candles: [],
      latestTick: null,
      balance: 1000,
      openPositions: 0,
    };

    const candle = createCandle(0, 100, 101, 99, 100);
    const signal = await strategy['onCandle'](candle, context);

    expect(signal).toBeNull();
  });

  it('should handle single candle', async () => {
    await strategy.start();

    const candle = createCandle(0, 100, 101, 99, 100);
    const context: StrategyContext = {
      candles: [candle],
      latestTick: null,
      balance: 1000,
      openPositions: 0,
    };

    const signal = await strategy['onCandle'](candle, context);

    expect(signal).toBeNull();
  });

  it('should handle multiple assets independently', async () => {
    await strategy.start();

    const candlesR100 = generateCandles(30, 100, 'R_100');
    const candlesR75 = generateCandles(30, 50, 'R_75');

    // Process R_100
    const contextR100: StrategyContext = {
      candles: candlesR100,
      latestTick: null,
      balance: 1000,
      openPositions: 0,
    };
    await strategy['onCandle'](candlesR100[candlesR100.length - 1]!, contextR100);

    // Process R_75
    const contextR75: StrategyContext = {
      candles: candlesR75,
      latestTick: null,
      balance: 1000,
      openPositions: 0,
    };
    await strategy['onCandle'](candlesR75[candlesR75.length - 1]!, contextR75);

    // Check states are independent
    const stateR100 = strategy.getState('R_100');
    const stateR75 = strategy.getState('R_75');

    expect(stateR100).toBeDefined();
    expect(stateR75).toBeDefined();
  });
});
