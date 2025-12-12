#!/usr/bin/env npx tsx
/**
 * Generate backtest chart for NFI strategy
 * Uses the existing visualization system from @deriv-bot/shared
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { generateChartHTML, createVisualizationData } from '@deriv-bot/shared';
import type { TradeWithContext, MarketSnapshot, IndicatorSnapshot } from '@deriv-bot/shared';
import { getParamsForAsset } from '../strategies/nfi/nfi.params.js';
import { NFI_ETH_OPTIMIZED } from '../strategies/nfi/nfi-optimized.params.js';
import type { NFIParams } from '../strategies/nfi/nfi.types.js';

// @ts-ignore
import * as ti from 'technicalindicators';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const DAYS_TO_SHOW = parseInt(process.env.DAYS ?? '3', 10);
const ASSET = process.env.ASSET ?? 'cryETHUSD';
const dataDir = path.join(process.cwd(), 'data');

interface CapturedTrade {
  entryIndex: number;
  exitIndex: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
  pnl: number;
  pnlPct: number;
  stake: number;
  entryTag: string;
  barsHeld: number;
}

interface IndicatorSeries {
  rsi_14: (number | undefined)[];
  ema_50: (number | undefined)[];
  ema_200: (number | undefined)[];
  bb_upper: (number | undefined)[];
  bb_middle: (number | undefined)[];
  bb_lower: (number | undefined)[];
  stoch_k: (number | undefined)[];
  stoch_d: (number | undefined)[];
  ewo: (number | undefined)[];
}

// Load CSV
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

// Calculate all indicators
function calculateIndicators(candles: Candle[]): IndicatorSeries {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // RSI
  const rsi = ti.RSI.calculate({ values: closes, period: 14 });
  const rsiPadded = Array(14).fill(undefined).concat(rsi);

  // EMAs
  const ema50 = ti.EMA.calculate({ values: closes, period: 50 });
  const ema50Padded = Array(49).fill(undefined).concat(ema50);

  const ema200 = ti.EMA.calculate({ values: closes, period: 200 });
  const ema200Padded = Array(199).fill(undefined).concat(ema200);

  // Bollinger Bands
  const bb = ti.BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });
  const bbPadded = Array(19).fill({ upper: undefined, middle: undefined, lower: undefined }).concat(bb);

  // Stochastic RSI
  const stochRsi = ti.StochasticRSI.calculate({
    values: closes,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3,
  });
  const stochPadded = Array(candles.length - stochRsi.length).fill({ k: undefined, d: undefined }).concat(stochRsi);

  // EWO (Elliott Wave Oscillator) - difference between fast and slow EMA
  const ema5 = ti.EMA.calculate({ values: closes, period: 5 });
  const ema35 = ti.EMA.calculate({ values: closes, period: 35 });
  const ewoValues: (number | undefined)[] = [];
  for (let i = 0; i < candles.length; i++) {
    const e5 = ema5[i - 4];
    const e35 = ema35[i - 34];
    if (e5 !== undefined && e35 !== undefined) {
      ewoValues.push(((e5 - e35) / closes[i]!) * 100);
    } else {
      ewoValues.push(undefined);
    }
  }

  return {
    rsi_14: rsiPadded,
    ema_50: ema50Padded,
    ema_200: ema200Padded,
    bb_upper: bbPadded.map((b: any) => b?.upper),
    bb_middle: bbPadded.map((b: any) => b?.middle),
    bb_lower: bbPadded.map((b: any) => b?.lower),
    stoch_k: stochPadded.map((s: any) => s?.k),
    stoch_d: stochPadded.map((s: any) => s?.d),
    ewo: ewoValues,
  };
}

// NFI entry conditions (simplified for visualization)
function checkNFIEntry(
  i: number,
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams
): { triggered: boolean; tag: string } | null {
  const rsi = series.rsi_14[i];
  const ema50 = series.ema_50[i];
  const ema200 = series.ema_200[i];
  const bbLower = series.bb_lower[i];
  const bbMiddle = series.bb_middle[i];
  const close = candles[i]!.close;
  const ewo = series.ewo[i];

  if (!rsi || !ema50 || !bbLower || !bbMiddle || ewo === undefined) return null;

  // Condition 1: Strong oversold with EWO bullish
  if (rsi < params.rsi.oversold && ewo < -2 && close < bbLower) {
    return { triggered: true, tag: '1' };
  }

  // Condition 4: RSI dip with BB touch
  if (rsi < 28 && close < bbLower * 1.002) {
    return { triggered: true, tag: '4' };
  }

  // Condition 10: Moderate oversold
  if (rsi < 32 && close < bbMiddle && ewo < 0) {
    return { triggered: true, tag: '10' };
  }

  // Condition 12: Quick scalp entry
  if (rsi < 35 && close < bbMiddle) {
    return { triggered: true, tag: '12' };
  }

  // Condition 41: Fast entry
  if (rsi < 30 && close < bbLower * 1.01) {
    return { triggered: true, tag: '41' };
  }

  // Condition 44: Momentum entry
  if (rsi < 28 && ewo < -4) {
    return { triggered: true, tag: '44' };
  }

  // Condition 102: Rapid entry
  if (rsi < 25) {
    return { triggered: true, tag: '102' };
  }

  // Condition 141: Top coin dip
  if (ema200 && close < ema200 && rsi < 40 && ewo < -1) {
    return { triggered: true, tag: '141' };
  }

  return null;
}

// Run backtest
function runBacktest(
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams
): CapturedTrade[] {
  const trades: CapturedTrade[] = [];
  let cooldownUntil = 0;
  const maxBarsInTrade = params.risk?.maxBarsInTrade ?? 72;
  const cooldownBars = params.risk?.cooldownBars ?? 6;
  const slPct = params.stopLoss.percentage * 100;
  let equity = INITIAL_CAPITAL;

  for (let i = 200; i < candles.length; i++) {
    if (i < cooldownUntil) continue;

    const entry = checkNFIEntry(i, candles, series, params);
    if (!entry?.triggered) continue;

    const entryPrice = candles[i]!.close;
    const stake = equity * STAKE_PCT;
    const slPrice = entryPrice * (1 - slPct / 100);

    let exitIndex = i;
    let exitPrice = entryPrice;
    let exitReason = 'TIME_LIMIT';
    let outcome: 'WIN' | 'LOSS' = 'LOSS';

    // Check ROI and SL
    for (let j = i + 1; j < Math.min(i + maxBarsInTrade + 1, candles.length); j++) {
      const candle = candles[j]!;
      const barsHeld = j - i;
      const currentPnlPct = ((candle.close - entryPrice) / entryPrice) * 100;

      // Stop Loss
      if (candle.low <= slPrice) {
        exitIndex = j;
        exitPrice = slPrice;
        exitReason = `STOP_LOSS`;
        outcome = 'LOSS';
        break;
      }

      // Dynamic ROI check
      let roiTarget = 3.0; // Default
      if (barsHeld >= 48) roiTarget = 0.8;      // 4h
      else if (barsHeld >= 24) roiTarget = 1.0; // 2h
      else if (barsHeld >= 12) roiTarget = 1.2; // 1h
      else if (barsHeld >= 6) roiTarget = 1.5;  // 30min
      else if (barsHeld >= 3) roiTarget = 2.0;  // 15min

      if (currentPnlPct >= roiTarget) {
        exitIndex = j;
        exitPrice = candle.close;
        exitReason = `ROI_${barsHeld * 5}min`;
        outcome = 'WIN';
        break;
      }
    }

    // Timeout exit
    if (exitIndex === i) {
      exitIndex = Math.min(i + maxBarsInTrade, candles.length - 1);
      exitPrice = candles[exitIndex]!.close;
      outcome = exitPrice >= entryPrice ? 'WIN' : 'LOSS';
    }

    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const pnl = pnlPct > 0 ? stake * MULTIPLIER * (pnlPct / 100) : -stake * MULTIPLIER * (Math.abs(pnlPct) / 100);

    trades.push({
      entryIndex: i,
      exitIndex,
      direction: 'CALL',
      entryPrice,
      exitPrice,
      outcome,
      exitReason,
      pnl,
      pnlPct,
      stake,
      entryTag: entry.tag,
      barsHeld: exitIndex - i,
    });

    equity += pnl;
    cooldownUntil = exitIndex + cooldownBars;
  }

  return trades;
}

// Convert trade to TradeWithContext
function convertToTradeWithContext(
  trade: CapturedTrade,
  candles: Candle[],
  series: IndicatorSeries,
  asset: string
): TradeWithContext {
  const entryCandle = candles[trade.entryIndex]!;
  const exitCandle = candles[trade.exitIndex]!;

  const entryIndicators: IndicatorSnapshot = {
    rsi: series.rsi_14[trade.entryIndex],
    bbUpper: series.bb_upper[trade.entryIndex],
    bbMiddle: series.bb_middle[trade.entryIndex],
    bbLower: series.bb_lower[trade.entryIndex],
  };

  const exitIndicators: IndicatorSnapshot = {
    rsi: series.rsi_14[trade.exitIndex],
    bbUpper: series.bb_upper[trade.exitIndex],
    bbMiddle: series.bb_middle[trade.exitIndex],
    bbLower: series.bb_lower[trade.exitIndex],
  };

  const entrySnapshot: MarketSnapshot = {
    timestamp: entryCandle.timestamp * 1000,
    candle: {
      index: trade.entryIndex,
      timestamp: entryCandle.timestamp,
      open: entryCandle.open,
      high: entryCandle.high,
      low: entryCandle.low,
      close: entryCandle.close,
    },
    price: trade.entryPrice,
    indicators: entryIndicators,
  };

  const exitSnapshot: MarketSnapshot = {
    timestamp: exitCandle.timestamp * 1000,
    candle: {
      index: trade.exitIndex,
      timestamp: exitCandle.timestamp,
      open: exitCandle.open,
      high: exitCandle.high,
      low: exitCandle.low,
      close: exitCandle.close,
    },
    price: trade.exitPrice,
    indicators: exitIndicators,
  };

  return {
    id: `nfi-${trade.entryIndex}`,
    asset,
    direction: trade.direction,
    source: 'backtest',
    correlationId: `nfi-${trade.entryIndex}`,
    signal: {
      snapshot: entrySnapshot,
      direction: trade.direction,
      confidence: 50,
      reason: `NFI Entry Tag ${trade.entryTag}`,
      strategyName: 'NostalgiaForInfinity',
    },
    entry: {
      snapshot: entrySnapshot,
      requestedPrice: trade.entryPrice,
      executedPrice: trade.entryPrice,
      latencyMs: 0,
      slippage: 0,
      slippagePct: 0,
      stake: trade.stake,
      tpPrice: 0,
      slPrice: 0,
      tpPct: 0,
      slPct: 0,
    },
    exit: {
      snapshot: exitSnapshot,
      reason: trade.exitReason as any,
      executedPrice: trade.exitPrice,
      durationMs: (exitCandle.timestamp - entryCandle.timestamp) * 1000,
    },
    result: {
      pnl: trade.pnl,
      pnlPct: trade.pnlPct,
      outcome: trade.outcome,
      maxFavorable: 0,
      maxFavorablePct: 0,
      maxAdverse: 0,
      maxAdversePct: 0,
    },
  };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  NFI CHART GENERATOR');
  console.log('═'.repeat(70));
  console.log(`  Asset: ${ASSET} | Days: ${DAYS_TO_SHOW}`);
  console.log('═'.repeat(70));

  const filepath = path.join(dataDir, `${ASSET}_1m_90d.csv`);
  if (!fs.existsSync(filepath)) {
    // Try 30d file
    const filepath30 = path.join(dataDir, `${ASSET}_1m_30d.csv`);
    if (!fs.existsSync(filepath30)) {
      console.error(`Data file not found: ${filepath}`);
      process.exit(1);
    }
  }

  console.log('\n📥 Loading candles...');
  const allCandles = loadCandles(fs.existsSync(filepath) ? filepath : path.join(dataDir, `${ASSET}_1m_30d.csv`));
  console.log(`   Loaded ${allCandles.length.toLocaleString()} candles`);

  // Aggregate to 5m
  const candles5m: Candle[] = [];
  for (let i = 0; i < allCandles.length; i += 5) {
    const chunk = allCandles.slice(i, i + 5);
    if (chunk.length === 5) {
      candles5m.push({
        timestamp: chunk[0]!.timestamp,
        open: chunk[0]!.open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[4]!.close,
        volume: chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0),
      });
    }
  }
  console.log(`   Aggregated to ${candles5m.length.toLocaleString()} 5m candles`);

  // Filter last N days (5m candles = N * 24 * 12 candles per day)
  const candlesPerDay = 24 * 12;
  const candlesToShow = Math.min(DAYS_TO_SHOW * candlesPerDay, candles5m.length);
  const startIndex = Math.max(0, candles5m.length - candlesToShow);
  const candles = candles5m.slice(startIndex);

  console.log(`\n📊 Showing last ${DAYS_TO_SHOW} days:`);
  console.log(`   From: ${new Date(candles[0]!.timestamp * 1000).toISOString()}`);
  console.log(`   To: ${new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString()}`);
  console.log(`   Candles: ${candles.length}`);

  // Get params
  const params = getParamsForAsset(ASSET, NFI_ETH_OPTIMIZED);

  // Calculate indicators
  console.log('\n🔧 Calculating indicators...');
  const series = calculateIndicators(candles);

  // Run backtest
  console.log('🚀 Running backtest...');
  const trades = runBacktest(candles, series, params);

  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  console.log(`\n📋 Results:`);
  console.log(`   Trades: ${trades.length}`);
  console.log(`   Wins: ${wins} | Losses: ${trades.length - wins}`);
  console.log(`   Win Rate: ${trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : 0}%`);
  console.log(`   Net P&L: $${netPnl.toFixed(2)}`);

  // Convert to TradeWithContext
  const tradesWithContext = trades.map(t => convertToTradeWithContext(t, candles, series, ASSET));

  // Prepare indicator arrays for visualization
  const rsiArray = series.rsi_14.map(v => v ?? 50);
  const bbUpperArray = series.bb_upper.map((v, i) => v ?? candles[i]?.close ?? 0);
  const bbMiddleArray = series.bb_middle.map((v, i) => v ?? candles[i]?.close ?? 0);
  const bbLowerArray = series.bb_lower.map((v, i) => v ?? candles[i]?.close ?? 0);

  // Create visualization data
  const vizData = createVisualizationData(
    ASSET,
    300, // 5 minutes in seconds
    candles,
    tradesWithContext,
    {
      rsi: rsiArray,
      bbUpper: bbUpperArray,
      bbMiddle: bbMiddleArray,
      bbLower: bbLowerArray,
    }
  );

  // Generate HTML
  const html = generateChartHTML(vizData, {
    title: `NFI Strategy - ${ASSET} - Last ${DAYS_TO_SHOW} Days`,
    theme: 'dark',
    width: 1600,
    height: 1000,
    showIndicators: ['rsi', 'bbands'],
  });

  // Save
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(outputDir, `nfi-${ASSET}-${DAYS_TO_SHOW}d-${timestamp}.html`);
  fs.writeFileSync(outputPath, html);

  console.log(`\n✅ Chart saved to: ${outputPath}`);
  console.log('\n🌐 Open in browser to view the chart!');

  // Print trade details
  console.log('\n📋 TRADE DETAILS:');
  console.log('─'.repeat(70));
  trades.forEach((t, idx) => {
    const icon = t.outcome === 'WIN' ? '✅' : '❌';
    const date = new Date(candles[t.entryIndex]!.timestamp * 1000).toLocaleString();
    console.log(`${icon} #${idx + 1} | ${date} | ${t.direction} @ $${t.entryPrice.toFixed(2)} | Exit: ${t.exitReason} | ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} | Tag: ${t.entryTag}`);
  });
}

main().catch(console.error);
