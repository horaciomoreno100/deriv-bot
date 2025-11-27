#!/usr/bin/env tsx
/**
 * Test BB_BOUNCE with different multipliers
 * Balance: $1000, Stake: 2% per trade
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
  console.log('🧪 BB_BOUNCE - TEST DE MULTIPLICADORES');
  console.log('='.repeat(80));
  console.log('Configuración:');
  console.log('  Balance inicial: $1,000');
  console.log('  Stake: 2% por trade ($20)');
  console.log('  Estrategia: TEST 4 (sin filtros restrictivos, ADX < 30)');
  console.log('='.repeat(80) + '\n');

  const multipliers = [50, 100, 150, 200, 300, 500];

  const baseConfig: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance: 1000, // $1,000
    stakePct: 0.02, // 2%
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: true,
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  // TEST 4 params: sin filtros restrictivos, ADX < 30
  const strategyParams: Partial<BBBounceParams> = {
    slBuffer: 0.3,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
  };

  const results: Array<{
    multiplier: number;
    metrics: any;
    finalBalance: number;
    roi: number;
  }> = [];

  for (const multiplier of multipliers) {
    console.log(`\n📊 Probando Multiplier: ${multiplier}x...`);
    
    const config: MRBacktestConfig = {
      ...baseConfig,
      multiplier,
    };

    const result = await runMRBacktest('BB_BOUNCE', config, strategyParams);
    
    const finalBalance = baseConfig.initialBalance + result.metrics.netPnl;
    const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;

    results.push({
      multiplier,
      metrics: result.metrics,
      finalBalance,
      roi,
    });
  }

  // Print comparison
  console.log('\n' + '='.repeat(90));
  console.log('📊 COMPARACIÓN DE MULTIPLICADORES');
  console.log('='.repeat(90));
  console.log('\n' +
    'Multiplier'.padEnd(12) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(12) +
    'ROI%'.padStart(10) +
    'Final $'.padStart(12) +
    'Max DD%'.padStart(10) +
    'Avg Win'.padStart(10) +
    'Avg Loss'.padStart(10)
  );
  console.log('-'.repeat(90));

  for (const result of results) {
    const { multiplier, metrics, finalBalance, roi } = result;
    const stake = baseConfig.initialBalance * baseConfig.stakePct;
    
    console.log(
      `${multiplier}x`.padEnd(12) +
      metrics.totalTrades.toString().padStart(8) +
      `${metrics.winRate.toFixed(1)}%`.padStart(8) +
      metrics.profitFactor.toFixed(2).padStart(8) +
      `$${metrics.netPnl.toFixed(2)}`.padStart(12) +
      `${roi.toFixed(1)}%`.padStart(10) +
      `$${finalBalance.toFixed(2)}`.padStart(12) +
      `${metrics.maxDrawdownPct.toFixed(1)}%`.padStart(10) +
      `$${metrics.avgWin.toFixed(2)}`.padStart(10) +
      `$${metrics.avgLoss.toFixed(2)}`.padStart(10)
    );
  }

  // Find best multiplier
  console.log('\n' + '='.repeat(90));
  console.log('💡 ANÁLISIS');
  console.log('='.repeat(90));

  const bestROI = results.reduce((best, r) => r.roi > best.roi ? r : best);
  const bestPF = results.reduce((best, r) => r.metrics.profitFactor > best.metrics.profitFactor ? r : best);
  const bestDD = results.reduce((best, r) => r.metrics.maxDrawdownPct < best.metrics.maxDrawdownPct ? r : best);

  console.log(`\n🏆 Mejor ROI: ${bestROI.multiplier}x`);
  console.log(`   ROI: ${bestROI.roi.toFixed(1)}%`);
  console.log(`   Net P&L: $${bestROI.metrics.netPnl.toFixed(2)}`);
  console.log(`   Final Balance: $${bestROI.finalBalance.toFixed(2)}`);

  console.log(`\n🏆 Mejor Profit Factor: ${bestPF.multiplier}x`);
  console.log(`   PF: ${bestPF.metrics.profitFactor.toFixed(2)}`);
  console.log(`   ROI: ${bestPF.roi.toFixed(1)}%`);

  console.log(`\n🏆 Menor Drawdown: ${bestDD.multiplier}x`);
  console.log(`   Max DD: ${bestDD.metrics.maxDrawdownPct.toFixed(1)}%`);
  console.log(`   ROI: ${bestDD.roi.toFixed(1)}%`);

  // Risk analysis
  console.log('\n' + '='.repeat(90));
  console.log('⚠️  ANÁLISIS DE RIESGO');
  console.log('='.repeat(90));

  for (const result of results) {
    const { multiplier, metrics, finalBalance } = result;
    const stake = baseConfig.initialBalance * baseConfig.stakePct;
    const maxLossPerTrade = stake * multiplier * 0.01; // Asumiendo SL de ~1%
    const maxLossPct = (maxLossPerTrade / baseConfig.initialBalance) * 100;
    
    console.log(`\n${multiplier}x:`);
    console.log(`  Stake por trade: $${stake.toFixed(2)}`);
    console.log(`  Pérdida máxima teórica por trade: $${maxLossPerTrade.toFixed(2)} (${maxLossPct.toFixed(1)}% del balance)`);
    console.log(`  Max Drawdown real: ${metrics.maxDrawdownPct.toFixed(1)}%`);
    
    if (metrics.maxDrawdownPct > 20) {
      console.log(`  ⚠️  Drawdown alto - considerar reducir multiplier o stake`);
    }
  }

  console.log('\n' + '='.repeat(90));
  console.log('✅ Testing complete!\n');
}

main().catch(console.error);

