#!/usr/bin/env tsx
/**
 * Analyze potential improvements for BB_BOUNCE
 * Test different filters and conditions to improve win rate and value
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
  console.log('🔍 ANÁLISIS DE MEJORAS - BB_BOUNCE');
  console.log('='.repeat(80));
  console.log('Objetivo: Mejorar Win Rate y Valor por trade\n');

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

  const tests = [
    {
      name: 'BASELINE (TP 0.75%)',
      params: baselineParams,
    },
    {
      name: 'TEST 1: Require Rejection Candle',
      params: {
        ...baselineParams,
        requireRejection: true, // Más selectivo
      },
    },
    {
      name: 'TEST 2: Require Clean Approach',
      params: {
        ...baselineParams,
        requireCleanApproach: true, // Más selectivo
      },
    },
    {
      name: 'TEST 3: Ambos filtros (Rejection + Clean)',
      params: {
        ...baselineParams,
        requireRejection: true,
        requireCleanApproach: true,
      },
    },
    {
      name: 'TEST 4: ADX más estricto (< 25)',
      params: {
        ...baselineParams,
        adxThreshold: 25, // Solo rangos más claros
      },
    },
    {
      name: 'TEST 5: ADX más estricto + Rejection',
      params: {
        ...baselineParams,
        adxThreshold: 25,
        requireRejection: true,
      },
    },
    {
      name: 'TEST 6: TP 1.0% (mayor valor)',
      params: {
        ...baselineParams,
        takeProfitPct: 0.01, // 1.0%
      },
    },
    {
      name: 'TEST 7: TP 1.0% + Filtros estrictos',
      params: {
        ...baselineParams,
        takeProfitPct: 0.01,
        adxThreshold: 25,
        requireRejection: true,
        requireCleanApproach: true,
      },
    },
  ];

  const results: Array<{
    name: string;
    metrics: any;
    finalBalance: number;
    roi: number;
  }> = [];

  for (const test of tests) {
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
  console.log('📊 COMPARACIÓN DE MEJORAS');
  console.log('='.repeat(100));
  console.log('\n' +
    'Test'.padEnd(35) +
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
    const roiChange = roi - baseline.roi;
    
    const wrChangeStr = wrChange >= 0 ? `+${wrChange.toFixed(1)}%` : `${wrChange.toFixed(1)}%`;
    const roiChangeStr = roiChange >= 0 ? `+${roiChange.toFixed(1)}%` : `${roiChange.toFixed(1)}%`;
    
    console.log(
      name.padEnd(35) +
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
  console.log('💡 ANÁLISIS DE MEJORAS');
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
  console.log(`   Net P&L: $${bestROI.metrics.netPnl.toFixed(2)}`);

  console.log(`\n🏆 Mejor Expectancy: ${bestExpectancy.name}`);
  console.log(`   Expectancy: $${bestExpectancy.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`   ROI: ${bestExpectancy.roi.toFixed(1)}%`);

  console.log(`\n🏆 Mejor Profit Factor: ${bestPF.name}`);
  console.log(`   PF: ${bestPF.metrics.profitFactor.toFixed(2)}`);
  console.log(`   ROI: ${bestPF.roi.toFixed(1)}%`);

  // Recommendations
  console.log('\n' + '='.repeat(100));
  console.log('📋 RECOMENDACIONES');
  console.log('='.repeat(100));

  console.log('\n1. Para mejorar Win Rate:');
  const wrImprovements = results
    .filter(r => r.metrics.winRate > baseline.metrics.winRate)
    .sort((a, b) => b.metrics.winRate - a.metrics.winRate)
    .slice(0, 3);
  
  if (wrImprovements.length > 0) {
    for (const r of wrImprovements) {
      const improvement = r.metrics.winRate - baseline.metrics.winRate;
      console.log(`   ✅ ${r.name}: +${improvement.toFixed(1)}% WR`);
    }
  } else {
    console.log('   ⚠️  Ningún test mejoró el WR significativamente');
  }

  console.log('\n2. Para mejorar ROI/Valor:');
  const roiImprovements = results
    .filter(r => r.roi > baseline.roi)
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 3);
  
  if (roiImprovements.length > 0) {
    for (const r of roiImprovements) {
      const improvement = r.roi - baseline.roi;
      console.log(`   ✅ ${r.name}: +${improvement.toFixed(1)}% ROI`);
    }
  }

  console.log('\n3. Próximos pasos sugeridos:');
  console.log('   - Implementar filtro RSI (solo entrar en extremos)');
  console.log('   - Agregar filtro de volumen (solo en alta liquidez)');
  console.log('   - Probar trailing stops');
  console.log('   - Implementar MTF (multi-timeframe) para confirmación');
  console.log('   - Analizar mejores horas/días para trading');

  console.log('\n' + '='.repeat(100) + '\n');
}

main().catch(console.error);

