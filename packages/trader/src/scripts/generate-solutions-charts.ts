#!/usr/bin/env tsx
/**
 * Generar gráficos para las diferentes soluciones probadas
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

interface ChartConfig {
  name: string;
  filename: string;
  params: any;
}

async function generateChart(config: ChartConfig, candles: any[]) {
  console.log(`\n📊 Generando gráfico: ${config.name}...`);
  
  const strategy = createMTFLevelsStrategy(ASSET, config.params);
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  console.log(`  Trades: ${result.trades.length}`);
  console.log(`  Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
  console.log(`  Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`  Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);

  const chartPath = path.join('analysis-output', config.filename);
  
  // Mostrar RSI y Bollinger Bands (los indicadores que usa la estrategia)
  const showIndicators: ('rsi' | 'bbands' | 'squeeze' | 'macd' | 'volume')[] = ['rsi', 'bbands'];
  
  await exportChart(result, chartPath, {
    title: `${config.name} - ${ASSET} - ${DAYS_TO_ANALYZE} día${DAYS_TO_ANALYZE > 1 ? 's' : ''}`,
    showTrades: true,
    showEquity: true,
    showIndicators: showIndicators,
  });

  console.log(`  ✅ Guardado: ${chartPath}`);
  
  return { config, result };
}

async function main() {
  console.log('='.repeat(80));
  console.log('GENERANDO GRÁFICOS DE SOLUCIONES');
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

  // Base configuration
  const baseConfig = {
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
    requireStrongLevelAgainstTrend: false,
    requireBBBand: true,
    bbBandTolerance: 0.15,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  };

  // Configurations to chart
  const configs: ChartConfig[] = [
    {
      name: 'BASE (Estado Actual)',
      filename: `mtf-levels-${ASSET}-base-${DAYS_TO_ANALYZE}d.html`,
      params: baseConfig,
    },
    {
      name: 'COMBINACIÓN GANADORA (Bounce 50% + Nivel Fuerte)',
      filename: `mtf-levels-${ASSET}-best-combination-${DAYS_TO_ANALYZE}d.html`,
      params: {
        ...baseConfig,
        minBounceStrength: 0.5,
        requireStrongLevelAgainstTrend: true,
      },
    },
    {
      name: 'Bounce Strength 50%',
      filename: `mtf-levels-${ASSET}-bounce50-${DAYS_TO_ANALYZE}d.html`,
      params: {
        ...baseConfig,
        minBounceStrength: 0.5,
      },
    },
    {
      name: 'Nivel Fuerte Contra Tendencia',
      filename: `mtf-levels-${ASSET}-strong-level-${DAYS_TO_ANALYZE}d.html`,
      params: {
        ...baseConfig,
        requireStrongLevelAgainstTrend: true,
      },
    },
  ];

  const results = [];
  for (const config of configs) {
    const result = await generateChart(config, candles);
    results.push(result);
  }

  console.log('\n' + '='.repeat(80));
  console.log('RESUMEN');
  console.log('='.repeat(80));
  console.log('');
  
  for (const { config, result } of results) {
    console.log(`${config.name}:`);
    console.log(`  Trades: ${result.trades.length}`);
    console.log(`  Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
    console.log(`  Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
    console.log(`  Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
    console.log(`  Gráfico: analysis-output/${config.filename}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('✅ Todos los gráficos generados');
  console.log('='.repeat(80));
}

main().catch(console.error);

