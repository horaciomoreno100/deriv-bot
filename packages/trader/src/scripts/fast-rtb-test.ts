#!/usr/bin/env npx tsx
/**
 * Fast Return to Base Backtest
 *
 * Uses FastBacktester for rapid multi-asset testing of the RTB strategy.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester, type FastEntrySignal } from '../backtest/runners/fast-backtester.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.05;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

// RTB Strategy Parameters - best config found
const RTB_PARAMS = {
  bbStdDev: 2.0,
  rsiOversold: 30,
  rsiOverbought: 70,
  bandWidthExpansionThreshold: 0.20,
  tpPct: 0.5,
  slPct: 0.3,
  cooldown: 3,
  maxBarsInTrade: 15,
  // MTF settings
  htfMultiplier: 5,  // 1m -> 5m, 5m -> 25m
  htfEmaFast: 20,
  htfEmaSlow: 50,
};

// Load CSV fast
function loadCandles(filepath: string): Candle[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts.length > 5 ? parseFloat(parts[5]!) : undefined,
      });
    }
  }

  return candles;
}

// Aggregate candles to higher timeframe
function aggregateToHTF(candles: Candle[], multiplier: number): Candle[] {
  const htfCandles: Candle[] = [];

  for (let i = 0; i < candles.length; i += multiplier) {
    const chunk = candles.slice(i, i + multiplier);
    if (chunk.length === 0) continue;

    htfCandles.push({
      timestamp: chunk[0]!.timestamp,
      open: chunk[0]!.open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1]!.close,
    });
  }

  return htfCandles;
}

// Calculate EMA
function calculateEMA(values: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      result.push(values[i]!);
    } else {
      result.push((values[i]! - result[i - 1]!) * multiplier + result[i - 1]!);
    }
  }

  return result;
}

// Detect weakness patterns in M1 (the "microscope")
interface WeaknessSignal {
  type: 'DOUBLE_TOP' | 'DOUBLE_BOTTOM' | 'PINBAR_REJECTION' | 'RSI_DIVERGENCE' | 'ENGULFING';
  direction: 'CALL' | 'PUT';
}

function detectWeakness(
  candles: Candle[],
  index: number,
  rsiValues: number[],
  direction: 'CALL' | 'PUT'
): WeaknessSignal | null {
  if (index < 5) return null;

  const curr = candles[index]!;
  const prev = candles[index - 1]!;
  const prev2 = candles[index - 2]!;
  const prev3 = candles[index - 3]!;

  const currRsi = rsiValues[index];
  const prevRsi = rsiValues[index - 1];
  const prev2Rsi = rsiValues[index - 2];

  if (direction === 'PUT') {
    // Looking for bearish weakness at upper band

    // 1. Pinbar Rejection (long upper wick, closes bearish)
    const bodySize = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.close, curr.open);
    const totalRange = curr.high - curr.low;
    if (totalRange > 0 && upperWick / totalRange > 0.6 && curr.close < curr.open) {
      return { type: 'PINBAR_REJECTION', direction: 'PUT' };
    }

    // 2. Bearish Engulfing
    if (prev.close > prev.open && curr.close < curr.open) {
      if (curr.open >= prev.close && curr.close <= prev.open) {
        return { type: 'ENGULFING', direction: 'PUT' };
      }
    }

    // 3. RSI Divergence (price higher high, RSI lower high)
    if (currRsi && prevRsi && prev2Rsi) {
      if (curr.high > prev2.high && currRsi < prev2Rsi && currRsi < 70) {
        return { type: 'RSI_DIVERGENCE', direction: 'PUT' };
      }
    }

    // 4. Double Top (micro M pattern)
    if (Math.abs(curr.high - prev2.high) / prev2.high < 0.001) { // Peaks within 0.1%
      if (prev.high < curr.high && prev.high < prev2.high) { // Valley between
        if (curr.close < prev.low) { // Broke the valley
          return { type: 'DOUBLE_TOP', direction: 'PUT' };
        }
      }
    }
  } else {
    // Looking for bullish weakness at lower band

    // 1. Pinbar Rejection (long lower wick, closes bullish)
    const bodySize = Math.abs(curr.close - curr.open);
    const lowerWick = Math.min(curr.close, curr.open) - curr.low;
    const totalRange = curr.high - curr.low;
    if (totalRange > 0 && lowerWick / totalRange > 0.6 && curr.close > curr.open) {
      return { type: 'PINBAR_REJECTION', direction: 'CALL' };
    }

    // 2. Bullish Engulfing
    if (prev.close < prev.open && curr.close > curr.open) {
      if (curr.open <= prev.close && curr.close >= prev.open) {
        return { type: 'ENGULFING', direction: 'CALL' };
      }
    }

    // 3. RSI Divergence (price lower low, RSI higher low)
    if (currRsi && prevRsi && prev2Rsi) {
      if (curr.low < prev2.low && currRsi > prev2Rsi && currRsi > 30) {
        return { type: 'RSI_DIVERGENCE', direction: 'CALL' };
      }
    }

    // 4. Double Bottom (micro W pattern)
    if (Math.abs(curr.low - prev2.low) / prev2.low < 0.001) {
      if (prev.low > curr.low && prev.low > prev2.low) {
        if (curr.close > prev.high) {
          return { type: 'DOUBLE_BOTTOM', direction: 'CALL' };
        }
      }
    }
  }

  return null;
}

// RTB Entry Function - Simple but effective MTF
// HTF at BB extreme + LTF rejection candle + RSI confirmation
function createRTBEntryFn(
  candles: Candle[],
  htfAtExtreme: { upper: boolean; lower: boolean }[],
  rsiValues: number[]
): (index: number, indicators: Record<string, number | boolean>) => FastEntrySignal | null {
  let lastBandWidths: number[] = [];
  const lookback = 5;

  return (index: number, indicators: Record<string, number | boolean>) => {
    if (index < 3) return null;

    const rsi = indicators.rsi as number;
    const bbUpper = indicators.bbUpper as number;
    const bbLower = indicators.bbLower as number;
    const bbMiddle = indicators.bbMiddle as number;

    const curr = candles[index]!;
    const prev = candles[index - 1]!;

    if (!rsi || !bbUpper || !bbLower || !bbMiddle) return null;

    // Get HTF extreme status
    const htfStatus = htfAtExtreme[index];
    if (!htfStatus) return null;

    // Calculate current band width (Boca de Cocodrilo filter)
    const bandWidth = (bbUpper - bbLower) / bbMiddle;
    lastBandWidths.push(bandWidth);
    if (lastBandWidths.length > lookback) {
      lastBandWidths = lastBandWidths.slice(-lookback);
    }

    if (lastBandWidths.length >= lookback) {
      const avgBandWidth = lastBandWidths.slice(0, -1).reduce((a, b) => a + b, 0) / (lastBandWidths.length - 1);
      const expansion = (bandWidth - avgBandWidth) / avgBandWidth;
      if (expansion > RTB_PARAMS.bandWidthExpansionThreshold) {
        return null;
      }
    }

    const totalRange = curr.high - curr.low;
    if (totalRange === 0) return null;

    // SELL Setup: HTF upper extreme + LTF bearish rejection
    if (htfStatus.upper && curr.high >= bbUpper) {
      const upperWick = curr.high - Math.max(curr.close, curr.open);
      const isBearish = curr.close < curr.open;
      const hasRejectionWick = upperWick / totalRange > 0.4;

      if (isBearish && hasRejectionWick && rsi > 70) {
        return { direction: 'PUT', price: curr.close };
      }
    }

    // BUY Setup: HTF lower extreme + LTF bullish rejection
    if (htfStatus.lower && curr.low <= bbLower) {
      const lowerWick = Math.min(curr.close, curr.open) - curr.low;
      const isBullish = curr.close > curr.open;
      const hasRejectionWick = lowerWick / totalRange > 0.4;

      if (isBullish && hasRejectionWick && rsi < 30) {
        return { direction: 'CALL', price: curr.close };
      }
    }

    return null;
  };
}

// Calculate HTF BB extremes for each LTF bar
function calculateHTFExtremes(candles: Candle[], multiplier: number): { upper: boolean; lower: boolean }[] {
  const htfCandles = aggregateToHTF(candles, multiplier);
  const closes = htfCandles.map(c => c.close);

  // Calculate BB for HTF
  const bbPeriod = 20;
  const bbStdDev = 2.5; // Use 2.5 for HTF (more extreme)

  const htfBB: { upper: number; lower: number; middle: number }[] = [];

  for (let i = 0; i < htfCandles.length; i++) {
    if (i < bbPeriod - 1) {
      htfBB.push({ upper: closes[i]!, lower: closes[i]!, middle: closes[i]! });
      continue;
    }

    // Calculate SMA
    let sum = 0;
    for (let j = 0; j < bbPeriod; j++) {
      sum += closes[i - j]!;
    }
    const sma = sum / bbPeriod;

    // Calculate StdDev
    let sqSum = 0;
    for (let j = 0; j < bbPeriod; j++) {
      sqSum += Math.pow(closes[i - j]! - sma, 2);
    }
    const stdDev = Math.sqrt(sqSum / bbPeriod);

    htfBB.push({
      upper: sma + stdDev * bbStdDev,
      lower: sma - stdDev * bbStdDev,
      middle: sma,
    });
  }

  // Map back to LTF bars
  const extremes: { upper: boolean; lower: boolean }[] = [];

  for (let i = 0; i < candles.length; i++) {
    const htfIndex = Math.floor(i / multiplier);
    if (htfIndex >= htfCandles.length || htfIndex >= htfBB.length) {
      extremes.push({ upper: false, lower: false });
      continue;
    }

    const htfCandle = htfCandles[htfIndex]!;
    const bb = htfBB[htfIndex]!;

    extremes.push({
      upper: htfCandle.high >= bb.upper * 0.998, // Within 0.2% of upper band
      lower: htfCandle.low <= bb.lower * 1.002,  // Within 0.2% of lower band
    });
  }

  return extremes;
}

// Calculate RSI series for weakness detection
function calculateRSISeries(candles: Candle[], period: number): number[] {
  const closes = candles.map(c => c.close);
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      rsi.push(50);
      continue;
    }

    const change = closes[i]! - closes[i - 1]!;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);

    if (i < period) {
      rsi.push(50);
      continue;
    }

    let avgGain = 0;
    let avgLoss = 0;

    if (i === period) {
      for (let j = 0; j < period; j++) {
        avgGain += gains[j]!;
        avgLoss += losses[j]!;
      }
      avgGain /= period;
      avgLoss /= period;
    } else {
      const prevAvgGain = rsi[i - 1]! > 50 ? (100 - rsi[i - 1]!) / rsi[i - 1]! : rsi[i - 1]! / (100 - rsi[i - 1]!);
      avgGain = (gains[gains.length - 1]! + (period - 1) * (gains[gains.length - 2] || 0)) / period;
      avgLoss = (losses[losses.length - 1]! + (period - 1) * (losses[losses.length - 2] || 0)) / period;
    }

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return rsi;
}

async function main() {
  console.log('='.repeat(70));
  console.log('  RTB MTF v2 - HTF Extreme + LTF Rejection');
  console.log('='.repeat(70));
  console.log(`\nStrategy: M5 at BB(2.5) extreme + M1 rejection candle`);
  console.log(`Entry: Wick >40% + Bearish/Bullish close + RSI confirm`);
  console.log(`TP: ${RTB_PARAMS.tpPct}% | SL: ${RTB_PARAMS.slPct}% | Exit: BB Middle`);
  console.log('');

  // Test ALL available assets
  const assets = [
    // Indices
    { name: 'DAX', file: 'OTC_GDAXI_1m_180d.csv' },
    // Synthetics
    { name: 'R_10', file: 'R_10_1m_90d.csv' },
    { name: 'R_25', file: 'R_25_1m_90d.csv' },
    { name: 'R_50', file: 'R_50_1m_90d.csv' },
    { name: 'R_75', file: 'R_75_1m_90d.csv' },
    { name: 'R_100', file: 'R_100_1m_90d.csv' },
    // Forex majors
    { name: 'EURUSD', file: 'frxEURUSD_1m_90d.csv' },
    { name: 'GBPUSD', file: 'frxGBPUSD_1m_90d.csv' },
    { name: 'USDJPY', file: 'frxUSDJPY_1m_90d.csv' },
    { name: 'USDCHF', file: 'frxUSDCHF_1m_90d.csv' },
    { name: 'USDCAD', file: 'frxUSDCAD_1m_90d.csv' },
    { name: 'AUDUSD', file: 'frxAUDUSD_1m_90d.csv' },
    // Forex crosses
    { name: 'EURGBP', file: 'frxEURGBP_1m_90d.csv' },
    { name: 'EURJPY', file: 'frxEURJPY_1m_90d.csv' },
    { name: 'GBPJPY', file: 'frxGBPJPY_1m_90d.csv' },
    { name: 'AUDJPY', file: 'frxAUDJPY_1m_90d.csv' },
    // Commodities
    { name: 'XAUUSD', file: 'frxXAUUSD_1m_90d.csv' },
    { name: 'XAGUSD', file: 'frxXAGUSD_1m_180d.csv' },
    // Crypto
    { name: 'BTCUSD', file: 'cryBTCUSD_1m_90d.csv' },
    { name: 'ETHUSD', file: 'cryETHUSD_1m_90d.csv' },
    // World indices
    { name: 'WLDUSD', file: 'WLDUSD_1m_90d.csv' },
    { name: 'WLDEUR', file: 'WLDEUR_1m_90d.csv' },
  ];

  const results: Array<{
    asset: string;
    candles: number;
    trades: number;
    winRate: number;
    pf: number;
    netPnl: number;
    maxDD: number;
    timeMs: number;
  }> = [];

  for (const asset of assets) {
    const filepath = path.join(dataDir, asset.file);

    if (!fs.existsSync(filepath)) {
      console.log(`⏭️  ${asset.name}: data not found (${asset.file})`);
      continue;
    }

    const startTime = Date.now();

    // Load data
    const candles = loadCandles(filepath);

    // Calculate HTF extremes (M5 touching BB bands)
    const htfExtremes = calculateHTFExtremes(candles, RTB_PARAMS.htfMultiplier);

    // Calculate RSI series for weakness detection
    const rsiValues = calculateRSISeries(candles, 7);

    // Create FastBacktester with required indicators
    const backtester = new FastBacktester(candles, ['rsi', 'bb'], {
      rsiPeriod: 7,
      bbPeriod: 20,
      bbStdDev: RTB_PARAMS.bbStdDev,
    });

    // Run backtest - HTF extreme + LTF weakness pattern
    const result = backtester.run({
      entryFn: createRTBEntryFn(candles, htfExtremes, rsiValues),
      tpPct: RTB_PARAMS.tpPct,
      slPct: RTB_PARAMS.slPct,
      cooldown: RTB_PARAMS.cooldown,
      maxBarsInTrade: RTB_PARAMS.maxBarsInTrade,
      initialBalance: INITIAL_CAPITAL,
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      startIndex: 60, // Skip warmup
      exitOnBBMiddle: false,  // Disabled - let TP/SL decide
    });

    const elapsed = Date.now() - startTime;

    results.push({
      asset: asset.name,
      candles: candles.length,
      trades: result.trades,
      winRate: result.winRate,
      pf: result.profitFactor,
      netPnl: result.netPnl,
      maxDD: result.maxDrawdownPct,
      timeMs: elapsed,
    });

    // Status indicator
    const status = result.profitFactor >= 1.3 ? '✅' : result.profitFactor >= 1.0 ? '⚠️' : '❌';
    console.log(
      `${status} ${asset.name.padEnd(12)} | ` +
      `${candles.length.toLocaleString().padStart(7)} candles | ` +
      `${result.trades.toString().padStart(4)} trades | ` +
      `WR ${result.winRate.toFixed(1).padStart(5)}% | ` +
      `PF ${result.profitFactor.toFixed(2).padStart(5)} | ` +
      `$${result.netPnl.toFixed(0).padStart(6)} | ` +
      `DD ${result.maxDrawdownPct.toFixed(1).padStart(4)}% | ` +
      `${elapsed}ms`
    );
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const profitable = results.filter(r => r.pf > 1);
  const good = results.filter(r => r.pf >= 1.3);
  const totalTrades = results.reduce((sum, r) => sum + r.trades, 0);
  const totalPnl = results.reduce((sum, r) => sum + r.netPnl, 0);
  const avgTime = results.reduce((sum, r) => sum + r.timeMs, 0) / results.length;

  console.log(`\nAssets tested: ${results.length}`);
  console.log(`Profitable (PF > 1): ${profitable.length}/${results.length}`);
  console.log(`Good (PF >= 1.3): ${good.length}/${results.length}`);
  console.log(`Total trades: ${totalTrades}`);
  console.log(`Total P&L: $${totalPnl.toFixed(2)}`);
  console.log(`Avg time per asset: ${avgTime.toFixed(0)}ms`);

  if (good.length > 0) {
    console.log('\n🎯 BEST ASSETS:');
    good.sort((a, b) => b.pf - a.pf);
    for (const r of good) {
      console.log(`  ${r.asset}: PF ${r.pf.toFixed(2)}, ${r.trades} trades, $${r.netPnl.toFixed(0)}`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
