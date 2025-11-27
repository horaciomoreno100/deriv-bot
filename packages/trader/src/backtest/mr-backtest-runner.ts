/**
 * MR Strategy Backtest Runner
 *
 * Wrapper that integrates MR strategies with the existing backtest engine.
 * Provides a simple interface to run and compare all MR strategies.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { Candle } from '@deriv-bot/shared';
import {
  createMRStrategy,
  type MRStrategyName,
  MR_STRATEGY_NAMES,
  type MRStrategyParams,
  type IndicatorSnapshot,
} from '../strategies/mr/index.js';
import {
  type BacktestConfig,
  type BacktestMetrics,
  type Trade,
  type Direction,
  calculateMetrics,
  createTradeEntry,
  executeTrade,
  formatMetrics,
  runMonteCarloSimulation,
  formatMonteCarloResults,
  runOutOfSampleTest,
} from './backtest-engine.js';
import {
  calculateATR,
  calculateADX,
  calculateRSI,
  calculateEMA,
  calculateBollingerBands,
} from '../indicators/index.js';
import { SessionFilterService } from '../services/session-filter.service.js';
import type { Timeframe } from '../utils/resampler.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * MR Backtest configuration
 */
export interface MRBacktestConfig {
  // Data
  dataPath: string;
  asset: string;

  // Capital & Position sizing
  initialBalance: number;
  stakePct: number; // % of capital per trade

  // Trading costs (for forex)
  spreadPips?: number;
  pipValue?: number;

  // Multiplier (for Deriv CFD)
  multiplier: number;

  // TP/SL (if not from strategy)
  takeProfitPct?: number;
  stopLossPct?: number;
  maxBarsInTrade?: number;

  // Filters
  enableNewsFilter?: boolean;
  enableSessionFilter?: boolean;
  allowedSessions?: Array<'ASIAN' | 'LONDON' | 'OVERLAP' | 'NY' | 'CLOSED'>;

  // MTF
  filterTimeframe?: Timeframe;
  entryTimeframe?: Timeframe;

  // Analysis
  runMonteCarlo?: boolean;
  runOOSTest?: boolean;
}

/**
 * Default MR backtest config
 */
export const DEFAULT_MR_BACKTEST_CONFIG: Partial<MRBacktestConfig> = {
  initialBalance: 10000,
  stakePct: 0.02,
  multiplier: 100,
  takeProfitPct: 0.005,
  stopLossPct: 0.005,
  maxBarsInTrade: 20,
  spreadPips: 1.0,
  pipValue: 0.0001,
  enableNewsFilter: false,
  enableSessionFilter: false,
  runMonteCarlo: false,
  runOOSTest: false,
};

/**
 * Single strategy backtest result
 */
export interface MRBacktestResult {
  strategyName: MRStrategyName;
  asset: string;
  config: MRBacktestConfig;
  trades: Trade[];
  metrics: BacktestMetrics;
  monteCarlo?: ReturnType<typeof runMonteCarloSimulation>;
  oosTest?: ReturnType<typeof runOutOfSampleTest>;
}

/**
 * Comparison result for all strategies
 */
export interface MRComparisonResult {
  asset: string;
  dateRange: { from: string; to: string };
  candleCount: number;
  results: Map<MRStrategyName, MRBacktestResult>;
  ranking: Array<{
    rank: number;
    strategy: MRStrategyName;
    winRate: number;
    profitFactor: number;
    netPnl: number;
    trades: number;
  }>;
  summaryTable: string;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

/**
 * Run backtest for a single MR strategy
 */
export async function runMRBacktest(
  strategyName: MRStrategyName,
  config: MRBacktestConfig,
  strategyParams?: Partial<MRStrategyParams>
): Promise<MRBacktestResult> {
  // Load data
  const candles = loadCandles(config.dataPath, config.asset);

  if (candles.length < 100) {
    throw new Error(`Not enough candles: ${candles.length}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Backtesting ${strategyName} on ${config.asset}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Candles: ${candles.length}`);
  console.log(`   Period: ${formatDate(candles[0]!.timestamp)} - ${formatDate(candles[candles.length - 1]!.timestamp)}`);

  // Create strategy
  const strategy = createMRStrategy(strategyName, {
    ...strategyParams,
    enableNewsFilter: config.enableNewsFilter ?? false,
    enableSessionFilter: config.enableSessionFilter ?? false,
  });

  // Convert config
  const btConfig: BacktestConfig = {
    initialBalance: config.initialBalance,
    stakeAmount: config.initialBalance * config.stakePct,
    stakePct: config.stakePct,
    multiplier: config.multiplier,
    takeProfitPct: config.takeProfitPct ?? 0.005,
    stopLossPct: config.stopLossPct ?? 0.005,
    maxBarsInTrade: config.maxBarsInTrade ?? 20,
    cooldownBars: 1,
  };

  // Pre-calculate all indicators ONCE (huge performance gain)
  console.log(`   Pre-calculating indicators...`);
  const indicatorSnapshots = precalculateIndicators(candles);
  console.log(`   Indicators ready. Running strategy...`);

  // Initialize session filter if enabled
  const sessionFilter = config.enableSessionFilter
    ? new SessionFilterService({
        enabled: true,
        allowedSessions: config.allowedSessions || ['ASIAN', 'LONDON', 'OVERLAP', 'NY'],
      })
    : null;

  // Run strategy and collect trades
  const trades: Trade[] = [];
  let cooldownUntil = 0;
  const startIdx = 50; // Need enough candles for indicators
  let filteredBySession = 0;

  for (let i = startIdx; i < candles.length; i++) {
    const candle = candles[i]!;

    // Check cooldown
    if (i < cooldownUntil) continue;

    // Apply session filter BEFORE checking entry
    if (sessionFilter) {
      const canTrade = sessionFilter.shouldTrade(candle.timestamp);
      if (!canTrade) {
        filteredBySession++;
        continue;
      }
    }

    // Get pre-calculated indicators for this bar
    const indicators = indicatorSnapshots[i];
    if (!indicators) continue;

    // Check if we should enter using strategy's checkEntry directly
    // This bypasses the expensive onCandle which recalculates everything
    const historicalCandles = candles.slice(Math.max(0, i - 100), i + 1);
    const entrySignal = strategy.checkEntry(historicalCandles, indicators);

    if (entrySignal) {
      // Create trade entry
      const direction: Direction = entrySignal.direction === 'LONG' ? 'CALL' : 'PUT';

      // Use strategy's SL/TP
      const tpPct = Math.abs((entrySignal.takeProfit - candle.close) / candle.close);
      const slPct = Math.abs((entrySignal.stopLoss - candle.close) / candle.close);

      const configWithStrategyTP = {
        ...btConfig,
        takeProfitPct: tpPct,
        stopLossPct: slPct,
        maxBarsInTrade: entrySignal.maxBars || btConfig.maxBarsInTrade,
      };

      const entry = createTradeEntry(
        candle.timestamp,
        direction,
        candle.close,
        configWithStrategyTP
      );

      // Execute trade on future candles (reuse existing candles array)
      const futureCandles = candles.slice(i + 1, i + 1 + btConfig.maxBarsInTrade + 5).map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const trade = executeTrade(entry, futureCandles, configWithStrategyTP);

      if (trade) {
        trades.push(trade);

        // Set cooldown
        cooldownUntil = i + trade.barsHeld + btConfig.cooldownBars;
      }
    }
  }

  // Calculate metrics
  const metrics = calculateMetrics(trades, btConfig);

  if (sessionFilter && filteredBySession > 0) {
    console.log(`   Session filter blocked: ${filteredBySession} candles`);
  }

  console.log(`\n📈 Results:`);
  console.log(formatMetrics(metrics));

  // Optional: Monte Carlo
  let monteCarlo;
  if (config.runMonteCarlo && trades.length >= 30) {
    console.log(`\n🎲 Running Monte Carlo simulation...`);
    monteCarlo = runMonteCarloSimulation(trades, btConfig, 1000);
    console.log(formatMonteCarloResults(monteCarlo));
  }

  // Optional: OOS Test
  let oosTest;
  if (config.runOOSTest && trades.length >= 30) {
    console.log(`\n🔬 Running Out-of-Sample test...`);
    oosTest = runOutOfSampleTest(trades, btConfig, 0.7);
    console.log(`   ${oosTest.recommendation}`);
  }

  return {
    strategyName,
    asset: config.asset,
    config,
    trades,
    metrics,
    monteCarlo,
    oosTest,
  };
}

/**
 * Run backtest for all MR strategies and compare
 */
export async function compareMRStrategies(
  config: MRBacktestConfig,
  strategyParams?: Partial<MRStrategyParams>
): Promise<MRComparisonResult> {
  const results = new Map<MRStrategyName, MRBacktestResult>();

  // Load candles once
  const candles = loadCandles(config.dataPath, config.asset);

  console.log('\n' + '='.repeat(80));
  console.log('🏆 MR STRATEGY COMPARISON');
  console.log('='.repeat(80));
  console.log(`Asset: ${config.asset}`);
  console.log(`Candles: ${candles.length}`);
  console.log(`Period: ${formatDate(candles[0]!.timestamp)} - ${formatDate(candles[candles.length - 1]!.timestamp)}`);
  console.log('='.repeat(80));

  // Run each strategy
  for (const strategyName of MR_STRATEGY_NAMES) {
    try {
      const result = await runMRBacktest(strategyName, config, strategyParams);
      results.set(strategyName, result);
    } catch (error) {
      console.error(`❌ Error with ${strategyName}:`, (error as Error).message);
    }
  }

  // Create ranking
  const ranking = [...results.entries()]
    .map(([name, result]) => ({
      strategy: name,
      winRate: result.metrics.winRate,
      profitFactor: result.metrics.profitFactor === Infinity ? 999 : result.metrics.profitFactor,
      netPnl: result.metrics.netPnl,
      trades: result.metrics.totalTrades,
    }))
    .sort((a, b) => b.profitFactor - a.profitFactor)
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));

  // Generate summary table
  const summaryTable = generateComparisonTable(ranking);

  console.log('\n' + summaryTable);

  return {
    asset: config.asset,
    dateRange: {
      from: formatDate(candles[0]!.timestamp),
      to: formatDate(candles[candles.length - 1]!.timestamp),
    },
    candleCount: candles.length,
    results,
    ranking,
    summaryTable,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Load candles from CSV file
 */
function loadCandles(filepath: string, asset: string): Candle[] {
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.split('\n').filter((line) => line.trim() !== '');
  const header = lines[0]!.toLowerCase();

  const hasHeader = header.includes('timestamp') || header.includes('time') || header.includes('open');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const candles: Candle[] = [];

  for (const line of dataLines) {
    const parts = line.split(',');
    if (parts.length < 5) continue;

    try {
      let timestamp: number;
      const tsStr = parts[0]!.trim();

      if (tsStr.includes('-') || tsStr.includes('/')) {
        timestamp = Math.floor(new Date(tsStr).getTime() / 1000);
      } else {
        timestamp = parseInt(tsStr, 10);
        if (timestamp > 1e12) {
          timestamp = Math.floor(timestamp / 1000);
        }
      }

      const candle: Candle = {
        asset,
        timeframe: 300,
        timestamp,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts[5] ? parseFloat(parts[5]) : 0,
      };

      if (!isNaN(candle.timestamp) && !isNaN(candle.close)) {
        candles.push(candle);
      }
    } catch {
      // Skip invalid lines
    }
  }

  // Sort and detect timeframe
  candles.sort((a, b) => a.timestamp - b.timestamp);

  if (candles.length >= 2) {
    const gap = candles[1]!.timestamp - candles[0]!.timestamp;
    for (const candle of candles) {
      candle.timeframe = gap;
    }
  }

  return candles;
}

/**
 * Format timestamp to date string
 */
function formatDate(timestamp: number): string {
  const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return new Date(ts).toISOString().split('T')[0]!;
}

/**
 * Generate comparison table
 */
function generateComparisonTable(
  ranking: Array<{
    rank: number;
    strategy: MRStrategyName;
    winRate: number;
    profitFactor: number;
    netPnl: number;
    trades: number;
  }>
): string {
  const lines: string[] = [];

  lines.push('='.repeat(90));
  lines.push('STRATEGY COMPARISON - RANKED BY PROFIT FACTOR');
  lines.push('='.repeat(90));
  lines.push('');

  // Header
  lines.push(
    'Rank'.padEnd(6) +
    'Strategy'.padEnd(18) +
    'Trades'.padStart(8) +
    'Win %'.padStart(10) +
    'PF'.padStart(8) +
    'Net P&L'.padStart(14) +
    'Status'.padStart(12)
  );
  lines.push('-'.repeat(90));

  for (const item of ranking) {
    const pf = item.profitFactor >= 999 ? '∞' : item.profitFactor.toFixed(2);
    const status = item.netPnl > 0
      ? (item.profitFactor >= 1.5 ? '✅ GOOD' : '⚠️ OK')
      : '❌ LOSS';

    lines.push(
      `#${item.rank}`.padEnd(6) +
      item.strategy.padEnd(18) +
      item.trades.toString().padStart(8) +
      `${item.winRate.toFixed(1)}%`.padStart(10) +
      pf.padStart(8) +
      `$${item.netPnl.toFixed(2)}`.padStart(14) +
      status.padStart(12)
    );
  }

  lines.push('='.repeat(90));

  // Legend
  lines.push('');
  lines.push('Legend: PF = Profit Factor (> 1.5 is good)');
  lines.push('        ✅ GOOD = PF >= 1.5 and profitable');
  lines.push('        ⚠️ OK = Profitable but PF < 1.5');
  lines.push('        ❌ LOSS = Net negative P&L');

  return lines.join('\n');
}

/**
 * Save comparison results to JSON
 */
export function saveComparisonResults(
  result: MRComparisonResult,
  outputPath: string
): void {
  const data = {
    asset: result.asset,
    dateRange: result.dateRange,
    candleCount: result.candleCount,
    ranking: result.ranking,
    strategies: Object.fromEntries(
      [...result.results.entries()].map(([name, res]) => [
        name,
        {
          trades: res.trades.length,
          metrics: res.metrics,
          oosTest: res.oosTest ? {
            isOverfit: res.oosTest.isOverfit,
            recommendation: res.oosTest.recommendation,
          } : undefined,
        },
      ])
    ),
  };

  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\n💾 Results saved to: ${outputPath}`);
}

// ============================================================================
// INDICATOR PRE-CALCULATION
// ============================================================================

/**
 * Pre-calculate all indicators for all candles at once
 * This is MUCH faster than calculating per-candle
 */
function precalculateIndicators(candles: Candle[]): (IndicatorSnapshot | null)[] {
  const atrPeriod = 14;
  const adxPeriod = 14;
  const rsiPeriod = 14;
  const emaPeriod = 20;
  const bbPeriod = 20;
  const bbStdDev = 2;

  // Calculate all indicator series once
  const atrValues = calculateATR(candles, atrPeriod);
  const adxValues = calculateADX(candles, adxPeriod);
  const rsiValues = calculateRSI(candles, rsiPeriod);
  const emaValues = calculateEMA(candles, emaPeriod);
  const bbValues = calculateBollingerBands(candles, bbPeriod, bbStdDev);

  // Pre-calculate offsets (indicators have different warmup periods)
  const atrOffset = candles.length - atrValues.length;
  const adxOffset = candles.length - adxValues.length;
  const rsiOffset = candles.length - rsiValues.length;
  const emaOffset = candles.length - emaValues.length;
  const bbOffset = candles.length - bbValues.length;

  // Build snapshots array
  const snapshots: (IndicatorSnapshot | null)[] = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;

    const atrIdx = i - atrOffset;
    const adxIdx = i - adxOffset;
    const rsiIdx = i - rsiOffset;
    const emaIdx = i - emaOffset;
    const bbIdx = i - bbOffset;

    // Skip if any indicator is not available yet
    if (atrIdx < 0 || adxIdx < 0 || rsiIdx < 0 || emaIdx < 0 || bbIdx < 0) {
      continue;
    }

    const atr = atrValues[atrIdx];
    const adxObj = adxValues[adxIdx];
    const rsi = rsiValues[rsiIdx];
    const ema = emaValues[emaIdx];
    const bb = bbValues[bbIdx];

    if (atr === undefined || !adxObj || rsi === undefined || ema === undefined || !bb) {
      continue;
    }

    snapshots[i] = {
      atr,
      adx: adxObj.adx,
      rsi,
      ema,
      bbUpper: bb.upper,
      bbMiddle: bb.middle,
      bbLower: bb.lower,
      bbWidth: (bb.upper - bb.lower) / bb.middle,
      price: candle.close,
    };
  }

  return snapshots;
}
