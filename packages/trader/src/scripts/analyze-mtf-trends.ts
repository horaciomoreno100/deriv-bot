#!/usr/bin/env npx tsx
/**
 * Analyze Multi-Timeframe Trends
 *
 * Analiza las tendencias en múltiples timeframes para entender mejor
 * el contexto del mercado:
 * - 1m: Micro-tendencias (ruido, scalping)
 * - 5m: Tendencias cortas
 * - 15m: Tendencias medias
 * - 1h: Tendencia principal
 *
 * Objetivo: Identificar cuándo una reversión en 1m está alineada
 * con la tendencia de timeframes mayores.
 *
 * Usage:
 *   ASSET="R_100" DATA_FILE="data/R_100_1m_7d.csv" npx tsx src/scripts/analyze-mtf-trends.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV, type Candle } from '../backtest/index.js';

const ASSET = process.env.ASSET ?? 'R_100';
const DATA_FILE = process.env.DATA_FILE ?? `data/${ASSET}_1m_7d.csv`;

interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  type: 'high' | 'low';
}

interface TrendInfo {
  direction: 'up' | 'down' | 'sideways';
  strength: number; // 0-100
  duration: number; // candles
  priceChange: number; // %
  lastSwingHigh: number;
  lastSwingLow: number;
}

/**
 * Resample candles to higher timeframe
 */
function resampleCandles(candles: Candle[], targetTimeframeSec: number): Candle[] {
  if (candles.length === 0) return [];

  const resampled: Candle[] = [];
  let currentBucket: Candle | null = null;
  let bucketStart = 0;

  for (const candle of candles) {
    const bucketTimestamp = Math.floor(candle.timestamp / targetTimeframeSec) * targetTimeframeSec;

    if (currentBucket === null || bucketTimestamp !== bucketStart) {
      if (currentBucket) {
        resampled.push(currentBucket);
      }
      currentBucket = {
        timestamp: bucketTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
      bucketStart = bucketTimestamp;
    } else {
      currentBucket.high = Math.max(currentBucket.high, candle.high);
      currentBucket.low = Math.min(currentBucket.low, candle.low);
      currentBucket.close = candle.close;
    }
  }

  if (currentBucket) {
    resampled.push(currentBucket);
  }

  return resampled;
}

/**
 * Detect swing points with configurable sensitivity
 */
function detectSwings(candles: Candle[], depth: number): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = depth; i < candles.length - depth; i++) {
    const candle = candles[i]!;
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= depth; j++) {
      const left = candles[i - j]!;
      const right = candles[i + j]!;

      if (candle.high <= left.high || candle.high <= right.high) isHigh = false;
      if (candle.low >= left.low || candle.low >= right.low) isLow = false;
    }

    if (isHigh) {
      swings.push({ index: i, timestamp: candle.timestamp, price: candle.high, type: 'high' });
    } else if (isLow) {
      swings.push({ index: i, timestamp: candle.timestamp, price: candle.low, type: 'low' });
    }
  }

  // Filter consecutive same type
  const filtered: SwingPoint[] = [];
  for (const swing of swings) {
    const last = filtered[filtered.length - 1];
    if (!last || last.type !== swing.type) {
      filtered.push(swing);
    } else if (swing.type === 'high' && swing.price > last.price) {
      filtered[filtered.length - 1] = swing;
    } else if (swing.type === 'low' && swing.price < last.price) {
      filtered[filtered.length - 1] = swing;
    }
  }

  return filtered;
}

/**
 * Analyze current trend from swing points
 */
function analyzeTrend(swings: SwingPoint[], candles: Candle[]): TrendInfo {
  if (swings.length < 4) {
    return {
      direction: 'sideways',
      strength: 0,
      duration: 0,
      priceChange: 0,
      lastSwingHigh: candles[candles.length - 1]?.high ?? 0,
      lastSwingLow: candles[candles.length - 1]?.low ?? 0,
    };
  }

  // Get last 4 swings to determine trend
  const recent = swings.slice(-4);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');

  let direction: 'up' | 'down' | 'sideways' = 'sideways';
  let strength = 0;

  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1]!.price > highs[highs.length - 2]!.price;
    const hl = lows[lows.length - 1]!.price > lows[lows.length - 2]!.price;
    const lh = highs[highs.length - 1]!.price < highs[highs.length - 2]!.price;
    const ll = lows[lows.length - 1]!.price < lows[lows.length - 2]!.price;

    if (hh && hl) {
      direction = 'up';
      strength = 80;
    } else if (lh && ll) {
      direction = 'down';
      strength = 80;
    } else if (hh || hl) {
      direction = 'up';
      strength = 50;
    } else if (lh || ll) {
      direction = 'down';
      strength = 50;
    }
  }

  // Calculate price change
  const lastSwing = swings[swings.length - 1]!;
  const prevOppositeSwing = swings.slice().reverse().find(s => s.type !== lastSwing.type);
  const priceChange = prevOppositeSwing
    ? Math.abs(lastSwing.price - prevOppositeSwing.price) / prevOppositeSwing.price * 100
    : 0;
  const duration = prevOppositeSwing ? lastSwing.index - prevOppositeSwing.index : 0;

  // Find last swing high/low
  const lastHigh = swings.slice().reverse().find(s => s.type === 'high');
  const lastLow = swings.slice().reverse().find(s => s.type === 'low');

  return {
    direction,
    strength,
    duration,
    priceChange,
    lastSwingHigh: lastHigh?.price ?? 0,
    lastSwingLow: lastLow?.price ?? 0,
  };
}

/**
 * Get trend at specific timestamp across all timeframes
 */
interface MTFSnapshot {
  timestamp: number;
  tf1m: TrendInfo;
  tf5m: TrendInfo;
  tf15m: TrendInfo;
  tf1h: TrendInfo;
  alignment: 'bullish' | 'bearish' | 'mixed';
  alignmentScore: number; // -100 to +100
}

function generateChartHTML(
  candles1m: Candle[],
  candles5m: Candle[],
  candles15m: Candle[],
  swings1m: SwingPoint[],
  swings5m: SwingPoint[],
  swings15m: SwingPoint[],
  asset: string
): string {
  // Sample every N candles for 1m to reduce data size
  const sampleRate = 1;
  const sampledCandles = candles1m.filter((_, i) => i % sampleRate === 0);

  return `<!DOCTYPE html>
<html>
<head>
  <title>MTF Trend Analysis - ${asset}</title>
  <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
    }
    .header {
      padding: 15px 20px;
      background: #16213e;
      border-bottom: 1px solid #333;
    }
    .header h1 { font-size: 18px; margin-bottom: 10px; }
    .charts-container {
      display: grid;
      grid-template-columns: 1fr;
      grid-template-rows: 2fr 1fr 1fr;
      height: calc(100vh - 80px);
    }
    .chart-wrapper {
      position: relative;
      border-bottom: 1px solid #333;
    }
    .chart-label {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(22, 33, 62, 0.9);
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10;
    }
    .chart { width: 100%; height: 100%; }
    .legend {
      display: flex;
      gap: 20px;
      padding: 10px 20px;
      font-size: 12px;
    }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Multi-Timeframe Trend Analysis - ${asset}</h1>
    <div class="legend">
      <div class="legend-item">
        <div class="legend-dot" style="background: #26a69a"></div>
        <span>Swing High</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background: #ef5350"></div>
        <span>Swing Low</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background: #2196f3"></div>
        <span>5m Swings</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background: #ff9800"></div>
        <span>15m Swings</span>
      </div>
    </div>
  </div>

  <div class="charts-container">
    <div class="chart-wrapper">
      <div class="chart-label">1 Minute (with 5m & 15m levels)</div>
      <div id="chart1m" class="chart"></div>
    </div>
    <div class="chart-wrapper">
      <div class="chart-label">5 Minutes</div>
      <div id="chart5m" class="chart"></div>
    </div>
    <div class="chart-wrapper">
      <div class="chart-label">15 Minutes</div>
      <div id="chart15m" class="chart"></div>
    </div>
  </div>

  <script>
    const candles1m = ${JSON.stringify(sampledCandles.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close })))};
    const candles5m = ${JSON.stringify(candles5m.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close })))};
    const candles15m = ${JSON.stringify(candles15m.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close })))};

    const swings1m = ${JSON.stringify(swings1m.map(s => ({ time: s.timestamp, price: s.price, type: s.type })))};
    const swings5m = ${JSON.stringify(swings5m.map(s => ({ time: s.timestamp, price: s.price, type: s.type })))};
    const swings15m = ${JSON.stringify(swings15m.map(s => ({ time: s.timestamp, price: s.price, type: s.type })))};

    const chartOptions = {
      layout: { background: { color: '#1a1a2e' }, textColor: '#d9d9d9' },
      grid: { vertLines: { color: '#2B2B43' }, horzLines: { color: '#2B2B43' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false },
    };

    // 1M Chart
    const chart1m = LightweightCharts.createChart(document.getElementById('chart1m'), chartOptions);
    const candleSeries1m = chart1m.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    candleSeries1m.setData(candles1m);

    // Add 1m swing markers
    const markers1m = swings1m.map(s => ({
      time: s.time,
      position: s.type === 'high' ? 'aboveBar' : 'belowBar',
      color: s.type === 'high' ? '#26a69a' : '#ef5350',
      shape: s.type === 'high' ? 'arrowDown' : 'arrowUp',
      size: 0.5,
    }));
    candleSeries1m.setMarkers(markers1m);

    // Add 5m levels as horizontal lines on 1m chart
    swings5m.forEach(s => {
      const line = chart1m.addLineSeries({
        color: s.type === 'high' ? 'rgba(33, 150, 243, 0.5)' : 'rgba(33, 150, 243, 0.5)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Draw line from swing point to end
      const startTime = s.time;
      const endTime = candles1m[candles1m.length - 1]?.time || s.time;
      line.setData([
        { time: startTime, value: s.price },
        { time: endTime, value: s.price },
      ]);
    });

    // Add 15m levels on 1m chart (thicker)
    swings15m.forEach(s => {
      const line = chart1m.addLineSeries({
        color: s.type === 'high' ? 'rgba(255, 152, 0, 0.6)' : 'rgba(255, 152, 0, 0.6)',
        lineWidth: 2,
        lineStyle: 0, // solid
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const startTime = s.time;
      const endTime = candles1m[candles1m.length - 1]?.time || s.time;
      line.setData([
        { time: startTime, value: s.price },
        { time: endTime, value: s.price },
      ]);
    });

    // 5M Chart
    const chart5m = LightweightCharts.createChart(document.getElementById('chart5m'), chartOptions);
    const candleSeries5m = chart5m.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    candleSeries5m.setData(candles5m);

    const markers5m = swings5m.map(s => ({
      time: s.time,
      position: s.type === 'high' ? 'aboveBar' : 'belowBar',
      color: s.type === 'high' ? '#2196f3' : '#2196f3',
      shape: s.type === 'high' ? 'arrowDown' : 'arrowUp',
      size: 1,
    }));
    candleSeries5m.setMarkers(markers5m);

    // 15M Chart
    const chart15m = LightweightCharts.createChart(document.getElementById('chart15m'), chartOptions);
    const candleSeries15m = chart15m.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    candleSeries15m.setData(candles15m);

    const markers15m = swings15m.map(s => ({
      time: s.time,
      position: s.type === 'high' ? 'aboveBar' : 'belowBar',
      color: s.type === 'high' ? '#ff9800' : '#ff9800',
      shape: s.type === 'high' ? 'arrowDown' : 'arrowUp',
      size: 1,
    }));
    candleSeries15m.setMarkers(markers15m);

    // Sync all charts
    function syncCharts(sourceChart, targetCharts) {
      sourceChart.timeScale().subscribeVisibleTimeRangeChange(() => {
        const range = sourceChart.timeScale().getVisibleRange();
        if (range) {
          targetCharts.forEach(c => c.timeScale().setVisibleRange(range));
        }
      });
    }

    syncCharts(chart1m, [chart5m, chart15m]);
    syncCharts(chart5m, [chart1m, chart15m]);
    syncCharts(chart15m, [chart1m, chart5m]);

    chart1m.timeScale().fitContent();
    chart5m.timeScale().fitContent();
    chart15m.timeScale().fitContent();
  </script>
</body>
</html>`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              Multi-Timeframe Trend Analysis');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  const dataPath = path.join(process.cwd(), DATA_FILE);
  console.log(`📂 Loading: ${DATA_FILE}`);

  const candles1m = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
  });

  console.log(`   1m: ${candles1m.length.toLocaleString()} candles`);

  // Resample to higher timeframes
  console.log('🔄 Resampling to higher timeframes...');
  const candles5m = resampleCandles(candles1m, 300);
  const candles15m = resampleCandles(candles1m, 900);
  const candles1h = resampleCandles(candles1m, 3600);

  console.log(`   5m: ${candles5m.length.toLocaleString()} candles`);
  console.log(`   15m: ${candles15m.length.toLocaleString()} candles`);
  console.log(`   1h: ${candles1h.length.toLocaleString()} candles`);
  console.log();

  // Detect swings at each timeframe
  console.log('🔍 Detecting swings at each timeframe...');
  const swings1m = detectSwings(candles1m, 5);
  const swings5m = detectSwings(candles5m, 3);
  const swings15m = detectSwings(candles15m, 3);
  const swings1h = detectSwings(candles1h, 2);

  console.log(`   1m swings: ${swings1m.length}`);
  console.log(`   5m swings: ${swings5m.length}`);
  console.log(`   15m swings: ${swings15m.length}`);
  console.log(`   1h swings: ${swings1h.length}`);
  console.log();

  // Analyze trends
  console.log('📊 Analyzing trends...');
  const trend1m = analyzeTrend(swings1m, candles1m);
  const trend5m = analyzeTrend(swings5m, candles5m);
  const trend15m = analyzeTrend(swings15m, candles15m);
  const trend1h = analyzeTrend(swings1h, candles1h);

  console.log();
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│                    CURRENT TREND STATUS                         │');
  console.log('├──────────┬────────────┬──────────┬─────────────┬────────────────┤');
  console.log('│ Timeframe│ Direction  │ Strength │ Last Move % │ Duration       │');
  console.log('├──────────┼────────────┼──────────┼─────────────┼────────────────┤');
  console.log(`│ 1m       │ ${trend1m.direction.padEnd(10)} │ ${String(trend1m.strength).padStart(6)}%  │ ${trend1m.priceChange.toFixed(2).padStart(10)}% │ ${String(trend1m.duration).padStart(6)} candles │`);
  console.log(`│ 5m       │ ${trend5m.direction.padEnd(10)} │ ${String(trend5m.strength).padStart(6)}%  │ ${trend5m.priceChange.toFixed(2).padStart(10)}% │ ${String(trend5m.duration).padStart(6)} candles │`);
  console.log(`│ 15m      │ ${trend15m.direction.padEnd(10)} │ ${String(trend15m.strength).padStart(6)}%  │ ${trend15m.priceChange.toFixed(2).padStart(10)}% │ ${String(trend15m.duration).padStart(6)} candles │`);
  console.log(`│ 1h       │ ${trend1h.direction.padEnd(10)} │ ${String(trend1h.strength).padStart(6)}%  │ ${trend1h.priceChange.toFixed(2).padStart(10)}% │ ${String(trend1h.duration).padStart(6)} candles │`);
  console.log('└──────────┴────────────┴──────────┴─────────────┴────────────────┘');
  console.log();

  // Key levels from higher timeframes
  console.log('🎯 KEY LEVELS FROM HIGHER TIMEFRAMES:');
  console.log();

  const lastHigh5m = swings5m.slice().reverse().find(s => s.type === 'high');
  const lastLow5m = swings5m.slice().reverse().find(s => s.type === 'low');
  const lastHigh15m = swings15m.slice().reverse().find(s => s.type === 'high');
  const lastLow15m = swings15m.slice().reverse().find(s => s.type === 'low');
  const lastHigh1h = swings1h.slice().reverse().find(s => s.type === 'high');
  const lastLow1h = swings1h.slice().reverse().find(s => s.type === 'low');

  console.log('   5m levels:');
  if (lastHigh5m) console.log(`      Resistance: ${lastHigh5m.price.toFixed(2)} (${new Date(lastHigh5m.timestamp * 1000).toISOString().slice(11, 16)})`);
  if (lastLow5m) console.log(`      Support:    ${lastLow5m.price.toFixed(2)} (${new Date(lastLow5m.timestamp * 1000).toISOString().slice(11, 16)})`);

  console.log('   15m levels:');
  if (lastHigh15m) console.log(`      Resistance: ${lastHigh15m.price.toFixed(2)} (${new Date(lastHigh15m.timestamp * 1000).toISOString().slice(11, 16)})`);
  if (lastLow15m) console.log(`      Support:    ${lastLow15m.price.toFixed(2)} (${new Date(lastLow15m.timestamp * 1000).toISOString().slice(11, 16)})`);

  console.log('   1h levels:');
  if (lastHigh1h) console.log(`      Resistance: ${lastHigh1h.price.toFixed(2)} (${new Date(lastHigh1h.timestamp * 1000).toISOString().slice(11, 16)})`);
  if (lastLow1h) console.log(`      Support:    ${lastLow1h.price.toFixed(2)} (${new Date(lastLow1h.timestamp * 1000).toISOString().slice(11, 16)})`);
  console.log();

  // Alignment analysis
  const directions = [trend1m.direction, trend5m.direction, trend15m.direction, trend1h.direction];
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;

  let alignment: string;
  let alignmentEmoji: string;
  if (upCount >= 3) {
    alignment = 'BULLISH';
    alignmentEmoji = '🟢';
  } else if (downCount >= 3) {
    alignment = 'BEARISH';
    alignmentEmoji = '🔴';
  } else {
    alignment = 'MIXED';
    alignmentEmoji = '🟡';
  }

  console.log(`📈 MTF ALIGNMENT: ${alignmentEmoji} ${alignment}`);
  console.log(`   Up: ${upCount}/4 timeframes | Down: ${downCount}/4 timeframes`);
  console.log();

  // Trading recommendations
  console.log('💡 TRADING RECOMMENDATIONS:');
  console.log();

  if (alignment === 'BULLISH') {
    console.log('   ✅ Look for CALL entries on 1m pullbacks to:');
    if (lastLow5m) console.log(`      - 5m support: ${lastLow5m.price.toFixed(2)}`);
    if (lastLow15m) console.log(`      - 15m support: ${lastLow15m.price.toFixed(2)}`);
    console.log('   ❌ Avoid PUT signals - going against the trend');
  } else if (alignment === 'BEARISH') {
    console.log('   ✅ Look for PUT entries on 1m rallies to:');
    if (lastHigh5m) console.log(`      - 5m resistance: ${lastHigh5m.price.toFixed(2)}`);
    if (lastHigh15m) console.log(`      - 15m resistance: ${lastHigh15m.price.toFixed(2)}`);
    console.log('   ❌ Avoid CALL signals - going against the trend');
  } else {
    console.log('   ⚠️  Mixed signals - be cautious');
    console.log('   🎯 Trade bounces from key levels:');
    if (lastHigh15m) console.log(`      - Resistance: ${lastHigh15m.price.toFixed(2)} (PUT)`);
    if (lastLow15m) console.log(`      - Support: ${lastLow15m.price.toFixed(2)} (CALL)`);
  }
  console.log();

  // Generate chart
  console.log('🎨 Generating MTF chart...');
  const html = generateChartHTML(candles1m, candles5m, candles15m, swings1m, swings5m, swings15m, ASSET);

  const outputDir = path.join(process.cwd(), 'charts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `mtf_analysis_${ASSET}_${new Date().toISOString().slice(0, 10)}.html`);
  fs.writeFileSync(outputFile, html);

  console.log(`   ✅ Chart saved: ${outputFile}`);
  console.log();
  console.log('💡 El gráfico muestra:');
  console.log('   - Chart 1m con niveles de 5m (azul punteado) y 15m (naranja sólido)');
  console.log('   - Charts 5m y 15m con sus swings');
  console.log('   - Los charts están sincronizados - mueve uno y los otros siguen');
}

main().catch(console.error);
