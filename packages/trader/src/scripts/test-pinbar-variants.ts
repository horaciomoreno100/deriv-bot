#!/usr/bin/env npx tsx
/**
 * Test Pin Bar Strategy - Variantes Individuales
 * 
 * Prueba cada mejora por separado para ver su impacto
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  loadCandlesFromCSV,
  runBacktest,
  createPinBarStrategy,
} from '../backtest/index.js';

const ASSET = 'frxXAUUSD';
const DATA_FILE = 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_TEST = 30;
const INITIAL_BALANCE = 1000;
const MULTIPLIER = 100;
const STAKE_PCT = 0.02;

interface VariantResult {
  name: string;
  description: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  lossesAgainstTrend: number;
  lossesAgainstTrendPct: number;
}

async function testVariant(
  name: string,
  description: string,
  candles: any[],
  params: any,
  checkTrendFilter: boolean = false
): Promise<VariantResult> {
  const strategy = createPinBarStrategy(ASSET, params);

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

  const wins = result.trades.filter(t => t.result?.outcome === 'WIN');
  const losses = result.trades.filter(t => t.result?.outcome === 'LOSS');

  let lossesAgainstTrend = 0;
  if (checkTrendFilter) {
    lossesAgainstTrend = losses.filter(t => {
      const indicators = t.entry?.snapshot?.indicators || {};
      const price = t.entry?.executedPrice || 0;
      const ema20 = (indicators.ema20 as number) || price;
      return t.direction === 'CALL' ? price < ema20 : price > ema20;
    }).length;
  }

  return {
    name,
    description,
    trades: result.metrics.totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate: result.metrics.winRate,
    netPnl: result.metrics.netPnl,
    profitFactor: result.metrics.profitFactor === Infinity ? 999 : result.metrics.profitFactor,
    maxDrawdown: result.metrics.maxDrawdownPct,
    lossesAgainstTrend,
    lossesAgainstTrendPct: losses.length > 0 ? (lossesAgainstTrend / losses.length) * 100 : 0,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   TEST VARIANTES PIN BAR - ANÁLISIS INDIVIDUAL            ║');
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

  console.log(`   ✅ Cargadas ${candles.length.toLocaleString()} velas\n`);

  const results: VariantResult[] = [];

  // Variante 1: ORIGINAL (sin mejoras)
  console.log('🔄 Probando Variante 1: ORIGINAL...');
  results.push(await testVariant(
    'Original',
    'Sin mejoras - RSI 45/55, sin filtro tendencia',
    candles,
    {
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      pinBarWickRatio: 0.5,
      pinBarBodyRatio: 0.4,
      takeProfitPct: 0.005,
      stopLossPct: 0.003,
      cooldownBars: 2,
    },
    true
  ));

  // Variante 2: Solo RSI más estricto
  console.log('🔄 Probando Variante 2: RSI ESTRICTO...');
  // Note: Necesitamos modificar la estrategia para esto, pero por ahora usamos los mismos params
  // El RSI estricto se aplica en la lógica de detección
  results.push(await testVariant(
    'RSI Estricto',
    'RSI < 30 para CALL, > 70 para PUT (más estricto)',
    candles,
    {
      rsiPeriod: 14,
      rsiOversold: 30,  // Más estricto
      rsiOverbought: 70, // Más estricto
      pinBarWickRatio: 0.5,
      pinBarBodyRatio: 0.4,
      takeProfitPct: 0.005,
      stopLossPct: 0.003,
      cooldownBars: 2,
    },
    true
  ));

  // Variante 3: Solo filtro de tendencia estricto (necesitamos modificar la estrategia)
  // Por ahora, vamos a simularlo filtrando en post-procesamiento
  console.log('🔄 Probando Variante 3: FILTRO TENDENCIA ESTRICTO...');
  const originalResult = await testVariant(
    'Original',
    'Original para comparar',
    candles,
    {
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      pinBarWickRatio: 0.5,
      pinBarBodyRatio: 0.4,
      takeProfitPct: 0.005,
      stopLossPct: 0.003,
      cooldownBars: 2,
    },
    true
  );

  // Simular filtro estricto en post-procesamiento
  const strategyOriginal = createPinBarStrategy(ASSET, {
    rsiPeriod: 14,
    rsiOversold: 35,
    rsiOverbought: 65,
    pinBarWickRatio: 0.5,
    pinBarBodyRatio: 0.4,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
    cooldownBars: 2,
  });

  const resultOriginal = runBacktest(strategyOriginal, candles, {
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

  // Filtrar trades contra tendencia
  const tradesWithTrend = resultOriginal.trades.filter(t => {
    const indicators = t.entry?.snapshot?.indicators || {};
    const price = t.entry?.executedPrice || 0;
    const ema20 = (indicators.ema20 as number) || price;
    
    if (t.direction === 'CALL') {
      return price >= ema20; // CALL solo si precio >= EMA
    } else {
      return price <= ema20; // PUT solo si precio <= EMA
    }
  });

  const winsFiltered = tradesWithTrend.filter(t => t.result?.outcome === 'WIN');
  const lossesFiltered = tradesWithTrend.filter(t => t.result?.outcome === 'LOSS');
  const grossProfit = winsFiltered.reduce((sum, t) => sum + (t.result?.pnl || 0), 0);
  const grossLoss = Math.abs(lossesFiltered.reduce((sum, t) => sum + (t.result?.pnl || 0), 0));
  const netPnlFiltered = grossProfit - grossLoss;
  const profitFactorFiltered = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  results.push({
    name: 'Filtro Tendencia Estricto',
    description: 'Solo trades a favor de EMA20 (precio >= EMA para CALL, <= EMA para PUT)',
    trades: tradesWithTrend.length,
    wins: winsFiltered.length,
    losses: lossesFiltered.length,
    winRate: tradesWithTrend.length > 0 ? (winsFiltered.length / tradesWithTrend.length) * 100 : 0,
    netPnl: netPnlFiltered,
    profitFactor: profitFactorFiltered === Infinity ? 999 : profitFactorFiltered,
    maxDrawdown: 0, // No calculado en este caso
    lossesAgainstTrend: 0,
    lossesAgainstTrendPct: 0,
  });

  // Variante 4: RSI estricto + Filtro tendencia
  console.log('🔄 Probando Variante 4: RSI ESTRICTO + FILTRO TENDENCIA...');
  const strategyRSI = createPinBarStrategy(ASSET, {
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    pinBarWickRatio: 0.5,
    pinBarBodyRatio: 0.4,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
    cooldownBars: 2,
  });

  const resultRSI = runBacktest(strategyRSI, candles, {
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

  const tradesRSIWithTrend = resultRSI.trades.filter(t => {
    const indicators = t.entry?.snapshot?.indicators || {};
    const price = t.entry?.executedPrice || 0;
    const ema20 = (indicators.ema20 as number) || price;
    
    if (t.direction === 'CALL') {
      return price >= ema20;
    } else {
      return price <= ema20;
    }
  });

  const winsRSI = tradesRSIWithTrend.filter(t => t.result?.outcome === 'WIN');
  const lossesRSI = tradesRSIWithTrend.filter(t => t.result?.outcome === 'LOSS');
  const grossProfitRSI = winsRSI.reduce((sum, t) => sum + (t.result?.pnl || 0), 0);
  const grossLossRSI = Math.abs(lossesRSI.reduce((sum, t) => sum + (t.result?.pnl || 0), 0));
  const netPnlRSI = grossProfitRSI - grossLossRSI;
  const profitFactorRSI = grossLossRSI > 0 ? grossProfitRSI / grossLossRSI : Infinity;

  results.push({
    name: 'RSI Estricto + Filtro Tendencia',
    description: 'RSI < 30/> 70 + Solo trades a favor de EMA20',
    trades: tradesRSIWithTrend.length,
    wins: winsRSI.length,
    losses: lossesRSI.length,
    winRate: tradesRSIWithTrend.length > 0 ? (winsRSI.length / tradesRSIWithTrend.length) * 100 : 0,
    netPnl: netPnlRSI,
    profitFactor: profitFactorRSI === Infinity ? 999 : profitFactorRSI,
    maxDrawdown: 0,
    lossesAgainstTrend: 0,
    lossesAgainstTrendPct: 0,
  });

  // Print results
  console.log('\n' + '═'.repeat(100));
  console.log('RESULTADOS COMPARATIVOS');
  console.log('═'.repeat(100));
  console.log();
  
  console.log('Variante'.padEnd(30) + 
    'Trades'.padStart(8) + 
    'WR%'.padStart(8) + 
    'P&L'.padStart(10) + 
    'PF'.padStart(8) + 
    'Loss vs Trend%'.padStart(15));
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      r.name.padEnd(30) +
      r.trades.toString().padStart(8) +
      r.winRate.toFixed(1).padStart(7) + '%' +
      `$${r.netPnl.toFixed(2)}`.padStart(10) +
      r.profitFactor.toFixed(2).padStart(8) +
      r.lossesAgainstTrendPct.toFixed(1).padStart(14) + '%'
    );
  }

  console.log('\n' + '═'.repeat(100));
  console.log('ANÁLISIS DETALLADO');
  console.log('═'.repeat(100));
  console.log();

  for (const r of results) {
    console.log(`📊 ${r.name}`);
    console.log(`   ${r.description}`);
    console.log(`   Trades: ${r.trades} (${r.wins}W / ${r.losses}L)`);
    console.log(`   Win Rate: ${r.winRate.toFixed(1)}%`);
    console.log(`   Net P&L: $${r.netPnl.toFixed(2)}`);
    console.log(`   Profit Factor: ${r.profitFactor.toFixed(2)}`);
    if (r.lossesAgainstTrendPct > 0) {
      console.log(`   Pérdidas vs tendencia: ${r.lossesAgainstTrendPct.toFixed(1)}%`);
    }
    console.log();
  }

  // Find best variant
  const bestByPnl = results.reduce((best, current) => 
    current.netPnl > best.netPnl ? current : best
  );
  const bestByPF = results.reduce((best, current) => 
    current.profitFactor > best.profitFactor ? current : best
  );
  const bestByWR = results.reduce((best, current) => 
    current.winRate > best.winRate ? current : best
  );

  console.log('═'.repeat(100));
  console.log('MEJORES VARIANTES');
  console.log('═'.repeat(100));
  console.log(`🏆 Mejor P&L: ${bestByPnl.name} ($${bestByPnl.netPnl.toFixed(2)})`);
  console.log(`🏆 Mejor Profit Factor: ${bestByPF.name} (${bestByPF.profitFactor.toFixed(2)})`);
  console.log(`🏆 Mejor Win Rate: ${bestByWR.name} (${bestByWR.winRate.toFixed(1)}%)`);
  console.log();
}

main().catch(console.error);

