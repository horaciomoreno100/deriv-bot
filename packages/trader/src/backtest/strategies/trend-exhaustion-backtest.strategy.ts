/**
 * Trend Exhaustion Strategy - Backtest Adapter
 *
 * Detects the END of micro-trends and enters in the reversal direction.
 * Multiple detection methods can be tested independently or combined.
 *
 * Detection Methods:
 * 1. RSI Extreme + Divergence
 * 2. Pin Bar at Extreme Zone
 * 3. Engulfing Pattern + RSI
 * 4. Extreme Distance from EMA
 * 5. Exhaustion Pattern (shrinking candles)
 * 6. Multi-Signal Combo
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';

/**
 * Detection method type
 */
export type DetectionMethod =
  | 'rsi_divergence'
  | 'pin_bar'
  | 'engulfing'
  | 'ema_distance'
  | 'exhaustion_candles'
  | 'multi_combo'
  | 'zigzag_reversal'        // ZigZag swing detection
  | 'rsi_divergence_confirmed' // RSI divergence + confirmation candles
  | 'zigzag_rsi_combo'       // ZigZag + RSI + confirmation
  | 'choch'                  // CHoCH (Change of Character) - SMC method
  | 'choch_pullback'         // CHoCH + wait for pullback to broken level
  | 'zigzag_strong'          // ZigZag only after STRONG/EXPLOSIVE trends
  | 'zigzag_put_only';       // ZigZag only PUT signals (mejor WR)

/**
 * Strategy parameters
 */
export interface TrendExhaustionParams {
  // Detection method to use
  method: DetectionMethod;

  // RSI parameters
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  rsiDivergenceLookback: number;

  // EMA parameters
  emaPeriod: number;
  emaDistanceMultiplier: number; // ATR multiplier for "extreme" distance

  // Pin Bar parameters
  pinBarWickRatio: number; // Min wick size as % of candle range (0.6 = 60%)
  pinBarBodyRatio: number; // Max body size as % of candle range (0.3 = 30%)

  // Exhaustion parameters
  exhaustionLookback: number; // How many candles to check for shrinking pattern
  exhaustionShrinkRatio: number; // Each candle must be < this ratio of previous

  // Bollinger Bands
  bbPeriod: number;
  bbStdDev: number;

  // ATR
  atrPeriod: number;

  // Risk management
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
  minCandles: number;
  maxHoldBars: number;

  // ZigZag parameters
  zigzagDeviation: number;  // Min % move to confirm swing
  zigzagDepth: number;      // Min bars between swings

  // Confirmation parameters
  confirmationBars: number;  // How many confirming candles needed
  confirmationMinMove: number; // Min move in confirmation direction (% of ATR)

  // CHoCH (Change of Character) parameters
  chochLookback: number;     // How many bars to look for structure
  chochMinSwingSize: number; // Min ATR multiplier for a valid swing

  // Trend strength filter (for zigzag_strong)
  minTrendStrength: 'weak' | 'moderate' | 'strong' | 'explosive';  // Min strength to trade
  minTrendPctChange: number;  // Min % change in trend (e.g., 0.5 = 0.5%)
  minTrendDuration: number;   // Min candles in trend
}

const DEFAULT_PARAMS: TrendExhaustionParams = {
  method: 'rsi_divergence',

  // RSI - más relajado para detectar más señales
  rsiPeriod: 14,
  rsiOversold: 35,  // Era 25, ahora 35 para más señales
  rsiOverbought: 65, // Era 75, ahora 65 para más señales
  rsiDivergenceLookback: 8,

  // EMA distance - más sensible
  emaPeriod: 20,
  emaDistanceMultiplier: 1.2, // Era 2.0, ahora 1.2 ATR

  // Pin Bar - más permisivo
  pinBarWickRatio: 0.5,  // Era 0.6
  pinBarBodyRatio: 0.4,  // Era 0.35

  // Exhaustion - más fácil de detectar
  exhaustionLookback: 3,  // Era 4
  exhaustionShrinkRatio: 0.95, // Era 0.8

  bbPeriod: 20,
  bbStdDev: 2,

  atrPeriod: 14,

  takeProfitPct: 0.005,
  stopLossPct: 0.003,
  cooldownBars: 2,  // Era 3
  minCandles: 30,   // Era 50
  maxHoldBars: 20,

  // ZigZag
  zigzagDeviation: 0.3,  // 0.3% para detectar micro-swings
  zigzagDepth: 5,

  // Confirmation - esperar rebote
  confirmationBars: 2,      // Esperar 2 velas de confirmación
  confirmationMinMove: 0.3, // Mínimo 0.3 ATR en dirección del rebote

  // CHoCH
  chochLookback: 30,        // Mirar 30 velas para estructura
  chochMinSwingSize: 0.5,   // Mínimo 0.5 ATR para un swing válido

  // Trend strength filter
  minTrendStrength: 'strong',  // Solo operar después de tendencias fuertes
  minTrendPctChange: 0.5,      // Mínimo 0.5% cambio de precio
  minTrendDuration: 5,         // Mínimo 5 velas
};

/**
 * Trend Exhaustion Strategy
 */
export class TrendExhaustionBacktestStrategy implements BacktestableStrategy {
  readonly name: string;
  readonly version = '1.0.0';

  private params: TrendExhaustionParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  // For divergence detection
  private rsiHistory: number[] = [];
  private priceHistory: number[] = [];

  // For CHoCH detection - track market structure
  private swingHighs: { idx: number; price: number }[] = [];
  private swingLows: { idx: number; price: number }[] = [];
  private lastStructure: 'uptrend' | 'downtrend' | 'unknown' = 'unknown';
  private chochDetected: { type: 'bullish' | 'bearish'; level: number; idx: number } | null = null;

  // For CHoCH Pullback - track confirmed CHoCH waiting for pullback
  private pendingChoch: {
    direction: 'CALL' | 'PUT';
    brokenLevel: number;
    breakIdx: number;
    swingLow?: number;  // For bullish - the low that formed the reversal
    swingHigh?: number; // For bearish - the high that formed the reversal
  } | null = null;

  constructor(asset: string, method: DetectionMethod, customParams?: Partial<TrendExhaustionParams>) {
    this.asset = asset;
    this.params = { ...DEFAULT_PARAMS, method, ...customParams };
    this.name = `TrendExhaustion-${method}`;
  }

  requiredIndicators(): string[] {
    const base = ['rsi', 'ema20', 'bbUpper', 'bbMiddle', 'bbLower', 'atr'];
    // Add zigzag indicators for methods that use them
    if (this.params.method === 'zigzag_reversal' ||
        this.params.method === 'zigzag_rsi_combo' ||
        this.params.method === 'rsi_divergence_confirmed' ||
        this.params.method === 'zigzag_strong' ||
        this.params.method === 'zigzag_put_only') {
      return [...base, 'zigzag', 'lastSwingHigh', 'lastSwingLow', 'lastSwingHighIdx', 'lastSwingLowIdx', 'zigzagType'];
    }
    return base;
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      takeProfitPct: this.params.takeProfitPct,
      stopLossPct: this.params.stopLossPct,
      cooldownBars: this.params.cooldownBars,
    };
  }

  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    if (currentIndex < this.params.minCandles) return null;

    // Cooldown check
    if (this.lastTradeIndex >= 0 && currentIndex - this.lastTradeIndex < this.params.cooldownBars) {
      return null;
    }

    const candle = candles[currentIndex];
    if (!candle) return null;

    const price = candle.close;
    const rsi = indicators.rsi as number | undefined;
    const ema20 = indicators.ema20 as number | undefined;
    const bbUpper = indicators.bbUpper as number | undefined;
    const bbLower = indicators.bbLower as number | undefined;
    const bbMiddle = indicators.bbMiddle as number | undefined;
    const atr = indicators.atr as number | undefined;

    if (rsi === undefined || ema20 === undefined || atr === undefined) {
      return null;
    }

    // EDGE FILTERS: Time-based filters
    const entryTime = new Date(candle.timestamp * 1000);
    const hour = entryTime.getUTCHours();
    const dayOfWeek = entryTime.getUTCDay(); // 0=Sunday, 4=Thursday
    
    // Best hours: 2, 8, 12, 16, 20 UTC (from edge analysis)
    const bestHours = [2, 8, 12, 16, 20];
    if (!bestHours.includes(hour)) {
      return null; // Skip trades outside best hours
    }
    
    // Avoid Thursday (worst day: 41.7% WR)
    if (dayOfWeek === 4) {
      return null; // Skip Thursday
    }

    // Update history for divergence
    this.rsiHistory.push(rsi);
    this.priceHistory.push(price);
    if (this.rsiHistory.length > this.params.rsiDivergenceLookback) {
      this.rsiHistory.shift();
      this.priceHistory.shift();
    }

    let signal: { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null = null;

    // Apply detection method
    switch (this.params.method) {
      case 'rsi_divergence':
        signal = this.detectRSIDivergence(candles, currentIndex, rsi, price);
        break;
      case 'pin_bar':
        signal = this.detectPinBar(candle, rsi, bbUpper, bbLower, price, ema20);
        break;
      case 'engulfing':
        signal = this.detectEngulfing(candles, currentIndex, rsi);
        break;
      case 'ema_distance':
        signal = this.detectEMADistance(candles, currentIndex, price, ema20, atr);
        break;
      case 'exhaustion_candles':
        signal = this.detectExhaustionCandles(candles, currentIndex, rsi);
        break;
      case 'multi_combo':
        signal = this.detectMultiCombo(candles, currentIndex, candle, rsi, price, ema20, atr, bbUpper, bbLower);
        break;
      case 'zigzag_reversal':
        signal = this.detectZigZagReversal(candles, currentIndex, indicators, rsi, atr);
        break;
      case 'rsi_divergence_confirmed':
        signal = this.detectRSIDivergenceConfirmed(candles, currentIndex, indicators, rsi, price, atr);
        break;
      case 'zigzag_rsi_combo':
        signal = this.detectZigZagRSICombo(candles, currentIndex, indicators, rsi, price, atr);
        break;
      case 'choch':
        signal = this.detectCHoCH(candles, currentIndex, atr);
        break;
      case 'choch_pullback':
        signal = this.detectCHoCHPullback(candles, currentIndex, atr);
        break;
      case 'zigzag_strong':
        signal = this.detectZigZagStrong(candles, currentIndex, indicators, rsi, atr);
        break;
      case 'zigzag_put_only':
        signal = this.detectZigZagPutOnly(candles, currentIndex, indicators, rsi, atr);
        break;
    }

    if (!signal) return null;

    this.lastTradeIndex = currentIndex;

    const snapshot: MarketSnapshot = {
      timestamp: candle.timestamp * 1000,
      candle: {
        index: currentIndex,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      },
      price,
      indicators: {
        ...indicators,
        detectionMethod: this.params.method,
      },
    };

    return {
      timestamp: candle.timestamp,
      direction: signal.direction,
      price,
      confidence: signal.confidence,
      reason: signal.reason,
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot,
      suggestedTpPct: this.params.takeProfitPct,
      suggestedSlPct: this.params.stopLossPct,
    };
  }

  /**
   * Method 1: RSI Extreme + Divergence
   */
  private detectRSIDivergence(
    candles: Candle[],
    currentIndex: number,
    rsi: number,
    price: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    if (this.rsiHistory.length < this.params.rsiDivergenceLookback) return null;

    // Bullish divergence: price makes lower low, RSI makes higher low
    if (rsi < this.params.rsiOversold) {
      const priceMin = Math.min(...this.priceHistory.slice(0, -1));
      const rsiAtPriceMin = this.rsiHistory[this.priceHistory.indexOf(priceMin)];

      if (price < priceMin && rsiAtPriceMin !== undefined && rsi > rsiAtPriceMin) {
        return {
          direction: 'CALL',
          confidence: 75 + Math.min((this.params.rsiOversold - rsi), 15),
          reason: `RSI Bullish Divergence: Price lower low (${price.toFixed(2)} < ${priceMin.toFixed(2)}) but RSI higher low (${rsi.toFixed(1)} > ${rsiAtPriceMin.toFixed(1)})`,
        };
      }
    }

    // Bearish divergence: price makes higher high, RSI makes lower high
    if (rsi > this.params.rsiOverbought) {
      const priceMax = Math.max(...this.priceHistory.slice(0, -1));
      const rsiAtPriceMax = this.rsiHistory[this.priceHistory.indexOf(priceMax)];

      if (price > priceMax && rsiAtPriceMax !== undefined && rsi < rsiAtPriceMax) {
        return {
          direction: 'PUT',
          confidence: 75 + Math.min((rsi - this.params.rsiOverbought), 15),
          reason: `RSI Bearish Divergence: Price higher high (${price.toFixed(2)} > ${priceMax.toFixed(2)}) but RSI lower high (${rsi.toFixed(1)} < ${rsiAtPriceMax.toFixed(1)})`,
        };
      }
    }

    return null;
  }

  /**
   * Method 2: Pin Bar at Extreme Zone
   * Improved version with trend filter and stricter RSI
   */
  private detectPinBar(
    candle: Candle,
    rsi: number,
    bbUpper?: number,
    bbLower?: number,
    price?: number,
    ema20?: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const range = candle.high - candle.low;
    if (range === 0) return null;

    const body = Math.abs(candle.close - candle.open);
    const bodyRatio = body / range;

    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    // Bullish Pin Bar: long lower wick, small body
    // Detecta rechazo de precios bajos (mecha inferior larga)
    if (lowerWick / range >= this.params.pinBarWickRatio && bodyRatio <= this.params.pinBarBodyRatio) {
      const nearLowerBB = bbLower !== undefined && candle.low <= bbLower * 1.01;
      // Use RSI threshold from params
      const rsiLow = rsi < this.params.rsiOversold;
      
      // EDGE FILTER: Prefer wick ratio 60-70% (best performance: 61% WR)
      const wickRatioPct = (lowerWick / range) * 100;
      const optimalWickRatio = wickRatioPct >= 60 && wickRatioPct <= 70;
      const wickRatioBonus = optimalWickRatio ? 10 : 0;

      // EDGE FILTER: Prefer RSI lower (30-40) or upper (60-70) - avoid neutral
      const rsiLower = rsi >= 30 && rsi < 40; // Lower RSI range
      const rsiUpper = rsi >= 60 && rsi < 70; // Upper RSI range (works for CALL too in some cases)
      const rsiEdge = rsiLower || rsiUpper;
      
      // Necesitamos al menos una condición adicional
      if (nearLowerBB || rsiLow) {
        // EDGE FILTER: Prefer near BB (55.9% WR vs 48.1%)
        if (!nearLowerBB && !rsiEdge) {
          return null; // Skip if not near BB and not in edge RSI range
        }
        
        // Trend filter: only CALL if price >= EMA20 (with trend) or very close (within 0.1%)
        const priceDiff = price !== undefined && ema20 !== undefined ? (price - ema20) / ema20 : 0;
        if (price !== undefined && ema20 !== undefined && priceDiff < -0.001) {
          return null; // Skip if significantly against trend (>0.1% below EMA)
        }

        const trendBonus = price !== undefined && ema20 !== undefined && price >= ema20 ? 5 : 0;
        const rsiExtremeBonus = rsi < (this.params.rsiOversold - 5) ? 10 : 0;
        const edgeBonus = (nearLowerBB ? 10 : 0) + (rsiEdge ? 5 : 0) + wickRatioBonus;
        
        return {
          direction: 'CALL',
          confidence: 70 + (nearLowerBB ? 15 : 0) + rsiExtremeBonus + trendBonus + edgeBonus,
          reason: `Bullish Pin Bar: Wick ${(lowerWick / range * 100).toFixed(0)}%, RSI=${rsi.toFixed(1)}${price !== undefined && ema20 !== undefined ? `, Price ${price >= ema20 ? '≥' : '<'} EMA20` : ''}${optimalWickRatio ? ' [Optimal Wick]' : ''}${rsiEdge ? ' [Edge RSI]' : ''}`,
        };
      }
    }

    // Bearish Pin Bar: long upper wick, small body
    // Detecta rechazo de precios altos (mecha superior larga)
    if (upperWick / range >= this.params.pinBarWickRatio && bodyRatio <= this.params.pinBarBodyRatio) {
      const nearUpperBB = bbUpper !== undefined && candle.high >= bbUpper * 0.99;
      // Use RSI threshold from params
      const rsiHigh = rsi > this.params.rsiOverbought;
      
      // EDGE FILTER: Prefer wick ratio 60-70% (best performance: 61% WR)
      const wickRatioPct = (upperWick / range) * 100;
      const optimalWickRatio = wickRatioPct >= 60 && wickRatioPct <= 70;
      const wickRatioBonus = optimalWickRatio ? 10 : 0;
      
      // EDGE FILTER: Prefer RSI upper (60-70) - best for PUT (61.5% WR)
      const rsiUpper = rsi >= 60 && rsi < 70; // Upper RSI range (best edge)
      const rsiEdge = rsiUpper;

      if (nearUpperBB || rsiHigh) {
        // EDGE FILTER: Prefer near BB or upper RSI
        if (!nearUpperBB && !rsiEdge) {
          return null; // Skip if not near BB and not in edge RSI range
        }
        
        // Trend filter: only PUT if price <= EMA20 (with trend) or very close (within 0.1%)
        const priceDiff = price !== undefined && ema20 !== undefined ? (price - ema20) / ema20 : 0;
        if (price !== undefined && ema20 !== undefined && priceDiff > 0.001) {
          return null; // Skip if significantly against trend (>0.1% above EMA)
        }

        const trendBonus = price !== undefined && ema20 !== undefined && price <= ema20 ? 5 : 0;
        const rsiExtremeBonus = rsi > (this.params.rsiOverbought + 5) ? 10 : 0;
        const edgeBonus = (nearUpperBB ? 10 : 0) + (rsiEdge ? 10 : 0) + wickRatioBonus; // Upper RSI is strong edge for PUT
        
        return {
          direction: 'PUT',
          confidence: 70 + (nearUpperBB ? 15 : 0) + rsiExtremeBonus + trendBonus + edgeBonus,
          reason: `Bearish Pin Bar: Wick ${(upperWick / range * 100).toFixed(0)}%, RSI=${rsi.toFixed(1)}${price !== undefined && ema20 !== undefined ? `, Price ${price <= ema20 ? '≤' : '>'} EMA20` : ''}${optimalWickRatio ? ' [Optimal Wick]' : ''}${rsiEdge ? ' [Edge RSI]' : ''}`,
        };
      }
    }

    return null;
  }

  /**
   * Method 3: Engulfing Pattern + RSI
   */
  private detectEngulfing(
    candles: Candle[],
    currentIndex: number,
    rsi: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    if (currentIndex < 1) return null;

    const current = candles[currentIndex]!;
    const previous = candles[currentIndex - 1]!;

    const currentBody = current.close - current.open;
    const previousBody = previous.close - previous.open;

    // Bullish Engulfing: previous red, current green that engulfs
    // Solo necesitamos que el body verde sea mayor y RSI no esté sobrecomprado
    if (previousBody < 0 && currentBody > 0) {
      const engulfs = current.open <= previous.close && current.close >= previous.open;
      const strongBody = Math.abs(currentBody) > Math.abs(previousBody) * 0.8;

      if ((engulfs || strongBody) && rsi < 55) {
        return {
          direction: 'CALL',
          confidence: 65 + (engulfs ? 10 : 0) + (rsi < 40 ? 15 : 0),
          reason: `Bullish Engulfing: Green > Red, RSI=${rsi.toFixed(1)}`,
        };
      }
    }

    // Bearish Engulfing: previous green, current red that engulfs
    if (previousBody > 0 && currentBody < 0) {
      const engulfs = current.open >= previous.close && current.close <= previous.open;
      const strongBody = Math.abs(currentBody) > Math.abs(previousBody) * 0.8;

      if ((engulfs || strongBody) && rsi > 45) {
        return {
          direction: 'PUT',
          confidence: 65 + (engulfs ? 10 : 0) + (rsi > 60 ? 15 : 0),
          reason: `Bearish Engulfing: Red > Green, RSI=${rsi.toFixed(1)}`,
        };
      }
    }

    return null;
  }

  /**
   * Method 4: Extreme Distance from EMA
   */
  private detectEMADistance(
    candles: Candle[],
    currentIndex: number,
    price: number,
    ema20: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const distance = price - ema20;
    const threshold = atr * this.params.emaDistanceMultiplier;

    // Check for reversion starting
    if (currentIndex < 2) return null;
    const prev1 = candles[currentIndex - 1]!;
    const prev2 = candles[currentIndex - 2]!;

    // Price far below EMA and starting to reverse up
    if (distance < -threshold) {
      const reversing = candles[currentIndex]!.close > prev1.close && prev1.close > prev2.close;
      if (reversing) {
        return {
          direction: 'CALL',
          confidence: 70 + Math.min(Math.abs(distance / atr) * 5, 20),
          reason: `EMA Distance Reversal: Price ${(distance / atr).toFixed(1)} ATR below EMA20, reversing up`,
        };
      }
    }

    // Price far above EMA and starting to reverse down
    if (distance > threshold) {
      const reversing = candles[currentIndex]!.close < prev1.close && prev1.close < prev2.close;
      if (reversing) {
        return {
          direction: 'PUT',
          confidence: 70 + Math.min(Math.abs(distance / atr) * 5, 20),
          reason: `EMA Distance Reversal: Price ${(distance / atr).toFixed(1)} ATR above EMA20, reversing down`,
        };
      }
    }

    return null;
  }

  /**
   * Method 5: Exhaustion Candles (shrinking pattern)
   */
  private detectExhaustionCandles(
    candles: Candle[],
    currentIndex: number,
    rsi: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    if (currentIndex < this.params.exhaustionLookback + 1) return null;

    const lookback = this.params.exhaustionLookback;
    const recentCandles = candles.slice(currentIndex - lookback, currentIndex + 1);

    // Check for downtrend exhaustion (bullish signal)
    let allRed = true;
    let shrinking = true;
    for (let i = 1; i < recentCandles.length; i++) {
      const current = recentCandles[i]!;
      const previous = recentCandles[i - 1]!;

      if (current.close >= current.open) allRed = false;

      const currentRange = current.high - current.low;
      const previousRange = previous.high - previous.low;

      if (currentRange > previousRange * this.params.exhaustionShrinkRatio) {
        shrinking = false;
      }
    }

    if (allRed && shrinking && rsi < 35) {
      return {
        direction: 'CALL',
        confidence: 75,
        reason: `Downtrend Exhaustion: ${lookback} shrinking red candles, RSI=${rsi.toFixed(1)}`,
      };
    }

    // Check for uptrend exhaustion (bearish signal)
    let allGreen = true;
    shrinking = true;
    for (let i = 1; i < recentCandles.length; i++) {
      const current = recentCandles[i]!;
      const previous = recentCandles[i - 1]!;

      if (current.close <= current.open) allGreen = false;

      const currentRange = current.high - current.low;
      const previousRange = previous.high - previous.low;

      if (currentRange > previousRange * this.params.exhaustionShrinkRatio) {
        shrinking = false;
      }
    }

    if (allGreen && shrinking && rsi > 65) {
      return {
        direction: 'PUT',
        confidence: 75,
        reason: `Uptrend Exhaustion: ${lookback} shrinking green candles, RSI=${rsi.toFixed(1)}`,
      };
    }

    return null;
  }

  /**
   * Method 6: Multi-Signal Combo
   */
  private detectMultiCombo(
    candles: Candle[],
    currentIndex: number,
    candle: Candle,
    rsi: number,
    price: number,
    ema20: number,
    atr: number,
    bbUpper?: number,
    bbLower?: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    let bullishSignals = 0;
    let bearishSignals = 0;
    const reasons: string[] = [];

    // Check RSI extreme
    if (rsi < 30) {
      bullishSignals++;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      bearishSignals++;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    }

    // Check BB position
    if (bbLower && price <= bbLower) {
      bullishSignals++;
      reasons.push('At BB Lower');
    } else if (bbUpper && price >= bbUpper) {
      bearishSignals++;
      reasons.push('At BB Upper');
    }

    // Check EMA distance
    const emaDistance = (price - ema20) / atr;
    if (emaDistance < -1.5) {
      bullishSignals++;
      reasons.push(`${Math.abs(emaDistance).toFixed(1)} ATR below EMA`);
    } else if (emaDistance > 1.5) {
      bearishSignals++;
      reasons.push(`${emaDistance.toFixed(1)} ATR above EMA`);
    }

    // Check for Pin Bar
    const range = candle.high - candle.low;
    if (range > 0) {
      const body = Math.abs(candle.close - candle.open);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const upperWick = candle.high - Math.max(candle.open, candle.close);

      if (lowerWick / range > 0.5 && body / range < 0.3) {
        bullishSignals++;
        reasons.push('Bullish Pin Bar');
      } else if (upperWick / range > 0.5 && body / range < 0.3) {
        bearishSignals++;
        reasons.push('Bearish Pin Bar');
      }
    }

    // Check for Engulfing
    if (currentIndex > 0) {
      const prev = candles[currentIndex - 1]!;
      const currBody = candle.close - candle.open;
      const prevBody = prev.close - prev.open;

      if (prevBody < 0 && currBody > 0 && candle.open <= prev.close && candle.close >= prev.open) {
        bullishSignals++;
        reasons.push('Bullish Engulfing');
      } else if (prevBody > 0 && currBody < 0 && candle.open >= prev.close && candle.close <= prev.open) {
        bearishSignals++;
        reasons.push('Bearish Engulfing');
      }
    }

    // Need at least 2 signals
    if (bullishSignals >= 2 && bullishSignals > bearishSignals) {
      return {
        direction: 'CALL',
        confidence: 60 + bullishSignals * 10,
        reason: `Multi-Combo CALL (${bullishSignals} signals): ${reasons.join(', ')}`,
      };
    }

    if (bearishSignals >= 2 && bearishSignals > bullishSignals) {
      return {
        direction: 'PUT',
        confidence: 60 + bearishSignals * 10,
        reason: `Multi-Combo PUT (${bearishSignals} signals): ${reasons.join(', ')}`,
      };
    }

    return null;
  }

  /**
   * Method 7: ZigZag Reversal
   * Enters when ZigZag detects a swing high/low and price starts reversing
   */
  private detectZigZagReversal(
    candles: Candle[],
    currentIndex: number,
    indicators: IndicatorSnapshot,
    rsi: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const lastSwingLowIdx = indicators.lastSwingLowIdx as number | undefined;
    const lastSwingHighIdx = indicators.lastSwingHighIdx as number | undefined;
    const lastSwingLow = indicators.lastSwingLow as number | undefined;
    const lastSwingHigh = indicators.lastSwingHigh as number | undefined;

    if (lastSwingLowIdx === undefined || lastSwingHighIdx === undefined) return null;
    if (lastSwingLow === undefined || lastSwingHigh === undefined) return null;

    const candle = candles[currentIndex]!;
    const { confirmationBars, confirmationMinMove } = this.params;
    const minMove = atr * confirmationMinMove;

    // Check for bullish reversal from swing low
    // Swing low must be recent (within last 10 bars) and we need confirmation
    if (lastSwingLowIdx > lastSwingHighIdx && currentIndex - lastSwingLowIdx <= 10) {
      // Check confirmation: consecutive higher closes
      let confirmedBars = 0;
      let totalMove = 0;

      for (let i = 1; i <= confirmationBars && currentIndex - i >= lastSwingLowIdx; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;
        if (bar.close > prevBar.close) {
          confirmedBars++;
          totalMove += bar.close - prevBar.close;
        }
      }

      if (confirmedBars >= confirmationBars && totalMove >= minMove && rsi < 50) {
        return {
          direction: 'CALL',
          confidence: 70 + Math.min(confirmedBars * 5, 20),
          reason: `ZigZag Bullish Reversal: Swing low at ${lastSwingLow.toFixed(2)}, ${confirmedBars} confirmation bars, RSI=${rsi.toFixed(1)}`,
        };
      }
    }

    // Check for bearish reversal from swing high
    if (lastSwingHighIdx > lastSwingLowIdx && currentIndex - lastSwingHighIdx <= 10) {
      // Check confirmation: consecutive lower closes
      let confirmedBars = 0;
      let totalMove = 0;

      for (let i = 1; i <= confirmationBars && currentIndex - i >= lastSwingHighIdx; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;
        if (bar.close < prevBar.close) {
          confirmedBars++;
          totalMove += prevBar.close - bar.close;
        }
      }

      if (confirmedBars >= confirmationBars && totalMove >= minMove && rsi > 50) {
        return {
          direction: 'PUT',
          confidence: 70 + Math.min(confirmedBars * 5, 20),
          reason: `ZigZag Bearish Reversal: Swing high at ${lastSwingHigh.toFixed(2)}, ${confirmedBars} confirmation bars, RSI=${rsi.toFixed(1)}`,
        };
      }
    }

    return null;
  }

  /**
   * Method 8: RSI Divergence + Confirmation
   * Same as RSI divergence but waits for confirmation candles before entry
   */
  private detectRSIDivergenceConfirmed(
    candles: Candle[],
    currentIndex: number,
    indicators: IndicatorSnapshot,
    rsi: number,
    price: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    if (this.rsiHistory.length < this.params.rsiDivergenceLookback) return null;

    const { confirmationBars, confirmationMinMove } = this.params;
    const minMove = atr * confirmationMinMove;
    const candle = candles[currentIndex]!;

    // First check if we're in a potential divergence zone (RSI was recently extreme)
    const recentRSIMin = Math.min(...this.rsiHistory);
    const recentRSIMax = Math.max(...this.rsiHistory);

    // Bullish divergence confirmation
    if (recentRSIMin < this.params.rsiOversold) {
      // Find the index where RSI was at minimum
      const rsiMinIdx = this.rsiHistory.indexOf(recentRSIMin);
      const priceAtRSIMin = this.priceHistory[rsiMinIdx];

      // Check if current RSI is higher (divergence)
      if (priceAtRSIMin !== undefined && rsi > recentRSIMin + 5) {
        // Now check for confirmation: price must be rising
        let confirmedBars = 0;
        let totalMove = 0;

        for (let i = 1; i <= confirmationBars && currentIndex - i >= 0; i++) {
          const bar = candles[currentIndex - i + 1]!;
          const prevBar = candles[currentIndex - i]!;
          if (bar.close > prevBar.close) {
            confirmedBars++;
            totalMove += bar.close - prevBar.close;
          }
        }

        // Require higher low formation: current low > recent low
        const recentLow = Math.min(...candles.slice(Math.max(0, currentIndex - 5), currentIndex).map(c => c.low));
        const higherLow = candle.low > recentLow * 0.999; // Allow small tolerance

        if (confirmedBars >= confirmationBars && totalMove >= minMove && higherLow) {
          return {
            direction: 'CALL',
            confidence: 75 + Math.min(confirmedBars * 5, 15),
            reason: `RSI Divergence Confirmed: RSI rose from ${recentRSIMin.toFixed(1)} to ${rsi.toFixed(1)}, ${confirmedBars} bullish bars, higher low formed`,
          };
        }
      }
    }

    // Bearish divergence confirmation
    if (recentRSIMax > this.params.rsiOverbought) {
      // Find the index where RSI was at maximum
      const rsiMaxIdx = this.rsiHistory.indexOf(recentRSIMax);
      const priceAtRSIMax = this.priceHistory[rsiMaxIdx];

      // Check if current RSI is lower (divergence)
      if (priceAtRSIMax !== undefined && rsi < recentRSIMax - 5) {
        // Now check for confirmation: price must be falling
        let confirmedBars = 0;
        let totalMove = 0;

        for (let i = 1; i <= confirmationBars && currentIndex - i >= 0; i++) {
          const bar = candles[currentIndex - i + 1]!;
          const prevBar = candles[currentIndex - i]!;
          if (bar.close < prevBar.close) {
            confirmedBars++;
            totalMove += prevBar.close - bar.close;
          }
        }

        // Require lower high formation: current high < recent high
        const recentHigh = Math.max(...candles.slice(Math.max(0, currentIndex - 5), currentIndex).map(c => c.high));
        const lowerHigh = candle.high < recentHigh * 1.001;

        if (confirmedBars >= confirmationBars && totalMove >= minMove && lowerHigh) {
          return {
            direction: 'PUT',
            confidence: 75 + Math.min(confirmedBars * 5, 15),
            reason: `RSI Divergence Confirmed: RSI fell from ${recentRSIMax.toFixed(1)} to ${rsi.toFixed(1)}, ${confirmedBars} bearish bars, lower high formed`,
          };
        }
      }
    }

    return null;
  }

  /**
   * Method 9: ZigZag + RSI Combo
   * Combines ZigZag swing detection with RSI extreme and confirmation
   * This is the most conservative method - requires multiple confluences
   */
  private detectZigZagRSICombo(
    candles: Candle[],
    currentIndex: number,
    indicators: IndicatorSnapshot,
    rsi: number,
    price: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const lastSwingLowIdx = indicators.lastSwingLowIdx as number | undefined;
    const lastSwingHighIdx = indicators.lastSwingHighIdx as number | undefined;
    const lastSwingLow = indicators.lastSwingLow as number | undefined;
    const lastSwingHigh = indicators.lastSwingHigh as number | undefined;

    if (lastSwingLowIdx === undefined || lastSwingHighIdx === undefined) return null;
    if (lastSwingLow === undefined || lastSwingHigh === undefined) return null;

    const candle = candles[currentIndex]!;
    const { confirmationBars, confirmationMinMove, rsiOversold, rsiOverbought } = this.params;
    const minMove = atr * confirmationMinMove;

    // Bullish combo:
    // 1. Recent swing low detected by ZigZag (within 15 bars)
    // 2. RSI was oversold near the swing low
    // 3. Price has bounced and forming higher lows
    // 4. Confirmation candles present
    if (lastSwingLowIdx > lastSwingHighIdx && currentIndex - lastSwingLowIdx <= 15) {
      // Check RSI was oversold near swing low
      const rsiAtSwingLow = this.rsiHistory[Math.max(0, this.rsiHistory.length - (currentIndex - lastSwingLowIdx))] ?? rsi;
      const wasOversold = rsiAtSwingLow < rsiOversold + 10; // More lenient

      if (!wasOversold) return null;

      // Check for higher low formation
      const barsAfterSwing = currentIndex - lastSwingLowIdx;
      if (barsAfterSwing < 2) return null;

      const recentLows = candles.slice(lastSwingLowIdx, currentIndex + 1).map(c => c.low);
      const lowestAfterSwing = Math.min(...recentLows.slice(1));
      const higherLow = lowestAfterSwing >= lastSwingLow * 0.998;

      // Check confirmation
      let bullishBars = 0;
      let totalMove = 0;
      for (let i = 1; i <= confirmationBars && currentIndex - i >= lastSwingLowIdx; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;
        if (bar.close > prevBar.close) {
          bullishBars++;
          totalMove += bar.close - prevBar.close;
        }
      }

      if (higherLow && bullishBars >= confirmationBars && totalMove >= minMove && rsi > rsiAtSwingLow) {
        return {
          direction: 'CALL',
          confidence: 80 + Math.min(bullishBars * 5, 15),
          reason: `ZigZag+RSI Combo: Swing low ${lastSwingLow.toFixed(2)}, RSI was ${rsiAtSwingLow.toFixed(1)} now ${rsi.toFixed(1)}, higher low + ${bullishBars} bullish bars`,
        };
      }
    }

    // Bearish combo:
    // 1. Recent swing high detected by ZigZag (within 15 bars)
    // 2. RSI was overbought near the swing high
    // 3. Price has dropped and forming lower highs
    // 4. Confirmation candles present
    if (lastSwingHighIdx > lastSwingLowIdx && currentIndex - lastSwingHighIdx <= 15) {
      // Check RSI was overbought near swing high
      const rsiAtSwingHigh = this.rsiHistory[Math.max(0, this.rsiHistory.length - (currentIndex - lastSwingHighIdx))] ?? rsi;
      const wasOverbought = rsiAtSwingHigh > rsiOverbought - 10;

      if (!wasOverbought) return null;

      // Check for lower high formation
      const barsAfterSwing = currentIndex - lastSwingHighIdx;
      if (barsAfterSwing < 2) return null;

      const recentHighs = candles.slice(lastSwingHighIdx, currentIndex + 1).map(c => c.high);
      const highestAfterSwing = Math.max(...recentHighs.slice(1));
      const lowerHigh = highestAfterSwing <= lastSwingHigh * 1.002;

      // Check confirmation
      let bearishBars = 0;
      let totalMove = 0;
      for (let i = 1; i <= confirmationBars && currentIndex - i >= lastSwingHighIdx; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;
        if (bar.close < prevBar.close) {
          bearishBars++;
          totalMove += prevBar.close - bar.close;
        }
      }

      if (lowerHigh && bearishBars >= confirmationBars && totalMove >= minMove && rsi < rsiAtSwingHigh) {
        return {
          direction: 'PUT',
          confidence: 80 + Math.min(bearishBars * 5, 15),
          reason: `ZigZag+RSI Combo: Swing high ${lastSwingHigh.toFixed(2)}, RSI was ${rsiAtSwingHigh.toFixed(1)} now ${rsi.toFixed(1)}, lower high + ${bearishBars} bearish bars`,
        };
      }
    }

    return null;
  }

  /**
   * Method 10: CHoCH (Change of Character) - SMC
   *
   * Smart Money Concepts approach:
   * 1. Track market structure (HH/HL = uptrend, LH/LL = downtrend)
   * 2. Detect when structure breaks (CHoCH):
   *    - Bullish CHoCH: In downtrend, price breaks above last Lower High
   *    - Bearish CHoCH: In uptrend, price breaks below last Higher Low
   * 3. Enter AFTER the break is confirmed (candle closes beyond level)
   *
   * Key difference from other methods:
   * - We wait for STRUCTURE to break, not just a pattern
   * - Entry is AFTER the breakout candle closes, confirming the move
   */
  private detectCHoCH(
    candles: Candle[],
    currentIndex: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const { chochLookback, chochMinSwingSize } = this.params;
    const minSwing = atr * chochMinSwingSize;

    if (currentIndex < 10) return null;

    const candle = candles[currentIndex]!;
    const prevCandle = candles[currentIndex - 1]!;

    // First, update swing points (local highs and lows)
    this.updateSwingPoints(candles, currentIndex, minSwing);

    // Need at least 2 swing highs and 2 swing lows to determine structure
    if (this.swingHighs.length < 2 || this.swingLows.length < 2) {
      return null;
    }

    // Get recent swings for structure analysis
    const recentHighs = this.swingHighs.slice(-4);
    const recentLows = this.swingLows.slice(-4);

    // Determine current market structure
    const structure = this.determineStructure(recentHighs, recentLows);

    // Check for CHoCH (Change of Character)
    // Bullish CHoCH: We're in downtrend (LH/LL) and price breaks above the last LH
    if (structure === 'downtrend' && recentHighs.length >= 2) {
      const lastLH = recentHighs[recentHighs.length - 1]!; // Last Lower High
      const prevHigh = recentHighs[recentHighs.length - 2]!;

      // Verify it's actually a Lower High
      if (lastLH.price < prevHigh.price) {
        // The break must be recent (within last swing)
        const barsFromSwing = currentIndex - lastLH.idx;
        if (barsFromSwing > 20) return null; // Too old

        // Check if we just broke above the LH level:
        // Previous candle was below or at level, current closes above
        const justBroke = prevCandle.close <= lastLH.price && candle.close > lastLH.price;
        // Or: candle crossed through the level and closed above
        const crossedThrough = candle.low <= lastLH.price && candle.close > lastLH.price;

        if (justBroke || crossedThrough) {
          // Additional confirmation: the break should be with momentum
          const breakStrength = (candle.close - lastLH.price) / atr;

          if (breakStrength > 0.1) { // At least 0.1 ATR above the level
            return {
              direction: 'CALL',
              confidence: 80 + Math.min(breakStrength * 10, 15),
              reason: `Bullish CHoCH: Broke LH at ${lastLH.price.toFixed(2)}, close=${candle.close.toFixed(2)} (+${(breakStrength * 100).toFixed(0)}% ATR)`,
            };
          }
        }
      }
    }

    // Bearish CHoCH: We're in uptrend (HH/HL) and price breaks below the last HL
    if (structure === 'uptrend' && recentLows.length >= 2) {
      const lastHL = recentLows[recentLows.length - 1]!; // Last Higher Low
      const prevLow = recentLows[recentLows.length - 2]!;

      // Verify it's actually a Higher Low
      if (lastHL.price > prevLow.price) {
        // The break must be recent (within last swing)
        const barsFromSwing = currentIndex - lastHL.idx;
        if (barsFromSwing > 20) return null; // Too old

        // Check if we just broke below the HL level:
        // Previous candle was above or at level, current closes below
        const justBroke = prevCandle.close >= lastHL.price && candle.close < lastHL.price;
        // Or: candle crossed through the level and closed below
        const crossedThrough = candle.high >= lastHL.price && candle.close < lastHL.price;

        if (justBroke || crossedThrough) {
          // Additional confirmation: the break should be with momentum
          const breakStrength = (lastHL.price - candle.close) / atr;

          if (breakStrength > 0.1) { // At least 0.1 ATR below the level
            return {
              direction: 'PUT',
              confidence: 80 + Math.min(breakStrength * 10, 15),
              reason: `Bearish CHoCH: Broke HL at ${lastHL.price.toFixed(2)}, close=${candle.close.toFixed(2)} (-${(breakStrength * 100).toFixed(0)}% ATR)`,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Update swing high/low points using simple pivot detection
   */
  private updateSwingPoints(candles: Candle[], currentIndex: number, minSwing: number): void {
    // Need at least 5 candles to detect a pivot (2 before, pivot, 2 after)
    if (currentIndex < 4) return;

    // Check if candle at index-2 is a swing point (needs confirmation from index-1 and current)
    const pivotIdx = currentIndex - 2;
    const pivot = candles[pivotIdx]!;
    const before1 = candles[pivotIdx - 1]!;
    const before2 = candles[pivotIdx - 2]!;
    const after1 = candles[pivotIdx + 1]!;
    const after2 = candles[pivotIdx + 2]!;

    // Check for swing high: pivot high > all neighbors
    if (
      pivot.high > before1.high &&
      pivot.high > before2.high &&
      pivot.high > after1.high &&
      pivot.high > after2.high
    ) {
      // Verify minimum swing size from last swing low
      const lastLow = this.swingLows[this.swingLows.length - 1];
      if (!lastLow || pivot.high - lastLow.price >= minSwing) {
        // Avoid duplicates
        if (!this.swingHighs.some(sh => sh.idx === pivotIdx)) {
          this.swingHighs.push({ idx: pivotIdx, price: pivot.high });
          // Keep only recent swings
          if (this.swingHighs.length > 10) this.swingHighs.shift();
        }
      }
    }

    // Check for swing low: pivot low < all neighbors
    if (
      pivot.low < before1.low &&
      pivot.low < before2.low &&
      pivot.low < after1.low &&
      pivot.low < after2.low
    ) {
      // Verify minimum swing size from last swing high
      const lastHigh = this.swingHighs[this.swingHighs.length - 1];
      if (!lastHigh || lastHigh.price - pivot.low >= minSwing) {
        // Avoid duplicates
        if (!this.swingLows.some(sl => sl.idx === pivotIdx)) {
          this.swingLows.push({ idx: pivotIdx, price: pivot.low });
          // Keep only recent swings
          if (this.swingLows.length > 10) this.swingLows.shift();
        }
      }
    }
  }

  /**
   * Determine market structure based on swing points
   * Uptrend: Higher Highs (HH) and Higher Lows (HL)
   * Downtrend: Lower Highs (LH) and Lower Lows (LL)
   */
  private determineStructure(
    highs: { idx: number; price: number }[],
    lows: { idx: number; price: number }[]
  ): 'uptrend' | 'downtrend' | 'unknown' {
    if (highs.length < 2 || lows.length < 2) return 'unknown';

    // Compare last 2 highs and last 2 lows
    const lastHigh = highs[highs.length - 1]!;
    const prevHigh = highs[highs.length - 2]!;
    const lastLow = lows[lows.length - 1]!;
    const prevLow = lows[lows.length - 2]!;

    const higherHigh = lastHigh.price > prevHigh.price;
    const higherLow = lastLow.price > prevLow.price;
    const lowerHigh = lastHigh.price < prevHigh.price;
    const lowerLow = lastLow.price < prevLow.price;

    // Uptrend: HH + HL
    if (higherHigh && higherLow) return 'uptrend';
    // Downtrend: LH + LL
    if (lowerHigh && lowerLow) return 'downtrend';
    // Mixed: could be transition, treat based on most recent action
    if (lowerHigh || lowerLow) return 'downtrend';
    if (higherHigh || higherLow) return 'uptrend';

    return 'unknown';
  }

  /**
   * Method 11: CHoCH + Pullback
   *
   * More conservative version of CHoCH:
   * 1. Detect CHoCH (structure break)
   * 2. Wait for price to pull back to the broken level
   * 3. Enter when price bounces off the level (support becomes resistance or vice versa)
   *
   * This is the classic SMC entry: break → pullback → continuation
   */
  private detectCHoCHPullback(
    candles: Candle[],
    currentIndex: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const { chochMinSwingSize } = this.params;
    const minSwing = atr * chochMinSwingSize;

    if (currentIndex < 10) return null;

    const candle = candles[currentIndex]!;
    const prevCandle = candles[currentIndex - 1]!;

    // Update swing points
    this.updateSwingPoints(candles, currentIndex, minSwing);

    // Check if we have a pending CHoCH waiting for pullback
    if (this.pendingChoch) {
      const barsWaiting = currentIndex - this.pendingChoch.breakIdx;

      // Invalidate if waiting too long (more than 15 bars)
      if (barsWaiting > 15) {
        this.pendingChoch = null;
      }
      // Invalidate if price went too far against us
      else if (this.pendingChoch.direction === 'CALL') {
        // For bullish, invalidate if price drops below the swing low
        if (this.pendingChoch.swingLow && candle.low < this.pendingChoch.swingLow * 0.998) {
          this.pendingChoch = null;
        }
        // Check for pullback entry
        else {
          const level = this.pendingChoch.brokenLevel;
          const tolerance = atr * 0.3;

          // Price pulled back to the level (was above, now near/at level)
          const pulledBack = prevCandle.low <= level + tolerance && prevCandle.low >= level - tolerance;
          // And now bouncing (current candle is bullish and moving up)
          const bouncing = candle.close > candle.open && candle.close > prevCandle.close;

          if (pulledBack && bouncing) {
            const entrySignal = {
              direction: 'CALL' as const,
              confidence: 88,
              reason: `CHoCH Pullback: Broke LH at ${level.toFixed(2)}, pulled back and bounced, close=${candle.close.toFixed(2)}`,
            };
            this.pendingChoch = null;
            return entrySignal;
          }
        }
      }
      else if (this.pendingChoch.direction === 'PUT') {
        // For bearish, invalidate if price rises above the swing high
        if (this.pendingChoch.swingHigh && candle.high > this.pendingChoch.swingHigh * 1.002) {
          this.pendingChoch = null;
        }
        // Check for pullback entry
        else {
          const level = this.pendingChoch.brokenLevel;
          const tolerance = atr * 0.3;

          // Price pulled back to the level (was below, now near/at level)
          const pulledBack = prevCandle.high >= level - tolerance && prevCandle.high <= level + tolerance;
          // And now bouncing down (current candle is bearish and moving down)
          const bouncing = candle.close < candle.open && candle.close < prevCandle.close;

          if (pulledBack && bouncing) {
            const entrySignal = {
              direction: 'PUT' as const,
              confidence: 88,
              reason: `CHoCH Pullback: Broke HL at ${level.toFixed(2)}, pulled back and bounced, close=${candle.close.toFixed(2)}`,
            };
            this.pendingChoch = null;
            return entrySignal;
          }
        }
      }
    }

    // If no pending CHoCH, look for new CHoCH to track
    if (!this.pendingChoch && this.swingHighs.length >= 2 && this.swingLows.length >= 2) {
      const recentHighs = this.swingHighs.slice(-4);
      const recentLows = this.swingLows.slice(-4);
      const structure = this.determineStructure(recentHighs, recentLows);

      // Bullish CHoCH detection
      if (structure === 'downtrend' && recentHighs.length >= 2) {
        const lastLH = recentHighs[recentHighs.length - 1]!;
        const prevHigh = recentHighs[recentHighs.length - 2]!;
        const lastLL = recentLows[recentLows.length - 1];

        if (lastLH.price < prevHigh.price) {
          const barsFromSwing = currentIndex - lastLH.idx;
          if (barsFromSwing <= 20) {
            // Check if we just broke above
            const justBroke = prevCandle.close <= lastLH.price && candle.close > lastLH.price;
            const crossedThrough = candle.low <= lastLH.price && candle.close > lastLH.price;

            if (justBroke || crossedThrough) {
              const breakStrength = (candle.close - lastLH.price) / atr;
              if (breakStrength > 0.1) {
                // Register the CHoCH for pullback entry
                this.pendingChoch = {
                  direction: 'CALL',
                  brokenLevel: lastLH.price,
                  breakIdx: currentIndex,
                  swingLow: lastLL?.price,
                };
              }
            }
          }
        }
      }

      // Bearish CHoCH detection
      if (structure === 'uptrend' && recentLows.length >= 2) {
        const lastHL = recentLows[recentLows.length - 1]!;
        const prevLow = recentLows[recentLows.length - 2]!;
        const lastHH = recentHighs[recentHighs.length - 1];

        if (lastHL.price > prevLow.price) {
          const barsFromSwing = currentIndex - lastHL.idx;
          if (barsFromSwing <= 20) {
            const justBroke = prevCandle.close >= lastHL.price && candle.close < lastHL.price;
            const crossedThrough = candle.high >= lastHL.price && candle.close < lastHL.price;

            if (justBroke || crossedThrough) {
              const breakStrength = (lastHL.price - candle.close) / atr;
              if (breakStrength > 0.1) {
                // Register the CHoCH for pullback entry
                this.pendingChoch = {
                  direction: 'PUT',
                  brokenLevel: lastHL.price,
                  breakIdx: currentIndex,
                  swingHigh: lastHH?.price,
                };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Method 12: ZigZag Strong/Explosive
   *
   * Solo opera después de tendencias FUERTES o EXPLOSIVAS
   * Basado en el análisis de tipos de tendencia:
   * - STRONG: slope > 0.05%/vela
   * - EXPLOSIVE: slope > 0.1%/vela
   *
   * Después de estas tendencias, la tasa de reversión es 99-100%
   *
   * SIMPLIFICADO: Usa los swings del ZigZag directamente
   * La tendencia es desde el swing opuesto anterior hasta el swing actual
   */
  private detectZigZagStrong(
    candles: Candle[],
    currentIndex: number,
    indicators: IndicatorSnapshot,
    rsi: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const lastSwingLowIdx = indicators.lastSwingLowIdx as number | undefined;
    const lastSwingHighIdx = indicators.lastSwingHighIdx as number | undefined;
    const lastSwingLow = indicators.lastSwingLow as number | undefined;
    const lastSwingHigh = indicators.lastSwingHigh as number | undefined;

    if (lastSwingLowIdx === undefined || lastSwingHighIdx === undefined) return null;
    if (lastSwingLow === undefined || lastSwingHigh === undefined) return null;

    const { confirmationBars, confirmationMinMove } = this.params;
    const minMove = atr * confirmationMinMove;

    // Calcular métricas usando los swings del ZigZag directamente
    // La tendencia es desde lastSwingHigh hasta lastSwingLow o viceversa
    let trendDirection: 'up' | 'down';
    let trendDuration: number;
    let priceChange: number;
    let pctChange: number;
    let slopePct: number;

    if (lastSwingLowIdx > lastSwingHighIdx) {
      // Último swing fue LOW → tendencia previa fue BAJISTA
      trendDirection = 'down';
      trendDuration = lastSwingLowIdx - lastSwingHighIdx;
      priceChange = lastSwingHigh - lastSwingLow;
      pctChange = (priceChange / lastSwingHigh) * 100;
    } else {
      // Último swing fue HIGH → tendencia previa fue ALCISTA
      trendDirection = 'up';
      trendDuration = lastSwingHighIdx - lastSwingLowIdx;
      priceChange = lastSwingHigh - lastSwingLow;
      pctChange = (priceChange / lastSwingLow) * 100;
    }

    slopePct = trendDuration > 0 ? pctChange / trendDuration : 0;

    // Clasificar la fuerza - usando umbrales más relajados
    let strength: 'weak' | 'moderate' | 'strong' | 'explosive';
    if (slopePct >= 0.08) {
      strength = 'explosive';
    } else if (slopePct >= 0.04) {
      strength = 'strong';
    } else if (slopePct >= 0.02) {
      strength = 'moderate';
    } else {
      strength = 'weak';
    }

    // Solo operar si la tendencia fue lo suficientemente fuerte (strong o explosive)
    if (strength === 'weak' || strength === 'moderate') return null;

    // Filtro adicional: cambio mínimo de precio
    if (pctChange < 0.3) return null; // Mínimo 0.3%

    // Aplicar la lógica de ZigZag reversal con confirmación
    if (trendDirection === 'down' && currentIndex - lastSwingLowIdx <= 10) {
      // Buscar CALL después de caída fuerte
      let confirmedBars = 0;
      let totalMove = 0;

      for (let i = 1; i <= confirmationBars && currentIndex - i >= lastSwingLowIdx; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;
        if (bar.close > prevBar.close) {
          confirmedBars++;
          totalMove += bar.close - prevBar.close;
        }
      }

      if (confirmedBars >= confirmationBars && totalMove >= minMove && rsi < 55) {
        return {
          direction: 'CALL',
          confidence: 75 + (strength === 'explosive' ? 15 : 10),
          reason: `ZigZag Strong CALL: ${strength.toUpperCase()} downtrend (${pctChange.toFixed(2)}% in ${trendDuration} bars, slope ${(slopePct * 100).toFixed(1)}%/bar), RSI=${rsi.toFixed(1)}`,
        };
      }
    }

    if (trendDirection === 'up' && currentIndex - lastSwingHighIdx <= 10) {
      // Buscar PUT después de subida fuerte
      let confirmedBars = 0;
      let totalMove = 0;

      for (let i = 1; i <= confirmationBars && currentIndex - i >= lastSwingHighIdx; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;
        if (bar.close < prevBar.close) {
          confirmedBars++;
          totalMove += prevBar.close - bar.close;
        }
      }

      if (confirmedBars >= confirmationBars && totalMove >= minMove && rsi > 45) {
        return {
          direction: 'PUT',
          confidence: 75 + (strength === 'explosive' ? 15 : 10),
          reason: `ZigZag Strong PUT: ${strength.toUpperCase()} uptrend (${pctChange.toFixed(2)}% in ${trendDuration} bars, slope ${(slopePct * 100).toFixed(1)}%/bar), RSI=${rsi.toFixed(1)}`,
        };
      }
    }

    return null;
  }

  /**
   * Method 13: ZigZag PUT Only
   *
   * Basado en el análisis de dirección:
   * - PUT tiene 59.6% WR vs CALL 50.7%
   * - PUT genera $490.38 vs CALL $305.47
   *
   * Solo genera señales PUT para maximizar WR
   */
  private detectZigZagPutOnly(
    candles: Candle[],
    currentIndex: number,
    indicators: IndicatorSnapshot,
    rsi: number,
    atr: number
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    // Usar el detector normal de ZigZag
    const signal = this.detectZigZagReversal(candles, currentIndex, indicators, rsi, atr);

    // Solo devolver señales PUT
    if (signal && signal.direction === 'PUT') {
      return {
        ...signal,
        confidence: signal.confidence + 5, // Boost por ser PUT (mejor históricamente)
        reason: signal.reason + ' [PUT-ONLY filter]',
      };
    }

    return null;
  }

  reset(): void {
    this.lastTradeIndex = -1;
    this.rsiHistory = [];
    this.priceHistory = [];
    this.swingHighs = [];
    this.swingLows = [];
    this.lastStructure = 'unknown';
    this.chochDetected = null;
    this.pendingChoch = null;
  }
}

/**
 * Factory functions
 */
export function createTrendExhaustionStrategy(
  asset: string,
  method: DetectionMethod,
  params?: Partial<TrendExhaustionParams>
): TrendExhaustionBacktestStrategy {
  return new TrendExhaustionBacktestStrategy(asset, method, params);
}

export function createRSIDivergenceStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'rsi_divergence', params);
}

export function createPinBarStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'pin_bar', params);
}

export function createEngulfingStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'engulfing', params);
}

export function createEMADistanceStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'ema_distance', params);
}

export function createExhaustionCandlesStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'exhaustion_candles', params);
}

export function createMultiComboStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'multi_combo', params);
}

export function createZigZagReversalStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'zigzag_reversal', params);
}

export function createRSIDivergenceConfirmedStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'rsi_divergence_confirmed', params);
}

export function createZigZagRSIComboStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'zigzag_rsi_combo', params);
}

export function createCHoCHStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'choch', params);
}

export function createCHoCHPullbackStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'choch_pullback', params);
}

export function createZigZagStrongStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'zigzag_strong', params);
}

export function createZigZagPutOnlyStrategy(asset: string, params?: Partial<TrendExhaustionParams>) {
  return createTrendExhaustionStrategy(asset, 'zigzag_put_only', params);
}
