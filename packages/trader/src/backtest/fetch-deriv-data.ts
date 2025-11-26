/**
 * Fetch Historical Data from Deriv API and convert to BacktestJS CSV format
 *
 * Downloads candle data from Deriv and saves it in a format compatible with BacktestJS
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { writeFile } from 'fs/promises';
import { join } from 'path';

dotenv.config();

/**
 * Configuration
 */
const SYMBOLS = process.env.SYMBOL?.split(',') || ['R_75'];
const TIMEFRAME = 60; // 1 minute
const DAYS = parseInt(process.env.BACKTEST_DAYS || '7', 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || './backtest-data';

/**
 * Convert Deriv candles to BacktestJS CSV format
 */
function candlesToCSV(candles: any[]): string {
  // BacktestJS CSV format: timestamp, open, high, low, close, volume
  const header = 'timestamp,open,high,low,close,volume';
  const rows = candles.map(c => {
    const timestamp = c.timestamp * 1000; // Convert to milliseconds
    return `${timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume || 0}`;
  });

  return [header, ...rows].join('\n');
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('📥 DERIV DATA FETCHER FOR BACKTESTJS');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`  Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`  Days: ${DAYS}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log();

  // Initialize Gateway Client
  const gatewayClient = new GatewayClient({
    url: process.env.GATEWAY_WS_URL || 'ws://localhost:3000',
    autoReconnect: true,
    reconnectInterval: 5000,
    enableLogging: false,
  });

  console.log('🔌 Connecting to Gateway...');
  await gatewayClient.connect();
  console.log('✅ Connected\n');

  // Fetch data for each symbol
  for (const symbol of SYMBOLS) {
    try {
      console.log(`📊 Fetching ${symbol}...`);

      const candlesNeeded = DAYS * 24 * 60; // 1-minute candles
      const candles = await gatewayClient.getCandles(symbol, TIMEFRAME, candlesNeeded);

      if (!candles || candles.length === 0) {
        console.error(`  ❌ No data received for ${symbol}`);
        continue;
      }

      console.log(`  ✅ Fetched ${candles.length} candles`);
      console.log(`  📅 Period: ${new Date(candles[0].timestamp * 1000).toISOString()} to ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()}`);

      // Convert to CSV
      const csv = candlesToCSV(candles);

      // Save to file
      const filename = join(OUTPUT_DIR, `${symbol}_${TIMEFRAME}s_${DAYS}d.csv`);
      await writeFile(filename, csv, 'utf-8');

      console.log(`  💾 Saved to: ${filename}`);
      console.log();

    } catch (error: any) {
      console.error(`  ❌ Error fetching ${symbol}:`, error.message);
      console.log();
    }
  }

  await gatewayClient.disconnect();
  console.log('✅ Data fetch complete');
  console.log();
  console.log('Next steps:');
  console.log('  1. Copy CSV files to your BacktestJS project');
  console.log('  2. Run: npx @backtest/framework');
  console.log('  3. Import CSV files via the UI');
  console.log('  4. Load the BB Squeeze strategy');
  console.log('  5. Run backtest!');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
