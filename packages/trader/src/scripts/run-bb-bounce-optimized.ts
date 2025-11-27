#!/usr/bin/env tsx
/**
 * Run BB_BOUNCE with optimized configuration
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';

async function main() {
  const dataPath = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
  const asset = process.env.ASSET || 'frxEURUSD';

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  const config: MRBacktestConfig = {
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
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'], // Exclude ASIAN
  };

  console.log('\n' + '='.repeat(80));
  console.log('🚀 BB_BOUNCE - CONFIGURACIÓN OPTIMIZADA');
  console.log('='.repeat(80));
  console.log('Cambios aplicados:');
  console.log('  ✅ SL Buffer: 0.5× → 0.3× ATR (aplicado en estrategia)');
  console.log('  ✅ Filtrar sesión ASIAN (solo LONDON, OVERLAP, NY)');
  console.log('  ✅ ADX < 25 (sin cambios)');
  console.log('='.repeat(80) + '\n');

  const result = await runMRBacktest('BB_BOUNCE', config);

  console.log('\n' + '='.repeat(80));
  console.log('📊 RESULTADO FINAL');
  console.log('='.repeat(80));
  console.log(`Net P&L: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`Trades: ${result.metrics.totalTrades}`);
  console.log(`Wins: ${result.metrics.wins} | Losses: ${result.metrics.losses}`);
  console.log(`Avg Win: $${result.metrics.avgWin.toFixed(2)}`);
  console.log(`Avg Loss: $${result.metrics.avgLoss.toFixed(2)}`);
  console.log(`Ratio Win/Loss: ${(result.metrics.avgWin / result.metrics.avgLoss).toFixed(2)}:1`);
  console.log(`Max Drawdown: $${result.metrics.maxDrawdown.toFixed(2)} (${result.metrics.maxDrawdownPct.toFixed(1)}%)`);
  console.log(`Expectancy: $${result.metrics.expectancy.toFixed(2)}`);
  console.log(`SQN: ${result.metrics.sqn.toFixed(2)}`);
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);

