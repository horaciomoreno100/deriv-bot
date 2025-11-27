#!/usr/bin/env tsx
/**
 * Calculate daily, monthly, and yearly P&L projections
 * For the optimized strategy: SL 0.15×ATR + TP 1.25%
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
  console.log('💰 PROYECCIÓN DE GANANCIAS: DÍA, MES Y AÑO');
  console.log('='.repeat(80));

  const baseConfig: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance,
    stakePct: 0.02,
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

  console.log('\nConfiguración optimizada:');
  console.log('  TP: 1.25%');
  console.log('  SL: 0.15×ATR');
  console.log('  Balance inicial: $' + initialBalance.toFixed(2));
  console.log('  Stake: 2% por trade');
  console.log('  Multiplier: 500×\n');

  console.log('Ejecutando backtest...\n');
  const result = await runMRBacktest('BB_BOUNCE', baseConfig, params);

  const totalTrades = result.metrics.totalTrades;
  const netPnl = result.metrics.netPnl;
  const expectancy = result.metrics.expectancy;
  const winRate = result.metrics.winRate;
  const roi = (netPnl / initialBalance) * 100;

  // Calculate daily/monthly stats
  const tradesPerDay = totalTrades / 365;
  const tradesPerWeek = totalTrades / 52;
  const tradesPerMonth = totalTrades / 12;

  const pnlPerDay = expectancy * tradesPerDay;
  const pnlPerWeek = expectancy * tradesPerWeek;
  const pnlPerMonth = expectancy * tradesPerMonth;
  const pnlPerYear = netPnl;

  // Calculate with compound interest (assuming reinvestment)
  let balance = initialBalance;
  const monthlyReturns: number[] = [];
  const monthlyTrades: number[] = [];
  
  // Group trades by month (approximate)
  const tradesPerMonthCount = Math.round(tradesPerMonth);
  let monthPnl = 0;
  let monthTrades = 0;
  
  for (let i = 0; i < result.trades.length; i++) {
    const trade = result.trades[i]!;
    monthPnl += trade.pnl;
    monthTrades++;
    
    if (monthTrades >= tradesPerMonthCount || i === result.trades.length - 1) {
      monthlyReturns.push(monthPnl);
      monthlyTrades.push(monthTrades);
      monthPnl = 0;
      monthTrades = 0;
    }
  }

  // Calculate compound returns
  let compoundBalance = initialBalance;
  const compoundMonthly: number[] = [];
  
  for (const monthReturn of monthlyReturns) {
    const monthReturnPct = monthReturn / compoundBalance;
    compoundBalance *= (1 + monthReturnPct);
    compoundMonthly.push(compoundBalance);
  }

  const finalCompoundBalance = compoundBalance;
  const compoundROI = ((finalCompoundBalance - initialBalance) / initialBalance) * 100;

  console.log('='.repeat(80));
  console.log('📊 RESULTADOS DEL BACKTEST');
  console.log('='.repeat(80));
  console.log(`\nTotal Trades: ${totalTrades}`);
  console.log(`Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`Expectancy: $${expectancy.toFixed(2)}/trade`);
  console.log(`Net P&L: $${netPnl.toFixed(2)}`);
  console.log(`ROI: ${roi.toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('💰 PROYECCIÓN DE GANANCIAS (Simple)');
  console.log('='.repeat(80));
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
    { name: 'Por Semana', trades: tradesPerWeek, pnl: pnlPerWeek },
    { name: 'Por Mes', trades: tradesPerMonth, pnl: pnlPerMonth },
    { name: 'Por Año', trades: totalTrades, pnl: pnlPerYear },
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

  console.log('\n' + '='.repeat(80));
  console.log('📈 PROYECCIÓN CON INTERÉS COMPUESTO (Reinversión)');
  console.log('='.repeat(80));
  console.log('\nAsumiendo que reinviertes las ganancias cada mes:\n');

  let runningBalance = initialBalance;
  console.log('Mes'.padEnd(8) + 'Trades'.padStart(10) + 'Ganancia'.padStart(15) + 'Balance'.padStart(18) + 'ROI Acum'.padStart(15));
  console.log('-'.repeat(80));

  for (let month = 0; month < Math.min(12, monthlyReturns.length); month++) {
    const monthReturn = monthlyReturns[month]!;
    const monthTrades = monthlyTrades[month]!;
    const returnPct = monthReturn / runningBalance;
    runningBalance *= (1 + returnPct);
    const roiAccum = ((runningBalance - initialBalance) / initialBalance) * 100;
    
    console.log(
      `Mes ${(month + 1).toString().padEnd(4)}` +
      monthTrades.toString().padStart(10) +
      `$${monthReturn.toFixed(2)}`.padStart(15) +
      `$${runningBalance.toFixed(2)}`.padStart(18) +
      `${roiAccum.toFixed(1)}%`.padStart(15)
    );
  }

  if (monthlyReturns.length > 12) {
    console.log(`\n... (${monthlyReturns.length - 12} meses más)`);
  }

  console.log(`\nBalance Final (Compuesto): $${finalCompoundBalance.toFixed(2)}`);
  console.log(`ROI Final (Compuesto): ${compoundROI.toFixed(1)}%`);
  console.log(`Ganancia Total (Compuesta): $${(finalCompoundBalance - initialBalance).toFixed(2)}`);

  // Projections for different initial balances
  console.log('\n' + '='.repeat(80));
  console.log('💵 PROYECCIONES CON DIFERENTES BALANCES INICIALES');
  console.log('='.repeat(80));
  console.log('\n' +
    'Balance Inicial'.padEnd(18) +
    'Ganancia/Día'.padStart(15) +
    'Ganancia/Mes'.padStart(18) +
    'Ganancia/Año'.padStart(18) +
    'ROI Anual'.padStart(12)
  );
  console.log('-'.repeat(80));

  const testBalances = [500, 1000, 2500, 5000, 10000, 25000];
  for (const testBalance of testBalances) {
    const testPnlPerDay = (expectancy * tradesPerDay * testBalance) / initialBalance;
    const testPnlPerMonth = (expectancy * tradesPerMonth * testBalance) / initialBalance;
    const testPnlPerYear = (netPnl * testBalance) / initialBalance;
    
    console.log(
      `$${testBalance.toFixed(2)}`.padEnd(18) +
      `$${testPnlPerDay.toFixed(2)}`.padStart(15) +
      `$${testPnlPerMonth.toFixed(2)}`.padStart(18) +
      `$${testPnlPerYear.toFixed(2)}`.padStart(18) +
      `${roi.toFixed(1)}%`.padStart(12)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('📅 RESUMEN EJECUTIVO');
  console.log('='.repeat(80));
  console.log(`\nCon balance inicial de $${initialBalance.toFixed(2)}:`);
  console.log(`  📊 Trades por día: ${tradesPerDay.toFixed(1)}`);
  console.log(`  💰 Ganancia por día: $${pnlPerDay.toFixed(2)}`);
  console.log(`  📊 Trades por mes: ${tradesPerMonth.toFixed(1)}`);
  console.log(`  💰 Ganancia por mes: $${pnlPerMonth.toFixed(2)}`);
  console.log(`  📊 Trades por año: ${totalTrades}`);
  console.log(`  💰 Ganancia por año: $${pnlPerYear.toFixed(2)}`);
  console.log(`  📈 ROI anual: ${roi.toFixed(1)}%`);
  console.log(`  🎯 Expectancy: $${expectancy.toFixed(2)}/trade`);
  console.log(`  ✅ Win Rate: ${winRate.toFixed(1)}%`);

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch(console.error);

