/**
 * Deep Loss Analysis - BB Squeeze Strategy
 *
 * Investigates FALSE BREAKOUTS en detalle:
 * - ¿Cuánto tiempo tarda en hit SL?
 * - ¿Qué precio máximo/mínimo alcanza antes de perder?
 * - ¿Cuánto del TP alcanzó antes de reversar?
 *
 * NO usa Grademark - implementación manual para rastrear cada candle
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

/**
 * Configuration
 */
const BACKTEST_DIR = './backtest-data';
const SYMBOL = process.env.SYMBOL || 'R_75';
const BACKTEST_DAYS = parseInt(process.env.BACKTEST_DAYS || '30', 10);

/**
 * Strategy Parameters (R_75 optimized)
 */
const PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 2.0,
  rsiPeriod: 14,
  takeProfitPct: 0.004, // 0.4%
  stopLossPct: 0.002,   // 0.2%
  minCandles: 50,
};

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Indicators {
  bb: { upper: number; middle: number; lower: number } | null;
  kc: { upper: number; middle: number; lower: number } | null;
  rsi: number | null;
}

interface TradeResult {
  id: number;
  direction: 'LONG' | 'SHORT';
  entryTime: number;
  entryPrice: number;
  entryRSI: number;

  exitTime: number;
  exitPrice: number;
  exitReason: 'TP' | 'SL';

  profit: number;
  profitPct: number;

  // FALSE BREAKOUT METRICS
  barsHeld: number;
  bestPrice: number;          // Mejor precio alcanzado a favor
  bestPricePct: number;       // % del TP alcanzado
  worstPrice: number;         // Peor precio (cuando hitea SL)

  immediateReversal: boolean; // Hit SL en 1-3 candles
  nearMiss: boolean;          // Llegó a >50% del TP

  // SQUEEZE DURATION METRICS
  squeezeDuration: number;    // Cuántos candles en squeeze antes del breakout
  atrAtEntry: number;         // ATR al momento de entrada (volatilidad)
  hourOfDay: number;          // Hora del día (0-23)
  dayOfWeek: number;          // Día de semana (0=Sun, 6=Sat)
}

/**
 * Calculate EMA
 */
function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];

  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emaArray.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }

  return emaArray;
}

/**
 * Calculate indicators for current window
 */
function calculateIndicators(candles: Candle[], index: number): Indicators {
  if (index < PARAMS.minCandles) {
    return { bb: null, kc: null, rsi: null };
  }

  const window = candles.slice(Math.max(0, index - PARAMS.bbPeriod - 10), index + 1);
  const closes = window.map(c => c.close);
  const highs = window.map(c => c.high);
  const lows = window.map(c => c.low);

  // BB
  const bbResult = BollingerBands.calculate({
    period: PARAMS.bbPeriod,
    values: closes,
    stdDev: PARAMS.bbStdDev,
  });

  // KC (EMA + ATR)
  const ema = calculateEMA(closes, PARAMS.kcPeriod);
  const atrValues = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: PARAMS.kcPeriod,
  });

  // RSI
  const rsiValues = RSI.calculate({
    period: PARAMS.rsiPeriod,
    values: closes,
  });

  if (!bbResult || bbResult.length === 0 || !atrValues || atrValues.length === 0 || !rsiValues || rsiValues.length === 0) {
    return { bb: null, kc: null, rsi: null };
  }

  const bb = bbResult[bbResult.length - 1];
  const atr = atrValues[atrValues.length - 1];
  const kcMiddle = ema[ema.length - 1];
  const rsi = rsiValues[rsiValues.length - 1];

  return {
    bb: bb ? { upper: bb.upper, middle: bb.middle, lower: bb.lower } : null,
    kc: atr ? {
      upper: kcMiddle + atr * PARAMS.kcMultiplier,
      middle: kcMiddle,
      lower: kcMiddle - atr * PARAMS.kcMultiplier,
    } : null,
    rsi: rsi || null,
  };
}

/**
 * Check for squeeze in recent bars and return duration
 */
function getSqueezeInfo(candles: Candle[], currentIndex: number): { hadSqueeze: boolean; duration: number } {
  if (currentIndex < 10) return { hadSqueeze: false, duration: 0 };

  let squeezeDuration = 0;
  let foundSqueeze = false;

  // Look back up to 20 candles to find squeeze duration
  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 20); i--) {
    const indicators = calculateIndicators(candles, i);
    if (indicators.bb && indicators.kc) {
      const inSqueeze = indicators.bb.upper < indicators.kc.upper &&
                       indicators.bb.lower > indicators.kc.lower;
      if (inSqueeze) {
        squeezeDuration++;
        foundSqueeze = true;
      } else if (foundSqueeze) {
        // Squeeze ended, stop counting
        break;
      }
    }
  }

  return { hadSqueeze: foundSqueeze, duration: squeezeDuration };
}

/**
 * Calculate ATR at a specific index
 */
function calculateATR(candles: Candle[], index: number): number {
  if (index < PARAMS.kcPeriod + 5) return 0;

  const window = candles.slice(Math.max(0, index - PARAMS.kcPeriod - 5), index + 1);
  const highs = window.map(c => c.high);
  const lows = window.map(c => c.low);
  const closes = window.map(c => c.close);

  const atrValues = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: PARAMS.kcPeriod,
  });

  return atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;
}

/**
 * Simulate a trade and track its lifecycle
 */
function simulateTrade(
  candles: Candle[],
  entryIndex: number,
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  entryRSI: number,
  tradeId: number,
  squeezeDuration: number,
  atrAtEntry: number
): TradeResult | null {
  const entryCandle = candles[entryIndex];
  const entryDate = new Date(entryCandle.timestamp);
  const hourOfDay = entryDate.getUTCHours();
  const dayOfWeek = entryDate.getUTCDay();

  const tpPrice = direction === 'LONG'
    ? entryPrice * (1 + PARAMS.takeProfitPct)
    : entryPrice * (1 - PARAMS.takeProfitPct);

  const slPrice = direction === 'LONG'
    ? entryPrice * (1 - PARAMS.stopLossPct)
    : entryPrice * (1 + PARAMS.stopLossPct);

  let bestPrice = entryPrice;
  let worstPrice = entryPrice;

  // Simulate trade bar by bar
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    const barsHeld = i - entryIndex;

    // Update best/worst prices
    if (direction === 'LONG') {
      bestPrice = Math.max(bestPrice, candle.high);
      worstPrice = Math.min(worstPrice, candle.low);

      // Check TP
      if (candle.high >= tpPrice) {
        const profit = tpPrice - entryPrice;
        const profitPct = (profit / entryPrice) * 100;
        const bestPricePct = ((bestPrice - entryPrice) / (tpPrice - entryPrice)) * 100;

        return {
          id: tradeId,
          direction,
          entryTime: candles[entryIndex].timestamp,
          entryPrice,
          entryRSI,
          exitTime: candle.timestamp,
          exitPrice: tpPrice,
          exitReason: 'TP',
          profit,
          profitPct,
          barsHeld,
          bestPrice,
          bestPricePct,
          worstPrice,
          immediateReversal: false,
          nearMiss: false,
          squeezeDuration,
          atrAtEntry,
          hourOfDay,
          dayOfWeek,
        };
      }

      // Check SL
      if (candle.low <= slPrice) {
        const profit = slPrice - entryPrice;
        const profitPct = (profit / entryPrice) * 100;
        const bestPricePct = ((bestPrice - entryPrice) / (tpPrice - entryPrice)) * 100;

        return {
          id: tradeId,
          direction,
          entryTime: candles[entryIndex].timestamp,
          entryPrice,
          entryRSI,
          exitTime: candle.timestamp,
          exitPrice: slPrice,
          exitReason: 'SL',
          profit,
          profitPct,
          barsHeld,
          bestPrice,
          bestPricePct: Math.max(0, bestPricePct),
          worstPrice,
          immediateReversal: barsHeld <= 3,
          nearMiss: bestPricePct > 50,
          squeezeDuration,
          atrAtEntry,
          hourOfDay,
          dayOfWeek,
        };
      }
    } else {
      // SHORT
      bestPrice = Math.min(bestPrice, candle.low);
      worstPrice = Math.max(worstPrice, candle.high);

      // Check TP
      if (candle.low <= tpPrice) {
        const profit = entryPrice - tpPrice;
        const profitPct = (profit / entryPrice) * 100;
        const bestPricePct = ((entryPrice - bestPrice) / (entryPrice - tpPrice)) * 100;

        return {
          id: tradeId,
          direction,
          entryTime: candles[entryIndex].timestamp,
          entryPrice,
          entryRSI,
          exitTime: candle.timestamp,
          exitPrice: tpPrice,
          exitReason: 'TP',
          profit,
          profitPct,
          barsHeld,
          bestPrice,
          bestPricePct,
          worstPrice,
          immediateReversal: false,
          nearMiss: false,
          squeezeDuration,
          atrAtEntry,
          hourOfDay,
          dayOfWeek,
        };
      }

      // Check SL
      if (candle.high >= slPrice) {
        const profit = entryPrice - slPrice;
        const profitPct = (profit / entryPrice) * 100;
        const bestPricePct = ((entryPrice - bestPrice) / (entryPrice - tpPrice)) * 100;

        return {
          id: tradeId,
          direction,
          entryTime: candles[entryIndex].timestamp,
          entryPrice,
          entryRSI,
          exitTime: candle.timestamp,
          exitPrice: slPrice,
          exitReason: 'SL',
          profit,
          profitPct,
          barsHeld,
          bestPrice,
          bestPricePct: Math.max(0, bestPricePct),
          worstPrice,
          immediateReversal: barsHeld <= 3,
          nearMiss: bestPricePct > 50,
          squeezeDuration,
          atrAtEntry,
          hourOfDay,
          dayOfWeek,
        };
      }
    }
  }

  return null; // Trade never closed (end of data)
}

/**
 * Run backtest
 */
function runBacktest(candles: Candle[]): TradeResult[] {
  const trades: TradeResult[] = [];
  let tradeId = 0;
  let lastTradeIndex = -100; // Cooldown

  console.log(`\n🔧 Running deep analysis on ${candles.length} candles...`);

  for (let i = PARAMS.minCandles; i < candles.length - 100; i++) {
    // Cooldown
    if (i - lastTradeIndex < 5) continue;

    const candle = candles[i];
    const indicators = calculateIndicators(candles, i);

    if (!indicators.bb || !indicators.kc || indicators.rsi === null) continue;

    // Check for squeeze and get duration
    const squeezeInfo = getSqueezeInfo(candles, i);
    if (!squeezeInfo.hadSqueeze) continue;

    const price = candle.close;
    const rsi = indicators.rsi;
    const atr = calculateATR(candles, i);

    // LONG signal
    const breakoutAbove = price > indicators.bb.upper;
    const rsiBullish = rsi > 55;

    if (breakoutAbove && rsiBullish) {
      const trade = simulateTrade(candles, i, 'LONG', price, rsi, ++tradeId, squeezeInfo.duration, atr);
      if (trade) {
        trades.push(trade);
        lastTradeIndex = i;
        // Skip to exit time to avoid overlapping trades
        i = candles.findIndex(c => c.timestamp === trade.exitTime);
      }
      continue;
    }

    // SHORT signal
    const breakoutBelow = price < indicators.bb.lower;
    const rsiBearish = rsi < 45;

    if (breakoutBelow && rsiBearish) {
      const trade = simulateTrade(candles, i, 'SHORT', price, rsi, ++tradeId, squeezeInfo.duration, atr);
      if (trade) {
        trades.push(trade);
        lastTradeIndex = i;
        // Skip to exit time
        i = candles.findIndex(c => c.timestamp === trade.exitTime);
      }
    }
  }

  return trades;
}

/**
 * Load CSV data
 */
function loadCandles(filepath: string): Candle[] {
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.split('\n').filter(line => line.trim() !== '');
  const rows = lines.slice(1); // Skip header

  return rows.map(row => {
    const [timestamp, open, high, low, close, volume] = row.split(',');
    return {
      timestamp: parseInt(timestamp, 10),
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume) || 0,
    };
  });
}

/**
 * Analyze results
 */
function analyzeResults(trades: TradeResult[]) {
  const wins = trades.filter(t => t.profit > 0);
  const losses = trades.filter(t => t.profit <= 0);

  console.log(`\n${'='.repeat(100)}`);
  console.log(`📊 DEEP LOSS ANALYSIS - ${SYMBOL}`);
  console.log('='.repeat(100));
  console.log(`\nTotal Trades: ${trades.length}`);
  console.log(`Wins: ${wins.length} (${(wins.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`Losses: ${losses.length} (${(losses.length / trades.length * 100).toFixed(1)}%)`);

  if (losses.length === 0) {
    console.log('\n✅ No losses to analyze!');
    return;
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`🔍 FALSE BREAKOUT ANALYSIS (${losses.length} losses)`);
  console.log('='.repeat(100));

  // 1. TIME TO STOP LOSS
  const avgBarsToSL = losses.reduce((sum, t) => sum + t.barsHeld, 0) / losses.length;
  const immediateReversals = losses.filter(t => t.immediateReversal);
  const slowReversals = losses.filter(t => !t.immediateReversal);

  console.log(`\n1️⃣  TIEMPO HASTA STOP LOSS:`);
  console.log(`   Avg bars to SL:        ${avgBarsToSL.toFixed(1)} candles (${(avgBarsToSL / 60).toFixed(1)} hours)`);
  console.log(`   Immediate reversals:   ${immediateReversals.length} (${(immediateReversals.length / losses.length * 100).toFixed(1)}%) - Hit SL en ≤3 candles`);
  console.log(`   Slow reversals:        ${slowReversals.length} (${(slowReversals.length / losses.length * 100).toFixed(1)}%) - Hit SL en >3 candles`);

  // 2. BEST PRICE ANALYSIS
  const nearMisses = losses.filter(t => t.nearMiss);
  const avgBestPricePct = losses.reduce((sum, t) => sum + t.bestPricePct, 0) / losses.length;

  console.log(`\n2️⃣  ANÁLISIS DE "NEAR MISSES":`);
  console.log(`   Near misses:           ${nearMisses.length} (${(nearMisses.length / losses.length * 100).toFixed(1)}%) - Alcanzaron >50% del TP`);
  console.log(`   Avg % of TP reached:   ${avgBestPricePct.toFixed(1)}%`);

  const neverMoved = losses.filter(t => t.bestPricePct < 10);
  const movedSome = losses.filter(t => t.bestPricePct >= 10 && t.bestPricePct < 50);
  const almostMade = losses.filter(t => t.bestPricePct >= 50);

  console.log(`\n   Distribution:`);
  console.log(`   Never moved (0-10%):   ${neverMoved.length} (${(neverMoved.length / losses.length * 100).toFixed(1)}%)`);
  console.log(`   Moved some (10-50%):   ${movedSome.length} (${(movedSome.length / losses.length * 100).toFixed(1)}%)`);
  console.log(`   Almost made it (>50%): ${almostMade.length} (${(almostMade.length / losses.length * 100).toFixed(1)}%)`);

  // 3. RSI ANALYSIS
  const longLosses = losses.filter(t => t.direction === 'LONG');
  const shortLosses = losses.filter(t => t.direction === 'SHORT');

  console.log(`\n3️⃣  RSI EN PÉRDIDAS:`);
  if (longLosses.length > 0) {
    const avgRSI = longLosses.reduce((sum, t) => sum + t.entryRSI, 0) / longLosses.length;
    const weakRSI = longLosses.filter(t => t.entryRSI < 60);
    console.log(`   LONG losses (${longLosses.length}):`);
    console.log(`     Avg RSI:             ${avgRSI.toFixed(1)}`);
    console.log(`     Weak RSI (<60):      ${weakRSI.length} (${(weakRSI.length / longLosses.length * 100).toFixed(1)}%)`);
  }

  if (shortLosses.length > 0) {
    const avgRSI = shortLosses.reduce((sum, t) => sum + t.entryRSI, 0) / shortLosses.length;
    const weakRSI = shortLosses.filter(t => t.entryRSI > 40);
    console.log(`   SHORT losses (${shortLosses.length}):`);
    console.log(`     Avg RSI:             ${avgRSI.toFixed(1)}`);
    console.log(`     Weak RSI (>40):      ${weakRSI.length} (${(weakRSI.length / shortLosses.length * 100).toFixed(1)}%)`);
  }

  // 4. SQUEEZE DURATION ANALYSIS
  console.log(`\n4️⃣  ANÁLISIS DE DURACIÓN DEL SQUEEZE:`);
  const avgSqueezeDuration = losses.reduce((sum, t) => sum + t.squeezeDuration, 0) / losses.length;
  const shortSqueeze = losses.filter(t => t.squeezeDuration <= 3);
  const mediumSqueeze = losses.filter(t => t.squeezeDuration > 3 && t.squeezeDuration <= 8);
  const longSqueeze = losses.filter(t => t.squeezeDuration > 8);

  console.log(`   Avg Squeeze Duration:  ${avgSqueezeDuration.toFixed(1)} candles`);
  console.log(`   Short (1-3 bars):      ${shortSqueeze.length} (${(shortSqueeze.length / losses.length * 100).toFixed(1)}%)`);
  console.log(`   Medium (4-8 bars):     ${mediumSqueeze.length} (${(mediumSqueeze.length / losses.length * 100).toFixed(1)}%)`);
  console.log(`   Long (>8 bars):        ${longSqueeze.length} (${(longSqueeze.length / losses.length * 100).toFixed(1)}%)`);

  // Compare squeeze duration between wins and losses
  const winsAvgSqueeze = wins.length > 0 ? wins.reduce((sum, t) => sum + t.squeezeDuration, 0) / wins.length : 0;
  console.log(`\n   Comparison WIN vs LOSS:`);
  console.log(`   Wins Avg Squeeze:      ${winsAvgSqueeze.toFixed(1)} candles`);
  console.log(`   Losses Avg Squeeze:    ${avgSqueezeDuration.toFixed(1)} candles`);

  // 5. ATR (VOLATILIDAD) ANALYSIS
  console.log(`\n5️⃣  ANÁLISIS DE VOLATILIDAD (ATR):`);
  const avgATR = losses.reduce((sum, t) => sum + t.atrAtEntry, 0) / losses.length;
  const avgATRPct = losses.reduce((sum, t) => sum + (t.atrAtEntry / t.entryPrice * 100), 0) / losses.length;

  // Divide into terciles
  const sortedByATR = [...losses].sort((a, b) => a.atrAtEntry - b.atrAtEntry);
  const lowATRThreshold = sortedByATR[Math.floor(losses.length / 3)].atrAtEntry;
  const highATRThreshold = sortedByATR[Math.floor(losses.length * 2 / 3)].atrAtEntry;

  const lowATR = losses.filter(t => t.atrAtEntry <= lowATRThreshold);
  const midATR = losses.filter(t => t.atrAtEntry > lowATRThreshold && t.atrAtEntry <= highATRThreshold);
  const highATR = losses.filter(t => t.atrAtEntry > highATRThreshold);

  console.log(`   Avg ATR:               $${avgATR.toFixed(2)} (${avgATRPct.toFixed(3)}%)`);
  console.log(`   Low ATR tercile:       ${lowATR.length} losses | Avg Best%: ${(lowATR.reduce((s, t) => s + t.bestPricePct, 0) / lowATR.length).toFixed(1)}%`);
  console.log(`   Mid ATR tercile:       ${midATR.length} losses | Avg Best%: ${(midATR.reduce((s, t) => s + t.bestPricePct, 0) / midATR.length).toFixed(1)}%`);
  console.log(`   High ATR tercile:      ${highATR.length} losses | Avg Best%: ${(highATR.reduce((s, t) => s + t.bestPricePct, 0) / highATR.length).toFixed(1)}%`);

  // Compare ATR between wins and losses
  const winsAvgATR = wins.length > 0 ? wins.reduce((sum, t) => sum + t.atrAtEntry, 0) / wins.length : 0;
  console.log(`\n   Comparison WIN vs LOSS:`);
  console.log(`   Wins Avg ATR:          $${winsAvgATR.toFixed(2)}`);
  console.log(`   Losses Avg ATR:        $${avgATR.toFixed(2)}`);

  // 6. TEMPORAL ANALYSIS (Hour of Day + Day of Week)
  console.log(`\n6️⃣  ANÁLISIS TEMPORAL:`);

  // Hour of day
  const hourCounts: Record<number, { losses: number; wins: number }> = {};
  for (let h = 0; h < 24; h++) hourCounts[h] = { losses: 0, wins: 0 };
  losses.forEach(t => hourCounts[t.hourOfDay].losses++);
  wins.forEach(t => hourCounts[t.hourOfDay].wins++);

  console.log(`\n   Hora del día (UTC) - Top 5 peores:`);
  const worstHours = Object.entries(hourCounts)
    .map(([h, c]) => ({ hour: parseInt(h), losses: c.losses, wins: c.wins, total: c.losses + c.wins, lossRate: c.losses / (c.losses + c.wins) * 100 }))
    .filter(x => x.total > 10)
    .sort((a, b) => b.lossRate - a.lossRate)
    .slice(0, 5);

  worstHours.forEach(h => {
    console.log(`      ${h.hour.toString().padStart(2, '0')}:00 UTC: ${h.losses} losses / ${h.total} trades (${h.lossRate.toFixed(1)}% loss rate)`);
  });

  // Day of week
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayCounts: Record<number, { losses: number; wins: number }> = {};
  for (let d = 0; d < 7; d++) dayCounts[d] = { losses: 0, wins: 0 };
  losses.forEach(t => dayCounts[t.dayOfWeek].losses++);
  wins.forEach(t => dayCounts[t.dayOfWeek].wins++);

  console.log(`\n   Día de la semana:`);
  Object.entries(dayCounts)
    .map(([d, c]) => ({ day: parseInt(d), losses: c.losses, wins: c.wins, total: c.losses + c.wins }))
    .filter(x => x.total > 0)
    .sort((a, b) => a.day - b.day)
    .forEach(d => {
      const lossRate = d.total > 0 ? (d.losses / d.total * 100).toFixed(1) : '0.0';
      console.log(`      ${dayNames[d.day]}: ${d.losses} losses / ${d.total} trades (${lossRate}% loss rate)`);
    });

  // 7. TOP 10 WORST LOSSES WITH FULL DETAILS
  console.log(`\n7️⃣  TOP 10 PEORES PÉRDIDAS (detalle completo):`);
  const worstLosses = [...losses].sort((a, b) => a.profit - b.profit).slice(0, 10);
  worstLosses.forEach((t, i) => {
    const date = new Date(t.entryTime);
    console.log(`   ${(i + 1).toString().padStart(2)}. ${t.direction} | $${t.entryPrice.toFixed(2)} | RSI: ${t.entryRSI.toFixed(1)} | Squeeze: ${t.squeezeDuration} bars`);
    console.log(`       Loss: $${Math.abs(t.profit).toFixed(2)} | Best: ${t.bestPricePct.toFixed(1)}% | ${dayNames[t.dayOfWeek]} ${t.hourOfDay}:00 | ${t.immediateReversal ? '⚡IMMED' : '🐌SLOW'} ${t.nearMiss ? '💔NEAR' : ''}`);
  });

  // 8. PATRONES CLAVE Y CONCLUSIONES
  console.log(`\n8️⃣  PATRONES REVELADORES:`);

  if (immediateReversals.length / losses.length > 0.3) {
    console.log(`\n   🚨 IMMEDIATE REVERSALS: ${(immediateReversals.length / losses.length * 100).toFixed(1)}%`);
    console.log(`       → Mercado reversa inmediatamente post-breakout`);
  }

  if (nearMisses.length / losses.length > 0.2) {
    console.log(`\n   🎯 NEAR MISSES: ${(nearMisses.length / losses.length * 100).toFixed(1)}%`);
    console.log(`       → Trades llegan cerca del TP pero fallan`);
  }

  if (shortSqueeze.length / losses.length > 0.4) {
    console.log(`\n   ⏱️  SHORT SQUEEZE: ${(shortSqueeze.length / losses.length * 100).toFixed(1)}%`);
    console.log(`       → Squeeze cortos (≤3 bars) generan más pérdidas`);
  }

  if (winsAvgSqueeze > avgSqueezeDuration * 1.2) {
    console.log(`\n   📈 SQUEEZE DURATION MATTERS:`);
    console.log(`       → Wins tienen ${((winsAvgSqueeze / avgSqueezeDuration - 1) * 100).toFixed(1)}% más squeeze duration`);
  }

  if (Math.abs(winsAvgATR - avgATR) / avgATR > 0.1) {
    console.log(`\n   📊 ATR MATTERS:`);
    console.log(`       → Wins ATR: $${winsAvgATR.toFixed(2)} vs Losses ATR: $${avgATR.toFixed(2)}`);
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`✅ Deep analysis complete`);
  console.log('='.repeat(100));

  // Save detailed CSV with ALL fields
  const csvRows = [
    'TradeID,Direction,EntryTime,EntryPrice,EntryRSI,ExitReason,Profit,BarsHeld,BestPricePct,ImmediateReversal,NearMiss,SqueezeDuration,ATR,HourOfDay,DayOfWeek'
  ];

  losses.forEach(t => {
    csvRows.push([
      t.id,
      t.direction,
      new Date(t.entryTime).toISOString(),
      t.entryPrice.toFixed(2),
      t.entryRSI.toFixed(1),
      t.exitReason,
      t.profit.toFixed(2),
      t.barsHeld,
      t.bestPricePct.toFixed(1),
      t.immediateReversal ? '1' : '0',
      t.nearMiss ? '1' : '0',
      t.squeezeDuration,
      t.atrAtEntry.toFixed(2),
      t.hourOfDay,
      t.dayOfWeek,
    ].join(','));
  });

  const csvPath = join(process.cwd(), 'backtest-data', `${SYMBOL}_loss_analysis.csv`);
  writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\n💾 Detailed loss data saved to: ${csvPath}`);

  // Save WINS too for comparison
  const winsCsvRows = [
    'TradeID,Direction,EntryTime,EntryPrice,EntryRSI,ExitReason,Profit,BarsHeld,BestPricePct,SqueezeDuration,ATR,HourOfDay,DayOfWeek'
  ];

  wins.forEach(t => {
    winsCsvRows.push([
      t.id,
      t.direction,
      new Date(t.entryTime).toISOString(),
      t.entryPrice.toFixed(2),
      t.entryRSI.toFixed(1),
      t.exitReason,
      t.profit.toFixed(2),
      t.barsHeld,
      t.bestPricePct.toFixed(1),
      t.squeezeDuration,
      t.atrAtEntry.toFixed(2),
      t.hourOfDay,
      t.dayOfWeek,
    ].join(','));
  });

  const winsCsvPath = join(process.cwd(), 'backtest-data', `${SYMBOL}_wins_analysis.csv`);
  writeFileSync(winsCsvPath, winsCsvRows.join('\n'));
  console.log(`💾 Wins data saved to: ${winsCsvPath}`);
}

/**
 * Main
 */
async function main() {
  const filepath = join(BACKTEST_DIR, `${SYMBOL}_60s_${BACKTEST_DAYS}d.csv`);

  if (!existsSync(filepath)) {
    console.error(`❌ Data file not found: ${filepath}`);
    console.error(`   Run: SYMBOLS="${SYMBOL}" DAYS=${BACKTEST_DAYS} pnpm data:fetch`);
    process.exit(1);
  }

  console.log('='.repeat(100));
  console.log('🔬 DEEP FALSE BREAKOUT ANALYSIS');
  console.log('='.repeat(100));
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Period: ${BACKTEST_DAYS} days`);
  console.log(`Strategy: BB Squeeze (optimized for ${SYMBOL})`);

  const candles = loadCandles(filepath);
  console.log(`Loaded ${candles.length} candles`);

  const trades = runBacktest(candles);
  console.log(`\n✅ Backtest complete: ${trades.length} trades generated`);

  analyzeResults(trades);

  console.log('\n✅ Done!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
