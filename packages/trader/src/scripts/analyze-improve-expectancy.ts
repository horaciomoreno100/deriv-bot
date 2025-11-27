#!/usr/bin/env tsx
/**
 * Analyze how to improve mathematical expectation (expectancy)
 * Test different approaches to increase expectancy per trade
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
  console.log('📈 ANÁLISIS: Cómo Aumentar la Esperanza Matemática');
  console.log('='.repeat(80));
  console.log('\nFórmula: Expectancy = (WR% × Avg Win) - ((1-WR%) × Avg Loss)');
  console.log('Objetivo: Maximizar la ganancia promedio por trade\n');

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

  // Baseline
  const baselineParams: Partial<BBBounceParams> = {
    slBuffer: 0.3,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0075, // 0.75%
  };

  const tests = [
    {
      name: 'BASELINE',
      params: baselineParams,
      goal: 'Baseline actual',
    },
    {
      name: 'TP 0.5% (aumentar frecuencia de TP)',
      params: {
        ...baselineParams,
        takeProfitPct: 0.005, // TP más alcanzable
      },
      goal: 'Aumentar % de trades que alcanzan TP',
    },
    {
      name: 'TP 0.3% (más alcanzable)',
      params: {
        ...baselineParams,
        takeProfitPct: 0.003,
      },
      goal: 'Maximizar % de trades que alcanzan TP',
    },
    {
      name: 'SL 0.2×ATR (reducir pérdidas)',
      params: {
        ...baselineParams,
        slBuffer: 0.2, // SL más cerca = pérdidas más pequeñas
      },
      goal: 'Reducir avg loss',
    },
    {
      name: 'TP 0.5% + SL 0.2×ATR',
      params: {
        ...baselineParams,
        takeProfitPct: 0.005,
        slBuffer: 0.2,
      },
      goal: 'Mejorar ratio Win/Loss',
    },
    {
      name: 'Require Rejection (mejor WR)',
      params: {
        ...baselineParams,
        requireRejection: true,
        takeProfitPct: 0.005,
      },
      goal: 'Aumentar win rate',
    },
    {
      name: 'Rejection + TP 0.5% + SL 0.2×ATR',
      params: {
        ...baselineParams,
        requireRejection: true,
        takeProfitPct: 0.005,
        slBuffer: 0.2,
      },
      goal: 'Combinación: mejor WR + mejor ratio',
    },
  ];

  const results: Array<{
    name: string;
    goal: string;
    metrics: any;
    expectancy: number;
    roi: number;
  }> = [];

  for (const test of tests) {
    console.log(`\n📊 Testing: ${test.name}...`);
    
    const config: MRBacktestConfig = {
      ...baseConfig,
      takeProfitPct: test.params.takeProfitPct || baseConfig.takeProfitPct,
    };

    const result = await runMRBacktest('BB_BOUNCE', config, test.params);
    const expectancy = result.metrics.expectancy;
    const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;

    results.push({
      name: test.name,
      goal: test.goal,
      metrics: result.metrics,
      expectancy,
      roi,
    });
  }

  // Print comparison
  console.log('\n' + '='.repeat(110));
  console.log('📊 COMPARACIÓN: Esperanza Matemática');
  console.log('='.repeat(110));
  console.log('\n' +
    'Configuración'.padEnd(40) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10) +
    'Ratio'.padStart(8) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10)
  );
  console.log('-'.repeat(110));

  const baseline = results[0]!;
  for (const result of results) {
    const { name, metrics, expectancy, roi } = result;
    const ratio = (metrics.avgWin / metrics.avgLoss).toFixed(2);
    const expChange = expectancy - baseline.expectancy;
    const expChangeStr = expChange >= 0 ? `+$${expChange.toFixed(2)}` : `$${expChange.toFixed(2)}`;
    
    console.log(
      name.padEnd(40) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10) +
      ratio.padStart(8) +
      `$${expectancy.toFixed(2)}`.padStart(12) +
      `${roi.toFixed(1)}%`.padStart(10) +
      ` (${expChangeStr})`.padStart(12)
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(110));
  console.log('💡 ANÁLISIS');
  console.log('='.repeat(110));

  const bestExpectancy = results.reduce((best, r) => r.expectancy > best.expectancy ? r : best);
  const bestROI = results.reduce((best, r) => r.roi > best.roi ? r : best);

  console.log(`\n🏆 Mejor Expectancy: ${bestExpectancy.name}`);
  console.log(`   Expectancy: $${bestExpectancy.expectancy.toFixed(2)}/trade`);
  console.log(`   Objetivo: ${bestExpectancy.goal}`);
  console.log(`   WR: ${bestExpectancy.metrics.winRate.toFixed(1)}%`);
  console.log(`   Ratio: ${(bestExpectancy.metrics.avgWin / bestExpectancy.metrics.avgLoss).toFixed(2)}:1`);
  console.log(`   ROI: ${bestExpectancy.roi.toFixed(1)}%`);

  console.log(`\n🏆 Mejor ROI: ${bestROI.name}`);
  console.log(`   ROI: ${bestROI.roi.toFixed(1)}%`);
  console.log(`   Expectancy: $${bestROI.expectancy.toFixed(2)}/trade`);

  // Calculate impact
  console.log('\n' + '='.repeat(110));
  console.log('📈 IMPACTO ANUAL');
  console.log('='.repeat(110));

  for (const result of results) {
    const annualImpact = result.expectancy * result.metrics.totalTrades;
    const improvement = (result.expectancy - baseline.expectancy) * result.metrics.totalTrades;
    console.log(`\n${result.name}:`);
    console.log(`  Expectancy: $${result.expectancy.toFixed(2)}/trade × ${result.metrics.totalTrades} trades = $${annualImpact.toFixed(2)}/año`);
    if (improvement !== 0) {
      console.log(`  Mejora vs baseline: $${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}/año`);
    }
  }

  console.log('\n' + '='.repeat(110) + '\n');
}

main().catch(console.error);

