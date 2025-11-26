/**
 * Multi-Asset BB Squeeze Optimizer
 *
 * Finds optimal parameters for R_10, R_25, R_50, R_75, and R_100
 * using volatility-aware Grid Search
 */

import { backtest, analyze, IStrategy, IBar } from 'grademark';
import { DataFrame } from 'data-forge';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

/**
 * Configuration
 */
const BACKTEST_DIR = './backtest-data';
const INITIAL_CAPITAL = 10000;
const BACKTEST_DAYS = 30;
const MIN_TRADES_THRESHOLD = 30; // Minimum trades for statistical relevance
const MIN_PROFIT_FACTOR = 1.2;   // Minimum profit factor to consider configuration viable

/**
 * Asset volatility profiles
 */
const ASSET_PROFILES = {
  'R_10': { volatility: 'low', label: 'Low Volatility' },
  'R_25': { volatility: 'low', label: 'Low Volatility' },
  'R_50': { volatility: 'mid', label: 'Mid Volatility' },
  'R_75': { volatility: 'high', label: 'High Volatility' },
  'R_100': { volatility: 'high', label: 'High Volatility' },
};

/**
 * Volatility-aware parameter grids
 */
const PARAM_GRIDS = {
  low: {
    kcMultiplier: [1.5, 1.7, 1.9, 2.1],      // Narrower channels for low volatility
    rsiPeriod: [9, 14],
    takeProfitPct: [0.002, 0.003, 0.004],    // Shorter TPs: 0.2% - 0.4%
  },
  mid: {
    kcMultiplier: [2.0, 2.2, 2.5, 2.8],      // Medium channels
    rsiPeriod: [9, 14],
    takeProfitPct: [0.003, 0.004, 0.006],    // Medium TPs: 0.3% - 0.6%
  },
  high: {
    kcMultiplier: [2.0, 2.5, 2.8, 3.0],      // Wider channels for high volatility
    rsiPeriod: [9, 14],
    takeProfitPct: [0.004, 0.006, 0.008],    // Longer TPs: 0.4% - 0.8%
  },
};

/**
 * Fixed parameters (shared across all assets)
 */
const FIXED_PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  lookbackBars: 50,
};

/**
 * Extended Bar with indicators
 */
interface IndicatorBar extends IBar {
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  kcUpper?: number;
  kcMiddle?: number;
  kcLower?: number;
  rsi?: number;
}

/**
 * Optimization result
 */
interface OptimizationResult {
  symbol: string;
  kcMultiplier: number;
  rsiPeriod: number;
  takeProfitPct: number;
  stopLossPct: number;
  netProfit: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  returnPct: number;
}

/**
 * Calculate EMA
 */
function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];

  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emaArray.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }

  return emaArray;
}

/**
 * Create BB Squeeze Strategy with given parameters
 */
function createStrategy(params: any): IStrategy<IBar, IndicatorBar> {
  return {
    parameters: params,
    lookbackPeriod: params.lookbackBars,

    prepIndicators: (args) => {
      const { inputSeries, parameters } = args;

      return inputSeries
        .select(bar => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        } as IndicatorBar))
        .withIndex(row => row.time.getTime())
        .window(parameters.bbPeriod + 10)
        .select(window => {
          const bars = window.toArray();

          if (bars.length < parameters.bbPeriod + 10) {
            return bars[bars.length - 1];
          }

          const closes = bars.map(b => b.close);
          const highs = bars.map(b => b.high);
          const lows = bars.map(b => b.low);

          // Calculate BB
          const bbResult = BollingerBands.calculate({
            period: parameters.bbPeriod,
            values: closes,
            stdDev: parameters.bbStdDev,
          });

          // Calculate KC
          const ema = calculateEMA(closes, parameters.kcPeriod);
          const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: parameters.kcPeriod,
          });

          // Calculate RSI
          const rsiValues = RSI.calculate({
            period: parameters.rsiPeriod,
            values: closes,
          });

          const currentBar = bars[bars.length - 1];

          if (!bbResult || bbResult.length === 0 || !atrValues || atrValues.length === 0 || !rsiValues || rsiValues.length === 0) {
            return currentBar;
          }

          const bb = bbResult[bbResult.length - 1];
          const atr = atrValues[atrValues.length - 1];
          const kcMiddle = ema[ema.length - 1];
          const rsi = rsiValues[rsiValues.length - 1];

          return {
            ...currentBar,
            bbUpper: bb?.upper,
            bbMiddle: bb?.middle,
            bbLower: bb?.lower,
            kcUpper: atr ? kcMiddle + atr * parameters.kcMultiplier : undefined,
            kcMiddle: kcMiddle,
            kcLower: atr ? kcMiddle - atr * parameters.kcMultiplier : undefined,
            rsi: rsi,
          } as IndicatorBar;
        })
        .inflate()
        .bake();
    },

    entryRule: (enterPosition, args) => {
      const { bar, lookback, parameters } = args;

      if (!bar.bbUpper || !bar.kcUpper || !bar.bbLower || !bar.kcLower || bar.rsi === undefined) {
        return;
      }

      if (lookback.count() < 5) {
        return;
      }

      const lookbackBars = lookback.toArray();

      // Check if we recently exited a squeeze
      let hadRecentSqueeze = false;
      for (const pastBar of lookbackBars.slice(-5)) {
        if (pastBar.bbUpper && pastBar.kcUpper && pastBar.bbLower && pastBar.kcLower) {
          const wasInSqueeze = pastBar.bbUpper < pastBar.kcUpper && pastBar.bbLower > pastBar.kcLower;
          if (wasInSqueeze) {
            hadRecentSqueeze = true;
            break;
          }
        }
      }

      if (!hadRecentSqueeze) {
        return;
      }

      const price = bar.close;
      const rsi = bar.rsi;

      // LONG: Breakout above BB_Upper + RSI > 55
      const breakoutAbove = price > bar.bbUpper;
      const rsiBullish = rsi > 55;

      if (breakoutAbove && rsiBullish) {
        enterPosition({ direction: 'long' });
      }

      // SHORT: Breakout below BB_Lower + RSI < 45
      const breakoutBelow = price < bar.bbLower;
      const rsiBearish = rsi < 45;

      if (breakoutBelow && rsiBearish) {
        enterPosition({ direction: 'short' });
      }
    },

    stopLoss: (args) => {
      const { entryPrice, parameters } = args;
      return entryPrice * parameters.stopLossPct;
    },

    profitTarget: (args) => {
      const { entryPrice, parameters } = args;
      return entryPrice * parameters.takeProfitPct;
    },
  };
}

/**
 * Load CSV data
 */
function loadCSVData(filepath: string): DataFrame {
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.split('\n').filter(line => line.trim() !== '');
  const rows = lines.slice(1); // Skip header

  const data = rows.map(row => {
    const [timestamp, open, high, low, close, volume] = row.split(',');
    return {
      time: new Date(parseInt(timestamp, 10)),
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume) || 0,
    };
  });

  return new DataFrame(data);
}

/**
 * Run backtest with given parameters
 */
function runBacktest(data: DataFrame, params: any): OptimizationResult | null {
  try {
    const strategy = createStrategy(params);
    const trades = backtest(strategy, data, { initialCapital: INITIAL_CAPITAL });

    if (trades.length === 0) {
      return null;
    }

    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit <= 0);
    const totalProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
    const netProfit = trades.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (winningTrades.length / trades.length) * 100;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

    const analysis = analyze(INITIAL_CAPITAL, trades);

    return {
      symbol: params.symbol,
      kcMultiplier: params.kcMultiplier,
      rsiPeriod: params.rsiPeriod,
      takeProfitPct: params.takeProfitPct,
      stopLossPct: params.stopLossPct,
      netProfit,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      profitFactor,
      maxDrawdown: analysis.maxDrawdown || 0,
      returnPct: (netProfit / INITIAL_CAPITAL) * 100,
    };
  } catch (error: any) {
    console.error(`   ⚠️  Backtest failed: ${error.message}`);
    return null;
  }
}

/**
 * Optimize parameters for a single asset
 */
async function optimizeAsset(symbol: string): Promise<OptimizationResult[]> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 OPTIMIZING ${symbol}`);
  console.log('='.repeat(80));

  const profile = ASSET_PROFILES[symbol as keyof typeof ASSET_PROFILES];
  const paramGrid = PARAM_GRIDS[profile.volatility as keyof typeof PARAM_GRIDS];

  console.log(`   Profile: ${profile.label}`);
  console.log(`   KC Multipliers: ${paramGrid.kcMultiplier.join(', ')}`);
  console.log(`   RSI Periods: ${paramGrid.rsiPeriod.join(', ')}`);
  console.log(`   Take Profits: ${paramGrid.takeProfitPct.map(p => (p * 100).toFixed(1) + '%').join(', ')}`);

  // Load data
  const filepath = join(BACKTEST_DIR, `${symbol}_60s_${BACKTEST_DAYS}d.csv`);
  if (!existsSync(filepath)) {
    console.error(`   ❌ Data file not found: ${filepath}`);
    return [];
  }

  const data = loadCSVData(filepath);
  console.log(`   Loaded ${data.count()} candles`);

  // Calculate total combinations
  const totalCombos = paramGrid.kcMultiplier.length *
                      paramGrid.rsiPeriod.length *
                      paramGrid.takeProfitPct.length;
  console.log(`   Testing ${totalCombos} combinations...\n`);

  const results: OptimizationResult[] = [];
  let tested = 0;

  for (const kcMultiplier of paramGrid.kcMultiplier) {
    for (const rsiPeriod of paramGrid.rsiPeriod) {
      for (const takeProfitPct of paramGrid.takeProfitPct) {
        tested++;
        const stopLossPct = takeProfitPct / 2; // Maintain 2:1 ratio

        const params = {
          symbol,
          ...FIXED_PARAMS,
          kcMultiplier,
          rsiPeriod,
          takeProfitPct,
          stopLossPct,
        };

        process.stdout.write(`\r   Progress: ${tested}/${totalCombos} (${((tested / totalCombos) * 100).toFixed(0)}%)`);

        const result = runBacktest(data, params);

        if (result && result.totalTrades >= MIN_TRADES_THRESHOLD) {
          results.push(result);
        }
      }
    }
  }

  console.log(`\n   ✓ Completed ${tested} tests, ${results.length} valid configurations found\n`);

  return results;
}

/**
 * Display top results for an asset
 */
function displayTopResults(symbol: string, results: OptimizationResult[]) {
  if (results.length === 0) {
    console.log(`   ⚠️  No valid configurations found (min ${MIN_TRADES_THRESHOLD} trades required)`);
    return;
  }

  // Filter by minimum profit factor
  const viableResults = results.filter(r => r.profitFactor >= MIN_PROFIT_FACTOR);

  if (viableResults.length === 0) {
    console.log(`   ⚠️  No configurations met minimum Profit Factor of ${MIN_PROFIT_FACTOR}`);
    console.log(`   Best result: PF = ${Math.max(...results.map(r => r.profitFactor)).toFixed(2)}`);
    return;
  }

  // Sort by Profit Factor (primary) and Return % (secondary)
  const sorted = [...viableResults].sort((a, b) => {
    if (Math.abs(b.profitFactor - a.profitFactor) > 0.1) {
      return b.profitFactor - a.profitFactor;
    }
    return b.returnPct - a.returnPct;
  });

  console.log(`📊 TOP 3 CONFIGURATIONS BY PROFIT FACTOR:`);
  console.log();

  sorted.slice(0, 3).forEach((r, i) => {
    console.log(`${i + 1}. KC=${r.kcMultiplier} | RSI=${r.rsiPeriod} | TP=${(r.takeProfitPct * 100).toFixed(1)}% | SL=${(r.stopLossPct * 100).toFixed(1)}%`);
    console.log(`   Return: ${r.returnPct.toFixed(2)}% | Profit Factor: ${r.profitFactor.toFixed(2)}`);
    console.log(`   Trades: ${r.totalTrades} | Win Rate: ${r.winRate.toFixed(2)}% | Max DD: ${r.maxDrawdown.toFixed(2)}%`);
    console.log();
  });

  // Best by return %
  const sortedByReturn = [...viableResults].sort((a, b) => b.returnPct - a.returnPct);
  console.log(`💰 BEST BY RETURN %:`);
  console.log();
  const bestReturn = sortedByReturn[0];
  console.log(`   KC=${bestReturn.kcMultiplier} | RSI=${bestReturn.rsiPeriod} | TP=${(bestReturn.takeProfitPct * 100).toFixed(1)}% | SL=${(bestReturn.stopLossPct * 100).toFixed(1)}%`);
  console.log(`   Return: ${bestReturn.returnPct.toFixed(2)}% | Profit Factor: ${bestReturn.profitFactor.toFixed(2)}`);
  console.log(`   Trades: ${bestReturn.totalTrades} | Win Rate: ${bestReturn.winRate.toFixed(2)}%`);
  console.log();

  // Best by win rate
  const sortedByWinRate = [...viableResults].sort((a, b) => b.winRate - a.winRate);
  console.log(`🎯 BEST BY WIN RATE:`);
  console.log();
  const bestWinRate = sortedByWinRate[0];
  console.log(`   KC=${bestWinRate.kcMultiplier} | RSI=${bestWinRate.rsiPeriod} | TP=${(bestWinRate.takeProfitPct * 100).toFixed(1)}% | SL=${(bestWinRate.stopLossPct * 100).toFixed(1)}%`);
  console.log(`   Win Rate: ${bestWinRate.winRate.toFixed(2)}% | Profit Factor: ${bestWinRate.profitFactor.toFixed(2)}`);
  console.log(`   Return: ${bestWinRate.returnPct.toFixed(2)}% | Trades: ${bestWinRate.totalTrades}`);
  console.log();
}

/**
 * Generate recommended configuration
 */
function getRecommendedConfig(results: OptimizationResult[]): OptimizationResult | null {
  if (results.length === 0) return null;

  const viableResults = results.filter(r => r.profitFactor >= MIN_PROFIT_FACTOR);
  if (viableResults.length === 0) return null;

  // Sort by Profit Factor (primary) and Return % (secondary)
  const sorted = [...viableResults].sort((a, b) => {
    if (Math.abs(b.profitFactor - a.profitFactor) > 0.1) {
      return b.profitFactor - a.profitFactor;
    }
    return b.returnPct - a.returnPct;
  });

  return sorted[0];
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 MULTI-ASSET BB SQUEEZE OPTIMIZER');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`   Initial Capital: $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`   Backtest Period: ${BACKTEST_DAYS} days`);
  console.log(`   Min Trades: ${MIN_TRADES_THRESHOLD}`);
  console.log(`   Min Profit Factor: ${MIN_PROFIT_FACTOR}`);
  console.log();

  const symbols = Object.keys(ASSET_PROFILES);
  const allRecommendations: Record<string, OptimizationResult | null> = {};

  // Optimize each asset
  for (const symbol of symbols) {
    const results = await optimizeAsset(symbol);
    displayTopResults(symbol, results);
    allRecommendations[symbol] = getRecommendedConfig(results);
  }

  // Final summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🎯 RECOMMENDED CONFIGURATION FOR ASSET_CONFIGS`);
  console.log('='.repeat(80));
  console.log();

  for (const symbol of symbols) {
    const config = allRecommendations[symbol];
    if (config) {
      console.log(`'${symbol}': {`);
      console.log(`  kcMultiplier: ${config.kcMultiplier},`);
      console.log(`  rsiPeriod: ${config.rsiPeriod},`);
      console.log(`  takeProfitPct: ${config.takeProfitPct},  // ${(config.takeProfitPct * 100).toFixed(1)}%`);
      console.log(`  stopLossPct: ${config.stopLossPct},    // ${(config.stopLossPct * 100).toFixed(1)}%`);
      console.log(`  // Expected: Return ${config.returnPct.toFixed(2)}%, PF ${config.profitFactor.toFixed(2)}, WR ${config.winRate.toFixed(1)}%`);
      console.log(`},`);
    } else {
      console.log(`'${symbol}': {`);
      console.log(`  // ⚠️  No viable configuration found`);
      console.log(`},`);
    }
    console.log();
  }

  console.log('✅ Optimization complete!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
