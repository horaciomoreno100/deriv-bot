/**
 * JSON Reporter for Backtest Results
 *
 * Exports backtest results to JSON files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BacktestResult } from '../types.js';

/**
 * Options for JSON export
 */
export interface JSONExportOptions {
  /** Pretty print with indentation */
  pretty?: boolean;
  /** Include full candle data */
  includeCandles?: boolean;
  /** Include indicator series */
  includeIndicators?: boolean;
  /** Include individual trades */
  includeTrades?: boolean;
}

const DEFAULT_OPTIONS: JSONExportOptions = {
  pretty: true,
  includeCandles: false,
  includeIndicators: false,
  includeTrades: true,
};

/**
 * Convert BacktestResult to a JSON-serializable object
 */
export function toJSON(
  result: BacktestResult,
  options?: JSONExportOptions
): Record<string, unknown> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const json: Record<string, unknown> = {
    metadata: {
      asset: result.asset,
      timeframe: result.timeframe,
      strategyName: result.strategyName,
      strategyVersion: result.strategyVersion,
      executedAt: result.executedAt.toISOString(),
      executionTimeMs: result.executionTimeMs,
    },
    config: result.config,
    dateRange: {
      from: result.dateRange.from.toISOString(),
      to: result.dateRange.to.toISOString(),
      candleCount: result.dateRange.candleCount,
    },
    metrics: result.metrics,
  };

  if (opts.includeTrades) {
    json.trades = result.trades;
  } else {
    json.tradeCount = result.trades.length;
  }

  if (opts.includeCandles) {
    json.candles = result.candles;
  }

  if (opts.includeIndicators) {
    // Convert Map to plain object
    const indicators: Record<string, number[]> = {};
    for (const [key, values] of result.indicatorSeries.entries()) {
      indicators[key] = values;
    }
    json.indicators = indicators;
  }

  if (result.monteCarlo) {
    json.monteCarlo = result.monteCarlo;
  }

  if (result.walkForward) {
    json.walkForward = result.walkForward;
  }

  if (result.oosTest) {
    json.oosTest = result.oosTest;
  }

  return json;
}

/**
 * Export backtest result to JSON file
 */
export function exportToJSON(
  result: BacktestResult,
  outputPath: string,
  options?: JSONExportOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const json = toJSON(result, opts);

  const content = opts.pretty
    ? JSON.stringify(json, null, 2)
    : JSON.stringify(json);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf-8');

  return outputPath;
}

/**
 * Generate default filename for result
 */
export function generateFilename(result: BacktestResult): string {
  const date = result.executedAt.toISOString().split('T')[0];
  const time = result.executedAt.toISOString().split('T')[1]?.split('.')[0]?.replace(/:/g, '');
  return `backtest_${result.strategyName}_${result.asset}_${date}_${time}.json`;
}

/**
 * Export to default location
 */
export function quickExport(result: BacktestResult, baseDir?: string): string {
  const dir = baseDir ?? path.join(process.cwd(), 'analysis-output');
  const filename = generateFilename(result);
  return exportToJSON(result, path.join(dir, filename));
}

/**
 * Load a backtest result from JSON file
 */
export function loadFromJSON(filePath: string): BacktestResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(content);

  // Reconstruct dates and Map
  const result: BacktestResult = {
    ...json,
    dateRange: {
      from: new Date(json.dateRange.from),
      to: new Date(json.dateRange.to),
      candleCount: json.dateRange.candleCount,
    },
    executedAt: new Date(json.metadata.executedAt),
    executionTimeMs: json.metadata.executionTimeMs,
    indicatorSeries: new Map(),
    candles: json.candles ?? [],
    trades: json.trades ?? [],
  };

  // Reconstruct indicator series if present
  if (json.indicators) {
    for (const [key, values] of Object.entries(json.indicators)) {
      result.indicatorSeries.set(key, values as number[]);
    }
  }

  return result;
}
