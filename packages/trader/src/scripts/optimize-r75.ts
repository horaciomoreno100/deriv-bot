/**
 * BB Squeeze Strategy Optimizer for R_75
 *
 * Grid Search optimization to find winning parameters for R_75
 * Tests multiple combinations of:
 * - KC Multiplier
 * - RSI Period
 * - Take Profit %
 *
 * Uses 30 days of historical data for robust testing
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
const DATA_FILE = 'R_75_60s_30d.csv';
const INITIAL_CAPITAL = 10000;
const MIN_TRADES_THRESHOLD = 10; // Minimum trades for statistical relevance

/**
 * Parameter Grid for Optimization
 */
const PARAM_GRID = {
  kcMultiplier: [2.0, 2.2, 2.5, 2.8, 3.0],
  rsiPeriod: [9, 14],
  takeProfitPct: [0.004, 0.006, 0.008, 0.01], // 0.4%, 0.6%, 0.8%, 1.0%
};

/**
 * Fixed parameters
 */
const FIXED_PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  stopLossPct: 0.002, // Keep 0.2% SL fixed (will scale with TP)
  lookbackBars: 50,
};

interface IndicatorBar extends IBar {
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  kcUpper?: number;
  kcMiddle?: number;
  kcLower?: number;
  rsi?: number;
}

interface OptimizationResult {
  kcMultiplier: number;
  rsiPeriod: number;
  takeProfitPct: number;
  stopLossPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netProfit: number;
  returnPct: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
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
    const value = values[i];
    if (value !== undefined) {
      ema = value * k + ema * (1 - k);
      emaArray.push(ema);
    }
  }

  return emaArray;
}

/**
 * Create BB Squeeze strategy with given parameters
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

      // Need indicators including RSI
      if (!bar.bbUpper || !bar.kcUpper || !bar.bbLower || !bar.kcLower || bar.rsi === undefined) {
        return;
      }

      // Need lookback to detect squeezes
      if (lookback.count() < 5) {
        return;
      }

      const lookbackBars = lookback.toArray();

      // Check if we recently exited a squeeze (within last 5 bars)
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

      // LONG: Breakout above BB_Upper + RSI > 55 (bullish momentum)
      const breakoutAbove = price > bar.bbUpper;
      const rsiBullish = rsi > 55;

      if (breakoutAbove && rsiBullish) {
        enterPosition({
          direction: 'long',
        });
      }

      // SHORT: Breakout below BB_Lower + RSI < 45 (bearish momentum)
      const breakoutBelow = price < bar.bbLower;
      const rsiBearish = rsi < 45;

      if (breakoutBelow && rsiBearish) {
        enterPosition({
          direction: 'short',
        });
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
 * Run single backtest with given parameters
 */
function runBacktest(data: DataFrame, params: any): OptimizationResult | null {
  const strategy = createStrategy(params);

  const trades = backtest(strategy, data, {
    initialCapital: INITIAL_CAPITAL,
  });

  // Filter out results with insufficient trades
  if (trades.length < MIN_TRADES_THRESHOLD) {
    return null;
  }

  // Manual analysis
  const winningTrades = trades.filter(t => t.profit > 0);
  const losingTrades = trades.filter(t => t.profit <= 0);
  const totalProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
  const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
  const netProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

  const analysis = analyze(INITIAL_CAPITAL, trades);

  return {
    kcMultiplier: params.kcMultiplier,
    rsiPeriod: params.rsiPeriod,
    takeProfitPct: params.takeProfitPct,
    stopLossPct: params.stopLossPct,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    netProfit,
    returnPct: (netProfit / INITIAL_CAPITAL) * 100,
    profitFactor,
    avgWin: winningTrades.length > 0 ? totalProfit / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? totalLoss / losingTrades.length : 0,
    maxDrawdown: analysis.maxDrawdown || 0,
  };
}

/**
 * Main optimization function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🔬 BB SQUEEZE PARAMETER OPTIMIZATION FOR R_75');
  console.log('='.repeat(80));
  console.log();

  // Load data
  const filepath = join(BACKTEST_DIR, DATA_FILE);
  console.log(`📂 Loading data: ${filepath}`);

  if (!existsSync(filepath)) {
    console.error(`❌ Data file not found: ${filepath}`);
    console.error(`   Run: SYMBOLS="R_75" DAYS=30 pnpm data:fetch\n`);
    process.exit(1);
  }

  const data = loadCSVData(filepath);
  console.log(`✅ Loaded ${data.count()} candles`);
  console.log(`   Period: ${data.first().time.toISOString()} to ${data.last().time.toISOString()}`);
  console.log();

  // Calculate total combinations
  const totalCombinations =
    PARAM_GRID.kcMultiplier.length *
    PARAM_GRID.rsiPeriod.length *
    PARAM_GRID.takeProfitPct.length;

  console.log(`🔍 Grid Search Configuration:`);
  console.log(`   KC Multiplier: ${PARAM_GRID.kcMultiplier.join(', ')}`);
  console.log(`   RSI Period: ${PARAM_GRID.rsiPeriod.join(', ')}`);
  console.log(`   Take Profit %: ${PARAM_GRID.takeProfitPct.map(p => (p * 100).toFixed(2) + '%').join(', ')}`);
  console.log(`   Stop Loss %: ${(FIXED_PARAMS.stopLossPct * 100).toFixed(2)}% (fixed)`);
  console.log(`   Min Trades: ${MIN_TRADES_THRESHOLD}`);
  console.log(`   Total Combinations: ${totalCombinations}`);
  console.log();

  const results: OptimizationResult[] = [];
  let currentTest = 0;

  console.log('🚀 Running optimization...\n');

  // Grid search
  for (const kcMultiplier of PARAM_GRID.kcMultiplier) {
    for (const rsiPeriod of PARAM_GRID.rsiPeriod) {
      for (const takeProfitPct of PARAM_GRID.takeProfitPct) {
        currentTest++;

        // Calculate dynamic stop loss (maintain 2:1 ratio)
        const stopLossPct = takeProfitPct / 2;

        const params = {
          ...FIXED_PARAMS,
          kcMultiplier,
          rsiPeriod,
          takeProfitPct,
          stopLossPct,
        };

        process.stdout.write(`[${currentTest}/${totalCombinations}] Testing KC=${kcMultiplier}, RSI=${rsiPeriod}, TP=${(takeProfitPct * 100).toFixed(2)}%... `);

        try {
          const result = runBacktest(data, params);

          if (result) {
            results.push(result);
            console.log(`✓ ${result.totalTrades} trades, ${result.returnPct.toFixed(2)}% return`);
          } else {
            console.log(`⚠️  Skipped (< ${MIN_TRADES_THRESHOLD} trades)`);
          }
        } catch (error: any) {
          console.log(`❌ Error: ${error.message}`);
        }
      }
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('📊 OPTIMIZATION RESULTS');
  console.log('='.repeat(80));
  console.log();

  if (results.length === 0) {
    console.log('❌ No valid results found. All configurations had insufficient trades.');
    process.exit(1);
  }

  console.log(`✅ Valid configurations: ${results.length}/${totalCombinations}`);
  console.log();

  // Sort by Profit Factor (primary) and Net Profit (secondary)
  const sortedByProfitFactor = [...results].sort((a, b) => {
    if (Math.abs(b.profitFactor - a.profitFactor) > 0.1) {
      return b.profitFactor - a.profitFactor;
    }
    return b.netProfit - a.netProfit;
  });

  // Sort by Net Profit
  const sortedByNetProfit = [...results].sort((a, b) => b.netProfit - a.netProfit);

  // Sort by Win Rate
  const sortedByWinRate = [...results].sort((a, b) => b.winRate - a.winRate);

  // Display Top 3 by Profit Factor
  console.log('🏆 TOP 3 BY PROFIT FACTOR:');
  console.log();

  sortedByProfitFactor.slice(0, 3).forEach((result, index) => {
    console.log(`${index + 1}. Configuration:`);
    console.log(`   KC Multiplier:   ${result.kcMultiplier}`);
    console.log(`   RSI Period:      ${result.rsiPeriod}`);
    console.log(`   Take Profit:     ${(result.takeProfitPct * 100).toFixed(2)}%`);
    console.log(`   Stop Loss:       ${(result.stopLossPct * 100).toFixed(2)}%`);
    console.log();
    console.log(`   Performance:`);
    console.log(`   • Total Trades:    ${result.totalTrades}`);
    console.log(`   • Win Rate:        ${result.winRate.toFixed(2)}%`);
    console.log(`   • Net Profit:      $${result.netProfit.toFixed(2)}`);
    console.log(`   • Return %:        ${result.returnPct.toFixed(2)}%`);
    console.log(`   • Profit Factor:   ${result.profitFactor.toFixed(2)}`);
    console.log(`   • Avg Win:         $${result.avgWin.toFixed(2)}`);
    console.log(`   • Avg Loss:        $${result.avgLoss.toFixed(2)}`);
    console.log(`   • Max Drawdown:    ${result.maxDrawdown.toFixed(2)}%`);
    console.log();
  });

  console.log('='.repeat(80));
  console.log('💰 TOP 3 BY NET PROFIT:');
  console.log();

  sortedByNetProfit.slice(0, 3).forEach((result, index) => {
    console.log(`${index + 1}. KC=${result.kcMultiplier}, RSI=${result.rsiPeriod}, TP=${(result.takeProfitPct * 100).toFixed(2)}%`);
    console.log(`   Net Profit: $${result.netProfit.toFixed(2)} (${result.returnPct.toFixed(2)}%)`);
    console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}, Win Rate: ${result.winRate.toFixed(2)}%`);
    console.log();
  });

  console.log('='.repeat(80));
  console.log('🎯 TOP 3 BY WIN RATE:');
  console.log();

  sortedByWinRate.slice(0, 3).forEach((result, index) => {
    console.log(`${index + 1}. KC=${result.kcMultiplier}, RSI=${result.rsiPeriod}, TP=${(result.takeProfitPct * 100).toFixed(2)}%`);
    console.log(`   Win Rate: ${result.winRate.toFixed(2)}% (${result.winningTrades}/${result.totalTrades})`);
    console.log(`   Net Profit: $${result.netProfit.toFixed(2)}, Profit Factor: ${result.profitFactor.toFixed(2)}`);
    console.log();
  });

  console.log('='.repeat(80));
  console.log('💡 RECOMMENDATION:');
  console.log('='.repeat(80));
  console.log();

  const best = sortedByProfitFactor[0];
  console.log(`Use the following configuration for R_75:`);
  console.log();
  console.log(`'R_75': {`);
  console.log(`  kcMultiplier: ${best.kcMultiplier},`);
  console.log(`  rsiPeriod: ${best.rsiPeriod},`);
  console.log(`  takeProfitPct: ${best.takeProfitPct},`);
  console.log(`  stopLossPct: ${best.stopLossPct},`);
  console.log(`},`);
  console.log();
  console.log(`Expected Performance (30 days):`);
  console.log(`  • Return: ${best.returnPct.toFixed(2)}%`);
  console.log(`  • Profit Factor: ${best.profitFactor.toFixed(2)}`);
  console.log(`  • Win Rate: ${best.winRate.toFixed(2)}%`);
  console.log();

  console.log('✅ Optimization complete!\n');
  process.exit(0);
}

// Run
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
