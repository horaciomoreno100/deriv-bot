#!/usr/bin/env node
/**
 * AI-Enhanced Trading Demo
 *
 * Integración completa: Estrategia Mean Reversion + AI Analysis
 *
 * Este script ejecuta trades REALES en demo, pero FILTRADOS por IA:
 * - Solo ejecuta señales con Quality Score >= 65
 * - Ajusta tamaño de posición según calidad de señal
 * - Ajusta TP/SL según volatilidad y régimen de mercado
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { UnifiedTradeAdapter } from '../adapters/trade-adapter.js';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { AIAnalyzer } from '../analysis/ai-analyzer.js';
import type { Candle, Tick, StrategyConfig, Signal } from '@deriv-bot/shared';

dotenv.config();

// Configuration
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOLS_STR = process.env.SYMBOL || 'R_75';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const TIMEFRAME = 60;
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const TRADE_MODE = 'binary'; // binary options

// AI Configuration
const AI_CONFIG = {
  minQualityScore: 65,      // Only trade signals with 65+ quality
  conservativeMode: false,  // false = standard mode
};

// State
let balance = INITIAL_BALANCE;
let totalSignals = 0;
let aiRecommendedTrades = 0;
let aiRejectedSignals = 0;
let executedTrades = 0;
const candleBuffers = new Map<string, Candle[]>();
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();

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
 * Main function
 */
async function main() {
  console.log('═'.repeat(100));
  console.log('🤖 AI-ENHANCED TRADING - DEMO');
  console.log('═'.repeat(100));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s`);
  console.log(`   Gateway: ${GATEWAY_URL}`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   AI Min Quality Score: ${AI_CONFIG.minQualityScore}`);
  console.log(`   AI Mode: ${AI_CONFIG.conservativeMode ? 'Conservative' : 'Standard'}`);
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

  // Create trade adapter
  const adapter = new UnifiedTradeAdapter(client, TRADE_MODE);

  // Create strategy and engine
  const strategy = createStrategy();
  const engine = new StrategyEngine();
  engine.addStrategy(strategy);
  await engine.startAll();
  console.log(`✅ Strategy started\n`);

  // Listen for signals
  engine.on('signal', async (signal: Signal) => {
    totalSignals++;
    const asset = (signal as any).asset || signal.symbol || SYMBOLS[0];

    console.log(`\n${'═'.repeat(100)}`);
    console.log(`📊 SIGNAL #${totalSignals} DETECTED`);
    console.log(`${'═'.repeat(100)}`);
    console.log(`   Asset: ${asset}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Original Confidence: ${(signal.confidence * 100).toFixed(1)}%`);

    // Get candles for AI analysis
    const candles = engine.getCandleDataForAsset(strategy.getName(), asset);

    if (candles.length < 50) {
      console.log(`   ⏳ Not enough candles for AI analysis (${candles.length}/50)`);
      console.log(`${'═'.repeat(100)}\n`);
      return;
    }

    try {
      // Run AI analysis
      console.log(`\n🤖 Running AI Analysis...`);
      const analysis = await aiAnalyzer.analyze(signal, candles);

      // Display AI results
      console.log(`\n🌍 MARKET CONTEXT:`);
      console.log(`   Regime: ${analysis.marketContext.regime.toUpperCase().replace('_', ' ')} (${Math.round(analysis.marketContext.regimeConfidence * 100)}% confidence)`);
      console.log(`   Volatility: ${analysis.marketContext.volatilityPercentile}th percentile`);
      console.log(`   Mean Reversion Probability: ${Math.round(analysis.marketContext.meanReversionProb * 100)}%`);

      console.log(`\n⭐ QUALITY SCORE: ${analysis.qualityScore.overall}/100`);
      console.log(`   Technical Alignment: ${analysis.qualityScore.components.technicalAlignment}/100`);
      console.log(`   Pattern Match: ${analysis.qualityScore.components.patternMatch}/100`);
      console.log(`   Regime Compatibility: ${analysis.qualityScore.components.regimeCompatibility}/100`);

      // Check AI recommendation
      if (!analysis.recommendation.shouldTrade) {
        aiRejectedSignals++;
        console.log(`\n❌ AI RECOMMENDATION: SKIP TRADE`);
        console.log(`   Reason: Quality score ${analysis.qualityScore.overall} below threshold ${AI_CONFIG.minQualityScore}`);
        console.log(`\n📝 Reasoning:`);
        analysis.recommendation.reasoning.forEach(reason => {
          console.log(`   ${reason}`);
        });

        if (analysis.qualityScore.warnings.length > 0) {
          console.log(`\n⚠️  Warnings:`);
          analysis.qualityScore.warnings.forEach(warning => {
            console.log(`   • ${warning}`);
          });
        }

        console.log(`\n📊 STATS: Signals ${totalSignals} | AI Recommended ${aiRecommendedTrades} | AI Rejected ${aiRejectedSignals} | Executed ${executedTrades}`);
        console.log(`${'═'.repeat(100)}\n`);
        return;
      }

      // AI recommends trade - apply adjustments
      aiRecommendedTrades++;

      console.log(`\n✅ AI RECOMMENDATION: EXECUTE TRADE`);
      console.log(`   Adjusted Confidence: ${(analysis.recommendation.adjustedConfidence * 100).toFixed(1)}%`);
      console.log(`   Position Size Multiplier: ${analysis.recommendation.sizeMultiplier.toFixed(2)}x`);
      console.log(`   TP Multiplier: ${analysis.recommendation.tpMultiplier.toFixed(2)}x`);
      console.log(`   SL Multiplier: ${analysis.recommendation.slMultiplier.toFixed(2)}x`);

      // Calculate adjusted stake
      const baseStake = Math.max(1.0, balance * 0.01);
      const adjustedStake = Math.floor(baseStake * analysis.recommendation.sizeMultiplier * 100) / 100;

      console.log(`\n💰 POSITION SIZING:`);
      console.log(`   Base Stake (1%): $${baseStake.toFixed(2)}`);
      console.log(`   AI Adjusted Stake: $${adjustedStake.toFixed(2)}`);

      // Execute trade
      console.log(`\n📤 Executing trade...`);

      const result = await adapter.executeTrade({
        asset,
        direction: signal.direction,
        amount: adjustedStake,
        duration: 1,
        durationUnit: 'm',
        strategyName: 'AI-Enhanced-Mean-Reversion',
      });

      executedTrades++;
      balance -= adjustedStake;

      console.log(`\n✅✅✅ TRADE EXECUTED ✅✅✅`);
      console.log(`   Contract ID: ${result.contractId}`);
      console.log(`   Entry Price: ${result.entryPrice.toFixed(2)}`);
      console.log(`   Stake: $${adjustedStake.toFixed(2)}`);
      console.log(`   Balance: $${balance.toFixed(2)}`);

      console.log(`\n📊 STATS:`);
      console.log(`   Total Signals: ${totalSignals}`);
      console.log(`   AI Recommended: ${aiRecommendedTrades} (${Math.round((aiRecommendedTrades / totalSignals) * 100)}%)`);
      console.log(`   AI Rejected: ${aiRejectedSignals} (${Math.round((aiRejectedSignals / totalSignals) * 100)}%)`);
      console.log(`   Executed: ${executedTrades}`);

      console.log(`${'═'.repeat(100)}\n`);

    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      console.log(`${'═'.repeat(100)}\n`);
    }
  });

  // Connect to Gateway
  console.log('🔌 Connecting to Gateway...');
  await client.connect();
  console.log('✅ Connected\n');

  // Get balance
  try {
    const balanceInfo = await client.getBalance();
    if (balanceInfo) {
      balance = balanceInfo.amount;
      console.log(`💰 Balance: $${balance.toFixed(2)} (${balanceInfo.loginid})`);
      engine.updateBalance(balance);
    }
  } catch (error) {
    console.warn('⚠️  Could not get balance');
    engine.updateBalance(balance);
  }

  // Load historical candles
  console.log(`\n📥 Loading historical candles...`);
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

  console.log('✅ AI-Enhanced Trading running. Waiting for signals...');
  console.log('   Press Ctrl+C to stop\n');

  // Handle exit
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping...\n');

    const acceptanceRate = totalSignals > 0 ? (aiRecommendedTrades / totalSignals) * 100 : 0;
    const executionRate = aiRecommendedTrades > 0 ? (executedTrades / aiRecommendedTrades) * 100 : 0;

    console.log('═'.repeat(100));
    console.log('📊 FINAL STATISTICS');
    console.log('═'.repeat(100));
    console.log(`   Total Signals: ${totalSignals}`);
    console.log(`   AI Recommended: ${aiRecommendedTrades} (${acceptanceRate.toFixed(1)}%)`);
    console.log(`   AI Rejected: ${aiRejectedSignals} (${(100 - acceptanceRate).toFixed(1)}%)`);
    console.log(`   Trades Executed: ${executedTrades} (${executionRate.toFixed(1)}% of recommended)`);
    console.log(`   Final Balance: $${balance.toFixed(2)}`);
    console.log('═'.repeat(100));

    process.exit(0);
  });
}

// Run
main().catch(console.error);
