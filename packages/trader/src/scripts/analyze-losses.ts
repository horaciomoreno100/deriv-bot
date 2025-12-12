#!/usr/bin/env npx tsx
/**
 * Analyze Loss Patterns in NFI Strategy
 * 
 * Understand WHY we lose:
 * - Exit reasons distribution
 * - Characteristics of STOP_LOSS vs TIME_LIMIT losses
 * - Patterns that lead to losses
 */

import * as fs from 'fs';
import * as path from 'path';

interface TradeRow {
  timestamp: number;
  datetime: string;
  entryTag: string;
  hourOfDay: number;
  dayOfWeek: number;
  entryPrice: number;
  rsi_3: number;
  rsi_14: number;
  rsi_delta: number;
  rsi_oversold_depth: number;
  bb_width: number;
  bb_position: number;
  dist_to_lower_bb: number;
  ewo: number;
  stoch_k: number;
  stoch_d: number;
  atr_pct: number;
  adx: number;
  price_change_5: number;
  price_change_15: number;
  recent_volatility: number;
  recent_trend: number;
  is_green_candle: number;
  outcome: string;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  barsHeld: number;
}

function parseCSV(filepath: string): TradeRow[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0]!.split(',');
  const trades: TradeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(',');
    const row: any = {};
    headers.forEach((h, idx) => {
      let val = values[idx]?.replace(/^"|"$/g, '') || '';
      if (val === 'NaN' || val === '') {
        row[h] = 0;
      } else if (['true', '1'].includes(val)) {
        row[h] = 1;
      } else if (['false', '0'].includes(val)) {
        row[h] = 0;
      } else if (!isNaN(parseFloat(val))) {
        row[h] = parseFloat(val);
      } else {
        row[h] = val;
      }
    });
    trades.push(row as TradeRow);
  }

  return trades;
}

function analyzeLosses(trades: TradeRow[]) {
  const losses = trades.filter(t => t.outcome === 'LOSS');
  const wins = trades.filter(t => t.outcome === 'WIN');

  console.log('\n' + '═'.repeat(80));
  console.log('  ANÁLISIS DE PÉRDIDAS - NFI Strategy');
  console.log('═'.repeat(80));
  console.log(`Total trades: ${trades.length}`);
  console.log(`Pérdidas: ${losses.length} (${((losses.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Ganancias: ${wins.length} (${((wins.length / trades.length) * 100).toFixed(1)}%)`);

  // 1. Distribución de razones de salida
  console.log('\n📊 DISTRIBUCIÓN DE RAZONES DE SALIDA (Pérdidas)');
  console.log('─'.repeat(80));
  const exitReasons = losses.reduce((acc, t) => {
    acc[t.exitReason] = (acc[t.exitReason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [reason, count] of Object.entries(exitReasons).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / losses.length) * 100).toFixed(1);
    const avgPnl = losses.filter(t => t.exitReason === reason).reduce((sum, t) => sum + t.pnl, 0) / count;
    const avgBars = losses.filter(t => t.exitReason === reason).reduce((sum, t) => sum + t.barsHeld, 0) / count;
    console.log(`${reason.padEnd(20)}: ${count.toString().padStart(4)} (${pct.padStart(5)}%) | Avg P&L: $${avgPnl.toFixed(2)} | Avg Bars: ${avgBars.toFixed(1)}`);
  }

  // 2. STOP_LOSS vs TIME_LIMIT analysis
  const stopLossLosses = losses.filter(t => t.exitReason === 'STOP_LOSS');
  const timeLimitLosses = losses.filter(t => t.exitReason === 'TIME_LIMIT');

  console.log('\n🔴 STOP_LOSS Losses vs ⏱️  TIME_LIMIT Losses');
  console.log('─'.repeat(80));
  console.log(`STOP_LOSS: ${stopLossLosses.length} (${((stopLossLosses.length / losses.length) * 100).toFixed(1)}%)`);
  console.log(`TIME_LIMIT: ${timeLimitLosses.length} (${((timeLimitLosses.length / losses.length) * 100).toFixed(1)}%)`);

  const numericFeatures = [
    'rsi_3', 'rsi_14', 'rsi_oversold_depth', 'bb_width', 'bb_position',
    'ewo', 'stoch_k', 'atr_pct', 'adx', 'price_change_5', 'price_change_15',
    'recent_volatility', 'recent_trend'
  ];

  console.log('\nFeature Comparison: STOP_LOSS vs TIME_LIMIT vs WIN');
  console.log('─'.repeat(80));
  console.log('Feature'.padEnd(20) + ' | STOP_LOSS | TIME_LIMIT | WIN      | Pattern');
  console.log('─'.repeat(80));

  for (const feat of numericFeatures) {
    const slAvg = stopLossLosses.reduce((sum, t) => sum + (t[feat as keyof TradeRow] as number || 0), 0) / stopLossLosses.length;
    const tlAvg = timeLimitLosses.reduce((sum, t) => sum + (t[feat as keyof TradeRow] as number || 0), 0) / timeLimitLosses.length;
    const winAvg = wins.reduce((sum, t) => sum + (t[feat as keyof TradeRow] as number || 0), 0) / wins.length;

    let pattern = '';
    if (Math.abs(slAvg - winAvg) > Math.abs(tlAvg - winAvg)) {
      pattern = slAvg > winAvg ? 'SL > WIN' : 'SL < WIN';
    } else {
      pattern = tlAvg > winAvg ? 'TL > WIN' : 'TL < WIN';
    }

    console.log(
      feat.padEnd(20) + ' | ' +
      slAvg.toFixed(3).padStart(9) + ' | ' +
      tlAvg.toFixed(3).padStart(10) + ' | ' +
      winAvg.toFixed(3).padStart(8) + ' | ' +
      pattern
    );
  }

  // 3. Bars held analysis
  console.log('\n⏱️  TIEMPO EN TRADE (Bars Held)');
  console.log('─'.repeat(80));
  const slBars = stopLossLosses.map(t => t.barsHeld);
  const tlBars = timeLimitLosses.map(t => t.barsHeld);
  const winBars = wins.map(t => t.barsHeld);

  console.log(`STOP_LOSS:   Avg ${(slBars.reduce((a, b) => a + b, 0) / slBars.length).toFixed(1)} bars | Min: ${Math.min(...slBars)} | Max: ${Math.max(...slBars)}`);
  console.log(`TIME_LIMIT:  Avg ${(tlBars.reduce((a, b) => a + b, 0) / tlBars.length).toFixed(1)} bars | Min: ${Math.min(...tlBars)} | Max: ${Math.max(...tlBars)}`);
  console.log(`WIN:         Avg ${(winBars.reduce((a, b) => a + b, 0) / winBars.length).toFixed(1)} bars | Min: ${Math.min(...winBars)} | Max: ${Math.max(...winBars)}`);

  // 4. Tag analysis for losses
  console.log('\n🏷️  PERFORMANCE POR TAG (Solo Pérdidas)');
  console.log('─'.repeat(80));
  const tags = [...new Set(losses.map(t => String(t.entryTag)))].sort();
  for (const tag of tags) {
    const tagLosses = losses.filter(t => String(t.entryTag) === tag);
    const tagWins = wins.filter(t => String(t.entryTag) === tag);
    const tagTotal = tagLosses.length + tagWins.length;
    const tagWR = tagTotal > 0 ? (tagWins.length / tagTotal * 100) : 0;
    const tagPnl = tagLosses.reduce((sum, t) => sum + t.pnl, 0) + tagWins.reduce((sum, t) => sum + t.pnl, 0);
    const slCount = tagLosses.filter(t => t.exitReason === 'STOP_LOSS').length;
    const tlCount = tagLosses.filter(t => t.exitReason === 'TIME_LIMIT').length;

    console.log(
      `Tag ${tag.padStart(3)}: ${tagTotal.toString().padStart(4)} trades | ` +
      `WR: ${tagWR.toFixed(1).padStart(5)}% | ` +
      `P&L: $${tagPnl.toFixed(2).padStart(8)} | ` +
      `Losses: ${tagLosses.length} (SL: ${slCount}, TL: ${tlCount})`
    );
  }

  // 5. Volatility analysis
  console.log('\n📈 ANÁLISIS DE VOLATILIDAD');
  console.log('─'.repeat(80));
  const highVolLosses = losses.filter(t => t.atr_pct > 0.3);
  const lowVolLosses = losses.filter(t => t.atr_pct <= 0.3);
  const highVolWins = wins.filter(t => t.atr_pct > 0.3);
  const lowVolWins = wins.filter(t => t.atr_pct <= 0.3);

  console.log(`Alta volatilidad (ATR > 0.3%):`);
  console.log(`  Losses: ${highVolLosses.length} (${((highVolLosses.length / losses.length) * 100).toFixed(1)}%)`);
  console.log(`  Wins: ${highVolWins.length} (${((highVolWins.length / wins.length) * 100).toFixed(1)}%)`);
  console.log(`Baja volatilidad (ATR <= 0.3%):`);
  console.log(`  Losses: ${lowVolLosses.length} (${((lowVolLosses.length / losses.length) * 100).toFixed(1)}%)`);
  console.log(`  Wins: ${lowVolWins.length} (${((lowVolWins.length / wins.length) * 100).toFixed(1)}%)`);

  // 6. RSI extremes
  console.log('\n📉 ANÁLISIS DE RSI EXTREMO');
  console.log('─'.repeat(80));
  const veryOversoldLosses = losses.filter(t => t.rsi_3 < 5);
  const oversoldLosses = losses.filter(t => t.rsi_3 >= 5 && t.rsi_3 < 10);
  const normalLosses = losses.filter(t => t.rsi_3 >= 10);
  const veryOversoldWins = wins.filter(t => t.rsi_3 < 5);
  const oversoldWins = wins.filter(t => t.rsi_3 >= 5 && t.rsi_3 < 10);
  const normalWins = wins.filter(t => t.rsi_3 >= 10);

  console.log(`RSI3 < 5 (muy oversold):`);
  console.log(`  Losses: ${veryOversoldLosses.length} | Wins: ${veryOversoldWins.length} | WR: ${((veryOversoldWins.length / (veryOversoldLosses.length + veryOversoldWins.length)) * 100).toFixed(1)}%`);
  console.log(`RSI3 5-10 (oversold):`);
  console.log(`  Losses: ${oversoldLosses.length} | Wins: ${oversoldWins.length} | WR: ${((oversoldWins.length / (oversoldLosses.length + oversoldWins.length)) * 100).toFixed(1)}%`);
  console.log(`RSI3 >= 10 (normal):`);
  console.log(`  Losses: ${normalLosses.length} | Wins: ${normalWins.length} | WR: ${((normalWins.length / (normalLosses.length + normalWins.length)) * 100).toFixed(1)}%`);

  // 7. Key insights
  console.log('\n💡 INSIGHTS CLAVE');
  console.log('─'.repeat(80));
  
  const slPct = (stopLossLosses.length / losses.length) * 100;
  const avgSlBars = slBars.reduce((a, b) => a + b, 0) / slBars.length;
  const avgTlBars = tlBars.reduce((a, b) => a + b, 0) / tlBars.length;

  console.log(`1. ${slPct.toFixed(1)}% de las pérdidas son por STOP_LOSS (${stopLossLosses.length} trades)`);
  console.log(`2. STOP_LOSS ocurre en promedio a las ${avgSlBars.toFixed(1)} barras (${(avgSlBars * 5 / 60).toFixed(1)} horas)`);
  console.log(`3. TIME_LIMIT ocurre a las ${avgTlBars.toFixed(1)} barras (${(avgTlBars * 5 / 60).toFixed(1)} horas)`);
  
  const slAvgVol = stopLossLosses.reduce((sum, t) => sum + t.atr_pct, 0) / stopLossLosses.length;
  const winAvgVol = wins.reduce((sum, t) => sum + t.atr_pct, 0) / wins.length;
  console.log(`4. STOP_LOSS tiene mayor volatilidad (ATR: ${slAvgVol.toFixed(3)}%) vs Wins (${winAvgVol.toFixed(3)}%)`);

  const slAvgRsi3 = stopLossLosses.reduce((sum, t) => sum + t.rsi_3, 0) / stopLossLosses.length;
  const winAvgRsi3 = wins.reduce((sum, t) => sum + t.rsi_3, 0) / wins.length;
  console.log(`5. STOP_LOSS tiene RSI3 más alto (${slAvgRsi3.toFixed(2)}) vs Wins (${winAvgRsi3.toFixed(2)})`);

  const slAvgAdx = stopLossLosses.reduce((sum, t) => sum + t.adx, 0) / stopLossLosses.length;
  const winAvgAdx = wins.reduce((sum, t) => sum + t.adx, 0) / wins.length;
  console.log(`6. STOP_LOSS tiene ADX más alto (${slAvgAdx.toFixed(2)}) vs Wins (${winAvgAdx.toFixed(2)}) - tendencia más fuerte`);
}

async function main() {
  const csvFile = process.env.CSV_FILE || 'analysis-output/nfi_ml_cryETHUSD_180d_2025-12-02T12-38-14.csv';
  const filepath = path.join(process.cwd(), csvFile);

  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`);
    process.exit(1);
  }

  console.log(`📁 Loading: ${filepath}`);
  const trades = parseCSV(filepath);
  console.log(`✅ Loaded ${trades.length} trades`);

  analyzeLosses(trades);
}

main().catch(console.error);

