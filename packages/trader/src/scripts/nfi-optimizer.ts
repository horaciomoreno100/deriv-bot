#!/usr/bin/env npx tsx
/**
 * NFI Strategy Parameter Optimizer
 *
 * Tests different SL/TP combinations to find optimal parameters.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { getParamsForAsset, DEFAULT_NFI_PARAMS } from '../strategies/nfi/nfi.params.js';
import type { NFIParams, NFIIndicators, NFIDynamicROI } from '../strategies/nfi/nfi.types.js';
import { checkEntryConditions, getBestEntryCondition } from '../strategies/nfi/entry-conditions.js';

// @ts-ignore
import * as ti from 'technicalindicators';

const RSI = ti.RSI;
const EMA = ti.EMA;
const SMA = ti.SMA;
const BollingerBands = ti.BollingerBands;
const Stochastic = ti.Stochastic;
const CCI = ti.CCI;
const WilliamsR = ti.WilliamsR;
const MFI = ti.MFI;
const ROC = ti.ROC;

const ASSET = process.env.ASSET ?? 'cryETHUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;

interface TestResult {
  slPct: number;
  tpPct: number;
  trades: number;
  wins: number;
  winRate: number;
  netPnl: number;
  roi: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  expectancy: number;
  sqn: number;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  NFI PARAMETER OPTIMIZER');
  console.log('═'.repeat(70));
  console.log(`  Asset: ${ASSET} | Days: ${DAYS}`);
  console.log('═'.repeat(70));
  console.log('');

  // Load data
  const dataPath = path.join(process.cwd(), 'data', `${ASSET}_1m_${DAYS}d.csv`);
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

  const candles = resampleCandles(candles1m, 5);
  console.log(`📥 Loaded ${candles.length.toLocaleString()} candles (5m)`);
  console.log('');

  // Pre-calculate indicators
  console.log('🔧 Pre-calculating indicators...');
  const series = preCalculateIndicators(candles);
  console.log('');

  // Test different parameter combinations
  const stopLossOptions = [0.008, 0.01, 0.012, 0.015, 0.018, 0.02, 0.025, 0.03];
  const takeProfitMultipliers = [1.5, 2.0, 2.5, 3.0];  // TP = SL * multiplier

  const results: TestResult[] = [];

  console.log('🔬 Testing parameter combinations...');
  console.log('─'.repeat(70));

  for (const slPct of stopLossOptions) {
    for (const tpMult of takeProfitMultipliers) {
      const tpPct = slPct * tpMult;

      // Create ROI config based on TP
      const dynamicROI: NFIDynamicROI = {
        0: tpPct * 100,
        30: tpPct * 100 * 0.8,
        60: tpPct * 100 * 0.6,
        120: tpPct * 100 * 0.5,
        240: tpPct * 100 * 0.4,
      };

      const testParams: Partial<NFIParams> = {
        stopLoss: {
          percentage: slPct,
          useTrailing: false,
          trailingActivation: 0.01,
          trailingDistance: 0.005,
        },
        dynamicROI,
        exitSignals: {
          rsi_overbought: 90,
          stoch_overbought: 95,
          bb_overbought: false,
          use_signal_exits: false,
        },
        risk: {
          maxOpenTrades: 1,
          maxBarsInTrade: 72,
          cooldownBars: 6,
          maxConsecutiveLosses: 5,
          pauseBarsAfterMaxLosses: 24,
        },
      };

      const params = getParamsForAsset(ASSET, { ...DEFAULT_NFI_PARAMS, ...testParams });
      const trades = runSimulation(candles, series, params);
      const metrics = calculateMetrics(trades);

      results.push({
        slPct: slPct * 100,
        tpPct: tpPct * 100,
        trades: trades.length,
        wins: metrics.wins,
        winRate: metrics.winRate,
        netPnl: metrics.netPnl,
        roi: (metrics.netPnl / INITIAL_CAPITAL) * 100,
        profitFactor: metrics.profitFactor,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        maxDrawdown: metrics.maxDrawdownPct,
        expectancy: metrics.expectancy,
        sqn: metrics.sqn,
      });

      const status = metrics.netPnl > 0 ? '✅' : '❌';
      console.log(
        `${status} SL: ${(slPct * 100).toFixed(1)}% | TP: ${(tpPct * 100).toFixed(1)}% | ` +
        `WR: ${metrics.winRate.toFixed(0)}% | PnL: $${metrics.netPnl.toFixed(0)} | PF: ${metrics.profitFactor.toFixed(2)}`
      );
    }
  }

  // Sort by profit
  results.sort((a, b) => b.netPnl - a.netPnl);

  console.log('');
  console.log('═'.repeat(70));
  console.log('  TOP 10 CONFIGURATIONS');
  console.log('═'.repeat(70));
  console.log('');
  console.log('  SL%   TP%   Trades  WinRate  Net P&L    PF    Exp    SQN');
  console.log('  ' + '-'.repeat(64));

  for (const r of results.slice(0, 10)) {
    const pnlStr = r.netPnl >= 0 ? `+$${r.netPnl.toFixed(0)}` : `-$${Math.abs(r.netPnl).toFixed(0)}`;
    console.log(
      `  ${r.slPct.toFixed(1).padStart(4)}  ${r.tpPct.toFixed(1).padStart(4)}  ${String(r.trades).padStart(6)}  ` +
      `${r.winRate.toFixed(1).padStart(6)}%  ${pnlStr.padStart(8)}  ${r.profitFactor.toFixed(2).padStart(4)}  ` +
      `${r.expectancy.toFixed(2).padStart(5)}  ${r.sqn.toFixed(2).padStart(5)}`
    );
  }

  // Find break-even configs
  const profitable = results.filter(r => r.netPnl > 0);
  console.log('');
  console.log(`📊 Profitable configs: ${profitable.length} / ${results.length}`);

  if (profitable.length > 0) {
    const best = profitable[0]!;
    console.log('');
    console.log('═'.repeat(70));
    console.log('  BEST CONFIGURATION');
    console.log('═'.repeat(70));
    console.log(`  Stop Loss:     ${best.slPct.toFixed(1)}%`);
    console.log(`  Take Profit:   ${best.tpPct.toFixed(1)}%`);
    console.log(`  Win Rate:      ${best.winRate.toFixed(1)}%`);
    console.log(`  Net P&L:       $${best.netPnl.toFixed(2)}`);
    console.log(`  ROI:           ${best.roi.toFixed(1)}%`);
    console.log(`  Profit Factor: ${best.profitFactor.toFixed(2)}`);
    console.log(`  Expectancy:    $${best.expectancy.toFixed(2)}`);
    console.log(`  SQN:           ${best.sqn.toFixed(2)}`);
  }

  console.log('');
  console.log('✅ Optimization complete!');
}

// Simplified simulation function
function runSimulation(
  candles: Candle[],
  series: any,
  params: NFIParams
): Array<{ pnl: number; win: boolean }> {
  const trades: Array<{ pnl: number; win: boolean }> = [];
  const warmup = 250;
  const cooldownBars = params.risk.cooldownBars;
  const maxBarsInTrade = params.risk.maxBarsInTrade;
  const slPct = params.stopLoss.percentage;
  const roiTimes = Object.keys(params.dynamicROI).map(Number).sort((a, b) => b - a);

  let position: { entryIndex: number; entryPrice: number; direction: 'CALL' | 'PUT' } | null = null;
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

      // Stop Loss
      if (pnlPct <= -slPct * 100) {
        shouldExit = true;
      }

      // Dynamic ROI
      if (!shouldExit) {
        for (const time of roiTimes) {
          if (minutesHeld >= time) {
            const target = params.dynamicROI[time]!;
            if (pnlPct >= target) {
              shouldExit = true;
            }
            break;
          }
        }
      }

      // Time limit
      if (!shouldExit && barsHeld >= maxBarsInTrade) {
        shouldExit = true;
      }

      if (shouldExit) {
        const pnl = (INITIAL_CAPITAL * STAKE_PCT * MULTIPLIER) * (pnlPct / 100);
        trades.push({ pnl, win: pnl > 0 });
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
        };
      }
    }
  }

  return trades;
}

function calculateMetrics(trades: Array<{ pnl: number; win: boolean }>) {
  if (trades.length === 0) {
    return {
      wins: 0, winRate: 0, netPnl: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, maxDrawdownPct: 0, expectancy: 0, sqn: 0
    };
  }

  const wins = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = grossProfit - grossLoss;

  let peak = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  let balance = INITIAL_CAPITAL;
  for (const trade of trades) {
    balance += trade.pnl;
    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const expectancy = netPnl / trades.length;
  const pnls = trades.map(t => t.pnl);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnls.length;
  const std = Math.sqrt(variance);
  const sqn = std > 0 ? (expectancy / std) * Math.sqrt(trades.length) : 0;

  return {
    wins: wins.length,
    winRate: (wins.length / trades.length) * 100,
    netPnl,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    maxDrawdownPct: (maxDrawdown / peak) * 100,
    expectancy,
    sqn,
  };
}

// Reuse helper functions from optimized script
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
    cci: new Array(n).fill(0),
    williams_r: new Array(n).fill(-50),
    mfi: new Array(n).fill(50),
    roc_2: new Array(n).fill(0),
    roc_9: new Array(n).fill(0),
    ewo: new Array(n).fill(0),
    cti: new Array(n).fill(0),
    cmf: new Array(n).fill(0),
    rsi_14_1h: new Array(n).fill(50),
    ema_200_1h: new Array(n).fill(closes[0]),
  };

  // RSI
  const rsi3Values = RSI.calculate({ values: closes, period: 3 });
  const rsi14Values = RSI.calculate({ values: closes, period: 14 });
  for (let i = 0; i < rsi3Values.length; i++) series.rsi_3[i + 3] = rsi3Values[i]!;
  for (let i = 0; i < rsi14Values.length; i++) series.rsi_14[i + 14] = rsi14Values[i]!;

  // EMAs
  const ema12Values = EMA.calculate({ values: closes, period: 12 });
  const ema26Values = EMA.calculate({ values: closes, period: 26 });
  const ema50Values = EMA.calculate({ values: closes, period: 50 });
  const ema200Values = EMA.calculate({ values: closes, period: 200 });
  for (let i = 0; i < ema12Values.length; i++) series.ema_12[i + 11] = ema12Values[i]!;
  for (let i = 0; i < ema26Values.length; i++) series.ema_26[i + 25] = ema26Values[i]!;
  for (let i = 0; i < ema50Values.length; i++) series.ema_50[i + 49] = ema50Values[i]!;
  for (let i = 0; i < ema200Values.length; i++) series.ema_200[i + 199] = ema200Values[i]!;

  // SMAs
  const sma9Values = SMA.calculate({ values: closes, period: 9 });
  const sma200Values = SMA.calculate({ values: closes, period: 200 });
  for (let i = 0; i < sma9Values.length; i++) series.sma_9[i + 8] = sma9Values[i]!;
  for (let i = 0; i < sma200Values.length; i++) series.sma_200[i + 199] = sma200Values[i]!;

  // BB
  const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  for (let i = 0; i < bbValues.length; i++) {
    const bb = bbValues[i]!;
    series.bb_upper[i + 19] = bb.upper;
    series.bb_middle[i + 19] = bb.middle;
    series.bb_lower[i + 19] = bb.lower;
    series.bb_width[i + 19] = bb.middle > 0 ? (bb.upper - bb.lower) / bb.middle : 0;
  }

  // Stoch
  const stochValues = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  for (let i = 0; i < stochValues.length; i++) {
    series.stoch_k[i + 15] = stochValues[i]!.k;
    series.stoch_d[i + 15] = stochValues[i]!.d;
  }

  // CCI
  const cciValues = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  for (let i = 0; i < cciValues.length; i++) series.cci[i + 19] = cciValues[i]!;

  // Williams %R
  const wrValues = WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  for (let i = 0; i < wrValues.length; i++) series.williams_r[i + 13] = wrValues[i]!;

  // MFI
  const mfiValues = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 });
  for (let i = 0; i < mfiValues.length; i++) series.mfi[i + 14] = mfiValues[i]!;

  // ROC
  const roc2Values = ROC.calculate({ values: closes, period: 2 });
  const roc9Values = ROC.calculate({ values: closes, period: 9 });
  for (let i = 0; i < roc2Values.length; i++) series.roc_2[i + 2] = roc2Values[i]!;
  for (let i = 0; i < roc9Values.length; i++) series.roc_9[i + 9] = roc9Values[i]!;

  // EWO
  const ema5Values = EMA.calculate({ values: closes, period: 5 });
  const ema35Values = EMA.calculate({ values: closes, period: 35 });
  for (let i = 34; i < n; i++) {
    const idx5 = i - 4;
    const idx35 = i - 34;
    if (idx5 >= 0 && idx5 < ema5Values.length && idx35 >= 0 && idx35 < ema35Values.length) {
      series.ewo[i] = closes[i]! > 0 ? ((ema5Values[idx5]! - ema35Values[idx35]!) / closes[i]!) * 100 : 0;
    }
  }

  // CTI & CMF
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
    mfi: series.mfi[i],
    williams_r: series.williams_r[i],
    cci: series.cci[i],
    roc_2: series.roc_2[i],
    roc_9: series.roc_9[i],
    rsi_3_15m: series.rsi_3[i],
    rsi_14_15m: series.rsi_14[i],
    ema_200_15m: series.ema_200[i],
    cti_15m: series.cti[i],
    cmf_15m: series.cmf[i],
    rsi_3_1h: series.rsi_14_1h[i],
    rsi_14_1h: series.rsi_14_1h[i],
    ema_50_1h: series.ema_200_1h[i],
    ema_200_1h: series.ema_200_1h[i],
    cti_1h: series.cti[i],
    cmf_1h: series.cmf[i],
    ssl_up_1h: candle.close,
    ssl_down_1h: candle.close,
    rsi_14_4h: series.rsi_14_1h[i],
    ema_200_4h: series.ema_200_1h[i],
    cti_4h: series.cti[i],
    roc_9_4h: series.roc_9[i],
    rsi_14_1d: series.rsi_14_1h[i],
    ema_200_1d: series.ema_200_1h[i],
    cti_1d: series.cti[i],
    is_downtrend: candle.close < series.ema_200[i] && series.ema_50[i] < series.ema_200[i],
    is_uptrend: candle.close > series.ema_200[i] && series.ema_50[i] > series.ema_200[i],
    pump_detected: pump,
    dump_detected: dump,
  };
}

main().catch(console.error);
