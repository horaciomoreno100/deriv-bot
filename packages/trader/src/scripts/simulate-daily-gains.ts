/**
 * Simulate daily gains with optimal config
 *
 * Capital: $1000
 * Config: TP 0.4% / SL 0.3% / Multiplier x200 / Stake 2%
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
const STAKE_PCT = 0.02; // 2%
const MULTIPLIER = parseInt(process.env.MULT || '200');

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

// Calculate actual days from candles (1440 minutes per day for 1m candles)
const actualDays = Math.ceil(candles.length / 1440);

console.log('═'.repeat(70));
console.log(`💰 SIMULACIÓN DE GANANCIAS DIARIAS - ${asset}`);
console.log('═'.repeat(70));
console.log(`\n📊 CONFIGURACIÓN:`);
console.log(`   Capital Inicial: $${INITIAL_CAPITAL}`);
console.log(`   Stake: ${(STAKE_PCT * 100).toFixed(0)}% = $${(INITIAL_CAPITAL * STAKE_PCT).toFixed(0)}/trade`);
console.log(`   Multiplicador: x${MULTIPLIER}`);
console.log(`   TP/SL: 0.4% / 0.3%`);
console.log(`   Período: ${actualDays} días`);

const strategy = new HybridMTFBacktestStrategy(asset, {
  takeProfitPct: 0.004,
  stopLossPct: 0.003,
});

const stakeAmount = INITIAL_CAPITAL * STAKE_PCT;

const result = runBacktest(strategy, candles, {
  initialBalance: INITIAL_CAPITAL,
  multiplier: MULTIPLIER,
  stakeAmount: stakeAmount,
});

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');

const wins = result.trades.filter(t => getOutcome(t) === 'WIN');
const losses = result.trades.filter(t => getOutcome(t) === 'LOSS');
const totalPnl = result.trades.reduce((sum, t) => sum + getPnl(t), 0);
const finalEquity = INITIAL_CAPITAL + totalPnl;

// Daily averages
const dailyPnl = totalPnl / actualDays;
const dailyTrades = result.trades.length / actualDays;
const dailyWins = wins.length / actualDays;
const dailyLosses = losses.length / actualDays;

// Win/Loss amounts
const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + getPnl(t), 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + getPnl(t), 0)) / losses.length : 0;

console.log(`\n📈 RESULTADOS (${actualDays} días):`);
console.log('─'.repeat(50));
console.log(`   Trades Totales: ${result.trades.length}`);
console.log(`   Wins/Losses: ${wins.length} / ${losses.length}`);
console.log(`   Win Rate: ${((wins.length / result.trades.length) * 100).toFixed(1)}%`);
console.log(`   P&L Total: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`);
console.log(`   Capital Final: $${finalEquity.toFixed(0)}`);
console.log(`   ROI: ${((totalPnl / INITIAL_CAPITAL) * 100).toFixed(1)}%`);
console.log(`   Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%`);

console.log(`\n💵 PROMEDIO DIARIO:`);
console.log('─'.repeat(50));
console.log(`   P&L/día: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`);
console.log(`   Trades/día: ${dailyTrades.toFixed(1)}`);
console.log(`   Wins/día: ${dailyWins.toFixed(1)}`);
console.log(`   Losses/día: ${dailyLosses.toFixed(1)}`);

console.log(`\n💰 GANANCIA POR TRADE:`);
console.log('─'.repeat(50));
console.log(`   Ganancia promedio (WIN): +$${avgWin.toFixed(2)}`);
console.log(`   Pérdida promedio (LOSS): -$${avgLoss.toFixed(2)}`);
console.log(`   Expectativa por trade: ${(totalPnl / result.trades.length).toFixed(2)}`);

// Projections
console.log(`\n📅 PROYECCIONES:`);
console.log('─'.repeat(50));
const weekly = dailyPnl * 7;
const monthly = dailyPnl * 30;
const quarterly = dailyPnl * 90;
console.log(`   Semanal (7d): ${weekly >= 0 ? '+' : ''}$${weekly.toFixed(0)}`);
console.log(`   Mensual (30d): ${monthly >= 0 ? '+' : ''}$${monthly.toFixed(0)}`);
console.log(`   Trimestral (90d): ${quarterly >= 0 ? '+' : ''}$${quarterly.toFixed(0)}`);

// Compound growth (reinvesting profits)
console.log(`\n🚀 CRECIMIENTO COMPUESTO (reinvirtiendo ganancias):`);
console.log('─'.repeat(50));
const dailyRate = dailyPnl / INITIAL_CAPITAL;
let compoundCapital = INITIAL_CAPITAL;
for (let month = 1; month <= 3; month++) {
  for (let day = 0; day < 30; day++) {
    compoundCapital *= (1 + dailyRate);
  }
  console.log(`   Mes ${month}: $${compoundCapital.toFixed(0)} (${((compoundCapital / INITIAL_CAPITAL - 1) * 100).toFixed(0)}% ROI)`);
}

// Risk analysis
console.log(`\n⚠️  ANÁLISIS DE RIESGO:`);
console.log('─'.repeat(50));
const maxLossStreak = result.metrics.maxConsecutiveLosses;
const maxLossStreakAmount = maxLossStreak * avgLoss;
const riskPerTrade = (stakeAmount * MULTIPLIER * 0.003); // SL 0.3%
console.log(`   Riesgo por trade: $${riskPerTrade.toFixed(2)} (${((riskPerTrade / INITIAL_CAPITAL) * 100).toFixed(1)}% del capital)`);
console.log(`   Racha perdedora máxima: ${maxLossStreak} trades`);
console.log(`   Pérdida máxima en racha: ~$${maxLossStreakAmount.toFixed(0)}`);
console.log(`   Max Drawdown histórico: ${result.metrics.maxDrawdownPct.toFixed(1)}%`);

// Recommendations
console.log(`\n💡 RECOMENDACIONES:`);
console.log('─'.repeat(50));
if (result.metrics.maxDrawdownPct > 15) {
  console.log(`   ⚠️  DD > 15% - Considera reducir multiplicador a x100`);
}
if (dailyPnl < 0) {
  console.log(`   ❌ Estrategia no rentable - Revisar parámetros`);
} else if (dailyPnl > 0 && dailyPnl < 5) {
  console.log(`   ⚠️  Ganancia diaria baja - Considera aumentar stake o multiplicador`);
} else {
  console.log(`   ✅ Configuración rentable`);
}
if (maxLossStreak > 5) {
  console.log(`   ⚠️  Rachas perdedoras largas - Asegura capital suficiente`);
}

console.log('\n' + '═'.repeat(70));
