/**
 * Spike: Generate a sample chart with mock data
 *
 * Run with: npx tsx packages/shared/src/visualization/spike/generate-sample-chart.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  generateChartHTML,
  createVisualizationData,
} from '../chart-generator.js';
import type { Candle } from '../../types/market.js';
import type { TradeWithContext, MarketSnapshot, IndicatorSnapshot } from '../../types/visualization.js';

// Generate mock candle data (simulating R_100 1-minute candles)
function generateMockCandles(count: number, startPrice: number): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - count * 60;

  for (let i = 0; i < count; i++) {
    const volatility = 0.002; // 0.2% volatility
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * price * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * price * 0.5;

    candles.push({
      asset: 'R_100',
      timeframe: 60,
      timestamp: startTime + i * 60,
      open,
      high,
      low,
      close,
    });

    price = close;
  }

  return candles;
}

// Calculate simple RSI
function calculateRSI(candles: Candle[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const prevCandle = candles[i - 1];
    const currCandle = candles[i];
    if (!prevCandle || !currCandle) continue;
    const change = currCandle.close - prevCandle.close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // First RSI values are NaN until we have enough data
  for (let i = 0; i < period; i++) {
    rsi.push(50); // Default to neutral
  }

  // Calculate RSI
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < candles.length; i++) {
    const gain = gains[i - 1];
    const loss = losses[i - 1];
    if (gain !== undefined) avgGain = (avgGain * (period - 1) + gain) / period;
    if (loss !== undefined) avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

// Calculate Bollinger Bands
function calculateBB(
  candles: Candle[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) continue;

    if (i < period - 1) {
      upper.push(candle.close);
      middle.push(candle.close);
      lower.push(candle.close);
      continue;
    }

    const slice = candles.slice(i - period + 1, i + 1);
    const closes = slice.map((c) => c.close);
    const sma = closes.reduce((a, b) => a + b, 0) / period;
    const variance =
      closes.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const std = Math.sqrt(variance);

    middle.push(sma);
    upper.push(sma + stdDevMultiplier * std);
    lower.push(sma - stdDevMultiplier * std);
  }

  return { upper, middle, lower };
}

// Generate mock squeeze histogram
function generateSqueezeHistogram(candles: Candle[]): number[] {
  return candles.map((_, i) => {
    // Simulate momentum oscillating
    return Math.sin(i * 0.1) * 0.5 + (Math.random() - 0.5) * 0.2;
  });
}

// Create a market snapshot
function createSnapshot(
  candle: Candle,
  index: number,
  indicators: IndicatorSnapshot
): MarketSnapshot {
  return {
    timestamp: candle.timestamp * 1000,
    candle: {
      index,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    },
    price: candle.close,
    indicators,
  };
}

// Generate mock trades
function generateMockTrades(
  candles: Candle[],
  rsi: number[],
  bb: { upper: number[]; middle: number[]; lower: number[] }
): TradeWithContext[] {
  const trades: TradeWithContext[] = [];
  let tradeId = 1;

  // Find some entry points based on RSI
  for (let i = 30; i < candles.length - 10; i += 15 + Math.floor(Math.random() * 20)) {
    const entryCandle = candles[i];
    if (!entryCandle) continue;

    const rsiValue = rsi[i];
    if (rsiValue === undefined) continue;

    const direction = rsiValue < 40 ? 'CALL' : rsiValue > 60 ? 'PUT' : null;

    if (!direction) continue;

    // Determine exit (5-10 candles later)
    const exitIndex = Math.min(i + 5 + Math.floor(Math.random() * 5), candles.length - 1);
    const exitCandle = candles[exitIndex];
    if (!exitCandle) continue;

    // Calculate P/L
    const entryPrice = entryCandle.close;
    const exitPrice = exitCandle.close;
    const stake = 10;
    const multiplier = 100;

    let pnl: number;
    if (direction === 'CALL') {
      pnl = ((exitPrice - entryPrice) / entryPrice) * stake * multiplier;
    } else {
      pnl = ((entryPrice - exitPrice) / entryPrice) * stake * multiplier;
    }

    const isWin = pnl > 0;
    const exitReason = isWin ? 'TP' : 'SL';

    // Simulate some latency for demo feel
    const latencyMs = Math.floor(Math.random() * 300) + 50;
    const slippage = (Math.random() - 0.5) * 0.001 * entryPrice;
    const executedEntry = entryPrice + slippage;

    const rsiVal = rsi[i] ?? 50;
    const bbUpperVal = bb.upper[i] ?? entryCandle.close;
    const bbMiddleVal = bb.middle[i] ?? entryCandle.close;
    const bbLowerVal = bb.lower[i] ?? entryCandle.close;

    const signalSnapshot = createSnapshot(entryCandle, i, {
      rsi: rsiVal,
      bbUpper: bbUpperVal,
      bbMiddle: bbMiddleVal,
      bbLower: bbLowerVal,
      squeezeOn: Math.random() > 0.5,
    });

    const entrySnapshot = createSnapshot(entryCandle, i, {
      rsi: rsiVal + (Math.random() - 0.5) * 2,
      bbUpper: bbUpperVal,
      bbMiddle: bbMiddleVal,
      bbLower: bbLowerVal,
      squeezeOn: signalSnapshot.indicators.squeezeOn,
    });
    entrySnapshot.timestamp += latencyMs;

    const exitRsi = rsi[exitIndex] ?? 50;
    const exitBbUpper = bb.upper[exitIndex] ?? exitCandle.close;
    const exitBbMiddle = bb.middle[exitIndex] ?? exitCandle.close;
    const exitBbLower = bb.lower[exitIndex] ?? exitCandle.close;

    const exitSnapshot = createSnapshot(exitCandle, exitIndex, {
      rsi: exitRsi,
      bbUpper: exitBbUpper,
      bbMiddle: exitBbMiddle,
      bbLower: exitBbLower,
      squeezeOn: Math.random() > 0.6,
    });

    trades.push({
      id: `trade_${tradeId++}`,
      asset: 'R_100',
      direction,
      source: 'backtest',
      correlationId: `corr_${tradeId}`,
      signal: {
        snapshot: signalSnapshot,
        direction,
        confidence: 70 + Math.floor(Math.random() * 25),
        reason:
          direction === 'CALL'
            ? `RSI oversold (${rsiVal.toFixed(1)}) + price near BB lower`
            : `RSI overbought (${rsiVal.toFixed(1)}) + price near BB upper`,
        strategyName: 'BB-Squeeze',
        strategyVersion: '2.0.0',
      },
      entry: {
        snapshot: entrySnapshot,
        requestedPrice: entryPrice,
        executedPrice: executedEntry,
        latencyMs,
        slippage,
        slippagePct: slippage / entryPrice,
        stake,
        tpPrice: direction === 'CALL' ? entryPrice * 1.005 : entryPrice * 0.995,
        slPrice: direction === 'CALL' ? entryPrice * 0.997 : entryPrice * 1.003,
        tpPct: 0.005,
        slPct: 0.003,
      },
      exit: {
        snapshot: exitSnapshot,
        reason: exitReason as 'TP' | 'SL',
        executedPrice: exitPrice,
        durationMs: (exitCandle.timestamp - entryCandle.timestamp) * 1000,
      },
      result: {
        pnl,
        pnlPct: pnl / stake,
        outcome: isWin ? 'WIN' : 'LOSS',
        maxFavorable: Math.abs(pnl) * (1 + Math.random() * 0.5),
        maxFavorablePct: Math.abs(pnl / stake) * (1 + Math.random() * 0.5),
        maxAdverse: Math.abs(pnl) * Math.random() * 0.5,
        maxAdversePct: Math.abs(pnl / stake) * Math.random() * 0.5,
      },
    });
  }

  return trades;
}

// Main
async function main() {
  console.log('Generating sample chart...');

  // Generate mock data
  const candles = generateMockCandles(200, 1000);
  const rsi = calculateRSI(candles);
  const bb = calculateBB(candles);
  const squeezeHistogram = generateSqueezeHistogram(candles);

  // Generate trades
  const trades = generateMockTrades(candles, rsi, bb);

  console.log(`Generated ${candles.length} candles and ${trades.length} trades`);

  // Create visualization data
  const vizData = createVisualizationData('R_100', 60, candles, trades, {
    rsi,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    squeezeHistogram,
  });

  // Generate HTML
  const html = generateChartHTML(vizData, {
    title: 'BB Squeeze Backtest - R_100 (Sample Data)',
    theme: 'dark',
    showIndicators: ['rsi', 'bbands', 'squeeze'],
    width: 1400,
    height: 900,
  });

  // Write to file
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'sample-backtest-chart.html');
  fs.writeFileSync(outputPath, html);

  console.log(`\nChart generated successfully!`);
  console.log(`Open in browser: ${outputPath}`);
  console.log(`\nSummary:`);
  console.log(`  - Trades: ${vizData.summary.totalTrades}`);
  console.log(`  - Win Rate: ${(vizData.summary.winRate * 100).toFixed(1)}%`);
  console.log(`  - P/L: $${vizData.summary.totalPnl.toFixed(2)}`);
  console.log(`  - Profit Factor: ${vizData.summary.profitFactor.toFixed(2)}`);
}

main().catch(console.error);
