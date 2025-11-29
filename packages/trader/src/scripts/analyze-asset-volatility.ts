/**
 * Analyze volatility differences between assets
 */

import * as fs from 'fs';
import * as path from 'path';

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

function loadCSV(filePath: string): Candle[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]) || new Date(parts[0]).getTime() / 1000,
        open: parseFloat(parts[1]),
        high: parseFloat(parts[2]),
        low: parseFloat(parts[3]),
        close: parseFloat(parts[4]),
      });
    }
  }

  return candles;
}

function analyzeVolatility(candles: Candle[], name: string) {
  // Returns
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
    returns.push(ret);
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // ATR
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atrs.push((tr / candles[i].close) * 100);
  }
  const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length;

  // Candle ranges
  const ranges = candles.map((c) => ((c.high - c.low) / c.close) * 100);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;

  // Trend analysis - consecutive up/down moves
  let upMoves = 0;
  let downMoves = 0;
  let currentStreak = 0;
  let maxUpStreak = 0;
  let maxDownStreak = 0;

  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      upMoves++;
      if (currentStreak > 0) {
        currentStreak++;
      } else {
        currentStreak = 1;
      }
      maxUpStreak = Math.max(maxUpStreak, currentStreak);
    } else {
      downMoves++;
      if (currentStreak < 0) {
        currentStreak--;
      } else {
        currentStreak = -1;
      }
      maxDownStreak = Math.max(maxDownStreak, Math.abs(currentStreak));
    }
  }

  // Mean reversion tendency - how often does price reverse after X bars
  let reversalsAfter3 = 0;
  let totalAfter3 = 0;
  for (let i = 3; i < candles.length; i++) {
    const prev3Trend = candles[i - 1].close - candles[i - 3].close;
    const currentMove = candles[i].close - candles[i - 1].close;
    totalAfter3++;
    if ((prev3Trend > 0 && currentMove < 0) || (prev3Trend < 0 && currentMove > 0)) {
      reversalsAfter3++;
    }
  }
  const meanReversionRate = (reversalsAfter3 / totalAfter3) * 100;

  console.log('');
  console.log(`=== ${name} ===`);
  console.log(`Candles: ${candles.length}`);
  console.log(`Price: ${candles[0].close.toFixed(2)} → ${candles[candles.length - 1].close.toFixed(2)}`);
  console.log(`Volatility (stdDev): ${(stdDev * 100).toFixed(4)}%`);
  console.log(`Avg ATR: ${avgATR.toFixed(4)}%`);
  console.log(`Avg candle range: ${avgRange.toFixed(4)}%`);
  console.log(`Up/Down moves: ${upMoves}/${downMoves} (${((upMoves / (upMoves + downMoves)) * 100).toFixed(1)}% up)`);
  console.log(`Max streak: ${maxUpStreak} up / ${maxDownStreak} down`);
  console.log(`Mean reversion rate: ${meanReversionRate.toFixed(1)}%`);

  return { stdDev, avgATR, avgRange, meanReversionRate };
}

// Main
const dataDir = path.join(process.cwd(), 'data');

// Find available data files
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.csv'));
console.log('Available data files:', files);

// Load R_100 and R_75 - same timeframe for fair comparison
const r100File = files.find((f) => f.includes('R_100') && f.includes('60s') && f.includes('30d'));
const r75File = files.find((f) => f.includes('R_75') && f.includes('60s') && f.includes('30d'));

if (r100File) {
  const r100 = loadCSV(path.join(dataDir, r100File));
  const r100Stats = analyzeVolatility(r100, `R_100 (${r100File})`);

  if (r75File) {
    const r75 = loadCSV(path.join(dataDir, r75File));
    const r75Stats = analyzeVolatility(r75, `R_75 (${r75File})`);

    console.log('');
    console.log('=== COMPARACIÓN ===');
    console.log(`R_100 volatilidad: ${(r100Stats.stdDev / r75Stats.stdDev).toFixed(2)}x vs R_75`);
    console.log(`R_100 ATR: ${(r100Stats.avgATR / r75Stats.avgATR).toFixed(2)}x vs R_75`);
    console.log(`R_100 mean reversion: ${r100Stats.meanReversionRate.toFixed(1)}% vs R_75: ${r75Stats.meanReversionRate.toFixed(1)}%`);
  }
}
