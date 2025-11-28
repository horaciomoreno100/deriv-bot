#!/usr/bin/env tsx
/**
 * Probar diferentes configuraciones de TP/SL para optimizar esperanza matemática
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '7', 10);

interface TestResult {
  name: string;
  tp: number;
  sl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  netPnL: number;
  profitFactor: number;
  expectedValue: number;
}

async function runTest(name: string, tp: number, sl: number): Promise<TestResult> {
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_ANALYZE * oneDaySeconds);
  const candles = allCandles.filter(c => c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime);

  const strategy = createMTFLevelsStrategy(ASSET, {
    requireTrendAlignment: false,
    allowedDirection: 'both',
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationBarsPUT: 1,
    confirmationMinMove: 0.2,
    confirmationMinMoveAgainstTrend: 0.25,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    requireStrongLevelAgainstTrend: true,
    requireBBBand: true,
    bbBandTolerance: 0.15,
    minBounceStrength: 0.5,
    avoidRSIMidRange: true,
    takeProfitPct: tp,
    stopLossPct: sl,
  });

  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  
  const avgWin = wins.length > 0 
    ? wins.reduce((sum, t) => sum + (t.result?.pnl || 0), 0) / wins.length 
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, t) => sum + (t.result?.pnl || 0), 0) / losses.length)
    : 0;
  
  const winRateDecimal = wins.length / trades.length;
  const expectedValue = (winRateDecimal * avgWin) - ((1 - winRateDecimal) * avgLoss);

  return {
    name,
    tp,
    sl,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    netPnL: result.metrics?.netPnL ?? 0,
    profitFactor: result.metrics?.profitFactor ?? 0,
    expectedValue,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PROBANDO OPTIMIZACIÓN TP/SL');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Días: ${DAYS_TO_ANALYZE}\n`);

  const tests = [
    { name: 'ACTUAL', tp: 0.004, sl: 0.003 },
    { name: 'TP 0.25% / SL 0.25%', tp: 0.0025, sl: 0.0025 },
    { name: 'TP 0.23% / SL 0.25%', tp: 0.0023, sl: 0.0025 },
    { name: 'TP 0.25% / SL 0.23%', tp: 0.0025, sl: 0.0023 },
    { name: 'TP 0.30% / SL 0.25%', tp: 0.003, sl: 0.0025 },
    { name: 'TP 0.20% / SL 0.20%', tp: 0.002, sl: 0.002 },
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    console.log(`📊 Probando: ${test.name} (TP: ${(test.tp * 100).toFixed(2)}%, SL: ${(test.sl * 100).toFixed(2)}%)...`);
    results.push(await runTest(test.name, test.tp, test.sl));
  }

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('RESULTADOS');
  console.log('='.repeat(80));
  console.log('');

  const formatNumber = (n: number, decimals: number = 2) => {
    return n >= 0 ? `+${n.toFixed(decimals)}` : n.toFixed(decimals);
  };

  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Configuración          │ Trades │ WR%   │ Avg Win │ Avg Loss │ PnL      │ PF   │ Esperanza │');
  console.log('├────────────────────────────────────────────────────────────────────────────────────────────────────┤');
  
  for (const result of results) {
    const name = result.name.padEnd(22);
    const trades = result.trades.toString().padStart(6);
    const wr = result.winRate.toFixed(1).padStart(5);
    const avgWin = `$${result.avgWin.toFixed(0)}`.padStart(8);
    const avgLoss = `$${result.avgLoss.toFixed(0)}`.padStart(9);
    const pnl = formatNumber(result.netPnL, 0).padStart(9);
    const pf = result.profitFactor.toFixed(2).padStart(5);
    const ev = formatNumber(result.expectedValue, 0).padStart(9);
    
    console.log(`│ ${name} │ ${trades} │ ${wr}% │ ${avgWin} │ ${avgLoss} │ ${pnl} │ ${pf} │ ${ev} │`);
  }
  
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Compare with base
  const base = results[0]!;
  console.log('Comparación con ACTUAL:');
  console.log('');
  
  for (let i = 1; i < results.length; i++) {
    const result = results[i]!;
    const tradesDiff = result.trades - base.trades;
    const wrDiff = result.winRate - base.winRate;
    const pnlDiff = result.netPnL - base.netPnL;
    const evDiff = result.expectedValue - base.expectedValue;
    
    const tradesEmoji = tradesDiff > 0 ? '📈' : tradesDiff < 0 ? '📉' : '➡️';
    const wrEmoji = wrDiff > 0 ? '✅' : wrDiff < 0 ? '❌' : '➡️';
    const pnlEmoji = pnlDiff > 0 ? '✅' : pnlDiff < 0 ? '❌' : '➡️';
    const evEmoji = evDiff > 0 ? '✅' : evDiff < 0 ? '❌' : '➡️';
    
    console.log(`${result.name}:`);
    console.log(`  ${tradesEmoji} Trades: ${formatNumber(tradesDiff)} (${base.trades} → ${result.trades})`);
    console.log(`  ${wrEmoji} Win Rate: ${formatNumber(wrDiff, 1)}% (${base.winRate.toFixed(1)}% → ${result.winRate.toFixed(1)}%)`);
    console.log(`  ${pnlEmoji} Net PnL: ${formatNumber(pnlDiff, 0)} (${formatNumber(base.netPnL, 0)} → ${formatNumber(result.netPnL, 0)})`);
    console.log(`  ${evEmoji} Esperanza: ${formatNumber(evDiff, 0)} (${formatNumber(base.expectedValue, 0)} → ${formatNumber(result.expectedValue, 0)})`);
    console.log('');
  }

  // Find best
  const best = results.reduce((best, curr) => {
    return curr.expectedValue > best.expectedValue ? curr : best;
  }, results[0]!);

  console.log('='.repeat(80));
  console.log('🏆 MEJOR CONFIGURACIÓN:');
  console.log('='.repeat(80));
  console.log(`${best.name}`);
  console.log(`TP: ${(best.tp * 100).toFixed(2)}%, SL: ${(best.sl * 100).toFixed(2)}%`);
  console.log(`Esperanza Matemática: $${best.expectedValue.toFixed(2)} por trade`);
  console.log(`Win Rate: ${best.winRate.toFixed(1)}%`);
  console.log(`Net PnL: $${best.netPnL.toFixed(2)}`);
  console.log(`Profit Factor: ${best.profitFactor.toFixed(2)}`);
  console.log('='.repeat(80));
}

main().catch(console.error);

