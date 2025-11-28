#!/usr/bin/env npx tsx
/**
 * Test Backtest - Gold 1 Day
 * 
 * Prueba rápida del backtest con 1 día de datos de oro
 * 
 * Usage:
 *   npx tsx src/scripts/test-gold-1day.ts
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
  console.log('║        TEST BACKTEST - GOLD 30 DAYS                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    console.log('\n💡 Sugerencia: Asegúrate de tener datos de oro descargados');
    process.exit(1);
  }

  console.log(`📂 Cargando datos de: ${DATA_FILE}`);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`   ✅ Cargadas ${allCandles.length.toLocaleString()} velas totales`);

  // Filter to first N days
  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_TEST * oneDaySeconds);

  const candles = allCandles.filter(c => {
    return c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime;
  });

  const firstDate = new Date(firstCandleTime * 1000);
  const lastDate = new Date(lastCandleTime * 1000);
  
  console.log(`\n📅 Período de prueba:`);
  console.log(`   Desde: ${firstDate.toISOString().split('T')[0]} ${firstDate.toISOString().split('T')[1]!.slice(0, 5)} UTC`);
  console.log(`   Hasta: ${lastDate.toISOString().split('T')[0]} ${lastDate.toISOString().split('T')[1]!.slice(0, 5)} UTC`);
  console.log(`   Velas: ${candles.length} de ${allCandles.length} totales`);
  console.log();

  if (candles.length < 100) {
    console.error(`❌ Muy pocas velas (${candles.length}). Necesitas al menos 100 para un backtest válido.`);
    process.exit(1);
  }

  // Test with Pin Bar strategy (simple and fast)
  console.log('🎯 Probando estrategia: Pin Bar (Price Action)');
  console.log('-'.repeat(60));
  
  const strategy = createPinBarStrategy(ASSET, {
    rsiPeriod: 14,
    rsiOversold: 35,
    rsiOverbought: 65,
    pinBarWickRatio: 0.5,
    pinBarBodyRatio: 0.4,
    takeProfitPct: 0.005,      // 0.5%
    stopLossPct: 0.003,        // 0.3%
    cooldownBars: 2,
  });

  console.log(`   Indicadores requeridos: ${strategy.requiredIndicators().join(', ')}`);
  console.log();

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
        title: `Pin Bar Strategy - ${ASSET} (${DAYS_TO_TEST} días)`,
        showIndicators: ['rsi', 'bbands', 'ema'],
      });
      console.log(`   ✅ Gráfico guardado en: ${chartPath}`);
      console.log(`   📂 Abrir en navegador: file://${chartPath}`);
    } catch (error) {
      console.error(`   ⚠️  Error al generar gráfico: ${error}`);
    }
  }

  // Quick summary
  console.log('\n' + '═'.repeat(60));
  console.log('RESUMEN RÁPIDO');
  console.log('═'.repeat(60));
  console.log(`Asset:         ${ASSET}`);
  console.log(`Período:       ${DAYS_TO_TEST} día(s)`);
  console.log(`Velas:         ${candles.length}`);
  console.log(`Trades:        ${result.metrics.totalTrades}`);
  console.log(`Win Rate:      ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`Net P&L:       $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown:  ${result.metrics.maxDrawdownPct.toFixed(1)}%`);
  console.log();

  if (result.metrics.totalTrades === 0) {
    console.log('⚠️  No se generaron trades. Esto puede ser normal en 1 día de datos.');
    console.log('   Considera probar con más días o ajustar los parámetros de la estrategia.');
  } else {
    console.log('✅ Backtest funcionando correctamente!');
    console.log('   Puedes proceder a implementar la estrategia Sniper.');
  }
}

main().catch(console.error);

