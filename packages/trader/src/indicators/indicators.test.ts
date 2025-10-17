/**
 * Tests for Technical Indicators
 *
 * TDD para asegurar que los indicadores se calculan correctamente
 */

import { describe, it, expect } from 'vitest';
import type { Candle } from '@deriv-bot/shared';

/**
 * Helper: Create test candles
 */
function createTestCandles(closes: number[]): Candle[] {
    return closes.map((close, i) => ({
        asset: 'TEST',
        timeframe: 60,
        timestamp: 1000000 + i * 60,
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume: 100
    }));
}

/**
 * Calculate RSI
 */
function calculateRSI(candles: Candle[], period: number = 14): number | null {
    if (candles.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = candles[candles.length - i].close - candles[candles.length - i - 1].close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Calculate SMA
 */
function calculateSMA(candles: Candle[], period: number): number | null {
    if (candles.length < period) return null;

    const recentCandles = candles.slice(-period);
    return recentCandles.reduce((sum, candle) => sum + candle.close, 0) / period;
}

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(candles: Candle[], period: number, stdDev: number): { upper: number; middle: number; lower: number } | null {
    if (candles.length < period) return null;

    const recentCandles = candles.slice(-period);
    const closes = recentCandles.map(c => c.close);
    const sma = closes.reduce((sum, close) => sum + close, 0) / period;

    const variance = closes.reduce((sum, close) => sum + Math.pow(close - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    return {
        upper: sma + (stdDev * standardDeviation),
        middle: sma,
        lower: sma - (stdDev * standardDeviation)
    };
}

/**
 * Calculate Stochastic
 */
function calculateStochastic(candles: Candle[], kPeriod: number, dPeriod: number): { k: number; d: number } | null {
    if (candles.length < kPeriod + dPeriod) return null;

    // Calculate %K
    const recentCandles = candles.slice(-kPeriod);
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    const currentClose = candles[candles.length - 1].close;

    if (highestHigh === lowestLow) return { k: 50, d: 50 };

    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;

    // Calculate %D (SMA of %K)
    const kValues: number[] = [];
    for (let i = 0; i < dPeriod; i++) {
        const slice = candles.slice(-(kPeriod + i + 1), candles.length - i || undefined);
        if (slice.length < kPeriod) continue;

        const sliceHighest = Math.max(...slice.map(c => c.high));
        const sliceLowest = Math.min(...slice.map(c => c.low));
        const sliceClose = slice[slice.length - 1].close;

        if (sliceHighest !== sliceLowest) {
            kValues.push(((sliceClose - sliceLowest) / (sliceHighest - sliceLowest)) * 100);
        }
    }

    const d = kValues.length > 0 ? kValues.reduce((sum, v) => sum + v, 0) / kValues.length : 50;

    return { k, d };
}

describe('RSI Indicator', () => {
    it('should return null when not enough data', () => {
        const candles = createTestCandles([100, 105, 110]);
        const rsi = calculateRSI(candles, 14);
        expect(rsi).toBeNull();
    });

    it('should calculate RSI correctly for uptrend', () => {
        // Create 15 candles with increasing prices (gains only)
        const candles = createTestCandles([
            100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114
        ]);
        const rsi = calculateRSI(candles, 14);

        expect(rsi).not.toBeNull();
        expect(rsi).toBeGreaterThan(70); // Should be overbought
    });

    it('should calculate RSI correctly for downtrend', () => {
        // Create 15 candles with decreasing prices (losses only)
        const candles = createTestCandles([
            114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100
        ]);
        const rsi = calculateRSI(candles, 14);

        expect(rsi).not.toBeNull();
        expect(rsi).toBeLessThan(30); // Should be oversold
    });

    it('should return 50 for sideways market', () => {
        // Alternating up/down by same amount
        const candles = createTestCandles([
            100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100
        ]);
        const rsi = calculateRSI(candles, 14);

        expect(rsi).not.toBeNull();
        expect(rsi).toBeGreaterThanOrEqual(45);
        expect(rsi).toBeLessThanOrEqual(55); // Should be near 50
    });
});

describe('SMA Indicator', () => {
    it('should return null when not enough data', () => {
        const candles = createTestCandles([100, 105]);
        const sma = calculateSMA(candles, 3);
        expect(sma).toBeNull();
    });

    it('should calculate SMA correctly', () => {
        const candles = createTestCandles([100, 110, 120]);
        const sma = calculateSMA(candles, 3);

        expect(sma).toBe(110); // (100 + 110 + 120) / 3 = 110
    });

    it('should only use last N candles', () => {
        const candles = createTestCandles([50, 60, 100, 110, 120]);
        const sma = calculateSMA(candles, 3);

        expect(sma).toBe(110); // Only last 3: (100 + 110 + 120) / 3 = 110
    });
});

describe('Bollinger Bands', () => {
    it('should return null when not enough data', () => {
        const candles = createTestCandles([100, 105]);
        const bb = calculateBollingerBands(candles, 20, 2);
        expect(bb).toBeNull();
    });

    it('should calculate BB correctly', () => {
        // Create 20 candles around 100
        const candles = createTestCandles(Array(20).fill(100));
        const bb = calculateBollingerBands(candles, 20, 2);

        expect(bb).not.toBeNull();
        expect(bb!.middle).toBe(100);
        // With no variance, upper and lower should equal middle
        expect(bb!.upper).toBeCloseTo(100, 2);
        expect(bb!.lower).toBeCloseTo(100, 2);
    });

    it('should have upper > middle > lower', () => {
        const candles = createTestCandles([
            95, 96, 97, 98, 99, 100, 101, 102, 103, 104,
            105, 104, 103, 102, 101, 100, 99, 98, 97, 96
        ]);
        const bb = calculateBollingerBands(candles, 20, 2);

        expect(bb).not.toBeNull();
        expect(bb!.upper).toBeGreaterThan(bb!.middle);
        expect(bb!.middle).toBeGreaterThan(bb!.lower);
    });
});

describe('Stochastic Oscillator', () => {
    it('should return null when not enough data', () => {
        const candles = createTestCandles([100, 105, 110]);
        const stoch = calculateStochastic(candles, 14, 3);
        expect(stoch).toBeNull();
    });

    it('should return 100 when price at highest high', () => {
        // Price climbing to 120 (highest)
        const candles = createTestCandles([
            100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 120, 120, 120, 120, 120, 120
        ]);
        const stoch = calculateStochastic(candles, 14, 3);

        expect(stoch).not.toBeNull();
        expect(stoch!.k).toBeGreaterThan(90); // Should be near 100
    });

    it('should return 0 when price at lowest low', () => {
        // Price dropping to 80 (lowest)
        const candles = createTestCandles([
            100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 80, 80, 80, 80, 80, 80
        ]);
        const stoch = calculateStochastic(candles, 14, 3);

        expect(stoch).not.toBeNull();
        expect(stoch!.k).toBeLessThan(10); // Should be near 0
    });

    it('should return 50 when price at middle', () => {
        // Create range 100-120, current at 110 (middle)
        const candles = createTestCandles([
            100, 120, 100, 120, 100, 120, 100, 120, 100, 120, 100, 120, 100, 120, 110, 110, 110
        ]);
        const stoch = calculateStochastic(candles, 14, 3);

        expect(stoch).not.toBeNull();
        expect(stoch!.k).toBeGreaterThan(40);
        expect(stoch!.k).toBeLessThan(60); // Should be near 50
    });
});
