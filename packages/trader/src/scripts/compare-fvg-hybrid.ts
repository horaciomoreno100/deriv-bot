/**
 * Compare FVG Strategy vs Hybrid MTF Strategy
 * 
 * Analyzes correlation between signals from both strategies
 * 
 * Usage:
 *   ASSET="R_100" DAYS="30" npx tsx src/scripts/compare-fvg-hybrid.ts
 */

import {
    loadCandlesFromCSV,
    runBacktest,
} from '../backtest/index.js';
import { FVGBacktestStrategy } from '../backtest/strategies/fvg-backtest.strategy.js';
import { createHybridMTFStrategy } from '../backtest/index.js';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal } from '../backtest/types.js';

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
console.log(`COMPARING FVG vs HYBRID MTF - ${asset} (${days} days)`);
console.log('='.repeat(80));

const candles = loadCandlesFromCSV(dataFile, {
    asset,
    timeframe: 60,
    timestampFormat: 'unix_ms',
});

console.log(`Loaded ${candles.length} candles\n`);

// Create strategies
const fvgStrategy = new FVGBacktestStrategy(asset, {
    fvgTimeframe: 5,
    entryZone: 'edge',
    requireConfirmation: true,
    useRSIFilter: true,
});

const hybridStrategy = createHybridMTFStrategy(asset);

// Run backtests to get trades
console.log('Running FVG backtest...');
const fvgResult = runBacktest(fvgStrategy, candles, {
    initialBalance: 10000,
    multiplier: mult,
    stakeAmount: 100,
});

console.log('Running Hybrid MTF backtest...');
const hybridResult = runBacktest(hybridStrategy, candles, {
    initialBalance: 10000,
    multiplier: mult,
    stakeAmount: 100,
});

// Extract signal timestamps and directions
interface Signal {
    timestamp: number;
    direction: 'CALL' | 'PUT';
    candleIndex: number;
}

// Extract signal timestamps and directions
// Note: entryTimestamp is in seconds (Unix timestamp)
// Extract signals - use entry.snapshot.candle.index and timestamp
const fvgSignals: Signal[] = fvgResult.trades.map(t => {
    const trade = t as any;
    const candleIndex = trade.entry?.snapshot?.candle?.index ?? -1;
    const timestamp = (trade.entry?.snapshot?.candle?.timestamp || trade.entry?.snapshot?.timestamp || 0) * 1000;
    
    return {
        timestamp,
        direction: trade.direction,
        candleIndex,
    };
}).filter(s => s.candleIndex >= 0);

const hybridSignals: Signal[] = hybridResult.trades.map(t => {
    const trade = t as any;
    const candleIndex = trade.entry?.snapshot?.candle?.index ?? -1;
    const timestamp = (trade.entry?.snapshot?.candle?.timestamp || trade.entry?.snapshot?.timestamp || 0) * 1000;
    
    return {
        timestamp,
        direction: trade.direction,
        candleIndex,
    };
}).filter(s => s.candleIndex >= 0);


// Calculate correlation metrics
// Using candle index for more accurate comparison (1 candle = 1 minute)
function calculateCorrelation(signals1: Signal[], signals2: Signal[], windowCandles: number = 5): {
    total1: number;
    total2: number;
    overlapping: number;
    sameDirection: number;
    oppositeDirection: number;
    correlation: number;
    sameDirectionPct: number;
} {
    let overlapping = 0;
    let sameDirection = 0;
    let oppositeDirection = 0;

    // Create a set of candle indices for signals2 for quick lookup
    const signals2ByIndex = new Map<number, Signal[]>();
    for (const s2 of signals2) {
        if (!signals2ByIndex.has(s2.candleIndex)) {
            signals2ByIndex.set(s2.candleIndex, []);
        }
        signals2ByIndex.get(s2.candleIndex)!.push(s2);
    }

    // Check each signal1 against signals2
    for (const s1 of signals1) {
        // Find signals2 within the candle window
        const nearby: Signal[] = [];
        for (let offset = -windowCandles; offset <= windowCandles; offset++) {
            const checkIndex = s1.candleIndex + offset;
            const signalsAtIndex = signals2ByIndex.get(checkIndex) || [];
            nearby.push(...signalsAtIndex);
        }

        if (nearby.length > 0) {
            overlapping++;
            // Check if any nearby signal has same direction
            const hasSameDir = nearby.some(s2 => s2.direction === s1.direction);
            if (hasSameDir) {
                sameDirection++;
            } else {
                oppositeDirection++;
            }
        }
    }

    const correlation = signals1.length > 0 ? (overlapping / signals1.length) : 0;
    const sameDirectionPct = overlapping > 0 ? (sameDirection / overlapping) * 100 : 0;

    return {
        total1: signals1.length,
        total2: signals2.length,
        overlapping,
        sameDirection,
        oppositeDirection,
        correlation,
        sameDirectionPct,
    };
}

// Calculate correlations (using candle index, window of 5 candles = 5 minutes)
const fvgToHybrid = calculateCorrelation(fvgSignals, hybridSignals, 5);
const hybridToFvg = calculateCorrelation(hybridSignals, fvgSignals, 5);

// Calculate P&L metrics
const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');

const fvgWins = fvgResult.trades.filter(t => getOutcome(t) === 'WIN').length;
const fvgLosses = fvgResult.trades.filter(t => getOutcome(t) === 'LOSS').length;
const fvgTotalPnl = fvgResult.trades.reduce((sum, t) => sum + getPnl(t), 0);
const fvgWinRate = fvgResult.trades.length > 0 ? (fvgWins / fvgResult.trades.length) * 100 : 0;

const hybridWins = hybridResult.trades.filter(t => getOutcome(t) === 'WIN').length;
const hybridLosses = hybridResult.trades.filter(t => getOutcome(t) === 'LOSS').length;
const hybridTotalPnl = hybridResult.trades.reduce((sum, t) => sum + getPnl(t), 0);
const hybridWinRate = hybridResult.trades.length > 0 ? (hybridWins / hybridResult.trades.length) * 100 : 0;

// Print results
console.log('\n' + '═'.repeat(80));
console.log('📊 BACKTEST RESULTS');
console.log('═'.repeat(80));
console.log(`\nFVG Strategy:`);
console.log(`  Trades: ${fvgResult.trades.length}`);
console.log(`  Win Rate: ${fvgWinRate.toFixed(1)}%`);
console.log(`  P&L: $${fvgTotalPnl.toFixed(2)}`);
console.log(`  Profit Factor: ${fvgResult.metrics.profitFactor.toFixed(2)}`);
console.log(`  Max Drawdown: ${fvgResult.metrics.maxDrawdownPct.toFixed(1)}%`);

console.log(`\nHybrid MTF Strategy:`);
console.log(`  Trades: ${hybridResult.trades.length}`);
console.log(`  Win Rate: ${hybridWinRate.toFixed(1)}%`);
console.log(`  P&L: $${hybridTotalPnl.toFixed(2)}`);
console.log(`  Profit Factor: ${hybridResult.metrics.profitFactor.toFixed(2)}`);
console.log(`  Max Drawdown: ${hybridResult.metrics.maxDrawdownPct.toFixed(1)}%`);

console.log('\n' + '═'.repeat(80));
console.log('🔗 SIGNAL CORRELATION ANALYSIS');
console.log('═'.repeat(80));

console.log(`\nFVG → Hybrid MTF:`);
console.log(`  FVG signals: ${fvgToHybrid.total1}`);
console.log(`  Hybrid MTF signals: ${fvgToHybrid.total2}`);
console.log(`  Overlapping (within 5 candles): ${fvgToHybrid.overlapping}`);
console.log(`  Same direction: ${fvgToHybrid.sameDirection} (${fvgToHybrid.sameDirectionPct.toFixed(1)}%)`);
console.log(`  Opposite direction: ${fvgToHybrid.oppositeDirection}`);
console.log(`  Correlation: ${(fvgToHybrid.correlation * 100).toFixed(1)}% (${fvgToHybrid.overlapping}/${fvgToHybrid.total1} FVG signals have nearby Hybrid MTF signals)`);

console.log(`\nHybrid MTF → FVG:`);
console.log(`  Hybrid MTF signals: ${hybridToFvg.total1}`);
console.log(`  FVG signals: ${hybridToFvg.total2}`);
console.log(`  Overlapping (within 5 candles): ${hybridToFvg.overlapping}`);
console.log(`  Same direction: ${hybridToFvg.sameDirection} (${hybridToFvg.sameDirectionPct.toFixed(1)}%)`);
console.log(`  Opposite direction: ${hybridToFvg.oppositeDirection}`);
console.log(`  Correlation: ${(hybridToFvg.correlation * 100).toFixed(1)}% (${hybridToFvg.overlapping}/${hybridToFvg.total1} Hybrid MTF signals have nearby FVG signals)`);

// Calculate unique signals
const fvgUnique = fvgToHybrid.total1 - fvgToHybrid.overlapping;
const hybridUnique = hybridToFvg.total1 - hybridToFvg.overlapping;

console.log('\n' + '═'.repeat(80));
console.log('📈 STRATEGY COMPLEMENTARITY');
console.log('═'.repeat(80));
console.log(`\nUnique FVG signals (no Hybrid MTF nearby): ${fvgUnique} (${((fvgUnique / fvgToHybrid.total1) * 100).toFixed(1)}%)`);
console.log(`Unique Hybrid MTF signals (no FVG nearby): ${hybridUnique} (${((hybridUnique / hybridToFvg.total1) * 100).toFixed(1)}%)`);

const totalUnique = fvgUnique + hybridUnique;
const totalSignals = fvgToHybrid.total1 + hybridToFvg.total1;
const complementarity = totalSignals > 0 ? (totalUnique / totalSignals) * 100 : 0;

console.log(`\nComplementarity Score: ${complementarity.toFixed(1)}%`);
console.log(`  (Higher = more complementary, Lower = more correlated)`);

// Interpretation
console.log('\n' + '═'.repeat(80));
console.log('💡 INTERPRETATION');
console.log('═'.repeat(80));

if (fvgToHybrid.correlation < 0.2 && hybridToFvg.correlation < 0.2) {
    console.log('✅ LOW CORRELATION: Strategies are highly complementary');
    console.log('   → Good for portfolio diversification');
    console.log('   → Can run both strategies simultaneously');
} else if (fvgToHybrid.correlation < 0.4 && hybridToFvg.correlation < 0.4) {
    console.log('✅ MODERATE CORRELATION: Strategies are somewhat complementary');
    console.log('   → Some overlap but still useful for diversification');
    console.log('   → Consider position sizing to avoid overexposure');
} else {
    console.log('⚠️  HIGH CORRELATION: Strategies are similar');
    console.log('   → High overlap in signals');
    console.log('   → Consider using only one or adjusting parameters');
}

if (fvgToHybrid.sameDirectionPct > 70) {
    console.log(`\n✅ When both strategies signal, they agree ${fvgToHybrid.sameDirectionPct.toFixed(1)}% of the time`);
    console.log('   → High agreement suggests both are catching similar market conditions');
} else if (fvgToHybrid.sameDirectionPct < 50) {
    console.log(`\n⚠️  When both strategies signal, they disagree ${(100 - fvgToHybrid.sameDirectionPct).toFixed(1)}% of the time`);
    console.log('   → Consider reviewing logic or market conditions');
}

console.log('\n' + '═'.repeat(80));

