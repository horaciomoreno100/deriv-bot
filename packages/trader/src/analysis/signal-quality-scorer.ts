/**
 * Signal Quality Scorer
 *
 * Evaluates trading signals and assigns quality scores based on:
 * - Technical indicator alignment
 * - Pattern recognition
 * - Historical performance
 * - Risk/reward assessment
 * - Market regime compatibility
 * - Entry timing
 *
 * This helps filter out low-quality signals and improve win rate.
 */

import type { Candle, Signal } from '@deriv-bot/shared';
import type {
  MarketContext,
  SignalQualityScore,
} from '@deriv-bot/shared';
import {
  calculateRSI,
  calculateBollingerBands,
  calculateATR,
  getLatest,
} from '../indicators/index.js';

/**
 * Signal Quality Scorer
 */
export class SignalQualityScorer {
  /**
   * Score a trading signal
   */
  public scoreSignal(
    signal: Signal,
    candles: Candle[],
    marketContext: MarketContext
  ): SignalQualityScore {
    const components = {
      technicalAlignment: this.scoreTechnicalAlignment(signal, candles),
      patternMatch: this.scorePatternMatch(signal, candles),
      historicalEdge: this.scoreHistoricalEdge(signal, marketContext),
      riskReward: this.scoreRiskReward(signal),
      regimeCompatibility: this.scoreRegimeCompatibility(signal, marketContext),
      timing: this.scoreTiming(signal, candles, marketContext),
    };

    // Calculate weighted overall score
    const overall = this.calculateOverallScore(components);

    // Generate explanation
    const explanation = this.generateExplanation(components, overall);

    // Generate warnings
    const warnings = this.generateWarnings(components, marketContext);

    return {
      overall,
      components,
      explanation,
      warnings,
    };
  }

  /**
   * Score technical indicator alignment (0-100)
   * How well do multiple indicators agree with the signal?
   */
  private scoreTechnicalAlignment(signal: Signal, candles: Candle[]): number {
    if (candles.length < 50) return 50; // Not enough data

    let score = 0;
    let maxScore = 0;

    const direction = signal.direction;
    const currentPrice = candles[candles.length - 1]?.close ?? 0;

    // RSI alignment (30 points)
    const rsiValues = calculateRSI(candles, 14);
    const currentRSI = getLatest(rsiValues);

    if (currentRSI) {
      maxScore += 30;

      if (direction === 'CALL' && currentRSI < 35) {
        // Strong oversold
        score += 30;
      } else if (direction === 'CALL' && currentRSI < 45) {
        // Moderate oversold
        score += 20;
      } else if (direction === 'PUT' && currentRSI > 65) {
        // Strong overbought
        score += 30;
      } else if (direction === 'PUT' && currentRSI > 55) {
        // Moderate overbought
        score += 20;
      }
    }

    // Bollinger Bands alignment (25 points)
    const bbValues = calculateBollingerBands(candles, 20, 2.0);
    const currentBB = getLatest(bbValues);

    if (currentBB) {
      maxScore += 25;

      const priceToBBLower = ((currentPrice - currentBB.lower) / currentBB.lower) * 100;
      const priceToBBUpper = ((currentBB.upper - currentPrice) / currentBB.upper) * 100;

      if (direction === 'CALL') {
        // Price near lower band
        if (priceToBBLower < 1) {
          score += 25; // Very close
        } else if (priceToBBLower < 3) {
          score += 15; // Close
        }
      } else if (direction === 'PUT') {
        // Price near upper band
        if (priceToBBUpper < 1) {
          score += 25; // Very close
        } else if (priceToBBUpper < 3) {
          score += 15; // Close
        }
      }
    }

    // Moving average alignment (20 points)
    maxScore += 20;

    const ema20 = this.calculateEMA(candles, 20);
    const ema50 = this.calculateEMA(candles, 50);

    if (direction === 'CALL') {
      // Price below EMAs (good for mean reversion call)
      if (currentPrice < ema20 && currentPrice < ema50) {
        score += 20;
      } else if (currentPrice < ema20 || currentPrice < ema50) {
        score += 10;
      }
    } else if (direction === 'PUT') {
      // Price above EMAs (good for mean reversion put)
      if (currentPrice > ema20 && currentPrice > ema50) {
        score += 20;
      } else if (currentPrice > ema20 || currentPrice > ema50) {
        score += 10;
      }
    }

    // Volume confirmation (15 points)
    maxScore += 15;

    const recentVolume = candles.slice(-5).reduce((sum, c) => sum + (c.volume || 0), 0) / 5;
    const avgVolume = candles.slice(-50).reduce((sum, c) => sum + (c.volume || 0), 0) / 50;

    if (avgVolume > 0) {
      const volumeRatio = recentVolume / avgVolume;
      if (volumeRatio > 1.2) {
        // Higher than average volume
        score += 15;
      } else if (volumeRatio > 1.0) {
        score += 10;
      }
    }

    // Momentum confirmation (10 points)
    maxScore += 10;

    const momentum = this.calculateMomentum(candles);

    if (direction === 'CALL' && momentum < -0.2) {
      // Negative momentum supports mean reversion buy
      score += 10;
    } else if (direction === 'PUT' && momentum > 0.2) {
      // Positive momentum supports mean reversion sell
      score += 10;
    } else if (Math.abs(momentum) < 0.1) {
      // Neutral momentum
      score += 5;
    }

    // Normalize to 0-100
    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 50;
  }

  /**
   * Score pattern match quality (0-100)
   * Recognizes common reversal patterns
   */
  private scorePatternMatch(signal: Signal, candles: Candle[]): number {
    if (candles.length < 10) return 50;

    let score = 50; // Start neutral
    const recent = candles.slice(-5);
    const direction = signal.direction;

    // Hammer/Shooting Star pattern (single candle reversal)
    const lastCandle = recent[recent.length - 1];
    if (!lastCandle) return score;

    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    const totalRange = lastCandle.high - lastCandle.low;

    if (totalRange > 0) {
      // Hammer (bullish reversal)
      if (
        direction === 'CALL' &&
        lowerWick > bodySize * 2 &&
        upperWick < bodySize * 0.5
      ) {
        score += 20;
      }

      // Shooting star (bearish reversal)
      if (
        direction === 'PUT' &&
        upperWick > bodySize * 2 &&
        lowerWick < bodySize * 0.5
      ) {
        score += 20;
      }
    }

    // Engulfing pattern (two candle reversal)
    if (recent.length >= 2) {
      const prev = recent[recent.length - 2];
      const curr = recent[recent.length - 1];

      if (!prev || !curr) return score;

      const prevBullish = prev.close > prev.open;
      const currBullish = curr.close > curr.open;
      const currBodySize = Math.abs(curr.close - curr.open);
      const prevBodySize = Math.abs(prev.close - prev.open);

      // Bullish engulfing
      if (
        direction === 'CALL' &&
        !prevBullish &&
        currBullish &&
        currBodySize > prevBodySize * 1.2
      ) {
        score += 15;
      }

      // Bearish engulfing
      if (
        direction === 'PUT' &&
        prevBullish &&
        !currBullish &&
        currBodySize > prevBodySize * 1.2
      ) {
        score += 15;
      }
    }

    // Doji pattern (indecision often precedes reversal)
    const dojiThreshold = totalRange * 0.1;
    if (bodySize < dojiThreshold) {
      score += 10;
    }

    // Three consecutive candles in opposite direction (exhaustion)
    if (recent.length >= 3) {
      const last3 = recent.slice(-3);
      const allBullish = last3.every(c => c.close > c.open);
      const allBearish = last3.every(c => c.close < c.open);

      if (direction === 'CALL' && allBearish) {
        score += 15; // Bearish exhaustion suggests bullish reversal
      } else if (direction === 'PUT' && allBullish) {
        score += 15; // Bullish exhaustion suggests bearish reversal
      }
    }

    return Math.min(100, score);
  }

  /**
   * Score historical edge (0-100)
   * Based on how similar setups have performed historically
   *
   * Note: This is a placeholder. In production, you would:
   * 1. Store historical trade outcomes in a database
   * 2. Use ML to find similar market conditions
   * 3. Calculate win rate and avg profit for those conditions
   */
  private scoreHistoricalEdge(_signal: Signal, marketContext: MarketContext): number {
    // Placeholder scoring based on market regime
    // In production, replace with actual historical analysis

    let score = 50; // Neutral baseline

    const { regime, meanReversionProb } = marketContext;

    // Mean reversion strategy works best in ranging markets
    if (regime === 'ranging') {
      score += 20;
    } else if (regime === 'reversal_bullish' || regime === 'reversal_bearish') {
      score += 15;
    } else if (regime === 'trending_up' || regime === 'trending_down') {
      score -= 15; // Trending markets fight mean reversion
    } else if (regime === 'high_volatility') {
      score -= 10; // High volatility = less predictable
    }

    // Add mean reversion probability contribution
    score += (meanReversionProb - 0.5) * 30; // -15 to +15

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Score risk/reward setup (0-100)
   * Evaluates TP/SL levels relative to current volatility
   */
  private scoreRiskReward(signal: Signal): number {
    const metadata = signal.metadata;

    if (!metadata || !metadata.tpPrice || !metadata.slPrice || !metadata.price) {
      return 50; // No risk/reward data
    }

    const entryPrice = Number(metadata.price);
    const tpPrice = Number(metadata.tpPrice);
    const slPrice = Number(metadata.slPrice);

    // Calculate risk and reward
    const reward = Math.abs(tpPrice - entryPrice);
    const risk = Math.abs(entryPrice - slPrice);

    if (risk === 0) return 0; // Invalid setup

    const rrRatio = reward / risk;

    // Score based on R:R ratio
    // Ideal: 1.5:1 or better
    // Acceptable: 1:1 to 1.5:1
    // Poor: < 1:1

    let score = 50;

    if (rrRatio >= 2.0) {
      score = 100; // Excellent
    } else if (rrRatio >= 1.5) {
      score = 85; // Very good
    } else if (rrRatio >= 1.2) {
      score = 70; // Good
    } else if (rrRatio >= 1.0) {
      score = 55; // Acceptable
    } else if (rrRatio >= 0.8) {
      score = 40; // Poor
    } else {
      score = 20; // Very poor
    }

    return score;
  }

  /**
   * Score regime compatibility (0-100)
   * How well does the signal match current market regime?
   */
  private scoreRegimeCompatibility(_signal: Signal, marketContext: MarketContext): number {
    const { regime, meanReversionProb, regimeConfidence } = marketContext;

    let baseScore = 50;

    // Mean reversion strategy compatibility
    switch (regime) {
      case 'ranging':
        baseScore = 90; // Perfect for mean reversion
        break;
      case 'reversal_bullish':
      case 'reversal_bearish':
        baseScore = 80; // Good for mean reversion
        break;
      case 'low_volatility':
        baseScore = 70; // Stable conditions help
        break;
      case 'high_volatility':
        baseScore = 40; // Risky, less predictable
        break;
      case 'trending_up':
      case 'trending_down':
        baseScore = 35; // Trending fights mean reversion
        break;
      case 'unknown':
        baseScore = 50; // Neutral
        break;
    }

    // Adjust for mean reversion probability
    const probAdjustment = (meanReversionProb - 0.5) * 40; // -20 to +20
    baseScore += probAdjustment;

    // Weight by regime confidence
    const finalScore = baseScore * regimeConfidence + 50 * (1 - regimeConfidence);

    return Math.round(Math.max(0, Math.min(100, finalScore)));
  }

  /**
   * Score entry timing (0-100)
   * Is this the optimal time to enter based on recent price action?
   */
  private scoreTiming(signal: Signal, candles: Candle[], marketContext: MarketContext): number {
    if (candles.length < 10) return 50;

    let score = 50;
    const direction = signal.direction;
    const recent = candles.slice(-10);
    const currentPrice = recent[recent.length - 1]?.close ?? 0;

    // Calculate recent price movement
    const firstPrice = recent[0]?.close ?? 0;
    const priceChange = firstPrice !== 0 ? (currentPrice - firstPrice) / firstPrice : 0;
    const absChange = Math.abs(priceChange);

    // For mean reversion, we want to enter after a move
    // But not too early (may continue) or too late (already reversing)

    // Ideal timing: 3-5% move in the opposite direction
    if (direction === 'CALL' && priceChange < 0) {
      // Price down, buying for reversion
      if (absChange >= 0.03 && absChange <= 0.05) {
        score += 25; // Perfect timing
      } else if (absChange >= 0.02 && absChange <= 0.07) {
        score += 15; // Good timing
      } else if (absChange > 0.07) {
        score -= 10; // Too late, may have already reversed
      } else if (absChange < 0.02) {
        score -= 10; // Too early, may continue down
      }
    } else if (direction === 'PUT' && priceChange > 0) {
      // Price up, selling for reversion
      if (absChange >= 0.03 && absChange <= 0.05) {
        score += 25; // Perfect timing
      } else if (absChange >= 0.02 && absChange <= 0.07) {
        score += 15; // Good timing
      } else if (absChange > 0.07) {
        score -= 10; // Too late
      } else if (absChange < 0.02) {
        score -= 10; // Too early
      }
    }

    // Check if price is decelerating (good for reversal)
    const recentMomentum = this.calculateMomentum(recent);
    const momentum = marketContext.momentum;

    if (Math.abs(recentMomentum) < Math.abs(momentum) * 0.7) {
      // Momentum is slowing
      score += 15;
    }

    // Avoid entering during extreme volatility spikes
    const atrValues = calculateATR(candles, 14);
    const currentATR = getLatest(atrValues);

    if (currentATR && atrValues.length > 10) {
      const avgATR = atrValues.slice(-10).reduce((sum, v) => sum + v, 0) / 10;
      const atrRatio = currentATR / avgATR;

      if (atrRatio > 2.0) {
        // Volatility spike - bad timing
        score -= 20;
      } else if (atrRatio > 1.5) {
        score -= 10;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate overall weighted score
   */
  private calculateOverallScore(components: SignalQualityScore['components']): number {
    // Weighted average
    const weights = {
      technicalAlignment: 0.25,
      patternMatch: 0.15,
      historicalEdge: 0.20,
      riskReward: 0.15,
      regimeCompatibility: 0.15,
      timing: 0.10,
    };

    const overall =
      components.technicalAlignment * weights.technicalAlignment +
      components.patternMatch * weights.patternMatch +
      components.historicalEdge * weights.historicalEdge +
      components.riskReward * weights.riskReward +
      components.regimeCompatibility * weights.regimeCompatibility +
      components.timing * weights.timing;

    return Math.round(overall);
  }

  /**
   * Generate explanation for the score
   */
  private generateExplanation(
    components: SignalQualityScore['components'],
    overall: number
  ): string[] {
    const explanation: string[] = [];

    // Overall assessment
    if (overall >= 80) {
      explanation.push('🟢 Excellent signal quality - High probability setup');
    } else if (overall >= 65) {
      explanation.push('🟡 Good signal quality - Above average setup');
    } else if (overall >= 50) {
      explanation.push('🟠 Fair signal quality - Marginal setup');
    } else {
      explanation.push('🔴 Poor signal quality - Below average setup');
    }

    // Component highlights
    if (components.technicalAlignment >= 75) {
      explanation.push('✓ Strong technical indicator alignment');
    } else if (components.technicalAlignment < 40) {
      explanation.push('✗ Weak technical indicator alignment');
    }

    if (components.patternMatch >= 75) {
      explanation.push('✓ Clear reversal pattern detected');
    }

    if (components.historicalEdge >= 70) {
      explanation.push('✓ Favorable historical conditions');
    } else if (components.historicalEdge < 40) {
      explanation.push('✗ Unfavorable historical conditions');
    }

    if (components.riskReward >= 70) {
      explanation.push('✓ Good risk/reward ratio');
    } else if (components.riskReward < 50) {
      explanation.push('✗ Poor risk/reward ratio');
    }

    if (components.regimeCompatibility >= 75) {
      explanation.push('✓ Market regime supports this strategy');
    } else if (components.regimeCompatibility < 45) {
      explanation.push('✗ Market regime not ideal for this strategy');
    }

    if (components.timing >= 70) {
      explanation.push('✓ Good entry timing');
    } else if (components.timing < 45) {
      explanation.push('⚠ Suboptimal entry timing');
    }

    return explanation;
  }

  /**
   * Generate warnings
   */
  private generateWarnings(
    components: SignalQualityScore['components'],
    marketContext: MarketContext
  ): string[] {
    const warnings: string[] = [];

    // Critical component failures
    if (components.technicalAlignment < 30) {
      warnings.push('Technical indicators do not support this signal');
    }

    if (components.riskReward < 40) {
      warnings.push('Risk/reward ratio is unfavorable');
    }

    if (components.regimeCompatibility < 35) {
      warnings.push('Current market regime is not compatible with this strategy');
    }

    // Market condition warnings
    if (marketContext.regime === 'high_volatility') {
      warnings.push('High volatility detected - increased risk');
    }

    if (marketContext.regime === 'trending_up' || marketContext.regime === 'trending_down') {
      warnings.push('Strong trend detected - mean reversion may fail');
    }

    if (marketContext.meanReversionProb < 0.4) {
      warnings.push('Low mean reversion probability - be cautious');
    }

    if (marketContext.volatilityPercentile > 85) {
      warnings.push('Volatility at extreme levels');
    }

    return warnings;
  }

  /**
   * Helper: Calculate EMA
   */
  private calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) {
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
   * Helper: Calculate momentum
   */
  private calculateMomentum(candles: Candle[]): number {
    if (candles.length < 10) return 0;

    const oldPrice = candles[0]?.close ?? 0;
    const newPrice = candles[candles.length - 1]?.close ?? 0;
    const priceChange = oldPrice !== 0 ? (newPrice - oldPrice) / oldPrice : 0;

    return Math.max(-1, Math.min(1, priceChange * 10));
  }
}
