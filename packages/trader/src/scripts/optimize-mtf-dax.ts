#!/usr/bin/env npx tsx
/**
 * MTF Squeeze Optimizer for DAX
 *
 * Optimizes BB/KC parameters, RSI levels, and TP/SL ratios
 * to maximize Win Rate and Profit Factor
 *
 * Usage: npx tsx src/scripts/optimize-mtf-dax.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface OptimizationResult {
  params: any;
  trades: number;
  winRate: number;
  profitFactor: number;
  netPnl: number;
  maxDD: number;
  expectancy: number;
}

// Load 1m data
function loadData(): Candle[] {
  const csvPath = join(process.cwd(), 'data', 'OTC_GDAXI_1m_180d.csv');
  const csv = readFileSync(csvPath, 'utf-8');
  const lines = csv.trim().split('\n').slice(1); // Skip header

  return lines.map(line => {
    const [timestamp, open, high, low, close, volume] = line.split(',').map(Number);
    return { timestamp, open, high, low, close, volume };
  });
}

// Simple indicators
function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateStdDev(values: number[], period: number, sma: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return Math.sqrt(slice.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / period);
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return NaN;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (!prev || !curr) continue;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + (gains / period) / (losses / period)));
}

// Backtest with specific params
function runBacktest(candles: Candle[], params: any): OptimizationResult {
  const { bbPeriod, bbStdDev, kcMultiplier, rsiPeriod, rsiOversold, rsiOverbought, tpPct, slPct } = params;

  let balance = 1000;
  const trades: any[] = [];
  let activeTrade: any = null;
  const closes: number[] = [];

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    closes.push(candle.close);

    // Check active trade exit
    if (activeTrade) {
      const pnlPct = activeTrade.direction === 'CALL'
        ? (candle.close - activeTrade.entry) / activeTrade.entry
        : (activeTrade.entry - candle.close) / activeTrade.entry;

      if (pnlPct >= tpPct || pnlPct <= -slPct) {
        const pnl = activeTrade.stake * pnlPct * 100; // multiplier 100
        balance += pnl;
        trades.push({
          entry: activeTrade.entry,
          exit: candle.close,
          pnl,
          result: pnl > 0 ? 'WIN' : 'LOSS',
        });
        activeTrade = null;
      }
      continue;
    }

    // Don't enter if we have active trade or not enough data
    if (activeTrade || closes.length < bbPeriod + 10) continue;

    // Calculate indicators
    const sma = calculateSMA(closes, bbPeriod);
    const std = calculateStdDev(closes, bbPeriod, sma);
    const bbUpper = sma + bbStdDev * std;
    const bbLower = sma - bbStdDev * std;

    const atr = calculateATR(candles.slice(i - 20, i + 1), 20);
    const kcUpper = sma + kcMultiplier * atr;
    const kcLower = sma - kcMultiplier * atr;

    const rsi = calculateRSI(closes, rsiPeriod);

    // Squeeze: BB inside KC
    const isSqueeze = bbUpper < kcUpper && bbLower > kcLower;
    if (!isSqueeze) continue;

    // Entry signals
    let direction: 'CALL' | 'PUT' | null = null;

    if (rsi < rsiOversold && candle.close < bbLower) {
      direction = 'CALL';
    } else if (rsi > rsiOverbought && candle.close > bbUpper) {
      direction = 'PUT';
    }

    if (direction) {
      const stake = balance * 0.02; // 2% per trade
      activeTrade = {
        entry: candle.close,
        stake,
        direction,
      };
    }
  }

  // Close any remaining trade
  if (activeTrade) {
    const lastCandle = candles[candles.length - 1];
    const pnlPct = activeTrade.direction === 'CALL'
      ? (lastCandle.close - activeTrade.entry) / activeTrade.entry
      : (activeTrade.entry - lastCandle.close) / activeTrade.entry;
    const pnl = activeTrade.stake * pnlPct * 100;
    balance += pnl;
    trades.push({
      entry: activeTrade.entry,
      exit: lastCandle.close,
      pnl,
      result: pnl > 0 ? 'WIN' : 'LOSS',
    });
  }

  // Calculate metrics
  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  const netPnl = balance - 1000;
  const expectancy = trades.length > 0 ? netPnl / trades.length : 0;

  // Calculate max DD
  let peak = 1000;
  let maxDD = 0;
  let runningBalance = 1000;
  for (const trade of trades) {
    runningBalance += trade.pnl;
    if (runningBalance > peak) peak = runningBalance;
    const dd = peak - runningBalance;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    params,
    trades: trades.length,
    winRate,
    profitFactor,
    netPnl,
    maxDD: (maxDD / 1000) * 100,
    expectancy,
  };
}

// Main optimization
async function main() {
  console.log('═'.repeat(80));
  console.log('🎯 MTF SQUEEZE OPTIMIZER - DAX (OTC_GDAXI)');
  console.log('═'.repeat(80));
  console.log();

  console.log('📥 Loading data...');
  const candles = loadData();
  console.log(`   ✅ Loaded ${candles.length.toLocaleString()} candles\n`);

  // Parameter grid - expanded for more frequency
  const paramGrid = {
    bbPeriod: [15, 20, 25],
    bbStdDev: [1.5, 2.0, 2.5],
    kcMultiplier: [1.5, 2.0, 2.5, 3.0], // Higher multipliers = more squeezes
    rsiPeriod: [7, 14],
    rsiOversold: [20, 25, 30, 35, 40], // Wider range for more signals
    rsiOverbought: [60, 65, 70, 75, 80],
    tpPct: [0.002, 0.003, 0.005], // 0.2%, 0.3%, 0.5% - tighter targets
    slPct: [0.003, 0.005, 0.008],
  };

  const combinations: any[] = [];
  for (const bbPeriod of paramGrid.bbPeriod) {
    for (const bbStdDev of paramGrid.bbStdDev) {
      for (const kcMultiplier of paramGrid.kcMultiplier) {
        for (const rsiPeriod of paramGrid.rsiPeriod) {
          for (const rsiOversold of paramGrid.rsiOversold) {
            for (const rsiOverbought of paramGrid.rsiOverbought) {
              for (const tpPct of paramGrid.tpPct) {
                for (const slPct of paramGrid.slPct) {
                  combinations.push({
                    bbPeriod,
                    bbStdDev,
                    kcMultiplier,
                    rsiPeriod,
                    rsiOversold,
                    rsiOverbought,
                    tpPct,
                    slPct,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`🔬 Testing ${combinations.length} parameter combinations...\n`);

  const results: OptimizationResult[] = [];
  let completed = 0;

  for (const params of combinations) {
    const result = runBacktest(candles, params);
    results.push(result);
    completed++;

    if (completed % 100 === 0) {
      process.stdout.write(`\r   Progress: ${completed}/${combinations.length} (${((completed/combinations.length)*100).toFixed(1)}%)`);
    }
  }

  console.log('\n\n📊 Optimization complete!\n');

  // Sort by multiple criteria
  const byWinRate = [...results].sort((a, b) => b.winRate - a.winRate);
  const byPF = [...results].sort((a, b) => b.profitFactor - a.profitFactor);
  const byNetPnl = [...results].sort((a, b) => b.netPnl - a.netPnl);

  // Combined score: WR * PF * (1 - DD/100)
  const byScore = [...results]
    .filter(r => r.trades >= 50) // Minimum trades
    .map(r => ({
      ...r,
      score: (r.winRate / 100) * r.profitFactor * (1 - Math.min(r.maxDD, 50) / 100),
    }))
    .sort((a, b) => b.score - a.score);

  console.log('═'.repeat(80));
  console.log('🏆 TOP 5 BY WIN RATE');
  console.log('═'.repeat(80));
  console.log();
  for (let i = 0; i < Math.min(5, byWinRate.length); i++) {
    const r = byWinRate[i];
    console.log(`${i+1}. Win Rate: ${r.winRate.toFixed(1)}% | PF: ${r.profitFactor.toFixed(2)} | Trades: ${r.trades} | P&L: $${r.netPnl.toFixed(2)}`);
    console.log(`   BB(${r.params.bbPeriod},${r.params.bbStdDev}) KC(${r.params.kcMultiplier}) RSI(${r.params.rsiPeriod},${r.params.rsiOversold}/${r.params.rsiOverbought}) TP/SL(${(r.params.tpPct*100).toFixed(2)}%/${(r.params.slPct*100).toFixed(2)}%)`);
    console.log();
  }

  console.log('═'.repeat(80));
  console.log('🏆 TOP 5 BY PROFIT FACTOR');
  console.log('═'.repeat(80));
  console.log();
  for (let i = 0; i < Math.min(5, byPF.length); i++) {
    const r = byPF[i];
    console.log(`${i+1}. PF: ${r.profitFactor.toFixed(2)} | Win Rate: ${r.winRate.toFixed(1)}% | Trades: ${r.trades} | P&L: $${r.netPnl.toFixed(2)}`);
    console.log(`   BB(${r.params.bbPeriod},${r.params.bbStdDev}) KC(${r.params.kcMultiplier}) RSI(${r.params.rsiPeriod},${r.params.rsiOversold}/${r.params.rsiOverbought}) TP/SL(${(r.params.tpPct*100).toFixed(2)}%/${(r.params.slPct*100).toFixed(2)}%)`);
    console.log();
  }

  // Balanced configs: Higher frequency (200+ trades) with solid metrics
  const balanced = [...results]
    .filter(r => r.trades >= 200 && r.winRate >= 55 && r.profitFactor >= 1.2)
    .map(r => ({
      ...r,
      tradesPerDay: r.trades / 180,
      score: (r.winRate / 100) * r.profitFactor * (1 - Math.min(r.maxDD, 50) / 100),
    }))
    .sort((a, b) => b.score - a.score);

  console.log('═'.repeat(80));
  console.log('⚖️  TOP 5 BALANCED CONFIGS (1-3 trades/day, WR 55%+, PF 1.2+)');
  console.log('═'.repeat(80));
  console.log();
  if (balanced.length > 0) {
    for (let i = 0; i < Math.min(5, balanced.length); i++) {
      const r = balanced[i];
      console.log(`${i+1}. Score: ${r.score.toFixed(3)} | WR: ${r.winRate.toFixed(1)}% | PF: ${r.profitFactor.toFixed(2)} | P&L: $${r.netPnl.toFixed(2)}`);
      console.log(`   BB(${r.params.bbPeriod},${r.params.bbStdDev}) KC(${r.params.kcMultiplier}) RSI(${r.params.rsiPeriod},${r.params.rsiOversold}/${r.params.rsiOverbought}) TP/SL(${(r.params.tpPct*100).toFixed(2)}%/${(r.params.slPct*100).toFixed(2)}%)`);
      console.log(`   Trades: ${r.trades} (${r.tradesPerDay.toFixed(1)}/day) | DD: ${r.maxDD.toFixed(1)}% | Expectancy: $${r.expectancy.toFixed(2)}`);
      console.log();
    }
  } else {
    console.log('No balanced configs found. Try relaxing filters.\n');
  }

  console.log('═'.repeat(80));
  console.log('🎯 TOP 5 BY COMBINED SCORE (WR × PF × Risk-Adj)');
  console.log('═'.repeat(80));
  console.log();
  for (let i = 0; i < Math.min(5, byScore.length); i++) {
    const r = byScore[i];
    console.log(`${i+1}. Score: ${r.score.toFixed(3)} | WR: ${r.winRate.toFixed(1)}% | PF: ${r.profitFactor.toFixed(2)} | P&L: $${r.netPnl.toFixed(2)}`);
    console.log(`   BB(${r.params.bbPeriod},${r.params.bbStdDev}) KC(${r.params.kcMultiplier}) RSI(${r.params.rsiPeriod},${r.params.rsiOversold}/${r.params.rsiOverbought}) TP/SL(${(r.params.tpPct*100).toFixed(2)}%/${(r.params.slPct*100).toFixed(2)}%)`);
    console.log(`   Trades: ${r.trades} | DD: ${r.maxDD.toFixed(1)}% | Expectancy: $${r.expectancy.toFixed(2)}`);
    console.log();
  }

  console.log('═'.repeat(80));
  console.log('✅ Optimization complete!');
  console.log('═'.repeat(80));
}

main().catch(console.error);
