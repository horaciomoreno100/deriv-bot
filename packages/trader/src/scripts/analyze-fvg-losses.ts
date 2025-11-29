#!/usr/bin/env npx tsx
/**
 * FVG Liquidity Sweep Loss Analysis
 *
 * Analyzes losing trades to find patterns and potential improvements.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  createFVGLiquiditySweepStrategy,
} from '../backtest/index.js';

// Configuration
const ASSET = process.env.ASSET ?? 'frxAUDUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 200;
const STAKE_PCT = 0.04;

interface TradeAnalysis {
  entryTime: Date;
  exitTime: Date;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  duration: number; // bars
  hourOfDay: number;
  dayOfWeek: number;
  priceMovePct: number;
  maxAdverseExcursion: number; // How far price went against us
  maxFavorableExcursion: number; // How close to TP we got
  reachedHalfTP: boolean;
  quickLoss: boolean; // Lost in <= 3 bars
}

async function main() {
  console.log('═'.repeat(70));
  console.log('🔍 FVG LIQUIDITY SWEEP - LOSS ANALYSIS');
  console.log('═'.repeat(70));
  console.log(`Asset: ${ASSET}`);
  console.log(`Period: ${DAYS} days`);
  console.log('');

  // Find data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${ASSET}_1m_${DAYS}d.csv`,
    `${ASSET}_60s_${DAYS}d.csv`,
    `${ASSET}_1m_90d.csv`,
    `${ASSET}_60s_90d.csv`,
  ];

  let dataPath: string | null = null;
  for (const file of possibleFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      dataPath = fullPath;
      break;
    }
  }

  if (!dataPath) {
    console.error(`❌ No data file found for ${ASSET}`);
    process.exit(1);
  }

  console.log(`📂 Loading data from: ${path.basename(dataPath)}`);

  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
  });

  console.log(`   Loaded ${candles.length} candles`);
  console.log('');

  // Run backtest
  const strategy = createFVGLiquiditySweepStrategy(ASSET);
  const result = runBacktest(strategy, candles, {
    initialBalance: INITIAL_BALANCE,
    multiplier: MULTIPLIER,
    stakePct: STAKE_PCT,
  });

  const trades = result.trades;
  const losses = trades.filter(t => t.pnl < 0);
  const wins = trades.filter(t => t.pnl >= 0);

  console.log('═'.repeat(70));
  console.log('📊 OVERALL STATISTICS');
  console.log('═'.repeat(70));
  console.log(`Total trades: ${trades.length}`);
  console.log(`Winners: ${wins.length} (${(wins.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`Losers: ${losses.length} (${(losses.length / trades.length * 100).toFixed(1)}%)`);
  console.log('');

  // Analyze losses
  const lossAnalyses: TradeAnalysis[] = losses.map(trade => {
    const entryTime = new Date(trade.entryTime);
    const exitTime = new Date(trade.exitTime);
    const duration = trade.exitBar - trade.entryBar;
    const priceMovePct = Math.abs(trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100;

    return {
      entryTime,
      exitTime,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnl: trade.pnl,
      duration,
      hourOfDay: entryTime.getUTCHours(),
      dayOfWeek: entryTime.getUTCDay(),
      priceMovePct,
      maxAdverseExcursion: 0, // Would need candle-level data
      maxFavorableExcursion: 0,
      reachedHalfTP: false,
      quickLoss: duration <= 3,
    };
  });

  // Analyze wins for comparison
  const winAnalyses = wins.map(trade => {
    const entryTime = new Date(trade.entryTime);
    return {
      hourOfDay: entryTime.getUTCHours(),
      dayOfWeek: entryTime.getUTCDay(),
      duration: trade.exitBar - trade.entryBar,
    };
  });

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 1: Hour of Day
  // ══════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(70));
  console.log('⏰ ANALYSIS BY HOUR OF DAY (UTC)');
  console.log('═'.repeat(70));

  const hourStats: { [hour: number]: { wins: number; losses: number } } = {};
  for (let h = 0; h < 24; h++) {
    hourStats[h] = { wins: 0, losses: 0 };
  }

  lossAnalyses.forEach(t => hourStats[t.hourOfDay]!.losses++);
  winAnalyses.forEach(t => hourStats[t.hourOfDay]!.wins++);

  console.log('Hour | Wins | Losses | Win Rate | Net');
  console.log('─'.repeat(50));

  const badHours: number[] = [];
  const goodHours: number[] = [];

  for (let h = 0; h < 24; h++) {
    const stats = hourStats[h]!;
    const total = stats.wins + stats.losses;
    if (total === 0) continue;

    const winRate = stats.wins / total * 100;
    const net = stats.wins - stats.losses;
    const bar = winRate >= 50 ? '█'.repeat(Math.round(winRate / 10)) : '░'.repeat(Math.round((100 - winRate) / 10));

    console.log(`${h.toString().padStart(2, '0')}:00 | ${stats.wins.toString().padStart(4)} | ${stats.losses.toString().padStart(6)} | ${winRate.toFixed(1).padStart(5)}% | ${net >= 0 ? '+' : ''}${net} ${bar}`);

    if (winRate < 45 && total >= 10) badHours.push(h);
    if (winRate > 55 && total >= 10) goodHours.push(h);
  }

  console.log('');
  if (badHours.length > 0) {
    console.log(`⚠️  Worst hours (< 45% win rate): ${badHours.map(h => `${h}:00`).join(', ')}`);
  }
  if (goodHours.length > 0) {
    console.log(`✅ Best hours (> 55% win rate): ${goodHours.map(h => `${h}:00`).join(', ')}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 2: Day of Week
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('📅 ANALYSIS BY DAY OF WEEK');
  console.log('═'.repeat(70));

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayStats: { [day: number]: { wins: number; losses: number } } = {};
  for (let d = 0; d < 7; d++) {
    dayStats[d] = { wins: 0, losses: 0 };
  }

  lossAnalyses.forEach(t => dayStats[t.dayOfWeek]!.losses++);
  winAnalyses.forEach(t => dayStats[t.dayOfWeek]!.wins++);

  console.log('Day       | Wins | Losses | Win Rate | Net');
  console.log('─'.repeat(55));

  for (let d = 0; d < 7; d++) {
    const stats = dayStats[d]!;
    const total = stats.wins + stats.losses;
    if (total === 0) continue;

    const winRate = stats.wins / total * 100;
    const net = stats.wins - stats.losses;

    console.log(`${dayNames[d]!.padEnd(9)} | ${stats.wins.toString().padStart(4)} | ${stats.losses.toString().padStart(6)} | ${winRate.toFixed(1).padStart(5)}% | ${net >= 0 ? '+' : ''}${net}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 3: Trade Duration
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('⏱️  ANALYSIS BY TRADE DURATION (bars)');
  console.log('═'.repeat(70));

  const durationBuckets = [
    { name: 'Very Quick (1-3)', min: 1, max: 3 },
    { name: 'Quick (4-10)', min: 4, max: 10 },
    { name: 'Medium (11-30)', min: 11, max: 30 },
    { name: 'Long (31-60)', min: 31, max: 60 },
    { name: 'Very Long (60+)', min: 61, max: Infinity },
  ];

  console.log('Duration       | Wins | Losses | Win Rate');
  console.log('─'.repeat(50));

  for (const bucket of durationBuckets) {
    const bucketWins = winAnalyses.filter(t => t.duration >= bucket.min && t.duration <= bucket.max).length;
    const bucketLosses = lossAnalyses.filter(t => t.duration >= bucket.min && t.duration <= bucket.max).length;
    const total = bucketWins + bucketLosses;

    if (total === 0) continue;

    const winRate = bucketWins / total * 100;
    console.log(`${bucket.name.padEnd(14)} | ${bucketWins.toString().padStart(4)} | ${bucketLosses.toString().padStart(6)} | ${winRate.toFixed(1).padStart(5)}%`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 4: Direction Bias
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('↕️  ANALYSIS BY DIRECTION');
  console.log('═'.repeat(70));

  const buyWins = wins.filter(t => t.direction === 'BUY').length;
  const buyLosses = losses.filter(t => t.direction === 'BUY').length;
  const sellWins = wins.filter(t => t.direction === 'SELL').length;
  const sellLosses = losses.filter(t => t.direction === 'SELL').length;

  const buyTotal = buyWins + buyLosses;
  const sellTotal = sellWins + sellLosses;

  console.log(`BUY:  ${buyWins} wins, ${buyLosses} losses (${(buyWins / buyTotal * 100).toFixed(1)}% win rate)`);
  console.log(`SELL: ${sellWins} wins, ${sellLosses} losses (${(sellWins / sellTotal * 100).toFixed(1)}% win rate)`);

  if (Math.abs(buyWins / buyTotal - sellWins / sellTotal) > 0.05) {
    const better = buyWins / buyTotal > sellWins / sellTotal ? 'BUY' : 'SELL';
    console.log(`\n⚠️  Direction bias detected: ${better} trades perform better`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 5: Quick Losses
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('⚡ QUICK LOSSES ANALYSIS (lost in ≤3 bars)');
  console.log('═'.repeat(70));

  const quickLosses = lossAnalyses.filter(t => t.quickLoss);
  console.log(`Quick losses: ${quickLosses.length} (${(quickLosses.length / losses.length * 100).toFixed(1)}% of all losses)`);

  if (quickLosses.length > 0) {
    const avgQuickLossPnl = quickLosses.reduce((sum, t) => sum + t.pnl, 0) / quickLosses.length;
    console.log(`Average quick loss P&L: $${avgQuickLossPnl.toFixed(2)}`);

    // Hour distribution of quick losses
    const quickLossHours: { [h: number]: number } = {};
    quickLosses.forEach(t => {
      quickLossHours[t.hourOfDay] = (quickLossHours[t.hourOfDay] || 0) + 1;
    });

    const sortedHours = Object.entries(quickLossHours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    console.log('\nTop hours for quick losses:');
    sortedHours.forEach(([hour, count]) => {
      console.log(`  ${hour.padStart(2, '0')}:00 UTC - ${count} quick losses`);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 6: Consecutive Losses
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('📉 CONSECUTIVE LOSSES ANALYSIS');
  console.log('═'.repeat(70));

  let currentStreak = 0;
  let maxStreak = 0;
  const streaks: number[] = [];

  trades.forEach(trade => {
    if (trade.pnl < 0) {
      currentStreak++;
    } else {
      if (currentStreak > 0) {
        streaks.push(currentStreak);
        maxStreak = Math.max(maxStreak, currentStreak);
      }
      currentStreak = 0;
    }
  });
  if (currentStreak > 0) streaks.push(currentStreak);

  const streakCounts: { [s: number]: number } = {};
  streaks.forEach(s => {
    streakCounts[s] = (streakCounts[s] || 0) + 1;
  });

  console.log(`Max consecutive losses: ${maxStreak}`);
  console.log('\nLoss streak distribution:');
  Object.entries(streakCounts)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([streak, count]) => {
      console.log(`  ${streak} losses in a row: ${count} times`);
    });

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSIS 7: Loss Size Distribution
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('💰 LOSS SIZE DISTRIBUTION');
  console.log('═'.repeat(70));

  const lossPnls = losses.map(t => Math.abs(t.pnl)).sort((a, b) => a - b);
  const avgLoss = lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length;
  const medianLoss = lossPnls[Math.floor(lossPnls.length / 2)]!;
  const maxLoss = lossPnls[lossPnls.length - 1]!;
  const minLoss = lossPnls[0]!;

  console.log(`Average loss: $${avgLoss.toFixed(2)}`);
  console.log(`Median loss: $${medianLoss.toFixed(2)}`);
  console.log(`Smallest loss: $${minLoss.toFixed(2)}`);
  console.log(`Largest loss: $${maxLoss.toFixed(2)}`);

  // Compare to wins
  const winPnls = wins.map(t => t.pnl).sort((a, b) => a - b);
  const avgWin = winPnls.reduce((a, b) => a + b, 0) / winPnls.length;

  console.log(`\nAverage win: $${avgWin.toFixed(2)}`);
  console.log(`Win/Loss ratio: ${(avgWin / avgLoss).toFixed(2)}:1`);

  // ══════════════════════════════════════════════════════════════════════
  // RECOMMENDATIONS
  // ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('💡 RECOMMENDATIONS');
  console.log('═'.repeat(70));

  const recommendations: string[] = [];

  // Hour-based filtering
  if (badHours.length > 0) {
    recommendations.push(`Consider avoiding trades during hours: ${badHours.map(h => `${h}:00`).join(', ')} UTC`);
  }

  // Quick losses
  if (quickLosses.length > losses.length * 0.15) {
    recommendations.push('High quick-loss rate suggests entries may be too aggressive. Consider:');
    recommendations.push('  - Increasing requireConfirmation to true');
    recommendations.push('  - Widening stopLossBufferPct slightly');
  }

  // Direction bias
  const buyWinRate = buyWins / buyTotal;
  const sellWinRate = sellWins / sellTotal;
  if (Math.abs(buyWinRate - sellWinRate) > 0.08) {
    const worse = buyWinRate < sellWinRate ? 'BUY' : 'SELL';
    recommendations.push(`${worse} trades underperform. Consider adding trend filter to avoid counter-trend entries.`);
  }

  // Consecutive losses
  if (maxStreak >= 6) {
    recommendations.push(`Max ${maxStreak} consecutive losses detected. Current dynamic cooldown may need adjustment.`);
  }

  // Win/Loss ratio
  if (avgWin / avgLoss < 1.2) {
    recommendations.push('Win/Loss ratio is low. Consider:');
    recommendations.push('  - Increasing takeProfitRR from 1.5 to 1.8-2.0');
    recommendations.push('  - Tightening entry conditions for higher quality setups');
  }

  if (recommendations.length === 0) {
    console.log('✅ No major issues detected. Strategy appears well-calibrated.');
  } else {
    recommendations.forEach((rec, i) => {
      console.log(`${i + 1}. ${rec}`);
    });
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('✅ Analysis complete!');
  console.log('═'.repeat(70));
}

main().catch(console.error);
