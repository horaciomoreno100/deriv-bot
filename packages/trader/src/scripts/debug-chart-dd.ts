import { loadCandlesFromCSV, runBacktest, createHybridMTFStrategy } from '../backtest/index.js';
import { createVisualizationData } from '@deriv-bot/shared';

const candles = loadCandlesFromCSV('data/R_100_1m_7d.csv', {
  asset: 'R_100',
  timeframe: 60,
  timestampFormat: 'unix_ms'
});

const strategy = createHybridMTFStrategy('R_100', {
  takeProfitPct: 0.004,
  stopLossPct: 0.003,
});

const result = runBacktest(strategy, candles, {
  initialBalance: 10000,
  multiplier: 100,
  stakeAmount: 100
});

// Convert indicator series Map to object
const indicators: Record<string, number[]> = {};
for (const [key, values] of result.indicatorSeries.entries()) {
  indicators[key] = values;
}

// Check what createVisualizationData produces
const vizData = createVisualizationData(
  result.asset,
  result.timeframe,
  result.candles,
  result.trades,
  indicators
);

console.log('Summary from createVisualizationData:');
console.log(JSON.stringify(vizData.summary, null, 2));

// Check the raw result.trades structure
console.log('\nFirst trade result structure:');
const t = result.trades[0];
if (t) {
  console.log('  result.pnl:', t.result?.pnl);
  console.log('  result.outcome:', t.result?.outcome);
}
