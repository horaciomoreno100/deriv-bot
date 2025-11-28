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

// Manual drawdown calculation
let balance = 10000;
let peak = 10000;
let maxDD = 0;
let maxDDPct = 0;

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;

console.log('Trade-by-trade equity curve:');
console.log('─'.repeat(60));

for (let i = 0; i < result.trades.length; i++) {
  const t = result.trades[i];
  const pnl = getPnl(t);
  balance += pnl;
  
  if (balance > peak) peak = balance;
  const dd = peak - balance;
  const ddPct = (dd / peak) * 100;
  
  if (dd > maxDD) {
    maxDD = dd;
    maxDDPct = ddPct;
  }
  
  if (i < 10 || dd === maxDD) {
    console.log(`#${(i+1).toString().padStart(2)} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(0).padStart(4)} | Balance: ${balance.toFixed(0).padStart(6)} | Peak: ${peak.toFixed(0)} | DD: ${dd.toFixed(0)} (${ddPct.toFixed(1)}%)`);
  }
}

console.log('─'.repeat(60));
console.log(`\nManual calculation:`);
console.log(`  Max Drawdown: $${maxDD.toFixed(2)} (${maxDDPct.toFixed(2)}%)`);
console.log(`\nBacktest engine reported:`);
console.log(`  Max Drawdown: $${result.metrics.maxDrawdown.toFixed(2)} (${result.metrics.maxDrawdownPct.toFixed(2)}%)`);
console.log(`\nMatch: ${Math.abs(maxDD - result.metrics.maxDrawdown) < 1 ? '✅ YES' : '❌ NO'}`);
