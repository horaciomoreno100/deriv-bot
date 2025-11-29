#!/usr/bin/env npx tsx
/**
 * RSI Scalp Parameter Optimization
 * Tests different parameter combinations to find optimal edge
 */

import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { RSIScalpBacktestStrategy } from '../backtest/strategies/rsi-scalp-backtest.strategy.js';
import type { RSIScalpParams } from '../strategies/rsi-scalp.types.js';

const ASSET = process.env.ASSET ?? 'cryBTCUSD';
const DAYS = parseInt(process.env.DAYS ?? '90', 10);
const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.02;
const MULTIPLIER = 50;

// Parameter grid
const RSI_LONG_THRESHOLDS = [20, 25, 28, 30];
const RSI_SHORT_THRESHOLDS = [70, 72, 75, 80];
const TP_PERCENTS = [0.4, 0.5, 0.6, 0.8, 1.0];
const SL_PERCENTS = [0.8, 1.0, 1.2, 1.5];
const COOLDOWNS = [3, 5, 8, 10];

interface TestResult {
  params: string;
  trades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDD: number;
  avgTrade: number;
  rsiLong: number;
  rsiShort: number;
  tp: number;
  sl: number;
  cooldown: number;
}

async function main() {
  console.log('═'.repeat(80));
  console.log('  RSI SCALP PARAMETER OPTIMIZATION');
  console.log('═'.repeat(80));
  console.log(`\n  Asset: ${ASSET}`);
  console.log(`  Days: ${DAYS}\n`);

  // Load data
  const dataDir = path.join(process.cwd(), 'data');
  const dataFile = `${ASSET}_1m_${DAYS}d.csv`;
  const dataPath = path.join(dataDir, dataFile);

  console.log(`📥 Loading ${dataFile}...`);
  const candles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });
  console.log(`   Loaded ${candles.length.toLocaleString()} candles\n`);

  const results: TestResult[] = [];
  let totalTests = 0;

  // Quick scan - test key combinations
  console.log('🔍 Running parameter scan...\n');
  
  for (const rsiLong of RSI_LONG_THRESHOLDS) {
    for (const rsiShort of RSI_SHORT_THRESHOLDS) {
      for (const tp of TP_PERCENTS) {
        for (const sl of SL_PERCENTS) {
          for (const cooldown of COOLDOWNS) {
            // Skip obviously bad combinations
            if (tp >= sl) continue; // TP should be less than SL for positive expectancy
            
            totalTests++;
            
            const params: Partial<RSIScalpParams> = {
              entryLevels: {
                long: [
                  { rsiThreshold: rsiLong, sizePercent: 100, enabled: true },
                ],
                short: [
                  { rsiThreshold: rsiShort, sizePercent: 100, enabled: true },
                ],
              },
              takeProfitLevels: [
                { profitPercent: tp, rsiThreshold: 50, exitPercent: 100 },
              ],
              stopLossPercent: sl,
              cooldownBars: cooldown,
            };

            const strategy = new RSIScalpBacktestStrategy(ASSET, params);
            
            try {
              const result = runBacktest(strategy, candles, {
                asset: ASSET,
                timeframe: 60,
                initialBalance: INITIAL_CAPITAL,
                multiplier: MULTIPLIER,
                stakeAmount: INITIAL_CAPITAL * STAKE_PCT,
                takeProfitPct: tp / 100,
                stopLossPct: sl / 100,
              });

              const m = result.metrics;
              
              if (m.totalTrades >= 50) {
                results.push({
                  params: `RSI ${rsiLong}/${rsiShort}, TP ${tp}%, SL ${sl}%, CD ${cooldown}`,
                  trades: m.totalTrades,
                  winRate: m.winRate,
                  netPnl: m.netPnl,
                  profitFactor: m.profitFactor,
                  maxDD: m.maxDrawdownPct,
                  avgTrade: m.avgPnl,
                  rsiLong,
                  rsiShort,
                  tp,
                  sl,
                  cooldown,
                });
              }
            } catch (e) {
              // Skip failed tests
            }
          }
        }
      }
    }
    process.stdout.write(`  Progress: RSI Long ${rsiLong} complete\n`);
  }

  console.log(`\n  Total tests run: ${totalTests}`);
  console.log(`  Valid results: ${results.length}\n`);

  // Sort by profit factor
  results.sort((a, b) => b.profitFactor - a.profitFactor);

  // Show top 20 results
  console.log('═'.repeat(80));
  console.log('  TOP 20 CONFIGURATIONS (by Profit Factor)');
  console.log('═'.repeat(80));
  console.log('');
  console.log('  #  | RSI L/S | TP%  | SL%  | CD | Trades | Win%  | Net P&L | PF   | DD%');
  console.log('─'.repeat(80));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i]!;
    console.log(
      `  ${String(i + 1).padStart(2)} | ` +
      `${String(r.rsiLong).padStart(2)}/${String(r.rsiShort).padStart(2)}  | ` +
      `${r.tp.toFixed(1).padStart(4)} | ` +
      `${r.sl.toFixed(1).padStart(4)} | ` +
      `${String(r.cooldown).padStart(2)} | ` +
      `${String(r.trades).padStart(6)} | ` +
      `${r.winRate.toFixed(1).padStart(5)}% | ` +
      `$${r.netPnl.toFixed(0).padStart(7)} | ` +
      `${r.profitFactor.toFixed(2).padStart(4)} | ` +
      `${r.maxDD.toFixed(1).padStart(4)}%`
    );
  }

  // Filter for PF >= 1.3
  const goodResults = results.filter(r => r.profitFactor >= 1.3);
  
  if (goodResults.length > 0) {
    console.log('\n═'.repeat(80));
    console.log('  CONFIGURATIONS WITH PF >= 1.3');
    console.log('═'.repeat(80));
    console.log('');
    console.log('  #  | RSI L/S | TP%  | SL%  | CD | Trades | Win%  | Net P&L | PF   | DD%');
    console.log('─'.repeat(80));

    for (let i = 0; i < Math.min(20, goodResults.length); i++) {
      const r = goodResults[i]!;
      console.log(
        `  ${String(i + 1).padStart(2)} | ` +
        `${String(r.rsiLong).padStart(2)}/${String(r.rsiShort).padStart(2)}  | ` +
        `${r.tp.toFixed(1).padStart(4)} | ` +
        `${r.sl.toFixed(1).padStart(4)} | ` +
        `${String(r.cooldown).padStart(2)} | ` +
        `${String(r.trades).padStart(6)} | ` +
        `${r.winRate.toFixed(1).padStart(5)}% | ` +
        `$${r.netPnl.toFixed(0).padStart(7)} | ` +
        `${r.profitFactor.toFixed(2).padStart(4)} | ` +
        `${r.maxDD.toFixed(1).padStart(4)}%`
      );
    }
  } else {
    console.log('\n⚠️  No configurations found with PF >= 1.3');
  }

  // Conclusions
  console.log('\n═'.repeat(80));
  console.log('  CONCLUSIONS');
  console.log('═'.repeat(80));
  
  const best = results[0];
  if (best) {
    console.log(`\n  Best configuration found:`);
    console.log(`    RSI Long threshold: ${best.rsiLong}`);
    console.log(`    RSI Short threshold: ${best.rsiShort}`);
    console.log(`    Take Profit: ${best.tp}%`);
    console.log(`    Stop Loss: ${best.sl}%`);
    console.log(`    Cooldown: ${best.cooldown} bars`);
    console.log(`\n  Performance:`);
    console.log(`    Trades: ${best.trades}`);
    console.log(`    Win Rate: ${best.winRate.toFixed(1)}%`);
    console.log(`    Profit Factor: ${best.profitFactor.toFixed(2)}`);
    console.log(`    Net P&L: $${best.netPnl.toFixed(2)}`);
    console.log(`    Max Drawdown: ${best.maxDD.toFixed(1)}%`);
  }

  console.log('\n✅ Optimization complete!');
}

main().catch(console.error);
