/**
 * Interactive Chart Generator
 *
 * Generates an HTML chart with:
 * - Candlestick chart
 * - Volume bars
 * - Swing points (HH, HL, LH, LL)
 * - FVG zones
 * - Liquidity sweeps
 * - Structure breaks (BOS, CHoCH)
 */

import type { Bar } from '../binance-client.js';
import type { MarketStructure, SwingPoint, StructureBreak } from './market-structure.js';
import type { FVG } from './fvg-detector.js';
import type { LiquiditySweep, EqualLevel } from './liquidity-sweep-detector.js';

export interface ChartData {
  symbol: string;
  timeframe: string;
  candles: Bar[];
  structure: MarketStructure;
  fvgs: FVG[];
  sweeps: LiquiditySweep[];
  equalHighs: EqualLevel[];
  equalLows: EqualLevel[];
}

export function generateChart(data: ChartData): string {
  const { symbol, timeframe, candles, structure, fvgs, sweeps, equalHighs, equalLows } = data;

  // Prepare candlestick data
  const ohlcData = candles.map((c) => ({
    x: c.timestamp.getTime(),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
  }));

  // Prepare volume data
  const volumeData = candles.map((c) => ({
    x: c.timestamp.getTime(),
    y: c.volume,
    color: c.close >= c.open ? 'rgba(0, 150, 136, 0.5)' : 'rgba(255, 82, 82, 0.5)',
  }));

  // Prepare swing point annotations
  const swingAnnotations = [
    ...structure.swingHighs.map((s) => createSwingAnnotation(s, candles, 'high')),
    ...structure.swingLows.map((s) => createSwingAnnotation(s, candles, 'low')),
  ];

  // Prepare structure break annotations
  const bosAnnotations = structure.structureBreaks.map((b) =>
    createStructureBreakAnnotation(b, candles)
  );

  // Prepare FVG shapes
  const fvgShapes = fvgs.map((f) => createFVGShape(f, candles));

  // Prepare sweep annotations
  const sweepAnnotations = sweeps.map((s) => createSweepAnnotation(s, candles));

  // Prepare equal level lines
  const equalLevelShapes = [
    ...equalHighs.map((e) => createEqualLevelShape(e, candles, 'high')),
    ...equalLows.map((e) => createEqualLevelShape(e, candles, 'low')),
  ];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${symbol} ${timeframe} - Market Structure Analysis</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
    }
    .trend-badge {
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .trend-bullish { background: rgba(0, 150, 136, 0.2); color: #00c853; }
    .trend-bearish { background: rgba(255, 82, 82, 0.2); color: #ff5252; }
    .trend-neutral { background: rgba(255, 193, 7, 0.2); color: #ffc107; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 15px;
    }
    .stat-label { color: #8b949e; font-size: 12px; margin-bottom: 5px; }
    .stat-value { font-size: 20px; font-weight: 600; }
    #chart { width: 100%; height: 700px; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin-top: 20px;
      padding: 15px;
      background: #161b22;
      border-radius: 8px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .legend-color {
      width: 20px;
      height: 12px;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${symbol} ${timeframe} - Market Structure</h1>
    <span class="trend-badge trend-${structure.currentTrend}">
      ${structure.currentTrend} Trend
    </span>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Current Price</div>
      <div class="stat-value">$${candles[candles.length - 1].close.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Swing Highs</div>
      <div class="stat-value">${structure.swingHighs.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Swing Lows</div>
      <div class="stat-value">${structure.swingLows.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Open FVGs</div>
      <div class="stat-value">${fvgs.filter((f) => !f.mitigated).length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">BOS/CHoCH</div>
      <div class="stat-value">${structure.structureBreaks.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Liquidity Sweeps</div>
      <div class="stat-value">${sweeps.length}</div>
    </div>
  </div>

  <div id="chart"></div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-color" style="background: #00c853;"></div>
      <span>HH (Higher High)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #69f0ae;"></div>
      <span>HL (Higher Low)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #ff5252;"></div>
      <span>LH (Lower High)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #ff8a80;"></div>
      <span>LL (Lower Low)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: rgba(0, 150, 136, 0.3);"></div>
      <span>Bullish FVG</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: rgba(255, 82, 82, 0.3);"></div>
      <span>Bearish FVG</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #2196f3;"></div>
      <span>BOS (Break of Structure)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #ff9800;"></div>
      <span>CHoCH (Change of Character)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #e040fb;"></div>
      <span>Liquidity Sweep</span>
    </div>
  </div>

  <script>
    const ohlcData = ${JSON.stringify(ohlcData)};
    const volumeData = ${JSON.stringify(volumeData)};
    const swingAnnotations = ${JSON.stringify(swingAnnotations)};
    const bosAnnotations = ${JSON.stringify(bosAnnotations)};
    const fvgShapes = ${JSON.stringify(fvgShapes)};
    const sweepAnnotations = ${JSON.stringify(sweepAnnotations)};
    const equalLevelShapes = ${JSON.stringify(equalLevelShapes)};

    // Candlestick trace
    const candlestick = {
      type: 'candlestick',
      x: ohlcData.map(d => new Date(d.x)),
      open: ohlcData.map(d => d.o),
      high: ohlcData.map(d => d.h),
      low: ohlcData.map(d => d.l),
      close: ohlcData.map(d => d.c),
      increasing: { line: { color: '#00c853' } },
      decreasing: { line: { color: '#ff5252' } },
      name: 'Price',
      yaxis: 'y2',
    };

    // Volume trace
    const volume = {
      type: 'bar',
      x: volumeData.map(d => new Date(d.x)),
      y: volumeData.map(d => d.y),
      marker: { color: volumeData.map(d => d.color) },
      name: 'Volume',
      yaxis: 'y',
    };

    const layout = {
      paper_bgcolor: '#0d1117',
      plot_bgcolor: '#0d1117',
      font: { color: '#c9d1d9' },
      xaxis: {
        type: 'date',
        rangeslider: { visible: false },
        gridcolor: '#21262d',
        linecolor: '#30363d',
      },
      yaxis: {
        domain: [0, 0.2],
        gridcolor: '#21262d',
        linecolor: '#30363d',
        title: 'Volume',
      },
      yaxis2: {
        domain: [0.25, 1],
        gridcolor: '#21262d',
        linecolor: '#30363d',
        title: 'Price',
      },
      shapes: [...fvgShapes, ...equalLevelShapes].map(s => ({
        ...s,
        x0: new Date(s.x0),
        x1: new Date(s.x1),
        yref: 'y2',
      })),
      annotations: [...swingAnnotations, ...bosAnnotations, ...sweepAnnotations].map(a => ({
        ...a,
        x: new Date(a.x),
        yref: 'y2',
      })),
      margin: { t: 20, b: 40, l: 60, r: 40 },
      showlegend: false,
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
    };

    Plotly.newPlot('chart', [volume, candlestick], layout, config);
  </script>
</body>
</html>
`;
}

function createSwingAnnotation(
  swing: SwingPoint,
  candles: Bar[],
  position: 'high' | 'low'
): any {
  const colors: Record<string, string> = {
    HH: '#00c853',
    HL: '#69f0ae',
    LH: '#ff5252',
    LL: '#ff8a80',
  };

  const label = swing.label || (position === 'high' ? 'SH' : 'SL');
  const color = colors[label] || '#ffffff';

  return {
    x: swing.timestamp.getTime(),
    y: swing.price,
    xref: 'x',
    text: label,
    showarrow: true,
    arrowhead: 0,
    arrowsize: 1,
    arrowwidth: 1,
    arrowcolor: color,
    ax: 0,
    ay: position === 'high' ? -25 : 25,
    font: {
      size: 11,
      color: color,
      family: 'monospace',
    },
    bgcolor: '#161b22',
    bordercolor: color,
    borderwidth: 1,
    borderpad: 3,
  };
}

function createStructureBreakAnnotation(breakPoint: StructureBreak, candles: Bar[]): any {
  const isChoch = breakPoint.type === 'CHoCH';
  const color = isChoch ? '#ff9800' : '#2196f3';

  return {
    x: breakPoint.timestamp.getTime(),
    y: breakPoint.brokenLevel,
    xref: 'x',
    text: `${breakPoint.type}`,
    showarrow: true,
    arrowhead: 2,
    arrowsize: 1,
    arrowwidth: 2,
    arrowcolor: color,
    ax: breakPoint.direction === 'bullish' ? -30 : 30,
    ay: breakPoint.direction === 'bullish' ? 30 : -30,
    font: {
      size: 10,
      color: color,
      family: 'monospace',
    },
    bgcolor: '#161b22',
    bordercolor: color,
    borderwidth: 1,
    borderpad: 2,
  };
}

function createFVGShape(fvg: FVG, candles: Bar[]): any {
  const isBullish = fvg.type === 'bullish';
  const color = isBullish ? 'rgba(0, 150, 136, 0.2)' : 'rgba(255, 82, 82, 0.2)';
  const borderColor = isBullish ? 'rgba(0, 150, 136, 0.5)' : 'rgba(255, 82, 82, 0.5)';

  // FVG extends from creation to current candle (or mitigation)
  const endIndex = fvg.mitigated && fvg.mitigatedIndex ? fvg.mitigatedIndex : candles.length - 1;
  const startTime = candles[fvg.index].timestamp.getTime();
  const endTime = candles[endIndex].timestamp.getTime();

  return {
    type: 'rect',
    x0: startTime,
    x1: endTime,
    y0: fvg.bottom,
    y1: fvg.top,
    fillcolor: color,
    line: {
      color: borderColor,
      width: 1,
      dash: fvg.mitigated ? 'dot' : 'solid',
    },
    opacity: fvg.mitigated ? 0.3 : 0.6,
  };
}

function createSweepAnnotation(sweep: LiquiditySweep, candles: Bar[]): any {
  const isHigh = sweep.type === 'high';

  return {
    x: sweep.timestamp.getTime(),
    y: isHigh ? sweep.sweepHigh : sweep.sweepLow,
    xref: 'x',
    text: '💧',
    showarrow: true,
    arrowhead: 0,
    arrowsize: 1,
    arrowwidth: 2,
    arrowcolor: '#e040fb',
    ax: 0,
    ay: isHigh ? -20 : 20,
    font: { size: 14 },
  };
}

function createEqualLevelShape(level: EqualLevel, candles: Bar[], type: 'high' | 'low'): any {
  const color = type === 'high' ? 'rgba(255, 193, 7, 0.3)' : 'rgba(156, 39, 176, 0.3)';

  // Line spans from first to last touch
  const firstIndex = Math.min(...level.indices);
  const lastIndex = Math.max(...level.indices);

  return {
    type: 'line',
    x0: candles[firstIndex].timestamp.getTime(),
    x1: candles[Math.min(lastIndex + 20, candles.length - 1)].timestamp.getTime(),
    y0: level.price,
    y1: level.price,
    line: {
      color,
      width: 2,
      dash: 'dot',
    },
  };
}
