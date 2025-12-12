#!/usr/bin/env npx tsx
/**
 * Market Structure Analysis Script
 *
 * Analyzes market structure and generates an interactive chart with:
 * - Support/Resistance zones (rectangles)
 * - Trend lines
 * - Swing points
 * - Market phases
 *
 * Usage:
 *   ASSET="frxEURUSD" DAYS=30 npx tsx src/scripts/analyze-market-structure.ts
 *   ASSET="R_100" DATA_FILE="data/R_100_1m_7d.csv" npx tsx src/scripts/analyze-market-structure.ts
 *
 * Environment variables:
 *   ASSET      - Asset symbol (default: R_100)
 *   DAYS       - Days of data to fetch (default: 7)
 *   DATA_FILE  - CSV file path (optional, skips API fetch)
 *   TIMEFRAME  - Timeframe in seconds (default: 60)
 *   SWING_DEPTH - Swing detection depth (default: 5)
 *   LOOKBACK   - Candles to analyze (default: 500)
 *   THEME      - Chart theme: dark|light (default: dark)
 *   OPEN       - Open chart in browser: true|false (default: true)
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { MarketStructureDetector } from '../analysis/market-structure-detector.js';
import {
  generateMarketStructureChart,
  type MarketStructureChartOptions,
} from '../analysis/market-structure-chart.js';
import type { MarketStructureOptions } from '@anthropic/shared/types/market-structure.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'R_100';
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const DATA_FILE = process.env.DATA_FILE;
const TIMEFRAME = parseInt(process.env.TIMEFRAME ?? '60', 10);
const SWING_DEPTH = parseInt(process.env.SWING_DEPTH ?? '5', 10);
const LOOKBACK = parseInt(process.env.LOOKBACK ?? '500', 10);
const THEME = (process.env.THEME ?? 'dark') as 'dark' | 'light';
const OPEN_BROWSER = process.env.OPEN !== 'false';

/**
 * Fetch candles from Deriv API
 */
async function fetchCandles(
  asset: string,
  days: number,
  granularity: number
): Promise<{ timestamp: number; open: number; high: number; low: number; close: number }[]> {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * 24 * 60 * 60;

  console.log(`📡 Fetching ${asset} data from Deriv API...`);
  console.log(`   Period: ${days} days`);
  console.log(`   Granularity: ${granularity}s`);

  const appId = process.env.DERIV_APP_ID ?? '1089';
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(url);
    const candles: { timestamp: number; open: number; high: number; low: number; close: number }[] = [];

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          ticks_history: asset,
          adjust_start_time: 1,
          count: Math.min(5000, Math.ceil((days * 24 * 60 * 60) / granularity)),
          end: endTime,
          start: startTime,
          style: 'candles',
          granularity: granularity,
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
            timestamp: c.epoch,
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
          });
        }
        console.log(`   ✅ Received ${candles.length} candles`);
        ws.close();
        resolve(candles);
      }
    });

    ws.on('error', (error: Error) => {
      reject(error);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      ws.close();
      if (candles.length === 0) {
        reject(new Error('Timeout waiting for candles'));
      } else {
        resolve(candles);
      }
    }, 30000);
  });
}

/**
 * Open file in default browser
 */
function openInBrowser(filePath: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin'
      ? `open "${filePath}"`
      : platform === 'win32'
      ? `start "" "${filePath}"`
      : `xdg-open "${filePath}"`;

  exec(cmd, (error) => {
    if (error) {
      console.log(`   ⚠️  Could not open browser: ${error.message}`);
    }
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              Market Structure Analysis');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  let candles: { timestamp: number; open: number; high: number; low: number; close: number }[];

  // Load or fetch candles
  if (DATA_FILE) {
    const dataPath = path.join(process.cwd(), DATA_FILE);
    console.log(`📂 Loading from file: ${DATA_FILE}`);

    candles = loadCandlesFromCSV(dataPath, {
      asset: ASSET,
      timeframe: TIMEFRAME,
      timestampColumn: 'timestamp',
      timestampFormat: 'unix_ms',
    });

    console.log(`   ✅ Loaded ${candles.length} candles`);
  } else {
    candles = await fetchCandles(ASSET, DAYS, TIMEFRAME);
  }

  console.log();

  // Run market structure analysis
  console.log('🔍 Analyzing market structure...');
  console.log(`   Swing depth: ${SWING_DEPTH}`);
  console.log(`   Lookback: ${LOOKBACK} candles`);

  const detectorOptions: MarketStructureOptions = {
    swingDepth: SWING_DEPTH,
    lookbackPeriod: LOOKBACK,
    minZoneTouches: 1, // Show zones even with single swing point
    minTrendLineTouches: 2,
    detectPhases: true,
  };

  const detector = new MarketStructureDetector(detectorOptions);
  const structure = detector.analyze(candles, ASSET, TIMEFRAME);

  console.log();
  console.log('┌───────────────────────────────────────────────────────────────┐');
  console.log('│                    ANALYSIS RESULTS                           │');
  console.log('├───────────────────────────────────────────────────────────────┤');
  console.log(`│ Asset:           ${ASSET.padEnd(44)}│`);
  console.log(`│ Timeframe:       ${(TIMEFRAME + 's').padEnd(44)}│`);
  console.log(`│ Candles:         ${String(Math.min(LOOKBACK, candles.length)).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  const trendEmoji = structure.trend === 'up' ? '📈' : structure.trend === 'down' ? '📉' : '↔️';
  console.log(`│ Trend:           ${trendEmoji} ${structure.trend.toUpperCase().padEnd(40)}│`);
  console.log(`│ Trend Strength:  ${(structure.trendStrength + '%').padEnd(44)}│`);
  console.log(`│ Current Phase:   ${structure.currentPhase.padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');
  console.log(`│ Swing Points:    ${String(structure.swingPoints.length).padEnd(44)}│`);
  console.log(`│   - Highs:       ${String(structure.swingPoints.filter(s => s.type === 'high').length).padEnd(44)}│`);
  console.log(`│   - Lows:        ${String(structure.swingPoints.filter(s => s.type === 'low').length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  const activeZones = structure.zones.filter(z => !z.broken);
  const brokenZones = structure.zones.filter(z => z.broken);
  console.log(`│ S/R Zones:       ${String(structure.zones.length).padEnd(44)}│`);
  console.log(`│   - Active:      ${String(activeZones.length).padEnd(44)}│`);
  console.log(`│   - Broken:      ${String(brokenZones.length).padEnd(44)}│`);
  console.log(`│   - Resistance:  ${String(structure.zones.filter(z => z.type === 'resistance').length).padEnd(44)}│`);
  console.log(`│   - Support:     ${String(structure.zones.filter(z => z.type === 'support').length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  const activeLines = structure.trendLines.filter(l => !l.broken);
  console.log(`│ Trend Lines:     ${String(structure.trendLines.length).padEnd(44)}│`);
  console.log(`│   - Active:      ${String(activeLines.length).padEnd(44)}│`);
  console.log(`│   - Ascending:   ${String(structure.trendLines.filter(l => l.type === 'ascending').length).padEnd(44)}│`);
  console.log(`│   - Descending:  ${String(structure.trendLines.filter(l => l.type === 'descending').length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');
  console.log(`│ Market Phases:   ${String(structure.phases.length).padEnd(44)}│`);
  console.log('└───────────────────────────────────────────────────────────────┘');
  console.log();

  // Key levels
  if (structure.keyLevels.nearestResistance || structure.keyLevels.nearestSupport) {
    console.log('🎯 KEY LEVELS:');
    if (structure.keyLevels.nearestResistance) {
      console.log(`   Nearest Resistance: ${structure.keyLevels.nearestResistance.toFixed(4)}`);
    }
    if (structure.keyLevels.nearestSupport) {
      console.log(`   Nearest Support:    ${structure.keyLevels.nearestSupport.toFixed(4)}`);
    }
    if (structure.keyLevels.majorResistance.length > 0) {
      console.log(`   Major Resistance:   ${structure.keyLevels.majorResistance.map(l => l.toFixed(4)).join(', ')}`);
    }
    if (structure.keyLevels.majorSupport.length > 0) {
      console.log(`   Major Support:      ${structure.keyLevels.majorSupport.map(l => l.toFixed(4)).join(', ')}`);
    }
    console.log();
  }

  // Generate chart
  console.log('🎨 Generating chart...');

  const chartOptions: MarketStructureChartOptions = {
    title: `${ASSET} - Market Structure (${TIMEFRAME}s)`,
    theme: THEME,
    width: 1600,
    height: 900,
    showZones: true,
    showTrendLines: true,
    showSwings: true,
    showPhases: true, // Shows only current phase rectangle
    hidebroken: false,
    zoneOpacity: 0.4,
    phaseOpacity: 0.15,
  };

  // Only pass the lookback candles to the chart (performance optimization)
  const chartCandles = candles.slice(-LOOKBACK);
  const chartHtml = generateMarketStructureChart(chartCandles, structure, chartOptions);

  // Save chart
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const outputFile = path.join(outputDir, `market-structure_${ASSET}_${timestamp}.html`);

  fs.writeFileSync(outputFile, chartHtml);
  console.log(`   ✅ Chart saved: ${outputFile}`);
  console.log();

  // Open in browser
  if (OPEN_BROWSER) {
    console.log('🌐 Opening chart in browser...');
    openInBrowser(outputFile);
  }

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                        Analysis Complete!');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
