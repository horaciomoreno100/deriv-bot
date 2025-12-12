#!/usr/bin/env npx tsx
/**
 * RSI Divergence Detector Test Script
 *
 * Tests the RSI divergence detector against historical data.
 *
 * Usage:
 *   ASSET="frxEURUSD" DATA_FILE="data/frxEURUSD_1m_365d.csv" npx tsx src/scripts/test-rsi-divergence.ts
 *   ASSET="cryETHUSD" DAYS=30 npx tsx src/scripts/test-rsi-divergence.ts
 */

import * as path from 'path';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { RSIDivergenceDetector, type RSIDivergence } from '../analysis/rsi-divergence-detector.js';

// Configuration
const ASSET = process.env.ASSET ?? 'frxEURUSD';
const DATA_FILE = process.env.DATA_FILE;
const DAYS = parseInt(process.env.DAYS ?? '30', 10);
const LOOKBACK = parseInt(process.env.LOOKBACK ?? '1000', 10);

async function fetchCandles(asset: string, days: number): Promise<any[]> {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * 24 * 60 * 60;

  console.log(`📡 Fetching ${asset} data from Deriv API...`);

  const appId = process.env.DERIV_APP_ID ?? '1089';
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(url);
    const candles: any[] = [];

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

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function formatDivergence(div: RSIDivergence, index: number): string {
  const typeEmoji =
    div.type === 'bullish'
      ? '🟢'
      : div.type === 'bearish'
      ? '🔴'
      : div.type === 'hidden_bullish'
      ? '🟡'
      : '🟠';

  const confirmEmoji = div.confirmed ? '✅' : '⏳';

  return `
${index + 1}. ${typeEmoji} ${div.type.toUpperCase()} ${confirmEmoji}
   Strength: ${div.strength}%
   Price: ${div.pricePoint1.value.toFixed(5)} → ${div.pricePoint2.value.toFixed(5)}
   RSI:   ${div.rsiPoint1.value.toFixed(1)} → ${div.rsiPoint2.value.toFixed(1)}
   Time:  ${formatDate(div.pricePoint1.timestamp)} → ${formatDate(div.pricePoint2.timestamp)}
   Expected: ${div.expectedDirection === 'up' ? '📈 UP' : '📉 DOWN'}`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              RSI Divergence Detector Test');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  let candles: any[];

  if (DATA_FILE) {
    const dataPath = path.join(process.cwd(), DATA_FILE);
    console.log(`📂 Loading from: ${DATA_FILE}`);
    candles = loadCandlesFromCSV(dataPath, {
      asset: ASSET,
      timeframe: 60,
      timestampColumn: 'timestamp',
      timestampFormat: 'unix_ms',
    });
  } else {
    candles = await fetchCandles(ASSET, DAYS);
  }

  console.log(`   ✅ Loaded ${candles.length} candles`);

  // Use last N candles
  const testCandles = candles.slice(-LOOKBACK);
  console.log(`   📊 Analyzing last ${testCandles.length} candles`);
  console.log();

  // Create detector with different configs
  const configs = [
    { name: 'Default', options: {} },
    { name: 'Strict', options: { minRSIDifference: 5, oversoldLevel: 35, overboughtLevel: 65 } },
    { name: 'Loose', options: { minRSIDifference: 2, swingLookback: 2, oversoldLevel: 45, overboughtLevel: 55 } },
  ];

  for (const config of configs) {
    console.log(`┌───────────────────────────────────────────────────────────────┐`);
    console.log(`│ Configuration: ${config.name.padEnd(46)}│`);
    console.log(`└───────────────────────────────────────────────────────────────┘`);

    const detector = new RSIDivergenceDetector(config.options);
    const divergences = detector.detect(testCandles);

    // Count by type
    const bullish = divergences.filter((d) => d.type === 'bullish');
    const bearish = divergences.filter((d) => d.type === 'bearish');
    const hiddenBullish = divergences.filter((d) => d.type === 'hidden_bullish');
    const hiddenBearish = divergences.filter((d) => d.type === 'hidden_bearish');
    const confirmed = divergences.filter((d) => d.confirmed);
    const highStrength = divergences.filter((d) => d.strength >= 70);

    console.log(`
📊 SUMMARY:
   Total Divergences:    ${divergences.length}
   - Bullish:            ${bullish.length} 🟢
   - Bearish:            ${bearish.length} 🔴
   - Hidden Bullish:     ${hiddenBullish.length} 🟡
   - Hidden Bearish:     ${hiddenBearish.length} 🟠

   Confirmed:            ${confirmed.length} (${((confirmed.length / divergences.length) * 100 || 0).toFixed(1)}%)
   High Strength (≥70):  ${highStrength.length}
`);

    // Show most recent divergences
    console.log(`📈 MOST RECENT DIVERGENCES (Top 5):`);
    const recent = divergences.slice(0, 5);
    if (recent.length === 0) {
      console.log('   No divergences found');
    } else {
      for (let i = 0; i < recent.length; i++) {
        console.log(formatDivergence(recent[i]!, i));
      }
    }

    console.log();

    // Show strongest divergences
    const strongest = [...divergences].sort((a, b) => b.strength - a.strength).slice(0, 3);
    if (strongest.length > 0) {
      console.log(`💪 STRONGEST DIVERGENCES:`);
      for (let i = 0; i < strongest.length; i++) {
        console.log(formatDivergence(strongest[i]!, i));
      }
      console.log();
    }
  }

  // Backtest simulation: Check if divergences predicted direction correctly
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              ACCURACY BACKTEST');
  console.log('═══════════════════════════════════════════════════════════════════');

  const detector = new RSIDivergenceDetector({ requireConfirmation: false });
  const allDivergences = detector.detect(testCandles);

  let correctPredictions = 0;
  let totalTestedDivergences = 0;

  for (const div of allDivergences) {
    // Skip if we don't have enough candles after divergence
    const barsAfter = 20; // Check price movement over next 20 bars
    if (div.pricePoint2.index + barsAfter >= testCandles.length) continue;

    totalTestedDivergences++;

    const entryPrice = testCandles[div.pricePoint2.index]!.close;
    let maxMove = 0;

    for (let i = 1; i <= barsAfter; i++) {
      const candle = testCandles[div.pricePoint2.index + i]!;
      if (div.expectedDirection === 'up') {
        maxMove = Math.max(maxMove, (candle.high - entryPrice) / entryPrice);
      } else {
        maxMove = Math.max(maxMove, (entryPrice - candle.low) / entryPrice);
      }
    }

    // Consider correct if price moved at least 0.005% in expected direction (5 pips for forex)
    if (maxMove >= 0.00005) {
      correctPredictions++;
    }
  }

  const accuracy = totalTestedDivergences > 0 ? (correctPredictions / totalTestedDivergences) * 100 : 0;

  console.log(`
📊 ACCURACY RESULTS:
   Divergences Tested:   ${totalTestedDivergences}
   Correct Predictions:  ${correctPredictions}
   Accuracy:             ${accuracy.toFixed(1)}%

   (Correct = price moved ≥5 pips in expected direction within 20 bars)
`);

  // Breakdown by type
  const byType: Record<string, { correct: number; total: number }> = {
    bullish: { correct: 0, total: 0 },
    bearish: { correct: 0, total: 0 },
    hidden_bullish: { correct: 0, total: 0 },
    hidden_bearish: { correct: 0, total: 0 },
  };

  for (const div of allDivergences) {
    const barsAfter = 20;
    if (div.pricePoint2.index + barsAfter >= testCandles.length) continue;

    byType[div.type]!.total++;

    const entryPrice = testCandles[div.pricePoint2.index]!.close;
    let maxMove = 0;

    for (let i = 1; i <= barsAfter; i++) {
      const candle = testCandles[div.pricePoint2.index + i]!;
      if (div.expectedDirection === 'up') {
        maxMove = Math.max(maxMove, (candle.high - entryPrice) / entryPrice);
      } else {
        maxMove = Math.max(maxMove, (entryPrice - candle.low) / entryPrice);
      }
    }

    if (maxMove >= 0.00005) {
      byType[div.type]!.correct++;
    }
  }

  console.log(`📈 ACCURACY BY TYPE:`);
  for (const [type, stats] of Object.entries(byType)) {
    if (stats.total > 0) {
      const acc = (stats.correct / stats.total) * 100;
      const emoji =
        type === 'bullish' ? '🟢' : type === 'bearish' ? '🔴' : type === 'hidden_bullish' ? '🟡' : '🟠';
      console.log(`   ${emoji} ${type.padEnd(15)}: ${acc.toFixed(1)}% (${stats.correct}/${stats.total})`);
    }
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
