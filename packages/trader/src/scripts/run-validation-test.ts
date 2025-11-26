/**
 * Validation Test Runner
 *
 * Runs ultra high-frequency validation strategy to test:
 * - Gateway connection
 * - Strategy execution
 * - Trade placement
 * - Result tracking
 *
 * Expected: 30-50 signals in first hour
 */

import { GatewayClient } from '../client/gateway-client';
import { StrategyEngine } from '../strategy/strategy-engine';
import { ValidationTestStrategy } from '../strategies/validation-test.strategy';
import { createLogger } from '@deriv-bot/shared';
import type { Tick, Candle } from '@deriv-bot/shared';

// Create logger for validation test
const logger = createLogger({
  service: 'validation-test',
  level: 'info',
  console: true,
  file: false,
});

// Configuration
const SYMBOL = 'R_25';
const TIMEFRAME = 60; // 1 minute

// Stats tracking
let signalCount = 0;
let tradeCount = 0;
let wonTrades = 0;
let lostTrades = 0;
const startTime = Date.now();

// Candle buffer
const candleBuffer: Candle[] = [];
let currentCandle: Partial<Candle> | null = null;
let lastCandleTime = 0;

/**
 * Process tick and build candle
 */
function processTick(tick: Tick): Candle | null {
  const tickTime = tick.timestamp;
  const candleTime = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);

  // New candle
  if (candleTime !== lastCandleTime) {
    const completedCandle = currentCandle;
    lastCandleTime = candleTime;

    // Start new candle
    currentCandle = {
      asset: SYMBOL,
      timeframe: TIMEFRAME,
      timestamp: candleTime,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
    };

    // Return completed candle if exists
    if (completedCandle && completedCandle.timestamp) {
      return completedCandle as Candle;
    }
  } else if (currentCandle) {
    // Update current candle
    currentCandle.high = Math.max(currentCandle.high || 0, tick.price);
    currentCandle.low = Math.min(currentCandle.low || Infinity, tick.price);
    currentCandle.close = tick.price;
  }

  return null;
}

/**
 * Execute trade
 */
async function executeTrade(
  client: GatewayClient,
  direction: 'CALL' | 'PUT',
  metadata: any
): Promise<void> {
  tradeCount++;

  logger.info('');
  logger.info(`📊 TRADE #${tradeCount}`);
  logger.info(`   Direction: ${direction}`);
  logger.info(`   Stake: $1.00`);
  logger.info(`   RSI: ${metadata?.rsi?.toFixed(2)}`);
  logger.info(`   Reason: ${metadata?.reason}`);

  try {
    // Execute trade through Gateway
    const result = await client.trade({
      asset: SYMBOL,
      direction,
      amount: 1, // $1 minimum
      duration: 30,  // 30 seconds - minimum allowed
      durationUnit: 's',
    });

    logger.info(`   ✅ Trade executed: ${result.contractId}`);
    logger.info(`   Buy Price: $${result.buyPrice}`);
    logger.info(`   Payout: $${result.payout}`);
  } catch (error: any) {
    logger.error(`   ❌ Error executing trade: ${error.message}`);
  }
}

async function main() {
  logger.info('🧪 Starting Validation Test - Ultra High Frequency');
  logger.info('='.repeat(80));
  logger.info('');
  logger.info('This will generate MANY signals (30-50/hour) to validate:');
  logger.info('  ✅ Gateway connection & communication');
  logger.info('  ✅ Strategy execution pipeline');
  logger.info('  ✅ Trade placement & tracking');
  logger.info('  ✅ Result monitoring');
  logger.info('');
  logger.info('⚠️  WARNING: This is NOT a real trading strategy!');
  logger.info('   Use DEMO account only for validation.');
  logger.info('');
  logger.info('='.repeat(80));
  logger.info('');

  // Connect to gateway
  logger.info('📡 Connecting to Gateway...');
  const host = process.env.GATEWAY_HOST || 'localhost';
  const port = process.env.GATEWAY_PORT || '3000';
  const url = `ws://${host}:${port}`;

  logger.info(`   Gateway URL: ${url}`);

  const gateway = new GatewayClient({
    url,
    autoReconnect: true,
    enableLogging: true,
  });

  await gateway.connect();
  logger.info('✅ Connected to Gateway');
  logger.info('');

  // Get balance
  try {
    const balance = await gateway.getBalance();
    logger.info(`💰 Account Balance: ${balance.amount} ${balance.currency}`);
  } catch (error) {
    logger.warn('⚠️  Could not get balance');
  }
  logger.info('');

  // Create strategy
  const strategy = new ValidationTestStrategy();
  const engine = new StrategyEngine();
  engine.addStrategy(strategy);

  logger.info(`📊 Strategy loaded: ${strategy.getName()}`);
  logger.info(`   Description: ${strategy.getConfig().description}`);

  const stats = strategy.getStats();
  logger.info('');
  logger.info('⚙️  Validation Parameters:');
  logger.info(`   RSI Oversold:  ${stats.parameters.rsiOversold} (very relaxed)`);
  logger.info(`   RSI Overbought: ${stats.parameters.rsiOverbought} (very relaxed)`);
  logger.info(`   Cooldown:      ${stats.parameters.cooldownMs}ms (5 seconds!)`);
  logger.info(`   Max Concurrent: ${stats.parameters.maxConcurrent}`);
  logger.info('');

  logger.info('🎯 Trading Configuration:');
  logger.info('   Symbol:        R_25 (Volatility 25 Index)');
  logger.info('   Timeframe:     1 minute');
  logger.info('   Contract:      Rise/Fall');
  logger.info('   Expiry:        30 SECONDS (ultra fast!)');
  logger.info('   Stake:         $1.00 (minimum for testing)');
  logger.info('   Max Active:    10 trades');
  logger.info('');

  // Listen for signals
  engine.on('signal', async (signal) => {
    signalCount++;

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    logger.info('');
    logger.info(`🎯 SIGNAL #${signalCount} (uptime: ${uptime}s)`);
    logger.info(`   Direction: ${signal.direction}`);
    logger.info(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    logger.info(`   Entry: ${signal.entry}`);

    // Execute trade
    await executeTrade(gateway, signal.direction, signal.metadata);
  });

  // Listen for trade results
  gateway.on('trade:result', (data) => {
    if (data.result === 'won') {
      wonTrades++;
      logger.info('');
      logger.info(`✅ Trade ${data.id} WON (+$${data.profit.toFixed(2)})`);
    } else {
      lostTrades++;
      logger.info('');
      logger.info(`❌ Trade ${data.id} LOST ($${data.profit.toFixed(2)})`);
    }

    const winRate = tradeCount > 0 ? ((wonTrades / tradeCount) * 100).toFixed(1) : '0.0';
    logger.info(`   Win Rate: ${winRate}% (${wonTrades}W / ${lostTrades}L)`);
  });

  // Get historical candles
  logger.info('📊 Loading historical candles...');
  try {
    const historicalCandles = await gateway.getCandles(SYMBOL, TIMEFRAME, 100);

    if (historicalCandles && historicalCandles.length > 0) {
      candleBuffer.push(...historicalCandles);
      logger.info(`✅ Loaded ${historicalCandles.length} historical candles`);
    }
  } catch (error) {
    logger.warn('⚠️  Could not load historical candles, starting fresh');
  }
  logger.info('');

  // Subscribe to ticks
  logger.info(`📡 Subscribing to ${SYMBOL}...`);
  await gateway.follow([SYMBOL]);
  logger.info(`✅ Subscribed to ${SYMBOL}`);
  logger.info('');

  // Start strategy
  await engine.startAll();
  logger.info('✅ Strategy started');
  logger.info('');

  // Feed historical candles to engine
  if (candleBuffer.length > 0) {
    logger.info(`🔄 Feeding ${candleBuffer.length} historical candles to engine...`);
    for (const candle of candleBuffer) {
      await engine.processCandle(candle);
    }
    logger.info('✅ Engine initialized with historical data');
  }
  logger.info('');

  if (candleBuffer.length >= 20) {
    logger.info('🎯 Ready to generate signals IMMEDIATELY');
  } else {
    logger.info(`📊 Need ${20 - candleBuffer.length} more candles before generating signals`);
  }
  logger.info('');

  logger.info('Expected behavior:');
  logger.info('  - Signals EVERY MINUTE (cada candle)');
  logger.info('  - ~60 total signals in first hour');
  logger.info('  - Up to 10 concurrent trades');
  logger.info('');
  logger.info('Press Ctrl+C to stop');
  logger.info('='.repeat(80));
  logger.info('');

  // Listen for ticks
  gateway.on('tick', (tick: Tick) => {
    // Only process ticks for our symbol
    if (tick.asset !== SYMBOL) return;

    // Build candle
    const completedCandle = processTick(tick);

    if (completedCandle) {
      // Add to buffer
      candleBuffer.push(completedCandle);

      // Keep last 100 candles
      if (candleBuffer.length > 100) {
        candleBuffer.shift();
      }

      // Process with strategy (if enough candles)
      if (candleBuffer.length >= 20) {
        engine.processCandle(completedCandle);
      }
    }
  });

  // Stats reporting every 30 seconds
  setInterval(() => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const signalsPerMin = signalCount > 0 ? ((signalCount / uptime) * 60).toFixed(1) : '0.0';

    logger.info('');
    logger.info('📊 Validation Stats:');
    logger.info(`   Uptime:           ${uptime}s`);
    logger.info(`   Signals:          ${signalCount} (${signalsPerMin}/min)`);
    logger.info(`   Trades Placed:    ${tradeCount}`);
    logger.info(`   Active Trades:    ${stats.activeTrades}`);
    logger.info(`   Completed:        ${wonTrades + lostTrades} (${wonTrades}W / ${lostTrades}L)`);
    logger.info('');
  }, 30000);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('');
    logger.info('⏹️  Stopping validation test...');

    await engine.stopAll();
    await gateway.disconnect();

    logger.info('');
    logger.info('='.repeat(80));
    logger.info('           VALIDATION TEST SUMMARY');
    logger.info('='.repeat(80));
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    logger.info(`Runtime:          ${uptime}s (${(uptime / 60).toFixed(1)}min)`);
    logger.info(`Signals Generated: ${signalCount}`);
    logger.info(`Trades Placed:     ${tradeCount}`);
    logger.info(`Trades Completed:  ${wonTrades + lostTrades}`);
    logger.info(`Win Rate:          ${tradeCount > 0 ? ((wonTrades / tradeCount) * 100).toFixed(1) : 0}%`);
    logger.info(`Candles Processed: ${candleBuffer.length}`);
    logger.info('='.repeat(80));
    logger.info('');
    logger.info('✅ Stopped gracefully');

    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('❌ Fatal error:', error);
  process.exit(1);
});
