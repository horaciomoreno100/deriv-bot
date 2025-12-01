/**
 * Fair Value Gap (FVG) Strategy v1.0.0 - Live Trading
 *
 * Strategy: Trade price returns to Fair Value Gaps (liquidity imbalances)
 * - Detects FVGs on 5m timeframe
 * - Waits for price to return to FVG zone on 1m
 * - Entry with RSI confirmation
 *
 * Based on backtest results (30 days):
 * - R_100: +$5,124 (64.5% WR, 1.47 PF, 3.10 SQN) - BEST
 * - R_75: +$1,399 (53.5% WR, 1.11 PF, 0.93 SQN)
 *
 * Usage:
 *   SYMBOL="R_75,R_100" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:fvg
 */

import { GatewayClient, loadEnvFromRoot, getTelegramAlerter, initSlackAlerts } from '@deriv-bot/shared';
import { FVGStrategy } from '../strategies/fvg.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const STRATEGY_NAME = 'FVG';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
// Default to R_75,R_100 (best performers in backtest)
const SYMBOLS_STR = process.env.SYMBOL || 'R_75,R_100';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Risk parameters (relative to strategy allocation)
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% per trade
const MAX_TRADES_PER_SYMBOL = 1;

// FVG Configuration from environment
const FVG_TIMEFRAME = parseInt(process.env.FVG_TIMEFRAME || '5'); // 5m default
const FVG_ENTRY_ZONE = (process.env.FVG_ENTRY_ZONE || 'middle') as 'edge' | 'middle' | 'full';

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
const WARM_UP_CANDLES_REQUIRED = 100; // Need 100 candles for FVG detection
const processedTradeResults = new Set<string>();

// Components
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let slackAlerter: ReturnType<typeof initSlackAlerts> | null = null;
let strategyAccountant: StrategyAccountant;

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
  console.log(`🎯 ${STRATEGY_NAME} - FAIR VALUE GAP STRATEGY`);
  console.log('='.repeat(80));
  console.log();
  console.log('📊 Configuration:');
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   FVG Timeframe: ${FVG_TIMEFRAME}m`);
  console.log(`   Entry Zone: ${FVG_ENTRY_ZONE}`);
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
      cfdTakeProfitPct: 0.004,  // 0.4% TP
      cfdStopLossPct: 0.003,    // 0.3% SL (1.33:1 ratio)
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        // Volatility indices
        'R_10': 400,
        'R_25': 200,
        'R_50': 100,
        'R_75': 100,
        'R_100': 200,  // Best performer for FVG
      },
    }
  );

  console.log('✅ TradeExecutionService initialized\n');

  // Connect to gateway
  console.log('🔌 Connecting to Gateway...');
  await gatewayClient.connect();
  console.log('✅ Connected to Gateway\n');

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

  // Initialize FVG strategy
  const strategy = new FVGStrategy({
    name: STRATEGY_NAME.toLowerCase(),
    enabled: true,
    assets: SYMBOLS,
    maxConcurrentTrades: 1,
    amount: 100,
    amountType: 'fixed',
    cooldownSeconds: 60,
    minConfidence: 0.7,
    parameters: {
      fvgTimeframe: FVG_TIMEFRAME,
      entryZone: FVG_ENTRY_ZONE,
      // Use defaults for other params (conservative settings)
    },
  });

  console.log('📊 Strategy Configuration (v1.0.0):');
  console.log(`   FVG Detection: ${FVG_TIMEFRAME}m timeframe`);
  console.log(`   Min Gap Size: 0.15%`);
  console.log(`   Entry Zone: ${FVG_ENTRY_ZONE}`);
  console.log(`   Confirmation: 2 candles (default)`);
  console.log(`   RSI Filter: Enabled (14 period, 70/30)`);
  console.log(`   Take Profit: 1.5x gap size`);
  console.log(`   Stop Loss: 0.1% beyond FVG`);
  console.log(`   Max FVG Age: 100 bars\n`);

  console.log('🛡️  Anti-Streak Protection:');
  console.log('   Dynamic Cooldown: 2L→10min, 3L→30min, 4+L→60min');
  console.log('   Daily Loss Limit: 5% of capital\n');

  console.log('📈 Strategy Logic:');
  console.log('   Bullish FVG (gap up): Wait for price to return DOWN → CALL');
  console.log('   Bearish FVG (gap down): Wait for price to return UP → PUT\n');

  console.log(`✅ Strategy "${strategy.getName()}" initialized\n`);

  // Load historical candles first
  console.log(`📥 Loading historical candles for ${SYMBOLS.length} asset(s)...\n`);
  const CANDLES_5M_NEEDED = 50; // For FVG detection
  const CANDLES_1M_NEEDED = 100; // For execution

  for (const symbol of SYMBOLS) {
    try {
      // Load 5m candles directly (for FVG detection)
      const candles5m = await gatewayClient.getCandles(symbol, 300, CANDLES_5M_NEEDED);
      console.log(`   ✅ ${symbol}: ${candles5m.length} x 5m candles`);

      // Load 1m candles (for execution)
      const candles1m = await gatewayClient.getCandles(symbol, 60, CANDLES_1M_NEEDED);
      console.log(`   ✅ ${symbol}: ${candles1m.length} x 1m candles`);

      // Store 1m candles in buffer (for strategy execution)
      candleBuffers.set(symbol, candles1m);
      warmUpCandlesPerAsset.set(symbol, candles1m.length);

      // Pre-load 5m candles into strategy for FVG detection
      strategy.loadDirectCandles(symbol, candles5m);

      if (candles5m.length >= 20) {
        console.log(`   ✅ ${symbol}: Ready for trading! (${candles5m.length} x 5m for FVG)`);
      } else {
        console.log(`   ⚠️  ${symbol}: Need ${Math.max(0, 20 - candles5m.length)} more 5m candles`);
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
    const isConnected = gatewayClient.isConnected();
    if (!isConnected) {
      return;
    }

    if (typeof (strategy as any).getSignalReadiness === 'function') {
      for (const symbol of SYMBOLS) {
        const buffer = candleBuffers.get(symbol) || [];
        if (buffer.length >= 100) {
          try {
            const readiness = (strategy as any).getSignalReadiness(buffer);
            if (readiness) {
              const stillConnected = gatewayClient.isConnected();
              if (!stillConnected) {
                continue;
              }

              await gatewayClient.publishSignalProximity({
                strategy: STRATEGY_NAME,
                asset: symbol,
                direction: readiness.direction,
                overallProximity: readiness.overallProximity,
                proximity: readiness.overallProximity,
                criteria: [],
                readyToSignal: readiness.readyToSignal,
                missingCriteria: readiness.missingCriteria || [],
              });
              console.log(`[Signal Proximity] Published for ${symbol}: ${readiness.direction} ${readiness.overallProximity}%`);
            }
          } catch (error: any) {
            const errorMsg = error?.message || String(error || '');
            if (errorMsg.includes('Not connected')) {
              return;
            }
          }
        }
      }
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

    // Report trade result to strategy for dynamic cooldown
    strategy.reportTradeResult(result.symbol, pnl, isWin);

    if (isWin) {
      wonTrades++;
      console.log(`\n✅ WIN: ${result.symbol} ${result.direction} | P&L: +$${pnl.toFixed(2)} | Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}`);
    } else {
      lostTrades++;
      console.log(`\n❌ LOSS: ${result.symbol} ${result.direction} | P&L: $${pnl.toFixed(2)} | Balance: $${strategyAccountant.getBalance(STRATEGY_NAME).toFixed(2)}`);
    }

    // Show FVG state
    const fvgState = strategy.getFVGState(result.symbol);
    console.log(`📊 FVG State: ${fvgState.bullishFVGs.length} bullish, ${fvgState.bearishFVGs.length} bearish | Consecutive Losses: ${fvgState.consecutiveLosses}`);

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
