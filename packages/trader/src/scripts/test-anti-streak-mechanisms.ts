/**
 * Test different anti-streak mechanisms
 *
 * Mechanisms to test:
 * 1. Dynamic cooldown (pause after losses)
 * 2. Daily loss limit
 * 3. Volatility filter (skip during high ATR)
 * 4. Direction lock (avoid same direction after losses)
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
const INITIAL_CAPITAL = 1000;
const MULTIPLIER = 200;
const STAKE_PCT = 0.02;

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
console.log(`🛡️ TEST DE MECANISMOS ANTI-RACHA - ${asset}`);
console.log('═'.repeat(80));

const strategy = new HybridMTFBacktestStrategy(asset, {
  takeProfitPct: 0.004,
  stopLossPct: 0.003,
});

const result = runBacktest(strategy, candles, {
  initialBalance: INITIAL_CAPITAL,
  multiplier: MULTIPLIER,
  stakeAmount: INITIAL_CAPITAL * STAKE_PCT,
});

const getPnl = (t: any) => t.result?.pnl ?? t.pnl ?? 0;
const getOutcome = (t: any) => t.result?.outcome ?? (getPnl(t) > 0 ? 'WIN' : 'LOSS');
const getDirection = (t: any) => t.entry?.direction ?? t.direction ?? 'UNKNOWN';
const getTimestamp = (t: any) => t.entry?.timestamp ?? t.timestamp ?? 0;

// Helper to calculate metrics from filtered trades
function calculateMetrics(trades: any[], initialCapital: number) {
  if (trades.length === 0) {
    return { pnl: 0, winRate: 0, maxDD: 0, trades: 0, maxStreak: 0 };
  }

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  let wins = 0;
  let consecutiveLosses = 0;
  let maxStreak = 0;

  for (const t of trades) {
    const pnl = getPnl(t);
    equity += pnl;

    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;

    if (getOutcome(t) === 'WIN') {
      wins++;
      consecutiveLosses = 0;
    } else {
      consecutiveLosses++;
      if (consecutiveLosses > maxStreak) maxStreak = consecutiveLosses;
    }
  }

  return {
    pnl: equity - initialCapital,
    winRate: (wins / trades.length) * 100,
    maxDD: maxDD * 100,
    trades: trades.length,
    maxStreak,
  };
}

// Baseline (no protection)
const baseline = calculateMetrics(result.trades, INITIAL_CAPITAL);
console.log(`\n📊 BASELINE (sin protección):`);
console.log(`   Trades: ${baseline.trades}`);
console.log(`   P&L: ${baseline.pnl >= 0 ? '+' : ''}$${baseline.pnl.toFixed(0)}`);
console.log(`   Win Rate: ${baseline.winRate.toFixed(1)}%`);
console.log(`   Max DD: ${baseline.maxDD.toFixed(1)}%`);
console.log(`   Max Racha: ${baseline.maxStreak} trades`);

// ============================================================
// MECHANISM 1: Dynamic Cooldown
// Skip trades for X bars after consecutive losses
// ============================================================
console.log(`\n─────────────────────────────────────────────────────────`);
console.log(`1️⃣  COOLDOWN DINÁMICO`);
console.log(`─────────────────────────────────────────────────────────`);

function simulateDynamicCooldown(trades: any[], cooldownBarsAfterLoss: Record<number, number>) {
  const filtered: any[] = [];
  let consecutiveLosses = 0;
  let cooldownUntilIndex = -1;

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tradeIndex = t.entry?.snapshot?.candle?.index ?? i;

    // Check if we're in cooldown
    if (tradeIndex < cooldownUntilIndex) {
      continue; // Skip this trade
    }

    filtered.push(t);

    if (getOutcome(t) === 'LOSS') {
      consecutiveLosses++;
      // Apply cooldown based on consecutive losses
      const cooldownBars = cooldownBarsAfterLoss[consecutiveLosses] || cooldownBarsAfterLoss[Math.max(...Object.keys(cooldownBarsAfterLoss).map(Number))] || 0;
      if (cooldownBars > 0) {
        cooldownUntilIndex = tradeIndex + cooldownBars;
      }
    } else {
      consecutiveLosses = 0;
      cooldownUntilIndex = -1;
    }
  }

  return filtered;
}

const cooldownConfigs = [
  { name: '2L→5bars, 3L→15bars, 4+→30bars', bars: { 2: 5, 3: 15, 4: 30 } },
  { name: '2L→10bars, 3L→30bars, 4+→60bars', bars: { 2: 10, 3: 30, 4: 60 } },
  { name: '3L→15bars, 4L→30bars, 5+→60bars', bars: { 3: 15, 4: 30, 5: 60 } },
  { name: '2L→3bars, 3L→10bars', bars: { 2: 3, 3: 10 } },
];

for (const config of cooldownConfigs) {
  const filtered = simulateDynamicCooldown(result.trades, config.bars);
  const metrics = calculateMetrics(filtered, INITIAL_CAPITAL);
  const pnlDiff = metrics.pnl - baseline.pnl;
  const ddDiff = metrics.maxDD - baseline.maxDD;

  console.log(`\n   ${config.name}:`);
  console.log(`      Trades: ${metrics.trades} (${metrics.trades - baseline.trades})`);
  console.log(`      P&L: ${metrics.pnl >= 0 ? '+' : ''}$${metrics.pnl.toFixed(0)} (${pnlDiff >= 0 ? '+' : ''}$${pnlDiff.toFixed(0)})`);
  console.log(`      Max DD: ${metrics.maxDD.toFixed(1)}% (${ddDiff >= 0 ? '+' : ''}${ddDiff.toFixed(1)}%)`);
  console.log(`      Max Racha: ${metrics.maxStreak} trades`);
}

// ============================================================
// MECHANISM 2: Daily Loss Limit
// Stop trading for the day after X% loss
// ============================================================
console.log(`\n─────────────────────────────────────────────────────────`);
console.log(`2️⃣  LÍMITE DE PÉRDIDA DIARIA`);
console.log(`─────────────────────────────────────────────────────────`);

function simulateDailyLossLimit(trades: any[], maxDailyLossPct: number) {
  const filtered: any[] = [];
  const maxDailyLoss = INITIAL_CAPITAL * maxDailyLossPct;

  let dailyPnl = 0;
  let currentDay = -1;

  for (const t of trades) {
    // Get day from candle index (1440 candles per day for 1m)
    const candleIndex = t.entry?.snapshot?.candle?.index ?? 0;
    const day = Math.floor(candleIndex / 1440);

    // Reset daily P&L on new day
    if (day !== currentDay) {
      currentDay = day;
      dailyPnl = 0;
    }

    // Check if daily loss limit reached
    if (dailyPnl <= -maxDailyLoss) {
      continue; // Skip this trade
    }

    filtered.push(t);
    dailyPnl += getPnl(t);
  }

  return filtered;
}

const dailyLossLimits = [0.03, 0.05, 0.07, 0.10]; // 3%, 5%, 7%, 10%

for (const limit of dailyLossLimits) {
  const filtered = simulateDailyLossLimit(result.trades, limit);
  const metrics = calculateMetrics(filtered, INITIAL_CAPITAL);
  const pnlDiff = metrics.pnl - baseline.pnl;
  const ddDiff = metrics.maxDD - baseline.maxDD;

  console.log(`\n   Max ${(limit * 100).toFixed(0)}% daily loss ($${(INITIAL_CAPITAL * limit).toFixed(0)}):`);
  console.log(`      Trades: ${metrics.trades} (${metrics.trades - baseline.trades})`);
  console.log(`      P&L: ${metrics.pnl >= 0 ? '+' : ''}$${metrics.pnl.toFixed(0)} (${pnlDiff >= 0 ? '+' : ''}$${pnlDiff.toFixed(0)})`);
  console.log(`      Max DD: ${metrics.maxDD.toFixed(1)}% (${ddDiff >= 0 ? '+' : ''}${ddDiff.toFixed(1)}%)`);
  console.log(`      Max Racha: ${metrics.maxStreak} trades`);
}

// ============================================================
// MECHANISM 3: Direction Lock
// Skip same direction after N consecutive losses in that direction
// ============================================================
console.log(`\n─────────────────────────────────────────────────────────`);
console.log(`3️⃣  BLOQUEO DE DIRECCIÓN`);
console.log(`─────────────────────────────────────────────────────────`);

function simulateDirectionLock(trades: any[], lockAfterN: number, lockForBars: number) {
  const filtered: any[] = [];
  let consecutiveCallLosses = 0;
  let consecutivePutLosses = 0;
  let callLockedUntil = -1;
  let putLockedUntil = -1;

  for (const t of trades) {
    const direction = getDirection(t);
    const candleIndex = t.entry?.snapshot?.candle?.index ?? 0;

    // Check if direction is locked
    if (direction === 'CALL' && candleIndex < callLockedUntil) continue;
    if (direction === 'PUT' && candleIndex < putLockedUntil) continue;

    filtered.push(t);

    if (getOutcome(t) === 'LOSS') {
      if (direction === 'CALL') {
        consecutiveCallLosses++;
        consecutivePutLosses = 0;
        if (consecutiveCallLosses >= lockAfterN) {
          callLockedUntil = candleIndex + lockForBars;
        }
      } else {
        consecutivePutLosses++;
        consecutiveCallLosses = 0;
        if (consecutivePutLosses >= lockAfterN) {
          putLockedUntil = candleIndex + lockForBars;
        }
      }
    } else {
      if (direction === 'CALL') {
        consecutiveCallLosses = 0;
      } else {
        consecutivePutLosses = 0;
      }
    }
  }

  return filtered;
}

const directionLockConfigs = [
  { lockAfter: 2, lockBars: 15 },
  { lockAfter: 3, lockBars: 20 },
  { lockAfter: 3, lockBars: 30 },
  { lockAfter: 2, lockBars: 30 },
];

for (const config of directionLockConfigs) {
  const filtered = simulateDirectionLock(result.trades, config.lockAfter, config.lockBars);
  const metrics = calculateMetrics(filtered, INITIAL_CAPITAL);
  const pnlDiff = metrics.pnl - baseline.pnl;
  const ddDiff = metrics.maxDD - baseline.maxDD;

  console.log(`\n   Lock after ${config.lockAfter}L same dir for ${config.lockBars} bars:`);
  console.log(`      Trades: ${metrics.trades} (${metrics.trades - baseline.trades})`);
  console.log(`      P&L: ${metrics.pnl >= 0 ? '+' : ''}$${metrics.pnl.toFixed(0)} (${pnlDiff >= 0 ? '+' : ''}$${pnlDiff.toFixed(0)})`);
  console.log(`      Max DD: ${metrics.maxDD.toFixed(1)}% (${ddDiff >= 0 ? '+' : ''}${ddDiff.toFixed(1)}%)`);
  console.log(`      Max Racha: ${metrics.maxStreak} trades`);
}

// ============================================================
// MECHANISM 4: Combined (Best of each)
// ============================================================
console.log(`\n─────────────────────────────────────────────────────────`);
console.log(`4️⃣  COMBINACIÓN DE MECANISMOS`);
console.log(`─────────────────────────────────────────────────────────`);

function simulateCombined(
  trades: any[],
  cooldownBars: Record<number, number>,
  maxDailyLossPct: number,
  dirLockAfter: number,
  dirLockBars: number
) {
  const filtered: any[] = [];
  const maxDailyLoss = INITIAL_CAPITAL * maxDailyLossPct;

  let consecutiveLosses = 0;
  let cooldownUntilIndex = -1;
  let dailyPnl = 0;
  let currentDay = -1;
  let consecutiveCallLosses = 0;
  let consecutivePutLosses = 0;
  let callLockedUntil = -1;
  let putLockedUntil = -1;

  for (const t of trades) {
    const candleIndex = t.entry?.snapshot?.candle?.index ?? 0;
    const direction = getDirection(t);
    const day = Math.floor(candleIndex / 1440);

    // Reset daily P&L on new day
    if (day !== currentDay) {
      currentDay = day;
      dailyPnl = 0;
    }

    // Check all conditions
    if (candleIndex < cooldownUntilIndex) continue; // Cooldown active
    if (dailyPnl <= -maxDailyLoss) continue; // Daily limit reached
    if (direction === 'CALL' && candleIndex < callLockedUntil) continue; // CALL locked
    if (direction === 'PUT' && candleIndex < putLockedUntil) continue; // PUT locked

    filtered.push(t);
    dailyPnl += getPnl(t);

    if (getOutcome(t) === 'LOSS') {
      consecutiveLosses++;

      // Apply cooldown
      const cooldown = cooldownBars[consecutiveLosses] || cooldownBars[Math.max(...Object.keys(cooldownBars).map(Number))] || 0;
      if (cooldown > 0) {
        cooldownUntilIndex = candleIndex + cooldown;
      }

      // Direction lock
      if (direction === 'CALL') {
        consecutiveCallLosses++;
        consecutivePutLosses = 0;
        if (consecutiveCallLosses >= dirLockAfter) {
          callLockedUntil = candleIndex + dirLockBars;
        }
      } else {
        consecutivePutLosses++;
        consecutiveCallLosses = 0;
        if (consecutivePutLosses >= dirLockAfter) {
          putLockedUntil = candleIndex + dirLockBars;
        }
      }
    } else {
      consecutiveLosses = 0;
      cooldownUntilIndex = -1;
      if (direction === 'CALL') {
        consecutiveCallLosses = 0;
      } else {
        consecutivePutLosses = 0;
      }
    }
  }

  return filtered;
}

const combinedConfigs = [
  {
    name: 'Cooldown + Daily 5%',
    cooldown: { 2: 5, 3: 15, 4: 30 },
    dailyLoss: 0.05,
    dirLock: 0,
    dirLockBars: 0,
  },
  {
    name: 'Cooldown + Dir Lock',
    cooldown: { 2: 5, 3: 15, 4: 30 },
    dailyLoss: 1, // No limit
    dirLock: 3,
    dirLockBars: 20,
  },
  {
    name: 'All Three (Light)',
    cooldown: { 2: 3, 3: 10 },
    dailyLoss: 0.07,
    dirLock: 3,
    dirLockBars: 15,
  },
  {
    name: 'All Three (Aggressive)',
    cooldown: { 2: 5, 3: 15, 4: 30 },
    dailyLoss: 0.05,
    dirLock: 2,
    dirLockBars: 20,
  },
];

for (const config of combinedConfigs) {
  const filtered = simulateCombined(
    result.trades,
    config.cooldown,
    config.dailyLoss,
    config.dirLock,
    config.dirLockBars
  );
  const metrics = calculateMetrics(filtered, INITIAL_CAPITAL);
  const pnlDiff = metrics.pnl - baseline.pnl;
  const ddDiff = metrics.maxDD - baseline.maxDD;

  console.log(`\n   ${config.name}:`);
  console.log(`      Trades: ${metrics.trades} (${metrics.trades - baseline.trades})`);
  console.log(`      P&L: ${metrics.pnl >= 0 ? '+' : ''}$${metrics.pnl.toFixed(0)} (${pnlDiff >= 0 ? '+' : ''}$${pnlDiff.toFixed(0)})`);
  console.log(`      Win Rate: ${metrics.winRate.toFixed(1)}%`);
  console.log(`      Max DD: ${metrics.maxDD.toFixed(1)}% (${ddDiff >= 0 ? '+' : ''}${ddDiff.toFixed(1)}%)`);
  console.log(`      Max Racha: ${metrics.maxStreak} trades`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n═`.repeat(80));
console.log(`\n📋 RESUMEN:`);
console.log(`─`.repeat(60));
console.log(`
   El objetivo es REDUCIR el Max DD y las rachas sin perder
   demasiado P&L.

   💡 MEJOR ESTRATEGIA ANTI-RACHA:

   1. COOLDOWN DINÁMICO (principal):
      - 2 losses → pausa 5 bars (5 min)
      - 3 losses → pausa 15 bars (15 min)
      - 4+ losses → pausa 30 bars (30 min)

   2. LÍMITE DIARIO 5-7%:
      - Máx $50-70 de pérdida diaria con $1000
      - Protege contra días catastróficos

   3. BLOQUEO DE DIRECCIÓN (opcional):
      - Si pierdes 3 veces seguidas en CALL, skip próximos CALL
      - Ayuda cuando el mercado va en contra de una dirección
`);

console.log('\n' + '═'.repeat(80));
