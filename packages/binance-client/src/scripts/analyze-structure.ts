/**
 * Binance Market Structure Analysis
 *
 * Uses the existing MarketStructureDetector and chart generator from trader package
 * to analyze crypto markets with REAL volume data from Binance.
 *
 * Usage:
 *   pnpm analyze:structure BTCUSDT 1h 500
 */

import * as fs from 'fs';
import * as path from 'path';
import { BinanceClient, type Bar, type Timeframe } from '../binance-client.js';

// Import from trader package (uses shared types)
import { MarketStructureDetector } from '../../../trader/src/analysis/market-structure-detector.js';
import { generateMarketStructureChart } from '../../../trader/src/analysis/market-structure-chart.js';
import type { Candle } from '@deriv-bot/shared';

/**
 * Convert Binance Bar to Candle format
 */
function barToCandle(bar: Bar): Candle {
  return {
    timestamp: Math.floor(bar.timestamp.getTime() / 1000), // Unix seconds
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume, // REAL volume from Binance!
  };
}

/**
 * Convert timeframe string to seconds
 */
function timeframeToSeconds(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1d': 86400,
    '3d': 259200,
    '1w': 604800,
    '1M': 2592000,
  };
  return map[tf] || 3600;
}

async function main() {
  const symbol = process.argv[2] || 'BTCUSDT';
  const timeframe = (process.argv[3] || '1h') as Timeframe;
  const limit = parseInt(process.argv[4] || '500');

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`     Market Structure Analysis: ${symbol} ${timeframe}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Initialize Binance client
  const client = new BinanceClient();

  // Fetch candles
  console.log(`📊 Fetching ${limit} candles from Binance...`);
  const bars = await client.getSpotKlines(symbol, timeframe, { limit });
  console.log(`   Retrieved ${bars.length} candles with REAL volume`);

  // Show date range
  const firstBar = bars[0];
  const lastBar = bars[bars.length - 1];
  console.log(`   Period: ${firstBar.timestamp.toISOString()} to ${lastBar.timestamp.toISOString()}`);
  console.log();

  // Show volume stats
  const totalVolume = bars.reduce((sum, b) => sum + b.volume, 0);
  const avgVolume = totalVolume / bars.length;
  console.log(`📈 Volume Statistics (REAL exchange volume):`);
  console.log(`   Total: ${totalVolume.toLocaleString()} ${symbol.replace('USDT', '')}`);
  console.log(`   Average per candle: ${avgVolume.toLocaleString()}`);
  console.log();

  // Convert to Candle format
  const candles: Candle[] = bars.map(barToCandle);

  // Analyze market structure
  console.log('🔍 Analyzing market structure...');
  const detector = new MarketStructureDetector({
    swingDepth: 5,
    minZoneTouches: 1,
    lookbackPeriod: limit,
    detectPhases: true,
  });

  const tfSeconds = timeframeToSeconds(timeframe);
  const structure = detector.analyze(candles, symbol, tfSeconds);

  // Print structure summary
  console.log(`   Swing Points: ${structure.swingPoints.length}`);
  console.log(`   S/R Zones: ${structure.zones.length}`);
  console.log(`   Trend Lines: ${structure.trendLines.length}`);
  console.log(`   Market Phases: ${structure.phases.length}`);
  console.log();

  // Print current state
  console.log('📊 Current Market State:');
  console.log(`   Trend: ${structure.trend.toUpperCase()} (${structure.trendStrength}% strength)`);
  console.log(`   Phase: ${structure.currentPhase.toUpperCase()}`);
  console.log();

  // Print key levels
  console.log('🎯 Key Levels:');
  if (structure.keyLevels.nearestResistance) {
    console.log(`   Nearest Resistance: $${structure.keyLevels.nearestResistance.toLocaleString()}`);
  }
  if (structure.keyLevels.nearestSupport) {
    console.log(`   Nearest Support: $${structure.keyLevels.nearestSupport.toLocaleString()}`);
  }
  console.log();

  // Print active zones
  const activeZones = structure.zones.filter((z) => !z.broken);
  console.log(`📍 Active Zones (${activeZones.length}):`);
  for (const zone of activeZones.slice(0, 5)) {
    const mid = (zone.priceHigh + zone.priceLow) / 2;
    const width = ((zone.priceHigh - zone.priceLow) / mid) * 100;
    console.log(
      `   ${zone.type === 'resistance' ? '🔴' : '🟢'} ${zone.type.toUpperCase()}: $${mid.toLocaleString()} (${zone.touchCount} touches, ${width.toFixed(2)}% width)`
    );
  }
  console.log();

  // Generate chart
  console.log('📈 Generating interactive chart...');
  const chartHtml = generateMarketStructureChart(candles, structure, {
    title: `${symbol} ${timeframe} - Market Structure Analysis`,
    theme: 'dark',
    showZones: true,
    showTrendLines: true,
    showSwings: true,
    showPhases: true,
  });

  // Save chart
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `structure_${symbol}_${timeframe}_${timestamp}.html`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, chartHtml);
  console.log(`   Saved to: ${filepath}`);
  console.log();

  // Summary
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                           Summary');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Timeframe: ${timeframe}`);
  console.log(`   Current Price: $${lastBar.close.toLocaleString()}`);
  console.log(`   Trend: ${structure.trend.toUpperCase()} (${structure.trendStrength}%)`);
  console.log(`   Phase: ${structure.currentPhase.toUpperCase()}`);
  console.log(`   Active Zones: ${activeZones.length}`);
  console.log();

  console.log('✅ Done! Open the HTML file in your browser.');
  console.log('   The chart supports zoom (scroll) and pan (drag).');
}

main().catch(console.error);
