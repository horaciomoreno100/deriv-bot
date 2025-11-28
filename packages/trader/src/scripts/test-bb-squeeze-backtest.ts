/**
 * BB-Squeeze Mean Reversion Backtest Analysis
 *
 * Analyze the edges and performance of BB-Squeeze MR strategy
 */

import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  exportChart,
} from '../backtest/index.js';
import { BBSqueezeMRBacktestStrategy } from '../backtest/strategies/bb-squeeze-mr-backtest.strategy.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_75';
const days = process.env.DAYS || '90';

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
  console.error(`No data file found for ${asset} with ${days} days`);
  console.error('Tried:', possiblePaths);
  process.exit(1);
}

console.log('═'.repeat(80));
console.log(`🔬 BB-SQUEEZE MEAN REVERSION BACKTEST - ${asset}`);
console.log('═'.repeat(80));
console.log(`Loading candles from: ${dataFile}`);

const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampFormat: 'unix_ms',
});
console.log(`Loaded ${candles.length} candles\n`);

// Test multiple configurations
const configs = [
  { name: 'Default', takeProfitPct: 0.005, stopLossPct: 0.003 },
  { name: 'Tight TP/SL', takeProfitPct: 0.004, stopLossPct: 0.003 },
  { name: 'Wide TP/SL', takeProfitPct: 0.006, stopLossPct: 0.004 },
  { name: 'Very Tight', takeProfitPct: 0.003, stopLossPct: 0.002 },
  { name: 'Asymmetric 1.5:1', takeProfitPct: 0.0045, stopLossPct: 0.003 },
  { name: 'Asymmetric 2:1', takeProfitPct: 0.006, stopLossPct: 0.003 },
];

const multipliers = [100, 150, 200];

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');
const getDirection = (t: any) => t.entry?.direction ?? t.direction ?? 'UNKNOWN';

interface Result {
  config: string;
  multiplier: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  maxDD: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
}

const results: Result[] = [];

console.log('Testing configurations...\n');

for (const config of configs) {
  for (const mult of multipliers) {
    const strategy = new BBSqueezeMRBacktestStrategy(asset, {
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
    });

    const result = runBacktest(strategy, candles, {
      initialBalance: 1000,
      multiplier: mult,
      stakeAmount: 20, // 2% of 1000
    });

    const wins = result.trades.filter(t => getOutcome(t) === 'WIN');
    const losses = result.trades.filter(t => getOutcome(t) === 'LOSS');
    const totalPnl = result.trades.reduce((sum, t) => sum + getPnl(t), 0);

    const totalWinAmount = wins.reduce((sum, t) => sum + getPnl(t), 0);
    const totalLossAmount = Math.abs(losses.reduce((sum, t) => sum + getPnl(t), 0));

    const avgWin = wins.length > 0 ? totalWinAmount / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLossAmount / losses.length : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
    const expectancy = result.trades.length > 0 ? totalPnl / result.trades.length : 0;

    results.push({
      config: config.name,
      multiplier: mult,
      trades: result.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / result.trades.length) * 100,
      pnl: totalPnl,
      maxDD: result.metrics.maxDrawdownPct,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
    });
  }
}

// Sort by P&L
results.sort((a, b) => b.pnl - a.pnl);

console.log('\n📊 RESULTADOS POR CONFIGURACIÓN');
console.log('═'.repeat(120));
console.log('Config             | Mult | Trades | Wins | Loss | WR%   | P&L      | DD%   | Avg Win | Avg Loss | PF   | Exp');
console.log('─'.repeat(120));

for (const r of results) {
  const pnlStr = r.pnl >= 0 ? `+$${r.pnl.toFixed(0)}` : `-$${Math.abs(r.pnl).toFixed(0)}`;
  console.log(
    `${r.config.padEnd(18)}| x${r.multiplier.toString().padEnd(3)} | ${r.trades.toString().padStart(6)} | ${r.wins.toString().padStart(4)} | ${r.losses.toString().padStart(4)} | ${r.winRate.toFixed(1).padStart(5)} | ${pnlStr.padStart(8)} | ${r.maxDD.toFixed(1).padStart(5)} | $${r.avgWin.toFixed(2).padStart(6)} | $${r.avgLoss.toFixed(2).padStart(7)} | ${r.profitFactor.toFixed(2).padStart(4)} | $${r.expectancy.toFixed(2)}`
  );
}

console.log('═'.repeat(120));

// Analyze best config in detail
const best = results[0]!;
console.log(`\n🏆 MEJOR CONFIGURACIÓN: ${best.config} x${best.multiplier}`);
console.log(`   P&L: ${best.pnl >= 0 ? '+' : ''}$${best.pnl.toFixed(0)}`);
console.log(`   Win Rate: ${best.winRate.toFixed(1)}%`);
console.log(`   Max DD: ${best.maxDD.toFixed(1)}%`);
console.log(`   Profit Factor: ${best.profitFactor.toFixed(2)}`);
console.log(`   Expectancy: $${best.expectancy.toFixed(2)}/trade`);

// Run detailed analysis on best config
const bestConfig = configs.find(c => c.name === best.config)!;
const bestStrategy = new BBSqueezeMRBacktestStrategy(asset, {
  takeProfitPct: bestConfig.takeProfitPct,
  stopLossPct: bestConfig.stopLossPct,
});

const bestResult = runBacktest(bestStrategy, candles, {
  initialBalance: 1000,
  multiplier: best.multiplier,
  stakeAmount: 20,
});

// Direction analysis
const calls = bestResult.trades.filter(t => getDirection(t) === 'CALL');
const puts = bestResult.trades.filter(t => getDirection(t) === 'PUT');
const callWins = calls.filter(t => getOutcome(t) === 'WIN').length;
const putWins = puts.filter(t => getOutcome(t) === 'WIN').length;

console.log(`\n📈 ANÁLISIS POR DIRECCIÓN:`);
console.log(`   CALL: ${calls.length} trades, ${callWins} wins (${calls.length > 0 ? ((callWins/calls.length)*100).toFixed(1) : 0}%)`);
console.log(`   PUT:  ${puts.length} trades, ${putWins} wins (${puts.length > 0 ? ((putWins/puts.length)*100).toFixed(1) : 0}%)`);

// Losing streak analysis
let maxStreak = 0;
let currentStreak = 0;
const streaks: number[] = [];

for (const t of bestResult.trades) {
  if (getOutcome(t) === 'LOSS') {
    currentStreak++;
    if (currentStreak > maxStreak) maxStreak = currentStreak;
  } else {
    if (currentStreak > 0) streaks.push(currentStreak);
    currentStreak = 0;
  }
}
if (currentStreak > 0) streaks.push(currentStreak);

console.log(`\n⚠️  ANÁLISIS DE RACHAS:`);
console.log(`   Racha perdedora máxima: ${maxStreak} trades`);
console.log(`   Rachas de 3+: ${streaks.filter(s => s >= 3).length}`);
console.log(`   Rachas de 5+: ${streaks.filter(s => s >= 5).length}`);

// Print full result and export chart
console.log('\n');
printBacktestResult(bestResult);

const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '');
const chartFile = `analysis-output/chart_BB-Squeeze-MR_${asset}_${timestamp}.html`;
exportChart(bestResult, chartFile);
console.log(`\n📊 Chart exported to: ${chartFile}`);
