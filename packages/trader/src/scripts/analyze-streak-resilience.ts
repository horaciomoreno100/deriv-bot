#!/usr/bin/env tsx
/**
 * Analyze which configurations handle losing streaks better
 * Focus on reducing max consecutive losses and improving recovery
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import type { BBBounceParams } from '../strategies/mr/bb-bounce.strategy.js';

interface StreakMetrics {
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgWinStreak: number;
  avgLossStreak: number;
  worstDrawdown: number;
  recoveryTrades: number;
  streakResilience: number; // Custom score: lower max losses + faster recovery
}

async function testConfiguration(
  name: string,
  config: MRBacktestConfig,
  params: Partial<BBBounceParams>
): Promise<{ name: string; metrics: any; streaks: StreakMetrics }> {
  const result = await runMRBacktest('BB_BOUNCE', config, params);
  const trades = result.trades;

  // Analyze streaks
  let currentStreak = 0;
  let currentType: 'WIN' | 'LOSS' | null = null;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  const winStreaks: number[] = [];
  const lossStreaks: number[] = [];

  for (const trade of trades) {
    if (trade.result === currentType) {
      currentStreak++;
    } else {
      if (currentStreak > 0 && currentType) {
        if (currentType === 'WIN') {
          winStreaks.push(currentStreak);
        } else {
          lossStreaks.push(currentStreak);
        }
      }
      currentStreak = 1;
      currentType = trade.result;
    }

    if (trade.result === 'WIN') {
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentStreak);
    } else {
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
    }
  }

  // Calculate recovery
  let equity = config.initialBalance;
  let peak = equity;
  let maxDD = 0;
  let recoveryTrades = 0;
  let inDrawdown = false;
  let drawdownStart = 0;

  for (let i = 0; i < trades.length; i++) {
    equity += trades[i]!.pnl;
    if (equity > peak) {
      peak = equity;
      if (inDrawdown) {
        recoveryTrades += i - drawdownStart;
        inDrawdown = false;
      }
    }
    const dd = peak - equity;
    if (dd > maxDD) {
      maxDD = dd;
    }
    if (equity < peak * 0.95 && !inDrawdown) {
      inDrawdown = true;
      drawdownStart = i;
    }
  }

  const avgWinStreak = winStreaks.length > 0 ? winStreaks.reduce((a, b) => a + b, 0) / winStreaks.length : 0;
  const avgLossStreak = lossStreaks.length > 0 ? lossStreaks.reduce((a, b) => a + b, 0) / lossStreaks.length : 0;

  // Resilience score: lower is better (fewer max losses, faster recovery)
  const streakResilience = maxConsecutiveLosses + (recoveryTrades / 100);

  return {
    name,
    metrics: result.metrics,
    streaks: {
      maxConsecutiveWins,
      maxConsecutiveLosses,
      avgWinStreak,
      avgLossStreak,
      worstDrawdown: (maxDD / config.initialBalance) * 100,
      recoveryTrades,
      streakResilience,
    },
  };
}

async function main() {
  const dataPath = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
  const asset = process.env.ASSET || 'frxEURUSD';

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🛡️  ANÁLISIS DE RESILIENCIA A RACHAS');
  console.log('='.repeat(80));
  console.log('Probando configuraciones que manejen mejor las rachas perdedoras\n');

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

  const configurations: Array<{ name: string; params: Partial<BBBounceParams> }> = [
    {
      name: 'Baseline',
      params: { slBuffer: 0.3, takeProfitPct: 0.0075, adxThreshold: 30 },
    },
    {
      name: 'Tighter SL (0.2×ATR)',
      params: { slBuffer: 0.2, takeProfitPct: 0.0075, adxThreshold: 30 },
    },
    {
      name: 'Wider SL (0.5×ATR)',
      params: { slBuffer: 0.5, takeProfitPct: 0.0075, adxThreshold: 30 },
    },
    {
      name: 'Smaller TP (0.5%)',
      params: { slBuffer: 0.3, takeProfitPct: 0.005, adxThreshold: 30 },
    },
    {
      name: 'Larger TP (1.0%)',
      params: { slBuffer: 0.3, takeProfitPct: 0.01, adxThreshold: 30 },
    },
    {
      name: 'Stricter ADX (<25)',
      params: { slBuffer: 0.3, takeProfitPct: 0.0075, adxThreshold: 25 },
    },
    {
      name: 'Require Rejection',
      params: { slBuffer: 0.3, takeProfitPct: 0.0075, adxThreshold: 30, requireRejection: true },
    },
    {
      name: 'Require Clean Approach',
      params: { slBuffer: 0.3, takeProfitPct: 0.0075, adxThreshold: 30, requireCleanApproach: true },
    },
    {
      name: 'Both Filters',
      params: { slBuffer: 0.3, takeProfitPct: 0.0075, adxThreshold: 30, requireRejection: true, requireCleanApproach: true },
    },
    {
      name: 'Tighter SL + Larger TP',
      params: { slBuffer: 0.2, takeProfitPct: 0.01, adxThreshold: 30 },
    },
    {
      name: 'Wider SL + Smaller TP',
      params: { slBuffer: 0.5, takeProfitPct: 0.005, adxThreshold: 30 },
    },
  ];

  const results: Array<{ name: string; metrics: any; streaks: StreakMetrics }> = [];

  for (const config of configurations) {
    process.stdout.write(`\rTesting: ${config.name}...`);
    const result = await testConfiguration(config.name, baseConfig, config.params);
    results.push(result);
  }

  console.log('\n\n' + '='.repeat(120));
  console.log('📊 RESULTADOS - RESILIENCIA A RACHAS');
  console.log('='.repeat(120));

  // Sort by resilience (lower is better)
  const sortedByResilience = [...results].sort((a, b) => a.streaks.streakResilience - b.streaks.streakResilience);
  const sortedByMaxLosses = [...results].sort((a, b) => a.streaks.maxConsecutiveLosses - b.streaks.maxConsecutiveLosses);
  const sortedByROI = [...results].filter(r => r.metrics.netPnl > 0).sort((a, b) => b.metrics.netPnl - a.metrics.netPnl);

  console.log('\n' + '='.repeat(120));
  console.log('🏆 TOP POR RESILIENCIA (menor max losses + recuperación más rápida)');
  console.log('='.repeat(120));
  console.log('\n' +
    'Config'.padEnd(25) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'ROI%'.padStart(10) +
    'Max W'.padStart(7) +
    'Max L'.padStart(7) +
    'Avg L'.padStart(8) +
    'DD%'.padStart(8) +
    'Recovery'.padStart(10) +
    'Resilience'.padStart(12)
  );
  console.log('-'.repeat(120));

  for (const r of sortedByResilience.slice(0, 10)) {
    const roi = (r.metrics.netPnl / baseConfig.initialBalance) * 100;
    console.log(
      r.name.padEnd(25) +
      r.metrics.totalTrades.toString().padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      `${roi.toFixed(1)}%`.padStart(10) +
      r.streaks.maxConsecutiveWins.toString().padStart(7) +
      r.streaks.maxConsecutiveLosses.toString().padStart(7) +
      r.streaks.avgLossStreak.toFixed(1).padStart(8) +
      `${r.streaks.worstDrawdown.toFixed(1)}%`.padStart(8) +
      r.streaks.recoveryTrades.toString().padStart(10) +
      r.streaks.streakResilience.toFixed(2).padStart(12)
    );
  }

  console.log('\n' + '='.repeat(120));
  console.log('🛡️  TOP POR MENOR MÁXIMA RACHA PERDEDORA');
  console.log('='.repeat(120));
  console.log('\n' +
    'Config'.padEnd(25) +
    'Max L'.padStart(7) +
    'Avg L'.padStart(8) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'ROI%'.padStart(10)
  );
  console.log('-'.repeat(120));

  for (const r of sortedByMaxLosses.slice(0, 10)) {
    const roi = (r.metrics.netPnl / baseConfig.initialBalance) * 100;
    console.log(
      r.name.padEnd(25) +
      r.streaks.maxConsecutiveLosses.toString().padStart(7) +
      r.streaks.avgLossStreak.toFixed(1).padStart(8) +
      r.metrics.totalTrades.toString().padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      `${roi.toFixed(1)}%`.padStart(10)
    );
  }

  console.log('\n' + '='.repeat(120));
  console.log('💰 TOP POR ROI (solo rentables)');
  console.log('='.repeat(120));
  console.log('\n' +
    'Config'.padEnd(25) +
    'ROI%'.padStart(10) +
    'Max L'.padStart(7) +
    'DD%'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8)
  );
  console.log('-'.repeat(120));

  for (const r of sortedByROI.slice(0, 10)) {
    const roi = (r.metrics.netPnl / baseConfig.initialBalance) * 100;
    console.log(
      r.name.padEnd(25) +
      `${roi.toFixed(1)}%`.padStart(10) +
      r.streaks.maxConsecutiveLosses.toString().padStart(7) +
      `${r.streaks.worstDrawdown.toFixed(1)}%`.padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      r.metrics.profitFactor.toFixed(2).padStart(8)
    );
  }

  console.log('\n' + '='.repeat(120) + '\n');
}

main().catch(console.error);

