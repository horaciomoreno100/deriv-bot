/**
 * Tests for Candle Aggregator
 *
 * TDD para asegurar que la agregación de velas funciona correctamente
 */

import { describe, it, expect } from 'vitest';
import type { Candle } from '@deriv-bot/shared';
import {
    aggregateCandles,
    convertToMultiTimeframe,
    alignTimeframes,
    validateAggregation
} from './candle-aggregator.js';

/**
 * Helper: Create test candles
 */
function createCandles(count: number, startTime: number = 1000000): Candle[] {
    const candles: Candle[] = [];

    for (let i = 0; i < count; i++) {
        const timestamp = startTime + (i * 60); // 1min intervals
        const basePrice = 1000 + i;

        candles.push({
            asset: 'TEST',
            timeframe: 60,
            timestamp,
            open: basePrice,
            high: basePrice + 2,
            low: basePrice - 2,
            close: basePrice + 1,
            volume: 100
        });
    }

    return candles;
}

describe('Candle Aggregation', () => {
    describe('aggregateCandles', () => {
        it('should aggregate 5 x 1min candles into 1 x 5min candle', () => {
            const candles1m = createCandles(5);
            const candles5m = aggregateCandles(candles1m, 5);

            expect(candles5m).toHaveLength(1);

            const candle = candles5m[0]!;
            expect(candle.open).toBe(candles1m[0]!.open); // First open
            expect(candle.close).toBe(candles1m[4]!.close); // Last close
            expect(candle.high).toBe(Math.max(...candles1m.map(c => c.high)));
            expect(candle.low).toBe(Math.min(...candles1m.map(c => c.low)));
            expect(candle.timestamp).toBe(candles1m[0]!.timestamp);
            expect(candle.timeframe).toBe(300); // 5 * 60
        });

        it('should aggregate 10 x 1min candles into 2 x 5min candles', () => {
            const candles1m = createCandles(10);
            const candles5m = aggregateCandles(candles1m, 5);

            expect(candles5m).toHaveLength(2);

            // First 5min candle
            expect(candles5m[0]!.open).toBe(candles1m[0]!.open);
            expect(candles5m[0]!.close).toBe(candles1m[4]!.close);

            // Second 5min candle
            expect(candles5m[1]!.open).toBe(candles1m[5]!.open);
            expect(candles5m[1]!.close).toBe(candles1m[9]!.close);
        });

        it('should skip incomplete chunks at the end', () => {
            const candles1m = createCandles(12); // 12 candles
            const candles5m = aggregateCandles(candles1m, 5);

            // 12 / 5 = 2 complete + 2 incomplete
            expect(candles5m).toHaveLength(2); // Only complete chunks
        });

        it('should handle empty input', () => {
            const candles = aggregateCandles([], 5);
            expect(candles).toHaveLength(0);
        });

        it('should throw error for invalid multiplier', () => {
            const candles1m = createCandles(5);

            expect(() => aggregateCandles(candles1m, 0)).toThrow();
            expect(() => aggregateCandles(candles1m, 1)).toThrow();
            expect(() => aggregateCandles(candles1m, -1)).toThrow();
        });

        it('should correctly calculate high across chunk', () => {
            const candles: Candle[] = [
                { asset: 'TEST', timeframe: 60, timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1060, open: 102, high: 110, low: 100, close: 108, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1120, open: 108, high: 112, low: 105, close: 109, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1180, open: 109, high: 115, low: 107, close: 111, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1240, open: 111, high: 113, low: 108, close: 110, volume: 100 }
            ];

            const aggregated = aggregateCandles(candles, 5);

            expect(aggregated[0]!.high).toBe(115); // Max of all highs
        });

        it('should correctly calculate low across chunk', () => {
            const candles: Candle[] = [
                { asset: 'TEST', timeframe: 60, timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1060, open: 102, high: 110, low: 90, close: 108, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1120, open: 108, high: 112, low: 105, close: 109, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1180, open: 109, high: 115, low: 107, close: 111, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1240, open: 111, high: 113, low: 108, close: 110, volume: 100 }
            ];

            const aggregated = aggregateCandles(candles, 5);

            expect(aggregated[0]!.low).toBe(90); // Min of all lows
        });

        it('should sum volumes correctly', () => {
            const candles: Candle[] = [
                { asset: 'TEST', timeframe: 60, timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 50 },
                { asset: 'TEST', timeframe: 60, timestamp: 1060, open: 102, high: 110, low: 100, close: 108, volume: 75 },
                { asset: 'TEST', timeframe: 60, timestamp: 1120, open: 108, high: 112, low: 105, close: 109, volume: 100 },
                { asset: 'TEST', timeframe: 60, timestamp: 1180, open: 109, high: 115, low: 107, close: 111, volume: 60 },
                { asset: 'TEST', timeframe: 60, timestamp: 1240, open: 111, high: 113, low: 108, close: 110, volume: 85 }
            ];

            const aggregated = aggregateCandles(candles, 5);

            expect(aggregated[0]!.volume).toBe(370); // 50 + 75 + 100 + 60 + 85
        });
    });

    describe('convertToMultiTimeframe', () => {
        it('should convert 1min to 5min and 15min', () => {
            const candles1m = createCandles(15); // 15 x 1min
            const result = convertToMultiTimeframe(candles1m);

            expect(result.candles1m).toHaveLength(15);
            expect(result.candles5m).toHaveLength(3);  // 15 / 5 = 3
            expect(result.candles15m).toHaveLength(1); // 3 / 3 = 1
        });

        it('should handle 30 candles correctly', () => {
            const candles1m = createCandles(30); // 30 x 1min
            const result = convertToMultiTimeframe(candles1m);

            expect(result.candles1m).toHaveLength(30);
            expect(result.candles5m).toHaveLength(6);  // 30 / 5 = 6
            expect(result.candles15m).toHaveLength(2); // 6 / 3 = 2
        });

        it('should maintain price continuity across timeframes', () => {
            const candles1m = createCandles(15);
            const result = convertToMultiTimeframe(candles1m);

            // First 5min candle should have same open as first 1min candle
            expect(result.candles5m[0]!.open).toBe(result.candles1m[0]!.open);

            // First 15min candle should have same open as first 5min candle
            expect(result.candles15m[0]!.open).toBe(result.candles5m[0]!.open);

            // Last close should match
            expect(result.candles5m[0]!.close).toBe(result.candles1m[4]!.close);
            expect(result.candles15m[0]!.close).toBe(result.candles5m[2]!.close);
        });
    });

    describe('alignTimeframes', () => {
        it('should find corresponding candles in higher timeframes', () => {
            const candles1m = createCandles(15);
            const candles5m = aggregateCandles(candles1m, 5);
            const candles15m = aggregateCandles(candles5m, 3);

            // Check alignment for a 1min timestamp
            const timestamp1m = candles1m[7]!.timestamp; // 8th candle (index 7)
            const aligned = alignTimeframes(timestamp1m, candles5m, candles15m);

            // 8th 1min candle (index 7) should be in 2nd 5min candle (index 1)
            expect(aligned.candle5m).not.toBeNull();
            expect(aligned.candle5m?.timestamp).toBe(candles5m[1]!.timestamp);

            // Should be in first 15min candle
            expect(aligned.candle15m).not.toBeNull();
            expect(aligned.candle15m?.timestamp).toBe(candles15m[0]!.timestamp);
        });

        it('should return null when candles not found', () => {
            const candles1m = createCandles(15);
            const candles5m = aggregateCandles(candles1m, 5);
            const candles15m = aggregateCandles(candles5m, 3);

            // Timestamp way in the future
            const futureTimestamp = candles1m[candles1m.length - 1]!.timestamp + 100000;
            const aligned = alignTimeframes(futureTimestamp, candles5m, candles15m);

            expect(aligned.candle5m).toBeNull();
            expect(aligned.candle15m).toBeNull();
        });
    });

    describe('validateAggregation', () => {
        it('should validate correct aggregation', () => {
            const source = createCandles(10);
            const aggregated = aggregateCandles(source, 5);

            const validation = validateAggregation(source, aggregated, 5);

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        });

        it('should detect incorrect count', () => {
            const source = createCandles(10);
            const aggregated = aggregateCandles(source, 5);

            // Remove one candle to make it incorrect
            aggregated.pop();

            const validation = validateAggregation(source, aggregated, 5);

            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
        });

        it('should detect incorrect open price', () => {
            const source = createCandles(5);
            const aggregated = aggregateCandles(source, 5);

            // Corrupt the open price
            aggregated[0]!.open = 999999;

            const validation = validateAggregation(source, aggregated, 5);

            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('Invalid open'))).toBe(true);
        });

        it('should detect incorrect close price', () => {
            const source = createCandles(5);
            const aggregated = aggregateCandles(source, 5);

            // Corrupt the close price
            aggregated[0]!.close = 999999;

            const validation = validateAggregation(source, aggregated, 5);

            expect(validation.valid).toBe(false);
            expect(validation.errors.some(e => e.includes('Invalid close'))).toBe(true);
        });
    });

    describe('Real-world scenario', () => {
        it('should correctly aggregate realistic price data', () => {
            // Simulate realistic 1min candles
            const candles1m: Candle[] = [
                { asset: 'R_25', timeframe: 60, timestamp: 1000000, open: 1234.50, high: 1235.20, low: 1233.80, close: 1234.90, volume: 150 },
                { asset: 'R_25', timeframe: 60, timestamp: 1000060, open: 1234.90, high: 1236.50, low: 1234.20, close: 1236.00, volume: 200 },
                { asset: 'R_25', timeframe: 60, timestamp: 1000120, open: 1236.00, high: 1237.80, low: 1235.50, close: 1237.20, volume: 180 },
                { asset: 'R_25', timeframe: 60, timestamp: 1000180, open: 1237.20, high: 1238.00, low: 1236.80, close: 1237.50, volume: 170 },
                { asset: 'R_25', timeframe: 60, timestamp: 1000240, open: 1237.50, high: 1238.50, low: 1237.00, close: 1238.20, volume: 160 }
            ];

            const candles5m = aggregateCandles(candles1m, 5);

            expect(candles5m).toHaveLength(1);

            const candle = candles5m[0]!;
            expect(candle.open).toBe(1234.50);          // First open
            expect(candle.close).toBe(1238.20);         // Last close
            expect(candle.high).toBe(1238.50);          // Highest high
            expect(candle.low).toBe(1233.80);           // Lowest low
            expect(candle.volume).toBe(860);            // Sum of volumes
            expect(candle.timestamp).toBe(1000000);     // First timestamp
            expect(candle.timeframe).toBe(300);         // 5 * 60
        });
    });
});
