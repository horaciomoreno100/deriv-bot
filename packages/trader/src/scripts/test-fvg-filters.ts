#!/usr/bin/env npx tsx
/**
 * Test FVG Liquidity Sweep filter configurations
 */

import { FVGLiquiditySweepBacktestStrategy } from '../backtest/strategies/fvg-liquidity-sweep-backtest.strategy.js';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import * as path from 'path';
import * as fs from 'fs';

const ASSET = process.env.ASSET || 'frxEURUSD';
const DAYS = parseInt(process.env.DAYS || '30');

const dataDir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dataDir);
const dataFile = files.find((f: string) => f.includes(ASSET) && f.includes('1m'));

if (!dataFile) {
  console.log(`No data file found for ${ASSET}`);
  process.exit(1);
}

const filepath = path.join(dataDir, dataFile);

let candles = loadCandlesFromCSV(filepath, {
  asset: ASSET,
  timeframe: 60,
  timestampColumn: 'timestamp',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  timestampFormat: 'unix_ms',
});

// Filter to last N days
const candlesPerDay = 24 * 60;
const maxCandles = DAYS * candlesPerDay;
if (candles.length > maxCandles) {
  candles = candles.slice(-maxCandles);
}

console.log(`\nTesting FVG-LS Filters on ${ASSET} (${DAYS} days, ${candles.length} candles)\n`);

const configs = [
  { name: 'Baseline', params: {} },
  { name: 'Session 7-20', params: { useSessionFilter: true, sessionStartHour: 7, sessionEndHour: 20 } },
  { name: 'Session 8-17', params: { useSessionFilter: true, sessionStartHour: 8, sessionEndHour: 17 } },
  { name: 'RSI div 3', params: { useRsiDivergence: true, minRsiDivergence: 3 } },
  { name: 'RSI div 5', params: { useRsiDivergence: true, minRsiDivergence: 5 } },
  { name: 'RSI div 8', params: { useRsiDivergence: true, minRsiDivergence: 8 } },
  { name: 'Strong rej', params: { requireStrongRejection: true } },
  { name: 'Depth 0.02%', params: { minSweepDepthPct: 0.0002 } },
  { name: 'Depth 0.05%', params: { minSweepDepthPct: 0.0005 } },
  { name: 'Session+RSI3', params: { useSessionFilter: true, sessionStartHour: 7, sessionEndHour: 20, useRsiDivergence: true, minRsiDivergence: 3 } },
  { name: 'Session+Rej', params: { useSessionFilter: true, sessionStartHour: 7, sessionEndHour: 20, requireStrongRejection: true } },
];

console.log('Config              | Trades | WR     | PF    | Net    | DD');
console.log('-'.repeat(65));

for (const cfg of configs) {
  const strategy = new FVGLiquiditySweepBacktestStrategy(ASSET, cfg.params);
  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: 1000,
    stakeMode: 'percentage',
    stakePct: 0.02,
    stakeAmount: 20,
    multiplier: 100,
  }, { runMonteCarlo: false, runOOS: false, verbose: false });

  const { totalTrades, winRate, profitFactor, netPnl, maxDrawdownPct } = result.metrics;
  const pfStr = profitFactor === Infinity ? '  Inf' : profitFactor.toFixed(2).padStart(5);
  console.log(
    `${cfg.name.padEnd(20)}| ${totalTrades.toString().padStart(6)} | ${winRate.toFixed(1).padStart(5)}% | ${pfStr} | $${netPnl.toFixed(0).padStart(5)} | ${maxDrawdownPct.toFixed(1)}%`
  );
}

console.log('\nDone!');
