#!/usr/bin/env npx tsx
/**
 * Analyze Trend Types - Visual Analysis
 *
 * Detecta y categoriza tendencias para análisis visual:
 * - Tendencias cortas vs largas
 * - Caídas/subidas repentinas vs graduales
 * - Fuerza de la tendencia (pendiente)
 * - Duración en velas
 *
 * Sin backtesting - solo detección y métricas
 */

import * as path from 'path';
import { loadCandlesFromCSV } from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

const ASSET = process.env.ASSET ?? 'R_100';
const DATA_FILE = process.env.DATA_FILE ?? `data/${ASSET}_1m_7d.csv`;

// ============================================================================
// TYPES
// ============================================================================

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: number;
}

interface TrendSegment {
  start: SwingPoint;
  end: SwingPoint;
  direction: 'up' | 'down';

  // Métricas de la tendencia
  duration: number;        // Velas
  priceChange: number;     // Cambio absoluto
  priceChangePct: number;  // Cambio %
  slope: number;           // Pendiente (cambio por vela)
  slopePct: number;        // Pendiente % por vela

  // Categorización
  category: 'impulse' | 'correction' | 'consolidation';
  strength: 'weak' | 'moderate' | 'strong' | 'explosive';
  length: 'micro' | 'short' | 'medium' | 'long';
}

// ============================================================================
// SWING DETECTION
// ============================================================================

function detectSwings(candles: Candle[], depth: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = depth; i < candles.length - depth; i++) {
    const candle = candles[i]!;

    // Check for swing high
    let isSwingHigh = true;
    for (let j = i - depth; j <= i + depth; j++) {
      if (j !== i && candles[j]!.high >= candle.high) {
        isSwingHigh = false;
        break;
      }
    }

    // Check for swing low
    let isSwingLow = true;
    for (let j = i - depth; j <= i + depth; j++) {
      if (j !== i && candles[j]!.low <= candle.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingHigh) {
      swings.push({
        index: i,
        price: candle.high,
        type: 'high',
        timestamp: candle.timestamp,
      });
    }

    if (isSwingLow) {
      swings.push({
        index: i,
        price: candle.low,
        type: 'low',
        timestamp: candle.timestamp,
      });
    }
  }

  // Sort by index and filter alternating highs/lows
  swings.sort((a, b) => a.index - b.index);

  // Filter to ensure alternation
  const filtered: SwingPoint[] = [];
  for (const swing of swings) {
    if (filtered.length === 0) {
      filtered.push(swing);
    } else {
      const last = filtered[filtered.length - 1]!;
      if (last.type !== swing.type) {
        filtered.push(swing);
      } else if (swing.type === 'high' && swing.price > last.price) {
        filtered[filtered.length - 1] = swing;
      } else if (swing.type === 'low' && swing.price < last.price) {
        filtered[filtered.length - 1] = swing;
      }
    }
  }

  return filtered;
}

// ============================================================================
// TREND ANALYSIS
// ============================================================================

function analyzeTrends(swings: SwingPoint[]): TrendSegment[] {
  const trends: TrendSegment[] = [];

  for (let i = 0; i < swings.length - 1; i++) {
    const start = swings[i]!;
    const end = swings[i + 1]!;

    const direction: 'up' | 'down' = end.price > start.price ? 'up' : 'down';
    const duration = end.index - start.index;
    const priceChange = Math.abs(end.price - start.price);
    const priceChangePct = (priceChange / start.price) * 100;
    const slope = priceChange / duration;
    const slopePct = priceChangePct / duration;

    // Categorize by duration
    let length: 'micro' | 'short' | 'medium' | 'long';
    if (duration <= 5) length = 'micro';
    else if (duration <= 15) length = 'short';
    else if (duration <= 40) length = 'medium';
    else length = 'long';

    // Categorize by strength (slope)
    let strength: 'weak' | 'moderate' | 'strong' | 'explosive';
    if (slopePct < 0.02) strength = 'weak';
    else if (slopePct < 0.05) strength = 'moderate';
    else if (slopePct < 0.1) strength = 'strong';
    else strength = 'explosive';

    // Categorize by type
    let category: 'impulse' | 'correction' | 'consolidation';
    if (strength === 'explosive' || (strength === 'strong' && length !== 'micro')) {
      category = 'impulse';
    } else if (strength === 'weak' && duration > 10) {
      category = 'consolidation';
    } else {
      category = 'correction';
    }

    trends.push({
      start,
      end,
      direction,
      duration,
      priceChange,
      priceChangePct,
      slope,
      slopePct,
      category,
      strength,
      length,
    });
  }

  return trends;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              ANÁLISIS DE TIPOS DE TENDENCIAS');
  console.log('              Detección Visual sin Backtesting');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  const dataPath = path.join(process.cwd(), DATA_FILE);
  console.log(`📂 Loading: ${DATA_FILE}`);

  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
  console.log();

  // Detect swings
  console.log('🔍 Detecting swing points...');
  const swings = detectSwings(candles, 5);
  console.log(`   Found ${swings.length} swing points`);
  console.log();

  // Analyze trends
  console.log('📊 Analyzing trend segments...');
  const trends = analyzeTrends(swings);
  console.log(`   Found ${trends.length} trend segments`);
  console.log();

  // =========================================================================
  // STATISTICS BY CATEGORY
  // =========================================================================

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                    ESTADÍSTICAS POR CATEGORÍA');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // By direction
  const upTrends = trends.filter(t => t.direction === 'up');
  const downTrends = trends.filter(t => t.direction === 'down');

  console.log('📈 TENDENCIAS ALCISTAS (UP):');
  console.log(`   Total: ${upTrends.length}`);
  console.log(`   Avg Duration: ${(upTrends.reduce((s, t) => s + t.duration, 0) / upTrends.length).toFixed(1)} velas`);
  console.log(`   Avg Change: ${(upTrends.reduce((s, t) => s + t.priceChangePct, 0) / upTrends.length).toFixed(2)}%`);
  console.log();

  console.log('📉 TENDENCIAS BAJISTAS (DOWN):');
  console.log(`   Total: ${downTrends.length}`);
  console.log(`   Avg Duration: ${(downTrends.reduce((s, t) => s + t.duration, 0) / downTrends.length).toFixed(1)} velas`);
  console.log(`   Avg Change: ${(downTrends.reduce((s, t) => s + t.priceChangePct, 0) / downTrends.length).toFixed(2)}%`);
  console.log();

  // By strength
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('                      POR FUERZA');
  console.log('─────────────────────────────────────────────────────────────────');

  for (const str of ['weak', 'moderate', 'strong', 'explosive'] as const) {
    const filtered = trends.filter(t => t.strength === str);
    const up = filtered.filter(t => t.direction === 'up').length;
    const down = filtered.filter(t => t.direction === 'down').length;
    const avgDur = filtered.length > 0
      ? (filtered.reduce((s, t) => s + t.duration, 0) / filtered.length).toFixed(1)
      : '0';
    const avgChg = filtered.length > 0
      ? (filtered.reduce((s, t) => s + t.priceChangePct, 0) / filtered.length).toFixed(2)
      : '0';

    const emoji = str === 'explosive' ? '💥' : str === 'strong' ? '🔥' : str === 'moderate' ? '📊' : '〰️';
    console.log(`${emoji} ${str.toUpperCase().padEnd(10)}: ${String(filtered.length).padStart(4)} (↑${up} ↓${down}) | Avg: ${avgDur} velas, ${avgChg}%`);
  }
  console.log();

  // By length
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('                      POR DURACIÓN');
  console.log('─────────────────────────────────────────────────────────────────');

  for (const len of ['micro', 'short', 'medium', 'long'] as const) {
    const filtered = trends.filter(t => t.length === len);
    const up = filtered.filter(t => t.direction === 'up').length;
    const down = filtered.filter(t => t.direction === 'down').length;
    const avgChg = filtered.length > 0
      ? (filtered.reduce((s, t) => s + t.priceChangePct, 0) / filtered.length).toFixed(2)
      : '0';

    const ranges = { micro: '≤5', short: '6-15', medium: '16-40', long: '>40' };
    console.log(`📏 ${len.toUpperCase().padEnd(8)} (${ranges[len]} velas): ${String(filtered.length).padStart(4)} (↑${up} ↓${down}) | Avg change: ${avgChg}%`);
  }
  console.log();

  // =========================================================================
  // BEST OPPORTUNITIES (for reversal trading)
  // =========================================================================

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           MEJORES OPORTUNIDADES PARA REVERSIÓN');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Strong/Explosive trends followed by reversal
  console.log('🎯 Tendencias STRONG/EXPLOSIVE (mejores para reversión):');
  console.log();

  const strongTrends = trends.filter(t => t.strength === 'strong' || t.strength === 'explosive');

  // Sort by price change %
  const sortedByChange = [...strongTrends].sort((a, b) => b.priceChangePct - a.priceChangePct);

  console.log('Top 15 por cambio de precio:');
  console.log('Dir | Duration | Change%  | Slope%/bar | Timestamp');
  console.log('────┼──────────┼──────────┼────────────┼──────────────────────');

  sortedByChange.slice(0, 15).forEach(t => {
    const dir = t.direction === 'up' ? '↑  ' : '↓  ';
    const date = new Date(t.start.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16);
    console.log(`${dir} | ${String(t.duration).padStart(8)} | ${t.priceChangePct.toFixed(2).padStart(7)}% | ${t.slopePct.toFixed(3).padStart(10)} | ${date}`);
  });
  console.log();

  // =========================================================================
  // PATTERN ANALYSIS: What follows strong moves?
  // =========================================================================

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('        QUÉ PASA DESPUÉS DE MOVIMIENTOS FUERTES?');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Analyze what happens after strong down moves
  console.log('📉 Después de caídas STRONG/EXPLOSIVE:');
  const strongDowns = trends.filter(t =>
    t.direction === 'down' && (t.strength === 'strong' || t.strength === 'explosive')
  );

  let afterStrongDown = { reversal: 0, continuation: 0, total: 0 };

  for (let i = 0; i < trends.length - 1; i++) {
    const current = trends[i]!;
    const next = trends[i + 1]!;

    if (current.direction === 'down' &&
        (current.strength === 'strong' || current.strength === 'explosive')) {
      afterStrongDown.total++;
      if (next.direction === 'up') {
        afterStrongDown.reversal++;
      } else {
        afterStrongDown.continuation++;
      }
    }
  }

  console.log(`   Total: ${afterStrongDown.total}`);
  console.log(`   Reversión (sube): ${afterStrongDown.reversal} (${(afterStrongDown.reversal/afterStrongDown.total*100).toFixed(1)}%)`);
  console.log(`   Continuación (sigue bajando): ${afterStrongDown.continuation} (${(afterStrongDown.continuation/afterStrongDown.total*100).toFixed(1)}%)`);
  console.log();

  // Analyze what happens after strong up moves
  console.log('📈 Después de subidas STRONG/EXPLOSIVE:');

  let afterStrongUp = { reversal: 0, continuation: 0, total: 0 };

  for (let i = 0; i < trends.length - 1; i++) {
    const current = trends[i]!;
    const next = trends[i + 1]!;

    if (current.direction === 'up' &&
        (current.strength === 'strong' || current.strength === 'explosive')) {
      afterStrongUp.total++;
      if (next.direction === 'down') {
        afterStrongUp.reversal++;
      } else {
        afterStrongUp.continuation++;
      }
    }
  }

  console.log(`   Total: ${afterStrongUp.total}`);
  console.log(`   Reversión (baja): ${afterStrongUp.reversal} (${(afterStrongUp.reversal/afterStrongUp.total*100).toFixed(1)}%)`);
  console.log(`   Continuación (sigue subiendo): ${afterStrongUp.continuation} (${(afterStrongUp.continuation/afterStrongUp.total*100).toFixed(1)}%)`);
  console.log();

  // =========================================================================
  // REVERSAL QUALITY: How strong is the reversal?
  // =========================================================================

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           CALIDAD DE LAS REVERSIONES');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // After strong down, how strong is the bounce?
  console.log('🔄 Fuerza del rebote después de caída STRONG/EXPLOSIVE:');

  const bounceAfterStrongDown: TrendSegment[] = [];
  for (let i = 0; i < trends.length - 1; i++) {
    const current = trends[i]!;
    const next = trends[i + 1]!;

    if (current.direction === 'down' &&
        (current.strength === 'strong' || current.strength === 'explosive') &&
        next.direction === 'up') {
      bounceAfterStrongDown.push(next);
    }
  }

  const bounceStrengthCounts = {
    weak: bounceAfterStrongDown.filter(t => t.strength === 'weak').length,
    moderate: bounceAfterStrongDown.filter(t => t.strength === 'moderate').length,
    strong: bounceAfterStrongDown.filter(t => t.strength === 'strong').length,
    explosive: bounceAfterStrongDown.filter(t => t.strength === 'explosive').length,
  };

  console.log(`   weak: ${bounceStrengthCounts.weak}`);
  console.log(`   moderate: ${bounceStrengthCounts.moderate}`);
  console.log(`   strong: ${bounceStrengthCounts.strong}`);
  console.log(`   explosive: ${bounceStrengthCounts.explosive}`);
  console.log();

  // Average retracement
  console.log('📐 Retroceso promedio después de movimiento fuerte:');

  let retracementData: { original: number; reversal: number }[] = [];

  for (let i = 0; i < trends.length - 1; i++) {
    const current = trends[i]!;
    const next = trends[i + 1]!;

    if ((current.strength === 'strong' || current.strength === 'explosive') &&
        current.direction !== next.direction) {
      retracementData.push({
        original: current.priceChangePct,
        reversal: next.priceChangePct,
      });
    }
  }

  if (retracementData.length > 0) {
    const avgOriginal = retracementData.reduce((s, d) => s + d.original, 0) / retracementData.length;
    const avgReversal = retracementData.reduce((s, d) => s + d.reversal, 0) / retracementData.length;
    const avgRetracementPct = (avgReversal / avgOriginal) * 100;

    console.log(`   Movimiento original promedio: ${avgOriginal.toFixed(2)}%`);
    console.log(`   Reversión promedio: ${avgReversal.toFixed(2)}%`);
    console.log(`   Retroceso promedio: ${avgRetracementPct.toFixed(1)}% del movimiento original`);
  }
  console.log();

  // =========================================================================
  // RECOMMENDATIONS
  // =========================================================================

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                      RECOMENDACIONES');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  const strongDownReversalRate = afterStrongDown.reversal / afterStrongDown.total * 100;
  const strongUpReversalRate = afterStrongUp.reversal / afterStrongUp.total * 100;

  if (strongDownReversalRate > 60) {
    console.log('✅ Las caídas fuertes tienen alta tasa de reversión (' + strongDownReversalRate.toFixed(0) + '%)');
    console.log('   → Buen escenario para entradas CALL después de caídas explosivas');
  }

  if (strongUpReversalRate > 60) {
    console.log('✅ Las subidas fuertes tienen alta tasa de reversión (' + strongUpReversalRate.toFixed(0) + '%)');
    console.log('   → Buen escenario para entradas PUT después de subidas explosivas');
  }

  console.log();
  console.log('💡 Filtros sugeridos para la estrategia:');
  console.log('   1. Solo operar después de movimientos STRONG o EXPLOSIVE');
  console.log('   2. Esperar confirmación (vela de reversión)');
  console.log('   3. Usar el slope (%/vela) como indicador de fuerza');
  console.log();

  // =========================================================================
  // SAMPLE TRENDS FOR VISUAL INSPECTION
  // =========================================================================

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('             EJEMPLOS DE TENDENCIAS PARA INSPECCIÓN');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  console.log('🔥 5 mejores caídas EXPLOSIVE seguidas de rebote:');
  console.log();

  const explosiveDownsWithBounce: Array<{ down: TrendSegment; bounce: TrendSegment }> = [];

  for (let i = 0; i < trends.length - 1; i++) {
    const current = trends[i]!;
    const next = trends[i + 1]!;

    if (current.direction === 'down' &&
        current.strength === 'explosive' &&
        next.direction === 'up') {
      explosiveDownsWithBounce.push({ down: current, bounce: next });
    }
  }

  explosiveDownsWithBounce
    .sort((a, b) => b.down.priceChangePct - a.down.priceChangePct)
    .slice(0, 5)
    .forEach((pair, idx) => {
      const startDate = new Date(pair.down.start.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16);
      const endDate = new Date(pair.down.end.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16);
      const bounceEnd = new Date(pair.bounce.end.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16);

      console.log(`${idx + 1}. Caída: ${startDate} → ${endDate}`);
      console.log(`   Precio: ${pair.down.start.price.toFixed(2)} → ${pair.down.end.price.toFixed(2)} (-${pair.down.priceChangePct.toFixed(2)}%)`);
      console.log(`   Duración: ${pair.down.duration} velas, Slope: ${pair.down.slopePct.toFixed(3)}%/vela`);
      console.log(`   Rebote: +${pair.bounce.priceChangePct.toFixed(2)}% en ${pair.bounce.duration} velas`);
      console.log(`   Retroceso: ${(pair.bounce.priceChangePct / pair.down.priceChangePct * 100).toFixed(0)}%`);
      console.log();
    });

  console.log('✅ Análisis completo!');
}

main().catch(console.error);
