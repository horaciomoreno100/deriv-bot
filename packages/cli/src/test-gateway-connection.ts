#!/usr/bin/env node
/**
 * Test script to verify Gateway connection and data flow
 */

import { GatewayClient } from '@deriv-bot/trader';

const GATEWAY_URL = 'ws://localhost:3000';

async function main() {
  console.log('🔍 Testing Gateway connection...\n');

  const client = new GatewayClient({
    url: GATEWAY_URL,
    enableLogging: true
  });

  // Track what events we receive
  const receivedEvents: Record<string, number> = {};

  client.on('connected', () => {
    console.log('✅ Connected to Gateway');
  });

  client.on('disconnected', () => {
    console.log('❌ Disconnected from Gateway');
  });

  client.on('tick', (tick) => {
    receivedEvents['tick'] = (receivedEvents['tick'] || 0) + 1;
    console.log('📈 Tick received:', {
      asset: tick.asset,
      price: tick.price,
      timestamp: new Date(tick.timestamp).toLocaleTimeString(),
    });
  });

  client.on('candle', (candle) => {
    receivedEvents['candle'] = (receivedEvents['candle'] || 0) + 1;
    console.log('🕯️  Candle received:', {
      asset: candle.asset,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      timestamp: new Date(candle.timestamp * 1000).toLocaleTimeString(),
    });
  });

  client.on('indicators', (indicators) => {
    receivedEvents['indicators'] = (receivedEvents['indicators'] || 0) + 1;
    console.log('📊 Indicators received:', {
      asset: indicators.asset,
      rsi: indicators.rsi.toFixed(2),
      bbUpper: indicators.bbUpper.toFixed(2),
      bbMiddle: indicators.bbMiddle.toFixed(2),
      bbLower: indicators.bbLower.toFixed(2),
      atr: indicators.atr.toFixed(2),
      timestamp: new Date(indicators.timestamp).toLocaleTimeString(),
    });
  });

  client.on('balance', (balance) => {
    receivedEvents['balance'] = (receivedEvents['balance'] || 0) + 1;
    console.log('💰 Balance received:', {
      balance: balance.balance,
      currency: balance.currency,
    });
  });

  client.on('signal', (signal) => {
    receivedEvents['signal'] = (receivedEvents['signal'] || 0) + 1;
    console.log('🚨 Signal received:', {
      direction: signal.direction,
      confidence: signal.confidence,
      metadata: signal.metadata,
    });
  });

  client.on('error', (error) => {
    console.error('❌ Error:', error);
  });

  try {
    await client.connect();
    console.log('⏳ Listening for events... (press Ctrl+C to exit)\n');

    // Print summary every 10 seconds
    setInterval(() => {
      console.log('\n📊 Event Summary:');
      Object.entries(receivedEvents).forEach(([event, count]) => {
        console.log(`  - ${event}: ${count}`);
      });
      console.log('');
    }, 10000);

  } catch (error) {
    console.error('❌ Failed to connect:', error);
    process.exit(1);
  }
}

main().catch(console.error);
