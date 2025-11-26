/**
 * Bollinger Band Squeeze Strategy Demo
 *
 * Run the BB Squeeze scalping strategy in demo mode
 * Strategy: Trades volatility breakouts after squeeze phases
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { BBSqueezeStrategy } from '../strategies/bb-squeeze.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables
dotenv.config();

// Configuration
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
const SYMBOLS_STR = process.env.SYMBOL || 'R_75,R_100';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Risk parameters
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.02'); // 2% for CFDs
const RISK_PERCENTAGE_BINARY = 0.01; // 1% for binary
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
// Track processed trades to avoid double-counting (from both trade:closed and trade:result events)
const processedTradeResults = new Set<string>();

// Trade Manager instance
let tradeManager: TradeManager;

// Trade Execution Service
let tradeExecutionService: TradeExecutionService;

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

async function main() {
  console.log('='.repeat(80));
  console.log('🚀 BOLLINGER BAND SQUEEZE STRATEGY - DEMO');
  console.log('='.repeat(80));
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Warm-up: ${WARM_UP_CANDLES_REQUIRED} candles required`);
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
  const MONITORED_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
  tradeManager = new TradeManager(gatewayClient, adapter, MONITORED_SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 40 * 60 * 1000,
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

  // Initialize TradeExecutionService
  tradeExecutionService = new TradeExecutionService(
    gatewayClient,
    adapter,
    tradeManager,
    {
      mode: TRADE_MODE,
      strategyName: 'BB-Squeeze',
      binaryDuration: 1,
      cfdTakeProfitPct: 0.004, // 0.4% TP (Strong Breakout Scalping)
      cfdStopLossPct: 0.002,   // 0.2% SL (2:1 ratio)
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        'R_10': 400,
        'R_25': 160,
        'R_50': 80,
        'R_75': 50,
        'R_100': 100,
      },
    }
  );

  console.log(`✅ TradeExecutionService initialized\n`);

  // Connect to gateway
  console.log('🔌 Connecting to Gateway...');
  await gatewayClient.connect();
  console.log('✅ Connected to Gateway\n');

  // Register trader with Gateway for monitoring
  try {
    const registration = await gatewayClient.registerTrader({
      name: 'BB-Squeeze Trader',
      strategy: 'BB-Squeeze',
      symbols: SYMBOLS,
    });
    console.log(`📝 Registered with Gateway: ${registration.traderId}\n`);
  } catch (error) {
    console.log('⚠️  Could not register with Gateway (older version?)\n');
  }

  // Start heartbeat interval (every 30 seconds)
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore heartbeat errors
    }
  }, 30000);

  // Initialize strategy with config
  const strategy = new BBSqueezeStrategy({
    name: 'bb-squeeze',
    enabled: true,
    assets: ['R_75', 'R_100'],
    maxConcurrentTrades: 1,
    amount: 100,
    amountType: 'fixed',
    cooldownSeconds: 60,
    minConfidence: 0.7,
    parameters: {
      bbPeriod: 20,
      bbStdDev: 2,
      kcPeriod: 20,
      kcMultiplier: 1.5,
      takeProfitPct: 0.004,  // 0.4% TP
      stopLossPct: 0.002,    // 0.2% SL
      cooldownSeconds: 60,   // 1 minute between trades
      minCandles: 50,        // Need 50 candles for indicator stability
    },
  });

  console.log('📊 Strategy Configuration:');
  console.log('   Bollinger Bands: Period=20, StdDev=2');
  console.log('   Keltner Channels: Period=20, ATR Multiplier=1.5');
  console.log('   Take Profit: 0.4% (Strong Breakout Scalping)');
  console.log('   Stop Loss: 0.2%');
  console.log('   TP/SL Ratio: 2:1');
  console.log('   Smart Exit: Close at BB_Middle (Mean Reversion)');
  console.log('   Cooldown: 60 seconds\n');

  console.log('📈 Strategy Logic:');
  console.log('   1. Detect "Squeeze" (Low Volatility): BB inside KC');
  console.log('   2. CALL: Price breaks above BB_Upper after squeeze');
  console.log('   3. PUT: Price breaks below BB_Lower after squeeze');
  console.log('   4. Smart Exit: Close trade when price touches BB_Middle\n');

  // Initialize Strategy Engine
  const engine = new StrategyEngine();

  // Add strategy to engine
  engine.addStrategy(strategy);

  // Start the strategy
  await engine.startAll();
  console.log(`✅ Strategy "${strategy.getName()}" started\n`);

  // Listen for signals
  engine.on('signal', async (signal: Signal) => {
    // Ignore signals during initialization
    if (isInitializing) {
      console.log(`\n⏸️  Señal ignorada durante inicialización`);
      return;
    }

    // Ignore signals until we've received at least one real-time candle
    if (!hasReceivedRealtimeCandle) {
      console.log(`\n⏸️  Señal ignorada - esperando primera vela en tiempo real`);
      return;
    }

    const asset = (signal as any).asset || signal.symbol || SYMBOLS[0];

    // Ignore signals during warm-up period
    const assetWarmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
    if (assetWarmUpCount < WARM_UP_CANDLES_REQUIRED) {
      const remaining = WARM_UP_CANDLES_REQUIRED - assetWarmUpCount;
      console.log(`\n⏳ Señal ignorada durante warm-up de ${asset}`);
      console.log(`   Velas procesadas: ${assetWarmUpCount}/${WARM_UP_CANDLES_REQUIRED} (faltan ${remaining})\n`);
      return;
    }

    // Risk checks using TradeManager
    const canTrade = tradeManager.canOpenTrade(asset);
    if (!canTrade.allowed) {
      console.log(`\n⚠️  SEÑAL IGNORADA - ${canTrade.reason}`);
      console.log(`   Direction: ${signal.direction} | Asset: ${asset}\n`);
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 SEÑAL DETECTADA - EJECUTANDO TRADE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Asset: ${asset}`);
    console.log(`   Timestamp: ${new Date(signal.timestamp).toISOString()}`);
    if (signal.metadata) {
      console.log(`   Metadata:`, signal.metadata);
    }
    console.log(`${'='.repeat(80)}\n`);

    // Execute trade using TradeExecutionService
    const result = await tradeExecutionService.executeTrade(signal, SYMBOLS[0]);
    if (result.success) {
      totalTrades++;
      if (result.stake) {
        balance -= result.stake;
      }
    }
  });

  // Listen for errors
  engine.on('strategy:error', (error: Error) => {
    console.error(`❌ Strategy error:`, error);
  });

  // Get balance
  try {
    const balanceInfo = await gatewayClient.getBalance();
    if (balanceInfo) {
      balance = balanceInfo.amount;
      console.log(`💰 Balance: $${balance.toFixed(2)}`);
      if (balanceInfo.loginid) {
        console.log(`📋 Account: ${balanceInfo.loginid} (${balanceInfo.accountType})`);
      }
      console.log();
      engine.updateBalance(balance);
    }
  } catch (error) {
    console.warn('⚠️  Could not get balance\n');
    engine.updateBalance(balance);
  }

  // Start TradeManager
  console.log('🔄 Starting TradeManager...');
  await tradeManager.start();
  console.log('✅ TradeManager started\n');

  // Load historical candles
  console.log(`📥 Loading historical candles for ${SYMBOLS.length} asset(s)...\n`);

  let totalHistoricalCandles = 0;
  for (const symbol of SYMBOLS) {
    try {
      const candles = await gatewayClient.getCandles(symbol, TIMEFRAME, 100);
      console.log(`   ✅ ${symbol}: ${candles.length} candles`);

      warmUpCandlesPerAsset.set(symbol, candles.length);

      for (const candle of candles) {
        await engine.processCandle(candle);
        totalHistoricalCandles++;
      }
    } catch (error) {
      console.warn(`   ⚠️  ${symbol}: Could not load historical candles`);
    }
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  isInitializing = false;

  console.log(`✅ Carga completada (${totalHistoricalCandles} velas)\n`);
  console.log(`📊 Warm-up status:`);
  SYMBOLS.forEach(symbol => {
    const count = warmUpCandlesPerAsset.get(symbol) || 0;
    const status = count >= WARM_UP_CANDLES_REQUIRED ? '✅' : '⏳';
    const remaining = Math.max(0, WARM_UP_CANDLES_REQUIRED - count);
    console.log(`   ${status} ${symbol}: ${count}/${WARM_UP_CANDLES_REQUIRED}${remaining > 0 ? ` (faltan ${remaining})` : ''}`);
  });
  console.log();

  // Subscribe to assets
  console.log(`📡 Subscribing to: ${SYMBOLS.join(', ')}...`);
  await gatewayClient.follow(SYMBOLS);
  console.log(`✅ Subscribed\n`);

  console.log('✅ Strategy is now running!');
  console.log('⏳ Waiting for signals...\n');
  console.log('Strategy Logic:');
  console.log('  • Detect Squeeze: BB inside KC (Low Volatility Phase)');
  console.log('  • CALL: Price breaks above BB_Upper after squeeze');
  console.log('  • PUT: Price breaks below BB_Lower after squeeze');
  console.log('  • Smart Exit: Close at BB_Middle (Mean Reversion)\n');

  // Signal proximity check
  const PROXIMITY_CHECK_INTERVAL = 10000;
  const proximityCheckInterval = setInterval(async () => {
    const strategyInstance = engine.getAllStrategies()[0];
    if (strategyInstance && typeof (strategyInstance as any).getSignalReadiness === 'function') {
      for (const symbol of SYMBOLS) {
        const strategyName = strategyInstance.getName();
        const buffer = engine.getCandleDataForAsset(strategyName, symbol);
        if (buffer.length >= 50) {
          try {
            const readiness = (strategyInstance as any).getSignalReadiness(buffer);
            if (readiness) {
              await gatewayClient.publishSignalProximity({
                asset: symbol,
                ...readiness,
              });
            }
          } catch (error) {
            // Skip silently
          }
        }
      }
    }
  }, PROXIMITY_CHECK_INTERVAL);

  // TradeManager events (from polling/reconciliation)
  tradeManager.on('trade:closed', async (data: { contractId: string; reason: string; profit?: number }) => {
    const contractId = data.contractId?.toString() || data.contractId;
    console.log(`\n📝 Trade closed: ${contractId} (${data.reason})`);

    // Skip if already processed (via trade:result event from Gateway)
    if (processedTradeResults.has(contractId)) {
      console.log(`   ⏭️  Already processed via trade:result, skipping duplicate`);
      return;
    }

    try {
      const allTrades = tradeManager.getTradeHistory();
      const trade = allTrades.find(t => t.contractId?.toString() === contractId);

      if (trade) {
        // Mark as processed to avoid double-counting
        processedTradeResults.add(contractId);

        let exitPrice = trade.entryPrice;
        let profit = data.profit ?? 0;
        let result: 'WIN' | 'LOSS' = profit >= 0 ? 'WIN' : 'LOSS';

        // Update statistics
        if (result === 'WIN') {
          wonTrades++;
        } else {
          lostTrades++;
        }

        // Get real balance from API (most accurate)
        try {
          const balanceInfo = await gatewayClient.getBalance();
          if (balanceInfo) {
            balance = balanceInfo.amount;
          }
        } catch (error) {
          // Fallback: calculate locally
          const stakeReturned = trade.stake || 0;
          balance += stakeReturned + profit;
        }

        await gatewayClient.updateTrade({
          contractId: contractId,
          exitPrice,
          payout: Math.abs(profit),
          result,
          closedAt: new Date(),
          metadata: JSON.stringify({
            ...trade.metadata,
            closeReason: data.reason,
            closedBy: 'TradeManager',
          }),
        });

        console.log(`   ✅ Trade updated (${result})`);
        console.log(`   P&L: $${profit.toFixed(2)}`);
        console.log(`   Balance: $${balance.toFixed(2)}`);

        // Show updated stats
        const winRate = totalTrades > 0 ? (wonTrades / totalTrades) * 100 : 0;
        console.log(`   📊 Stats: ${totalTrades} trades | W:${wonTrades} L:${lostTrades} | WR: ${winRate.toFixed(1)}%`);
      }
    } catch (error: any) {
      console.error(`   ⚠️  Error updating trade: ${error.message}`);
    }
  });

  // Listen for ticks
  gatewayClient.on('tick', async (tick: Tick) => {
    if (!SYMBOLS.includes(tick.asset)) return;

    const candle = processTick(tick);
    if (candle) {
      const asset = candle.asset;

      // Mark first real-time candle
      if (!hasReceivedRealtimeCandle) {
        hasReceivedRealtimeCandle = true;
        console.log(`\n✅✅✅ PRIMERA VELA EN TIEMPO REAL RECIBIDA ✅✅✅`);
        console.log(`   Asset: ${asset} | Timestamp: ${new Date(candle.timestamp * 1000).toISOString()}\n`);
      }

      // Process candle through strategy
      await engine.processCandle(candle);

      // Update warm-up counter
      if (!isInitializing) {
        const currentCount = warmUpCandlesPerAsset.get(asset) || 0;
        if (currentCount < WARM_UP_CANDLES_REQUIRED) {
          const newCount = currentCount + 1;
          warmUpCandlesPerAsset.set(asset, newCount);

          if (newCount === WARM_UP_CANDLES_REQUIRED) {
            console.log(`\n✅✅✅ WARM-UP COMPLETADO PARA ${asset} ✅✅✅`);
            console.log(`   Indicadores estabilizados. Listo para trades.\n`);
          }
        }
      }
    }
  });

  // Listen for trade results (from Gateway contract subscription - primary source)
  gatewayClient.on('trade:result', async (data: any) => {
    const contractId = data.id?.toString() || data.id;
    console.log(`\n🎯 TRADE RESULT from Gateway: ${contractId}`);
    console.log(`   Result: ${data.result} | Profit: $${data.profit?.toFixed(2) || 'N/A'}`);

    // Skip if already processed (via trade:closed event from TradeManager)
    if (processedTradeResults.has(contractId)) {
      console.log(`   ⏭️  Already processed via trade:closed, skipping duplicate`);
      return;
    }

    const allTrades = tradeManager.getTradeHistory();
    // Compare as strings to handle number/string mismatch
    const trade = allTrades.find(t => t.contractId?.toString() === contractId);
    if (!trade) {
      console.log(`   ⚠️  Trade not found in history (contractId: ${contractId})`);
      console.log(`   📋 Available trades: ${allTrades.map(t => t.contractId).join(', ') || 'none'}`);
      return;
    }

    // Mark as processed to avoid double-counting
    processedTradeResults.add(contractId);

    const won = data.result === 'won';
    const profit = data.profit || 0;

    if (won) {
      wonTrades++;
      console.log(`   ✅ TRADE WON`);
    } else {
      lostTrades++;
      console.log(`   ❌ TRADE LOST`);
    }

    // Get real balance from API (most accurate)
    try {
      const balanceInfo = await gatewayClient.getBalance();
      if (balanceInfo) {
        balance = balanceInfo.amount;
      }
    } catch (error) {
      // Fallback: calculate locally
      const stakeReturned = trade.stake || 0;
      balance += stakeReturned + profit;
    }

    console.log(`   P&L: $${profit.toFixed(2)}`);
    console.log(`   Balance: $${balance.toFixed(2)}`);

    try {
      await gatewayClient.updateTrade({
        contractId: contractId,
        exitPrice: data.closePrice || trade.entryPrice,
        payout: Math.abs(profit),
        result: won ? 'WIN' : 'LOSS',
        closedAt: new Date(),
        metadata: JSON.stringify({
          ...trade.metadata,
          closedBy: 'Gateway:trade:result',
        }),
      });
    } catch (error: any) {
      console.error(`   ⚠️  Error updating trade: ${error.message}`);
    }

    const winRate = totalTrades > 0 ? (wonTrades / totalTrades) * 100 : 0;
    const totalPnL = balance - INITIAL_BALANCE;
    const roi = (totalPnL / INITIAL_BALANCE) * 100;

    console.log(`\n📊 STATISTICS:`);
    console.log(`   Total: ${totalTrades} | Wins: ${wonTrades} | Losses: ${lostTrades}`);
    console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   Total P&L: $${totalPnL.toFixed(2)} | ROI: ${roi.toFixed(2)}%\n`);
  });

  console.log('✅ Ready. Waiting for signals...\n');

  // Periodic summary
  const summaryInterval = setInterval(() => {
    if (totalTrades > 0) {
      console.log(`\n📊 RESUMEN:`);
      console.log(`   Trades: ${totalTrades} | Wins: ${wonTrades} | Losses: ${lostTrades}`);
      console.log(`   Balance: $${balance.toFixed(2)}`);

      const stats = tradeManager.getRiskStats();
      console.log(`   Open: ${stats.openTrades}/${stats.maxOpenTrades}\n`);
    }
  }, 60000);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping...');

    clearInterval(proximityCheckInterval);
    clearInterval(summaryInterval);
    tradeManager.stop();

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

    await gatewayClient.disconnect();
    console.log('✅ Shutdown complete');
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
