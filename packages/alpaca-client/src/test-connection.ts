/**
 * Test Alpaca Markets API Connection
 *
 * This script tests the connection to Alpaca and demonstrates how to:
 * 1. Connect and authenticate
 * 2. Get account info
 * 3. Get historical bars with REAL volume
 * 4. Subscribe to real-time crypto data
 *
 * Required environment variables:
 * - ALPACA_API_KEY: Your Alpaca API key
 * - ALPACA_SECRET_KEY: Your Alpaca secret key
 * - ALPACA_PAPER: 'true' or 'false' (default: true)
 */

import { AlpacaClient } from './alpaca-client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           Alpaca Markets API Connection Test');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Check environment variables
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const paper = process.env.ALPACA_PAPER !== 'false';

  if (!apiKey || !secretKey) {
    console.log('❌ Missing required environment variables:');
    console.log();
    console.log('Required:');
    console.log('  ALPACA_API_KEY    - Your Alpaca API key');
    console.log('  ALPACA_SECRET_KEY - Your Alpaca secret key');
    console.log();
    console.log('Optional:');
    console.log('  ALPACA_PAPER      - "true" or "false" (default: true)');
    console.log();
    console.log('To get these credentials:');
    console.log('1. Go to https://app.alpaca.markets/');
    console.log('2. Sign up or log in');
    console.log('3. Go to Paper Trading (or Live)');
    console.log('4. Click on "API Keys" in the sidebar');
    console.log('5. Generate new keys');
    console.log();
    process.exit(1);
  }

  console.log(`Environment: ${paper ? 'PAPER TRADING' : 'LIVE TRADING'}`);
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);
  console.log();

  // Create client
  const client = new AlpacaClient({
    keyId: apiKey,
    secretKey: secretKey,
    paper,
  });

  try {
    // Get account info
    console.log('📊 Getting account info...');
    const account = await client.getAccount();
    console.log(`   Account ID: ${account.id}`);
    console.log(`   Status: ${account.status}`);
    console.log(`   Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`);
    console.log(`   Portfolio Value: $${parseFloat(account.portfolio_value).toFixed(2)}`);
    console.log();

    // Get historical stock bars (AAPL)
    console.log('📈 Getting AAPL stock bars (1 day timeframe)...');
    const stockBars = await client.getStockBars('AAPL', '1Day', {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
      limit: 10,
    });
    console.log(`   Found ${stockBars.length} bars`);
    stockBars.slice(0, 5).forEach((bar) => {
      console.log(
        `   ${bar.timestamp.toISOString().split('T')[0]}: ` +
          `O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} ` +
          `L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)} ` +
          `Vol=${bar.volume.toLocaleString()} VWAP=${bar.vwap?.toFixed(2) || 'N/A'}`
      );
    });
    console.log();

    // Get historical crypto bars (BTC/USD)
    console.log('🪙 Getting BTC/USD crypto bars (1 hour timeframe)...');
    const cryptoBars = await client.getCryptoBars('BTC/USD', '1Hour', {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days
      limit: 10,
    });
    console.log(`   Found ${cryptoBars.length} bars`);
    cryptoBars.slice(0, 5).forEach((bar) => {
      console.log(
        `   ${bar.timestamp.toISOString()}: ` +
          `O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} ` +
          `L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)} ` +
          `Vol=${bar.volume.toFixed(4)} VWAP=${bar.vwap?.toFixed(2) || 'N/A'}`
      );
    });
    console.log();

    // Subscribe to real-time crypto data
    console.log('🔴 Subscribing to real-time BTC/USD data...');
    let tradeCount = 0;
    let quoteCount = 0;

    client.subscribeCrypto(['BTC/USD'], {
      onTrade: (trade) => {
        tradeCount++;
        if (tradeCount <= 5) {
          console.log(
            `   TRADE: ${trade.symbol} @ $${trade.price.toFixed(2)} ` +
              `Size=${trade.size.toFixed(6)} Exchange=${trade.exchange}`
          );
        } else if (tradeCount === 6) {
          console.log('   ... (showing first 5 trades)');
        }
      },
      onQuote: (quote) => {
        quoteCount++;
        if (quoteCount <= 3) {
          console.log(
            `   QUOTE: ${quote.symbol} Bid=$${quote.bidPrice.toFixed(2)} ` +
              `Ask=$${quote.askPrice.toFixed(2)} Spread=$${(quote.askPrice - quote.bidPrice).toFixed(2)}`
          );
        } else if (quoteCount === 4) {
          console.log('   ... (showing first 3 quotes)');
        }
      },
    });

    // Wait for some data
    console.log();
    console.log('⏳ Waiting 15 seconds for real-time data...');
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Summary
    console.log();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                          Summary');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   Stock bars retrieved: ${stockBars.length} (with REAL volume)`);
    console.log(`   Crypto bars retrieved: ${cryptoBars.length} (with REAL volume)`);
    console.log(`   Real-time trades received: ${tradeCount}`);
    console.log(`   Real-time quotes received: ${quoteCount}`);
    console.log();

    if (stockBars.length > 0 && cryptoBars.length > 0) {
      console.log('✅ SUCCESS! Alpaca connection working with REAL volume data.');
      console.log('   You can use this for volume-based analysis and trading.');
    } else {
      console.log('⚠️  Partial success. Check API permissions.');
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
