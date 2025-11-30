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

import { GatewayClient, loadEnvFromRoot, getTelegramAlerter } from '@deriv-bot/shared';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { ETH_OPTIMIZED_PRESET, BTC_OPTIMIZED_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';
import dotenv from 'dotenv';

// Load environment variables from project root
loadEnvFromRoot();
dotenv.config();

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
const WARM_UP_CANDLES_REQUIRED = 50; // Need 50 candles for indicators
const processedTradeResults = new Set<string>();

// Trade Manager instance
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let strategyAccountant: StrategyAccountant;

// Telegram Alerter
const telegramAlerter = getTelegramAlerter({ serviceName: STRATEGY_NAME });

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
  
  return {
    tpPct: preset.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
    slPct: preset.baseStopLossPct ?? 0.2,
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

  console.log(`✅ TradeExecutionService initialized\n`);

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

  // Process ticks and generate signals
  gatewayClient.on('tick', async (tick: Tick) => {
    try {
      const candle = processTick(tick);
      if (!candle) return;

      const asset = candle.asset;
      const history = candleHistory.get(asset) || [];
      
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

      // Get entry function (should already be initialized with historical data)
      const entryFn = entryFunctions.get(asset);
      if (!entryFn) {
        continue; // Not initialized yet, skip
      }
      
      // Check if we have enough candles
      if (history.length < WARM_UP_CANDLES_REQUIRED) {
        continue; // Still need more candles
      }
      
      // Get FastBacktester for this asset
      let backtester = backtesters.get(asset);
      
      // Update backtester with new candle (recreate every 10 candles for efficiency)
      // FastBacktester pre-calculates all indicators, so we recreate periodically
      if (!backtester || history.length > backtester.length + 10) {
        backtester = new FastBacktester(history, ['rsi', 'atr', 'adx', 'bb'], {
          rsiPeriod: 14,
          atrPeriod: 14,
          adxPeriod: 14,
          bbPeriod: 20,
          bbStdDev: 2,
        });
        backtesters.set(asset, backtester);
        
        // Recreate entry function with updated candles
        const preset = getPresetForAsset(asset);
        const newEntryFn = createCryptoScalpV2EntryFn(history, preset, { enableMTF: true });
        entryFunctions.set(asset, newEntryFn);
      }
      
      // Get indicators snapshot from FastBacktester
      const indicators = backtester.getIndicatorSnapshot(history.length - 1);

      // Check for entry signal
      const signal = entryFn(history.length - 1, indicators);
      
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
            await tradeExecutionService.executeSignal(signalObj);
          } catch (error) {
            console.error(`❌ Error executing trade: ${error}`);
          }
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

