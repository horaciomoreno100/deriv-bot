#!/usr/bin/env node
/**
 * RSI + Bollinger Bands Scalping Strategy - Demo
 *
 * Uses the Trade Adapter to switch between Binary Options and CFDs
 *
 * ✨ MEJORAS IMPLEMENTADAS:
 * 1. ⏰ Timer Periódico (30s) - Monitoreo SMART Exit independiente de ticks
 * 2. 📈 Trailing Stop Loss Dinámico - Activa al 20% del TP, buffer 0.1%
 * 3. 🎯 Límite por Símbolo - Máximo 1 trade por asset (diversificación)
 * 4. 🔌 API Integration - proposal(), sell(), cancel(), profitTable()
 * 5. 💰 Riesgo Dinámico - 1-2% del capital por trade
 */

import dotenv from 'dotenv';
import { GatewayClient, getOpenObserveLogger } from '@deriv-bot/shared';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import type { Candle, Tick, StrategyConfig, Signal } from '@deriv-bot/shared';
import { RSI } from 'technicalindicators';

// Load environment variables
dotenv.config();

// OpenObserve Logger (with service name for per-service streams)
const ooLogger = getOpenObserveLogger({ service: 'trader' });

// Configuration
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
// Support multiple assets: SYMBOL can be comma-separated (e.g., "R_75,R_100,R_50")
const SYMBOLS_STR = process.env.SYMBOL || 'R_10,R_25,R_50,R_75,R_100'; // Default: All volatility indices
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const TIMEFRAME = 60; // 1 minute
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'binary'; // 'binary' or 'cfd'
// NOTE: Account selection is now handled by the Gateway via DERIV_ACCOUNT environment variable
// You can still override per-trade by setting ACCOUNT_LOGINID, but it's recommended to configure it in the Gateway
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID; // Optional: override account per-trade (e.g., 'CR1234567', 'MF1234567')

// ========================================
// 🆕 MEJORA 3: Límite por Símbolo
// ========================================
// Máximo 1 trade abierto por símbolo (diversificación)
// Esto previene concentrar riesgo en un solo asset
const MAX_TRADES_PER_SYMBOL = 1;

// ========================================
// 🆕 MEJORA 5: Riesgo Dinámico por Trade
// ========================================
// El stake se calcula dinámicamente basado en el balance actual
// CFD: 1-2% del balance (ajustable con RISK_PERCENTAGE env var)
// Binary: 1% del balance
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% default para CFDs
const RISK_PERCENTAGE_BINARY = 0.01; // 1% fijo para binary options

// Note: multiplier logic moved to TradeExecutionService

// State
let balance = INITIAL_BALANCE;
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
let isInitializing = true; // Flag to prevent trades during historical data loading
const warmUpCandlesPerAsset = new Map<string, number>(); // Counter for warm-up period PER ASSET
let hasReceivedRealtimeCandle = false; // Flag to ensure we've received at least one real-time candle
const WARM_UP_CANDLES_REQUIRED = 50; // Minimum candles needed for indicators to stabilize (RSI=14, BB=20, ATR=14, so 50 is safe)

// Trade Manager instance (will be initialized in main)
let tradeManager: TradeManager;

// Trade Execution Service
let tradeExecutionService: TradeExecutionService;

// Candle buffers per asset
const candleBuffers = new Map<string, Candle[]>();
const currentCandles = new Map<string, Partial<Candle>>();
const lastCandleTimes = new Map<string, number>();

// Note: warmUpCandlesPerAsset will be initialized when loading historical candles

/**
 * Create strategy with RSI+BB parameters optimized for scalping
 */
function createStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'RSI-BB-Scalping-Demo',
    enabled: true,
    assets: SYMBOLS, // Multiple assets supported
    maxConcurrentTrades: SYMBOLS.length, // Allow one trade per asset
    amount: TRADE_MODE === 'cfd' ? 15 : 1, // 15% for CFDs, 1% for binary
    amountType: 'percentage',
    cooldownSeconds: 30, // 30 seconds cooldown
    minConfidence: 0.75,
    parameters: {
      // WIDER_SL_1 Optimized Configuration (60.74% WR, +43.83% return)
      // Using validated parameters from backtest
      rsiPeriod: 14,
      rsiOversold: 30,       // WIDER_SL_1 optimized (not relaxed)
      rsiOverbought: 70,     // WIDER_SL_1 optimized (not relaxed)
      bbPeriod: 20,
      bbStdDev: 2.0,
      takeProfitPct: 0.003,  // 0.3% TP (1:1 R:R)
      stopLossPct: 0.003,    // 0.3% SL (1:1 R:R)
      cooldownSeconds: 30,   // 30 seconds cooldown
      bbTouchPct: 0.05,      // 5% BB touch tolerance
      atrPeriod: 14,
      atrMultiplier: 1.0,
      cooldownMinutes: 0.5,  // 30 seconds
      expiryMinutes: TRADE_MODE === 'cfd' ? 1 : 1, // 1 minute for both
      maxWinStreak: 2,
      maxLossStreak: 3,
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Process tick and build candle (per asset)
 */
function processTick(tick: Tick): Candle | null {
  const asset = tick.asset;
  if (!SYMBOLS.includes(asset)) {
    return null; // Ignore assets not in our list
  }

  const tickTime = tick.timestamp; // Assume timestamp is in milliseconds
  // Calculate candle time in seconds (Candle.timestamp expects seconds)
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
      timeframe: TIMEFRAME, // Required field
      timestamp: candleTime, // Now in seconds
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
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 RSI + BOLLINGER BANDS SCALPING - DEMO');
  console.log('='.repeat(80));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (${TIMEFRAME / 60}min)`);
  console.log(`   Gateway: ${GATEWAY_URL}`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Warm-up: ${WARM_UP_CANDLES_REQUIRED} velas requeridas para estabilizar indicadores`);
  console.log();

  ooLogger.info('trader', 'RSI-BB-Scalping demo started', {
    symbols: SYMBOLS,
    timeframe: TIMEFRAME,
    tradeMode: TRADE_MODE,
    balance: INITIAL_BALANCE,
    gatewayUrl: GATEWAY_URL
  });
  console.log(`🆕 MEJORAS ACTIVAS:`);
  console.log(`   ⏰ Timer Periódico: Cada 30s (getPortfolio)`);
  console.log(`   📈 Trailing Stop: Configurado vía TradeManager`);
  console.log(`   🎯 Límite por Símbolo: Max ${MAX_TRADES_PER_SYMBOL} trade/asset`);
  console.log(`   🔌 API Integration: proposal(), sell(), cancel(), profitTable()`);
  console.log(`   💰 Riesgo Dinámico: ${TRADE_MODE === 'cfd' ? `${(RISK_PERCENTAGE_CFD * 100).toFixed(1)}%` : `${(RISK_PERCENTAGE_BINARY * 100).toFixed(1)}%`} del capital`);
  console.log();
  if (ACCOUNT_LOGINID) {
    console.log(`   Account Override: ${ACCOUNT_LOGINID} (per-trade override)`);
  } else {
    console.log(`   Account: Using Gateway default (configure via DERIV_ACCOUNT env var)`);
  }
  console.log();

  // Create Gateway client
  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: true,
    enableLogging: false,
  });

  // Create trade adapter
  const adapter = new UnifiedTradeAdapter(client, TRADE_MODE);

  // ========================================
  // 🆕 Initialize TradeManager
  // ========================================
  tradeManager = new TradeManager(client, adapter, SYMBOLS, {
    pollingInterval: 30000, // 30 seconds
    smartExit: {
      maxTradeDuration: 40 * 60 * 1000, // 40 minutes
      extremeMaxDuration: 120 * 60 * 1000, // 120 minutes
      minTradeDuration: 60 * 1000, // 1 minute
      earlyExitTpPct: 0.75, // 75% of TP
    },
    trailingStop: {
      activationThreshold: 0.20, // 20% of TP
      buffer: 0.001, // 0.1%
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

  console.log(`✅ TradeManager initialized with smart exit and trailing stop\n`);

  // Initialize TradeExecutionService
  tradeExecutionService = new TradeExecutionService(
    client,
    adapter,
    tradeManager,
    {
      mode: TRADE_MODE,
      strategyName: 'RSI-BB-Scalping',
      binaryDuration: 1,
      cfdTakeProfitPct: 0.003,   // 0.3% TP (scalping config)
      cfdStopLossPct: 0.0015,    // 0.15% SL (scalping config)
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        'R_10': 400,
        'R_25': 160,
        'R_50': 80,
        'R_75': 50,
        'R_100': 80,
      },
    }
  );

  console.log(`✅ TradeExecutionService initialized\n`);

  // Create strategy
  const strategy = createStrategy();
  const engine = new StrategyEngine();

  // Add strategy to engine
  engine.addStrategy(strategy);

  // Start the strategy
  await engine.startAll();
  console.log(`✅ Strategy "${strategy.getName()}" started\n`);

  // Listen for signals
  engine.on('signal', async (signal: Signal) => {
    // Ignore signals during initialization (historical data loading)
    if (isInitializing) {
      console.log(`\n⏸️  Señal ignorada durante inicialización (carga de datos históricos)`);
      console.log(`   Direction: ${signal.direction} | Asset: ${signal.symbol || signal.asset}`);
      console.log(`   Esperando a que termine la carga de datos históricos...\n`);
      return;
    }

    // Ignore signals until we've received at least one real-time candle
    // This prevents executing trades based on historical data
    if (!hasReceivedRealtimeCandle) {
      console.log(`\n⏸️  Señal ignorada - esperando primera vela en tiempo real`);
      console.log(`   Direction: ${signal.direction} | Asset: ${signal.symbol || signal.asset}`);
      console.log(`   Las señales basadas en datos históricos no se ejecutan.\n`);
      return;
    }

    const asset = (signal as any).asset || signal.symbol || SYMBOLS[0];

    // Ignore signals during warm-up period (indicator stabilization) - CHECK PER ASSET
    const assetWarmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
    if (assetWarmUpCount < WARM_UP_CANDLES_REQUIRED) {
      const remaining = WARM_UP_CANDLES_REQUIRED - assetWarmUpCount;
      console.log(`\n⏳ Señal ignorada durante warm-up de ${asset} (estabilización de indicadores)`);
      console.log(`   Direction: ${signal.direction} | Asset: ${asset}`);
      console.log(`   Velas procesadas: ${assetWarmUpCount}/${WARM_UP_CANDLES_REQUIRED} (faltan ${remaining})\n`);
      return;
    }

    // ========================================
    // 🆕 MEJORA 3: Risk checks usando TradeManager
    // ========================================
    const canTrade = tradeManager.canOpenTrade(asset);
    if (!canTrade.allowed) {
      console.log(`\n⚠️  SEÑAL IGNORADA - ${canTrade.reason}`);
      console.log(`   Direction: ${signal.direction} | Asset: ${asset}`);
      console.log(`   Esperando a que se libere capacidad antes de abrir nueva posición.\n`);
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 SEÑAL DETECTADA - EJECUTANDO TRADE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Reason: ${signal.metadata?.reason || 'N/A'}`);
    console.log(`   Asset: ${asset}`);
    console.log(`   Timestamp: ${new Date(signal.timestamp).toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);

    // Execute trade using TradeExecutionService
    const result = await tradeExecutionService.executeTrade(signal, SYMBOLS[0]);
    if (result.success) {
      totalTrades++;
      if (result.stake) {
        balance -= result.stake;
      }
      ooLogger.info('trader', 'Trade executed', {
        asset: signal.symbol || SYMBOLS[0],
        direction: signal.direction,
        stake: result.stake,
        contractId: result.contractId
      });
    } else {
      ooLogger.warn('trader', 'Trade failed', {
        asset: signal.symbol || SYMBOLS[0],
        direction: signal.direction,
        error: result.error
      });
    }
  });

  // Listen for errors
  engine.on('strategy:error', (error: Error) => {
    console.error(`❌ Strategy error:`, error);
    ooLogger.error('trader', 'Strategy error', { error: error.message });
  });

  // Connect to Gateway
  console.log('🔌 Connecting to Gateway...');
  await client.connect();
  console.log('✅ Connected to Gateway\n');

  // Get balance
  try {
    const balanceInfo = await client.getBalance();
    if (balanceInfo) {
      balance = balanceInfo.amount;
      console.log(`💰 Balance: $${balance.toFixed(2)}`);
      if (balanceInfo.loginid) {
        console.log(`📋 Account Login ID: ${balanceInfo.loginid}`);
        console.log(`📋 Account Type: ${balanceInfo.accountType.toUpperCase()}`);

        // Determine account type from loginid prefix
        const loginid = balanceInfo.loginid;
        if (loginid.startsWith('VRT')) {
          console.log(`   → Demo Account (Virtual)`);
        } else if (loginid.startsWith('CR')) {
          console.log(`   → Real Account (cTrader)`);
        } else if (loginid.startsWith('MF')) {
          console.log(`   → Real Account (MT5 Financial)`);
        } else if (loginid.startsWith('M')) {
          console.log(`   → Real Account (MT5)`);
        } else {
          console.log(`   → Account type: ${balanceInfo.accountType}`);
        }
      }
      console.log();
      // Update engine balance for context
      engine.updateBalance(balance);
    }
  } catch (error) {
    console.warn('⚠️  Could not get balance, using initial balance\n');
    engine.updateBalance(balance);
  }

  // ========================================
  // 🆕 Start TradeManager (handles position recovery and monitoring)
  // ========================================
  console.log('\n🔄 Starting TradeManager (position recovery + monitoring)...');
  await tradeManager.start();
  console.log('✅ TradeManager started - monitoring active\n');

  // Load historical candles for all assets
  console.log(`📥 Loading historical candles for ${SYMBOLS.length} asset(s)...`);
  console.log(`   ⚠️  Las señales generadas durante la carga serán ignoradas (solo para cálculos de indicadores)\n`);

  let totalHistoricalCandles = 0;
  for (const symbol of SYMBOLS) {
    try {
      const candles = await client.getCandles(symbol, TIMEFRAME, 100);
      console.log(`   ✅ ${symbol}: ${candles.length} candles`);

      // Initialize buffer for this asset
      if (!candleBuffers.has(symbol)) {
        candleBuffers.set(symbol, []);
      }
      const buffer = candleBuffers.get(symbol)!;
      buffer.push(...candles);

      // Initialize warm-up counter with historical candles for this asset
      warmUpCandlesPerAsset.set(symbol, candles.length);

      // Process candles through strategy (for indicator calculations only)
      // Signals generated during this phase will be ignored due to isInitializing flag
      // Note: StrategyEngine.processCandle only takes candle, context is created internally
      for (const candle of candles) {
        await engine.processCandle(candle);
        totalHistoricalCandles++;
      }
    } catch (error) {
      console.warn(`   ⚠️  ${symbol}: Could not load historical candles: ${error}`);
    }
  }

  // Mark initialization as complete AFTER a small delay
  // This ensures any signals generated during historical processing are fully ignored
  await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
  isInitializing = false;

  // Calculate warm-up status based on historical candles loaded PER ASSET
  // Each asset needs its own warm-up period
  console.log(`✅ Carga de datos históricos completada (${totalHistoricalCandles} velas total).`);
  console.log(`\n📊 Estado de warm-up por asset:`);
  SYMBOLS.forEach(symbol => {
    const count = warmUpCandlesPerAsset.get(symbol) || 0;
    const status = count >= WARM_UP_CANDLES_REQUIRED ? '✅' : '⏳';
    const remaining = Math.max(0, WARM_UP_CANDLES_REQUIRED - count);
    console.log(`   ${status} ${symbol}: ${count}/${WARM_UP_CANDLES_REQUIRED} velas${remaining > 0 ? ` (faltan ${remaining})` : ''}`);
  });
  console.log(`\n⏳ Esperando primera vela en tiempo real antes de ejecutar trades...\n`);

  // Subscribe to ticks for all assets
  console.log(`📡 Subscribing to ${SYMBOLS.length} asset(s): ${SYMBOLS.join(', ')}...`);
  await client.follow(SYMBOLS);
  console.log(`✅ Subscribed\n`);

  // Listen for ticks
  const PROXIMITY_CHECK_INTERVAL = 10000; // Check every 10 seconds

  // Set up periodic proximity check (even without new ticks) - for all assets
  const proximityCheckInterval = setInterval(async () => {
    const strategyInstance = engine.getAllStrategies()[0];
    if (strategyInstance && typeof (strategyInstance as any).getSignalProximity === 'function') {
      // Check proximity for each asset
      for (const symbol of SYMBOLS) {
        // Use StrategyEngine's candle data (per asset) instead of local buffer
        const strategyName = strategyInstance.getName();
        const buffer = engine.getCandleDataForAsset(strategyName, symbol);
        if (buffer.length >= 50) {
          try {
            const proximity = (strategyInstance as any).getSignalProximity(buffer);
            if (proximity) {
              // Publish signal proximity to Gateway for dashboard consumption
              try {
                await client.publishSignalProximity({
                  asset: symbol,
                  ...proximity,
                });
              } catch (error) {
                console.warn(`⚠️  Could not publish signal proximity for ${symbol}:`, error);
              }

              console.log(`\n📊 PROXIMIDAD DE SEÑAL [${symbol}]:`);
              console.log(`   Dirección: ${proximity.direction.toUpperCase()}`);
              console.log(`   Proximidad: ${proximity.overallProximity}%`);
              console.log(`   Listo: ${proximity.readyToSignal ? '✅ SÍ' : '⏳ NO'}`);

              if (proximity.criteria && proximity.criteria.length > 0) {
                console.log(`   Criterios:`);
                proximity.criteria.forEach((c: any) => {
                  const status = c.passed ? '✅' : '⏳';
                  const currentVal = typeof c.current === 'number' ? c.current.toFixed(2) : c.current;
                  const targetVal = typeof c.target === 'number' ? c.target.toFixed(2) : c.target;
                  const distanceVal = typeof c.distance === 'number' ? c.distance.toFixed(1) : c.distance;
                  console.log(`     ${status} ${c.name}: ${currentVal}${c.unit} (objetivo: ${targetVal}${c.unit}) - ${distanceVal}%`);
                });
              }

              if (proximity.missingCriteria && proximity.missingCriteria.length > 0) {
                console.log(`   Faltan: ${proximity.missingCriteria.join(', ')}`);
              }
              console.log();
            }
          } catch (error) {
            // Proximity not available, skip silently
          }
        }
      }
    }
  }, PROXIMITY_CHECK_INTERVAL);

  // Note: Periodic monitoring and SMART Exit now handled by TradeManager

  // ========================================
  // 🆕 Listen for TradeManager events to update database
  // ========================================
  tradeManager.on('trade:closed', async (data: { contractId: string; reason: string }) => {
    console.log(`\n📝 Updating database for closed trade: ${data.contractId}`);
    console.log(`   Close reason: ${data.reason}`);

    try {
      // Get the trade from history
      const allTrades = tradeManager.getTradeHistory();
      const trade = allTrades.find(t => t.contractId === data.contractId);

      if (trade) {
        // Try to get final portfolio info for exit price and profit
        let exitPrice = trade.entryPrice;
        let profit = 0;
        let result: 'WIN' | 'LOSS' = 'LOSS';

        try {
          const portfolio = await client.getPortfolio();
          const position = portfolio.find(p => p.contractId === data.contractId);

          if (position) {
            exitPrice = position.currentPrice;
            profit = position.profit;
            result = profit > 0 ? 'WIN' : 'LOSS';
          }
        } catch (error) {
          console.warn(`   ⚠️  Could not get portfolio info, using entry price as exit`);
        }

        // Get existing metadata and add close reason
        const existingMetadata = trade.metadata || {};
        const updatedMetadata = {
          ...existingMetadata,
          closeReason: data.reason,
          closedBy: 'TradeManager',
          closedAt: new Date().toISOString(),
        };

        await client.updateTrade({
          contractId: data.contractId,
          exitPrice,
          payout: Math.abs(profit),
          result,
          closedAt: new Date(),
          metadata: JSON.stringify(updatedMetadata),
        });

        console.log(`   ✅ Trade actualizado en base de datos (${result}, reason: ${data.reason})`);
      }
    } catch (error: any) {
      console.error(`   ⚠️  Error actualizando trade en DB: ${error.message}`);
    }
  });

  client.on('tick', async (tick: Tick) => {
    if (!SYMBOLS.includes(tick.asset)) return;

    // ========================================
    // 🆕 STRATEGY-SPECIFIC EXIT: RSI Reversal (on ticks)
    // ========================================
    // Check all trades managed by TradeManager
    const allTrades = tradeManager.getTradeHistory();

    for (const trade of allTrades) {
      if (trade.closed || !trade.contractId) continue;
      if (trade.asset !== tick.asset) continue;

      // Get current RSI for RSI-based early exit
      const strategyName = engine.getAllStrategies()[0]?.getName();
      const buffer = strategyName ? engine.getCandleDataForAsset(strategyName, trade.asset) : [];

      if (buffer.length >= 14) {
        const closes = buffer.slice(-50).map((c: any) => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        const currentRSI = rsiValues[rsiValues.length - 1];

        // Use TradeManager's evaluateExit with RSI value
        await tradeManager.evaluateExit(trade.contractId, tick.price, currentRSI);
      } else {
        // Evaluate without RSI if not enough data
        await tradeManager.evaluateExit(trade.contractId, tick.price);
      }
    }

    const candle = processTick(tick);
    if (candle) {
      const asset = candle.asset;

      // Mark that we've received at least one real-time candle
      if (!hasReceivedRealtimeCandle) {
        hasReceivedRealtimeCandle = true;
        console.log(`\n✅✅✅ PRIMERA VELA EN TIEMPO REAL RECIBIDA ✅✅✅`);
        console.log(`   Asset: ${asset} | Timestamp: ${new Date(candle.timestamp * 1000).toISOString()}`);

        // Check warm-up status for this specific asset
        const assetWarmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
        if (assetWarmUpCount >= WARM_UP_CANDLES_REQUIRED) {
          console.log(`   ✅ ${asset} indicadores estabilizados. Listo para trades en este asset.\n`);
        } else {
          console.log(`   ⏳ ${asset} continuando warm-up...\n`);
        }
      }

      // Initialize buffer if needed
      if (!candleBuffers.has(asset)) {
        candleBuffers.set(asset, []);
      }
      const buffer = candleBuffers.get(asset)!;
      buffer.push(candle);

      // Keep only last 200 candles per asset
      if (buffer.length > 200) {
        buffer.shift();
      }

      // Process candle through strategy
      // Note: StrategyEngine.processCandle only takes candle, context is created internally
      await engine.processCandle(candle);

      // Update warm-up counter PER ASSET (only after initialization is complete)
      if (!isInitializing) {
        const currentCount = warmUpCandlesPerAsset.get(asset) || 0;
        if (currentCount < WARM_UP_CANDLES_REQUIRED) {
          const newCount = currentCount + 1;
          warmUpCandlesPerAsset.set(asset, newCount);

          if (newCount === WARM_UP_CANDLES_REQUIRED) {
            console.log(`\n✅✅✅ WARM-UP COMPLETADO PARA ${asset} ✅✅✅`);
            console.log(`   ${newCount} velas procesadas. Indicadores estabilizados para ${asset}.`);
            console.log(`   Ahora se ejecutarán trades en señales de ${asset}.\n`);
          } else if (newCount % 10 === 0) {
            // Log progress every 10 candles during warm-up
            const remaining = WARM_UP_CANDLES_REQUIRED - newCount;
            console.log(`⏳ Warm-up ${asset}: ${newCount}/${WARM_UP_CANDLES_REQUIRED} velas (faltan ${remaining})`);
          }
        }
      }
    }
  });

  // Listen for trade results
  client.on('trade:result', async (data: any) => {
    const allTrades = tradeManager.getTradeHistory();
    const trade = allTrades.find(t => t.contractId === data.id);
    if (!trade) return;

    const won = data.result === 'won';
    const profit = data.profit || 0;

    if (won) {
      wonTrades++;
      balance += (trade.stake || 0) + profit;
      ooLogger.info('trader', 'Trade closed - WIN', {
        contractId: data.id,
        profit,
        asset: trade.asset,
        direction: trade.direction
      });
      console.log(`\n✅ TRADE WON: ${data.id}`);
    } else {
      lostTrades++;
      balance += (trade.stake || 0) + profit; // profit is negative for losses
      console.log(`\n❌ TRADE LOST: ${data.id}`);
      ooLogger.info('trader', 'Trade closed - LOSS', {
        contractId: data.id,
        profit,
        asset: trade.asset,
        direction: trade.direction
      });
    }

    console.log(`   P&L: $${profit.toFixed(2)}`);
    console.log(`   Balance: $${balance.toFixed(2)}`);

    // Update trade in database with result
    try {
      await client.updateTrade({
        contractId: data.id,
        exitPrice: data.exitPrice || data.price || trade.entryPrice,
        payout: Math.abs(profit), // Store as positive number
        result: won ? 'WIN' : 'LOSS',
        closedAt: new Date(),
      });
      console.log(`   ✅ Trade actualizado en base de datos`);
    } catch (error: any) {
      console.error(`   ⚠️  Error actualizando trade en DB: ${error.message}`);
    }

    // Statistics
    const winRate = (wonTrades / totalTrades) * 100;
    const totalPnL = balance - INITIAL_BALANCE;
    const roi = (totalPnL / INITIAL_BALANCE) * 100;

    console.log(`\n📊 STATISTICS:`);
    console.log(`   Total Trades: ${totalTrades}`);
    console.log(`   Wins: ${wonTrades} | Losses: ${lostTrades}`);
    console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`   ROI: ${roi.toFixed(2)}%`);
    console.log();
  });

  console.log('✅ Ready to trade. Waiting for signals...');
  console.log('   Press Ctrl+C to stop\n');

  // Periodic summary log (every 60 seconds)
  const summaryInterval = setInterval(() => {
    if (totalTrades > 0) {
      console.log(`\n📊 RESUMEN (cada 60s):`);
      console.log(`   Total Trades ejecutados: ${totalTrades}`);
      console.log(`   Wins: ${wonTrades} | Losses: ${lostTrades}`);
      console.log(`   Balance actual: $${balance.toFixed(2)}`);

      // 🆕 MEJORA 3: Mostrar estadísticas desde TradeManager
      const stats = tradeManager.getRiskStats();
      console.log(`   Trades abiertos: ${stats.openTrades}/${stats.maxOpenTrades} (${stats.utilizationPct.toFixed(0)}% utilización)`);

      if (stats.tradesBySymbol.size > 0) {
        console.log(`   Por símbolo:`);
        stats.tradesBySymbol.forEach((count, symbol) => {
          console.log(`      ${symbol}: ${count}/${MAX_TRADES_PER_SYMBOL}`);
        });
      }

      console.log();
    } else {
      console.log(`\n⏳ Esperando señales... (0 trades ejecutados hasta ahora)`);
    }
  }, 60000); // Every 60 seconds

  // Keep running
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping...');
    ooLogger.warn('trader', 'RSI-BB-Scalping demo shutting down');

    // Clear intervals
    clearInterval(proximityCheckInterval);
    clearInterval(summaryInterval);

    // Stop TradeManager
    tradeManager.stop();

    // Final statistics
    const winRate = totalTrades > 0 ? (wonTrades / totalTrades) * 100 : 0;
    const totalPnL = balance - INITIAL_BALANCE;
    const roi = (totalPnL / INITIAL_BALANCE) * 100;

    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL STATISTICS');
    console.log('='.repeat(80));
    console.log(`   Total Trades: ${totalTrades}`);
    console.log(`   Wins: ${wonTrades} | Losses: ${lostTrades}`);
    console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`   ROI: ${roi.toFixed(2)}%`);
    console.log('='.repeat(80));

    ooLogger.info('trader', 'RSI-BB-Scalping demo stopped', {
      totalTrades,
      wonTrades,
      lostTrades,
      winRate,
      totalPnL,
      roi,
      finalBalance: balance
    });

    await ooLogger.close();
    process.exit(0);
  });
}

// Run
main().catch(console.error);
