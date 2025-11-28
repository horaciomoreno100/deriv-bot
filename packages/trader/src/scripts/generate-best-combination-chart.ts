#!/usr/bin/env tsx
/**
 * Generar gráfico de la mejor combinación con todas las condiciones lógicas
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
  exportChart,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '1', 10);

async function main() {
  console.log('='.repeat(80));
  console.log('GENERANDO GRÁFICO - MEJOR COMBINACIÓN CON CONDICIONES LÓGICAS');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Días: ${DAYS_TO_ANALYZE}\n`);

  // Load data
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

  console.log(`✅ Cargadas ${candles.length} velas\n`);

  // Best combination with all logical conditions
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
    avoidRSIMidRange: true, // Nueva condición: evitar RSI 40-60
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  });

  console.log('🔄 Ejecutando backtest...\n');
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  console.log('='.repeat(80));
  console.log('RESULTADOS');
  console.log('='.repeat(80));
  console.log(`Total trades: ${result.trades.length}`);
  console.log(`Wins: ${result.metrics.wins} (${result.metrics.winRate.toFixed(1)}%)`);
  console.log(`Losses: ${result.metrics.losses} (${(100 - result.metrics.winRate).toFixed(1)}%)`);
  console.log(`Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%\n`);

  const chartFilename = `analysis-output/mtf-levels-${ASSET}-best-logical-conditions-${DAYS_TO_ANALYZE}d.html`;
  console.log(`📊 Generando gráfico: ${chartFilename}...`);
  
  await exportChart(result, chartFilename, {
    title: `MTF Levels - Mejor Combinación (Condiciones Lógicas) - ${ASSET} - ${DAYS_TO_ANALYZE} día${DAYS_TO_ANALYZE > 1 ? 's' : ''}`,
    showTrades: true,
    showEquity: true,
    showIndicators: ['rsi', 'bbands'],
  });

  console.log(`✅ Gráfico generado: ${chartFilename}\n`);
  console.log('='.repeat(80));
  console.log('CONDICIONES APLICADAS:');
  console.log('='.repeat(80));
  console.log('✅ Bounce strength mínimo: 50% (bounce real, no ruido)');
  console.log('✅ Nivel fuerte requerido (5m+15m cuando contra tendencia)');
  console.log('✅ Bollinger Bands: CALL en banda baja, PUT en banda alta');
  console.log('✅ RSI: Evitar zona neutral 40-60 (sin momentum claro)');
  console.log('='.repeat(80));
  console.log('Completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

