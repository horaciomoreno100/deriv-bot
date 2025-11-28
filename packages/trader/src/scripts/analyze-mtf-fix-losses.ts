#!/usr/bin/env tsx
/**
 * Análisis Profundo para ARREGLAR Pérdidas - MTF Levels Strategy
 * 
 * No filtrar, sino entender qué está mal y cómo arreglarlo
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
} from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';

interface DetailedLoss {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  tpPrice: number;
  slPrice: number;
  pnl: number;
  barsHeld: number;
  exitReason: string;
  
  // Entry conditions
  levelType: 'high' | 'low';
  levelPrice: number;
  levelStrength: number;
  distanceToLevel: number; // % desde precio al nivel
  rsi: number;
  atr: number;
  trend5m: string;
  trend15m: string;
  
  // Price action during trade
  maxFavorablePct: number; // % máximo a favor
  maxAdversePct: number;   // % máximo en contra
  reachedTP: boolean;
  reachedSL: boolean;
  priceAtBar1: number;
  priceAtBar2: number;
  priceAtBar3: number;
  
  // What went wrong
  againstTrend: boolean;
  levelBreakdown: boolean; // El nivel se rompió (precio pasó el nivel)
  falseBounce: boolean;    // No hubo bounce real
  tooFarFromLevel: boolean;
  
  timestamp: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS PARA ARREGLAR PÉRDIDAS - MTF Levels Strategy');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data: ${DATA_FILE}\n`);

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    process.exit(1);
  }

  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`✅ Cargadas ${candles.length} velas\n`);

  // Run backtest
  const strategy = createMTFLevelsStrategy(ASSET, {
    requireTrendAlignment: false,
    allowedDirection: 'both',
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationMinMove: 0.2,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
  });

  console.log('🔄 Ejecutando backtest...\n');
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');
  const wins = trades.filter(t => t.result?.outcome === 'WIN');

  console.log(`Total: ${trades.length} trades, ${losses.length} pérdidas, ${wins.length} wins\n`);

  // Build detailed loss analysis
  const detailedLosses: DetailedLoss[] = [];

  for (const trade of losses) {
    const entry = trade.entry;
    const exit = trade.exit;
    const indicators = entry?.snapshot?.indicators || {};
    
    if (!entry || !exit) continue;

    const entryIndex = entry.snapshot.candle?.index || 0;
    const exitIndex = exit.snapshot.candle?.index || entryIndex;
    const barsHeld = Math.ceil((exit.durationMs || 0) / (60 * 1000));
    
    const levelPrice = (indicators.nearestLevel as number) || entry.executedPrice;
    const distanceToLevel = Math.abs(entry.executedPrice - levelPrice) / entry.executedPrice * 100;
    
    const levelType = (indicators.levelType as 'high' | 'low') || 'low';
    const trend5m = (indicators.trend5m as string) || 'sideways';
    const trend15m = (indicators.trend15m as string) || 'sideways';
    
    // Check if against trend
    const againstTrend = 
      (trade.direction === 'CALL' && (trend15m === 'down' || trend5m === 'down')) ||
      (trade.direction === 'PUT' && (trend15m === 'up' || trend5m === 'up'));
    
    // Check if level broke down
    let levelBreakdown = false;
    if (trade.direction === 'CALL' && levelType === 'low') {
      // Support broke - price went below level
      for (let i = entryIndex; i <= Math.min(entryIndex + barsHeld, candles.length - 1); i++) {
        if (candles[i]!.low < levelPrice * 0.999) {
          levelBreakdown = true;
          break;
        }
      }
    } else if (trade.direction === 'PUT' && levelType === 'high') {
      // Resistance broke - price went above level
      for (let i = entryIndex; i <= Math.min(entryIndex + barsHeld, candles.length - 1); i++) {
        if (candles[i]!.high > levelPrice * 1.001) {
          levelBreakdown = true;
          break;
        }
      }
    }
    
    // Check price action in first few bars
    const priceAtBar1 = entryIndex + 1 < candles.length ? candles[entryIndex + 1]!.close : entry.executedPrice;
    const priceAtBar2 = entryIndex + 2 < candles.length ? candles[entryIndex + 2]!.close : entry.executedPrice;
    const priceAtBar3 = entryIndex + 3 < candles.length ? candles[entryIndex + 3]!.close : entry.executedPrice;
    
    // False bounce: price didn't bounce, kept going against us
    let falseBounce = false;
    if (trade.direction === 'CALL') {
      // Should bounce up, but went down
      falseBounce = priceAtBar1 < entry.executedPrice && priceAtBar2 < priceAtBar1;
    } else {
      // Should bounce down, but went up
      falseBounce = priceAtBar1 > entry.executedPrice && priceAtBar2 > priceAtBar1;
    }
    
    const maxFavorablePct = trade.result?.maxFavorablePct || 0;
    const maxAdversePct = Math.abs(trade.result?.maxAdversePct || 0);
    
    const reachedTP = maxFavorablePct >= 0.5 * 100; // 0.5% is TP
    const reachedSL = exit.reason === 'SL';
    
    detailedLosses.push({
      direction: trade.direction,
      entryPrice: entry.executedPrice,
      exitPrice: exit.executedPrice,
      tpPrice: entry.tpPrice,
      slPrice: entry.slPrice,
      pnl: trade.result?.pnl || 0,
      barsHeld,
      exitReason: exit.reason || 'UNKNOWN',
      levelType,
      levelPrice,
      levelStrength: (indicators.levelStrength as number) || 0,
      distanceToLevel,
      rsi: (indicators.rsi as number) || 50,
      atr: (indicators.atr as number) || 0,
      trend5m,
      trend15m,
      maxFavorablePct,
      maxAdversePct,
      reachedTP,
      reachedSL,
      priceAtBar1,
      priceAtBar2,
      priceAtBar3,
      againstTrend,
      levelBreakdown,
      falseBounce,
      tooFarFromLevel: distanceToLevel > 0.2, // >0.2% from level
      timestamp: entry.snapshot.timestamp,
    });
  }

  // ============================================================================
  // ANÁLISIS: ¿POR QUÉ PUT FALLA MÁS QUE CALL?
  // ============================================================================
  console.log('='.repeat(80));
  console.log('🔍 ANÁLISIS: ¿POR QUÉ PUT FALLA MÁS QUE CALL?');
  console.log('='.repeat(80));
  
  const callLosses = detailedLosses.filter(l => l.direction === 'CALL');
  const putLosses = detailedLosses.filter(l => l.direction === 'PUT');
  
  const callWins = wins.filter(w => w.direction === 'CALL');
  const putWins = wins.filter(w => w.direction === 'PUT');
  
  console.log(`CALL: ${callWins.length} wins, ${callLosses.length} losses (WR: ${((callWins.length / (callWins.length + callLosses.length)) * 100).toFixed(1)}%)`);
  console.log(`PUT:  ${putWins.length} wins, ${putLosses.length} losses (WR: ${((putWins.length / (putWins.length + putLosses.length)) * 100).toFixed(1)}%)\n`);
  
  // Compare entry conditions
  console.log('Condiciones de entrada:');
  console.log(`CALL - Avg RSI: ${(callLosses.reduce((s, l) => s + l.rsi, 0) / callLosses.length).toFixed(1)}`);
  console.log(`PUT  - Avg RSI: ${(putLosses.reduce((s, l) => s + l.rsi, 0) / putLosses.length).toFixed(1)}`);
  console.log(`CALL - Avg distance to level: ${(callLosses.reduce((s, l) => s + l.distanceToLevel, 0) / callLosses.length).toFixed(3)}%`);
  console.log(`PUT  - Avg distance to level: ${(putLosses.reduce((s, l) => s + l.distanceToLevel, 0) / putLosses.length).toFixed(3)}%\n`);
  
  // Compare what went wrong
  console.log('¿Qué salió mal?');
  const callFalseBounce = callLosses.filter(l => l.falseBounce).length;
  const putFalseBounce = putLosses.filter(l => l.falseBounce).length;
  console.log(`CALL - False bounces: ${callFalseBounce} (${((callFalseBounce / callLosses.length) * 100).toFixed(1)}%)`);
  console.log(`PUT  - False bounces: ${putFalseBounce} (${((putFalseBounce / putLosses.length) * 100).toFixed(1)}%)\n`);
  
  const callLevelBreak = callLosses.filter(l => l.levelBreakdown).length;
  const putLevelBreak = putLosses.filter(l => l.levelBreakdown).length;
  console.log(`CALL - Level breakdown: ${callLevelBreak} (${((callLevelBreak / callLosses.length) * 100).toFixed(1)}%)`);
  console.log(`PUT  - Level breakdown: ${putLevelBreak} (${((putLevelBreak / putLosses.length) * 100).toFixed(1)}%)\n`);
  
  // Compare price action
  console.log('Comportamiento del precio:');
  const callReachedTP = callLosses.filter(l => l.reachedTP).length;
  const putReachedTP = putLosses.filter(l => l.reachedTP).length;
  console.log(`CALL - Llegó a TP pero perdió: ${callReachedTP} (${((callReachedTP / callLosses.length) * 100).toFixed(1)}%)`);
  console.log(`PUT  - Llegó a TP pero perdió: ${putReachedTP} (${((putReachedTP / putLosses.length) * 100).toFixed(1)}%)\n`);
  
  const callAvgBars = callLosses.reduce((s, l) => s + l.barsHeld, 0) / callLosses.length;
  const putAvgBars = putLosses.reduce((s, l) => s + l.barsHeld, 0) / putLosses.length;
  console.log(`CALL - Avg bars held: ${callAvgBars.toFixed(1)}`);
  console.log(`PUT  - Avg bars held: ${putAvgBars.toFixed(1)}\n`);

  // ============================================================================
  // ANÁLISIS: TRADES CONTRA TENDENCIA
  // ============================================================================
  console.log('='.repeat(80));
  console.log('🔍 ANÁLISIS: TRADES CONTRA TENDENCIA');
  console.log('='.repeat(80));
  
  const againstTrendLosses = detailedLosses.filter(l => l.againstTrend);
  const withTrendLosses = detailedLosses.filter(l => !l.againstTrend);
  
  console.log(`Contra tendencia: ${againstTrendLosses.length} pérdidas (${((againstTrendLosses.length / detailedLosses.length) * 100).toFixed(1)}%)`);
  console.log(`Con tendencia: ${withTrendLosses.length} pérdidas (${((withTrendLosses.length / detailedLosses.length) * 100).toFixed(1)}%)\n`);
  
  console.log('¿Qué pasa cuando vamos contra tendencia?');
  const atFalseBounce = againstTrendLosses.filter(l => l.falseBounce).length;
  const wtFalseBounce = withTrendLosses.filter(l => l.falseBounce).length;
  console.log(`Contra tendencia - False bounces: ${atFalseBounce} (${((atFalseBounce / againstTrendLosses.length) * 100).toFixed(1)}%)`);
  console.log(`Con tendencia - False bounces: ${wtFalseBounce} (${((wtFalseBounce / withTrendLosses.length) * 100).toFixed(1)}%)\n`);
  
  const atLevelBreak = againstTrendLosses.filter(l => l.levelBreakdown).length;
  const wtLevelBreak = withTrendLosses.filter(l => l.levelBreakdown).length;
  console.log(`Contra tendencia - Level breakdown: ${atLevelBreak} (${((atLevelBreak / againstTrendLosses.length) * 100).toFixed(1)}%)`);
  console.log(`Con tendencia - Level breakdown: ${wtLevelBreak} (${((wtLevelBreak / withTrendLosses.length) * 100).toFixed(1)}%)\n`);
  
  const atAvgBars = againstTrendLosses.reduce((s, l) => s + l.barsHeld, 0) / againstTrendLosses.length;
  const wtAvgBars = withTrendLosses.reduce((s, l) => s + l.barsHeld, 0) / withTrendLosses.length;
  console.log(`Contra tendencia - Avg bars held: ${atAvgBars.toFixed(1)}`);
  console.log(`Con tendencia - Avg bars held: ${wtAvgBars.toFixed(1)}\n`);

  // ============================================================================
  // ANÁLISIS: TIMEOUT (71.8% de pérdidas)
  // ============================================================================
  console.log('='.repeat(80));
  console.log('🔍 ANÁLISIS: TIMEOUT (71.8% de pérdidas)');
  console.log('='.repeat(80));
  
  const timeoutLosses = detailedLosses.filter(l => l.exitReason === 'TIMEOUT');
  const slLosses = detailedLosses.filter(l => l.exitReason === 'SL');
  
  console.log(`Timeout: ${timeoutLosses.length} pérdidas`);
  console.log(`Stop Loss: ${slLosses.length} pérdidas\n`);
  
  console.log('Comportamiento en pérdidas por timeout:');
  const timeoutReachedTP = timeoutLosses.filter(l => l.reachedTP).length;
  console.log(`Llegaron a TP pero no cerraron: ${timeoutReachedTP} (${((timeoutReachedTP / timeoutLosses.length) * 100).toFixed(1)}%)\n`);
  
  const timeoutAvgMaxFav = timeoutLosses.reduce((s, l) => s + l.maxFavorablePct, 0) / timeoutLosses.length;
  const timeoutAvgMaxAdv = timeoutLosses.reduce((s, l) => s + l.maxAdversePct, 0) / timeoutLosses.length;
  console.log(`Avg max favorable: ${timeoutAvgMaxFav.toFixed(2)}%`);
  console.log(`Avg max adverse: ${timeoutAvgMaxAdv.toFixed(2)}%\n`);
  
  const timeoutAvgBars = timeoutLosses.reduce((s, l) => s + l.barsHeld, 0) / timeoutLosses.length;
  console.log(`Avg bars held: ${timeoutAvgBars.toFixed(1)} (max: ${Math.max(...timeoutLosses.map(l => l.barsHeld))})\n`);
  
  // Analyze if TP is too far
  const timeoutCloseToTP = timeoutLosses.filter(l => l.maxFavorablePct >= 0.4 * 100).length; // >40% of TP
  console.log(`Llegaron a >40% del TP: ${timeoutCloseToTP} (${((timeoutCloseToTP / timeoutLosses.length) * 100).toFixed(1)}%)\n`);

  // ============================================================================
  // ANÁLISIS: FALSE BOUNCES
  // ============================================================================
  console.log('='.repeat(80));
  console.log('🔍 ANÁLISIS: FALSE BOUNCES (no hubo rebote real)');
  console.log('='.repeat(80));
  
  const falseBounceLosses = detailedLosses.filter(l => l.falseBounce);
  console.log(`False bounces: ${falseBounceLosses.length} (${((falseBounceLosses.length / detailedLosses.length) * 100).toFixed(1)}%)\n`);
  
  console.log('Características de false bounces:');
  const fbAvgRSI = falseBounceLosses.reduce((s, l) => s + l.rsi, 0) / falseBounceLosses.length;
  console.log(`Avg RSI: ${fbAvgRSI.toFixed(1)}\n`);
  
  const fbAgainstTrend = falseBounceLosses.filter(l => l.againstTrend).length;
  console.log(`Contra tendencia: ${fbAgainstTrend} (${((fbAgainstTrend / falseBounceLosses.length) * 100).toFixed(1)}%)\n`);
  
  const fbLevelBreak = falseBounceLosses.filter(l => l.levelBreakdown).length;
  console.log(`Level breakdown: ${fbLevelBreak} (${((fbLevelBreak / falseBounceLosses.length) * 100).toFixed(1)}%)\n`);

  // ============================================================================
  // ANÁLISIS: LEVEL BREAKDOWN
  // ============================================================================
  console.log('='.repeat(80));
  console.log('🔍 ANÁLISIS: LEVEL BREAKDOWN (el nivel se rompió)');
  console.log('='.repeat(80));
  
  const levelBreakLosses = detailedLosses.filter(l => l.levelBreakdown);
  console.log(`Level breakdowns: ${levelBreakLosses.length} (${((levelBreakLosses.length / detailedLosses.length) * 100).toFixed(1)}%)\n`);
  
  console.log('Características:');
  const lbAvgStrength = levelBreakLosses.reduce((s, l) => s + l.levelStrength, 0) / levelBreakLosses.length;
  console.log(`Avg level strength: ${lbAvgStrength.toFixed(1)} (1=5m, 2=15m, 3=both)\n`);
  
  const lbAgainstTrend = levelBreakLosses.filter(l => l.againstTrend).length;
  console.log(`Contra tendencia: ${lbAgainstTrend} (${((lbAgainstTrend / levelBreakLosses.length) * 100).toFixed(1)}%)\n`);

  // ============================================================================
  // PROPUESTAS DE SOLUCIÓN
  // ============================================================================
  console.log('='.repeat(80));
  console.log('💡 PROPUESTAS DE SOLUCIÓN');
  console.log('='.repeat(80));
  
  const solutions: string[] = [];
  
  // PUT problem
  if (putLosses.length > callLosses.length * 1.2) {
    solutions.push(`1. PUT tiene más pérdidas que CALL:`);
    solutions.push(`   - PUT tiene ${((putFalseBounce / putLosses.length) * 100).toFixed(1)}% false bounces vs CALL ${((callFalseBounce / callLosses.length) * 100).toFixed(1)}%`);
    solutions.push(`   - SOLUCIÓN: Aumentar confirmationBars para PUT o requerir confirmación más fuerte`);
    solutions.push(`   - SOLUCIÓN: Verificar que el nivel de resistencia sea más fuerte antes de entrar PUT`);
    solutions.push('');
  }
  
  // Against trend
  if (againstTrendLosses.length > detailedLosses.length * 0.3) {
    solutions.push(`2. ${((againstTrendLosses.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas son contra tendencia:`);
    solutions.push(`   - False bounce rate: ${((atFalseBounce / againstTrendLosses.length) * 100).toFixed(1)}% vs ${((wtFalseBounce / withTrendLosses.length) * 100).toFixed(1)}% con tendencia`);
    solutions.push(`   - SOLUCIÓN: Aumentar confirmationMinMove cuando vamos contra tendencia`);
    solutions.push(`   - SOLUCIÓN: Requerir nivel más fuerte (strength >= 2) cuando vamos contra tendencia`);
    solutions.push(`   - SOLUCIÓN: Usar TP/SL más ajustados cuando vamos contra tendencia`);
    solutions.push('');
  }
  
  // Timeout
  if (timeoutLosses.length > detailedLosses.length * 0.6) {
    solutions.push(`3. ${((timeoutLosses.length / detailedLosses.length) * 100).toFixed(1)}% de pérdidas son por timeout:`);
    solutions.push(`   - ${((timeoutCloseToTP / timeoutLosses.length) * 100).toFixed(1)}% llegaron a >40% del TP`);
    solutions.push(`   - SOLUCIÓN: Reducir TP a 0.4% o 0.35% para cerrar más rápido`);
    solutions.push(`   - SOLUCIÓN: Implementar trailing stop después de alcanzar 50% del TP`);
    solutions.push(`   - SOLUCIÓN: Reducir maxBarsInTrade para cerrar trades que no avanzan`);
    solutions.push('');
  }
  
  // False bounces
  if (falseBounceLosses.length > detailedLosses.length * 0.2) {
    solutions.push(`4. ${((falseBounceLosses.length / detailedLosses.length) * 100).toFixed(1)}% son false bounces:`);
    solutions.push(`   - ${((fbAgainstTrend / falseBounceLosses.length) * 100).toFixed(1)}% son contra tendencia`);
    solutions.push(`   - SOLUCIÓN: Aumentar confirmationBars de 1 a 2 para verificar bounce real`);
    solutions.push(`   - SOLUCIÓN: Verificar que precio realmente tocó el nivel (no solo cerca)`);
    solutions.push(`   - SOLUCIÓN: Requerir que la vela de confirmación tenga cuerpo fuerte`);
    solutions.push('');
  }
  
  // Level breakdown
  if (levelBreakLosses.length > detailedLosses.length * 0.15) {
    solutions.push(`5. ${((levelBreakLosses.length / detailedLosses.length) * 100).toFixed(1)}% tienen level breakdown:`);
    solutions.push(`   - Avg strength: ${lbAvgStrength.toFixed(1)} (niveles débiles se rompen más)`);
    solutions.push(`   - SOLUCIÓN: Filtrar niveles con strength < 2 (solo niveles de 15m o ambos)`);
    solutions.push(`   - SOLUCIÓN: Usar SL más ajustado cuando el nivel se rompe`);
    solutions.push('');
  }
  
  if (solutions.length === 0) {
    console.log('No se identificaron problemas específicos.');
  } else {
    solutions.forEach(s => console.log(s));
  }
  
  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

main().catch(console.error);

