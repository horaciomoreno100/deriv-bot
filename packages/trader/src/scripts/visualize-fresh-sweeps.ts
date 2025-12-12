#!/usr/bin/env npx tsx
/**
 * Fresh Sweep Backtest Visualization
 *
 * Tests the Fresh Sweep detector - focused on:
 * - Sweeps within last 1-3 candles (FRESH)
 * - Immediate confirmation (pin bar, engulfing, rejection)
 * - Clear entry at the reversal candle
 *
 * Usage:
 *   ASSET="R_100" DAYS=7 npx tsx src/scripts/visualize-fresh-sweeps.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { FreshSweepDetector, type FreshSweep } from '../analysis/fresh-sweep-detector.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'R_100';
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const MIN_QUALITY = process.env.QUALITY ?? 'B';
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'analysis-output';

interface Trade {
  sweep: FreshSweep;
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  exitReason: 'TP' | 'SL' | 'TIMEOUT';
  pnl: number;
  result: 'WIN' | 'LOSS';
  barsHeld: number;
}

/**
 * Simulate a trade from fresh sweep signal
 */
function simulateTrade(
  sweep: FreshSweep,
  candles: Candle[],
  maxBars: number = 50
): Trade | null {
  // Entry is at the confirmation candle close (already set in sweep.entryPrice)
  const entryIndex = sweep.confirmationIndex;
  const entryPrice = sweep.entryPrice;
  const direction = sweep.direction;

  const tpPrice = sweep.takeProfit1;
  const slPrice = sweep.stopLoss;

  let exitIndex = entryIndex;
  let exitPrice = entryPrice;
  let exitReason: 'TP' | 'SL' | 'TIMEOUT' = 'TIMEOUT';

  // Simulate forward through candles
  for (let i = entryIndex + 1; i < Math.min(entryIndex + maxBars, candles.length); i++) {
    const candle = candles[i]!;

    if (direction === 'long') {
      // Check TP first (optimistic)
      if (candle.high >= tpPrice) {
        exitIndex = i;
        exitPrice = tpPrice;
        exitReason = 'TP';
        break;
      }
      // Check SL
      if (candle.low <= slPrice) {
        exitIndex = i;
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
    } else {
      // Check TP first
      if (candle.low <= tpPrice) {
        exitIndex = i;
        exitPrice = tpPrice;
        exitReason = 'TP';
        break;
      }
      // Check SL
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

  const stake = 1000 * 0.02; // 2% of $1000
  const multiplier = 100;
  const pnl = priceChangePct * stake * multiplier;

  return {
    sweep,
    entryIndex,
    entryPrice,
    exitIndex,
    exitPrice,
    exitReason,
    pnl,
    result: pnl > 0 ? 'WIN' : 'LOSS',
    barsHeld: exitIndex - entryIndex,
  };
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function generateHTML(
  candles: Candle[],
  sweeps: FreshSweep[],
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
  const avgRR = sweeps.length > 0
    ? (sweeps.reduce((sum, s) => sum + s.riskRewardRatio, 0) / sweeps.length).toFixed(2)
    : '0';

  // Quality breakdown
  const byQuality = {
    'A+': sweeps.filter((s) => s.quality === 'A+').length,
    A: sweeps.filter((s) => s.quality === 'A').length,
    B: sweeps.filter((s) => s.quality === 'B').length,
  };

  // Confirmation type breakdown
  const byConfirmation: Record<string, number> = {};
  for (const sweep of sweeps) {
    byConfirmation[sweep.confirmationType] = (byConfirmation[sweep.confirmationType] ?? 0) + 1;
  }

  // Create sweep markers (swept swing points)
  const swingMarkers = sweeps.map((sweep) => {
    const swingIdx = sweep.sweptSwing.index;
    if (swingIdx < 0 || swingIdx >= candles.length) return null;

    return {
      x: timestamps[swingIdx],
      y: sweep.sweptSwing.price,
      text: sweep.sweptSwing.type === 'high' ? '---HIGH---' : '---LOW---',
      showarrow: false,
      font: { size: 9, color: sweep.sweptSwing.type === 'high' ? '#ffcc00' : '#00ffcc' },
    };
  }).filter(Boolean);

  // Create trade annotations
  const tradeAnnotations = trades.flatMap((trade) => {
    const sweepIdx = trade.sweep.index;
    const entryIdx = trade.entryIndex;
    const exitIdx = trade.exitIndex;

    if (entryIdx < 0 || entryIdx >= candles.length) return [];
    if (exitIdx < 0 || exitIdx >= candles.length) return [];

    const isWin = trade.result === 'WIN';
    const color = isWin ? '#00ff00' : '#ff4444';
    const arrow = trade.sweep.direction === 'long' ? '▲' : '▼';

    const qualityColors: Record<string, string> = {
      'A+': '#ffd700',
      A: '#00ff00',
      B: '#00d4ff',
    };

    return [
      // Sweep marker
      {
        x: timestamps[sweepIdx],
        y: trade.sweep.direction === 'long' ? lows[sweepIdx]! * 0.9995 : highs[sweepIdx]! * 1.0005,
        text: `${arrow} ${trade.sweep.quality} ${trade.sweep.confirmationType}`,
        showarrow: true,
        arrowhead: 2,
        arrowcolor: qualityColors[trade.sweep.quality],
        ax: 0,
        ay: trade.sweep.direction === 'long' ? 40 : -40,
        font: { size: 11, color: 'white' },
        bgcolor: '#222',
        bordercolor: qualityColors[trade.sweep.quality],
      },
      // Exit marker
      {
        x: timestamps[exitIdx],
        y: trade.sweep.direction === 'long' ? highs[exitIdx]! * 1.0003 : lows[exitIdx]! * 0.9997,
        text: `${trade.exitReason} ${isWin ? '✅' : '❌'} $${trade.pnl.toFixed(2)}`,
        showarrow: true,
        arrowhead: 2,
        arrowcolor: color,
        ax: 0,
        ay: trade.sweep.direction === 'long' ? -30 : 30,
        font: { size: 10, color: 'white' },
        bgcolor: isWin ? '#004400' : '#440000',
        bordercolor: color,
      },
    ];
  });

  // TP/SL/Entry lines for each trade
  const tpslShapes = trades.flatMap((trade) => {
    const startIdx = trade.entryIndex;
    const endIdx = Math.min(trade.exitIndex + 3, candles.length - 1);

    return [
      // Entry line (white)
      {
        type: 'line',
        x0: timestamps[startIdx],
        x1: timestamps[endIdx],
        y0: trade.entryPrice,
        y1: trade.entryPrice,
        line: { color: '#ffffff', width: 1, dash: 'solid' },
      },
      // TP line (green)
      {
        type: 'line',
        x0: timestamps[startIdx],
        x1: timestamps[endIdx],
        y0: trade.sweep.takeProfit1,
        y1: trade.sweep.takeProfit1,
        line: { color: '#00ff00', width: 2, dash: 'dot' },
      },
      // SL line (red)
      {
        type: 'line',
        x0: timestamps[startIdx],
        x1: timestamps[endIdx],
        y0: trade.sweep.stopLoss,
        y1: trade.sweep.stopLoss,
        line: { color: '#ff4444', width: 2, dash: 'dot' },
      },
      // Swept level line (yellow)
      {
        type: 'line',
        x0: timestamps[trade.sweep.sweptSwing.index],
        x1: timestamps[startIdx],
        y0: trade.sweep.sweptSwing.price,
        y1: trade.sweep.sweptSwing.price,
        line: { color: '#ffcc00', width: 1, dash: 'dash' },
      },
    ];
  });

  // Trade path lines
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

  return `<!DOCTYPE html>
<html>
<head>
  <title>Fresh Sweeps Backtest - ${asset}</title>
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
    .trade-list { max-height: 300px; overflow-y: auto; }
    .trade-item { padding: 8px; margin: 5px 0; background: #0f0f23; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
    .win { border-left: 3px solid #00ff00; }
    .loss { border-left: 3px solid #ff4444; }
  </style>
</head>
<body>
  <h1>🎯 Fresh Sweeps Backtest - ${asset}</h1>
  <p style="color: #888; margin-bottom: 20px;">
    Detecting FRESH liquidity sweeps with immediate confirmation (pin bars, engulfing, rejections)
  </p>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-value">${candles.length.toLocaleString()}</div>
      <div class="stat-label">Candles</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ffcc00">${sweeps.length}</div>
      <div class="stat-label">Fresh Sweeps</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${trades.length}</div>
      <div class="stat-label">Trades</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #00ff00">${wins}</div>
      <div class="stat-label">Wins</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ff4444">${losses}</div>
      <div class="stat-label">Losses</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: ${parseFloat(winRate) >= 50 ? '#00ff00' : '#ff4444'}">${winRate}%</div>
      <div class="stat-label">Win Rate</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: ${netPnl >= 0 ? '#00ff00' : '#ff4444'}">$${netPnl.toFixed(2)}</div>
      <div class="stat-label">Net P&L</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${avgRR}</div>
      <div class="stat-label">Avg R:R</div>
    </div>
  </div>

  <div class="info-box">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">📊 Quality & Confirmation</h3>
    <div style="margin-bottom: 10px;">
      <span class="quality-badge quality-aplus">A+ ${byQuality['A+']}</span>
      <span class="quality-badge quality-a">A ${byQuality.A}</span>
      <span class="quality-badge quality-b">B ${byQuality.B}</span>
    </div>
    <div style="font-size: 13px; color: #888;">
      Confirmations: ${Object.entries(byConfirmation).map(([k, v]) => `${k}: ${v}`).join(', ')}
    </div>
  </div>

  <div class="chart-container">
    <div id="priceChart" style="height: 600px;"></div>
  </div>

  <div class="info-box">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">📝 Trade Details</h3>
    <div class="trade-list">
      ${trades.length === 0 ? '<p style="color: #666;">No trades executed</p>' : trades
        .map(
          (t) => `
        <div class="trade-item ${t.result.toLowerCase()}">
          <span>
            ${t.sweep.direction === 'long' ? '⬆️' : '⬇️'}
            <strong>${t.sweep.quality}</strong>
            ${t.sweep.confirmationType}
          </span>
          <span style="color: #888;">
            R:R ${t.sweep.riskRewardRatio.toFixed(2)} | ${t.barsHeld} bars
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
      title: 'Fresh Sweeps with Confirmation',
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
      annotations: ${JSON.stringify([...swingMarkers, ...tradeAnnotations])},
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
  console.log('║     FRESH SWEEP BACKTEST                                   ║');
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

  if (candles.length < 100) {
    console.log('❌ Not enough candles');
    return;
  }

  // Detect fresh sweeps using sliding window
  console.log('\n🔍 Detecting fresh sweeps...');
  const startTime = Date.now();

  // Best performing parameters so far: 35.6% win rate, $214 profit
  const detector = new FreshSweepDetector({
    swingLookback: 15, // Standard swing lookback
    minSwingStrength: 6, // Relaxed swing strength
    maxSweepAge: 2, // Within last 2 candles
    minSweepSize: 0.001, // 0.1% minimum sweep past level
    minWickRatio: 2.5, // Wick must be 2.5x the body for pin bars
    minRejectionPct: 0.6, // Must reject 60%+ of the sweep
    minRR: 2.0, // 2:1 R:R is optimal for this strategy
    requireDisplacement: true, // Require displacement for momentum
    minDisplacementPct: 0.4, // Body must be 40% of confirmation candle range
  });

  // Scan through all candles to find sweeps
  const allSweeps: FreshSweep[] = [];
  const windowSize = 200; // Analyze windows of 200 candles

  for (let i = windowSize; i < candles.length; i += 10) {
    const windowCandles = candles.slice(Math.max(0, i - windowSize), i + 1);
    const sweeps = detector.detect(windowCandles);

    // Adjust indices to global
    for (const sweep of sweeps) {
      const globalIndex = i - windowSize + sweep.index;
      // Check if we already have a sweep at this index
      const exists = allSweeps.some(
        (s) => Math.abs(s.index - globalIndex) < 5 && s.direction === sweep.direction
      );
      if (!exists) {
        sweep.index = globalIndex;
        sweep.sweptSwing.index = i - windowSize + sweep.sweptSwing.index;
        sweep.confirmationIndex = i - windowSize + sweep.confirmationIndex;
        allSweeps.push(sweep);
      }
    }
  }

  const detectTime = Date.now() - startTime;
  console.log(`   Detection time: ${detectTime}ms`);
  console.log(`   Total sweeps found: ${allSweeps.length}`);

  // Filter by quality
  const qualityOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2 };
  const minQualityLevel = qualityOrder[MIN_QUALITY] ?? 2;

  // Apply additional filters based on analysis:
  // R_100: SHORT works better (47.6% vs 28.9%), pin bar better, low R:R better
  // ETH: LONG works better (44.4% vs 25%), engulfing better, large sweeps 70% WR
  const USE_DIRECTION_FILTER = process.env.FILTER_DIRECTION !== 'false';
  const PREFER_SHORT = process.env.PREFER_SHORT !== 'false'; // false = prefer long
  const USE_CONFIRMATION_FILTER = process.env.FILTER_CONFIRMATION !== 'false';
  const MAX_RR = parseFloat(process.env.MAX_RR ?? '6.0');
  const MIN_SWEEP_SIZE = parseFloat(process.env.MIN_SWEEP_SIZE ?? '0'); // % sweep size filter

  const filteredSweeps = allSweeps.filter((s) => {
    // Quality filter
    if (qualityOrder[s.quality] > minQualityLevel) return false;

    // Direction filter
    if (USE_DIRECTION_FILTER) {
      if (PREFER_SHORT && s.direction === 'long') return false;
      if (!PREFER_SHORT && s.direction === 'short') return false;
    }

    // Confirmation filter
    const PREFER_ENGULFING = process.env.PREFER_ENGULFING === 'true';
    if (USE_CONFIRMATION_FILTER) {
      if (PREFER_ENGULFING && s.confirmationType !== 'engulfing') return false;
      if (!PREFER_ENGULFING && s.confirmationType !== 'pin_bar') return false;
    }

    // R:R filter
    if (s.riskRewardRatio > MAX_RR) return false;

    // Sweep size filter (for crypto, larger sweeps work better)
    if (s.sweepSize < MIN_SWEEP_SIZE) return false;

    return true;
  });

  console.log(`   After quality filter (>= ${MIN_QUALITY}): ${filteredSweeps.length}`);

  // Quality breakdown
  const byQuality = {
    'A+': allSweeps.filter((s) => s.quality === 'A+').length,
    A: allSweeps.filter((s) => s.quality === 'A').length,
    B: allSweeps.filter((s) => s.quality === 'B').length,
  };
  console.log(`   Quality: A+=${byQuality['A+']} A=${byQuality.A} B=${byQuality.B}`);

  // Simulate trades
  console.log('\n💹 Simulating trades...');
  const sortedSweeps = [...filteredSweeps].sort((a, b) => a.index - b.index);

  const trades: Trade[] = [];
  let lastExitIndex = 0;
  const cooldownBars = 10;

  for (const sweep of sortedSweeps) {
    // Cooldown check
    if (sweep.confirmationIndex < lastExitIndex + cooldownBars) continue;

    const trade = simulateTrade(sweep, candles, 50);
    if (trade) {
      trades.push(trade);
      lastExitIndex = trade.exitIndex;
    }
  }

  console.log(`   Trades executed: ${trades.length}`);

  // Generate HTML
  console.log('\n📝 Generating chart...');
  const html = generateHTML(candles, filteredSweeps, trades, ASSET);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `fresh-sweeps_${ASSET}_${timestamp}.html`;
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
  console.log(`Sweeps: ${filteredSweeps.length}`);
  console.log(`Trades: ${trades.length} (${wins}W / ${losses}L)`);
  console.log(`Win Rate: ${winRate}%`);
  console.log(`Net P&L: $${netPnl.toFixed(2)}`);

  // Detailed analysis of winning vs losing trades
  console.log('\n' + '─'.repeat(50));
  console.log('TRADE ANALYSIS');
  console.log('─'.repeat(50));

  const winningTrades = trades.filter((t) => t.result === 'WIN');
  const losingTrades = trades.filter((t) => t.result === 'LOSS');

  // Analyze by confirmation type
  const byConfirmation: Record<string, { wins: number; losses: number }> = {};
  for (const trade of trades) {
    const type = trade.sweep.confirmationType;
    if (!byConfirmation[type]) byConfirmation[type] = { wins: 0, losses: 0 };
    if (trade.result === 'WIN') byConfirmation[type]!.wins++;
    else byConfirmation[type]!.losses++;
  }
  console.log('\nBy Confirmation Type:');
  for (const [type, stats] of Object.entries(byConfirmation)) {
    const total = stats.wins + stats.losses;
    const wr = ((stats.wins / total) * 100).toFixed(1);
    console.log(`  ${type}: ${stats.wins}W/${stats.losses}L (${wr}% WR)`);
  }

  // Analyze by direction
  const byDirection: Record<string, { wins: number; losses: number }> = {};
  for (const trade of trades) {
    const dir = trade.sweep.direction;
    if (!byDirection[dir]) byDirection[dir] = { wins: 0, losses: 0 };
    if (trade.result === 'WIN') byDirection[dir]!.wins++;
    else byDirection[dir]!.losses++;
  }
  console.log('\nBy Direction:');
  for (const [dir, stats] of Object.entries(byDirection)) {
    const total = stats.wins + stats.losses;
    const wr = ((stats.wins / total) * 100).toFixed(1);
    console.log(`  ${dir}: ${stats.wins}W/${stats.losses}L (${wr}% WR)`);
  }

  // Analyze by sweep size (small vs large)
  const avgSweepSize = trades.reduce((s, t) => s + t.sweep.sweepSize, 0) / trades.length;
  const largeSweeps = trades.filter((t) => t.sweep.sweepSize >= avgSweepSize);
  const smallSweeps = trades.filter((t) => t.sweep.sweepSize < avgSweepSize);
  const largeWins = largeSweeps.filter((t) => t.result === 'WIN').length;
  const smallWins = smallSweeps.filter((t) => t.result === 'WIN').length;
  console.log('\nBy Sweep Size:');
  console.log(`  Large (>=${avgSweepSize.toFixed(3)}%): ${largeWins}W/${largeSweeps.length - largeWins}L (${((largeWins / largeSweeps.length) * 100).toFixed(1)}% WR)`);
  console.log(`  Small (<${avgSweepSize.toFixed(3)}%): ${smallWins}W/${smallSweeps.length - smallWins}L (${((smallWins / smallSweeps.length) * 100).toFixed(1)}% WR)`);

  // Analyze by R:R ratio
  const avgRR = trades.reduce((s, t) => s + t.sweep.riskRewardRatio, 0) / trades.length;
  const highRR = trades.filter((t) => t.sweep.riskRewardRatio >= avgRR);
  const lowRR = trades.filter((t) => t.sweep.riskRewardRatio < avgRR);
  const highRRWins = highRR.filter((t) => t.result === 'WIN').length;
  const lowRRWins = lowRR.filter((t) => t.result === 'WIN').length;
  console.log('\nBy R:R Ratio:');
  console.log(`  High (>=${avgRR.toFixed(2)}): ${highRRWins}W/${highRR.length - highRRWins}L (${((highRRWins / highRR.length) * 100).toFixed(1)}% WR)`);
  console.log(`  Low (<${avgRR.toFixed(2)}): ${lowRRWins}W/${lowRR.length - lowRRWins}L (${((lowRRWins / lowRR.length) * 100).toFixed(1)}% WR)`);

  // Analyze by swing strength
  const avgStrength = trades.reduce((s, t) => s + t.sweep.sweptSwing.strength, 0) / trades.length;
  const strongSwings = trades.filter((t) => t.sweep.sweptSwing.strength >= avgStrength);
  const weakSwings = trades.filter((t) => t.sweep.sweptSwing.strength < avgStrength);
  const strongWins = strongSwings.filter((t) => t.result === 'WIN').length;
  const weakWins = weakSwings.filter((t) => t.result === 'WIN').length;
  console.log('\nBy Swing Strength:');
  console.log(`  Strong (>=${avgStrength.toFixed(1)}): ${strongWins}W/${strongSwings.length - strongWins}L (${strongSwings.length > 0 ? ((strongWins / strongSwings.length) * 100).toFixed(1) : 0}% WR)`);
  console.log(`  Weak (<${avgStrength.toFixed(1)}): ${weakWins}W/${weakSwings.length - weakWins}L (${weakSwings.length > 0 ? ((weakWins / weakSwings.length) * 100).toFixed(1) : 0}% WR)`);

  // Analyze bars held
  const avgBarsWin = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.barsHeld, 0) / winningTrades.length : 0;
  const avgBarsLoss = losingTrades.length > 0 ? losingTrades.reduce((s, t) => s + t.barsHeld, 0) / losingTrades.length : 0;
  console.log('\nTrade Duration:');
  console.log(`  Avg bars to WIN: ${avgBarsWin.toFixed(1)}`);
  console.log(`  Avg bars to LOSS: ${avgBarsLoss.toFixed(1)}`);

  // Open chart
  console.log('\n🌐 Opening chart...');
  const { exec } = await import('child_process');
  exec(`open "${filepath}"`);
}

main().catch(console.error);
