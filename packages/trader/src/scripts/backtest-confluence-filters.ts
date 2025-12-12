#!/usr/bin/env npx tsx
/**
 * Confluence Filters Backtest
 *
 * Tests the impact of each filter on signal quality:
 * 1. Base: MTF zones only
 * 2. + RSI Divergence
 * 3. + Session Filter
 * 4. All combined
 *
 * Measures win rate, profit factor, and other metrics for each configuration.
 *
 * Usage:
 *   ASSET="frxEURUSD" DATA_FILE="data/frxEURUSD_1m_365d.csv" npx tsx src/scripts/backtest-confluence-filters.ts
 *   ASSET="cryETHUSD" DAYS=30 npx tsx src/scripts/backtest-confluence-filters.ts
 */

import * as path from 'path';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { aggregateCandles } from '../utils/candle-aggregator.js';
import { MTFMarketStructureAnalyzer, type MTFZone } from '../analysis/mtf-market-structure.js';
import { RSIDivergenceDetector, type RSIDivergence } from '../analysis/rsi-divergence-detector.js';
import { SessionFilterService } from '../services/session-filter.service.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'frxEURUSD';
const DATA_FILE = process.env.DATA_FILE;
const DAYS = parseInt(process.env.DAYS ?? '30', 10);
const BARS_FOR_OUTCOME = parseInt(process.env.BARS_FOR_OUTCOME ?? '30', 10);
const ZONE_PROXIMITY_PCT = parseFloat(process.env.ZONE_PROXIMITY ?? '0.0015'); // 0.15%

interface TradeSetup {
  timestamp: number;
  price: number;
  direction: 'long' | 'short';
  zone: MTFZone;
  hasDivergence: boolean;
  divergence?: RSIDivergence;
  divergenceStrength: number;
  session: string;
  isKillzone: boolean;
  hasRejectionCandle: boolean;
  hasSweep: boolean;
  trendAligned: boolean;
  confluenceCount: number;
  outcome?: 'win' | 'loss';
  pnlPct?: number;
}

interface BacktestResult {
  name: string;
  totalSetups: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnlPct: number;
  avgPnlPct: number;
}

async function fetchCandles(asset: string, days: number): Promise<Candle[]> {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * 24 * 60 * 60;

  console.log(`📡 Fetching ${asset} data from Deriv API...`);

  const appId = process.env.DERIV_APP_ID ?? '1089';
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(url);
    const candles: Candle[] = [];

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          ticks_history: asset,
          adjust_start_time: 1,
          count: Math.min(5000, Math.ceil((days * 24 * 60 * 60) / 60)),
          end: endTime,
          start: startTime,
          style: 'candles',
          granularity: 60,
        })
      );
    });

    ws.on('message', (data: Buffer) => {
      const response = JSON.parse(data.toString());
      if (response.error) {
        ws.close();
        reject(new Error(response.error.message));
        return;
      }
      if (response.candles) {
        for (const c of response.candles) {
          candles.push({
            asset,
            timeframe: 60,
            timestamp: c.epoch,
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
          });
        }
        ws.close();
        resolve(candles);
      }
    });

    ws.on('error', reject);
    setTimeout(() => {
      ws.close();
      resolve(candles);
    }, 30000);
  });
}

/**
 * Detect rejection candle at zone
 */
function hasRejectionCandle(
  candles: Candle[],
  zone: MTFZone,
  direction: 'long' | 'short'
): boolean {
  const current = candles[candles.length - 1]!;
  const range = current.high - current.low;
  if (range === 0) return false;

  const body = Math.abs(current.close - current.open);
  const bodyRatio = body / range;

  if (direction === 'long') {
    // Bullish rejection: long lower wick, price near zone low
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const wickRatio = lowerWick / range;
    return (
      wickRatio > 0.5 &&
      bodyRatio < 0.4 &&
      current.low <= zone.priceHigh &&
      current.close > current.open
    );
  } else {
    // Bearish rejection: long upper wick, price near zone high
    const upperWick = current.high - Math.max(current.open, current.close);
    const wickRatio = upperWick / range;
    return (
      wickRatio > 0.5 &&
      bodyRatio < 0.4 &&
      current.high >= zone.priceLow &&
      current.close < current.open
    );
  }
}

/**
 * Detect liquidity sweep (price briefly breaks zone then reverses)
 */
function hasSweep(
  candles: Candle[],
  zone: MTFZone,
  direction: 'long' | 'short'
): boolean {
  if (candles.length < 3) return false;

  const current = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2]!;

  if (direction === 'long') {
    // Sweep below support: prev candle broke below, current closed back above
    const brokeBelow = prev.low < zone.priceLow;
    const closedAbove = current.close > zone.priceLow;
    const bullishClose = current.close > current.open;
    return brokeBelow && closedAbove && bullishClose;
  } else {
    // Sweep above resistance: prev candle broke above, current closed back below
    const brokeAbove = prev.high > zone.priceHigh;
    const closedBelow = current.close < zone.priceHigh;
    const bearishClose = current.close < current.open;
    return brokeAbove && closedBelow && bearishClose;
  }
}

function findNearestZone(
  price: number,
  zones: MTFZone[],
  proximityPct: number
): { zone: MTFZone; direction: 'long' | 'short' } | null {
  let nearest: MTFZone | null = null;
  let minDistance = Infinity;

  for (const zone of zones) {
    if (zone.broken) continue;

    const zoneMid = (zone.priceHigh + zone.priceLow) / 2;
    const distance = Math.abs(price - zoneMid) / price;

    if (distance < minDistance && distance < proximityPct) {
      minDistance = distance;
      nearest = zone;
    }
  }

  if (!nearest) return null;

  const direction = nearest.type === 'support' ? 'long' : 'short';
  return { zone: nearest, direction };
}

function calculateOutcome(
  candles: Candle[],
  startIndex: number,
  direction: 'long' | 'short',
  zone: MTFZone,
  barsToCheck: number
): { outcome: 'win' | 'loss'; pnlPct: number } {
  const entryCandle = candles[startIndex]!;
  const entryPrice = entryCandle.close;

  // Calculate SL and TP based on zone
  const zoneHeight = zone.priceHigh - zone.priceLow;
  let sl: number;
  let tp: number;

  if (direction === 'long') {
    sl = zone.priceLow - zoneHeight * 0.5; // SL below zone
    tp = entryPrice + (entryPrice - sl) * 1.5; // 1.5 RR
  } else {
    sl = zone.priceHigh + zoneHeight * 0.5; // SL above zone
    tp = entryPrice - (sl - entryPrice) * 1.5; // 1.5 RR
  }

  // Check each candle for SL or TP hit
  for (let i = 1; i <= barsToCheck && startIndex + i < candles.length; i++) {
    const candle = candles[startIndex + i]!;

    if (direction === 'long') {
      // Check SL first (conservative)
      if (candle.low <= sl) {
        const pnlPct = ((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'loss', pnlPct };
      }
      // Check TP
      if (candle.high >= tp) {
        const pnlPct = ((tp - entryPrice) / entryPrice) * 100;
        return { outcome: 'win', pnlPct };
      }
    } else {
      // Check SL first
      if (candle.high >= sl) {
        const pnlPct = ((entryPrice - sl) / entryPrice) * 100;
        return { outcome: 'loss', pnlPct };
      }
      // Check TP
      if (candle.low <= tp) {
        const pnlPct = ((entryPrice - tp) / entryPrice) * 100;
        return { outcome: 'win', pnlPct };
      }
    }
  }

  // If neither hit, calculate based on final price
  const finalCandle = candles[Math.min(startIndex + barsToCheck, candles.length - 1)]!;
  const finalPrice = finalCandle.close;

  if (direction === 'long') {
    const pnlPct = ((finalPrice - entryPrice) / entryPrice) * 100;
    return { outcome: pnlPct > 0 ? 'win' : 'loss', pnlPct };
  } else {
    const pnlPct = ((entryPrice - finalPrice) / entryPrice) * 100;
    return { outcome: pnlPct > 0 ? 'win' : 'loss', pnlPct };
  }
}

function analyzeResults(setups: TradeSetup[], name: string): BacktestResult {
  const wins = setups.filter((s) => s.outcome === 'win');
  const losses = setups.filter((s) => s.outcome === 'loss');

  const totalWinPnl = wins.reduce((sum, s) => sum + (s.pnlPct || 0), 0);
  const totalLossPnl = Math.abs(losses.reduce((sum, s) => sum + (s.pnlPct || 0), 0));

  return {
    name,
    totalSetups: setups.length,
    wins: wins.length,
    losses: losses.length,
    winRate: setups.length > 0 ? (wins.length / setups.length) * 100 : 0,
    avgWin: wins.length > 0 ? totalWinPnl / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLossPnl / losses.length : 0,
    profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0,
    totalPnlPct: totalWinPnl - totalLossPnl,
    avgPnlPct: setups.length > 0 ? (totalWinPnl - totalLossPnl) / setups.length : 0,
  };
}

function printResult(result: BacktestResult): void {
  const winRateColor = result.winRate >= 55 ? '\x1b[32m' : result.winRate >= 45 ? '\x1b[33m' : '\x1b[31m';
  const pfColor = result.profitFactor >= 1.5 ? '\x1b[32m' : result.profitFactor >= 1 ? '\x1b[33m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│ ${result.name.padEnd(63)}│
├─────────────────────────────────────────────────────────────────┤
│ Total Setups:    ${String(result.totalSetups).padEnd(45)}│
│ Wins/Losses:     ${String(result.wins).padEnd(5)}/ ${String(result.losses).padEnd(38)}│
│ Win Rate:        ${winRateColor}${result.winRate.toFixed(1)}%${reset}${''.padEnd(42 - result.winRate.toFixed(1).length)}│
│ Avg Win:         ${result.avgWin.toFixed(4)}%${''.padEnd(44 - result.avgWin.toFixed(4).length)}│
│ Avg Loss:        ${result.avgLoss.toFixed(4)}%${''.padEnd(44 - result.avgLoss.toFixed(4).length)}│
│ Profit Factor:   ${pfColor}${result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}${reset}${''.padEnd(44 - (result.profitFactor === Infinity ? 1 : result.profitFactor.toFixed(2).length))}│
│ Total PnL:       ${result.totalPnlPct.toFixed(4)}%${''.padEnd(44 - result.totalPnlPct.toFixed(4).length)}│
│ Avg PnL/Trade:   ${result.avgPnlPct.toFixed(4)}%${''.padEnd(44 - result.avgPnlPct.toFixed(4).length)}│
└─────────────────────────────────────────────────────────────────┘`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           Confluence Filters Backtest');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Load data
  let candles1m: Candle[];

  if (DATA_FILE) {
    const dataPath = path.join(process.cwd(), DATA_FILE);
    console.log(`📂 Loading from: ${DATA_FILE}`);
    candles1m = loadCandlesFromCSV(dataPath, {
      asset: ASSET,
      timeframe: 60,
      timestampColumn: 'timestamp',
      timestampFormat: 'unix_ms',
    });
  } else {
    candles1m = await fetchCandles(ASSET, DAYS);
  }

  console.log(`   ✅ Loaded ${candles1m.length} 1m candles`);

  // Aggregate to higher TFs
  console.log(`\n📊 Preparing multi-timeframe data...`);
  const candles5m = aggregateCandles(candles1m, 5);
  const candles15m = aggregateCandles(candles5m, 3);
  console.log(`   5m candles: ${candles5m.length}`);
  console.log(`   15m candles: ${candles15m.length}`);

  // Initialize analyzers
  const mtfAnalyzer = new MTFMarketStructureAnalyzer();
  const divergenceDetector = new RSIDivergenceDetector({
    rsiPeriod: 14,
    minSwingDistance: 5,
    maxSwingDistance: 40,
  });
  const sessionFilter = new SessionFilterService({
    enabled: true,
    allowedSessions: ['ASIAN', 'LONDON', 'OVERLAP', 'NY'],
  });

  // Collect all setups
  console.log(`\n🔍 Scanning for trade setups...`);

  const allSetups: TradeSetup[] = [];
  const windowSize = 500; // Candles to look back for MTF analysis
  const step = 10; // Check every 10 candles

  for (let i = windowSize; i < candles1m.length - BARS_FOR_OUTCOME; i += step) {
    const windowCandles = candles1m.slice(i - windowSize, i + 1);
    const currentCandle = candles1m[i]!;
    const currentPrice = currentCandle.close;

    // MTF Analysis
    const mtfStructure = mtfAnalyzer.analyze(windowCandles, ASSET);
    const allZones = mtfStructure.allZones;

    // Find nearest zone
    const zoneResult = findNearestZone(currentPrice, allZones, ZONE_PROXIMITY_PCT);
    if (!zoneResult) continue;

    // Check for divergence
    const divergence = divergenceDetector.detectAtZone(
      windowCandles,
      zoneResult.zone.priceLow,
      zoneResult.zone.priceHigh,
      zoneResult.zone.type
    );

    // Get session
    const session = sessionFilter.getSession(currentCandle.timestamp);
    const isKillzone = session === 'OVERLAP' || session === 'LONDON';

    // Check for rejection candle
    const rejectionCandle = hasRejectionCandle(windowCandles, zoneResult.zone, zoneResult.direction);

    // Check for liquidity sweep
    const sweep = hasSweep(windowCandles, zoneResult.zone, zoneResult.direction);

    // Check trend alignment (trade in direction of HTF trend)
    const trendAligned =
      (mtfStructure.htfBias === 'bullish' && zoneResult.direction === 'long') ||
      (mtfStructure.htfBias === 'bearish' && zoneResult.direction === 'short');

    // Count confluence factors
    let confluenceCount = 1; // Zone touch is base
    if (divergence) confluenceCount++;
    if (rejectionCandle) confluenceCount++;
    if (sweep) confluenceCount++;
    if (trendAligned) confluenceCount++;
    if (isKillzone) confluenceCount++;

    // Create setup
    const setup: TradeSetup = {
      timestamp: currentCandle.timestamp,
      price: currentPrice,
      direction: zoneResult.direction,
      zone: zoneResult.zone,
      hasDivergence: divergence !== null,
      divergence: divergence || undefined,
      divergenceStrength: divergence?.strength ?? 0,
      session,
      isKillzone,
      hasRejectionCandle: rejectionCandle,
      hasSweep: sweep,
      trendAligned,
      confluenceCount,
    };

    // Calculate outcome
    const outcome = calculateOutcome(candles1m, i, zoneResult.direction, zoneResult.zone, BARS_FOR_OUTCOME);
    setup.outcome = outcome.outcome;
    setup.pnlPct = outcome.pnlPct;

    allSetups.push(setup);
  }

  console.log(`   ✅ Found ${allSetups.length} setups`);

  // Analyze different filter combinations
  console.log(`\n📈 Analyzing filter combinations...`);

  // 1. Base: All zone touches (no filters)
  const baseResult = analyzeResults(allSetups, '1. BASE - Zone Touch Only');

  // 2. + Divergence filter
  const withDivergence = allSetups.filter((s) => s.hasDivergence);
  const divergenceResult = analyzeResults(withDivergence, '2. + RSI Divergence');

  // 3. + Session filter (killzones only)
  const withKillzone = allSetups.filter((s) => s.isKillzone);
  const killzoneResult = analyzeResults(withKillzone, '3. + Killzone Session');

  // 4. + Session filter (all allowed)
  const withSession = allSetups.filter((s) => s.session !== 'CLOSED');
  const sessionResult = analyzeResults(withSession, '4. + Session Filter (excl. CLOSED)');

  // 5. Divergence + Killzone
  const divKillzone = allSetups.filter((s) => s.hasDivergence && s.isKillzone);
  const divKillzoneResult = analyzeResults(divKillzone, '5. Divergence + Killzone');

  // 6. Divergence + Any allowed session
  const divSession = allSetups.filter((s) => s.hasDivergence && s.session !== 'CLOSED');
  const divSessionResult = analyzeResults(divSession, '6. Divergence + Session');

  // 7. High strength divergence only
  const highStrengthDiv = allSetups.filter((s) => s.hasDivergence && s.divergence && s.divergence.strength >= 70);
  const highStrengthResult = analyzeResults(highStrengthDiv, '7. High Strength Divergence (≥70)');

  // 8. Confirmed divergence only
  const confirmedDiv = allSetups.filter((s) => s.hasDivergence && s.divergence && s.divergence.confirmed);
  const confirmedDivResult = analyzeResults(confirmedDiv, '8. Confirmed Divergence Only');

  // 9. All filters combined
  const allFilters = allSetups.filter(
    (s) => s.hasDivergence && s.divergence && s.divergence.confirmed && s.isKillzone
  );
  const allFiltersResult = analyzeResults(allFilters, '9. ALL FILTERS (Div + Confirmed + Killzone)');

  // Print results
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                       RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════');

  printResult(baseResult);
  printResult(divergenceResult);
  printResult(killzoneResult);
  printResult(sessionResult);
  printResult(divKillzoneResult);
  printResult(divSessionResult);
  printResult(highStrengthResult);
  printResult(confirmedDivResult);
  printResult(allFiltersResult);

  // Summary comparison
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                   COMPARISON SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');

  const results = [
    baseResult,
    divergenceResult,
    killzoneResult,
    sessionResult,
    divKillzoneResult,
    divSessionResult,
    highStrengthResult,
    confirmedDivResult,
    allFiltersResult,
  ];

  console.log(`
${'Filter'.padEnd(45)} | ${'Setups'.padStart(6)} | ${'WR%'.padStart(6)} | ${'PF'.padStart(6)} | ${'Avg PnL'.padStart(8)}
${'─'.repeat(45)} | ${'─'.repeat(6)} | ${'─'.repeat(6)} | ${'─'.repeat(6)} | ${'─'.repeat(8)}`);

  for (const r of results) {
    const name = r.name.length > 45 ? r.name.substring(0, 42) + '...' : r.name.padEnd(45);
    const setups = String(r.totalSetups).padStart(6);
    const wr = r.winRate.toFixed(1).padStart(6);
    const pf = (r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)).padStart(6);
    const avgPnl = r.avgPnlPct.toFixed(4).padStart(8);
    console.log(`${name} | ${setups} | ${wr} | ${pf} | ${avgPnl}`);
  }

  // Best configuration
  const bestByWR = results.filter((r) => r.totalSetups >= 10).sort((a, b) => b.winRate - a.winRate)[0];
  const bestByPF = results.filter((r) => r.totalSetups >= 10).sort((a, b) => b.profitFactor - a.profitFactor)[0];

  console.log(`
📊 RECOMMENDATIONS:
   Best Win Rate:     ${bestByWR?.name} (${bestByWR?.winRate.toFixed(1)}%)
   Best Profit Factor: ${bestByPF?.name} (${bestByPF?.profitFactor === Infinity ? '∞' : bestByPF?.profitFactor.toFixed(2)})
`);

  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
