#!/usr/bin/env tsx
/**
 * Test BB_BOUNCE Improvements Incrementally
 * 
 * Applies changes one by one and compares results to baseline.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import type { MRStrategyParams } from '../strategy/mr-strategy-base.js';
import type { BBBounceParams } from '../strategies/mr/bb-bounce.strategy.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DATA_PATH = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
const ASSET = process.env.ASSET || 'frxEURUSD';

interface TestConfig {
  name: string;
  description: string;
  params: Partial<BBBounceParams>;
  sessionFilter?: boolean;
  allowedSessions?: Array<'ASIAN' | 'LONDON' | 'OVERLAP' | 'NY' | 'CLOSED'>;
  adxThreshold?: number; // Override ADX threshold
}

// ============================================================================
// TEST CONFIGURATIONS
// ============================================================================

const BASELINE: TestConfig = {
  name: 'BASELINE',
  description: 'Configuración original (slBuffer: 0.5, ADX < 25, todas las sesiones)',
  params: {
    slBuffer: 0.5,
    adxThreshold: 25,
  },
  sessionFilter: false,
};

const TEST_1: TestConfig = {
  name: 'TEST 1: SL Buffer 0.3×',
  description: 'Reducir SL buffer de 0.5× a 0.3× ATR',
  params: {
    slBuffer: 0.3,
    adxThreshold: 25,
  },
  sessionFilter: false,
};

const TEST_2: TestConfig = {
  name: 'TEST 2: SL 0.3× + Filtrar ASIAN',
  description: 'SL 0.3× + No operar en sesión ASIAN',
  params: {
    slBuffer: 0.3,
    adxThreshold: 25,
  },
  sessionFilter: true,
  allowedSessions: ['LONDON', 'OVERLAP', 'NY'], // Exclude ASIAN
};

const TEST_3: TestConfig = {
  name: 'TEST 3: SL 0.3× + ASIAN + ADX < 20',
  description: 'SL 0.3× + Filtrar ASIAN + ADX más estricto (< 20)',
  params: {
    slBuffer: 0.3,
    adxThreshold: 20,
  },
  sessionFilter: true,
  allowedSessions: ['LONDON', 'OVERLAP', 'NY'], // Exclude ASIAN
};

const TEST_4: TestConfig = {
  name: 'TEST 4: SL 0.3× + ASIAN + ADX < 20 + TP Mejorado',
  description: 'SL 0.3× + Filtrar ASIAN + ADX < 20 + TP a 0.75× distancia banda-middle',
  params: {
    slBuffer: 0.3,
    adxThreshold: 20,
    // Note: TP improvement needs code change, will handle separately
  },
  sessionFilter: true,
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 BB_BOUNCE IMPROVEMENTS - INCREMENTAL TESTING');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data: ${DATA_PATH}\n`);

  if (!existsSync(DATA_PATH)) {
    console.error(`❌ Data file not found: ${DATA_PATH}`);
    process.exit(1);
  }

  const baseConfig: MRBacktestConfig = {
    asset: ASSET,
    dataPath: DATA_PATH,
    initialBalance: 10000,
    stakePct: 0.02,
    multiplier: 100,
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
  };

  const results: Array<{
    config: TestConfig;
    metrics: any;
  }> = [];

  // Run baseline
  console.log('📊 Running BASELINE...\n');
  const baseline = await runTest(BASELINE, baseConfig);
  results.push({ config: BASELINE, metrics: baseline.metrics });

  // Run Test 1
  console.log('\n' + '='.repeat(80));
  console.log('📊 Running TEST 1: SL Buffer 0.3×\n');
  const test1 = await runTest(TEST_1, baseConfig);
  results.push({ config: TEST_1, metrics: test1.metrics });

  // Run Test 2
  console.log('\n' + '='.repeat(80));
  console.log('📊 Running TEST 2: SL 0.3× + Filtrar ASIAN\n');
  const test2 = await runTest(TEST_2, baseConfig);
  results.push({ config: TEST_2, metrics: test2.metrics });

  // Run Test 3
  console.log('\n' + '='.repeat(80));
  console.log('📊 Running TEST 3: SL 0.3× + ASIAN + ADX < 20\n');
  const test3 = await runTest(TEST_3, baseConfig);
  results.push({ config: TEST_3, metrics: test3.metrics });

  // Print comparison
  printComparison(results);
}

async function runTest(
  testConfig: TestConfig,
  baseConfig: MRBacktestConfig
) {
  const config: MRBacktestConfig = {
    ...baseConfig,
    enableSessionFilter: testConfig.sessionFilter ?? false,
    allowedSessions: testConfig.allowedSessions,
  };

  const strategyParams: Partial<MRStrategyParams & BBBounceParams> = {
    ...testConfig.params,
  };

  const result = await runMRBacktest('BB_BOUNCE', config, strategyParams);
  return result;
}

function printComparison(results: Array<{ config: TestConfig; metrics: any }>) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPARACIÓN DE RESULTADOS');
  console.log('='.repeat(80));
  console.log('');

  const baseline = results[0]!;
  
  // Header
  console.log(
    'Config'.padEnd(35) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(12) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10) +
    'Ratio'.padStart(8) +
    'Change'.padStart(10)
  );
  console.log('-'.repeat(110));

  for (const result of results) {
    const { config, metrics } = result;
    const change = metrics.netPnl - baseline.metrics.netPnl;
    const changePct = ((change / Math.abs(baseline.metrics.netPnl)) * 100).toFixed(1);
    const ratio = (metrics.avgWin / metrics.avgLoss).toFixed(2);
    
    const changeStr = change >= 0 
      ? `+$${change.toFixed(2)} (+${changePct}%)`
      : `$${change.toFixed(2)} (${changePct}%)`;

    console.log(
      config.name.padEnd(35) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      metrics.profitFactor.toFixed(2).padStart(8) +
      `$${metrics.netPnl.toFixed(2)}`.padStart(12) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10) +
      ratio.padStart(8) +
      changeStr.padStart(10)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('📈 ANÁLISIS DE MEJORAS');
  console.log('='.repeat(80));
  console.log('');

  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1]!;
    const curr = results[i]!;
    
    const pnlChange = curr.metrics.netPnl - prev.metrics.netPnl;
    const pfChange = curr.metrics.profitFactor - prev.metrics.profitFactor;
    const wrChange = curr.metrics.winRate - prev.metrics.winRate;
    const ratioChange = (curr.metrics.avgWin / curr.metrics.avgLoss) - (prev.metrics.avgWin / prev.metrics.avgLoss);

    console.log(`\n${curr.config.name}:`);
    console.log(`  ${curr.config.description}`);
    console.log(`  P&L: ${pnlChange >= 0 ? '+' : ''}$${pnlChange.toFixed(2)} (${((pnlChange / Math.abs(prev.metrics.netPnl)) * 100).toFixed(1)}%)`);
    console.log(`  PF: ${pfChange >= 0 ? '+' : ''}${pfChange.toFixed(2)}`);
    console.log(`  WR: ${wrChange >= 0 ? '+' : ''}${wrChange.toFixed(1)}%`);
    console.log(`  Ratio: ${ratioChange >= 0 ? '+' : ''}${ratioChange.toFixed(2)}`);
    console.log(`  Trades: ${curr.metrics.totalTrades - prev.metrics.totalTrades >= 0 ? '+' : ''}${curr.metrics.totalTrades - prev.metrics.totalTrades}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Testing complete!\n');
}

main().catch(console.error);

