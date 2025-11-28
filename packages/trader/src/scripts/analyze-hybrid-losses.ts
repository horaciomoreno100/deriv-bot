/**
 * Analyze Hybrid-MTF Losing Trades
 * Identifies patterns in losing trades to improve strategy
 */

import {
  loadCandlesFromCSV,
  runBacktest,
  createHybridMTFStrategy,
} from '../backtest/index.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, RSI } from 'technicalindicators';

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
console.log(`ANALYZING HYBRID-MTF LOSSES - ${asset} (${days} days)`);
console.log('='.repeat(80));

const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampFormat: 'unix_ms',
});

const strategy = createHybridMTFStrategy(asset);
const result = runBacktest(strategy, candles, {
  initialBalance: 10000,
  multiplier: 100,
  stakeAmount: 100,
});

// Pre-calculate indicators for analysis
const closes = candles.map(c => c.close);
const bbResult = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
const rsiResult = RSI.calculate({ period: 14, values: closes });

// Pad to align with candles
const bbPadded = Array(20 - 1).fill(null).concat(bbResult);
const rsiPadded = Array(14).fill(null).concat(rsiResult);

// Helper to get pnl from trade (handles nested structure)
const getPnl = (t: any): number => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any): string => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');
const getMFE = (t: any): number => t.result?.maxFavorablePct ?? 0;

// Analyze trades
const losses = result.trades.filter(t => getOutcome(t) === 'LOSS');
const wins = result.trades.filter(t => getOutcome(t) === 'WIN');

console.log(`\nTotal Trades: ${result.trades.length}`);
console.log(`Wins: ${wins.length} | Losses: ${losses.length}`);
console.log(`Win Rate: ${((wins.length / result.trades.length) * 100).toFixed(1)}%`);

// Direction analysis
console.log('\n📊 DIRECTION ANALYSIS:');
console.log('-'.repeat(60));

const callTrades = result.trades.filter(t => t.direction === 'CALL');
const putTrades = result.trades.filter(t => t.direction === 'PUT');
const callWins = callTrades.filter(t => getOutcome(t) === 'WIN').length;
const putWins = putTrades.filter(t => getOutcome(t) === 'WIN').length;

const callPnl = callTrades.reduce((sum, t) => sum + getPnl(t), 0);
const putPnl = putTrades.reduce((sum, t) => sum + getPnl(t), 0);

console.log(`  CALL: ${callTrades.length} trades | WR: ${callTrades.length > 0 ? ((callWins / callTrades.length) * 100).toFixed(0) : 0}% | P&L: $${callPnl.toFixed(2)}`);
console.log(`  PUT:  ${putTrades.length} trades | WR: ${putTrades.length > 0 ? ((putWins / putTrades.length) * 100).toFixed(0) : 0}% | P&L: $${putPnl.toFixed(2)}`);

// Max Favorable Excursion analysis
console.log('\n📊 MAX FAVORABLE EXCURSION (MFE):');
console.log('-'.repeat(60));

const tpPct = 0.8; // 0.8% TP

const lossMFEs = losses.map(t => getMFE(t) * 100); // Convert to %
const winMFEs = wins.map(t => getMFE(t) * 100);

const nearMisses = losses.filter(t => getMFE(t) * 100 >= tpPct * 0.5);
const quickLosses = losses.filter(t => getMFE(t) * 100 < tpPct * 0.25);

console.log(`  Losses that reached >50% of TP: ${nearMisses.length} / ${losses.length} (${losses.length > 0 ? ((nearMisses.length / losses.length) * 100).toFixed(0) : 0}%)`);
console.log(`  Quick losses (<25% of TP):      ${quickLosses.length} / ${losses.length} (${losses.length > 0 ? ((quickLosses.length / losses.length) * 100).toFixed(0) : 0}%)`);

if (winMFEs.length > 0) {
  const avgWinMFE = winMFEs.reduce((a, b) => a + b, 0) / winMFEs.length;
  console.log(`  Avg MFE on wins: ${avgWinMFE.toFixed(2)}%`);
}
if (lossMFEs.length > 0) {
  const avgLossMFE = lossMFEs.reduce((a, b) => a + b, 0) / lossMFEs.length;
  console.log(`  Avg MFE on losses: ${avgLossMFE.toFixed(2)}%`);
}

// Losing streaks
console.log('\n📉 LOSING STREAKS:');
console.log('-'.repeat(60));

let currentStreak = 0;
let maxStreak = 0;
let streakStart = 0;
const streaks: { start: number; length: number; loss: number }[] = [];

for (let i = 0; i < result.trades.length; i++) {
  if (getOutcome(result.trades[i]) === 'LOSS') {
    if (currentStreak === 0) streakStart = i;
    currentStreak++;
  } else {
    if (currentStreak >= 3) {
      let streakLoss = 0;
      for (let j = streakStart; j < streakStart + currentStreak; j++) {
        streakLoss += getPnl(result.trades[j]);
      }
      streaks.push({ start: streakStart, length: currentStreak, loss: streakLoss });
    }
    if (currentStreak > maxStreak) maxStreak = currentStreak;
    currentStreak = 0;
  }
}
// Check final streak
if (currentStreak > maxStreak) maxStreak = currentStreak;

console.log(`  Max consecutive losses: ${maxStreak}`);
console.log(`  Streaks of 3+ losses: ${streaks.length}`);

for (const streak of streaks.slice(0, 5)) {
  console.log(`    - ${streak.length} losses | Total loss: $${streak.loss.toFixed(2)}`);
}

// P&L Distribution
console.log('\n📊 P&L DISTRIBUTION:');
console.log('-'.repeat(60));

const pnls = result.trades.map(t => getPnl(t));
const sortedPnls = [...pnls].sort((a, b) => a - b);

console.log(`  Best trade:  $${sortedPnls[sortedPnls.length - 1]?.toFixed(2) || 0}`);
console.log(`  Worst trade: $${sortedPnls[0]?.toFixed(2) || 0}`);
console.log(`  Avg win:     $${wins.length > 0 ? (wins.reduce((sum, t) => sum + getPnl(t), 0) / wins.length).toFixed(2) : 0}`);
console.log(`  Avg loss:    $${losses.length > 0 ? (losses.reduce((sum, t) => sum + getPnl(t), 0) / losses.length).toFixed(2) : 0}`);

// Win/Loss ratio
const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + getPnl(t), 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + getPnl(t), 0) / losses.length) : 0;
const wlRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
console.log(`  Win/Loss ratio: ${wlRatio.toFixed(2)}:1`);

// Recommendations
console.log('\n💡 RECOMMENDATIONS:');
console.log('-'.repeat(60));

const wr = wins.length / result.trades.length;

if (wr < 0.45) {
  console.log('  ⚠️  Win rate below 45% - strategy is struggling this week');
}

if (nearMisses.length > losses.length * 0.3) {
  console.log('  ⚠️  Many near misses (>30% of losses)');
  console.log('     → TP might be too ambitious (0.8%)');
  console.log('     → Consider: TP 0.6% or trailing stop at 0.4%');
}

if (quickLosses.length > losses.length * 0.4) {
  console.log('  ⚠️  Many quick losses (<25% MFE)');
  console.log('     → Entry timing is poor - price moves against immediately');
  console.log('     → Consider: stricter RSI thresholds or waiting for pullback confirmation');
}

const callWR = callTrades.length > 0 ? callWins / callTrades.length : 0;
const putWR = putTrades.length > 0 ? putWins / putTrades.length : 0;

if (callWR < 0.35 && callTrades.length >= 5) {
  console.log(`  ⚠️  CALL trades underperforming (${(callWR * 100).toFixed(0)}% WR)`);
  console.log('     → BULLISH_TREND detection may be lagging');
}

if (putWR < 0.35 && putTrades.length >= 5) {
  console.log(`  ⚠️  PUT trades underperforming (${(putWR * 100).toFixed(0)}% WR)`);
  console.log('     → BEARISH_TREND detection may be lagging');
}

if (wlRatio < 1.3) {
  console.log(`  ⚠️  Win/Loss ratio too low (${wlRatio.toFixed(2)}:1)`);
  console.log('     → Need ratio > 1.3:1 for 42% WR to be profitable');
  console.log('     → Consider: wider TP or tighter SL');
}

// Show worst 5 trades
console.log('\n📋 WORST 5 TRADES:');
console.log('-'.repeat(60));

const worstTrades = [...result.trades].sort((a, b) => getPnl(a) - getPnl(b)).slice(0, 5);
for (const t of worstTrades) {
  const mfe = (getMFE(t) * 100).toFixed(2);
  console.log(`  ${t.direction} | MFE: ${mfe}% | P&L: $${getPnl(t).toFixed(2)}`);
}

// Show best 5 trades for comparison
console.log('\n📋 BEST 5 TRADES:');
console.log('-'.repeat(60));

const bestTrades = [...result.trades].sort((a, b) => getPnl(b) - getPnl(a)).slice(0, 5);
for (const t of bestTrades) {
  const mfe = (getMFE(t) * 100).toFixed(2);
  console.log(`  ${t.direction} | MFE: ${mfe}% | P&L: $${getPnl(t).toFixed(2)}`);
}

console.log('\n' + '='.repeat(80));
