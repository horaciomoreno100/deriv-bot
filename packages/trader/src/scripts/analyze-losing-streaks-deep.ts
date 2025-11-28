/**
 * Deep Analysis of Losing Streaks
 *
 * Goal: Understand WHY losing streaks happen and how to avoid them
 */

import {
  loadCandlesFromCSV,
  runBacktest,
} from '../backtest/index.js';
import { HybridMTFBacktestStrategy } from '../backtest/strategies/hybrid-mtf-backtest.strategy.js';
import { existsSync } from 'fs';
import { join } from 'path';

const asset = process.env.ASSET || 'R_100';
const days = process.env.DAYS || '90';

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

console.log('═'.repeat(80));
console.log(`🔍 ANÁLISIS PROFUNDO DE RACHAS PERDEDORAS - ${asset}`);
console.log('═'.repeat(80));

const strategy = new HybridMTFBacktestStrategy(asset, {
  takeProfitPct: 0.004,
  stopLossPct: 0.003,
});

const result = runBacktest(strategy, candles, {
  initialBalance: 1000,
  multiplier: 200,
  stakeAmount: 20,
});

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');
const getDirection = (t: any) => t.entry?.direction ?? t.direction ?? 'UNKNOWN';
const getReason = (t: any) => t.entry?.signal?.reason ?? t.reason ?? 'unknown';
const getExitReason = (t: any) => t.exit?.reason ?? t.exitReason ?? 'unknown';

// Find all losing streaks
interface LosingStreak {
  startIndex: number;
  length: number;
  trades: any[];
  totalLoss: number;
  directions: string[];
  reasons: string[];
  exitReasons: string[];
  recoveryTrades: number; // How many trades to recover
}

const streaks: LosingStreak[] = [];
let currentStreak: any[] = [];
let streakStartIdx = 0;

for (let i = 0; i < result.trades.length; i++) {
  const t = result.trades[i];
  if (getOutcome(t) === 'LOSS') {
    if (currentStreak.length === 0) {
      streakStartIdx = i;
    }
    currentStreak.push(t);
  } else {
    if (currentStreak.length >= 3) { // Only track streaks of 3+
      // Calculate recovery trades
      let recoveryPnl = 0;
      let recoveryTrades = 0;
      const streakLoss = currentStreak.reduce((sum, t) => sum + getPnl(t), 0);

      for (let j = i; j < result.trades.length && recoveryPnl < Math.abs(streakLoss); j++) {
        recoveryPnl += getPnl(result.trades[j]);
        recoveryTrades++;
      }

      streaks.push({
        startIndex: streakStartIdx,
        length: currentStreak.length,
        trades: [...currentStreak],
        totalLoss: streakLoss,
        directions: currentStreak.map(t => getDirection(t)),
        reasons: currentStreak.map(t => getReason(t)),
        exitReasons: currentStreak.map(t => getExitReason(t)),
        recoveryTrades,
      });
    }
    currentStreak = [];
  }
}

// Handle streak at the end
if (currentStreak.length >= 3) {
  streaks.push({
    startIndex: streakStartIdx,
    length: currentStreak.length,
    trades: [...currentStreak],
    totalLoss: currentStreak.reduce((sum, t) => sum + getPnl(t), 0),
    directions: currentStreak.map(t => getDirection(t)),
    reasons: currentStreak.map(t => getReason(t)),
    exitReasons: currentStreak.map(t => getExitReason(t)),
    recoveryTrades: -1, // Didn't recover
  });
}

console.log(`\n📊 RESUMEN GENERAL:`);
console.log('─'.repeat(60));
console.log(`   Total trades: ${result.trades.length}`);
console.log(`   Rachas perdedoras (3+): ${streaks.length}`);
console.log(`   Racha más larga: ${Math.max(...streaks.map(s => s.length))} trades`);

// Analyze streak distribution
const streakLengths = streaks.map(s => s.length);
const lengthCounts: Record<number, number> = {};
for (const len of streakLengths) {
  lengthCounts[len] = (lengthCounts[len] || 0) + 1;
}

console.log(`\n📈 DISTRIBUCIÓN DE RACHAS:`);
console.log('─'.repeat(60));
for (const [len, count] of Object.entries(lengthCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const bar = '█'.repeat(count);
  console.log(`   ${len} trades: ${bar} (${count})`);
}

// Analyze patterns in losing streaks
console.log(`\n🔍 PATRONES EN RACHAS PERDEDORAS:`);
console.log('─'.repeat(60));

// Direction analysis
const allDirectionsInStreaks = streaks.flatMap(s => s.directions);
const callsInStreaks = allDirectionsInStreaks.filter(d => d === 'CALL').length;
const putsInStreaks = allDirectionsInStreaks.filter(d => d === 'PUT').length;
console.log(`   Dirección durante rachas:`);
console.log(`      CALL: ${callsInStreaks} (${((callsInStreaks / allDirectionsInStreaks.length) * 100).toFixed(1)}%)`);
console.log(`      PUT: ${putsInStreaks} (${((putsInStreaks / allDirectionsInStreaks.length) * 100).toFixed(1)}%)`);

// Check if same direction repeats
let sameDirectionStreaks = 0;
for (const streak of streaks) {
  const uniqueDirections = new Set(streak.directions);
  if (uniqueDirections.size === 1) {
    sameDirectionStreaks++;
  }
}
console.log(`   Rachas con misma dirección: ${sameDirectionStreaks}/${streaks.length} (${((sameDirectionStreaks / streaks.length) * 100).toFixed(0)}%)`);

// Exit reason analysis
const allExitReasons = streaks.flatMap(s => s.exitReasons);
const exitReasonCounts: Record<string, number> = {};
for (const reason of allExitReasons) {
  exitReasonCounts[reason] = (exitReasonCounts[reason] || 0) + 1;
}
console.log(`\n   Razones de salida en rachas:`);
for (const [reason, count] of Object.entries(exitReasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`      ${reason}: ${count} (${((count / allExitReasons.length) * 100).toFixed(1)}%)`);
}

// Show worst streaks
console.log(`\n🚨 TOP 5 PEORES RACHAS:`);
console.log('─'.repeat(60));
const worstStreaks = [...streaks].sort((a, b) => a.totalLoss - b.totalLoss).slice(0, 5);

for (let i = 0; i < worstStreaks.length; i++) {
  const s = worstStreaks[i];
  console.log(`\n   #${i + 1}: ${s.length} trades, Pérdida: $${Math.abs(s.totalLoss).toFixed(0)}`);
  console.log(`      Trade #${s.startIndex + 1} - #${s.startIndex + s.length}`);
  console.log(`      Direcciones: ${s.directions.join(' → ')}`);
  console.log(`      Exit reasons: ${[...new Set(s.exitReasons)].join(', ')}`);
  console.log(`      Trades para recuperar: ${s.recoveryTrades > 0 ? s.recoveryTrades : 'No recuperado'}`);
}

// Analyze what happens BEFORE losing streaks
console.log(`\n🔮 ¿QUÉ PASA ANTES DE LAS RACHAS?`);
console.log('─'.repeat(60));

let winsBeforeStreak = 0;
let lossesBeforeStreak = 0;

for (const streak of streaks) {
  if (streak.startIndex > 0) {
    const prevTrade = result.trades[streak.startIndex - 1];
    if (getOutcome(prevTrade) === 'WIN') {
      winsBeforeStreak++;
    } else {
      lossesBeforeStreak++;
    }
  }
}

console.log(`   Trade anterior a racha:`);
console.log(`      WIN: ${winsBeforeStreak} (${((winsBeforeStreak / streaks.length) * 100).toFixed(0)}%)`);
console.log(`      LOSS: ${lossesBeforeStreak} (${((lossesBeforeStreak / streaks.length) * 100).toFixed(0)}%)`);

// Time-based analysis (if we have good timestamps)
console.log(`\n⏰ ANÁLISIS TEMPORAL:`);
console.log('─'.repeat(60));

// Calculate average time between trades in streaks vs normal
const getTimestamp = (t: any) => t.entry?.timestamp ?? t.timestamp ?? 0;

let totalTimeInStreaks = 0;
let totalTradesInStreaks = 0;

for (const streak of streaks) {
  for (let i = 1; i < streak.trades.length; i++) {
    const timeDiff = getTimestamp(streak.trades[i]) - getTimestamp(streak.trades[i - 1]);
    if (timeDiff > 0 && timeDiff < 24 * 60 * 60 * 1000) { // Valid time diff
      totalTimeInStreaks += timeDiff;
      totalTradesInStreaks++;
    }
  }
}

const avgTimeInStreaks = totalTradesInStreaks > 0 ? totalTimeInStreaks / totalTradesInStreaks / 60000 : 0;
console.log(`   Tiempo promedio entre trades en rachas: ${avgTimeInStreaks.toFixed(1)} minutos`);

// Recommendations
console.log(`\n💡 MECANISMOS ANTI-RACHA SUGERIDOS:`);
console.log('═'.repeat(60));

console.log(`
1. COOLDOWN DINÁMICO:
   - Después de 2 losses seguidos: +1 minuto de cooldown
   - Después de 3 losses seguidos: +3 minutos de cooldown
   - Después de 4+ losses: +5 minutos de cooldown

2. REDUCCIÓN DE STAKE PROGRESIVA:
   - 2 losses: stake × 0.75
   - 3 losses: stake × 0.5
   - 4+ losses: stake × 0.25
   - Reset después de 2 wins seguidos

3. CAMBIO DE DIRECCIÓN FORZADO:
   - ${((sameDirectionStreaks / streaks.length) * 100).toFixed(0)}% de rachas son en misma dirección
   - Después de 3 losses en misma dirección: skip next signal en esa dirección

4. FILTRO DE VOLATILIDAD:
   - Pausar trading si ATR > 2x promedio (mercado muy volátil)
   - Pausar si ATR < 0.5x promedio (mercado muerto)

5. LÍMITE DIARIO DE PÉRDIDAS:
   - Max loss diario: 5% del capital ($50 con $1000)
   - Al alcanzar, pausar trading por el resto del día
`);

// Calculate what stake reduction would have saved
console.log(`\n📊 SIMULACIÓN: Stake Reduction vs Normal`);
console.log('─'.repeat(60));

let normalPnl = 0;
let reducedPnl = 0;
let consecutiveLosses = 0;

for (const t of result.trades) {
  const pnl = getPnl(t);
  normalPnl += pnl;

  // Calculate reduced stake PnL
  let stakeMultiplier = 1;
  if (consecutiveLosses >= 4) stakeMultiplier = 0.25;
  else if (consecutiveLosses >= 3) stakeMultiplier = 0.5;
  else if (consecutiveLosses >= 2) stakeMultiplier = 0.75;

  reducedPnl += pnl * stakeMultiplier;

  if (getOutcome(t) === 'LOSS') {
    consecutiveLosses++;
  } else {
    consecutiveLosses = 0;
  }
}

console.log(`   P&L Normal: $${normalPnl.toFixed(0)}`);
console.log(`   P&L con Stake Reduction: $${reducedPnl.toFixed(0)}`);
console.log(`   Diferencia: ${reducedPnl > normalPnl ? '+' : ''}$${(reducedPnl - normalPnl).toFixed(0)}`);

// Calculate max drawdown with stake reduction
let equity = 1000;
let peakEquity = 1000;
let maxDD = 0;
consecutiveLosses = 0;

for (const t of result.trades) {
  const pnl = getPnl(t);

  let stakeMultiplier = 1;
  if (consecutiveLosses >= 4) stakeMultiplier = 0.25;
  else if (consecutiveLosses >= 3) stakeMultiplier = 0.5;
  else if (consecutiveLosses >= 2) stakeMultiplier = 0.75;

  equity += pnl * stakeMultiplier;
  if (equity > peakEquity) peakEquity = equity;
  const dd = (peakEquity - equity) / peakEquity;
  if (dd > maxDD) maxDD = dd;

  if (getOutcome(t) === 'LOSS') {
    consecutiveLosses++;
  } else {
    consecutiveLosses = 0;
  }
}

console.log(`   Max DD Normal: ${result.metrics.maxDrawdownPct.toFixed(1)}%`);
console.log(`   Max DD con Stake Reduction: ${(maxDD * 100).toFixed(1)}%`);

console.log('\n' + '═'.repeat(80));
