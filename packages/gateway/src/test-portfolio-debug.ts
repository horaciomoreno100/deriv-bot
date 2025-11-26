/**
 * Test Portfolio Debug
 *
 * Direct test to debug why getPortfolio() returns 0 positions
 */

import { DerivClient } from './api/deriv-client.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testPortfolio() {
  console.log('🔍 Testing Portfolio Debug...\n');

  const client = new DerivClient({
    appId: parseInt(process.env.DERIV_APP_ID || '67287'),
    apiToken: process.env.DERIV_API_TOKEN || '',
    endpoint: 'wss://ws.derivws.com/websockets/v3',
  });

  try {
    console.log('📡 Connecting to Deriv API...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('💰 Getting balance...');
    const balance = await client.getBalance();
    console.log(`   Balance: $${balance.amount} ${balance.currency}`);
    console.log(`   Account: ${balance.loginid} (${balance.accountType})\n`);

    console.log('📋 Getting portfolio (account: current)...');
    const positions1 = await client.getPortfolio('current');
    console.log(`   ✅ Portfolio returned: ${positions1.length} position(s)\n`);

    if (positions1.length > 0) {
      positions1.forEach((pos, i) => {
        console.log(`   Position ${i + 1}:`);
        console.log(`      Contract ID: ${pos.contractId}`);
        console.log(`      Symbol: ${pos.symbol}`);
        console.log(`      Type: ${pos.contractType}`);
        console.log(`      Buy Price: ${pos.buyPrice}`);
        console.log(`      Current Price: ${pos.currentPrice}`);
        console.log(`      Profit: $${pos.profit.toFixed(2)} (${pos.profitPercentage.toFixed(2)}%)`);
        console.log(`      Status: ${pos.status}`);
        console.log(`      Sold: ${pos.isSold}`);
        console.log(`      Multiplier: ${pos.multiplier}`);
        console.log(`      TP: ${pos.takeProfit}`);
        console.log(`      SL: ${pos.stopLoss}\n`);
      });
    } else {
      console.log('   ⚠️  No open positions found\n');
    }

    console.log('📋 Getting portfolio (no account param)...');
    const positions2 = await client.getPortfolio();
    console.log(`   ✅ Portfolio returned: ${positions2.length} position(s)\n`);

    console.log('🔌 Disconnecting...');
    client.disconnect();
    console.log('✅ Test complete');

  } catch (error) {
    console.error('❌ Error:', error);
    client.disconnect();
    process.exit(1);
  }
}

testPortfolio();
