#!/usr/bin/env tsx
/**
 * Análisis Detallado de Entradas - MTF Levels Strategy
 * 
 * Muestra todas las condiciones que se cumplieron para cada entrada
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '1', 10);

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS DETALLADO DE ENTRADAS - MTF Levels Strategy');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data: ${DATA_FILE}`);
  console.log(`Días a analizar: ${DAYS_TO_ANALYZE}\n`);

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    process.exit(1);
  }

  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`✅ Cargadas ${allCandles.length} velas totales\n`);

  // Get first N days of data
  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_ANALYZE * oneDaySeconds);
  
  const candles = allCandles.filter(c => {
    return c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime;
  });
  
  const firstDate = new Date(firstCandleTime * 1000);
  const lastDate = new Date(lastCandleTime * 1000);
  console.log(`📅 Período: ${firstDate.toISOString().split('T')[0]} ${firstDate.toISOString().split('T')[1]!.slice(0, 5)} UTC`);
  console.log(`   Hasta: ${lastDate.toISOString().split('T')[0]} ${lastDate.toISOString().split('T')[1]!.slice(0, 5)} UTC`);
  console.log(`   Velas filtradas: ${candles.length} de ${allCandles.length} totales\n`);

  // Run backtest with IMPROVED v3 config (con filtro BB)
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
    requireBBBand: true,  // MEJORA: Filtro de Bollinger Bands
    bbBandTolerance: 0.15, // 15% del ancho de banda
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  });

  console.log('🔄 Ejecutando backtest...\n');
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  console.log(`Total trades: ${trades.length}\n`);

  // Analyze each entry in detail
  console.log('='.repeat(80));
  console.log('ANÁLISIS DETALLADO DE CADA ENTRADA');
  console.log('='.repeat(80));
  console.log('');

  for (let i = 0; i < Math.min(10, trades.length); i++) {
    const trade = trades[i]!;
    const entry = trade.entry;
    const exit = trade.exit;
    const signal = trade.signal;
    const indicators = entry.snapshot.indicators || {};
    
    const entryTime = new Date(entry.snapshot.timestamp);
    const exitTime = exit ? new Date(exit.snapshot.timestamp) : null;
    const outcome = trade.result?.outcome || 'UNKNOWN';
    const pnl = trade.result?.pnl || 0;
    
    console.log(`${'='.repeat(80)}`);
    console.log(`ENTRADA #${i + 1} - ${trade.direction} - ${outcome === 'WIN' ? '✅ WIN' : '❌ LOSS'}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Fecha/Hora: ${entryTime.toISOString().replace('T', ' ').slice(0, 19)} UTC`);
    console.log(`Dirección: ${trade.direction}`);
    console.log(`Precio entrada: $${entry.executedPrice.toFixed(2)}`);
    console.log(`TP: $${entry.tpPrice.toFixed(2)} (${(entry.tpPct * 100).toFixed(2)}%)`);
    console.log(`SL: $${entry.slPrice.toFixed(2)} (${(entry.slPct * 100).toFixed(2)}%)`);
    
    if (exit) {
      console.log(`Precio salida: $${exit.executedPrice.toFixed(2)}`);
      console.log(`Razón salida: ${exit.reason}`);
      const barsHeld = Math.ceil((exit.durationMs || 0) / (60 * 1000));
      console.log(`Barras mantenidas: ${barsHeld}`);
    }
    
    console.log(`PnL: $${pnl.toFixed(2)}`);
    console.log(`Confianza: ${signal.confidence}%`);
    console.log('');

    // Market conditions at entry
    console.log('📊 CONDICIONES DE MERCADO EN LA ENTRADA:');
    console.log(`  RSI: ${(indicators.rsi as number)?.toFixed(2) || 'N/A'}`);
    console.log(`  ATR: ${(indicators.atr as number)?.toFixed(2) || 'N/A'}`);
    
    // Bollinger Bands
    const bbUpper = indicators.bbUpper as number | undefined;
    const bbLower = indicators.bbLower as number | undefined;
    const bbMiddle = indicators.bbMiddle as number | undefined;
    
    if (bbUpper && bbLower && bbMiddle) {
      const bbWidth = bbUpper - bbLower;
      const bbWidthPct = (bbWidth / bbMiddle) * 100;
      const pricePos = ((entry.executedPrice - bbLower) / bbWidth) * 100;
      
      console.log(`  BB Upper: $${bbUpper.toFixed(2)}`);
      console.log(`  BB Middle: $${bbMiddle.toFixed(2)}`);
      console.log(`  BB Lower: $${bbLower.toFixed(2)}`);
      console.log(`  BB Width: $${bbWidth.toFixed(2)} (${bbWidthPct.toFixed(2)}%)`);
      console.log(`  Precio posición en BB: ${pricePos.toFixed(1)}% (0% = banda baja, 100% = banda alta)`);
      
      // Verificar si pasó el filtro BB
      const tolerance = 0.15 * bbWidth;
      if (trade.direction === 'CALL') {
        const distanceFromLower = entry.executedPrice - bbLower;
        const inLowerBand = distanceFromLower <= tolerance;
        console.log(`  ✅ Filtro BB CALL: ${inLowerBand ? 'PASÓ' : 'NO PASÓ'} (distancia desde banda baja: $${distanceFromLower.toFixed(2)}, tolerancia: $${tolerance.toFixed(2)})`);
      } else {
        const distanceFromUpper = bbUpper - entry.executedPrice;
        const inUpperBand = distanceFromUpper <= tolerance;
        console.log(`  ✅ Filtro BB PUT: ${inUpperBand ? 'PASÓ' : 'NO PASÓ'} (distancia desde banda alta: $${distanceFromUpper.toFixed(2)}, tolerancia: $${tolerance.toFixed(2)})`);
      }
    }
    console.log('');

    // MTF Context
    console.log('📈 CONTEXTO MULTI-TIMEFRAME:');
    const trend5m = indicators.trend5m as string | undefined;
    const trend15m = indicators.trend15m as string | undefined;
    const levelType = indicators.levelType as string | undefined;
    const levelPrice = indicators.nearestLevel as number | undefined;
    const levelStrength = indicators.levelStrength as number | undefined;
    
    console.log(`  Tendencia 5m: ${trend5m || 'N/A'}`);
    console.log(`  Tendencia 15m: ${trend15m || 'N/A'}`);
    
    // Check if against trend
    const againstTrend = 
      (trade.direction === 'CALL' && (trend15m === 'down' || trend5m === 'down')) ||
      (trade.direction === 'PUT' && (trend15m === 'up' || trend5m === 'up'));
    
    console.log(`  ⚠️  Contra tendencia: ${againstTrend ? 'SÍ' : 'NO'}`);
    
    if (levelType && levelPrice) {
      console.log(`  Nivel detectado: ${levelType === 'low' ? 'Support' : 'Resistance'} @ $${levelPrice.toFixed(2)}`);
      console.log(`  Fuerza del nivel: ${levelStrength} (1=5m, 2=15m, 3=ambos)`);
      const distanceToLevel = Math.abs(entry.executedPrice - levelPrice);
      const distancePct = (distanceToLevel / entry.executedPrice) * 100;
      console.log(`  Distancia al nivel: $${distanceToLevel.toFixed(2)} (${distancePct.toFixed(3)}%)`);
    }
    console.log('');

    // Entry reason
    console.log('💡 RAZÓN DE ENTRADA:');
    console.log(`  ${signal.reason || 'N/A'}`);
    console.log('');

    // Price action after entry
    if (exit) {
      const entryIndex = entry.snapshot.candle?.index || 0;
      const exitIndex = exit.snapshot.candle?.index || entryIndex;
      const maxFavorablePct = trade.result?.maxFavorablePct || 0;
      const maxAdversePct = Math.abs(trade.result?.maxAdversePct || 0);
      
      console.log('📉 COMPORTAMIENTO DEL TRADE:');
      console.log(`  Max favorable: ${maxFavorablePct.toFixed(2)}%`);
      console.log(`  Max adverso: ${maxAdversePct.toFixed(2)}%`);
      
      // Show price action in first few bars
      console.log(`  Precio en las primeras 3 velas después de entrada:`);
      for (let j = 1; j <= 3 && entryIndex + j < candles.length; j++) {
        const futureCandle = candles[entryIndex + j]!;
        const priceChange = trade.direction === 'CALL' 
          ? ((futureCandle.close - entry.executedPrice) / entry.executedPrice) * 100
          : ((entry.executedPrice - futureCandle.close) / entry.executedPrice) * 100;
        const color = priceChange >= 0 ? '✅' : '❌';
        console.log(`    Vela ${j}: $${futureCandle.close.toFixed(2)} (${color} ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%)`);
      }
      console.log('');
    }

    // Analysis
    console.log('🔍 ANÁLISIS:');
    if (outcome === 'LOSS') {
      if (bbUpper && bbLower) {
        if (trade.direction === 'CALL' && entry.executedPrice > bbMiddle!) {
          console.log(`  ⚠️  CALL tomado pero precio estaba por encima de BB Middle`);
        }
        if (trade.direction === 'PUT' && entry.executedPrice < bbMiddle!) {
          console.log(`  ⚠️  PUT tomado pero precio estaba por debajo de BB Middle`);
        }
      }
      
      if (againstTrend) {
        console.log(`  ⚠️  Trade contra tendencia - puede explicar la pérdida`);
      }
      
      if (levelStrength && levelStrength < 2) {
        console.log(`  ⚠️  Nivel débil (solo 5m) - puede no ser un nivel fuerte`);
      }
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

