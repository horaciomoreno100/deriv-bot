#!/usr/bin/env npx tsx
/**
 * SMC Backtest Visualization
 *
 * Generates an interactive chart showing:
 * - SMC opportunities detected
 * - Simulated trade entries/exits
 * - Quality grades (A+, A, B, C)
 * - Win/Loss outcomes
 *
 * Usage:
 *   ASSET="R_100" DAYS=7 npx tsx src/scripts/visualize-smc-backtest.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { MTFMarketStructureAnalyzer } from '../analysis/mtf-market-structure.js';
import { OrderBlockDetector } from '../analysis/order-block-detector.js';
import { FVGDetector } from '../analysis/fvg-detector.js';
import { LiquiditySweepDetector } from '../analysis/liquidity-sweep-detector.js';
import { SMCOpportunityDetector, type SMCOpportunity } from '../analysis/smc-opportunity-detector.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'R_100';
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const MIN_QUALITY = process.env.QUALITY ?? 'B';
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'analysis-output';

interface Trade {
  signal: SMCOpportunity;
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  exitReason: 'TP' | 'SL' | 'TIMEOUT';
  pnl: number;
  result: 'WIN' | 'LOSS';
  barsHeld: number;
  // Actual TP/SL prices used in simulation
  tpPrice: number;
  slPrice: number;
}

/**
 * Simulate a trade from signal
 */
function simulateTrade(
  signal: SMCOpportunity,
  candles: Candle[],
  entryIndex: number,
  maxBars: number = 30
): Trade | null {
  const entryCandle = candles[entryIndex];
  if (!entryCandle) return null;

  const entryPrice = signal.idealEntry;
  const direction = signal.direction;

  // Use structural TP/SL with sanity limits
  let tpPrice = signal.structuralTP1;
  let slPrice = signal.structuralSL;

  // Cap TP/SL at reasonable percentages
  const maxTPPct = 0.015; // 1.5%
  const maxSLPct = 0.01; // 1%

  if (direction === 'long') {
    tpPrice = Math.min(tpPrice, entryPrice * (1 + maxTPPct));
    slPrice = Math.max(slPrice, entryPrice * (1 - maxSLPct));
  } else {
    tpPrice = Math.max(tpPrice, entryPrice * (1 - maxTPPct));
    slPrice = Math.min(slPrice, entryPrice * (1 + maxSLPct));
  }

  let exitIndex = entryIndex;
  let exitPrice = entryPrice;
  let exitReason: 'TP' | 'SL' | 'TIMEOUT' = 'TIMEOUT';

  // Simulate forward through candles
  for (let i = entryIndex + 1; i < Math.min(entryIndex + maxBars, candles.length); i++) {
    const candle = candles[i]!;

    if (direction === 'long') {
      if (candle.high >= tpPrice) {
        exitIndex = i;
        exitPrice = tpPrice;
        exitReason = 'TP';
        break;
      }
      if (candle.low <= slPrice) {
        exitIndex = i;
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
    } else {
      if (candle.low <= tpPrice) {
        exitIndex = i;
        exitPrice = tpPrice;
        exitReason = 'TP';
        break;
      }
      if (candle.high >= slPrice) {
        exitIndex = i;
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
    }

    exitIndex = i;
    exitPrice = candle.close;
  }

  // Calculate P&L
  const priceChangePct =
    direction === 'long'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

  const stake = 1000 * 0.02;
  const pnl = priceChangePct * stake * 100;

  return {
    signal,
    entryIndex,
    entryPrice,
    exitIndex,
    exitPrice,
    exitReason,
    pnl,
    result: pnl > 0 ? 'WIN' : 'LOSS',
    barsHeld: exitIndex - entryIndex,
    tpPrice,
    slPrice,
  };
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function generateHTML(
  candles: Candle[],
  opportunities: SMCOpportunity[],
  trades: Trade[],
  asset: string
): string {
  const timestamps = candles.map((c) => formatTimestamp(c.timestamp));
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  // Stats
  const wins = trades.filter((t) => t.result === 'WIN').length;
  const losses = trades.filter((t) => t.result === 'LOSS').length;
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0';
  const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  // Quality breakdown
  const byQuality = {
    'A+': opportunities.filter((o) => o.quality === 'A+').length,
    A: opportunities.filter((o) => o.quality === 'A').length,
    B: opportunities.filter((o) => o.quality === 'B').length,
    C: opportunities.filter((o) => o.quality === 'C').length,
  };

  // Create opportunity markers (all detected)
  const oppAnnotations = opportunities.map((opp) => {
    const idx = opp.originIndex;
    if (idx < 0 || idx >= candles.length) return null;

    const qualityColors: Record<string, string> = {
      'A+': '#ffd700',
      A: '#00ff00',
      B: '#00d4ff',
      C: '#888888',
    };

    const arrow = opp.direction === 'long' ? '▲' : '▼';
    const label = `${arrow} ${opp.quality}`;

    return {
      x: timestamps[idx],
      y: opp.direction === 'long' ? lows[idx]! * 0.9995 : highs[idx]! * 1.0005,
      text: label,
      showarrow: false,
      font: { size: 10, color: qualityColors[opp.quality] },
    };
  }).filter(Boolean);

  // Create trade markers (executed trades)
  const tradeAnnotations = trades.flatMap((trade) => {
    const entryIdx = trade.entryIndex;
    const exitIdx = trade.exitIndex;
    if (entryIdx < 0 || entryIdx >= candles.length) return [];
    if (exitIdx < 0 || exitIdx >= candles.length) return [];

    const isWin = trade.result === 'WIN';
    const color = isWin ? '#00ff00' : '#ff4444';

    return [
      // Entry marker
      {
        x: timestamps[entryIdx],
        y: trade.direction === 'long' ? lows[entryIdx]! * 0.9990 : highs[entryIdx]! * 1.0010,
        text: `ENTRY ${trade.signal.direction.toUpperCase()}`,
        showarrow: true,
        arrowhead: 2,
        arrowcolor: color,
        ax: 0,
        ay: trade.signal.direction === 'long' ? 30 : -30,
        font: { size: 10, color: 'white' },
        bgcolor: '#333',
        bordercolor: color,
      },
      // Exit marker
      {
        x: timestamps[exitIdx],
        y: trade.signal.direction === 'long' ? highs[exitIdx]! * 1.0005 : lows[exitIdx]! * 0.9995,
        text: `${trade.exitReason} ${isWin ? '✅' : '❌'} $${trade.pnl.toFixed(2)}`,
        showarrow: true,
        arrowhead: 2,
        arrowcolor: color,
        ax: 0,
        ay: trade.signal.direction === 'long' ? -30 : 30,
        font: { size: 10, color: 'white' },
        bgcolor: isWin ? '#004400' : '#440000',
        bordercolor: color,
      },
    ];
  });

  // Trade lines (entry to exit)
  const tradeLines = trades.map((trade) => {
    const isWin = trade.result === 'WIN';
    return {
      type: 'line',
      x0: timestamps[trade.entryIndex],
      x1: timestamps[trade.exitIndex],
      y0: trade.entryPrice,
      y1: trade.exitPrice,
      line: {
        color: isWin ? '#00ff00' : '#ff4444',
        width: 2,
        dash: 'solid',
      },
    };
  });

  // TP/SL zones for each trade - use actual values from simulation
  const tpslShapes = trades.flatMap((trade) => {
    const startIdx = trade.entryIndex;
    const endIdx = Math.min(trade.exitIndex + 5, candles.length - 1);

    // Use the actual TP/SL prices that were used in the simulation
    const tpPrice = trade.tpPrice;
    const slPrice = trade.slPrice;

    return [
      // TP line (green)
      {
        type: 'line',
        x0: timestamps[startIdx],
        x1: timestamps[endIdx],
        y0: tpPrice,
        y1: tpPrice,
        line: { color: '#00ff00', width: 2, dash: 'dot' },
      },
      // SL line (red)
      {
        type: 'line',
        x0: timestamps[startIdx],
        x1: timestamps[endIdx],
        y0: slPrice,
        y1: slPrice,
        line: { color: '#ff4444', width: 2, dash: 'dot' },
      },
      // Entry line (white)
      {
        type: 'line',
        x0: timestamps[startIdx],
        x1: timestamps[endIdx],
        y0: trade.entryPrice,
        y1: trade.entryPrice,
        line: { color: '#ffffff', width: 1, dash: 'solid' },
      },
    ];
  });

  return `<!DOCTYPE html>
<html>
<head>
  <title>SMC Backtest - ${asset}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d4ff; margin-bottom: 10px; }
    .stats { display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-box { background: #16213e; padding: 12px 20px; border-radius: 8px; text-align: center; min-width: 80px; }
    .stat-value { font-size: 22px; font-weight: bold; color: #00d4ff; }
    .stat-label { font-size: 11px; color: #888; margin-top: 5px; }
    .chart-container { background: #0f0f23; border-radius: 8px; padding: 10px; margin-bottom: 20px; }
    .info-box { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .quality-badge { display: inline-block; padding: 3px 8px; border-radius: 4px; margin-right: 8px; font-weight: bold; }
    .quality-aplus { background: #ffd700; color: #000; }
    .quality-a { background: #00ff00; color: #000; }
    .quality-b { background: #00d4ff; color: #000; }
    .quality-c { background: #888; color: #fff; }
    .trade-list { max-height: 300px; overflow-y: auto; }
    .trade-item { padding: 8px; margin: 5px 0; background: #0f0f23; border-radius: 4px; display: flex; justify-content: space-between; }
    .win { border-left: 3px solid #00ff00; }
    .loss { border-left: 3px solid #ff4444; }
  </style>
</head>
<body>
  <h1>🎯 SMC Backtest Results - ${asset}</h1>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-value">${candles.length.toLocaleString()}</div>
      <div class="stat-label">Candles</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ffcc00">${opportunities.length}</div>
      <div class="stat-label">Opportunities</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${trades.length}</div>
      <div class="stat-label">Trades</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #00ff00">${wins}</div>
      <div class="stat-label">✅ Wins</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ff4444">${losses}</div>
      <div class="stat-label">❌ Losses</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: ${parseFloat(winRate) >= 50 ? '#00ff00' : '#ff4444'}">${winRate}%</div>
      <div class="stat-label">Win Rate</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: ${netPnl >= 0 ? '#00ff00' : '#ff4444'}">$${netPnl.toFixed(2)}</div>
      <div class="stat-label">Net P&L</div>
    </div>
  </div>

  <div class="info-box">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">📊 Quality Distribution</h3>
    <div>
      <span class="quality-badge quality-aplus">A+ ${byQuality['A+']}</span>
      <span class="quality-badge quality-a">A ${byQuality.A}</span>
      <span class="quality-badge quality-b">B ${byQuality.B}</span>
      <span class="quality-badge quality-c">C ${byQuality.C}</span>
    </div>
    <p style="margin: 10px 0 0 0; font-size: 13px; color: #888;">
      SMC signals are graded by confluence count: A+ (5+), A (4), B (3), C (1-2).
      Only opportunities where price reached the entry zone become trades.
    </p>
  </div>

  <div class="chart-container">
    <div id="priceChart" style="height: 600px;"></div>
  </div>

  <div class="info-box">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">📝 Trade List</h3>
    <div class="trade-list">
      ${trades
        .map(
          (t) => `
        <div class="trade-item ${t.result.toLowerCase()}">
          <span>
            ${t.signal.direction === 'long' ? '⬆️' : '⬇️'}
            <strong>${t.signal.quality}</strong> ${t.signal.setupType}
          </span>
          <span>${t.exitReason}</span>
          <span style="color: ${t.result === 'WIN' ? '#00ff00' : '#ff4444'}">
            ${t.result === 'WIN' ? '✅' : '❌'} $${t.pnl.toFixed(2)}
          </span>
        </div>
      `
        )
        .join('')}
    </div>
  </div>

  <script>
    const candlestick = {
      x: ${JSON.stringify(timestamps)},
      open: ${JSON.stringify(opens)},
      high: ${JSON.stringify(highs)},
      low: ${JSON.stringify(lows)},
      close: ${JSON.stringify(closes)},
      type: 'candlestick',
      name: '${asset}',
      increasing: { line: { color: '#26a69a' } },
      decreasing: { line: { color: '#ef5350' } },
    };

    const layout = {
      title: 'SMC Opportunities & Trades',
      xaxis: {
        rangeslider: { visible: false },
        color: '#888',
      },
      yaxis: {
        title: 'Price',
        color: '#888',
        side: 'right',
        autorange: true,
        fixedrange: false,
      },
      shapes: ${JSON.stringify([...tradeLines, ...tpslShapes])},
      annotations: ${JSON.stringify([...oppAnnotations, ...tradeAnnotations])},
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: false,
      margin: { t: 50, b: 50, l: 50, r: 80 },
    };

    Plotly.newPlot('priceChart', [candlestick], layout, {
      responsive: true,
      scrollZoom: true,
    });
  </script>
</body>
</html>`;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     SMC BACKTEST VISUALIZATION                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Asset: ${ASSET}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Min Quality: ${MIN_QUALITY}`);

  // Find data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${ASSET}_1m_${DAYS}d.csv`,
    `${ASSET}_60s_${DAYS}d.csv`,
    `${ASSET}_1m_7d.csv`,
    `${ASSET}_1m_30d.csv`,
    `${ASSET}_1m_90d.csv`,
  ];

  let dataPath: string | null = null;
  for (const file of possibleFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      dataPath = fullPath;
      break;
    }
  }

  if (!dataPath) {
    console.log(`❌ No data file found for ${ASSET}`);
    return;
  }

  console.log(`\n📂 Loading: ${path.basename(dataPath)}`);
  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });

  console.log(`   ${candles.length.toLocaleString()} candles loaded`);

  if (candles.length < 500) {
    console.log('❌ Not enough candles');
    return;
  }

  // Pre-calculate SMC components
  console.log('\n🔍 Pre-calculating SMC components...');
  const startTime = Date.now();

  const mtfAnalyzer = new MTFMarketStructureAnalyzer();
  const mtfStructure = mtfAnalyzer.analyze(candles);
  console.log(`   MTF Structure: ${mtfStructure.allZones.length} zones`);

  const obDetector = new OrderBlockDetector();
  const orderBlocks = obDetector.detect(candles);
  console.log(`   Order Blocks: ${orderBlocks.length} detected`);

  const fvgDetector = new FVGDetector({ minGapPct: 0.03 });
  const fvgs = fvgDetector.detect(candles);
  const unfilledFVGs = fvgDetector.getUnfilledFVGs(fvgs);
  console.log(`   FVGs: ${fvgs.length} total, ${unfilledFVGs.length} unfilled`);

  const sweepDetector = new LiquiditySweepDetector();
  const sweeps = sweepDetector.detect(candles, mtfStructure.tf1m.swingPoints);
  console.log(`   Liquidity Sweeps: ${sweeps.length} detected`);

  // Detect opportunities
  console.log('\n🎯 Detecting SMC opportunities...');
  const smcDetector = new SMCOpportunityDetector();
  const allOpportunities = smcDetector.detect({
    candles,
    mtfStructure,
    orderBlocks,
    fvgs: unfilledFVGs,
    sweeps,
    asset: ASSET,
  });

  const precalcTime = Date.now() - startTime;
  console.log(`   Total opportunities: ${allOpportunities.length}`);
  console.log(`   Pre-calculation time: ${precalcTime}ms`);

  // Filter by quality
  const qualityOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3 };
  const minQualityLevel = qualityOrder[MIN_QUALITY] ?? 2;

  const filteredOpportunities = allOpportunities.filter(
    (opp) => qualityOrder[opp.quality] <= minQualityLevel
  );

  console.log(`   After quality filter (>= ${MIN_QUALITY}): ${filteredOpportunities.length}`);

  // Simulate trades
  console.log('\n💹 Simulating trades...');
  const sortedOpps = [...filteredOpportunities].sort((a, b) => a.originIndex - b.originIndex);

  const trades: Trade[] = [];
  let lastExitIndex = 0;
  const cooldownBars = 5;

  for (const opp of sortedOpps) {
    if (opp.originIndex < lastExitIndex + cooldownBars) continue;

    // Find entry index
    let entryIndex = -1;
    for (let i = opp.originIndex + 1; i < Math.min(opp.originIndex + 50, candles.length); i++) {
      const candle = candles[i]!;
      const touchesZone =
        opp.direction === 'long'
          ? candle.low <= opp.entryZoneHigh
          : candle.high >= opp.entryZoneLow;

      if (touchesZone) {
        entryIndex = i;
        break;
      }
    }

    if (entryIndex === -1) continue;

    const trade = simulateTrade(opp, candles, entryIndex, 30);
    if (trade) {
      trades.push(trade);
      lastExitIndex = trade.exitIndex;
    }
  }

  console.log(`   Trades executed: ${trades.length}`);

  // Generate HTML
  console.log('\n📝 Generating chart...');
  const html = generateHTML(candles, filteredOpportunities, trades, ASSET);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `smc-backtest_${ASSET}_${timestamp}.html`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, html);
  console.log(`\n✅ Chart saved to: ${filepath}`);

  // Print summary
  const wins = trades.filter((t) => t.result === 'WIN').length;
  const losses = trades.filter((t) => t.result === 'LOSS').length;
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0';
  const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  console.log('\n' + '─'.repeat(50));
  console.log('SUMMARY');
  console.log('─'.repeat(50));
  console.log(`Trades: ${trades.length} (${wins}W / ${losses}L)`);
  console.log(`Win Rate: ${winRate}%`);
  console.log(`Net P&L: $${netPnl.toFixed(2)}`);
}

main().catch(console.error);
