/**
 * FVG Liquidity Sweep Strategy v1.0.0 - Live Trading
 *
 * Strategy: Combine Liquidity Sweep detection with FVG entry
 * - Detects liquidity sweeps (stop hunts)
 * - Finds FVG formed after sweep
 * - Enters when price returns to FVG
 * - Hour-based filtering to avoid low win-rate periods
 *
 * Optimized for Forex pairs with specific hour filters:
 * - frxAUDUSD: +11% improvement with hour filter
 * - frxEURUSD: +39.6% improvement
 * - frxGBPUSD: +81.8% improvement
 * - frxUSDCHF: +13.5% improvement
 *
 * Usage:
 *   SYMBOL="frxAUDUSD,frxEURUSD,frxGBPUSD,frxUSDCHF" pnpm --filter @deriv-bot/trader demo:fvg-ls
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
const STRATEGY_NAME = 'FVG-LS';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
// Default to optimized forex pairs
const SYMBOLS_STR = process.env.SYMBOL || 'frxAUDUSD,frxEURUSD,frxGBPUSD,frxUSDCHF';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Risk parameters
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.04'); // 4% per trade
const MAX_TRADES_PER_SYMBOL = 1;
const MULTIPLIER = parseInt(process.env.MULTIPLIER || '200');

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

// Telegram Alerter (created after loadEnvFromRoot to ensure env vars are loaded)
const telegramAlerter = new TelegramAlerter({ serviceName: STRATEGY_NAME });

// Strategies per symbol
const strategies = new Map<string, FVGLiquiditySweepStrategy>();

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
  console.log(`🎯 ${STRATEGY_NAME} - FVG LIQUIDITY SWEEP STRATEGY`);
  console.log('='.repeat(80));
  console.log();
  console.log('📊 Configuration:');
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Strategy Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
  console.log(`   Risk per Trade: ${(RISK_PERCENTAGE_CFD * 100).toFixed(1)}%`);
  console.log(`   Multiplier: x${MULTIPLIER}`);
  console.log(`   Warm-up: ${WARM_UP_CANDLES_REQUIRED} candles required`);
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

  // Initialize TradeManager
  tradeManager = new TradeManager(gatewayClient, adapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 60 * 60 * 1000,
      extremeMaxDuration: 120 * 60 * 1000,
      minTradeDuration: 60 * 1000,
      earlyExitTpPct: 0.75,
    },
    trailingStop: {
      activationThreshold: 0.20,
      buffer: 0.001,
    },
    risk: {
      maxOpenTrades: 4,
      maxTradesPerSymbol: MAX_TRADES_PER_SYMBOL,
      riskPercentageCFD: RISK_PERCENTAGE_CFD,
      riskPercentageBinary: 0.01,
      minStake: 1.0,
      maxStakePercentage: 0.10,
    },
  });

  console.log('✅ TradeManager initialized\n');

  // Initialize TradeExecutionService with multiplier map for forex
  tradeExecutionService = new TradeExecutionService(
    gatewayClient,
    adapter,
    tradeManager,
    {
      mode: TRADE_MODE,
      strategyName: STRATEGY_NAME,
      binaryDuration: 1,
      cfdTakeProfitPct: 0.005,  // 0.5% TP
      cfdStopLossPct: 0.003,    // 0.3% SL
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        // Forex pairs
        'frxAUDUSD': MULTIPLIER,
        'frxEURUSD': MULTIPLIER,
        'frxGBPUSD': MULTIPLIER,
        'frxUSDCHF': MULTIPLIER,
        'frxUSDJPY': MULTIPLIER,
        // Synthetics (if used)
        'R_75': 100,
        'R_100': 200,
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

  // Start TradeManager (recovers existing positions and starts monitoring)
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

  // Initialize FVG-LS strategy per symbol
  for (const symbol of SYMBOLS) {
    const strategy = new FVGLiquiditySweepStrategy({
      name: `${STRATEGY_NAME}-${symbol}`,
      asset: symbol,
      version: '1.0.0',
      enabled: true,
    });
    strategies.set(symbol, strategy);
    console.log(`✅ Strategy initialized for ${symbol}`);
  }
  console.log();

  console.log('📊 Strategy Configuration:');
  console.log('   Liquidity Sweep: Detect stop hunts above/below swing points');
  console.log('   FVG Entry: Enter at 50% of FVG after sweep');
  console.log('   Hour Filter: Skip bad hours based on backtested data');
  console.log('   Take Profit: 1.5:1 R:R');
  console.log('   Stop Loss: Beyond sweep level + buffer\n');

  console.log('⏰ Hour Filters (UTC):');
  console.log('   frxAUDUSD: Skip 5,8,9,11,16,17,21');
  console.log('   frxEURUSD: Skip 4,5,10,15');
  console.log('   frxGBPUSD: Skip 1,5,7,17,19,23');
  console.log('   frxUSDCHF: Skip 4,9,21,23\n');

  // Check if forex market is open (closed on weekends)
  const isForexMarket = SYMBOLS.some(s => s.startsWith('frx'));
  if (isForexMarket) {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();

    // Forex market is closed from Friday ~22:00 UTC to Sunday ~22:00 UTC
    // Saturday (6) is always closed
    // Sunday (0) before 22:00 UTC is closed
    // Friday (5) after 22:00 UTC is effectively closed (low liquidity)
    const isWeekend = dayOfWeek === 6 || (dayOfWeek === 0 && hour < 22) || (dayOfWeek === 5 && hour >= 22);

    if (isWeekend) {
      console.log('⏸️  Forex market is closed (weekend)');
      console.log('   Market opens: Sunday 22:00 UTC');
      console.log('   Waiting for market to open...\n');

      // Wait and retry every 5 minutes
      const waitForMarketOpen = async () => {
        while (true) {
          const checkNow = new Date();
          const checkDay = checkNow.getUTCDay();
          const checkHour = checkNow.getUTCHours();
          const stillClosed = checkDay === 6 || (checkDay === 0 && checkHour < 22) || (checkDay === 5 && checkHour >= 22);

          if (!stillClosed) {
            console.log('✅ Forex market is now open!\n');
            return;
          }

          // Calculate time until Sunday 22:00 UTC
          const targetDay = 0; // Sunday
          const targetHour = 22;
          let daysUntil = (targetDay - checkDay + 7) % 7;
          if (daysUntil === 0 && checkHour >= targetHour) {
            daysUntil = 7;
          }
          const msUntil = ((daysUntil * 24 + targetHour - checkHour) * 60 - checkNow.getUTCMinutes()) * 60 * 1000;
          const hoursUntil = Math.floor(msUntil / (1000 * 60 * 60));
          const minsUntil = Math.floor((msUntil % (1000 * 60 * 60)) / (1000 * 60));

          console.log(`⏳ Market closed. Opens in ~${hoursUntil}h ${minsUntil}m. Checking again in 5 minutes...`);
          await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // Wait 5 minutes
        }
      };

      await waitForMarketOpen();
    }
  }

  // Load historical candles
  console.log(`📥 Loading historical candles for ${SYMBOLS.length} asset(s)...\n`);

  for (const symbol of SYMBOLS) {
    try {
      const candles1m = await gatewayClient.getCandles(symbol, 60, WARM_UP_CANDLES_REQUIRED);
      console.log(`   ✅ ${symbol}: ${candles1m.length} x 1m candles`);
      candleBuffers.set(symbol, candles1m);
      warmUpCandlesPerAsset.set(symbol, candles1m.length);

      if (candles1m.length >= 50) {
        console.log(`   ✅ ${symbol}: Ready for trading!`);
      }
    } catch (error: any) {
      // Check if market is closed
      if (error.message?.includes('market is presently closed') || error.message?.includes('MarketIsClosed')) {
        console.log(`   ⏸️  ${symbol}: Market is closed - waiting...`);
        // Wait 5 minutes and retry
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        // Retry once
        try {
          const retryCandles = await gatewayClient.getCandles(symbol, 60, WARM_UP_CANDLES_REQUIRED);
          console.log(`   ✅ ${symbol}: ${retryCandles.length} x 1m candles (after retry)`);
          candleBuffers.set(symbol, retryCandles);
          warmUpCandlesPerAsset.set(symbol, retryCandles.length);
        } catch (retryError: any) {
          console.log(`   ⚠️  ${symbol}: Still closed after retry: ${retryError.message}`);
          candleBuffers.set(symbol, []);
          warmUpCandlesPerAsset.set(symbol, 0);
        }
      } else {
        console.log(`   ⚠️  ${symbol}: Could not load historical candles: ${error.message}`);
        candleBuffers.set(symbol, []);
        warmUpCandlesPerAsset.set(symbol, 0);
      }
    }
  }
  console.log();

  // Process strategy signal
  async function processStrategySignal(signal: Signal | null, asset: string) {
    if (!signal) return;
    if (isInitializing || !hasReceivedRealtimeCandle) {
      console.log(`\n⏸️  Signal ignored during initialization`);
      return;
    }

    // CRITICAL: Check position limits BEFORE processing signal
    // This prevents multiple trades opening for the same asset
    const canOpen = tradeManager.canOpenTrade(asset);
    if (!canOpen.allowed) {
      console.log(`\n❌ Signal rejected for ${asset}: ${canOpen.reason}`);
      return;
    }

    // CRITICAL: Acquire trade lock to prevent race conditions
    // If two signals arrive within milliseconds, only the first one should proceed
    if (!tradeManager.acquireTradeLock(asset)) {
      console.log(`\n❌ Signal rejected for ${asset}: Trade already in progress`);
      return;
    }

    const strategyBalance = strategyAccountant.getBalance(STRATEGY_NAME);
    const strategyContext = strategyAccountant.getRiskContext(STRATEGY_NAME);

    if (!strategyContext) {
      console.log(`❌ Signal rejected: Strategy context not available`);
      tradeManager.releaseTradeLock(asset); // Release lock on early exit
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
      tradeManager.releaseTradeLock(asset); // Release lock on early exit
      return;
    }

    const reserved = strategyAccountant.reserveStake(STRATEGY_NAME, stakeAmount);
    if (!reserved) {
      console.log(`❌ Signal rejected: Could not reserve stake`);
      tradeManager.releaseTradeLock(asset); // Release lock on early exit
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

  // Subscribe to ticks with retry on market closed
  console.log(`📡 Subscribing to: ${SYMBOLS.join(', ')}...`);

  const subscribeWithRetry = async (maxRetries = 10) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await gatewayClient.follow(SYMBOLS);
        console.log(`✅ Subscribed\n`);
        return;
      } catch (error: any) {
        const isMarketClosed = error.message?.includes('market is presently closed') ||
                               error.message?.includes('MarketIsClosed');

        if (isMarketClosed && attempt < maxRetries) {
          console.log(`⏸️  Market closed - waiting 5 minutes before retry (${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        } else {
          throw error;
        }
      }
    }
  };

  await subscribeWithRetry();

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
    const strategy = strategies.get(asset);
    if (!strategy) return;

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
    const strategy = strategies.get(symbol);
    if (strategy) {
      strategy.onTradeResult?.(isWin ? 'WIN' : 'LOSS', pnl);
    }

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
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
