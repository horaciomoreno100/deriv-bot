#!/usr/bin/env tsx
/**
 * Find configurations that balance high frequency (many trades) with good expectancy
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const resultsPath = join(process.cwd(), 'analysis-output', 'bb_bounce_grid_search.json');

if (!existsSync(resultsPath)) {
  console.error('❌ Grid search results not found. Run grid-search-bb-bounce.ts first.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resultsPath, 'utf-8'));

// Filter profitable strategies
const profitable = data.topByExpectancy.filter((r: any) => r.metrics.netPnl > 0 && r.metrics.profitFactor >= 1.0);

// Score: balance between frequency (trades) and expectancy
// Higher score = better balance
const scored = profitable.map((r: any) => {
  const trades = r.metrics.trades;
  const expectancy = r.metrics.expectancy;
  
  // Normalize trades (0-1 scale, assuming max ~2700)
  const normalizedTrades = Math.min(trades / 2700, 1);
  
  // Normalize expectancy (0-1 scale, assuming max ~$1.00)
  const normalizedExpectancy = Math.min(expectancy / 1.0, 1);
  
  // Combined score: 50% frequency + 50% expectancy
  const frequencyScore = normalizedTrades * 0.5;
  const expectancyScore = normalizedExpectancy * 0.5;
  const combinedScore = frequencyScore + expectancyScore;
  
  // Alternative: weighted product (favors balance)
  const productScore = normalizedTrades * normalizedExpectancy;
  
  return {
    ...r,
    score: combinedScore,
    productScore,
    normalizedTrades,
    normalizedExpectancy,
  };
});

// Sort by combined score
const sortedByBalance = [...scored].sort((a, b) => b.score - a.score);
// Sort by product (favors balance)
const sortedByProduct = [...scored].sort((a, b) => b.productScore - a.productScore);
// Sort by trades (frequency)
const sortedByTrades = [...profitable].sort((a: any, b: any) => b.metrics.trades - a.metrics.trades);

console.log('\n' + '='.repeat(120));
console.log('🎯 CONFIGURACIONES: FRECUENCIA + ESPERANZA MATEMÁTICA');
console.log('='.repeat(120));
console.log('\nBuscando el mejor balance entre muchos trades y buena expectancy...\n');

console.log('='.repeat(120));
console.log('🏆 TOP 15 POR BALANCE (Frecuencia + Expectancy)');
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
  'Expectancy'.padStart(12) +
  'ROI%'.padStart(10) +
  'Score'.padStart(10) +
  'Max L'.padStart(7)
);
console.log('-'.repeat(120));

for (let i = 0; i < Math.min(15, sortedByBalance.length); i++) {
  const r = sortedByBalance[i]!;
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
    `$${r.metrics.expectancy.toFixed(2)}`.padStart(12) +
    `${r.metrics.roi.toFixed(1)}%`.padStart(10) +
    r.score.toFixed(3).padStart(10) +
    r.streaks.maxConsecutiveLosses.toString().padStart(7)
  );
}

console.log('\n' + '='.repeat(120));
console.log('⚖️  TOP 15 POR PRODUCTO (Favorece Balance)');
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
  'Expectancy'.padStart(12) +
  'ROI%'.padStart(10) +
  'Product'.padStart(10) +
  'Max L'.padStart(7)
);
console.log('-'.repeat(120));

for (let i = 0; i < Math.min(15, sortedByProduct.length); i++) {
  const r = sortedByProduct[i]!;
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
    `$${r.metrics.expectancy.toFixed(2)}`.padStart(12) +
    `${r.metrics.roi.toFixed(1)}%`.padStart(10) +
    r.productScore.toFixed(3).padStart(10) +
    r.streaks.maxConsecutiveLosses.toString().padStart(7)
  );
}

// Find sweet spot: high frequency with decent expectancy
console.log('\n' + '='.repeat(120));
console.log('🎯 SWEET SPOT: Alta Frecuencia + Buena Expectancy');
console.log('='.repeat(120));

// Filter: at least 1000 trades AND expectancy >= $0.40
const sweetSpot = profitable
  .filter((r: any) => r.metrics.trades >= 1000 && r.metrics.expectancy >= 0.40)
  .sort((a: any, b: any) => {
    // Sort by expectancy first, then by trades
    if (Math.abs(a.metrics.expectancy - b.metrics.expectancy) > 0.01) {
      return b.metrics.expectancy - a.metrics.expectancy;
    }
    return b.metrics.trades - a.metrics.trades;
  });

if (sweetSpot.length > 0) {
  console.log(`\nEncontradas ${sweetSpot.length} configuraciones con ≥1000 trades y expectancy ≥$0.40:\n`);
  console.log(
    'Rank'.padEnd(6) +
    'TP%'.padStart(6) +
    'SL×'.padStart(5) +
    'Rej'.padStart(5) +
    'Clean'.padStart(7) +
    'ADX'.padStart(5) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'Expectancy'.padStart(12) +
    'ROI%'.padStart(10) +
    'PF'.padStart(8) +
    'Max L'.padStart(7)
  );
  console.log('-'.repeat(120));

  for (let i = 0; i < Math.min(10, sweetSpot.length); i++) {
    const r = sweetSpot[i]!;
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
      `$${r.metrics.expectancy.toFixed(2)}`.padStart(12) +
      `${r.metrics.roi.toFixed(1)}%`.padStart(10) +
      r.metrics.profitFactor.toFixed(2).padStart(8) +
      r.streaks.maxConsecutiveLosses.toString().padStart(7)
    );
  }

  // Best sweet spot
  const best = sweetSpot[0];
  console.log('\n' + '='.repeat(120));
  console.log('🏆 MEJOR CONFIGURACIÓN: FRECUENCIA + ESPERANZA');
  console.log('='.repeat(120));
  console.log(`\n  TP: ${(best.params.tp*100).toFixed(2)}%`);
  console.log(`  SL Buffer: ${best.params.slBuffer}×ATR`);
  console.log(`  Require Rejection: ${best.params.rejection ? 'Yes' : 'No'}`);
  console.log(`  Require Clean Approach: ${best.params.cleanApproach ? 'Yes' : 'No'}`);
  console.log(`  ADX Threshold: <${best.params.adx}`);
  console.log(`\n  Métricas:`);
  console.log(`    Trades: ${best.metrics.trades} (${(best.metrics.trades / 365).toFixed(1)}/día)`);
  console.log(`    Win Rate: ${best.metrics.winRate.toFixed(1)}%`);
  console.log(`    Expectancy: $${best.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`    ROI: ${best.metrics.roi.toFixed(1)}%`);
  console.log(`    Profit Factor: ${best.metrics.profitFactor.toFixed(2)}`);
  console.log(`    Max Drawdown: ${best.streaks.worstDrawdown.toFixed(1)}%`);
  console.log(`    Max Consecutive Losses: ${best.streaks.maxConsecutiveLosses}`);
} else {
  console.log('\n⚠️  No se encontraron configuraciones con ≥1000 trades y expectancy ≥$0.40');
  console.log('Buscando configuraciones con ≥500 trades y expectancy ≥$0.35...\n');
  
  const alternative = profitable
    .filter((r: any) => r.metrics.trades >= 500 && r.metrics.expectancy >= 0.35)
    .sort((a: any, b: any) => {
      if (Math.abs(a.metrics.expectancy - b.metrics.expectancy) > 0.01) {
        return b.metrics.expectancy - a.metrics.expectancy;
      }
      return b.metrics.trades - a.metrics.trades;
    });

  if (alternative.length > 0) {
    console.log(`Encontradas ${alternative.length} configuraciones:\n`);
    for (let i = 0; i < Math.min(5, alternative.length); i++) {
      const r = alternative[i]!;
      console.log(`  ${i+1}. TP ${(r.params.tp*100).toFixed(2)}%, SL ${r.params.slBuffer}×, Trades: ${r.metrics.trades}, Expectancy: $${r.metrics.expectancy.toFixed(2)}`);
    }
  }
}

console.log('\n' + '='.repeat(120) + '\n');

