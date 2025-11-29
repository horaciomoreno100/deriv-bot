/**
 * Debug FVG Liquidity Sweep trades to understand why R_100 fails
 */

import { loadCandlesFromCSV } from '../backtest/data/index.js';
import { runBacktest } from '../backtest/runners/index.js';
import { createFVGLiquiditySweepStrategy } from '../backtest/strategies/fvg-liquidity-sweep-backtest.strategy.js';

const asset = process.env.ASSET || 'R_100';
const dataFile = process.env.DATA_FILE || `data/${asset}_1m_7d.csv`;

console.log(`\n📊 Debugging FVG-LS trades for ${asset}`);
console.log(`📂 Data file: ${dataFile}\n`);

// Load candles - match backtest runner options
const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampColumn: 'timestamp',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  timestampFormat: 'unix_ms',
});
console.log(`Loaded ${candles.length} candles`);

// Create strategy
const strategy = createFVGLiquiditySweepStrategy(asset);

// Run backtest
const result = runBacktest(strategy, candles, {
  initialBalance: 1000,
  stakePct: 0.02,
  multiplier: 100,
});

// Get metrics
const metrics = result.metrics;
console.log(`\n=== MÉTRICAS ===`);
console.log(`Total trades: ${metrics.totalTrades}`);
console.log(`Wins: ${metrics.wins} (${metrics.winRate.toFixed(1)}%)`);
console.log(`Losses: ${metrics.losses}`);
console.log(`Net P&L: $${metrics.netPnl.toFixed(2)}`);
console.log(`Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
console.log(`Max Drawdown: ${metrics.maxDrawdownPct.toFixed(1)}%`);
console.log(`Max Consec Losses: ${metrics.maxConsecutiveLosses}`);
console.log(`Near Misses: ${metrics.nearMisses}`);
console.log(`Immediate Reversals: ${metrics.immediateReversals}`);
console.log(`Avg Bars Held: ${metrics.avgBarsHeld.toFixed(1)}`);

// Analyze trades
if (result.trades.length === 0) {
  console.log('No trades generated!');
  process.exit(0);
}

// Analyze by direction
const calls = result.trades.filter(t => t.direction === 'CALL');
const puts = result.trades.filter(t => t.direction === 'PUT');

console.log(`\n=== POR DIRECCIÓN ===`);
console.log(`CALL: ${calls.length} trades`);
console.log(`PUT: ${puts.length} trades`);

// Analyze trade signals
console.log(`\n=== SEÑALES (primeras 10) ===`);
result.trades.slice(0, 10).forEach((trade, i) => {
  const signal = trade.signal;
  const snapshot = signal?.snapshot;
  if (snapshot) {
    const sweepType = snapshot.indicators?.sweepType || 'N/A';
    const confidence = snapshot.indicators?.confidence?.toFixed(2) || 'N/A';
    const rsi = snapshot.indicators?.rsi?.toFixed(1) || 'N/A';
    const price = snapshot.price?.toFixed(2) || 'N/A';
    const fvgTop = snapshot.indicators?.fvgTop?.toFixed(2) || 'N/A';
    const fvgBottom = snapshot.indicators?.fvgBottom?.toFixed(2) || 'N/A';
    const sweepLevel = snapshot.indicators?.sweepLevel?.toFixed(2) || 'N/A';

    console.log(`\n#${i + 1} ${trade.direction}`);
    console.log(`  Price: ${price}`);
    console.log(`  Sweep: ${sweepType} @ ${sweepLevel}`);
    console.log(`  FVG: ${fvgBottom} - ${fvgTop}`);
    console.log(`  RSI: ${rsi}`);
    console.log(`  Confidence: ${confidence}`);
  }
});

// Compare with R_75
console.log(`\n\n${'═'.repeat(60)}`);
console.log('COMPARACIÓN R_100 vs R_75');
console.log('═'.repeat(60));

const r75File = 'data/R_75_60s_30d.csv';
try {
  const r75Candles = loadCandlesFromCSV(r75File, {
    asset: 'R_75',
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });

  const r75Strategy = createFVGLiquiditySweepStrategy('R_75');
  const r75Result = runBacktest(r75Strategy, r75Candles, {
    initialBalance: 1000,
    stakePct: 0.02,
    multiplier: 100,
  });

  console.log(`\nR_100 (${candles.length} candles):`);
  console.log(`  Win Rate: ${metrics.winRate.toFixed(1)}%`);
  console.log(`  Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
  console.log(`  Max Consec Losses: ${metrics.maxConsecutiveLosses}`);
  console.log(`  Near Misses: ${metrics.nearMisses}`);

  console.log(`\nR_75 (${r75Candles.length} candles):`);
  console.log(`  Win Rate: ${r75Result.metrics.winRate.toFixed(1)}%`);
  console.log(`  Profit Factor: ${r75Result.metrics.profitFactor.toFixed(2)}`);
  console.log(`  Max Consec Losses: ${r75Result.metrics.maxConsecutiveLosses}`);
  console.log(`  Near Misses: ${r75Result.metrics.nearMisses}`);

  // Analyze trade quality indicators
  console.log(`\n=== CALIDAD DE SEÑALES ===`);

  // Confidence distribution
  const r100Confidences = result.trades
    .map(t => t.signal?.snapshot?.indicators?.confidence)
    .filter(c => c !== undefined) as number[];
  const r75Confidences = r75Result.trades
    .map(t => t.signal?.snapshot?.indicators?.confidence)
    .filter(c => c !== undefined) as number[];

  if (r100Confidences.length > 0 && r75Confidences.length > 0) {
    const avgR100Conf = r100Confidences.reduce((a, b) => a + b, 0) / r100Confidences.length;
    const avgR75Conf = r75Confidences.reduce((a, b) => a + b, 0) / r75Confidences.length;
    console.log(`\nAvg Confidence:`);
    console.log(`  R_100: ${avgR100Conf.toFixed(3)}`);
    console.log(`  R_75: ${avgR75Conf.toFixed(3)}`);
  }

  // Sweep type distribution
  const r100SweepTypes: Record<string, number> = {};
  result.trades.forEach(t => {
    const type = t.signal?.snapshot?.indicators?.sweepType as string || 'unknown';
    r100SweepTypes[type] = (r100SweepTypes[type] || 0) + 1;
  });

  const r75SweepTypes: Record<string, number> = {};
  r75Result.trades.forEach(t => {
    const type = t.signal?.snapshot?.indicators?.sweepType as string || 'unknown';
    r75SweepTypes[type] = (r75SweepTypes[type] || 0) + 1;
  });

  console.log(`\nSweep Types:`);
  console.log(`  R_100: BSL=${r100SweepTypes['BSL'] || 0}, SSL=${r100SweepTypes['SSL'] || 0}`);
  console.log(`  R_75: BSL=${r75SweepTypes['BSL'] || 0}, SSL=${r75SweepTypes['SSL'] || 0}`);

} catch (e) {
  console.log('Could not compare with R_75:', e);
}
