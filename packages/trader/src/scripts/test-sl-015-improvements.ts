#!/usr/bin/env tsx
/**
 * Test improvements with SL 0.15×ATR (best found)
 * Try different TP values and filters to optimize further
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
  console.log('🚀 OPTIMIZACIÓN: SL 0.15×ATR (Mejor base encontrada)');
  console.log('='.repeat(80));

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

  // Base: SL 0.15×ATR (best found)
  const baseParams: Partial<BBBounceParams> = {
    slBuffer: 0.15,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0075,
  };

  console.log('\nProbando diferentes combinaciones con SL 0.15×ATR...\n');

  const tests = [
    {
      name: 'BASE: SL 0.15×ATR, TP 0.75%',
      params: baseParams,
    },
    {
      name: 'TP 0.5%',
      params: { ...baseParams, takeProfitPct: 0.005 },
    },
    {
      name: 'TP 1.0%',
      params: { ...baseParams, takeProfitPct: 0.01 },
    },
    {
      name: 'TP 1.25%',
      params: { ...baseParams, takeProfitPct: 0.0125 },
    },
    {
      name: 'TP 0.75% + Clean Approach',
      params: { ...baseParams, requireCleanApproach: true },
    },
    {
      name: 'TP 0.75% + Rejection',
      params: { ...baseParams, requireRejection: true },
    },
    {
      name: 'TP 1.0% + Clean Approach',
      params: { ...baseParams, takeProfitPct: 0.01, requireCleanApproach: true },
    },
    {
      name: 'TP 1.0% + Rejection',
      params: { ...baseParams, takeProfitPct: 0.01, requireRejection: true },
    },
    {
      name: 'ADX <25, TP 0.75%',
      params: { ...baseParams, adxThreshold: 25 },
    },
    {
      name: 'ADX <25, TP 1.0%',
      params: { ...baseParams, adxThreshold: 25, takeProfitPct: 0.01 },
    },
  ];

  const results: Array<{
    name: string;
    metrics: any;
    trades: number;
    expectancy: number;
    roi: number;
    wr: number;
    pf: number;
    dd: number;
  }> = [];

  for (const test of tests) {
    process.stdout.write(`\rProbando: ${test.name}...`);
    try {
      const config = {
        ...baseConfig,
        takeProfitPct: test.params.takeProfitPct || 0.0075,
      };
      const result = await runMRBacktest('BB_BOUNCE', config, test.params);
      const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;
      results.push({
        name: test.name,
        metrics: result.metrics,
        trades: result.metrics.totalTrades,
        expectancy: result.metrics.expectancy,
        roi,
        wr: result.metrics.winRate,
        pf: result.metrics.profitFactor,
        dd: result.metrics.maxDrawdown,
      });
    } catch (error) {
      console.error(`\nError con ${test.name}:`, error);
    }
  }

  console.log('\n\n' + '='.repeat(120));
  console.log('📊 RESULTADOS: OPTIMIZACIÓN CON SL 0.15×ATR');
  console.log('='.repeat(120));
  console.log('\n' +
    'Configuración'.padEnd(35) +
    'Trades'.padStart(8) +
    'Trades/día'.padStart(12) +
    'WR%'.padStart(8) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10) +
    'PF'.padStart(8) +
    'DD%'.padStart(8)
  );
  console.log('-'.repeat(120));

  const sorted = [...results].sort((a, b) => {
    // Sort by: expectancy * (trades / 2000) to balance both
    const scoreA = a.expectancy * (a.trades / 2000);
    const scoreB = b.expectancy * (b.trades / 2000);
    return scoreB - scoreA;
  });

  for (const r of sorted) {
    const isBase = r.name.includes('BASE');
    const marker = isBase ? '👉 ' : '   ';
    console.log(
      (marker + r.name).padEnd(35) +
      r.trades.toString().padStart(8) +
      (r.trades / 365).toFixed(1).padStart(12) +
      `${r.wr.toFixed(1)}%`.padStart(8) +
      `$${r.expectancy.toFixed(2)}`.padStart(12) +
      `${r.roi.toFixed(1)}%`.padStart(10) +
      r.pf.toFixed(2).padStart(8) +
      `${r.dd.toFixed(1)}%`.padStart(8)
    );
  }

  // Best overall
  const best = sorted[0];
  console.log('\n' + '='.repeat(120));
  console.log('🏆 MEJOR CONFIGURACIÓN');
  console.log('='.repeat(120));
  console.log(`\n${best.name}`);
  console.log(`  Trades: ${best.trades} (${(best.trades / 365).toFixed(1)}/día)`);
  console.log(`  Expectancy: $${best.expectancy.toFixed(2)}/trade`);
  console.log(`  ROI: ${best.roi.toFixed(1)}%`);
  console.log(`  Win Rate: ${best.wr.toFixed(1)}%`);
  console.log(`  Profit Factor: ${best.pf.toFixed(2)}`);
  console.log(`  Max Drawdown: ${best.dd.toFixed(1)}%`);

  console.log('\n' + '='.repeat(120) + '\n');
}

main().catch(console.error);

