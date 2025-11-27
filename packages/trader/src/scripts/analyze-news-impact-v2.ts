/**
 * Analyze News Impact on Mean Reversion Strategy - V2
 *
 * Uses raw candle data (OHLC) and calculates indicators on the fly
 * Much faster than loading pre-calculated detailed analysis
 *
 * Usage:
 *   SYMBOL=frxEURUSD npx tsx src/scripts/analyze-news-impact-v2.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { BollingerBands, RSI, ADX } from 'technicalindicators';

dotenv.config();

// =============================================================================
// CONFIGURATION
// =============================================================================

const INPUT_DIR = process.env.INPUT_DIR || './analysis-output';
const SYMBOL = process.env.SYMBOL || 'frxEURUSD';
const GRANULARITY = process.env.GRANULARITY || '300'; // 5 min default

// News window configurations to test
const WINDOW_CONFIGS = [
  { name: 'Conservative', preHigh: 15, postHigh: 30, preMed: 10, postMed: 15 },
  { name: 'Moderate', preHigh: 30, postHigh: 60, preMed: 15, postMed: 30 },
  { name: 'Standard', preHigh: 60, postHigh: 90, preMed: 30, postMed: 60 },
  { name: 'Aggressive', preHigh: 90, postHigh: 120, preMed: 45, postMed: 90 },
];

// BB Settings
const BB_PERIOD = 20;
const BB_STD_DEV = 2;

// RSI Settings
const RSI_PERIOD = 14;

// ADX Settings
const ADX_PERIOD = 14;

// =============================================================================
// TYPES
// =============================================================================

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface EnrichedCandle extends Candle {
  session: string;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  rsi: number;
  adx: number;
  regime: string;
}

interface EconomicEvent {
  id: string;
  name: string;
  currency: string;
  category: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: number;
  date: string;
  time: string;
}

interface MRSignal {
  timestamp: number;
  direction: 'long' | 'short';
  session: string;
  newsCategory: string;
  nearestEvent?: string;
  minutesToEvent?: number;
  reverted: boolean;
  barsToReversion: number;
  maxDrawdown: number;
}

// =============================================================================
// DATA LOADING
// =============================================================================

function loadCandles(): Candle[] {
  // Try different file naming patterns
  const patterns = [
    `${SYMBOL}_${GRANULARITY}s_365d.csv`,
    `${SYMBOL}_raw_candles.csv`,
    `${SYMBOL}_candles.csv`,
  ];

  for (const pattern of patterns) {
    const filePath = join(INPUT_DIR, pattern);
    if (existsSync(filePath)) {
      console.log(`📂 Loading: ${filePath}`);
      const csv = readFileSync(filePath, 'utf-8');
      const lines = csv.trim().split('\n');
      const headers = lines[0]!.split(',');

      return lines.slice(1).map((line) => {
        const values = line.split(',');
        return {
          timestamp: parseInt(values[0]!, 10),
          open: parseFloat(values[1]!),
          high: parseFloat(values[2]!),
          low: parseFloat(values[3]!),
          close: parseFloat(values[4]!),
        };
      });
    }
  }

  throw new Error(`No candle data found for ${SYMBOL} in ${INPUT_DIR}`);
}

function loadEvents(): EconomicEvent[] {
  const filePath = join(INPUT_DIR, 'economic_events.csv');

  if (!existsSync(filePath)) {
    console.warn('⚠️  No economic events file found, running without news filter');
    return [];
  }

  const csv = readFileSync(filePath, 'utf-8');
  const lines = csv.trim().split('\n');

  return lines.slice(1).map((line) => {
    // Parse quoted CSV
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return {
      id: values[0]!,
      name: values[1]!,
      currency: values[2]!,
      category: values[3]!,
      impact: values[4] as 'HIGH' | 'MEDIUM' | 'LOW',
      timestamp: parseInt(values[5]!, 10),
      date: values[6]!,
      time: values[7]!,
    };
  });
}

// =============================================================================
// INDICATORS
// =============================================================================

function getSession(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const hour = date.getUTCHours();

  if (hour >= 0 && hour < 7) return 'ASIAN';
  if (hour >= 7 && hour < 13) return 'LONDON';
  if (hour >= 13 && hour < 16) return 'LONDON_NY_OVERLAP';
  if (hour >= 16 && hour < 22) return 'NEW_YORK';
  return 'ASIAN'; // 22-24 is Asian next day
}

function enrichCandles(candles: Candle[]): EnrichedCandle[] {
  console.log('📊 Calculating indicators...');

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // Calculate Bollinger Bands
  const bbResult = BollingerBands.calculate({
    period: BB_PERIOD,
    values: closes,
    stdDev: BB_STD_DEV,
  });

  // Calculate RSI
  const rsiResult = RSI.calculate({
    period: RSI_PERIOD,
    values: closes,
  });

  // Calculate ADX
  const adxResult = ADX.calculate({
    period: ADX_PERIOD,
    high: highs,
    low: lows,
    close: closes,
  });

  // Pad results to align with candles
  const bbPadded = new Array(BB_PERIOD - 1).fill(null).concat(bbResult);
  const rsiPadded = new Array(RSI_PERIOD).fill(null).concat(rsiResult);
  const adxPadded = new Array(ADX_PERIOD * 2 - 1).fill(null).concat(adxResult);

  return candles.map((candle, i) => {
    const bb = bbPadded[i];
    const rsi = rsiPadded[i];
    const adx = adxPadded[i];

    let regime = 'RANGE_QUIET';
    if (adx && adx.adx > 25) {
      regime = candle.close > candle.open ? 'TREND_UP' : 'TREND_DOWN';
    } else if (bb) {
      const bbWidth = (bb.upper - bb.lower) / bb.middle;
      regime = bbWidth > 0.02 ? 'RANGE_VOLATILE' : 'RANGE_QUIET';
    }

    return {
      ...candle,
      session: getSession(candle.timestamp),
      bbUpper: bb?.upper || 0,
      bbMiddle: bb?.middle || 0,
      bbLower: bb?.lower || 0,
      rsi: rsi || 50,
      adx: adx?.adx || 0,
      regime,
    };
  });
}

// =============================================================================
// NEWS CLASSIFICATION
// =============================================================================

function classifyNewsWindow(
  timestamp: number,
  events: EconomicEvent[],
  config: typeof WINDOW_CONFIGS[0]
): { category: string; nearestEvent?: EconomicEvent; minutesToEvent?: number } {
  if (events.length === 0) {
    return { category: 'NO_NEWS' };
  }

  // Find nearest event
  let nearestEvent: EconomicEvent | undefined;
  let minDistance = Infinity;

  for (const event of events) {
    const distance = Math.abs(event.timestamp - timestamp);
    if (distance < minDistance) {
      minDistance = distance;
      nearestEvent = event;
    }
  }

  if (!nearestEvent) {
    return { category: 'NO_NEWS' };
  }

  const minutesToEvent = (nearestEvent.timestamp - timestamp) / 60;
  const absMinutes = Math.abs(minutesToEvent);

  // Check HIGH impact
  if (nearestEvent.impact === 'HIGH') {
    if (
      (minutesToEvent > 0 && minutesToEvent <= config.preHigh) ||
      (minutesToEvent < 0 && absMinutes <= config.postHigh)
    ) {
      return { category: 'NEWS_HIGH', nearestEvent, minutesToEvent: Math.round(minutesToEvent) };
    }
  }

  // Check MEDIUM impact
  if (nearestEvent.impact === 'MEDIUM') {
    if (
      (minutesToEvent > 0 && minutesToEvent <= config.preMed) ||
      (minutesToEvent < 0 && absMinutes <= config.postMed)
    ) {
      return { category: 'NEWS_MEDIUM', nearestEvent, minutesToEvent: Math.round(minutesToEvent) };
    }
  }

  // Check major event day
  const majorEvents = ['Non-Farm', 'NFP', 'FOMC', 'ECB Interest Rate', 'CPI'];
  const dayStart = new Date(timestamp * 1000);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const majorToday = events.find(
    (e) =>
      e.timestamp >= dayStart.getTime() / 1000 &&
      e.timestamp < dayEnd.getTime() / 1000 &&
      majorEvents.some((m) => e.name.includes(m))
  );

  if (majorToday) {
    return {
      category: 'NEWS_DAY',
      nearestEvent: majorToday,
      minutesToEvent: Math.round((majorToday.timestamp - timestamp) / 60),
    };
  }

  return { category: 'NO_NEWS', nearestEvent, minutesToEvent: Math.round(minutesToEvent) };
}

// =============================================================================
// MEAN REVERSION DETECTION
// =============================================================================

function detectMRSignals(
  candles: EnrichedCandle[],
  events: EconomicEvent[],
  config: typeof WINDOW_CONFIGS[0]
): MRSignal[] {
  const signals: MRSignal[] = [];
  const lookback = 20;

  for (let i = lookback; i < candles.length - 20; i++) {
    const candle = candles[i]!;

    // Skip if no BB data
    if (!candle.bbUpper || !candle.bbLower || !candle.bbMiddle) continue;

    // Skip if in trend
    if (candle.regime.includes('TREND')) continue;

    // Skip if ADX too high
    if (candle.adx > 25) continue;

    // Detect BB touch with RSI confirmation
    let direction: 'long' | 'short' | null = null;

    if (candle.close <= candle.bbLower && candle.rsi < 35) {
      direction = 'long';
    } else if (candle.close >= candle.bbUpper && candle.rsi > 65) {
      direction = 'short';
    }

    if (!direction) continue;

    // Classify news
    const newsClass = classifyNewsWindow(candle.timestamp, events, config);

    // Check reversion
    let reverted = false;
    let barsToReversion = 0;
    let maxDrawdown = 0;

    for (let j = i + 1; j < Math.min(i + 21, candles.length); j++) {
      const future = candles[j]!;
      barsToReversion++;

      if (direction === 'long') {
        const dd = (candle.close - future.low) / candle.close;
        maxDrawdown = Math.max(maxDrawdown, dd);
        if (future.high >= candle.bbMiddle) {
          reverted = true;
          break;
        }
      } else {
        const dd = (future.high - candle.close) / candle.close;
        maxDrawdown = Math.max(maxDrawdown, dd);
        if (future.low <= candle.bbMiddle) {
          reverted = true;
          break;
        }
      }
    }

    signals.push({
      timestamp: candle.timestamp,
      direction,
      session: candle.session,
      newsCategory: newsClass.category,
      nearestEvent: newsClass.nearestEvent?.name,
      minutesToEvent: newsClass.minutesToEvent,
      reverted,
      barsToReversion,
      maxDrawdown: maxDrawdown * 100,
    });
  }

  return signals;
}

// =============================================================================
// ANALYSIS
// =============================================================================

interface Stats {
  category: string;
  signals: number;
  reverted: number;
  revRate: number;
  avgBars: number;
  avgDD: number;
  maxDD: number;
}

function analyzeByCategory(signals: MRSignal[]): Stats[] {
  const categories = ['NO_NEWS', 'NEWS_MEDIUM', 'NEWS_HIGH', 'NEWS_DAY'];

  return categories.map((cat) => {
    const catSignals = signals.filter((s) => s.newsCategory === cat);
    const reverted = catSignals.filter((s) => s.reverted);

    return {
      category: cat,
      signals: catSignals.length,
      reverted: reverted.length,
      revRate: catSignals.length > 0 ? (reverted.length / catSignals.length) * 100 : 0,
      avgBars: reverted.length > 0 ? reverted.reduce((s, x) => s + x.barsToReversion, 0) / reverted.length : 0,
      avgDD: catSignals.length > 0 ? catSignals.reduce((s, x) => s + x.maxDrawdown, 0) / catSignals.length : 0,
      maxDD: catSignals.length > 0 ? Math.max(...catSignals.map((x) => x.maxDrawdown)) : 0,
    };
  });
}

function analyzeBySession(signals: MRSignal[]): Record<string, { noNews: Stats; withNews: Stats; improvement: number }> {
  const sessions = ['ASIAN', 'LONDON', 'LONDON_NY_OVERLAP', 'NEW_YORK'];
  const result: Record<string, { noNews: Stats; withNews: Stats; improvement: number }> = {};

  for (const session of sessions) {
    const sessionSignals = signals.filter((s) => s.session === session);

    const noNews = sessionSignals.filter((s) => s.newsCategory === 'NO_NEWS');
    const withNews = sessionSignals.filter((s) => s.newsCategory !== 'NO_NEWS');

    const noNewsReverted = noNews.filter((s) => s.reverted);
    const withNewsReverted = withNews.filter((s) => s.reverted);

    const noNewsRate = noNews.length > 0 ? (noNewsReverted.length / noNews.length) * 100 : 0;
    const withNewsRate = withNews.length > 0 ? (withNewsReverted.length / withNews.length) * 100 : 0;

    result[session] = {
      noNews: {
        category: 'NO_NEWS',
        signals: noNews.length,
        reverted: noNewsReverted.length,
        revRate: noNewsRate,
        avgBars: noNewsReverted.length > 0 ? noNewsReverted.reduce((s, x) => s + x.barsToReversion, 0) / noNewsReverted.length : 0,
        avgDD: noNews.length > 0 ? noNews.reduce((s, x) => s + x.maxDrawdown, 0) / noNews.length : 0,
        maxDD: noNews.length > 0 ? Math.max(...noNews.map((x) => x.maxDrawdown)) : 0,
      },
      withNews: {
        category: 'WITH_NEWS',
        signals: withNews.length,
        reverted: withNewsReverted.length,
        revRate: withNewsRate,
        avgBars: withNewsReverted.length > 0 ? withNewsReverted.reduce((s, x) => s + x.barsToReversion, 0) / withNewsReverted.length : 0,
        avgDD: withNews.length > 0 ? withNews.reduce((s, x) => s + x.maxDrawdown, 0) / withNews.length : 0,
        maxDD: withNews.length > 0 ? Math.max(...withNews.map((x) => x.maxDrawdown)) : 0,
      },
      improvement: noNewsRate - withNewsRate,
    };
  }

  return result;
}

function analyzeByEventType(signals: MRSignal[]): Array<{ event: string; signals: number; revRate: number; avgDD: number }> {
  const groups: Record<string, MRSignal[]> = {};

  for (const sig of signals) {
    if (!sig.nearestEvent) continue;

    let eventType = sig.nearestEvent;
    if (eventType.includes('Non-Farm') || eventType.includes('NFP')) eventType = 'NFP';
    else if (eventType.includes('FOMC')) eventType = 'FOMC';
    else if (eventType.includes('ECB') && eventType.includes('Rate')) eventType = 'ECB Rate';
    else if (eventType.includes('CPI')) eventType = 'CPI';
    else if (eventType.includes('GDP')) eventType = 'GDP';
    else if (eventType.includes('Jobless')) eventType = 'Jobless Claims';
    else if (eventType.includes('PMI') || eventType.includes('ISM')) eventType = 'PMI/ISM';
    else if (eventType.includes('Retail')) eventType = 'Retail Sales';
    else eventType = 'Other';

    if (!groups[eventType]) groups[eventType] = [];
    groups[eventType]!.push(sig);
  }

  return Object.entries(groups)
    .map(([event, sigs]) => ({
      event,
      signals: sigs.length,
      revRate: (sigs.filter((s) => s.reverted).length / sigs.length) * 100,
      avgDD: sigs.reduce((s, x) => s + x.maxDrawdown, 0) / sigs.length,
    }))
    .sort((a, b) => a.revRate - b.revRate);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('📊 NEWS IMPACT ANALYSIS V2 - Mean Reversion');
  console.log('='.repeat(80));
  console.log(`Symbol: ${SYMBOL}`);
  console.log('='.repeat(80));

  // Load data
  const candles = loadCandles();
  const events = loadEvents();

  console.log(`✅ Loaded ${candles.length.toLocaleString()} candles`);
  console.log(`✅ Loaded ${events.length} economic events`);

  // Get date range
  const firstDate = new Date(candles[0]!.timestamp * 1000).toISOString().split('T')[0];
  const lastDate = new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString().split('T')[0];
  console.log(`📅 Date range: ${firstDate} to ${lastDate}`);

  // Enrich candles
  const enriched = enrichCandles(candles);
  console.log('✅ Indicators calculated');

  // Store results
  const allResults: Record<string, {
    config: typeof WINDOW_CONFIGS[0];
    categoryStats: Stats[];
    sessionStats: ReturnType<typeof analyzeBySession>;
    eventStats: ReturnType<typeof analyzeByEventType>;
    signals: MRSignal[];
  }> = {};

  // Analyze each window
  for (const config of WINDOW_CONFIGS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 ${config.name}: HIGH ±${config.preHigh}/${config.postHigh}min, MED ±${config.preMed}/${config.postMed}min`);
    console.log('='.repeat(60));

    const signals = detectMRSignals(enriched, events, config);
    console.log(`  Signals: ${signals.length}`);

    const categoryStats = analyzeByCategory(signals);
    const sessionStats = analyzeBySession(signals);
    const eventStats = analyzeByEventType(signals.filter((s) => s.newsCategory !== 'NO_NEWS'));

    // Print category stats
    console.log('\n  📈 By Category:');
    console.log('  ' + '-'.repeat(65));
    for (const stat of categoryStats) {
      console.log(`  ${stat.category.padEnd(12)} | ${stat.signals.toString().padStart(5)} sig | ${stat.revRate.toFixed(1).padStart(5)}% rev | ${stat.avgDD.toFixed(3)}% DD`);
    }

    // Print session stats
    console.log('\n  📊 Session × News:');
    for (const [session, data] of Object.entries(sessionStats)) {
      const imp = data.improvement > 0 ? `+${data.improvement.toFixed(1)}` : data.improvement.toFixed(1);
      console.log(`  ${session.padEnd(18)} | NoNews: ${data.noNews.revRate.toFixed(1)}% | News: ${data.withNews.revRate.toFixed(1)}% | Δ: ${imp}%`);
    }

    allResults[config.name] = { config, categoryStats, sessionStats, eventStats, signals };
  }

  // Find best window
  console.log('\n' + '='.repeat(80));
  console.log('🏆 RECOMMENDATION');
  console.log('='.repeat(80));

  let bestName = 'Standard';
  let bestImprovement = 0;

  for (const [name, result] of Object.entries(allResults)) {
    const noNews = result.categoryStats.find((s) => s.category === 'NO_NEWS');
    const highNews = result.categoryStats.find((s) => s.category === 'NEWS_HIGH');

    const improvement = (noNews?.revRate || 0) - (highNews?.revRate || 0);

    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      bestName = name;
    }
  }

  const best = allResults[bestName]!;
  const noNewsRate = best.categoryStats.find((s) => s.category === 'NO_NEWS')?.revRate || 0;
  const highNewsRate = best.categoryStats.find((s) => s.category === 'NEWS_HIGH')?.revRate || 0;

  console.log(`\n✅ Best Window: ${bestName}`);
  console.log(`   HIGH impact: -${best.config.preHigh}min to +${best.config.postHigh}min`);
  console.log(`   MEDIUM impact: -${best.config.preMed}min to +${best.config.postMed}min`);
  console.log(`\n   NO_NEWS reversion: ${noNewsRate.toFixed(1)}%`);
  console.log(`   NEWS_HIGH reversion: ${highNewsRate.toFixed(1)}%`);
  console.log(`   Improvement: +${bestImprovement.toFixed(1)}%`);

  // Event breakdown
  if (best.eventStats.length > 0) {
    console.log('\n🎯 Worst Events (lowest reversion rate):');
    for (const e of best.eventStats.slice(0, 5)) {
      console.log(`   ${e.event.padEnd(15)} | ${e.revRate.toFixed(1)}% rev | ${e.avgDD.toFixed(3)}% DD`);
    }
  }

  // Save results
  console.log('\n💾 Saving results...');

  // Save recommendation
  const recommendation = {
    symbol: SYMBOL,
    dataRange: { from: firstDate, to: lastDate },
    totalCandles: candles.length,
    totalSignals: best.signals.length,
    recommendedWindow: {
      name: bestName,
      highImpact: { before: best.config.preHigh, after: best.config.postHigh },
      mediumImpact: { before: best.config.preMed, after: best.config.postMed },
    },
    results: {
      noNewsRevRate: noNewsRate,
      highNewsRevRate: highNewsRate,
      improvement: bestImprovement,
    },
    worstEvents: best.eventStats.slice(0, 5).map((e) => e.event),
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(
    join(INPUT_DIR, `${SYMBOL}_news_analysis_recommendation.json`),
    JSON.stringify(recommendation, null, 2)
  );

  // Save category stats CSV
  const catCsv = [
    'window,category,signals,reverted,revRate,avgBars,avgDD,maxDD',
    ...Object.entries(allResults).flatMap(([name, res]) =>
      res.categoryStats.map((s) =>
        `${name},${s.category},${s.signals},${s.reverted},${s.revRate.toFixed(2)},${s.avgBars.toFixed(2)},${s.avgDD.toFixed(4)},${s.maxDD.toFixed(4)}`
      )
    ),
  ].join('\n');

  writeFileSync(join(INPUT_DIR, `${SYMBOL}_news_impact_categories.csv`), catCsv);

  console.log('✅ Results saved to analysis-output/');
  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
