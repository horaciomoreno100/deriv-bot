#!/usr/bin/env node
/**
 * AI Analysis Observer
 *
 * Este script corre EN PARALELO con tu trader actual:
 * - Escucha las señales que genera tu estrategia
 * - Las analiza con IA
 * - Reporta qué señales son buenas vs malas
 * - NO interfiere con la ejecución de trades
 *
 * Úsalo para:
 * 1. Ver qué señales deberías haber tomado vs rechazado
 * 2. Comparar performance: todas las señales vs solo las recomendadas por IA
 * 3. Ajustar el threshold de calidad óptimo
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { AIAnalyzer } from '../analysis/ai-analyzer.js';
import type { Candle, Tick, StrategyConfig, Signal } from '@deriv-bot/shared';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Configuration
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOLS_STR = process.env.SYMBOL || 'R_10,R_25,R_50,R_75,R_100';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const TIMEFRAME = 60;

// AI Configuration - Prueba diferentes thresholds
const AI_THRESHOLDS = [55, 60, 65, 70, 75]; // Evaluaremos múltiples thresholds

// Stats tracking
interface SignalAnalysis {
  timestamp: number;
  asset: string;
  direction: string;
  originalConfidence: number;
  qualityScore: number;
  regime: string;
  volatility: number;
  meanReversionProb: number;
  recommendation: 'TRADE' | 'SKIP';
  reasoning: string[];
  warnings: string[];
}

const allSignals: SignalAnalysis[] = [];
const candleBuffers = new Map<string, Candle[]>();
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();

// Output file
const OUTPUT_DIR = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const OUTPUT_FILE = path.join(OUTPUT_DIR, `ai_analysis_report_${timestamp}.json`);

/**
 * Create strategy (same as your actual trader)
 */
function createStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'AI-Observer-Mean-Reversion',
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
 * Analyze signal with AI and log results
 */
async function analyzeSignal(
  signal: Signal,
  candles: Candle[],
  aiAnalyzer: AIAnalyzer
): Promise<void> {
  const asset = (signal as any).asset || signal.symbol || 'UNKNOWN';

  try {
    const analysis = await aiAnalyzer.analyze(signal, candles);

    // Store analysis
    const signalAnalysis: SignalAnalysis = {
      timestamp: Date.now(),
      asset,
      direction: signal.direction,
      originalConfidence: signal.confidence,
      qualityScore: analysis.qualityScore.overall,
      regime: analysis.marketContext.regime,
      volatility: analysis.marketContext.volatilityPercentile,
      meanReversionProb: analysis.marketContext.meanReversionProb,
      recommendation: analysis.recommendation.shouldTrade ? 'TRADE' : 'SKIP',
      reasoning: analysis.recommendation.reasoning,
      warnings: analysis.qualityScore.warnings,
    };

    allSignals.push(signalAnalysis);

    // Display compact analysis
    const emoji = analysis.recommendation.shouldTrade ? '✅' : '❌';
    const scoreColor = analysis.qualityScore.overall >= 75 ? '🟢' :
                       analysis.qualityScore.overall >= 65 ? '🟡' :
                       analysis.qualityScore.overall >= 50 ? '🟠' : '🔴';

    console.log(`\n${emoji} SIGNAL #${allSignals.length} [${asset}] ${signal.direction}`);
    console.log(`   Score: ${analysis.qualityScore.overall}/100 ${scoreColor}`);
    console.log(`   Regime: ${analysis.marketContext.regime.toUpperCase().replace('_', ' ')}`);
    console.log(`   MR Prob: ${Math.round(analysis.marketContext.meanReversionProb * 100)}%`);
    console.log(`   Recommendation: ${analysis.recommendation.shouldTrade ? 'TRADE' : 'SKIP'}`);

    if (analysis.qualityScore.warnings.length > 0) {
      console.log(`   ⚠️  ${analysis.qualityScore.warnings[0]}`);
    }

  } catch (error: any) {
    console.error(`   ❌ Analysis error: ${error.message}`);
  }
}

/**
 * Generate performance report
 */
function generateReport(): void {
  if (allSignals.length === 0) {
    console.log('\n⚠️  No signals analyzed yet\n');
    return;
  }

  console.log('\n' + '═'.repeat(100));
  console.log('📊 AI ANALYSIS REPORT');
  console.log('═'.repeat(100));

  // Overall stats
  console.log(`\n📈 OVERALL STATS:`);
  console.log(`   Total Signals Analyzed: ${allSignals.length}`);

  // Stats by threshold
  console.log(`\n🎯 FILTERING IMPACT BY THRESHOLD:\n`);
  console.log(`   Threshold | Accepted | Rejected | Accept Rate | Avg Score (Accepted)`);
  console.log(`   ${'-'.repeat(75)}`);

  AI_THRESHOLDS.forEach(threshold => {
    const accepted = allSignals.filter(s => s.qualityScore >= threshold);
    const rejected = allSignals.filter(s => s.qualityScore < threshold);
    const acceptRate = (accepted.length / allSignals.length) * 100;
    const avgScore = accepted.length > 0
      ? accepted.reduce((sum, s) => sum + s.qualityScore, 0) / accepted.length
      : 0;

    console.log(`   ${threshold.toString().padEnd(9)} | ${accepted.length.toString().padEnd(8)} | ${rejected.length.toString().padEnd(8)} | ${acceptRate.toFixed(1).padEnd(11)}% | ${avgScore.toFixed(1)}`);
  });

  // Regime analysis
  console.log(`\n🌍 SIGNALS BY MARKET REGIME:\n`);
  const regimeCounts = new Map<string, { count: number; avgScore: number; scores: number[] }>();

  allSignals.forEach(s => {
    const regime = s.regime;
    if (!regimeCounts.has(regime)) {
      regimeCounts.set(regime, { count: 0, avgScore: 0, scores: [] });
    }
    const data = regimeCounts.get(regime)!;
    data.count++;
    data.scores.push(s.qualityScore);
  });

  regimeCounts.forEach((data) => {
    data.avgScore = data.scores.reduce((sum, s) => sum + s, 0) / data.scores.length;
  });

  // Sort by count
  const sortedRegimes = Array.from(regimeCounts.entries())
    .sort((a, b) => b[1].count - a[1].count);

  console.log(`   Regime                | Count | Avg Score`);
  console.log(`   ${'-'.repeat(50)}`);
  sortedRegimes.forEach(([regime, data]) => {
    const formattedRegime = regime.toUpperCase().replace('_', ' ').padEnd(20);
    console.log(`   ${formattedRegime} | ${data.count.toString().padEnd(5)} | ${data.avgScore.toFixed(1)}`);
  });

  // Quality distribution
  console.log(`\n⭐ QUALITY SCORE DISTRIBUTION:\n`);
  const ranges = [
    { label: '80-100 (Excellent)', min: 80, max: 100 },
    { label: '65-79  (Good)', min: 65, max: 79 },
    { label: '50-64  (Fair)', min: 50, max: 64 },
    { label: '0-49   (Poor)', min: 0, max: 49 },
  ];

  ranges.forEach(range => {
    const count = allSignals.filter(s => s.qualityScore >= range.min && s.qualityScore <= range.max).length;
    const pct = (count / allSignals.length) * 100;
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(`   ${range.label}: ${count.toString().padStart(3)} (${pct.toFixed(1).padStart(5)}%) ${bar}`);
  });

  // Top 5 best and worst signals
  const sorted = [...allSignals].sort((a, b) => b.qualityScore - a.qualityScore);

  console.log(`\n🏆 TOP 5 BEST SIGNALS:\n`);
  sorted.slice(0, 5).forEach((s, i) => {
    console.log(`   ${i + 1}. [${s.asset}] ${s.direction} - Score: ${s.qualityScore} - Regime: ${s.regime}`);
  });

  console.log(`\n⚠️  TOP 5 WORST SIGNALS:\n`);
  sorted.slice(-5).reverse().forEach((s, i) => {
    console.log(`   ${i + 1}. [${s.asset}] ${s.direction} - Score: ${s.qualityScore} - Regime: ${s.regime}`);
    if (s.warnings.length > 0) {
      console.log(`      Warning: ${s.warnings[0]}`);
    }
  });

  // Recommendations
  console.log(`\n💡 RECOMMENDATIONS:\n`);

  const bestThreshold = AI_THRESHOLDS.reduce((best, threshold) => {
    const accepted = allSignals.filter(s => s.qualityScore >= threshold);
    const avgScore = accepted.length > 0
      ? accepted.reduce((sum, s) => sum + s.qualityScore, 0) / accepted.length
      : 0;

    const bestAccepted = best !== undefined ? allSignals.filter(s => s.qualityScore >= best) : [];
    const bestAvgScore = bestAccepted.length > 0
      ? bestAccepted.reduce((sum, s) => sum + s.qualityScore, 0) / bestAccepted.length
      : 0;

    // Find threshold with best balance: 40-70% acceptance rate + highest avg score
    const acceptRate = (accepted.length / allSignals.length) * 100;
    if (acceptRate >= 40 && acceptRate <= 70 && avgScore > bestAvgScore) {
      return threshold;
    }
    return best;
  }, AI_THRESHOLDS[2]); // Default to 65

  console.log(`   ✓ Recommended threshold: ${bestThreshold}`);
  console.log(`     This gives a good balance between signal quality and trade frequency.`);

  const worstRegime = sortedRegimes[sortedRegimes.length - 1];
  if (worstRegime && worstRegime[1].avgScore < 55) {
    console.log(`   ✓ Avoid trading in "${worstRegime[0]}" regime (avg score: ${worstRegime[1].avgScore.toFixed(1)})`);
  }

  const excellentSignals = allSignals.filter(s => s.qualityScore >= 80).length;
  const excellentPct = (excellentSignals / allSignals.length) * 100;
  if (excellentPct < 20) {
    console.log(`   ✓ Only ${excellentPct.toFixed(1)}% of signals are "excellent" (80+)`);
    console.log(`     Consider adjusting strategy parameters to generate higher quality signals.`);
  }

  console.log('═'.repeat(100) + '\n');

  // Save to file
  try {
    const report = {
      timestamp: new Date().toISOString(),
      totalSignals: allSignals.length,
      thresholds: AI_THRESHOLDS.map(threshold => ({
        threshold,
        accepted: allSignals.filter(s => s.qualityScore >= threshold).length,
        acceptRate: (allSignals.filter(s => s.qualityScore >= threshold).length / allSignals.length) * 100,
      })),
      regimes: Array.from(regimeCounts.entries()).map(([regime, data]) => ({
        regime,
        count: data.count,
        avgScore: data.avgScore,
      })),
      signals: allSignals,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    console.log(`📄 Full report saved to: ${OUTPUT_FILE}\n`);
  } catch (error) {
    console.error('⚠️  Could not save report file');
  }
}

/**
 * Main function
 */
async function main() {
  console.log('═'.repeat(100));
  console.log('🔍 AI ANALYSIS OBSERVER - Running in Parallel Mode');
  console.log('═'.repeat(100));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Gateway: ${GATEWAY_URL}`);
  console.log(`   Mode: OBSERVER ONLY (no interference with actual trading)`);
  console.log(`   Evaluating thresholds: ${AI_THRESHOLDS.join(', ')}`);
  console.log();

  // Create AI Analyzer (using middle threshold for real-time display)
  const aiAnalyzer = new AIAnalyzer({
    minQualityScore: AI_THRESHOLDS[2], // 65
    conservativeMode: false,
  });
  console.log('✅ AI Analyzer initialized\n');

  // Create Gateway client
  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: true,
    enableLogging: false,
  });

  // Create strategy and engine (to generate signals, same as your trader)
  const strategy = createStrategy();
  const engine = new StrategyEngine();
  engine.addStrategy(strategy);
  await engine.startAll();
  console.log(`✅ Strategy engine started (observer mode)\n`);

  // Listen for signals (THIS IS WHERE WE OBSERVE)
  engine.on('signal', async (signal: Signal) => {
    const asset = (signal as any).asset || signal.symbol || SYMBOLS[0];
    const candles = engine.getCandleDataForAsset(strategy.getName(), asset);

    if (candles.length < 50) {
      return; // Not enough data
    }

    // Analyze signal with AI (in parallel, non-blocking)
    await analyzeSignal(signal, candles, aiAnalyzer);
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
      console.warn(`   ⚠️  ${symbol}: Could not load candles`);
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

  console.log('✅ AI Observer running. Analyzing signals in real-time...');
  console.log('   Your actual trader can run separately - this will not interfere.');
  console.log('   Press Ctrl+C to stop and see full report\n');

  // Periodic mini-report (every 5 minutes)
  const reportInterval = setInterval(() => {
    if (allSignals.length > 0) {
      const recent = allSignals.slice(-10);
      const avgScore = recent.reduce((sum, s) => sum + s.qualityScore, 0) / recent.length;
      const recommended = recent.filter(s => s.recommendation === 'TRADE').length;

      console.log(`\n📊 Quick Stats (last ${recent.length} signals):`);
      console.log(`   Avg Score: ${avgScore.toFixed(1)}/100`);
      console.log(`   Recommended: ${recommended}/${recent.length} (${Math.round((recommended / recent.length) * 100)}%)\n`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Handle exit
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping observer...\n');
    clearInterval(reportInterval);
    generateReport();
    process.exit(0);
  });
}

// Run
main().catch(console.error);
