#!/usr/bin/env ts-node
/**
 * Manual test for Gateway
 *
 * Tests the complete Gateway functionality by:
 * 1. Starting the Gateway
 * 2. Connecting as a client
 * 3. Testing all commands
 * 4. Verifying events
 */

import WebSocket from 'ws';
import dotenv from 'dotenv';
import { Gateway } from './main.js';
import type { CommandMessage } from './ws/protocol.js';

dotenv.config({ path: '../../.env' });

// Helper to send command
function sendCommand(ws: WebSocket, command: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = Date.now().toString();

    const message: CommandMessage = {
      type: 'command',
      command,
      params,
      requestId,
      timestamp: Date.now(),
    };

    // Listen for response
    const handleMessage = (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());

        if (response.type === 'response' && response.requestId === requestId) {
          ws.off('message', handleMessage);
          if (response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response.error?.message || 'Command failed'));
          }
        }
      } catch (error) {
        // Ignore parse errors (might be events)
      }
    };

    ws.on('message', handleMessage);

    // Send command
    ws.send(JSON.stringify(message));

    // Timeout after 10 seconds
    setTimeout(() => {
      ws.off('message', handleMessage);
      reject(new Error('Command timeout'));
    }, 10000);
  });
}

async function main() {
  console.log('🚀 Starting Gateway test...\n');

  // 1. Start Gateway
  const gateway = new Gateway({
    derivAppId: parseInt(process.env.DERIV_APP_ID || '1089', 10),
    derivApiToken: process.env.DERIV_API_TOKEN || '',
    derivEndpoint: process.env.DERIV_ENDPOINT || 'wss://ws.derivws.com/websockets/v3',
    derivAccount: process.env.DERIV_ACCOUNT || 'current',
    gatewayPort: 3001, // Use different port for testing
    gatewayHost: 'localhost',
    maxTicksPerAsset: 100,
    maxCandlesPerAsset: 50,
    enablePersistence: false,
  });

  try {
    await gateway.start();
    console.log('✅ Gateway started\n');

    // Wait a bit for Gateway to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 2. Connect as client
    console.log('🔌 Connecting as client...');
    const ws = new WebSocket('ws://localhost:3001');

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        console.log('✅ Connected to Gateway\n');
        resolve();
      });
      ws.on('error', reject);
    });

    // Listen for events
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== 'response') {
          console.log(`📨 Event: ${message.type}`, JSON.stringify(message.data, null, 2));
        }
      } catch (error) {
        // Ignore
      }
    });

    // 3. Test ping command
    console.log('📍 Testing ping command...');
    const pingResult = await sendCommand(ws, 'ping');
    console.log('✅ Ping:', pingResult);
    console.log();

    // 4. Test instruments command
    console.log('📊 Testing instruments command...');
    const instruments = await sendCommand(ws, 'instruments');
    console.log(`✅ Instruments: ${instruments.count} symbols available`);
    console.log('   First 5:', instruments.instruments.slice(0, 5).map((s: any) => s.symbol).join(', '));
    console.log();

    // 5. Test balance command
    console.log('💰 Testing balance command...');
    const balance = await sendCommand(ws, 'balance');
    console.log('✅ Balance:', balance);
    console.log();

    // 6. Test follow command
    console.log('👀 Testing follow command (subscribing to R_100)...');
    const followResult = await sendCommand(ws, 'follow', { assets: ['R_100'] });
    console.log('✅ Follow:', followResult);
    console.log();

    // Wait for some ticks
    console.log('⏳ Waiting for ticks and candles (10 seconds)...');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // 7. Test get_ticks command
    console.log('📈 Testing get_ticks command...');
    const ticks = await sendCommand(ws, 'get_ticks', { asset: 'R_100', count: 5 });
    console.log(`✅ Got ${ticks.count} ticks`);
    console.log('   Latest:', ticks.ticks[ticks.ticks.length - 1]);
    console.log();

    // 8. Test get_candles command
    console.log('📊 Testing get_candles command...');
    const candles = await sendCommand(ws, 'get_candles', {
      asset: 'R_100',
      timeframe: 60,
      count: 3,
    });
    console.log(`✅ Got ${candles.count} candles`);
    console.log('   Latest:', candles.candles[candles.candles.length - 1]);
    console.log();

    // 9. Test history command
    console.log('📜 Testing history command...');
    const history = await sendCommand(ws, 'history', {
      asset: 'R_100',
      timeframe: 60,
      count: 5,
      end: 'latest',
    });
    console.log(`✅ Got ${history.count} historical candles`);
    console.log();

    // 10. Test get_assets command
    console.log('📋 Testing get_assets command...');
    const assets = await sendCommand(ws, 'get_assets');
    console.log('✅ Tracked assets:', assets.assets);
    console.log();

    // 11. Test unfollow command
    console.log('👋 Testing unfollow command...');
    const unfollowResult = await sendCommand(ws, 'unfollow', { assets: ['R_100'] });
    console.log('✅ Unfollow:', unfollowResult);
    console.log();

    // Close client
    ws.close();
    console.log('✅ Client disconnected\n');

    // Stop Gateway
    console.log('🛑 Stopping Gateway...');
    await gateway.stop();
    console.log('✅ Gateway stopped\n');

    console.log('✨ All tests passed!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    await gateway.stop();
    process.exit(1);
  }
}

// Run
main();
