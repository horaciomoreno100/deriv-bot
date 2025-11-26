/**
 * Bollinger Band Squeeze Strategy - MEAN REVERSION VERSION
 *
 * Strategy: Mean Reversion based on volatility compression (BB Squeeze)
 *
 * MEAN REVERSION LOGIC:
 * - CALL when RSI < 45 AND price < BB_Lower (oversold, expect bounce UP)
 * - PUT when RSI > 55 AND price > BB_Upper (overbought, expect drop DOWN)
 *
 * This is the OPPOSITE of momentum:
 * - Momentum: "price broke up, buy up" (trend following)
 * - Mean Reversion: "price broke down, expect bounce UP" (contrarian)
 *
 * Logic:
 * - Detects "Squeeze" phases (low volatility) when BB is inside Keltner Channels
 * - After squeeze release, enters trades AGAINST the breakout direction
 * - Expects price to revert to mean (BB middle)
 *
 * Backtest Configuration:
 * - TP/SL: 0.5%/0.5% (1:1 ratio) - gives more room for trades to develop
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

/**
 * BB Squeeze Mean Reversion Strategy Parameters
 */
export interface BBSqueezeMRParams {
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
  /** RSI threshold for CALL (oversold) - CALL when RSI < this value */
  rsiCallMax: number;
  /** RSI threshold for PUT (overbought) - PUT when RSI > this value */
  rsiPutMin: number;
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
 * Asset-specific parameter overrides for Mean Reversion
 * Note: These may need re-optimization for Mean Reversion logic
 */
const ASSET_CONFIGS: Record<string, Partial<BBSqueezeMRParams>> = {
  'R_50': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.005,  // 0.5%
    stopLossPct: 0.005,    // 0.5% (1:1 ratio for MR)
  },
  'R_75': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.005,  // 0.5%
    stopLossPct: 0.005,    // 0.5% (1:1 ratio for MR)
  },
  'R_100': {
    kcMultiplier: 2.0,
    rsiPeriod: 14,
    takeProfitPct: 0.005,  // 0.5%
    stopLossPct: 0.005,    // 0.5% (1:1 ratio for MR)
  },
};

/**
 * Default base parameters for Mean Reversion
 */
const DEFAULT_PARAMS: BBSqueezeMRParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  rsiPeriod: 7,
  rsiCallMax: 45,           // CALL when RSI < 45 (oversold)
  rsiPutMin: 55,            // PUT when RSI > 55 (overbought)
  takeProfitPct: 0.005,     // 0.5% TP
  stopLossPct: 0.005,       // 0.5% SL (1:1 ratio)
  cooldownSeconds: 60,
  minCandles: 50,
  skipSaturday: true,
  enableTimeFilter: true,
  enableRSIFilter: true,
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
 * BB Squeeze Mean Reversion Strategy
 *
 * Trades AGAINST volatility breakouts after squeeze phases (contrarian approach)
 * With per-asset parameter optimization
 */
export class BBSqueezeMRStrategy extends BaseStrategy {
  private baseParams: BBSqueezeMRParams;
  private lastTradeTime: Record<string, number> = {};
  private inSqueeze: Record<string, boolean> = {};
  private lastSqueezeTime: Record<string, number> = {};

  constructor(config: StrategyConfig) {
    super(config);

    // Merge user params with defaults
    this.baseParams = {
      ...DEFAULT_PARAMS,
      ...(config.parameters as Partial<BBSqueezeMRParams>),
    };
  }

  /**
   * Get parameters for a specific asset
   */
  private getParamsForAsset(asset: string): BBSqueezeMRParams {
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

    console.log(`[BBSqueezeMR] 🔍 onCandle for ${asset} | price=${candle.close.toFixed(2)} | KC=${params.kcMultiplier} | RSI period=${params.rsiPeriod}`);

    // Need enough candles for indicators
    if (!candles || candles.length < params.minCandles) {
      console.log(`[BBSqueezeMR] ⏭️  Not enough candles: ${candles?.length || 0} < ${params.minCandles}`);
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
      console.log(`[BBSqueezeMR] ⏱️  Cooldown active: ${Math.ceil((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`);
      return null;
    }

    // Get time information for filters
    const candleDate = new Date(candle.timestamp);
    const dayOfWeek = candleDate.getUTCDay();
    const hourUTC = candleDate.getUTCHours();

    // Skip Saturday trades (backtest analysis: 70% loss rate on Saturdays)
    if (params.skipSaturday && dayOfWeek === 6) {
      console.log(`[BBSqueezeMR] 📅 Skipping Saturday trade for ${asset} - High loss rate day`);
      return null;
    }

    // Time window filter (avoid bad day+hour combinations)
    if (params.enableTimeFilter && !isGoodTimeWindow(dayOfWeek, hourUTC)) {
      console.log(`[BBSqueezeMR] ⏰ Skipping bad time window: day=${dayOfWeek}, hour=${hourUTC} for ${asset}`);
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
      console.log(`[BBSqueezeMR] ⚠️  BB calculation failed`);
      return null;
    }

    if (!kcResult || kcResult.length === 0) {
      console.log(`[BBSqueezeMR] ⚠️  KC calculation failed`);
      return null;
    }

    if (!rsiResult || rsiResult.length === 0) {
      console.log(`[BBSqueezeMR] ⚠️  RSI calculation failed`);
      return null;
    }

    // Get current values
    const currentBB = bbResult[bbResult.length - 1];
    const currentKC = kcResult[kcResult.length - 1];
    const currentRSI = rsiResult[rsiResult.length - 1];

    if (!currentBB || !currentKC || currentRSI === undefined) {
      console.log(`[BBSqueezeMR] ⚠️  Invalid indicator values`);
      return null;
    }

    const price = candle.close;

    console.log(`[BBSqueezeMR] 📊 BB: upper=${currentBB.upper.toFixed(2)}, middle=${currentBB.middle.toFixed(2)}, lower=${currentBB.lower.toFixed(2)}`);
    console.log(`[BBSqueezeMR] 📊 KC: upper=${currentKC.upper.toFixed(2)}, middle=${currentKC.middle.toFixed(2)}, lower=${currentKC.lower.toFixed(2)}`);
    console.log(`[BBSqueezeMR] 📊 RSI(${params.rsiPeriod}): ${currentRSI.toFixed(1)}`);

    // Detect Squeeze: BB is inside KC
    const bbUpperInsideKC = currentBB.upper < currentKC.upper;
    const bbLowerInsideKC = currentBB.lower > currentKC.lower;
    const isInSqueeze = bbUpperInsideKC && bbLowerInsideKC;

    if (isInSqueeze && !this.inSqueeze[asset]) {
      this.inSqueeze[asset] = true;
      this.lastSqueezeTime[asset] = now;
      console.log(`[BBSqueezeMR] 💤 SQUEEZE DETECTED for ${asset} (Low Volatility) - BB inside KC`);
      console.log(`[BBSqueezeMR]    BB Range: [${currentBB.lower.toFixed(2)}, ${currentBB.upper.toFixed(2)}]`);
      console.log(`[BBSqueezeMR]    KC Range: [${currentKC.lower.toFixed(2)}, ${currentKC.upper.toFixed(2)}]`);
    } else if (!isInSqueeze && this.inSqueeze[asset]) {
      console.log(`[BBSqueezeMR] 🌊 Squeeze ended for ${asset} - volatility expanding`);
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
      console.log(`[BBSqueezeMR] 📉 Skipping RSI indecision zone: RSI=${currentRSI.toFixed(1)} (30-40) for ${asset}`);
      return null;
    }

    // ============================================
    // MEAN REVERSION LOGIC (OPPOSITE OF MOMENTUM)
    // ============================================

    // CALL Signal: Price broke BELOW BB_Lower + RSI oversold = expect bounce UP
    const breakoutBelow = price < currentBB.lower;
    const rsiOversold = currentRSI < params.rsiCallMax; // RSI < 45

    if (breakoutBelow && rsiOversold) {
      console.log(`[BBSqueezeMR] 🔄 CALL SIGNAL (Mean Reversion) for ${asset}`);
      console.log(`[BBSqueezeMR]    Price: ${price.toFixed(2)} < BB_Lower: ${currentBB.lower.toFixed(2)} (Oversold)`);
      console.log(`[BBSqueezeMR]    RSI: ${currentRSI.toFixed(1)} < ${params.rsiCallMax} ✓ (Oversold, expect bounce UP)`);
      console.log(`[BBSqueezeMR]    Time since squeeze: ${Math.round(timeSinceSqueeze / 1000)}s`);
      console.log(`[BBSqueezeMR]    Asset params: KC=${params.kcMultiplier}, TP=${(params.takeProfitPct * 100).toFixed(2)}%, SL=${(params.stopLossPct * 100).toFixed(2)}%`);

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
          breakoutType: 'BELOW_MR', // Mean Reversion - price broke below, expect up
          tpPrice,
          slPrice,
          tpPct: params.takeProfitPct,
          slPct: params.stopLossPct,
          strategyType: 'MEAN_REVERSION',
          smartExit: `Exit at BB_Middle: ${currentBB.middle.toFixed(2)}`,
        },
        asset
      );

      console.log(`[BBSqueezeMR] 📤 EMITTING CALL SIGNAL for ${asset}`);
      return signal;
    } else if (breakoutBelow && !rsiOversold) {
      console.log(`[BBSqueezeMR] ⚠️  Breakout BELOW but RSI not oversold enough (${currentRSI.toFixed(1)} >= ${params.rsiCallMax}) - SKIPPING`);
    }

    // PUT Signal: Price broke ABOVE BB_Upper + RSI overbought = expect drop DOWN
    const breakoutAbove = price > currentBB.upper;
    const rsiOverbought = currentRSI > params.rsiPutMin; // RSI > 55

    if (breakoutAbove && rsiOverbought) {
      console.log(`[BBSqueezeMR] 🔄 PUT SIGNAL (Mean Reversion) for ${asset}`);
      console.log(`[BBSqueezeMR]    Price: ${price.toFixed(2)} > BB_Upper: ${currentBB.upper.toFixed(2)} (Overbought)`);
      console.log(`[BBSqueezeMR]    RSI: ${currentRSI.toFixed(1)} > ${params.rsiPutMin} ✓ (Overbought, expect drop DOWN)`);
      console.log(`[BBSqueezeMR]    Time since squeeze: ${Math.round(timeSinceSqueeze / 1000)}s`);
      console.log(`[BBSqueezeMR]    Asset params: KC=${params.kcMultiplier}, TP=${(params.takeProfitPct * 100).toFixed(2)}%, SL=${(params.stopLossPct * 100).toFixed(2)}%`);

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
          breakoutType: 'ABOVE_MR', // Mean Reversion - price broke above, expect down
          tpPrice,
          slPrice,
          tpPct: params.takeProfitPct,
          slPct: params.stopLossPct,
          strategyType: 'MEAN_REVERSION',
          smartExit: `Exit at BB_Middle: ${currentBB.middle.toFixed(2)}`,
        },
        asset
      );

      console.log(`[BBSqueezeMR] 📤 EMITTING PUT SIGNAL for ${asset}`);
      return signal;
    } else if (breakoutAbove && !rsiOverbought) {
      console.log(`[BBSqueezeMR] ⚠️  Breakout ABOVE but RSI not overbought enough (${currentRSI.toFixed(1)} <= ${params.rsiPutMin}) - SKIPPING`);
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

    const rsiResult = RSI.calculate({
      period: params.rsiPeriod,
      values: closes,
    });

    if (!bbResult || bbResult.length === 0 || !kcResult || kcResult.length === 0 || !rsiResult || rsiResult.length === 0) {
      return null;
    }

    const currentBB = bbResult[bbResult.length - 1];
    const currentKC = kcResult[kcResult.length - 1];
    const currentRSI = rsiResult[rsiResult.length - 1];
    const currentCandle = candles[candles.length - 1];

    if (!currentBB || !currentKC || currentRSI === undefined || !currentCandle) {
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

    // Check breakouts (Mean Reversion: opposite direction)
    const breakoutBelow = price < currentBB.lower;
    const breakoutAbove = price > currentBB.upper;
    const rsiOversold = currentRSI < params.rsiCallMax;
    const rsiOverbought = currentRSI > params.rsiPutMin;

    // Mean Reversion: CALL when oversold (price below + RSI low)
    const callReady = breakoutBelow && rsiOversold && wasRecentlyInSqueeze && cooldownOk;
    // Mean Reversion: PUT when overbought (price above + RSI high)
    const putReady = breakoutAbove && rsiOverbought && wasRecentlyInSqueeze && cooldownOk;

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

      // Mean Reversion: CALL proximity when close to lower band
      const callProximity = Math.max(
        0,
        (isInSqueeze ? 50 : 0) +
        (wasRecentlyInSqueeze ? 25 : 0) +
        Math.max(0, 25 - (distToLower * 10000))
      );

      // Mean Reversion: PUT proximity when close to upper band
      const putProximity = Math.max(
        0,
        (isInSqueeze ? 50 : 0) +
        (wasRecentlyInSqueeze ? 25 : 0) +
        Math.max(0, 25 - (distToUpper * 10000))
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
      'Price vs BB_Lower (CALL)': {
        met: breakoutBelow,
        value: `${price.toFixed(2)} ${breakoutBelow ? '<' : '>='} ${currentBB.lower.toFixed(2)}`,
      },
      'Price vs BB_Upper (PUT)': {
        met: breakoutAbove,
        value: `${price.toFixed(2)} ${breakoutAbove ? '>' : '<='} ${currentBB.upper.toFixed(2)}`,
      },
      'RSI Oversold (CALL)': {
        met: rsiOversold,
        value: `${currentRSI.toFixed(1)} ${rsiOversold ? '<' : '>='} ${params.rsiCallMax}`,
      },
      'RSI Overbought (PUT)': {
        met: rsiOverbought,
        value: `${currentRSI.toFixed(1)} ${rsiOverbought ? '>' : '<='} ${params.rsiPutMin}`,
      },
      'Cooldown': {
        met: cooldownOk,
        value: cooldownOk ? 'Ready' : `${Math.ceil((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`,
      },
      'Strategy Type': {
        met: true,
        value: 'MEAN REVERSION',
      },
    };

    const missingCriteria: string[] = [];
    if (!isInSqueeze && !wasRecentlyInSqueeze) missingCriteria.push('Squeeze required');
    if (!breakoutBelow && direction === 'call') missingCriteria.push('Price must be below BB_Lower for CALL');
    if (!breakoutAbove && direction === 'put') missingCriteria.push('Price must be above BB_Upper for PUT');
    if (!rsiOversold && direction === 'call') missingCriteria.push(`RSI must be < ${params.rsiCallMax} for CALL`);
    if (!rsiOverbought && direction === 'put') missingCriteria.push(`RSI must be > ${params.rsiPutMin} for PUT`);
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
