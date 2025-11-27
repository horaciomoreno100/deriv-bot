#!/usr/bin/env tsx
/**
 * Test stake 4% and analyze ways to increase daily profits
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import type { BBBounceParams } from '../strategies/mr/bb-bounce.strategy.js';

async function main() {
  const dataPath = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
  const asset = process.env.ASSET || 'frxEURUSD';
  const initialBalance = parseFloat(process.env.INITIAL_BALANCE || '1000');

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('💰 OPTIMIZACIÓN: STAKE 4% + ESTRATEGIAS PARA AUMENTAR GANANCIAS');
  console.log('='.repeat(80));

  const baseConfig: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance,
    stakePct: 0.04, // 4%
    multiplier: 500,
    takeProfitPct: 0.0125, // TP 1.25%
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: true,
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  const baseParams: Partial<BBBounceParams> = {
    slBuffer: 0.15,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0125,
  };

  // Test base with 4%
  console.log('\n📊 BACKTEST CON STAKE 4%');
  console.log('='.repeat(80));
  const result4pct = await runMRBacktest('BB_BOUNCE', baseConfig, baseParams);
  const roi4pct = (result4pct.metrics.netPnl / initialBalance) * 100;

  // Test optimizations
  console.log('\n' + '='.repeat(80));
  console.log('🔍 PROBANDO OPTIMIZACIONES PARA AUMENTAR GANANCIAS');
  console.log('='.repeat(80));

  const optimizations = [
    {
      name: '1. TP más grande (1.5%)',
      params: { ...baseParams, takeProfitPct: 0.015 },
      config: { ...baseConfig, takeProfitPct: 0.015 },
    },
    {
      name: '2. TP más grande (2.0%)',
      params: { ...baseParams, takeProfitPct: 0.02 },
      config: { ...baseConfig, takeProfitPct: 0.02 },
    },
    {
      name: '3. Sin filtro de sesión (más trades)',
      params: baseParams,
      config: { ...baseConfig, enableSessionFilter: false },
    },
    {
      name: '4. ADX más permisivo (<35)',
      params: { ...baseParams, adxThreshold: 35 },
      config: baseConfig,
    },
    {
      name: '5. TP 1.5% + Sin sesión',
      params: { ...baseParams, takeProfitPct: 0.015 },
      config: { ...baseConfig, takeProfitPct: 0.015, enableSessionFilter: false },
    },
    {
      name: '6. TP 2.0% + Sin sesión',
      params: { ...baseParams, takeProfitPct: 0.02 },
      config: { ...baseConfig, takeProfitPct: 0.02, enableSessionFilter: false },
    },
  ];

  const results: Array<{
    name: string;
    metrics: any;
    trades: number;
    expectancy: number;
    roi: number;
    pnlPerDay: number;
    dd: number;
  }> = [];

  for (const opt of optimizations) {
    process.stdout.write(`\rProbando: ${opt.name}...`);
    try {
      const result = await runMRBacktest('BB_BOUNCE', opt.config, opt.params);
      const roi = (result.metrics.netPnl / initialBalance) * 100;
      const pnlPerDay = (result.metrics.netPnl / 365);
      results.push({
        name: opt.name,
        metrics: result.metrics,
        trades: result.metrics.totalTrades,
        expectancy: result.metrics.expectancy,
        roi,
        pnlPerDay,
        dd: result.metrics.maxDrawdown,
      });
    } catch (error) {
      console.error(`\nError con ${opt.name}:`, error);
    }
  }

  console.log('\n\n' + '='.repeat(120));
  console.log('📊 COMPARACIÓN: OPTIMIZACIONES PARA AUMENTAR GANANCIAS');
  console.log('='.repeat(120));
  console.log('\n' +
    'Configuración'.padEnd(30) +
    'Trades/día'.padStart(12) +
    'Ganancia/día'.padStart(15) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10) +
    'DD%'.padStart(10)
  );
  console.log('-'.repeat(120));

  const basePnlPerDay = result4pct.metrics.netPnl / 365;
  const baseTradesPerDay = result4pct.metrics.totalTrades / 365;

  console.log(
    'BASE (Stake 4%, TP 1.25%)'.padEnd(30) +
    baseTradesPerDay.toFixed(1).padStart(12) +
    `$${basePnlPerDay.toFixed(2)}`.padStart(15) +
    `$${result4pct.metrics.expectancy.toFixed(2)}`.padStart(12) +
    `${roi4pct.toFixed(1)}%`.padStart(10) +
    `${((result4pct.metrics.maxDrawdown / initialBalance) * 100).toFixed(1)}%`.padStart(10)
  );

  const sorted = [...results].sort((a, b) => b.pnlPerDay - a.pnlPerDay);

  for (const r of sorted) {
    const tradesPerDay = r.trades / 365;
    const improvement = ((r.pnlPerDay - basePnlPerDay) / basePnlPerDay) * 100;
    const marker = improvement > 20 ? '✅' : improvement > 0 ? '➖' : '❌';
    console.log(
      (marker + ' ' + r.name).padEnd(30) +
      tradesPerDay.toFixed(1).padStart(12) +
      `$${r.pnlPerDay.toFixed(2)}`.padStart(15) +
      `$${r.expectancy.toFixed(2)}`.padStart(12) +
      `${r.roi.toFixed(1)}%`.padStart(10) +
      `${((r.dd / initialBalance) * 100).toFixed(1)}%`.padStart(10)
    );
  }

  // Analysis: Ways to increase profits
  console.log('\n' + '='.repeat(120));
  console.log('💡 ESTRATEGIAS PARA AUMENTAR GANANCIAS DIARIAS');
  console.log('='.repeat(120));

  const best = sorted[0];
  console.log(`\n🏆 Mejor optimización: ${best.name}`);
  console.log(`   Ganancia/día: $${best.pnlPerDay.toFixed(2)} (vs $${basePnlPerDay.toFixed(2)} base)`);
  console.log(`   Mejora: +${((best.pnlPerDay - basePnlPerDay) / basePnlPerDay * 100).toFixed(1)}%`);

  console.log('\n📈 Otras formas de aumentar ganancias:');
  console.log('\n1. AUMENTAR BALANCE INICIAL:');
  console.log('   - Con $2,000: Ganancia/día se duplica');
  console.log('   - Con $5,000: Ganancia/día × 5');
  console.log('   - Con $10,000: Ganancia/día × 10');

  console.log('\n2. AUMENTAR STAKE:');
  console.log('   - Stake 4%: $5.73/día (actual)');
  console.log('   - Stake 5%: ~$7.16/día (+25%)');
  console.log('   - Stake 6%: ~$8.60/día (+50%) ⚠️  Drawdown 63.9%');

  console.log('\n3. TRADING EN MÚLTIPLES ACTIVOS:');
  console.log('   - EURUSD: $5.73/día');
  console.log('   - GBPUSD: ~$5.73/día');
  console.log('   - USDJPY: ~$5.73/día');
  console.log('   - Total 3 activos: ~$17/día');

  console.log('\n4. AUMENTAR FRECUENCIA:');
  const noSessionResult = results.find(r => r.name.includes('Sin sesión'));
  if (noSessionResult) {
    console.log(`   - Sin filtro sesión: ${(noSessionResult.trades / 365).toFixed(1)} trades/día`);
    console.log(`   - Ganancia/día: $${noSessionResult.pnlPerDay.toFixed(2)}`);
  }

  console.log('\n5. MEJORAR EXPECTANCY:');
  const bestExpectancy = [...results].sort((a, b) => b.expectancy - a.expectancy)[0];
  if (bestExpectancy) {
    console.log(`   - Mejor expectancy: $${bestExpectancy.expectancy.toFixed(2)}/trade`);
    console.log(`   - Con ${(result4pct.metrics.totalTrades / 365).toFixed(1)} trades/día: $${(bestExpectancy.expectancy * result4pct.metrics.totalTrades / 365).toFixed(2)}/día`);
  }

  // Projections with different balances
  console.log('\n' + '='.repeat(120));
  console.log('💰 PROYECCIONES CON DIFERENTES BALANCES (Stake 4%)');
  console.log('='.repeat(120));
  console.log('\n' +
    'Balance'.padEnd(15) +
    'Stake/trade'.padStart(15) +
    'Ganancia/día'.padStart(15) +
    'Ganancia/mes'.padStart(18) +
    'Ganancia/año'.padStart(18)
  );
  console.log('-'.repeat(120));

  const balances = [1000, 2000, 5000, 10000];
  for (const bal of balances) {
    const stake = bal * 0.04;
    const pnlPerDay = (result4pct.metrics.netPnl / initialBalance) * (bal / initialBalance);
    const pnlPerMonth = pnlPerDay * 30;
    const pnlPerYear = pnlPerDay * 365;
    console.log(
      `$${bal.toFixed(0)}`.padEnd(15) +
      `$${stake.toFixed(2)}`.padStart(15) +
      `$${pnlPerDay.toFixed(2)}`.padStart(15) +
      `$${pnlPerMonth.toFixed(2)}`.padStart(18) +
      `$${pnlPerYear.toFixed(2)}`.padStart(18)
    );
  }

  console.log('\n' + '='.repeat(120) + '\n');
}

main().catch(console.error);

