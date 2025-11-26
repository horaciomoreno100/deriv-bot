/**
 * Bollinger Band Squeeze Strategy (Multi-Asset Optimized)
 *
 * Strategy: Scalping based on volatility compression and breakouts
 * Logic:
 * - Detects "Squeeze" phases (low volatility) when BB is inside Keltner Channels
 * - Trades breakouts from the squeeze with momentum confirmation
 * - CALL when price breaks above BB_Upper AND RSI > 55 (bullish momentum)
 * - PUT when price breaks below BB_Lower AND RSI < 45 (bearish momentum)
 *
 * Multi-Asset Configuration (30-day Grid Search Optimization):
 * ⭐ R_75: BEST PERFORMER - 47.11% return, PF 1.91, WR 48.2%
 *    KC=2.0, RSI=14, TP=0.4%, SL=0.2%
 *
 * ✅ R_100: PROFITABLE - 0.97% return, PF 1.67, WR 45.6%
 *    KC=2.0, RSI=14, TP=0.6%, SL=0.3%
 *
 * ⚠️  R_50: MARGINAL - 0.09% return, PF 1.46, WR 41.9%
 *    KC=2.0, RSI=14, TP=0.6%, SL=0.3%
 *
 * ❌ R_10/R_25: NOT VIABLE - Strategy doesn't work on low volatility indices
 *    Best PF < 1.2 (minimum threshold)
 *
 * Improvement (Deep Loss Analysis - 2025-11-25):
 * - skipSaturday: true (default) - Saturdays have 70% loss rate vs 63.5% Monday
 *   Backtest results: NO_SATURDAY = +$837 profit vs baseline -$1,639 (PF 1.01)
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

/**
 * BB Squeeze Strategy Parameters
 */
export interface BBSqueezeParams {
  /** Bollinger Bands period (default: 20) */
  bbPeriod: number;
  /** Bollinger Bands standard deviation multiplier (default: 2) */
  bbStdDev: number;
  /** Keltner Channel period (default: 20) */
  kcPeriod: number;
  /** Keltner Channel ATR multiplier (varies by asset) */
  kcMultiplier: number;
  /** RSI Period for momentum confirmation (varies by asset) */
  rsiPeriod: number;
  /** Take Profit percentage (varies by asset) */
  takeProfitPct: number;
  /** Stop Loss percentage (varies by asset) */
  stopLossPct: number;
  /** Cooldown between trades in seconds (default: 60) */
  cooldownSeconds: number;
  /** Minimum candles required for indicator calculation (default: 50) */
  minCandles: number;
  /** Skip trading on Saturdays (default: true) - based on backtest analysis showing 70% loss rate on Saturdays */
  skipSaturday: boolean;
  /** Enable time window filter (default: true) - avoids bad day+hour combinations */
  enableTimeFilter: boolean;
  /** Enable RSI zone filter (default: true) - avoids RSI 30-40 indecision zone */
  enableRSIFilter: boolean;
}

/**
 * Bad time windows based on backtest analysis
 * Format: "dayOfWeek-hourUTC" where dayOfWeek is 0=Sun, 1=Mon, etc.
 * These combinations have <20% win rate and negative returns
 */
const BAD_TIME_WINDOWS = new Set([
  '0-4',   // Sun 4:00 - 7% WR, -$440
  '0-5',   // Sun 5:00 - 13% WR, -$345
  '0-15',  // Sun 15:00 - 13% WR, -$398
  '0-16',  // Sun 16:00 - 8% WR, -$360
  '1-1',   // Mon 1:00 - 20% WR, -$320
  '2-1',   // Tue 1:00 - 8% WR, -$400
  '2-5',   // Tue 5:00 - 0% WR, -$341
  '2-10',  // Tue 10:00 - 7% WR, -$440
  '3-21',  // Wed 21:00 - 0% WR, -$480
  '4-14',  // Thu 14:00 - 8% WR, -$311
  '5-6',   // Fri 6:00 - 8% WR, -$400
  '5-15',  // Fri 15:00 - 19% WR, -$318
  '6-3',   // Sat 3:00 - 0% WR, -$351
  '6-9',   // Sat 9:00 - 11% WR, -$480
  '6-11',  // Sat 11:00 - 18% WR, -$320
]);

/**
 * Asset-specific parameter overrides
 * Optimized via 30-day Grid Search backtesting
 * Note: R_10 and R_25 are not viable (PF < 1.2) - commented out
 */
const ASSET_CONFIGS: Record<string, Partial<BBSqueezeParams>> = {
  // 'R_10': {
  //   // ⚠️  Not viable: Best PF = 1.11 (below minimum threshold of 1.2)
  //   // This strategy does not work on ultra-low volatility indices
  // },
  // 'R_25': {
  //   // ⚠️  Not viable: Best PF = 1.09 (below minimum threshold of 1.2)
  //   // This strategy does not work on very low volatility indices
  // },
  'R_50': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.006,  // 0.6%
    stopLossPct: 0.003,    // 0.3%
    // Expected: Return 0.09%, PF 1.46, WR 41.9%, Marginal performance
  },
  'R_75': {
    kcMultiplier: 2.0,     // ⭐ BEST ASSET - Optimized from 2.8 to 2.0
    rsiPeriod: 14,         // Standard RSI period for noise filtering
    takeProfitPct: 0.004,  // 0.4% - Optimal for high frequency
    stopLossPct: 0.002,    // 0.2% - Maintains 2:1 TP/SL ratio
    // Expected: Return 47.11%, PF 1.91, WR 48.2%, 114 trades
  },
  'R_100': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.006,  // 0.6% - Higher TP for R_100's volatility
    stopLossPct: 0.003,    // 0.3% - Maintains 2:1 TP/SL ratio
    // Expected: Return 0.97%, PF 1.67, WR 45.6%, 103 trades
  },
};

/**
 * Default base parameters (Backtest-Optimized)
 */
const DEFAULT_PARAMS: BBSqueezeParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,          // Optimized from 2.0 to 1.5 for better squeeze detection
  rsiPeriod: 7,               // Shorter RSI period for scalping (7 vs 14)
  takeProfitPct: 0.004,       // 0.4% TP
  stopLossPct: 0.002,         // 0.2% SL (2:1 ratio)
  cooldownSeconds: 60,
  minCandles: 50,
  skipSaturday: true,         // Saturday has 70% loss rate
  enableTimeFilter: true,     // Avoid bad day+hour combinations
  enableRSIFilter: true,      // Avoid RSI 30-40 indecision zone
};

/**
 * Check if current time is a good trading window
 * Returns false for known bad day+hour combinations
 */
function isGoodTimeWindow(dayOfWeek: number, hourUTC: number): boolean {
  const key = `${dayOfWeek}-${hourUTC}`;
  return !BAD_TIME_WINDOWS.has(key);
}

/**
 * Check if RSI is in a good zone for trading
 * Avoids the 30-40 "indecision zone" which has 25% win rate
 */
function isGoodRSIZone(rsi: number): boolean {
  // RSI 30-40 has 25% WR and -$1,493 in backtest
  // RSI < 30 (oversold) or RSI > 40 are acceptable
  return rsi < 30 || rsi > 40;
}

/**
 * Keltner Channel interface
 */
interface KeltnerChannel {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * BB Squeeze Strategy
 *
 * Trades volatility breakouts after squeeze phases
 * With per-asset parameter optimization
 */
export class BBSqueezeStrategy extends BaseStrategy {
  private baseParams: BBSqueezeParams;
  private lastTradeTime: Record<string, number> = {};
  private inSqueeze: Record<string, boolean> = {};
  private lastSqueezeTime: Record<string, number> = {};

  constructor(config: StrategyConfig) {
    super(config);

    // Merge user params with defaults
    this.baseParams = {
      ...DEFAULT_PARAMS,
      ...(config.parameters as Partial<BBSqueezeParams>),
    };
  }

  /**
   * Get parameters for a specific asset
   */
  private getParamsForAsset(asset: string): BBSqueezeParams {
    const override = ASSET_CONFIGS[asset] || {};
    return {
      ...this.baseParams,
      ...override,
    };
  }

  /**
   * Calculate Keltner Channels manually
   */
  private calculateKeltnerChannels(candles: Candle[], kcMultiplier: number): KeltnerChannel[] {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Calculate EMA (middle line)
    const ema = this.calculateEMA(closes, this.baseParams.kcPeriod);

    // Calculate ATR
    const atrInput = {
      high: highs,
      low: lows,
      close: closes,
      period: this.baseParams.kcPeriod,
    };
    const atrValues = ATR.calculate(atrInput);

    // Build Keltner Channels
    const keltnerChannels: KeltnerChannel[] = [];
    const offset = closes.length - atrValues.length;

    for (let i = 0; i < atrValues.length; i++) {
      const middle = ema[i + offset];
      const atr = atrValues[i];
      if (middle !== undefined && atr !== undefined) {
        keltnerChannels.push({
          upper: middle + atr * kcMultiplier,
          middle,
          lower: middle - atr * kcMultiplier,
        });
      }
    }

    return keltnerChannels;
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray: number[] = [];

    // First EMA is simple moving average
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    emaArray.push(ema);

    // Calculate rest of EMAs
    for (let i = period; i < values.length; i++) {
      const value = values[i];
      if (value !== undefined) {
        ema = value * k + ema * (1 - k);
        emaArray.push(ema);
      }
    }

    return emaArray;
  }

  async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    const { candles } = context;
    const asset = candle.asset;

    // Get asset-specific parameters
    const params = this.getParamsForAsset(asset);

    console.log(`[BBSqueeze] 🔍 onCandle for ${asset} | price=${candle.close.toFixed(2)} | KC=${params.kcMultiplier} | RSI period=${params.rsiPeriod}`);

    // Need enough candles for indicators
    if (!candles || candles.length < params.minCandles) {
      console.log(`[BBSqueeze] ⏭️  Not enough candles: ${candles?.length || 0} < ${params.minCandles}`);
      return null;
    }

    // Initialize asset state if needed
    if (this.lastTradeTime[asset] === undefined) this.lastTradeTime[asset] = 0;
    if (this.inSqueeze[asset] === undefined) this.inSqueeze[asset] = false;
    if (this.lastSqueezeTime[asset] === undefined) this.lastSqueezeTime[asset] = 0;

    // Check cooldown
    const now = Date.now();
    const timeSinceLastTrade = now - this.lastTradeTime[asset];
    const cooldownMs = params.cooldownSeconds * 1000;

    if (timeSinceLastTrade < cooldownMs) {
      console.log(`[BBSqueeze] ⏱️  Cooldown active: ${Math.ceil((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`);
      return null;
    }

    // Get time information for filters
    const candleDate = new Date(candle.timestamp);
    const dayOfWeek = candleDate.getUTCDay();
    const hourUTC = candleDate.getUTCHours();

    // Skip Saturday trades (backtest analysis: 70% loss rate on Saturdays)
    if (params.skipSaturday && dayOfWeek === 6) {
      console.log(`[BBSqueeze] 📅 Skipping Saturday trade for ${asset} - High loss rate day`);
      return null;
    }

    // Time window filter (avoid bad day+hour combinations)
    if (params.enableTimeFilter && !isGoodTimeWindow(dayOfWeek, hourUTC)) {
      console.log(`[BBSqueeze] ⏰ Skipping bad time window: day=${dayOfWeek}, hour=${hourUTC} for ${asset}`);
      return null;
    }

    // Calculate indicators
    const closes = candles.map(c => c.close);

    // 1. Calculate Bollinger Bands
    const bbResult = BollingerBands.calculate({
      period: params.bbPeriod,
      values: closes,
      stdDev: params.bbStdDev,
    });

    // 2. Calculate Keltner Channels (with asset-specific multiplier)
    const kcResult = this.calculateKeltnerChannels(candles, params.kcMultiplier);

    // 3. Calculate RSI for momentum confirmation (with asset-specific period)
    const rsiResult = RSI.calculate({
      period: params.rsiPeriod,
      values: closes,
    });

    if (!bbResult || bbResult.length === 0) {
      console.log(`[BBSqueeze] ⚠️  BB calculation failed`);
      return null;
    }

    if (!kcResult || kcResult.length === 0) {
      console.log(`[BBSqueeze] ⚠️  KC calculation failed`);
      return null;
    }

    if (!rsiResult || rsiResult.length === 0) {
      console.log(`[BBSqueeze] ⚠️  RSI calculation failed`);
      return null;
    }

    // Get current values
    const currentBB = bbResult[bbResult.length - 1];
    const currentKC = kcResult[kcResult.length - 1];
    const currentRSI = rsiResult[rsiResult.length - 1];

    if (!currentBB || !currentKC || currentRSI === undefined) {
      console.log(`[BBSqueeze] ⚠️  Invalid indicator values`);
      return null;
    }

    const price = candle.close;

    console.log(`[BBSqueeze] 📊 BB: upper=${currentBB.upper.toFixed(2)}, middle=${currentBB.middle.toFixed(2)}, lower=${currentBB.lower.toFixed(2)}`);
    console.log(`[BBSqueeze] 📊 KC: upper=${currentKC.upper.toFixed(2)}, middle=${currentKC.middle.toFixed(2)}, lower=${currentKC.lower.toFixed(2)}`);
    console.log(`[BBSqueeze] 📊 RSI(${params.rsiPeriod}): ${currentRSI.toFixed(1)}`);

    // Detect Squeeze: BB is inside KC
    const bbUpperInsideKC = currentBB.upper < currentKC.upper;
    const bbLowerInsideKC = currentBB.lower > currentKC.lower;
    const isInSqueeze = bbUpperInsideKC && bbLowerInsideKC;

    if (isInSqueeze && !this.inSqueeze[asset]) {
      this.inSqueeze[asset] = true;
      this.lastSqueezeTime[asset] = now;
      console.log(`[BBSqueeze] 💤 SQUEEZE DETECTED for ${asset} (Low Volatility) - BB inside KC`);
      console.log(`[BBSqueeze]    BB Range: [${currentBB.lower.toFixed(2)}, ${currentBB.upper.toFixed(2)}]`);
      console.log(`[BBSqueeze]    KC Range: [${currentKC.lower.toFixed(2)}, ${currentKC.upper.toFixed(2)}]`);
    } else if (!isInSqueeze && this.inSqueeze[asset]) {
      console.log(`[BBSqueeze] 🌊 Squeeze ended for ${asset} - volatility expanding`);
    }

    // Update squeeze state
    this.inSqueeze[asset] = isInSqueeze;

    // Only trade if we recently came from a squeeze (within last 5 minutes)
    const timeSinceSqueeze = now - this.lastSqueezeTime[asset];
    const wasRecentlyInSqueeze = timeSinceSqueeze < 5 * 60 * 1000;

    if (!wasRecentlyInSqueeze) {
      return null;
    }

    // RSI zone filter (avoid 30-40 indecision zone - 25% WR in backtest)
    if (params.enableRSIFilter && !isGoodRSIZone(currentRSI)) {
      console.log(`[BBSqueeze] 📉 Skipping RSI indecision zone: RSI=${currentRSI.toFixed(1)} (30-40) for ${asset}`);
      return null;
    }

    // CALL Signal: Breakout above BB_Upper + RSI bullish momentum
    const breakoutAbove = price > currentBB.upper;
    const rsiBullish = currentRSI > 55; // Momentum confirmation for CALL

    if (breakoutAbove && rsiBullish) {
      console.log(`[BBSqueeze] 🚀 CALL SIGNAL for ${asset} - Breakout + Bullish Momentum`);
      console.log(`[BBSqueeze]    Price: ${price.toFixed(2)} > BB_Upper: ${currentBB.upper.toFixed(2)}`);
      console.log(`[BBSqueeze]    RSI: ${currentRSI.toFixed(1)} > 55 ✓ (Bullish)`);
      console.log(`[BBSqueeze]    Time since squeeze: ${Math.round(timeSinceSqueeze / 1000)}s`);
      console.log(`[BBSqueeze]    Asset params: KC=${params.kcMultiplier}, TP=${(params.takeProfitPct * 100).toFixed(2)}%, SL=${(params.stopLossPct * 100).toFixed(2)}%`);

      this.lastTradeTime[asset] = now;

      const tpPrice = price * (1 + params.takeProfitPct);
      const slPrice = price * (1 - params.stopLossPct);

      const signal = this.createSignal(
        'CALL',
        0.85, // Higher confidence with RSI confirmation
        {
          price,
          bbUpper: currentBB.upper.toFixed(2),
          bbMiddle: currentBB.middle.toFixed(2),
          bbLower: currentBB.lower.toFixed(2),
          kcUpper: currentKC.upper.toFixed(2),
          kcLower: currentKC.lower.toFixed(2),
          kcMultiplier: params.kcMultiplier,
          rsi: currentRSI.toFixed(1),
          rsiPeriod: params.rsiPeriod,
          breakoutType: 'ABOVE',
          tpPrice,
          slPrice,
          tpPct: params.takeProfitPct,  // Keep as decimal (e.g., 0.004 for 0.4%)
          slPct: params.stopLossPct,    // Keep as decimal (e.g., 0.002 for 0.2%)
          smartExit: `Exit at BB_Middle: ${currentBB.middle.toFixed(2)}`,
        },
        asset
      );

      console.log(`[BBSqueeze] 📤 EMITTING CALL SIGNAL for ${asset}`);
      return signal;
    } else if (breakoutAbove && !rsiBullish) {
      console.log(`[BBSqueeze] ⚠️  Breakout ABOVE but RSI too weak (${currentRSI.toFixed(1)} <= 55) - SKIPPING`);
    }

    // PUT Signal: Breakout below BB_Lower + RSI bearish momentum
    const breakoutBelow = price < currentBB.lower;
    const rsiBearish = currentRSI < 45; // Momentum confirmation for PUT

    if (breakoutBelow && rsiBearish) {
      console.log(`[BBSqueeze] 📉 PUT SIGNAL for ${asset} - Breakout + Bearish Momentum`);
      console.log(`[BBSqueeze]    Price: ${price.toFixed(2)} < BB_Lower: ${currentBB.lower.toFixed(2)}`);
      console.log(`[BBSqueeze]    RSI: ${currentRSI.toFixed(1)} < 45 ✓ (Bearish)`);
      console.log(`[BBSqueeze]    Time since squeeze: ${Math.round(timeSinceSqueeze / 1000)}s`);
      console.log(`[BBSqueeze]    Asset params: KC=${params.kcMultiplier}, TP=${(params.takeProfitPct * 100).toFixed(2)}%, SL=${(params.stopLossPct * 100).toFixed(2)}%`);

      this.lastTradeTime[asset] = now;

      const tpPrice = price * (1 - params.takeProfitPct);
      const slPrice = price * (1 + params.stopLossPct);

      const signal = this.createSignal(
        'PUT',
        0.85, // Higher confidence with RSI confirmation
        {
          price,
          bbUpper: currentBB.upper.toFixed(2),
          bbMiddle: currentBB.middle.toFixed(2),
          bbLower: currentBB.lower.toFixed(2),
          kcUpper: currentKC.upper.toFixed(2),
          kcLower: currentKC.lower.toFixed(2),
          kcMultiplier: params.kcMultiplier,
          rsi: currentRSI.toFixed(1),
          rsiPeriod: params.rsiPeriod,
          breakoutType: 'BELOW',
          tpPrice,
          slPrice,
          tpPct: params.takeProfitPct,  // Keep as decimal (e.g., 0.004 for 0.4%)
          slPct: params.stopLossPct,    // Keep as decimal (e.g., 0.002 for 0.2%)
          smartExit: `Exit at BB_Middle: ${currentBB.middle.toFixed(2)}`,
        },
        asset
      );

      console.log(`[BBSqueeze] 📤 EMITTING PUT SIGNAL for ${asset}`);
      return signal;
    } else if (breakoutBelow && !rsiBearish) {
      console.log(`[BBSqueeze] ⚠️  Breakout BELOW but RSI too strong (${currentRSI.toFixed(1)} >= 45) - SKIPPING`);
    }

    return null;
  }

  /**
   * Get signal readiness for dashboard
   */
  getSignalReadiness(candles: Candle[]): {
    asset: string;
    direction: 'call' | 'put' | 'neutral';
    overallProximity: number;
    criteria: Record<string, { met: boolean; value: string }>;
    readyToSignal: boolean;
    missingCriteria: string[];
  } | null {
    if (!candles || candles.length === 0) {
      return null;
    }

    const firstCandle = candles[0];
    if (!firstCandle) {
      return null;
    }

    const asset = firstCandle.asset;
    const params = this.getParamsForAsset(asset);

    if (candles.length < params.minCandles) {
      return null;
    }

    // Initialize asset state if needed
    if (this.lastTradeTime[asset] === undefined) this.lastTradeTime[asset] = 0;
    if (this.lastSqueezeTime[asset] === undefined) this.lastSqueezeTime[asset] = 0;

    // Check cooldown
    const now = Date.now();
    const timeSinceLastTrade = now - this.lastTradeTime[asset];
    const cooldownMs = params.cooldownSeconds * 1000;
    const cooldownOk = timeSinceLastTrade >= cooldownMs;

    // Calculate indicators
    const closes = candles.map(c => c.close);
    const bbResult = BollingerBands.calculate({
      period: params.bbPeriod,
      values: closes,
      stdDev: params.bbStdDev,
    });

    const kcResult = this.calculateKeltnerChannels(candles, params.kcMultiplier);

    if (!bbResult || bbResult.length === 0 || !kcResult || kcResult.length === 0) {
      return null;
    }

    const currentBB = bbResult[bbResult.length - 1];
    const currentKC = kcResult[kcResult.length - 1];
    const currentCandle = candles[candles.length - 1];

    if (!currentBB || !currentKC || !currentCandle) {
      return null;
    }

    const price = currentCandle.close;

    // Detect squeeze
    const bbUpperInsideKC = currentBB.upper < currentKC.upper;
    const bbLowerInsideKC = currentBB.lower > currentKC.lower;
    const isInSqueeze = bbUpperInsideKC && bbLowerInsideKC;

    // Check if recently in squeeze
    const timeSinceSqueeze = now - this.lastSqueezeTime[asset];
    const wasRecentlyInSqueeze = timeSinceSqueeze < 5 * 60 * 1000;

    // Check breakouts
    const breakoutAbove = price > currentBB.upper;
    const breakoutBelow = price < currentBB.lower;

    const callReady = breakoutAbove && wasRecentlyInSqueeze && cooldownOk;
    const putReady = breakoutBelow && wasRecentlyInSqueeze && cooldownOk;

    // Determine direction and proximity
    let direction: 'call' | 'put' | 'neutral' = 'neutral';
    let overallProximity = 0;

    if (callReady) {
      direction = 'call';
      overallProximity = 100;
    } else if (putReady) {
      direction = 'put';
      overallProximity = 100;
    } else {
      // Calculate proximity based on price distance to bands
      const distToUpper = Math.abs((price - currentBB.upper) / price);
      const distToLower = Math.abs((price - currentBB.lower) / price);

      const callProximity = Math.max(
        0,
        (isInSqueeze ? 50 : 0) +
        (wasRecentlyInSqueeze ? 25 : 0) +
        Math.max(0, 25 - (distToUpper * 10000))
      );

      const putProximity = Math.max(
        0,
        (isInSqueeze ? 50 : 0) +
        (wasRecentlyInSqueeze ? 25 : 0) +
        Math.max(0, 25 - (distToLower * 10000))
      );

      if (callProximity > putProximity) {
        direction = 'call';
        overallProximity = Math.min(100, callProximity);
      } else {
        direction = 'put';
        overallProximity = Math.min(100, putProximity);
      }
    }

    // Criteria
    const criteria = {
      'Squeeze Status': {
        met: isInSqueeze || wasRecentlyInSqueeze,
        value: isInSqueeze ? '💤 Active' : (wasRecentlyInSqueeze ? `🌊 Ended ${Math.round(timeSinceSqueeze / 1000)}s ago` : '❌ None'),
      },
      'Price vs BB_Upper': {
        met: breakoutAbove,
        value: `${price.toFixed(2)} ${breakoutAbove ? '>' : '<='} ${currentBB.upper.toFixed(2)}`,
      },
      'Price vs BB_Lower': {
        met: breakoutBelow,
        value: `${price.toFixed(2)} ${breakoutBelow ? '<' : '>='} ${currentBB.lower.toFixed(2)}`,
      },
      'Cooldown': {
        met: cooldownOk,
        value: cooldownOk ? 'Ready' : `${Math.ceil((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`,
      },
      'Asset Config': {
        met: true,
        value: `KC=${params.kcMultiplier}, RSI=${params.rsiPeriod}`,
      },
    };

    const missingCriteria: string[] = [];
    if (!isInSqueeze && !wasRecentlyInSqueeze) missingCriteria.push('Squeeze required');
    if (!breakoutAbove && direction === 'call') missingCriteria.push('Breakout above BB_Upper');
    if (!breakoutBelow && direction === 'put') missingCriteria.push('Breakout below BB_Lower');
    if (!cooldownOk) missingCriteria.push('Cooldown active');

    return {
      asset: currentCandle.asset,
      direction,
      overallProximity: Math.round(overallProximity),
      criteria,
      readyToSignal: callReady || putReady,
      missingCriteria,
    };
  }
}
