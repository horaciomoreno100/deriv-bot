/**
 * Analyze daily profit potential with $1000 capital
 *
 * Goal: Maximize daily gains while controlling risk
 */

import {
  loadCandlesFromCSV,
  runBacktest,
} from '../backtest/index.js';
import { HybridMTFBacktestStrategy } from '../backtest/strategies/hybrid-mtf-backtest.strategy.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_100';
const days = process.env.DAYS || '7';
const INITIAL_CAPITAL = 1000;

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
  process.exit(1);
}

const candles = loadCandlesFromCSV(dataFile, {
  asset,
  timeframe: 60,
  timestampFormat: 'unix_ms',
});

console.log('='.repeat(80));
console.log(`💰 DAILY PROFIT ANALYSIS - ${asset} (${days} days)`);
console.log(`   Capital Inicial: $${INITIAL_CAPITAL}`);
console.log('='.repeat(80));
console.log(`Loaded ${candles.length} candles\n`);

// Group candles by day
const candlesByDay = new Map<string, typeof candles>();
for (const c of candles) {
  const date = new Date(c.timestamp).toISOString().slice(0, 10);
  if (!candlesByDay.has(date)) {
    candlesByDay.set(date, []);
  }
  candlesByDay.get(date)!.push(c);
}

const days_list = Array.from(candlesByDay.keys()).sort();
console.log(`📅 Days in dataset: ${days_list.length}`);
console.log(`   From: ${days_list[0]} to ${days_list[days_list.length - 1]}\n`);

// Test different configurations
const configs = [
  {
    name: 'Conservative (2% stake)',
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    stakePct: 0.02,
    multiplier: 100
  },
  {
    name: 'Moderate (3% stake)',
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    stakePct: 0.03,
    multiplier: 100
  },
  {
    name: 'Aggressive (5% stake)',
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    stakePct: 0.05,
    multiplier: 100
  },
  {
    name: 'Higher Mult x200 (2% stake)',
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    stakePct: 0.02,
    multiplier: 200
  },
  {
    name: 'Higher Mult x200 (3% stake)',
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    stakePct: 0.03,
    multiplier: 200
  },
  {
    name: 'Tight TP/SL 0.3%/0.2% (3% stake)',
    takeProfitPct: 0.003,
    stopLossPct: 0.002,
    stakePct: 0.03,
    multiplier: 100
  },
];

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');

interface ConfigResult {
  name: string;
  totalPnl: number;
  totalTrades: number;
  winRate: number;
  maxDD: number;
  dailyAvgPnl: number;
  dailyAvgTrades: number;
  profitDays: number;
  lossDays: number;
  finalEquity: number;
  roi: number;
}

const results: ConfigResult[] = [];

for (const config of configs) {
  const strategy = new HybridMTFBacktestStrategy(asset, {
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
  });

  const stakeAmount = INITIAL_CAPITAL * config.stakePct;

  const result = runBacktest(strategy, candles, {
    initialBalance: INITIAL_CAPITAL,
    multiplier: config.multiplier,
    stakeAmount: stakeAmount,
  });

  // Calculate daily stats
  const tradesByDay = new Map<string, any[]>();
  for (const t of result.trades) {
    const date = new Date(t.entry?.timestamp || 0).toISOString().slice(0, 10);
    if (!tradesByDay.has(date)) {
      tradesByDay.set(date, []);
    }
    tradesByDay.get(date)!.push(t);
  }

  let profitDays = 0;
  let lossDays = 0;
  const dailyPnls: number[] = [];

  for (const [_date, trades] of tradesByDay.entries()) {
    const dayPnl = trades.reduce((sum, t) => sum + getPnl(t), 0);
    dailyPnls.push(dayPnl);
    if (dayPnl > 0) profitDays++;
    else if (dayPnl < 0) lossDays++;
  }

  const wins = result.trades.filter(t => getOutcome(t) === 'WIN');
  const totalPnl = result.trades.reduce((sum, t) => sum + getPnl(t), 0);
  const finalEquity = INITIAL_CAPITAL + totalPnl;
  const roi = (totalPnl / INITIAL_CAPITAL) * 100;

  results.push({
    name: config.name,
    totalPnl,
    totalTrades: result.trades.length,
    winRate: (wins.length / result.trades.length) * 100,
    maxDD: result.metrics.maxDrawdownPct,
    dailyAvgPnl: dailyPnls.length > 0 ? dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length : 0,
    dailyAvgTrades: result.trades.length / days_list.length,
    profitDays,
    lossDays,
    finalEquity,
    roi,
  });
}

// Sort by total P&L
results.sort((a, b) => b.totalPnl - a.totalPnl);

console.log('\n📊 RESULTADOS POR CONFIGURACIÓN');
console.log('='.repeat(100));
console.log('Config                                  | P&L Total | ROI    | WR    | DD    | $/día | Trades/día | Días +/-');
console.log('-'.repeat(100));

for (const r of results) {
  const pnlStr = r.totalPnl >= 0 ? `+$${r.totalPnl.toFixed(0)}`.padStart(9) : `-$${Math.abs(r.totalPnl).toFixed(0)}`.padStart(9);
  const roiStr = `${r.roi >= 0 ? '+' : ''}${r.roi.toFixed(1)}%`.padStart(7);
  const wrStr = `${r.winRate.toFixed(1)}%`.padStart(6);
  const ddStr = `${r.maxDD.toFixed(1)}%`.padStart(6);
  const dailyPnlStr = r.dailyAvgPnl >= 0 ? `+$${r.dailyAvgPnl.toFixed(0)}`.padStart(6) : `-$${Math.abs(r.dailyAvgPnl).toFixed(0)}`.padStart(6);
  const dailyTradesStr = r.dailyAvgTrades.toFixed(1).padStart(6);
  const daysStr = `${r.profitDays}/${r.lossDays}`.padStart(6);

  console.log(`${r.name.padEnd(40)}| ${pnlStr} | ${roiStr} | ${wrStr} | ${ddStr} | ${dailyPnlStr} | ${dailyTradesStr}      | ${daysStr}`);
}

console.log('='.repeat(100));

// Best config
const best = results[0];
console.log(`\n🏆 MEJOR CONFIGURACIÓN: ${best.name}`);
console.log(`   Capital: $${INITIAL_CAPITAL} → $${best.finalEquity.toFixed(0)} (${best.roi >= 0 ? '+' : ''}${best.roi.toFixed(1)}% ROI)`);
console.log(`   P&L Total: ${best.totalPnl >= 0 ? '+' : ''}$${best.totalPnl.toFixed(0)} en ${days_list.length} días`);
console.log(`   Promedio Diario: ${best.dailyAvgPnl >= 0 ? '+' : ''}$${best.dailyAvgPnl.toFixed(2)}/día`);
console.log(`   Trades/día: ${best.dailyAvgTrades.toFixed(1)}`);
console.log(`   Win Rate: ${best.winRate.toFixed(1)}%`);
console.log(`   Max Drawdown: ${best.maxDD.toFixed(1)}%`);
console.log(`   Días Rentables: ${best.profitDays}/${days_list.length} (${((best.profitDays/days_list.length)*100).toFixed(0)}%)`);

// Proyección mensual
const monthlyProjection = best.dailyAvgPnl * 30;
const monthlyRoi = (monthlyProjection / INITIAL_CAPITAL) * 100;
console.log(`\n📈 PROYECCIÓN MENSUAL (30 días):`);
console.log(`   P&L Estimado: ${monthlyProjection >= 0 ? '+' : ''}$${monthlyProjection.toFixed(0)}`);
console.log(`   ROI Estimado: ${monthlyRoi >= 0 ? '+' : ''}${monthlyRoi.toFixed(1)}%`);
console.log(`   Capital Final: $${(INITIAL_CAPITAL + monthlyProjection).toFixed(0)}`);

// Warnings
console.log(`\n⚠️  ADVERTENCIAS:`);
if (best.maxDD > 20) {
  console.log(`   - Drawdown alto (${best.maxDD.toFixed(1)}%) - considera reducir stake`);
}
if (best.winRate < 45) {
  console.log(`   - Win rate bajo (${best.winRate.toFixed(1)}%) - alta dependencia de ratio TP/SL`);
}
if (best.profitDays < days_list.length * 0.5) {
  console.log(`   - Menos del 50% de días rentables - alta variabilidad`);
}

console.log('\n' + '='.repeat(80));
