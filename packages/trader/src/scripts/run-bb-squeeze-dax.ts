/**
 * BB Squeeze Strategy for DAX (OTC_GDAXI)
 *
 * Optimized configuration found via grid search (16,200 combinations):
 * - BB(15,2.5) KC(2) RSI(7,25/60) TP/SL(0.20%/0.80%)
 * - Win Rate: 84.4%
 * - Profit Factor: 1.51
 * - Trades: 1.3/day (225 trades over 180 days)
 * - Max DD: 7.0%
 * - Expected P&L: +36.7% over 180 days
 */

import dotenv from 'dotenv';
import { GatewayClient, initSlackAlerts, type SlackAlerter } from '@deriv-bot/shared';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { BBSqueezeStrategy } from '../strategies/bb-squeeze.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables
dotenv.config();

// Configuration
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
const SYMBOL = 'OTC_GDAXI'; // DAX Germany 40
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '1000');
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Risk parameters
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% per trade
const MAX_TRADES_PER_SYMBOL = 1;

// Tick processing state
const TIMEFRAME = 60; // 1 minute
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();

// State
let balance = INITIAL_BALANCE;
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true;
const warmUpCandlesPerAsset = new Map<string, number>();
let hasReceivedRealtimeCandle = false;
const WARM_UP_CANDLES_REQUIRED = 50; // Need 50 candles for BB and KC calculations
// Track processed trades to avoid double-counting
const processedTradeResults = new Set<string>();

// Trade Manager instance
let tradeManager: TradeManager;

// Trade Execution Service
let tradeExecutionService: TradeExecutionService;

// Slack Alerter
let slackAlerter: SlackAlerter | null = null;

/**
 * Process tick and build candle (per asset)
 */
function processTick(tick: Tick): Candle | null {
  const asset = tick.asset;
  const tickTime = tick.timestamp;
  const candleTimeMs = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);
  const candleTime = Math.floor(candleTimeMs / 1000); // Convert to seconds

  const lastCandleTime = lastCandleTimes.get(asset) || 0;
  const currentCandle = currentCandles.get(asset);

  if (candleTime !== lastCandleTime) {
    const completedCandle = currentCandle;
    lastCandleTimes.set(asset, candleTime);

    // Start new candle
    const newCandle: Partial<Candle> = {
      asset: tick.asset,
      timeframe: TIMEFRAME,
      timestamp: candleTime,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: 1,
    };
    currentCandles.set(asset, newCandle);

    // Return completed candle if valid
    if (completedCandle && completedCandle.open && completedCandle.close) {
      return completedCandle as Candle;
    }
  } else if (currentCandle) {
    // Update current candle
    currentCandle.high = Math.max(currentCandle.high || tick.price, tick.price);
    currentCandle.low = Math.min(currentCandle.low || tick.price, tick.price);
    currentCandle.close = tick.price;
    currentCandle.volume = (currentCandle.volume || 0) + 1;
  }

  return null;
}

/**
 * Process strategy signal and execute trade
 */
async function processStrategySignal(signal: Signal | null, asset: string) {
  if (!signal) return;

  // Skip during initialization
  if (isInitializing || !hasReceivedRealtimeCandle) {
    console.log(`\n⏸️  Signal ignored during initialization`);
    return;
  }

  // CRITICAL: Check position limits BEFORE processing
  const canOpen = tradeManager.canOpenTrade(asset);
  if (!canOpen.allowed) {
    console.log(`\n❌ Signal rejected for ${asset}: ${canOpen.reason}`);
    return;
  }

  // CRITICAL: Acquire trade lock to prevent race conditions
  if (!tradeManager.acquireTradeLock(asset)) {
    console.log(`\n❌ Signal rejected for ${asset}: Trade already in progress`);
    return;
  }

  console.log(`\n⚡ Signal detected for ${asset}:`, signal);

  // Check if we have enough balance to open a trade
  const currentBalance = tradeManager.getAvailableBalance();
  if (currentBalance < INITIAL_BALANCE * 0.1) {
    console.log(`\n❌ Insufficient balance: $${currentBalance.toFixed(2)}`);
    tradeManager.releaseTradeLock(asset);
    return;
  }

  // Calculate stake based on current balance and risk percentage
  const riskPercentage = TRADE_MODE === 'binary' ? 0.01 : RISK_PERCENTAGE_CFD;
  const calculatedStake = currentBalance * riskPercentage;

  // Reserve stake amount before opening trade
  if (!tradeManager.reserveStake(asset, calculatedStake)) {
    console.log(`\n❌ Cannot reserve stake: $${calculatedStake.toFixed(2)}`);
    tradeManager.releaseTradeLock(asset);
    return;
  }

  // Execute trade via TradeExecutionService
  try {
    const result = await tradeExecutionService.executeTrade(signal, asset);
    console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);

    if (!result.success) {
      // Release reserved stake if trade failed
      tradeManager.releaseStake(asset);
    }
  } catch (error) {
    console.error(`\n❌ Trade execution failed:`, error);
    // Release reserved stake on error
    tradeManager.releaseStake(asset);
  } finally {
    // CRITICAL: ALWAYS release lock after execution
    tradeManager.releaseTradeLock(asset);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     BB SQUEEZE - DAX (OTC_GDAXI) - OPTIMIZED              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('📊 Optimized Parameters:');
  console.log('   BB(15,2.5) KC(2) RSI(7,25/60) TP/SL(0.20%/0.80%)');
  console.log();
  console.log('🎯 Expected Performance (backtest 180 days):');
  console.log('   Win Rate: 84.4% | PF: 1.51 | Trades: 1.3/day');
  console.log('   Max DD: 7.0% | Expected Return: +36.7%');
  console.log();
  console.log(`🔹 Symbol: ${SYMBOL}`);
  console.log(`🔹 Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`🔹 Initial Balance: $${INITIAL_BALANCE.toLocaleString()}`);
  console.log(`🔹 Risk per trade: ${(RISK_PERCENTAGE_CFD * 100).toFixed(1)}%`);
  console.log();

  // Initialize Slack alerts
  slackAlerter = await initSlackAlerts('trader-bb-squeeze-dax');
  if (slackAlerter) {
    console.log('✅ Slack alerts enabled\n');
    await slackAlerter.sendAlert({
      level: 'info',
      message: `BB Squeeze DAX started`,
      data: {
        symbol: SYMBOL,
        mode: TRADE_MODE,
        balance: INITIAL_BALANCE,
        params: 'BB(15,2.5) KC(2) RSI(7,25/60) TP/SL(0.20%/0.80%)',
      },
    });
  }

  // Initialize Gateway Client
  const gatewayClient = new GatewayClient({
    url: process.env.GATEWAY_WS_URL || 'ws://localhost:3000',
    autoReconnect: true,
    reconnectInterval: 5000,
    enableLogging: false,
  });

  await gatewayClient.connect();
  console.log('✅ Connected to gateway\n');

  // Initialize Trade Manager
  tradeManager = new TradeManager({
    initialBalance: INITIAL_BALANCE,
    maxTradesPerSymbol: MAX_TRADES_PER_SYMBOL,
    reserveBalanceEnabled: true,
    maxBalanceReservePercentage: 50, // Max 50% of balance reserved
  });

  // Initialize Trade Adapter
  const tradeAdapter = new UnifiedTradeAdapter(TRADE_MODE, gatewayClient);

  // Initialize Trade Execution Service
  tradeExecutionService = new TradeExecutionService(
    gatewayClient,
    tradeAdapter,
    tradeManager,
    slackAlerter || undefined
  );

  // Listen to balance updates
  gatewayClient.on('balance', (data: any) => {
    balance = data.balance;
    tradeManager.updateBalance(balance);
    console.log(`💰 Balance updated: $${balance.toFixed(2)}`);
  });

  // Listen to trade results
  gatewayClient.on('trade:result', (data: any) => {
    const tradeId = `${data.contract_id}_${data.timestamp}`;
    if (processedTradeResults.has(tradeId)) {
      return;
    }
    processedTradeResults.add(tradeId);

    totalTrades++;
    if (data.result === 'WIN') {
      wonTrades++;
    } else {
      lostTrades++;
    }

    const winRate = totalTrades > 0 ? (wonTrades / totalTrades * 100).toFixed(1) : '0.0';
    console.log(`\n📊 Trade ${totalTrades}: ${data.result} | Win Rate: ${winRate}% (${wonTrades}W/${lostTrades}L)`);

    if (slackAlerter) {
      slackAlerter.sendAlert({
        level: data.result === 'WIN' ? 'success' : 'error',
        message: `Trade ${data.result}`,
        data: {
          symbol: data.asset || SYMBOL,
          result: data.result,
          pnl: data.pnl,
          winRate: `${winRate}%`,
          total: `${wonTrades}W/${lostTrades}L`,
        },
      });
    }
  });

  // Initialize Strategy with optimized DAX parameters
  const strategy = new BBSqueezeStrategy(SYMBOL, {
    // Optimized parameters from grid search
    bbPeriod: 15,           // Shorter period for faster signals
    bbStdDev: 2.5,          // Wider bands for DAX volatility
    kcPeriod: 20,           // Standard KC period
    kcMultiplier: 2.0,      // Wider KC for squeeze detection
    rsiPeriod: 7,           // Fast RSI for scalping
    takeProfitPct: 0.002,   // 0.20% TP
    stopLossPct: 0.008,     // 0.80% SL (1:4 ratio - tight TP, wide SL)
    cooldownSeconds: 60,    // 1 minute cooldown
    minCandles: 50,
    // Filters
    skipSaturday: false,    // DAX doesn't trade weekends anyway
    enableTimeFilter: false,// Disabled - DAX has limited trading hours
    enableRSIFilter: false, // Disabled - using custom RSI thresholds
    enableNewsFilter: false,
    assetType: 'commodities', // Treat as commodities (indices)
  }, {
    // RSI thresholds for mean reversion
    rsiOversold: 25,  // Optimized: More aggressive than default
    rsiOverbought: 60, // Optimized: Asymmetric (25/60 vs 45/55)
  });

  // Initialize Strategy Engine
  const strategyEngine = new StrategyEngine();
  strategyEngine.registerStrategy(SYMBOL, strategy);

  // Subscribe to symbol
  console.log(`📡 Subscribing to ${SYMBOL}...\n`);
  await gatewayClient.subscribeTicks([SYMBOL]);

  // Listen to ticks
  gatewayClient.on('tick', async (tick: Tick) => {
    // Build candle from tick
    const completedCandle = processTick(tick);

    if (!completedCandle) return;

    // Count warm-up candles
    if (isInitializing) {
      const currentCount = warmUpCandlesPerAsset.get(tick.asset) || 0;
      warmUpCandlesPerAsset.set(tick.asset, currentCount + 1);

      if (currentCount + 1 >= WARM_UP_CANDLES_REQUIRED) {
        console.log(`\n✅ Warm-up complete for ${tick.asset} (${currentCount + 1} candles)`);
        isInitializing = false;
        hasReceivedRealtimeCandle = true;
      } else {
        process.stdout.write(`\r🔄 Warming up ${tick.asset}: ${currentCount + 1}/${WARM_UP_CANDLES_REQUIRED} candles`);
      }
    }

    // Add candle to strategy engine
    strategyEngine.addCandle(completedCandle);

    // Get signal from strategy
    const signal = await strategyEngine.getSignal(tick.asset);

    // Process signal
    await processStrategySignal(signal, tick.asset);
  });

  // Error handling
  gatewayClient.on('error', (error: Error) => {
    console.error('❌ Gateway error:', error);
    if (slackAlerter) {
      slackAlerter.sendAlert({
        level: 'critical',
        message: 'Gateway connection error',
        data: { error: error.message },
      });
    }
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');

    const finalWinRate = totalTrades > 0 ? (wonTrades / totalTrades * 100).toFixed(1) : '0.0';
    console.log(`\n📊 Final Stats:`);
    console.log(`   Total Trades: ${totalTrades}`);
    console.log(`   Win Rate: ${finalWinRate}% (${wonTrades}W/${lostTrades}L)`);
    console.log(`   Final Balance: $${balance.toFixed(2)}`);

    if (slackAlerter) {
      await slackAlerter.sendAlert({
        level: 'info',
        message: 'BB Squeeze DAX stopped',
        data: {
          trades: totalTrades,
          winRate: `${finalWinRate}%`,
          balance: balance,
        },
      });
    }

    await gatewayClient.disconnect();
    process.exit(0);
  });

  console.log('✅ Strategy running. Press Ctrl+C to stop.\n');
}

main().catch(console.error);
