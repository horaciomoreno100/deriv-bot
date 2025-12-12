#!/usr/bin/env npx tsx
/**
 * Accumulation/Distribution Zone Visualizer
 *
 * Visualiza zonas de acumulación (compra) y distribución (venta) usando:
 * 1. Percentil histórico del precio (barato vs caro)
 * 2. RSI con divergencias
 * 3. Estructura de mercado (swing highs/lows)
 * 4. Zonas de demanda/oferta en HTF
 *
 * Usage:
 *   ASSET="cryETHUSD" DAYS=90 pnpm exec tsx src/scripts/visualize-accumulation-zones.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { loadCandlesFromCSV } from '../backtest/index.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'cryETHUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'analysis-output';

// Percentile thresholds
const VERY_CHEAP_PERCENTILE = 20;
const CHEAP_PERCENTILE = 35;
const EXPENSIVE_PERCENTILE = 65;
const VERY_EXPENSIVE_PERCENTILE = 80;

// RSI settings
const RSI_PERIOD = 14;
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;

interface PriceZone {
  startIndex: number;
  endIndex: number;
  type: 'very_cheap' | 'cheap' | 'expensive' | 'very_expensive';
  priceRange: { low: number; high: number };
}

interface RSIDivergence {
  index: number;
  type: 'bullish' | 'bearish';
  pricePoint: number;
  rsiValue: number;
}

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  strength: number;
}

/**
 * Calculate RSI
 */
function calculateRSI(candles: Candle[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      rsi.push(50);
      continue;
    }

    const change = candles[i]!.close - candles[i - 1]!.close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    gains.push(gain);
    losses.push(loss);

    if (i < period) {
      rsi.push(50);
      continue;
    }

    let avgGain: number;
    let avgLoss: number;

    if (i === period) {
      avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
      avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      const prevAvgGain = gains.slice(0, i - 1).reduce((a, b) => a + b, 0) / (i - 1);
      const prevAvgLoss = losses.slice(0, i - 1).reduce((a, b) => a + b, 0) / (i - 1);
      avgGain = (prevAvgGain * (period - 1) + gain) / period;
      avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return rsi;
}

/**
 * Calculate price percentile over rolling window
 */
function calculatePercentile(candles: Candle[], windowSize: number = 1440): number[] {
  const percentiles: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - windowSize);
    const window = candles.slice(start, i + 1);

    const prices = window.map((c) => c.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    if (max === min) {
      percentiles.push(50);
    } else {
      const percentile = ((candles[i]!.close - min) / (max - min)) * 100;
      percentiles.push(percentile);
    }
  }

  return percentiles;
}

/**
 * Find swing points
 */
function findSwingPoints(candles: Candle[], lookback: number = 20): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i]!;

    // Check for swing high
    let isSwingHigh = true;
    let highStrength = 0;
    for (let j = 1; j <= lookback; j++) {
      const before = candles[i - j]!;
      const after = candles[i + j];
      if (!after) break;

      if (current.high <= before.high || current.high <= after.high) {
        isSwingHigh = false;
        break;
      }
      highStrength = j;
    }

    if (isSwingHigh && highStrength >= 5) {
      swings.push({
        index: i,
        price: current.high,
        type: 'high',
        strength: highStrength,
      });
    }

    // Check for swing low
    let isSwingLow = true;
    let lowStrength = 0;
    for (let j = 1; j <= lookback; j++) {
      const before = candles[i - j]!;
      const after = candles[i + j];
      if (!after) break;

      if (current.low >= before.low || current.low >= after.low) {
        isSwingLow = false;
        break;
      }
      lowStrength = j;
    }

    if (isSwingLow && lowStrength >= 5) {
      swings.push({
        index: i,
        price: current.low,
        type: 'low',
        strength: lowStrength,
      });
    }
  }

  return swings;
}

/**
 * Detect RSI divergences
 */
function detectDivergences(
  candles: Candle[],
  rsi: number[],
  swings: SwingPoint[]
): RSIDivergence[] {
  const divergences: RSIDivergence[] = [];

  // Get swing lows for bullish divergence
  const swingLows = swings.filter((s) => s.type === 'low').sort((a, b) => a.index - b.index);

  // Check consecutive swing lows for bullish divergence
  for (let i = 1; i < swingLows.length; i++) {
    const prev = swingLows[i - 1]!;
    const curr = swingLows[i]!;

    // Price makes lower low but RSI makes higher low
    if (
      curr.price < prev.price &&
      rsi[curr.index]! > rsi[prev.index]! &&
      rsi[curr.index]! < 40 // RSI should be in oversold territory
    ) {
      divergences.push({
        index: curr.index,
        type: 'bullish',
        pricePoint: curr.price,
        rsiValue: rsi[curr.index]!,
      });
    }
  }

  // Get swing highs for bearish divergence
  const swingHighs = swings.filter((s) => s.type === 'high').sort((a, b) => a.index - b.index);

  // Check consecutive swing highs for bearish divergence
  for (let i = 1; i < swingHighs.length; i++) {
    const prev = swingHighs[i - 1]!;
    const curr = swingHighs[i]!;

    // Price makes higher high but RSI makes lower high
    if (
      curr.price > prev.price &&
      rsi[curr.index]! < rsi[prev.index]! &&
      rsi[curr.index]! > 60 // RSI should be in overbought territory
    ) {
      divergences.push({
        index: curr.index,
        type: 'bearish',
        pricePoint: curr.price,
        rsiValue: rsi[curr.index]!,
      });
    }
  }

  return divergences;
}

/**
 * Find price zones based on percentile
 */
function findPriceZones(candles: Candle[], percentiles: number[]): PriceZone[] {
  const zones: PriceZone[] = [];
  let currentZone: PriceZone | null = null;

  for (let i = 0; i < candles.length; i++) {
    const pct = percentiles[i]!;
    let zoneType: PriceZone['type'] | null = null;

    if (pct <= VERY_CHEAP_PERCENTILE) {
      zoneType = 'very_cheap';
    } else if (pct <= CHEAP_PERCENTILE) {
      zoneType = 'cheap';
    } else if (pct >= VERY_EXPENSIVE_PERCENTILE) {
      zoneType = 'very_expensive';
    } else if (pct >= EXPENSIVE_PERCENTILE) {
      zoneType = 'expensive';
    }

    if (zoneType) {
      if (!currentZone || currentZone.type !== zoneType) {
        if (currentZone) {
          zones.push(currentZone);
        }
        currentZone = {
          startIndex: i,
          endIndex: i,
          type: zoneType,
          priceRange: { low: candles[i]!.low, high: candles[i]!.high },
        };
      } else {
        currentZone.endIndex = i;
        currentZone.priceRange.low = Math.min(currentZone.priceRange.low, candles[i]!.low);
        currentZone.priceRange.high = Math.max(currentZone.priceRange.high, candles[i]!.high);
      }
    } else {
      if (currentZone) {
        zones.push(currentZone);
        currentZone = null;
      }
    }
  }

  if (currentZone) {
    zones.push(currentZone);
  }

  return zones;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Generate HTML chart
 */
function generateHTML(
  candles: Candle[],
  percentiles: number[],
  rsi: number[],
  swings: SwingPoint[],
  divergences: RSIDivergence[],
  zones: PriceZone[],
  asset: string
): string {
  // Resample for performance (every 15 candles for 1m data)
  const resampleRate = Math.max(1, Math.floor(candles.length / 5000));
  const sampledCandles = candles.filter((_, i) => i % resampleRate === 0);
  const sampledPercentiles = percentiles.filter((_, i) => i % resampleRate === 0);
  const sampledRSI = rsi.filter((_, i) => i % resampleRate === 0);

  const timestamps = sampledCandles.map((c) => formatTimestamp(c.timestamp));
  const opens = sampledCandles.map((c) => c.open);
  const highs = sampledCandles.map((c) => c.high);
  const lows = sampledCandles.map((c) => c.low);
  const closes = sampledCandles.map((c) => c.close);

  // Price stats
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const currentPrice = closes[closes.length - 1]!;
  const currentPercentile = sampledPercentiles[sampledPercentiles.length - 1]!;

  // Zone shapes
  const zoneShapes = zones.map((zone) => {
    const startIdx = Math.floor(zone.startIndex / resampleRate);
    const endIdx = Math.floor(zone.endIndex / resampleRate);

    const colors: Record<string, string> = {
      very_cheap: 'rgba(0, 255, 0, 0.15)',
      cheap: 'rgba(0, 255, 0, 0.08)',
      expensive: 'rgba(255, 0, 0, 0.08)',
      very_expensive: 'rgba(255, 0, 0, 0.15)',
    };

    return {
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: timestamps[startIdx],
      x1: timestamps[Math.min(endIdx, timestamps.length - 1)],
      y0: minPrice * 0.99,
      y1: maxPrice * 1.01,
      fillcolor: colors[zone.type],
      line: { width: 0 },
    };
  });

  // Swing point markers
  const swingHighMarkers = swings
    .filter((s) => s.type === 'high' && s.strength >= 10)
    .map((s) => {
      const idx = Math.floor(s.index / resampleRate);
      if (idx >= timestamps.length) return null;
      return {
        x: timestamps[idx],
        y: s.price * 1.002,
        text: '▼',
        showarrow: false,
        font: { color: '#ff6666', size: 12 },
      };
    })
    .filter(Boolean);

  const swingLowMarkers = swings
    .filter((s) => s.type === 'low' && s.strength >= 10)
    .map((s) => {
      const idx = Math.floor(s.index / resampleRate);
      if (idx >= timestamps.length) return null;
      return {
        x: timestamps[idx],
        y: s.price * 0.998,
        text: '▲',
        showarrow: false,
        font: { color: '#66ff66', size: 12 },
      };
    })
    .filter(Boolean);

  // Divergence markers
  const divMarkers = divergences.map((d) => {
    const idx = Math.floor(d.index / resampleRate);
    if (idx >= timestamps.length) return null;
    const isBullish = d.type === 'bullish';
    return {
      x: timestamps[idx],
      y: d.pricePoint * (isBullish ? 0.995 : 1.005),
      text: isBullish ? '🟢 DIV' : '🔴 DIV',
      showarrow: true,
      arrowhead: 2,
      arrowsize: 1,
      arrowcolor: isBullish ? '#00ff00' : '#ff0000',
      font: { color: isBullish ? '#00ff00' : '#ff0000', size: 10 },
      ax: 0,
      ay: isBullish ? 30 : -30,
    };
  }).filter(Boolean);

  // Stats summary
  const bullishDivs = divergences.filter((d) => d.type === 'bullish').length;
  const bearishDivs = divergences.filter((d) => d.type === 'bearish').length;
  const cheapZones = zones.filter((z) => z.type.includes('cheap')).length;
  const expensiveZones = zones.filter((z) => z.type.includes('expensive')).length;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Accumulation Zones - ${asset}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .container { max-width: 1800px; margin: 0 auto; }
    h1 { color: #00d4ff; margin-bottom: 10px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #16213e;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #00d4ff;
    }
    .stat-value { font-size: 24px; font-weight: bold; }
    .stat-label { color: #888; font-size: 12px; }
    .cheap { border-left-color: #00ff00; }
    .expensive { border-left-color: #ff4444; }
    .neutral { border-left-color: #ffaa00; }
    .legend {
      display: flex;
      gap: 20px;
      margin-bottom: 15px;
      flex-wrap: wrap;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .legend-color {
      width: 20px;
      height: 20px;
      border-radius: 4px;
    }
    #chart { width: 100%; height: 600px; }
    #rsi-chart { width: 100%; height: 200px; margin-top: 10px; }
    #percentile-chart { width: 100%; height: 150px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Accumulation/Distribution Zones - ${asset}</h1>

    <div class="stats">
      <div class="stat-card ${currentPercentile < 35 ? 'cheap' : currentPercentile > 65 ? 'expensive' : 'neutral'}">
        <div class="stat-value">${currentPercentile.toFixed(1)}%</div>
        <div class="stat-label">Current Percentile (${currentPercentile < 35 ? 'CHEAP' : currentPercentile > 65 ? 'EXPENSIVE' : 'NEUTRAL'})</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${currentPrice.toFixed(2)}</div>
        <div class="stat-label">Current Price</div>
      </div>
      <div class="stat-card cheap">
        <div class="stat-value">${bullishDivs}</div>
        <div class="stat-label">Bullish Divergences</div>
      </div>
      <div class="stat-card expensive">
        <div class="stat-value">${bearishDivs}</div>
        <div class="stat-label">Bearish Divergences</div>
      </div>
      <div class="stat-card cheap">
        <div class="stat-value">${cheapZones}</div>
        <div class="stat-label">Cheap Zones</div>
      </div>
      <div class="stat-card expensive">
        <div class="stat-value">${expensiveZones}</div>
        <div class="stat-label">Expensive Zones</div>
      </div>
    </div>

    <div class="legend">
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(0, 255, 0, 0.3)"></div>
        <span>Very Cheap (&lt;${VERY_CHEAP_PERCENTILE}%)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(0, 255, 0, 0.15)"></div>
        <span>Cheap (${VERY_CHEAP_PERCENTILE}-${CHEAP_PERCENTILE}%)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(255, 0, 0, 0.15)"></div>
        <span>Expensive (${EXPENSIVE_PERCENTILE}-${VERY_EXPENSIVE_PERCENTILE}%)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(255, 0, 0, 0.3)"></div>
        <span>Very Expensive (&gt;${VERY_EXPENSIVE_PERCENTILE}%)</span>
      </div>
      <div class="legend-item">
        <span>▲ Strong Swing Low</span>
      </div>
      <div class="legend-item">
        <span>▼ Strong Swing High</span>
      </div>
    </div>

    <div id="chart"></div>
    <div id="rsi-chart"></div>
    <div id="percentile-chart"></div>
  </div>

  <script>
    // Main price chart
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
      title: { text: 'Price with Accumulation/Distribution Zones', font: { color: '#eee' } },
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#16213e',
      xaxis: {
        gridcolor: '#2a2a4e',
        color: '#888',
        rangeslider: { visible: false }
      },
      yaxis: {
        gridcolor: '#2a2a4e',
        color: '#888',
        title: 'Price'
      },
      shapes: ${JSON.stringify(zoneShapes)},
      annotations: ${JSON.stringify([...swingHighMarkers, ...swingLowMarkers, ...divMarkers])},
      showlegend: false,
    };

    Plotly.newPlot('chart', [candlestick], priceLayout, { responsive: true });

    // RSI chart
    const rsiTrace = {
      x: ${JSON.stringify(timestamps)},
      y: ${JSON.stringify(sampledRSI)},
      type: 'scatter',
      mode: 'lines',
      name: 'RSI',
      line: { color: '#ffaa00', width: 1.5 },
    };

    const rsiLayout = {
      title: { text: 'RSI (${RSI_PERIOD})', font: { color: '#eee', size: 12 } },
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#16213e',
      xaxis: { gridcolor: '#2a2a4e', color: '#888', showticklabels: false },
      yaxis: {
        gridcolor: '#2a2a4e',
        color: '#888',
        range: [0, 100],
      },
      shapes: [
        { type: 'line', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: ${RSI_OVERSOLD}, y1: ${RSI_OVERSOLD}, line: { color: '#00ff00', width: 1, dash: 'dot' } },
        { type: 'line', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: ${RSI_OVERBOUGHT}, y1: ${RSI_OVERBOUGHT}, line: { color: '#ff4444', width: 1, dash: 'dot' } },
        { type: 'line', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: 50, y1: 50, line: { color: '#666', width: 1, dash: 'dot' } },
      ],
      margin: { t: 30, b: 20 },
      showlegend: false,
    };

    Plotly.newPlot('rsi-chart', [rsiTrace], rsiLayout, { responsive: true });

    // Percentile chart
    const pctTrace = {
      x: ${JSON.stringify(timestamps)},
      y: ${JSON.stringify(sampledPercentiles)},
      type: 'scatter',
      mode: 'lines',
      name: 'Price Percentile',
      line: { color: '#00d4ff', width: 1.5 },
      fill: 'tozeroy',
      fillcolor: 'rgba(0, 212, 255, 0.1)',
    };

    const pctLayout = {
      title: { text: 'Price Percentile (rolling window)', font: { color: '#eee', size: 12 } },
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#16213e',
      xaxis: { gridcolor: '#2a2a4e', color: '#888' },
      yaxis: {
        gridcolor: '#2a2a4e',
        color: '#888',
        range: [0, 100],
        title: '%'
      },
      shapes: [
        { type: 'rect', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: 0, y1: ${CHEAP_PERCENTILE}, fillcolor: 'rgba(0, 255, 0, 0.1)', line: { width: 0 } },
        { type: 'rect', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: ${EXPENSIVE_PERCENTILE}, y1: 100, fillcolor: 'rgba(255, 0, 0, 0.1)', line: { width: 0 } },
        { type: 'line', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: ${CHEAP_PERCENTILE}, y1: ${CHEAP_PERCENTILE}, line: { color: '#00ff00', width: 1, dash: 'dot' } },
        { type: 'line', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: ${EXPENSIVE_PERCENTILE}, y1: ${EXPENSIVE_PERCENTILE}, line: { color: '#ff4444', width: 1, dash: 'dot' } },
      ],
      margin: { t: 30, b: 30 },
      showlegend: false,
    };

    Plotly.newPlot('percentile-chart', [pctTrace], pctLayout, { responsive: true });
  </script>
</body>
</html>`;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     ACCUMULATION/DISTRIBUTION ZONE VISUALIZER             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Asset: ${ASSET}`);
  console.log(`Days: ${DAYS}`);

  // Find data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${ASSET}_1m_${DAYS}d.csv`,
    `${ASSET}_1m_180d.csv`,
    `${ASSET}_1m_90d.csv`,
    `${ASSET}_1m_30d.csv`,
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

  // Calculate indicators
  console.log('\n🔍 Calculating indicators...');

  // Percentile (using 24h window = 1440 candles for 1m data)
  const windowSize = Math.min(1440, Math.floor(candles.length / 3));
  const percentiles = calculatePercentile(candles, windowSize);
  console.log(`   Percentile window: ${windowSize} candles`);

  // RSI
  const rsi = calculateRSI(candles, RSI_PERIOD);
  console.log(`   RSI period: ${RSI_PERIOD}`);

  // Swing points
  const swings = findSwingPoints(candles, 20);
  console.log(`   Swing points found: ${swings.length}`);

  // Divergences
  const divergences = detectDivergences(candles, rsi, swings);
  console.log(`   Divergences found: ${divergences.length} (${divergences.filter((d) => d.type === 'bullish').length} bullish, ${divergences.filter((d) => d.type === 'bearish').length} bearish)`);

  // Price zones
  const zones = findPriceZones(candles, percentiles);
  console.log(`   Price zones: ${zones.length}`);

  // Generate HTML
  console.log('\n📝 Generating chart...');
  const html = generateHTML(candles, percentiles, rsi, swings, divergences, zones, ASSET);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `accumulation-zones_${ASSET}_${timestamp}.html`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, html);
  console.log(`\n✅ Chart saved to: ${filepath}`);

  // Print current status
  const currentPct = percentiles[percentiles.length - 1]!;
  const currentRSI = rsi[rsi.length - 1]!;

  console.log('\n' + '─'.repeat(50));
  console.log('CURRENT STATUS');
  console.log('─'.repeat(50));
  console.log(`Price Percentile: ${currentPct.toFixed(1)}% ${currentPct < 35 ? '(CHEAP - potential buy zone)' : currentPct > 65 ? '(EXPENSIVE - potential sell zone)' : '(NEUTRAL)'}`);
  console.log(`RSI: ${currentRSI.toFixed(1)} ${currentRSI < 30 ? '(OVERSOLD)' : currentRSI > 70 ? '(OVERBOUGHT)' : ''}`);

  // Recent divergences
  const recentDivs = divergences.filter((d) => d.index > candles.length - 500);
  if (recentDivs.length > 0) {
    console.log(`\nRecent Divergences:`);
    for (const div of recentDivs.slice(-3)) {
      const date = formatTimestamp(candles[div.index]!.timestamp);
      console.log(`  ${div.type === 'bullish' ? '🟢' : '🔴'} ${div.type.toUpperCase()} at ${date} (RSI: ${div.rsiValue.toFixed(1)})`);
    }
  }

  // Open chart
  console.log('\n🌐 Opening chart...');
  const { exec } = await import('child_process');
  exec(`open "${filepath}"`);
}

main().catch(console.error);
