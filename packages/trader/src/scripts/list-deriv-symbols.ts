#!/usr/bin/env npx tsx
/**
 * List all available Deriv symbols (especially indices)
 * Usage: npx tsx src/scripts/list-deriv-symbols.ts
 */

import WebSocket from 'ws';

const APP_ID = process.env.DERIV_APP_ID || '106646';
const API_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

async function listSymbols() {
  console.log('🔌 Connecting to Deriv API...');
  const ws = new WebSocket(API_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('✅ Connected\n');
  console.log('📥 Fetching all active symbols...\n');

  // Request all active symbols
  ws.send(JSON.stringify({
    active_symbols: 'brief',
    product_type: 'basic'
  }));

  ws.on('message', (data: WebSocket.Data) => {
    const response = JSON.parse(data.toString());

    if (response.error) {
      console.error('❌ Error:', response.error.message);
      process.exit(1);
    }

    if (response.active_symbols) {
      const symbols = response.active_symbols;

      console.log(`Total symbols: ${symbols.length}\n`);

      // Filter for indices containing "GER" or "DAX" or "Germany"
      console.log('🇩🇪 German/DAX indices:');
      console.log('═'.repeat(80));
      const germanSymbols = symbols.filter((s: any) =>
        s.display_name?.toLowerCase().includes('german') ||
        s.display_name?.toLowerCase().includes('dax') ||
        s.display_name?.toLowerCase().includes('ger') ||
        s.symbol?.toLowerCase().includes('ger')
      );

      if (germanSymbols.length > 0) {
        germanSymbols.forEach((s: any) => {
          console.log(`Symbol: ${s.symbol}`);
          console.log(`  Name: ${s.display_name}`);
          console.log(`  Market: ${s.market} | Type: ${s.submarket}`);
          console.log();
        });
      } else {
        console.log('No German indices found\n');
      }

      // Show all indices
      console.log('\n📊 All Stock Indices:');
      console.log('═'.repeat(80));
      const indices = symbols.filter((s: any) =>
        s.market === 'indices' ||
        s.submarket === 'indices'
      );

      if (indices.length > 0) {
        indices.forEach((s: any) => {
          console.log(`${s.symbol.padEnd(20)} | ${s.display_name}`);
        });
      }

      ws.close();
      process.exit(0);
    }
  });

  // Timeout after 10 seconds
  setTimeout(() => {
    console.error('❌ Timeout waiting for response');
    ws.close();
    process.exit(1);
  }, 10000);
}

listSymbols().catch(console.error);
