/**
 * Unified Backtest Engine
 *
 * A comprehensive backtesting system for trading strategies.
 *
 * @example
 * ```typescript
 * import {
 *   runBacktest,
 *   loadCandlesFromCSV,
 *   printBacktestResult,
 *   exportChart,
 * } from './backtest';
 *
 * // Load data
 * const candles = loadCandlesFromCSV('data.csv', { asset: 'R_100', timeframe: 60 });
 *
 * // Run backtest
 * const result = runBacktest(myStrategy, candles, {
 *   initialBalance: 1000,
 *   multiplier: 100,
 * });
 *
 * // Print and export
 * printBacktestResult(result);
 * exportChart(result, 'backtest-chart.html');
 * ```
 */

// Types
export * from './types.js';

// Engine
export {
  EventCollector,
  createEventCollector,
  executeTradeWithContext,
  createTradeEntry,
  createMarketSnapshot,
  calculateStake,
  calculateTpSlPrices,
} from './engine/index.js';

// Data
export {
  loadCandlesFromCSV,
  loadCandlesFromMultipleCSV,
  getCSVInfo,
  detectCSVFormat,
  quickLoadCSV,
  createIndicatorCache,
  getAvailableIndicators,
  type CSVLoadOptions,
  type IndicatorSeries,
  type CachedIndicators,
} from './data/index.js';

// Runners
export { runBacktest, type RunBacktestOptions } from './runners/index.js';

// Reporters
export {
  printBacktestResult,
  printMetrics,
  printMonteCarlo,
  printOOSResult,
  printCompactSummary,
  toJSON,
  exportToJSON,
  loadFromJSON,
  generateFilename,
  quickExport,
  generateChart,
  exportChart,
  quickExportChart,
  generateChartFilename,
  exportMultipleCharts,
  type JSONExportOptions,
  type ChartExportOptions,
} from './reporters/index.js';

// Strategies
export {
  BBSqueezeBacktestStrategy,
  createBBSqueezeStrategy,
  BBSqueezeMRBacktestStrategy,
  createBBSqueezeMRStrategy,
  KeltnerMRBacktestStrategy,
  createKeltnerMRStrategy,
  HybridMTFBacktestStrategy,
  createHybridMTFStrategy,
  HybridMTFBacktestMLStrategy,
  createHybridMTFMLStrategy,
  TrendExhaustionBacktestStrategy,
  createTrendExhaustionStrategy,
  createRSIDivergenceStrategy,
  createPinBarStrategy,
  createEngulfingStrategy,
  createEMADistanceStrategy,
  createExhaustionCandlesStrategy,
  createMultiComboStrategy,
  MTFLevelsBacktestStrategy,
  createMTFLevelsStrategy,
  FVGBacktestStrategy,
  createFVGStrategy,
  FVGLiquiditySweepBacktestStrategy,
  createFVGLiquiditySweepStrategy,
  type DetectionMethod,
  type TrendExhaustionParams,
  type MTFLevelsParams,
} from './strategies/index.js';

// ML Data Collection
export {
  DataCollector,
  createDataCollector,
  FEATURE_IMPORTANCE_HINTS,
  RECOMMENDED_XGBOOST_PARAMS,
  type TradeFeatureRow,
} from './data-collector.js';

// Legacy exports for backward compatibility
// These will be deprecated in future versions
export {
  executeTrade,
  calculateMetrics,
  createTradeEntry as createLegacyTradeEntry,
  formatMetrics,
  runMonteCarloSimulation,
  runWalkForwardAnalysis as runLegacyWalkForward,
  runOutOfSampleTest,
  analyzeSensitivityResults,
} from './backtest-engine.js';
