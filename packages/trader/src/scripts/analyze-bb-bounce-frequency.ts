#!/usr/bin/env tsx
/**
 * Analyze what's limiting BB_BOUNCE trade frequency
 * Test relaxed conditions to increase frequency for scalping
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

  const baseConfig: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance: 10000,
    stakePct: 0.02,
    multiplier: 100,
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: true,
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  console.log('\n' + '='.repeat(80));
  console.log('🔍 ANÁLISIS DE FRECUENCIA - BB_BOUNCE');
  console.log('='.repeat(80));
  console.log('Objetivo: Aumentar frecuencia para scalping (múltiples trades/día)\n');

  const tests = [
    {
      name: 'ACTUAL (Optimizado)',
      params: {
        slBuffer: 0.3,
        requireRejection: true,
        requireCleanApproach: true,
        adxThreshold: 25,
      },
    },
    {
      name: 'TEST 1: Sin requireRejection',
      params: {
        slBuffer: 0.3,
        requireRejection: false, // Relajar
        requireCleanApproach: true,
        adxThreshold: 25,
      },
    },
    {
      name: 'TEST 2: Sin requireCleanApproach',
      params: {
        slBuffer: 0.3,
        requireRejection: true,
        requireCleanApproach: false, // Relajar
        adxThreshold: 25,
      },
    },
    {
      name: 'TEST 3: Sin ambos filtros',
      params: {
        slBuffer: 0.3,
        requireRejection: false, // Relajar ambos
        requireCleanApproach: false,
        adxThreshold: 25,
      },
    },
    {
      name: 'TEST 4: ADX < 30 (más permisivo)',
      params: {
        slBuffer: 0.3,
        requireRejection: false,
        requireCleanApproach: false,
        adxThreshold: 30, // Más permisivo
      },
    },
    {
      name: 'TEST 5: Incluir ASIAN (más horas)',
      params: {
        slBuffer: 0.3,
        requireRejection: false,
        requireCleanApproach: false,
        adxThreshold: 25,
      },
      allowedSessions: ['ASIAN', 'LONDON', 'OVERLAP', 'NY'], // Incluir ASIAN
    },
  ];

  const results: Array<{
    name: string;
    trades: number;
    metrics: any;
  }> = [];

  for (const test of tests) {
    console.log(`\n📊 Running: ${test.name}...`);
    
    const config: MRBacktestConfig = {
      ...baseConfig,
      allowedSessions: test.allowedSessions || baseConfig.allowedSessions,
    };

    const result = await runMRBacktest('BB_BOUNCE', config, test.params);
    
    results.push({
      name: test.name,
      trades: result.metrics.totalTrades,
      metrics: result.metrics,
    });
  }

  // Print comparison
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPARACIÓN DE FRECUENCIA');
  console.log('='.repeat(80));
  console.log('\nConfiguración'.padEnd(35) + 
    'Trades'.padStart(8) + 
    'Trades/día'.padStart(12) + 
    'WR%'.padStart(8) + 
    'PF'.padStart(8) + 
    'Net P&L'.padStart(12) + 
    'Ratio'.padStart(8));
  console.log('-'.repeat(90));

  const baseline = results[0]!;
  const days = 366;

  for (const result of results) {
    const tradesPerDay = result.trades / days;
    const ratio = (result.metrics.avgWin / result.metrics.avgLoss).toFixed(2);
    const change = result.trades - baseline.trades;
    const changePct = ((change / baseline.trades) * 100).toFixed(0);
    
    console.log(
      result.name.padEnd(35) +
      result.trades.toString().padStart(8) +
      tradesPerDay.toFixed(2).padStart(12) +
      `${result.metrics.winRate.toFixed(1)}%`.padStart(8) +
      result.metrics.profitFactor.toFixed(2).padStart(8) +
      `$${result.metrics.netPnl.toFixed(2)}`.padStart(12) +
      ratio.padStart(8) +
      (change !== 0 ? ` (+${changePct}%)` : '').padStart(10)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('💡 RECOMENDACIONES');
  console.log('='.repeat(80));

  // Find best balance
  const profitable = results.filter(r => r.metrics.netPnl > 0 && r.metrics.profitFactor >= 1.0);
  const bestFreq = profitable.sort((a, b) => b.trades - a.trades)[0];
  
  if (bestFreq) {
    const tradesPerDay = bestFreq.trades / days;
    console.log(`\n✅ Mejor opción para scalping: ${bestFreq.name}`);
    console.log(`   Trades: ${bestFreq.trades} (~${tradesPerDay.toFixed(1)}/día)`);
    console.log(`   Profit Factor: ${bestFreq.metrics.profitFactor.toFixed(2)}`);
    console.log(`   Net P&L: $${bestFreq.metrics.netPnl.toFixed(2)}`);
    
    if (tradesPerDay < 3) {
      console.log(`\n⚠️  Aún bajo para scalping. Considera:`);
      console.log(`   - Reducir ADX threshold aún más`);
      console.log(`   - Permitir entradas en más condiciones de mercado`);
      console.log(`   - Reducir cooldown entre trades`);
    } else if (tradesPerDay >= 3 && tradesPerDay < 5) {
      console.log(`\n✅ Frecuencia aceptable para scalping moderado`);
    } else {
      console.log(`\n✅ Excelente frecuencia para scalping agresivo`);
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch(console.error);

