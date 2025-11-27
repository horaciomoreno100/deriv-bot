#!/usr/bin/env tsx
/**
 * Analyze winning/losing streaks in BB_BOUNCE
 * How are we "surfing" the streaks?
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import type { BBBounceParams } from '../strategies/mr/bb-bounce.strategy.js';

async function main() {
  const dataPath = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
  const asset = process.env.ASSET || 'frxEURUSD';

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 ANÁLISIS DE RACHAS - BB_BOUNCE');
  console.log('='.repeat(80) + '\n');

  const baseConfig: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance: 1000,
    stakePct: 0.02,
    multiplier: 500,
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: true,
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  const params: Partial<BBBounceParams> = {
    slBuffer: 0.3,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0075,
  };

  const result = await runMRBacktest('BB_BOUNCE', baseConfig, params);
  const trades = result.trades;

  // Analyze streaks
  interface Streak {
    type: 'WIN' | 'LOSS';
    length: number;
    startIndex: number;
    totalPnl: number;
  }

  const streaks: Streak[] = [];
  let currentStreak: Streak | null = null;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!;
    
    if (!currentStreak || currentStreak.type !== trade.result) {
      // Start new streak
      if (currentStreak) {
        streaks.push(currentStreak);
      }
      currentStreak = {
        type: trade.result,
        length: 1,
        startIndex: i,
        totalPnl: trade.pnl,
      };
    } else {
      // Continue streak
      currentStreak.length++;
      currentStreak.totalPnl += trade.pnl;
    }
  }
  if (currentStreak) {
    streaks.push(currentStreak);
  }

  // Analyze
  const winStreaks = streaks.filter(s => s.type === 'WIN');
  const lossStreaks = streaks.filter(s => s.type === 'LOSS');

  console.log('='.repeat(80));
  console.log('📊 ESTADÍSTICAS DE RACHAS');
  console.log('='.repeat(80));
  console.log(`\nTotal rachas: ${streaks.length}`);
  console.log(`  Rachas ganadoras: ${winStreaks.length}`);
  console.log(`  Rachas perdedoras: ${lossStreaks.length}`);
  console.log(`  Ratio: ${(winStreaks.length / lossStreaks.length).toFixed(2)}:1`);

  // Win streaks
  console.log('\n' + '='.repeat(80));
  console.log('✅ RACHAS GANADORAS');
  console.log('='.repeat(80));
  if (winStreaks.length > 0) {
    const maxWinStreak = Math.max(...winStreaks.map(s => s.length));
    const avgWinStreak = winStreaks.reduce((sum, s) => sum + s.length, 0) / winStreaks.length;
    const avgWinStreakPnl = winStreaks.reduce((sum, s) => sum + s.totalPnl, 0) / winStreaks.length;

    console.log(`  Máxima racha ganadora: ${maxWinStreak} trades`);
    console.log(`  Promedio de racha ganadora: ${avgWinStreak.toFixed(1)} trades`);
    console.log(`  P&L promedio por racha ganadora: $${avgWinStreakPnl.toFixed(2)}`);

    // Distribution
    const winStreakDist: Record<number, number> = {};
    for (const streak of winStreaks) {
      winStreakDist[streak.length] = (winStreakDist[streak.length] || 0) + 1;
    }

    console.log('\n  Distribución de rachas ganadoras:');
    for (const [length, count] of Object.entries(winStreakDist).sort((a, b) => parseInt(b) - parseInt(a))) {
      const pct = (count / winStreaks.length) * 100;
      console.log(`    ${length} trade(s): ${count} rachas (${pct.toFixed(1)}%)`);
    }
  }

  // Loss streaks
  console.log('\n' + '='.repeat(80));
  console.log('❌ RACHAS PERDEDORAS');
  console.log('='.repeat(80));
  if (lossStreaks.length > 0) {
    const maxLossStreak = Math.max(...lossStreaks.map(s => s.length));
    const avgLossStreak = lossStreaks.reduce((sum, s) => sum + s.length, 0) / lossStreaks.length;
    const avgLossStreakPnl = lossStreaks.reduce((sum, s) => sum + s.totalPnl, 0) / lossStreaks.length;

    console.log(`  Máxima racha perdedora: ${maxLossStreak} trades`);
    console.log(`  Promedio de racha perdedora: ${avgLossStreak.toFixed(1)} trades`);
    console.log(`  P&L promedio por racha perdedora: $${avgLossStreakPnl.toFixed(2)}`);

    // Distribution
    const lossStreakDist: Record<number, number> = {};
    for (const streak of lossStreaks) {
      lossStreakDist[streak.length] = (lossStreakDist[streak.length] || 0) + 1;
    }

    console.log('\n  Distribución de rachas perdedoras:');
    for (const [length, count] of Object.entries(lossStreakDist).sort((a, b) => parseInt(b) - parseInt(a))) {
      const pct = (count / lossStreaks.length) * 100;
      console.log(`    ${length} trade(s): ${count} rachas (${pct.toFixed(1)}%)`);
    }
  }

  // Equity curve analysis
  console.log('\n' + '='.repeat(80));
  console.log('📈 ANÁLISIS DE CURVA DE EQUITY');
  console.log('='.repeat(80));

  let equity = baseConfig.initialBalance;
  let peak = equity;
  const equityCurve: Array<{ trade: number; equity: number; streak: number; streakType: 'WIN' | 'LOSS' }> = [];
  let currentStreakLength = 0;
  let currentStreakType: 'WIN' | 'LOSS' | null = null;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!;
    equity += trade.pnl;
    peak = Math.max(peak, equity);

    if (trade.result === currentStreakType) {
      currentStreakLength++;
    } else {
      currentStreakLength = 1;
      currentStreakType = trade.result;
    }

    equityCurve.push({
      trade: i + 1,
      equity,
      streak: currentStreakLength,
      streakType: currentStreakType,
    });
  }

  // Find worst drawdown periods
  let maxDD = 0;
  let maxDDStart = 0;
  let maxDDEnd = 0;
  let currentPeak = baseConfig.initialBalance;
  let currentPeakIndex = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    const point = equityCurve[i]!;
    if (point.equity > currentPeak) {
      currentPeak = point.equity;
      currentPeakIndex = i;
    }
    const dd = currentPeak - point.equity;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDStart = currentPeakIndex;
      maxDDEnd = i;
    }
  }

  console.log(`\n  Peor drawdown: $${maxDD.toFixed(2)} (${((maxDD / baseConfig.initialBalance) * 100).toFixed(1)}%)`);
  console.log(`  Ocurrió entre trade ${maxDDStart + 1} y ${maxDDEnd + 1}`);
  
  const ddStreaks = equityCurve.slice(maxDDStart, maxDDEnd + 1);
  const ddWinStreaks = ddStreaks.filter(p => p.streakType === 'WIN').length;
  const ddLossStreaks = ddStreaks.filter(p => p.streakType === 'LOSS').length;
  console.log(`  Durante este período: ${ddWinStreaks} rachas ganadoras, ${ddLossStreaks} rachas perdedoras`);

  // Recovery analysis
  console.log('\n' + '='.repeat(80));
  console.log('🔄 ANÁLISIS DE RECUPERACIÓN');
  console.log('='.repeat(80));

  const recoveryPeriods: Array<{ from: number; to: number; trades: number; pnl: number }> = [];
  let inDrawdown = false;
  let drawdownStart = 0;
  let drawdownPeak = baseConfig.initialBalance;

  for (let i = 0; i < equityCurve.length; i++) {
    const point = equityCurve[i]!;
    if (point.equity < drawdownPeak * 0.95) { // 5% drawdown
      if (!inDrawdown) {
        inDrawdown = true;
        drawdownStart = i;
      }
    } else if (inDrawdown && point.equity >= drawdownPeak) {
      // Recovered
      recoveryPeriods.push({
        from: drawdownStart,
        to: i,
        trades: i - drawdownStart,
        pnl: point.equity - equityCurve[drawdownStart]!.equity,
      });
      inDrawdown = false;
      drawdownPeak = point.equity;
    }
    if (point.equity > drawdownPeak) {
      drawdownPeak = point.equity;
    }
  }

  if (recoveryPeriods.length > 0) {
    const avgRecoveryTrades = recoveryPeriods.reduce((sum, r) => sum + r.trades, 0) / recoveryPeriods.length;
    console.log(`\n  Períodos de recuperación: ${recoveryPeriods.length}`);
    console.log(`  Trades promedio para recuperar: ${avgRecoveryTrades.toFixed(1)}`);
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch(console.error);

