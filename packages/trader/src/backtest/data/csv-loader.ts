/**
 * CSV Loader for Backtest Engine
 *
 * Unified CSV loading with support for multiple formats.
 * Consolidates all CSV loading logic in one place.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';

/**
 * CSV parsing options
 */
export interface CSVLoadOptions {
  /** Column name or index for timestamp (default: 'timestamp' or 0) */
  timestampColumn?: string | number;
  /** Column name or index for open (default: 'open' or 1) */
  openColumn?: string | number;
  /** Column name or index for high (default: 'high' or 2) */
  highColumn?: string | number;
  /** Column name or index for low (default: 'low' or 3) */
  lowColumn?: string | number;
  /** Column name or index for close (default: 'close' or 4) */
  closeColumn?: string | number;
  /** Delimiter (default: ',') */
  delimiter?: string;
  /** Has header row (default: true) */
  hasHeader?: boolean;
  /** Timestamp format: 'unix_s', 'unix_ms', 'iso' (default: 'unix_s') */
  timestampFormat?: 'unix_s' | 'unix_ms' | 'iso';
  /** Asset name to set on candles */
  asset?: string;
  /** Timeframe in seconds */
  timeframe?: number;
  /** Skip rows with invalid data (default: true) */
  skipInvalid?: boolean;
}

const DEFAULT_OPTIONS: Required<CSVLoadOptions> = {
  timestampColumn: 'timestamp',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  delimiter: ',',
  hasHeader: true,
  timestampFormat: 'unix_s',
  asset: 'UNKNOWN',
  timeframe: 60,
  skipInvalid: true,
};

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Get column index from header or use numeric index
 */
function getColumnIndex(
  column: string | number,
  headers: string[]
): number {
  if (typeof column === 'number') {
    return column;
  }

  const index = headers.findIndex(
    (h) => h.toLowerCase() === column.toLowerCase()
  );

  if (index === -1) {
    throw new Error(`Column "${column}" not found in headers: ${headers.join(', ')}`);
  }

  return index;
}

/**
 * Parse timestamp based on format
 */
function parseTimestamp(value: string, format: 'unix_s' | 'unix_ms' | 'iso'): number {
  switch (format) {
    case 'unix_s':
      return parseInt(value, 10);
    case 'unix_ms':
      return Math.floor(parseInt(value, 10) / 1000);
    case 'iso':
      return Math.floor(new Date(value).getTime() / 1000);
    default:
      return parseInt(value, 10);
  }
}

/**
 * Load candles from a CSV file
 */
export function loadCandlesFromCSV(
  filePath: string,
  options?: CSVLoadOptions
): Candle[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Read file
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`CSV file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error(`CSV file is empty: ${absolutePath}`);
  }

  // Parse header
  let headers: string[] = [];
  let dataStartIndex = 0;

  if (opts.hasHeader) {
    headers = parseCSVLine(lines[0]!, opts.delimiter);
    dataStartIndex = 1;
  } else {
    // Generate numeric headers
    const firstLine = parseCSVLine(lines[0]!, opts.delimiter);
    headers = firstLine.map((_, i) => i.toString());
  }

  // Get column indices
  const tsIdx = getColumnIndex(opts.timestampColumn, headers);
  const openIdx = getColumnIndex(opts.openColumn, headers);
  const highIdx = getColumnIndex(opts.highColumn, headers);
  const lowIdx = getColumnIndex(opts.lowColumn, headers);
  const closeIdx = getColumnIndex(opts.closeColumn, headers);

  // Parse candles
  const candles: Candle[] = [];
  let skipped = 0;

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i]!;
    const values = parseCSVLine(line, opts.delimiter);

    try {
      const timestamp = parseTimestamp(values[tsIdx]!, opts.timestampFormat);
      const open = parseFloat(values[openIdx]!);
      const high = parseFloat(values[highIdx]!);
      const low = parseFloat(values[lowIdx]!);
      const close = parseFloat(values[closeIdx]!);

      // Validate
      if (isNaN(timestamp) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
        if (opts.skipInvalid) {
          skipped++;
          continue;
        }
        throw new Error(`Invalid numeric value on line ${i + 1}`);
      }

      candles.push({
        asset: opts.asset,
        timeframe: opts.timeframe,
        timestamp,
        open,
        high,
        low,
        close,
      });
    } catch (error) {
      if (opts.skipInvalid) {
        skipped++;
        continue;
      }
      throw error;
    }
  }

  if (skipped > 0) {
    console.warn(`Skipped ${skipped} invalid rows while loading CSV`);
  }

  // Sort by timestamp ascending
  candles.sort((a, b) => a.timestamp - b.timestamp);

  return candles;
}

/**
 * Load candles from multiple CSV files and merge them
 */
export function loadCandlesFromMultipleCSV(
  filePaths: string[],
  options?: CSVLoadOptions
): Candle[] {
  const allCandles: Candle[] = [];

  for (const filePath of filePaths) {
    const candles = loadCandlesFromCSV(filePath, options);
    allCandles.push(...candles);
  }

  // Sort and deduplicate by timestamp
  allCandles.sort((a, b) => a.timestamp - b.timestamp);

  const deduped: Candle[] = [];
  let lastTimestamp = -1;

  for (const candle of allCandles) {
    if (candle.timestamp !== lastTimestamp) {
      deduped.push(candle);
      lastTimestamp = candle.timestamp;
    }
  }

  return deduped;
}

/**
 * Get info about a CSV file without loading all data
 */
export function getCSVInfo(
  filePath: string,
  options?: Pick<CSVLoadOptions, 'delimiter' | 'hasHeader'>
): {
  rowCount: number;
  headers: string[];
  sampleRow: string[];
  fileSizeBytes: number;
} {
  const opts = { delimiter: ',', hasHeader: true, ...options };

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  const stats = fs.statSync(absolutePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  const headers = opts.hasHeader
    ? parseCSVLine(lines[0]!, opts.delimiter)
    : [];

  const sampleRow =
    lines.length > 1 ? parseCSVLine(lines[1]!, opts.delimiter) : [];

  return {
    rowCount: opts.hasHeader ? lines.length - 1 : lines.length,
    headers,
    sampleRow,
    fileSizeBytes: stats.size,
  };
}

/**
 * Auto-detect CSV format based on content
 */
export function detectCSVFormat(filePath: string): CSVLoadOptions {
  const info = getCSVInfo(filePath);
  const options: CSVLoadOptions = {};

  // Check for common column names
  const lowerHeaders = info.headers.map((h) => h.toLowerCase());

  // Timestamp column detection
  const tsVariants = ['timestamp', 'time', 'date', 'datetime', 'epoch'];
  for (const variant of tsVariants) {
    const idx = lowerHeaders.indexOf(variant);
    if (idx !== -1) {
      options.timestampColumn = info.headers[idx];
      break;
    }
  }

  // OHLC detection
  const ohlcVariants = {
    open: ['open', 'o', 'open_price'],
    high: ['high', 'h', 'high_price'],
    low: ['low', 'l', 'low_price'],
    close: ['close', 'c', 'close_price'],
  };

  for (const [key, variants] of Object.entries(ohlcVariants)) {
    for (const variant of variants) {
      const idx = lowerHeaders.indexOf(variant);
      if (idx !== -1) {
        (options as Record<string, unknown>)[`${key}Column`] = info.headers[idx];
        break;
      }
    }
  }

  // Detect timestamp format from sample
  if (info.sampleRow.length > 0) {
    const tsIdx = options.timestampColumn
      ? info.headers.findIndex(
          (h) => h.toLowerCase() === (options.timestampColumn as string).toLowerCase()
        )
      : 0;

    const tsValue = info.sampleRow[tsIdx];

    if (tsValue) {
      if (tsValue.includes('T') || tsValue.includes('-')) {
        options.timestampFormat = 'iso';
      } else if (tsValue.length > 10) {
        options.timestampFormat = 'unix_ms';
      } else {
        options.timestampFormat = 'unix_s';
      }
    }
  }

  return options;
}

/**
 * Quick load with auto-detection
 */
export function quickLoadCSV(
  filePath: string,
  asset: string,
  timeframe: number
): Candle[] {
  const detected = detectCSVFormat(filePath);
  return loadCandlesFromCSV(filePath, { ...detected, asset, timeframe });
}
