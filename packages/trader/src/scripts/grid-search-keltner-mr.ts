/**
 * Grid Search Optimization for KELTNER_MR Strategy
 *
 * Applies the same optimization methodology used for BB_BOUNCE to KELTNER_MR.
 * Uses composite scoring function that balances profitability, frequency, and risk.
 *
 * Score = (Profit Factor - 1) × sqrt(Trades) × (1 - MaxDrawdown/100)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Candle } from '@deriv-bot/shared';
import { createKeltnerMR, type KeltnerMRParams } from '../strategies/mr/keltner-mr.strategy.js';
import {
  type BacktestConfig,
  type Trade,
  type Direction,
  calculateMetrics,
  createTradeEntry,
  executeTrade,
} from '../backtest/backtest-engine.js';
import {
  calculateATR,
  calculateADX,
  calculateRSI,
  calculateEMA,
  calculateBollingerBands,
} from '../indicators/index.js';
import type { IndicatorSnapshot } from '../strategies/mr/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Grid search parameter ranges - REDUCED for faster execution
// Total combinations: 1 × 1 × 3 × 2 × 2 × 3 × 2 × 2 × 3 = 432 (vs 43,740 original)
const PARAM_GRID = {
  kcEmaPeriod: [20],              // Fixed at standard value
  kcAtrPeriod: [14],              // Fixed at standard value
  kcMultiplier: [1.5, 2.0, 2.5],  // 3 values
  rsiOversold: [30, 35],          // 2 values
  rsiOverbought: [65, 70],        // 2 values
  slMultiplier: [1.0, 1.5, 2.0],  // 3 values
  maxBars: [10, 15],              // 2 values
  adxThreshold: [25, 30],         // 2 values
  multiplier: [200, 300, 500],    // 3 values (skip low multipliers)
};

// Constraints
const CONSTRAINTS = {
  minTrades: 500, // Minimum 500 trades/year (~2/day)
  minProfitFactor: 1.05,
  maxDrawdown: 50, // Max 50% drawdown
  minWinRate: 25,
};

// Base backtest config
const BASE_CONFIG = {
  initialBalance: 1000,
  stakePct: 0.04, // 4%
};

// ============================================================================
// TYPES
// ============================================================================

interface GridSearchResult {
  params: {
    kcEmaPeriod: number;
    kcAtrPeriod: number;
    kcMultiplier: number;
    rsiOversold: number;
    rsiOverbought: number;
    slMultiplier: number;
    maxBars: number;
    adxThreshold: number;
    multiplier: number;
  };
  metrics: {
    trades: number;
    wins: number;
    winRate: number;
    netPnL: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
    tradesPerDay: number;
  };
  score: number;
  passedConstraints: boolean;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('🔍 GRID SEARCH: KELTNER_MR Strategy Optimization');
  console.log('═'.repeat(70));

  // Load data
  const dataFile = process.env.DATA_FILE || 'analysis-output/frxEURUSD_300s_365d.csv';
  const dataPath = resolve(process.cwd(), dataFile);

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  console.log(`\n📂 Loading data from: ${dataFile}`);
  const candles = loadCandles(dataPath);
  console.log(`   Loaded ${candles.length.toLocaleString()} candles`);

  // Calculate trading days
  const startDate = new Date(candles[0]!.timestamp * 1000);
  const endDate = new Date(candles[candles.length - 1]!.timestamp * 1000);
  const tradingDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  console.log(`   Trading days: ${tradingDays}`);

  // Pre-calculate indicators once
  console.log('\n📊 Pre-calculating indicators...');
  const indicators = precalculateIndicators(candles);

  // Calculate total combinations
  const totalCombinations = Object.values(PARAM_GRID).reduce((acc, arr) => acc * arr.length, 1);
  console.log(`\n🔄 Running grid search with ${totalCombinations.toLocaleString()} combinations...`);
  console.log(`   Constraints: minTrades=${CONSTRAINTS.minTrades}, minPF=${CONSTRAINTS.minProfitFactor}, maxDD=${CONSTRAINTS.maxDrawdown}%`);

  // Run grid search
  const results: GridSearchResult[] = [];
  let tested = 0;
  let passed = 0;

  // Generate all combinations
  for (const kcEmaPeriod of PARAM_GRID.kcEmaPeriod) {
    for (const kcAtrPeriod of PARAM_GRID.kcAtrPeriod) {
      for (const kcMultiplier of PARAM_GRID.kcMultiplier) {
        for (const rsiOversold of PARAM_GRID.rsiOversold) {
          for (const rsiOverbought of PARAM_GRID.rsiOverbought) {
            // Skip invalid RSI combinations
            if (rsiOversold >= rsiOverbought - 20) continue;

            for (const slMultiplier of PARAM_GRID.slMultiplier) {
              for (const maxBars of PARAM_GRID.maxBars) {
                for (const adxThreshold of PARAM_GRID.adxThreshold) {
                  for (const multiplier of PARAM_GRID.multiplier) {
                    tested++;

                    // Progress update
                    if (tested % 50 === 0) {
                      console.log(`   Progress: ${tested}/${totalCombinations} (${((tested / totalCombinations) * 100).toFixed(1)}%) | Passed: ${passed}`);
                    }

                    // Run backtest
                    const result = runBacktest(candles, indicators, tradingDays, {
                      kcEmaPeriod,
                      kcAtrPeriod,
                      kcMultiplier,
                      rsiOversold,
                      rsiOverbought,
                      slMultiplier,
                      maxBars,
                      adxThreshold,
                      multiplier,
                    });

                    if (result.passedConstraints) {
                      passed++;
                      results.push(result);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`\r   Progress: ${tested}/${totalCombinations} (100%) | Passed: ${passed}           `);

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // Print results
  console.log('\n' + '═'.repeat(70));
  console.log('📊 TOP 20 COMBINATIONS');
  console.log('═'.repeat(70));

  console.log(`\nRank | Score  | Trades | WR%   | PF    | P&L      | DD%   | Mult | Params`);
  console.log('─'.repeat(90));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i]!;
    const pnlStr = r.metrics.netPnL >= 0 ? `+$${r.metrics.netPnL.toFixed(0)}` : `-$${Math.abs(r.metrics.netPnL).toFixed(0)}`;

    console.log(
      `${String(i + 1).padStart(3)}  | ${r.score.toFixed(2).padStart(6)} | ${String(r.metrics.trades).padStart(6)} | ${r.metrics.winRate.toFixed(1).padStart(5)} | ${r.metrics.profitFactor.toFixed(2).padStart(5)} | ${pnlStr.padStart(8)} | ${r.metrics.maxDrawdown.toFixed(1).padStart(5)} | ${String(r.params.multiplier).padStart(4)} | EMA${r.params.kcEmaPeriod} KC${r.params.kcMultiplier} SL${r.params.slMultiplier} ADX${r.params.adxThreshold}`
    );
  }

  // Best result details
  if (results.length > 0) {
    const best = results[0]!;
    console.log('\n' + '═'.repeat(70));
    console.log('🏆 BEST CONFIGURATION');
    console.log('═'.repeat(70));

    console.log('\nStrategy Parameters:');
    console.log(`  kcEmaPeriod:   ${best.params.kcEmaPeriod}`);
    console.log(`  kcAtrPeriod:   ${best.params.kcAtrPeriod}`);
    console.log(`  kcMultiplier:  ${best.params.kcMultiplier}`);
    console.log(`  rsiOversold:   ${best.params.rsiOversold}`);
    console.log(`  rsiOverbought: ${best.params.rsiOverbought}`);
    console.log(`  slMultiplier:  ${best.params.slMultiplier}`);
    console.log(`  maxBars:       ${best.params.maxBars}`);
    console.log(`  adxThreshold:  ${best.params.adxThreshold}`);

    console.log('\nBacktest Config:');
    console.log(`  multiplier:    ${best.params.multiplier}`);
    console.log(`  stakePct:      ${BASE_CONFIG.stakePct * 100}%`);
    console.log(`  initialBalance: $${BASE_CONFIG.initialBalance}`);

    console.log('\nResults:');
    console.log(`  Trades:        ${best.metrics.trades} (${best.metrics.tradesPerDay.toFixed(1)}/day)`);
    console.log(`  Win Rate:      ${best.metrics.winRate.toFixed(1)}%`);
    console.log(`  Profit Factor: ${best.metrics.profitFactor.toFixed(2)}`);
    console.log(`  Expectancy:    $${best.metrics.expectancy.toFixed(2)}/trade`);
    console.log(`  Net P&L:       $${best.metrics.netPnL.toFixed(2)}`);
    console.log(`  ROI:           ${((best.metrics.netPnL / BASE_CONFIG.initialBalance) * 100).toFixed(1)}%`);
    console.log(`  Max Drawdown:  ${best.metrics.maxDrawdown.toFixed(1)}%`);
    console.log(`  Score:         ${best.score.toFixed(2)}`);

    // Compare with different multipliers for best params
    console.log('\n📈 MULTIPLIER COMPARISON (Best Params):');
    console.log('Mult  | Trades | WR%   | PF    | P&L      | DD%   | ROI%');
    console.log('─'.repeat(60));

    for (const mult of [100, 200, 300, 400, 500]) {
      const r = runBacktest(candles, indicators, tradingDays, { ...best.params, multiplier: mult });
      const pnlStr = r.metrics.netPnL >= 0 ? `+$${r.metrics.netPnL.toFixed(0)}` : `-$${Math.abs(r.metrics.netPnL).toFixed(0)}`;
      const roi = ((r.metrics.netPnL / BASE_CONFIG.initialBalance) * 100).toFixed(1);
      console.log(
        `${String(mult).padStart(4)}× | ${String(r.metrics.trades).padStart(6)} | ${r.metrics.winRate.toFixed(1).padStart(5)} | ${r.metrics.profitFactor.toFixed(2).padStart(5)} | ${pnlStr.padStart(8)} | ${r.metrics.maxDrawdown.toFixed(1).padStart(5)} | ${roi}%`
      );
    }
  }

  // Save results
  const output = {
    gridSearch: {
      totalCombinations: tested,
      passed,
      constraints: CONSTRAINTS,
    },
    bestResult: results[0] || null,
    top20: results.slice(0, 20),
    allPassed: results,
  };

  const outputPath = resolve(process.cwd(), 'analysis-output/keltner_grid_search.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved to: ${outputPath}`);

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📋 SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  Total combinations tested: ${tested.toLocaleString()}`);
  console.log(`  Passed constraints:        ${passed} (${((passed / tested) * 100).toFixed(1)}%)`);

  if (results.length > 0) {
    const avgPF = results.reduce((sum, r) => sum + r.metrics.profitFactor, 0) / results.length;
    const avgDD = results.reduce((sum, r) => sum + r.metrics.maxDrawdown, 0) / results.length;
    console.log(`  Avg Profit Factor:         ${avgPF.toFixed(2)}`);
    console.log(`  Avg Max Drawdown:          ${avgDD.toFixed(1)}%`);
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================

function loadCandles(filePath: string): Candle[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0]!.split(',');

  const timestampIdx = headers.indexOf('timestamp');
  const openIdx = headers.indexOf('open');
  const highIdx = headers.indexOf('high');
  const lowIdx = headers.indexOf('low');
  const closeIdx = headers.indexOf('close');

  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return {
      timestamp: parseInt(values[timestampIdx]!, 10),
      open: parseFloat(values[openIdx]!),
      high: parseFloat(values[highIdx]!),
      low: parseFloat(values[lowIdx]!),
      close: parseFloat(values[closeIdx]!),
    };
  });
}

// ============================================================================
// INDICATOR PRE-CALCULATION
// ============================================================================

function precalculateIndicators(candles: Candle[]): (IndicatorSnapshot | null)[] {
  const atrValues = calculateATR(candles, 14);
  const adxValues = calculateADX(candles, 14);
  const rsiValues = calculateRSI(candles, 14);
  const emaValues = calculateEMA(candles, 20);
  const bbValues = calculateBollingerBands(candles, 20, 2);

  const atrOffset = candles.length - atrValues.length;
  const adxOffset = candles.length - adxValues.length;
  const rsiOffset = candles.length - rsiValues.length;
  const emaOffset = candles.length - emaValues.length;
  const bbOffset = candles.length - bbValues.length;

  const snapshots: (IndicatorSnapshot | null)[] = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const atrIdx = i - atrOffset;
    const adxIdx = i - adxOffset;
    const rsiIdx = i - rsiOffset;
    const emaIdx = i - emaOffset;
    const bbIdx = i - bbOffset;

    if (atrIdx < 0 || adxIdx < 0 || rsiIdx < 0 || emaIdx < 0 || bbIdx < 0) continue;

    const atr = atrValues[atrIdx];
    const adxObj = adxValues[adxIdx];
    const rsi = rsiValues[rsiIdx];
    const ema = emaValues[emaIdx];
    const bb = bbValues[bbIdx];

    if (atr === undefined || !adxObj || rsi === undefined || ema === undefined || !bb) continue;

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

// ============================================================================
// BACKTEST
// ============================================================================

function runBacktest(
  candles: Candle[],
  indicators: (IndicatorSnapshot | null)[],
  tradingDays: number,
  params: GridSearchResult['params']
): GridSearchResult {
  const strategy = createKeltnerMR({
    kcEmaPeriod: params.kcEmaPeriod,
    kcAtrPeriod: params.kcAtrPeriod,
    kcMultiplier: params.kcMultiplier,
    rsiOversold: params.rsiOversold,
    rsiOverbought: params.rsiOverbought,
    slMultiplier: params.slMultiplier,
    maxBars: params.maxBars,
    adxThreshold: params.adxThreshold,
  });

  const btConfig: BacktestConfig = {
    initialBalance: BASE_CONFIG.initialBalance,
    stakePct: BASE_CONFIG.stakePct,
    multiplier: params.multiplier,
    takeProfitPct: 0.01, // Will be overridden
    stopLossPct: 0.01, // Will be overridden
    maxBarsInTrade: params.maxBars,
    cooldownBars: 1,
  };

  const trades: Trade[] = [];
  let cooldownUntil = 0;
  const startIdx = 50;

  for (let i = startIdx; i < candles.length; i++) {
    const candle = candles[i]!;
    if (i < cooldownUntil) continue;

    const ind = indicators[i];
    if (!ind) continue;

    const historicalCandles = candles.slice(Math.max(0, i - 100), i + 1);
    const entrySignal = strategy.checkEntry(historicalCandles, ind);

    if (entrySignal) {
      const direction: Direction = entrySignal.direction === 'LONG' ? 'CALL' : 'PUT';
      const tpPct = Math.abs((entrySignal.takeProfit - candle.close) / candle.close);
      const slPct = Math.abs((entrySignal.stopLoss - candle.close) / candle.close);

      const configWithTP = {
        ...btConfig,
        takeProfitPct: tpPct,
        stopLossPct: slPct,
        maxBarsInTrade: entrySignal.maxBars || btConfig.maxBarsInTrade,
      };

      const entry = createTradeEntry(candle.timestamp, direction, candle.close, configWithTP);
      const futureCandles = candles.slice(i + 1, i + 1 + btConfig.maxBarsInTrade + 5).map((c) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const trade = executeTrade(entry, futureCandles, configWithTP);

      if (trade) {
        trades.push(trade);
        cooldownUntil = i + trade.barsHeld + btConfig.cooldownBars;
      }
    }
  }

  // Calculate metrics
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalWinPnL = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLossPnL = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnL = totalWinPnL - totalLossPnL;
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLossPnL > 0 ? totalWinPnL / totalLossPnL : totalWinPnL > 0 ? Infinity : 0;
  const expectancy = trades.length > 0 ? netPnL / trades.length : 0;

  // Calculate max drawdown
  let equity = BASE_CONFIG.initialBalance;
  let peak = equity;
  let maxDD = 0;

  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const dd = ((peak - equity) / peak) * 100;
    maxDD = Math.max(maxDD, dd);
  }

  // Check constraints
  const passedConstraints =
    trades.length >= CONSTRAINTS.minTrades &&
    profitFactor >= CONSTRAINTS.minProfitFactor &&
    maxDD <= CONSTRAINTS.maxDrawdown &&
    winRate >= CONSTRAINTS.minWinRate &&
    profitFactor !== Infinity;

  // Calculate score: (PF - 1) × sqrt(trades) × (1 - DD/100)
  const score = passedConstraints ? (profitFactor - 1) * Math.sqrt(trades.length) * (1 - maxDD / 100) : 0;

  return {
    params,
    metrics: {
      trades: trades.length,
      wins: wins.length,
      winRate,
      netPnL,
      profitFactor,
      expectancy,
      maxDrawdown: maxDD,
      tradesPerDay: trades.length / tradingDays,
    },
    score,
    passedConstraints,
  };
}

// Run
main().catch(console.error);
