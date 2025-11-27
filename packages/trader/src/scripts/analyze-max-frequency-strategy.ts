#!/usr/bin/env tsx
/**
 * Deep analysis of maximum frequency strategy
 * TP: 0.75%, SL: 0.2×ATR, No filters, ADX: <30
 * Goal: Find improvements while maintaining high frequency
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
  console.log('🚀 ANÁLISIS: ESTRATEGIA DE MÁXIMA FRECUENCIA');
  console.log('='.repeat(80));
  console.log('\nConfiguración base:');
  console.log('  TP: 0.75%');
  console.log('  SL: 0.2×ATR');
  console.log('  Filtros: Ninguno');
  console.log('  ADX: <30\n');

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

  // Base configuration
  const baseParams: Partial<BBBounceParams> = {
    slBuffer: 0.2,
    requireRejection: false,
    requireCleanApproach: false,
    adxThreshold: 30,
    takeProfitPct: 0.0075,
  };

  console.log('Ejecutando backtest base...\n');
  const baseResult = await runMRBacktest('BB_BOUNCE', baseConfig, baseParams);

  console.log('='.repeat(80));
  console.log('📊 RESULTADOS BASE');
  console.log('='.repeat(80));
  console.log(`Trades: ${baseResult.metrics.totalTrades}`);
  console.log(`Win Rate: ${baseResult.metrics.winRate.toFixed(1)}%`);
  console.log(`Expectancy: $${baseResult.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`ROI: ${((baseResult.metrics.netPnl / baseConfig.initialBalance) * 100).toFixed(1)}%`);
  console.log(`Profit Factor: ${baseResult.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${baseResult.metrics.maxDrawdown.toFixed(1)}%`);
  const maxConsecutiveLosses = baseResult.metrics.maxConsecutiveLosses || 0;
  console.log(`Max Consecutive Losses: ${maxConsecutiveLosses}`);

  // Analyze losing trades
  const losingTrades = baseResult.trades.filter(t => t.result === 'LOSS');
  const winningTrades = baseResult.trades.filter(t => t.result === 'WIN');

  console.log('\n' + '='.repeat(80));
  console.log('🔍 ANÁLISIS DE TRADES PERDEDORES');
  console.log('='.repeat(80));

  // Immediate reversals
  const immediateReversals = losingTrades.filter(t => t.barsHeld <= 2);
  console.log(`\nReversales inmediatas (≤2 barras): ${immediateReversals.length} (${((immediateReversals.length / losingTrades.length) * 100).toFixed(1)}%)`);

  // Near misses (using maxFavorableExcursion)
  const nearMisses = losingTrades.filter(t => {
    if (t.maxFavorableExcursion && t.tpPrice) {
      const tpDistance = Math.abs(t.tpPrice - t.entryPrice);
      const maxProfitPct = Math.abs(t.maxFavorableExcursion);
      return maxProfitPct >= tpDistance * 0.7; // Reached 70% of TP
    }
    return false;
  });
  console.log(`Near misses (alcanzó 70% TP): ${nearMisses.length} (${((nearMisses.length / losingTrades.length) * 100).toFixed(1)}%)`);

  // Session analysis (if available)
  const sessionLosses: Record<string, number> = {};
  const sessionWins: Record<string, number> = {};
  losingTrades.forEach(t => {
    const session = (t as any).session || 'UNKNOWN';
    sessionLosses[session] = (sessionLosses[session] || 0) + 1;
  });
  winningTrades.forEach(t => {
    const session = (t as any).session || 'UNKNOWN';
    sessionWins[session] = (sessionWins[session] || 0) + 1;
  });

  console.log('\nWin Rate por sesión:');
  for (const session of Object.keys({ ...sessionLosses, ...sessionWins })) {
    const wins = sessionWins[session] || 0;
    const losses = sessionLosses[session] || 0;
    const total = wins + losses;
    if (total > 0) {
      const wr = (wins / total) * 100;
      console.log(`  ${session}: ${wr.toFixed(1)}% (${wins}W / ${losses}L)`);
    }
  }

  // ADX analysis (if available)
  const lowADXTrades = baseResult.trades.filter(t => {
    const adx = (t as any).adxValue;
    return adx !== undefined && adx < 20;
  });
  if (lowADXTrades.length > 0) {
    const lowADXWins = lowADXTrades.filter(t => t.result === 'WIN').length;
    const lowADXWR = (lowADXWins / lowADXTrades.length) * 100;
    console.log(`\nTrades con ADX < 20: ${lowADXTrades.length} (WR: ${lowADXWR.toFixed(1)}%)`);
  }

  // Test improvements
  console.log('\n' + '='.repeat(80));
  console.log('🧪 PROBANDO MEJORAS (manteniendo alta frecuencia)');
  console.log('='.repeat(80));

  const improvements = [
    {
      name: '1. ADX más estricto (<25)',
      params: { ...baseParams, adxThreshold: 25 },
    },
    {
      name: '2. TP más grande (1.0%)',
      params: { ...baseParams, takeProfitPct: 0.01 },
    },
    {
      name: '3. TP más pequeño (0.5%)',
      params: { ...baseParams, takeProfitPct: 0.005 },
    },
    {
      name: '4. SL más ajustado (0.15×ATR)',
      params: { ...baseParams, slBuffer: 0.15 },
    },
    {
      name: '5. Clean Approach solo',
      params: { ...baseParams, requireCleanApproach: true },
    },
    {
      name: '6. Rejection solo',
      params: { ...baseParams, requireRejection: true },
    },
    {
      name: '7. ADX <25 + TP 1.0%',
      params: { ...baseParams, adxThreshold: 25, takeProfitPct: 0.01 },
    },
    {
      name: '8. ADX <25 + Clean Approach',
      params: { ...baseParams, adxThreshold: 25, requireCleanApproach: true },
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
  }> = [];

  for (const improvement of improvements) {
    process.stdout.write(`\rProbando: ${improvement.name}...`);
    try {
      const result = await runMRBacktest('BB_BOUNCE', baseConfig, improvement.params);
      const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;
      results.push({
        name: improvement.name,
        metrics: result.metrics,
        trades: result.metrics.totalTrades,
        expectancy: result.metrics.expectancy,
        roi,
        wr: result.metrics.winRate,
        pf: result.metrics.profitFactor,
      });
    } catch (error) {
      console.error(`\nError con ${improvement.name}:`, error);
    }
  }

  console.log('\n\n' + '='.repeat(120));
  console.log('📊 COMPARACIÓN DE MEJORAS');
  console.log('='.repeat(120));
  console.log('\n' +
    'Mejora'.padEnd(30) +
    'Trades'.padStart(8) +
    'Trades/día'.padStart(12) +
    'WR%'.padStart(8) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10) +
    'PF'.padStart(8) +
    'Mejora'.padStart(10)
  );
  console.log('-'.repeat(120));

  const baseExpectancy = baseResult.metrics.expectancy;
  const baseROI = (baseResult.metrics.netPnl / baseConfig.initialBalance) * 100;
  const baseTrades = baseResult.metrics.totalTrades;

  console.log(
    'BASE'.padEnd(30) +
    baseTrades.toString().padStart(8) +
    (baseTrades / 365).toFixed(1).padStart(12) +
    `${baseResult.metrics.winRate.toFixed(1)}%`.padStart(8) +
    `$${baseExpectancy.toFixed(2)}`.padStart(12) +
    `${baseROI.toFixed(1)}%`.padStart(10) +
    baseResult.metrics.profitFactor.toFixed(2).padStart(8) +
    '-'.padStart(10)
  );

  for (const r of results) {
    const expectancyChange = ((r.expectancy - baseExpectancy) / baseExpectancy) * 100;
    const roiChange = r.roi - baseROI;
    const tradesChange = ((r.trades - baseTrades) / baseTrades) * 100;
    
    const improvement = `${expectancyChange >= 0 ? '+' : ''}${expectancyChange.toFixed(1)}%`;
    const color = expectancyChange > 0 ? '✅' : expectancyChange < -5 ? '❌' : '➖';
    
    console.log(
      r.name.padEnd(30) +
      r.trades.toString().padStart(8) +
      (r.trades / 365).toFixed(1).padStart(12) +
      `${r.wr.toFixed(1)}%`.padStart(8) +
      `$${r.expectancy.toFixed(2)}`.padStart(12) +
      `${r.roi.toFixed(1)}%`.padStart(10) +
      r.pf.toFixed(2).padStart(8) +
      `${color} ${improvement}`.padStart(10)
    );
  }

  // Find best improvements
  const bestByExpectancy = [...results].sort((a, b) => b.expectancy - a.expectancy);
  const bestByROI = [...results].sort((a, b) => b.roi - a.roi);
  const bestByBalance = [...results]
    .filter(r => r.trades >= baseTrades * 0.8) // At least 80% of base trades
    .sort((a, b) => {
      const scoreA = a.expectancy * (a.trades / baseTrades);
      const scoreB = b.expectancy * (b.trades / baseTrades);
      return scoreB - scoreA;
    });

  console.log('\n' + '='.repeat(120));
  console.log('🏆 MEJORES MEJORAS');
  console.log('='.repeat(120));

  if (bestByExpectancy.length > 0) {
    const best = bestByExpectancy[0]!;
    console.log(`\n🥇 Mejor Expectancy: ${best.name}`);
    console.log(`   Trades: ${best.trades} (${((best.trades / baseTrades) * 100).toFixed(1)}% del base)`);
    console.log(`   Expectancy: $${best.expectancy.toFixed(2)} (${((best.expectancy - baseExpectancy) / baseExpectancy * 100).toFixed(1)}% mejora)`);
    console.log(`   ROI: ${best.roi.toFixed(1)}%`);
  }

  if (bestByBalance.length > 0) {
    const best = bestByBalance[0]!;
    console.log(`\n⚖️  Mejor Balance (Expectancy × Frecuencia): ${best.name}`);
    console.log(`   Trades: ${best.trades} (${((best.trades / baseTrades) * 100).toFixed(1)}% del base)`);
    console.log(`   Expectancy: $${best.expectancy.toFixed(2)}`);
    console.log(`   ROI: ${best.roi.toFixed(1)}%`);
  }

  console.log('\n' + '='.repeat(120) + '\n');
}

main().catch(console.error);

