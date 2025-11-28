/**
 * Test MTF Levels Strategy
 *
 * Prueba la estrategia de niveles multi-timeframe que:
 * 1. Detecta niveles de 5m y 15m
 * 2. Entra cuando el precio toca un nivel y rebota
 * 3. Filtra por alineación de tendencia
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  printBacktestResult,
  exportChart,
  createMTFLevelsStrategy,
} from '../backtest/index.js';

// Configuration
const ASSET = process.env.ASSET || 'R_100';
const DATA_FILE = process.env.DATA_FILE || 'data/R_100_1m_90d.csv';
const INITIAL_BALANCE = 1000;
const MULTIPLIER = parseInt(process.env.MULT || '100', 10);
const STAKE_PCT = parseFloat(process.env.STAKE_PCT || '2');

async function main() {
  console.log('='.repeat(60));
  console.log('MTF LEVELS STRATEGY BACKTEST');
  console.log('='.repeat(60));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`Initial balance: $${INITIAL_BALANCE}`);
  console.log(`Multiplier: ${MULTIPLIER}x`);
  console.log(`Stake: ${STAKE_PCT}%`);
  console.log('');

  // Load candles
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`Data file not found: ${dataPath}`);
    console.log('\nPrimero debes descargar los datos:');
    console.log(`SYMBOLS="${ASSET}" DAYS=7 GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    process.exit(1);
  }

  console.log('Loading candles...');
  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',  // CSV timestamps are in milliseconds
  });
  console.log(`Loaded ${candles.length} candles`);
  console.log('');

  // Create strategy with different parameter sets
  const paramSets = [
    {
      name: 'Default (both directions)',
      params: {},  // Now defaults to requireTrendAlignment: true, cooldown: 10
    },
    {
      name: 'CALL only (mejor WR)',
      params: {
        requireTrendAlignment: true,
        allowedDirection: 'CALL' as const,
        cooldownBars: 10,
      },
    },
    {
      name: 'CALL Scalper (quick TP/SL)',
      params: {
        requireTrendAlignment: true,
        allowedDirection: 'CALL' as const,
        levelTolerance: 0.8,
        takeProfitPct: 0.003,
        stopLossPct: 0.002,
        cooldownBars: 10,
        confirmationBars: 2,
      },
    },
    {
      name: 'CALL Conservative',
      params: {
        requireTrendAlignment: true,
        allowedDirection: 'CALL' as const,
        cooldownBars: 15,
        confirmationBars: 3,
        confirmationMinMove: 0.4,
      },
    },
    {
      name: 'CALL Moderate (paso 1)',
      params: {
        requireTrendAlignment: true,
        allowedDirection: 'CALL' as const,
        cooldownBars: 10,               // Reducido de 15 a 10
        confirmationBars: 2,            // Reducido de 3 a 2
        confirmationMinMove: 0.3,       // Reducido de 0.4 a 0.3
        levelTolerance: 0.7,            // Aumentado de 0.5 a 0.7
      },
    },
    {
      name: 'CALL Active (paso 2)',
      params: {
        requireTrendAlignment: true,
        allowedDirection: 'CALL' as const,
        cooldownBars: 5,                // Reducido a 5
        confirmationBars: 1,            // Solo 1 confirmación
        confirmationMinMove: 0.2,       // Reducido a 0.2
        levelTolerance: 0.8,            // Aumentado a 0.8
        swingDepth5m: 2,                // Swings más pequeños
      },
    },
    {
      name: 'CALL Very Active (paso 2.5)',
      params: {
        requireTrendAlignment: true,
        allowedDirection: 'CALL' as const,
        cooldownBars: 3,                // Cooldown más bajo
        confirmationBars: 1,
        confirmationMinMove: 0.15,      // Movimiento mínimo más bajo
        levelTolerance: 1.0,            // Tolerancia más amplia
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions with Trend (paso 2.75)',
      params: {
        requireTrendAlignment: true,    // Mantener filtro de tendencia
        allowedDirection: 'both',       // Pero permitir ambas direcciones
        cooldownBars: 5,
        confirmationBars: 1,
        confirmationMinMove: 0.2,
        levelTolerance: 0.8,
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions with Trend Relaxed (paso 2.85)',
      params: {
        requireTrendAlignment: true,    // Mantener filtro de tendencia
        allowedDirection: 'both',
        cooldownBars: 4,                // Cooldown un poco más bajo
        confirmationBars: 1,
        confirmationMinMove: 0.18,      // Movimiento mínimo más bajo
        levelTolerance: 0.85,           // Tolerancia un poco más amplia
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions No Trend Strict (paso 2.9)',
      params: {
        requireTrendAlignment: false,   // Sin filtro de tendencia
        allowedDirection: 'both',
        cooldownBars: 8,                // Cooldown alto para limitar trades
        confirmationBars: 1,
        confirmationMinMove: 0.2,       // Movimiento mínimo moderado
        levelTolerance: 0.85,           // Tolerancia moderada
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions No Trend Moderate (paso 2.95)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 6,                // Cooldown moderado
        confirmationBars: 1,
        confirmationMinMove: 0.2,
        levelTolerance: 0.9,            // Tolerancia moderada
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions CALL-heavy (paso 3)',
      params: {
        requireTrendAlignment: false,   // Sin filtro de tendencia
        allowedDirection: 'both',       // Ambas direcciones
        cooldownBars: 5,                // Mantener cooldown
        confirmationBars: 1,
        confirmationMinMove: 0.2,       // Movimiento mínimo moderado
        levelTolerance: 0.9,            // Tolerancia moderada
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions Balanced (paso 3.25)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 5,
        confirmationBars: 1,
        confirmationMinMove: 0.18,      // Movimiento mínimo intermedio
        levelTolerance: 0.95,           // Tolerancia intermedia
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions IMPROVED v1 (muy restrictivo)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 6,
        confirmationBars: 1,
        confirmationBarsPUT: 2,  // MEJORA: Más confirmación para PUT
        confirmationMinMove: 0.2,
        confirmationMinMoveAgainstTrend: 0.3,  // MEJORA: Más movimiento cuando contra tendencia
        levelTolerance: 0.9,
        swingDepth5m: 2,
        swingDepth15m: 2,
        requireStrongLevelAgainstTrend: true,  // MEJORA: Nivel fuerte contra tendencia
        takeProfitPct: 0.004,  // MEJORA: TP más ajustado (0.4% en vez de 0.5%)
        stopLossPct: 0.003,
      },
    },
    {
      name: 'Both Directions IMPROVED v2 (balanceado)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 6,
        confirmationBars: 1,
        confirmationBarsPUT: 1,  // MEJORA: Misma confirmación pero con cuerpo fuerte
        confirmationMinMove: 0.2,
        confirmationMinMoveAgainstTrend: 0.25,  // MEJORA: Ligeramente más movimiento contra tendencia
        levelTolerance: 0.9,
        swingDepth5m: 2,
        swingDepth15m: 2,
        requireStrongLevelAgainstTrend: false,  // No tan restrictivo
        takeProfitPct: 0.004,  // MEJORA: TP más ajustado (0.4% en vez de 0.5%)
        stopLossPct: 0.003,
      },
    },
    {
      name: 'Both Directions IMPROVED v3 (con filtro BB)',
      params: {
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
        requireBBBand: true,  // MEJORA: Filtro de Bollinger Bands
        bbBandTolerance: 0.15, // 15% del ancho de banda
        takeProfitPct: 0.004,
        stopLossPct: 0.003,
      },
    },
    {
      name: 'Both Directions Moderate (paso 3.5)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 5,
        confirmationBars: 1,
        confirmationMinMove: 0.15,
        levelTolerance: 1.0,            // Tolerancia amplia
        swingDepth5m: 2,
        swingDepth15m: 2,
      },
    },
    {
      name: 'Both Directions Active (paso 4)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 3,                // Cooldown bajo
        confirmationBars: 1,
        confirmationMinMove: 0.1,       // Movimiento mínimo bajo
        levelTolerance: 1.2,            // Tolerancia más amplia
        swingDepth5m: 2,
        swingDepth15m: 2,
        minCandles: 70,
      },
    },
    {
      name: 'Both Directions Very Active (paso 4.5)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 1,                // Cooldown mínimo
        confirmationBars: 1,
        confirmationMinMove: 0.08,      // Movimiento mínimo muy bajo
        levelTolerance: 1.3,            // Tolerancia amplia
        swingDepth5m: 2,
        swingDepth15m: 2,
        minCandles: 60,
      },
    },
    {
      name: 'No trend filter (baseline)',
      params: {
        requireTrendAlignment: false,
        cooldownBars: 10,
      },
    },
    {
      name: 'Scalping Aggressive (máxima frecuencia)',
      params: {
        requireTrendAlignment: false,  // Sin filtro de tendencia
        allowedDirection: 'both',       // Ambas direcciones
        cooldownBars: 0,                // Sin cooldown
        confirmationBars: 0,            // Sin confirmación
        confirmationMinMove: 0.05,      // Movimiento mínimo muy bajo
        levelTolerance: 1.5,            // Tolerancia amplia (detecta más niveles)
        swingDepth5m: 2,                // Swings más pequeños (era 3)
        swingDepth15m: 2,               // Swings más pequeños (era 3)
        takeProfitPct: 0.003,           // TP rápido
        stopLossPct: 0.002,             // SL ajustado
        minCandles: 50,                 // Menos velas de warm-up
      },
    },
    {
      name: 'Scalping Ultra (solo 5m, sin 15m)',
      params: {
        requireTrendAlignment: false,
        allowedDirection: 'both',
        cooldownBars: 0,
        confirmationBars: 0,
        confirmationMinMove: 0.03,
        levelTolerance: 2.0,            // Tolerancia muy amplia
        swingDepth5m: 1,                // Swings mínimos
        swingDepth15m: 1,               // Swings mínimos
        takeProfitPct: 0.002,           // TP muy rápido
        stopLossPct: 0.0015,            // SL muy ajustado
        minCandles: 30,                 // Warm-up mínimo
      },
    },
  ];

  const results: Array<{ name: string; result: any }> = [];

  for (const paramSet of paramSets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${paramSet.name}`);
    console.log('='.repeat(60));

    const strategy = createMTFLevelsStrategy(ASSET, paramSet.params);

    try {
      const result = runBacktest(strategy, candles, {
        initialBalance: INITIAL_BALANCE,
        multiplier: MULTIPLIER,
        stakePct: STAKE_PCT,
      });

      results.push({ name: paramSet.name, result });

      // Print summary
      const metrics = result.metrics;
      const finalBalance = INITIAL_BALANCE + metrics.netPnl;
      // winRate already comes as 0-100, not 0-1
      const winRatePct = metrics.winRate > 1 ? metrics.winRate : metrics.winRate * 100;
      console.log(`\nResultados:`);
      console.log(`  Trades: ${metrics.totalTrades}`);
      console.log(`  Win Rate: ${winRatePct.toFixed(1)}%`);
      console.log(`  Net PnL: $${metrics.netPnl.toFixed(2)}`);
      console.log(`  Final Balance: $${finalBalance.toFixed(2)}`);
      console.log(`  Max Drawdown: ${metrics.maxDrawdownPct.toFixed(1)}%`);
      console.log(`  Profit Factor: ${metrics.profitFactor.toFixed(2)}`);

      if (metrics.totalTrades > 0) {
        console.log(`  Avg Win: $${metrics.avgWin.toFixed(2)}`);
        console.log(`  Avg Loss: $${metrics.avgLoss.toFixed(2)}`);
      }

    } catch (error) {
      console.error(`Error testing ${paramSet.name}:`, error);
    }
  }

  // Summary comparison
  console.log('\n' + '='.repeat(80));
  console.log('RESUMEN COMPARATIVO');
  console.log('='.repeat(80));
  console.log('');
  console.log(
    'Strategy'.padEnd(35) +
    'Trades'.padStart(8) +
    'WR%'.padStart(8) +
    'NetPnL'.padStart(12) +
    'MaxDD%'.padStart(8) +
    'PF'.padStart(8)
  );
  console.log('-'.repeat(80));

  for (const { name, result } of results) {
    const m = result.metrics;
    const wr = m.winRate > 1 ? m.winRate : m.winRate * 100;
    console.log(
      name.padEnd(35) +
      String(m.totalTrades).padStart(8) +
      `${wr.toFixed(1)}%`.padStart(8) +
      `$${m.netPnl.toFixed(2)}`.padStart(12) +
      `${m.maxDrawdownPct.toFixed(1)}%`.padStart(8) +
      m.profitFactor.toFixed(2).padStart(8)
    );
  }

  // Export chart for the best result
  const bestResult = results.reduce((best, curr) => {
    if (!best) return curr;
    return curr.result.metrics.netPnl > best.result.metrics.netPnl ? curr : best;
  }, results[0]);

  if (bestResult && bestResult.result.metrics.totalTrades > 0) {
    const chartPath = `analysis-output/mtf-levels-${ASSET}-${bestResult.name.replace(/\s+/g, '-').toLowerCase()}.html`;
    console.log(`\nExporting chart for best result (${bestResult.name}): ${chartPath}`);

    try {
      await exportChart(bestResult.result, chartPath, {
        title: `MTF Levels - ${bestResult.name}`,
        showTrades: true,
        showEquity: true,
      });
      console.log(`Chart exported: ${chartPath}`);
    } catch (error) {
      console.error('Error exporting chart:', error);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Backtest completado');
  console.log('='.repeat(60));
}

main().catch(console.error);
