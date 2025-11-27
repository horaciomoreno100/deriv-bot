#!/usr/bin/env tsx
/**
 * Test BB_BOUNCE with RSI extreme filter
 * Test different RSI thresholds to improve win rate
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
  console.log('🧪 BB_BOUNCE - TEST DE FILTRO RSI EXTREMO');
  console.log('='.repeat(80));
  console.log('Objetivo: Mejorar Win Rate usando RSI extremo como filtro\n');

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

  // Baseline: TEST 4 con TP 0.75%
  const baselineParams: Partial<BBBounceParams> = {
    slBuffer: 0.3,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0075, // 0.75%
  };

  const rsiTests = [
    {
      name: 'BASELINE (Sin filtro RSI)',
      params: baselineParams,
    },
    {
      name: 'RSI < 40 / > 60',
      params: {
        ...baselineParams,
        rsiOversold: 40,
        rsiOverbought: 60,
      },
    },
    {
      name: 'RSI < 35 / > 65',
      params: {
        ...baselineParams,
        rsiOversold: 35,
        rsiOverbought: 65,
      },
    },
    {
      name: 'RSI < 30 / > 70',
      params: {
        ...baselineParams,
        rsiOversold: 30,
        rsiOverbought: 70,
      },
    },
    {
      name: 'RSI < 25 / > 75',
      params: {
        ...baselineParams,
        rsiOversold: 25,
        rsiOverbought: 75,
      },
    },
    {
      name: 'RSI < 20 / > 80',
      params: {
        ...baselineParams,
        rsiOversold: 20,
        rsiOverbought: 80,
      },
    },
  ];

  const results: Array<{
    name: string;
    metrics: any;
    finalBalance: number;
    roi: number;
  }> = [];

  for (const test of rsiTests) {
    console.log(`\n📊 Running: ${test.name}...`);
    const result = await runMRBacktest('BB_BOUNCE', baseConfig, test.params);
    
    const finalBalance = baseConfig.initialBalance + result.metrics.netPnl;
    const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;

    results.push({
      name: test.name,
      metrics: result.metrics,
      finalBalance,
      roi,
    });
  }

  // Print comparison
  console.log('\n' + '='.repeat(100));
  console.log('📊 COMPARACIÓN DE FILTROS RSI');
  console.log('='.repeat(100));
  console.log('\n' +
    'Filtro RSI'.padEnd(30) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(12) +
    'ROI%'.padStart(10) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10) +
    'Ratio'.padStart(8) +
    'Expectancy'.padStart(12)
  );
  console.log('-'.repeat(100));

  const baseline = results[0]!;
  for (const result of results) {
    const { name, metrics, finalBalance, roi } = result;
    const ratio = (metrics.avgWin / metrics.avgLoss).toFixed(2);
    const wrChange = metrics.winRate - baseline.metrics.winRate;
    const tradesChange = metrics.totalTrades - baseline.metrics.totalTrades;
    
    const wrChangeStr = wrChange >= 0 ? `+${wrChange.toFixed(1)}%` : `${wrChange.toFixed(1)}%`;
    const tradesChangeStr = tradesChange >= 0 ? `+${tradesChange}` : `${tradesChange}`;
    
    console.log(
      name.padEnd(30) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      metrics.profitFactor.toFixed(2).padStart(8) +
      `$${metrics.netPnl.toFixed(2)}`.padStart(12) +
      `${roi.toFixed(1)}%`.padStart(10) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10) +
      ratio.padStart(8) +
      `$${metrics.expectancy.toFixed(2)}`.padStart(12)
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(100));
  console.log('💡 ANÁLISIS');
  console.log('='.repeat(100));

  const bestWR = results.reduce((best, r) => r.metrics.winRate > best.metrics.winRate ? r : best);
  const bestROI = results.reduce((best, r) => r.roi > best.roi ? r : best);
  const bestExpectancy = results.reduce((best, r) => r.metrics.expectancy > best.metrics.expectancy ? r : best);
  const bestPF = results.reduce((best, r) => r.metrics.profitFactor > best.metrics.profitFactor ? r : best);

  console.log(`\n🏆 Mejor Win Rate: ${bestWR.name}`);
  console.log(`   WR: ${bestWR.metrics.winRate.toFixed(1)}% (vs ${baseline.metrics.winRate.toFixed(1)}% baseline)`);
  console.log(`   ROI: ${bestWR.roi.toFixed(1)}%`);
  console.log(`   Trades: ${bestWR.metrics.totalTrades}`);

  console.log(`\n🏆 Mejor ROI: ${bestROI.name}`);
  console.log(`   ROI: ${bestROI.roi.toFixed(1)}%`);
  console.log(`   WR: ${bestROI.metrics.winRate.toFixed(1)}%`);

  console.log(`\n🏆 Mejor Expectancy: ${bestExpectancy.name}`);
  console.log(`   Expectancy: $${bestExpectancy.metrics.expectancy.toFixed(2)}/trade`);

  console.log(`\n🏆 Mejor Profit Factor: ${bestPF.name}`);
  console.log(`   PF: ${bestPF.metrics.profitFactor.toFixed(2)}`);

  // Recommendations
  console.log('\n' + '='.repeat(100));
  console.log('📋 RECOMENDACIONES');
  console.log('='.repeat(100));

  const wrImprovements = results
    .filter(r => r.metrics.winRate > baseline.metrics.winRate)
    .sort((a, b) => b.metrics.winRate - a.metrics.winRate);

  if (wrImprovements.length > 0) {
    console.log('\n✅ Filtros RSI que mejoran Win Rate:');
    for (const r of wrImprovements) {
      const improvement = r.metrics.winRate - baseline.metrics.winRate;
      const tradesLost = baseline.metrics.totalTrades - r.metrics.totalTrades;
      console.log(`   ${r.name}: +${improvement.toFixed(1)}% WR (${tradesLost} trades menos)`);
    }
  } else {
    console.log('\n⚠️  Ningún filtro RSI mejoró el WR significativamente');
  }

  console.log('\n' + '='.repeat(100) + '\n');
}

main().catch(console.error);

