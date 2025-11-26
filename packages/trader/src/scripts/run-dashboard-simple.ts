#!/usr/bin/env node
/**
 * Trading Dashboard - Simple Consumer (No Strategy Engine)
 *
 * This dashboard is a pure consumer that only reads from the Gateway.
 * It does NOT:
 * - Run strategies
 * - Calculate indicators
 * - Generate signals
 * - Execute trades
 *
 * Usage:
 *   pnpm run dashboard
 *   or
 *   tsx src/scripts/run-dashboard-simple.ts
 */

import dotenv from 'dotenv';
import React from 'react';
import { render } from 'ink';
import { GatewayClient } from '@deriv-bot/shared';
import { DashboardApp } from '../dashboard/DashboardApp.js';
import { SimpleDashboardDataProvider } from '../dashboard/dashboard-data-provider-simple.js';

// Load environment variables
dotenv.config();

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOLS = (process.env.SYMBOL || 'R_75').split(',').map(s => s.trim());

async function main() {
  console.log('🚀 Starting Trading Dashboard (Consumer Mode)...\n');

  // Initialize Gateway Client (read-only)
  const gatewayClient = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: true,
    enableLogging: false,
  });

  // Connect to Gateway
  console.log(`📡 Connecting to Gateway at ${GATEWAY_URL}...`);
  await gatewayClient.connect();
  console.log('✅ Connected to Gateway\n');

  // Subscribe to assets (for price updates)
  console.log(`📊 Subscribing to assets: ${SYMBOLS.join(', ')}...`);
  await gatewayClient.follow(SYMBOLS);
  console.log('✅ Subscribed to assets\n');

  // Create data provider (NO StrategyEngine - pure consumer)
  const dataProvider = new SimpleDashboardDataProvider(gatewayClient);

  console.log('✅ Dashboard ready. Starting interactive dashboard...\n');
  console.log(`🎯 Monitoring Assets: ${SYMBOLS.join(', ')}`);
  console.log(`\n💡 This is a CONSUMER dashboard - it only reads from Gateway.`);
  console.log(`   To run strategies and execute trades, start the trader separately:\n`);
  console.log(`   TRADE_MODE=cfd SYMBOL="R_75,R_100" pnpm run trader:rsi-bb\n`);
  console.log('Press Ctrl+C or "q" to quit\n');

  // Store latest prices from tick stream
  const latestPrices = new Map<string, number>();

  gatewayClient.on('tick', (tick) => {
    latestPrices.set(tick.asset, tick.price);
  });

  // Render Ink dashboard
  const { waitUntilExit } = render(
    React.createElement(DashboardApp, {
      fetchData: async () => {
        const data = await dataProvider.fetchAll();

        // Enhance assets with latest tick prices
        data.assets = data.assets.map(asset => ({
          ...asset,
          price: latestPrices.get(asset.symbol) || asset.price,
        }));

        return data;
      },
      updateInterval: 3000,
      compact: false,
    })
  );

  // Wait for exit
  await waitUntilExit();

  // Cleanup
  console.log('\n\n👋 Shutting down dashboard...');
  gatewayClient.disconnect();
  console.log('✅ Dashboard stopped');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
