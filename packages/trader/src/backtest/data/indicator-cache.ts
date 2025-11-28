/**
 * Indicator Cache for Backtest Engine
 *
 * Pre-calculates all required indicators efficiently.
 * Caches results to avoid recalculating during backtest loop.
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { IndicatorConfig, IndicatorName } from '../types.js';
import { DEFAULT_INDICATOR_CONFIG } from '../types.js';

/**
 * Indicator calculation result
 */
export interface IndicatorSeries {
  name: IndicatorName;
  values: number[];
}

/**
 * Pre-calculated indicator data for the entire candle series
 */
export interface CachedIndicators {
  /** Get indicator snapshot at a specific index */
  getSnapshot(index: number): IndicatorSnapshot;
  /** Get a single indicator series */
  getSeries(name: IndicatorName): number[];
  /** Get all series as a map */
  getAllSeries(): Map<string, number[]>;
  /** Number of data points */
  length: number;
}

// =============================================================================
// INDICATOR CALCULATIONS
// =============================================================================

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(closes: number[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(closes[i]!);
      continue;
    }

    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - j]!;
    }
    result.push(sum / period);
  }

  return result;
}

/**
 * Calculate Exponential Moving Average
 */
function calculateEMA(closes: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      result.push(closes[i]!);
    } else if (i < period) {
      // Use SMA for initial period
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += closes[j]!;
      }
      result.push(sum / (i + 1));
    } else {
      const ema = (closes[i]! - result[i - 1]!) * multiplier + result[i - 1]!;
      result.push(ema);
    }
  }

  return result;
}

/**
 * Calculate RSI
 */
function calculateRSI(closes: number[], period: number): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate gains and losses
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // First values
  for (let i = 0; i < period; i++) {
    result.push(50);
  }

  // Calculate RSI
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    const gain = gains[i - 1] ?? 0;
    const loss = losses[i - 1] ?? 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  return result;
}

/**
 * Calculate Standard Deviation
 */
function calculateStdDev(values: number[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }

    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    result.push(Math.sqrt(variance));
  }

  return result;
}

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(
  closes: number[],
  period: number,
  stdDev: number
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const std = calculateStdDev(closes, period);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    upper.push(middle[i]! + stdDev * std[i]!);
    lower.push(middle[i]! - stdDev * std[i]!);
  }

  return { upper, middle, lower };
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(candles: Candle[], period: number): number[] {
  const result: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;

    if (i === 0) {
      trueRanges.push(candle.high - candle.low);
    } else {
      const prevClose = candles[i - 1]!.close;
      const tr = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevClose),
        Math.abs(candle.low - prevClose)
      );
      trueRanges.push(tr);
    }
  }

  // Calculate ATR as EMA of true range
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period) {
      const sum = trueRanges.slice(0, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / (i + 1));
    } else {
      const atr = (trueRanges[i]! - result[i - 1]!) * multiplier + result[i - 1]!;
      result.push(atr);
    }
  }

  return result;
}

/**
 * Calculate Keltner Channels
 */
function calculateKeltnerChannels(
  candles: Candle[],
  period: number,
  multiplier: number
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = candles.map((c) => c.close);
  const middle = calculateEMA(closes, period);
  const atr = calculateATR(candles, period);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    upper.push(middle[i]! + multiplier * atr[i]!);
    lower.push(middle[i]! - multiplier * atr[i]!);
  }

  return { upper, middle, lower };
}

/**
 * Calculate Squeeze (BB inside KC)
 */
function calculateSqueeze(
  bb: { upper: number[]; lower: number[] },
  kc: { upper: number[]; lower: number[] }
): { squeezeOn: boolean[]; histogram: number[] } {
  const squeezeOn: boolean[] = [];
  const histogram: number[] = [];

  for (let i = 0; i < bb.upper.length; i++) {
    // Squeeze is ON when BB is inside KC
    const isOn = bb.lower[i]! > kc.lower[i]! && bb.upper[i]! < kc.upper[i]!;
    squeezeOn.push(isOn);

    // Momentum histogram (simplified - distance from middle)
    const momentum = (bb.upper[i]! + bb.lower[i]!) / 2 - (kc.upper[i]! + kc.lower[i]!) / 2;
    histogram.push(momentum);
  }

  return { squeezeOn, histogram };
}

/**
 * Calculate MACD
 */
function calculateMACD(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  const macd: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macd.push(fastEMA[i]! - slowEMA[i]!);
  }

  const signal = calculateEMA(macd, signalPeriod);

  const histogram: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    histogram.push(macd[i]! - signal[i]!);
  }

  return { macd, signal, histogram };
}

/**
 * Calculate Stochastic
 */
function calculateStochastic(
  candles: Candle[],
  kPeriod: number,
  dPeriod: number
): { k: number[]; d: number[] } {
  const k: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      k.push(50);
      continue;
    }

    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    const close = candles[i]!.close;

    const stochK = high === low ? 50 : ((close - low) / (high - low)) * 100;
    k.push(stochK);
  }

  const d = calculateSMA(k, dPeriod);

  return { k, d };
}

// =============================================================================
// INDICATOR CACHE
// =============================================================================

/**
 * Create a cached indicator calculator
 */
export function createIndicatorCache(
  candles: Candle[],
  requiredIndicators: string[],
  config?: Partial<IndicatorConfig>
): CachedIndicators {
  const opts = { ...DEFAULT_INDICATOR_CONFIG, ...config };
  const series = new Map<string, number[]>();
  const closes = candles.map((c) => c.close);

  // Always calculate these for BB-Squeeze strategy
  const bb = calculateBollingerBands(closes, opts.bbPeriod!, opts.bbStdDev!);
  const kc = calculateKeltnerChannels(candles, opts.kcPeriod!, opts.kcMultiplier!);
  const squeeze = calculateSqueeze(bb, kc);

  // Store BB
  series.set('bbUpper', bb.upper);
  series.set('bbMiddle', bb.middle);
  series.set('bbLower', bb.lower);

  // Store KC
  series.set('kcUpper', kc.upper);
  series.set('kcMiddle', kc.middle);
  series.set('kcLower', kc.lower);

  // Store Squeeze
  series.set('squeezeOn', squeeze.squeezeOn.map((v) => (v ? 1 : 0)));
  series.set('squeezeHistogram', squeeze.histogram);

  // Calculate other indicators based on requirements
  if (requiredIndicators.includes('rsi')) {
    series.set('rsi', calculateRSI(closes, opts.rsiPeriod!));
  }

  if (requiredIndicators.includes('atr')) {
    series.set('atr', calculateATR(candles, opts.atrPeriod!));
  }

  if (requiredIndicators.includes('sma')) {
    series.set('sma', calculateSMA(closes, opts.smaPeriod!));
  }

  if (requiredIndicators.includes('ema')) {
    series.set('ema', calculateEMA(closes, opts.emaPeriod!));
  }

  if (
    requiredIndicators.includes('macd') ||
    requiredIndicators.includes('macdSignal') ||
    requiredIndicators.includes('macdHistogram')
  ) {
    const macd = calculateMACD(closes, opts.macdFast!, opts.macdSlow!, opts.macdSignal!);
    series.set('macd', macd.macd);
    series.set('macdSignal', macd.signal);
    series.set('macdHistogram', macd.histogram);
  }

  if (requiredIndicators.includes('stochK') || requiredIndicators.includes('stochD')) {
    const stoch = calculateStochastic(candles, opts.stochKPeriod!, opts.stochDPeriod!);
    series.set('stochK', stoch.k);
    series.set('stochD', stoch.d);
  }

  return {
    getSnapshot(index: number): IndicatorSnapshot {
      const snapshot: IndicatorSnapshot = {};

      for (const [name, values] of series.entries()) {
        const value = values[index];
        if (value !== undefined) {
          if (name === 'squeezeOn') {
            snapshot[name] = value === 1;
          } else {
            snapshot[name] = value;
          }
        }
      }

      return snapshot;
    },

    getSeries(name: IndicatorName): number[] {
      return series.get(name) ?? [];
    },

    getAllSeries(): Map<string, number[]> {
      return new Map(series);
    },

    get length() {
      return candles.length;
    },
  };
}

/**
 * Get list of all available indicators
 */
export function getAvailableIndicators(): IndicatorName[] {
  return [
    'rsi',
    'bbUpper',
    'bbMiddle',
    'bbLower',
    'kcUpper',
    'kcMiddle',
    'kcLower',
    'atr',
    'sma',
    'ema',
    'macd',
    'macdSignal',
    'macdHistogram',
    'stochK',
    'stochD',
    'squeezeOn',
    'squeezeHistogram',
  ];
}
