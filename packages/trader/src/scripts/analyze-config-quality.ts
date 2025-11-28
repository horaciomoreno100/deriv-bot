/**
 * Analyze trade quality for different TP/SL configurations
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

const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampFormat: 'unix_ms',
});

console.log('='.repeat(80));
console.log(`TRADE QUALITY ANALYSIS - ${asset} (${days} days)`);
console.log('='.repeat(80));
console.log(`Loaded ${candles.length} candles\n`);

const configs = [
  { name: 'TP 0.5% / SL 0.5% (1:1)', takeProfitPct: 0.005, stopLossPct: 0.005 },
  { name: 'TP 0.6% / SL 0.4% (1.5:1)', takeProfitPct: 0.006, stopLossPct: 0.004 },
  { name: 'TP 0.5% / SL 0.4% (1.25:1)', takeProfitPct: 0.005, stopLossPct: 0.004 },
  { name: 'TP 0.4% / SL 0.3% (1.33:1)', takeProfitPct: 0.004, stopLossPct: 0.003 },
];

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');
const getDuration = (t: any) => {
  const entryIdx = t.entry?.snapshot?.candle?.index ?? 0;
  const exitIdx = t.exit?.snapshot?.candle?.index ?? 0;
  return exitIdx - entryIdx;
};

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

  const wins = result.trades.filter(t => getOutcome(t) === 'WIN');
  const losses = result.trades.filter(t => getOutcome(t) === 'LOSS');
  const totalPnl = result.trades.reduce((sum, t) => sum + getPnl(t), 0);

  // Quick losses (≤3 bars)
  const quickLosses = losses.filter(t => getDuration(t) <= 3);

  // Medium duration losses (4-10 bars)
  const mediumLosses = losses.filter(t => getDuration(t) > 3 && getDuration(t) <= 10);

  // Slow losses (>10 bars)
  const slowLosses = losses.filter(t => getDuration(t) > 10);

  // Average duration
  const avgWinDuration = wins.length > 0
    ? wins.reduce((sum, t) => sum + getDuration(t), 0) / wins.length
    : 0;
  const avgLossDuration = losses.length > 0
    ? losses.reduce((sum, t) => sum + getDuration(t), 0) / losses.length
    : 0;

  // Max consecutive losses
  let maxConsecLosses = 0;
  let currentStreak = 0;
  for (const t of result.trades) {
    if (getOutcome(t) === 'LOSS') {
      currentStreak++;
      maxConsecLosses = Math.max(maxConsecLosses, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const pnlStr = totalPnl >= 0 ? '+' + totalPnl.toFixed(0) : totalPnl.toFixed(0);
  const wrPct = ((wins.length / result.trades.length) * 100).toFixed(1);
  const ddPct = result.metrics.maxDrawdownPct.toFixed(1);
  const quickLossPct = losses.length > 0 ? ((quickLosses.length / losses.length) * 100).toFixed(0) : '0';

  console.log(`\n📊 ${config.name}`);
  console.log('-'.repeat(60));
  console.log(`   P&L: $${pnlStr} | WR: ${wrPct}% | DD: ${ddPct}%`);
  console.log(`   Trades: ${result.trades.length} (${wins.length}W / ${losses.length}L)`);
  console.log(`   Max Consec Losses: ${maxConsecLosses}`);
  console.log(`   Avg Win Duration: ${avgWinDuration.toFixed(1)} bars`);
  console.log(`   Avg Loss Duration: ${avgLossDuration.toFixed(1)} bars`);
  console.log(`   Quick Losses (≤3 bars): ${quickLosses.length} (${quickLossPct}%)`);
  console.log(`   Medium Losses (4-10 bars): ${mediumLosses.length}`);
  console.log(`   Slow Losses (>10 bars): ${slowLosses.length}`);

  // Score (higher is better)
  const profitScore = totalPnl / 100; // Normalize
  const ddPenalty = result.metrics.maxDrawdownPct * 2;
  const quickLossPenalty = (quickLosses.length / Math.max(losses.length, 1)) * 10;
  const streakPenalty = maxConsecLosses * 2;
  const score = profitScore - ddPenalty - quickLossPenalty - streakPenalty;

  console.log(`   📈 Quality Score: ${score.toFixed(1)} (higher = better)`);
}

console.log('\n' + '='.repeat(80));
