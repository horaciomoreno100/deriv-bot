/**
 * BB Squeeze Backtest Runner
 *
 * Complete workflow:
 * 1. Fetch data from Deriv
 * 2. Save to CSV
 * 3. Instructions for running BacktestJS
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

dotenv.config();

/**
 * Configuration
 */
const SYMBOLS = process.env.SYMBOL?.split(',') || ['R_75', 'R_100'];
const TIMEFRAME = 60; // 1 minute
const DAYS = parseInt(process.env.BACKTEST_DAYS || '7', 10);
const OUTPUT_DIR = './backtest-data';

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
 * Generate BacktestJS configuration file
 */
function generateConfigFile(symbols: string[]): string {
  return `/**
 * BacktestJS Configuration for BB Squeeze Strategy
 * Generated automatically
 */

module.exports = {
  // Strategy parameters to test
  params: {
    bbPeriod: [15, 20, 25],           // Bollinger Bands period
    bbStdDev: [2, 2.5],                // BB standard deviation
    kcPeriod: [15, 20, 25],            // Keltner Channel period
    kcMultiplier: [1.0, 1.5, 2.0],     // KC ATR multiplier
    takeProfitPct: [0.003, 0.004, 0.005], // 0.3%, 0.4%, 0.5%
    stopLossPct: [0.0015, 0.002, 0.0025], // 0.15%, 0.2%, 0.25%
  },

  // Symbols to test
  symbols: ${JSON.stringify(symbols)},

  // Initial capital
  initialCapital: 10000,

  // Position sizing
  positionSize: 0.02, // 2% risk per trade
};
`;
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 BB SQUEEZE BACKTEST SETUP');
  console.log('='.repeat(80));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Output Directory: ${OUTPUT_DIR}`);
  console.log();

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    console.log(`✅ Created directory: ${OUTPUT_DIR}\n`);
  }

  // Initialize Gateway Client
  const gatewayClient = new GatewayClient({
    url: process.env.GATEWAY_WS_URL || 'ws://localhost:3000',
    autoReconnect: true,
    reconnectInterval: 5000,
    enableLogging: false,
  });

  console.log('🔌 Connecting to Gateway...');
  await gatewayClient.connect();
  console.log('✅ Connected to Gateway\n');

  const fetchedSymbols: string[] = [];

  // Fetch data for each symbol
  for (const symbol of SYMBOLS) {
    try {
      console.log(`📥 Fetching ${symbol}...`);

      const candlesNeeded = DAYS * 24 * 60; // 1-minute candles
      const candles = await gatewayClient.getCandles(symbol, TIMEFRAME, candlesNeeded);

      if (!candles || candles.length === 0) {
        console.error(`   ❌ No data received for ${symbol}`);
        continue;
      }

      console.log(`   ✅ Fetched ${candles.length} candles`);
      console.log(`   📅 From: ${new Date(candles[0].timestamp * 1000).toISOString()}`);
      console.log(`   📅 To:   ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()}`);

      // Convert to CSV
      const csv = candlesToCSV(candles);

      // Save to file
      const filename = join(OUTPUT_DIR, `${symbol}_${TIMEFRAME}s_${DAYS}d.csv`);
      await writeFile(filename, csv, 'utf-8');

      console.log(`   💾 Saved to: ${filename}`);
      console.log();

      fetchedSymbols.push(symbol);

    } catch (error: any) {
      console.error(`   ❌ Error fetching ${symbol}:`, error.message);
      console.log();
    }
  }

  // Generate config file
  const configPath = join(OUTPUT_DIR, 'backtest-config.js');
  const configContent = generateConfigFile(fetchedSymbols);
  await writeFile(configPath, configContent, 'utf-8');
  console.log(`✅ Generated config: ${configPath}\n`);

  // Copy strategy file
  console.log('📋 Strategy file location:');
  console.log(`   src/backtest/bb-squeeze-backtest.ts\n`);

  await gatewayClient.disconnect();

  // Print instructions
  console.log('='.repeat(80));
  console.log('📖 NEXT STEPS - HOW TO RUN BACKTEST');
  console.log('='.repeat(80));
  console.log();
  console.log('Method 1: Using BacktestJS CLI (Recommended)');
  console.log('─'.repeat(80));
  console.log('1. Start BacktestJS UI:');
  console.log('   npx @backtest/framework');
  console.log();
  console.log('2. In the UI:');
  console.log('   a. Import CSV files from:', OUTPUT_DIR);
  console.log('   b. Load strategy: src/backtest/bb-squeeze-backtest.ts');
  console.log('   c. Configure parameters (or use defaults)');
  console.log('   d. Click "Run Backtest"');
  console.log();
  console.log('3. View results:');
  console.log('   - Interactive charts in browser');
  console.log('   - Win rate, ROI, profit factor');
  console.log('   - Trade-by-trade breakdown');
  console.log('   - Equity curve');
  console.log();
  console.log('─'.repeat(80));
  console.log('Method 2: Programmatic (Advanced)');
  console.log('─'.repeat(80));
  console.log('1. Create a custom backtest runner using @backtest/framework API');
  console.log('2. See BacktestJS documentation: https://backtestjs.github.io/framework/');
  console.log();
  console.log('='.repeat(80));
  console.log('📊 STRATEGY PARAMETERS TO OPTIMIZE');
  console.log('='.repeat(80));
  console.log();
  console.log('Default Parameters:');
  console.log('  • bbPeriod: 20 (Bollinger Bands period)');
  console.log('  • bbStdDev: 2 (BB standard deviation)');
  console.log('  • kcPeriod: 20 (Keltner Channel period)');
  console.log('  • kcMultiplier: 1.5 (KC ATR multiplier)');
  console.log('  • takeProfitPct: 0.004 (0.4% TP)');
  console.log('  • stopLossPct: 0.002 (0.2% SL)');
  console.log();
  console.log('Try different combinations to find optimal parameters!');
  console.log();
  console.log('='.repeat(80));
  console.log();
  console.log('✅ Setup complete! You can now run the backtest.');
  console.log();

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
