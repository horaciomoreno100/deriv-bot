#!/usr/bin/env node
/**
 * AI Analysis Demo
 *
 * Demonstrates how to use the AI Analyzer to improve signal quality.
 * This runs ANALYSIS ONLY - no actual trading.
 *
 * The AI Analyzer:
 * - Detects market regime (trending, ranging, volatile, etc.)
 * - Scores signal quality (0-100) based on multiple factors
 * - Recommends position sizing adjustments
 * - Suggests TP/SL adjustments based on volatility
 * - Filters out low-quality signals
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { AIAnalyzer } from '../analysis/ai-analyzer.js';
import type { Candle, Tick, StrategyConfig, Signal } from '@deriv-bot/shared';
import type { AIAnalysisResult } from '@deriv-bot/shared';

dotenv.config();

// Configuration
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOLS_STR = process.env.SYMBOL || 'R_75'; // Start with single asset for demo
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const TIMEFRAME = 60; // 1 minute

// AI Configuration
const AI_CONFIG = {
  minQualityScore: 65, // Only recommend trades with 65+ quality score
  enablePatternRecognition: true,
  enableRegimeDetection: true,
  historicalWindow: 100,
  minHistoricalSamples: 50,
  conservativeMode: false, // Set to true for stricter filtering
};

// State
const candleBuffers = new Map<string, Candle[]>();
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();
let analysisCount = 0;
let recommendedCount = 0;
let rejectedCount = 0;

/**
 * Create strategy
 */
function createStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'AI-Enhanced-Mean-Reversion',
    enabled: true,
    assets: SYMBOLS,
    maxConcurrentTrades: SYMBOLS.length,
    amount: 1,
    amountType: 'percentage',
    cooldownSeconds: 30,
    minConfidence: 0.75,
    parameters: {
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      bbPeriod: 20,
      bbStdDev: 2.0,
      takeProfitPct: 0.003,
      stopLossPct: 0.003,
      cooldownSeconds: 30,
      bbTouchPct: 0.05,
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Process tick and build candle
 */
function processTick(tick: Tick): Candle | null {
  const asset = tick.asset;
  if (!SYMBOLS.includes(asset)) return null;

  const tickTime = tick.timestamp;
  const candleTimeMs = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);
  const candleTime = Math.floor(candleTimeMs / 1000);

  const lastCandleTime = lastCandleTimes.get(asset) || 0;
  const currentCandle = currentCandles.get(asset);

  if (candleTime !== lastCandleTime) {
    const completedCandle = currentCandle;
    lastCandleTimes.set(asset, candleTime);

    const newCandle: Partial<Candle> = {
      asset: tick.asset,
      timeframe: TIMEFRAME,
      timestamp: candleTime,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: 1,
    };
    currentCandles.set(asset, newCandle);

    if (completedCandle && completedCandle.open && completedCandle.close) {
      return completedCandle as Candle;
    }
  } else if (currentCandle) {
    currentCandle.high = Math.max(currentCandle.high || tick.price, tick.price);
    currentCandle.low = Math.min(currentCandle.low || tick.price, tick.price);
    currentCandle.close = tick.price;
    currentCandle.volume = (currentCandle.volume || 0) + 1;
  }

  return null;
}

/**
 * Display analysis result
 */
function displayAnalysis(signal: Signal, analysis: AIAnalysisResult): void {
  const { marketContext, qualityScore, recommendation, patternMatches, processingTimeMs } = analysis;

  console.log('\n' + '═'.repeat(100));
  console.log('🤖 AI SIGNAL ANALYSIS');
  console.log('═'.repeat(100));

  // Signal info
  console.log(`\n📊 SIGNAL:`);
  console.log(`   Asset: ${analysis.asset}`);
  console.log(`   Direction: ${signal.direction}`);
  console.log(`   Original Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
  console.log(`   Adjusted Confidence: ${(recommendation.adjustedConfidence * 100).toFixed(1)}%`);

  // Market context
  console.log(`\n🌍 MARKET CONTEXT:`);
  console.log(`   Regime: ${marketContext.regime.toUpperCase().replace('_', ' ')} (${Math.round(marketContext.regimeConfidence * 100)}% confidence)`);
  console.log(`   Volatility: ${marketContext.volatilityPercentile}th percentile`);
  console.log(`   Trend Strength: ${marketContext.trendStrength.toFixed(2)} (${marketContext.trendStrength > 0.3 ? 'UP' : marketContext.trendStrength < -0.3 ? 'DOWN' : 'NEUTRAL'})`);
  console.log(`   Momentum: ${marketContext.momentum.toFixed(2)}`);
  console.log(`   Mean Reversion Probability: ${Math.round(marketContext.meanReversionProb * 100)}%`);

  // Quality score
  console.log(`\n⭐ QUALITY SCORE: ${qualityScore.overall}/100`);
  console.log(`   Components:`);
  console.log(`     • Technical Alignment:  ${qualityScore.components.technicalAlignment}/100 ${getScoreEmoji(qualityScore.components.technicalAlignment)}`);
  console.log(`     • Pattern Match:        ${qualityScore.components.patternMatch}/100 ${getScoreEmoji(qualityScore.components.patternMatch)}`);
  console.log(`     • Historical Edge:      ${qualityScore.components.historicalEdge}/100 ${getScoreEmoji(qualityScore.components.historicalEdge)}`);
  console.log(`     • Risk/Reward:          ${qualityScore.components.riskReward}/100 ${getScoreEmoji(qualityScore.components.riskReward)}`);
  console.log(`     • Regime Compatibility: ${qualityScore.components.regimeCompatibility}/100 ${getScoreEmoji(qualityScore.components.regimeCompatibility)}`);
  console.log(`     • Timing:               ${qualityScore.components.timing}/100 ${getScoreEmoji(qualityScore.components.timing)}`);

  // Explanation
  console.log(`\n💡 EXPLANATION:`);
  qualityScore.explanation.forEach((line: string) => {
    console.log(`   ${line}`);
  });

  // Warnings
  if (qualityScore.warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS:`);
    qualityScore.warnings.forEach((warning: string) => {
      console.log(`   • ${warning}`);
    });
  }

  // Pattern matches
  if (patternMatches.length > 0) {
    console.log(`\n🔍 PATTERN MATCHES:`);
    patternMatches.forEach((pattern) => {
      console.log(`   • ${pattern.patternName}`);
      console.log(`     Similarity: ${Math.round(pattern.similarity * 100)}% | Historical WR: ${Math.round(pattern.historicalWinRate * 100)}% | Avg Profit: ${(pattern.avgProfit * 100).toFixed(2)}%`);
    });
  }

  // Recommendation
  console.log(`\n${recommendation.shouldTrade ? '✅' : '❌'} RECOMMENDATION: ${recommendation.shouldTrade ? 'EXECUTE TRADE' : 'SKIP TRADE'}`);

  if (recommendation.shouldTrade) {
    console.log(`   Position Size: ${Math.round(recommendation.sizeMultiplier * 100)}% of standard`);
    console.log(`   TP Multiplier: ${recommendation.tpMultiplier.toFixed(2)}x`);
    console.log(`   SL Multiplier: ${recommendation.slMultiplier.toFixed(2)}x`);
  }

  console.log(`\n📝 REASONING:`);
  recommendation.reasoning.forEach((line: string) => {
    console.log(`   ${line}`);
  });

  if (recommendation.alternatives && recommendation.alternatives.length > 0) {
    console.log(`\n💭 ALTERNATIVES:`);
    recommendation.alternatives.forEach((alt: string) => {
      console.log(`   • ${alt}`);
    });
  }

  console.log(`\n⏱️  Processing Time: ${processingTimeMs}ms`);
  console.log('═'.repeat(100) + '\n');
}

/**
 * Get emoji for score
 */
function getScoreEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 65) return '🟡';
  if (score >= 50) return '🟠';
  return '🔴';
}

/**
 * Main function
 */
async function main() {
  console.log('═'.repeat(100));
  console.log('🤖 AI SIGNAL ANALYSIS - DEMO (ANALYSIS ONLY, NO TRADING)');
  console.log('═'.repeat(100));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s`);
  console.log(`   Gateway: ${GATEWAY_URL}`);
  console.log(`   Min Quality Score: ${AI_CONFIG.minQualityScore}`);
  console.log(`   Conservative Mode: ${AI_CONFIG.conservativeMode ? 'YES' : 'NO'}`);
  console.log();

  // Create AI Analyzer
  const aiAnalyzer = new AIAnalyzer(AI_CONFIG);
  console.log('✅ AI Analyzer initialized\n');

  // Create Gateway client
  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: true,
    enableLogging: false,
  });

  // Create strategy and engine
  const strategy = createStrategy();
  const engine = new StrategyEngine();
  engine.addStrategy(strategy);
  await engine.startAll();
  console.log(`✅ Strategy started\n`);

  // Listen for signals
  engine.on('signal', async (signal: Signal) => {
    const asset = (signal as any).asset || signal.symbol || SYMBOLS[0];

    // Get candles for this asset from engine
    const strategyName = strategy.getName();
    const candles = engine.getCandleDataForAsset(strategyName, asset);

    if (candles.length < 50) {
      console.log(`⏳ Not enough candles for analysis (${candles.length}/50)`);
      return;
    }

    analysisCount++;

    try {
      // Run AI analysis
      const analysis = await aiAnalyzer.analyze(signal, candles);

      // Display results
      displayAnalysis(signal, analysis);

      // Update stats
      if (analysis.recommendation.shouldTrade) {
        recommendedCount++;
      } else {
        rejectedCount++;
      }

      // Show stats
      const acceptanceRate = analysisCount > 0 ? (recommendedCount / analysisCount) * 100 : 0;
      console.log(`📈 STATISTICS:`);
      console.log(`   Total Signals Analyzed: ${analysisCount}`);
      console.log(`   Recommended: ${recommendedCount} (${acceptanceRate.toFixed(1)}%)`);
      console.log(`   Rejected: ${rejectedCount} (${(100 - acceptanceRate).toFixed(1)}%)`);
      console.log();

    } catch (error: any) {
      console.error(`❌ AI Analysis error: ${error.message}`);
    }
  });

  // Connect to Gateway
  console.log('🔌 Connecting to Gateway...');
  await client.connect();
  console.log('✅ Connected\n');

  // Load historical candles
  console.log(`📥 Loading historical candles...`);
  for (const symbol of SYMBOLS) {
    try {
      const candles = await client.getCandles(symbol, TIMEFRAME, 100);
      console.log(`   ✅ ${symbol}: ${candles.length} candles`);

      if (!candleBuffers.has(symbol)) {
        candleBuffers.set(symbol, []);
      }
      const buffer = candleBuffers.get(symbol)!;
      buffer.push(...candles);

      for (const candle of candles) {
        await engine.processCandle(candle);
      }
    } catch (error) {
      console.warn(`   ⚠️  ${symbol}: Could not load historical candles`);
    }
  }
  console.log('✅ Historical data loaded\n');

  // Subscribe to ticks
  console.log(`📡 Subscribing to ${SYMBOLS.join(', ')}...`);
  await client.follow(SYMBOLS);
  console.log('✅ Subscribed\n');

  // Listen for ticks
  client.on('tick', async (tick: Tick) => {
    if (!SYMBOLS.includes(tick.asset)) return;

    const candle = processTick(tick);
    if (candle) {
      const asset = candle.asset;

      if (!candleBuffers.has(asset)) {
        candleBuffers.set(asset, []);
      }
      const buffer = candleBuffers.get(asset)!;
      buffer.push(candle);

      if (buffer.length > 200) {
        buffer.shift();
      }

      await engine.processCandle(candle);
    }
  });

  console.log('✅ AI Analysis Demo running. Waiting for signals...');
  console.log('   Press Ctrl+C to stop\n');

  // Handle exit
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping...\n');

    const acceptanceRate = analysisCount > 0 ? (recommendedCount / analysisCount) * 100 : 0;

    console.log('═'.repeat(100));
    console.log('📊 FINAL STATISTICS');
    console.log('═'.repeat(100));
    console.log(`   Total Signals Analyzed: ${analysisCount}`);
    console.log(`   Recommended for Trading: ${recommendedCount} (${acceptanceRate.toFixed(1)}%)`);
    console.log(`   Rejected/Filtered: ${rejectedCount} (${(100 - acceptanceRate).toFixed(1)}%)`);
    console.log('═'.repeat(100));

    process.exit(0);
  });
}

// Run
main().catch(console.error);
