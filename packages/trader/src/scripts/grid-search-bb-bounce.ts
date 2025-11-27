#!/usr/bin/env tsx
/**
 * Grid Search - Test all possible combinations
 * Analyze how we handle winning/losing streaks
 */

import { join } from 'path';
import { existsSync, writeFileSync } from 'fs';
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
  console.log('🔬 GRID SEARCH - TODAS LAS COMBINACIONES POSIBLES');
  console.log('='.repeat(80));
  console.log('Analizando: TP, SL buffer, filtros, y manejo de rachas\n');

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

  // Grid de parámetros
  const tpValues = [0.003, 0.005, 0.0075, 0.01]; // 0.3%, 0.5%, 0.75%, 1.0%
  const slBuffers = [0.2, 0.3, 0.5]; // ATR multipliers
  const requireRejection = [false, true];
  const requireCleanApproach = [false, true];
  const adxThresholds = [25, 30];

  const totalCombinations = tpValues.length * slBuffers.length * requireRejection.length * requireCleanApproach.length * adxThresholds.length;
  
  console.log(`Total combinaciones: ${totalCombinations}`);
  console.log('Iniciando grid search...\n');

  const results: Array<{
    params: {
      tp: number;
      slBuffer: number;
      rejection: boolean;
      cleanApproach: boolean;
      adx: number;
    };
    metrics: any;
    roi: number;
    expectancy: number;
    streakAnalysis: {
      maxConsecutiveWins: number;
      maxConsecutiveLosses: number;
      avgStreakLength: number;
      worstDrawdown: number;
    };
  }> = [];

  let count = 0;
  for (const tp of tpValues) {
    for (const slBuffer of slBuffers) {
      for (const rejection of requireRejection) {
        for (const cleanApproach of requireCleanApproach) {
          for (const adx of adxThresholds) {
            count++;
            const params: Partial<BBBounceParams> = {
              slBuffer,
              requireRejection: rejection,
              requireCleanApproach: cleanApproach,
              adxThreshold: adx,
              takeProfitPct: tp,
            };

            const config: MRBacktestConfig = {
              ...baseConfig,
              takeProfitPct: tp,
            };

            process.stdout.write(`\r[${count}/${totalCombinations}] Testing TP:${(tp*100).toFixed(2)}% SL:${slBuffer}× Rej:${rejection} Clean:${cleanApproach} ADX:<${adx}...`);

            try {
              const result = await runMRBacktest('BB_BOUNCE', config, params);
              const roi = (result.metrics.netPnl / baseConfig.initialBalance) * 100;
              const expectancy = result.metrics.expectancy;

              // Analyze streaks
              const trades = result.trades;
              let currentStreak = 0;
              let currentType: 'WIN' | 'LOSS' | null = null;
              let maxConsecutiveWins = 0;
              let maxConsecutiveLosses = 0;
              const streakLengths: number[] = [];

              for (const trade of trades) {
                if (trade.result === currentType) {
                  currentStreak++;
                } else {
                  if (currentStreak > 0) {
                    streakLengths.push(currentStreak);
                  }
                  currentStreak = 1;
                  currentType = trade.result;
                }

                if (trade.result === 'WIN') {
                  maxConsecutiveWins = Math.max(maxConsecutiveWins, currentStreak);
                } else {
                  maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
                }
              }

              const avgStreakLength = streakLengths.length > 0
                ? streakLengths.reduce((a, b) => a + b, 0) / streakLengths.length
                : 0;

              results.push({
                params: {
                  tp,
                  slBuffer,
                  rejection,
                  cleanApproach,
                  adx,
                },
                metrics: result.metrics,
                roi,
                expectancy,
                streakAnalysis: {
                  maxConsecutiveWins,
                  maxConsecutiveLosses,
                  avgStreakLength,
                  worstDrawdown: result.metrics.maxDrawdown,
                },
              });
            } catch (error) {
              console.error(`\nError with combination:`, error);
            }
          }
        }
      }
    }
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('📊 RESULTADOS DEL GRID SEARCH');
  console.log('='.repeat(80));

  // Filter profitable strategies
  const profitable = results.filter(r => r.metrics.netPnl > 0 && r.metrics.profitFactor >= 1.0);
  const sortedByExpectancy = [...profitable].sort((a, b) => b.expectancy - a.expectancy);
  const sortedByROI = [...profitable].sort((a, b) => b.roi - a.roi);
  const sortedByWR = [...profitable].sort((a, b) => b.metrics.winRate - a.metrics.winRate);
  const sortedByPF = [...profitable].sort((a, b) => b.metrics.profitFactor - a.metrics.profitFactor);

  console.log(`\nTotal combinaciones probadas: ${results.length}`);
  console.log(`Estrategias rentables: ${profitable.length}`);
  console.log(`Estrategias no rentables: ${results.length - profitable.length}`);

  // Top 10 by Expectancy
  console.log('\n' + '='.repeat(120));
  console.log('🏆 TOP 10 POR ESPERANZA MATEMÁTICA');
  console.log('='.repeat(120));
  console.log('\n' +
    'Rank'.padEnd(6) +
    'TP%'.padStart(6) +
    'SL×'.padStart(5) +
    'Rej'.padStart(5) +
    'Clean'.padStart(7) +
    'ADX'.padStart(5) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10) +
    'Max W'.padStart(6) +
    'Max L'.padStart(6) +
    'Max DD%'.padStart(10)
  );
  console.log('-'.repeat(120));

  for (let i = 0; i < Math.min(10, sortedByExpectancy.length); i++) {
    const r = sortedByExpectancy[i]!;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(
      `${medal} #${(i+1)}`.padEnd(6) +
      `${(r.params.tp*100).toFixed(2)}%`.padStart(6) +
      `${r.params.slBuffer}×`.padStart(5) +
      (r.params.rejection ? 'Yes' : 'No').padStart(5) +
      (r.params.cleanApproach ? 'Yes' : 'No').padStart(7) +
      `<${r.params.adx}`.padStart(5) +
      r.metrics.totalTrades.toString().padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      r.metrics.profitFactor.toFixed(2).padStart(8) +
      `$${r.expectancy.toFixed(2)}`.padStart(12) +
      `${r.roi.toFixed(1)}%`.padStart(10) +
      r.streakAnalysis.maxConsecutiveWins.toString().padStart(6) +
      r.streakAnalysis.maxConsecutiveLosses.toString().padStart(6) +
      `${r.streakAnalysis.worstDrawdown.toFixed(1)}%`.padStart(10)
    );
  }

  // Top 10 by ROI
  console.log('\n' + '='.repeat(120));
  console.log('🏆 TOP 10 POR ROI');
  console.log('='.repeat(120));
  console.log('\n' +
    'Rank'.padEnd(6) +
    'TP%'.padStart(6) +
    'SL×'.padStart(5) +
    'Rej'.padStart(5) +
    'Clean'.padStart(7) +
    'ADX'.padStart(5) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'PF'.padStart(8) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10) +
    'Max W'.padStart(6) +
    'Max L'.padStart(6)
  );
  console.log('-'.repeat(120));

  for (let i = 0; i < Math.min(10, sortedByROI.length); i++) {
    const r = sortedByROI[i]!;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(
      `${medal} #${(i+1)}`.padEnd(6) +
      `${(r.params.tp*100).toFixed(2)}%`.padStart(6) +
      `${r.params.slBuffer}×`.padStart(5) +
      (r.params.rejection ? 'Yes' : 'No').padStart(5) +
      (r.params.cleanApproach ? 'Yes' : 'No').padStart(7) +
      `<${r.params.adx}`.padStart(5) +
      r.metrics.totalTrades.toString().padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      r.metrics.profitFactor.toFixed(2).padStart(8) +
      `$${r.expectancy.toFixed(2)}`.padStart(12) +
      `${r.roi.toFixed(1)}%`.padStart(10) +
      r.streakAnalysis.maxConsecutiveWins.toString().padStart(6) +
      r.streakAnalysis.maxConsecutiveLosses.toString().padStart(6)
    );
  }

  // Streak Analysis
  console.log('\n' + '='.repeat(120));
  console.log('📊 ANÁLISIS DE RACHAS (STREAKS)');
  console.log('='.repeat(120));

  const bestByExpectancy = sortedByExpectancy[0];
  if (bestByExpectancy) {
    console.log(`\nMejor estrategia (por Expectancy):`);
    console.log(`  Config: TP ${(bestByExpectancy.params.tp*100).toFixed(2)}%, SL ${bestByExpectancy.params.slBuffer}×ATR`);
    console.log(`  Max Consecutive Wins: ${bestByExpectancy.streakAnalysis.maxConsecutiveWins}`);
    console.log(`  Max Consecutive Losses: ${bestByExpectancy.streakAnalysis.maxConsecutiveLosses}`);
    console.log(`  Avg Streak Length: ${bestByExpectancy.streakAnalysis.avgStreakLength.toFixed(1)}`);
    console.log(`  Max Drawdown: ${bestByExpectancy.streakAnalysis.worstDrawdown.toFixed(1)}%`);
  }

  // Analyze streak patterns
  console.log('\n📈 Patrones de rachas:');
  const highWR = sortedByWR.slice(0, 5);
  const lowDD = [...profitable].sort((a, b) => a.streakAnalysis.worstDrawdown - b.streakAnalysis.worstDrawdown).slice(0, 5);

  console.log('\nTop 5 por Win Rate:');
  for (const r of highWR) {
    console.log(`  WR ${r.metrics.winRate.toFixed(1)}%: Max W=${r.streakAnalysis.maxConsecutiveWins}, Max L=${r.streakAnalysis.maxConsecutiveLosses}, DD=${r.streakAnalysis.worstDrawdown.toFixed(1)}%`);
  }

  console.log('\nTop 5 por Menor Drawdown:');
  for (const r of lowDD) {
    console.log(`  DD ${r.streakAnalysis.worstDrawdown.toFixed(1)}%: Max W=${r.streakAnalysis.maxConsecutiveWins}, Max L=${r.streakAnalysis.maxConsecutiveLosses}, WR=${r.metrics.winRate.toFixed(1)}%`);
  }

  // Save results
  const outputPath = join(process.cwd(), 'analysis-output', 'bb_bounce_grid_search.json');
  writeFileSync(outputPath, JSON.stringify({
    totalCombinations: results.length,
    profitable: profitable.length,
    topByExpectancy: sortedByExpectancy.slice(0, 20).map(r => ({
      params: r.params,
      metrics: {
        trades: r.metrics.totalTrades,
        winRate: r.metrics.winRate,
        profitFactor: r.metrics.profitFactor,
        netPnl: r.metrics.netPnl,
        expectancy: r.expectancy,
        roi: r.roi,
        maxDrawdown: r.streakAnalysis.worstDrawdown,
      },
      streaks: r.streakAnalysis,
    })),
    topByROI: sortedByROI.slice(0, 20).map(r => ({
      params: r.params,
      metrics: {
        trades: r.metrics.totalTrades,
        winRate: r.metrics.winRate,
        profitFactor: r.metrics.profitFactor,
        netPnl: r.metrics.netPnl,
        expectancy: r.expectancy,
        roi: r.roi,
      },
    })),
  }, null, 2));

  console.log(`\n💾 Resultados guardados en: ${outputPath}`);
  console.log('\n' + '='.repeat(120) + '\n');
}

main().catch(console.error);

