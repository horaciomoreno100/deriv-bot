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

// Replicate the createVisualizationData drawdown calculation
let maxDrawdown = 0;
let peak = 0;
let equity = 0;

console.log('Trade-by-trade drawdown calculation (createVisualizationData logic):');
console.log('─'.repeat(80));

for (let i = 0; i < Math.min(result.trades.length, 20); i++) {
  const trade = result.trades[i];
  const pnl = trade.result.pnl;
  equity += pnl;
  if (equity > peak) peak = equity;
  const drawdown = peak > 0 ? (peak - equity) / peak : 0;
  if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  
  console.log(`#${(i+1).toString().padStart(2)} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(0).padStart(5)} | Equity: ${equity.toFixed(0).padStart(6)} | Peak: ${peak.toFixed(0).padStart(6)} | DD: ${drawdown.toFixed(6)} | MaxDD: ${maxDrawdown.toFixed(6)}`);
}

console.log('─'.repeat(80));
console.log(`Final maxDrawdown: ${maxDrawdown}`);
console.log(`As percentage: ${(maxDrawdown * 100).toFixed(1)}%`);
