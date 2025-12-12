/**
 * Binance MTF (Multi-Timeframe) Market Structure Analysis
 *
 * Analyzes market structure across 1m, 5m, and 15m timeframes
 * showing zones from each TF with different colors.
 *
 * Usage:
 *   pnpm analyze:mtf BTCUSDT 1000
 */

import * as fs from 'fs';
import * as path from 'path';
import { BinanceClient, type Bar } from '../binance-client.js';

// Import from trader package
import { MTFMarketStructureAnalyzer } from '../../../trader/src/analysis/mtf-market-structure.js';
import { generateMTFMarketStructureChart } from '../../../trader/src/analysis/market-structure-chart.js';
import { OrderBlockDetector } from '../../../trader/src/analysis/order-block-detector.js';
import { FVGDetector } from '../../../trader/src/analysis/fvg-detector.js';
import { LiquiditySweepDetector } from '../../../trader/src/analysis/liquidity-sweep-detector.js';
import { SMCOpportunityDetector, getHighQualitySetups } from '../../../trader/src/analysis/smc-opportunity-detector.js';
import type { Candle } from '@deriv-bot/shared';

/**
 * Convert Binance Bar to Candle format
 */
function barToCandle(bar: Bar): Candle {
  return {
    timestamp: Math.floor(bar.timestamp.getTime() / 1000),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

async function main() {
  const symbol = process.argv[2] || 'BTCUSDT';
  const limit = parseInt(process.argv[3] || '1000'); // Need more 1m candles for MTF

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`     MTF Market Structure Analysis: ${symbol}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Initialize Binance client
  const client = new BinanceClient();

  // Fetch 1m candles (base timeframe)
  console.log(`📊 Fetching ${limit} x 1m candles from Binance...`);
  const bars1m = await client.getSpotKlines(symbol, '1m', { limit });
  console.log(`   Retrieved ${bars1m.length} candles`);

  // Show date range
  const firstBar = bars1m[0];
  const lastBar = bars1m[bars1m.length - 1];
  const hoursOfData = (lastBar.timestamp.getTime() - firstBar.timestamp.getTime()) / (1000 * 60 * 60);
  console.log(`   Period: ${firstBar.timestamp.toISOString()} to ${lastBar.timestamp.toISOString()}`);
  console.log(`   Coverage: ${hoursOfData.toFixed(1)} hours (~${(hoursOfData / 24).toFixed(1)} days)`);
  console.log();

  // Convert to Candle format
  const candles1m: Candle[] = bars1m.map(barToCandle);

  // Analyze MTF structure
  console.log('🔍 Analyzing multi-timeframe structure...');
  const analyzer = new MTFMarketStructureAnalyzer({
    tf1mOptions: { swingDepth: 3, lookbackPeriod: 200, minZoneTouches: 1 },
    tf5mOptions: { swingDepth: 4, lookbackPeriod: 100, minZoneTouches: 1 },
    tf15mOptions: { swingDepth: 5, lookbackPeriod: 50, minZoneTouches: 1 },
  });

  const mtfStructure = analyzer.analyze(candles1m, symbol);

  // Print structure summary
  console.log();
  console.log('📊 Timeframe Analysis:');
  console.log(`   1M:  ${mtfStructure.tf1m.zones.length} zones, ${mtfStructure.tf1m.swingPoints.length} swings, trend: ${mtfStructure.tf1m.trend}`);
  console.log(`   5M:  ${mtfStructure.tf5m.zones.length} zones, ${mtfStructure.tf5m.swingPoints.length} swings, trend: ${mtfStructure.tf5m.trend}`);
  console.log(`   15M: ${mtfStructure.tf15m.zones.length} zones, ${mtfStructure.tf15m.swingPoints.length} swings, trend: ${mtfStructure.tf15m.trend}`);
  console.log();

  // Print HTF analysis
  console.log('📈 Higher Timeframe Analysis:');
  console.log(`   HTF Bias: ${mtfStructure.htfBias.toUpperCase()}`);
  console.log(`   Confluence Zones: ${mtfStructure.confluenceZones.length}`);
  console.log(`   HTF Resistances: ${mtfStructure.htfKeyLevels.resistance.length}`);
  console.log(`   HTF Supports: ${mtfStructure.htfKeyLevels.support.length}`);
  console.log();

  // Print confluence zones
  if (mtfStructure.confluenceZones.length > 0) {
    console.log('🎯 Confluence Zones (multiple TFs agree):');
    for (const zone of mtfStructure.confluenceZones.slice(0, 5)) {
      const mid = (zone.priceHigh + zone.priceLow) / 2;
      console.log(
        `   ${zone.type === 'resistance' ? '🔴' : '🟢'} ${zone.type.toUpperCase()}: $${mid.toLocaleString()} [${zone.timeframes.join('+')}] (strength: ${zone.combinedStrength})`
      );
    }
    console.log();
  }

  // Print HTF key levels
  console.log('📍 HTF Key Levels:');
  if (mtfStructure.htfKeyLevels.resistance.length > 0) {
    console.log(`   Resistances: ${mtfStructure.htfKeyLevels.resistance.slice(0, 3).map(p => '$' + p.toLocaleString()).join(', ')}`);
  }
  if (mtfStructure.htfKeyLevels.support.length > 0) {
    console.log(`   Supports: ${mtfStructure.htfKeyLevels.support.slice(0, 3).map(p => '$' + p.toLocaleString()).join(', ')}`);
  }
  console.log();

  // Detect Order Blocks
  console.log('🔍 Detecting Order Blocks...');
  const obDetector = new OrderBlockDetector({
    minImpulsePct: 0.2, // Lower threshold for crypto (volatile)
    impulseCandles: 5,
    minImpulseCandles: 2,
    trackMitigation: true,
  });
  const orderBlocks = obDetector.detect(candles1m);
  const activeOBs = obDetector.getActiveOrderBlocks(orderBlocks);

  console.log(`   Total Order Blocks: ${orderBlocks.length}`);
  console.log(`   Active (unmitigated): ${activeOBs.length}`);
  console.log(`   Bullish OBs: ${activeOBs.filter(ob => ob.type === 'bullish').length}`);
  console.log(`   Bearish OBs: ${activeOBs.filter(ob => ob.type === 'bearish').length}`);
  console.log();

  // Print strongest active Order Blocks
  if (activeOBs.length > 0) {
    const strongestOBs = [...activeOBs].sort((a, b) => b.strength - a.strength).slice(0, 5);
    console.log('🎯 Strongest Active Order Blocks:');
    for (const ob of strongestOBs) {
      const emoji = ob.type === 'bullish' ? '🔵' : '🔴';
      const stars = '★'.repeat(ob.strength);
      const midPrice = (ob.priceHigh + ob.priceLow) / 2;
      console.log(`   ${emoji} ${ob.type.toUpperCase()}: $${midPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${stars} (impulse: ${ob.impulseSizePct.toFixed(2)}%)`);
    }
    console.log();
  }

  // Detect Fair Value Gaps
  console.log('🔍 Detecting Fair Value Gaps...');
  const fvgDetector = new FVGDetector({
    minGapPct: 0.03, // Lower threshold for crypto
    trackFill: true,
    fillThresholdPct: 50,
    trackRespected: true,
  });
  const fvgs = fvgDetector.detect(candles1m);
  const unfilledFVGs = fvgDetector.getUnfilledFVGs(fvgs);

  console.log(`   Total FVGs: ${fvgs.length}`);
  console.log(`   Unfilled: ${unfilledFVGs.length}`);
  console.log(`   Bullish FVGs: ${unfilledFVGs.filter(f => f.type === 'bullish').length}`);
  console.log(`   Bearish FVGs: ${unfilledFVGs.filter(f => f.type === 'bearish').length}`);
  console.log();

  // Print strongest unfilled FVGs
  if (unfilledFVGs.length > 0) {
    const strongestFVGs = [...unfilledFVGs].sort((a, b) => b.strength - a.strength || b.gapSizePct - a.gapSizePct).slice(0, 5);
    console.log('🎯 Strongest Unfilled FVGs:');
    for (const fvg of strongestFVGs) {
      const emoji = fvg.type === 'bullish' ? '📗' : '📕';
      const stars = '★'.repeat(Math.min(fvg.strength, 3));
      console.log(`   ${emoji} ${fvg.type.toUpperCase()}: $${fvg.midpoint.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${stars} (gap: ${fvg.gapSizePct.toFixed(3)}%)`);
    }
    console.log();
  }

  // Detect Liquidity Sweeps
  console.log('🔍 Detecting Liquidity Sweeps...');
  const sweepDetector = new LiquiditySweepDetector({
    minSweepDepthPct: 0.03, // Lower for crypto
    swingLookback: 50,
    minSwingStrength: 1,
    reversalCandles: 5,
    minReversalPct: 0.05,
  });
  const sweeps = sweepDetector.detect(candles1m, mtfStructure.tf1m.swingPoints);
  const recentSweeps = sweepDetector.getRecentSweeps(sweeps, candles1m, 100); // Last 100 candles

  console.log(`   Total Sweeps: ${sweeps.length}`);
  console.log(`   Recent (last 100 candles): ${recentSweeps.length}`);
  console.log(`   Buyside (BSL): ${recentSweeps.filter(s => s.type === 'buyside').length}`);
  console.log(`   Sellside (SSL): ${recentSweeps.filter(s => s.type === 'sellside').length}`);
  console.log();

  // Print strongest recent sweeps
  if (recentSweeps.length > 0) {
    const strongestSweeps = [...recentSweeps].sort((a, b) => b.strength - a.strength || b.reversalPct - a.reversalPct).slice(0, 5);
    console.log('🎯 Strongest Recent Liquidity Sweeps:');
    for (const sweep of strongestSweeps) {
      const emoji = sweep.type === 'buyside' ? '🔺' : '🔻';
      const label = sweep.type === 'buyside' ? 'BSL' : 'SSL';
      const stars = '★'.repeat(Math.min(sweep.strength, 3));
      console.log(`   ${emoji} ${label}: $${sweep.sweptLevel.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${stars} (depth: ${sweep.sweepDepthPct.toFixed(3)}%, reversal: ${sweep.reversalPct.toFixed(3)}%)`);
    }
    console.log();
  }

  // ==================== SMC OPPORTUNITY DETECTION ====================
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                    SMC Opportunity Detection');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  const smcDetector = new SMCOpportunityDetector();
  const opportunities = smcDetector.detect({
    candles: candles1m,
    mtfStructure,
    orderBlocks: activeOBs,
    fvgs: unfilledFVGs,
    sweeps: recentSweeps,
    asset: symbol,
  });

  const highQuality = getHighQualitySetups(opportunities);

  console.log(`   Total Opportunities: ${opportunities.length}`);
  console.log(`   High Quality (A/A+): ${highQuality.length}`);
  console.log();

  // Print opportunities by quality tier
  const byQuality = {
    'A+': opportunities.filter(o => o.quality === 'A+'),
    'A': opportunities.filter(o => o.quality === 'A'),
    'B': opportunities.filter(o => o.quality === 'B'),
    'C': opportunities.filter(o => o.quality === 'C'),
  };

  if (byQuality['A+'].length > 0) {
    console.log('🌟 A+ SETUPS (Highest Quality):');
    for (const opp of byQuality['A+'].slice(0, 3)) {
      const dirEmoji = opp.direction === 'long' ? '📈' : '📉';
      console.log(`   ${dirEmoji} ${opp.setupType.toUpperCase()} @ $${opp.idealEntry.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`      Direction: ${opp.direction.toUpperCase()} | R:R ${opp.riskRewardRatio.toFixed(2)}`);
      console.log(`      Confluences: ${opp.confluenceCount} factors`);
      console.log(`      SL: $${opp.structuralSL.toLocaleString(undefined, { maximumFractionDigits: 2 })} | TP1: $${opp.structuralTP1.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`      Reasons: ${opp.reasons.slice(0, 2).join(', ')}`);
      if (opp.warnings.length > 0) {
        console.log(`      ⚠️  ${opp.warnings[0]}`);
      }
      console.log();
    }
  }

  if (byQuality['A'].length > 0) {
    console.log('⭐ A SETUPS (High Quality):');
    for (const opp of byQuality['A'].slice(0, 3)) {
      const dirEmoji = opp.direction === 'long' ? '📈' : '📉';
      console.log(`   ${dirEmoji} ${opp.setupType.toUpperCase()} @ $${opp.idealEntry.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`      Direction: ${opp.direction.toUpperCase()} | R:R ${opp.riskRewardRatio.toFixed(2)} | Confluences: ${opp.confluenceCount}`);
      console.log(`      Reasons: ${opp.reasons.slice(0, 2).join(', ')}`);
      console.log();
    }
  }

  if (byQuality['B'].length > 0 && highQuality.length === 0) {
    console.log('📊 B SETUPS (Moderate Quality - be cautious):');
    for (const opp of byQuality['B'].slice(0, 2)) {
      const dirEmoji = opp.direction === 'long' ? '📈' : '📉';
      console.log(`   ${dirEmoji} ${opp.setupType.toUpperCase()} @ $${opp.idealEntry.toLocaleString(undefined, { maximumFractionDigits: 2 })} | Confluences: ${opp.confluenceCount}`);
    }
    console.log();
  }

  if (opportunities.length === 0) {
    console.log('   ⏳ No clear setups detected - wait for better conditions');
    console.log();
  }

  // Generate MTF chart with Order Blocks, FVGs, Sweeps, Volume, and SMC Opportunities
  console.log('📈 Generating MTF interactive chart...');
  const chartHtml = generateMTFMarketStructureChart(candles1m, mtfStructure, {
    title: `${symbol} MTF Market Structure (1M/5M/15M)`,
    theme: 'dark',
    showZones: true,
    showTrendLines: false, // Disabled for cleaner chart
    showSwings: true,
    showPhases: false, // Disabled for cleaner chart
    showOrderBlocks: true,
    orderBlocks: activeOBs, // Only show active order blocks
    showVolume: true, // Show real volume from Binance
    showFVGs: true,
    fvgs: unfilledFVGs, // Only show unfilled FVGs
    showLiquiditySweeps: true,
    liquiditySweeps: recentSweeps, // Only show recent sweeps
    showOpportunities: true,
    opportunities: opportunities, // Show detected SMC opportunities
  });

  // Save chart
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `mtf_${symbol}_${timestamp}.html`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, chartHtml);
  console.log(`   Saved to: ${filepath}`);
  console.log();

  // Summary
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                           Summary');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Current Price: $${lastBar.close.toLocaleString()}`);
  console.log(`   HTF Bias: ${mtfStructure.htfBias.toUpperCase()}`);
  console.log(`   15M Trend: ${mtfStructure.tf15m.trend.toUpperCase()}`);
  console.log(`   5M Trend: ${mtfStructure.tf5m.trend.toUpperCase()}`);
  console.log(`   1M Trend: ${mtfStructure.tf1m.trend.toUpperCase()}`);
  console.log(`   Total Zones: ${mtfStructure.allZones.length}`);
  console.log(`   Confluences: ${mtfStructure.confluenceZones.length}`);
  console.log();

  console.log('✅ Done! Open the HTML file in your browser.');
  console.log('   Legend:');
  console.log('   - S/R Zones: 5M=purple, 15M=gold');
  console.log('   - Order Blocks: 🔵 Bullish (blue), 🔴 Bearish (pink)');
  console.log('   - FVGs: 📗 Bullish (light green), 📕 Bearish (light red) - dashed borders');
  console.log('   - Liquidity Sweeps: 🔺 BSL (amber), 🔻 SSL (violet) - dotted lines');
  console.log('   - Volume: Green=up, Red=down (bottom panel)');
}

main().catch(console.error);
