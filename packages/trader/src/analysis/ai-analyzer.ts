/**
 * AI Analyzer - Main Orchestrator
 *
 * Combines market context analysis and signal quality scoring
 * to provide AI-enhanced trade recommendations.
 *
 * This is the main entry point for AI analysis.
 */

import type { Candle, Signal } from '@deriv-bot/shared';
import type {
  AIAnalysisResult,
  AITradeRecommendation,
  AIAnalyzerConfig,
  PatternMatch,
} from '@deriv-bot/shared';
import { MarketContextAnalyzer } from './market-context-analyzer.js';
import { SignalQualityScorer } from './signal-quality-scorer.js';

/**
 * Default AI Analyzer configuration
 */
const DEFAULT_CONFIG: AIAnalyzerConfig = {
  minQualityScore: 65, // Only trade signals with 65+ quality score
  enablePatternRecognition: true,
  enableRegimeDetection: true,
  historicalWindow: 100,
  minHistoricalSamples: 50,
  conservativeMode: false,
};

/**
 * AI Analyzer
 *
 * Main class that orchestrates AI-enhanced signal analysis
 */
export class AIAnalyzer {
  private config: AIAnalyzerConfig;
  private contextAnalyzer: MarketContextAnalyzer;
  private qualityScorer: SignalQualityScorer;

  constructor(config: Partial<AIAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.contextAnalyzer = new MarketContextAnalyzer();
    this.qualityScorer = new SignalQualityScorer();
  }

  /**
   * Analyze a trading signal and provide AI-enhanced recommendation
   */
  public async analyze(signal: Signal, candles: Candle[]): Promise<AIAnalysisResult> {
    const startTime = Date.now();

    // Step 1: Analyze market context
    const marketContext = this.contextAnalyzer.analyze(candles);

    // Step 2: Score signal quality
    const qualityScore = this.qualityScorer.scoreSignal(signal, candles, marketContext);

    // Step 3: Generate trade recommendation
    const recommendation = this.generateRecommendation(
      signal,
      qualityScore,
      marketContext
    );

    // Step 4: Find pattern matches (placeholder for now)
    const patternMatches = this.findPatternMatches(signal, candles, marketContext);

    const processingTimeMs = Date.now() - startTime;

    return {
      timestamp: Date.now(),
      asset: signal.symbol || signal.asset || 'UNKNOWN',
      marketContext,
      qualityScore,
      recommendation,
      patternMatches,
      processingTimeMs,
    };
  }

  /**
   * Generate trade recommendation based on analysis
   */
  private generateRecommendation(
    signal: Signal,
    qualityScore: any,
    marketContext: any
  ): AITradeRecommendation {
    const overall = qualityScore.overall;
    const components = qualityScore.components;

    // Determine if we should trade
    const shouldTrade = overall >= this.config.minQualityScore;

    // Calculate position size multiplier
    let sizeMultiplier = 1.0;

    if (this.config.conservativeMode) {
      // Conservative mode: reduce size for borderline signals
      if (overall >= 85) {
        sizeMultiplier = 1.0; // Full size
      } else if (overall >= 75) {
        sizeMultiplier = 0.8; // 80% size
      } else if (overall >= 65) {
        sizeMultiplier = 0.6; // 60% size
      } else {
        sizeMultiplier = 0.0; // No trade
      }
    } else {
      // Standard mode: scale with quality
      if (overall >= 80) {
        sizeMultiplier = 1.2; // Increase size for high quality
      } else if (overall >= 70) {
        sizeMultiplier = 1.0; // Full size
      } else if (overall >= 60) {
        sizeMultiplier = 0.8; // Reduce size
      } else {
        sizeMultiplier = 0.5; // Minimal size
      }
    }

    // Adjust TP/SL based on volatility and regime
    let tpMultiplier = 1.0;
    let slMultiplier = 1.0;

    // In high volatility, widen stops
    if (marketContext.volatilityPercentile > 75) {
      tpMultiplier = 1.3; // Wider TP
      slMultiplier = 1.2; // Wider SL
    } else if (marketContext.volatilityPercentile < 25) {
      // In low volatility, tighten stops
      tpMultiplier = 0.8;
      slMultiplier = 0.8;
    }

    // In trending markets, adjust for trend direction
    if (marketContext.regime === 'trending_up' || marketContext.regime === 'trending_down') {
      if (signal.direction === 'CALL' && marketContext.regime === 'trending_up') {
        // Trading with trend
        tpMultiplier *= 1.2; // Larger TP
        slMultiplier *= 0.9; // Tighter SL
      } else if (signal.direction === 'PUT' && marketContext.regime === 'trending_down') {
        // Trading with trend
        tpMultiplier *= 1.2;
        slMultiplier *= 0.9;
      } else {
        // Trading against trend (risky)
        tpMultiplier *= 0.8; // Smaller TP
        slMultiplier *= 1.1; // Wider SL
      }
    }

    // Adjust confidence
    const adjustedConfidence = Math.min(
      0.95,
      signal.confidence * (overall / 100) * marketContext.regimeConfidence
    );

    // Generate reasoning
    const reasoning = this.generateReasoning(
      shouldTrade,
      overall,
      components,
      marketContext,
      sizeMultiplier,
      tpMultiplier,
      slMultiplier
    );

    // Generate alternatives
    const alternatives = this.generateAlternatives(
      shouldTrade,
      overall,
      marketContext
    );

    return {
      shouldTrade,
      sizeMultiplier,
      tpMultiplier,
      slMultiplier,
      adjustedConfidence,
      reasoning,
      alternatives,
    };
  }

  /**
   * Generate reasoning for the recommendation
   */
  private generateReasoning(
    shouldTrade: boolean,
    overall: number,
    components: any,
    marketContext: any,
    sizeMultiplier: number,
    tpMultiplier: number,
    slMultiplier: number
  ): string[] {
    const reasoning: string[] = [];

    // Decision
    if (shouldTrade) {
      reasoning.push(`✅ TRADE RECOMMENDED (Quality Score: ${overall}/100)`);
    } else {
      reasoning.push(`❌ SKIP TRADE (Quality Score: ${overall}/100, below threshold ${this.config.minQualityScore})`);
    }

    // Position sizing
    if (sizeMultiplier !== 1.0) {
      const pct = Math.round(sizeMultiplier * 100);
      reasoning.push(`Position Size: ${pct}% of standard size`);
    }

    // TP/SL adjustments
    if (tpMultiplier !== 1.0 || slMultiplier !== 1.0) {
      const tpPct = Math.round(tpMultiplier * 100);
      const slPct = Math.round(slMultiplier * 100);
      reasoning.push(`TP adjusted to ${tpPct}%, SL adjusted to ${slPct}%`);
    }

    // Market regime insights
    reasoning.push(`Market Regime: ${marketContext.regime.replace('_', ' ').toUpperCase()} (${Math.round(marketContext.regimeConfidence * 100)}% confidence)`);
    reasoning.push(`Mean Reversion Probability: ${Math.round(marketContext.meanReversionProb * 100)}%`);
    reasoning.push(`Volatility: ${marketContext.volatilityPercentile}th percentile`);

    // Component insights
    const strongComponents: string[] = [];
    const weakComponents: string[] = [];

    Object.entries(components).forEach(([key, value]: [string, any]) => {
      if (value >= 75) {
        strongComponents.push(key.replace(/([A-Z])/g, ' $1').trim());
      } else if (value < 45) {
        weakComponents.push(key.replace(/([A-Z])/g, ' $1').trim());
      }
    });

    if (strongComponents.length > 0) {
      reasoning.push(`Strong: ${strongComponents.join(', ')}`);
    }

    if (weakComponents.length > 0) {
      reasoning.push(`Weak: ${weakComponents.join(', ')}`);
    }

    return reasoning;
  }

  /**
   * Generate alternative suggestions
   */
  private generateAlternatives(
    shouldTrade: boolean,
    overall: number,
    marketContext: any
  ): string[] {
    const alternatives: string[] = [];

    if (!shouldTrade) {
      // Suggest what to wait for
      if (overall >= 50 && overall < this.config.minQualityScore) {
        alternatives.push('Wait for stronger technical confirmation');
      }

      if (marketContext.regime === 'high_volatility') {
        alternatives.push('Consider waiting for volatility to decrease');
      }

      if (marketContext.regime === 'trending_up' || marketContext.regime === 'trending_down') {
        alternatives.push('Consider trend-following strategy instead of mean reversion');
      }

      if (marketContext.meanReversionProb < 0.4) {
        alternatives.push('Mean reversion conditions are weak - consider different strategy');
      }
    } else {
      // Suggest risk management
      if (overall < 75) {
        alternatives.push('Consider reducing position size due to moderate quality score');
      }

      if (marketContext.volatilityPercentile > 70) {
        alternatives.push('High volatility - consider wider stops or smaller position');
      }
    }

    return alternatives;
  }

  /**
   * Find similar historical patterns (placeholder)
   *
   * In production, this would:
   * 1. Query historical trade database
   * 2. Use ML to find similar market conditions
   * 3. Return actual historical performance data
   */
  private findPatternMatches(
    signal: Signal,
    _candles: Candle[],
    marketContext: any
  ): PatternMatch[] {
    // Placeholder: Return empty array
    // In production, implement actual pattern matching logic

    const patterns: PatternMatch[] = [];

    // Example pattern (for demonstration only)
    // In production, replace with actual ML-based pattern recognition
    if (marketContext.regime === 'reversal_bullish' && signal.direction === 'CALL') {
      patterns.push({
        patternId: 'reversal_bullish_rsi_oversold',
        patternName: 'Bullish Reversal with Oversold RSI',
        similarity: 0.78,
        historicalWinRate: 0.62, // Placeholder
        avgProfit: 0.015, // Placeholder: 1.5% avg profit
        occurrences: 145, // Placeholder
        bestTiming: 60, // Placeholder: best entry after 60 seconds
      });
    } else if (marketContext.regime === 'reversal_bearish' && signal.direction === 'PUT') {
      patterns.push({
        patternId: 'reversal_bearish_rsi_overbought',
        patternName: 'Bearish Reversal with Overbought RSI',
        similarity: 0.75,
        historicalWinRate: 0.59,
        avgProfit: 0.013,
        occurrences: 138,
        bestTiming: 60,
      });
    }

    return patterns;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<AIAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  public getConfig(): AIAnalyzerConfig {
    return { ...this.config };
  }
}
