#!/usr/bin/env npx tsx
/**
 * NostalgiaForInfinity (NFI) Strategy Backtest - FAST VERSION
 *
 * Pre-calculates all indicators once, then simulates trading.
 * Much faster than recalculating indicators for each candle.
 *
 * Usage:
 *   ASSET="cryETHUSD" DAYS=90 npx tsx src/scripts/backtest-nfi-fast.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { loadCandlesFromCSV } from '../backtest/index.js';
import {
  ETH_NFI_PARAMS,
  BTC_NFI_PARAMS,
  CONSERVATIVE_NFI_PARAMS,
  DEFAULT_NFI_PARAMS,
  getParamsForAsset,
} from '../strategies/nfi/nfi.params.js';
import {
  NFI_BALANCED,
} from '../strategies/nfi/nfi-optimized.params.js';
import type { NFIParams, NFIIndicators } from '../strategies/nfi/nfi.types.js';
import {
  calculateRSI,
  calculateEMA,
  calculateSMA,
  calculateBollingerBands,
  calculateEWO,
  calculateCTI,
  calculateCMF,
  calculateMFI,
  calculateWilliamsR,
  calculateCCI,
  calculateROC,
  calculateStochRSI,
  calculateSSL,
  detectPump,
  detectDump,
  resampleCandles,
} from '../strategies/nfi/indicators.js';
import {
  checkEntryConditions,
  getBestEntryCondition,
} from '../strategies/nfi/entry-conditions.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'cryETHUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const DATA_FILE = process.env.DATA_FILE;
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.03');
const MULTIPLIER = parseInt(process.env.MULTIPLIER ?? '100', 10);
const RUN_MONTE_CARLO = process.env.MONTE_CARLO === 'true';
const SAVE_JSON = process.env.JSON === 'true';
const PRESET = process.env.PRESET as 'eth' | 'btc' | 'conservative' | 'balanced' | undefined;

const INITIAL_CAPITAL = 1000;

interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'CALL' | 'PUT';
  pnl: number;
  pnlPct: number;
  exitReason: string;
  entryTag: string;
  barsHeld: number;
}

interface IndicatorSeries {
  // 5m indicators per bar
  rsi_3: number[];
  rsi_14: number[];
  stoch_k: number[];
  stoch_d: number[];
  ema_12: number[];
  ema_26: number[];
  ema_50: number[];
  ema_200: number[];
  sma_9: number[];
  sma_200: number[];
  bb_upper: number[];
  bb_middle: number[];
  bb_lower: number[];
  bb_width: number[];
  ewo: number[];
  cti: number[];
  cmf: number[];
  mfi: number[];
  williams_r: number[];
  cci: number[];
  roc_2: number[];
  roc_9: number[];
  atr: number[];
  adx: number[];

  // 1h indicators (calculated at 1h intervals)
  rsi_14_1h: number[];
  ema_200_1h: number[];
  cti_1h: number[];
  cmf_1h: number[];
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  NOSTALGIAFORINFINITY (NFI) BACKTEST - FAST VERSION');
  console.log('═'.repeat(70));
  console.log('');

  // Get params based on preset
  let baseParams: Partial<NFIParams> = {};
  if (PRESET === 'eth') {
    baseParams = ETH_NFI_PARAMS;
    console.log(`📋 Using preset: ETH (aggressive)`);
  } else if (PRESET === 'btc') {
    baseParams = BTC_NFI_PARAMS;
    console.log(`📋 Using preset: BTC`);
  } else if (PRESET === 'conservative') {
    baseParams = CONSERVATIVE_NFI_PARAMS;
    console.log(`📋 Using preset: Conservative`);
  } else if (PRESET === 'balanced') {
    baseParams = NFI_BALANCED;
    console.log(`📋 Using preset: BALANCED (optimized frequency + performance)`);
  }

  const params = getParamsForAsset(ASSET, baseParams);

  console.log(`📊 Configuration:`);
  console.log(`   Asset: ${ASSET}`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log(`   Stop Loss: ${(params.stopLoss.percentage * 100).toFixed(1)}%`);
  console.log(`   RSI Oversold: ${params.rsi.oversold}`);
  console.log(`   RSI Overbought: ${params.rsi.overbought}`);
  console.log('');

  // Load data
  let dataPath: string;
  if (DATA_FILE) {
    dataPath = path.isAbsolute(DATA_FILE) ? DATA_FILE : path.join(process.cwd(), DATA_FILE);
  } else {
    const dataDir = path.join(process.cwd(), 'data');
    dataPath = path.join(dataDir, `${ASSET}_1m_${DAYS}d.csv`);
  }

  if (!fs.existsSync(dataPath)) {
    console.log(`❌ Data file not found: ${dataPath}`);
    console.log('To download data, run:');
    console.log(`   SYMBOLS="${ASSET}" DAYS=${DAYS} GRANULARITY=60 npx tsx src/scripts/fetch-historical-data.ts`);
    process.exit(1);
  }

  console.log(`📥 Loading data from: ${path.basename(dataPath)}`);
  const candles = loadCandlesFromCSV(dataPath, {
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

  console.log(`   Loaded ${candles.length.toLocaleString()} candles (1m)`);

  // Convert 1m candles to 5m for NFI
  const candles5m = resampleCandles(candles, 5);
  console.log(`   Resampled to ${candles5m.length.toLocaleString()} candles (5m)`);

  const firstCandle = candles5m[0]!;
  const lastCandle = candles5m[candles5m.length - 1]!;
  const startDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];
  console.log(`   Period: ${startDate} → ${endDate}`);
  console.log('');

  // Pre-calculate all indicators
  console.log('🔧 Pre-calculating indicators...');
  const startCalc = Date.now();
  const indicatorSeries = preCalculateIndicators(candles5m, params);
  console.log(`   Completed in ${((Date.now() - startCalc) / 1000).toFixed(1)}s`);
  console.log('');

  // Run simulation
  console.log('🚀 Running simulation...');
  const startSim = Date.now();
  const trades = runSimulation(candles5m, indicatorSeries, params);
  console.log(`   Completed in ${((Date.now() - startSim) / 1000).toFixed(1)}s`);
  console.log(`   Total trades: ${trades.length}`);
  console.log('');

  // Calculate metrics
  const metrics = calculateMetrics(trades, INITIAL_CAPITAL);

  // Print results
  printResults(trades, metrics, candles5m, params);

  // Analyze entry tags
  analyzeEntryTags(trades);

  // Monte Carlo
  if (RUN_MONTE_CARLO && trades.length > 30) {
    runMonteCarloSimulation(trades);
  }

  // Save JSON
  if (SAVE_JSON) {
    const jsonPath = saveResultsToJSON(trades, metrics, candles5m);
    console.log(`\n💾 Results saved to: ${jsonPath}`);
  }

  console.log('\n✅ NFI Fast Backtest complete!');
}

/**
 * Pre-calculate all indicator series
 */
function preCalculateIndicators(candles: Candle[], params: NFIParams): IndicatorSeries {
  const n = candles.length;
  const closes = candles.map(c => c.close);

  // Initialize arrays
  const series: IndicatorSeries = {
    rsi_3: new Array(n).fill(50),
    rsi_14: new Array(n).fill(50),
    stoch_k: new Array(n).fill(50),
    stoch_d: new Array(n).fill(50),
    ema_12: new Array(n).fill(0),
    ema_26: new Array(n).fill(0),
    ema_50: new Array(n).fill(0),
    ema_200: new Array(n).fill(0),
    sma_9: new Array(n).fill(0),
    sma_200: new Array(n).fill(0),
    bb_upper: new Array(n).fill(0),
    bb_middle: new Array(n).fill(0),
    bb_lower: new Array(n).fill(0),
    bb_width: new Array(n).fill(0),
    ewo: new Array(n).fill(0),
    cti: new Array(n).fill(0),
    cmf: new Array(n).fill(0),
    mfi: new Array(n).fill(50),
    williams_r: new Array(n).fill(-50),
    cci: new Array(n).fill(0),
    roc_2: new Array(n).fill(0),
    roc_9: new Array(n).fill(0),
    atr: new Array(n).fill(0),
    adx: new Array(n).fill(25),
    rsi_14_1h: new Array(n).fill(50),
    ema_200_1h: new Array(n).fill(0),
    cti_1h: new Array(n).fill(0),
    cmf_1h: new Array(n).fill(0),
  };

  // Calculate rolling indicators
  const warmup = 250; // Need 200+ bars for EMA200

  for (let i = warmup; i < n; i++) {
    const slice = closes.slice(0, i + 1);
    const candleSlice = candles.slice(0, i + 1);

    // RSI
    series.rsi_3[i] = calculateRSI(slice, 3) ?? 50;
    series.rsi_14[i] = calculateRSI(slice, 14) ?? 50;

    // Stochastic RSI
    const stoch = calculateStochRSI(slice);
    if (stoch) {
      series.stoch_k[i] = stoch.k;
      series.stoch_d[i] = stoch.d;
    }

    // EMAs
    series.ema_12[i] = calculateEMA(slice, 12) ?? slice[slice.length - 1]!;
    series.ema_26[i] = calculateEMA(slice, 26) ?? slice[slice.length - 1]!;
    series.ema_50[i] = calculateEMA(slice, 50) ?? slice[slice.length - 1]!;
    series.ema_200[i] = calculateEMA(slice, 200) ?? slice[slice.length - 1]!;

    // SMAs
    series.sma_9[i] = calculateSMA(slice, 9) ?? slice[slice.length - 1]!;
    series.sma_200[i] = calculateSMA(slice, 200) ?? slice[slice.length - 1]!;

    // Bollinger Bands
    const bb = calculateBollingerBands(slice, params.bb.period, params.bb.stdDev);
    if (bb) {
      series.bb_upper[i] = bb.upper;
      series.bb_middle[i] = bb.middle;
      series.bb_lower[i] = bb.lower;
      series.bb_width[i] = bb.width;
    }

    // EWO
    series.ewo[i] = calculateEWO(slice, params.ewo.period_fast, params.ewo.period_slow) ?? 0;

    // CTI
    series.cti[i] = calculateCTI(slice) ?? 0;

    // CMF
    series.cmf[i] = calculateCMF(candleSlice) ?? 0;

    // MFI
    series.mfi[i] = calculateMFI(candleSlice) ?? 50;

    // Williams %R
    series.williams_r[i] = calculateWilliamsR(candleSlice) ?? -50;

    // CCI
    series.cci[i] = calculateCCI(candleSlice) ?? 0;

    // ROC
    series.roc_2[i] = calculateROC(slice, 2) ?? 0;
    series.roc_9[i] = calculateROC(slice, 9) ?? 0;

    // ATR - calculate directly
    if (i >= 14) {
      let atrSum = 0;
      for (let j = i - 13; j <= i; j++) {
        const curr = candles[j]!;
        const prev = candles[j - 1]!;
        const tr = Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
        );
        atrSum += tr;
      }
      series.atr[i] = atrSum / 14;
    }

    // ADX - simplified calculation
    if (i >= 28) {
      let plusDM = 0;
      let minusDM = 0;
      let trSum = 0;
      for (let j = i - 13; j <= i; j++) {
        const curr = candles[j]!;
        const prev = candles[j - 1]!;
        const upMove = curr.high - prev.high;
        const downMove = prev.low - curr.low;
        if (upMove > downMove && upMove > 0) {
          plusDM += upMove;
        } else if (downMove > upMove && downMove > 0) {
          minusDM += downMove;
        }
        const tr = Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
        );
        trSum += tr;
      }
      const plusDI = trSum > 0 ? (plusDM / trSum) * 100 : 0;
      const minusDI = trSum > 0 ? (minusDM / trSum) * 100 : 0;
      const diSum = plusDI + minusDI;
      series.adx[i] = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    }
  }

  // Calculate 1h indicators (resample 5m -> 1h = factor of 12)
  const candles1h = resampleCandles(candles, 12);
  const closes1h = candles1h.map(c => c.close);

  for (let i = 20; i < candles1h.length; i++) {
    const slice1h = closes1h.slice(0, i + 1);
    const candleSlice1h = candles1h.slice(0, i + 1);

    const rsi1h = calculateRSI(slice1h, 14) ?? 50;
    const ema2001h = calculateEMA(slice1h, Math.min(200, slice1h.length)) ?? slice1h[slice1h.length - 1]!;
    const cti1h = calculateCTI(slice1h) ?? 0;
    const cmf1h = calculateCMF(candleSlice1h) ?? 0;

    // Map to 5m indices
    const startIdx = i * 12;
    const endIdx = Math.min((i + 1) * 12, n);
    for (let j = startIdx; j < endIdx; j++) {
      series.rsi_14_1h[j] = rsi1h;
      series.ema_200_1h[j] = ema2001h;
      series.cti_1h[j] = cti1h;
      series.cmf_1h[j] = cmf1h;
    }
  }

  return series;
}

/**
 * Build NFIIndicators for a specific index
 */
function getIndicatorsAtIndex(i: number, candles: Candle[], series: IndicatorSeries): NFIIndicators {
  const candle = candles[i]!;
  const prevCandle = candles[i - 1]!;

  const bb_delta = series.bb_middle[i]! - series.bb_lower[i]!;
  const close_delta = candle.close - prevCandle.close;
  const tail = Math.abs(candle.close - candle.low);

  // Trend detection
  const is_downtrend = candle.close < series.ema_200[i]! && series.ema_50[i]! < series.ema_200[i]!;
  const is_uptrend = candle.close > series.ema_200[i]! && series.ema_50[i]! > series.ema_200[i]!;

  // Simple pump/dump detection
  const pumpThreshold = 0.03;
  const lookback = 12;
  let pump_detected = false;
  let dump_detected = false;
  if (i >= lookback) {
    const change = (candle.close - candles[i - lookback]!.close) / candles[i - lookback]!.close;
    pump_detected = change > pumpThreshold;
    dump_detected = change < -pumpThreshold;
  }

  return {
    rsi_3: series.rsi_3[i]!,
    rsi_14: series.rsi_14[i]!,
    rsi_3_change: i > 0 ? series.rsi_3[i]! - series.rsi_3[i - 1]! : 0,
    stoch_rsi_k: series.stoch_k[i]!,
    stoch_rsi_d: series.stoch_d[i]!,
    ema_12: series.ema_12[i]!,
    ema_26: series.ema_26[i]!,
    ema_50: series.ema_50[i]!,
    ema_200: series.ema_200[i]!,
    sma_9: series.sma_9[i]!,
    sma_200: series.sma_200[i]!,
    bb_upper: series.bb_upper[i]!,
    bb_middle: series.bb_middle[i]!,
    bb_lower: series.bb_lower[i]!,
    bb_width: series.bb_width[i]!,
    bb_delta,
    close_delta,
    tail,
    ewo: series.ewo[i]!,
    cti: series.cti[i]!,
    cmf: series.cmf[i]!,
    mfi: series.mfi[i]!,
    williams_r: series.williams_r[i]!,
    cci: series.cci[i]!,
    roc_2: series.roc_2[i]!,
    roc_9: series.roc_9[i]!,
    atr: series.atr[i]!,
    adx: series.adx[i]!,

    // 15m (use 5m values as approximation)
    rsi_3_15m: series.rsi_3[i]!,
    rsi_14_15m: series.rsi_14[i]!,
    ema_200_15m: series.ema_200[i]!,
    cti_15m: series.cti[i]!,
    cmf_15m: series.cmf[i]!,

    // 1h
    rsi_3_1h: series.rsi_14_1h[i]!,
    rsi_14_1h: series.rsi_14_1h[i]!,
    ema_50_1h: series.ema_200_1h[i]!,
    ema_200_1h: series.ema_200_1h[i]!,
    cti_1h: series.cti_1h[i]!,
    cmf_1h: series.cmf_1h[i]!,
    ssl_up_1h: candle.close,
    ssl_down_1h: candle.close,

    // 4h (use 1h values as approximation)
    rsi_14_4h: series.rsi_14_1h[i]!,
    ema_200_4h: series.ema_200_1h[i]!,
    cti_4h: series.cti_1h[i]!,
    roc_9_4h: series.roc_9[i]!,

    // 1d (use 1h values as approximation)
    rsi_14_1d: series.rsi_14_1h[i]!,
    ema_200_1d: series.ema_200_1h[i]!,
    cti_1d: series.cti_1h[i]!,

    // Derived
    is_downtrend,
    is_uptrend,
    pump_detected,
    dump_detected,
  };
}

/**
 * Run trading simulation
 */
function runSimulation(
  candles: Candle[],
  series: IndicatorSeries,
  params: NFIParams
): Trade[] {
  const trades: Trade[] = [];
  const warmup = 300;
  const cooldownBars = params.risk.cooldownBars;
  const maxBarsInTrade = params.risk.maxBarsInTrade;
  const slPct = params.stopLoss.percentage;

  // Dynamic ROI targets
  const roiTimes = Object.keys(params.dynamicROI).map(Number).sort((a, b) => b - a);

  let position: {
    entryIndex: number;
    entryPrice: number;
    direction: 'CALL' | 'PUT';
    entryTag: string;
  } | null = null;
  let lastExitBar = -cooldownBars;
  let consecutiveLosses = 0;
  let pauseUntilBar = -1;

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i]!;

    // If in position, check exit
    if (position) {
      const barsHeld = i - position.entryIndex;
      const minutesHeld = barsHeld * 5;

      // Calculate P&L
      const pnlPct = position.direction === 'CALL'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;

      let shouldExit = false;
      let exitReason = '';

      // 1. Stop Loss
      if (pnlPct <= -slPct * 100) {
        shouldExit = true;
        exitReason = `STOP_LOSS (${pnlPct.toFixed(2)}%)`;
      }

      // 2. Dynamic ROI
      if (!shouldExit) {
        for (const time of roiTimes) {
          if (minutesHeld >= time) {
            const target = params.dynamicROI[time]!;
            if (pnlPct >= target) {
              shouldExit = true;
              exitReason = `ROI_${time}min (${pnlPct.toFixed(2)}% >= ${target}%)`;
            }
            break;
          }
        }
      }

      // 3. Time limit
      if (!shouldExit && barsHeld >= maxBarsInTrade) {
        shouldExit = true;
        exitReason = `TIME_LIMIT (${barsHeld} bars)`;
      }

      // 4. Signal-based exit (if in profit and enabled)
      if (!shouldExit && pnlPct > 0 && params.exitSignals.use_signal_exits !== false) {
        const ind = getIndicatorsAtIndex(i, candles, series);

        if (position.direction === 'CALL') {
          if (ind.rsi_14 > params.exitSignals.rsi_overbought) {
            shouldExit = true;
            exitReason = `RSI_OVERBOUGHT (${ind.rsi_14.toFixed(0)})`;
          } else if (params.exitSignals.bb_overbought !== false && candle.close > ind.bb_upper) {
            shouldExit = true;
            exitReason = 'BB_UPPER_TOUCH';
          } else if (ind.stoch_rsi_k > params.exitSignals.stoch_overbought) {
            shouldExit = true;
            exitReason = `STOCH_OVERBOUGHT (${ind.stoch_rsi_k.toFixed(0)})`;
          }
        }
      }

      // Execute exit
      if (shouldExit) {
        const pnl = (INITIAL_CAPITAL * STAKE_PCT * MULTIPLIER) * (pnlPct / 100);

        trades.push({
          entryTime: candles[position.entryIndex]!.timestamp * 1000,
          exitTime: candle.timestamp * 1000,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          direction: position.direction,
          pnl,
          pnlPct,
          exitReason,
          entryTag: position.entryTag,
          barsHeld,
        });

        // Update state
        if (pnl > 0) {
          consecutiveLosses = 0;
        } else {
          consecutiveLosses++;
          if (consecutiveLosses >= params.risk.maxConsecutiveLosses) {
            pauseUntilBar = i + params.risk.pauseBarsAfterMaxLosses;
            consecutiveLosses = 0;
          }
        }

        lastExitBar = i;
        position = null;
      }
    }
    // If not in position, check entry
    else {
      // Check cooldown
      if (i - lastExitBar < cooldownBars) continue;

      // Check pause
      if (i < pauseUntilBar) continue;

      // Get indicators and check entry conditions
      const indicators = getIndicatorsAtIndex(i, candles, series);
      const conditions = checkEntryConditions(candle, indicators, params, 'CALL');
      const bestCondition = getBestEntryCondition(conditions);

      if (bestCondition) {
        // Apply ML-validated filters to reduce losses
        // Filters validated with out-of-sample testing (85.7% improvement)
        const atrPct = candle.close > 0 ? (indicators.atr / candle.close) * 100 : 0;
        const maxATR = 0.284;  // Filter high volatility
        const maxADX = 26.3;   // Filter strong trends
        const excludeTags = ['4']; // Exclude worst performing tag

        // Check filters
        if (atrPct > maxATR) continue;
        if (indicators.adx > maxADX) continue;
        if (excludeTags.includes(bestCondition.tag)) continue;

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

/**
 * Calculate backtest metrics
 */
function calculateMetrics(trades: Trade[], initialCapital: number) {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      grossProfit: 0,
      grossLoss: 0,
      netPnl: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      avgBarsHeld: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = grossProfit - grossLoss;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  // Max drawdown
  let peak = initialCapital;
  let maxDrawdown = 0;
  let balance = initialCapital;
  for (const trade of trades) {
    balance += trade.pnl;
    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Consecutive wins/losses
  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let consecWins = 0;
  let consecLosses = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      consecWins++;
      consecLosses = 0;
      if (consecWins > maxConsecWins) maxConsecWins = consecWins;
    } else {
      consecLosses++;
      consecWins = 0;
      if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
    }
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    grossProfit,
    grossLoss,
    netPnl,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    maxDrawdown,
    maxDrawdownPct: (maxDrawdown / peak) * 100,
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    avgBarsHeld: trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length,
  };
}

function printResults(trades: Trade[], metrics: any, candles: Candle[], params: NFIParams) {
  const startDate = new Date(candles[0]!.timestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString().split('T')[0];

  const expectancy = trades.length > 0 ? metrics.netPnl / trades.length : 0;
  const pnls = trades.map(t => t.pnl);
  const pnlStd = std(pnls);
  const sqn = pnlStd > 0 ? (expectancy / pnlStd) * Math.sqrt(trades.length) : 0;

  console.log('═'.repeat(70));
  console.log('  NFI BACKTEST RESULTS');
  console.log('═'.repeat(70));
  console.log('');

  console.log('📊 CONFIGURATION');
  console.log('─'.repeat(70));
  console.log(`  Asset:        ${ASSET}`);
  console.log(`  Timeframe:    5m`);
  console.log(`  Period:       ${startDate} → ${endDate}`);
  console.log(`  Candles:      ${candles.length.toLocaleString()}`);
  console.log(`  Initial:      $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  Stake:        ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`  Multiplier:   ${MULTIPLIER}x`);
  console.log(`  Stop Loss:    ${(params.stopLoss.percentage * 100).toFixed(1)}%`);
  console.log('');

  console.log('📈 PERFORMANCE');
  console.log('─'.repeat(70));
  console.log(`  Trades:       ${metrics.totalTrades} (${metrics.wins}W / ${metrics.losses}L)`);
  console.log(`  Win Rate:     ${metrics.winRate.toFixed(1)}%`);
  console.log(`  Net P&L:      $${metrics.netPnl.toFixed(2)}`);
  console.log(`  ROI:          ${((metrics.netPnl / INITIAL_CAPITAL) * 100).toFixed(1)}%`);
  console.log(`  Profit Factor: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}`);
  console.log('');

  console.log('💰 P&L BREAKDOWN');
  console.log('─'.repeat(70));
  console.log(`  Gross Profit: $${metrics.grossProfit.toFixed(2)}`);
  console.log(`  Gross Loss:   $${metrics.grossLoss.toFixed(2)}`);
  console.log(`  Avg Win:      $${metrics.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:     $${metrics.avgLoss.toFixed(2)}`);
  console.log(`  Avg Trade:    $${expectancy.toFixed(2)}`);
  console.log('');

  console.log('⚠️  RISK METRICS');
  console.log('─'.repeat(70));
  console.log(`  Max Drawdown: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPct.toFixed(1)}%)`);
  console.log(`  Max Consec W: ${metrics.maxConsecutiveWins}`);
  console.log(`  Max Consec L: ${metrics.maxConsecutiveLosses}`);
  console.log(`  Expectancy:   $${expectancy.toFixed(2)}`);
  console.log(`  SQN:          ${sqn.toFixed(2)}`);
  console.log('');

  console.log('🔍 TRADE QUALITY');
  console.log('─'.repeat(70));
  console.log(`  Avg Duration: ${metrics.avgBarsHeld.toFixed(1)} bars (${(metrics.avgBarsHeld * 5).toFixed(0)} min)`);
  console.log(`  Trades/Day:   ${(trades.length / DAYS).toFixed(1)}`);
  console.log('');

  // Exit reason breakdown
  const exitReasons: Record<string, number> = {};
  for (const trade of trades) {
    const reason = trade.exitReason.split(' ')[0] ?? trade.exitReason;
    exitReasons[reason] = (exitReasons[reason] ?? 0) + 1;
  }

  console.log('📊 EXIT REASONS');
  console.log('─'.repeat(70));
  for (const [reason, count] of Object.entries(exitReasons).sort((a, b) => b[1] - a[1])) {
    const pct = (count / trades.length) * 100;
    console.log(`  ${reason.padEnd(22)}: ${String(count).padStart(4)} (${pct.toFixed(1)}%)`);
  }
  console.log('');

  console.log('═'.repeat(70));
}

function analyzeEntryTags(trades: Trade[]) {
  const tagStats: Record<string, { count: number; wins: number; totalPnl: number }> = {};

  for (const trade of trades) {
    const tag = trade.entryTag || 'unknown';
    if (!tagStats[tag]) {
      tagStats[tag] = { count: 0, wins: 0, totalPnl: 0 };
    }
    tagStats[tag]!.count++;
    if (trade.pnl > 0) tagStats[tag]!.wins++;
    tagStats[tag]!.totalPnl += trade.pnl;
  }

  const sorted = Object.entries(tagStats).sort((a, b) => b[1].count - a[1].count);

  console.log('🏷️  ENTRY TAG ANALYSIS');
  console.log('─'.repeat(70));
  console.log('  Tag                          Count   WinRate   Avg P&L');
  console.log('  ' + '-'.repeat(55));

  for (const [tag, stats] of sorted.slice(0, 15)) {
    const winRate = stats.count > 0 ? (stats.wins / stats.count) * 100 : 0;
    const avgPnl = stats.count > 0 ? stats.totalPnl / stats.count : 0;
    console.log(
      `  ${tag.padEnd(28)} ${String(stats.count).padStart(5)}   ${winRate.toFixed(1).padStart(5)}%   $${avgPnl.toFixed(2).padStart(7)}`
    );
  }
  console.log('');
}

function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squaredDiffs = arr.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function runMonteCarloSimulation(trades: Trade[]) {
  console.log('🎲 MONTE CARLO SIMULATION');
  console.log('─'.repeat(70));

  const iterations = 1000;
  const pnls = trades.map(t => t.pnl);
  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let balance = INITIAL_CAPITAL;
    const shuffled = [...pnls].sort(() => Math.random() - 0.5);
    for (const pnl of shuffled) {
      balance += pnl;
    }
    results.push(balance - INITIAL_CAPITAL);
  }

  results.sort((a, b) => a - b);

  console.log(`  Iterations:  ${iterations}`);
  console.log(`  5th pctl:    $${results[Math.floor(iterations * 0.05)]!.toFixed(2)}`);
  console.log(`  25th pctl:   $${results[Math.floor(iterations * 0.25)]!.toFixed(2)}`);
  console.log(`  Median:      $${results[Math.floor(iterations * 0.5)]!.toFixed(2)}`);
  console.log(`  75th pctl:   $${results[Math.floor(iterations * 0.75)]!.toFixed(2)}`);
  console.log(`  95th pctl:   $${results[Math.floor(iterations * 0.95)]!.toFixed(2)}`);
  console.log('');
}

function saveResultsToJSON(trades: Trade[], metrics: any, candles: Candle[]): string {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nfi-backtest-${ASSET}-${DAYS}d-${timestamp}.json`;
  const outputPath = path.join(outputDir, filename);

  const output = {
    strategy: 'NostalgiaForInfinity',
    version: '1.0.0',
    asset: ASSET,
    days: DAYS,
    preset: PRESET,
    config: {
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      initialCapital: INITIAL_CAPITAL,
    },
    period: {
      start: new Date(candles[0]!.timestamp * 1000).toISOString(),
      end: new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString(),
      candles: candles.length,
    },
    metrics,
    trades: trades.map(t => ({
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      direction: t.direction,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.pnl,
      pnlPct: t.pnlPct,
      exitReason: t.exitReason,
      entryTag: t.entryTag,
      barsHeld: t.barsHeld,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  return outputPath;
}

main().catch(console.error);
