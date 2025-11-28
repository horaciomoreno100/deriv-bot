#!/usr/bin/env npx tsx
/**
 * Test Pin Bar Strategy Mejorada - Backtest Completo 30 días
 * 
 * Estrategia mejorada con:
 * - Filtro de tendencia (solo trades a favor de EMA20)
 * - RSI más estricto (35/65 en lugar de 45/55)
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
  console.log('║   PIN BAR MEJORADA - BACKTEST 30 DÍAS                     ║');
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

  // Improved Strategy with trend filter and stricter RSI
  console.log('🎯 Estrategia: Pin Bar Mejorada');
  console.log('   ✅ Filtro de tendencia: Solo trades a favor de EMA20');
  console.log('   ✅ RSI más estricto: < 35 para CALL, > 65 para PUT');
  console.log('   ✅ Mejor detección de pin bars cerca de BB\n');
  
  const strategy = createPinBarStrategy(ASSET, {
    rsiPeriod: 14,
    rsiOversold: 35,      // Más estricto (era 35, pero ahora se usa < 35)
    rsiOverbought: 65,    // Más estricto (era 65, pero ahora se usa > 65)
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
        title: `Pin Bar Mejorada - ${ASSET} (${DAYS_TO_TEST} días)`,
        showIndicators: ['rsi', 'bbands', 'ema'],
      });
      console.log(`   ✅ Gráfico guardado en: ${chartPath}`);
      console.log(`   📂 Abrir en navegador: file://${chartPath}\n`);
    } catch (error) {
      console.error(`   ⚠️  Error al generar gráfico: ${error}\n`);
    }
  }

  // Detailed summary
  const wins = result.trades.filter(t => t.result?.outcome === 'WIN');
  const losses = result.trades.filter(t => t.result?.outcome === 'LOSS');
  
  // Analyze trend filter impact
  const lossesAgainstTrend = losses.filter(t => {
    const indicators = t.entry?.snapshot?.indicators || {};
    const price = t.entry?.executedPrice || 0;
    const ema20 = (indicators.ema20 as number) || price;
    return t.direction === 'CALL' ? price < ema20 : price > ema20;
  });

  console.log('═'.repeat(80));
  console.log('ANÁLISIS DE MEJORAS');
  console.log('═'.repeat(80));
  console.log(`Total trades:        ${result.metrics.totalTrades}`);
  console.log(`Wins:                ${wins.length} (${result.metrics.winRate.toFixed(1)}%)`);
  console.log(`Losses:              ${losses.length}`);
  console.log(`Pérdidas vs tendencia: ${lossesAgainstTrend.length} (${((lossesAgainstTrend.length / losses.length) * 100).toFixed(1)}% de pérdidas)`);
  console.log(`Net P&L:             $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor:       ${result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown:        ${result.metrics.maxDrawdownPct.toFixed(1)}%`);
  console.log();

  if (lossesAgainstTrend.length / losses.length < 0.3) {
    console.log('✅ Filtro de tendencia funcionando: < 30% de pérdidas contra tendencia');
  } else {
    console.log('⚠️  Aún hay pérdidas contra tendencia. Revisar implementación del filtro.');
  }
  console.log();
}

main().catch(console.error);

