#!/usr/bin/env npx tsx
/**
 * Plot Trend Categories
 *
 * Genera un gráfico HTML interactivo mostrando las tendencias
 * categorizadas por FUERZA (weak, moderate, strong, explosive)
 *
 * Esto permite visualizar qué tipo de tendencias estamos detectando
 * ANTES de implementarlas en una estrategia de trading.
 *
 * Usage:
 *   ASSET="R_100" DATA_FILE="data/R_100_1m_7d.csv" npx tsx src/scripts/plot-trend-categories.ts
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

interface TrendSegment {
  start: SwingPoint;
  end: SwingPoint;
  direction: 'up' | 'down';
  duration: number;
  priceChange: number;
  priceChangePct: number;
  slopePct: number;
  strength: 'weak' | 'moderate' | 'strong' | 'explosive';
}

function detectSwingPoints(candles: Candle[], depth: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = depth; i < candles.length - depth; i++) {
    const candle = candles[i]!;
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= depth; j++) {
      const leftCandle = candles[i - j]!;
      const rightCandle = candles[i + j]!;

      if (candle.high <= leftCandle.high || candle.high <= rightCandle.high) {
        isHigh = false;
      }
      if (candle.low >= leftCandle.low || candle.low >= rightCandle.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      swings.push({
        index: i,
        timestamp: candle.timestamp,
        price: candle.high,
        type: 'high',
      });
    } else if (isLow) {
      swings.push({
        index: i,
        timestamp: candle.timestamp,
        price: candle.low,
        type: 'low',
      });
    }
  }

  // Filtrar swings consecutivos del mismo tipo
  const filtered: SwingPoint[] = [];
  for (let i = 0; i < swings.length; i++) {
    const swing = swings[i]!;
    const lastFiltered = filtered[filtered.length - 1];

    if (!lastFiltered || lastFiltered.type !== swing.type) {
      filtered.push(swing);
    } else {
      // Mismo tipo - mantener el más extremo
      if (swing.type === 'high' && swing.price > lastFiltered.price) {
        filtered[filtered.length - 1] = swing;
      } else if (swing.type === 'low' && swing.price < lastFiltered.price) {
        filtered[filtered.length - 1] = swing;
      }
    }
  }

  return filtered;
}

function analyzeTrends(swings: SwingPoint[]): TrendSegment[] {
  const trends: TrendSegment[] = [];

  for (let i = 0; i < swings.length - 1; i++) {
    const start = swings[i]!;
    const end = swings[i + 1]!;

    const direction: 'up' | 'down' = end.price > start.price ? 'up' : 'down';
    const duration = end.index - start.index;
    const priceChange = Math.abs(end.price - start.price);
    const priceChangePct = (priceChange / start.price) * 100;
    const slopePct = duration > 0 ? priceChangePct / duration : 0;

    // Clasificar fuerza
    let strength: 'weak' | 'moderate' | 'strong' | 'explosive';
    if (slopePct >= 0.08) {
      strength = 'explosive';
    } else if (slopePct >= 0.04) {
      strength = 'strong';
    } else if (slopePct >= 0.02) {
      strength = 'moderate';
    } else {
      strength = 'weak';
    }

    trends.push({
      start,
      end,
      direction,
      duration,
      priceChange,
      priceChangePct,
      slopePct,
      strength,
    });
  }

  return trends;
}

function generateChartHTML(candles: Candle[], trends: TrendSegment[], asset: string): string {
  // Preparar datos para el chart
  const candleData = candles.map(c => ({
    time: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  // Colores por fuerza
  const strengthColors = {
    weak: 'rgba(128, 128, 128, 0.3)',      // gris
    moderate: 'rgba(255, 193, 7, 0.5)',    // amarillo
    strong: 'rgba(255, 87, 34, 0.6)',      // naranja
    explosive: 'rgba(244, 67, 54, 0.8)',   // rojo
  };

  // Crear líneas de tendencia por categoría
  const trendLines = trends.map((t, idx) => ({
    id: `trend_${idx}`,
    start: { time: t.start.timestamp, price: t.start.price },
    end: { time: t.end.timestamp, price: t.end.price },
    direction: t.direction,
    strength: t.strength,
    color: strengthColors[t.strength],
    duration: t.duration,
    pctChange: t.priceChangePct.toFixed(2),
    slopePct: (t.slopePct * 100).toFixed(2),
  }));

  // Estadísticas
  const stats = {
    total: trends.length,
    weak: trends.filter(t => t.strength === 'weak').length,
    moderate: trends.filter(t => t.strength === 'moderate').length,
    strong: trends.filter(t => t.strength === 'strong').length,
    explosive: trends.filter(t => t.strength === 'explosive').length,
    avgDuration: (trends.reduce((s, t) => s + t.duration, 0) / trends.length).toFixed(1),
    avgPctChange: (trends.reduce((s, t) => s + t.priceChangePct, 0) / trends.length).toFixed(2),
  };

  return `<!DOCTYPE html>
<html>
<head>
  <title>Trend Categories - ${asset}</title>
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
    .header h1 {
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 10px;
    }
    .stats {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .stat {
      padding: 8px 12px;
      background: #0f3460;
      border-radius: 6px;
      font-size: 13px;
    }
    .stat .label { color: #888; margin-right: 5px; }
    .stat .value { font-weight: 600; }
    .stat.weak .value { color: #888; }
    .stat.moderate .value { color: #ffc107; }
    .stat.strong .value { color: #ff5722; }
    .stat.explosive .value { color: #f44336; }
    .legend {
      display: flex;
      gap: 15px;
      margin-top: 10px;
      font-size: 12px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .legend-color {
      width: 20px;
      height: 3px;
      border-radius: 2px;
    }
    #chart { width: 100%; height: calc(100vh - 150px); }
    .tooltip {
      position: absolute;
      background: rgba(22, 33, 62, 0.95);
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 100;
      display: none;
    }
    .controls {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(22, 33, 62, 0.9);
      padding: 10px;
      border-radius: 6px;
      z-index: 50;
    }
    .controls label {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 5px 0;
      cursor: pointer;
      font-size: 12px;
    }
    .controls input[type="checkbox"] {
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Categorización de Tendencias - ${asset}</h1>
    <div class="stats">
      <div class="stat">
        <span class="label">Total:</span>
        <span class="value">${stats.total}</span>
      </div>
      <div class="stat weak">
        <span class="label">Weak:</span>
        <span class="value">${stats.weak}</span>
      </div>
      <div class="stat moderate">
        <span class="label">Moderate:</span>
        <span class="value">${stats.moderate}</span>
      </div>
      <div class="stat strong">
        <span class="label">Strong:</span>
        <span class="value">${stats.strong}</span>
      </div>
      <div class="stat explosive">
        <span class="label">Explosive:</span>
        <span class="value">${stats.explosive}</span>
      </div>
      <div class="stat">
        <span class="label">Avg Duration:</span>
        <span class="value">${stats.avgDuration} velas</span>
      </div>
      <div class="stat">
        <span class="label">Avg Change:</span>
        <span class="value">${stats.avgPctChange}%</span>
      </div>
    </div>
    <div class="legend">
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(128, 128, 128, 0.8)"></div>
        <span>Weak (&lt;0.02%/vela)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(255, 193, 7, 0.8)"></div>
        <span>Moderate (0.02-0.04%/vela)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(255, 87, 34, 0.8)"></div>
        <span>Strong (0.04-0.08%/vela)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgba(244, 67, 54, 0.9)"></div>
        <span>Explosive (&gt;0.08%/vela)</span>
      </div>
    </div>
  </div>

  <div class="controls">
    <strong style="font-size: 11px; color: #888;">Mostrar:</strong>
    <label><input type="checkbox" id="showWeak" checked> Weak</label>
    <label><input type="checkbox" id="showModerate" checked> Moderate</label>
    <label><input type="checkbox" id="showStrong" checked> Strong</label>
    <label><input type="checkbox" id="showExplosive" checked> Explosive</label>
  </div>

  <div id="chart"></div>
  <div class="tooltip" id="tooltip"></div>

  <script>
    const candleData = ${JSON.stringify(candleData)};
    const trendLines = ${JSON.stringify(trendLines)};

    const chart = LightweightCharts.createChart(document.getElementById('chart'), {
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#d9d9d9',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeries.setData(candleData);

    // Store line series by strength
    const lineSeriesByStrength = {
      weak: [],
      moderate: [],
      strong: [],
      explosive: [],
    };

    // Create trend lines
    trendLines.forEach((trend, idx) => {
      const lineSeries = chart.addLineSeries({
        color: trend.color,
        lineWidth: trend.strength === 'explosive' ? 3 : (trend.strength === 'strong' ? 2 : 1),
        lineStyle: trend.strength === 'weak' ? 2 : 0, // dashed for weak
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      lineSeries.setData([
        { time: trend.start.time, value: trend.start.price },
        { time: trend.end.time, value: trend.end.price },
      ]);

      // Store metadata
      lineSeries._trendData = trend;
      lineSeriesByStrength[trend.strength].push(lineSeries);
    });

    // Toggle visibility
    function updateVisibility() {
      const showWeak = document.getElementById('showWeak').checked;
      const showModerate = document.getElementById('showModerate').checked;
      const showStrong = document.getElementById('showStrong').checked;
      const showExplosive = document.getElementById('showExplosive').checked;

      lineSeriesByStrength.weak.forEach(s => s.applyOptions({ visible: showWeak }));
      lineSeriesByStrength.moderate.forEach(s => s.applyOptions({ visible: showModerate }));
      lineSeriesByStrength.strong.forEach(s => s.applyOptions({ visible: showStrong }));
      lineSeriesByStrength.explosive.forEach(s => s.applyOptions({ visible: showExplosive }));
    }

    document.getElementById('showWeak').addEventListener('change', updateVisibility);
    document.getElementById('showModerate').addEventListener('change', updateVisibility);
    document.getElementById('showStrong').addEventListener('change', updateVisibility);
    document.getElementById('showExplosive').addEventListener('change', updateVisibility);

    chart.timeScale().fitContent();

    // Tooltip on hover
    const tooltip = document.getElementById('tooltip');
    chart.subscribeCrosshairMove(param => {
      if (!param.point || !param.time) {
        tooltip.style.display = 'none';
        return;
      }

      // Find if we're near a trend line
      const time = param.time;
      let nearestTrend = null;
      let minDist = Infinity;

      trendLines.forEach(trend => {
        if (time >= trend.start.time && time <= trend.end.time) {
          const timeFrac = (time - trend.start.time) / (trend.end.time - trend.start.time);
          const expectedPrice = trend.start.price + (trend.end.price - trend.start.price) * timeFrac;

          const price = param.seriesData.get(candleSeries);
          if (price) {
            const dist = Math.abs(price.close - expectedPrice);
            if (dist < minDist) {
              minDist = dist;
              nearestTrend = trend;
            }
          }
        }
      });

      if (nearestTrend && minDist < (candleData[0].high - candleData[0].low) * 5) {
        tooltip.innerHTML = \`
          <div><strong>\${nearestTrend.direction.toUpperCase()} - \${nearestTrend.strength.toUpperCase()}</strong></div>
          <div>Duration: \${nearestTrend.duration} velas</div>
          <div>Change: \${nearestTrend.pctChange}%</div>
          <div>Slope: \${nearestTrend.slopePct}%/vela</div>
        \`;
        tooltip.style.display = 'block';
        tooltip.style.left = param.point.x + 20 + 'px';
        tooltip.style.top = param.point.y + 20 + 'px';
      } else {
        tooltip.style.display = 'none';
      }
    });
  </script>
</body>
</html>`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              PLOT: Categorización de Tendencias');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  const dataPath = path.join(process.cwd(), DATA_FILE);
  console.log(`📂 Loading: ${DATA_FILE}`);

  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
  });

  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);
  console.log();

  // Detectar swings
  console.log('🔍 Detecting swing points...');
  const swings = detectSwingPoints(candles, 5);
  console.log(`   Found ${swings.length} swing points`);

  // Analizar tendencias
  console.log('📊 Analyzing trends...');
  const trends = analyzeTrends(swings);
  console.log(`   Found ${trends.length} trend segments`);
  console.log();

  // Estadísticas
  const byStrength = {
    weak: trends.filter(t => t.strength === 'weak'),
    moderate: trends.filter(t => t.strength === 'moderate'),
    strong: trends.filter(t => t.strength === 'strong'),
    explosive: trends.filter(t => t.strength === 'explosive'),
  };

  console.log('📈 Distribution by strength:');
  console.log(`   Weak:      ${byStrength.weak.length} (${(byStrength.weak.length / trends.length * 100).toFixed(1)}%)`);
  console.log(`   Moderate:  ${byStrength.moderate.length} (${(byStrength.moderate.length / trends.length * 100).toFixed(1)}%)`);
  console.log(`   Strong:    ${byStrength.strong.length} (${(byStrength.strong.length / trends.length * 100).toFixed(1)}%)`);
  console.log(`   Explosive: ${byStrength.explosive.length} (${(byStrength.explosive.length / trends.length * 100).toFixed(1)}%)`);
  console.log();

  // Generar chart
  console.log('🎨 Generating chart...');
  const html = generateChartHTML(candles, trends, ASSET);

  const outputDir = path.join(process.cwd(), 'charts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `trend_categories_${ASSET}_${new Date().toISOString().slice(0, 10)}.html`);
  fs.writeFileSync(outputFile, html);

  console.log(`   ✅ Chart saved: ${outputFile}`);
  console.log();
  console.log('💡 Abre el archivo HTML en tu navegador para ver el gráfico interactivo.');
  console.log('   - Puedes filtrar por tipo de tendencia usando los checkboxes');
  console.log('   - Las líneas más gruesas son tendencias más fuertes');
  console.log('   - Pasa el mouse sobre las líneas para ver detalles');
}

main().catch(console.error);
