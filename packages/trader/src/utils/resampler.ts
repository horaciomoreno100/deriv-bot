/**
 * Multi-Timeframe (MTF) Resampler
 *
 * Utility to resample M5 candle data to higher timeframes (M15, M30, H1, H4).
 * Essential for MTF analysis where filter TF != entry TF.
 *
 * Usage:
 * ```typescript
 * const m5Candles = loadCSV('EURUSD_M5.csv');
 * const h1Candles = resampleCandles(m5Candles, 'H1');
 * ```
 */

import type { Candle } from '@deriv-bot/shared';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported timeframes
 */
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

/**
 * Timeframe in seconds
 */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
};

/**
 * Resampling ratio (how many source candles per target candle)
 */
export const RESAMPLE_RATIOS: Record<string, number> = {
  'M1_M5': 5,
  'M1_M15': 15,
  'M1_M30': 30,
  'M1_H1': 60,
  'M1_H4': 240,
  'M1_D1': 1440,
  'M5_M15': 3,
  'M5_M30': 6,
  'M5_H1': 12,
  'M5_H4': 48,
  'M5_D1': 288,
  'M15_M30': 2,
  'M15_H1': 4,
  'M15_H4': 16,
  'M15_D1': 96,
  'M30_H1': 2,
  'M30_H4': 8,
  'M30_D1': 48,
  'H1_H4': 4,
  'H1_D1': 24,
  'H4_D1': 6,
};

/**
 * Resampling options
 */
export interface ResampleOptions {
  /** Fill gaps with last known values (default: true) */
  fillGaps?: boolean;
  /** Preserve partial periods at end (default: false) */
  includePartial?: boolean;
  /** Validate timestamps are sequential (default: true) */
  validateTimestamps?: boolean;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Resample candles to a higher timeframe
 *
 * @param candles - Source candles (must be sorted by timestamp ascending)
 * @param targetTF - Target timeframe
 * @param options - Resampling options
 * @returns Resampled candles
 *
 * @example
 * ```typescript
 * // Resample M5 to H1
 * const h1Candles = resampleCandles(m5Candles, 'H1');
 *
 * // Resample with options
 * const h4Candles = resampleCandles(m5Candles, 'H4', {
 *   fillGaps: true,
 *   includePartial: false,
 * });
 * ```
 */
export function resampleCandles(
  candles: Candle[],
  targetTF: Timeframe,
  options: ResampleOptions = {}
): Candle[] {
  const { fillGaps = true, includePartial = false, validateTimestamps = true } = options;

  if (candles.length === 0) {
    return [];
  }

  // Detect source timeframe
  const sourceTF = detectTimeframe(candles);
  if (!sourceTF) {
    throw new Error('Could not detect source timeframe from candle data');
  }

  const sourceSeconds = TIMEFRAME_SECONDS[sourceTF];
  const targetSeconds = TIMEFRAME_SECONDS[targetTF];

  if (targetSeconds <= sourceSeconds) {
    throw new Error(
      `Target timeframe (${targetTF}) must be larger than source (${sourceTF})`
    );
  }

  const ratio = targetSeconds / sourceSeconds;
  if (!Number.isInteger(ratio)) {
    throw new Error(
      `Invalid resampling ratio: ${sourceTF} to ${targetTF} (ratio: ${ratio})`
    );
  }

  // Validate timestamps are sequential
  if (validateTimestamps) {
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1]!;
      const curr = candles[i]!;
      const expectedGap = sourceSeconds;
      const actualGap = curr.timestamp - prev.timestamp;

      // Allow small variations (up to 2x expected gap for missing candles)
      if (actualGap < 0) {
        throw new Error(
          `Candles not sorted by timestamp at index ${i}: ${prev.timestamp} > ${curr.timestamp}`
        );
      }
    }
  }

  // Group candles by target period
  const grouped = groupCandlesByPeriod(candles, targetSeconds);

  // Build resampled candles
  const resampled: Candle[] = [];

  for (const [periodStart, periodCandles] of grouped.entries()) {
    if (periodCandles.length === 0) continue;

    // Skip partial periods at the end unless requested
    if (!includePartial && periodCandles.length < ratio) {
      // Check if this is the last period
      const isLastPeriod = periodStart === Math.max(...grouped.keys());
      if (isLastPeriod) continue;
    }

    const aggregated = aggregateCandles(periodCandles, periodStart, targetSeconds);
    resampled.push(aggregated);
  }

  // Sort by timestamp
  resampled.sort((a, b) => a.timestamp - b.timestamp);

  return resampled;
}

/**
 * Resample to multiple timeframes at once
 *
 * @param candles - Source candles
 * @param timeframes - Array of target timeframes
 * @returns Map of timeframe to resampled candles
 */
export function resampleToMultiple(
  candles: Candle[],
  timeframes: Timeframe[]
): Map<Timeframe, Candle[]> {
  const result = new Map<Timeframe, Candle[]>();

  for (const tf of timeframes) {
    try {
      result.set(tf, resampleCandles(candles, tf));
    } catch (e) {
      console.warn(`Failed to resample to ${tf}: ${(e as Error).message}`);
    }
  }

  return result;
}

/**
 * Get candle at a specific timestamp from resampled data
 * Useful for aligning MTF data
 *
 * @param candles - Resampled candles
 * @param timestamp - Target timestamp
 * @param tolerance - Timestamp tolerance in seconds (default: 0)
 */
export function getCandleAtTimestamp(
  candles: Candle[],
  timestamp: number,
  tolerance: number = 0
): Candle | null {
  for (const candle of candles) {
    if (
      candle.timestamp === timestamp ||
      (tolerance > 0 && Math.abs(candle.timestamp - timestamp) <= tolerance)
    ) {
      return candle;
    }
  }
  return null;
}

/**
 * Get the higher timeframe candle that contains a lower timeframe timestamp
 *
 * @param htfCandles - Higher timeframe candles
 * @param ltfTimestamp - Lower timeframe timestamp
 * @param htfSeconds - Higher timeframe period in seconds
 */
export function getContainingHTFCandle(
  htfCandles: Candle[],
  ltfTimestamp: number,
  htfSeconds: number
): Candle | null {
  const periodStart = Math.floor(ltfTimestamp / htfSeconds) * htfSeconds;

  for (const candle of htfCandles) {
    if (candle.timestamp === periodStart) {
      return candle;
    }
  }

  return null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Detect timeframe from candle data
 */
export function detectTimeframe(candles: Candle[]): Timeframe | null {
  if (candles.length < 2) {
    // Check if timeframe is set on candle
    const tf = candles[0]?.timeframe;
    if (tf) {
      for (const [name, seconds] of Object.entries(TIMEFRAME_SECONDS)) {
        if (seconds === tf) return name as Timeframe;
      }
    }
    return null;
  }

  // Calculate average gap between candles
  let totalGap = 0;
  let gapCount = 0;

  for (let i = 1; i < Math.min(candles.length, 100); i++) {
    const gap = candles[i]!.timestamp - candles[i - 1]!.timestamp;
    if (gap > 0 && gap < 86400 * 7) {
      // Ignore gaps > 1 week
      totalGap += gap;
      gapCount++;
    }
  }

  if (gapCount === 0) return null;

  const avgGap = totalGap / gapCount;

  // Find closest timeframe
  let closestTF: Timeframe | null = null;
  let closestDiff = Infinity;

  for (const [tf, seconds] of Object.entries(TIMEFRAME_SECONDS)) {
    const diff = Math.abs(avgGap - seconds);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestTF = tf as Timeframe;
    }
  }

  // Only accept if within 10% tolerance
  if (closestTF && closestDiff / TIMEFRAME_SECONDS[closestTF] < 0.1) {
    return closestTF;
  }

  return null;
}

/**
 * Group candles by target period
 */
function groupCandlesByPeriod(
  candles: Candle[],
  periodSeconds: number
): Map<number, Candle[]> {
  const groups = new Map<number, Candle[]>();

  for (const candle of candles) {
    const periodStart = Math.floor(candle.timestamp / periodSeconds) * periodSeconds;

    if (!groups.has(periodStart)) {
      groups.set(periodStart, []);
    }
    groups.get(periodStart)!.push(candle);
  }

  return groups;
}

/**
 * Aggregate multiple candles into one
 */
function aggregateCandles(
  candles: Candle[],
  timestamp: number,
  timeframe: number
): Candle {
  if (candles.length === 0) {
    throw new Error('Cannot aggregate empty candle array');
  }

  // Sort by timestamp to ensure correct OHLC
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  return {
    asset: first.asset,
    timeframe,
    timestamp,
    open: first.open,
    high: Math.max(...sorted.map((c) => c.high)),
    low: Math.min(...sorted.map((c) => c.low)),
    close: last.close,
    volume: sorted.reduce((sum, c) => sum + (c.volume || 0), 0),
  };
}

// ============================================================================
// MTF ALIGNMENT UTILITIES
// ============================================================================

/**
 * Align LTF candles with HTF candles
 * Returns pairs of [ltfCandle, htfCandle] where htfCandle is the containing period
 *
 * @param ltfCandles - Lower timeframe candles
 * @param htfCandles - Higher timeframe candles
 */
export function alignMTFCandles(
  ltfCandles: Candle[],
  htfCandles: Candle[]
): Array<{ ltf: Candle; htf: Candle }> {
  const htfTF = detectTimeframe(htfCandles);
  if (!htfTF) {
    throw new Error('Could not detect HTF timeframe');
  }

  const htfSeconds = TIMEFRAME_SECONDS[htfTF];
  const aligned: Array<{ ltf: Candle; htf: Candle }> = [];

  // Create HTF lookup map for O(1) access
  const htfMap = new Map<number, Candle>();
  for (const candle of htfCandles) {
    htfMap.set(candle.timestamp, candle);
  }

  for (const ltfCandle of ltfCandles) {
    const htfStart = Math.floor(ltfCandle.timestamp / htfSeconds) * htfSeconds;
    const htfCandle = htfMap.get(htfStart);

    if (htfCandle) {
      aligned.push({ ltf: ltfCandle, htf: htfCandle });
    }
  }

  return aligned;
}

/**
 * Get HTF indicator value for a LTF timestamp
 * Looks back to find the most recent completed HTF candle
 *
 * @param htfData - Array of { timestamp, value } pairs
 * @param ltfTimestamp - Lower timeframe timestamp
 * @param htfSeconds - Higher timeframe period in seconds
 */
export function getHTFValueAtLTF<T>(
  htfData: Array<{ timestamp: number; value: T }>,
  ltfTimestamp: number,
  htfSeconds: number
): T | null {
  // Find the HTF period that contains this LTF timestamp
  const htfStart = Math.floor(ltfTimestamp / htfSeconds) * htfSeconds;

  // Use the PREVIOUS HTF candle's value (completed candle)
  const prevHTFStart = htfStart - htfSeconds;

  for (const item of htfData) {
    if (item.timestamp === prevHTFStart) {
      return item.value;
    }
  }

  return null;
}

// ============================================================================
// CONVERSION UTILITIES
// ============================================================================

/**
 * Convert timeframe string to seconds
 */
export function timeframeToSeconds(tf: Timeframe): number {
  return TIMEFRAME_SECONDS[tf];
}

/**
 * Convert seconds to timeframe string
 */
export function secondsToTimeframe(seconds: number): Timeframe | null {
  for (const [tf, secs] of Object.entries(TIMEFRAME_SECONDS)) {
    if (secs === seconds) return tf as Timeframe;
  }
  return null;
}

/**
 * Get human-readable timeframe name
 */
export function getTimeframeName(tf: Timeframe): string {
  const names: Record<Timeframe, string> = {
    M1: '1 Minute',
    M5: '5 Minutes',
    M15: '15 Minutes',
    M30: '30 Minutes',
    H1: '1 Hour',
    H4: '4 Hours',
    D1: 'Daily',
  };
  return names[tf];
}

/**
 * Check if one timeframe is higher than another
 */
export function isHigherTimeframe(tf1: Timeframe, tf2: Timeframe): boolean {
  return TIMEFRAME_SECONDS[tf1] > TIMEFRAME_SECONDS[tf2];
}

/**
 * Get all timeframes higher than the given one
 */
export function getHigherTimeframes(tf: Timeframe): Timeframe[] {
  const tfSeconds = TIMEFRAME_SECONDS[tf];
  return (Object.keys(TIMEFRAME_SECONDS) as Timeframe[]).filter(
    (t) => TIMEFRAME_SECONDS[t] > tfSeconds
  );
}
