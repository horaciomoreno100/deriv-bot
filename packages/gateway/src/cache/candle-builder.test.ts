import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CandleBuilder } from './candle-builder.js';
import type { Tick } from '@deriv-bot/shared';

describe('CandleBuilder', () => {
  let builder: CandleBuilder;

  beforeEach(() => {
    builder = new CandleBuilder({
      asset: 'R_100',
      timeframe: 60, // 1 minute
    });
  });

  it('should create candle from first tick', () => {
    const tick: Tick = {
      asset: 'R_100',
      price: 1234.56,
      timestamp: 1704067200000, // 2024-01-01 00:00:00
    };

    builder.addTick(tick);

    const candle = builder.getCurrentCandle();
    expect(candle).toBeDefined();
    expect(candle?.open).toBe(1234.56);
    expect(candle?.high).toBe(1234.56);
    expect(candle?.low).toBe(1234.56);
    expect(candle?.close).toBe(1234.56);
  });

  it('should update candle with new ticks', () => {
    const tick1: Tick = {
      asset: 'R_100',
      price: 1234.56,
      timestamp: 1704067200000,
    };

    const tick2: Tick = {
      asset: 'R_100',
      price: 1235.00, // Higher
      timestamp: 1704067210000, // +10s
    };

    const tick3: Tick = {
      asset: 'R_100',
      price: 1233.00, // Lower
      timestamp: 1704067220000, // +20s
    };

    builder.addTick(tick1);
    builder.addTick(tick2);
    builder.addTick(tick3);

    const candle = builder.getCurrentCandle();
    expect(candle?.open).toBe(1234.56); // First price
    expect(candle?.high).toBe(1235.00); // Highest
    expect(candle?.low).toBe(1233.00); // Lowest
    expect(candle?.close).toBe(1233.00); // Last price
  });

  it('should emit candle:update event on tick', () => {
    const updateSpy = vi.fn();
    builder.on('candle:update', updateSpy);

    const tick: Tick = {
      asset: 'R_100',
      price: 1234.56,
      timestamp: 1704067200000,
    };

    builder.addTick(tick);

    expect(updateSpy).toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        open: 1234.56,
        close: 1234.56,
      })
    );
  });

  it('should close candle and start new one after timeframe', () => {
    const closedSpy = vi.fn();
    builder.on('candle:closed', closedSpy);

    // First candle (00:00:00)
    const tick1: Tick = {
      asset: 'R_100',
      price: 1234.56,
      timestamp: 1704067200000, // 00:00:00
    };

    builder.addTick(tick1);

    // Second candle (00:01:00) - should close first
    const tick2: Tick = {
      asset: 'R_100',
      price: 1235.00,
      timestamp: 1704067260000, // 00:01:00
    };

    builder.addTick(tick2);

    // Should have closed first candle
    expect(closedSpy).toHaveBeenCalled();
    expect(closedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        open: 1234.56,
        close: 1234.56,
      })
    );

    // Current candle should be the new one
    const current = builder.getCurrentCandle();
    expect(current?.open).toBe(1235.00);
    expect(current?.close).toBe(1235.00);
  });

  it('should handle multiple timeframes', () => {
    const builder5m = new CandleBuilder({
      asset: 'R_100',
      timeframe: 300, // 5 minutes
    });

    // Ticks within same 5-minute window
    const tick1: Tick = {
      asset: 'R_100',
      price: 1234.0,
      timestamp: 1704067200000, // 00:00:00
    };

    const tick2: Tick = {
      asset: 'R_100',
      price: 1235.0,
      timestamp: 1704067440000, // 00:04:00 (still same candle)
    };

    const tick3: Tick = {
      asset: 'R_100',
      price: 1236.0,
      timestamp: 1704067500000, // 00:05:00 (new candle)
    };

    const closedSpy = vi.fn();
    builder5m.on('candle:closed', closedSpy);

    builder5m.addTick(tick1);
    builder5m.addTick(tick2);

    // Should NOT have closed yet
    expect(closedSpy).not.toHaveBeenCalled();

    builder5m.addTick(tick3);

    // Should have closed now
    expect(closedSpy).toHaveBeenCalled();
  });

  it('should calculate candle timestamp correctly', () => {
    // Tick at 00:00:45
    const tick: Tick = {
      asset: 'R_100',
      price: 1234.56,
      timestamp: 1704067245000, // 00:00:45
    };

    builder.addTick(tick);

    const candle = builder.getCurrentCandle();

    // Candle timestamp should be rounded down to 00:00:00
    expect(candle?.timestamp).toBe(1704067200); // 00:00:00 in seconds
  });

  it('should get closed candles', () => {
    // Add ticks to create and close multiple candles
    for (let i = 0; i < 5; i++) {
      const tick: Tick = {
        asset: 'R_100',
        price: 1234 + i,
        timestamp: 1704067200000 + i * 60000, // Each minute
      };
      builder.addTick(tick);
    }

    const closed = builder.getClosedCandles();

    // Should have 4 closed candles (5th is current)
    expect(closed).toHaveLength(4);
    expect(closed[0].open).toBe(1234);
    expect(closed[3].open).toBe(1237);
  });
});
