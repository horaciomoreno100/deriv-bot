/**
 * BB Squeeze Strategy for Synthetic Indices (R_100, R_75, R_50, etc.)
 *
 * Use SYMBOL env to specify which synthetic to trade:
 *   SYMBOL=R_100 npx tsx src/scripts/run-bb-squeeze-synthetic.ts
 *   SYMBOL=R_75 npx tsx src/scripts/run-bb-squeeze-synthetic.ts
 *
 * Based on backtest results:
 *   R_100: 278 trades, WR: 36.7%, PF: 1.14, Score: 38.4
 *   R_75: 287 trades, WR: 33.4%, PF: 0.97, Score: 38.0
 *   R_50: 265 trades, WR: 47.2%, PF: 1.13, Score: 43.1
 */

import { loadEnvFromRoot } from '../utils/load-env.js';
import { GatewayClient, initSlackAlerts, type SlackAlerter } from '@deriv-bot/shared';
import { BBSqueezeStrategy } from '../strategies/bb-squeeze.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables from project root
loadEnvFromRoot();

// Configuration
const SYMBOL = process.env.SYMBOL || 'R_100'; // Default to R_100, can override with env
const STRATEGY_NAME = `BB-SQUEEZE-${SYMBOL}`;
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
const SYMBOLS = [SYMBOL];
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Risk parameters
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% per trade
const MAX_TRADES_PER_SYMBOL = 1;

// Tick processing state
const TIMEFRAME = 60; // 1 minute
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();

// State
let balance = STRATEGY_ALLOCATION;
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true;
const warmUpCandlesPerAsset = new Map<string, number>();
let hasReceivedRealtimeCandle = false;
const WARM_UP_CANDLES_REQUIRED = 50;
const processedTradeResults = new Set<string>();
const candleBuffers = new Map<string, Candle[]>();

// Trade Manager instance
let tradeManager: TradeManager;

// Trade Execution Service
let tradeExecutionService: TradeExecutionService;

// Strategy Accountant for balance tracking
let strategyAccountant: StrategyAccountant;

// Slack Alerter
let slackAlerter: SlackAlerter | null = null;

/**
 * Process tick and build candle
 */
function processTick(tick: Tick): Candle | null {
  const asset = tick.asset;
  const tickTime = tick.timestamp;
  const candleTimeMs = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);
  const candleTime = Math.floor(candleTimeMs / 1000);

  const lastCandleTime = lastCandleTimes.get(asset) || 0;
  const currentCandle = currentCandles.get(asset);

  if (candleTime !== lastCandleTime) {
    const completedCandle = currentCandle;
    lastCandleTimes.set(asset, candleTime);

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

    if (completedCandle && completedCandle.open && completedCandle.close) {
      return completedCandle as Candle;
    }
  } else if (currentCandle) {
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

  if (isInitializing || !hasReceivedRealtimeCandle) {
    console.log(`\n⏸️  Signal ignored during initialization`);
    return;
  }

  const canOpen = tradeManager.canOpenTrade(asset);
  if (!canOpen.allowed) {
    console.log(`\n❌ Signal rejected for ${asset}: ${canOpen.reason}`);
    return;
  }

  if (!tradeManager.acquireTradeLock(asset)) {
    console.log(`\n❌ Signal rejected for ${asset}: Trade already in progress`);
    return;
  }

  console.log(`\n⚡ Signal detected for ${asset}:`, signal);

  const currentBalance = strategyAccountant.getAvailableBalance(STRATEGY_NAME);
  if (currentBalance < STRATEGY_ALLOCATION * 0.1) {
    console.log(`\n❌ Insufficient balance: $${currentBalance.toFixed(2)}`);
    tradeManager.releaseTradeLock(asset);
    return;
  }

  const riskPercentage = TRADE_MODE === 'binary' ? 0.01 : RISK_PERCENTAGE_CFD;
  const calculatedStake = currentBalance * riskPercentage;

  if (!strategyAccountant.reserveStake(STRATEGY_NAME, asset, calculatedStake)) {
    console.log(`\n❌ Cannot reserve stake: $${calculatedStake.toFixed(2)}`);
    tradeManager.releaseTradeLock(asset);
    return;
  }

  try {
    const result = await tradeExecutionService.executeTrade(signal, asset);
    console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);

    if (!result.success) {
      strategyAccountant.releaseStake(STRATEGY_NAME, asset);
    }
  } catch (error) {
    console.error(`\n❌ Trade execution failed:`, error);
    strategyAccountant.releaseStake(STRATEGY_NAME, asset);
  } finally {
    tradeManager.releaseTradeLock(asset);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║     BB SQUEEZE - ${SYMBOL.padEnd(10)} - SYNTHETIC              ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`🔹 Symbol: ${SYMBOL}`);
  console.log(`🔹 Strategy: ${STRATEGY_NAME}`);
  console.log(`🔹 Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`🔹 Allocation: $${STRATEGY_ALLOCATION.toLocaleString()}`);
  console.log(`🔹 Risk per trade: ${(RISK_PERCENTAGE_CFD * 100).toFixed(1)}%`);
  console.log();

  // Initialize Strategy Accountant
  strategyAccountant = new StrategyAccountant();
  strategyAccountant.allocate(STRATEGY_NAME, STRATEGY_ALLOCATION);
  console.log(`💰 Allocated $${STRATEGY_ALLOCATION} to ${STRATEGY_NAME}\n`);

  // Initialize Slack alerts
  slackAlerter = await initSlackAlerts(`trader-bb-squeeze-${SYMBOL.toLowerCase()}`);
  if (slackAlerter) {
    console.log('✅ Slack alerts enabled\n');
    await slackAlerter.sendAlert({
      level: 'info',
      message: `BB Squeeze ${SYMBOL} started`,
      data: {
        symbol: SYMBOL,
        mode: TRADE_MODE,
        balance: STRATEGY_ALLOCATION,
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

  // Initialize Trade Adapter
  const tradeAdapter = new UnifiedTradeAdapter(TRADE_MODE, gatewayClient);

  // Initialize Trade Manager
  tradeManager = new TradeManager(gatewayClient, tradeAdapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 15 * 60 * 1000,      // 15 min max for synthetics
      extremeMaxDuration: 30 * 60 * 1000,    // 30 min extreme max
      minTradeDuration: 30 * 1000,           // 30 sec minimum
      earlyExitTpPct: 0.75,                  // Exit at 75% TP
    },
    trailingStop: {
      enabled: false,
    },
  });

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
    const result = data.result?.toUpperCase();
    if (result === 'WIN' || result === 'WON') {
      wonTrades++;
    } else {
      lostTrades++;
    }

    const winRate = totalTrades > 0 ? (wonTrades / totalTrades * 100).toFixed(1) : '0.0';
    console.log(`\n📊 Trade ${totalTrades}: ${data.result} | Win Rate: ${winRate}% (${wonTrades}W/${lostTrades}L)`);

    if (slackAlerter) {
      slackAlerter.sendAlert({
        level: (result === 'WIN' || result === 'WON') ? 'success' : 'error',
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

  // Initialize Strategy with synthetic-optimized parameters
  const strategy = new BBSqueezeStrategy(SYMBOL, {
    bbPeriod: 20,
    bbStdDev: 2.0,
    kcPeriod: 20,
    kcMultiplier: 1.5,
    rsiPeriod: 14,
    takeProfitPct: 0.005,   // 0.5% TP
    stopLossPct: 0.003,     // 0.3% SL
    cooldownSeconds: 60,
    minCandles: 50,
    skipSaturday: false,
    enableTimeFilter: false,
    enableRSIFilter: false,
    enableNewsFilter: false,
    assetType: 'synthetic',
  }, {
    rsiOversold: 30,
    rsiOverbought: 70,
  });

  // Register trader with Gateway
  try {
    const registration = await gatewayClient.registerTrader({
      name: `BB-SQUEEZE-${SYMBOL} Trader`,
      strategy: STRATEGY_NAME,
      symbols: SYMBOLS,
    });
    console.log(`📝 Registered with Gateway: ${registration.traderId}\n`);
  } catch {
    console.log('⚠️  Could not register with Gateway (older version?)\n');
  }

  console.log(`📡 Subscribing to ${SYMBOL}...\n`);
  try {
    await gatewayClient.follow(SYMBOLS);
    console.log(`✅ Subscribed to ${SYMBOL}\n`);
  } catch (error: any) {
    console.error(`❌ Failed to subscribe to ${SYMBOL}: ${error.message}`);
    console.log(`⏸️  Market may be closed. Trader will wait for market to open...\n`);
  }

  // Start heartbeat
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore heartbeat errors
    }
  }, 30000);

  // Load historical candles for warm-up
  console.log(`📥 Loading historical candles for ${SYMBOL}...\n`);
  try {
    const CANDLES_NEEDED = 100;
    const candles = await gatewayClient.getCandles(SYMBOL, 60, CANDLES_NEEDED);
    console.log(`   ✅ ${SYMBOL}: ${candles.length} x 1m candles loaded\n`);

    candleBuffers.set(SYMBOL, candles);
    warmUpCandlesPerAsset.set(SYMBOL, candles.length);

    if (candles.length >= WARM_UP_CANDLES_REQUIRED) {
      isInitializing = false;
      hasReceivedRealtimeCandle = true;
      console.log(`✅ ${SYMBOL} ready! (${candles.length} candles)\n`);
    }
  } catch (error: any) {
    console.error(`⚠️  Failed to load historical candles: ${error.message}`);
    console.log(`   Will accumulate candles in real-time...\n`);
  }

  // Signal proximity check - publish every 10 seconds
  const PROXIMITY_CHECK_INTERVAL = 10000;
  setInterval(async () => {
    const isConnected = gatewayClient.isConnected();
    if (!isConnected) {
      return;
    }

    if (typeof (strategy as any).getSignalReadiness === 'function') {
      const buffer = candleBuffers.get(SYMBOL) || [];
      if (buffer.length >= 50) {
        try {
          const readiness = (strategy as any).getSignalReadiness(buffer);
          if (readiness) {
            const stillConnected = gatewayClient.isConnected();
            if (!stillConnected) {
              return;
            }

            const criteria = Object.entries(readiness.criteria).map(([name, criterion]: [string, any]) => ({
              name,
              current: criterion.value || '',
              target: criterion.met ? 'Met' : 'Not Met',
              unit: '',
              passed: criterion.met,
              distance: 0,
            }));

            await gatewayClient.publishSignalProximity({
              strategy: STRATEGY_NAME,
              asset: SYMBOL,
              direction: readiness.direction.toUpperCase() as 'CALL' | 'PUT' | 'NEUTRAL',
              overallProximity: readiness.overallProximity,
              proximity: readiness.overallProximity,
              criteria,
              readyToSignal: readiness.readyToSignal,
              missingCriteria: readiness.missingCriteria || [],
            });
          }
        } catch (error: any) {
          const errorMsg = error?.message || String(error || '');
          if (errorMsg.includes('Not connected') || !gatewayClient.isConnected()) {
            return;
          }
          console.error(`[Signal Proximity] Error:`, errorMsg);
        }
      }
    }
  }, PROXIMITY_CHECK_INTERVAL);

  // Listen to ticks
  gatewayClient.on('tick', async (tick: Tick) => {
    const completedCandle = processTick(tick);
    if (!completedCandle) return;

    const asset = completedCandle.asset;
    const buffer = candleBuffers.get(asset) || [];
    buffer.push(completedCandle);

    if (buffer.length > 200) {
      buffer.shift();
    }
    candleBuffers.set(asset, buffer);

    const warmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
    if (warmUpCount < WARM_UP_CANDLES_REQUIRED) {
      warmUpCandlesPerAsset.set(asset, warmUpCount + 1);
      if (warmUpCount + 1 === WARM_UP_CANDLES_REQUIRED) {
        console.log(`\n✅ Warm-up complete for ${asset} (${warmUpCount + 1} candles)`);
        isInitializing = false;
        hasReceivedRealtimeCandle = true;
      } else {
        process.stdout.write(`\r🔄 Warming up ${asset}: ${warmUpCount + 1}/${WARM_UP_CANDLES_REQUIRED} candles`);
      }
      return;
    }

    if (!hasReceivedRealtimeCandle) {
      hasReceivedRealtimeCandle = true;
    }

    if (isInitializing) {
      isInitializing = false;
      console.log('\n🚀 Strategy is LIVE and ready to trade!\n');
    }

    try {
      const signal = await strategy.onCandle(completedCandle, {
        candles: buffer,
        balance: balance,
      });

      await processStrategySignal(signal, asset);
    } catch (error: any) {
      console.error(`❌ Strategy error for ${asset}:`, error.message);
    }
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
        message: `BB Squeeze ${SYMBOL} stopped`,
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
