/**
 * Backtest Reporters
 */

export {
  printBacktestResult,
  printMetrics,
  printMonteCarlo,
  printOOSResult,
  printCompactSummary,
} from './console-reporter.js';

export {
  toJSON,
  exportToJSON,
  loadFromJSON,
  generateFilename,
  quickExport,
  type JSONExportOptions,
} from './json-reporter.js';

export {
  generateChart,
  exportChart,
  quickExportChart,
  generateChartFilename,
  exportMultipleCharts,
  type ChartExportOptions,
} from './chart-reporter.js';
