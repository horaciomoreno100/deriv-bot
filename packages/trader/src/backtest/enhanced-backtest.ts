/**
 * Simple BB Squeeze Backtest using Grademark
 *
 * Clean and straightforward backtesting implementation
 */

import { backtest, analyze, IStrategy, IBar } from 'grademark';
import { DataFrame, IDataFrame } from 'data-forge';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

/**
 * Configuration
 */
const BACKTEST_DIR = './backtest-data';
const SYMBOLS = process.env.SYMBOL?.split(',') || ['R_75', 'R_100'];
const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const BACKTEST_DAYS = parseInt(process.env.BACKTEST_DAYS || '30', 10);

/**
 * Strategy Parameters
 */
const PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 2.0,    // INCREASED from 1.5 to 2.0 for more squeezes
  rsiPeriod: 14,        // ADDED: RSI for momentum confirmation
  takeProfitPct: 0.004, // 0.4%
  stopLossPct: 0.002,   // 0.2%
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
 * BB Squeeze Strategy for Grademark
 */
const strategy: IStrategy<IBar, IndicatorBar> = {
  parameters: PARAMS,
  lookbackPeriod: PARAMS.lookbackBars,

  prepIndicators: (args) => {
    const { inputSeries, parameters } = args;

    console.log(`\n🔧 Preparing indicators for ${inputSeries.count()} bars...`);

    return inputSeries
      .select(bar => {
        return {
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        } as IndicatorBar;
      })
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
      console.log(`\n🟢 LONG at ${price.toFixed(2)} | RSI: ${rsi.toFixed(1)} | TP: ${(price * (1 + parameters.takeProfitPct)).toFixed(2)} | SL: ${(price * (1 - parameters.stopLossPct)).toFixed(2)}`);
    } else if (breakoutAbove && !rsiBullish) {
      console.log(`\n⚠️  Skipped LONG - RSI too weak (${rsi.toFixed(1)} <= 55)`);
    }

    // SHORT: Breakout below BB_Lower + RSI < 45 (bearish momentum)
    const breakoutBelow = price < bar.bbLower;
    const rsiBearish = rsi < 45;

    if (breakoutBelow && rsiBearish) {
      enterPosition({
        direction: 'short',
      });
      console.log(`\n🔴 SHORT at ${price.toFixed(2)} | RSI: ${rsi.toFixed(1)} | TP: ${(price * (1 - parameters.takeProfitPct)).toFixed(2)} | SL: ${(price * (1 + parameters.stopLossPct)).toFixed(2)}`);
    } else if (breakoutBelow && !rsiBearish) {
      console.log(`\n⚠️  Skipped SHORT - RSI too strong (${rsi.toFixed(1)} >= 45)`);
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
 * Run backtest for a symbol
 */
async function runBacktest(symbol: string, data: DataFrame) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 BACKTESTING ${symbol}`);
  console.log('='.repeat(80));
  console.log(`   Data Points: ${data.count()}`);
  console.log(`   Period: ${data.first().time.toISOString()} to ${data.last().time.toISOString()}`);
  console.log(`   Initial Capital: $${INITIAL_CAPITAL.toFixed(2)}`);

  const trades = backtest(strategy, data, {
    initialCapital: INITIAL_CAPITAL,
  });

  console.log(`\n📋 Trades generated: ${trades.length}`);

  // Print ALL losing trades for analysis
  const losingTradesForAnalysis = trades.filter(t => t.profit <= 0);
  console.log(`\n❌ TODAS LAS PÉRDIDAS (${losingTradesForAnalysis.length} trades):`);
  console.log('='.repeat(120));

  losingTradesForAnalysis.forEach((trade, i) => {
    // Need to find RSI from entry bar - we'll use entryTime to match
    console.log(`${(i + 1).toString().padStart(3)}. ${trade.direction.toUpperCase().padEnd(5)} | Entry: $${trade.entryPrice.toFixed(2).padStart(10)} | Exit: $${trade.exitPrice.toFixed(2).padStart(10)} | P&L: $${trade.profit.toFixed(2).padStart(8)} | Reason: ${(trade.exitReason || 'unknown').padEnd(15)} | Time: ${trade.entryTime.toISOString()}`);
  });
  console.log('='.repeat(120));

  const analysis = analyze(INITIAL_CAPITAL, trades);

  // Manual analysis to fix grademark bugs
  const winningTrades = trades.filter(t => t.profit > 0);
  const losingTrades = trades.filter(t => t.profit <= 0);
  const totalProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
  const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
  const netProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📈 RESULTS - ${symbol}`);
  console.log('='.repeat(80));
  console.log();
  console.log(`💰 Performance:`);
  console.log(`   Start Value:       $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`   End Value:         $${(INITIAL_CAPITAL + netProfit).toFixed(2)}`);
  console.log(`   Total Return:      $${netProfit.toFixed(2)}`);
  console.log(`   Return %:          ${((netProfit / INITIAL_CAPITAL) * 100).toFixed(2)}%`);
  console.log();
  console.log(`📊 Trades:`);
  console.log(`   Total Trades:      ${trades.length}`);
  console.log(`   Winning Trades:    ${winningTrades.length}`);
  console.log(`   Losing Trades:     ${losingTrades.length}`);
  console.log(`   Win Rate:          ${winRate.toFixed(2)}%`);
  console.log();
  console.log(`💵 Profit Analysis:`);
  console.log(`   Total Profit:      $${totalProfit.toFixed(2)}`);
  console.log(`   Total Loss:        $${totalLoss.toFixed(2)}`);
  console.log(`   Profit Factor:     ${profitFactor.toFixed(2)}`);
  console.log(`   Avg Win:           $${(winningTrades.length > 0 ? totalProfit / winningTrades.length : 0).toFixed(2)}`);
  console.log(`   Avg Loss:          $${(losingTrades.length > 0 ? totalLoss / losingTrades.length : 0).toFixed(2)}`);
  console.log();
  console.log(`📉 Risk Metrics:`);
  console.log(`   Max Drawdown:      ${(analysis.maxDrawdown || 0).toFixed(2)}%`);
  console.log(`   Max Drawdown $:    $${(analysis.maxDrawdownAmount || 0).toFixed(2)}`);
  console.log();

  return {
    netProfit,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    profitFactor,
    analysis
  };
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 BB SQUEEZE BACKTEST (Grademark)');
  console.log('='.repeat(80));
  console.log();

  const allResults: any[] = [];

  for (const symbol of SYMBOLS) {
    try {
      const filepath = join(BACKTEST_DIR, `${symbol}_60s_${BACKTEST_DAYS}d.csv`);

      if (!existsSync(filepath)) {
        console.error(`❌ Data file not found: ${filepath}`);
        console.error(`   Run: SYMBOLS="${symbol}" DAYS=${BACKTEST_DAYS} pnpm data:fetch\n`);
        continue;
      }

      const data = loadCSVData(filepath);
      const { netProfit, totalTrades, winningTrades } = await runBacktest(symbol, data);
      allResults.push({
        symbol,
        netProfit,
        totalTrades,
        winningTrades
      });

    } catch (error: any) {
      console.error(`\n❌ Error backtesting ${symbol}:`, error.message);
      console.error(error.stack);
    }
  }

  // Combined summary
  if (allResults.length > 1) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🌍 COMBINED SUMMARY`);
    console.log('='.repeat(80));

    // Calculate combined metrics
    const totalNetProfit = allResults.reduce((sum, r) => sum + r.netProfit, 0);
    const totalInitialCapital = INITIAL_CAPITAL * allResults.length;
    const avgReturnPct = (totalNetProfit / totalInitialCapital) * 100;

    const totalTrades = allResults.reduce((sum, r) => sum + r.totalTrades, 0);
    const totalWinningTrades = allResults.reduce((sum, r) => sum + r.winningTrades, 0);
    const combinedWinRate = totalTrades > 0 ? (totalWinningTrades / totalTrades) * 100 : 0;

    console.log(`   Total Net P&L:     $${totalNetProfit.toFixed(2)}`);
    console.log(`   Average Return:    ${avgReturnPct.toFixed(2)}%`);
    console.log(`   Combined Win Rate: ${combinedWinRate.toFixed(2)}%`);
    console.log(`   Total Trades:      ${totalTrades}`);
    console.log(`   Winning Trades:    ${totalWinningTrades}`);
    console.log();
  }

  console.log('✅ Backtest complete!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
