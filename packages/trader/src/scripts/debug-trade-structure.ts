import { loadCandlesFromCSV, runBacktest, createHybridMTFStrategy } from '../backtest/index.js';

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

console.log('Total trades:', result.trades.length);
console.log('Sample trade structure (first 3):');

for (const t of result.trades.slice(0, 3)) {
  console.log(JSON.stringify(t, null, 2));
}
