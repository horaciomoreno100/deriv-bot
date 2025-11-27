#!/usr/bin/env tsx
/**
 * Test fixes for low win rate in BB_BOUNCE
 * Focus: Reduce immediate reversals, balance TP/SL
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
  console.log('🔧 FIXES PARA MEJORAR WIN RATE');
  console.log('='.repeat(80));
  console.log('Problemas identificados:');
  console.log('  - 54.9% immediate reversals (≤3 barras)');
  console.log('  - 89.6% pérdidas por SL');
  console.log('  - Solo 0.3% alcanzan TP');
  console.log('  - SL muy cerca (0.045%), TP muy lejos (0.75%)');
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

  const tests = [
    {
      name: 'BASELINE (TP 0.75%, SL 0.3×ATR)',
      params: {
        slBuffer: 0.3,
        requireRejection: false,
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.0075,
      },
      config: baseConfig,
    },
    {
      name: 'FIX 1: TP 0.3% (más alcanzable)',
      params: {
        slBuffer: 0.3,
        requireRejection: false,
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.003, // Reducir TP
      },
      config: { ...baseConfig, takeProfitPct: 0.003 },
    },
    {
      name: 'FIX 2: SL 0.5×ATR (más espacio)',
      params: {
        slBuffer: 0.5, // Aumentar SL buffer
        requireRejection: false,
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.0075,
      },
      config: baseConfig,
    },
    {
      name: 'FIX 3: TP 0.3% + SL 0.5×ATR',
      params: {
        slBuffer: 0.5,
        requireRejection: false,
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.003,
      },
      config: { ...baseConfig, takeProfitPct: 0.003 },
    },
    {
      name: 'FIX 4: Require Rejection (mejor entrada)',
      params: {
        slBuffer: 0.3,
        requireRejection: true, // Más selectivo
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.003,
      },
      config: { ...baseConfig, takeProfitPct: 0.003 },
    },
    {
      name: 'FIX 5: Rejection + SL 0.5×ATR',
      params: {
        slBuffer: 0.5,
        requireRejection: true,
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.003,
      },
      config: { ...baseConfig, takeProfitPct: 0.003 },
    },
    {
      name: 'FIX 6: TP 0.5% + SL 0.5×ATR + Rejection',
      params: {
        slBuffer: 0.5,
        requireRejection: true,
        requireCleanApproach: false,
        adxThreshold: 30,
        takeProfitPct: 0.005, // TP intermedio
      },
      config: { ...baseConfig, takeProfitPct: 0.005 },
    },
  ];

  const results: Array<{
    name: string;
    metrics: any;
    roi: number;
  }> = [];

  for (const test of tests) {
    console.log(`\n📊 Running: ${test.name}...`);
    const result = await runMRBacktest('BB_BOUNCE', test.config, test.params);
    const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;
    results.push({ name: test.name, metrics: result.metrics, roi });
  }

  // Print comparison
  console.log('\n' + '='.repeat(100));
  console.log('📊 COMPARACIÓN DE FIXES');
  console.log('='.repeat(100));
  console.log('\n' +
    'Fix'.padEnd(40) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(12) +
    'ROI%'.padStart(10) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10) +
    'Immed Rev%'.padStart(12)
  );
  console.log('-'.repeat(100));

  const baseline = results[0]!;
  for (const result of results) {
    const { name, metrics, roi } = result;
    const immediateReversals = metrics.immediateReversals || 0;
    const immRevPct = metrics.losses > 0 ? ((immediateReversals / metrics.losses) * 100).toFixed(1) : '0.0';
    const wrChange = metrics.winRate - baseline.metrics.winRate;
    const wrChangeStr = wrChange >= 0 ? `+${wrChange.toFixed(1)}%` : `${wrChange.toFixed(1)}%`;
    
    console.log(
      name.padEnd(40) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      metrics.profitFactor.toFixed(2).padStart(8) +
      `$${metrics.netPnl.toFixed(2)}`.padStart(12) +
      `${roi.toFixed(1)}%`.padStart(10) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10) +
      `${immRevPct}%`.padStart(12)
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(100));
  console.log('💡 ANÁLISIS');
  console.log('='.repeat(100));

  const bestWR = results.reduce((best, r) => r.metrics.winRate > best.metrics.winRate ? r : best);
  const bestROI = results.reduce((best, r) => r.roi > best.roi ? r : best);
  const lowestImmRev = results.reduce((best, r) => {
    const immRev = r.metrics.immediateReversals || 0;
    const bestImmRev = best.metrics.immediateReversals || 0;
    return immRev < bestImmRev ? r : best;
  });

  console.log(`\n🏆 Mejor Win Rate: ${bestWR.name}`);
  console.log(`   WR: ${bestWR.metrics.winRate.toFixed(1)}%`);
  console.log(`   ROI: ${bestWR.roi.toFixed(1)}%`);

  console.log(`\n🏆 Mejor ROI: ${bestROI.name}`);
  console.log(`   ROI: ${bestROI.roi.toFixed(1)}%`);
  console.log(`   WR: ${bestROI.metrics.winRate.toFixed(1)}%`);

  console.log(`\n🏆 Menos Immediate Reversals: ${lowestImmRev.name}`);
  const immRev = lowestImmRev.metrics.immediateReversals || 0;
  const immRevPct = lowestImmRev.metrics.losses > 0 ? ((immRev / lowestImmRev.metrics.losses) * 100).toFixed(1) : '0.0';
  console.log(`   Immediate Reversals: ${immRevPct}%`);

  console.log('\n' + '='.repeat(100) + '\n');
}

main().catch(console.error);

