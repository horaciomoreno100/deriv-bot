/**
 * Chart Generator using Plotly.js
 *
 * Generates interactive HTML charts from backtest or live trading data.
 * Features:
 * - Candlestick chart with trades overlay
 * - Indicator subplots (RSI, Squeeze, etc.)
 * - Rich tooltips with full trade context
 * - Entry/exit markers with annotations
 */

import type {
  ChartVisualizationData,
  TradeWithContext,
} from '../types/visualization.js';
import type { Candle } from '../types/market.js';

/**
 * Options for chart generation
 */
export interface ChartGeneratorOptions {
  /** Output file path */
  output?: string;

  /** Chart title */
  title?: string;

  /** Width in pixels */
  width?: number;

  /** Height in pixels */
  height?: number;

  /** Theme */
  theme?: 'dark' | 'light';

  /** Show which indicators */
  showIndicators?: ('rsi' | 'bbands' | 'squeeze' | 'macd' | 'volume')[];

  /** Show trade markers */
  showTrades?: boolean;

  /** Show signal markers */
  showSignals?: boolean;
}

const DEFAULT_OPTIONS: Required<ChartGeneratorOptions> = {
  output: './chart.html',
  title: 'Trading Analysis',
  width: 1400,
  height: 900,
  theme: 'dark',
  showIndicators: ['rsi', 'bbands', 'squeeze'],
  showTrades: true,
  showSignals: true,
};

/**
 * Color palette for dark theme
 */
const COLORS = {
  dark: {
    background: '#0e0e0e',
    paper: '#1a1a1a',
    text: '#e0e0e0',
    grid: '#2a2a2a',
    candleUp: '#22c55e',
    candleDown: '#ef4444',
    bbUpper: '#3b82f6',
    bbMiddle: '#6b7280',
    bbLower: '#3b82f6',
    entryCall: '#22c55e',
    entryPut: '#ef4444',
    exitWin: '#22c55e',
    exitLoss: '#ef4444',
    signal: '#f59e0b',
    rsi: '#a855f7',
    rsiOverbought: '#ef4444',
    rsiOversold: '#22c55e',
    squeezeOn: '#ef4444',
    squeezeOff: '#22c55e',
  },
  light: {
    background: '#ffffff',
    paper: '#f5f5f5',
    text: '#1a1a1a',
    grid: '#e0e0e0',
    candleUp: '#16a34a',
    candleDown: '#dc2626',
    bbUpper: '#2563eb',
    bbMiddle: '#6b7280',
    bbLower: '#2563eb',
    entryCall: '#16a34a',
    entryPut: '#dc2626',
    exitWin: '#16a34a',
    exitLoss: '#dc2626',
    signal: '#d97706',
    rsi: '#9333ea',
    rsiOverbought: '#dc2626',
    rsiOversold: '#16a34a',
    squeezeOn: '#dc2626',
    squeezeOff: '#16a34a',
  },
};

/**
 * Generate Plotly chart data from visualization data
 */
export function generatePlotlyData(
  data: ChartVisualizationData,
  options: ChartGeneratorOptions = {}
): { data: unknown[]; layout: unknown; config: unknown } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const colors = COLORS[opts.theme];

  const traces: unknown[] = [];
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];

  // Calculate subplot layout
  const hasRsi = opts.showIndicators.includes('rsi');
  const hasSqueeze = opts.showIndicators.includes('squeeze');

  // Convert candles to Plotly format
  const candleTimestamps = data.candles.map((c) =>
    new Date(c.timestamp * 1000).toISOString()
  );
  const opens = data.candles.map((c) => c.open);
  const highs = data.candles.map((c) => c.high);
  const lows = data.candles.map((c) => c.low);
  const closes = data.candles.map((c) => c.close);

  // 1. Candlestick trace
  traces.push({
    type: 'candlestick',
    x: candleTimestamps,
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    name: 'Price',
    increasing: { line: { color: colors.candleUp } },
    decreasing: { line: { color: colors.candleDown } },
    yaxis: 'y',
    xaxis: 'x',
  });

  // 2. Bollinger Bands (if enabled)
  if (opts.showIndicators.includes('bbands')) {
    const bbUpperData = data.indicatorSeries.find((s) => s.name === 'bbUpper');
    const bbMiddleData = data.indicatorSeries.find(
      (s) => s.name === 'bbMiddle'
    );
    const bbLowerData = data.indicatorSeries.find((s) => s.name === 'bbLower');

    if (bbUpperData) {
      traces.push({
        type: 'scatter',
        x: bbUpperData.data.map((d) => new Date(d[0] * 1000).toISOString()),
        y: bbUpperData.data.map((d) => d[1]),
        name: 'BB Upper',
        line: { color: colors.bbUpper, width: 1, dash: 'dot' },
        yaxis: 'y',
        xaxis: 'x',
      });
    }

    if (bbMiddleData) {
      traces.push({
        type: 'scatter',
        x: bbMiddleData.data.map((d) => new Date(d[0] * 1000).toISOString()),
        y: bbMiddleData.data.map((d) => d[1]),
        name: 'BB Middle',
        line: { color: colors.bbMiddle, width: 1 },
        yaxis: 'y',
        xaxis: 'x',
      });
    }

    if (bbLowerData) {
      traces.push({
        type: 'scatter',
        x: bbLowerData.data.map((d) => new Date(d[0] * 1000).toISOString()),
        y: bbLowerData.data.map((d) => d[1]),
        name: 'BB Lower',
        line: { color: colors.bbLower, width: 1, dash: 'dot' },
        yaxis: 'y',
        xaxis: 'x',
      });
    }
  }

  // 3. Trade markers
  if (opts.showTrades && data.trades.length > 0) {
    const entries = data.trades.map((t) => ({
      x: new Date(t.entry.snapshot.timestamp).toISOString(),
      y: t.entry.executedPrice,
      trade: t,
    }));

    const exits = data.trades
      .filter((t) => t.exit)
      .map((t) => ({
        x: new Date(t.exit!.snapshot.timestamp).toISOString(),
        y: t.exit!.executedPrice,
        trade: t,
      }));

    // Entry markers
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: entries.map((e) => e.x),
      y: entries.map((e) => e.y),
      name: 'Entries',
      marker: {
        symbol: entries.map((e) =>
          e.trade.direction === 'CALL' ? 'triangle-up' : 'triangle-down'
        ),
        size: 12,
        color: entries.map((e) =>
          e.trade.direction === 'CALL' ? colors.entryCall : colors.entryPut
        ),
        line: { width: 1, color: colors.text },
      },
      text: entries.map(
        (e) =>
          `<b>ENTRY ${e.trade.direction}</b><br>` +
          `Price: ${e.trade.entry.executedPrice.toFixed(4)}<br>` +
          `RSI: ${e.trade.entry.snapshot.indicators.rsi?.toFixed(1) ?? 'N/A'}<br>` +
          `Squeeze: ${e.trade.entry.snapshot.indicators.squeezeOn ? 'ON' : 'OFF'}<br>` +
          `Latency: ${e.trade.entry.latencyMs}ms<br>` +
          `Slippage: ${(e.trade.entry.slippagePct * 100).toFixed(3)}%`
      ),
      hoverinfo: 'text',
      yaxis: 'y',
      xaxis: 'x',
    });

    // Exit markers
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: exits.map((e) => e.x),
      y: exits.map((e) => e.y),
      name: 'Exits',
      marker: {
        symbol: 'x',
        size: 10,
        color: exits.map((e) =>
          e.trade.result.outcome === 'WIN' ? colors.exitWin : colors.exitLoss
        ),
        line: { width: 2 },
      },
      text: exits.map(
        (e) =>
          `<b>EXIT ${e.trade.exit!.reason}</b><br>` +
          `Price: ${e.trade.exit!.executedPrice.toFixed(4)}<br>` +
          `P/L: ${e.trade.result.pnl >= 0 ? '+' : ''}${e.trade.result.pnl.toFixed(2)} (${(e.trade.result.pnlPct * 100).toFixed(2)}%)<br>` +
          `RSI: ${e.trade.exit!.snapshot.indicators.rsi?.toFixed(1) ?? 'N/A'}<br>` +
          `Duration: ${(e.trade.exit!.durationMs / 1000).toFixed(0)}s`
      ),
      hoverinfo: 'text',
      yaxis: 'y',
      xaxis: 'x',
    });

    // Draw lines connecting entry to exit
    data.trades
      .filter((t) => t.exit)
      .forEach((t) => {
        shapes.push({
          type: 'line',
          x0: new Date(t.entry.snapshot.timestamp).toISOString(),
          y0: t.entry.executedPrice,
          x1: new Date(t.exit!.snapshot.timestamp).toISOString(),
          y1: t.exit!.executedPrice,
          line: {
            color:
              t.result.outcome === 'WIN' ? colors.exitWin : colors.exitLoss,
            width: 1,
            dash: 'dot',
          },
          opacity: 0.5,
        });
      });
  }

  // 4. RSI subplot (if enabled)
  if (hasRsi) {
    const rsiData = data.indicatorSeries.find((s) => s.name === 'rsi');
    if (rsiData) {
      traces.push({
        type: 'scatter',
        x: rsiData.data.map((d) => new Date(d[0] * 1000).toISOString()),
        y: rsiData.data.map((d) => d[1]),
        name: 'RSI',
        line: { color: colors.rsi, width: 1 },
        yaxis: 'y2',
        xaxis: 'x',
      });

      // RSI reference lines
      shapes.push({
        type: 'line',
        x0: candleTimestamps[0],
        x1: candleTimestamps[candleTimestamps.length - 1],
        y0: 70,
        y1: 70,
        yref: 'y2',
        line: { color: colors.rsiOverbought, width: 1, dash: 'dash' },
      });
      shapes.push({
        type: 'line',
        x0: candleTimestamps[0],
        x1: candleTimestamps[candleTimestamps.length - 1],
        y0: 30,
        y1: 30,
        yref: 'y2',
        line: { color: colors.rsiOversold, width: 1, dash: 'dash' },
      });
    }
  }

  // 5. Squeeze histogram (if enabled)
  if (hasSqueeze) {
    const squeezeData = data.indicatorSeries.find(
      (s) => s.name === 'squeezeHistogram'
    );
    if (squeezeData) {
      traces.push({
        type: 'bar',
        x: squeezeData.data.map((d) => new Date(d[0] * 1000).toISOString()),
        y: squeezeData.data.map((d) => d[1]),
        name: 'Squeeze',
        marker: {
          color: squeezeData.data.map((d) =>
            d[1] >= 0 ? colors.squeezeOff : colors.squeezeOn
          ),
        },
        yaxis: 'y3',
        xaxis: 'x',
      });
    }
  }

  // Layout
  const layout: Record<string, unknown> = {
    title: {
      text: opts.title || data.title,
      font: { color: colors.text, size: 16 },
    },
    width: opts.width,
    height: opts.height,
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.background,
    font: { color: colors.text },
    showlegend: true,
    legend: {
      orientation: 'h',
      y: 1.02,
      x: 0.5,
      xanchor: 'center',
    },
    xaxis: {
      type: 'date',
      rangeslider: { visible: false },
      gridcolor: colors.grid,
      showgrid: true,
    },
    yaxis: {
      title: 'Price',
      side: 'right',
      gridcolor: colors.grid,
      showgrid: true,
      domain: hasRsi || hasSqueeze ? [0.35, 1] : [0, 1],
    },
    shapes,
    annotations,
    hovermode: 'x unified',
  };

  // Add RSI y-axis if needed
  if (hasRsi) {
    layout['yaxis2'] = {
      title: 'RSI',
      side: 'right',
      gridcolor: colors.grid,
      showgrid: true,
      domain: hasSqueeze ? [0.15, 0.3] : [0, 0.3],
      range: [0, 100],
    };
  }

  // Add Squeeze y-axis if needed
  if (hasSqueeze) {
    layout['yaxis3'] = {
      title: 'Squeeze',
      side: 'right',
      gridcolor: colors.grid,
      showgrid: false,
      domain: [0, 0.12],
    };
  }

  const config = {
    responsive: true,
    scrollZoom: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  };

  return { data: traces, layout, config };
}

/**
 * Generate standalone HTML file with the chart
 */
export function generateChartHTML(
  data: ChartVisualizationData,
  options: ChartGeneratorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { data: plotData, layout, config } = generatePlotlyData(data, opts);

  const summaryHtml = `
    <div style="padding: 10px; background: ${opts.theme === 'dark' ? '#1a1a1a' : '#f5f5f5'}; color: ${opts.theme === 'dark' ? '#e0e0e0' : '#1a1a1a'}; font-family: monospace; margin-bottom: 10px;">
      <h3 style="margin: 0 0 10px 0;">${data.asset} - Summary</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
        <div>Trades: <b>${data.summary.totalTrades}</b></div>
        <div>Win Rate: <b>${(data.summary.winRate * 100).toFixed(1)}%</b></div>
        <div>P/L: <b style="color: ${data.summary.totalPnl >= 0 ? '#22c55e' : '#ef4444'}">
          ${data.summary.totalPnl >= 0 ? '+' : ''}$${data.summary.totalPnl.toFixed(2)}</b></div>
        <div>Profit Factor: <b>${data.summary.profitFactor.toFixed(2)}</b></div>
        <div>Max Drawdown: <b style="color: #ef4444">${(data.summary.maxDrawdown * 100).toFixed(1)}%</b></div>
        ${data.summary.avgLatencyMs !== undefined ? `<div>Avg Latency: <b>${data.summary.avgLatencyMs.toFixed(0)}ms</b></div>` : ''}
        ${data.summary.avgSlippagePct !== undefined ? `<div>Avg Slippage: <b>${(data.summary.avgSlippagePct * 100).toFixed(3)}%</b></div>` : ''}
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <title>${opts.title}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: ${opts.theme === 'dark' ? '#0e0e0e' : '#ffffff'};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #chart {
      width: 100%;
      max-width: ${opts.width}px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  ${summaryHtml}
  <div id="chart"></div>
  <script>
    const data = ${JSON.stringify(plotData)};
    const layout = ${JSON.stringify(layout)};
    const config = ${JSON.stringify(config)};
    Plotly.newPlot('chart', data, layout, config);
  </script>
</body>
</html>`;
}

/**
 * Create ChartVisualizationData from trades and candles
 * Helper to convert backtest output to visualization format
 */
export function createVisualizationData(
  asset: string,
  timeframe: number,
  candles: Candle[],
  trades: TradeWithContext[],
  indicatorData: {
    rsi?: number[];
    bbUpper?: number[];
    bbMiddle?: number[];
    bbLower?: number[];
    squeezeHistogram?: number[];
  } = {}
): ChartVisualizationData {
  const indicatorSeries: ChartVisualizationData['indicatorSeries'] = [];

  // Convert indicator arrays to series format
  if (indicatorData.rsi) {
    indicatorSeries.push({
      name: 'rsi',
      data: indicatorData.rsi.map((v, i) => [candles[i]?.timestamp ?? 0, v]),
      panel: 'oscillator',
      color: '#a855f7',
      style: 'solid',
    });
  }

  if (indicatorData.bbUpper) {
    indicatorSeries.push({
      name: 'bbUpper',
      data: indicatorData.bbUpper.map((v, i) => [
        candles[i]?.timestamp ?? 0,
        v,
      ]),
      panel: 'main',
      color: '#3b82f6',
      style: 'dotted',
    });
  }

  if (indicatorData.bbMiddle) {
    indicatorSeries.push({
      name: 'bbMiddle',
      data: indicatorData.bbMiddle.map((v, i) => [
        candles[i]?.timestamp ?? 0,
        v,
      ]),
      panel: 'main',
      color: '#6b7280',
      style: 'solid',
    });
  }

  if (indicatorData.bbLower) {
    indicatorSeries.push({
      name: 'bbLower',
      data: indicatorData.bbLower.map((v, i) => [
        candles[i]?.timestamp ?? 0,
        v,
      ]),
      panel: 'main',
      color: '#3b82f6',
      style: 'dotted',
    });
  }

  if (indicatorData.squeezeHistogram) {
    indicatorSeries.push({
      name: 'squeezeHistogram',
      data: indicatorData.squeezeHistogram.map((v, i) => [
        candles[i]?.timestamp ?? 0,
        v,
      ]),
      panel: 'volume',
      color: '#22c55e',
      style: 'solid',
    });
  }

  // Calculate summary
  const wins = trades.filter((t) => t.result.outcome === 'WIN').length;
  const totalPnl = trades.reduce((sum, t) => sum + t.result.pnl, 0);
  const avgLatency =
    trades.length > 0
      ? trades.reduce((sum, t) => sum + t.entry.latencyMs, 0) / trades.length
      : undefined;
  const avgSlippage =
    trades.length > 0
      ? trades.reduce((sum, t) => sum + Math.abs(t.entry.slippagePct), 0) /
        trades.length
      : undefined;

  // Calculate profit factor
  const grossProfit = trades
    .filter((t) => t.result.pnl > 0)
    .reduce((sum, t) => sum + t.result.pnl, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.result.pnl < 0).reduce((sum, t) => sum + t.result.pnl, 0)
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Calculate max drawdown (as percentage of peak equity or initial capital)
  // Use initial capital of 10000 as reference when equity never goes positive
  const INITIAL_CAPITAL = 10000;
  let maxDrawdown = 0;
  let peak = INITIAL_CAPITAL; // Start from initial capital, not 0
  let equity = INITIAL_CAPITAL;
  for (const trade of trades) {
    equity += trade.result.pnl;
    if (equity > peak) peak = equity;
    // Drawdown is the percentage drop from peak
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    asset,
    timeframe,
    title: `${asset} - Backtest Analysis`,
    candles,
    trades,
    annotations: [],
    indicatorSeries,
    summary: {
      totalTrades: trades.length,
      winRate: trades.length > 0 ? wins / trades.length : 0,
      totalPnl,
      avgLatencyMs: avgLatency,
      avgSlippagePct: avgSlippage,
      maxDrawdown,
      profitFactor,
    },
  };
}
