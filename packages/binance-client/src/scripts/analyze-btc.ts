/**
 * Analyze BTC/USDT Market Structure
 *
 * Generates an interactive HTML chart showing:
 * - Swing points (HH, HL, LH, LL)
 * - FVGs (Fair Value Gaps)
 * - Liquidity sweeps
 * - BOS/CHoCH
 */

import * as fs from 'fs';
import * as path from 'path';
import { BinanceClient } from '../binance-client.js';
import {
  MarketStructureDetector,
  FVGDetector,
  LiquiditySweepDetector,
  generateChart,
} from '../analysis/index.js';

async function main() {
  const symbol = process.argv[2] || 'BTCUSDT';
  const timeframe = (process.argv[3] || '1h') as any;
  const limit = parseInt(process.argv[4] || '200');

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`     Market Structure Analysis: ${symbol} ${timeframe}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Initialize client
  const client = new BinanceClient();

  // Fetch candles
  console.log(`📊 Fetching ${limit} candles...`);
  const candles = await client.getSpotKlines(symbol, timeframe, { limit });
  console.log(`   Retrieved ${candles.length} candles`);
  console.log(
    `   Period: ${candles[0].timestamp.toISOString()} to ${candles[candles.length - 1].timestamp.toISOString()}`
  );
  console.log();

  // Analyze market structure
  console.log('🔍 Analyzing market structure...');
  const structureDetector = new MarketStructureDetector({ swingStrength: 3 });
  const structure = structureDetector.analyze(candles);
  console.log(`   Swing Highs: ${structure.swingHighs.length}`);
  console.log(`   Swing Lows: ${structure.swingLows.length}`);
  console.log(`   Structure Breaks: ${structure.structureBreaks.length}`);
  console.log(`   Current Trend: ${structure.currentTrend.toUpperCase()}`);
  console.log();

  // Detect FVGs
  console.log('🔍 Detecting Fair Value Gaps...');
  const fvgDetector = new FVGDetector({ minSizePercent: 0.1 });
  const fvgs = fvgDetector.detect(candles);
  const openFVGs = fvgs.filter((f) => !f.mitigated);
  console.log(`   Total FVGs: ${fvgs.length}`);
  console.log(`   Open FVGs: ${openFVGs.length}`);
  console.log(`   Bullish: ${fvgs.filter((f) => f.type === 'bullish').length}`);
  console.log(`   Bearish: ${fvgs.filter((f) => f.type === 'bearish').length}`);
  console.log();

  // Detect liquidity sweeps
  console.log('🔍 Detecting liquidity sweeps...');
  const sweepDetector = new LiquiditySweepDetector();
  const sweeps = sweepDetector.detectSweeps(candles, structure.swingHighs, structure.swingLows);
  const equalHighs = sweepDetector.detectEqualHighs(candles);
  const equalLows = sweepDetector.detectEqualLows(candles);
  console.log(`   Liquidity Sweeps: ${sweeps.length}`);
  console.log(`   Equal Highs: ${equalHighs.length}`);
  console.log(`   Equal Lows: ${equalLows.length}`);
  console.log();

  // Print recent structure
  console.log('📈 Recent Structure:');
  if (structure.lastHH) {
    console.log(`   Last HH: $${structure.lastHH.price.toLocaleString()} (${structure.lastHH.timestamp.toISOString().substring(0, 16)})`);
  }
  if (structure.lastHL) {
    console.log(`   Last HL: $${structure.lastHL.price.toLocaleString()} (${structure.lastHL.timestamp.toISOString().substring(0, 16)})`);
  }
  if (structure.lastLH) {
    console.log(`   Last LH: $${structure.lastLH.price.toLocaleString()} (${structure.lastLH.timestamp.toISOString().substring(0, 16)})`);
  }
  if (structure.lastLL) {
    console.log(`   Last LL: $${structure.lastLL.price.toLocaleString()} (${structure.lastLL.timestamp.toISOString().substring(0, 16)})`);
  }
  console.log();

  // Print recent BOS/CHoCH
  console.log('📊 Recent Structure Breaks:');
  const recentBreaks = structure.structureBreaks.slice(-5);
  for (const b of recentBreaks) {
    const arrow = b.direction === 'bullish' ? '↗️' : '↘️';
    console.log(
      `   ${arrow} ${b.type} ${b.direction} @ $${b.brokenLevel.toLocaleString()} (${b.timestamp.toISOString().substring(0, 16)})`
    );
  }
  console.log();

  // Print open FVGs
  console.log('🎯 Open FVG Zones:');
  for (const fvg of openFVGs.slice(-5)) {
    const type = fvg.type === 'bullish' ? '🟢' : '🔴';
    console.log(
      `   ${type} ${fvg.type.toUpperCase()} FVG: $${fvg.bottom.toLocaleString()} - $${fvg.top.toLocaleString()} (${fvg.sizePercent.toFixed(2)}%)`
    );
  }
  console.log();

  // Generate HTML chart
  console.log('📈 Generating interactive chart...');
  const chartHtml = generateChart({
    symbol,
    timeframe,
    candles,
    structure,
    fvgs,
    sweeps,
    equalHighs,
    equalLows,
  });

  // Save chart
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `market-structure_${symbol}_${timeframe}_${timestamp}.html`;
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
  console.log(`   Current Price: $${candles[candles.length - 1].close.toLocaleString()}`);
  console.log(`   Trend: ${structure.currentTrend.toUpperCase()}`);
  console.log(`   Open FVGs: ${openFVGs.length}`);
  console.log(`   Sweeps: ${sweeps.length}`);
  console.log();

  // Trading bias
  const currentPrice = candles[candles.length - 1].close;
  const nearestBullishFVG = openFVGs.find((f) => f.type === 'bullish' && f.top < currentPrice);
  const nearestBearishFVG = openFVGs.find((f) => f.type === 'bearish' && f.bottom > currentPrice);

  console.log('🎯 Key Levels:');
  if (nearestBullishFVG) {
    console.log(`   Bullish FVG below: $${nearestBullishFVG.top.toLocaleString()} - $${nearestBullishFVG.bottom.toLocaleString()}`);
  }
  if (nearestBearishFVG) {
    console.log(`   Bearish FVG above: $${nearestBearishFVG.bottom.toLocaleString()} - $${nearestBearishFVG.top.toLocaleString()}`);
  }
  if (structure.lastHL) {
    console.log(`   Support (last HL): $${structure.lastHL.price.toLocaleString()}`);
  }
  if (structure.lastLH) {
    console.log(`   Resistance (last LH): $${structure.lastLH.price.toLocaleString()}`);
  }
  console.log();

  console.log('✅ Done! Open the HTML file in your browser to view the interactive chart.');
}

main().catch(console.error);
