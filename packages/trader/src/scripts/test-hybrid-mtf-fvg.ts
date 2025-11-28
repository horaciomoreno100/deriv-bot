/**
 * Test Hybrid MTF + FVG Strategy
 *
 * Usage:
 *   ASSET="R_100" DAYS="30" npx tsx src/scripts/test-hybrid-mtf-fvg.ts
 */

import {
    loadCandlesFromCSV,
    runBacktest,
    printBacktestResult,
} from '../backtest/index.js';
import { createHybridMTFFVGStrategy } from '../backtest/strategies/hybrid-mtf-fvg-backtest.strategy.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_100';
const days = process.env.DAYS || '30';
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
console.log(`TESTING HYBRID MTF + FVG STRATEGY - ${asset} (${days} days, x${mult})`);
console.log('='.repeat(80));

const candles = loadCandlesFromCSV(dataFile, {
    asset,
    timeframe: 60,
    timestampFormat: 'unix_ms',
});

console.log(`Loaded ${candles.length} candles\n`);

// Test different configurations
const configs = [
    {
        name: 'All Modes (Independent FVG)',
        params: {
            enableMomentum: true,
            enableMeanReversion: true,
            enableFVG: true,
            fvgAsFilter: false,
        },
    },
    {
        name: 'All Modes (FVG as Filter)',
        params: {
            enableMomentum: true,
            enableMeanReversion: true,
            enableFVG: true,
            fvgAsFilter: true,
        },
    },
    {
        name: 'Hybrid MTF Only',
        params: {
            enableMomentum: true,
            enableMeanReversion: true,
            enableFVG: false,
        },
    },
    {
        name: 'FVG Only',
        params: {
            enableMomentum: false,
            enableMeanReversion: false,
            enableFVG: true,
            fvgAsFilter: false,
        },
    },
    {
        name: 'Momentum + FVG',
        params: {
            enableMomentum: true,
            enableMeanReversion: false,
            enableFVG: true,
            fvgAsFilter: false,
        },
    },
];

interface TestResult {
    name: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    pnl: number;
    profitFactor: number;
    maxDD: number;
    sqn: number;
}

const results: TestResult[] = [];

for (const config of configs) {
    console.log(`\nTesting: ${config.name}...`);
    const strategy = createHybridMTFFVGStrategy(asset, config.params);

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
        maxDD: result.metrics.maxDrawdownPct,
        sqn: result.metrics.sqn,
    });

    strategy.reset();
}

// Print results table
console.log('\n' + '═'.repeat(100));
console.log('📊 HYBRID MTF + FVG STRATEGY TEST RESULTS');
console.log('═'.repeat(100));
console.log(
    '│ ' + 'Configuration'.padEnd(30) + ' │ ' +
    'Trades'.padStart(6) + ' │ ' +
    'Win%'.padStart(6) + ' │ ' +
    'P&L'.padStart(10) + ' │ ' +
    'PF'.padStart(6) + ' │ ' +
    'DD%'.padStart(6) + ' │ ' +
    'SQN'.padStart(6) + ' │'
);
console.log('═'.repeat(100));

for (const r of results) {
    const pnlStr = r.pnl >= 0 ? `+$${r.pnl.toFixed(0)}` : `-$${Math.abs(r.pnl).toFixed(0)}`;
    console.log(
        '│ ' + r.name.padEnd(30) + ' │ ' +
        r.trades.toString().padStart(6) + ' │ ' +
        r.winRate.toFixed(1).padStart(6) + ' │ ' +
        pnlStr.padStart(10) + ' │ ' +
        r.profitFactor.toFixed(2).padStart(6) + ' │ ' +
        r.maxDD.toFixed(1).padStart(6) + ' │ ' +
        r.sqn.toFixed(2).padStart(6) + ' │'
    );
}

console.log('═'.repeat(100));

// Find best config
const profitable = results.filter(r => r.pnl > 0 && r.trades >= 20);

if (profitable.length > 0) {
    const bestByPnl = [...profitable].sort((a, b) => b.pnl - a.pnl)[0];
    const bestByWR = [...profitable].sort((a, b) => b.winRate - a.winRate)[0];
    const bestByPF = [...profitable].sort((a, b) => b.profitFactor - a.profitFactor)[0];
    const bestBySQN = [...profitable].sort((a, b) => b.sqn - a.sqn)[0];

    console.log('\n🏆 BEST CONFIGURATIONS (min 20 trades, positive P&L):');
    console.log('─'.repeat(70));
    console.log(`  Best by P&L:           ${bestByPnl.name} ($${bestByPnl.pnl.toFixed(0)})`);
    console.log(`  Best by Win Rate:      ${bestByWR.name} (${bestByWR.winRate.toFixed(1)}%)`);
    console.log(`  Best by Profit Factor: ${bestByPF.name} (${bestByPF.profitFactor.toFixed(2)})`);
    console.log(`  Best by SQN:           ${bestBySQN.name} (${bestBySQN.sqn.toFixed(2)})`);
} else {
    console.log('\n⚠️  No profitable configurations found with >= 20 trades');
}

console.log('\n' + '='.repeat(80));

