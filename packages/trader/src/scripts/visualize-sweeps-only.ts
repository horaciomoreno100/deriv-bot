#!/usr/bin/env npx tsx
/**
 * Visualize SWEEPS ONLY
 *
 * Enfoque simple: Solo mostrar barridos de liquidez (Liquidity Sweeps)
 * Es el patrón más limpio de Smart Money:
 * - Precio rompe un nivel (barre stop losses)
 * - Precio vuelve inmediatamente (trampa completada)
 * - Ahora sí va en la dirección real
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV } from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'frxEURUSD';
const DATA_FILE = process.env.DATA_FILE ?? 'data/frxEURUSD_1m_365d.csv';
const LOOKBACK = parseInt(process.env.LOOKBACK ?? '1440', 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'analysis-output';

// Swing detection parameters
const SWING_LOOKBACK = parseInt(process.env.SWING_LOOKBACK ?? '10', 10);

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: number;
}

interface Sweep {
  index: number;
  timestamp: number;
  entryPrice: number;
  direction: 'long' | 'short';
  swingPoint: SwingPoint;
  sweepDistance: number; // How far past the swing it went
  outcome?: {
    maxFavorable: number;
    maxAdverse: number;
    result: 'win' | 'loss' | 'pending';
  };
}

/**
 * Find swing highs and lows
 */
function findSwingPoints(candles: Candle[], lookback: number): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i]!;
    let isSwingHigh = true;
    let isSwingLow = true;

    // Check if it's higher/lower than surrounding candles
    for (let j = 1; j <= lookback; j++) {
      const before = candles[i - j]!;
      const after = candles[i + j]!;

      if (current.high <= before.high || current.high <= after.high) {
        isSwingHigh = false;
      }
      if (current.low >= before.low || current.low >= after.low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swings.push({
        index: i,
        price: current.high,
        type: 'high',
        timestamp: current.timestamp,
      });
    }
    if (isSwingLow) {
      swings.push({
        index: i,
        price: current.low,
        type: 'low',
        timestamp: current.timestamp,
      });
    }
  }

  return swings;
}

/**
 * Find liquidity sweeps
 * A sweep happens when price breaks past a swing point and then reverses
 */
function findSweeps(candles: Candle[], swings: SwingPoint[]): Sweep[] {
  const sweeps: Sweep[] = [];
  const usedSwings = new Set<number>();

  for (let i = 2; i < candles.length - 30; i++) {
    const current = candles[i]!;
    const prev = candles[i - 1]!;

    // Look for recent swing points (within last 100 candles)
    for (const swing of swings) {
      if (usedSwings.has(swing.index)) continue;
      if (swing.index >= i - 5) continue; // Swing must be at least 5 candles old
      if (swing.index < i - 100) continue; // Not too old

      // BULLISH SWEEP: Price swept below a swing low and reversed up
      if (swing.type === 'low') {
        const brokeBelow = prev.low < swing.price;
        const closedAbove = current.close > swing.price;
        const bullishCandle = current.close > current.open;
        const strongBody = Math.abs(current.close - current.open) > (current.high - current.low) * 0.4;

        if (brokeBelow && closedAbove && bullishCandle && strongBody) {
          usedSwings.add(swing.index);
          sweeps.push({
            index: i,
            timestamp: current.timestamp,
            entryPrice: current.close,
            direction: 'long',
            swingPoint: swing,
            sweepDistance: swing.price - prev.low,
            outcome: calculateOutcome(candles, i, 'long', current.close, 30),
          });
          break;
        }
      }

      // BEARISH SWEEP: Price swept above a swing high and reversed down
      if (swing.type === 'high') {
        const brokeAbove = prev.high > swing.price;
        const closedBelow = current.close < swing.price;
        const bearishCandle = current.close < current.open;
        const strongBody = Math.abs(current.close - current.open) > (current.high - current.low) * 0.4;

        if (brokeAbove && closedBelow && bearishCandle && strongBody) {
          usedSwings.add(swing.index);
          sweeps.push({
            index: i,
            timestamp: current.timestamp,
            entryPrice: current.close,
            direction: 'short',
            swingPoint: swing,
            sweepDistance: prev.high - swing.price,
            outcome: calculateOutcome(candles, i, 'short', current.close, 30),
          });
          break;
        }
      }
    }
  }

  return sweeps;
}

/**
 * Calculate outcome
 */
function calculateOutcome(
  candles: Candle[],
  signalIndex: number,
  direction: 'long' | 'short',
  entryPrice: number,
  lookAhead: number
): Sweep['outcome'] {
  let maxFavorable = 0;
  let maxAdverse = 0;

  for (let i = 1; i <= lookAhead && signalIndex + i < candles.length; i++) {
    const c = candles[signalIndex + i]!;

    if (direction === 'long') {
      maxFavorable = Math.max(maxFavorable, c.high - entryPrice);
      maxAdverse = Math.max(maxAdverse, entryPrice - c.low);
    } else {
      maxFavorable = Math.max(maxFavorable, entryPrice - c.low);
      maxAdverse = Math.max(maxAdverse, c.high - entryPrice);
    }
  }

  // Win if favorable >= 1.5x adverse
  const result = maxFavorable >= maxAdverse * 1.5 ? 'win' :
                 maxAdverse > maxFavorable ? 'loss' : 'pending';

  return { maxFavorable, maxAdverse, result };
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function filterContinuousCandles(allCandles: Candle[], maxCandles: number): Candle[] {
  if (allCandles.length === 0) return [];

  const result: Candle[] = [];
  let prevTimestamp = allCandles[allCandles.length - 1]!.timestamp;

  for (let i = allCandles.length - 1; i >= 0 && result.length < maxCandles; i--) {
    const candle = allCandles[i]!;
    const gap = prevTimestamp - candle.timestamp;

    if (gap > 120 && result.length > 0) {
      break;
    }

    result.unshift(candle);
    prevTimestamp = candle.timestamp;
  }

  return result;
}

function generateHTML(
  candles: Candle[],
  swings: SwingPoint[],
  sweeps: Sweep[],
  asset: string
): string {
  const timestamps = candles.map((c) => formatTimestamp(c.timestamp));
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  // Swing point markers
  const swingHighs = swings.filter(s => s.type === 'high');
  const swingLows = swings.filter(s => s.type === 'low');

  // Stats
  const wins = sweeps.filter(s => s.outcome?.result === 'win').length;
  const losses = sweeps.filter(s => s.outcome?.result === 'loss').length;
  const winRate = sweeps.length > 0 ? ((wins / sweeps.length) * 100).toFixed(1) : '0';
  const longSweeps = sweeps.filter(s => s.direction === 'long').length;
  const shortSweeps = sweeps.filter(s => s.direction === 'short').length;

  // Create sweep annotations
  const sweepAnnotations = sweeps.map((sweep) => {
    const idx = sweep.index;
    const arrow = sweep.direction === 'long' ? '⬆️' : '⬇️';
    const outcomeEmoji = sweep.outcome?.result === 'win' ? '✅' :
                         sweep.outcome?.result === 'loss' ? '❌' : '⏳';
    const label = `${arrow} SWEEP ${outcomeEmoji}`;

    let bgcolor: string;
    if (sweep.outcome?.result === 'win') {
      bgcolor = '#00cc00';
    } else if (sweep.outcome?.result === 'loss') {
      bgcolor = '#cc0000';
    } else {
      bgcolor = '#666666';
    }

    return {
      x: timestamps[idx],
      y: sweep.direction === 'long' ? lows[idx]! * 0.9998 : highs[idx]! * 1.0002,
      text: label,
      showarrow: true,
      arrowhead: 2,
      ax: 0,
      ay: sweep.direction === 'long' ? 35 : -35,
      font: { size: 11, color: 'white' },
      bgcolor,
      bordercolor: sweep.outcome?.result === 'win' ? '#00ff00' :
                   sweep.outcome?.result === 'loss' ? '#ff0000' : 'white',
    };
  });

  // Lines connecting sweep to swing point
  const sweepLines = sweeps.map((sweep) => {
    const swingIdx = sweep.swingPoint.index;
    const sweepIdx = sweep.index;
    return {
      type: 'line',
      x0: timestamps[swingIdx],
      x1: timestamps[sweepIdx],
      y0: sweep.swingPoint.price,
      y1: sweep.swingPoint.price,
      line: {
        color: sweep.direction === 'long' ? '#00ff00' : '#ff0000',
        width: 1,
        dash: 'dot',
      },
    };
  });

  return `<!DOCTYPE html>
<html>
<head>
  <title>Liquidity Sweeps - ${asset}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d4ff; margin-bottom: 10px; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-box { background: #16213e; padding: 15px 25px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .stat-label { font-size: 12px; color: #888; margin-top: 5px; }
    .chart-container { background: #0f0f23; border-radius: 8px; padding: 10px; margin-bottom: 20px; }
    .info-box { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>🎯 Liquidity Sweeps - ${asset}</h1>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-value">${candles.length}</div>
      <div class="stat-label">Candles</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${swings.length}</div>
      <div class="stat-label">Swing Points</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ffcc00">${sweeps.length}</div>
      <div class="stat-label">Sweeps Found</div>
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
      <div class="stat-value" style="color: #00ff00">${longSweeps}</div>
      <div class="stat-label">⬆️ LONG</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ff4444">${shortSweeps}</div>
      <div class="stat-label">⬇️ SHORT</div>
    </div>
  </div>

  <div class="info-box">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">🎯 ¿Qué es un Liquidity Sweep?</h3>
    <p style="margin: 5px 0; font-size: 14px;">
      <strong>SWEEP</strong> = El precio rompe un swing high/low (barre stop losses) y luego vuelve inmediatamente.
    </p>
    <p style="margin: 5px 0; font-size: 14px;">
      Es una "trampa" de Smart Money: primero sacan a los traders en la dirección equivocada,
      luego el precio va en la dirección real.
    </p>
    <p style="margin: 10px 0 0 0; font-size: 13px; color: #888;">
      Los puntos amarillos son swing highs, los puntos verdes son swing lows.
      Las líneas punteadas conectan el swing con el sweep.
    </p>
  </div>

  <div class="chart-container">
    <div id="priceChart" style="height: 600px;"></div>
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

    // Swing highs
    const swingHighMarkers = {
      x: ${JSON.stringify(swingHighs.map(s => timestamps[s.index]))},
      y: ${JSON.stringify(swingHighs.map(s => s.price))},
      mode: 'markers',
      type: 'scatter',
      name: 'Swing High',
      marker: { color: '#ffcc00', size: 8, symbol: 'triangle-down' },
    };

    // Swing lows
    const swingLowMarkers = {
      x: ${JSON.stringify(swingLows.map(s => timestamps[s.index]))},
      y: ${JSON.stringify(swingLows.map(s => s.price))},
      mode: 'markers',
      type: 'scatter',
      name: 'Swing Low',
      marker: { color: '#00ffcc', size: 8, symbol: 'triangle-up' },
    };

    const layout = {
      title: 'Liquidity Sweeps',
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
      shapes: ${JSON.stringify(sweepLines)},
      annotations: ${JSON.stringify(sweepAnnotations)},
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: true,
      legend: { x: 0, y: 1.1, orientation: 'h' },
      margin: { t: 50, b: 50, l: 50, r: 80 },
    };

    Plotly.newPlot('priceChart', [candlestick, swingHighMarkers, swingLowMarkers], layout, {
      responsive: true,
      scrollZoom: true,
    });
  </script>
</body>
</html>`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           Liquidity Sweeps Visualization');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Load data
  const dataPath = path.join(process.cwd(), DATA_FILE);
  console.log(`📂 Loading from: ${DATA_FILE}`);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
  });

  console.log(`   ✅ Loaded ${allCandles.length} candles`);

  const candles = filterContinuousCandles(allCandles, LOOKBACK);
  console.log(`   📊 Using ${candles.length} continuous candles`);

  if (candles.length > 0) {
    const startTime = new Date(candles[0]!.timestamp * 1000).toISOString();
    const endTime = new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString();
    console.log(`   📅 Range: ${startTime.slice(0, 16)} to ${endTime.slice(0, 16)}`);
  }

  // Find swing points
  console.log(`\n🔍 Finding swing points (lookback=${SWING_LOOKBACK})...`);
  const swings = findSwingPoints(candles, SWING_LOOKBACK);
  console.log(`   ✅ Found ${swings.length} swing points`);
  console.log(`      - ${swings.filter(s => s.type === 'high').length} swing highs`);
  console.log(`      - ${swings.filter(s => s.type === 'low').length} swing lows`);

  // Find sweeps
  console.log('\n🎯 Finding liquidity sweeps...');
  const sweeps = findSweeps(candles, swings);
  console.log(`   ✅ Found ${sweeps.length} sweeps`);

  const wins = sweeps.filter(s => s.outcome?.result === 'win').length;
  const losses = sweeps.filter(s => s.outcome?.result === 'loss').length;
  const winRate = sweeps.length > 0 ? ((wins / sweeps.length) * 100).toFixed(1) : '0';
  console.log(`   📊 Win Rate: ${winRate}% (${wins}W / ${losses}L)`);

  // Generate HTML
  console.log('\n📝 Generating chart...');
  const html = generateHTML(candles, swings, sweeps, ASSET);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `sweeps-only_${ASSET}_${timestamp}.html`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, html);
  console.log(`\n✅ Chart saved to: ${filepath}`);
}

main().catch(console.error);
