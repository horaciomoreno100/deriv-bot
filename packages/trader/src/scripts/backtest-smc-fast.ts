#!/usr/bin/env npx tsx
/**
 * SMC Opportunity Fast Backtest
 *
 * OPTIMIZED VERSION: Pre-calculates ALL signals ONCE, then simulates trades.
 * This avoids the O(n^2) complexity of recalculating at each bar.
 *
 * Usage:
 *   ASSET="R_100" DAYS=7 npx tsx src/scripts/backtest-smc-fast.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { MTFMarketStructureAnalyzer } from '../analysis/mtf-market-structure.js';
import { OrderBlockDetector } from '../analysis/order-block-detector.js';
import { FVGDetector } from '../analysis/fvg-detector.js';
import { LiquiditySweepDetector } from '../analysis/liquidity-sweep-detector.js';
import {
  SMCOpportunityDetector,
  getHighQualitySetups,
  type SMCOpportunity,
} from '../analysis/smc-opportunity-detector.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSETS = (process.env.ASSET ?? 'R_100').split(',').map((a) => a.trim());
const DAYS = parseInt(process.env.DAYS ?? '7', 10);
const MIN_QUALITY = process.env.QUALITY ?? 'A';
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE ?? '1000');
const STAKE_PCT = parseFloat(process.env.STAKE_PCT ?? '0.02');
const MULTIPLIER = parseFloat(process.env.MULTIPLIER ?? '100');

interface Trade {
  signal: SMCOpportunity;
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  exitReason: 'TP' | 'SL' | 'TIMEOUT';
  pnl: number;
  result: 'WIN' | 'LOSS';
  barsHeld: number;
}

/**
 * Simulate a trade from signal
 */
function simulateTrade(
  signal: SMCOpportunity,
  candles: Candle[],
  entryIndex: number,
  maxBars: number = 30
): Trade | null {
  const entryCandle = candles[entryIndex];
  if (!entryCandle) return null;

  const entryPrice = signal.idealEntry;
  const direction = signal.direction;

  // Use structural TP/SL with sanity limits
  let tpPrice = signal.structuralTP1;
  let slPrice = signal.structuralSL;

  // Cap TP/SL at reasonable percentages
  const maxTPPct = 0.015; // 1.5%
  const maxSLPct = 0.01; // 1%

  if (direction === 'long') {
    tpPrice = Math.min(tpPrice, entryPrice * (1 + maxTPPct));
    slPrice = Math.max(slPrice, entryPrice * (1 - maxSLPct));
  } else {
    tpPrice = Math.max(tpPrice, entryPrice * (1 - maxTPPct));
    slPrice = Math.min(slPrice, entryPrice * (1 + maxSLPct));
  }

  let exitIndex = entryIndex;
  let exitPrice = entryPrice;
  let exitReason: 'TP' | 'SL' | 'TIMEOUT' = 'TIMEOUT';

  // Simulate forward through candles
  for (let i = entryIndex + 1; i < Math.min(entryIndex + maxBars, candles.length); i++) {
    const candle = candles[i]!;

    if (direction === 'long') {
      // Check TP first (optimistic)
      if (candle.high >= tpPrice) {
        exitIndex = i;
        exitPrice = tpPrice;
        exitReason = 'TP';
        break;
      }
      // Check SL
      if (candle.low <= slPrice) {
        exitIndex = i;
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
    } else {
      // Check TP first
      if (candle.low <= tpPrice) {
        exitIndex = i;
        exitPrice = tpPrice;
        exitReason = 'TP';
        break;
      }
      // Check SL
      if (candle.high >= slPrice) {
        exitIndex = i;
        exitPrice = slPrice;
        exitReason = 'SL';
        break;
      }
    }

    // Update for timeout
    exitIndex = i;
    exitPrice = candle.close;
  }

  // Calculate P&L
  const priceChangePct =
    direction === 'long'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

  const stake = INITIAL_BALANCE * STAKE_PCT;
  const pnl = priceChangePct * stake * MULTIPLIER;

  return {
    signal,
    entryIndex,
    entryPrice,
    exitIndex,
    exitPrice,
    exitReason,
    pnl,
    result: pnl > 0 ? 'WIN' : 'LOSS',
    barsHeld: exitIndex - entryIndex,
  };
}

async function runBacktestForAsset(asset: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`SMC FAST BACKTEST: ${asset}`);
  console.log('═'.repeat(60));

  // Find data file
  const dataDir = path.join(process.cwd(), 'data');
  const possibleFiles = [
    `${asset}_1m_${DAYS}d.csv`,
    `${asset}_60s_${DAYS}d.csv`,
    `${asset}_1m_7d.csv`,
    `${asset}_1m_30d.csv`,
    `${asset}_1m_90d.csv`,
  ];

  let dataPath: string | null = null;
  for (const file of possibleFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      dataPath = fullPath;
      break;
    }
  }

  if (!dataPath) {
    console.log(`❌ No data file found for ${asset}`);
    return null;
  }

  console.log(`\n📂 Loading: ${path.basename(dataPath)}`);
  const candles = loadCandlesFromCSV(dataPath, {
    asset,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });

  console.log(`   ${candles.length.toLocaleString()} candles loaded`);

  if (candles.length < 500) {
    console.log('❌ Not enough candles');
    return null;
  }

  // =====================================================================
  // STEP 1: Pre-calculate ALL SMC components ONCE
  // =====================================================================
  console.log('\n🔍 Pre-calculating SMC components...');
  const startTime = Date.now();

  const mtfAnalyzer = new MTFMarketStructureAnalyzer();
  const mtfStructure = mtfAnalyzer.analyze(candles);
  console.log(`   MTF Structure: ${mtfStructure.allZones.length} zones, ${mtfStructure.confluenceZones.length} confluence zones`);

  const obDetector = new OrderBlockDetector();
  const orderBlocks = obDetector.detect(candles);
  console.log(`   Order Blocks: ${orderBlocks.length} detected`);

  const fvgDetector = new FVGDetector({ minGapPct: 0.03 });
  const fvgs = fvgDetector.detect(candles);
  const unfilledFVGs = fvgDetector.getUnfilledFVGs(fvgs);
  console.log(`   FVGs: ${fvgs.length} total, ${unfilledFVGs.length} unfilled`);

  const sweepDetector = new LiquiditySweepDetector();
  const sweeps = sweepDetector.detect(candles, mtfStructure.tf1m.swingPoints);
  console.log(`   Liquidity Sweeps: ${sweeps.length} detected`);

  // =====================================================================
  // STEP 2: Detect ALL SMC opportunities
  // =====================================================================
  console.log('\n🎯 Detecting SMC opportunities...');

  const smcDetector = new SMCOpportunityDetector();
  const allOpportunities = smcDetector.detect({
    candles,
    mtfStructure,
    orderBlocks,
    fvgs: unfilledFVGs,
    sweeps,
    asset,
  });

  const precalcTime = Date.now() - startTime;
  console.log(`   Total opportunities: ${allOpportunities.length}`);
  console.log(`   Pre-calculation time: ${precalcTime}ms`);

  // Filter by quality
  const qualityOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3 };
  const minQualityLevel = qualityOrder[MIN_QUALITY] ?? 1;

  const filteredOpportunities = allOpportunities.filter(
    (opp) => qualityOrder[opp.quality] <= minQualityLevel
  );

  console.log(`   After quality filter (>= ${MIN_QUALITY}): ${filteredOpportunities.length}`);

  // Group by quality
  const byQuality = {
    'A+': allOpportunities.filter((o) => o.quality === 'A+').length,
    A: allOpportunities.filter((o) => o.quality === 'A').length,
    B: allOpportunities.filter((o) => o.quality === 'B').length,
    C: allOpportunities.filter((o) => o.quality === 'C').length,
  };
  console.log(`   By quality: A+=${byQuality['A+']} A=${byQuality.A} B=${byQuality.B} C=${byQuality.C}`);

  if (filteredOpportunities.length === 0) {
    console.log('\n❌ No opportunities matching quality filter');
    return null;
  }

  // =====================================================================
  // STEP 3: Simulate trades from opportunities
  // =====================================================================
  console.log('\n💹 Simulating trades...');

  // Sort opportunities by origin index to process chronologically
  const sortedOpps = [...filteredOpportunities].sort(
    (a, b) => a.originIndex - b.originIndex
  );

  const trades: Trade[] = [];
  let lastExitIndex = 0;
  const cooldownBars = 5;

  for (const opp of sortedOpps) {
    // Skip if we're in cooldown
    if (opp.originIndex < lastExitIndex + cooldownBars) continue;

    // Find entry index (first candle that touches entry zone after origin)
    let entryIndex = -1;
    for (let i = opp.originIndex + 1; i < Math.min(opp.originIndex + 50, candles.length); i++) {
      const candle = candles[i]!;
      const touchesZone =
        opp.direction === 'long'
          ? candle.low <= opp.entryZoneHigh
          : candle.high >= opp.entryZoneLow;

      if (touchesZone) {
        entryIndex = i;
        break;
      }
    }

    if (entryIndex === -1) continue; // Never reached entry zone

    // Simulate the trade
    const trade = simulateTrade(opp, candles, entryIndex, 30);
    if (trade) {
      trades.push(trade);
      lastExitIndex = trade.exitIndex;
    }
  }

  console.log(`   Trades executed: ${trades.length}`);

  // =====================================================================
  // STEP 4: Calculate metrics
  // =====================================================================
  if (trades.length === 0) {
    console.log('\n❌ No trades executed');
    return null;
  }

  const wins = trades.filter((t) => t.result === 'WIN');
  const losses = trades.filter((t) => t.result === 'LOSS');
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = grossProfit - grossLoss;
  const winRate = (wins.length / trades.length) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgBarsHeld = trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length;

  // Drawdown calculation
  let equity = INITIAL_BALANCE;
  let peak = INITIAL_BALANCE;
  let maxDrawdown = 0;

  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }

  const maxDrawdownPct = (maxDrawdown / INITIAL_BALANCE) * 100;

  // Consecutive stats
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  for (const trade of trades) {
    if (trade.result === 'WIN') {
      consecutiveWins++;
      consecutiveLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
    } else {
      consecutiveLosses++;
      consecutiveWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    }
  }

  // Exit reason breakdown
  const exitReasons = {
    TP: trades.filter((t) => t.exitReason === 'TP').length,
    SL: trades.filter((t) => t.exitReason === 'SL').length,
    TIMEOUT: trades.filter((t) => t.exitReason === 'TIMEOUT').length,
  };

  // Setup type breakdown
  const setupTypes: Record<string, number> = {};
  for (const trade of trades) {
    const type = trade.signal.setupType;
    setupTypes[type] = (setupTypes[type] ?? 0) + 1;
  }

  // =====================================================================
  // STEP 5: Print results
  // =====================================================================
  console.log('\n' + '─'.repeat(60));
  console.log('RESULTS');
  console.log('─'.repeat(60));
  console.log(`Trades: ${trades.length} (${wins.length}W / ${losses.length}L)`);
  console.log(`Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`Net P&L: $${netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: $${maxDrawdown.toFixed(2)} (${maxDrawdownPct.toFixed(1)}%)`);
  console.log(`Avg Bars Held: ${avgBarsHeld.toFixed(1)}`);
  console.log(`Max Consecutive: ${maxConsecutiveWins}W / ${maxConsecutiveLosses}L`);
  console.log();
  console.log(`Exit Reasons: TP=${exitReasons.TP} SL=${exitReasons.SL} TIMEOUT=${exitReasons.TIMEOUT}`);
  console.log(`Setup Types: ${Object.entries(setupTypes).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // Print sample trades
  console.log('\n📊 Sample Trades:');
  for (const trade of trades.slice(0, 5)) {
    const emoji = trade.result === 'WIN' ? '✅' : '❌';
    console.log(
      `   ${emoji} ${trade.signal.direction.toUpperCase()} ${trade.signal.setupType} | ` +
        `Entry: ${trade.entryPrice.toFixed(2)} | Exit: ${trade.exitPrice.toFixed(2)} (${trade.exitReason}) | ` +
        `P&L: $${trade.pnl.toFixed(2)} | Bars: ${trade.barsHeld}`
    );
  }

  return {
    asset,
    trades: trades.length,
    winRate,
    netPnl,
    profitFactor,
    maxDrawdownPct,
    avgBarsHeld,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     SMC OPPORTUNITY FAST BACKTEST                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Assets: ${ASSETS.join(', ')}`);
  console.log(`Min Quality: ${MIN_QUALITY}`);
  console.log(`Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`Stake: ${(STAKE_PCT * 100).toFixed(1)}%`);
  console.log(`Multiplier: x${MULTIPLIER}`);

  const results = [];

  for (const asset of ASSETS) {
    const result = await runBacktestForAsset(asset);
    if (result) results.push(result);
  }

  if (results.length > 0) {
    console.log('\n\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));

    const totalTrades = results.reduce((sum, r) => sum + r.trades, 0);
    const totalPnl = results.reduce((sum, r) => sum + r.netPnl, 0);
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;

    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`Avg Win Rate: ${avgWinRate.toFixed(1)}%`);
  }

  console.log('\n✅ Backtest complete!');
}

main().catch(console.error);
