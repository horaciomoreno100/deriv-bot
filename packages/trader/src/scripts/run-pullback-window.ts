/**
 * Pullback Window Strategy - Live Trading Script
 *
 * State machine-based scalping strategy for Gold (XAUUSD) and Silver (XAGUSD):
 * 1. SCANNING: Waiting for EMA crossover
 * 2. ARMED: Counting pullback candles
 * 3. WINDOW_OPEN: Waiting for breakout
 * 4. ENTRY: Signal confirmed
 *
 * Strategy Characteristics:
 * - 4-phase state machine for high probability entries
 * - ATR-based dynamic TP/SL
 * - ADX filter for trend strength
 * - Optimized presets for Gold/Silver volatility
 */

import { GatewayClient, loadEnvFromRoot, TelegramAlerter } from '@deriv-bot/shared';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import { PullbackWindowStrategy } from '../strategies/pullback-window/pullback-window.strategy.js';
import { getParamsForAsset, getPreset } from '../strategies/pullback-window/pullback-window.params.js';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables from project root
loadEnvFromRoot();

// Configuration
const STRATEGY_NAME = 'PULLBACK-WINDOW';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
const SYMBOL_STR = process.env.SYMBOL || 'frxXAUUSD,frxXAGUSD';
const SYMBOLS = SYMBOL_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');

// Strategy preset (validated in backtest)
const PRESET = process.env.PRESET || 'paper_m5'; // M5 timeframe, academic paper parameters

// Risk parameters
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% for forex
const RISK_PERCENTAGE_BINARY = 0.01; // 1% for binary
const MAX_TRADES_PER_SYMBOL = 1;

// Tick processing state
const TIMEFRAME = 300; // 5 minutes (M5) - validated in backtest
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();
const candleHistory = new Map<string, Candle[]>();

// Strategy instances
const strategies = new Map<string, PullbackWindowStrategy>();
const backtesters = new Map<string, FastBacktester>();

// State
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true;
const warmUpCandlesPerAsset = new Map<string, number>();
let hasReceivedRealtimeCandle = false;
const WARM_UP_CANDLES_REQUIRED = 50; // Need 50 candles for EMAs (EMA24 + buffer)

// Services (initialized in main)
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let strategyAccountant: StrategyAccountant;
const telegramAlerter = new TelegramAlerter();

// Track processed trade results
const processedTradeResults = new Set<string>();

// Signal proximity calculation interval (every 10 seconds)
const PROXIMITY_CHECK_INTERVAL = 10000;

/**
 * Process tick and aggregate to candle
 */
function processTick(tick: Tick): Candle | null {
  const asset = tick.asset;
  const tickTime = tick.timestamp;
  const candleTime = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);

  const lastTime = lastCandleTimes.get(asset);

  // If new candle period started
  if (lastTime !== undefined && lastTime !== candleTime) {
    const prevCandle = currentCandles.get(asset);
    if (prevCandle && prevCandle.open !== undefined && prevCandle.close !== undefined) {
      const completedCandle: Candle = {
        asset,
        timestamp: lastTime,
        timeframe: TIMEFRAME,
        open: prevCandle.open,
        high: prevCandle.high!,
        low: prevCandle.low!,
        close: prevCandle.close,
        volume: prevCandle.volume || 0,
      };

      // Add to history
      const history = candleHistory.get(asset) || [];
      history.push(completedCandle);
      candleHistory.set(asset, history);

      // Start new candle
      currentCandles.set(asset, {
        asset,
        timestamp: candleTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
      });
      lastCandleTimes.set(asset, candleTime);

      return completedCandle;
    }
  }

  // Update current candle
  let candle = currentCandles.get(asset);
  if (!candle || candle.timestamp !== candleTime) {
    candle = {
      asset,
      timestamp: candleTime,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: 0,
    };
    currentCandles.set(asset, candle);
    lastCandleTimes.set(asset, candleTime);
  } else {
    candle.high = Math.max(candle.high || tick.price, tick.price);
    candle.low = Math.min(candle.low || tick.price, tick.price);
    candle.close = tick.price;
  }

  return null;
}

/**
 * Calculate signal proximity for Pullback Window Strategy
 */
function calculateSignalProximity(
  strategy: PullbackWindowStrategy,
  indicators: Record<string, number>,
  asset: string,
  candle: Candle
): {
  direction: 'call' | 'put' | 'neutral';
  proximity: number;
  criteria: Array<{
    name: string;
    current: number;
    target: number;
    unit: string;
    passed: boolean;
    distance: number;
  }>;
  readyToSignal: boolean;
  missingCriteria?: string[];
} | null {
  const ema1 = indicators.ema1 as number;
  const ema14 = indicators.ema14 as number;
  const ema18 = indicators.ema18 as number;
  const ema24 = indicators.ema24 as number;
  const adx = indicators.adx as number;

  if (
    typeof ema1 !== 'number' ||
    typeof ema14 !== 'number' ||
    typeof ema18 !== 'number' ||
    typeof ema24 !== 'number' ||
    typeof adx !== 'number'
  ) {
    return null;
  }

  const state = strategy.getState();
  const phase = state.phase;

  // Get params for ADX threshold
  const params = getParamsForAsset(asset);
  const minAdx = params.minAdx;

  // Determine direction based on phase
  let direction: 'call' | 'put' | 'neutral' = 'neutral';
  if (state.direction === 'LONG') direction = 'call';
  else if (state.direction === 'SHORT') direction = 'put';

  const criteria: Array<{
    name: string;
    current: number;
    target: number;
    unit: string;
    passed: boolean;
    distance: number;
  }> = [];

  // Phase-specific proximity calculation
  if (phase === 'SCANNING') {
    // Looking for EMA crossover
    // For LONG: EMA1 should be above EMA14, EMA18, EMA24
    // For SHORT: EMA1 should be below EMA14, EMA18, EMA24

    const longSetup = ema1 > ema14 && ema1 > ema18 && ema1 > ema24;
    const shortSetup = ema1 < ema14 && ema1 < ema18 && ema1 < ema24;

    if (longSetup) {
      direction = 'call';
      criteria.push({
        name: 'EMA Crossover',
        current: 1,
        target: 1,
        unit: 'setup',
        passed: true,
        distance: 0,
      });
    } else if (shortSetup) {
      direction = 'put';
      criteria.push({
        name: 'EMA Crossover',
        current: 1,
        target: 1,
        unit: 'setup',
        passed: true,
        distance: 0,
      });
    } else {
      criteria.push({
        name: 'EMA Crossover',
        current: 0,
        target: 1,
        unit: 'setup',
        passed: false,
        distance: 1,
      });
    }

    // ADX strength check
    criteria.push({
      name: 'ADX Strength',
      current: adx,
      target: minAdx,
      unit: 'value',
      passed: adx >= minAdx,
      distance: Math.max(0, minAdx - adx),
    });

    const proximity = criteria.filter(c => c.passed).length / criteria.length;
    const readyToSignal = false; // SCANNING phase never generates signals directly

    return {
      direction,
      proximity,
      criteria,
      readyToSignal,
      missingCriteria: criteria.filter(c => !c.passed).map(c => c.name),
    };
  } else if (phase === 'ARMED' || phase === 'WINDOW_OPEN') {
    // In ARMED or WINDOW_OPEN, we're waiting for specific conditions
    // Show current phase status

    criteria.push({
      name: 'Phase',
      current: phase === 'ARMED' ? 2 : 3,
      target: 4,
      unit: 'phase',
      passed: phase === 'WINDOW_OPEN',
      distance: phase === 'ARMED' ? 2 : 1,
    });

    // Pullback count
    criteria.push({
      name: 'Pullback Candles',
      current: state.pullbackCount,
      target: params.minPullbackCandles,
      unit: 'candles',
      passed: state.pullbackCount >= params.minPullbackCandles,
      distance: Math.max(0, params.minPullbackCandles - state.pullbackCount),
    });

    // ADX strength check
    criteria.push({
      name: 'ADX Strength',
      current: adx,
      target: minAdx,
      unit: 'value',
      passed: adx >= minAdx,
      distance: Math.max(0, minAdx - adx),
    });

    // Breakout level (if window is open)
    if (phase === 'WINDOW_OPEN' && state.breakoutLevel !== null) {
      const price = candle.close;
      const targetPrice = state.breakoutLevel;
      const distanceToBreakout = state.direction === 'LONG'
        ? targetPrice - price
        : price - targetPrice;

      criteria.push({
        name: 'Breakout',
        current: price,
        target: targetPrice,
        unit: 'price',
        passed: distanceToBreakout <= 0,
        distance: Math.max(0, distanceToBreakout),
      });
    }

    const proximity = criteria.filter(c => c.passed).length / criteria.length;
    const readyToSignal = phase === 'WINDOW_OPEN' && state.breakoutLevel !== null;

    return {
      direction,
      proximity,
      criteria,
      readyToSignal,
      missingCriteria: criteria.filter(c => !c.passed).map(c => c.name),
    };
  } else if (phase === 'ENTRY') {
    // Signal was generated, show as ready
    criteria.push({
      name: 'Entry Signal',
      current: 1,
      target: 1,
      unit: 'signal',
      passed: true,
      distance: 0,
    });

    return {
      direction,
      proximity: 1,
      criteria,
      readyToSignal: true,
      missingCriteria: [],
    };
  }

  return null;
}

/**
 * Process strategy signal with trade locks to prevent race conditions
 * CRITICAL: Follows pattern from CLAUDE.md to prevent duplicate trades
 */
async function processStrategySignal(signal: Signal | null, asset: string) {
  if (!signal) return;

  // 1. Skip during initialization
  if (isInitializing || !hasReceivedRealtimeCandle) {
    console.log(`\n⏸️  Signal ignored during initialization`);
    return;
  }

  // 2. CRITICAL: Check position limits BEFORE processing
  const canOpen = tradeManager.canOpenTrade(asset);
  if (!canOpen.allowed) {
    console.log(`\n❌ Signal rejected for ${asset}: ${canOpen.reason}`);
    return;
  }

  // 3. CRITICAL: Acquire trade lock to prevent race conditions
  if (!tradeManager.acquireTradeLock(asset)) {
    console.log(`\n❌ Signal rejected for ${asset}: Trade already in progress`);
    return;
  }

  // Extract price from metadata
  const metadata = signal.metadata as { price?: number } | undefined;
  const price = metadata?.price ?? 0;

  console.log(`\n🎯 Signal generated for ${asset}:`);
  console.log(`   Direction: ${signal.direction}`);
  console.log(`   Price: $${price.toFixed(2)}`);
  console.log(`   Reason: ${signal.reason}`);

  // 4. Execute trade in try/finally block
  try {
    await tradeExecutionService.executeTrade(signal);
  } catch (error) {
    console.error(`❌ Error executing trade: ${error}`);
  } finally {
    // 5. CRITICAL: ALWAYS release lock after execution
    tradeManager.releaseTradeLock(asset);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log(`🎯 ${STRATEGY_NAME} - STATE MACHINE SCALPING FOR GOLD/SILVER`);
  console.log('='.repeat(80));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Preset: ${PRESET} (academic paper baseline)`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (M5 / 5min)`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Strategy Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
  console.log(`   Total Account Balance: $${INITIAL_BALANCE.toFixed(2)}`);
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
    enableLogging: true,
  });

  // Create trade adapter
  const adapter = new UnifiedTradeAdapter(gatewayClient, TRADE_MODE);

  // Initialize TradeManager
  tradeManager = new TradeManager(gatewayClient, adapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 120 * 60 * 1000, // 120 min max (forex can trend longer)
      extremeMaxDuration: 240 * 60 * 1000,
      minTradeDuration: 60 * 1000,
      earlyExitTpPct: 0.70, // Exit at 70% TP for quick profits
    },
    trailingStop: {
      activationThreshold: 0.30, // Activate at 30% profit
      buffer: 0.002, // 0.2% buffer
    },
    risk: {
      maxOpenTrades: 2, // Max 2 positions (1 Gold, 1 Silver)
      maxTradesPerSymbol: MAX_TRADES_PER_SYMBOL,
      riskPercentageCFD: RISK_PERCENTAGE_CFD,
      riskPercentageBinary: RISK_PERCENTAGE_BINARY,
      minStake: 1.0,
      maxStakePercentage: 0.10,
    },
  });

  console.log(`✅ TradeManager initialized\n`);

  // Initialize TradeExecutionService
  const firstSymbol = SYMBOLS[0]!;
  const firstParams = getParamsForAsset(firstSymbol);

  tradeExecutionService = new TradeExecutionService(
    gatewayClient,
    adapter,
    tradeManager,
    {
      mode: TRADE_MODE,
      strategyName: STRATEGY_NAME,
      binaryDuration: 1,
      cfdTakeProfitPct: firstParams.tpAtrMultiplier * 0.01, // Convert ATR multiplier to %
      cfdStopLossPct: firstParams.slAtrMultiplier * 0.01,
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        'frxXAUUSD': 100,  // Gold - AGGRESSIVE (was 50x)
        'frxXAGUSD': 100,  // Silver - AGGRESSIVE
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

  // Start heartbeat
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore heartbeat errors
    }
  }, 30000);

  // Load historical candles for warm-up
  console.log(`📥 Loading historical candles for ${SYMBOLS.length} asset(s)...\n`);

  const CANDLES_NEEDED = 100; // More than needed for EMA24 + buffer

  let totalHistoricalCandles = 0;

  for (const symbol of SYMBOLS) {
    try {
      // Load M5 candles (300s)
      const candles = await gatewayClient.getCandles(symbol, TIMEFRAME, CANDLES_NEEDED);
      console.log(`   ✅ ${symbol}: ${candles.length} x M5 candles`);

      // Store candles in history
      candleHistory.set(symbol, candles);
      warmUpCandlesPerAsset.set(symbol, candles.length);

      // Initialize FastBacktester for indicator calculation
      const backtester = new FastBacktester(candles, ['ema', 'atr', 'adx'], {
        emaPeriods: [1, 14, 18, 24], // All EMAs needed for strategy
        atrPeriod: 14,
        adxPeriod: 14,
      });
      backtesters.set(symbol, backtester);

      // Initialize strategy instance with explicit preset
      const presetParams = getPreset(PRESET as 'paper_m5' | 'gold_m5_opt' | 'default');
      const strategy = new PullbackWindowStrategy(symbol, presetParams);
      strategies.set(symbol, strategy);

      totalHistoricalCandles += candles.length;

      if (candles.length >= WARM_UP_CANDLES_REQUIRED) {
        console.log(`   ✅ ${symbol}: Ready for trading! (${candles.length} candles loaded)`);
      } else {
        console.log(`   ⚠️  ${symbol}: Need ${WARM_UP_CANDLES_REQUIRED - candles.length} more candles`);
      }
    } catch (error: any) {
      console.log(`   ⚠️  ${symbol}: Could not load historical candles: ${error.message}`);
      candleHistory.set(symbol, []);
      warmUpCandlesPerAsset.set(symbol, 0);
    }
  }

  console.log(`\n✅ Historical data loaded (${totalHistoricalCandles} candles total)\n`);
  console.log('📊 Warm-up status:');
  SYMBOLS.forEach(symbol => {
    const count = warmUpCandlesPerAsset.get(symbol) || 0;
    const status = count >= WARM_UP_CANDLES_REQUIRED ? '✅' : '⏳';
    const remaining = Math.max(0, WARM_UP_CANDLES_REQUIRED - count);
    console.log(`   ${status} ${symbol}: ${count}/${WARM_UP_CANDLES_REQUIRED}${remaining > 0 ? ` (need ${remaining} more)` : ' - READY!'}`);
  });
  console.log();

  // Mark as ready if we have enough candles
  const allReady = SYMBOLS.every(symbol => {
    const count = warmUpCandlesPerAsset.get(symbol) || 0;
    return count >= WARM_UP_CANDLES_REQUIRED;
  });

  if (allReady) {
    isInitializing = false;
    hasReceivedRealtimeCandle = true;
    console.log('🚀 Strategy is READY and will start trading immediately!\n');
  } else {
    console.log('⏳ Strategy will start trading after receiving remaining candles...\n');
  }

  // Subscribe to ticks
  console.log(`📡 Subscribing to ticks for: ${SYMBOLS.join(', ')}`);
  await gatewayClient.follow(SYMBOLS);
  console.log(`✅ Subscribed\n`);

  // Signal proximity check - publish every 10 seconds
  console.log(`📡 Starting signal proximity publisher (every ${PROXIMITY_CHECK_INTERVAL/1000}s)`);

  const publishProximities = async () => {
    const isConnected = gatewayClient.isConnected();
    if (!isConnected) {
      console.log(`[Proximity] Skipping - Gateway not connected`);
      return;
    }

    for (const asset of SYMBOLS) {
      const history = candleHistory.get(asset) || [];
      if (history.length < WARM_UP_CANDLES_REQUIRED) {
        console.log(`[Proximity] ${asset}: Not enough candles (${history.length}/${WARM_UP_CANDLES_REQUIRED})`);
        continue;
      }

      const backtester = backtesters.get(asset);
      const strategy = strategies.get(asset);
      if (!backtester || !strategy) {
        console.log(`[Proximity] ${asset}: Not initialized`);
        continue;
      }

      try {
        // Recreate backtester with current history
        const currentBacktester = new FastBacktester(history, ['ema', 'atr', 'adx'], {
          emaPeriods: [1, 14, 18, 24],
          atrPeriod: 14,
          adxPeriod: 14,
        });
        backtesters.set(asset, currentBacktester);

        // Get indicators for last candle
        const rawIndicators = currentBacktester.getIndicatorSnapshot(history.length - 1);
        // Filter to only numeric indicators
        const indicators: Record<string, number> = {};
        for (const [key, value] of Object.entries(rawIndicators)) {
          if (typeof value === 'number') {
            indicators[key] = value;
          }
        }

        const latestCandle = history[history.length - 1];
        if (!latestCandle) {
          console.log(`[Proximity] ${asset}: No latest candle`);
          continue;
        }

        // Debug: Log indicator values and phase
        const { ema1, ema14, ema18, ema24, atr, adx } = indicators;
        const state = strategy.getState();
        console.log(`[Proximity] ${asset}: Phase=${state.phase}, EMA1=${ema1?.toFixed(2)}, EMA14=${ema14?.toFixed(2)}, ADX=${adx?.toFixed(1)}, ATR=${atr?.toFixed(2)}, Candles=${history.length}`);

        const proximityData = calculateSignalProximity(strategy, indicators, asset, latestCandle);
        if (proximityData) {
          await gatewayClient.publishSignalProximity({
            strategy: STRATEGY_NAME,
            asset,
            direction: proximityData.direction,
            overallProximity: proximityData.proximity,
            criteria: proximityData.criteria,
            readyToSignal: proximityData.readyToSignal,
            missingCriteria: proximityData.missingCriteria || [],
          });
          console.log(`[Proximity] ${asset}: → ${proximityData.direction} ${(proximityData.proximity * 100).toFixed(0)}%`);
        } else {
          console.log(`[Proximity] ${asset}: No proximity data`);
        }
      } catch (error: any) {
        console.error(`[Proximity] ${asset} Error:`, error?.message || error);
      }
    }
  };

  // Publish immediately
  console.log(`[Proximity] Initial publish...`);
  publishProximities().catch(err => console.error(`[Proximity] Initial error:`, err));

  // Then every 10 seconds
  setInterval(() => {
    publishProximities().catch(err => console.error(`[Proximity] Interval error:`, err));
  }, PROXIMITY_CHECK_INTERVAL);

  // Track tick count
  let tickCount = 0;
  let lastTickLog = Date.now();

  // Process ticks and generate signals
  gatewayClient.on('tick', async (tick: Tick) => {
    // Filter: only process ticks for configured symbols
    if (!SYMBOLS.includes(tick.asset)) return;

    try {
      tickCount++;
      const now = Date.now();
      if (now - lastTickLog > 30000) {
        console.log(`[Ticks] Received ${tickCount} ticks in last 30s for ${tick.asset}`);
        tickCount = 0;
        lastTickLog = now;
      }

      const candle = processTick(tick);
      if (!candle) return;

      const asset = candle.asset;
      const history = candleHistory.get(asset) || [];

      console.log(`[Candle] ${asset} completed: O=${candle.open.toFixed(4)} H=${candle.high.toFixed(4)} L=${candle.low.toFixed(4)} C=${candle.close.toFixed(4)}, History=${history.length}`);

      // Check warm-up
      const warmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
      if (warmUpCount < WARM_UP_CANDLES_REQUIRED) {
        warmUpCandlesPerAsset.set(asset, warmUpCount + 1);
        if (warmUpCount + 1 === WARM_UP_CANDLES_REQUIRED) {
          console.log(`✅ ${asset}: Warm-up complete (${WARM_UP_CANDLES_REQUIRED} candles)`);
          hasReceivedRealtimeCandle = true;
          isInitializing = false;
        }
        return;
      }

      if (history.length < WARM_UP_CANDLES_REQUIRED) {
        return;
      }

      // Recreate backtester with new candle
      const backtester = new FastBacktester(history, ['ema', 'atr', 'adx'], {
        emaPeriods: [1, 14, 18, 24],
        atrPeriod: 14,
        adxPeriod: 14,
      });
      backtesters.set(asset, backtester);

      // Get indicators
      const rawIndicators = backtester.getIndicatorSnapshot(history.length - 1);
      // Filter to only numeric indicators
      const indicators: Record<string, number> = {};
      for (const [key, value] of Object.entries(rawIndicators)) {
        if (typeof value === 'number') {
          indicators[key] = value;
        }
      }

      // Get strategy instance
      const strategy = strategies.get(asset);
      if (!strategy) {
        console.error(`❌ No strategy for ${asset}`);
        return;
      }

      // Evaluate entry signal
      const signal = strategy.evaluateEntry(history, history.length - 1, indicators);

      // Debug: Log state and indicators
      const state = strategy.getState();
      const { ema1, ema14, ema18, ema24, atr, adx } = indicators;
      console.log(`[${asset}] Phase: ${state.phase}, EMA1: ${ema1?.toFixed(2)}, EMA14: ${ema14?.toFixed(2)}, EMA18: ${ema18?.toFixed(2)}, EMA24: ${ema24?.toFixed(2)}, ATR: ${atr?.toFixed(2)}, ADX: ${adx?.toFixed(1)}`);

      // Process signal
      if (signal) {
        await processStrategySignal(signal, asset);
      }
    } catch (error) {
      console.error(`❌ Error processing tick: ${error}`);
    }
  });

  // Handle trade results
  gatewayClient.on('trade:result', async (result: any) => {
    if (processedTradeResults.has(result.contractId)) return;
    processedTradeResults.add(result.contractId);

    totalTrades++;
    if (result.profit > 0) {
      wonTrades++;
    } else {
      lostTrades++;
    }

    const winRate = totalTrades > 0 ? (wonTrades / totalTrades) * 100 : 0;
    console.log(`\n📊 Trade Result:`);
    console.log(`   ${result.profit > 0 ? '✅ WIN' : '❌ LOSS'}: $${result.profit.toFixed(2)}`);
    console.log(`   Total: ${totalTrades} | Wins: ${wonTrades} | Losses: ${lostTrades} | WR: ${winRate.toFixed(1)}%`);
  });

  console.log('🚀 Pullback Window Strategy is running...\n');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
