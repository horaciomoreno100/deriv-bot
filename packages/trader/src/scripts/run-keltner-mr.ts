/**
 * Keltner Channel Mean Reversion Strategy - Live Trading Script
 *
 * This script runs the KELTNER_MR strategy with dedicated balance allocation.
 * Uses the StrategyAccountant for per-strategy accounting and P/L tracking.
 *
 * Features:
 * - Per-strategy balance allocation ($1000 default)
 * - Independent P/L tracking
 * - Risk management based on strategy balance
 * - Works alongside other strategies (multi-strategy support)
 */

import dotenv from 'dotenv';
import { GatewayClient, initSlackAlerts, type SlackAlerter } from '@deriv-bot/shared';
import { KeltnerMRStrategy } from '../strategies/mr/keltner-mr.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import { SessionFilterService, type TradingSession } from '../services/session-filter.service.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';

// Load environment variables
dotenv.config();

// Configuration
const STRATEGY_NAME = 'KELTNER_MR';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
// Strategy optimized specifically for EUR/USD (frxEURUSD)
// Backtest data: frxEURUSD_300s_365d.csv (365 days, 5min timeframe)
const SYMBOLS_STR = process.env.SYMBOL || 'frxEURUSD';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Session filter configuration (forex 24/5)
const ENABLE_SESSION_FILTER = process.env.ENABLE_SESSION_FILTER !== 'false'; // Default: true
const ALLOWED_SESSIONS_STR = process.env.ALLOWED_SESSIONS || 'LONDON,NY,ASIAN'; // Default: best performing sessions
const ALLOWED_SESSIONS = ALLOWED_SESSIONS_STR.split(',')
  .map(s => s.trim().toUpperCase())
  .filter(s => s.length > 0) as TradingSession[];

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
const WARM_UP_CANDLES_REQUIRED = 50;
const processedTradeResults = new Set<string>();

// Components
let tradeManager: TradeManager;
let tradeExecutionService: TradeExecutionService;
let slackAlerter: SlackAlerter | null = null;
let strategyAccountant: StrategyAccountant;
let sessionFilter: SessionFilterService;

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
  console.log(`🎯 ${STRATEGY_NAME} - MEAN REVERSION STRATEGY`);
  console.log('='.repeat(80));
  console.log();
  console.log('📊 Configuration:');
  console.log(`   Strategy: ${STRATEGY_NAME}`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  if (!SYMBOLS.includes('frxEURUSD')) {
    console.log(`   ⚠️  WARNING: Strategy optimized for frxEURUSD only!`);
    console.log(`   ⚠️  Other symbols not tested - use at your own risk`);
  }
  console.log(`   Timeframe: ${TIMEFRAME}s (1min)`);
  console.log(`   Trade Mode: ${TRADE_MODE.toUpperCase()}`);
  console.log(`   Strategy Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
  console.log(`   Total Account Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Warm-up: ${WARM_UP_CANDLES_REQUIRED} candles required`);
  console.log(`   Slack Alerts: ${slackAlerter ? 'Enabled' : 'Disabled'}`);
  console.log();

  // Initialize Session Filter (forex 24/5)
  sessionFilter = new SessionFilterService({
    enabled: ENABLE_SESSION_FILTER,
    allowedSessions: ALLOWED_SESSIONS,
  });

  console.log('🌍 Session Filter Configuration:');
  console.log(`   Enabled: ${ENABLE_SESSION_FILTER ? 'Yes' : 'No'}`);
  if (ENABLE_SESSION_FILTER) {
    console.log(`   Allowed Sessions: ${ALLOWED_SESSIONS.join(', ')}`);
    console.log(`   Market: Forex (24/5 - excludes CLOSED session)`);
    console.log();
    console.log(sessionFilter.getTodaySchedule());
    console.log();
  } else {
    console.log(`   ⚠️  Session filtering disabled - trading 24/7`);
    console.log();
  }

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

  // Initialize TradeManager (use SYMBOLS from config, not hardcoded)
  tradeManager = new TradeManager(gatewayClient, adapter, SYMBOLS, {
    pollingInterval: 30000,
    smartExit: {
      maxTradeDuration: 60 * 60 * 1000, // 60 min max (MR may take time)
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
      cfdTakeProfitPct: 0.006,  // 0.6% TP (Mean Reversion)
      cfdStopLossPct: 0.003,    // 0.3% SL (2:1 ratio)
      accountLoginid: ACCOUNT_LOGINID,
      multiplierMap: {
        // Strategy optimized specifically for EUR/USD
        'frxEURUSD': 300,  // EUR/USD - optimized multiplier from backtest (114.5% ROI)
        // Other symbols not tested - use at your own risk
        'frxGBPUSD': 300,
        'frxUSDJPY': 300,
        'frxAUDUSD': 300,
        'frxUSDCAD': 300,
        'frxUSDCHF': 300,
        'frxEURGBP': 300,
        'frxEURJPY': 300,
        'frxGBPJPY': 300,
        // Volatility indices (not recommended for this strategy)
        'R_10': 400,
        'R_25': 160,
        'R_50': 80,
        'R_75': 50,
        'R_100': 100,
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

  // Start heartbeat
  setInterval(async () => {
    try {
      await gatewayClient.heartbeat();
    } catch {
      // Ignore
    }
  }, 30000);

  // Initialize strategy
  const strategy = new KeltnerMRStrategy({
    // Optimized parameters from backtest (114.5% ROI)
    kcEmaPeriod: 20,
    kcAtrPeriod: 14,
    kcMultiplier: 2.0,
    rsiOversold: 35,
    rsiOverbought: 65,
    adxThreshold: 25,
    slMultiplier: 1.5,
    maxBars: 15,
    minCandles: 40,
  });

  console.log('📊 Strategy Configuration:');
  console.log(`   Keltner Channel: EMA(20) ± 2.0×ATR(14)`);
  console.log(`   RSI Thresholds: Oversold<35, Overbought>65`);
  console.log(`   ADX Filter: < 25 (ranging market)`);
  console.log(`   Stop Loss: 1.5× ATR`);
  console.log(`   Take Profit: EMA (central line)`);
  console.log(`   Max Duration: 15 bars\n`);

  console.log('📈 Strategy Logic:');
  console.log('   1. LONG: Price <= Lower Keltner + RSI < 35 + ADX < 25');
  console.log('   2. SHORT: Price >= Upper Keltner + RSI > 65 + ADX < 25');
  console.log('   3. Exit: Price reaches EMA (mean reversion complete)\n');

  console.log(`✅ Strategy "${strategy.getName()}" initialized\n`);

  // Signal proximity check - publish every 10 seconds
  const PROXIMITY_CHECK_INTERVAL = 10000;
  const proximityCheckInterval = setInterval(async () => {
    if (typeof (strategy as any).getSignalReadiness === 'function') {
      for (const symbol of SYMBOLS) {
        const buffer = candleBuffers.get(symbol) || [];
        if (buffer.length >= 40) { // minCandles for Keltner MR
          try {
            const readiness = (strategy as any).getSignalReadiness(buffer);
            if (readiness) {
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
                asset: symbol,
                direction: readiness.direction,
                overallProximity: readiness.overallProximity,
                proximity: readiness.overallProximity, // For compatibility
                criteria,
                readyToSignal: readiness.readyToSignal,
                missingCriteria: readiness.missingCriteria || [],
              });
            }
          } catch (error) {
            // Skip silently
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

    // Warm-up check
    const assetWarmUpCount = warmUpCandlesPerAsset.get(asset) || 0;
    if (assetWarmUpCount < WARM_UP_CANDLES_REQUIRED) {
      const remaining = WARM_UP_CANDLES_REQUIRED - assetWarmUpCount;
      console.log(`\n⏳ Signal ignored during warm-up for ${asset}`);
      console.log(`   Candles: ${assetWarmUpCount}/${WARM_UP_CANDLES_REQUIRED} (need ${remaining} more)\n`);
      return;
    }

    // Risk checks using TradeManager
    const canTrade = tradeManager.canOpenTrade(asset);
    if (!canTrade.allowed) {
      console.log(`\n⚠️  SIGNAL IGNORED - ${canTrade.reason}`);
      console.log(`   Direction: ${signal.direction} | Asset: ${asset}\n`);
      return;
    }

    // Check session filter (forex 24/5)
    if (ENABLE_SESSION_FILTER) {
      const timestamp = signal.timestamp; // Already in milliseconds (Date.now())
      const sessionCheck = sessionFilter.shouldTradeDetailed(timestamp);

      if (!sessionCheck.canTrade) {
        const nextSession = sessionFilter.getMinutesToNextSession(timestamp);
        const nextInfo = nextSession
          ? ` (Next: ${nextSession.nextSession} in ${nextSession.minutesUntil} min)`
          : '';
        console.log(`\n⚠️  SIGNAL IGNORED - Session filter blocked`);
        console.log(`   Current Session: ${sessionCheck.session}`);
        console.log(`   Reason: ${sessionCheck.reason}${nextInfo}`);
        console.log(`   Direction: ${signal.direction} | Asset: ${asset}\n`);
        return;
      }

      // Log session info for debugging
      if (sessionCheck.session) {
        console.log(`\n🌍 Session: ${sessionCheck.session} | Stake: ${(sessionCheck.params.stakePct * 100).toFixed(0)}% | SL: x${sessionCheck.params.slMultiplier}`);
      }
    }

    // Check strategy balance using StrategyAccountant
    const riskContext = strategyAccountant.getRiskContext(STRATEGY_NAME);
    if (!riskContext || riskContext.balance <= 0) {
      console.log(`\n⚠️  SIGNAL IGNORED - Insufficient strategy balance`);
      console.log(`   Available: $${riskContext?.balance.toFixed(2) || '0.00'}\n`);
      return;
    }

    // Calculate base stake based on strategy allocation
    let baseStakeAmount = riskContext.balance * RISK_PERCENTAGE_CFD;

    // Apply session-based stake adjustment
    let stakeAmount = baseStakeAmount;
    if (ENABLE_SESSION_FILTER) {
      const timestamp = signal.timestamp; // Already in milliseconds
      const sessionParams = sessionFilter.getSessionParams(timestamp);
      stakeAmount = baseStakeAmount * sessionParams.stakePct;

      // Log stake adjustment if different from base
      if (sessionParams.stakePct !== 1.0) {
        console.log(`   💰 Stake adjusted: $${baseStakeAmount.toFixed(2)} → $${stakeAmount.toFixed(2)} (${(sessionParams.stakePct * 100).toFixed(0)}% of base)`);
      }
    }

    // Reserve stake in accountant
    if (!strategyAccountant.reserveStake(STRATEGY_NAME, stakeAmount)) {
      console.log(`\n⚠️  SIGNAL IGNORED - Could not reserve stake`);
      return;
    }

    strategyAccountant.incrementOpenPositions(STRATEGY_NAME);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 ${STRATEGY_NAME} SIGNAL - EXECUTING TRADE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Asset: ${asset}`);
    if (ENABLE_SESSION_FILTER) {
      const timestamp = signal.timestamp; // Already in milliseconds
      const sessionParams = sessionFilter.getSessionParams(timestamp);
      const session = sessionFilter.getSession(timestamp);
      console.log(`   Session: ${session} (Stake: ${(sessionParams.stakePct * 100).toFixed(0)}%, SL: x${sessionParams.slMultiplier})`);
    }
    console.log(`   Stake: $${stakeAmount.toFixed(2)} (${(RISK_PERCENTAGE_CFD * 100).toFixed(1)}% of strategy balance${ENABLE_SESSION_FILTER ? ' × session multiplier' : ''})`);
    console.log(`   Strategy Balance: $${riskContext.balance.toFixed(2)}`);
    console.log(`   Timestamp: ${new Date(signal.timestamp).toISOString()}`);
    if (signal.metadata) {
      console.log(`   Metadata:`, signal.metadata);
    }
    console.log(`${'='.repeat(80)}\n`);

    // Execute trade
    const result = await tradeExecutionService.executeTrade(signal, asset);
    if (result.success) {
      totalTrades++;

      if (slackAlerter) {
        slackAlerter.tradeOpened({
          symbol: asset,
          direction: signal.direction,
          stake: stakeAmount,
          entryPrice: (signal.metadata as any)?.currentPrice,
          confidence: signal.confidence,
          strategy: STRATEGY_NAME,
        });
      }
    } else {
      // Release stake if trade failed
      strategyAccountant.releaseStake(STRATEGY_NAME, stakeAmount);
      strategyAccountant.decrementOpenPositions(STRATEGY_NAME);
    }
  }

  // Listen for errors (handled in processStrategySignal)

  // Get balance
  try {
    const balanceInfo = await gatewayClient.getBalance();
    if (balanceInfo) {
      console.log(`💰 Account Balance: $${balanceInfo.amount.toFixed(2)}`);
      if (balanceInfo.loginid) {
        console.log(`📋 Account: ${balanceInfo.loginid} (${balanceInfo.accountType})`);
      }
      console.log(`💰 Strategy Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
      console.log();
    }
  } catch {
    console.warn('⚠️  Could not get balance\n');
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
      candleBuffers.set(symbol, [...candles]); // Store candles for strategy

      // Process historical candles through strategy (for warm-up)
      for (const candle of candles) {
        const signal = strategy.onCandle(candle, candleBuffers.get(symbol) || [], symbol);
        if (signal) {
          // Don't process signals during historical load
        }
        totalHistoricalCandles++;
      }
    } catch {
      console.warn(`   ⚠️  ${symbol}: Could not load historical candles`);
      candleBuffers.set(symbol, []); // Initialize empty buffer
    }
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  isInitializing = false;

  console.log(`\n✅ Loading complete (${totalHistoricalCandles} candles)\n`);
  console.log('📊 Warm-up status:');
  SYMBOLS.forEach(symbol => {
    const count = warmUpCandlesPerAsset.get(symbol) || 0;
    const status = count >= WARM_UP_CANDLES_REQUIRED ? '✅' : '⏳';
    const remaining = Math.max(0, WARM_UP_CANDLES_REQUIRED - count);
    console.log(`   ${status} ${symbol}: ${count}/${WARM_UP_CANDLES_REQUIRED}${remaining > 0 ? ` (need ${remaining} more)` : ''}`);
  });
  console.log();

  // Subscribe to assets
  console.log(`📡 Subscribing to: ${SYMBOLS.join(', ')}...`);
  await gatewayClient.follow(SYMBOLS);
  console.log('✅ Subscribed\n');

  console.log('✅ Strategy is now running!');
  console.log('⏳ Waiting for signals...\n');

  // TradeManager events
  tradeManager.on('trade:closed', async (data: { contractId: string; reason: string; profit?: number }) => {
    const contractId = data.contractId?.toString() || data.contractId;
    console.log(`\n📝 Trade closed: ${contractId} (${data.reason})`);

    if (processedTradeResults.has(contractId)) {
      console.log(`   ⏭️  Already processed, skipping duplicate`);
      return;
    }

    try {
      const allTrades = tradeManager.getTradeHistory();
      const trade = allTrades.find(t => t.contractId?.toString() === contractId);

      if (trade) {
        processedTradeResults.add(contractId);

        const profit = data.profit ?? 0;
        const result: 'WIN' | 'LOSS' = profit >= 0 ? 'WIN' : 'LOSS';

        if (result === 'WIN') {
          wonTrades++;
        } else {
          lostTrades++;
        }

        // Update strategy accounting
        const stakeAmount = trade.stake || 0;
        strategyAccountant.releaseStake(STRATEGY_NAME, stakeAmount);
        strategyAccountant.decrementOpenPositions(STRATEGY_NAME);
        strategyAccountant.recordTrade(STRATEGY_NAME, {
          contractId,
          symbol: trade.symbol,
          direction: trade.direction as 'CALL' | 'PUT',
          status: result === 'WIN' ? 'won' : 'lost',
          stake: stakeAmount,
          payout: result === 'WIN' ? stakeAmount + profit : 0,
          profit,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice || trade.entryPrice,
          entryTime: trade.entryTime || Date.now(),
          exitTime: Date.now(),
        });

        await gatewayClient.updateTrade({
          contractId: contractId,
          exitPrice: trade.exitPrice || trade.entryPrice,
          payout: Math.abs(profit),
          result,
          closedAt: new Date(),
          metadata: JSON.stringify({
            ...trade.metadata,
            closeReason: data.reason,
            closedBy: 'TradeManager',
            strategy: STRATEGY_NAME,
          }),
        });

        // Print strategy stats
        const stats = strategyAccountant.getStats(STRATEGY_NAME);
        const balance = strategyAccountant.getBalance(STRATEGY_NAME);

        console.log(`   ✅ Trade updated (${result})`);
        console.log(`   P&L: $${profit.toFixed(2)}`);
        console.log(`   Strategy Balance: $${balance.toFixed(2)}`);
        console.log(`   ROI: ${stats?.roi.toFixed(1)}%`);
        console.log(`   Win Rate: ${((stats?.winRate || 0) * 100).toFixed(1)}%`);

        if (slackAlerter) {
          slackAlerter.tradeClosed({
            symbol: trade.symbol,
            direction: trade.direction as 'CALL' | 'PUT',
            stake: stakeAmount,
            profit,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice || trade.entryPrice,
          });
        }
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

      if (!hasReceivedRealtimeCandle) {
        hasReceivedRealtimeCandle = true;
        console.log(`\n✅✅✅ FIRST REALTIME CANDLE RECEIVED ✅✅✅`);
        console.log(`   Asset: ${asset} | Timestamp: ${new Date(candle.timestamp * 1000).toISOString()}\n`);
      }

      // Update candle buffer
      const buffer = candleBuffers.get(asset) || [];
      buffer.push(candle);
      // Keep last 500 candles
      if (buffer.length > 500) {
        buffer.shift();
      }
      candleBuffers.set(asset, buffer);

      // Process candle through strategy
      try {
        const signal = strategy.onCandle(candle, buffer, asset);
        if (signal) {
          await processStrategySignal(signal, asset);
        }
      } catch (error: any) {
        console.error(`❌ Strategy error processing candle:`, error.message);
      }

      if (!isInitializing) {
        const currentCount = warmUpCandlesPerAsset.get(asset) || 0;
        if (currentCount < WARM_UP_CANDLES_REQUIRED) {
          const newCount = currentCount + 1;
          warmUpCandlesPerAsset.set(asset, newCount);

          if (newCount === WARM_UP_CANDLES_REQUIRED) {
            console.log(`\n✅✅✅ WARM-UP COMPLETE FOR ${asset} ✅✅✅`);
            console.log(`   Indicators stabilized. Ready for trades.\n`);
          }
        }
      }
    }
  });

  // Listen for trade results from Gateway
  gatewayClient.on('trade:result', async (data: any) => {
    const contractId = data.id?.toString() || data.id;
    console.log(`\n🎯 TRADE RESULT from Gateway: ${contractId}`);
    console.log(`   Result: ${data.result} | Profit: $${data.profit?.toFixed(2) || 'N/A'}`);

    if (processedTradeResults.has(contractId)) {
      console.log(`   ⏭️  Already processed, skipping duplicate`);
      return;
    }

    const allTrades = tradeManager.getTradeHistory();
    const trade = allTrades.find(t => t.contractId?.toString() === contractId);
    if (!trade) {
      console.log(`   ⚠️  Trade not found in history`);
      return;
    }

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

    // Update strategy accounting
    const stakeAmount = trade.stake || 0;
    strategyAccountant.releaseStake(STRATEGY_NAME, stakeAmount);
    strategyAccountant.decrementOpenPositions(STRATEGY_NAME);
    strategyAccountant.recordTrade(STRATEGY_NAME, {
      contractId,
      symbol: trade.symbol,
      direction: trade.direction as 'CALL' | 'PUT',
      status: won ? 'won' : 'lost',
      stake: stakeAmount,
      payout: won ? stakeAmount + profit : 0,
      profit,
      entryPrice: trade.entryPrice,
      exitPrice: data.closePrice || trade.entryPrice,
      entryTime: trade.entryTime || Date.now(),
      exitTime: Date.now(),
    });

    // Print strategy stats
    const stats = strategyAccountant.getStats(STRATEGY_NAME);
    const balance = strategyAccountant.getBalance(STRATEGY_NAME);

    console.log(`   P&L: $${profit.toFixed(2)}`);
    console.log(`   Strategy Balance: $${balance.toFixed(2)}`);
    console.log(`   ROI: ${stats?.roi.toFixed(1)}%`);
    console.log(`   Win Rate: ${((stats?.winRate || 0) * 100).toFixed(1)}%\n`);

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
          strategy: STRATEGY_NAME,
        }),
      });
    } catch (error: any) {
      console.error(`   ⚠️  Error updating trade: ${error.message}`);
    }

    if (slackAlerter && trade) {
      slackAlerter.tradeClosed({
        symbol: trade.symbol,
        direction: trade.direction as 'CALL' | 'PUT',
        stake: stakeAmount,
        profit,
        entryPrice: trade.entryPrice,
        exitPrice: data.closePrice || trade.entryPrice,
      });
    }
  });

  console.log('✅ Ready. Waiting for signals...\n');

  // Periodic summary
  const summaryInterval = setInterval(() => {
    if (totalTrades > 0) {
      const stats = strategyAccountant.getStats(STRATEGY_NAME);
      const balance = strategyAccountant.getBalance(STRATEGY_NAME);

      console.log(`\n📊 ${STRATEGY_NAME} SUMMARY:`);
      console.log(`   Trades: ${totalTrades} | Wins: ${wonTrades} | Losses: ${lostTrades}`);
      console.log(`   Balance: $${balance.toFixed(2)} | ROI: ${stats?.roi.toFixed(1)}%`);
      console.log(`   Win Rate: ${((stats?.winRate || 0) * 100).toFixed(1)}%`);

      const riskStats = tradeManager.getRiskStats();
      console.log(`   Open: ${riskStats.openTrades}/${riskStats.maxOpenTrades}\n`);
    }
  }, 60000);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping...');

    clearInterval(summaryInterval);
    tradeManager.stop();

    const stats = strategyAccountant.getStats(STRATEGY_NAME);
    const finalBalance = strategyAccountant.getBalance(STRATEGY_NAME);

    console.log('\n' + '='.repeat(80));
    console.log(`📊 ${STRATEGY_NAME} FINAL STATISTICS`);
    console.log('='.repeat(80));
    console.log(`   Initial Allocation: $${STRATEGY_ALLOCATION.toFixed(2)}`);
    console.log(`   Final Balance: $${finalBalance.toFixed(2)}`);
    console.log(`   Total Trades: ${totalTrades}`);
    console.log(`   Wins: ${wonTrades} | Losses: ${lostTrades}`);
    console.log(`   Win Rate: ${((stats?.winRate || 0) * 100).toFixed(2)}%`);
    console.log(`   Total P&L: $${stats?.totalPnL.toFixed(2)}`);
    console.log(`   ROI: ${stats?.roi.toFixed(2)}%`);
    console.log(`   Max Drawdown: ${stats?.maxDrawdown.toFixed(2)}%`);
    console.log('='.repeat(80));

    await gatewayClient.disconnect();
    console.log('✅ Shutdown complete');
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => { });
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
