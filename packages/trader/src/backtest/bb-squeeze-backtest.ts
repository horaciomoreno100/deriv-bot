/**
 * BB Squeeze Strategy for BacktestJS
 *
 * Bollinger Band Squeeze strategy adapted for BacktestJS framework
 */

import type { BTH } from '@backtest/framework';

/**
 * Strategy Parameters
 */
export const properties = {
  params: [
    'bbPeriod',
    'bbStdDev',
    'kcPeriod',
    'kcMultiplier',
    'takeProfitPct',
    'stopLossPct',
  ],
  dynamicParams: false,
};

/**
 * Default Parameters
 */
const DEFAULT_PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  takeProfitPct: 0.004, // 0.4%
  stopLossPct: 0.002,   // 0.2%
  minCandles: 50,
};

/**
 * State variables
 */
let inSqueeze = false;
let lastSqueezeTime = 0;

/**
 * Calculate EMA manually
 */
function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];

  // First EMA is simple moving average
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emaArray.push(ema);

  // Calculate rest of EMAs
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }

  return emaArray;
}

/**
 * Calculate Keltner Channels
 */
function calculateKeltnerChannels(
  closes: number[],
  highs: number[],
  lows: number[],
  period: number,
  multiplier: number
): { upper: number; middle: number; lower: number }[] {
  // Calculate EMA (middle line)
  const ema = calculateEMA(closes, period);

  // Calculate ATR manually
  const atrValues: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    atrValues.push(tr);
  }

  // Smooth ATR with EMA
  const atrEma = calculateEMA(atrValues, period);

  // Build Keltner Channels
  const keltnerChannels: { upper: number; middle: number; lower: number }[] = [];
  const offset = closes.length - atrEma.length;

  for (let i = 0; i < atrEma.length; i++) {
    const middle = ema[i + offset];
    const atr = atrEma[i];
    if (middle !== undefined && atr !== undefined) {
      keltnerChannels.push({
        upper: middle + atr * multiplier,
        middle,
        lower: middle - atr * multiplier,
      });
    }
  }

  return keltnerChannels;
}

/**
 * Main Strategy Function
 */
export async function runStrategy(bth: BTH) {
  // Get parameters
  const params = { ...DEFAULT_PARAMS, ...bth.params };

  // Get current candle data
  const closes = await bth.getCandles('close', params.minCandles, 0);
  const highs = await bth.getCandles('high', params.minCandles, 0);
  const lows = await bth.getCandles('low', params.minCandles, 0);

  if (closes.length < params.minCandles) {
    return; // Not enough data
  }

  // Calculate Bollinger Bands using BacktestJS built-in
  const bb = await bth.indicatorBB(params.bbPeriod, params.bbStdDev, 0);

  if (!bb) {
    return; // BB calculation failed
  }

  // Calculate Keltner Channels
  const kcResult = calculateKeltnerChannels(
    closes,
    highs,
    lows,
    params.kcPeriod,
    params.kcMultiplier
  );

  if (!kcResult || kcResult.length === 0) {
    return; // KC calculation failed
  }

  // Get current values (align indices)
  const currentBB = bb;
  const currentKC = kcResult[kcResult.length - 1];
  const currentPrice = closes[closes.length - 1];

  if (!currentBB || !currentKC) {
    return;
  }

  // Detect Squeeze: BB is inside KC
  const bbUpperInsideKC = currentBB.upper < currentKC.upper;
  const bbLowerInsideKC = currentBB.lower > currentKC.lower;
  const isInSqueeze = bbUpperInsideKC && bbLowerInsideKC;

  // Update squeeze state
  const now = Date.now();
  if (isInSqueeze && !inSqueeze) {
    inSqueeze = true;
    lastSqueezeTime = now;
    console.log(`💤 SQUEEZE DETECTED at price ${currentPrice.toFixed(2)}`);
  } else if (!isInSqueeze && inSqueeze) {
    inSqueeze = false;
    console.log(`🌊 Squeeze ended - volatility expanding`);
  }

  inSqueeze = isInSqueeze;

  // Only trade if we recently came from a squeeze (within last 5 minutes)
  const timeSinceSqueeze = now - lastSqueezeTime;
  const wasRecentlyInSqueeze = timeSinceSqueeze < 5 * 60 * 1000;

  if (!wasRecentlyInSqueeze) {
    return;
  }

  // CALL Signal: Breakout above BB_Upper
  const breakoutAbove = currentPrice > currentBB.upper;

  if (breakoutAbove) {
    console.log(`🚀 BREAKOUT ABOVE at ${currentPrice.toFixed(2)} > ${currentBB.upper.toFixed(2)}`);

    const tpPrice = currentPrice * (1 + params.takeProfitPct);
    const slPrice = currentPrice * (1 - params.stopLossPct);

    await bth.buy({
      type: 'long',
      takeProfit: tpPrice,
      stopLoss: slPrice,
    });

    return;
  }

  // PUT Signal: Breakout below BB_Lower
  const breakoutBelow = currentPrice < currentBB.lower;

  if (breakoutBelow) {
    console.log(`📉 BREAKOUT BELOW at ${currentPrice.toFixed(2)} < ${currentBB.lower.toFixed(2)}`);

    const tpPrice = currentPrice * (1 - params.takeProfitPct);
    const slPrice = currentPrice * (1 + params.stopLossPct);

    await bth.buy({
      type: 'short',
      takeProfit: tpPrice,
      stopLoss: slPrice,
    });

    return;
  }

  // Check for smart exit at BB_Middle
  const positions = await bth.getPositions();
  if (positions && positions.length > 0) {
    for (const position of positions) {
      const isLong = position.type === 'long';
      const shouldExit = isLong
        ? currentPrice <= currentBB.middle
        : currentPrice >= currentBB.middle;

      if (shouldExit) {
        console.log(`🎯 Smart Exit at BB_Middle: ${currentBB.middle.toFixed(2)}`);
        await bth.sell({ positionId: position.id });
      }
    }
  }
}
