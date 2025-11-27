#!/usr/bin/env tsx
/**
 * Display grid search results in a formatted way
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const resultsPath = join(process.cwd(), 'analysis-output', 'bb_bounce_grid_search.json');

if (!existsSync(resultsPath)) {
  console.error('❌ Grid search results not found. Run grid-search-bb-bounce.ts first.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resultsPath, 'utf-8'));

console.log('\n' + '='.repeat(120));
console.log('🏆 RESULTADOS COMPLETOS DEL GRID SEARCH');
console.log('='.repeat(120));
console.log(`\nTotal combinaciones probadas: ${data.totalCombinations}`);
console.log(`Estrategias rentables: ${data.profitable}`);
console.log(`Estrategias no rentables: ${data.totalCombinations - data.profitable}`);

if (data.topByExpectancy && data.topByExpectancy.length > 0) {
  console.log('\n' + '='.repeat(120));
  console.log('🥇 TOP 20 POR ESPERANZA MATEMÁTICA');
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

  data.topByExpectancy.forEach((r: any, i: number) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(
      `${medal} #${(i+1)}`.padEnd(6) +
      `${(r.params.tp*100).toFixed(2)}%`.padStart(6) +
      `${r.params.slBuffer}×`.padStart(5) +
      (r.params.rejection ? 'Yes' : 'No').padStart(5) +
      (r.params.cleanApproach ? 'Yes' : 'No').padStart(7) +
      `<${r.params.adx}`.padStart(5) +
      r.metrics.trades.toString().padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      r.metrics.profitFactor.toFixed(2).padStart(8) +
      `$${r.metrics.expectancy.toFixed(2)}`.padStart(12) +
      `${r.metrics.roi.toFixed(1)}%`.padStart(10) +
      r.streaks.maxConsecutiveWins.toString().padStart(6) +
      r.streaks.maxConsecutiveLosses.toString().padStart(6) +
      `${r.streaks.worstDrawdown.toFixed(1)}%`.padStart(10)
    );
  });
}

if (data.topByROI && data.topByROI.length > 0) {
  console.log('\n' + '='.repeat(120));
  console.log('💰 TOP 20 POR ROI');
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
    'ROI%'.padStart(10)
  );
  console.log('-'.repeat(120));

  data.topByROI.forEach((r: any, i: number) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(
      `${medal} #${(i+1)}`.padEnd(6) +
      `${(r.params.tp*100).toFixed(2)}%`.padStart(6) +
      `${r.params.slBuffer}×`.padStart(5) +
      (r.params.rejection ? 'Yes' : 'No').padStart(5) +
      (r.params.cleanApproach ? 'Yes' : 'No').padStart(7) +
      `<${r.params.adx}`.padStart(5) +
      r.metrics.trades.toString().padStart(8) +
      `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
      r.metrics.profitFactor.toFixed(2).padStart(8) +
      `$${r.metrics.expectancy.toFixed(2)}`.padStart(12) +
      `${r.metrics.roi.toFixed(1)}%`.padStart(10)
    );
  });
}

// Best overall
if (data.topByExpectancy && data.topByExpectancy.length > 0) {
  const best = data.topByExpectancy[0];
  console.log('\n' + '='.repeat(120));
  console.log('🏆 MEJOR CONFIGURACIÓN (Por Esperanza Matemática)');
  console.log('='.repeat(120));
  console.log(`\n  TP: ${(best.params.tp*100).toFixed(2)}%`);
  console.log(`  SL Buffer: ${best.params.slBuffer}×ATR`);
  console.log(`  Require Rejection: ${best.params.rejection ? 'Yes' : 'No'}`);
  console.log(`  Require Clean Approach: ${best.params.cleanApproach ? 'Yes' : 'No'}`);
  console.log(`  ADX Threshold: <${best.params.adx}`);
  console.log(`\n  Métricas:`);
  console.log(`    Trades: ${best.metrics.trades}`);
  console.log(`    Win Rate: ${best.metrics.winRate.toFixed(1)}%`);
  console.log(`    Profit Factor: ${best.metrics.profitFactor.toFixed(2)}`);
  console.log(`    Expectancy: $${best.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`    ROI: ${best.metrics.roi.toFixed(1)}%`);
  console.log(`    Max Drawdown: ${best.streaks.worstDrawdown.toFixed(1)}%`);
  console.log(`    Max Consecutive Wins: ${best.streaks.maxConsecutiveWins}`);
  console.log(`    Max Consecutive Losses: ${best.streaks.maxConsecutiveLosses}`);
}

console.log('\n' + '='.repeat(120) + '\n');

