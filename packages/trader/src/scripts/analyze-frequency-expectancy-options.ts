#!/usr/bin/env tsx
/**
 * Analyze specific configurations that balance frequency and expectancy
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const resultsPath = join(process.cwd(), 'analysis-output', 'bb_bounce_grid_search.json');

if (!existsSync(resultsPath)) {
  console.error('❌ Grid search results not found.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resultsPath, 'utf-8'));

// Get all unique strategies
const all = [...data.topByExpectancy, ...data.topByROI];
const unique = new Map();
all.forEach((r: any) => {
  const key = `${r.params.tp}-${r.params.slBuffer}-${r.params.rejection}-${r.params.cleanApproach}-${r.params.adx}`;
  if (!unique.has(key) || unique.get(key).metrics.trades < r.metrics.trades) {
    unique.set(key, r);
  }
});

const strategies = Array.from(unique.values())
  .filter((r: any) => r.metrics.netPnl > 0 && r.metrics.profitFactor >= 1.0);

console.log('\n' + '='.repeat(120));
console.log('🎯 OPCIONES: FRECUENCIA + ESPERANZA MATEMÁTICA');
console.log('='.repeat(120));

// Option 1: Best expectancy with good frequency (>= 0.40 expectancy, most trades)
const option1 = strategies
  .filter((r: any) => r.metrics.expectancy >= 0.40)
  .sort((a: any, b: any) => b.metrics.trades - a.metrics.trades)[0];

// Option 2: High frequency with decent expectancy (>= 1000 trades, best expectancy)
const option2 = strategies
  .filter((r: any) => r.metrics.trades >= 1000)
  .sort((a: any, b: any) => b.metrics.expectancy - a.metrics.expectancy)[0];

// Option 3: Best balance (expectancy * trades)
const option3 = strategies
  .map((r: any) => ({ ...r, balance: r.metrics.expectancy * r.metrics.trades }))
  .sort((a: any, b: any) => b.balance - a.balance)[0];

// Option 4: Very high frequency with acceptable expectancy (>= 2000 trades, expectancy >= 0.30)
const option4 = strategies
  .filter((r: any) => r.metrics.trades >= 2000 && r.metrics.expectancy >= 0.30)
  .sort((a: any, b: any) => b.metrics.expectancy - a.metrics.expectancy)[0];

function printOption(name: string, r: any) {
  if (!r) return;
  console.log(`\n${name}:`);
  console.log('─'.repeat(120));
  console.log(`  Configuración:`);
  console.log(`    TP: ${(r.params.tp*100).toFixed(2)}%`);
  console.log(`    SL Buffer: ${r.params.slBuffer}×ATR`);
  console.log(`    Require Rejection: ${r.params.rejection ? 'Yes' : 'No'}`);
  console.log(`    Require Clean Approach: ${r.params.cleanApproach ? 'Yes' : 'No'}`);
  console.log(`    ADX Threshold: <${r.params.adx}`);
  console.log(`\n  Métricas:`);
  console.log(`    Trades: ${r.metrics.trades} (${(r.metrics.trades/365).toFixed(1)}/día, ${(r.metrics.trades/52).toFixed(1)}/semana)`);
  console.log(`    Win Rate: ${r.metrics.winRate.toFixed(1)}%`);
  console.log(`    Expectancy: $${r.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`    ROI: ${r.metrics.roi.toFixed(1)}%`);
  console.log(`    Profit Factor: ${r.metrics.profitFactor.toFixed(2)}`);
  console.log(`    Max Drawdown: ${(r.streaks?.worstDrawdown || r.metrics.maxDrawdown || 0).toFixed(1)}%`);
  console.log(`    Max Consecutive Losses: ${r.streaks?.maxConsecutiveLosses || 'N/A'}`);
  console.log(`    P&L Total: $${r.metrics.netPnl.toFixed(2)}`);
  if (r.balance) {
    console.log(`    Balance Score (Expectancy × Trades): ${r.balance.toFixed(0)}`);
  }
}

printOption('🏆 OPCIÓN 1: Mejor Expectancy (≥$0.40) con Más Trades', option1);
printOption('📈 OPCIÓN 2: Alta Frecuencia (≥1000 trades) con Mejor Expectancy', option2);
printOption('⚖️  OPCIÓN 3: Mejor Balance (Expectancy × Trades)', option3);
printOption('🚀 OPCIÓN 4: Muy Alta Frecuencia (≥2000 trades) con Expectancy ≥$0.30', option4);

// Comparison table
console.log('\n' + '='.repeat(120));
console.log('📊 COMPARACIÓN LADO A LADO');
console.log('='.repeat(120));
console.log('\n' +
  'Opción'.padEnd(25) +
  'TP%'.padStart(6) +
  'SL×'.padStart(5) +
  'Filtros'.padStart(10) +
  'Trades'.padStart(8) +
  'Trades/día'.padStart(12) +
  'WR%'.padStart(8) +
  'Expectancy'.padStart(12) +
  'ROI%'.padStart(10) +
  'PF'.padStart(8) +
  'Max L'.padStart(7)
);
console.log('-'.repeat(120));

const options = [
  { name: 'Opción 1: Mejor Expectancy', r: option1 },
  { name: 'Opción 2: Alta Frecuencia', r: option2 },
  { name: 'Opción 3: Mejor Balance', r: option3 },
  { name: 'Opción 4: Muy Alta Frecuencia', r: option4 },
].filter(o => o.r);

options.forEach(({ name, r }) => {
  const filters = `${r.params.rejection ? 'R' : ''}${r.params.cleanApproach ? 'C' : ''}` || 'None';
  console.log(
    name.padEnd(25) +
    `${(r.params.tp*100).toFixed(2)}%`.padStart(6) +
    `${r.params.slBuffer}×`.padStart(5) +
    filters.padStart(10) +
    r.metrics.trades.toString().padStart(8) +
    (r.metrics.trades/365).toFixed(1).padStart(12) +
    `${r.metrics.winRate.toFixed(1)}%`.padStart(8) +
    `$${r.metrics.expectancy.toFixed(2)}`.padStart(12) +
    `${r.metrics.roi.toFixed(1)}%`.padStart(10) +
    r.metrics.profitFactor.toFixed(2).padStart(8) +
    (r.streaks?.maxConsecutiveLosses || 'N/A').toString().padStart(7)
  );
});

// Recommendation
console.log('\n' + '='.repeat(120));
console.log('💡 RECOMENDACIÓN');
console.log('='.repeat(120));

if (option1 && option2) {
  const rec = option1.metrics.trades >= 1000 ? option1 : option2;
  console.log(`\n✅ Para maximizar frecuencia Y buena esperanza matemática:`);
  console.log(`\n   Configuración recomendada:`);
  console.log(`   - TP: ${(rec.params.tp*100).toFixed(2)}%`);
  console.log(`   - SL Buffer: ${rec.params.slBuffer}×ATR`);
  console.log(`   - Require Rejection: ${rec.params.rejection ? 'Yes' : 'No'}`);
  console.log(`   - Require Clean Approach: ${rec.params.cleanApproach ? 'Yes' : 'No'}`);
  console.log(`   - ADX Threshold: <${rec.params.adx}`);
  console.log(`\n   Resultados esperados:`);
  console.log(`   - ${rec.metrics.trades} trades/año (${(rec.metrics.trades/365).toFixed(1)}/día)`);
  console.log(`   - Expectancy: $${rec.metrics.expectancy.toFixed(2)}/trade`);
  console.log(`   - ROI: ${rec.metrics.roi.toFixed(1)}%`);
  console.log(`   - Win Rate: ${rec.metrics.winRate.toFixed(1)}%`);
}

console.log('\n' + '='.repeat(120) + '\n');

