#!/usr/bin/env tsx
/**
 * Test optimized strategy on multiple Forex pairs
 * Compare results across different currency pairs
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import type { BBBounceParams } from '../strategies/mr/bb-bounce.strategy.js';

interface PairResult {
  pair: string;
  dataPath: string;
  metrics: any;
  trades: number;
  expectancy: number;
  roi: number;
  pnlPerDay: number;
  wr: number;
  pf: number;
  dd: number;
  success: boolean;
  error?: string;
}

async function testPair(
  pair: string,
  dataPath: string,
  config: MRBacktestConfig,
  params: Partial<BBBounceParams>
): Promise<PairResult> {
  try {
    if (!existsSync(dataPath)) {
      return {
        pair,
        dataPath,
        metrics: null,
        trades: 0,
        expectancy: 0,
        roi: 0,
        pnlPerDay: 0,
        wr: 0,
        pf: 0,
        dd: 0,
        success: false,
        error: 'Data file not found',
      };
    }

    const pairConfig = { ...config, asset: pair, dataPath };
    const result = await runMRBacktest('BB_BOUNCE', pairConfig, params);
    const roi = (result.metrics.netPnl / config.initialBalance) * 100;
    const pnlPerDay = result.metrics.netPnl / 365;

    return {
      pair,
      dataPath,
      metrics: result.metrics,
      trades: result.metrics.totalTrades,
      expectancy: result.metrics.expectancy,
      roi,
      pnlPerDay,
      wr: result.metrics.winRate,
      pf: result.metrics.profitFactor,
      dd: result.metrics.maxDrawdown,
      success: true,
    };
  } catch (error: any) {
    return {
      pair,
      dataPath,
      metrics: null,
      trades: 0,
      expectancy: 0,
      roi: 0,
      pnlPerDay: 0,
      wr: 0,
      pf: 0,
      dd: 0,
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

async function main() {
  const initialBalance = parseFloat(process.env.INITIAL_BALANCE || '1000');
  const analysisDir = join(process.cwd(), 'analysis-output');

  console.log('\n' + '='.repeat(80));
  console.log('🌍 PRUEBA EN MÚLTIPLES PARES FOREX');
  console.log('='.repeat(80));

  const baseConfig: MRBacktestConfig = {
    asset: '', // Will be set per pair
    dataPath: '', // Will be set per pair
    initialBalance,
    stakePct: 0.04, // 4%
    multiplier: 500,
    takeProfitPct: 0.0125, // TP 1.25%
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: false, // Sin filtro de sesión (mejor resultado)
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  const params: Partial<BBBounceParams> = {
    slBuffer: 0.15, // SL 0.15×ATR
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0125, // TP 1.25%
  };

  console.log('\nConfiguración optimizada:');
  console.log('  Stake: 4%');
  console.log('  TP: 1.25%');
  console.log('  SL: 0.15×ATR');
  console.log('  Sin filtro de sesión');
  console.log('  Balance inicial: $' + initialBalance.toFixed(2));
  console.log('  Multiplier: 500×\n');

  // Forex pairs to test
  const pairs = [
    { name: 'frxEURUSD', display: 'EUR/USD', file: 'frxEURUSD_300s_365d.csv' },
    { name: 'frxGBPUSD', display: 'GBP/USD', file: 'frxGBPUSD_300s_365d.csv' },
    { name: 'frxUSDJPY', display: 'USD/JPY', file: 'frxUSDJPY_300s_365d.csv' },
    { name: 'frxAUDUSD', display: 'AUD/USD', file: 'frxAUDUSD_300s_365d.csv' },
    { name: 'frxUSDCAD', display: 'USD/CAD', file: 'frxUSDCAD_300s_365d.csv' },
    { name: 'frxUSDCHF', display: 'USD/CHF', file: 'frxUSDCHF_300s_365d.csv' },
    { name: 'frxNZDUSD', display: 'NZD/USD', file: 'frxNZDUSD_300s_365d.csv' },
  ];

  console.log('Probando pares de Forex...\n');
  const results: PairResult[] = [];

  for (const pair of pairs) {
    const dataPath = join(analysisDir, pair.file);
    process.stdout.write(`\rProbando ${pair.display}...`);
    const result = await testPair(pair.name, dataPath, baseConfig, params);
    results.push({ ...result, pair: pair.display });
  }

  console.log('\n\n' + '='.repeat(120));
  console.log('📊 RESULTADOS POR PAR FOREX');
  console.log('='.repeat(120));

  // Filter successful results
  const successful = results.filter(r => r.success && r.metrics.netPnl > 0);
  const sorted = [...successful].sort((a, b) => b.pnlPerDay - a.pnlPerDay);

  console.log('\n' +
    'Par'.padEnd(12) +
    'Trades'.padStart(8) +
    'Trades/día'.padStart(12) +
    'WR%'.padStart(8) +
    'Expectancy'.padStart(12) +
    'Ganancia/día'.padStart(15) +
    'ROI%'.padStart(10) +
    'PF'.padStart(8) +
    'DD%'.padStart(10)
  );
  console.log('-'.repeat(120));

  for (const r of sorted) {
    const tradesPerDay = r.trades / 365;
    const ddPct = (r.dd / initialBalance) * 100;
    console.log(
      r.pair.padEnd(12) +
      r.trades.toString().padStart(8) +
      tradesPerDay.toFixed(1).padStart(12) +
      `${r.wr.toFixed(1)}%`.padStart(8) +
      `$${r.expectancy.toFixed(2)}`.padStart(12) +
      `$${r.pnlPerDay.toFixed(2)}`.padStart(15) +
      `${r.roi.toFixed(1)}%`.padStart(10) +
      r.pf.toFixed(2).padStart(8) +
      `${ddPct.toFixed(1)}%`.padStart(10)
    );
  }

  // Show failed pairs
  const failed = results.filter(r => !r.success || r.metrics.netPnl <= 0);
  if (failed.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log('⚠️  PARES NO DISPONIBLES O NO RENTABLES');
    console.log('='.repeat(120));
    for (const r of failed) {
      console.log(`  ${r.pair}: ${r.error || 'No rentable'}`);
    }
  }

  // Summary
  if (successful.length > 0) {
    const totalPnlPerDay = successful.reduce((sum, r) => sum + r.pnlPerDay, 0);
    const avgPnlPerDay = totalPnlPerDay / successful.length;
    const totalTradesPerDay = successful.reduce((sum, r) => sum + (r.trades / 365), 0);

    console.log('\n' + '='.repeat(120));
    console.log('📈 RESUMEN');
    console.log('='.repeat(120));
    console.log(`\nPares rentables: ${successful.length}/${pairs.length}`);
    console.log(`Ganancia promedio/día por par: $${avgPnlPerDay.toFixed(2)}`);
    console.log(`Total trades/día (todos los pares): ${totalTradesPerDay.toFixed(1)}`);
    console.log(`Ganancia total/día (todos los pares): $${totalPnlPerDay.toFixed(2)}`);
    console.log(`Ganancia total/mes (todos los pares): $${(totalPnlPerDay * 30).toFixed(2)}`);
    console.log(`Ganancia total/año (todos los pares): $${(totalPnlPerDay * 365).toFixed(2)}`);

    // Best pairs
    console.log('\n🏆 TOP 3 PARES:');
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      const r = sorted[i]!;
      console.log(`  ${i + 1}. ${r.pair}: $${r.pnlPerDay.toFixed(2)}/día (${r.trades} trades, WR ${r.wr.toFixed(1)}%)`);
    }
  }

  console.log('\n' + '='.repeat(120) + '\n');
}

main().catch(console.error);

