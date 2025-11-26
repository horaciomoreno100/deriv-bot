/**
 * Market Context Analyzer
 *
 * Analyzes market conditions to determine the current regime,
 * volatility profile, trend strength, and mean reversion probability.
 *
 * This helps improve signal quality by filtering out trades
 * that are incompatible with current market conditions.
 */

import type { Candle } from '@deriv-bot/shared';
import type { MarketContext, MarketRegime } from '@deriv-bot/shared';
import {
  calculateRSI,
  calculateBollingerBands,
  calculateATR,
  getLatest,
} from '../indicators/index.js';

/**
 * Market Context Analyzer
 */
export class MarketContextAnalyzer {
  /**
   * Analyze market context from candle data
   */
  public analyze(candles: Candle[]): MarketContext {
    // Need minimum candles for analysis
    if (candles.length < 50) {
      return this.getUnknownContext();
    }

    // Calculate various metrics
    const volatility = this.calculateVolatilityPercentile(candles);
    const trend = this.calculateTrendStrength(candles);
    const momentum = this.calculateMomentum(candles);
    const volume = this.calculateVolumeProfile(candles);

    // Determine market regime
    const regime = this.detectRegime(candles, trend, volatility, momentum);
    const regimeConfidence = this.calculateRegimeConfidence(regime, trend, volatility);

    // Calculate probabilities
    const meanReversionProb = this.calculateMeanReversionProbability(
      candles,
      regime,
      volatility,
      trend
    );
    const trendContinuationProb = 1 - meanReversionProb; // Inverse relationship

    return {
      regime,
      regimeConfidence,
      volatilityPercentile: volatility,
      trendStrength: trend,
      momentum,
      volumeProfile: volume,
      meanReversionProb,
      trendContinuationProb,
    };
  }

  /**
   * Calculate volatility percentile (0-100)
   * Uses ATR relative to historical ATR values
   */
  private calculateVolatilityPercentile(candles: Candle[]): number {
    const atrPeriod = 14;
    const atrValues = calculateATR(candles, atrPeriod);
    const currentATR = getLatest(atrValues);

    if (!currentATR || atrValues.length < 20) {
      return 50; // Default to median
    }

    // Calculate percentile rank
    const sortedATR = [...atrValues].sort((a, b) => a - b);
    const rank = sortedATR.filter(v => v <= currentATR).length;
    const percentile = (rank / sortedATR.length) * 100;

    return Math.round(percentile);
  }

  /**
   * Calculate trend strength (-1 to 1)
   * -1 = strong downtrend, 0 = no trend, 1 = strong uptrend
   */
  private calculateTrendStrength(candles: Candle[]): number {
    if (candles.length < 20) return 0;

    // Use multiple EMAs to determine trend
    const ema8 = this.calculateEMA(candles, 8);
    const ema21 = this.calculateEMA(candles, 21);
    const ema50 = this.calculateEMA(candles, 50);

    const currentPrice = candles[candles.length - 1]?.close ?? 0;

    // Calculate position relative to EMAs
    const aboveEMA8 = currentPrice > ema8;
    const aboveEMA21 = currentPrice > ema21;
    const aboveEMA50 = currentPrice > ema50;

    // Calculate EMA alignment
    const ema8AboveEMA21 = ema8 > ema21;
    const ema21AboveEMA50 = ema21 > ema50;

    // Score trend strength
    let trendScore = 0;

    // Price position (3 points max)
    if (aboveEMA8) trendScore += 1;
    if (aboveEMA21) trendScore += 1;
    if (aboveEMA50) trendScore += 1;

    // EMA alignment (2 points max)
    if (ema8AboveEMA21) trendScore += 1;
    if (ema21AboveEMA50) trendScore += 1;

    // Convert to -1 to 1 scale
    // Score ranges from 0 to 5
    // 0 = strong downtrend (-1)
    // 2.5 = no trend (0)
    // 5 = strong uptrend (1)
    return (trendScore / 5) * 2 - 1;
  }

  /**
   * Calculate momentum (-1 to 1)
   * Uses RSI and price momentum
   */
  private calculateMomentum(candles: Candle[]): number {
    if (candles.length < 14) return 0;

    // RSI-based momentum
    const rsiValues = calculateRSI(candles, 14);
    const currentRSI = getLatest(rsiValues);

    if (!currentRSI) return 0;

    // Convert RSI (0-100) to momentum (-1 to 1)
    // RSI < 30 = oversold = negative momentum
    // RSI > 70 = overbought = positive momentum
    // RSI = 50 = neutral
    const rsiMomentum = (currentRSI - 50) / 50;

    // Price momentum (rate of change over last 10 candles)
    const recentCandles = candles.slice(-10);
    const oldPrice = recentCandles[0]?.close ?? 0;
    const newPrice = recentCandles[recentCandles.length - 1]?.close ?? 0;
    const priceChange = oldPrice !== 0 ? (newPrice - oldPrice) / oldPrice : 0;

    // Normalize price change to -1 to 1 range (assuming max 10% change)
    const priceMomentum = Math.max(-1, Math.min(1, priceChange * 10));

    // Combine both (weighted average: RSI 60%, price 40%)
    return rsiMomentum * 0.6 + priceMomentum * 0.4;
  }

  /**
   * Calculate volume profile (relative to average)
   * Returns multiplier (1.0 = average, 2.0 = double average, etc.)
   */
  private calculateVolumeProfile(candles: Candle[]): number {
    if (candles.length < 20) return 1.0;

    const recentVolume = candles.slice(-10).reduce((sum, c) => sum + (c.volume || 0), 0) / 10;
    const avgVolume = candles.slice(-50).reduce((sum, c) => sum + (c.volume || 0), 0) / 50;

    if (avgVolume === 0) return 1.0;

    return recentVolume / avgVolume;
  }

  /**
   * Detect market regime
   */
  private detectRegime(
    candles: Candle[],
    trendStrength: number,
    volatility: number,
    momentum: number
  ): MarketRegime {
    // High volatility regime
    if (volatility > 80) {
      return 'high_volatility';
    }

    // Low volatility regime
    if (volatility < 20) {
      return 'low_volatility';
    }

    // Strong uptrend
    if (trendStrength > 0.5 && momentum > 0.3) {
      return 'trending_up';
    }

    // Strong downtrend
    if (trendStrength < -0.5 && momentum < -0.3) {
      return 'trending_down';
    }

    // Reversal detection (using RSI extremes + opposite trend)
    const rsiValues = calculateRSI(candles, 14);
    const currentRSI = getLatest(rsiValues);

    if (currentRSI) {
      // Bullish reversal: RSI oversold + recent downtrend
      if (currentRSI < 30 && trendStrength < 0) {
        return 'reversal_bullish';
      }

      // Bearish reversal: RSI overbought + recent uptrend
      if (currentRSI > 70 && trendStrength > 0) {
        return 'reversal_bearish';
      }
    }

    // Default: ranging market
    return 'ranging';
  }

  /**
   * Calculate confidence in regime detection (0-1)
   */
  private calculateRegimeConfidence(
    regime: MarketRegime,
    trendStrength: number,
    volatility: number
  ): number {
    // Base confidence on how clear the regime is

    switch (regime) {
      case 'trending_up':
      case 'trending_down':
        // Confidence increases with stronger trend
        return Math.min(1, Math.abs(trendStrength) + 0.3);

      case 'high_volatility':
      case 'low_volatility':
        // Confidence based on how extreme volatility is
        const extremity = Math.abs(volatility - 50) / 50;
        return Math.min(1, extremity + 0.4);

      case 'reversal_bullish':
      case 'reversal_bearish':
        // Reversals are less certain
        return 0.6;

      case 'ranging':
        // Ranging is detected when nothing else fits, so lower confidence
        return 0.5;

      default:
        return 0.3;
    }
  }

  /**
   * Calculate mean reversion probability (0-1)
   * Higher values indicate better conditions for mean reversion strategies
   */
  private calculateMeanReversionProbability(
    candles: Candle[],
    regime: MarketRegime,
    volatility: number,
    trendStrength: number
  ): number {
    let probability = 0.5; // Start neutral

    // Regime contribution
    switch (regime) {
      case 'ranging':
        probability += 0.3; // Best for mean reversion
        break;
      case 'reversal_bullish':
      case 'reversal_bearish':
        probability += 0.25; // Good for mean reversion
        break;
      case 'high_volatility':
        probability -= 0.1; // Volatile markets less predictable
        break;
      case 'trending_up':
      case 'trending_down':
        probability -= 0.2; // Trending markets fight mean reversion
        break;
      case 'low_volatility':
        probability += 0.1; // Stable = more predictable
        break;
    }

    // Volatility contribution
    // Medium volatility (40-60 percentile) is best for mean reversion
    const volScore = 1 - Math.abs(volatility - 50) / 50;
    probability += volScore * 0.1;

    // Trend strength contribution
    // Weak trends (near 0) favor mean reversion
    const trendScore = 1 - Math.abs(trendStrength);
    probability += trendScore * 0.15;

    // Bollinger Bands squeeze detection
    const bbValues = calculateBollingerBands(candles, 20, 2.0);
    const currentBB = getLatest(bbValues);

    if (currentBB) {
      const bandwidth = (currentBB.upper - currentBB.lower) / currentBB.middle;
      // Narrow bands (squeeze) often precede mean reversion
      if (bandwidth < 0.04) {
        probability += 0.1;
      }
    }

    // Clamp to 0-1 range
    return Math.max(0, Math.min(1, probability));
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) {
      // Not enough data, return current price
      return candles[candles.length - 1]?.close ?? 0;
    }

    const k = 2 / (period + 1);
    let ema = candles[0]?.close ?? 0;

    for (let i = 1; i < candles.length; i++) {
      ema = (candles[i]?.close ?? 0) * k + ema * (1 - k);
    }

    return ema;
  }

  /**
   * Return unknown context when insufficient data
   */
  private getUnknownContext(): MarketContext {
    return {
      regime: 'unknown',
      regimeConfidence: 0,
      volatilityPercentile: 50,
      trendStrength: 0,
      momentum: 0,
      volumeProfile: 1.0,
      meanReversionProb: 0.5,
      trendContinuationProb: 0.5,
    };
  }
}
