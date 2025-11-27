/**
 * Analyze News Impact on Mean Reversion Strategy
 *
 * Crosses economic calendar events with price data to measure:
 * - Impact on mean reversion success rate
 * - Optimal news windows (before/after)
 * - Best sessions with/without news
 *
 * Usage:
 *   npx tsx src/scripts/analyze-news-impact.ts
 *
 * Requires:
 *   - analysis-output/frxEURUSD_detailed_analysis.csv (from forex-market-characterization.ts)
 *   - analysis-output/economic_events.csv (from fetch-economic-calendar.ts)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

// =============================================================================
// CONFIGURATION
// =============================================================================

const INPUT_DIR = process.env.INPUT_DIR || './analysis-output';
const SYMBOL = process.env.SYMBOL || 'frxEURUSD';

// News window configurations to test
const WINDOW_CONFIGS = [
  { name: 'Conservative', preHigh: 15, postHigh: 30, preMed: 10, postMed: 15 },
  { name: 'Moderate', preHigh: 30, postHigh: 60, preMed: 15, postMed: 30 },
  { name: 'Standard', preHigh: 60, postHigh: 90, preMed: 30, postMed: 60 },
  { name: 'Aggressive', preHigh: 90, postHigh: 120, preMed: 45, postMed: 90 },
];

// =============================================================================
// TYPES
// =============================================================================

interface PriceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  session: string;
  regime: string;
  adx: number;
  rsi: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  pricePosition: string;
  atrPercent: number;
  hourUTC: number;
  dayOfWeek: string;
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

interface NewsClassification {
  category: 'NO_NEWS' | 'NEWS_LOW' | 'NEWS_MEDIUM' | 'NEWS_HIGH' | 'NEWS_DAY';
  nearestEvent?: EconomicEvent;
  minutesToEvent?: number;
}

interface MeanReversionSignal {
  timestamp: number;
  direction: 'long' | 'short';
  entryPrice: number;
  bbBand: number;
  bbMiddle: number;
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

function loadPriceData(): PriceCandle[] {
  const filePath = join(INPUT_DIR, `${SYMBOL}_detailed_analysis.csv`);

  if (!existsSync(filePath)) {
    throw new Error(`Price data not found: ${filePath}\nRun: SYMBOLS="${SYMBOL}" npx tsx src/scripts/forex-market-characterization.ts`);
  }

  const csv = readFileSync(filePath, 'utf-8');
  const lines = csv.trim().split('\n');
  const headers = lines[0]!.split(',');

  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const obj: Record<string, string | number> = {};

    headers.forEach((h, i) => {
      const val = values[i] || '';
      // Try to parse as number
      const num = parseFloat(val);
      obj[h] = isNaN(num) ? val : num;
    });

    return obj as unknown as PriceCandle;
  });
}

function loadEconomicEvents(): EconomicEvent[] {
  const filePath = join(INPUT_DIR, 'economic_events.csv');

  if (!existsSync(filePath)) {
    throw new Error(`Economic events not found: ${filePath}\nRun: npx tsx src/scripts/fetch-economic-calendar.ts`);
  }

  const csv = readFileSync(filePath, 'utf-8');
  const lines = csv.trim().split('\n');
  const headers = lines[0]!.split(',').map((h) => h.replace(/"/g, ''));

  return lines.slice(1).map((line) => {
    // Handle quoted CSV fields
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

    const obj: Record<string, string | number> = {};
    headers.forEach((h, i) => {
      const val = values[i] || '';
      if (h === 'timestamp') {
        obj[h] = parseInt(val, 10);
      } else {
        obj[h] = val;
      }
    });

    return obj as unknown as EconomicEvent;
  });
}

// =============================================================================
// NEWS CLASSIFICATION
// =============================================================================

function classifyNewsWindow(
  timestamp: number,
  events: EconomicEvent[],
  config: typeof WINDOW_CONFIGS[0]
): NewsClassification {
  // Filter events for relevant currencies (USD, EUR for EUR/USD pair)
  const relevantEvents = events.filter(
    (e) => e.currency === 'USD' || e.currency === 'EUR'
  );

  // Find nearest event
  let nearestEvent: EconomicEvent | undefined;
  let minDistance = Infinity;

  for (const event of relevantEvents) {
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

  // Check HIGH impact events
  if (nearestEvent.impact === 'HIGH') {
    const windowBefore = minutesToEvent > 0 ? config.preHigh : 0;
    const windowAfter = minutesToEvent < 0 ? config.postHigh : 0;

    if (
      (minutesToEvent > 0 && minutesToEvent <= config.preHigh) ||
      (minutesToEvent < 0 && absMinutes <= config.postHigh)
    ) {
      return {
        category: 'NEWS_HIGH',
        nearestEvent,
        minutesToEvent: Math.round(minutesToEvent),
      };
    }
  }

  // Check MEDIUM impact events
  if (nearestEvent.impact === 'MEDIUM') {
    if (
      (minutesToEvent > 0 && minutesToEvent <= config.preMed) ||
      (minutesToEvent < 0 && absMinutes <= config.postMed)
    ) {
      return {
        category: 'NEWS_MEDIUM',
        nearestEvent,
        minutesToEvent: Math.round(minutesToEvent),
      };
    }
  }

  // Check if it's a major event day (NFP, FOMC, ECB)
  const majorEventNames = ['Non-Farm', 'NFP', 'FOMC', 'ECB Interest Rate'];
  const dayStart = new Date(timestamp * 1000);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const majorEventToday = relevantEvents.find(
    (e) =>
      e.timestamp >= dayStart.getTime() / 1000 &&
      e.timestamp < dayEnd.getTime() / 1000 &&
      majorEventNames.some((m) => e.name.includes(m))
  );

  if (majorEventToday) {
    return {
      category: 'NEWS_DAY',
      nearestEvent: majorEventToday,
      minutesToEvent: Math.round((majorEventToday.timestamp - timestamp) / 60),
    };
  }

  return { category: 'NO_NEWS', nearestEvent, minutesToEvent: Math.round(minutesToEvent) };
}

// =============================================================================
// MEAN REVERSION ANALYSIS
// =============================================================================

function detectMRSignals(
  candles: PriceCandle[],
  events: EconomicEvent[],
  windowConfig: typeof WINDOW_CONFIGS[0]
): MeanReversionSignal[] {
  const signals: MeanReversionSignal[] = [];

  for (let i = 20; i < candles.length - 20; i++) {
    const candle = candles[i]!;

    // Skip if in trend regime
    if (candle.regime.includes('TREND')) continue;

    // Skip if ADX too high
    if (candle.adx > 25) continue;

    // Detect BB touch
    let direction: 'long' | 'short' | null = null;
    let bbBand = 0;

    if (candle.close <= candle.bbLower && candle.rsi < 35) {
      direction = 'long';
      bbBand = candle.bbLower;
    } else if (candle.close >= candle.bbUpper && candle.rsi > 65) {
      direction = 'short';
      bbBand = candle.bbUpper;
    }

    if (!direction) continue;

    // Classify news window
    const newsClass = classifyNewsWindow(candle.timestamp, events, windowConfig);

    // Check for reversion in next 20 candles
    let reverted = false;
    let barsToReversion = 0;
    let maxDrawdown = 0;

    for (let j = i + 1; j < Math.min(i + 21, candles.length); j++) {
      const futureCandle = candles[j]!;
      barsToReversion++;

      // Calculate drawdown
      if (direction === 'long') {
        const drawdown = (candle.close - futureCandle.low) / candle.close;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        // Check reversion to middle band
        if (futureCandle.high >= candle.bbMiddle) {
          reverted = true;
          break;
        }
      } else {
        const drawdown = (futureCandle.high - candle.close) / candle.close;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        if (futureCandle.low <= candle.bbMiddle) {
          reverted = true;
          break;
        }
      }
    }

    signals.push({
      timestamp: candle.timestamp,
      direction,
      entryPrice: candle.close,
      bbBand,
      bbMiddle: candle.bbMiddle,
      session: candle.session,
      newsCategory: newsClass.category,
      nearestEvent: newsClass.nearestEvent?.name,
      minutesToEvent: newsClass.minutesToEvent,
      reverted,
      barsToReversion,
      maxDrawdown: maxDrawdown * 100, // Convert to percentage
    });
  }

  return signals;
}

// =============================================================================
// ANALYSIS & REPORTING
// =============================================================================

interface CategoryStats {
  category: string;
  totalSignals: number;
  revertedSignals: number;
  reversionRate: number;
  avgBarsToReversion: number;
  avgDrawdown: number;
  maxDrawdown: number;
}

function calculateCategoryStats(signals: MeanReversionSignal[]): CategoryStats[] {
  const categories = ['NO_NEWS', 'NEWS_MEDIUM', 'NEWS_HIGH', 'NEWS_DAY'];
  const stats: CategoryStats[] = [];

  for (const cat of categories) {
    const catSignals = signals.filter((s) => s.newsCategory === cat);

    if (catSignals.length === 0) {
      stats.push({
        category: cat,
        totalSignals: 0,
        revertedSignals: 0,
        reversionRate: 0,
        avgBarsToReversion: 0,
        avgDrawdown: 0,
        maxDrawdown: 0,
      });
      continue;
    }

    const reverted = catSignals.filter((s) => s.reverted);
    const avgBars = reverted.length > 0
      ? reverted.reduce((sum, s) => sum + s.barsToReversion, 0) / reverted.length
      : 0;

    stats.push({
      category: cat,
      totalSignals: catSignals.length,
      revertedSignals: reverted.length,
      reversionRate: (reverted.length / catSignals.length) * 100,
      avgBarsToReversion: avgBars,
      avgDrawdown: catSignals.reduce((sum, s) => sum + s.maxDrawdown, 0) / catSignals.length,
      maxDrawdown: Math.max(...catSignals.map((s) => s.maxDrawdown)),
    });
  }

  return stats;
}

interface SessionNewsStats {
  session: string;
  noNews: { signals: number; revRate: number; avgDrawdown: number };
  withNews: { signals: number; revRate: number; avgDrawdown: number };
  improvement: number;
}

function calculateSessionNewsStats(signals: MeanReversionSignal[]): SessionNewsStats[] {
  const sessions = ['ASIAN', 'LONDON', 'LONDON_NY_OVERLAP', 'NEW_YORK'];
  const stats: SessionNewsStats[] = [];

  for (const session of sessions) {
    const sessionSignals = signals.filter((s) => s.session === session);

    const noNewsSignals = sessionSignals.filter((s) => s.newsCategory === 'NO_NEWS');
    const withNewsSignals = sessionSignals.filter((s) => s.newsCategory !== 'NO_NEWS');

    const noNewsReverted = noNewsSignals.filter((s) => s.reverted);
    const withNewsReverted = withNewsSignals.filter((s) => s.reverted);

    const noNewsRate = noNewsSignals.length > 0
      ? (noNewsReverted.length / noNewsSignals.length) * 100
      : 0;

    const withNewsRate = withNewsSignals.length > 0
      ? (withNewsReverted.length / withNewsSignals.length) * 100
      : 0;

    stats.push({
      session,
      noNews: {
        signals: noNewsSignals.length,
        revRate: noNewsRate,
        avgDrawdown: noNewsSignals.length > 0
          ? noNewsSignals.reduce((sum, s) => sum + s.maxDrawdown, 0) / noNewsSignals.length
          : 0,
      },
      withNews: {
        signals: withNewsSignals.length,
        revRate: withNewsRate,
        avgDrawdown: withNewsSignals.length > 0
          ? withNewsSignals.reduce((sum, s) => sum + s.maxDrawdown, 0) / withNewsSignals.length
          : 0,
      },
      improvement: noNewsRate - withNewsRate,
    });
  }

  return stats;
}

interface EventTypeStats {
  eventType: string;
  signals: number;
  reversionRate: number;
  avgDrawdown: number;
}

function analyzeByEventType(signals: MeanReversionSignal[]): EventTypeStats[] {
  const eventGroups: Record<string, MeanReversionSignal[]> = {};

  for (const signal of signals) {
    if (signal.nearestEvent) {
      // Normalize event name
      let eventType = signal.nearestEvent;

      if (eventType.includes('Non-Farm') || eventType.includes('NFP')) {
        eventType = 'NFP';
      } else if (eventType.includes('FOMC')) {
        eventType = 'FOMC';
      } else if (eventType.includes('ECB') && eventType.includes('Rate')) {
        eventType = 'ECB Rate';
      } else if (eventType.includes('CPI')) {
        eventType = 'CPI';
      } else if (eventType.includes('GDP')) {
        eventType = 'GDP';
      } else if (eventType.includes('Jobless')) {
        eventType = 'Jobless Claims';
      } else if (eventType.includes('PMI') || eventType.includes('ISM')) {
        eventType = 'PMI/ISM';
      } else if (eventType.includes('Retail')) {
        eventType = 'Retail Sales';
      } else {
        eventType = 'Other';
      }

      if (!eventGroups[eventType]) {
        eventGroups[eventType] = [];
      }
      eventGroups[eventType]!.push(signal);
    }
  }

  return Object.entries(eventGroups)
    .map(([eventType, sigs]) => {
      const reverted = sigs.filter((s) => s.reverted);
      return {
        eventType,
        signals: sigs.length,
        reversionRate: (reverted.length / sigs.length) * 100,
        avgDrawdown: sigs.reduce((sum, s) => sum + s.maxDrawdown, 0) / sigs.length,
      };
    })
    .sort((a, b) => a.reversionRate - b.reversionRate);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('📊 NEWS IMPACT ANALYSIS ON MEAN REVERSION');
  console.log('='.repeat(80));
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Input: ${INPUT_DIR}`);
  console.log('='.repeat(80));

  // Load data
  console.log('\n📥 Loading data...');
  const priceData = loadPriceData();
  const events = loadEconomicEvents();

  console.log(`  Price candles: ${priceData.length.toLocaleString()}`);
  console.log(`  Economic events: ${events.length}`);

  // Get date range
  const firstCandle = priceData[0]!;
  const lastCandle = priceData[priceData.length - 1]!;
  const firstDate = new Date(firstCandle.timestamp * 1000).toISOString().split('T')[0];
  const lastDate = new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0];
  console.log(`  Date range: ${firstDate} to ${lastDate}`);

  // Results storage
  const allResults: Record<string, {
    config: typeof WINDOW_CONFIGS[0];
    categoryStats: CategoryStats[];
    sessionStats: SessionNewsStats[];
    eventTypeStats: EventTypeStats[];
    signals: MeanReversionSignal[];
  }> = {};

  // Analyze each window configuration
  for (const config of WINDOW_CONFIGS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 Analyzing: ${config.name} Window`);
    console.log(`   HIGH: -${config.preHigh}min to +${config.postHigh}min`);
    console.log(`   MEDIUM: -${config.preMed}min to +${config.postMed}min`);
    console.log('='.repeat(60));

    // Detect MR signals with news classification
    const signals = detectMRSignals(priceData, events, config);
    console.log(`\n  Total MR signals detected: ${signals.length}`);

    // Category stats
    const categoryStats = calculateCategoryStats(signals);
    console.log('\n  📈 By News Category:');
    console.log('  ' + '-'.repeat(70));
    console.log('  Category       | Signals | Reverted | Rev Rate | Avg DD  | Max DD');
    console.log('  ' + '-'.repeat(70));

    for (const stat of categoryStats) {
      console.log(
        `  ${stat.category.padEnd(14)} | ${stat.totalSignals.toString().padStart(7)} | ${stat.revertedSignals.toString().padStart(8)} | ${stat.reversionRate.toFixed(1).padStart(7)}% | ${stat.avgDrawdown.toFixed(3).padStart(6)}% | ${stat.maxDrawdown.toFixed(3)}%`
      );
    }

    // Session x News stats
    const sessionStats = calculateSessionNewsStats(signals);
    console.log('\n  📊 Session × News Impact:');
    console.log('  ' + '-'.repeat(80));
    console.log('  Session           | No News Rev% | With News Rev% | Improvement | DD Change');
    console.log('  ' + '-'.repeat(80));

    for (const stat of sessionStats) {
      const ddChange = stat.withNews.avgDrawdown - stat.noNews.avgDrawdown;
      console.log(
        `  ${stat.session.padEnd(18)} | ${stat.noNews.revRate.toFixed(1).padStart(11)}% | ${stat.withNews.revRate.toFixed(1).padStart(13)}% | ${stat.improvement > 0 ? '+' : ''}${stat.improvement.toFixed(1).padStart(10)}% | ${ddChange > 0 ? '+' : ''}${ddChange.toFixed(3)}%`
      );
    }

    // Event type analysis
    const eventTypeStats = analyzeByEventType(signals.filter((s) => s.newsCategory !== 'NO_NEWS'));
    console.log('\n  🎯 By Event Type (worst to best):');
    console.log('  ' + '-'.repeat(55));
    console.log('  Event Type     | Signals | Rev Rate | Avg Drawdown');
    console.log('  ' + '-'.repeat(55));

    for (const stat of eventTypeStats.slice(0, 10)) {
      console.log(
        `  ${stat.eventType.padEnd(15)} | ${stat.signals.toString().padStart(7)} | ${stat.reversionRate.toFixed(1).padStart(7)}% | ${stat.avgDrawdown.toFixed(3)}%`
      );
    }

    allResults[config.name] = {
      config,
      categoryStats,
      sessionStats,
      eventTypeStats,
      signals,
    };
  }

  // Find optimal window
  console.log('\n' + '='.repeat(80));
  console.log('🏆 OPTIMAL WINDOW RECOMMENDATION');
  console.log('='.repeat(80));

  let bestConfig = WINDOW_CONFIGS[0]!;
  let bestImprovement = 0;

  for (const [name, result] of Object.entries(allResults)) {
    const noNewsRate = result.categoryStats.find((s) => s.category === 'NO_NEWS')?.reversionRate || 0;
    const highNewsRate = result.categoryStats.find((s) => s.category === 'NEWS_HIGH')?.reversionRate || 0;
    const improvement = noNewsRate - highNewsRate;

    console.log(`\n${name}:`);
    console.log(`  NO_NEWS reversion rate: ${noNewsRate.toFixed(1)}%`);
    console.log(`  NEWS_HIGH reversion rate: ${highNewsRate.toFixed(1)}%`);
    console.log(`  Improvement by filtering: +${improvement.toFixed(1)}%`);

    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      bestConfig = result.config;
    }
  }

  console.log(`\n✅ RECOMMENDED: ${bestConfig.name} Window`);
  console.log(`   HIGH impact: pause ${bestConfig.preHigh}min before, ${bestConfig.postHigh}min after`);
  console.log(`   MEDIUM impact: pause ${bestConfig.preMed}min before, ${bestConfig.postMed}min after`);
  console.log(`   Expected win rate improvement: +${bestImprovement.toFixed(1)}%`);

  // Save results
  console.log('\n💾 Saving results...');

  // Save detailed CSV
  const bestResult = allResults[bestConfig.name]!;
  const signalsCsv = [
    'timestamp,direction,session,newsCategory,nearestEvent,minutesToEvent,reverted,barsToReversion,maxDrawdown',
    ...bestResult.signals.map((s) =>
      `${s.timestamp},${s.direction},${s.session},${s.newsCategory},"${s.nearestEvent || ''}",${s.minutesToEvent || ''},${s.reverted},${s.barsToReversion},${s.maxDrawdown.toFixed(4)}`
    ),
  ].join('\n');

  writeFileSync(join(INPUT_DIR, 'news_impact_signals.csv'), signalsCsv, 'utf-8');
  console.log(`  Saved: ${INPUT_DIR}/news_impact_signals.csv`);

  // Save category stats
  const categoryStatsCsv = [
    'category,totalSignals,revertedSignals,reversionRate,avgBarsToReversion,avgDrawdown,maxDrawdown',
    ...bestResult.categoryStats.map((s) =>
      `${s.category},${s.totalSignals},${s.revertedSignals},${s.reversionRate.toFixed(2)},${s.avgBarsToReversion.toFixed(2)},${s.avgDrawdown.toFixed(4)},${s.maxDrawdown.toFixed(4)}`
    ),
  ].join('\n');

  writeFileSync(join(INPUT_DIR, 'news_impact_by_category.csv'), categoryStatsCsv, 'utf-8');
  console.log(`  Saved: ${INPUT_DIR}/news_impact_by_category.csv`);

  // Save session stats
  const sessionStatsCsv = [
    'session,noNews_signals,noNews_revRate,noNews_avgDD,withNews_signals,withNews_revRate,withNews_avgDD,improvement',
    ...bestResult.sessionStats.map((s) =>
      `${s.session},${s.noNews.signals},${s.noNews.revRate.toFixed(2)},${s.noNews.avgDrawdown.toFixed(4)},${s.withNews.signals},${s.withNews.revRate.toFixed(2)},${s.withNews.avgDrawdown.toFixed(4)},${s.improvement.toFixed(2)}`
    ),
  ].join('\n');

  writeFileSync(join(INPUT_DIR, 'news_impact_by_session.csv'), sessionStatsCsv, 'utf-8');
  console.log(`  Saved: ${INPUT_DIR}/news_impact_by_session.csv`);

  // Save event type stats
  const eventStatsCsv = [
    'eventType,signals,reversionRate,avgDrawdown',
    ...bestResult.eventTypeStats.map((s) =>
      `"${s.eventType}",${s.signals},${s.reversionRate.toFixed(2)},${s.avgDrawdown.toFixed(4)}`
    ),
  ].join('\n');

  writeFileSync(join(INPUT_DIR, 'news_impact_by_event.csv'), eventStatsCsv, 'utf-8');
  console.log(`  Saved: ${INPUT_DIR}/news_impact_by_event.csv`);

  // Save recommendation JSON
  const recommendation = {
    symbol: SYMBOL,
    analysisDate: new Date().toISOString(),
    dataRange: { from: firstDate, to: lastDate },
    totalSignals: bestResult.signals.length,
    recommendedWindow: {
      name: bestConfig.name,
      highImpact: { minutesBefore: bestConfig.preHigh, minutesAfter: bestConfig.postHigh },
      mediumImpact: { minutesBefore: bestConfig.preMed, minutesAfter: bestConfig.postMed },
    },
    expectedImprovement: {
      reversionRate: bestImprovement,
      noNewsRevRate: bestResult.categoryStats.find((s) => s.category === 'NO_NEWS')?.reversionRate,
      highNewsRevRate: bestResult.categoryStats.find((s) => s.category === 'NEWS_HIGH')?.reversionRate,
    },
    worstEvents: bestResult.eventTypeStats.slice(0, 5).map((e) => e.eventType),
    bestSession: {
      noNews: bestResult.sessionStats.reduce((best, s) =>
        s.noNews.revRate > best.noNews.revRate ? s : best
      ).session,
      improvement: Math.max(...bestResult.sessionStats.map((s) => s.improvement)),
    },
  };

  writeFileSync(join(INPUT_DIR, 'news_filter_recommendation.json'), JSON.stringify(recommendation, null, 2), 'utf-8');
  console.log(`  Saved: ${INPUT_DIR}/news_filter_recommendation.json`);

  console.log('\n' + '='.repeat(80));
  console.log('✅ News impact analysis complete!');
  console.log('='.repeat(80));
}

main().catch(console.error);
