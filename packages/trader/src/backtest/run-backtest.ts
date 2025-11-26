/**
 * BB Squeeze Backtest Runner using BacktestJS API
 *
 * Executes backtest programmatically and displays results
 */

import { runStrategy } from '@backtest/framework';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Configuration
 */
const BACKTEST_DIR = './backtest-data';
const SYMBOLS = ['R_75', 'R_100'];
const STARTING_AMOUNT = 10000;

/**
 * Load CSV data manually
 */
function loadCSVData(filepath: string): any[] {
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.split('\n').filter(line => line.trim() !== '');
  const header = lines[0];
  const rows = lines.slice(1);

  return rows.map(row => {
    const [timestamp, open, high, low, close, volume] = row.split(',');
    return {
      timestamp: parseInt(timestamp, 10),
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume) || 0,
    };
  });
}

/**
 * Print results beautifully
 */
function printResults(result: any, symbol: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 BACKTEST RESULTS - ${symbol}`);
  console.log('='.repeat(80));

  if (result.error) {
    console.error(`❌ Error: ${result.error}`);
    return;
  }

  const stats = result.stats || {};

  console.log(`\n📈 Performance Metrics:`);
  console.log(`   Starting Balance:  $${STARTING_AMOUNT.toFixed(2)}`);
  console.log(`   Ending Balance:    $${(stats.endingBalance || STARTING_AMOUNT).toFixed(2)}`);
  console.log(`   Net Profit:        $${((stats.endingBalance || STARTING_AMOUNT) - STARTING_AMOUNT).toFixed(2)}`);
  console.log(`   ROI:               ${(((stats.endingBalance || STARTING_AMOUNT) - STARTING_AMOUNT) / STARTING_AMOUNT * 100).toFixed(2)}%`);

  console.log(`\n💼 Trade Statistics:`);
  console.log(`   Total Trades:      ${stats.totalTrades || 0}`);
  console.log(`   Winning Trades:    ${stats.winningTrades || 0}`);
  console.log(`   Losing Trades:     ${stats.losingTrades || 0}`);
  console.log(`   Win Rate:          ${stats.winRate ? (stats.winRate * 100).toFixed(2) : '0.00'}%`);

  console.log(`\n💰 Profit Analysis:`);
  console.log(`   Total Profit:      $${(stats.totalProfit || 0).toFixed(2)}`);
  console.log(`   Total Loss:        $${(stats.totalLoss || 0).toFixed(2)}`);
  console.log(`   Profit Factor:     ${stats.profitFactor ? stats.profitFactor.toFixed(2) : 'N/A'}`);
  console.log(`   Avg Win:           $${(stats.avgWin || 0).toFixed(2)}`);
  console.log(`   Avg Loss:          $${(stats.avgLoss || 0).toFixed(2)}`);

  console.log(`\n📉 Risk Metrics:`);
  console.log(`   Max Drawdown:      ${stats.maxDrawdown ? (stats.maxDrawdown * 100).toFixed(2) : '0.00'}%`);
  console.log(`   Sharpe Ratio:      ${stats.sharpeRatio ? stats.sharpeRatio.toFixed(2) : 'N/A'}`);

  console.log(`\n${'='.repeat(80)}\n`);
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 RUNNING BB SQUEEZE BACKTEST');
  console.log('='.repeat(80));
  console.log();

  // Check if data files exist
  const missingFiles: string[] = [];
  for (const symbol of SYMBOLS) {
    const filepath = join(BACKTEST_DIR, `${symbol}_60s_14d.csv`);
    if (!existsSync(filepath)) {
      missingFiles.push(filepath);
    }
  }

  if (missingFiles.length > 0) {
    console.error('❌ Data files not found:');
    missingFiles.forEach(f => console.error(`   - ${f}`));
    console.error('\nRun this first:');
    console.error('   SYMBOL="R_75,R_100" BACKTEST_DAYS=14 pnpm --filter @deriv-bot/trader backtest:squeeze');
    process.exit(1);
  }

  // Run backtest for each symbol
  for (const symbol of SYMBOLS) {
    try {
      console.log(`\n📊 Testing ${symbol}...`);

      const filepath = join(BACKTEST_DIR, `${symbol}_60s_14d.csv`);
      console.log(`   Loading data from: ${filepath}`);

      const data = loadCSVData(filepath);
      console.log(`   ✅ Loaded ${data.length} candles`);
      console.log(`   📅 Period: ${new Date(data[0].timestamp).toISOString()} to ${new Date(data[data.length - 1].timestamp).toISOString()}`);

      console.log(`\n   🔄 Running backtest...`);

      // Run strategy using BacktestJS
      const result = await runStrategy({
        strategyName: 'bb-squeeze-backtest',
        historicalData: [data],
        params: {
          bbPeriod: 20,
          bbStdDev: 2,
          kcPeriod: 20,
          kcMultiplier: 1.5,
          takeProfitPct: 0.004,
          stopLossPct: 0.002,
        },
        startingAmount: STARTING_AMOUNT,
      });

      printResults(result, symbol);

    } catch (error: any) {
      console.error(`\n❌ Error testing ${symbol}:`, error.message);
      console.error(error.stack);
    }
  }

  console.log('✅ Backtest complete!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
