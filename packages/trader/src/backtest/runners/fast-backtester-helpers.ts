/**
 * Helper functions for FastBacktester
 *
 * Utilities to adapt existing strategies to FastBacktester format
 */

import type { Candle } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal } from '../types.js';
import { FastBacktester, type FastBacktestConfig, type FastEntrySignal } from './fast-backtester.js';

/**
 * Create a FastBacktestConfig from a BacktestableStrategy
 *
 * This adapter allows using existing strategies with FastBacktester
 * by wrapping the strategy's checkEntry method.
 *
 * NOTE: This still uses candles.slice() which is slower. For true optimization,
 * strategies should be refactored to work with FastBacktester directly.
 */
export function createFastConfigFromStrategy(
  strategy: BacktestableStrategy,
  candles: Candle[],
  config: {
    tpPct: number;
    slPct: number;
    cooldown: number;
    maxBarsInTrade?: number;
    initialBalance?: number;
    stakePct?: number;
    multiplier?: number;
    startIndex?: number;
    endIndex?: number;
  }
): FastBacktestConfig {
  return {
    entryFn: (index: number, indicators: Record<string, number | boolean>) => {
      // Convert indicators record back to IndicatorSnapshot format
      const snapshot: any = {};
      for (const [key, value] of Object.entries(indicators)) {
        snapshot[key] = value;
      }

      // Call strategy's checkEntry method
      // Note: We pass candles up to current index (but this is still a slice)
      // For true optimization, strategies should be refactored to use index-based access
      const signal = strategy.checkEntry(
        candles.slice(0, index + 1),
        snapshot,
        index
      );

      if (!signal) {
        return null;
      }

      return {
        direction: signal.direction,
        price: signal.price,
      };
    },
    tpPct: config.tpPct,
    slPct: config.slPct,
    cooldown: config.cooldown,
    maxBarsInTrade: config.maxBarsInTrade,
    initialBalance: config.initialBalance,
    stakePct: config.stakePct,
    multiplier: config.multiplier,
    startIndex: config.startIndex,
    endIndex: config.endIndex,
  };
}

/**
 * Simple RSI-based entry function factory
 *
 * Creates an entry function for RSI scalping strategies
 */
export function createRSIEntryFn(
  rsiOversold: number,
  rsiOverbought: number
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
  return (index: number, indicators: Record<string, number | boolean>) => {
    const rsi = indicators.rsi;
    if (typeof rsi !== 'number') {
      return null;
    }

    if (rsi <= rsiOversold) {
      return {
        direction: 'CALL',
        price: 0, // Will use candle close price
      };
    }

    if (rsi >= rsiOverbought) {
      return {
        direction: 'PUT',
        price: 0, // Will use candle close price
      };
    }

    return null;
  };
}

/**
 * Enhanced RSI entry function with EMA filter
 */
export function createRSIWithEMAEntryFn(
  rsiOversold: number,
  rsiOverbought: number,
  useEMAFilter: boolean = false
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
  return (index: number, indicators: Record<string, number | boolean>) => {
    const rsi = indicators.rsi;
    if (typeof rsi !== 'number') {
      return null;
    }

    // EMA filter: only long if price > EMA, only short if price < EMA
    if (useEMAFilter) {
      const ema = indicators.ema;
      const price = indicators.price;
      
      if (typeof ema !== 'number' || typeof price !== 'number') {
        return null;
      }

      if (rsi <= rsiOversold && price > ema) {
        return { direction: 'CALL', price: 0 };
      }

      if (rsi >= rsiOverbought && price < ema) {
        return { direction: 'PUT', price: 0 };
      }

      return null;
    }

    // No EMA filter
    if (rsi <= rsiOversold) {
      return { direction: 'CALL', price: 0 };
    }

    if (rsi >= rsiOverbought) {
      return { direction: 'PUT', price: 0 };
    }

    return null;
  };
}

/**
 * Bollinger Bands squeeze entry function
 */
export function createBBSqueezeEntryFn(
  squeezeHistogramThreshold: number = 0
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
  return (index: number, indicators: Record<string, number | boolean>) => {
    const squeezeOn = indicators.squeezeOn;
    const squeezeHistogram = indicators.squeezeHistogram;
    const price = indicators.price;
    const bbMiddle = indicators.bbMiddle;

    if (
      typeof squeezeOn !== 'boolean' ||
      typeof squeezeHistogram !== 'number' ||
      typeof price !== 'number' ||
      typeof bbMiddle !== 'number'
    ) {
      return null;
    }

    // Enter on squeeze release (squeeze was on, now off, with momentum)
    if (!squeezeOn && squeezeHistogram > squeezeHistogramThreshold) {
      // Long if price above middle band
      if (price > bbMiddle) {
        return { direction: 'CALL', price: 0 };
      }
      // Short if price below middle band
      if (price < bbMiddle) {
        return { direction: 'PUT', price: 0 };
      }
    }

    return null;
  };
}

/**
 * Multi-indicator entry function (RSI + ADX + VWAP)
 */
export function createMultiIndicatorEntryFn(
  rsiOversold: number,
  rsiOverbought: number,
  minADX: number = 20,
  requireVWAPBias: boolean = false
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
  return (index: number, indicators: Record<string, number | boolean>) => {
    const rsi = indicators.rsi;
    const adx = indicators.adx;
    const price = indicators.price;
    const vwap = indicators.vwap;

    if (typeof rsi !== 'number' || typeof adx !== 'number' || typeof price !== 'number') {
      return null;
    }

    // ADX filter: require trending market
    if (adx < minADX) {
      return null;
    }

    // VWAP bias filter (if enabled)
    if (requireVWAPBias && typeof vwap === 'number') {
      if (rsi <= rsiOversold && price < vwap) {
        return null; // Don't long if price below VWAP
      }
      if (rsi >= rsiOverbought && price > vwap) {
        return null; // Don't short if price above VWAP
      }
    }

    // RSI signals
    if (rsi <= rsiOversold) {
      return { direction: 'CALL', price: 0 };
    }

    if (rsi >= rsiOverbought) {
      return { direction: 'PUT', price: 0 };
    }

    return null;
  };
}

