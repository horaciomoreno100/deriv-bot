#!/usr/bin/env npx tsx
/**
 * MTF Market Structure Analysis Script
 *
 * Analyzes market structure across multiple timeframes (1m, 5m, 15m)
 * and generates an interactive chart showing zones from all TFs.
 *
 * Usage:
 *   ASSET="frxEURUSD" DAYS=7 npx tsx src/scripts/analyze-mtf-structure.ts
 *   ASSET="R_100" DATA_FILE="data/R_100_1m_7d.csv" npx tsx src/scripts/analyze-mtf-structure.ts
 *
 * Environment variables:
 *   ASSET      - Asset symbol (default: frxEURUSD)
 *   DAYS       - Days of data to fetch (default: 7)
 *   DATA_FILE  - CSV file path (optional, skips API fetch)
 *   LOOKBACK   - Candles to analyze (default: 1000)
 *   THEME      - Chart theme: dark|light (default: dark)
 *   OPEN       - Open chart in browser: true|false (default: true)
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { MTFMarketStructureAnalyzer } from '../analysis/mtf-market-structure.js';
import {
  generateMTFMarketStructureChart,
  type MarketStructureChartOptions,
} from '../analysis/market-structure-chart.js';

// Configuration from environment
const ASSET = process.env.ASSET ?? 'frxEURUSD';
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const DATA_FILE = process.env.DATA_FILE;
const LOOKBACK = parseInt(process.env.LOOKBACK ?? '1000', 10);
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
  console.log('           MTF Market Structure Analysis (1M/5M/15M)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  let candles: { timestamp: number; open: number; high: number; low: number; close: number }[];

  // Load or fetch candles
  if (DATA_FILE) {
    const dataPath = path.join(process.cwd(), DATA_FILE);
    console.log(`📂 Loading from file: ${DATA_FILE}`);

    candles = loadCandlesFromCSV(dataPath, {
      asset: ASSET,
      timeframe: 60,
      timestampColumn: 'timestamp',
      timestampFormat: 'unix_ms',
    });

    console.log(`   ✅ Loaded ${candles.length} candles`);
  } else {
    candles = await fetchCandles(ASSET, DAYS, 60);
  }

  // Take only the last LOOKBACK candles for analysis
  const analysisCandles = candles.slice(-LOOKBACK);
  console.log(`   Using last ${analysisCandles.length} candles for analysis`);
  console.log();

  // Run MTF market structure analysis
  console.log('🔍 Analyzing market structure across timeframes...');
  console.log('   Timeframes: 1M, 5M, 15M');

  const analyzer = new MTFMarketStructureAnalyzer();
  const mtfStructure = analyzer.analyze(analysisCandles, ASSET);

  console.log();
  console.log('┌───────────────────────────────────────────────────────────────┐');
  console.log('│                  MTF ANALYSIS RESULTS                         │');
  console.log('├───────────────────────────────────────────────────────────────┤');
  console.log(`│ Asset:           ${ASSET.padEnd(44)}│`);
  console.log(`│ Candles (1M):    ${String(analysisCandles.length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  const biasEmoji = mtfStructure.htfBias === 'bullish' ? '🟢' : mtfStructure.htfBias === 'bearish' ? '🔴' : '⚪';
  console.log(`│ HTF Bias:        ${biasEmoji} ${mtfStructure.htfBias.toUpperCase().padEnd(40)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  // 15M stats
  const trend15m = mtfStructure.tf15m.trend === 'up' ? '📈' : mtfStructure.tf15m.trend === 'down' ? '📉' : '↔️';
  console.log(`│ 15M Trend:       ${trend15m} ${mtfStructure.tf15m.trend.toUpperCase()} (${mtfStructure.tf15m.trendStrength}%)`.padEnd(64) + '│');
  console.log(`│ 15M Phase:       ${mtfStructure.tf15m.currentPhase.padEnd(44)}│`);
  console.log(`│ 15M Zones:       ${String(mtfStructure.allZones.filter(z => z.tfLabel === '15M').length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  // 5M stats
  const trend5m = mtfStructure.tf5m.trend === 'up' ? '📈' : mtfStructure.tf5m.trend === 'down' ? '📉' : '↔️';
  console.log(`│ 5M Trend:        ${trend5m} ${mtfStructure.tf5m.trend.toUpperCase()} (${mtfStructure.tf5m.trendStrength}%)`.padEnd(64) + '│');
  console.log(`│ 5M Phase:        ${mtfStructure.tf5m.currentPhase.padEnd(44)}│`);
  console.log(`│ 5M Zones:        ${String(mtfStructure.allZones.filter(z => z.tfLabel === '5M').length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');

  // 1M stats
  const trend1m = mtfStructure.tf1m.trend === 'up' ? '📈' : mtfStructure.tf1m.trend === 'down' ? '📉' : '↔️';
  console.log(`│ 1M Trend:        ${trend1m} ${mtfStructure.tf1m.trend.toUpperCase()} (${mtfStructure.tf1m.trendStrength}%)`.padEnd(64) + '│');
  console.log(`│ 1M Phase:        ${mtfStructure.tf1m.currentPhase.padEnd(44)}│`);
  console.log(`│ 1M Zones:        ${String(mtfStructure.allZones.filter(z => z.tfLabel === '1M').length).padEnd(44)}│`);
  console.log('├───────────────────────────────────────────────────────────────┤');
  console.log(`│ Confluence Zones:${String(mtfStructure.confluenceZones.length).padEnd(44)}│`);
  console.log(`│ Total Zones:     ${String(mtfStructure.allZones.length).padEnd(44)}│`);
  console.log('└───────────────────────────────────────────────────────────────┘');
  console.log();

  // Key levels
  if (mtfStructure.htfKeyLevels.resistance.length > 0 || mtfStructure.htfKeyLevels.support.length > 0) {
    console.log('🎯 HTF KEY LEVELS:');
    if (mtfStructure.htfKeyLevels.resistance.length > 0) {
      console.log(`   Resistance: ${mtfStructure.htfKeyLevels.resistance.slice(0, 3).map(l => l.toFixed(5)).join(', ')}`);
    }
    if (mtfStructure.htfKeyLevels.support.length > 0) {
      console.log(`   Support:    ${mtfStructure.htfKeyLevels.support.slice(0, 3).map(l => l.toFixed(5)).join(', ')}`);
    }
    console.log();
  }

  // Confluence zones
  if (mtfStructure.confluenceZones.length > 0) {
    console.log('🔗 CONFLUENCE ZONES (Multi-TF Overlap):');
    for (const conf of mtfStructure.confluenceZones.slice(0, 3)) {
      const tfs = conf.timeframes.join('+');
      console.log(`   ${conf.type.toUpperCase()} [${tfs}]: ${conf.priceLow.toFixed(5)} - ${conf.priceHigh.toFixed(5)} (strength: ${conf.combinedStrength})`);
    }
    console.log();
  }

  // Generate chart
  console.log('🎨 Generating MTF chart...');

  const chartOptions: MarketStructureChartOptions = {
    title: `${ASSET} - MTF Market Structure (1M/5M/15M)`,
    theme: THEME,
    width: 1600,
    height: 900,
    showZones: true,
    showTrendLines: true,
    showSwings: true,
    showPhases: true,
    hidebroken: true, // Hide broken zones for cleaner view
    zoneOpacity: 0.35,
    phaseOpacity: 0.15,
  };

  const chartHtml = generateMTFMarketStructureChart(analysisCandles, mtfStructure, chartOptions);

  // Save chart
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const outputFile = path.join(outputDir, `mtf-structure_${ASSET}_${timestamp}.html`);

  fs.writeFileSync(outputFile, chartHtml);
  console.log(`   ✅ Chart saved: ${outputFile}`);
  console.log();

  // Open in browser
  if (OPEN_BROWSER) {
    console.log('🌐 Opening chart in browser...');
    openInBrowser(outputFile);
  }

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                     MTF Analysis Complete!');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
