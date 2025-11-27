#!/usr/bin/env tsx
/**
 * Test strategy with 6% stake instead of 2%
 * Compare results and show new projections
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
  console.log('💰 PRUEBA: STAKE 6% vs 2%');
  console.log('='.repeat(80));

  const baseConfig: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance,
    stakePct: 0.02, // 2%
    multiplier: 500,
    takeProfitPct: 0.0125, // TP 1.25%
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: true,
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  const params: Partial<BBBounceParams> = {
    slBuffer: 0.15, // SL 0.15×ATR
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0125, // TP 1.25%
  };

  console.log('\nConfiguración:');
  console.log('  TP: 1.25%');
  console.log('  SL: 0.15×ATR');
  console.log('  Balance inicial: $' + initialBalance.toFixed(2));
  console.log('  Multiplier: 500×\n');

  // Test with 2% stake
  console.log('='.repeat(80));
  console.log('📊 BACKTEST CON STAKE 2%');
  console.log('='.repeat(80));
  const result2pct = await runMRBacktest('BB_BOUNCE', baseConfig, params);
  const roi2pct = (result2pct.metrics.netPnl / initialBalance) * 100;

  // Test with 6% stake
  console.log('\n' + '='.repeat(80));
  console.log('📊 BACKTEST CON STAKE 6%');
  console.log('='.repeat(80));
  const config6pct = { ...baseConfig, stakePct: 0.06 };
  const result6pct = await runMRBacktest('BB_BOUNCE', config6pct, params);
  const roi6pct = (result6pct.metrics.netPnl / initialBalance) * 100;

  // Comparison
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPARACIÓN: STAKE 2% vs 6%');
  console.log('='.repeat(80));
  console.log('\n' +
    'Métrica'.padEnd(25) +
    'Stake 2%'.padStart(20) +
    'Stake 6%'.padStart(20) +
    'Diferencia'.padStart(15)
  );
  console.log('-'.repeat(80));

  const metrics = [
    { name: 'Trades', val2: result2pct.metrics.totalTrades, val6: result6pct.metrics.totalTrades, format: (v: number) => v.toString() },
    { name: 'Win Rate', val2: result2pct.metrics.winRate, val6: result6pct.metrics.winRate, format: (v: number) => `${v.toFixed(1)}%` },
    { name: 'Net P&L', val2: result2pct.metrics.netPnl, val6: result6pct.metrics.netPnl, format: (v: number) => `$${v.toFixed(2)}` },
    { name: 'ROI', val2: roi2pct, val6: roi6pct, format: (v: number) => `${v.toFixed(1)}%` },
    { name: 'Expectancy', val2: result2pct.metrics.expectancy, val6: result6pct.metrics.expectancy, format: (v: number) => `$${v.toFixed(2)}` },
    { name: 'Avg Win', val2: result2pct.metrics.avgWin, val6: result6pct.metrics.avgWin, format: (v: number) => `$${v.toFixed(2)}` },
    { name: 'Avg Loss', val2: result2pct.metrics.avgLoss, val6: result6pct.metrics.avgLoss, format: (v: number) => `$${v.toFixed(2)}` },
    { name: 'Profit Factor', val2: result2pct.metrics.profitFactor, val6: result6pct.metrics.profitFactor, format: (v: number) => v.toFixed(2) },
    { name: 'Max Drawdown', val2: result2pct.metrics.maxDrawdown, val6: result6pct.metrics.maxDrawdown, format: (v: number) => `$${v.toFixed(2)}` },
    { name: 'Max DD %', val2: (result2pct.metrics.maxDrawdown / initialBalance) * 100, val6: (result6pct.metrics.maxDrawdown / initialBalance) * 100, format: (v: number) => `${v.toFixed(1)}%` },
    { name: 'Max Consecutive Losses', val2: result2pct.metrics.maxConsecutiveLosses, val6: result6pct.metrics.maxConsecutiveLosses, format: (v: number) => v.toString() },
  ];

  for (const m of metrics) {
    const diff = m.val6 - m.val2;
    const diffPct = m.val2 !== 0 ? ((diff / m.val2) * 100) : 0;
    const diffStr = diffPct !== 0 ? `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%` : '-';
    console.log(
      m.name.padEnd(25) +
      m.format(m.val2).padStart(20) +
      m.format(m.val6).padStart(20) +
      diffStr.padStart(15)
    );
  }

  // Projections with 6% stake
  const tradesPerDay = result6pct.metrics.totalTrades / 365;
  const tradesPerMonth = result6pct.metrics.totalTrades / 12;
  const pnlPerDay = result6pct.metrics.expectancy * tradesPerDay;
  const pnlPerMonth = result6pct.metrics.expectancy * tradesPerMonth;
  const pnlPerYear = result6pct.metrics.netPnl;

  console.log('\n' + '='.repeat(80));
  console.log('💰 PROYECCIONES CON STAKE 6%');
  console.log('='.repeat(80));
  console.log(`\nBalance inicial: $${initialBalance.toFixed(2)}`);
  console.log(`Stake por trade: $${(initialBalance * 0.06).toFixed(2)} (6%)`);
  console.log('\n' +
    'Período'.padEnd(15) +
    'Trades'.padStart(10) +
    'Ganancia'.padStart(15) +
    'Balance Final'.padStart(18) +
    'ROI Acumulado'.padStart(15)
  );
  console.log('-'.repeat(80));

  const periods = [
    { name: 'Por Día', trades: tradesPerDay, pnl: pnlPerDay },
    { name: 'Por Semana', trades: tradesPerDay * 7, pnl: pnlPerDay * 7 },
    { name: 'Por Mes', trades: tradesPerMonth, pnl: pnlPerMonth },
    { name: 'Por Año', trades: result6pct.metrics.totalTrades, pnl: pnlPerYear },
  ];

  for (const period of periods) {
    const balanceFinal = initialBalance + period.pnl;
    const roiPeriod = (period.pnl / initialBalance) * 100;
    console.log(
      period.name.padEnd(15) +
      period.trades.toFixed(1).padStart(10) +
      `$${period.pnl.toFixed(2)}`.padStart(15) +
      `$${balanceFinal.toFixed(2)}`.padStart(18) +
      `${roiPeriod.toFixed(1)}%`.padStart(15)
    );
  }

  // Risk warning
  console.log('\n' + '='.repeat(80));
  console.log('⚠️  ADVERTENCIA DE RIESGO');
  console.log('='.repeat(80));
  console.log('\nCon stake 6%:');
  console.log(`  - Riesgo por trade: $${(initialBalance * 0.06).toFixed(2)} (vs $${(initialBalance * 0.02).toFixed(2)} con 2%)`);
  console.log(`  - Max Drawdown: $${result6pct.metrics.maxDrawdown.toFixed(2)} (${((result6pct.metrics.maxDrawdown / initialBalance) * 100).toFixed(1)}%)`);
  console.log(`  - Max pérdida consecutiva: ${result6pct.metrics.maxConsecutiveLosses} trades`);
  
  const maxLossStreak = result6pct.metrics.maxConsecutiveLosses;
  const avgLoss = result6pct.metrics.avgLoss;
  const potentialLoss = maxLossStreak * avgLoss;
  console.log(`  - Pérdida potencial en racha: ~$${potentialLoss.toFixed(2)} (${((potentialLoss / initialBalance) * 100).toFixed(1)}% del balance)`);
  
  console.log('\n💡 Recomendación:');
  if (result6pct.metrics.maxDrawdown / initialBalance > 0.5) {
    console.log('  ⚠️  Drawdown > 50%: Considera reducir el stake o mejorar la gestión de riesgo');
  } else if (result6pct.metrics.maxDrawdown / initialBalance > 0.3) {
    console.log('  ⚠️  Drawdown > 30%: Alto riesgo, monitorea de cerca');
  } else {
    console.log('  ✅ Drawdown < 30%: Riesgo manejable');
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch(console.error);

