/**
 * BB Squeeze Strategy for DAX (OTC_GDAXI) - Optimized
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
const SYMBOLS = [SYMBOL];
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
const processedTradeResults = new Set<string>();
const candleBuffers = new Map<string, Candle[]>();

// Trade Manager instance
let tradeManager: TradeManager;

// Trade Execution Service
let tradeExecutionService: TradeExecutionService;

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

  const currentBalance = tradeManager.getAvailableBalance();
  if (currentBalance < INITIAL_BALANCE * 0.1) {
    console.log(`\n❌ Insufficient balance: $${currentBalance.toFixed(2)}`);
    tradeManager.releaseTradeLock(asset);
    return;
  }

  const riskPercentage = TRADE_MODE === 'binary' ? 0.01 : RISK_PERCENTAGE_CFD;
  const calculatedStake = currentBalance * riskPercentage;

  if (!tradeManager.reserveStake(asset, calculatedStake)) {
    console.log(`\n❌ Cannot reserve stake: $${calculatedStake.toFixed(2)}`);
    tradeManager.releaseTradeLock(asset);
    return;
  }

  try {
    const result = await tradeExecutionService.executeTrade(signal, asset);
    console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);

    if (!result.success) {
      tradeManager.releaseStake(asset);
    }
  } catch (error) {
    console.error(`\n❌ Trade execution failed:`, error);
    tradeManager.releaseStake(asset);
  } finally {
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

  // Initialize Trade Adapter
  const tradeAdapter = new UnifiedTradeAdapter(TRADE_MODE, gatewayClient);

  // Initialize Trade Manager
  tradeManager = new TradeManager(gatewayClient, tradeAdapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 30 * 60 * 1000,      // 30 min max for DAX
      extremeMaxDuration: 45 * 60 * 1000,    // 45 min extreme max
      minTradeDuration: 60 * 1000,           // 1 min minimum
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

  // Initialize Strategy with optimized DAX parameters
  const strategy = new BBSqueezeStrategy(SYMBOL, {
    bbPeriod: 15,
    bbStdDev: 2.5,
    kcPeriod: 20,
    kcMultiplier: 2.0,
    rsiPeriod: 7,
    takeProfitPct: 0.002,   // 0.20% TP
    stopLossPct: 0.008,     // 0.80% SL
    cooldownSeconds: 60,
    minCandles: 50,
    skipSaturday: false,
    enableTimeFilter: false,
    enableRSIFilter: false,
    enableNewsFilter: false,
    assetType: 'commodities',
  }, {
    rsiOversold: 25,
    rsiOverbought: 60,
  });

  // Register trader with Gateway
  try {
    const registration = await gatewayClient.registerTrader({
      name: 'BB-SQUEEZE-DAX Trader',
      strategy: 'BB-SQUEEZE-DAX',
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
    // Don't crash - trader will stay registered and can handle manual commands
  }

  // Start heartbeat
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore heartbeat errors
    }
  }, 30000);

  // Signal proximity check - publish every 10 seconds
  const PROXIMITY_CHECK_INTERVAL = 10000;
  setInterval(async () => {
    // Check connection first - skip entire check if not connected
    const isConnected = gatewayClient.isConnected();
    if (!isConnected) {
      return; // Skip silently, will retry on next interval
    }

    if (typeof (strategy as any).getSignalReadiness === 'function') {
      const buffer = candleBuffers.get(SYMBOL) || [];
      if (buffer.length >= 50) { // minCandles for BB Squeeze
        try {
          const readiness = (strategy as any).getSignalReadiness(buffer);
          if (readiness) {
            // Double-check connection before publishing
            const stillConnected = gatewayClient.isConnected();
            if (!stillConnected) {
              return;
            }

            // Convert criteria format to match Gateway expectations
            // BBSqueezeStrategy returns Record<string, { met: boolean; value: string }>
            // Gateway expects Array<{ name, current, target, unit, passed, distance }>
            const criteria = Object.entries(readiness.criteria).map(([name, criterion]: [string, any]) => ({
              name,
              current: criterion.value || '',
              target: criterion.met ? 'Met' : 'Not Met',
              unit: '',
              passed: criterion.met,
              distance: 0,
            }));

            await gatewayClient.publishSignalProximity({
              strategy: 'BB-SQUEEZE-DAX',
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
          // Extract error message first
          const errorMsg = error?.message || String(error || '');

          // Silently ignore connection errors
          if (errorMsg.includes('Not connected') || !gatewayClient.isConnected()) {
            return;
          }

          // Log real errors only
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

    // Keep buffer size manageable (keep last 200 candles)
    if (buffer.length > 200) {
      buffer.shift();
    }
    candleBuffers.set(asset, buffer);

    // Track warm-up
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

    // Process strategy signal
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
