#!/usr/bin/env npx tsx
/**
 * Visualize Confluence Signals
 *
 * Creates an interactive chart showing:
 * - Candlesticks
 * - MTF S/R Zones
 * - RSI Divergences (marked on chart)
 * - Rejection Candles (highlighted)
 * - Liquidity Sweeps (marked)
 * - Session backgrounds
 *
 * Usage:
 *   ASSET="frxEURUSD" DATA_FILE="data/frxEURUSD_1m_365d.csv" LOOKBACK=500 npx tsx src/scripts/visualize-confluence-signals.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { MTFMarketStructureAnalyzer, type MTFZone } from '../analysis/mtf-market-structure.js';
import { RSIDivergenceDetector, type RSIDivergence } from '../analysis/rsi-divergence-detector.js';
import { SessionFilterService, type TradingSession } from '../services/session-filter.service.js';
import { calculateRSI } from '../indicators/index.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'frxEURUSD';
const DATA_FILE = process.env.DATA_FILE ?? 'data/frxEURUSD_1m_365d.csv';
const LOOKBACK = parseInt(process.env.LOOKBACK ?? '500', 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'analysis-output';
const MIN_CONFLUENCE = parseInt(process.env.MIN_CONFLUENCE ?? '2', 10); // Minimum factors for high quality signal

interface ChartAnnotation {
  x: string;
  y: number;
  text: string;
  showarrow: boolean;
  arrowhead?: number;
  ax?: number;
  ay?: number;
  font?: { size: number; color: string };
  bgcolor?: string;
  bordercolor?: string;
}

interface ChartShape {
  type: string;
  x0: string;
  x1: string;
  y0: number;
  y1: number;
  fillcolor: string;
  opacity: number;
  line: { width: number; color?: string };
  layer?: string;
  xref?: string;
  yref?: string;
}

/**
 * High quality signal with confluence
 */
interface ConfluenceSignal {
  index: number;
  timestamp: number;
  price: number;
  direction: 'long' | 'short';
  zone: MTFZone;
  factors: string[];
  confluenceCount: number;
  hasDivergence: boolean;
  hasRejection: boolean;
  hasSweep: boolean;
  hasConfirmation: boolean;
  // Track outcome for learning
  outcome?: {
    maxFavorable: number; // Max move in our direction (pips)
    maxAdverse: number;   // Max move against us (pips)
    result: 'win' | 'loss' | 'pending';
  };
}

/**
 * Detect rejection candles
 */
function findRejectionCandles(
  candles: Candle[],
  zones: MTFZone[]
): { index: number; direction: 'bullish' | 'bearish'; zone: MTFZone }[] {
  const rejections: { index: number; direction: 'bullish' | 'bearish'; zone: MTFZone }[] = [];

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]!;
    const range = candle.high - candle.low;
    if (range === 0) continue;

    const body = Math.abs(candle.close - candle.open);
    const bodyRatio = body / range;

    // Check each zone
    for (const zone of zones) {
      if (zone.broken) continue;

      // Bullish rejection at support
      if (zone.type === 'support') {
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        const wickRatio = lowerWick / range;

        if (
          wickRatio > 0.5 &&
          bodyRatio < 0.4 &&
          candle.low <= zone.priceHigh * 1.001 &&
          candle.low >= zone.priceLow * 0.999 &&
          candle.close > candle.open
        ) {
          rejections.push({ index: i, direction: 'bullish', zone });
          break;
        }
      }

      // Bearish rejection at resistance
      if (zone.type === 'resistance') {
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const wickRatio = upperWick / range;

        if (
          wickRatio > 0.5 &&
          bodyRatio < 0.4 &&
          candle.high >= zone.priceLow * 0.999 &&
          candle.high <= zone.priceHigh * 1.001 &&
          candle.close < candle.open
        ) {
          rejections.push({ index: i, direction: 'bearish', zone });
          break;
        }
      }
    }
  }

  return rejections;
}

/**
 * Detect liquidity sweeps
 */
function findSweeps(
  candles: Candle[],
  zones: MTFZone[]
): { index: number; direction: 'bullish' | 'bearish'; zone: MTFZone }[] {
  const sweeps: { index: number; direction: 'bullish' | 'bearish'; zone: MTFZone }[] = [];

  for (let i = 2; i < candles.length; i++) {
    const current = candles[i]!;
    const prev = candles[i - 1]!;

    for (const zone of zones) {
      if (zone.broken) continue;

      // Bullish sweep (SSL): prev broke below support, current closed back above
      if (zone.type === 'support') {
        const brokeBelow = prev.low < zone.priceLow;
        const closedAbove = current.close > zone.priceLow;
        const bullishClose = current.close > current.open;

        if (brokeBelow && closedAbove && bullishClose) {
          sweeps.push({ index: i, direction: 'bullish', zone });
          break;
        }
      }

      // Bearish sweep (BSL): prev broke above resistance, current closed back below
      if (zone.type === 'resistance') {
        const brokeAbove = prev.high > zone.priceHigh;
        const closedBelow = current.close < zone.priceHigh;
        const bearishClose = current.close < current.open;

        if (brokeAbove && closedBelow && bearishClose) {
          sweeps.push({ index: i, direction: 'bearish', zone });
          break;
        }
      }
    }
  }

  return sweeps;
}

/**
 * Check if next candles confirm the direction
 * Confirmation = at least 1 of the next 3 candles closes in the expected direction
 * with momentum (body > 50% of range)
 */
function hasConfirmation(
  candles: Candle[],
  signalIndex: number,
  direction: 'long' | 'short',
  lookAhead: number = 3
): { confirmed: boolean; confirmIndex: number } {
  for (let i = 1; i <= lookAhead && signalIndex + i < candles.length; i++) {
    const c = candles[signalIndex + i]!;
    const range = c.high - c.low;
    if (range === 0) continue;

    const body = Math.abs(c.close - c.open);
    const bodyRatio = body / range;

    if (direction === 'long') {
      // Bullish confirmation: green candle with strong body
      if (c.close > c.open && bodyRatio > 0.5) {
        return { confirmed: true, confirmIndex: signalIndex + i };
      }
    } else {
      // Bearish confirmation: red candle with strong body
      if (c.close < c.open && bodyRatio > 0.5) {
        return { confirmed: true, confirmIndex: signalIndex + i };
      }
    }
  }
  return { confirmed: false, confirmIndex: -1 };
}

/**
 * Calculate outcome of a signal
 * Track max favorable/adverse excursion over next N candles
 */
function calculateOutcome(
  candles: Candle[],
  signalIndex: number,
  direction: 'long' | 'short',
  entryPrice: number,
  lookAhead: number = 30
): ConfluenceSignal['outcome'] {
  let maxFavorable = 0;
  let maxAdverse = 0;

  for (let i = 1; i <= lookAhead && signalIndex + i < candles.length; i++) {
    const c = candles[signalIndex + i]!;

    if (direction === 'long') {
      const favorable = c.high - entryPrice;
      const adverse = entryPrice - c.low;
      maxFavorable = Math.max(maxFavorable, favorable);
      maxAdverse = Math.max(maxAdverse, adverse);
    } else {
      const favorable = entryPrice - c.low;
      const adverse = c.high - entryPrice;
      maxFavorable = Math.max(maxFavorable, favorable);
      maxAdverse = Math.max(maxAdverse, adverse);
    }
  }

  // Simple win/loss based on 1.5 RR: if max favorable >= 1.5 * max adverse early = win
  const result = maxFavorable >= maxAdverse * 1.5 ? 'win' :
                 maxAdverse > maxFavorable ? 'loss' : 'pending';

  return { maxFavorable, maxAdverse, result };
}

/**
 * Find HIGH QUALITY signals where multiple factors align
 * NEW: Requires CONFIRMATION - signal only valid when next candle(s) confirm direction
 */
function findConfluenceSignals(
  candles: Candle[],
  zones: MTFZone[],
  divergences: RSIDivergence[],
  minConfluence: number,
  requireConfirmation: boolean = true
): ConfluenceSignal[] {
  const signals: ConfluenceSignal[] = [];
  const usedIndices = new Set<number>(); // Prevent duplicate signals

  for (let i = 3; i < candles.length - 3; i++) { // Leave room for confirmation
    if (usedIndices.has(i)) continue;

    const candle = candles[i]!;
    const price = candle.close;

    // Find if price is at a zone
    for (const zone of zones) {
      if (zone.broken) continue;

      const atSupport = zone.type === 'support' &&
        candle.low <= zone.priceHigh * 1.001 &&
        candle.low >= zone.priceLow * 0.998;

      const atResistance = zone.type === 'resistance' &&
        candle.high >= zone.priceLow * 0.999 &&
        candle.high <= zone.priceHigh * 1.002;

      if (!atSupport && !atResistance) continue;

      const direction: 'long' | 'short' = zone.type === 'support' ? 'long' : 'short';
      const factors: string[] = ['ZONE'];

      // Check for divergence at this candle
      const hasDivergenceFlag = divergences.some(d =>
        Math.abs(d.pricePoint2.index - i) <= 3 &&
        ((direction === 'long' && d.expectedDirection === 'up') ||
         (direction === 'short' && d.expectedDirection === 'down'))
      );
      if (hasDivergenceFlag) factors.push('DIV');

      // Check for rejection candle
      const range = candle.high - candle.low;
      let hasRejectionFlag = false;
      if (range > 0) {
        const body = Math.abs(candle.close - candle.open);
        const bodyRatio = body / range;

        if (direction === 'long') {
          const lowerWick = Math.min(candle.open, candle.close) - candle.low;
          if (lowerWick / range > 0.5 && bodyRatio < 0.4 && candle.close > candle.open) {
            factors.push('REJ');
            hasRejectionFlag = true;
          }
        } else {
          const upperWick = candle.high - Math.max(candle.open, candle.close);
          if (upperWick / range > 0.5 && bodyRatio < 0.4 && candle.close < candle.open) {
            factors.push('REJ');
            hasRejectionFlag = true;
          }
        }
      }

      // Check for sweep
      const prev = candles[i - 1]!;
      let hasSweepFlag = false;
      if (direction === 'long') {
        if (prev.low < zone.priceLow && candle.close > zone.priceLow && candle.close > candle.open) {
          factors.push('SWEEP');
          hasSweepFlag = true;
        }
      } else {
        if (prev.high > zone.priceHigh && candle.close < zone.priceHigh && candle.close < candle.open) {
          factors.push('SWEEP');
          hasSweepFlag = true;
        }
      }

      // Check for confirmation (next candle(s) moving in expected direction)
      const confirmation = hasConfirmation(candles, i, direction, 3);
      const hasConfirmationFlag = confirmation.confirmed;

      // If requiring confirmation but don't have it, skip
      if (requireConfirmation && !hasConfirmationFlag) continue;

      if (hasConfirmationFlag) {
        factors.push('CONF');
      }

      // Only add if meets minimum confluence
      if (factors.length >= minConfluence) {
        // Use confirmation candle index if confirmed, otherwise signal index
        const entryIndex = hasConfirmationFlag ? confirmation.confirmIndex : i;
        const entryCandle = candles[entryIndex]!;
        const entryPrice = entryCandle.close;

        // Mark surrounding indices as used to avoid duplicate signals
        for (let j = i - 1; j <= entryIndex + 1; j++) {
          usedIndices.add(j);
        }

        signals.push({
          index: entryIndex,
          timestamp: entryCandle.timestamp,
          price: entryPrice,
          direction,
          zone,
          factors,
          confluenceCount: factors.length,
          hasDivergence: hasDivergenceFlag,
          hasRejection: hasRejectionFlag,
          hasSweep: hasSweepFlag,
          hasConfirmation: hasConfirmationFlag,
          outcome: calculateOutcome(candles, entryIndex, direction, entryPrice, 30),
        });
        break; // One signal per candle
      }
    }
  }

  return signals;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function generateHTML(
  candles: Candle[],
  zones: MTFZone[],
  divergences: RSIDivergence[],
  confluenceSignals: ConfluenceSignal[],
  rsiValues: number[],
  asset: string
): string {
  const timestamps = candles.map((c) => formatTimestamp(c.timestamp));
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  // RSI offset
  const rsiOffset = candles.length - rsiValues.length;

  // Create zone shapes
  const zoneShapes: ChartShape[] = zones
    .filter((z) => !z.broken)
    .map((zone) => {
      const color = zone.type === 'support' ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 0, 0, 0.15)';
      const borderColor = zone.type === 'support' ? 'green' : 'red';
      const tfLabel = zone.tfLabel || '1M';
      const opacity = tfLabel === '15M' ? 0.3 : tfLabel === '5M' ? 0.2 : 0.1;

      return {
        type: 'rect',
        x0: timestamps[0]!,
        x1: timestamps[timestamps.length - 1]!,
        y0: zone.priceLow,
        y1: zone.priceHigh,
        fillcolor: color,
        opacity,
        line: { width: 1, color: borderColor },
        layer: 'below',
      };
    });

  // Create annotations ONLY for confirmed confluence signals
  const signalAnnotations: ChartAnnotation[] = confluenceSignals.map((sig) => {
    const idx = sig.index;
    const arrow = sig.direction === 'long' ? '⬆️' : '⬇️';
    const factors = sig.factors.join('+');

    // Show outcome
    const outcomeEmoji = sig.outcome?.result === 'win' ? '✅' :
                         sig.outcome?.result === 'loss' ? '❌' : '⏳';
    const label = `${arrow} ${factors} ${outcomeEmoji}`;

    // Color based on outcome
    let bgcolor: string;
    if (sig.outcome?.result === 'win') {
      bgcolor = '#00cc00'; // Green for win
    } else if (sig.outcome?.result === 'loss') {
      bgcolor = '#cc0000'; // Red for loss
    } else {
      bgcolor = sig.direction === 'long' ? '#006600' : '#660000'; // Darker for pending
    }

    return {
      x: timestamps[idx]!,
      y: sig.direction === 'long' ? lows[idx]! * 0.9995 : highs[idx]! * 1.0005,
      text: label,
      showarrow: true,
      arrowhead: 2,
      ax: 0,
      ay: sig.direction === 'long' ? 40 : -40,
      font: { size: 11, color: 'white' },
      bgcolor,
      bordercolor: sig.outcome?.result === 'win' ? '#00ff00' :
                   sig.outcome?.result === 'loss' ? '#ff0000' : 'white',
    };
  });

  // RSI data aligned with candles
  const rsiTimestamps = timestamps.slice(rsiOffset);
  const rsiData = rsiValues;

  // Mark divergence points on RSI
  const rsiDivMarkers = divergences.map((div) => {
    const idx1 = div.rsiPoint1.index - rsiOffset;
    const idx2 = div.rsiPoint2.index - rsiOffset;
    return {
      x: [rsiTimestamps[idx1], rsiTimestamps[idx2]],
      y: [div.rsiPoint1.value, div.rsiPoint2.value],
      mode: 'lines+markers',
      line: {
        color: div.type.includes('bullish') ? 'lime' : 'red',
        width: 2,
        dash: 'dash',
      },
      marker: { size: 8 },
      name: `${div.type} div`,
    };
  });

  // Stats
  const longSignals = confluenceSignals.filter(s => s.direction === 'long');
  const shortSignals = confluenceSignals.filter(s => s.direction === 'short');
  const highQualitySignals = confluenceSignals.filter(s => s.confluenceCount >= 4); // 4 factors now (ZONE+X+CONF)
  const winningSignals = confluenceSignals.filter(s => s.outcome?.result === 'win');
  const losingSignals = confluenceSignals.filter(s => s.outcome?.result === 'loss');

  const stats = {
    totalCandles: candles.length,
    zones: zones.filter((z) => !z.broken).length,
    totalSignals: confluenceSignals.length,
    highQuality: highQualitySignals.length,
    longSignals: longSignals.length,
    shortSignals: shortSignals.length,
    withDivergence: confluenceSignals.filter(s => s.hasDivergence).length,
    withRejection: confluenceSignals.filter(s => s.hasRejection).length,
    withSweep: confluenceSignals.filter(s => s.hasSweep).length,
    withConfirmation: confluenceSignals.filter(s => s.hasConfirmation).length,
    wins: winningSignals.length,
    losses: losingSignals.length,
    winRate: confluenceSignals.length > 0
      ? ((winningSignals.length / confluenceSignals.length) * 100).toFixed(1)
      : '0',
  };

  return `<!DOCTYPE html>
<html>
<head>
  <title>Confluence Signals - ${asset}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d4ff; margin-bottom: 10px; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-box { background: #16213e; padding: 15px 25px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .stat-label { font-size: 12px; color: #888; margin-top: 5px; }
    .chart-container { background: #0f0f23; border-radius: 8px; padding: 10px; margin-bottom: 20px; }
    .legend { display: flex; gap: 15px; margin: 20px 0; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .legend-color { width: 20px; height: 20px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>📊 Confluence Signals - ${asset}</h1>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-value">${stats.totalCandles}</div>
      <div class="stat-label">Candles</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${stats.zones}</div>
      <div class="stat-label">Active Zones</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ffcc00">${stats.totalSignals}</div>
      <div class="stat-label">Confirmed Signals</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #00ff00">${stats.wins}</div>
      <div class="stat-label">✅ Wins</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ff4444">${stats.losses}</div>
      <div class="stat-label">❌ Losses</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: ${parseFloat(stats.winRate) >= 50 ? '#00ff00' : '#ff4444'}">${stats.winRate}%</div>
      <div class="stat-label">Win Rate</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #00ff00">${stats.longSignals}</div>
      <div class="stat-label">⬆️ LONG</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ff4444">${stats.shortSignals}</div>
      <div class="stat-label">⬇️ SHORT</div>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background: rgba(0,255,0,0.3)"></div> Support Zone</div>
    <div class="legend-item"><div class="legend-color" style="background: rgba(255,0,0,0.3)"></div> Resistance Zone</div>
    <div class="legend-item"><div class="legend-color" style="background: #00ff00"></div> ⬆️ LONG (confirmed)</div>
    <div class="legend-item"><div class="legend-color" style="background: #ff0000"></div> ⬇️ SHORT (confirmed)</div>
  </div>

  <div style="background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">📖 Cómo leer las señales</h3>
    <p style="margin: 5px 0; font-size: 14px;"><strong>ZONE</strong> = Precio está en zona de soporte/resistencia</p>
    <p style="margin: 5px 0; font-size: 14px;"><strong>DIV</strong> = Divergencia RSI (momentum vs precio)</p>
    <p style="margin: 5px 0; font-size: 14px;"><strong>REJ</strong> = Vela de rechazo (mecha larga = rechazo del nivel)</p>
    <p style="margin: 5px 0; font-size: 14px;"><strong>SWEEP</strong> = Barrido de liquidez (rompió zona y volvió)</p>
    <p style="margin: 5px 0; font-size: 14px;"><strong style="color: #00ffcc;">CONF</strong> = <strong>CONFIRMACIÓN</strong> - La siguiente vela confirma el movimiento</p>
    <p style="margin: 10px 0 0 0; font-size: 13px; color: #888;">
      <strong>IMPORTANTE:</strong> Ahora las señales solo aparecen cuando hay CONFIRMACIÓN real del movimiento.
      Esto evita entradas prematuras donde el precio aún no empezó a moverse.
    </p>
  </div>

  <div class="chart-container">
    <div id="priceChart" style="height: 500px;"></div>
  </div>

  <div class="chart-container">
    <div id="rsiChart" style="height: 200px;"></div>
  </div>

  <script>
    // Price chart
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

    const priceLayout = {
      title: 'Price with Confluence Signals',
      xaxis: {
        rangeslider: { visible: false },
        color: '#888',
        autorange: true,
      },
      yaxis: {
        title: 'Price',
        color: '#888',
        side: 'right',
        autorange: true,
        fixedrange: false,
      },
      shapes: ${JSON.stringify(zoneShapes)},
      annotations: ${JSON.stringify(signalAnnotations)},
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: false,
      margin: { t: 50, b: 50, l: 50, r: 80 },
      dragmode: 'zoom',
    };

    Plotly.newPlot('priceChart', [candlestick], priceLayout, {
      responsive: true,
      scrollZoom: true,
      displayModeBar: true,
      modeBarButtonsToAdd: ['drawline', 'drawopenpath', 'eraseshape'],
    });

    // RSI chart
    const rsiLine = {
      x: ${JSON.stringify(rsiTimestamps)},
      y: ${JSON.stringify(rsiData)},
      type: 'scatter',
      mode: 'lines',
      name: 'RSI',
      line: { color: '#00d4ff', width: 1 },
    };

    const rsiDivLines = ${JSON.stringify(rsiDivMarkers)};

    const rsiLayout = {
      title: 'RSI (14) with Divergence Lines',
      xaxis: { color: '#888' },
      yaxis: { title: 'RSI', color: '#888', range: [0, 100] },
      shapes: [
        { type: 'line', x0: '${rsiTimestamps[0]}', x1: '${rsiTimestamps[rsiTimestamps.length - 1]}', y0: 70, y1: 70, line: { color: 'red', dash: 'dash', width: 1 } },
        { type: 'line', x0: '${rsiTimestamps[0]}', x1: '${rsiTimestamps[rsiTimestamps.length - 1]}', y0: 30, y1: 30, line: { color: 'green', dash: 'dash', width: 1 } },
      ],
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: false,
      margin: { t: 50, b: 30, l: 50, r: 80 },
    };

    Plotly.newPlot('rsiChart', [rsiLine, ...rsiDivLines], rsiLayout, { responsive: true });
  </script>
</body>
</html>`;
}

/**
 * Filter candles to get only continuous data (no gaps > 2 minutes)
 * This removes weekend gaps and other market closures
 */
function filterContinuousCandles(allCandles: Candle[], maxCandles: number): Candle[] {
  if (allCandles.length === 0) return [];

  // Start from the end and work backwards
  const result: Candle[] = [];
  let prevTimestamp = allCandles[allCandles.length - 1]!.timestamp;

  for (let i = allCandles.length - 1; i >= 0 && result.length < maxCandles; i--) {
    const candle = allCandles[i]!;
    const gap = prevTimestamp - candle.timestamp;

    // If gap is more than 2 minutes (120 seconds), we hit a market close
    // Stop collecting if we already have some candles
    if (gap > 120 && result.length > 0) {
      break;
    }

    result.unshift(candle);
    prevTimestamp = candle.timestamp;
  }

  return result;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           Confluence Signals Visualization');
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

  // Get continuous candles (no weekend gaps)
  const continuousCandles = filterContinuousCandles(allCandles, LOOKBACK);
  console.log(`   📊 Using ${continuousCandles.length} continuous candles (no gaps)`);

  const candles = continuousCandles;

  if (candles.length > 0) {
    const startTime = new Date(candles[0]!.timestamp * 1000).toISOString();
    const endTime = new Date(candles[candles.length - 1]!.timestamp * 1000).toISOString();
    console.log(`   📅 Range: ${startTime.slice(0, 16)} to ${endTime.slice(0, 16)}`);
  }

  // MTF Analysis
  console.log('\n🔍 Running MTF Market Structure Analysis...');
  const mtfAnalyzer = new MTFMarketStructureAnalyzer();
  const mtfStructure = mtfAnalyzer.analyze(candles, ASSET);
  console.log(`   ✅ Found ${mtfStructure.allZones.length} zones`);

  // RSI Divergence Detection
  console.log('\n🔍 Detecting RSI Divergences...');
  const divergenceDetector = new RSIDivergenceDetector({
    rsiPeriod: 14,
    minSwingDistance: 5,
    maxSwingDistance: 40,
    requireConfirmation: false, // Show all for visualization
  });
  const divergences = divergenceDetector.detect(candles);
  console.log(`   ✅ Found ${divergences.length} divergences`);

  // Calculate RSI for chart
  const rsiValues = calculateRSI(candles, 14);

  // Find HIGH QUALITY confluence signals
  console.log(`\n🎯 Finding High Quality Signals (min ${MIN_CONFLUENCE} factors)...`);
  const confluenceSignals = findConfluenceSignals(
    candles,
    mtfStructure.allZones,
    divergences,
    MIN_CONFLUENCE
  );
  console.log(`   ✅ Found ${confluenceSignals.length} confluence signals`);

  const highQuality = confluenceSignals.filter(s => s.confluenceCount >= 3);
  console.log(`   ⭐ ${highQuality.length} are high quality (3+ factors)`);

  // Generate HTML
  console.log('\n📝 Generating chart...');
  const html = generateHTML(
    candles,
    mtfStructure.allZones,
    divergences,
    confluenceSignals,
    rsiValues,
    ASSET
  );

  // Write file
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `confluence-signals_${ASSET}_${timestamp}.html`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, html);
  console.log(`\n✅ Chart saved to: ${filepath}`);
  console.log('\n📊 Open the file in a browser to view the interactive chart.');
}

main().catch(console.error);
