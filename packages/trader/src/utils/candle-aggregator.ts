/**
 * Candle Aggregator
 *
 * Convierte velas de timeframe bajo a timeframe alto
 * Ejemplo: 1min → 5min → 15min
 */

import type { Candle } from '@deriv-bot/shared';

/**
 * Aggregate candles to higher timeframe
 *
 * @param candles - Source candles (e.g., 1min)
 * @param multiplier - Multiplier (e.g., 5 for 1min → 5min)
 * @returns Aggregated candles
 *
 * @example
 * ```typescript
 * // Convert 1min to 5min
 * const candles1m = [...]; // 1min candles
 * const candles5m = aggregateCandles(candles1m, 5);
 *
 * // Convert 5min to 15min
 * const candles15m = aggregateCandles(candles5m, 3);
 * ```
 */
export function aggregateCandles(candles: Candle[], multiplier: number): Candle[] {
    if (candles.length === 0) {
        return [];
    }

    if (multiplier <= 1) {
        throw new Error('Multiplier must be > 1');
    }

    const aggregated: Candle[] = [];

    // Process candles in chunks of 'multiplier' size
    for (let i = 0; i < candles.length; i += multiplier) {
        const chunk = candles.slice(i, i + multiplier);

        // Skip incomplete chunks at the end
        if (chunk.length < multiplier) {
            break;
        }

        const aggregatedCandle = aggregateChunk(chunk);
        aggregated.push(aggregatedCandle);
    }

    return aggregated;
}

/**
 * Aggregate a chunk of candles into a single candle
 */
function aggregateChunk(chunk: Candle[]): Candle {
    if (chunk.length === 0) {
        throw new Error('Cannot aggregate empty chunk');
    }

    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;

    return {
        asset: first.asset,
        timeframe: first.timeframe * chunk.length, // New timeframe
        timestamp: first.timestamp, // Start time of the period
        open: first.open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: last.close,
        volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0)
    };
}

/**
 * Convert 1min candles to multiple timeframes
 *
 * @param candles1m - 1min candles
 * @returns Object with candles for each timeframe
 *
 * @example
 * ```typescript
 * const candles1m = [...];
 * const { candles5m, candles15m } = convertToMultiTimeframe(candles1m);
 * ```
 */
export function convertToMultiTimeframe(candles1m: Candle[]): {
    candles1m: Candle[];
    candles5m: Candle[];
    candles15m: Candle[];
} {
    const candles5m = aggregateCandles(candles1m, 5);
    const candles15m = aggregateCandles(candles5m, 3);

    return {
        candles1m,
        candles5m,
        candles15m
    };
}

/**
 * Align timestamps across timeframes
 *
 * Given a timestamp in 1min timeframe, find the corresponding
 * candles in 5min and 15min timeframes.
 *
 * @param timestamp1m - Timestamp from 1min candle
 * @param candles5m - 5min candles
 * @param candles15m - 15min candles
 * @returns Aligned candles or null if not found
 */
export function alignTimeframes(
    timestamp1m: number,
    candles5m: Candle[],
    candles15m: Candle[]
): {
    candle5m: Candle | null;
    candle15m: Candle | null;
} {
    // Find 5min candle that contains this 1min timestamp
    const candle5m = candles5m.find(c => {
        const startTime = c.timestamp;
        const endTime = c.timestamp + (5 * 60); // 5 minutes later
        return timestamp1m >= startTime && timestamp1m < endTime;
    }) || null;

    // Find 15min candle that contains this 1min timestamp
    const candle15m = candles15m.find(c => {
        const startTime = c.timestamp;
        const endTime = c.timestamp + (15 * 60); // 15 minutes later
        return timestamp1m >= startTime && timestamp1m < endTime;
    }) || null;

    return {
        candle5m,
        candle15m
    };
}

/**
 * Get latest complete candles from each timeframe
 *
 * Ensures we're looking at complete candles (not in-progress)
 */
export function getLatestCompleteCandles(
    candles1m: Candle[],
    candles5m: Candle[],
    candles15m: Candle[],
    currentTimestamp: number
): {
    latest1m: Candle | null;
    latest5m: Candle | null;
    latest15m: Candle | null;
} {
    // Get latest complete 1min candle (not the current in-progress one)
    const latest1m = candles1m.find(c => c.timestamp < currentTimestamp - 60) || null;

    // Get latest complete 5min candle
    const latest5m = candles5m.find(c => c.timestamp < currentTimestamp - 300) || null;

    // Get latest complete 15min candle
    const latest15m = candles15m.find(c => c.timestamp < currentTimestamp - 900) || null;

    return {
        latest1m,
        latest5m,
        latest15m
    };
}

/**
 * Validate aggregated candles
 *
 * Ensures the aggregation was done correctly
 */
export function validateAggregation(
    sourceCandles: Candle[],
    aggregatedCandles: Candle[],
    multiplier: number
): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check count
    const expectedCount = Math.floor(sourceCandles.length / multiplier);
    if (aggregatedCandles.length !== expectedCount) {
        errors.push(`Expected ${expectedCount} candles, got ${aggregatedCandles.length}`);
    }

    // Check each aggregated candle
    for (let i = 0; i < aggregatedCandles.length; i++) {
        const aggCandle = aggregatedCandles[i]!;
        const sourceStart = i * multiplier;
        const sourceChunk = sourceCandles.slice(sourceStart, sourceStart + multiplier);

        // Validate open
        if (aggCandle.open !== sourceChunk[0]?.open) {
            errors.push(`Candle ${i}: Invalid open price`);
        }

        // Validate close
        if (aggCandle.close !== sourceChunk[sourceChunk.length - 1]?.close) {
            errors.push(`Candle ${i}: Invalid close price`);
        }

        // Validate high
        const expectedHigh = Math.max(...sourceChunk.map(c => c.high));
        if (Math.abs(aggCandle.high - expectedHigh) > 0.0001) {
            errors.push(`Candle ${i}: Invalid high price`);
        }

        // Validate low
        const expectedLow = Math.min(...sourceChunk.map(c => c.low));
        if (Math.abs(aggCandle.low - expectedLow) > 0.0001) {
            errors.push(`Candle ${i}: Invalid low price`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
