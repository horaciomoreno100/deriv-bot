#!/usr/bin/env npx tsx
/**
 * Analyze ZigZag Reversal by Direction (CALL vs PUT)
 */

import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createTrendExhaustionStrategy,
} from '../backtest/index.js';

const ASSET = process.env.ASSET ?? 'R_100';
const DATA_FILE = process.env.DATA_FILE ?? `data/${ASSET}_1m_7d.csv`;

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('         ZigZag Reversal - Análisis por Dirección');
  console.log('═══════════════════════════════════════════════════════════');
  console.log();

  const dataPath = path.join(process.cwd(), DATA_FILE);
  console.log(`📂 Loading: ${DATA_FILE}`);

  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
  console.log();

  const strategy = createTrendExhaustionStrategy(ASSET, 'zigzag_reversal');

  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: 1000,
    stakeMode: 'percentage',
    stakePct: 0.02,
    stakeAmount: 20,
    multiplier: 100,
  }, {
    runMonteCarlo: false,
    runOOS: false,
    verbose: false,
  });

  // Extract data from TradeWithContext
  interface SimpleTrade {
    direction: 'CALL' | 'PUT';
    result: 'WIN' | 'LOSS';
    pnl: number;
    entryPrice: number;
    exitPrice: number;
    entryTimestamp: number;
  }

  const trades: SimpleTrade[] = result.trades.map(t => ({
    direction: t.direction,
    result: t.result?.outcome === 'WIN' ? 'WIN' : 'LOSS',
    pnl: t.result?.pnl ?? 0,
    entryPrice: t.entry?.executedPrice ?? 0,
    exitPrice: t.exit?.executedPrice ?? 0,
    entryTimestamp: t.entry?.snapshot?.timestamp ?? 0,
  }));

  // Analyze by direction
  const callTrades = trades.filter(t => t.direction === 'CALL');
  const putTrades = trades.filter(t => t.direction === 'PUT');

  const callWins = callTrades.filter(t => t.result === 'WIN').length;
  const putWins = putTrades.filter(t => t.result === 'WIN').length;

  const callPnL = callTrades.reduce((sum, t) => sum + t.pnl, 0);
  const putPnL = putTrades.reduce((sum, t) => sum + t.pnl, 0);

  const callAvgPnL = callTrades.length > 0 ? callPnL / callTrades.length : 0;
  const putAvgPnL = putTrades.length > 0 ? putPnL / putTrades.length : 0;

  const callWR = callTrades.length > 0 ? (callWins / callTrades.length) * 100 : 0;
  const putWR = putTrades.length > 0 ? (putWins / putTrades.length) * 100 : 0;

  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│                    CALL (Alcista)                       │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  Trades:    ${String(callTrades.length).padStart(6)}                                   │`);
  console.log(`│  Wins:      ${String(callWins).padStart(6)}                                   │`);
  console.log(`│  Losses:    ${String(callTrades.length - callWins).padStart(6)}                                   │`);
  console.log(`│  Win Rate:  ${callWR.toFixed(1).padStart(5)}%                                  │`);
  console.log(`│  P&L:      $${callPnL.toFixed(2).padStart(8)}                                │`);
  console.log(`│  Avg P&L:  $${callAvgPnL.toFixed(2).padStart(8)}                                │`);
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log();
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│                     PUT (Bajista)                       │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  Trades:    ${String(putTrades.length).padStart(6)}                                   │`);
  console.log(`│  Wins:      ${String(putWins).padStart(6)}                                   │`);
  console.log(`│  Losses:    ${String(putTrades.length - putWins).padStart(6)}                                   │`);
  console.log(`│  Win Rate:  ${putWR.toFixed(1).padStart(5)}%                                  │`);
  console.log(`│  P&L:      $${putPnL.toFixed(2).padStart(8)}                                │`);
  console.log(`│  Avg P&L:  $${putAvgPnL.toFixed(2).padStart(8)}                                │`);
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log();

  // Comparison
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                      COMPARACIÓN');
  console.log('═══════════════════════════════════════════════════════════');

  const betterDirection = callPnL > putPnL ? 'CALL' : 'PUT';
  const wrDiff = Math.abs(callWR - putWR);

  console.log(`  Mejor dirección: ${betterDirection}`);
  console.log(`  Diferencia WR: ${wrDiff.toFixed(1)}%`);
  console.log(`  Diferencia P&L: $${Math.abs(callPnL - putPnL).toFixed(2)}`);
  console.log();

  // Show last 10 trades of each direction
  console.log('═══════════════════════════════════════════════════════════');
  console.log('              ÚLTIMAS 10 OPERACIONES CALL');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Timestamp            | Entry    | Exit     | Result | P&L');
  console.log('─────────────────────┼──────────┼──────────┼────────┼────────');

  callTrades.slice(-10).forEach(t => {
    const date = t.entryTimestamp > 0
      ? new Date(t.entryTimestamp).toISOString().replace('T', ' ').slice(0, 19)
      : 'N/A                ';
    const resultIcon = t.result === 'WIN' ? '✅ WIN ' : '❌ LOSS';
    console.log(`${date} | ${t.entryPrice.toFixed(2).padStart(8)} | ${t.exitPrice.toFixed(2).padStart(8)} | ${resultIcon} | $${t.pnl.toFixed(2).padStart(6)}`);
  });

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('              ÚLTIMAS 10 OPERACIONES PUT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Timestamp            | Entry    | Exit     | Result | P&L');
  console.log('─────────────────────┼──────────┼──────────┼────────┼────────');

  putTrades.slice(-10).forEach(t => {
    const date = t.entryTimestamp > 0
      ? new Date(t.entryTimestamp).toISOString().replace('T', ' ').slice(0, 19)
      : 'N/A                ';
    const resultIcon = t.result === 'WIN' ? '✅ WIN ' : '❌ LOSS';
    console.log(`${date} | ${t.entryPrice.toFixed(2).padStart(8)} | ${t.exitPrice.toFixed(2).padStart(8)} | ${resultIcon} | $${t.pnl.toFixed(2).padStart(6)}`);
  });

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                       TOTAL');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Trades: ${result.trades.length}`);
  console.log(`  Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`  P&L: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`  Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Recommendation
  console.log();
  if (wrDiff > 5) {
    console.log(`💡 RECOMENDACIÓN: ${betterDirection} tiene ${wrDiff.toFixed(1)}% más win rate.`);
    console.log(`   Considera filtrar solo señales ${betterDirection} para mejorar resultados.`);
  } else {
    console.log('💡 Ambas direcciones tienen rendimiento similar.');
  }
}

main().catch(console.error);
