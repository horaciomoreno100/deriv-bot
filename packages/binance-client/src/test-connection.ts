/**
 * Test Binance API Connection
 *
 * This script tests the connection to Binance and demonstrates:
 * 1. Getting historical klines with REAL volume
 * 2. Getting order book (DOM)
 * 3. Subscribing to real-time data
 *
 * NO API KEY REQUIRED for this test (public data only)
 */

import { BinanceClient } from './binance-client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           Binance API Connection Test (NO API KEY NEEDED)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Create client without API key (public data only)
  const client = new BinanceClient();

  try {
    // Get current BTC price
    console.log('💰 Getting BTC/USDT price...');
    const price = await client.getPrice('BTCUSDT');
    console.log(`   Current price: $${price.toLocaleString()}`);
    console.log();

    // Get 24h stats
    console.log('📊 Getting 24h statistics...');
    const ticker = await client.get24hTicker('BTCUSDT');
    console.log(`   Symbol: ${ticker.symbol}`);
    console.log(`   Price Change: ${ticker.priceChangePercent.toFixed(2)}%`);
    console.log(`   Volume: ${ticker.volume.toLocaleString()} BTC`);
    console.log(`   Quote Volume: $${(ticker.quoteVolume / 1_000_000).toFixed(2)}M USDT`);
    console.log(`   Number of Trades: ${ticker.trades.toLocaleString()}`);
    console.log();

    // Get historical klines with volume
    console.log('📈 Getting historical klines (1h timeframe, last 24 bars)...');
    const klines = await client.getSpotKlines('BTCUSDT', '1h', { limit: 24 });
    console.log(`   Retrieved ${klines.length} bars with REAL volume:`);
    console.log();
    console.log('   Time                  | Open      | High      | Low       | Close     | Volume BTC  | Trades');
    console.log('   ' + '-'.repeat(100));

    klines.slice(-10).forEach((bar) => {
      const time = bar.timestamp.toISOString().replace('T', ' ').substring(0, 16);
      console.log(
        `   ${time} | ` +
          `${bar.open.toFixed(2).padStart(9)} | ` +
          `${bar.high.toFixed(2).padStart(9)} | ` +
          `${bar.low.toFixed(2).padStart(9)} | ` +
          `${bar.close.toFixed(2).padStart(9)} | ` +
          `${bar.volume.toFixed(2).padStart(11)} | ` +
          `${bar.trades.toLocaleString().padStart(6)}`
      );
    });
    console.log();

    // Get order book (DOM)
    console.log('📖 Getting Order Book (top 10 levels)...');
    const book = await client.getOrderBook('BTCUSDT', 10);
    console.log();
    console.log('   ASKS (Sell Orders)           | BIDS (Buy Orders)');
    console.log('   Price      | Quantity        | Price      | Quantity');
    console.log('   ' + '-'.repeat(60));

    for (let i = 9; i >= 0; i--) {
      const ask = book.asks[i];
      const bid = book.bids[i];
      console.log(
        `   $${ask.price.toFixed(2).padStart(9)} | ${ask.quantity.toFixed(4).padStart(14)} | ` +
          `$${bid.price.toFixed(2).padStart(9)} | ${bid.quantity.toFixed(4).padStart(14)}`
      );
    }
    console.log();

    // Get recent trades
    console.log('🔄 Getting recent trades...');
    const trades = await client.getRecentTrades('BTCUSDT', 10);
    console.log(`   Last ${trades.length} trades:`);
    trades.forEach((t) => {
      const side = t.isBuyerMaker ? 'SELL' : 'BUY ';
      const time = t.time.toISOString().substring(11, 19);
      console.log(
        `   ${time} | ${side} | $${t.price.toFixed(2)} | ${t.quantity.toFixed(6)} BTC | $${t.quoteQuantity.toFixed(2)}`
      );
    });
    console.log();

    // Subscribe to real-time klines
    console.log('🔴 Subscribing to real-time klines (1m)...');
    let klineCount = 0;

    client.subscribeKlines('BTCUSDT', '1m', (bar) => {
      klineCount++;
      if (klineCount <= 5) {
        console.log(
          `   KLINE: ${bar.timestamp.toISOString().substring(11, 19)} | ` +
            `C=$${bar.close.toFixed(2)} | Vol=${bar.volume.toFixed(4)} | Trades=${bar.trades}`
        );
      }
    });

    // Subscribe to real-time trades
    console.log('🔴 Subscribing to real-time trades...');
    let tradeCount = 0;

    client.subscribeTrades('BTCUSDT', (trade) => {
      tradeCount++;
      if (tradeCount <= 10) {
        const side = trade.isBuyerMaker ? 'SELL' : 'BUY ';
        console.log(
          `   TRADE: ${side} $${trade.price.toFixed(2)} | ${trade.quantity.toFixed(6)} BTC`
        );
      } else if (tradeCount === 11) {
        console.log('   ... (showing first 10 trades)');
      }
    });

    // Wait for real-time data
    console.log();
    console.log('⏳ Waiting 15 seconds for real-time data...');
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Summary
    console.log();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                          Summary');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   Historical bars retrieved: ${klines.length} (with REAL volume)`);
    console.log(`   Order book levels: ${book.bids.length} bids, ${book.asks.length} asks`);
    console.log(`   Real-time kline updates: ${klineCount}`);
    console.log(`   Real-time trades: ${tradeCount}`);
    console.log();
    console.log('✅ SUCCESS! Binance connection working with REAL volume data.');
    console.log('   No API key was required for this public data.');
    console.log();

    // Disconnect
    console.log('📴 Disconnecting...');
    client.disconnect();
    console.log('✅ Done!\n');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    client.disconnect();
    process.exit(1);
  }
}

main().catch(console.error);
