import { loadCandlesFromCSV, runBacktest, createHybridMTFStrategy } from '../backtest/index.js';

const candles = loadCandlesFromCSV('data/R_100_1m_7d.csv', {
  asset: 'R_100',
  timeframe: 60,
  timestampFormat: 'unix_ms'
});

const strategy = createHybridMTFStrategy('R_100');
const result = runBacktest(strategy, candles, {
  initialBalance: 10000,
  multiplier: 100,
  stakeAmount: 100
});

console.log('Total trades:', result.trades.length);
console.log('Sample trades (first 5):');

for (const t of result.trades.slice(0, 5)) {
  console.log({
    direction: t.direction,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    pnl: t.pnl,
    result: t.result,
    entryIndex: t.entryIndex,
    exitIndex: t.exitIndex,
  });
}

// Calculate wins/losses manually
let wins = 0;
let losses = 0;
for (const t of result.trades) {
  if (t.result === 'WIN' || t.pnl > 0) wins++;
  else if (t.result === 'LOSS' || t.pnl < 0) losses++;
}

console.log(`\nManual count: ${wins} wins, ${losses} losses`);
