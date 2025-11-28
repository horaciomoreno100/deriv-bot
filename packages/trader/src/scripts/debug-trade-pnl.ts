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

console.log('First 10 trades - result object:');
for (let i = 0; i < 10; i++) {
  const t = result.trades[i];
  console.log(`#${i+1}: result =`, JSON.stringify(t.result));
}
