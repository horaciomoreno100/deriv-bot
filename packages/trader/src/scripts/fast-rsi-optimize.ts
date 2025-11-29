#!/usr/bin/env npx tsx
/**
 * FAST RSI Optimization
 *
 * Pre-calculates RSI ONCE then tests multiple configs with pure simulation.
 * Should be 10-50x faster than full backtest.
 */

import * as fs from 'fs';
import * as path from 'path';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Result {
  config: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  pf: number;
  maxDD: number;
  score: number;
}

// Fast RSI calculation
function calculateRSI(closes: number[], period: number): number[] {
  const result: number[] = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Smoothed RSI
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

// Load CSV fast
function loadCandles(filepath: string): Candle[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000, // Convert ms to s
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
      });
    }
  }

  return candles;
}

// Fast backtest simulation
function runFastBacktest(
  candles: Candle[],
  rsi: number[],
  config: {
    rsiOversold: number;
    rsiOverbought: number;
    tpPct: number;
    slPct: number;
    cooldown: number;
  }
): Result {
  const { rsiOversold, rsiOverbought, tpPct, slPct, cooldown } = config;
  const stake = INITIAL_CAPITAL * STAKE_PCT;

  let equity = INITIAL_CAPITAL;
  let peak = INITIAL_CAPITAL;
  let maxDD = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let cooldownUntil = 0;

  for (let i = 20; i < candles.length - 50; i++) {
    if (i < cooldownUntil) continue;

    const currentRSI = rsi[i]!;
    let direction: 'LONG' | 'SHORT' | null = null;

    if (currentRSI <= rsiOversold) {
      direction = 'LONG';
    } else if (currentRSI >= rsiOverbought) {
      direction = 'SHORT';
    }

    if (!direction) continue;

    // Enter trade
    const entryPrice = candles[i]!.close;
    const tpPrice = direction === 'LONG'
      ? entryPrice * (1 + tpPct / 100)
      : entryPrice * (1 - tpPct / 100);
    const slPrice = direction === 'LONG'
      ? entryPrice * (1 - slPct / 100)
      : entryPrice * (1 + slPct / 100);

    // Simulate trade
    let exitPrice = entryPrice;
    let outcome: 'WIN' | 'LOSS' = 'LOSS';

    for (let j = i + 1; j < Math.min(i + 50, candles.length); j++) {
      const candle = candles[j]!;

      if (direction === 'LONG') {
        if (candle.low <= slPrice) {
          exitPrice = slPrice;
          outcome = 'LOSS';
          break;
        }
        if (candle.high >= tpPrice) {
          exitPrice = tpPrice;
          outcome = 'WIN';
          break;
        }
      } else {
        if (candle.high >= slPrice) {
          exitPrice = slPrice;
          outcome = 'LOSS';
          break;
        }
        if (candle.low <= tpPrice) {
          exitPrice = tpPrice;
          outcome = 'WIN';
          break;
        }
      }
    }

    // Calculate PnL
    const priceDiff = direction === 'LONG'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    const pnl = stake * MULTIPLIER * priceDiff;

    trades++;
    equity += pnl;

    if (outcome === 'WIN') {
      wins++;
      grossProfit += pnl;
    } else {
      losses++;
      grossLoss += Math.abs(pnl);
    }

    // Track drawdown
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDD) maxDD = dd;

    // Set cooldown
    cooldownUntil = i + cooldown;
  }

  const netPnl = grossProfit - grossLoss;
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;
  const score = pf > 1 ? (pf - 1) * Math.sqrt(trades) * (1 - maxDD / 100) : -Math.abs(netPnl);

  return {
    config: `RSI ${rsiOversold}/${rsiOverbought}, TP ${tpPct}% SL ${slPct}%, CD ${cooldown}`,
    trades,
    wins,
    losses,
    netPnl,
    pf,
    maxDD,
    score,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('  FAST RSI OPTIMIZATION');
  console.log('='.repeat(80));

  const assets = ['cryBTCUSD', 'cryETHUSD'];

  for (const asset of assets) {
    const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);

    if (!fs.existsSync(filepath)) {
      console.log(`\nSkipping ${asset} - data not found`);
      continue;
    }

    console.log(`\n\n${asset}`);
    console.log('-'.repeat(80));

    // Load data once
    console.log('Loading candles...');
    const candles = loadCandles(filepath);
    console.log(`Loaded ${candles.length.toLocaleString()} candles`);

    // Calculate RSI once
    console.log('Calculating RSI...');
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, 14);

    // Test configs
    console.log('Testing configurations...');
    const results: Result[] = [];

    const rsiConfigs = [
      { os: 25, ob: 75 },
      { os: 23, ob: 77 },
      { os: 20, ob: 80 },
      { os: 18, ob: 82 },
      { os: 17, ob: 83 },
      { os: 15, ob: 85 },
      { os: 12, ob: 88 },
    ];

    const tpslConfigs = [
      { tp: 0.25, sl: 0.25 },
      { tp: 0.3, sl: 0.2 },
      { tp: 0.4, sl: 0.2 },
      { tp: 0.5, sl: 0.25 },
      { tp: 0.6, sl: 0.2 },
    ];

    const cooldowns = [3, 5, 10, 15];

    const startTime = Date.now();

    for (const rsiCfg of rsiConfigs) {
      for (const tpsl of tpslConfigs) {
        for (const cd of cooldowns) {
          const result = runFastBacktest(candles, rsi, {
            rsiOversold: rsiCfg.os,
            rsiOverbought: rsiCfg.ob,
            tpPct: tpsl.tp,
            slPct: tpsl.sl,
            cooldown: cd,
          });
          results.push(result);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Tested ${results.length} configs in ${elapsed}ms`);

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Print results
    console.log('\nTOP 15 CONFIGURATIONS');
    console.log('-'.repeat(80));
    console.log('Config'.padEnd(42) + '| Trades | W/L   | Net$  | PF   | DD%  | Score');
    console.log('-'.repeat(80));

    for (const r of results.slice(0, 15)) {
      const winRate = r.trades > 0 ? (r.wins / r.trades * 100).toFixed(0) : '0';
      const marker = r.pf >= 1.5 ? ' *' : r.pf >= 1.3 ? ' +' : '';
      console.log(
        r.config.padEnd(42) + '| ' +
        String(r.trades).padStart(6) + ' | ' +
        `${r.wins}/${r.losses}`.padStart(5) + ' | ' +
        ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
        r.pf.toFixed(2).padStart(4) + ' | ' +
        r.maxDD.toFixed(1).padStart(4) + '% | ' +
        r.score.toFixed(1).padStart(5) + marker
      );
    }

    // Summary
    const profitable = results.filter(r => r.pf > 1);
    const manyTrades = results.filter(r => r.trades >= 200 && r.pf > 1);

    console.log('\n📊 SUMMARY');
    console.log(`  Profitable: ${profitable.length}/${results.length}`);
    console.log(`  200+ trades & profitable: ${manyTrades.length}`);

    if (manyTrades.length > 0) {
      console.log('\n🎯 BEST HIGH-VOLUME (200+ trades, PF > 1):');
      const best = manyTrades.sort((a, b) => b.pf - a.pf).slice(0, 3);
      for (const r of best) {
        console.log(`  ${r.config} → ${r.trades} trades, PF ${r.pf.toFixed(2)}, $${r.netPnl.toFixed(0)}`);
      }
    }
  }

  console.log('\n\n* = PF >= 1.5, + = PF >= 1.3');
  console.log('Done!');
}

main().catch(console.error);
