/**
 * Visualization module for trading analysis
 *
 * Provides chart generation capabilities for backtest and live trading data.
 *
 * @example
 * ```typescript
 * import { generateChartHTML, createVisualizationData } from '@deriv-bot/shared/visualization';
 *
 * const vizData = createVisualizationData(
 *   'R_100',
 *   60,
 *   candles,
 *   tradesWithContext,
 *   { rsi: rsiValues, bbUpper, bbMiddle, bbLower }
 * );
 *
 * const html = generateChartHTML(vizData, {
 *   title: 'BB Squeeze Backtest - R_100',
 *   theme: 'dark',
 *   showIndicators: ['rsi', 'bbands', 'squeeze'],
 * });
 *
 * fs.writeFileSync('backtest-chart.html', html);
 * ```
 */

export {
  generateChartHTML,
  generatePlotlyData,
  createVisualizationData,
  type ChartGeneratorOptions,
} from './chart-generator.js';
