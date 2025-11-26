/**
 * Support/Resistance Strategy Demo
 *
 * Run the Support/Resistance bounce strategy in demo mode
 * Expected performance: 67.22% ROI, 41.9% WR (from backtest)
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { SupportResistanceStrategy } from '../strategies/support-resistance.strategy.js';
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
const WARM_UP_CANDLES_REQUIRED = 50;

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
  console.log('🚀 SUPPORT/RESISTANCE BOUNCE STRATEGY - DEMO');
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
  // Monitor ALL volatility indices (not just active trading symbols) to detect any open positions
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
      strategyName: 'Support-Resistance',
      binaryDuration: 1,
      cfdTakeProfitPct: 0.0035, // 0.35% TP (Fast Profit Taking - improved win rate with 1.4:1 ratio)
      cfdStopLossPct: 0.0025,   // 0.25% SL
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

  // Initialize strategy with config
  const strategy = new SupportResistanceStrategy({
    name: 'support-resistance',
    enabled: true,
    assets: ['R_75', 'R_100'],
    maxConcurrentTrades: 1,
    amount: 100,
    amountType: 'fixed',
    cooldownSeconds: 60,
    minConfidence: 0.7,
    parameters: {
      lookbackPeriod: 20,
      touchTolerancePct: 0.002, // 0.2%
      takeProfitPct: 0.005,      // 0.5% TP
      stopLossPct: 0.0025,       // 0.25% SL (2:1 ratio)
      cooldownSeconds: 60,       // 1 minute between trades
    },
  });

  console.log('📊 Strategy Configuration:');
  console.log('   Lookback Period: 20 candles');
  console.log('   S/R Touch Tolerance: 0.2%');
  console.log('   Take Profit: 0.35% (Fast Profit Taking)');
  console.log('   Stop Loss: 0.25%');
  console.log('   TP/SL Ratio: 1.4:1');
  console.log('   Cooldown: 60 seconds\n');

  console.log('📈 Expected Performance (from backtest):');
  console.log('   ROI: 67.22% monthly');
  console.log('   Win Rate: 41.9%');
  console.log('   Trades: ~4,446/month (~150/day)');
  console.log('   Profit Factor: 1.07\n');

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
  console.log('  • CALL: When price bounces from support level (±0.2%)');
  console.log('  • PUT: When price bounces from resistance level (±0.2%)');
  console.log('  • Support = Lowest low of last 20 candles');
  console.log('  • Resistance = Highest high of last 20 candles\n');

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

  // TradeManager events
  tradeManager.on('trade:closed', async (data: { contractId: string; reason: string }) => {
    console.log(`\n📝 Trade closed: ${data.contractId} (${data.reason})`);

    try {
      const allTrades = tradeManager.getTradeHistory();
      const trade = allTrades.find(t => t.contractId === data.contractId);

      if (trade) {
        let exitPrice = trade.entryPrice;
        let profit = 0;
        let result: 'WIN' | 'LOSS' = 'LOSS';

        try {
          const portfolio = await gatewayClient.getPortfolio();
          const position = portfolio.find((p: any) => p.contractId === data.contractId);
          if (position) {
            exitPrice = position.currentPrice;
            profit = position.profit;
            result = profit > 0 ? 'WIN' : 'LOSS';
          }
        } catch (error) {
          console.warn(`   ⚠️  Could not get portfolio info`);
        }

        await gatewayClient.updateTrade({
          contractId: data.contractId,
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

  // Listen for trade results
  gatewayClient.on('trade:result', async (data: any) => {
    const allTrades = tradeManager.getTradeHistory();
    const trade = allTrades.find(t => t.contractId === data.id);
    if (!trade) return;

    const won = data.result === 'won';
    const profit = data.profit || 0;

    if (won) {
      wonTrades++;
      balance += (trade.stake || 0) + profit;
      console.log(`\n✅ TRADE WON: ${data.id}`);
    } else {
      lostTrades++;
      balance += (trade.stake || 0) + profit;
      console.log(`\n❌ TRADE LOST: ${data.id}`);
    }

    console.log(`   P&L: $${profit.toFixed(2)}`);
    console.log(`   Balance: $${balance.toFixed(2)}`);

    try {
      await gatewayClient.updateTrade({
        contractId: data.id,
        exitPrice: data.exitPrice || data.price || trade.entryPrice,
        payout: Math.abs(profit),
        result: won ? 'WIN' : 'LOSS',
        closedAt: new Date(),
      });
    } catch (error: any) {
      console.error(`   ⚠️  Error updating trade: ${error.message}`);
    }

    const winRate = (wonTrades / totalTrades) * 100;
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
