#!/usr/bin/env tsx
/**
 * Generar gráfico del backtest completo
 */

import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
  exportChart,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';

async function main() {
  console.log('='.repeat(80));
  console.log('GENERANDO GRÁFICO - MTF Levels Improved v2');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data: ${DATA_FILE}\n`);

  const candles = loadCandlesFromCSV(DATA_FILE, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`✅ Cargadas ${candles.length} velas\n`);

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
    requireStrongLevelAgainstTrend: false,
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

  const chartFilename = `analysis-output/mtf-levels-${ASSET}-improved-v2-30d.html`;
  console.log(`📊 Generando gráfico: ${chartFilename}...`);
  
  await exportChart(result, chartFilename, {
    title: `MTF Levels Improved v2 - ${ASSET} - 30 días`,
    showTrades: true,
    showEquity: true,
  });

  console.log(`✅ Gráfico generado: ${chartFilename}\n`);
  console.log('='.repeat(80));
  console.log('Completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

