/**
 * FVG Liquidity Sweep Strategy for DAX (OTC_GDAXI)
 *
 * Based on backtest results showing FVG-LS performs well on indices:
 * - Score: 52.9 (30-day backtest)
 * - Win Rate: 66.7%
 * - Profit Factor: 1.93
 *
 * Configuration optimized for DAX index trading.
 */

import { GatewayClient, initSlackAlerts, TelegramAlerter, loadEnvFromRoot } from '@deriv-bot/shared';
import { FVGLiquiditySweepStrategy } from '../strategies/fvg-liquidity-sweep.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables from project root
loadEnvFromRoot();

// Configuration
const STRATEGY_NAME = 'FVG-LS-DAX';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
const SYMBOL = 'OTC_GDAXI'; // DAX Germany 40
const SYMBOLS = [SYMBOL];
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Risk parameters - conservative for indices
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.03'); // 3% per trade
const MAX_TRADES_PER_SYMBOL = 1;
const MULTIPLIER = parseInt(process.env.MULTIPLIER || '100');

// Tick processing state
const TIMEFRAME = 60; // 1 minute
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();
const candleBuffers = new Map<string, Candle[]>();

// State
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true;
const warmUpCandlesPerAsset = new Map<string, number>();
let hasReceivedRealtimeCandle = false;
const WARM_UP_CANDLES_REQUIRED = 100;
const processedTradeResults = new Set<string>();

// Components
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let slackAlerter: ReturnType<typeof initSlackAlerts> | null = null;
let strategyAccountant: StrategyAccountant;

// Telegram Alerter
const telegramAlerter = new TelegramAlerter({ serviceName: STRATEGY_NAME });

// Strategy
let strategy: FVGLiquiditySweepStrategy;

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

async function main() {
  // Initialize Slack Alerts
  slackAlerter = initSlackAlerts(`trader-${STRATEGY_NAME.toLowerCase()}`);

  console.log('='.repeat(80));
  console.log(`🎯 ${STRATEGY_NAME} - FVG LIQUIDITY SWEEP FOR DAX`);
  console.log('='.repeat(80));
  console.log();
  console.log('📊 Configuration:');
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Symbol: ${SYMBOL}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Strategy Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
  console.log(`   Risk per Trade: ${(RISK_PERCENTAGE_CFD * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log(`   Warm-up: ${WARM_UP_CANDLES_REQUIRED} candles required`);
  console.log();
  console.log('📈 Expected Performance (from backtest):');
  console.log('   Win Rate: ~67% | PF: ~1.93 | Score: 52.9');
  console.log();

  // Initialize Strategy Accountant
  strategyAccountant = new StrategyAccountant();
  strategyAccountant.allocate(STRATEGY_NAME, STRATEGY_ALLOCATION);
  console.log(`💰 Allocated $${STRATEGY_ALLOCATION} to ${STRATEGY_NAME}`);
  console.log();

  // Initialize Gateway Client
  const gatewayClient = new GatewayClient({
    url: process.env.GATEWAY_WS_URL || 'ws://localhost:3000',
    autoReconnect: true,
    reconnectInterval: 5000,
    enableLogging: false,
  });

  // Create trade adapter
  const adapter = new UnifiedTradeAdapter(gatewayClient, TRADE_MODE);

  // Initialize TradeManager with DAX-specific settings
  tradeManager = new TradeManager(gatewayClient, adapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 20 * 60 * 1000,      // 20 min max for indices
      extremeMaxDuration: 30 * 60 * 1000,    // 30 min extreme max
      minTradeDuration: 60 * 1000,           // 1 min minimum
      earlyExitTpPct: 0.70,                  // Exit at 70% TP
    },
    trailingStop: {
      activationThreshold: 0.15,
      buffer: 0.001,
    },
    risk: {
      maxOpenTrades: 2,
      maxTradesPerSymbol: MAX_TRADES_PER_SYMBOL,
      riskPercentageCFD: RISK_PERCENTAGE_CFD,
      riskPercentageBinary: 0.01,
      minStake: 1.0,
      maxStakePercentage: 0.10,
    },
  });

  console.log('✅ TradeManager initialized\n');

  // Initialize TradeExecutionService
  tradeExecutionService = new TradeExecutionService(
    gatewayClient,
    adapter,
    tradeManager,
    {
      mode: TRADE_MODE,
      strategyName: STRATEGY_NAME,
      binaryDuration: 1,
      cfdTakeProfitPct: 0.003,  // 0.3% TP for indices
      cfdStopLossPct: 0.002,    // 0.2% SL for indices
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        'OTC_GDAXI': MULTIPLIER,
      },
    }
  );

  // Connect Telegram alerter to TradeExecutionService
  tradeExecutionService.setTelegramAlerter(telegramAlerter);
  console.log(`✅ TradeExecutionService initialized (Telegram: ${telegramAlerter.isReady() ? 'enabled' : 'disabled'})\n`);

  // Connect to gateway
  console.log('🔌 Connecting to Gateway...');
  await gatewayClient.connect();
  console.log('✅ Connected to Gateway\n');

  // Start TradeManager
  console.log('🔄 Starting TradeManager (position recovery + monitoring)...');
  await tradeManager.start();
  console.log('✅ TradeManager started\n');

  // Register trader
  try {
    const registration = await gatewayClient.registerTrader({
      name: `${STRATEGY_NAME} Trader`,
      strategy: STRATEGY_NAME,
      symbols: SYMBOLS,
    });
    console.log(`📝 Registered with Gateway: ${registration.traderId}\n`);
  } catch {
    console.log('⚠️  Could not register with Gateway (older version?)\n');
  }

  // Listen for reconnection
  gatewayClient.on('connected', async () => {
    console.log('✅ [GatewayClient] Reconnected to Gateway');
    try {
      await gatewayClient.registerTrader({
        name: `${STRATEGY_NAME} Trader`,
        strategy: STRATEGY_NAME,
        symbols: SYMBOLS,
      });
    } catch {
      // Ignore
    }
  });

  // Heartbeat
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore
    }
  }, 30000);

  // Initialize FVG-LS strategy for DAX
  strategy = new FVGLiquiditySweepStrategy({
    name: `${STRATEGY_NAME}`,
    asset: SYMBOL,
    version: '1.0.0',
    enabled: true,
  });
  console.log(`✅ Strategy initialized for ${SYMBOL}\n`);

  console.log('📊 Strategy Configuration:');
  console.log('   Liquidity Sweep: Detect stop hunts above/below swing points');
  console.log('   FVG Entry: Enter at 50% of FVG after sweep');
  console.log('   Take Profit: 1.5:1 R:R');
  console.log('   Stop Loss: Beyond sweep level + buffer\n');

  // Load historical candles
  console.log(`📥 Loading historical candles for ${SYMBOL}...\n`);

  try {
    const candles1m = await gatewayClient.getCandles(SYMBOL, 60, WARM_UP_CANDLES_REQUIRED);
    console.log(`   ✅ ${SYMBOL}: ${candles1m.length} x 1m candles`);
    candleBuffers.set(SYMBOL, candles1m);
    warmUpCandlesPerAsset.set(SYMBOL, candles1m.length);

    if (candles1m.length >= 50) {
      console.log(`   ✅ ${SYMBOL}: Ready for trading!\n`);
    }
  } catch (error: any) {
    console.log(`   ⚠️  ${SYMBOL}: Could not load historical candles: ${error.message}`);
    candleBuffers.set(SYMBOL, []);
    warmUpCandlesPerAsset.set(SYMBOL, 0);
  }

  // Process strategy signal
  async function processStrategySignal(signal: Signal | null, asset: string) {
    if (!signal) return;
    if (isInitializing || !hasReceivedRealtimeCandle) {
      console.log(`\n⏸️  Signal ignored during initialization`);
      return;
    }

    // CRITICAL: Check position limits BEFORE processing signal
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

    const strategyBalance = strategyAccountant.getBalance(STRATEGY_NAME);
    const strategyContext = strategyAccountant.getRiskContext(STRATEGY_NAME);

    if (!strategyContext) {
      console.log(`❌ Signal rejected: Strategy context not available`);
      tradeManager.releaseTradeLock(asset);
      return;
    }

    const stakeAmount = Math.max(
      1.0,
      Math.min(
        strategyBalance * RISK_PERCENTAGE_CFD,
        strategyBalance * 0.10
      )
    );

    if (stakeAmount > strategyBalance) {
      console.log(`❌ Signal rejected: Insufficient balance`);
      tradeManager.releaseTradeLock(asset);
      return;
    }

    const reserved = strategyAccountant.reserveStake(STRATEGY_NAME, stakeAmount);
    if (!reserved) {
      console.log(`❌ Signal rejected: Could not reserve stake`);
      tradeManager.releaseTradeLock(asset);
      return;
    }

    console.log(`\n✅ Signal approved | ${asset} | ${signal.direction} | Stake: $${stakeAmount.toFixed(2)} | ${signal.reason}`);

    try {
      const result = await tradeExecutionService.executeTrade(signal, asset);

      if (result.success) {
        console.log(`✅ Trade opened: ${result.contractId}`);
        totalTrades++;
      } else {
        console.log(`❌ Trade failed: ${result.error}`);
        strategyAccountant.releaseStake(STRATEGY_NAME, stakeAmount);
      }
    } catch (error: any) {
      console.error(`❌ Trade execution error:`, error.message);
      strategyAccountant.releaseStake(STRATEGY_NAME, stakeAmount);
    } finally {
      // CRITICAL: Always release the trade lock after execution completes
      tradeManager.releaseTradeLock(asset);
    }
  }

  // Subscribe to ticks
  console.log(`📡 Subscribing to: ${SYMBOLS.join(', ')}...`);
  try {
    await gatewayClient.follow(SYMBOLS);
    console.log(`✅ Subscribed\n`);
  } catch (error: any) {
    console.error(`❌ Failed to subscribe: ${error.message}`);
    console.log(`⏸️  Market may be closed. Trader will wait for market to open...\n`);
  }

  // Signal proximity check - publish every 10 seconds
  const PROXIMITY_CHECK_INTERVAL = 10000;
  setInterval(async () => {
    const isConnected = gatewayClient.isConnected();
    if (!isConnected) {
      return;
    }

    const buffer = candleBuffers.get(SYMBOL) || [];
    if (buffer.length < 50) {
      return;
    }

    try {
      const readiness = strategy.getSignalReadiness(buffer, SYMBOL);
      if (readiness) {
        if (!gatewayClient.isConnected()) {
          return;
        }

        const criteria = readiness.criteria.map((c) => ({
          name: c.name,
          current: c.current,
          target: c.target,
          unit: c.unit || '',
          passed: c.passed,
          distance: c.distance || 0,
        }));

        await gatewayClient.publishSignalProximity({
          strategy: STRATEGY_NAME,
          asset: SYMBOL,
          direction: readiness.direction,
          overallProximity: readiness.overallProximity,
          proximity: readiness.overallProximity,
          criteria,
          readyToSignal: readiness.readyToSignal,
          missingCriteria: readiness.missingCriteria || [],
        });
      }
    } catch (error: any) {
      const errorMsg = error?.message || '';
      if (errorMsg.includes('Not connected') || errorMsg.includes('Connection closed')) {
        return;
      }
      if (gatewayClient.isConnected()) {
        console.error(`[Signal Proximity] Error:`, errorMsg);
      }
    }
  }, PROXIMITY_CHECK_INTERVAL);

  // Handle ticks
  gatewayClient.on('tick', async (tick: Tick) => {
    const candle = processTick(tick);
    if (!candle) return;

    const asset = candle.asset;
    const buffer = candleBuffers.get(asset) || [];
    buffer.push(candle);

    if (buffer.length > 500) {
      buffer.shift();
    }
    candleBuffers.set(asset, buffer);

    // Track warm-up
    const warmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
    if (warmUpCount < WARM_UP_CANDLES_REQUIRED) {
      warmUpCandlesPerAsset.set(asset, warmUpCount + 1);
      if (warmUpCount + 1 === WARM_UP_CANDLES_REQUIRED) {
        console.log(`✅ ${asset}: Warm-up complete`);
        hasReceivedRealtimeCandle = true;
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
      const signal = await strategy.onCandle(candle, {
        candles: buffer,
        currentPrice: candle.close,
        indicators: {},
      });

      await processStrategySignal(signal, asset);
    } catch (error: any) {
      console.error(`❌ Strategy error for ${asset}:`, error.message);
    }
  });

  // Handle trade results
  tradeManager.on('trade:closed', async (result) => {
    if (processedTradeResults.has(result.contractId)) {
      return;
    }
    processedTradeResults.add(result.contractId);

    const pnl = result.profit || 0;
    const stake = result.stake || 0;
    const symbol = result.symbol;

    // Update accountant
    strategyAccountant.recordTrade(STRATEGY_NAME, {
      contractId: result.contractId,
      symbol,
      direction: result.direction,
      stake,
      profit: pnl,
      timestamp: Date.now(),
    });

    const isWin = pnl > 0;

    // Report to strategy for dynamic cooldown
    strategy.onTradeResult?.(isWin ? 'WIN' : 'LOSS', pnl);

    if (isWin) {
      wonTrades++;
      console.log(`\n✅ WIN: ${symbol} ${result.direction} | P&L: +$${pnl.toFixed(2)} | Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}`);
    } else {
      lostTrades++;
      console.log(`\n❌ LOSS: ${symbol} ${result.direction} | P&L: $${pnl.toFixed(2)} | Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}`);
    }

    const winRate = totalTrades > 0 ? (wonTrades / totalTrades * 100).toFixed(1) : '0.0';
    const stats = strategyAccountant.getStats(STRATEGY_NAME);
    console.log(`📊 Stats: ${wonTrades}W/${lostTrades}L (${winRate}% WR) | Total: ${totalTrades} | P&L: $${stats.totalPnL.toFixed(2)}\n`);
  });

  // Handle connection events
  gatewayClient.on('connected', () => {
    console.log('✅ Gateway connected');
    if (slackAlerter) {
      slackAlerter.info(`${STRATEGY_NAME} Trader connected to Gateway`);
    }
  });

  gatewayClient.on('disconnected', () => {
    console.log('⚠️  Gateway disconnected');
    if (slackAlerter) {
      slackAlerter.warning(`${STRATEGY_NAME} Trader disconnected from Gateway`);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    const stats = strategyAccountant.getStats(STRATEGY_NAME);
    console.log(`\n📊 Final Stats for ${STRATEGY_NAME}:`);
    console.log(`   Total Trades: ${totalTrades}`);
    console.log(`   Wins: ${wonTrades} | Losses: ${lostTrades}`);
    console.log(`   Win Rate: ${totalTrades > 0 ? (wonTrades / totalTrades * 100).toFixed(1) : '0.0'}%`);
    console.log(`   Total P&L: $${stats.totalPnL.toFixed(2)}`);
    console.log(`   Final Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}\n`);
    await gatewayClient.disconnect();
    process.exit(0);
  });

  console.log('✅ Strategy running. Press Ctrl+C to stop.\n');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
