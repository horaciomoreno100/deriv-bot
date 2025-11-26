#!/usr/bin/env node
/**
 * Trading Dashboard - Interactive REPL/Dashboard for monitoring trading
 *
 * Usage:
 *   pnpm run dashboard
 *   or
 *   tsx src/scripts/run-dashboard.ts
 */

import dotenv from 'dotenv';
import React from 'react';
import { render } from 'ink';
import { GatewayClient } from '@deriv-bot/shared';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { DashboardApp } from '../dashboard/DashboardApp.js';
import { DashboardDataProvider } from '../dashboard/dashboard-data-provider.js';
import type { Candle, Tick } from '@deriv-bot/shared';

// Load environment variables
dotenv.config();

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOLS = (process.env.SYMBOL || 'R_75').split(',').map(s => s.trim());

async function main() {
  console.log('🚀 Starting Trading Dashboard...\n');

  // Initialize Gateway Client
  const gatewayClient = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: true,
    enableLogging: false, // Disable verbose logging for dashboard
  });

  // Initialize Strategy Engine (only for signal proximity calculation, NOT for trade execution)
  const strategyEngine = new StrategyEngine();

  // Create and add strategy (for proximity calculation only - no trades executed)
  const strategy = new MeanReversionStrategy({
    name: 'RSI + BB Scalping',
    assets: SYMBOLS,
    enabled: true,
    maxConcurrentTrades: SYMBOLS.length,
    amount: 10,
    amountType: 'percentage',
    cooldownSeconds: 30,
    minConfidence: 0.75,
    parameters: {
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      bbPeriod: 20,
      bbStdDev: 2.0,
      atrPeriod: 14,
      atrMultiplier: 1.0,
      expiryMinutes: 1,
      cooldownMinutes: 0.5,
      maxWinStreak: 2,
      maxLossStreak: 3,
    },
  });

  strategyEngine.addStrategy(strategy);

  // Connect to Gateway
  console.log(`📡 Connecting to Gateway at ${GATEWAY_URL}...`);
  await gatewayClient.connect();
  console.log('✅ Connected to Gateway\n');

  // Subscribe to assets
  console.log(`📊 Subscribing to assets: ${SYMBOLS.join(', ')}...`);
  await gatewayClient.follow(SYMBOLS);
  console.log('✅ Subscribed to assets\n');

  // Load historical candles (for indicator calculation)
  console.log('📈 Loading historical candles for signal proximity calculation...');
  for (const symbol of SYMBOLS) {
    try {
      const candles = await gatewayClient.getCandles(symbol, 60, 100);
      if (candles && candles.length > 0) {
        // Feed candles to engine (for indicator calculation only)
        for (const candle of candles) {
          await strategyEngine.processCandle(candle);
        }
        console.log(`✅ Loaded ${candles.length} candles for ${symbol}`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not load candles for ${symbol}:`, error);
    }
  }
  console.log();

  // Start strategies (for proximity calculation only)
  await strategyEngine.startAll();
  console.log('✅ Strategy engine started (for proximity calculation only)\n');

  // Candle building from ticks (for proximity calculation)
  const TIMEFRAME = 60; // 1 minute
  const currentCandles = new Map<string, Partial<Candle>>();
  const lastCandleTimes = new Map<string, number>();

  // Process tick and build candle (per asset)
  const processTick = (tick: Tick): Candle | null => {
    const asset = tick.asset;
    if (!SYMBOLS.includes(asset)) {
      return null; // Ignore assets not in our list
    }

    const tickTime = tick.timestamp; // Assume timestamp is in milliseconds
    // Calculate candle time in seconds (Candle.timestamp expects seconds)
    const candleTimeMs = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);
    const candleTime = Math.floor(candleTimeMs / 1000); // Convert to seconds

    const lastCandleTime = lastCandleTimes.get(asset) || 0;
    const currentCandle = currentCandles.get(asset);

    if (candleTime !== lastCandleTime) {
      const completedCandle = currentCandle;
      lastCandleTimes.set(asset, candleTime);

      // Start new candle
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

      // Return completed candle if valid
      if (completedCandle && completedCandle.open && completedCandle.close) {
        return completedCandle as Candle;
      }
    } else if (currentCandle) {
      // Update current candle
      currentCandle.high = Math.max(currentCandle.high || tick.price, tick.price);
      currentCandle.low = Math.min(currentCandle.low || tick.price, tick.price);
      currentCandle.close = tick.price;
      currentCandle.volume = (currentCandle.volume || 0) + 1;
    }

    return null;
  };

  // Setup market data handlers (for proximity calculation only - NO trade execution)
  gatewayClient.on('tick', async (tick) => {
    // Process tick for candle building
    await strategyEngine.processTick(tick);

    // Build candle from tick
    const candle = processTick(tick);
    if (candle) {
      await strategyEngine.processCandle(candle);
    }
  });

  gatewayClient.on('candle:closed', async (data) => {
    await strategyEngine.processCandle(data.candle);
  });

  // IMPORTANT: Do NOT listen to 'signal' events - dashboard does NOT execute trades

  // Create data provider
  const dataProvider = new DashboardDataProvider(strategyEngine, gatewayClient);

  console.log('✅ Dashboard ready. Starting interactive dashboard...\n');
  console.log(`📈 Strategy: RSI + BB Scalping (MONITORING ONLY)`);
  console.log(`🎯 Assets: ${SYMBOLS.join(', ')}`);
  console.log(`\n💡 Note: This dashboard only monitors - it does NOT execute trades.`);
  console.log(`   To execute trades, run: TRADE_MODE=cfd SYMBOL="R_75,R_100" pnpm run trader:rsi-bb\n`);
  console.log('Press Ctrl+C or "q" to quit\n');

  // Render Ink dashboard
  const { waitUntilExit } = render(
    React.createElement(DashboardApp, {
      fetchData: () => dataProvider.fetchAll(),
      updateInterval: 3000,
      compact: false,
    })
  );

  // Wait for exit
  await waitUntilExit();

  // Cleanup
  console.log('\n\n👋 Shutting down dashboard...');
  gatewayClient.disconnect();
  await strategyEngine.stopAll();
  console.log('✅ Dashboard stopped');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
