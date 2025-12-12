#!/usr/bin/env npx tsx
/**
 * NFI Chart Export - Exports trades with candle data for charting
 *
 * Generates a JSON file with candles and trade markers for visualization.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { getParamsForAsset, DEFAULT_NFI_PARAMS } from '../strategies/nfi/nfi.params.js';
import { NFI_ETH_OPTIMIZED } from '../strategies/nfi/nfi-optimized.params.js';
import type { NFIParams, NFIIndicators } from '../strategies/nfi/nfi.types.js';
import { checkEntryConditions, getBestEntryCondition } from '../strategies/nfi/entry-conditions.js';

// @ts-ignore
import * as ti from 'technicalindicators';

const RSI = ti.RSI;
const EMA = ti.EMA;
const SMA = ti.SMA;
const BollingerBands = ti.BollingerBands;
const Stochastic = ti.Stochastic;

const ASSET = process.env.ASSET ?? 'cryETHUSD';
const LAST_DAYS = parseInt(process.env.LAST_DAYS ?? '3', 10);
const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;

interface TradeMarker {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  direction: 'CALL' | 'PUT';
  pnl: number;
  pnlPct: number;
  exitReason: string;
  entryTag: string;
  barsHeld: number;
  win: boolean;
}

interface ChartData {
  asset: string;
  timeframe: string;
  period: { start: string; end: string };
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    rsi: number;
    ema_50: number;
    ema_200: number;
    bb_upper: number;
    bb_middle: number;
    bb_lower: number;
  }>;
  trades: TradeMarker[];
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnl: number;
  };
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  NFI CHART EXPORT');
  console.log('═'.repeat(60));
  console.log(`  Asset: ${ASSET} | Last ${LAST_DAYS} days`);
  console.log('═'.repeat(60));
  console.log('');

  // Load 30-day data (we have this)
  const dataPath = path.join(process.cwd(), 'data', `${ASSET}_1m_30d.csv`);
  if (!fs.existsSync(dataPath)) {
    console.log(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  const candles1m = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    volumeColumn: 'volume',
    timestampFormat: 'unix_ms',
  });

  // Resample to 5m
  const allCandles = resampleCandles(candles1m, 5);
  console.log(`📥 Loaded ${allCandles.length} candles (5m)`);

  // Get last N days of candles
  const barsPerDay = 288; // 24h * 60min / 5min
  const lastNBars = LAST_DAYS * barsPerDay;

  // We need extra warmup bars for indicators
  const warmupBars = 250;
  const startIdx = Math.max(0, allCandles.length - lastNBars - warmupBars);
  const candles = allCandles.slice(startIdx);

  console.log(`📊 Using last ${candles.length} candles for analysis`);

  // Calculate indicators
  console.log('🔧 Calculating indicators...');
  const series = preCalculateIndicators(candles);

  // Get params
  const params = getParamsForAsset(ASSET, NFI_ETH_OPTIMIZED);

  // Run simulation
  console.log('🚀 Running simulation...');
  const trades = runSimulation(candles, series, params);
  console.log(`   Found ${trades.length} trades`);

  // Prepare chart data (only last N days of candles, not warmup)
  const chartStartIdx = Math.max(0, candles.length - lastNBars);
  const chartCandles = candles.slice(chartStartIdx);
  const chartSeriesOffset = chartStartIdx;

  const chartData: ChartData = {
    asset: ASSET,
    timeframe: '5m',
    period: {
      start: new Date(chartCandles[0]!.timestamp * 1000).toISOString(),
      end: new Date(chartCandles[chartCandles.length - 1]!.timestamp * 1000).toISOString(),
    },
    candles: chartCandles.map((c, idx) => {
      const globalIdx = chartStartIdx + idx;
      return {
        timestamp: c.timestamp * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
        rsi: series.rsi_14[globalIdx] ?? 50,
        ema_50: series.ema_50[globalIdx] ?? c.close,
        ema_200: series.ema_200[globalIdx] ?? c.close,
        bb_upper: series.bb_upper[globalIdx] ?? c.close,
        bb_middle: series.bb_middle[globalIdx] ?? c.close,
        bb_lower: series.bb_lower[globalIdx] ?? c.close,
      };
    }),
    trades: trades.filter(t => {
      // Only include trades within the chart period
      const chartStartTime = chartCandles[0]!.timestamp * 1000;
      return t.entryTime >= chartStartTime;
    }),
    summary: {
      totalTrades: trades.length,
      wins: trades.filter(t => t.win).length,
      losses: trades.filter(t => !t.win).length,
      winRate: trades.length > 0 ? (trades.filter(t => t.win).length / trades.length) * 100 : 0,
      netPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
    },
  };

  // Filter trades to only those in chart period
  const chartTrades = chartData.trades;
  chartData.summary = {
    totalTrades: chartTrades.length,
    wins: chartTrades.filter(t => t.win).length,
    losses: chartTrades.filter(t => !t.win).length,
    winRate: chartTrades.length > 0 ? (chartTrades.filter(t => t.win).length / chartTrades.length) * 100 : 0,
    netPnl: chartTrades.reduce((sum, t) => sum + t.pnl, 0),
  };

  // Save to file
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `nfi-chart-${ASSET}-${LAST_DAYS}d.json`);
  fs.writeFileSync(outputPath, JSON.stringify(chartData, null, 2));

  console.log('');
  console.log('═'.repeat(60));
  console.log('  CHART DATA SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Period: ${chartData.period.start.split('T')[0]} → ${chartData.period.end.split('T')[0]}`);
  console.log(`  Candles: ${chartData.candles.length}`);
  console.log(`  Trades: ${chartData.summary.totalTrades} (${chartData.summary.wins}W / ${chartData.summary.losses}L)`);
  console.log(`  Win Rate: ${chartData.summary.winRate.toFixed(1)}%`);
  console.log(`  Net P&L: $${chartData.summary.netPnl.toFixed(2)}`);
  console.log('═'.repeat(60));
  console.log('');

  // Print trade details
  console.log('📋 TRADE DETAILS:');
  console.log('─'.repeat(60));

  for (const trade of chartTrades.slice(0, 20)) {
    const entryDate = new Date(trade.entryTime).toLocaleString();
    const status = trade.win ? '✅' : '❌';
    const pnlStr = trade.pnl >= 0 ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`;

    console.log(
      `${status} ${entryDate} | ${trade.direction} @ $${trade.entryPrice.toFixed(2)} | ` +
      `Exit: ${trade.exitReason.split(' ')[0]} | ${pnlStr} | Tag: ${trade.entryTag}`
    );
  }

  if (chartTrades.length > 20) {
    console.log(`   ... and ${chartTrades.length - 20} more trades`);
  }

  console.log('');
  console.log(`💾 Chart data saved to: ${outputPath}`);
  console.log('');
  console.log('✅ Export complete!');
}

function resampleCandles(candles: Candle[], factor: number): Candle[] {
  const resampled: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    const firstCandle = chunk[0]!;
    const lastCandle = chunk[chunk.length - 1]!;
    resampled.push({
      open: firstCandle.open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: lastCandle.close,
      volume: chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0),
      timestamp: lastCandle.timestamp,
      asset: firstCandle.asset,
      timeframe: (firstCandle.timeframe ?? 60) * factor,
    });
  }
  return resampled;
}

function preCalculateIndicators(candles: Candle[]): any {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume ?? 0);

  const series: any = {
    rsi_3: new Array(n).fill(50),
    rsi_14: new Array(n).fill(50),
    ema_12: new Array(n).fill(closes[0]),
    ema_26: new Array(n).fill(closes[0]),
    ema_50: new Array(n).fill(closes[0]),
    ema_200: new Array(n).fill(closes[0]),
    sma_9: new Array(n).fill(closes[0]),
    sma_200: new Array(n).fill(closes[0]),
    bb_upper: new Array(n).fill(closes[0]),
    bb_middle: new Array(n).fill(closes[0]),
    bb_lower: new Array(n).fill(closes[0]),
    bb_width: new Array(n).fill(0),
    stoch_k: new Array(n).fill(50),
    stoch_d: new Array(n).fill(50),
    ewo: new Array(n).fill(0),
    cti: new Array(n).fill(0),
    cmf: new Array(n).fill(0),
    mfi: new Array(n).fill(50),
    williams_r: new Array(n).fill(-50),
    cci: new Array(n).fill(0),
    roc_2: new Array(n).fill(0),
    roc_9: new Array(n).fill(0),
    rsi_14_1h: new Array(n).fill(50),
    ema_200_1h: new Array(n).fill(closes[0]),
  };

  // RSI
  const rsi3Values = RSI.calculate({ values: closes, period: 3 });
  const rsi14Values = RSI.calculate({ values: closes, period: 14 });
  for (let i = 0; i < rsi3Values.length; i++) series.rsi_3[i + 3] = rsi3Values[i]!;
  for (let i = 0; i < rsi14Values.length; i++) series.rsi_14[i + 14] = rsi14Values[i]!;

  // EMAs
  const ema12 = EMA.calculate({ values: closes, period: 12 });
  const ema26 = EMA.calculate({ values: closes, period: 26 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });
  for (let i = 0; i < ema12.length; i++) series.ema_12[i + 11] = ema12[i]!;
  for (let i = 0; i < ema26.length; i++) series.ema_26[i + 25] = ema26[i]!;
  for (let i = 0; i < ema50.length; i++) series.ema_50[i + 49] = ema50[i]!;
  for (let i = 0; i < ema200.length; i++) series.ema_200[i + 199] = ema200[i]!;

  // SMAs
  const sma9 = SMA.calculate({ values: closes, period: 9 });
  const sma200 = SMA.calculate({ values: closes, period: 200 });
  for (let i = 0; i < sma9.length; i++) series.sma_9[i + 8] = sma9[i]!;
  for (let i = 0; i < sma200.length; i++) series.sma_200[i + 199] = sma200[i]!;

  // BB
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  for (let i = 0; i < bb.length; i++) {
    series.bb_upper[i + 19] = bb[i]!.upper;
    series.bb_middle[i + 19] = bb[i]!.middle;
    series.bb_lower[i + 19] = bb[i]!.lower;
    series.bb_width[i + 19] = bb[i]!.middle > 0 ? (bb[i]!.upper - bb[i]!.lower) / bb[i]!.middle : 0;
  }

  // Stoch
  const stoch = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  for (let i = 0; i < stoch.length; i++) {
    series.stoch_k[i + 15] = stoch[i]!.k;
    series.stoch_d[i + 15] = stoch[i]!.d;
  }

  // EWO, CTI, CMF
  const ema5 = EMA.calculate({ values: closes, period: 5 });
  const ema35 = EMA.calculate({ values: closes, period: 35 });
  for (let i = 34; i < n; i++) {
    const idx5 = i - 4;
    const idx35 = i - 34;
    if (idx5 >= 0 && idx5 < ema5.length && idx35 >= 0 && idx35 < ema35.length) {
      series.ewo[i] = closes[i]! > 0 ? ((ema5[idx5]! - ema35[idx35]!) / closes[i]!) * 100 : 0;
    }
  }

  for (let i = 20; i < n; i++) {
    const slice = closes.slice(i - 20, i);
    const meanP = slice.reduce((a, b) => a + b, 0) / 20;
    const times = Array.from({ length: 20 }, (_, j) => j + 1);
    const meanT = times.reduce((a, b) => a + b, 0) / 20;
    let num = 0, denomP = 0, denomT = 0;
    for (let j = 0; j < 20; j++) {
      const pd = slice[j]! - meanP;
      const td = times[j]! - meanT;
      num += pd * td;
      denomP += pd * pd;
      denomT += td * td;
    }
    series.cti[i] = Math.sqrt(denomP * denomT) === 0 ? 0 : num / Math.sqrt(denomP * denomT);

    const candleSlice = candles.slice(i - 20, i);
    let mfvSum = 0, volSum = 0;
    for (const c of candleSlice) {
      const hl = c.high - c.low;
      if (hl === 0) continue;
      const vol = c.volume ?? 0;
      mfvSum += ((c.close - c.low) - (c.high - c.close)) / hl * vol;
      volSum += vol;
    }
    series.cmf[i] = volSum === 0 ? 0 : mfvSum / volSum;
  }

  return series;
}

function runSimulation(candles: Candle[], series: any, params: NFIParams): TradeMarker[] {
  const trades: TradeMarker[] = [];
  const warmup = 250;
  const cooldownBars = params.risk.cooldownBars;
  const maxBarsInTrade = params.risk.maxBarsInTrade;
  const slPct = params.stopLoss.percentage;
  const roiTimes = Object.keys(params.dynamicROI).map(Number).sort((a, b) => b - a);

  let position: { entryIndex: number; entryPrice: number; direction: 'CALL' | 'PUT'; entryTag: string } | null = null;
  let lastExitBar = -cooldownBars;

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i]!;

    if (position) {
      const barsHeld = i - position.entryIndex;
      const minutesHeld = barsHeld * 5;

      const pnlPct = position.direction === 'CALL'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;

      let shouldExit = false;
      let exitReason = '';

      // Stop Loss
      if (pnlPct <= -slPct * 100) {
        shouldExit = true;
        exitReason = `STOP_LOSS (${pnlPct.toFixed(2)}%)`;
      }

      // Dynamic ROI
      if (!shouldExit) {
        for (const time of roiTimes) {
          if (minutesHeld >= time) {
            const target = params.dynamicROI[time]!;
            if (pnlPct >= target) {
              shouldExit = true;
              exitReason = `ROI_${time}min (${pnlPct.toFixed(2)}%)`;
            }
            break;
          }
        }
      }

      // Time limit
      if (!shouldExit && barsHeld >= maxBarsInTrade) {
        shouldExit = true;
        exitReason = `TIME_LIMIT (${barsHeld} bars)`;
      }

      if (shouldExit) {
        const pnl = (INITIAL_CAPITAL * STAKE_PCT * MULTIPLIER) * (pnlPct / 100);
        trades.push({
          entryTime: candles[position.entryIndex]!.timestamp * 1000,
          entryPrice: position.entryPrice,
          exitTime: candle.timestamp * 1000,
          exitPrice: candle.close,
          direction: position.direction,
          pnl,
          pnlPct,
          exitReason,
          entryTag: position.entryTag,
          barsHeld,
          win: pnl > 0,
        });
        lastExitBar = i;
        position = null;
      }
    } else {
      if (i - lastExitBar < cooldownBars) continue;

      const indicators = getIndicatorsAtIndex(i, candles, series);
      const conditions = checkEntryConditions(candle, indicators, params, 'CALL');
      const bestCondition = getBestEntryCondition(conditions);

      if (bestCondition) {
        position = {
          entryIndex: i,
          entryPrice: candle.close,
          direction: bestCondition.tag.startsWith('short') ? 'PUT' : 'CALL',
          entryTag: bestCondition.tag,
        };
      }
    }
  }

  return trades;
}

function getIndicatorsAtIndex(i: number, candles: Candle[], series: any): NFIIndicators {
  const candle = candles[i]!;
  const prevCandle = candles[Math.max(0, i - 1)]!;
  const lookback = 12;
  let pump = false, dump = false;
  if (i >= lookback) {
    const change = (candle.close - candles[i - lookback]!.close) / candles[i - lookback]!.close;
    pump = change > 0.03;
    dump = change < -0.03;
  }

  return {
    rsi_3: series.rsi_3[i],
    rsi_14: series.rsi_14[i],
    rsi_3_change: i > 0 ? series.rsi_3[i] - series.rsi_3[i - 1] : 0,
    stoch_rsi_k: series.stoch_k[i],
    stoch_rsi_d: series.stoch_d[i],
    ema_12: series.ema_12[i],
    ema_26: series.ema_26[i],
    ema_50: series.ema_50[i],
    ema_200: series.ema_200[i],
    sma_9: series.sma_9[i],
    sma_200: series.sma_200[i],
    bb_upper: series.bb_upper[i],
    bb_middle: series.bb_middle[i],
    bb_lower: series.bb_lower[i],
    bb_width: series.bb_width[i],
    bb_delta: series.bb_middle[i] - series.bb_lower[i],
    close_delta: candle.close - prevCandle.close,
    tail: Math.abs(candle.close - candle.low),
    ewo: series.ewo[i],
    cti: series.cti[i],
    cmf: series.cmf[i],
    mfi: series.mfi[i] ?? 50,
    williams_r: series.williams_r[i] ?? -50,
    cci: series.cci[i] ?? 0,
    roc_2: series.roc_2[i] ?? 0,
    roc_9: series.roc_9[i] ?? 0,
    rsi_3_15m: series.rsi_3[i],
    rsi_14_15m: series.rsi_14[i],
    ema_200_15m: series.ema_200[i],
    cti_15m: series.cti[i],
    cmf_15m: series.cmf[i],
    rsi_3_1h: series.rsi_14[i],
    rsi_14_1h: series.rsi_14[i],
    ema_50_1h: series.ema_200[i],
    ema_200_1h: series.ema_200[i],
    cti_1h: series.cti[i],
    cmf_1h: series.cmf[i],
    ssl_up_1h: candle.close,
    ssl_down_1h: candle.close,
    rsi_14_4h: series.rsi_14[i],
    ema_200_4h: series.ema_200[i],
    cti_4h: series.cti[i],
    roc_9_4h: series.roc_9[i] ?? 0,
    rsi_14_1d: series.rsi_14[i],
    ema_200_1d: series.ema_200[i],
    cti_1d: series.cti[i],
    is_downtrend: candle.close < series.ema_200[i] && series.ema_50[i] < series.ema_200[i],
    is_uptrend: candle.close > series.ema_200[i] && series.ema_50[i] > series.ema_200[i],
    pump_detected: pump,
    dump_detected: dump,
  };
}

main().catch(console.error);
