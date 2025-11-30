#!/usr/bin/env npx tsx
/**
 * Generate 7-day backtest chart for CryptoScalp v2
 * 
 * Shows entries, exits, and indicators for the last 7 days
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { HIGH_PF_PRESET, CONSERVATIVE_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';
import { createIndicatorCache } from '../backtest/data/indicator-cache.js';
import { generateChartHTML, createVisualizationData } from '@deriv-bot/shared';
import type { TradeWithContext, MarketSnapshot, IndicatorSnapshot } from '@deriv-bot/shared';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const DAYS_TO_SHOW = 7;
const dataDir = path.join(process.cwd(), 'data');

interface CapturedTrade {
  entryIndex: number;
  exitIndex: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
  pnl: number;
  stake: number;
}

// Load CSV fast
function loadCandles(filepath: string): Candle[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts.length > 5 ? parseFloat(parts[5]!) : undefined,
      });
    }
  }

  return candles;
}

// Custom backtest that captures trades (simplified version matching FastBacktester logic)
function runBacktestWithCapture(
  candles: Candle[],
  indicatorCache: any,
  entryFn: (index: number, indicators: Record<string, number | boolean>) => any,
  config: any
): { result: any; trades: CapturedTrade[] } {
  const {
    tpPct,
    slPct,
    cooldown,
    maxBarsInTrade = 50,
    initialBalance = 1000,
    stakePct = 0.03,
    multiplier = 100,
    startIndex = 0,
    endIndex = candles.length,
  } = config;

  let equity = initialBalance;
  let cooldownUntil = startIndex;
  const capturedTrades: CapturedTrade[] = [];
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (let i = startIndex; i < endIndex; i++) {
    if (i < cooldownUntil) continue;

    const indicators = indicatorCache.getSnapshot(i);
    const indicatorRecord: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(indicators)) {
      indicatorRecord[key] = value as number | boolean;
    }

    const signal = entryFn(i, indicatorRecord);
    if (!signal) continue;

    const entryPrice = signal.price > 0 ? signal.price : candles[i]!.close;
    const stake = equity * stakePct;
    const tpPrice = signal.direction === 'CALL'
      ? entryPrice * (1 + tpPct / 100)
      : entryPrice * (1 - tpPct / 100);
    const slPrice = signal.direction === 'CALL'
      ? entryPrice * (1 - slPct / 100)
      : entryPrice * (1 + slPct / 100);

    let exitPrice = entryPrice;
    let outcome: 'WIN' | 'LOSS' = 'LOSS';
    let exitIndex = i;
    let exitReason = 'TIMEOUT';

    for (let j = i + 1; j < Math.min(i + maxBarsInTrade + 1, endIndex); j++) {
      const candle = candles[j]!;
      const barsHeld = j - i;
      const exitIndicators = indicatorCache.getSnapshot(j);
      const currentPrice = candle.close;

      if (signal.direction === 'CALL') {
        // Stop Loss
        if (candle.low <= slPrice) {
          exitPrice = slPrice;
          outcome = 'LOSS';
          exitIndex = j;
          exitReason = 'SL';
          break;
        }
        // Take Profit
        if (candle.high >= tpPrice) {
          exitPrice = tpPrice;
          outcome = 'WIN';
          exitIndex = j;
          exitReason = 'TP';
          break;
        }
        // Zombie Killer
        if (config.zombieKiller?.enabled && barsHeld >= config.zombieKiller.bars) {
          const currentPnl = (currentPrice - entryPrice) / entryPrice * 100;
          const minPnl = config.zombieKiller.minPnlPct || 0.05;
          const isReversing = config.zombieKiller.onlyIfReversing
            ? (j > i + 1 && currentPrice < candles[j - 1]!.close)
            : true;
          
          if (currentPnl < minPnl && isReversing) {
            exitPrice = currentPrice;
            outcome = currentPnl >= 0 ? 'WIN' : 'LOSS';
            exitIndex = j;
            exitReason = 'ZOMBIE';
            break;
          }
        }
      } else {
        // PUT
        if (candle.high >= slPrice) {
          exitPrice = slPrice;
          outcome = 'LOSS';
          exitIndex = j;
          exitReason = 'SL';
          break;
        }
        if (candle.low <= tpPrice) {
          exitPrice = tpPrice;
          outcome = 'WIN';
          exitIndex = j;
          exitReason = 'TP';
          break;
        }
        if (config.zombieKiller?.enabled && barsHeld >= config.zombieKiller.bars) {
          const currentPnl = (entryPrice - currentPrice) / entryPrice * 100;
          const minPnl = config.zombieKiller.minPnlPct || 0.05;
          const isReversing = config.zombieKiller.onlyIfReversing
            ? (j > i + 1 && currentPrice > candles[j - 1]!.close)
            : true;
          
          if (currentPnl < minPnl && isReversing) {
            exitPrice = currentPrice;
            outcome = currentPnl >= 0 ? 'WIN' : 'LOSS';
            exitIndex = j;
            exitReason = 'ZOMBIE';
            break;
          }
        }
      }
    }

    // If no exit, use timeout
    if (exitIndex === i) {
      exitIndex = Math.min(i + maxBarsInTrade, endIndex - 1);
      exitPrice = candles[exitIndex]!.close;
      if (signal.direction === 'CALL') {
        outcome = exitPrice >= entryPrice ? 'WIN' : 'LOSS';
      } else {
        outcome = exitPrice <= entryPrice ? 'WIN' : 'LOSS';
      }
    }

    // Calculate PnL
    const priceDiff = signal.direction === 'CALL'
      ? (exitPrice - entryPrice) / entryPrice * 100
      : (entryPrice - exitPrice) / entryPrice * 100;
    const pnl = priceDiff > 0 ? stake * multiplier * (priceDiff / 100) : -stake;

    if (outcome === 'WIN') {
      wins++;
      grossProfit += pnl;
    } else {
      losses++;
      grossLoss += Math.abs(pnl);
    }
    trades++;
    equity += pnl;
    cooldownUntil = exitIndex + cooldown;

    capturedTrades.push({
      entryIndex: i,
      exitIndex,
      direction: signal.direction,
      entryPrice,
      exitPrice,
      outcome,
      exitReason,
      pnl,
      stake,
    });
  }

  return {
    result: {
      trades,
      wins,
      losses,
      winRate: trades > 0 ? (wins / trades) * 100 : 0,
      netPnl: grossProfit - grossLoss,
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
    },
    trades: capturedTrades,
  };
}

function convertToTradeWithContext(
  trade: CapturedTrade,
  candles: Candle[],
  indicatorCache: any,
  asset: string
): TradeWithContext {
  const entryCandle = candles[trade.entryIndex]!;
  const exitCandle = candles[trade.exitIndex]!;
  const entryIndicators = indicatorCache.getSnapshot(trade.entryIndex);
  const exitIndicators = indicatorCache.getSnapshot(trade.exitIndex);

  const entrySnapshot: MarketSnapshot = {
    timestamp: entryCandle.timestamp * 1000,
    candle: {
      index: trade.entryIndex,
      timestamp: entryCandle.timestamp,
      open: entryCandle.open,
      high: entryCandle.high,
      low: entryCandle.low,
      close: entryCandle.close,
    },
    price: trade.entryPrice,
    indicators: entryIndicators as IndicatorSnapshot,
  };

  const exitSnapshot: MarketSnapshot = {
    timestamp: exitCandle.timestamp * 1000,
    candle: {
      index: trade.exitIndex,
      timestamp: exitCandle.timestamp,
      open: exitCandle.open,
      high: exitCandle.high,
      low: exitCandle.low,
      close: exitCandle.close,
    },
    price: trade.exitPrice,
    indicators: exitIndicators as IndicatorSnapshot,
  };

  return {
    id: `trade-${trade.entryIndex}`,
    asset,
    direction: trade.direction === 'CALL' ? 'CALL' : 'PUT',
    source: 'backtest',
    correlationId: `trade-${trade.entryIndex}`,
    signal: {
      snapshot: entrySnapshot,
      direction: trade.direction === 'CALL' ? 'CALL' : 'PUT',
      confidence: 50,
      reason: 'CryptoScalp v2 Entry',
      strategyName: 'CryptoScalp v2',
    },
    entry: {
      snapshot: entrySnapshot,
      requestedPrice: trade.entryPrice,
      executedPrice: trade.entryPrice,
      latencyMs: 0,
      slippage: 0,
      slippagePct: 0,
      stake: trade.stake,
      tpPrice: 0,
      slPrice: 0,
      tpPct: 0,
      slPct: 0,
    },
    exit: {
      snapshot: exitSnapshot,
      reason: trade.exitReason as any,
      executedPrice: trade.exitPrice,
      durationMs: (exitCandle.timestamp - entryCandle.timestamp) * 1000,
    },
    result: {
      pnl: trade.pnl,
      pnlPct: (trade.pnl / trade.stake) * 100,
      outcome: trade.outcome,
      maxFavorable: 0,
      maxFavorablePct: 0,
      maxAdverse: 0,
      maxAdversePct: 0,
    },
  };
}

async function main() {
  const asset = process.argv[2] || 'cryETHUSD';
  const presetName = asset.includes('ETH') ? 'High PF' : 'Conservative';
  const preset = asset.includes('ETH') ? HIGH_PF_PRESET : CONSERVATIVE_PRESET;

  console.log('='.repeat(80));
  console.log(`  CRYPTOSCALP V2 - 7 DAY CHART: ${asset}`);
  console.log('='.repeat(80));

  const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);
  if (!fs.existsSync(filepath)) {
    console.error(`Data file not found: ${filepath}`);
    process.exit(1);
  }

  console.log('Loading candles...');
  const allCandles = loadCandles(filepath);
  console.log(`Loaded ${allCandles.length.toLocaleString()} candles`);

  // Filter last 7 days (1m candles = 7 * 24 * 60 = 10,080 candles)
  const candlesToShow = Math.min(DAYS_TO_SHOW * 24 * 60, allCandles.length);
  const startCandleIndex = Math.max(0, allCandles.length - candlesToShow);
  const candles = allCandles.slice(startCandleIndex);
  const startTimestamp = candles[0]!.timestamp;
  const endTimestamp = candles[candles.length - 1]!.timestamp;

  console.log(`\nShowing last ${DAYS_TO_SHOW} days:`);
  console.log(`  From: ${new Date(startTimestamp * 1000).toISOString()}`);
  console.log(`  To: ${new Date(endTimestamp * 1000).toISOString()}`);
  console.log(`  Candles: ${candles.length.toLocaleString()}`);

  // Create indicator cache
  console.log('\nPre-calculating indicators...');
  const indicatorCache = createIndicatorCache(candles, ['rsi', 'atr', 'adx', 'bb', 'vwap'], {
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    bbPeriod: 20,
    bbStdDev: 2,
  });

  // Create entry function
  const entryFn = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: true });

  // Run backtest with capture
  console.log('Running backtest...');
  const baseConfig = {
    tpPct: preset.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
    slPct: preset.baseStopLossPct ?? 0.2,
    cooldown: preset.cooldownBars ?? 20,
    maxBarsInTrade: preset.maxBarsInTrade ?? 60,
    initialBalance: INITIAL_CAPITAL,
    stakePct: STAKE_PCT,
    multiplier: MULTIPLIER,
    startIndex: 50,
    zombieKiller: asset.includes('ETH')
      ? { enabled: true, bars: 15, minPnlPct: 0.05, onlyIfReversing: true }
      : { enabled: true, bars: 15, minPnlPct: 0.1 },
  };

  const { result, trades } = runBacktestWithCapture(candles, indicatorCache, entryFn, baseConfig);

  console.log(`\nBacktest Results:`);
  console.log(`  Trades: ${result.trades}`);
  console.log(`  Wins: ${result.wins} | Losses: ${result.losses}`);
  console.log(`  Win Rate: ${result.winRate.toFixed(1)}%`);
  console.log(`  Net PnL: $${result.netPnl.toFixed(2)}`);
  console.log(`  Profit Factor: ${result.profitFactor.toFixed(2)}`);

  // Filter trades to only those in the visible range
  const visibleTrades = trades.filter(t => 
    t.entryIndex >= 0 && t.entryIndex < candles.length
  );

  console.log(`\nVisible trades: ${visibleTrades.length}`);

  // Convert to TradeWithContext
  const tradesWithContext = visibleTrades.map(t => 
    convertToTradeWithContext(t, candles, indicatorCache, asset)
  );

  // Prepare indicator data
  const rsi: number[] = [];
  const bbUpper: number[] = [];
  const bbMiddle: number[] = [];
  const bbLower: number[] = [];
  const vwap: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const indicators = indicatorCache.getSnapshot(i);
    rsi.push(indicators.rsi as number || 50);
    bbUpper.push(indicators.bbUpper as number || candles[i]!.close);
    bbMiddle.push(indicators.bbMiddle as number || candles[i]!.close);
    bbLower.push(indicators.bbLower as number || candles[i]!.close);
    vwap.push(indicators.vwap as number || candles[i]!.close);
  }

  // Create visualization data
  const vizData = createVisualizationData(
    asset,
    60, // 1 minute
    candles,
    tradesWithContext,
    {
      rsi,
      bbUpper,
      bbMiddle,
      bbLower,
    }
  );

  // Generate HTML
  const html = generateChartHTML(vizData, {
    title: `CryptoScalp v2 - ${asset} - Last ${DAYS_TO_SHOW} Days`,
    theme: 'dark',
    width: 1600,
    height: 1000,
    showIndicators: ['rsi', 'bbands'],
  });

  // Save to file
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `crypto-scalp-v2-${asset}-7d.html`);
  fs.writeFileSync(outputPath, html);

  console.log(`\n✅ Chart saved to: ${outputPath}`);
  console.log(`\nOpen in browser to view the chart!`);
}

main().catch(console.error);

