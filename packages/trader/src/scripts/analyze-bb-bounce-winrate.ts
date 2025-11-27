#!/usr/bin/env tsx
/**
 * Deep analysis of why BB_BOUNCE has low win rate
 * Analyze trade behavior, TP/SL hits, near misses, etc.
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
  console.log('🔍 ANÁLISIS PROFUNDO: ¿Por qué el Win Rate es bajo?');
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

  // Current config: TP 0.75%, sin filtros restrictivos
  const currentParams: Partial<BBBounceParams> = {
    slBuffer: 0.3,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0075, // 0.75%
  };

  console.log('📊 Ejecutando backtest actual...\n');
  const result = await runMRBacktest('BB_BOUNCE', baseConfig, currentParams);

  // Analyze trades
  const trades = result.trades;
  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');

  console.log('\n' + '='.repeat(80));
  console.log('📊 ANÁLISIS DE TRADES');
  console.log('='.repeat(80));

  // Exit reasons
  const exitReasons: Record<string, { wins: number; losses: number }> = {};
  for (const trade of trades) {
    const reason = trade.exitReason;
    if (!exitReasons[reason]) {
      exitReasons[reason] = { wins: 0, losses: 0 };
    }
    if (trade.result === 'WIN') {
      exitReasons[reason]!.wins++;
    } else {
      exitReasons[reason]!.losses++;
    }
  }

  console.log('\n🚪 Razones de salida:');
  for (const [reason, counts] of Object.entries(exitReasons)) {
    const total = counts.wins + counts.losses;
    const wr = (counts.wins / total) * 100;
    console.log(`  ${reason.padEnd(15)}: ${counts.wins}W / ${counts.losses}L (${total} total) - WR: ${wr.toFixed(1)}%`);
  }

  // Analyze TP/SL distances
  console.log('\n📏 Análisis de distancias TP/SL:');
  
  const tpDistances: number[] = [];
  const slDistances: number[] = [];
  const tpSlRatios: number[] = [];

  for (const trade of trades) {
    const tpDist = Math.abs((trade.tpPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const slDist = Math.abs((trade.entryPrice - trade.slPrice) / trade.entryPrice) * 100;
    const ratio = tpDist / slDist;
    
    tpDistances.push(tpDist);
    slDistances.push(slDist);
    tpSlRatios.push(ratio);
  }

  const avgTPDist = tpDistances.reduce((a, b) => a + b, 0) / tpDistances.length;
  const avgSLDist = slDistances.reduce((a, b) => a + b, 0) / slDistances.length;
  const avgRatio = tpSlRatios.reduce((a, b) => a + b, 0) / tpSlRatios.length;

  console.log(`  Avg TP Distance: ${avgTPDist.toFixed(3)}%`);
  console.log(`  Avg SL Distance: ${avgSLDist.toFixed(3)}%`);
  console.log(`  Avg TP/SL Ratio: ${avgRatio.toFixed(2)}:1`);

  // Analyze near misses
  const nearMisses = losses.filter(t => t.maxFavorableExcursion >= avgTPDist * 0.5);
  console.log(`\n🎯 Near Misses: ${nearMisses.length} (${((nearMisses.length / losses.length) * 100).toFixed(1)}% de pérdidas)`);
  console.log(`   Trades que alcanzaron >50% del TP pero perdieron`);

  // Analyze immediate reversals
  const immediateReversals = losses.filter(t => t.barsHeld <= 3);
  console.log(`\n⚡ Reversiones Inmediatas: ${immediateReversals.length} (${((immediateReversals.length / losses.length) * 100).toFixed(1)}% de pérdidas)`);
  console.log(`   Trades que perdieron en ≤3 barras`);

  // Test different TP/SL ratios
  console.log('\n' + '='.repeat(80));
  console.log('🧪 PROBANDO DIFERENTES TP/SL RATIOS');
  console.log('='.repeat(80));

  const tpSlTests = [
    { tp: 0.005, sl: 0.005, label: 'TP 0.5% / SL 0.5% (1:1)' },
    { tp: 0.005, sl: 0.003, label: 'TP 0.5% / SL 0.3% (1.67:1)' },
    { tp: 0.005, sl: 0.002, label: 'TP 0.5% / SL 0.2% (2.5:1)' },
    { tp: 0.003, sl: 0.003, label: 'TP 0.3% / SL 0.3% (1:1)' },
    { tp: 0.003, sl: 0.002, label: 'TP 0.3% / SL 0.2% (1.5:1)' },
    { tp: 0.0075, sl: 0.003, label: 'TP 0.75% / SL 0.3% (2.5:1)' },
    { tp: 0.0075, sl: 0.002, label: 'TP 0.75% / SL 0.2% (3.75:1)' },
  ];

  const tpSlResults: Array<{
    label: string;
    metrics: any;
    roi: number;
  }> = [];

  for (const test of tpSlTests) {
    console.log(`\n📊 Probando: ${test.label}...`);
    
    const testParams: Partial<BBBounceParams> = {
      ...currentParams,
      takeProfitPct: test.tp,
    };

    const testConfig: MRBacktestConfig = {
      ...baseConfig,
      takeProfitPct: test.tp,
      stopLossPct: test.sl,
    };

    const testResult = await runMRBacktest('BB_BOUNCE', testConfig, testParams);
    const roi = (testResult.metrics.netPnl / baseConfig.initialBalance) * 100;

    tpSlResults.push({
      label: test.label,
      metrics: testResult.metrics,
      roi,
    });
  }

  // Print TP/SL comparison
  console.log('\n' + '='.repeat(100));
  console.log('📊 COMPARACIÓN TP/SL RATIOS');
  console.log('='.repeat(100));
  console.log('\n' +
    'TP/SL'.padEnd(25) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(12) +
    'ROI%'.padStart(10) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10) +
    'Ratio'.padStart(8)
  );
  console.log('-'.repeat(100));

  for (const result of tpSlResults) {
    const { label, metrics, roi } = result;
    const ratio = (metrics.avgWin / metrics.avgLoss).toFixed(2);
    
    console.log(
      label.padEnd(25) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      metrics.profitFactor.toFixed(2).padStart(8) +
      `$${metrics.netPnl.toFixed(2)}`.padStart(12) +
      `${roi.toFixed(1)}%`.padStart(10) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10) +
      ratio.padStart(8)
    );
  }

  // Find best
  const bestWR = tpSlResults.reduce((best, r) => r.metrics.winRate > best.metrics.winRate ? r : best);
  const bestROI = tpSlResults.reduce((best, r) => r.roi > best.roi ? r : best);

  console.log('\n' + '='.repeat(100));
  console.log('💡 RECOMENDACIONES');
  console.log('='.repeat(100));
  console.log(`\n🏆 Mejor Win Rate: ${bestWR.label}`);
  console.log(`   WR: ${bestWR.metrics.winRate.toFixed(1)}%`);
  console.log(`   ROI: ${bestWR.roi.toFixed(1)}%`);

  console.log(`\n🏆 Mejor ROI: ${bestROI.label}`);
  console.log(`   ROI: ${bestROI.roi.toFixed(1)}%`);
  console.log(`   WR: ${bestROI.metrics.winRate.toFixed(1)}%`);

  console.log('\n' + '='.repeat(100) + '\n');
}

main().catch(console.error);

