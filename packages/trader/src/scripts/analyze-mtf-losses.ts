/**
 * Analyze MTF Levels Strategy Losses
 *
 * Entender por qué perdemos y cuándo perdemos
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'R_100';
const DATA_FILE = process.env.DATA_FILE || 'data/R_100_1m_7d.csv';

async function main() {
  console.log('='.repeat(70));
  console.log('ANÁLISIS DE PÉRDIDAS - MTF Levels Strategy');
  console.log('='.repeat(70));

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`Loaded ${candles.length} candles\n`);

  // Run backtest with trend filter enabled
  const strategy = createMTFLevelsStrategy(ASSET, {
    requireTrendAlignment: true,
    levelTolerance: 0.8,
    takeProfitPct: 0.003,
    stopLossPct: 0.002,
    cooldownBars: 10,
    confirmationBars: 2,
  });

  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');

  console.log(`Total trades: ${trades.length}`);
  console.log(`Wins: ${wins.length} (${((wins.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Losses: ${losses.length} (${((losses.length / trades.length) * 100).toFixed(1)}%)`);
  console.log('');

  // Analyze losses by direction
  const callLosses = losses.filter(t => t.direction === 'CALL');
  const putLosses = losses.filter(t => t.direction === 'PUT');
  const callWins = wins.filter(t => t.direction === 'CALL');
  const putWins = wins.filter(t => t.direction === 'PUT');

  console.log('='.repeat(70));
  console.log('ANÁLISIS POR DIRECCIÓN');
  console.log('='.repeat(70));
  console.log(`CALL: ${callWins.length} wins, ${callLosses.length} losses (WR: ${((callWins.length / (callWins.length + callLosses.length)) * 100).toFixed(1)}%)`);
  console.log(`PUT:  ${putWins.length} wins, ${putLosses.length} losses (WR: ${((putWins.length / (putWins.length + putLosses.length)) * 100).toFixed(1)}%)`);
  console.log('');

  // Analyze consecutive losses
  console.log('='.repeat(70));
  console.log('RACHAS DE PÉRDIDAS CONSECUTIVAS');
  console.log('='.repeat(70));

  let currentStreak = 0;
  let maxStreak = 0;
  const streaks: number[] = [];

  for (const trade of trades) {
    if (trade.result?.outcome === 'LOSS') {
      currentStreak++;
    } else {
      if (currentStreak > 0) {
        streaks.push(currentStreak);
        maxStreak = Math.max(maxStreak, currentStreak);
      }
      currentStreak = 0;
    }
  }
  if (currentStreak > 0) {
    streaks.push(currentStreak);
    maxStreak = Math.max(maxStreak, currentStreak);
  }

  const avgStreak = streaks.length > 0 ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0;
  console.log(`Racha máxima de pérdidas: ${maxStreak}`);
  console.log(`Racha promedio de pérdidas: ${avgStreak.toFixed(1)}`);
  console.log(`Total de rachas: ${streaks.length}`);
  console.log(`Distribución: ${streaks.slice(0, 20).join(', ')}${streaks.length > 20 ? '...' : ''}`);
  console.log('');

  // Analyze time between trades
  console.log('='.repeat(70));
  console.log('TIEMPO ENTRE TRADES');
  console.log('='.repeat(70));

  const timeBetweenTrades: number[] = [];
  for (let i = 1; i < trades.length; i++) {
    const prevExit = trades[i - 1]?.exit?.snapshot?.timestamp ?? 0;
    const currEntry = trades[i]?.entry?.snapshot?.timestamp ?? 0;
    if (prevExit && currEntry) {
      const diffMinutes = (currEntry - prevExit) / 1000 / 60;
      timeBetweenTrades.push(diffMinutes);
    }
  }

  const avgTimeBetween = timeBetweenTrades.length > 0
    ? timeBetweenTrades.reduce((a, b) => a + b, 0) / timeBetweenTrades.length
    : 0;
  const minTime = Math.min(...timeBetweenTrades);
  const maxTime = Math.max(...timeBetweenTrades);

  console.log(`Tiempo promedio entre trades: ${avgTimeBetween.toFixed(1)} minutos`);
  console.log(`Tiempo mínimo: ${minTime.toFixed(1)} minutos`);
  console.log(`Tiempo máximo: ${maxTime.toFixed(1)} minutos`);

  // Count trades that happened too quickly
  const quickTrades = timeBetweenTrades.filter(t => t < 5).length;
  console.log(`Trades con <5 min de separación: ${quickTrades} (${((quickTrades / timeBetweenTrades.length) * 100).toFixed(1)}%)`);
  console.log('');

  // Analyze losses by market condition (using indicators)
  console.log('='.repeat(70));
  console.log('ANÁLISIS DE PÉRDIDAS POR CONDICIÓN DE MERCADO');
  console.log('='.repeat(70));

  // Group losses by RSI zones
  const lossesWithRSI = losses.filter(t => t.entry?.snapshot?.indicators?.rsi !== undefined);
  const rsiZones = {
    oversold: lossesWithRSI.filter(t => (t.entry?.snapshot?.indicators?.rsi as number) < 30),
    neutral: lossesWithRSI.filter(t => {
      const rsi = t.entry?.snapshot?.indicators?.rsi as number;
      return rsi >= 30 && rsi <= 70;
    }),
    overbought: lossesWithRSI.filter(t => (t.entry?.snapshot?.indicators?.rsi as number) > 70),
  };

  console.log('Pérdidas por zona RSI:');
  console.log(`  Oversold (<30): ${rsiZones.oversold.length}`);
  console.log(`  Neutral (30-70): ${rsiZones.neutral.length}`);
  console.log(`  Overbought (>70): ${rsiZones.overbought.length}`);
  console.log('');

  // Analyze by level type and strength
  console.log('Pérdidas por tipo de nivel:');
  const levelTypeLosses = {
    support: losses.filter(t => t.entry?.snapshot?.indicators?.levelType === 'low'),
    resistance: losses.filter(t => t.entry?.snapshot?.indicators?.levelType === 'high'),
  };
  console.log(`  Support (CALL): ${levelTypeLosses.support.length}`);
  console.log(`  Resistance (PUT): ${levelTypeLosses.resistance.length}`);
  console.log('');

  // Analyze by trend context
  console.log('Pérdidas por tendencia 15m:');
  const trend15mLosses = {
    up: losses.filter(t => t.entry?.snapshot?.indicators?.trend15m === 'up'),
    down: losses.filter(t => t.entry?.snapshot?.indicators?.trend15m === 'down'),
    sideways: losses.filter(t => t.entry?.snapshot?.indicators?.trend15m === 'sideways'),
  };
  console.log(`  Uptrend: ${trend15mLosses.up.length}`);
  console.log(`  Downtrend: ${trend15mLosses.down.length}`);
  console.log(`  Sideways: ${trend15mLosses.sideways.length}`);
  console.log('');

  // Check for trades against the 15m trend
  console.log('='.repeat(70));
  console.log('TRADES CONTRA LA TENDENCIA');
  console.log('='.repeat(70));

  const callInDowntrend = trades.filter(t =>
    t.direction === 'CALL' && t.entry?.snapshot?.indicators?.trend15m === 'down'
  );
  const putInUptrend = trades.filter(t =>
    t.direction === 'PUT' && t.entry?.snapshot?.indicators?.trend15m === 'up'
  );

  const callInDowntrendLosses = callInDowntrend.filter(t => t.result?.outcome === 'LOSS');
  const putInUptrendLosses = putInUptrend.filter(t => t.result?.outcome === 'LOSS');

  console.log(`CALL en downtrend: ${callInDowntrend.length} trades, ${callInDowntrendLosses.length} pérdidas (${((callInDowntrendLosses.length / callInDowntrend.length) * 100 || 0).toFixed(1)}% loss rate)`);
  console.log(`PUT en uptrend: ${putInUptrend.length} trades, ${putInUptrendLosses.length} pérdidas (${((putInUptrendLosses.length / putInUptrend.length) * 100 || 0).toFixed(1)}% loss rate)`);
  console.log('');

  // Sample of loss trades with context
  console.log('='.repeat(70));
  console.log('MUESTRA DE TRADES PERDEDORES (primeros 10)');
  console.log('='.repeat(70));

  for (let i = 0; i < Math.min(10, losses.length); i++) {
    const trade = losses[i]!;
    const entry = trade.entry;
    const exit = trade.exit;
    const indicators = entry?.snapshot?.indicators || {};

    const entryTime = entry?.snapshot?.timestamp
      ? new Date(entry.snapshot.timestamp).toISOString().replace('T', ' ').slice(0, 19)
      : 'N/A';

    console.log(`\n${i + 1}. ${trade.direction} @ ${entry?.executedPrice?.toFixed(2) || 'N/A'}`);
    console.log(`   Entry: ${entryTime}`);
    console.log(`   Exit: ${exit?.executedPrice?.toFixed(2) || 'N/A'} (${trade.result?.exitReason || 'N/A'})`);
    console.log(`   PnL: $${trade.result?.pnl?.toFixed(2) || 'N/A'}`);
    console.log(`   RSI: ${(indicators.rsi as number)?.toFixed(1) || 'N/A'}`);
    console.log(`   Level: ${indicators.levelType} @ ${(indicators.nearestLevel as number)?.toFixed(2) || 'N/A'} (strength: ${indicators.levelStrength})`);
    console.log(`   Trend 5m: ${indicators.trend5m}, 15m: ${indicators.trend15m}`);
    console.log(`   Reason: ${entry?.reason?.slice(0, 80) || 'N/A'}...`);
  }

  // Recommendations
  console.log('\n' + '='.repeat(70));
  console.log('RECOMENDACIONES');
  console.log('='.repeat(70));

  const recommendations: string[] = [];

  if (quickTrades > timeBetweenTrades.length * 0.3) {
    recommendations.push('- Aumentar cooldown: muchos trades muy seguidos');
  }

  if (maxStreak > 5) {
    recommendations.push(`- Implementar circuit breaker: racha máxima de ${maxStreak} pérdidas`);
  }

  const callWinRate = callWins.length / (callWins.length + callLosses.length);
  const putWinRate = putWins.length / (putWins.length + putLosses.length);
  if (Math.abs(callWinRate - putWinRate) > 0.1) {
    const betterDir = callWinRate > putWinRate ? 'CALL' : 'PUT';
    const worseDir = betterDir === 'CALL' ? 'PUT' : 'CALL';
    recommendations.push(`- Considerar filtrar ${worseDir}: ${betterDir} tiene ${((Math.abs(callWinRate - putWinRate)) * 100).toFixed(1)}% mejor WR`);
  }

  if (callInDowntrendLosses.length > callInDowntrend.length * 0.6) {
    recommendations.push('- Evitar CALL en downtrend 15m: alta tasa de pérdida');
  }

  if (putInUptrendLosses.length > putInUptrend.length * 0.6) {
    recommendations.push('- Evitar PUT en uptrend 15m: alta tasa de pérdida');
  }

  if (recommendations.length === 0) {
    console.log('No hay recomendaciones específicas basadas en el análisis.');
  } else {
    recommendations.forEach(r => console.log(r));
  }
}

main().catch(console.error);
