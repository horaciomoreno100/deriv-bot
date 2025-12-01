/**
 * Hybrid Multi-Timeframe Strategy v2.1.0 - Live Trading
 *
 * Strategy: Combines Momentum and Mean Reversion based on multi-timeframe regime detection
 * - 15m Context: Determines macro regime (BULLISH_TREND / BEARISH_TREND / RANGE)
 * - 5m Filter: RSI extremes filter (avoid buying tops/selling bottoms)
 * - 1m Execution: BB + RSI signals for precise entry
 *
 * v2.1.0 IMPROVEMENTS:
 * - Dynamic cooldown after consecutive losses (reduces DD from 13.8% to 8%)
 * - Optimized TP/SL: 0.4%/0.3% (1.33:1 ratio) for better win rate
 * - Multiplier x200 for R_100 (doubles returns with manageable risk)
 * - Daily loss limit: 5% protection
 *
 * v2.0.0 IMPROVEMENTS:
 * - Fixed Momentum logic: Enter on pullbacks (buy dips/sell rallies), not extensions
 * - RSI thresholds: 70/30 instead of 55/45
 * - ADX period: 10 instead of 14 (faster regime detection)
 * - BB width filter: 0.3% min to avoid low volatility
 *
 * Optimized for: R_100 (Volatility 100 Index)
 * Backtest Results (90 days R_100, $1000 capital):
 * - v2.1.0 (x200, cooldown): +$1014 (47.1% WR, 8.0% DD, 736 trades)
 * - v2.1.0 (x200, no cooldown): +$1026 (47.1% WR, 13.8% DD, 882 trades)
 * - v2.0.0 (x100): +$513 (47.1% WR, 8.4% DD, 882 trades)
 *
 * Usage:
 *   SYMBOL="R_100" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:hybrid-mtf
 */

import { GatewayClient, loadEnvFromRoot, TelegramAlerter, initSlackAlerts } from '@deriv-bot/shared';
import { HybridMTFStrategy } from '../strategies/hybrid-mtf.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';
// Load environment variables from project root
loadEnvFromRoot();

// Configuration
const STRATEGY_NAME = 'HYBRID_MTF';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
// Strategy optimized specifically for R_100
const SYMBOLS_STR = process.env.SYMBOL || 'R_100';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Risk parameters (relative to strategy allocation)
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% per trade
const MAX_TRADES_PER_SYMBOL = 1;

// Tick processing state
const TIMEFRAME = 60; // 1 minute
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();
const candleBuffers = new Map<string, Candle[]>(); // Per-asset candle buffers for strategy

// State
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true;
const warmUpCandlesPerAsset = new Map<string, number>();
let hasReceivedRealtimeCandle = false;
const WARM_UP_CANDLES_REQUIRED = 100; // Need 100 candles for 15m context (50 SMA + buffer)
const processedTradeResults = new Set<string>();

// Components
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let slackAlerter: ReturnType<typeof initSlackAlerts> | null = null;
let strategyAccountant: StrategyAccountant;

// Telegram Alerter (created after loadEnvFromRoot to ensure env vars are loaded)
const telegramAlerter = new TelegramAlerter({ serviceName: STRATEGY_NAME });

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
  console.log(`🎯 ${STRATEGY_NAME} - HYBRID MULTI-TIMEFRAME STRATEGY`);
  console.log('='.repeat(80));
  console.log();
  console.log('📊 Configuration:');
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  if (!SYMBOLS.includes('R_100')) {
    console.log(`   ⚠️  WARNING: Strategy optimized for R_100 only!`);
    console.log(`   ⚠️  Other symbols not tested - use at your own risk`);
  }
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Strategy Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
  console.log(`   Total Account Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Warm-up: ${WARM_UP_CANDLES_REQUIRED} candles required`);
  console.log(`   Slack Alerts: ${slackAlerter ? 'Enabled' : 'Disabled'}`);
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

  // Initialize TradeManager (use SYMBOLS from config)
  tradeManager = new TradeManager(gatewayClient, adapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 60 * 60 * 1000, // 60 min max
      extremeMaxDuration: 120 * 60 * 1000,
      minTradeDuration: 60 * 1000,
      earlyExitTpPct: 0.75,
    },
    trailingStop: {
      activationThreshold: 0.20,
      buffer: 0.001,
    },
    risk: {
      maxOpenTrades: 3,
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
      cfdTakeProfitPct: 0.004,  // 0.4% TP (v2.1.0 - optimized)
      cfdStopLossPct: 0.003,    // 0.3% SL (1.33:1 ratio)
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        // Volatility indices (v2.1.0 - increased for better returns)
        'R_10': 400,
        'R_25': 200,
        'R_50': 100,
        'R_75': 100,
        'R_100': 200,  // v2.1.0: Doubled for better P&L (+102% ROI with same risk)
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

  // Listen for reconnection events and re-register
  gatewayClient.on('connected', async () => {
    console.log('✅ [GatewayClient] Reconnected to Gateway');
    
    // Re-register trader with Gateway after reconnection
    try {
      const registration = await gatewayClient.registerTrader({
        name: `${STRATEGY_NAME} Trader`,
        strategy: STRATEGY_NAME,
        symbols: SYMBOLS,
      });
      console.log(`📝 [Reconnect] Re-registered with Gateway: ${registration.traderId}`);
    } catch (error) {
      console.log('⚠️  [Reconnect] Could not re-register with Gateway');
    }
  });

  // Start heartbeat
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore
    }
  }, 30000);

  // Initialize strategy (uses DEFAULT_PARAMS from strategy class - v2.0.0)
  const strategy = new HybridMTFStrategy({
    name: STRATEGY_NAME.toLowerCase(),
    enabled: true,
    assets: SYMBOLS,
    maxConcurrentTrades: 1,
    amount: 100,
    amountType: 'fixed',
    cooldownSeconds: 60,
    minConfidence: 0.7,
    // Uses DEFAULT_PARAMS v2.0.0 from strategy class
  });

  console.log('📊 Strategy Configuration (v2.1.0):');
  console.log(`   15m Context: ADX(10) > 20 + SMA(20) slope for regime detection`);
  console.log(`   5m Filter: RSI(14) extremes (avoid >70/<30)`);
  console.log(`   1m Execution: BB(20,2) + RSI(14) for entry`);
  console.log(`   BB Width Min: 0.3% (avoid low volatility)`);
  console.log(`   RSI Thresholds: 70/30 (real overbought/oversold)`);
  console.log(`   Take Profit: 0.4% (v2.1.0 optimized)`);
  console.log(`   Stop Loss: 0.3%`);
  console.log(`   TP/SL Ratio: 1.33:1`);
  console.log(`   Multiplier: x200 for R_100 (v2.1.0)`);
  console.log(`   Cooldown: 60 seconds (base)`);
  console.log(`   Confirmation: 2 candles (Mean Reversion)\n`);

  console.log('🛡️  Anti-Streak Protection (v2.1.0):');
  console.log('   Dynamic Cooldown: 2L→10min, 3L→30min, 4+L→60min');
  console.log('   Daily Loss Limit: 5% of capital');
  console.log('   Expected DD reduction: 13.8% → 8.0%\n');

  console.log('📈 Strategy Logic:');
  console.log('   BULLISH_TREND (15m): CALL on pullbacks (buy the dip)');
  console.log('   BEARISH_TREND (15m): PUT on pullbacks (sell the rally)');
  console.log('   RANGE (15m): Mean Reversion (POST_CONFIRM 2 candles)\n');

  console.log(`✅ Strategy "${strategy.getName()}" initialized\n`);

  // Load historical candles first (before setting up signal proximity)
  console.log(`📥 Loading historical candles for ${SYMBOLS.length} asset(s)...\n`);
  // Strategy needs (v2.0.0):
  // - 1m candles for execution (need 100+ for BB/RSI indicators)
  // - 5m candles for RSI filter (need 15+ for RSI 14)
  // - 15m candles for regime detection (need 21 for SMA 20 + ADX 10)
  // Load 5m and 15m candles directly from API (much more efficient than resampling!)
  const CANDLES_15M_NEEDED = 30; // 21 for SMA(20) + ADX(10) + buffer
  const CANDLES_5M_NEEDED = 20; // 15 for RSI(14) + buffer
  const CANDLES_1M_NEEDED = 100; // For BB/RSI indicators on 1m

  for (const symbol of SYMBOLS) {
    try {
      // Load 15m candles directly (for regime detection)
      const candles15m = await gatewayClient.getCandles(symbol, 900, CANDLES_15M_NEEDED); // 900 seconds = 15 minutes
      console.log(`   ✅ ${symbol}: ${candles15m.length} x 15m candles`);
      
      // Load 5m candles directly (for RSI filter)
      const candles5m = await gatewayClient.getCandles(symbol, 300, CANDLES_5M_NEEDED); // 300 seconds = 5 minutes
      console.log(`   ✅ ${symbol}: ${candles5m.length} x 5m candles`);
      
      // Load 1m candles (for execution)
      const candles1m = await gatewayClient.getCandles(symbol, 60, CANDLES_1M_NEEDED); // 60 seconds = 1 minute
      console.log(`   ✅ ${symbol}: ${candles1m.length} x 1m candles`);
      
      // Store 1m candles in buffer (for strategy execution)
      candleBuffers.set(symbol, candles1m);
      warmUpCandlesPerAsset.set(symbol, candles1m.length);
      
      // Pre-load direct candles into strategy (much faster than resampling!)
      strategy.loadDirectCandles(symbol, candles5m, candles15m);
      
      if (candles15m.length >= 21 && candles5m.length >= 15) {
        console.log(`   ✅ ${symbol}: Ready for trading! (${candles15m.length} x 15m, ${candles5m.length} x 5m)`);
      } else {
        console.log(`   ⚠️  ${symbol}: Need ${Math.max(0, 21 - candles15m.length)} more 15m, ${Math.max(0, 15 - candles5m.length)} more 5m candles`);
      }
    } catch (error: any) {
      console.log(`   ⚠️  ${symbol}: Could not load historical candles: ${error.message}`);
      candleBuffers.set(symbol, []);
      warmUpCandlesPerAsset.set(symbol, 0);
    }
  }
  console.log();

  // Signal proximity check - publish every 10 seconds
  const PROXIMITY_CHECK_INTERVAL = 10000;
  const proximityCheckInterval = setInterval(async () => {
    // Check connection first - skip entire check if not connected
    const isConnected = gatewayClient.isConnected();
    if (!isConnected) {
      // Debug: Log connection status (only occasionally to avoid spam)
      if (Math.random() < 0.1) { // 10% of the time
        console.log(`[Signal Proximity] Skipping check - Gateway not connected (isConnected: ${isConnected})`);
      }
      return; // Skip silently, will retry on next interval
    }

    if (typeof (strategy as any).getSignalReadiness === 'function') {
      for (const symbol of SYMBOLS) {
        const buffer = candleBuffers.get(symbol) || [];
        if (buffer.length >= 100) { // minCandles for Hybrid MTF
          try {
            const readiness = (strategy as any).getSignalReadiness(buffer);
            if (readiness) {
              // Double-check connection before publishing (connection might drop between checks)
              const stillConnected = gatewayClient.isConnected();
              if (!stillConnected) {
                console.log(`[Signal Proximity] ${symbol}: Connection lost before publish, skipping`);
                continue; // Skip this symbol, try next one
              }

              // Convert criteria format to match Gateway expectations
              const criteria = readiness.criteria.map((c: any) => ({
                name: c.name,
                current: c.current,
                target: c.target,
                unit: c.unit || '',
                passed: c.passed,
                distance: c.distance || 0,
              }));

              await gatewayClient.publishSignalProximity({
                strategy: STRATEGY_NAME,
                asset: symbol,
                direction: readiness.direction,
                overallProximity: readiness.overallProximity,
                proximity: readiness.overallProximity, // For compatibility
                criteria,
                readyToSignal: readiness.readyToSignal,
                missingCriteria: readiness.missingCriteria || [],
              });
              console.log(`[Signal Proximity] Published for ${symbol}: ${readiness.direction} ${readiness.overallProximity}%`);
            } else {
              console.log(`[Signal Proximity] ${symbol}: getSignalReadiness returned null`);
            }
          } catch (error: any) {
            // Extract error message FIRST
            const errorMsg = error?.message || String(error || '');
            
            // Check if error message contains "Not connected to Gateway" - this is the most direct check
            // This MUST be checked first before any other logic
            if (errorMsg.includes('Not connected to Gateway') || errorMsg.includes('Not connected')) {
              // This is definitely a connection error - silently ignore
              return;
            }
            
            // Check connection state - if not connected, this is definitely a connection error
            const currentlyConnected = gatewayClient.isConnected();
            if (!currentlyConnected) {
              // Not connected - silently ignore
              return;
            }
            
            // Check for other connection-related keywords
            const errorStack = error?.stack || '';
            const hasConnectionKeywords = 
              errorMsg.includes('Connection closed') || 
              errorMsg.includes('WebSocket') || 
              errorMsg.includes('socket') ||
              errorStack.includes('Not connected') || 
              errorStack.includes('Connection closed') || 
              errorStack.includes('WebSocket');
            
            if (hasConnectionKeywords) {
              // Connection-related error - silently ignore
              return;
            }
            
            // Only log if it's NOT a connection error (real errors)
            // This should rarely happen - if it does, it's a real bug
            console.error(`[Signal Proximity] Real error for ${symbol} (not connection):`, errorMsg);
          }
        } else {
          // Log when buffer is not ready (only once per symbol to avoid spam)
          if (buffer.length === 0 || buffer.length % 20 === 0) {
            console.log(`[Signal Proximity] ${symbol}: Waiting for candles (${buffer.length}/100)`);
          }
        }
      }
    } else {
      console.warn('[Signal Proximity] Strategy does not have getSignalReadiness method');
    }
  }, PROXIMITY_CHECK_INTERVAL);

  // Process signals from strategy
  async function processStrategySignal(signal: Signal | null, assetParam: string) {
    if (!signal) return;
    if (isInitializing || !hasReceivedRealtimeCandle) {
      console.log(`\n⏸️  Signal ignored during initialization`);
      return;
    }

    const asset = (signal as any).asset || signal.symbol || assetParam || SYMBOLS[0];

    // Get strategy balance from accountant
    const strategyBalance = strategyAccountant.getBalance(STRATEGY_NAME);
    const strategyContext = strategyAccountant.getRiskContext(STRATEGY_NAME);

    if (!strategyContext) {
      console.log(`❌ Signal rejected: Strategy ${STRATEGY_NAME} context not available`);
      return;
    }

    // Calculate stake based on strategy balance
    const stakeAmount = Math.max(
      1.0,
      Math.min(
        strategyBalance * RISK_PERCENTAGE_CFD,
        strategyBalance * 0.10 // Max 10% of strategy balance
      )
    );

    if (stakeAmount > strategyBalance) {
      console.log(`❌ Signal rejected: Insufficient balance (${strategyBalance.toFixed(2)} < ${stakeAmount.toFixed(2)})`);
      return;
    }

    // Reserve stake
    const reserved = strategyAccountant.reserveStake(STRATEGY_NAME, stakeAmount);
    if (!reserved) {
      console.log(`❌ Signal rejected: Could not reserve stake`);
      return;
    }

    console.log(`\n✅ Signal approved | Asset: ${asset} | Direction: ${signal.direction} | Stake: $${stakeAmount.toFixed(2)} [${STRATEGY_NAME}]`);

    try {
      // Pass the original signal (which contains metadata.entryPrice) to TradeExecutionService
      // The signal from HybridMTFStrategy includes:
      // - direction: 'CALL' | 'PUT'
      // - confidence: number
      // - metadata: { regime, strategy, entryPrice, takeProfit, stopLoss, tpPct, slPct }
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
    }
  }

  // Subscribe to ticks
  console.log(`📡 Subscribing to: ${SYMBOLS.join(', ')}...`);
  await gatewayClient.follow(SYMBOLS);
  // Don't clear buffers here - they already have historical candles loaded
  console.log(`✅ Subscribed\n`);

  // Handle ticks
  gatewayClient.on('tick', async (tick: Tick) => {
    const candle = processTick(tick);
    if (!candle) return;

    const asset = candle.asset;
    const buffer = candleBuffers.get(asset) || [];
    buffer.push(candle);

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
        console.log(`✅ ${asset}: Warm-up complete (${WARM_UP_CANDLES_REQUIRED} candles)`);
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
        balance: strategyAccountant.getBalance(STRATEGY_NAME),
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

    // Update accountant
    strategyAccountant.recordTrade(STRATEGY_NAME, {
      contractId: result.contractId,
      symbol: result.symbol,
      direction: result.direction,
      stake,
      profit: pnl,
      timestamp: Date.now(),
    });

    const isWin = pnl > 0;

    // Report trade result to strategy for dynamic cooldown (v2.1.0)
    strategy.reportTradeResult(result.symbol, pnl, isWin);

    if (isWin) {
      wonTrades++;
      console.log(`\n✅ WIN: ${result.symbol} ${result.direction} | P&L: +$${pnl.toFixed(2)} | Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}`);
    } else {
      lostTrades++;
      console.log(`\n❌ LOSS: ${result.symbol} ${result.direction} | P&L: $${pnl.toFixed(2)} | Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}`);
    }

    // Show streak protection status (v2.1.0)
    const streakStatus = strategy.getStreakStatus(result.symbol);
    if (streakStatus.consecutiveLosses > 0 || streakStatus.cooldownRemaining > 0) {
      console.log(`🛡️  Streak Protection: ${streakStatus.consecutiveLosses} consecutive losses | Cooldown: ${streakStatus.cooldownRemaining.toFixed(0)}s | Daily P&L: $${streakStatus.dailyPnl.toFixed(2)}`);
    }

    // Print stats
    const winRate = totalTrades > 0 ? (wonTrades / totalTrades * 100).toFixed(1) : '0.0';
    const stats = strategyAccountant.getStats(STRATEGY_NAME);
    console.log(`📊 Stats: ${wonTrades}W/${lostTrades}L (${winRate}% WR) | Total: ${totalTrades} | P&L: $${stats.totalPnL.toFixed(2)} | ROI: ${stats.roi.toFixed(2)}%\n`);
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
    console.log(`   ROI: ${stats.roi.toFixed(2)}%`);
    console.log(`   Final Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}\n`);
    await gatewayClient.disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

