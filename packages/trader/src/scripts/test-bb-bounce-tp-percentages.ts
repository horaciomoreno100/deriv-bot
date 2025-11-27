#!/usr/bin/env tsx
/**
 * Test BB_BOUNCE with different TP percentages
 * Balance: $1,000, Stake: 2%, Multiplier: 500x
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
  console.log('🧪 BB_BOUNCE - TEST DE TP PORCENTUALES');
  console.log('='.repeat(80));
  console.log('Configuración:');
  console.log('  Balance inicial: $1,000');
  console.log('  Stake: 2% por trade ($20)');
  console.log('  Multiplier: 500x');
  console.log('  Estrategia: TEST 4 (sin filtros restrictivos, ADX < 30)');
  console.log('='.repeat(80) + '\n');

  const tpPercentages = [
    undefined, // BB Middle (actual)
    0.003,     // 0.3%
    0.005,     // 0.5%
    0.0075,    // 0.75%
    0.01,      // 1.0%
  ];

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

  // TEST 4 params
  const baseStrategyParams: Partial<BBBounceParams> = {
    slBuffer: 0.3,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
  };

  const results: Array<{
    tpPct: number | undefined;
    tpLabel: string;
    metrics: any;
    finalBalance: number;
    roi: number;
  }> = [];

  for (const tpPct of tpPercentages) {
    const tpLabel = tpPct === undefined ? 'BB Middle' : `${(tpPct * 100).toFixed(2)}%`;
    console.log(`\n📊 Probando TP: ${tpLabel}...`);
    
    const strategyParams: Partial<BBBounceParams> = {
      ...baseStrategyParams,
      takeProfitPct: tpPct,
    };

    const result = await runMRBacktest('BB_BOUNCE', baseConfig, strategyParams);
    
    const finalBalance = baseConfig.initialBalance + result.metrics.netPnl;
    const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;

    results.push({
      tpPct,
      tpLabel,
      metrics: result.metrics,
      finalBalance,
      roi,
    });
  }

  // Print comparison
  console.log('\n' + '='.repeat(100));
  console.log('📊 COMPARACIÓN DE TP PORCENTUALES');
  console.log('='.repeat(100));
  console.log('\n' +
    'TP'.padEnd(15) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(12) +
    'ROI%'.padStart(10) +
    'Final $'.padStart(12) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10) +
    'Ratio'.padStart(8) +
    'Expectancy'.padStart(12)
  );
  console.log('-'.repeat(100));

  for (const result of results) {
    const { tpLabel, metrics, finalBalance, roi } = result;
    const ratio = (metrics.avgWin / metrics.avgLoss).toFixed(2);
    
    console.log(
      tpLabel.padEnd(15) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      metrics.profitFactor.toFixed(2).padStart(8) +
      `$${metrics.netPnl.toFixed(2)}`.padStart(12) +
      `${roi.toFixed(1)}%`.padStart(10) +
      `$${finalBalance.toFixed(2)}`.padStart(12) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10) +
      ratio.padStart(8) +
      `$${metrics.expectancy.toFixed(2)}`.padStart(12)
    );
  }

  // Find best
  console.log('\n' + '='.repeat(100));
  console.log('💡 ANÁLISIS');
  console.log('='.repeat(100));

  const bestROI = results.reduce((best, r) => r.roi > best.roi ? r : best);
  const bestPF = results.reduce((best, r) => r.metrics.profitFactor > best.metrics.profitFactor ? r : best);
  const bestExpectancy = results.reduce((best, r) => r.metrics.expectancy > best.metrics.expectancy ? r : best);

  console.log(`\n🏆 Mejor ROI: TP ${bestROI.tpLabel}`);
  console.log(`   ROI: ${bestROI.roi.toFixed(1)}%`);
  console.log(`   Net P&L: $${bestROI.metrics.netPnl.toFixed(2)}`);
  console.log(`   Final Balance: $${bestROI.finalBalance.toFixed(2)}`);

  console.log(`\n🏆 Mejor Profit Factor: TP ${bestPF.tpLabel}`);
  console.log(`   PF: ${bestPF.metrics.profitFactor.toFixed(2)}`);
  console.log(`   ROI: ${bestPF.roi.toFixed(1)}%`);

  console.log(`\n🏆 Mejor Expectancy: TP ${bestExpectancy.tpLabel}`);
  console.log(`   Expectancy: $${bestExpectancy.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`   ROI: ${bestExpectancy.roi.toFixed(1)}%`);

  console.log('\n' + '='.repeat(100));
  console.log('✅ Testing complete!\n');
}

main().catch(console.error);

