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

import { GatewayClient, loadEnvFromRoot, getTelegramAlerter, initSlackAlerts } from '@deriv-bot/shared';
import { FVGLiquiditySweepStrategy } from '../strategies/fvg-liquidity-sweep.strategy.js';
import { UnifiedTradeAdapter, type TradeMode } from '../adapters/trade-adapter.js';
import { TradeManager } from '../trade-management/index.js';
import { TradeExecutionService } from '../services/trade-execution.service.js';
import { StrategyAccountant } from '../accounting/strategy-accountant.js';
import type { Candle, Tick, Signal } from '@deriv-bot/shared';
import dotenv from 'dotenv';

// Load environment variables
loadEnvFromRoot();
dotenv.config();

// Configuration
const STRATEGY_NAME = 'FVG-Liquidity-Sweep';
const TRADE_MODE: TradeMode = (process.env.TRADE_MODE as TradeMode) || 'cfd';
// Default to optimized forex pairs
const SYMBOLS_STR = process.env.SYMBOL || 'frxAUDUSD,frxEURUSD,frxGBPUSD,frxUSDCHF';
const SYMBOLS = SYMBOLS_STR.split(',').map(s => s.trim()).filter(s => s.length > 0);
const ACCOUNT_LOGINID = process.env.ACCOUNT_LOGINID;

// Strategy allocation (per-strategy balance)
const STRATEGY_ALLOCATION = parseFloat(process.env.STRATEGY_ALLOCATION || '1000');
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_CAPITAL || '10000');

// Risk parameters (relative to strategy allocation)
const RISK_PERCENTAGE_CFD = parseFloat(process.env.RISK_PERCENTAGE || '0.04'); // 4% per trade
const MULTIPLIER = parseInt(process.env.MULTIPLIER || '200');
const MAX_TRADES_PER_SYMBOL = 1;

// Tick processing state
const TIMEFRAME = 60; // 1 minute

// State per symbol
const symbolState: Record<string, {
  candles: Candle[];
  lastCandleTimestamp: number;
  currentCandle: Candle | null;
  strategy: FVGLiquiditySweepStrategy;
  tradeAdapter: UnifiedTradeAdapter;
  accountant: StrategyAccountant;
}> = {};

// Telegram alerter
let telegramAlerter: ReturnType<typeof getTelegramAlerter> | null = null;

/**
 * Initialize strategy for a symbol
 */
function initializeSymbol(symbol: string): void {
  const strategy = new FVGLiquiditySweepStrategy({
    name: `${STRATEGY_NAME}-${symbol}`,
    asset: symbol,
    version: '1.0.0',
    enabled: true,
  });

  const tradeAdapter = new UnifiedTradeAdapter(
    TRADE_MODE,
    symbol,
    STRATEGY_ALLOCATION,
    RISK_PERCENTAGE_CFD
  );

  const accountant = new StrategyAccountant(
    `${STRATEGY_NAME}-${symbol}`,
    STRATEGY_ALLOCATION
  );

  symbolState[symbol] = {
    candles: [],
    lastCandleTimestamp: 0,
    currentCandle: null,
    strategy,
    tradeAdapter,
    accountant,
  };

  console.log(`[${STRATEGY_NAME}] Initialized for ${symbol}`);
}

/**
 * Process a tick for a symbol
 */
async function processTick(
  symbol: string,
  tick: Tick,
  gateway: GatewayClient,
  tradeManager: TradeManager,
  executionService: TradeExecutionService
): Promise<void> {
  const state = symbolState[symbol];
  if (!state) return;

  const tickTime = tick.epoch * 1000;
  const candleStartTime = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);

  // Update or create current candle
  if (!state.currentCandle || candleStartTime > state.currentCandle.timestamp * 1000) {
    // Save previous candle if exists
    if (state.currentCandle && state.currentCandle.timestamp > state.lastCandleTimestamp) {
      state.candles.push(state.currentCandle);
      state.lastCandleTimestamp = state.currentCandle.timestamp;

      // Keep only last 500 candles
      if (state.candles.length > 500) {
        state.candles = state.candles.slice(-500);
      }

      // Process completed candle through strategy
      await processCandle(symbol, state.currentCandle, gateway, tradeManager, executionService);
    }

    // Start new candle
    state.currentCandle = {
      asset: symbol,
      timestamp: candleStartTime / 1000,
      open: tick.quote,
      high: tick.quote,
      low: tick.quote,
      close: tick.quote,
    };
  } else {
    // Update current candle
    state.currentCandle.high = Math.max(state.currentCandle.high, tick.quote);
    state.currentCandle.low = Math.min(state.currentCandle.low, tick.quote);
    state.currentCandle.close = tick.quote;
  }
}

/**
 * Process a completed candle
 */
async function processCandle(
  symbol: string,
  candle: Candle,
  gateway: GatewayClient,
  tradeManager: TradeManager,
  executionService: TradeExecutionService
): Promise<void> {
  const state = symbolState[symbol];
  if (!state) return;

  // Need minimum candles
  if (state.candles.length < 50) {
    return;
  }

  // Check if we already have a position
  const openPositions = tradeManager.getOpenPositionsForSymbol(symbol);
  if (openPositions.length >= MAX_TRADES_PER_SYMBOL) {
    return;
  }

  // Get signal from strategy
  try {
    const signal = await state.strategy.onCandle(candle, {
      candles: state.candles,
      currentPrice: candle.close,
      indicators: {},
    });

    if (signal) {
      console.log(`[${STRATEGY_NAME}] Signal for ${symbol}: ${signal.direction} @ ${candle.close}`);

      // Execute trade
      await executeTrade(signal, symbol, gateway, tradeManager, executionService);
    }
  } catch (error) {
    console.error(`[${STRATEGY_NAME}] Error processing candle for ${symbol}:`, error);
  }
}

/**
 * Execute a trade based on signal
 */
async function executeTrade(
  signal: Signal,
  symbol: string,
  gateway: GatewayClient,
  tradeManager: TradeManager,
  executionService: TradeExecutionService
): Promise<void> {
  const state = symbolState[symbol];
  if (!state) return;

  try {
    const tradeParams = state.tradeAdapter.convertSignalToTrade(signal, MULTIPLIER);

    console.log(`[${STRATEGY_NAME}] Executing ${tradeParams.direction} trade on ${symbol}`);
    console.log(`  Stake: $${tradeParams.stake}, Multiplier: x${MULTIPLIER}`);
    console.log(`  Reason: ${signal.reason}`);

    const result = await executionService.executeTrade({
      ...tradeParams,
      asset: symbol,
      strategyName: STRATEGY_NAME,
    });

    if (result.success) {
      console.log(`[${STRATEGY_NAME}] Trade opened: ${result.contractId}`);

      // Record in accountant
      state.accountant.recordTrade({
        id: result.contractId || `trade-${Date.now()}`,
        symbol,
        direction: tradeParams.direction,
        stake: tradeParams.stake,
        entryPrice: signal.snapshot?.price || 0,
        entryTime: new Date(),
        status: 'open',
      });

      // Send Telegram alert
      if (telegramAlerter) {
        await telegramAlerter.sendTradeAlert({
          strategy: STRATEGY_NAME,
          symbol,
          direction: tradeParams.direction,
          stake: tradeParams.stake,
          multiplier: MULTIPLIER,
          reason: signal.reason,
          confidence: signal.confidence,
        });
      }
    } else {
      console.error(`[${STRATEGY_NAME}] Trade failed:`, result.error);
    }
  } catch (error) {
    console.error(`[${STRATEGY_NAME}] Error executing trade:`, error);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log(`${STRATEGY_NAME} - Live Trading`);
  console.log('═'.repeat(60));
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Trade Mode: ${TRADE_MODE}`);
  console.log(`Strategy Allocation: $${STRATEGY_ALLOCATION}`);
  console.log(`Risk per Trade: ${RISK_PERCENTAGE_CFD * 100}%`);
  console.log(`Multiplier: x${MULTIPLIER}`);
  console.log('═'.repeat(60));

  // Initialize Telegram alerter
  try {
    telegramAlerter = getTelegramAlerter();
    console.log('[Telegram] Alerter initialized');
  } catch (error) {
    console.warn('[Telegram] Failed to initialize alerter:', error);
  }

  // Initialize Slack alerts
  try {
    initSlackAlerts();
    console.log('[Slack] Alerts initialized');
  } catch (error) {
    console.warn('[Slack] Failed to initialize alerts:', error);
  }

  // Initialize gateway client
  const gatewayUrl = process.env.GATEWAY_URL || 'ws://localhost:3000';
  const gateway = new GatewayClient(gatewayUrl);

  // Initialize services
  const tradeManager = new TradeManager();
  const executionService = new TradeExecutionService(gateway, tradeManager);

  // Initialize symbols
  for (const symbol of SYMBOLS) {
    initializeSymbol(symbol);
  }

  // Connect to gateway
  await gateway.connect();
  console.log('[Gateway] Connected');

  // Subscribe to ticks for each symbol
  for (const symbol of SYMBOLS) {
    gateway.on(`tick:${symbol}`, async (tick: Tick) => {
      await processTick(symbol, tick, gateway, tradeManager, executionService);
    });

    await gateway.subscribeTicks(symbol);
    console.log(`[Gateway] Subscribed to ${symbol} ticks`);
  }

  // Handle trade results
  gateway.on('trade:result', async (result: any) => {
    const symbol = result.symbol;
    const state = symbolState[symbol];
    if (!state) return;

    const pnl = result.profit || 0;
    state.accountant.recordTradeResult(result.contractId, pnl);

    console.log(`[${STRATEGY_NAME}] Trade result for ${symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);

    // Notify strategy of result for dynamic cooldown
    state.strategy.onTradeResult?.(pnl >= 0 ? 'WIN' : 'LOSS', pnl);

    // Send Telegram alert
    if (telegramAlerter) {
      await telegramAlerter.sendTradeResult({
        strategy: STRATEGY_NAME,
        symbol,
        pnl,
        outcome: pnl >= 0 ? 'WIN' : 'LOSS',
      });
    }
  });

  // Keep alive
  console.log('[FVG-LS] Strategy running... Press Ctrl+C to stop');

  // Periodic status report
  setInterval(() => {
    console.log('\n[Status Report]');
    for (const symbol of SYMBOLS) {
      const state = symbolState[symbol];
      if (state) {
        const stats = state.accountant.getStats();
        console.log(`  ${symbol}: ${state.candles.length} candles | Trades: ${stats.totalTrades} | P&L: $${stats.netPnl.toFixed(2)}`);
      }
    }
  }, 60000); // Every minute
}

// Run
main().catch(console.error);
