/**
 * Test Hybrid-MTF Improvements One by One
 *
 * Based on loss analysis:
 * 1. Reduce TP from 0.8% to 0.6%
 * 2. Reduce TP from 0.8% to 0.5%
 * 3. Tighter SL from 0.5% to 0.4%
 * 4. Both: TP 0.6% / SL 0.4%
 */

import {
  loadCandlesFromCSV,
  runBacktest,
} from '../backtest/index.js';
import { HybridMTFBacktestStrategy } from '../backtest/strategies/hybrid-mtf-backtest.strategy.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_100';
const days = process.env.DAYS || '7';

// Find data file
const possiblePaths = [
  join(process.cwd(), `data/${asset}_1m_${days}d.csv`),
  join(process.cwd(), `data/${asset}_60s_${days}d.csv`),
];

let dataFile: string | null = null;
for (const p of possiblePaths) {
  if (existsSync(p)) {
    dataFile = p;
    break;
  }
}

if (!dataFile) {
  console.error(`No data file found for ${asset} with ${days} days`);
  process.exit(1);
}

console.log('='.repeat(80));
console.log(`TESTING HYBRID-MTF IMPROVEMENTS - ${asset} (${days} days)`);
console.log('='.repeat(80));

const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampFormat: 'unix_ms',
});

console.log(`Loaded ${candles.length} candles\n`);

// Test configurations
const configs = [
  { name: 'BASELINE (TP 0.8% / SL 0.5%)', takeProfitPct: 0.008, stopLossPct: 0.005 },
  { name: 'TP 0.6% / SL 0.5%', takeProfitPct: 0.006, stopLossPct: 0.005 },
  { name: 'TP 0.5% / SL 0.5% (1:1)', takeProfitPct: 0.005, stopLossPct: 0.005 },
  { name: 'TP 0.8% / SL 0.4%', takeProfitPct: 0.008, stopLossPct: 0.004 },
  { name: 'TP 0.6% / SL 0.4% (1.5:1)', takeProfitPct: 0.006, stopLossPct: 0.004 },
  { name: 'TP 0.5% / SL 0.4% (1.25:1)', takeProfitPct: 0.005, stopLossPct: 0.004 },
  { name: 'TP 0.4% / SL 0.3% (1.33:1)', takeProfitPct: 0.004, stopLossPct: 0.003 },
];

interface TestResult {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDD: number;
}

const results: TestResult[] = [];

for (const config of configs) {
  const strategy = new HybridMTFBacktestStrategy(asset, {
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
  });

  const result = runBacktest(strategy, candles, {
    initialBalance: 10000,
    multiplier: 100,
    stakeAmount: 100,
  });

  const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
  const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');

  const wins = result.trades.filter(t => getOutcome(t) === 'WIN');
  const losses = result.trades.filter(t => getOutcome(t) === 'LOSS');
  const totalPnl = result.trades.reduce((sum, t) => sum + getPnl(t), 0);

  const grossProfit = wins.reduce((sum, t) => sum + getPnl(t), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + getPnl(t), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  results.push({
    name: config.name,
    trades: result.trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / result.trades.length) * 100,
    pnl: totalPnl,
    profitFactor,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    maxDD: result.metrics.maxDrawdownPct,
  });
}

// Print results table
console.log('┌' + '─'.repeat(30) + '┬' + '─'.repeat(8) + '┬' + '─'.repeat(8) + '┬' + '─'.repeat(10) + '┬' + '─'.repeat(10) + '┬' + '─'.repeat(8) + '┐');
console.log('│ ' + 'Configuration'.padEnd(28) + ' │ ' + 'Trades'.padStart(6) + ' │ ' + 'WR %'.padStart(6) + ' │ ' + 'P&L'.padStart(8) + ' │ ' + 'PF'.padStart(8) + ' │ ' + 'DD %'.padStart(6) + ' │');
console.log('├' + '─'.repeat(30) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┤');

for (const r of results) {
  const pnlStr = r.pnl >= 0 ? `+$${r.pnl.toFixed(0)}` : `-$${Math.abs(r.pnl).toFixed(0)}`;
  console.log(
    '│ ' + r.name.padEnd(28) + ' │ ' +
    r.trades.toString().padStart(6) + ' │ ' +
    r.winRate.toFixed(1).padStart(6) + ' │ ' +
    pnlStr.padStart(8) + ' │ ' +
    r.profitFactor.toFixed(2).padStart(8) + ' │ ' +
    r.maxDD.toFixed(1).padStart(6) + ' │'
  );
}

console.log('└' + '─'.repeat(30) + '┴' + '─'.repeat(8) + '┴' + '─'.repeat(8) + '┴' + '─'.repeat(10) + '┴' + '─'.repeat(10) + '┴' + '─'.repeat(8) + '┘');

// Find best config
const bestByPnl = [...results].sort((a, b) => b.pnl - a.pnl)[0];
const bestByPF = [...results].sort((a, b) => b.profitFactor - a.profitFactor)[0];

console.log('\n📊 ANALYSIS:');
console.log('-'.repeat(60));
console.log(`  Best by P&L:          ${bestByPnl.name} ($${bestByPnl.pnl.toFixed(2)})`);
console.log(`  Best by Profit Factor: ${bestByPF.name} (${bestByPF.profitFactor.toFixed(2)})`);

// Show improvement vs baseline
const baseline = results[0];
console.log('\n📈 IMPROVEMENT VS BASELINE:');
console.log('-'.repeat(60));

for (const r of results.slice(1)) {
  const pnlDiff = r.pnl - baseline.pnl;
  const wrDiff = r.winRate - baseline.winRate;
  const pfDiff = r.profitFactor - baseline.profitFactor;

  const pnlIcon = pnlDiff >= 0 ? '✅' : '❌';
  const pnlStr = pnlDiff >= 0 ? `+$${pnlDiff.toFixed(0)}` : `-$${Math.abs(pnlDiff).toFixed(0)}`;

  console.log(`  ${r.name.padEnd(28)} | P&L: ${pnlIcon} ${pnlStr.padStart(8)} | WR: ${wrDiff >= 0 ? '+' : ''}${wrDiff.toFixed(1)}% | PF: ${pfDiff >= 0 ? '+' : ''}${pfDiff.toFixed(2)}`);
}

// Win/Loss ratio analysis
console.log('\n📊 WIN/LOSS RATIO ANALYSIS:');
console.log('-'.repeat(60));

for (const r of results) {
  const ratio = r.avgLoss > 0 ? r.avgWin / r.avgLoss : 0;
  const breakeven = ratio > 0 ? (1 / (1 + ratio)) * 100 : 0;
  const profitable = r.winRate > breakeven;

  console.log(`  ${r.name.padEnd(28)} | Ratio: ${ratio.toFixed(2)}:1 | Breakeven: ${breakeven.toFixed(1)}% | ${profitable ? '✅ Profitable' : '❌ Unprofitable'}`);
}

console.log('\n' + '='.repeat(80));
