/**
 * CryptoScalp v2 Optimized - Live Trading Script
 * 
 * Deploy de la estrategia CryptoScalp v2 con presets optimizados:
 * - ETH: ETH_OPTIMIZED_PRESET (MTF + Zombie + BB Exit)
 * - BTC: BTC_OPTIMIZED_PRESET (MTF + Zombie)
 * 
 * Backtest Results:
 * - ETH: $10,949 net PnL, 1.43 PF, 50% WR
 * - BTC: $3,847 net PnL, 1.27 PF, 51% WR
 */

import { GatewayClient, loadEnvFromRoot, TelegramAlerter } from '@deriv-bot/shared';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { ETH_OPTIMIZED_PRESET, BTC_OPTIMIZED_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables from project root
loadEnvFromRoot();

// Configuration
const STRATEGY_NAME = 'CRYPTOSCALP-V2';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
const SYMBOL_STR = process.env.SYMBOL || 'cryETHUSD';
const SYMBOLS = SYMBOL_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');

// Risk parameters
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.03'); // 3% for crypto
const RISK_PERCENTAGE_BINARY = 0.01; // 1% for binary
const MAX_TRADES_PER_SYMBOL = 1;

// Tick processing state
const TIMEFRAME = 60; // 1 minute
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();
const candleHistory = new Map<string, Candle[]>();

// State
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true;
const warmUpCandlesPerAsset = new Map<string, number>();
let hasReceivedRealtimeCandle = false;
const WARM_UP_CANDLES_REQUIRED = 30; // Need 30 candles for indicators (reduced for crypto availability)

// Signal proximity calculation interval (every 10 seconds)
const PROXIMITY_CHECK_INTERVAL = 10000;

/**
 * Calculate signal proximity for CryptoScalp v2
 */
function calculateSignalProximity(
  indicators: Record<string, number | boolean>,
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
  const rsi = indicators.rsi as number;
  const adx = indicators.adx as number;
  const plusDI = indicators.plusDI as number;
  const minusDI = indicators.minusDI as number;
  const bbUpper = indicators.bbUpper as number;
  const bbMiddle = indicators.bbMiddle as number;
  const bbLower = indicators.bbLower as number;
  const price = candle.close;

  if (
    typeof rsi !== 'number' ||
    typeof adx !== 'number' ||
    typeof plusDI !== 'number' ||
    typeof minusDI !== 'number' ||
    typeof bbUpper !== 'number' ||
    typeof bbMiddle !== 'number' ||
    typeof bbLower !== 'number'
  ) {
    return null;
  }

  const preset = getPresetForAsset(asset);
  
  // Calculate proximity for CALL (long) signals
  const callCriteria: Array<{
    name: string;
    current: number;
    target: number;
    unit: string;
    passed: boolean;
    distance: number;
  }> = [];
  
  // RSI should be oversold (< 30) for CALL
  const rsiTarget = 30;
  const rsiDistance = Math.max(0, rsi - rsiTarget) / (100 - rsiTarget); // 0-1, 0 = at target
  callCriteria.push({
    name: 'RSI',
    current: rsi,
    target: rsiTarget,
    unit: '',
    passed: rsi < rsiTarget,
    distance: rsiDistance,
  });

  // Price should be near BB Lower for CALL
  const bbLowerDistance = Math.max(0, price - bbLower) / (bbUpper - bbLower);
  callCriteria.push({
    name: 'BB Lower',
    current: price,
    target: bbLower,
    unit: '',
    passed: price <= bbLower * 1.001, // Within 0.1% of lower band
    distance: bbLowerDistance,
  });

  // ADX should indicate trend strength (> 20)
  const adxTarget = 20;
  const adxDistance = Math.max(0, adxTarget - adx) / adxTarget;
  callCriteria.push({
    name: 'ADX',
    current: adx,
    target: adxTarget,
    unit: '',
    passed: adx > adxTarget,
    distance: adxDistance,
  });

  // Calculate proximity for PUT (short) signals
  const putCriteria: Array<{
    name: string;
    current: number;
    target: number;
    unit: string;
    passed: boolean;
    distance: number;
  }> = [];
  
  // RSI should be overbought (> 70) for PUT
  const rsiTargetPut = 70;
  const rsiDistancePut = Math.max(0, rsiTargetPut - rsi) / rsiTargetPut;
  putCriteria.push({
    name: 'RSI',
    current: rsi,
    target: rsiTargetPut,
    unit: '',
    passed: rsi > rsiTargetPut,
    distance: rsiDistancePut,
  });

  // Price should be near BB Upper for PUT
  const bbUpperDistance = Math.max(0, bbUpper - price) / (bbUpper - bbLower);
  putCriteria.push({
    name: 'BB Upper',
    current: price,
    target: bbUpper,
    unit: '',
    passed: price >= bbUpper * 0.999, // Within 0.1% of upper band
    distance: bbUpperDistance,
  });

  // ADX should indicate trend strength (> 20)
  putCriteria.push({
    name: 'ADX',
    current: adx,
    target: adxTarget,
    unit: '',
    passed: adx > adxTarget,
    distance: adxDistance,
  });

  // Calculate overall proximity (0-100%)
  const callProximity = Math.max(0, Math.min(100, (1 - callCriteria.reduce((sum, c) => sum + c.distance, 0) / callCriteria.length) * 100));
  const putProximity = Math.max(0, Math.min(100, (1 - putCriteria.reduce((sum, c) => sum + c.distance, 0) / putCriteria.length) * 100));

  // Determine direction and proximity
  let direction: 'call' | 'put' | 'neutral';
  let proximity: number;
  let criteria: typeof callCriteria;
  let readyToSignal: boolean;
  let missingCriteria: string[] = [];

  if (callProximity > putProximity && callProximity > 30) {
    direction = 'call';
    proximity = callProximity;
    criteria = callCriteria;
    readyToSignal = callCriteria.every(c => c.passed);
    missingCriteria = callCriteria.filter(c => !c.passed).map(c => c.name);
  } else if (putProximity > callProximity && putProximity > 30) {
    direction = 'put';
    proximity = putProximity;
    criteria = putCriteria;
    readyToSignal = putCriteria.every(c => c.passed);
    missingCriteria = putCriteria.filter(c => !c.passed).map(c => c.name);
  } else {
    direction = 'neutral';
    proximity = Math.max(callProximity, putProximity);
    criteria = callProximity > putProximity ? callCriteria : putCriteria;
    readyToSignal = false;
    missingCriteria = criteria.filter(c => !c.passed).map(c => c.name);
  }

  return {
    direction,
    proximity,
    criteria,
    readyToSignal,
    missingCriteria: missingCriteria.length > 0 ? missingCriteria : undefined,
  };
}
const processedTradeResults = new Set<string>();

// Trade Manager instance
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let strategyAccountant: StrategyAccountant;

// Telegram Alerter (created after loadEnvFromRoot to ensure env vars are loaded)
const telegramAlerter = new TelegramAlerter({ serviceName: STRATEGY_NAME });

// Entry functions per asset
const entryFunctions = new Map<string, (index: number, indicators: Record<string, number | boolean>) => any>();

// FastBacktester instances per asset (for indicator calculation)
const backtesters = new Map<string, FastBacktester>();

/**
 * Process tick and build candle (per asset)
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
      const candle = completedCandle as Candle;
      
      // Add to history
      const history = candleHistory.get(asset) || [];
      history.push(candle);
      if (history.length > 200) {
        history.shift(); // Keep last 200 candles
      }
      candleHistory.set(asset, history);
      
      return candle;
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
 * Get preset for asset
 */
function getPresetForAsset(asset: string) {
  if (asset.includes('ETH')) {
    return ETH_OPTIMIZED_PRESET;
  } else if (asset.includes('BTC')) {
    return BTC_OPTIMIZED_PRESET;
  }
  // Default to ETH preset
  return ETH_OPTIMIZED_PRESET;
}

/**
 * Get optimized config for asset
 */
function getOptimizedConfig(asset: string) {
  const preset = getPresetForAsset(asset);
  const isETH = asset.includes('ETH');

  // NOTE: preset values are in "human-readable" percentages (0.5 = 0.5%, not 50%)
  // but TradeExecutionService expects decimals (0.005 = 0.5%)
  // So we need to divide by 100 to convert
  const rawTp = preset.takeProfitLevels?.[0]?.profitPercent ?? 0.5;
  const rawSl = preset.baseStopLossPct ?? 0.2;

  return {
    tpPct: rawTp / 100, // 0.5 -> 0.005 (0.5%)
    slPct: rawSl / 100, // 0.2 -> 0.002 (0.2%)
    cooldown: preset.cooldownBars ?? 20,
    maxBarsInTrade: preset.maxBarsInTrade ?? 60,
    zombieKiller: isETH
      ? { enabled: true, bars: 15, minPnlPct: 0.05, onlyIfReversing: true }
      : { enabled: true, bars: 15, minPnlPct: 0.1 },
    exitOnBBUpper: isETH, // Only for ETH
    exitOnBBLower: isETH, // Only for ETH
    bbUpperLowerMinPnl: 0.05,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`🎯 ${STRATEGY_NAME} - OPTIMIZED CRYPTO SCALPING`);
  console.log('='.repeat(80));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
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
      riskPercentageBinary: RISK_PERCENTAGE_BINARY,
      minStake: 1.0,
      maxStakePercentage: 0.10,
    },
  });

  console.log(`✅ TradeManager initialized\n`);

  // Initialize FastBacktester instances for each asset (for indicator calculation)
  // These will be populated with historical candles
  console.log(`✅ FastBacktester instances will be initialized with historical data`);
  console.log();

  // Initialize TradeExecutionService
  const firstSymbol = SYMBOLS[0]!;
  const firstConfig = getOptimizedConfig(firstSymbol);
  
  tradeExecutionService = new TradeExecutionService(
    gatewayClient,
    adapter,
    tradeManager,
    {
      mode: TRADE_MODE,
      strategyName: STRATEGY_NAME,
      binaryDuration: 1,
      cfdTakeProfitPct: firstConfig.tpPct,
      cfdStopLossPct: firstConfig.slPct,
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        'cryETHUSD': 100,
        'cryBTCUSD': 100,
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
  
  // Need 1m candles for indicators (50+ for RSI, BB, etc.)
  // Need 15m candles for MTF Filter (EMA 50 needs ~50 candles = 50*15 = 750 minutes = ~12.5 hours)
  const CANDLES_1M_NEEDED = 100; // More than needed for safety
  const CANDLES_15M_NEEDED = 60; // For MTF EMA 50
  
  let totalHistoricalCandles = 0;
  
  for (const symbol of SYMBOLS) {
    try {
      // Load 1m candles (for main strategy)
      const candles1m = await gatewayClient.getCandles(symbol, 60, CANDLES_1M_NEEDED);
      console.log(`   ✅ ${symbol}: ${candles1m.length} x 1m candles`);
      
      // Load 15m candles (for MTF Filter)
      const candles15m = await gatewayClient.getCandles(symbol, 900, CANDLES_15M_NEEDED);
      console.log(`   ✅ ${symbol}: ${candles15m.length} x 15m candles`);
      
      // Store 1m candles in history
      candleHistory.set(symbol, candles1m);
      warmUpCandlesPerAsset.set(symbol, candles1m.length);
      
      // Initialize FastBacktester for indicator calculation
      const backtester = new FastBacktester(candles1m, ['rsi', 'atr', 'adx', 'bb'], {
        rsiPeriod: 14,
        atrPeriod: 14,
        adxPeriod: 14,
        bbPeriod: 20,
        bbStdDev: 2,
      });
      backtesters.set(symbol, backtester);
      
      // Initialize entry function with historical data
      const preset = getPresetForAsset(symbol);
      const entryFn = createCryptoScalpV2EntryFn(candles1m, preset, { enableMTF: true });
      entryFunctions.set(symbol, entryFn);
      
      totalHistoricalCandles += candles1m.length;
      
      if (candles1m.length >= WARM_UP_CANDLES_REQUIRED) {
        console.log(`   ✅ ${symbol}: Ready for trading! (${candles1m.length} x 1m candles loaded)`);
      } else {
        console.log(`   ⚠️  ${symbol}: Need ${WARM_UP_CANDLES_REQUIRED - candles1m.length} more 1m candles`);
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

  // Signal proximity check - publish every 10 seconds (independent of candle completion)
  console.log(`📡 Starting signal proximity publisher (every ${PROXIMITY_CHECK_INTERVAL/1000}s)`);

  // Use a regular function to publish proximities
  const publishProximities = async () => {
    // Check connection first
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

      // Get or create backtester for indicators
      const backtester = backtesters.get(asset);
      if (!backtester) {
        console.log(`[Proximity] ${asset}: No backtester initialized`);
        continue;
      }

      try {
        // CRITICAL FIX: Always recreate backtester to ensure indicators are current
        // The backtester pre-calculates all indicators for its candles array
        // When new candles arrive, we must recalculate to get updated indicator values
        const currentBacktester = new FastBacktester(history, ['rsi', 'atr', 'adx', 'bb'], {
          rsiPeriod: 14,
          atrPeriod: 14,
          adxPeriod: 14,
          bbPeriod: 20,
          bbStdDev: 2,
        });
        backtesters.set(asset, currentBacktester);

        // Get latest indicators for the last candle
        const indicators = currentBacktester.getIndicatorSnapshot(history.length - 1);
        const latestCandle = history[history.length - 1];
        if (!latestCandle) {
          console.log(`[Proximity] ${asset}: No latest candle`);
          continue;
        }

        // Debug: Always log indicator values to verify they're updating
        const { rsi, adx, bbUpper, bbLower } = indicators as Record<string, number>;
        console.log(`[Proximity] ${asset}: RSI=${rsi?.toFixed(1)}, ADX=${adx?.toFixed(1)}, Price=${latestCandle.close.toFixed(2)}, BB=${bbLower?.toFixed(2)}-${bbUpper?.toFixed(2)}, Candles=${history.length}`);

        const proximityData = calculateSignalProximity(indicators, asset, latestCandle);
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
          console.log(`[Proximity] ${asset}: → ${proximityData.direction} ${proximityData.proximity.toFixed(0)}%`);
        } else {
          console.log(`[Proximity] ${asset}: No proximity data calculated`);
        }
      } catch (error: any) {
        // Log all errors for debugging
        console.error(`[Proximity] ${asset} Error:`, error?.message || error);
      }
    }
  };

  // Publish immediately on startup
  console.log(`[Proximity] Initial publish...`);
  publishProximities().catch(err => console.error(`[Proximity] Initial error:`, err));

  // Then publish every 10 seconds
  setInterval(() => {
    publishProximities().catch(err => console.error(`[Proximity] Interval error:`, err));
  }, PROXIMITY_CHECK_INTERVAL);

  // Track tick count for debugging
  let tickCount = 0;
  let lastTickLog = Date.now();

  // Process ticks and generate signals
  gatewayClient.on('tick', async (tick: Tick) => {
    try {
      tickCount++;
      // Log tick receipt every 30 seconds
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

      // Log when candle completes
      console.log(`[Candle] ${asset} completed: O=${candle.open.toFixed(2)} H=${candle.high.toFixed(2)} L=${candle.low.toFixed(2)} C=${candle.close.toFixed(2)}, History=${history.length}`);
      
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

      // Check if we have enough candles
      if (history.length < WARM_UP_CANDLES_REQUIRED) {
        return; // Still need more candles
      }
      
      // Get FastBacktester for this asset
      let backtester = backtesters.get(asset);

      // CRITICAL FIX: Always recreate entry function when processing new candle
      // The entry function uses pre-calculated data (VWAP, volume, 15m trend) that must match
      // the current history size, otherwise index will be out of bounds
      backtester = new FastBacktester(history, ['rsi', 'atr', 'adx', 'bb'], {
        rsiPeriod: 14,
        atrPeriod: 14,
        adxPeriod: 14,
        bbPeriod: 20,
        bbStdDev: 2,
      });
      backtesters.set(asset, backtester);

      // Recreate entry function with updated candles for each new candle
      const preset = getPresetForAsset(asset);
      const updatedEntryFn = createCryptoScalpV2EntryFn(history, preset, { enableMTF: true });
      entryFunctions.set(asset, updatedEntryFn);

      // Get indicators snapshot from FastBacktester
      const indicators = backtester.getIndicatorSnapshot(history.length - 1);

      // Check for entry signal - use LAST index of the newly created entry function
      const signal = updatedEntryFn(history.length - 1, indicators);

      // Debug: Log indicator values on each candle
      const { rsi, adx, plusDI, minusDI, bbUpper, bbLower } = indicators as Record<string, number>;
      console.log(`[${asset}] Candle #${history.length} - RSI: ${rsi?.toFixed(1)}, ADX: ${adx?.toFixed(1)}, +DI: ${plusDI?.toFixed(1)}, -DI: ${minusDI?.toFixed(1)}, BB: ${bbLower?.toFixed(2)}-${bbUpper?.toFixed(2)}, Price: ${candle.close.toFixed(2)}`);

      if (signal) {
        const direction = signal.direction === 'CALL' ? 'CALL' : 'PUT';
        const signalObj: Signal = {
          asset,
          direction,
          confidence: 0.7,
          timestamp: candle.timestamp,
          price: signal.price || candle.close,
          reason: 'CryptoScalp v2 Entry',
        };

        console.log(`\n🎯 Signal generated for ${asset}:`);
        console.log(`   Direction: ${direction}`);
        console.log(`   Price: $${signalObj.price.toFixed(2)}`);
        console.log(`   Reason: ${signalObj.reason}`);

        // Execute trade
        try {
          await tradeExecutionService.executeTrade(signalObj);
        } catch (error) {
          console.error(`❌ Error executing trade: ${error}`);
        }
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

  console.log('🚀 CryptoScalp v2 Optimized is running...\n');
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
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

