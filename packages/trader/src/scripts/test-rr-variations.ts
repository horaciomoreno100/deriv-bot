#!/usr/bin/env npx tsx
/**
 * Test different takeProfitRR values for FVG-LS strategy
 */

import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createFVGLiquiditySweepStrategy,
} from '../backtest/index.js';

const ASSET = process.env.ASSET ?? 'frxAUDUSD';
const dataPath = path.join(process.cwd(), 'data', `${ASSET}_1m_90d.csv`);

console.log('Loading candles...');
const candles = loadCandlesFromCSV(dataPath, {
  asset: ASSET,
  timeframe: 60,
  timestampColumn: 'timestamp',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  timestampFormat: 'unix_ms',
});
console.log(`Loaded ${candles.length} candles`);

interface TestResult {
  rr: number;
  trades: number;
  winRate: number;
  netPnl: number;
  pf: number;
  maxDD: number;
}

const results: TestResult[] = [];

// Test different R:R values
const rrValues = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5];

for (const rr of rrValues) {
  console.log(`\nTesting takeProfitRR = ${rr}...`);

  const strategy = createFVGLiquiditySweepStrategy(ASSET, { takeProfitRR: rr });
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 200,
    stakePct: 0.04,
  });

  results.push({
    rr,
    trades: result.metrics.totalTrades,
    winRate: result.metrics.winRate,
    netPnl: result.metrics.netPnl,
    pf: result.metrics.profitFactor,
    maxDD: result.metrics.maxDrawdownPct,
  });

  console.log(`  Trades: ${result.metrics.totalTrades} | Win: ${result.metrics.winRate.toFixed(1)}% | P&L: $${result.metrics.netPnl.toFixed(0)} | PF: ${result.metrics.profitFactor.toFixed(2)}`);
}

// Print summary
console.log('\n');
console.log('═'.repeat(75));
console.log('RESUMEN: Impacto de takeProfitRR en frxAUDUSD (90 días)');
console.log('═'.repeat(75));
console.log('R:R  | Trades | Win Rate | Net P&L  | PF   | Max DD | vs Base');
console.log('─'.repeat(75));

const baseline = results.find(r => r.rr === 1.5)!;

for (const r of results) {
  const improvement = ((r.netPnl - baseline.netPnl) / Math.abs(baseline.netPnl) * 100).toFixed(1);
  const sign = parseFloat(improvement) >= 0 ? '+' : '';
  console.log(
    `${r.rr.toFixed(1)} | ` +
    `${r.trades.toString().padStart(6)} | ` +
    `${r.winRate.toFixed(1).padStart(7)}% | ` +
    `$${r.netPnl.toFixed(0).padStart(7)} | ` +
    `${r.pf.toFixed(2)} | ` +
    `${r.maxDD.toFixed(1).padStart(5)}% | ` +
    `${sign}${improvement}%`
  );
}

// Find best
const best = results.reduce((a, b) => a.netPnl > b.netPnl ? a : b);
console.log('─'.repeat(75));
console.log(`\n✅ Mejor configuración: takeProfitRR = ${best.rr}`);
console.log(`   P&L: $${best.netPnl.toFixed(2)} | Win Rate: ${best.winRate.toFixed(1)}% | PF: ${best.pf.toFixed(2)}`);
