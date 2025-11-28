/**
 * Test FVG (Fair Value Gap) Strategy
 *
 * Tests the FVG strategy with different configurations:
 * 1. Different entry zones (edge, middle, full)
 * 2. Different confirmation settings
 * 3. Different timeframes (5m vs 15m FVG detection)
 * 4. With/without RSI filter
 *
 * Usage:
 *   ASSET="R_100" DAYS="90" npx tsx src/scripts/test-fvg-strategy.ts
 */

import {
    loadCandlesFromCSV,
    runBacktest,
} from '../backtest/index.js';
import { FVGBacktestStrategy } from '../backtest/strategies/fvg-backtest.strategy.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_100';
const days = process.env.DAYS || '7';
const mult = parseInt(process.env.MULT || '100', 10);

// Find data file
const possiblePaths = [
    join(process.cwd(), `data/${asset}_1m_${days}d.csv`),
    join(process.cwd(), `data/${asset}_60s_${days}d.csv`),
    join(process.cwd(), process.env.DATA_FILE || ''),
];

let dataFile: string | null = null;
for (const p of possiblePaths) {
    if (p && existsSync(p)) {
        dataFile = p;
        break;
    }
}

if (!dataFile) {
    console.error(`No data file found for ${asset} with ${days} days`);
    console.error('Tried paths:', possiblePaths);
    process.exit(1);
}

console.log('='.repeat(80));
console.log(`TESTING FVG STRATEGY - ${asset} (${days} days, x${mult})`);
console.log('='.repeat(80));

const candles = loadCandlesFromCSV(dataFile, {
    asset,
    timeframe: 60,
    timestampFormat: 'unix_ms',
});

console.log(`Loaded ${candles.length} candles\n`);

// Test configurations
const configs = [
    // Entry zone variants
    { name: 'Edge Entry (5m)', fvgTimeframe: 5, entryZone: 'edge' as const, requireConfirmation: true },
    { name: 'Middle Entry (5m)', fvgTimeframe: 5, entryZone: 'middle' as const, requireConfirmation: true },
    { name: 'Full Zone (5m)', fvgTimeframe: 5, entryZone: 'full' as const, requireConfirmation: true },

    // Confirmation variants
    { name: 'No Confirmation (5m)', fvgTimeframe: 5, entryZone: 'middle' as const, requireConfirmation: false },
    { name: 'Middle + 3 bar confirm', fvgTimeframe: 5, entryZone: 'middle' as const, requireConfirmation: true, confirmationBars: 3 },

    // Timeframe variants
    { name: '15m FVG (middle)', fvgTimeframe: 15, entryZone: 'middle' as const, requireConfirmation: true },
    { name: '15m FVG (edge)', fvgTimeframe: 15, entryZone: 'edge' as const, requireConfirmation: true },

    // Gap size variants
    { name: 'Smaller gaps (0.1%)', fvgTimeframe: 5, entryZone: 'middle' as const, minGapSizePct: 0.001 },
    { name: 'Larger gaps (0.2%)', fvgTimeframe: 5, entryZone: 'middle' as const, minGapSizePct: 0.002 },

    // RSI filter variants
    { name: 'No RSI Filter', fvgTimeframe: 5, entryZone: 'middle' as const, useRSIFilter: false },

    // TP/SL variants
    { name: 'TP x2.0 (higher reward)', fvgTimeframe: 5, entryZone: 'middle' as const, takeProfitMultiple: 2.0 },
    { name: 'TP x1.0 (tight)', fvgTimeframe: 5, entryZone: 'middle' as const, takeProfitMultiple: 1.0 },
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
    sqn: number;
}

const results: TestResult[] = [];

for (const config of configs) {
    const strategy = new FVGBacktestStrategy(asset, config);

    const result = runBacktest(strategy, candles, {
        initialBalance: 10000,
        multiplier: mult,
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
        winRate: result.trades.length > 0 ? (wins.length / result.trades.length) * 100 : 0,
        pnl: totalPnl,
        profitFactor,
        avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
        avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
        maxDD: result.metrics.maxDrawdownPct,
        sqn: result.metrics.sqn,
    });

    // Reset strategy for next run
    strategy.reset();
}

// Print results table
console.log('\n📊 FVG STRATEGY TEST RESULTS');
console.log('─'.repeat(100));
console.log(
    '│ ' + 'Configuration'.padEnd(25) + ' │ ' +
    'Trades'.padStart(6) + ' │ ' +
    'Win%'.padStart(6) + ' │ ' +
    'P&L'.padStart(10) + ' │ ' +
    'PF'.padStart(6) + ' │ ' +
    'DD%'.padStart(6) + ' │ ' +
    'SQN'.padStart(6) + ' │'
);
console.log('─'.repeat(100));

for (const r of results) {
    const pnlStr = r.pnl >= 0 ? `+$${r.pnl.toFixed(0)}` : `-$${Math.abs(r.pnl).toFixed(0)}`;
    console.log(
        '│ ' + r.name.padEnd(25) + ' │ ' +
        r.trades.toString().padStart(6) + ' │ ' +
        r.winRate.toFixed(1).padStart(6) + ' │ ' +
        pnlStr.padStart(10) + ' │ ' +
        r.profitFactor.toFixed(2).padStart(6) + ' │ ' +
        r.maxDD.toFixed(1).padStart(6) + ' │ ' +
        r.sqn.toFixed(2).padStart(6) + ' │'
    );
}

console.log('─'.repeat(100));

// Find best configs
const profitable = results.filter(r => r.pnl > 0 && r.trades >= 20);

if (profitable.length > 0) {
    const bestByPnl = [...profitable].sort((a, b) => b.pnl - a.pnl)[0];
    const bestByWR = [...profitable].sort((a, b) => b.winRate - a.winRate)[0];
    const bestByPF = [...profitable].sort((a, b) => b.profitFactor - a.profitFactor)[0];
    const bestBySQN = [...profitable].sort((a, b) => b.sqn - a.sqn)[0];

    console.log('\n🏆 BEST CONFIGURATIONS (min 20 trades, positive P&L):');
    console.log('─'.repeat(60));
    console.log(`  Best by P&L:           ${bestByPnl.name} ($${bestByPnl.pnl.toFixed(0)})`);
    console.log(`  Best by Win Rate:      ${bestByWR.name} (${bestByWR.winRate.toFixed(1)}%)`);
    console.log(`  Best by Profit Factor: ${bestByPF.name} (${bestByPF.profitFactor.toFixed(2)})`);
    console.log(`  Best by SQN:           ${bestBySQN.name} (${bestBySQN.sqn.toFixed(2)})`);
} else {
    console.log('\n⚠️  No profitable configurations found with >= 20 trades');
}

// Analysis by entry zone
console.log('\n📈 ANALYSIS BY ENTRY ZONE:');
console.log('─'.repeat(60));

const byEntryZone = ['edge', 'middle', 'full'];
for (const zone of byEntryZone) {
    const zoneResults = results.filter(r => r.name.toLowerCase().includes(zone) || r.name.includes('Entry'));
    if (zoneResults.length > 0) {
        const avgWR = zoneResults.reduce((sum, r) => sum + r.winRate, 0) / zoneResults.length;
        const avgPnl = zoneResults.reduce((sum, r) => sum + r.pnl, 0) / zoneResults.length;
        console.log(`  ${zone.padEnd(10)} | Avg WR: ${avgWR.toFixed(1)}% | Avg P&L: $${avgPnl.toFixed(0)}`);
    }
}

// Summary
console.log('\n📋 SUMMARY:');
console.log('─'.repeat(60));
console.log(`  Total configurations tested: ${results.length}`);
console.log(`  Profitable configs: ${profitable.length}`);
console.log(`  Configs with trades: ${results.filter(r => r.trades > 0).length}`);

const avgTrades = results.reduce((sum, r) => sum + r.trades, 0) / results.length;
const avgWR = results.filter(r => r.trades > 0).reduce((sum, r) => sum + r.winRate, 0) / results.filter(r => r.trades > 0).length || 0;

console.log(`  Average trades per config: ${avgTrades.toFixed(0)}`);
console.log(`  Average win rate: ${avgWR.toFixed(1)}%`);

console.log('\n' + '='.repeat(80));
