/**
 * Chart Reporter for Backtest Results
 *
 * Generates interactive HTML charts using the visualization module.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  generateChartHTML,
  createVisualizationData,
  type ChartGeneratorOptions,
} from '@deriv-bot/shared';
import type { BacktestResult } from '../types.js';

/**
 * Options for chart generation
 */
export interface ChartExportOptions {
  /** Chart title */
  title?: string;
  /** Theme (dark or light) */
  theme?: 'dark' | 'light';
  /** Chart width */
  width?: number;
  /** Chart height */
  height?: number;
  /** Indicators to show */
  showIndicators?: ('rsi' | 'bbands' | 'squeeze' | 'macd' | 'kc')[];
  /** Open in browser after generation */
  openInBrowser?: boolean;
}

const DEFAULT_OPTIONS: ChartExportOptions = {
  theme: 'dark',
  width: 1400,
  height: 900,
  showIndicators: ['rsi', 'bbands', 'squeeze'],
  openInBrowser: false,
};

/**
 * Generate HTML chart from backtest result
 */
export function generateChart(
  result: BacktestResult,
  options?: ChartExportOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Build title
  const title =
    opts.title ??
    `${result.strategyName} Backtest - ${result.asset} (${result.dateRange.from.toISOString().split('T')[0]} to ${result.dateRange.to.toISOString().split('T')[0]})`;

  // Convert indicator series Map to object
  const indicators: Record<string, number[]> = {};
  for (const [key, values] of result.indicatorSeries.entries()) {
    indicators[key] = values;
  }

  // Create visualization data
  const vizData = createVisualizationData(
    result.asset,
    result.timeframe,
    result.candles,
    result.trades,
    indicators
  );

  // Generate HTML
  const chartOptions: ChartGeneratorOptions = {
    title,
    theme: opts.theme,
    width: opts.width,
    height: opts.height,
    showIndicators: opts.showIndicators,
  };

  return generateChartHTML(vizData, chartOptions);
}

/**
 * Export chart to HTML file
 */
export function exportChart(
  result: BacktestResult,
  outputPath: string,
  options?: ChartExportOptions
): string {
  const html = generateChart(result, options);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, html, 'utf-8');

  // Open in browser if requested
  if (options?.openInBrowser) {
    openInBrowser(outputPath);
  }

  return outputPath;
}

/**
 * Generate default filename
 */
export function generateChartFilename(result: BacktestResult): string {
  const date = result.executedAt.toISOString().split('T')[0];
  const time = result.executedAt.toISOString().split('T')[1]?.split('.')[0]?.replace(/:/g, '');
  return `chart_${result.strategyName}_${result.asset}_${date}_${time}.html`;
}

/**
 * Quick export to default location
 */
export function quickExportChart(
  result: BacktestResult,
  baseDir?: string,
  options?: ChartExportOptions
): string {
  const dir = baseDir ?? path.join(process.cwd(), 'analysis-output');
  const filename = generateChartFilename(result);
  return exportChart(result, path.join(dir, filename), options);
}

/**
 * Open file in default browser
 */
function openInBrowser(filePath: string): void {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  const url = `file://${absolutePath}`;

  // Platform-specific open command
  const { platform } = process;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  // Execute async, don't wait
  import('child_process').then(({ exec }) => {
    exec(command, (error) => {
      if (error) {
        console.warn(`Could not open browser: ${error.message}`);
      }
    });
  });
}

/**
 * Generate charts for multiple results
 */
export function exportMultipleCharts(
  results: BacktestResult[],
  baseDir: string,
  options?: ChartExportOptions
): string[] {
  const paths: string[] = [];

  for (const result of results) {
    const filename = generateChartFilename(result);
    const filePath = exportChart(result, path.join(baseDir, filename), options);
    paths.push(filePath);
  }

  return paths;
}
