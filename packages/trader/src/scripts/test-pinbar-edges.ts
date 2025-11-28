#!/usr/bin/env npx tsx
/**
 * Test Pin Bar Strategy con Edges Aplicados
 * 
 * Estrategia optimizada con los edges encontrados:
 * - Filtro por horas (2, 8, 12, 16, 20 UTC)
 * - Evitar jueves
 * - Preferir wick ratio 60-70%
 * - Priorizar RSI edge ranges (30-40, 60-70)
 * - Priorizar pin bars cerca de BB
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  quickExportChart,
  createPinBarStrategy,
} from '../backtest/index.js';

const ASSET = 'frxXAUUSD';
const DATA_FILE = 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_TEST = 30;
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   PIN BAR CON EDGES - BACKTEST 30 DÍAS                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    process.exit(1);
  }

  console.log(`📂 Cargando datos de: ${DATA_FILE}`);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  // Filter to first N days
  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_TEST * oneDaySeconds);

  const candles = allCandles.filter(c => {
    return c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime;
  });

  const firstDate = new Date(firstCandleTime * 1000);
  const lastDate = new Date(lastCandleTime * 1000);
  
  console.log(`   ✅ Cargadas ${candles.length.toLocaleString()} velas`);
  console.log(`   📅 Período: ${firstDate.toISOString().split('T')[0]} → ${lastDate.toISOString().split('T')[0]}\n`);

  // Strategy with edges applied
  console.log('🎯 Estrategia: Pin Bar con Edges Aplicados');
  console.log('   ✅ Filtro de horas: Solo 2, 8, 12, 16, 20 UTC');
  console.log('   ✅ Evitar jueves (41.7% WR)');
  console.log('   ✅ Preferir wick ratio 60-70% (61% WR)');
  console.log('   ✅ Priorizar RSI edge ranges (30-40, 60-70)');
  console.log('   ✅ Priorizar pin bars cerca de BB (55.9% WR)');
  console.log('   ✅ Filtro de tendencia: Solo trades a favor de EMA20\n');
  
  const strategy = createPinBarStrategy(ASSET, {
    rsiPeriod: 14,
    rsiOversold: 35,
    rsiOverbought: 65,
    pinBarWickRatio: 0.5,
    pinBarBodyRatio: 0.4,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
    cooldownBars: 2,
  });

  console.log(`   Indicadores requeridos: ${strategy.requiredIndicators().join(', ')}\n`);

  // Run backtest
  console.log('🚀 Ejecutando backtest...');
  const startTime = Date.now();

  const result = runBacktest(strategy, candles, {
    asset: ASSET,
    timeframe: 60,
    initialBalance: INITIAL_BALANCE,
    stakeMode: 'percentage',
    stakePct: STAKE_PCT,
    stakeAmount: INITIAL_BALANCE * STAKE_PCT,
    multiplier: MULTIPLIER,
  }, {
    runMonteCarlo: false,
    runOOS: false,
    verbose: false,
  });

  const elapsed = Date.now() - startTime;
  console.log(`   ✅ Completado en ${elapsed}ms\n`);

  // Print results
  printBacktestResult(result);

  // Generate chart
  if (result.trades.length > 0) {
    console.log('\n📈 Generando gráfico...');
    try {
      const chartPath = quickExportChart(result, undefined, {
        title: `Pin Bar con Edges - ${ASSET} (${DAYS_TO_TEST} días)`,
        showIndicators: ['rsi', 'bbands', 'ema'],
      });
      console.log(`   ✅ Gráfico guardado en: ${chartPath}`);
      console.log(`   📂 Abrir en navegador: file://${chartPath}\n`);
    } catch (error) {
      console.error(`   ⚠️  Error al generar gráfico: ${error}\n`);
    }
  }

  // Detailed analysis
  const wins = result.trades.filter(t => t.result?.outcome === 'WIN');
  const losses = result.trades.filter(t => t.result?.outcome === 'LOSS');
  
  // Analyze time filters
  const hourCounts: Record<number, { wins: number; total: number }> = {};
  const dayCounts: Record<number, { wins: number; total: number }> = {};
  
  for (const trade of result.trades) {
    const entry = trade.entry;
    if (!entry) continue;
    
    const entryTime = new Date(entry.snapshot.timestamp);
    const hour = entryTime.getUTCHours();
    const day = entryTime.getUTCDay();
    
    if (!hourCounts[hour]) hourCounts[hour] = { wins: 0, total: 0 };
    hourCounts[hour]!.total++;
    if (trade.result?.outcome === 'WIN') hourCounts[hour]!.wins++;
    
    if (!dayCounts[day]) dayCounts[day] = { wins: 0, total: 0 };
    dayCounts[day]!.total++;
    if (trade.result?.outcome === 'WIN') dayCounts[day]!.wins++;
  }

  console.log('═'.repeat(80));
  console.log('ANÁLISIS DE FILTROS APLICADOS');
  console.log('═'.repeat(80));
  console.log(`Total trades:        ${result.metrics.totalTrades}`);
  console.log(`Wins:                ${wins.length} (${result.metrics.winRate.toFixed(1)}%)`);
  console.log(`Losses:              ${losses.length}`);
  console.log(`Net P&L:             $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor:       ${result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown:        ${result.metrics.maxDrawdownPct.toFixed(1)}%`);
  console.log();
  
  console.log('Trades por hora (UTC):');
  for (const [hour, data] of Object.entries(hourCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const wr = (data.wins / data.total) * 100;
    console.log(`  ${hour.padStart(2)}:00 - ${data.total.toString().padStart(3)} trades | WR: ${wr.toFixed(1)}%`);
  }
  console.log();
  
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  console.log('Trades por día:');
  for (const [day, data] of Object.entries(dayCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const wr = (data.wins / data.total) * 100;
    const dayName = dayNames[parseInt(day)]!;
    const emoji = dayName === 'Jue' ? '❌' : wr > 55 ? '✅' : '⚪';
    console.log(`  ${emoji} ${dayName} - ${data.total.toString().padStart(3)} trades | WR: ${wr.toFixed(1)}%`);
  }
  console.log();
}

main().catch(console.error);

