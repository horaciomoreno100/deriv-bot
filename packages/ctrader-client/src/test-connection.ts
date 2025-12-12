/**
 * Test cTrader Open API Connection
 *
 * This script tests the connection to cTrader Open API and
 * demonstrates how to:
 * 1. Connect and authenticate
 * 2. Get available symbols
 * 3. Subscribe to spot prices
 * 4. Subscribe to Depth of Market (DOM)
 *
 * Required environment variables:
 * - CTRADER_CLIENT_ID: Your cTrader Open API client ID
 * - CTRADER_CLIENT_SECRET: Your cTrader Open API client secret
 * - CTRADER_ACCESS_TOKEN: OAuth access token
 * - CTRADER_ENV: 'demo' or 'live' (default: demo)
 */

import { CTraderClient } from './ctrader-client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           cTrader Open API Connection Test');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Check environment variables
  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;
  const accessToken = process.env.CTRADER_ACCESS_TOKEN;
  const environment = (process.env.CTRADER_ENV || 'demo') as 'demo' | 'live';

  if (!clientId || !clientSecret || !accessToken) {
    console.log('❌ Missing required environment variables:');
    console.log();
    console.log('Required:');
    console.log('  CTRADER_CLIENT_ID     - Your cTrader Open API client ID');
    console.log('  CTRADER_CLIENT_SECRET - Your cTrader Open API client secret');
    console.log('  CTRADER_ACCESS_TOKEN  - OAuth access token');
    console.log();
    console.log('Optional:');
    console.log('  CTRADER_ENV           - "demo" or "live" (default: demo)');
    console.log();
    console.log('To get these credentials:');
    console.log('1. Go to https://openapi.ctrader.com/');
    console.log('2. Sign in with your cTrader ID (cTID)');
    console.log('3. Create a new application');
    console.log('4. Use the Playground to get an access token');
    console.log();
    process.exit(1);
  }

  console.log(`Environment: ${environment.toUpperCase()}`);
  console.log(`Client ID: ${clientId.substring(0, 8)}...`);
  console.log();

  // Create client
  const client = new CTraderClient({
    clientId,
    clientSecret,
    accessToken,
    environment,
  });

  try {
    // Connect
    console.log('📡 Connecting to cTrader Open API...');
    await client.connect();
    console.log('✅ Connected and authenticated!\n');

    // Get symbols
    console.log('📊 Getting available symbols...');
    const symbols = await client.getSymbols();
    console.log(`   Found ${symbols.length} symbols\n`);

    // Find EURUSD
    const eurusd = symbols.find(
      (s) => s.symbolName.includes('EURUSD') || s.symbolName.includes('EUR/USD')
    );

    if (!eurusd) {
      console.log('   EURUSD not found. Available symbols:');
      symbols.slice(0, 20).forEach((s) => {
        console.log(`     - ${s.symbolName} (ID: ${s.symbolId})`);
      });
      client.disconnect();
      return;
    }

    console.log(`   Using: ${eurusd.symbolName} (ID: ${eurusd.symbolId})\n`);

    // Subscribe to spot prices
    console.log('📈 Subscribing to spot prices...');
    let spotCount = 0;
    await client.subscribeSpots([eurusd.symbolId], (event) => {
      spotCount++;
      if (spotCount <= 5) {
        console.log(
          `   SPOT: Bid=${event.bid.toFixed(5)} Ask=${event.ask.toFixed(5)} ` +
            `Spread=${((event.ask - event.bid) * 10000).toFixed(1)} pips`
        );
      } else if (spotCount === 6) {
        console.log('   ... (showing first 5 spot events)');
      }
    });
    console.log('✅ Subscribed to spot prices\n');

    // Subscribe to Depth of Market
    console.log('📊 Subscribing to Depth of Market (DOM)...');
    let depthCount = 0;
    await client.subscribeDepth([eurusd.symbolId], (event) => {
      depthCount++;
      if (depthCount <= 3) {
        console.log(`   DOM Event #${depthCount}:`);
        console.log(`     New quotes: ${event.newQuotes.length}`);
        event.newQuotes.slice(0, 3).forEach((q) => {
          console.log(
            `       ID=${q.id} Price=${q.price.toFixed(5)} Size=${q.size.toFixed(2)}`
          );
        });
        console.log(`     Deleted quotes: ${event.deletedQuoteIds.length}`);
      } else if (depthCount === 4) {
        console.log('   ... (showing first 3 depth events)');
      }
    });
    console.log('✅ Subscribed to DOM\n');

    // Wait for some data
    console.log('⏳ Waiting 10 seconds for market data...\n');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Summary
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                          Summary');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   Spot events received: ${spotCount}`);
    console.log(`   Depth events received: ${depthCount}`);
    console.log();

    if (spotCount > 0 && depthCount > 0) {
      console.log('✅ SUCCESS! cTrader connection working with DOM data.');
      console.log('   You can use this for real volume/depth analysis.');
    } else if (spotCount > 0) {
      console.log('⚠️  Spot data received but no DOM data.');
      console.log('   DOM might not be available for this symbol/account.');
    } else {
      console.log('❌ No market data received. Check your credentials.');
    }

    // Disconnect
    console.log('\n📴 Disconnecting...');
    client.disconnect();
    console.log('✅ Done!\n');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    client.disconnect();
    process.exit(1);
  }
}

main().catch(console.error);
