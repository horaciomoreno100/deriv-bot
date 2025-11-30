#!/usr/bin/env npx tsx
/**
 * Backtest Script with ML Data Collection
 *
 * This script runs a backtest of the Hybrid-MTF strategy and collects
 * training data for machine learning models.
 *
 * USAGE:
 *   ASSET="R_100" DAYS="90" npx tsx src/scripts/backtest-hybrid-ml-collect.ts
 *
 * OUTPUT:
 *   - Console: Backtest metrics
 *   - CSV: analysis-output/ml_training_<ASSET>_<TIMESTAMP>.csv
 *   - JSON (optional): analysis-output/ml_training_<ASSET>_<TIMESTAMP>.json
 *
 * ENVIRONMENT VARIABLES:
 *   - ASSET: Trading asset (default: R_100)
 *   - DAYS: Historical data days (default: 90)
 *   - MULT: Multiplier (default: 200)
 *   - STAKE_PCT: Stake percentage (default: 0.02)
 *   - EXPORT_JSON: Set to "true" to also export JSON (default: false)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHybridMTFMLStrategy } from '../backtest/strategies/hybrid-mtf-backtest-ml.strategy.js';
import {
  executeTrade,
  calculateMetrics,
  createTradeEntry,
  formatMetrics,
  type Trade,
  type BacktestConfig,
} from '../backtest/backtest-engine.js';
import type { Candle } from '@deriv-bot/shared';

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSET = process.env.ASSET || 'R_100';
const DAYS = parseInt(process.env.DAYS || '90', 10);
const MULTIPLIER = parseInt(process.env.MULT || '200', 10);
const STAKE_PCT = parseFloat(process.env.STAKE_PCT || '0.02');
const EXPORT_JSON = process.env.EXPORT_JSON === 'true';

const config: BacktestConfig = {
  initialBalance: 1000,
  stakeAmount: 20,
  stakePct: STAKE_PCT,
  multiplier: MULTIPLIER,
  takeProfitPct: 0.008,
  stopLossPct: 0.005,
  maxBarsInTrade: 30,
  cooldownBars: 5,
  useTrailingStop: false,
};

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadCandles(asset: string, days: number): Promise<Candle[]> {
  // Try to find existing data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${asset}_1m_${days}d.csv`,
    `${asset}_60s_${days}d.csv`,
    `${asset}_1m_90d.csv`,
    `${asset}_60s_90d.csv`,
  ];

  let dataFile: string | null = null;
  for (const file of possibleFiles) {
    const filepath = path.join(dataDir, file);
    if (fs.existsSync(filepath)) {
      dataFile = filepath;
      break;
    }
  }

  if (!dataFile) {
    console.error(`No data file found for ${asset}. Please run data fetch first.`);
    console.error('Example: SYMBOLS="${asset}" DAYS=${days} npx tsx src/scripts/fetch-historical-data.ts');
    process.exit(1);
  }

  console.log(`Loading data from: ${dataFile}`);

  const content = fs.readFileSync(dataFile, 'utf-8');
  const lines = content.trim().split('\n');

  // Skip header
  const candles: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const parts = line.split(',');

    if (parts.length < 5) continue;

    // Support different CSV formats
    // Format 1: timestamp,open,high,low,close
    // Format 2: datetime,timestamp,open,high,low,close
    let timestamp: number;
    let open: number;
    let high: number;
    let low: number;
    let close: number;

    if (parts.length === 5) {
      timestamp = parseInt(parts[0]!, 10);
      open = parseFloat(parts[1]!);
      high = parseFloat(parts[2]!);
      low = parseFloat(parts[3]!);
      close = parseFloat(parts[4]!);
    } else if (parts.length >= 6) {
      // Try both formats
      const maybeTimestamp = parseInt(parts[1]!, 10);
      if (!isNaN(maybeTimestamp) && maybeTimestamp > 1000000000) {
        timestamp = maybeTimestamp;
        open = parseFloat(parts[2]!);
        high = parseFloat(parts[3]!);
        low = parseFloat(parts[4]!);
        close = parseFloat(parts[5]!);
      } else {
        timestamp = parseInt(parts[0]!, 10);
        open = parseFloat(parts[1]!);
        high = parseFloat(parts[2]!);
        low = parseFloat(parts[3]!);
        close = parseFloat(parts[4]!);
      }
    } else {
      continue;
    }

    if (isNaN(timestamp) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      continue;
    }

    // Convert milliseconds to seconds if needed
    // Unix timestamps in seconds are ~10 digits, in milliseconds ~13 digits
    if (timestamp > 1e12) {
      timestamp = Math.floor(timestamp / 1000);
    }

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      asset,
      timeframe: 60,
    });
  }

  // Sort by timestamp
  candles.sort((a, b) => a.timestamp - b.timestamp);

  return candles;
}

// =============================================================================
// MAIN BACKTEST LOOP
// =============================================================================

async function runBacktest(): Promise<void> {
  console.log('═'.repeat(60));
  console.log(`BACKTEST WITH ML DATA COLLECTION`);
  console.log('═'.repeat(60));
  console.log(`Asset: ${ASSET}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Multiplier: ${MULTIPLIER}x`);
  console.log(`Stake: ${STAKE_PCT * 100}% of capital`);
  console.log('─'.repeat(60));

  // Load candles
  const candles = await loadCandles(ASSET, DAYS);
  console.log(`Loaded ${candles.length} candles`);

  // Initialize strategy with ML collection
  const strategy = createHybridMTFMLStrategy(ASSET);

  // Pre-calculate MTF data
  strategy.preCalculate(candles);

  // Get strategy's default config
  const strategyConfig = strategy.getDefaultConfig();
  const finalConfig = { ...config, ...strategyConfig };

  // Backtest state
  const trades: Trade[] = [];
  let lastTradeEndIndex = 0;

  console.log('\nRunning backtest...');

  // Main loop
  for (let i = 0; i < candles.length; i++) {
    // Check cooldown
    if (i < lastTradeEndIndex + finalConfig.cooldownBars) {
      continue;
    }

    // Check for entry signal
    const signal = strategy.checkEntry(candles, {}, i);

    if (signal) {
      // Create trade entry
      const entry = createTradeEntry(
        signal.timestamp,
        signal.direction,
        signal.price,
        finalConfig
      );

      // Get candles after entry for trade simulation
      const futureCandles = candles.slice(i + 1);

      if (futureCandles.length === 0) {
        // No future candles, skip this trade
        continue;
      }

      // Execute trade
      const trade = executeTrade(entry, futureCandles, finalConfig);

      if (trade) {
        trades.push(trade);

        // Report outcome to ML collector
        strategy.reportTradeOutcome({
          exitReason: trade.exitReason,
          pnl: trade.pnl,
          barsHeld: trade.barsHeld,
        });

        // Update cooldown
        lastTradeEndIndex = i + trade.barsHeld;

        // Progress logging (every 100 trades)
        if (trades.length % 100 === 0) {
          console.log(`  ${trades.length} trades executed...`);
        }
      }
    }
  }

  // Calculate metrics
  const metrics = calculateMetrics(trades, finalConfig);

  // Print results
  console.log('\n' + '═'.repeat(60));
  console.log('BACKTEST RESULTS');
  console.log('═'.repeat(60));
  console.log(formatMetrics(metrics));

  // Print ML data stats
  const dataCollector = strategy.getDataCollector();
  const mlStats = dataCollector.getStats();

  console.log('\n' + '─'.repeat(60));
  console.log('ML DATA COLLECTION STATS');
  console.log('─'.repeat(60));
  console.log(`Total Entries Captured: ${mlStats.total}`);
  console.log(`Completed (with outcome): ${mlStats.completed}`);
  console.log(`Incomplete (open at end): ${mlStats.incomplete}`);
  console.log(`Wins: ${mlStats.wins} | Losses: ${mlStats.losses}`);
  console.log(`Win Rate: ${mlStats.winRate.toFixed(1)}%`);

  // Export ML data
  console.log('\n' + '─'.repeat(60));
  console.log('EXPORTING ML DATA');
  console.log('─'.repeat(60));

  const csvPath = strategy.exportMLData();
  if (csvPath) {
    console.log(`CSV exported to: ${csvPath}`);
  }

  if (EXPORT_JSON) {
    const jsonPath = strategy.exportMLDataJSON();
    if (jsonPath) {
      console.log(`JSON exported to: ${jsonPath}`);
    }
  }

  // Print sample of collected features
  const sampleData = dataCollector.getCompletedData().slice(0, 3);
  if (sampleData.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('SAMPLE FEATURE ROW (first trade)');
    console.log('─'.repeat(60));

    const sample = sampleData[0]!;
    const keyFeatures = [
      'tradeId',
      'datetime',
      'direction',
      'regime',
      'strategyType',
      'rsi1m',
      'rsi5m',
      'bbWidth',
      'pricePositionInBB',
      'rsiDelta1m',
      'distToSma15m',
      'confidence',
      'target',
      'exitReason',
      'pnl',
    ];

    for (const key of keyFeatures) {
      const value = sample[key as keyof typeof sample];
      console.log(`  ${key}: ${value !== null ? value : 'null'}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('DONE');
  console.log('═'.repeat(60));
}

// =============================================================================
// RUN
// =============================================================================

runBacktest().catch(console.error);
