/**
 * Test Hybrid MTF Strategy with New Backtest Engine
 *
 * Usage:
 *   ASSET="R_100" npx tsx src/scripts/test-hybrid-mtf-backtest.ts
 */

import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  exportChart,
  createHybridMTFStrategy,
} from '../backtest/index.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_100';
const days = process.env.DAYS || '90';
const tpPct = process.env.TP_PCT ? parseFloat(process.env.TP_PCT) : undefined;
const slPct = process.env.SL_PCT ? parseFloat(process.env.SL_PCT) : undefined;

// Find data file
const possiblePaths = [
  join(process.cwd(), `data/${asset}_1m_${days}d.csv`),
  join(process.cwd(), `data/${asset}_60s_${days}d.csv`),
];

let dataFile: string | null = null;
for (const p of possiblePaths) {
  if (existsSync(p)) {
    dataFile = p;
    break;
  }
}

if (!dataFile) {
  console.error(`❌ No data file found for ${asset} with ${days} days`);
  console.error('Tried:', possiblePaths);
  process.exit(1);
}

console.log('='.repeat(80));
console.log(`🧬 HYBRID MTF BACKTEST - ${asset}`);
console.log('='.repeat(80));
console.log(`Loading candles from: ${dataFile}`);

// Data files have timestamps in milliseconds
const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampFormat: 'unix_ms',
});
console.log(`Loaded ${candles.length} candles`);

const strategyParams: Record<string, number> = {};
if (tpPct !== undefined) strategyParams.takeProfitPct = tpPct;
if (slPct !== undefined) strategyParams.stopLossPct = slPct;

const strategy = createHybridMTFStrategy(asset, Object.keys(strategyParams).length > 0 ? strategyParams : undefined);
console.log(`\nRunning backtest for: ${strategy.name} v${strategy.version}`);
console.log('Parameters:', JSON.stringify(strategy.getDefaultConfig(), null, 2));

// Usar mismas condiciones que BB-Squeeze-MR para comparar
const result = runBacktest(strategy, candles, {
  initialBalance: 1000,
  multiplier: 200,
  stakeAmount: 20, // 2% de 1000 (mismo que BB-Squeeze-MR)
});

printBacktestResult(result);

// Export chart
const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '');
const chartFile = `analysis-output/chart_Hybrid-MTF_${asset}_${timestamp}.html`;
exportChart(result, chartFile);
console.log(`\n📊 Chart exported to: ${chartFile}`);
