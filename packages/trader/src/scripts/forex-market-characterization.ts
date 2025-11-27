/**
 * Forex Market Characterization Analysis
 *
 * Comprehensive analysis of forex markets (EUR/USD, XAU/USD) to determine:
 * 1. Volatility by trading session (Asian, London, NY)
 * 2. Market regime distribution (Trend vs Range)
 * 3. Multi-timeframe analysis for optimal strategy selection
 * 4. Mean reversion probability by session
 * 5. Best times for mean reversion vs momentum strategies
 *
 * Usage:
 *   SYMBOLS="frxEURUSD,frxXAUUSD" DAYS=30 npx tsx src/scripts/forex-market-characterization.ts
 *
 * Output:
 *   - CSV files in ./analysis-output/ for Python visualization
 *   - Console summary with key insights
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ADX, ATR, RSI, EMA, SMA } from 'technicalindicators';
import { GatewayClient } from '@deriv-bot/shared';

// =============================================================================
// TYPES
// =============================================================================

interface Candle {
  timestamp: number;  // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

type Session = 'ASIAN' | 'LONDON' | 'NEW_YORK' | 'LONDON_NY_OVERLAP';
type Regime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE_QUIET' | 'RANGE_VOLATILE' | 'UNCERTAIN';
type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

interface SessionDefinition {
  name: Session;
  startHourUTC: number;
  endHourUTC: number;
  color: string;
}

interface CandleAnalysis {
  timestamp: number;
  dateUTC: string;
  hourUTC: number;
  dayOfWeek: DayOfWeek;
  session: Session;
  price: number;

  // Volatility metrics
  atr: number;
  atrPercent: number;  // ATR as % of price
  range: number;       // High - Low
  rangePercent: number;
  bbWidth: number;
  bbWidthPercent: number;

  // Trend/Regime metrics
  adx: number;
  regime: Regime;
  rsi: number;
  ema8: number;
  ema21: number;
  ema50: number;
  trendStrength: number;  // -1 to 1

  // Mean Reversion metrics
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  distanceFromBBMiddle: number;
  distanceFromBBMiddlePercent: number;
  pricePosition: 'UPPER' | 'MIDDLE' | 'LOWER';  // Position within BB bands

  // Multi-timeframe context (will be filled if MTF data available)
  regimeH1?: Regime;
  adxH1?: number;
}

interface SessionStats {
  session: Session;
  count: number;
  avgATR: number;
  avgATRPercent: number;
  avgRange: number;
  avgRangePercent: number;
  avgBBWidth: number;
  avgADX: number;
  trendPercent: number;
  rangePercent: number;
  avgRSI: number;

  // Regime breakdown
  regimeDistribution: Record<Regime, number>;
}

interface HourlyStats {
  hour: number;
  session: Session;
  count: number;
  avgATR: number;
  avgATRPercent: number;
  avgADX: number;
  trendPercent: number;
  rangePercent: number;
  avgRSI: number;
  regimeDistribution: Record<Regime, number>;
}

interface DayOfWeekStats {
  day: DayOfWeek;
  count: number;
  avgATR: number;
  avgADX: number;
  trendPercent: number;
  rangePercent: number;
}

interface MeanReversionStats {
  session: Session;
  totalTouchesUpper: number;
  totalTouchesLower: number;
  reversionsFromUpper: number;
  reversionsFromLower: number;
  reversionRateUpper: number;
  reversionRateLower: number;
  avgBarsToReversion: number;
  avgDrawdownBeforeReversion: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const SYMBOLS = (process.env.SYMBOLS || 'frxEURUSD').split(',');
const DAYS = parseInt(process.env.DAYS || '30', 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || './analysis-output';
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';

// Session definitions (UTC hours)
const SESSIONS: SessionDefinition[] = [
  { name: 'ASIAN', startHourUTC: 0, endHourUTC: 9, color: '#FF6B6B' },
  { name: 'LONDON', startHourUTC: 7, endHourUTC: 16, color: '#4ECDC4' },
  { name: 'NEW_YORK', startHourUTC: 13, endHourUTC: 22, color: '#45B7D1' },
  { name: 'LONDON_NY_OVERLAP', startHourUTC: 13, endHourUTC: 16, color: '#96CEB4' },
];

// Indicator parameters
const PARAMS = {
  atrPeriod: 14,
  adxPeriod: 14,
  adxTrendThreshold: 25,
  adxStrongTrendThreshold: 30,
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  emaPeriods: [8, 21, 50],

  // Mean reversion parameters
  bbTouchThreshold: 0.02,  // Within 2% of BB band = "touch"
  reversionTarget: 0.5,     // Consider reverted when crosses 50% back to middle
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function getSession(hourUTC: number): Session {
  // Check overlap first (most specific)
  if (hourUTC >= 13 && hourUTC < 16) {
    return 'LONDON_NY_OVERLAP';
  }
  // Then check other sessions
  if (hourUTC >= 0 && hourUTC < 9) {
    return 'ASIAN';
  }
  if (hourUTC >= 7 && hourUTC < 16) {
    return 'LONDON';
  }
  if (hourUTC >= 13 && hourUTC < 22) {
    return 'NEW_YORK';
  }
  // Default to Asian for late night hours (22-24 UTC)
  return 'ASIAN';
}

function getDayOfWeek(timestamp: number): DayOfWeek {
  const days: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const date = new Date(timestamp * 1000);
  return days[date.getUTCDay()]!;
}

function formatDateUTC(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function fetchDataFromGateway(symbol: string, days: number): Promise<Candle[]> {
  console.log(`\n📡 Connecting to Gateway at ${GATEWAY_URL}...`);

  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: false,
    enableLogging: false,
  });

  try {
    await client.connect();
    console.log('✅ Connected to Gateway');

    // Fetch 1-minute candles
    const candlesNeeded = days * 24 * 60;
    console.log(`📊 Fetching ${candlesNeeded} candles for ${symbol}...`);

    const candles = await client.getCandles(symbol, 60, candlesNeeded);

    if (!candles || candles.length === 0) {
      throw new Error(`No data received for ${symbol}`);
    }

    console.log(`✅ Fetched ${candles.length} candles`);

    // Convert to our Candle format
    return candles.map(c => ({
      timestamp: typeof c.timestamp === 'number' && c.timestamp > 10000000000
        ? Math.floor(c.timestamp / 1000)
        : c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
    }));

  } finally {
    await client.disconnect();
  }
}

function loadCandlesFromCSV(filepath: string): Candle[] | null {
  if (!existsSync(filepath)) {
    return null;
  }

  console.log(`📂 Loading data from: ${filepath}`);
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header

  const candles = lines.map(line => {
    const [timestamp, open, high, low, close, volume] = line.split(',');
    const ts = parseInt(timestamp!);
    return {
      timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
      open: parseFloat(open!),
      high: parseFloat(high!),
      low: parseFloat(low!),
      close: parseFloat(close!),
      volume: parseFloat(volume || '0'),
    };
  }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close));

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

// =============================================================================
// INDICATOR CALCULATIONS
// =============================================================================

function calculateAllIndicators(candles: Candle[]): {
  atr: number[];
  adx: { adx: number; pdi: number; mdi: number }[];
  bb: { upper: number; middle: number; lower: number }[];
  rsi: number[];
  ema8: number[];
  ema21: number[];
  ema50: number[];
} {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const atr = ATR.calculate({
    period: PARAMS.atrPeriod,
    high: highs,
    low: lows,
    close: closes,
  });

  const adx = ADX.calculate({
    period: PARAMS.adxPeriod,
    high: highs,
    low: lows,
    close: closes,
  });

  const bb = BollingerBands.calculate({
    period: PARAMS.bbPeriod,
    stdDev: PARAMS.bbStdDev,
    values: closes,
  });

  const rsi = RSI.calculate({
    period: PARAMS.rsiPeriod,
    values: closes,
  });

  const ema8 = EMA.calculate({ period: 8, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });

  return { atr, adx, bb, rsi, ema8, ema21, ema50 };
}

function detectRegime(
  adx: number,
  price: number,
  ema8: number,
  ema21: number,
  ema50: number,
  bbWidth: number,
  avgBBWidth: number
): Regime {
  const isTrending = adx > PARAMS.adxTrendThreshold;
  const isStrongTrend = adx > PARAMS.adxStrongTrendThreshold;
  const isLowVolatility = bbWidth < avgBBWidth * 0.7;

  // Trend alignment check
  const bullishAlignment = ema8 > ema21 && ema21 > ema50 && price > ema8;
  const bearishAlignment = ema8 < ema21 && ema21 < ema50 && price < ema8;

  if (isTrending || isStrongTrend) {
    if (bullishAlignment) return 'TREND_UP';
    if (bearishAlignment) return 'TREND_DOWN';
    return 'RANGE_VOLATILE';  // ADX high but no clear direction
  }

  // Low ADX
  if (isLowVolatility) {
    return 'RANGE_QUIET';
  }

  return 'RANGE_VOLATILE';
}

function calculateTrendStrength(
  price: number,
  ema8: number,
  ema21: number,
  ema50: number
): number {
  // Calculate trend strength from -1 (strong bearish) to +1 (strong bullish)
  let score = 0;

  if (price > ema8) score += 0.25;
  else score -= 0.25;

  if (ema8 > ema21) score += 0.25;
  else score -= 0.25;

  if (ema21 > ema50) score += 0.25;
  else score -= 0.25;

  if (price > ema50) score += 0.25;
  else score -= 0.25;

  return score;
}

function getPricePosition(price: number, bbUpper: number, bbLower: number, bbMiddle: number): 'UPPER' | 'MIDDLE' | 'LOWER' {
  const range = bbUpper - bbLower;
  const upperThreshold = bbMiddle + range * 0.25;
  const lowerThreshold = bbMiddle - range * 0.25;

  if (price >= upperThreshold) return 'UPPER';
  if (price <= lowerThreshold) return 'LOWER';
  return 'MIDDLE';
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

function analyzeCandles(candles: Candle[]): CandleAnalysis[] {
  console.log('📊 Calculating indicators...');
  const indicators = calculateAllIndicators(candles);

  // Calculate average BB width for regime detection
  const avgBBWidth = indicators.bb.reduce((sum, b) => sum + (b.upper - b.lower) / b.middle, 0) / indicators.bb.length;

  // Align indicator arrays (they start at different offsets due to period requirements)
  const minLen = Math.min(
    indicators.atr.length,
    indicators.adx.length,
    indicators.bb.length,
    indicators.rsi.length,
    indicators.ema8.length,
    indicators.ema21.length,
    indicators.ema50.length
  );

  const results: CandleAnalysis[] = [];
  const candleOffset = candles.length - minLen;

  console.log(`📈 Analyzing ${minLen} candles with complete indicator data...`);

  for (let i = 0; i < minLen; i++) {
    const candle = candles[candleOffset + i]!;
    const date = new Date(candle.timestamp * 1000);
    const hourUTC = date.getUTCHours();

    // Get indicator values (aligned from end)
    const atrIdx = i - (minLen - indicators.atr.length);
    const adxIdx = i - (minLen - indicators.adx.length);
    const bbIdx = i - (minLen - indicators.bb.length);
    const rsiIdx = i - (minLen - indicators.rsi.length);
    const ema8Idx = i - (minLen - indicators.ema8.length);
    const ema21Idx = i - (minLen - indicators.ema21.length);
    const ema50Idx = i - (minLen - indicators.ema50.length);

    if (atrIdx < 0 || adxIdx < 0 || bbIdx < 0 || rsiIdx < 0 || ema8Idx < 0 || ema21Idx < 0 || ema50Idx < 0) {
      continue;
    }

    const atr = indicators.atr[atrIdx]!;
    const adx = indicators.adx[adxIdx]!;
    const bb = indicators.bb[bbIdx]!;
    const rsi = indicators.rsi[rsiIdx]!;
    const ema8 = indicators.ema8[ema8Idx]!;
    const ema21 = indicators.ema21[ema21Idx]!;
    const ema50 = indicators.ema50[ema50Idx]!;

    const price = candle.close;
    const range = candle.high - candle.low;
    const bbWidth = bb.upper - bb.lower;

    const regime = detectRegime(adx.adx, price, ema8, ema21, ema50, bbWidth / bb.middle, avgBBWidth);
    const trendStrength = calculateTrendStrength(price, ema8, ema21, ema50);
    const pricePosition = getPricePosition(price, bb.upper, bb.lower, bb.middle);
    const distanceFromBBMiddle = price - bb.middle;

    results.push({
      timestamp: candle.timestamp,
      dateUTC: formatDateUTC(candle.timestamp),
      hourUTC,
      dayOfWeek: getDayOfWeek(candle.timestamp),
      session: getSession(hourUTC),
      price,

      atr,
      atrPercent: (atr / price) * 100,
      range,
      rangePercent: (range / price) * 100,
      bbWidth,
      bbWidthPercent: (bbWidth / bb.middle) * 100,

      adx: adx.adx,
      regime,
      rsi,
      ema8,
      ema21,
      ema50,
      trendStrength,

      bbUpper: bb.upper,
      bbLower: bb.lower,
      bbMiddle: bb.middle,
      distanceFromBBMiddle,
      distanceFromBBMiddlePercent: (distanceFromBBMiddle / bb.middle) * 100,
      pricePosition,
    });
  }

  return results;
}

function calculateSessionStats(analysis: CandleAnalysis[]): SessionStats[] {
  const sessions: Session[] = ['ASIAN', 'LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP'];

  return sessions.map(session => {
    const filtered = analysis.filter(a => a.session === session);
    const count = filtered.length;

    if (count === 0) {
      return {
        session,
        count: 0,
        avgATR: 0,
        avgATRPercent: 0,
        avgRange: 0,
        avgRangePercent: 0,
        avgBBWidth: 0,
        avgADX: 0,
        trendPercent: 0,
        rangePercent: 0,
        avgRSI: 0,
        regimeDistribution: {
          'TREND_UP': 0, 'TREND_DOWN': 0, 'RANGE_QUIET': 0, 'RANGE_VOLATILE': 0, 'UNCERTAIN': 0
        },
      };
    }

    const regimeDistribution: Record<Regime, number> = {
      'TREND_UP': 0, 'TREND_DOWN': 0, 'RANGE_QUIET': 0, 'RANGE_VOLATILE': 0, 'UNCERTAIN': 0
    };
    filtered.forEach(a => regimeDistribution[a.regime]++);

    const trendCount = regimeDistribution['TREND_UP'] + regimeDistribution['TREND_DOWN'];
    const rangeCount = regimeDistribution['RANGE_QUIET'] + regimeDistribution['RANGE_VOLATILE'];

    return {
      session,
      count,
      avgATR: filtered.reduce((sum, a) => sum + a.atr, 0) / count,
      avgATRPercent: filtered.reduce((sum, a) => sum + a.atrPercent, 0) / count,
      avgRange: filtered.reduce((sum, a) => sum + a.range, 0) / count,
      avgRangePercent: filtered.reduce((sum, a) => sum + a.rangePercent, 0) / count,
      avgBBWidth: filtered.reduce((sum, a) => sum + a.bbWidthPercent, 0) / count,
      avgADX: filtered.reduce((sum, a) => sum + a.adx, 0) / count,
      trendPercent: (trendCount / count) * 100,
      rangePercent: (rangeCount / count) * 100,
      avgRSI: filtered.reduce((sum, a) => sum + a.rsi, 0) / count,
      regimeDistribution,
    };
  });
}

function calculateHourlyStats(analysis: CandleAnalysis[]): HourlyStats[] {
  const hourlyStats: HourlyStats[] = [];

  for (let hour = 0; hour < 24; hour++) {
    const filtered = analysis.filter(a => a.hourUTC === hour);
    const count = filtered.length;

    if (count === 0) {
      hourlyStats.push({
        hour,
        session: getSession(hour),
        count: 0,
        avgATR: 0,
        avgATRPercent: 0,
        avgADX: 0,
        trendPercent: 0,
        rangePercent: 0,
        avgRSI: 0,
        regimeDistribution: {
          'TREND_UP': 0, 'TREND_DOWN': 0, 'RANGE_QUIET': 0, 'RANGE_VOLATILE': 0, 'UNCERTAIN': 0
        },
      });
      continue;
    }

    const regimeDistribution: Record<Regime, number> = {
      'TREND_UP': 0, 'TREND_DOWN': 0, 'RANGE_QUIET': 0, 'RANGE_VOLATILE': 0, 'UNCERTAIN': 0
    };
    filtered.forEach(a => regimeDistribution[a.regime]++);

    const trendCount = regimeDistribution['TREND_UP'] + regimeDistribution['TREND_DOWN'];
    const rangeCount = regimeDistribution['RANGE_QUIET'] + regimeDistribution['RANGE_VOLATILE'];

    hourlyStats.push({
      hour,
      session: getSession(hour),
      count,
      avgATR: filtered.reduce((sum, a) => sum + a.atr, 0) / count,
      avgATRPercent: filtered.reduce((sum, a) => sum + a.atrPercent, 0) / count,
      avgADX: filtered.reduce((sum, a) => sum + a.adx, 0) / count,
      trendPercent: (trendCount / count) * 100,
      rangePercent: (rangeCount / count) * 100,
      avgRSI: filtered.reduce((sum, a) => sum + a.rsi, 0) / count,
      regimeDistribution,
    });
  }

  return hourlyStats;
}

function calculateDayOfWeekStats(analysis: CandleAnalysis[]): DayOfWeekStats[] {
  const days: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return days.map(day => {
    const filtered = analysis.filter(a => a.dayOfWeek === day);
    const count = filtered.length;

    if (count === 0) {
      return { day, count: 0, avgATR: 0, avgADX: 0, trendPercent: 0, rangePercent: 0 };
    }

    const trendCount = filtered.filter(a => a.regime === 'TREND_UP' || a.regime === 'TREND_DOWN').length;
    const rangeCount = filtered.filter(a => a.regime === 'RANGE_QUIET' || a.regime === 'RANGE_VOLATILE').length;

    return {
      day,
      count,
      avgATR: filtered.reduce((sum, a) => sum + a.atr, 0) / count,
      avgADX: filtered.reduce((sum, a) => sum + a.adx, 0) / count,
      trendPercent: (trendCount / count) * 100,
      rangePercent: (rangeCount / count) * 100,
    };
  });
}

function calculateMeanReversionStats(analysis: CandleAnalysis[]): MeanReversionStats[] {
  const sessions: Session[] = ['ASIAN', 'LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP'];

  return sessions.map(session => {
    const filtered = analysis.filter(a => a.session === session);

    let touchesUpper = 0;
    let touchesLower = 0;
    let reversionsUpper = 0;
    let reversionsLower = 0;
    const barsToReversion: number[] = [];
    const drawdowns: number[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const current = filtered[i]!;

      // Detect BB touches
      const upperTouch = current.price >= current.bbUpper * (1 - PARAMS.bbTouchThreshold);
      const lowerTouch = current.price <= current.bbLower * (1 + PARAMS.bbTouchThreshold);

      if (upperTouch) {
        touchesUpper++;
        // Look for reversion (price crosses back toward middle)
        let bars = 0;
        let maxDrawdown = 0;
        for (let j = i + 1; j < Math.min(i + 50, filtered.length); j++) {
          bars++;
          const future = filtered[j]!;
          const dd = (future.price - current.price) / current.price;
          if (dd > maxDrawdown) maxDrawdown = dd;

          // Reverted if crosses middle line
          if (future.price <= current.bbMiddle) {
            reversionsUpper++;
            barsToReversion.push(bars);
            drawdowns.push(Math.abs(maxDrawdown));
            break;
          }
        }
      }

      if (lowerTouch) {
        touchesLower++;
        let bars = 0;
        let maxDrawdown = 0;
        for (let j = i + 1; j < Math.min(i + 50, filtered.length); j++) {
          bars++;
          const future = filtered[j]!;
          const dd = (current.price - future.price) / current.price;
          if (dd > maxDrawdown) maxDrawdown = dd;

          if (future.price >= current.bbMiddle) {
            reversionsLower++;
            barsToReversion.push(bars);
            drawdowns.push(Math.abs(maxDrawdown));
            break;
          }
        }
      }
    }

    return {
      session,
      totalTouchesUpper: touchesUpper,
      totalTouchesLower: touchesLower,
      reversionsFromUpper: reversionsUpper,
      reversionsFromLower: reversionsLower,
      reversionRateUpper: touchesUpper > 0 ? (reversionsUpper / touchesUpper) * 100 : 0,
      reversionRateLower: touchesLower > 0 ? (reversionsLower / touchesLower) * 100 : 0,
      avgBarsToReversion: barsToReversion.length > 0
        ? barsToReversion.reduce((a, b) => a + b, 0) / barsToReversion.length
        : 0,
      avgDrawdownBeforeReversion: drawdowns.length > 0
        ? (drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length) * 100
        : 0,
    };
  });
}

function calculateAutocorrelation(analysis: CandleAnalysis[], lag: number = 1): number {
  const returns = analysis.map((a, i) => {
    if (i === 0) return 0;
    return (a.price - analysis[i - 1]!.price) / analysis[i - 1]!.price;
  }).slice(1);

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = lag; i < n; i++) {
    numerator += (returns[i]! - mean) * (returns[i - lag]! - mean);
  }

  for (let i = 0; i < n; i++) {
    denominator += Math.pow(returns[i]! - mean, 2);
  }

  return numerator / denominator;
}

// =============================================================================
// CSV EXPORT
// =============================================================================

function exportToCSV(analysis: CandleAnalysis[], symbol: string): void {
  // Export detailed analysis
  const detailedHeader = [
    'timestamp', 'dateUTC', 'hourUTC', 'dayOfWeek', 'session', 'price',
    'atr', 'atrPercent', 'range', 'rangePercent', 'bbWidth', 'bbWidthPercent',
    'adx', 'regime', 'rsi', 'ema8', 'ema21', 'ema50', 'trendStrength',
    'bbUpper', 'bbLower', 'bbMiddle', 'distanceFromBBMiddle', 'distanceFromBBMiddlePercent', 'pricePosition'
  ].join(',');

  const detailedRows = analysis.map(a => [
    a.timestamp, a.dateUTC, a.hourUTC, a.dayOfWeek, a.session, a.price,
    a.atr.toFixed(6), a.atrPercent.toFixed(4), a.range.toFixed(6), a.rangePercent.toFixed(4),
    a.bbWidth.toFixed(6), a.bbWidthPercent.toFixed(4),
    a.adx.toFixed(2), a.regime, a.rsi.toFixed(2),
    a.ema8.toFixed(6), a.ema21.toFixed(6), a.ema50.toFixed(6), a.trendStrength.toFixed(2),
    a.bbUpper.toFixed(6), a.bbLower.toFixed(6), a.bbMiddle.toFixed(6),
    a.distanceFromBBMiddle.toFixed(6), a.distanceFromBBMiddlePercent.toFixed(4), a.pricePosition
  ].join(','));

  const detailedCSV = [detailedHeader, ...detailedRows].join('\n');
  const detailedPath = join(OUTPUT_DIR, `${symbol}_detailed_analysis.csv`);
  writeFileSync(detailedPath, detailedCSV, 'utf-8');
  console.log(`💾 Saved: ${detailedPath}`);
}

function exportSessionStats(stats: SessionStats[], symbol: string): void {
  const header = [
    'session', 'count', 'avgATR', 'avgATRPercent', 'avgRange', 'avgRangePercent',
    'avgBBWidth', 'avgADX', 'trendPercent', 'rangePercent', 'avgRSI',
    'TREND_UP', 'TREND_DOWN', 'RANGE_QUIET', 'RANGE_VOLATILE', 'UNCERTAIN'
  ].join(',');

  const rows = stats.map(s => [
    s.session, s.count, s.avgATR.toFixed(6), s.avgATRPercent.toFixed(4),
    s.avgRange.toFixed(6), s.avgRangePercent.toFixed(4),
    s.avgBBWidth.toFixed(4), s.avgADX.toFixed(2), s.trendPercent.toFixed(2),
    s.rangePercent.toFixed(2), s.avgRSI.toFixed(2),
    s.regimeDistribution['TREND_UP'], s.regimeDistribution['TREND_DOWN'],
    s.regimeDistribution['RANGE_QUIET'], s.regimeDistribution['RANGE_VOLATILE'],
    s.regimeDistribution['UNCERTAIN']
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const path = join(OUTPUT_DIR, `${symbol}_session_stats.csv`);
  writeFileSync(path, csv, 'utf-8');
  console.log(`💾 Saved: ${path}`);
}

function exportHourlyStats(stats: HourlyStats[], symbol: string): void {
  const header = [
    'hour', 'session', 'count', 'avgATR', 'avgATRPercent', 'avgADX',
    'trendPercent', 'rangePercent', 'avgRSI',
    'TREND_UP', 'TREND_DOWN', 'RANGE_QUIET', 'RANGE_VOLATILE', 'UNCERTAIN'
  ].join(',');

  const rows = stats.map(s => [
    s.hour, s.session, s.count, s.avgATR.toFixed(6), s.avgATRPercent.toFixed(4),
    s.avgADX.toFixed(2), s.trendPercent.toFixed(2), s.rangePercent.toFixed(2), s.avgRSI.toFixed(2),
    s.regimeDistribution['TREND_UP'], s.regimeDistribution['TREND_DOWN'],
    s.regimeDistribution['RANGE_QUIET'], s.regimeDistribution['RANGE_VOLATILE'],
    s.regimeDistribution['UNCERTAIN']
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const path = join(OUTPUT_DIR, `${symbol}_hourly_stats.csv`);
  writeFileSync(path, csv, 'utf-8');
  console.log(`💾 Saved: ${path}`);
}

function exportDayOfWeekStats(stats: DayOfWeekStats[], symbol: string): void {
  const header = 'day,count,avgATR,avgADX,trendPercent,rangePercent';
  const rows = stats.map(s => [
    s.day, s.count, s.avgATR.toFixed(6), s.avgADX.toFixed(2),
    s.trendPercent.toFixed(2), s.rangePercent.toFixed(2)
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const path = join(OUTPUT_DIR, `${symbol}_day_of_week_stats.csv`);
  writeFileSync(path, csv, 'utf-8');
  console.log(`💾 Saved: ${path}`);
}

function exportMeanReversionStats(stats: MeanReversionStats[], symbol: string): void {
  const header = [
    'session', 'totalTouchesUpper', 'totalTouchesLower',
    'reversionsFromUpper', 'reversionsFromLower',
    'reversionRateUpper', 'reversionRateLower',
    'avgBarsToReversion', 'avgDrawdownBeforeReversion'
  ].join(',');

  const rows = stats.map(s => [
    s.session, s.totalTouchesUpper, s.totalTouchesLower,
    s.reversionsFromUpper, s.reversionsFromLower,
    s.reversionRateUpper.toFixed(2), s.reversionRateLower.toFixed(2),
    s.avgBarsToReversion.toFixed(1), s.avgDrawdownBeforeReversion.toFixed(4)
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const path = join(OUTPUT_DIR, `${symbol}_mean_reversion_stats.csv`);
  writeFileSync(path, csv, 'utf-8');
  console.log(`💾 Saved: ${path}`);
}

// =============================================================================
// CONSOLE OUTPUT
// =============================================================================

function printSummary(
  symbol: string,
  analysis: CandleAnalysis[],
  sessionStats: SessionStats[],
  hourlyStats: HourlyStats[],
  dayStats: DayOfWeekStats[],
  mrStats: MeanReversionStats[],
  autocorr: number
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`📊 MARKET CHARACTERIZATION SUMMARY - ${symbol}`);
  console.log('='.repeat(80));

  // Overall stats
  const totalTrend = analysis.filter(a => a.regime === 'TREND_UP' || a.regime === 'TREND_DOWN').length;
  const totalRange = analysis.filter(a => a.regime === 'RANGE_QUIET' || a.regime === 'RANGE_VOLATILE').length;

  console.log(`\n📈 OVERALL STATISTICS (${analysis.length} candles)`);
  console.log('-'.repeat(50));
  console.log(`  Trend Time: ${((totalTrend / analysis.length) * 100).toFixed(1)}%`);
  console.log(`  Range Time: ${((totalRange / analysis.length) * 100).toFixed(1)}%`);
  console.log(`  Autocorrelation (lag-1): ${autocorr.toFixed(4)}`);
  console.log(`  ${autocorr < 0 ? '➡️  Negative autocorr = Good for Mean Reversion' : '➡️  Positive autocorr = Good for Momentum'}`);

  // Session comparison
  console.log(`\n🌍 VOLATILITY BY SESSION`);
  console.log('-'.repeat(50));
  console.log('Session              | ATR%    | ADX    | Range% | Trend% ');
  console.log('-'.repeat(50));
  sessionStats.forEach(s => {
    console.log(
      `${s.session.padEnd(20)} | ${s.avgATRPercent.toFixed(3).padStart(6)}% | ${s.avgADX.toFixed(1).padStart(5)} | ${s.avgRangePercent.toFixed(3).padStart(6)}% | ${s.trendPercent.toFixed(1).padStart(5)}%`
    );
  });

  // Best session for mean reversion
  const bestMRSession = mrStats.reduce((best, curr) => {
    const currRate = (curr.reversionRateUpper + curr.reversionRateLower) / 2;
    const bestRate = (best.reversionRateUpper + best.reversionRateLower) / 2;
    return currRate > bestRate ? curr : best;
  });

  console.log(`\n🔄 MEAN REVERSION ANALYSIS`);
  console.log('-'.repeat(50));
  console.log('Session              | Touches | Reversions | Rate%  | Bars | DD%');
  console.log('-'.repeat(50));
  mrStats.forEach(s => {
    const totalTouches = s.totalTouchesUpper + s.totalTouchesLower;
    const totalReversions = s.reversionsFromUpper + s.reversionsFromLower;
    const rate = totalTouches > 0 ? (totalReversions / totalTouches) * 100 : 0;
    console.log(
      `${s.session.padEnd(20)} | ${totalTouches.toString().padStart(7)} | ${totalReversions.toString().padStart(10)} | ${rate.toFixed(1).padStart(5)}% | ${s.avgBarsToReversion.toFixed(0).padStart(4)} | ${s.avgDrawdownBeforeReversion.toFixed(2).padStart(4)}%`
    );
  });

  // Best hours for range trading
  const bestRangeHours = hourlyStats
    .filter(h => h.count > 0)
    .sort((a, b) => b.rangePercent - a.rangePercent)
    .slice(0, 5);

  console.log(`\n⏰ BEST HOURS FOR RANGE TRADING (Mean Reversion)`);
  console.log('-'.repeat(50));
  bestRangeHours.forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.hour.toString().padStart(2)}:00 UTC (${h.session}) - ${h.rangePercent.toFixed(1)}% range time`);
  });

  // Best hours for trend trading
  const bestTrendHours = hourlyStats
    .filter(h => h.count > 0)
    .sort((a, b) => b.trendPercent - a.trendPercent)
    .slice(0, 5);

  console.log(`\n📈 BEST HOURS FOR TREND TRADING (Momentum)`);
  console.log('-'.repeat(50));
  bestTrendHours.forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.hour.toString().padStart(2)}:00 UTC (${h.session}) - ${h.trendPercent.toFixed(1)}% trend time`);
  });

  // Day of week analysis
  console.log(`\n📅 DAY OF WEEK ANALYSIS`);
  console.log('-'.repeat(50));
  dayStats.forEach(d => {
    if (d.count > 0) {
      console.log(`  ${d.day.padEnd(10)}: Range ${d.rangePercent.toFixed(1)}% | Trend ${d.trendPercent.toFixed(1)}%`);
    }
  });

  // Recommendations
  console.log(`\n💡 RECOMMENDATIONS`);
  console.log('='.repeat(50));

  const lowestVolSession = sessionStats.reduce((min, curr) =>
    curr.avgATRPercent < min.avgATRPercent && curr.count > 0 ? curr : min
  );
  const highestVolSession = sessionStats.reduce((max, curr) =>
    curr.avgATRPercent > max.avgATRPercent && curr.count > 0 ? curr : max
  );

  console.log(`\n  📉 MEAN REVERSION:`);
  console.log(`     Best Session: ${bestMRSession.session}`);
  console.log(`     Reversion Rate: ${((bestMRSession.reversionRateUpper + bestMRSession.reversionRateLower) / 2).toFixed(1)}%`);
  console.log(`     Lowest Volatility: ${lowestVolSession.session} (ATR: ${lowestVolSession.avgATRPercent.toFixed(3)}%)`);

  console.log(`\n  📈 MOMENTUM/TREND:`);
  console.log(`     Best Session: ${highestVolSession.session}`);
  console.log(`     Highest Volatility: ATR ${highestVolSession.avgATRPercent.toFixed(3)}%`);
  console.log(`     Trend Time: ${highestVolSession.trendPercent.toFixed(1)}%`);

  if (autocorr < -0.05) {
    console.log(`\n  ✅ Negative autocorrelation (${autocorr.toFixed(4)}) suggests mean reversion is viable`);
  } else if (autocorr > 0.05) {
    console.log(`\n  ✅ Positive autocorrelation (${autocorr.toFixed(4)}) suggests momentum/trend following is viable`);
  } else {
    console.log(`\n  ⚠️  Weak autocorrelation (${autocorr.toFixed(4)}) - both strategies may work equally`);
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('🔬 FOREX MARKET CHARACTERIZATION ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('='.repeat(80));

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const symbol of SYMBOLS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Analyzing ${symbol}...`);
    console.log('='.repeat(80));

    // Try to load from CSV first, then fetch from gateway
    let candles: Candle[] | null = null;

    const possiblePaths = [
      join(process.cwd(), 'backtest-data', `${symbol}_60s_${DAYS}d.csv`),
      join(process.cwd(), 'backtest-data', `${symbol}_1m_${DAYS}d.csv`),
      join(process.cwd(), 'analysis-output', `${symbol}_raw_candles.csv`),
    ];

    for (const path of possiblePaths) {
      candles = loadCandlesFromCSV(path);
      if (candles && candles.length > 0) break;
    }

    if (!candles || candles.length === 0) {
      try {
        candles = await fetchDataFromGateway(symbol, DAYS);

        // Save raw candles for future use
        const rawPath = join(OUTPUT_DIR, `${symbol}_raw_candles.csv`);
        const rawHeader = 'timestamp,open,high,low,close,volume';
        const rawRows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume || 0}`);
        writeFileSync(rawPath, [rawHeader, ...rawRows].join('\n'), 'utf-8');
        console.log(`💾 Saved raw candles: ${rawPath}`);
      } catch (error: any) {
        console.error(`❌ Failed to fetch data for ${symbol}: ${error.message}`);
        continue;
      }
    }

    if (!candles || candles.length < 100) {
      console.error(`❌ Insufficient data for ${symbol} (${candles?.length || 0} candles)`);
      continue;
    }

    console.log(`📊 Total candles: ${candles.length}`);
    console.log(`📅 Period: ${formatDateUTC(candles[0]!.timestamp)} to ${formatDateUTC(candles[candles.length - 1]!.timestamp)}`);

    // Perform analysis
    const analysis = analyzeCandles(candles);
    const sessionStats = calculateSessionStats(analysis);
    const hourlyStats = calculateHourlyStats(analysis);
    const dayStats = calculateDayOfWeekStats(analysis);
    const mrStats = calculateMeanReversionStats(analysis);
    const autocorr = calculateAutocorrelation(analysis);

    // Export to CSV
    console.log('\n📁 Exporting CSV files...');
    exportToCSV(analysis, symbol);
    exportSessionStats(sessionStats, symbol);
    exportHourlyStats(hourlyStats, symbol);
    exportDayOfWeekStats(dayStats, symbol);
    exportMeanReversionStats(mrStats, symbol);

    // Print summary
    printSummary(symbol, analysis, sessionStats, hourlyStats, dayStats, mrStats, autocorr);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Analysis complete!');
  console.log(`📁 CSV files saved to: ${OUTPUT_DIR}`);
  console.log('\nNext steps:');
  console.log('  1. cd analysis-output');
  console.log('  2. jupyter notebook');
  console.log('  3. Open forex_visualization.ipynb');
  console.log('='.repeat(80));
}

main().catch(console.error);
