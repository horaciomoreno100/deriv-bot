/**
 * Command Handlers - Process commands from Trader clients
 *
 * Integrates DerivClient, MarketDataCache, and GatewayServer
 */

import type { WebSocket } from 'ws';
import type { CommandMessage } from '../ws/protocol.js';
import type { DerivClient } from '../api/deriv-client.js';
import type { MarketDataCache } from '../cache/market-data-cache.js';
import type { GatewayServer } from '../ws/gateway-server.js';
import type { StateManager } from '../state/state-manager.js';
import { createEventMessage } from '../ws/protocol.js';
import type { Tick, Candle } from '@deriv-bot/shared';
import { EventBus } from '../events/event-bus.js';

/**
 * CommandHandlerContext - Shared resources for command handlers
 */
export interface CommandHandlerContext {
  derivClient: DerivClient;
  marketCache: MarketDataCache;
  gatewayServer: GatewayServer;
  eventBus: EventBus;
  stateManager: StateManager;
}

/**
 * Subscription tracking
 */
const activeSubscriptions = new Map<string, string>(); // asset -> subscriptionId

/**
 * Portfolio cache to avoid rate limits
 */
interface PortfolioCacheEntry {
  positions: any[];
  timestamp: number;
}

const portfolioCache = new Map<string, PortfolioCacheEntry>(); // account -> cache entry
const PORTFOLIO_CACHE_TTL = 10000; // 10 seconds - return fresh cache immediately
const PORTFOLIO_STALE_TTL = 300000; // 5 minutes - use stale cache on errors

/**
 * Registered Traders tracking
 */
interface RegisteredTrader {
  id: string;
  name: string;
  strategy: string;
  symbols: string[];
  startedAt: number;
  ws: WebSocket;
  lastHeartbeat: number;
}

const registeredTraders = new Map<WebSocket, RegisteredTrader>();

/**
 * Signal Proximity Cache - stores latest proximity per asset
 */
interface SignalProximityEntry {
  asset: string;
  direction: 'call' | 'put' | 'neutral';
  proximity: number;
  criteria?: Array<{
    name: string;
    current: number;
    target: number;
    unit: string;
    passed: boolean;
    distance: number;
  }>;
  readyToSignal: boolean;
  missingCriteria?: string[];
  timestamp: number;
}

const signalProximityCache = new Map<string, SignalProximityEntry>(); // asset -> proximity

/**
 * Trader info returned by getRegisteredTraders
 */
interface TraderInfo {
  id: string;
  name: string;
  strategy: string;
  symbols: string[];
  startedAt: number;
  lastHeartbeat: number;
  uptime: number;
  isActive: boolean;
}

/**
 * Get registered traders info (for external use)
 * Only returns active traders (heartbeat within 5 minutes)
 */
export function getRegisteredTraders(): TraderInfo[] {
  const now = Date.now();
  const ACTIVE_THRESHOLD = 300000; // 5 minutes (heartbeat every 30s, so this is safe)
  
  // Clean up inactive traders (heartbeat older than 10 minutes)
  const INACTIVE_THRESHOLD = 600000; // 10 minutes
  for (const [ws, trader] of registeredTraders.entries()) {
    if (now - trader.lastHeartbeat > INACTIVE_THRESHOLD) {
      // Check if WebSocket is still open
      if (ws.readyState !== 1) { // 1 = OPEN
        console.log(`[getRegisteredTraders] Removing inactive trader: ${trader.name} (last heartbeat: ${Math.round((now - trader.lastHeartbeat) / 1000)}s ago)`);
        registeredTraders.delete(ws);
      }
    }
  }
  
  // Return only active traders
  return Array.from(registeredTraders.values())
    .filter(t => (now - t.lastHeartbeat) < ACTIVE_THRESHOLD)
    .map(t => ({
      id: t.id,
      name: t.name,
      strategy: t.strategy,
      symbols: t.symbols,
      startedAt: t.startedAt,
      lastHeartbeat: t.lastHeartbeat,
      uptime: now - t.startedAt,
      isActive: (now - t.lastHeartbeat) < 120000, // Active if heartbeat within 2 minutes
    }))
    .sort((a, b) => b.startedAt - a.startedAt); // Sort by most recent first
}

/**
 * Remove trader on disconnect
 */
export function unregisterTrader(ws: WebSocket): void {
  if (registeredTraders.has(ws)) {
    const trader = registeredTraders.get(ws)!;
    console.log(`[unregisterTrader] Trader disconnected: ${trader.name} (${trader.strategy})`);
    registeredTraders.delete(ws);
  }
}

/**
 * Handle 'follow' command
 * Subscribe to real-time ticks for assets
 *
 * @param force - If true, force re-subscription even if already subscribed
 *                Useful when health check detects stale tick streams
 */
export async function handleFollowCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, marketCache, gatewayServer, eventBus } = context;
  const { assets, force } = command.params as { assets: string[]; force?: boolean };

  console.log(`[handleFollowCommand] Starting follow for assets:`, assets, force ? '(FORCED)' : '');

  try {
    for (const asset of assets) {
      // Skip if already subscribed (unless force is true)
      if (activeSubscriptions.has(asset) && !force) {
        console.log(`[handleFollowCommand] Already subscribed to ${asset}, skipping`);
        continue;
      }

      // If forcing, unsubscribe first
      if (force && activeSubscriptions.has(asset)) {
        const oldSubscriptionId = activeSubscriptions.get(asset);
        console.log(`[handleFollowCommand] Force mode: unsubscribing ${asset} (sub ID: ${oldSubscriptionId})`);
        try {
          await derivClient.unsubscribe(oldSubscriptionId!);
        } catch (error) {
          console.log(`[handleFollowCommand] Could not unsubscribe ${asset} (may already be stale):`, error);
        }
        activeSubscriptions.delete(asset);
      }

      console.log(`[handleFollowCommand] Subscribing to ${asset}...`);

      // Subscribe to ticks from Deriv API
      const subscription = await derivClient.subscribeTicks(asset, (tick: Tick) => {
        console.log(`[Tick] ${asset}: ${tick.price}`);

        // Add to cache (automatically builds candles)
        marketCache.addTick(tick);

        // Broadcast tick event
        gatewayServer.broadcast(createEventMessage('tick', tick));
      });

      console.log(`[handleFollowCommand] Subscribed to ${asset}, subscription ID:`, subscription.id);
      activeSubscriptions.set(asset, subscription.id);
    }

    // Subscribe to candle events from cache
    eventBus.onTyped('candle:update', (data) => {
      gatewayServer.broadcast(createEventMessage('candle_update', data));
    });

    eventBus.onTyped('candle:closed', (data) => {
      gatewayServer.broadcast(createEventMessage('candle_closed', data));
    });

    console.log(`[handleFollowCommand] Sending success response`);

    // Send success response
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      assets,
      message: `Subscribed to ${assets.length} asset(s)`,
    });

    console.log(`[handleFollowCommand] Success response sent`);
  } catch (error) {
    console.error(`[handleFollowCommand] Error:`, error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'FOLLOW_ERROR',
      message: error instanceof Error ? error.message : 'Failed to subscribe',
    });
  }
}

/**
 * Handle 'unfollow' command
 * Unsubscribe from real-time ticks
 */
export async function handleUnfollowCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, marketCache, gatewayServer } = context;
  const { assets } = command.params as { assets: string[] };

  try {
    for (const asset of assets) {
      const subscriptionId = activeSubscriptions.get(asset);
      if (subscriptionId) {
        await derivClient.unsubscribe(subscriptionId);
        activeSubscriptions.delete(asset);

        // Clear cache for asset
        marketCache.clearAsset(asset);
      }
    }

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      assets,
      message: `Unsubscribed from ${assets.length} asset(s)`,
    });
  } catch (error) {
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'UNFOLLOW_ERROR',
      message: error instanceof Error ? error.message : 'Failed to unsubscribe',
    });
  }
}

/**
 * Handle 'balance' command
 * Get account balance
 */
export async function handleBalanceCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer } = context;

  console.log(`[handleBalanceCommand] Getting balance...`);

  try {
    const balance = await derivClient.getBalance();

    console.log(`[handleBalanceCommand] Balance retrieved:`, balance);

    gatewayServer.respondToCommand(ws, command.requestId!, true, balance);

    console.log(`[handleBalanceCommand] Response sent`);
  } catch (error) {
    console.error(`[handleBalanceCommand] Error:`, error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'BALANCE_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get balance',
    });
  }
}

/**
 * Handle 'portfolio' command
 * Get all open positions (with caching to avoid rate limits)
 *
 * For Multiplier (CFD) positions: Uses open trades from DB + proposal_open_contract API
 * For Binary positions: Uses standard portfolio API
 */
export async function handlePortfolioCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer, stateManager } = context;
  const { account } = (command.params || {}) as { account?: string };
  const accountKey = account || 'current';

  // Check cache first
  const cached = portfolioCache.get(accountKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < PORTFOLIO_CACHE_TTL) {
    // Return cached data
    console.log(`[handlePortfolioCommand] Returning cached portfolio for ${accountKey} (age: ${now - cached.timestamp}ms)`);
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      positions: cached.positions,
      count: cached.positions.length,
      totalProfit: cached.positions.reduce((sum: number, pos: any) => sum + (pos.profit || 0), 0),
      cached: true,
    });
    return;
  }

  console.log(`[handlePortfolioCommand] Getting portfolio${account ? ` for account ${account}` : ''}...`);

  try {
    // Get standard portfolio (Binary options)
    const binaryPositions = await derivClient.getPortfolio(account);
    console.log(`[handlePortfolioCommand] Found ${binaryPositions.length} binary position(s)`);

    // Get open trades from DB (for Multiplier/CFD positions)
    const openTrades = await stateManager.getOpenTrades();
    const multiplierTrades = openTrades.filter(t => t.tradeMode === 'cfd');
    console.log(`[handlePortfolioCommand] Found ${multiplierTrades.length} open CFD trade(s) in DB`);

    let multiplierPositions: any[] = [];

    // If we have open Multiplier trades, get live P/L from Deriv API
    if (multiplierTrades.length > 0) {
      const contractIds = multiplierTrades.map(t => t.contractId);
      console.log(`[handlePortfolioCommand] Querying live P/L for contracts: ${contractIds.join(', ')}`);

      try {
        multiplierPositions = await derivClient.getMultiplierPositions(contractIds);
        console.log(`[handlePortfolioCommand] Got live data for ${multiplierPositions.length} Multiplier position(s)`);
      } catch (err) {
        console.warn(`[handlePortfolioCommand] Failed to get Multiplier positions:`, err);
        // Fall back to DB data without live P/L
        multiplierPositions = multiplierTrades.map(t => ({
          contractId: t.contractId,
          symbol: t.asset,
          contractType: t.type,
          buyPrice: t.stake,
          currentPrice: t.entryPrice,
          profit: 0, // Unknown without API
          profitPercentage: 0,
          purchaseTime: t.openedAt,
          status: 'open' as const,
          isSold: false,
          multiplier: t.multiplier,
          direction: t.type === 'MULTUP' ? 'CALL' : 'PUT',
        }));
      }
    }

    // Combine all positions
    const allPositions = [...binaryPositions, ...multiplierPositions];
    console.log(`[handlePortfolioCommand] Total positions: ${allPositions.length}`);

    // Update cache
    portfolioCache.set(accountKey, {
      positions: allPositions,
      timestamp: now,
    });

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      positions: allPositions,
      count: allPositions.length,
      totalProfit: allPositions.reduce((sum, pos) => sum + (pos.profit || 0), 0),
      cached: false,
    });

    console.log(`[handlePortfolioCommand] Response sent`);
  } catch (error) {
    console.error(`[handlePortfolioCommand] Error:`, error);

    // If we have cached data within stale TTL, return it on any error (timeout, rate limit, etc.)
    if (cached && (now - cached.timestamp) < PORTFOLIO_STALE_TTL) {
      const cacheAge = Math.round((now - cached.timestamp) / 1000);
      console.log(`[handlePortfolioCommand] Error occurred, returning stale cache (age: ${cacheAge}s)`);
      gatewayServer.respondToCommand(ws, command.requestId!, true, {
        positions: cached.positions,
        count: cached.positions.length,
        totalProfit: cached.positions.reduce((sum: number, pos: any) => sum + (pos.profit || 0), 0),
        cached: true,
        stale: true,
        cacheAge,
      });
      return;
    }

    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'PORTFOLIO_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get portfolio',
    });
  }
}

/**
 * Handle 'multiplier_positions' command
 * Get Multiplier positions by Contract IDs using proposal_open_contract API
 *
 * This is necessary because the portfolio API does NOT return Multiplier contracts (MULTUP/MULTDOWN).
 */
export async function handleMultiplierPositionsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer } = context;
  const { contractIds } = (command.params || {}) as { contractIds: string[] };

  if (!contractIds || contractIds.length === 0) {
    console.log(`[handleMultiplierPositionsCommand] No contract IDs provided`);
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      positions: [],
      count: 0,
      totalProfit: 0,
    });
    return;
  }

  console.log(`[handleMultiplierPositionsCommand] Getting ${contractIds.length} Multiplier position(s)...`);

  try {
    const positions = await derivClient.getMultiplierPositions(contractIds);

    console.log(`[handleMultiplierPositionsCommand] Found ${positions.length} open Multiplier position(s)`);

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      positions,
      count: positions.length,
      totalProfit: positions.reduce((sum, pos) => sum + pos.profit, 0),
    });

    console.log(`[handleMultiplierPositionsCommand] Response sent`);
  } catch (error) {
    console.error(`[handleMultiplierPositionsCommand] Error:`, error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'MULTIPLIER_POSITIONS_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get Multiplier positions',
    });
  }
}

/**
 * Handle 'profit_table' command
 * Get closed contracts history
 */
export async function handleProfitTableCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer } = context;
  const params = (command.params || {}) as {
    limit?: number;
    offset?: number;
    dateFrom?: number;
    dateTo?: number;
    sort?: 'ASC' | 'DESC';
    contractType?: string[];
  };

  console.log(`[handleProfitTableCommand] Getting profit table with options:`, params);

  try {
    const contracts = await derivClient.getProfitTable(params);

    console.log(`[handleProfitTableCommand] Found ${contracts.length} closed contract(s)`);

    const totalProfit = contracts.reduce((sum, contract) => sum + contract.profit, 0);
    const totalWins = contracts.filter(c => c.profit > 0).length;
    const totalLosses = contracts.filter(c => c.profit < 0).length;

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      contracts,
      count: contracts.length,
      totalProfit,
      wins: totalWins,
      losses: totalLosses,
      winRate: contracts.length > 0 ? (totalWins / contracts.length) * 100 : 0,
    });

    console.log(`[handleProfitTableCommand] Response sent (${contracts.length} contracts, profit: ${totalProfit.toFixed(2)})`);
  } catch (error) {
    console.error(`[handleProfitTableCommand] Error:`, error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'PROFIT_TABLE_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get profit table',
    });
  }
}

/**
 * Handle 'instruments' command
 * Get available trading symbols
 */
export async function handleInstrumentsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer } = context;

  try {
    const symbols = await derivClient.getActiveSymbols();

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      instruments: symbols,
      count: symbols.length,
    });
  } catch (error) {
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'INSTRUMENTS_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get instruments',
    });
  }
}

/**
 * Handle 'history' command
 * Get historical candles
 */
export async function handleHistoryCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, marketCache, gatewayServer } = context;
  const { asset, timeframe, count, end } = command.params as {
    asset: string;
    timeframe: number;
    count: number;
    end?: 'latest' | number;
  };

  try {
    let candles: Candle[] = [];

    // Try to get from cache first
    const cachedCandles = marketCache.getCandles(asset, timeframe, count);

    if (cachedCandles.length >= count) {
      // Cache has enough data
      candles = cachedCandles;
    } else {
      // Fetch from Deriv API
      const endTime = end === 'latest' ? Math.floor(Date.now() / 1000) : end;
      candles = await derivClient.getCandles(asset, {
        granularity: timeframe,
        count,
        end: endTime,
      });

      // Add to cache
      candles.forEach((candle) => {
        marketCache.addTick({
          asset: candle.asset,
          price: candle.close,
          timestamp: candle.timestamp * 1000,
        });
      });
    }

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      asset,
      timeframe,
      candles,
      count: candles.length,
    });
  } catch (error) {
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'HISTORY_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get history',
    });
  }
}

/**
 * Handle 'get_assets' command
 * Get list of tracked assets
 */
export async function handleGetAssetsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { marketCache, gatewayServer } = context;

  try {
    const assets = marketCache.getTrackedAssets();

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      assets,
      count: assets.length,
    });
  } catch (error) {
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'GET_ASSETS_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get assets',
    });
  }
}

/**
 * Handle 'get_ticks' command
 * Get recent ticks from cache
 */
export async function handleGetTicksCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { marketCache, gatewayServer } = context;
  const { asset, count } = command.params as { asset: string; count?: number };

  try {
    const ticks = marketCache.getTicks(asset, count);

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      asset,
      ticks,
      count: ticks.length,
    });
  } catch (error) {
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'GET_TICKS_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get ticks',
    });
  }
}

/**
 * Handle 'get_candles' command
 * Get recent candles from cache or fetch from API if needed
 */
export async function handleGetCandlesCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { marketCache, gatewayServer, derivClient } = context;
  const { asset, timeframe, count, end } = command.params as {
    asset: string;
    timeframe: number;
    count?: number;
    end?: number; // Unix timestamp in seconds - get candles BEFORE this time
  };

  console.log(`[handleGetCandlesCommand] Getting candles for ${asset}, timeframe: ${timeframe}, count: ${count || 'all'}, end: ${end || 'latest'}`);

  try {
    // Si se especifica 'end', siempre ir al API (no al cache)
    // porque el cache solo tiene datos recientes
    let candles: Candle[];

    if (end) {
      console.log(`[handleGetCandlesCommand] Fetching historical data from Deriv API before timestamp ${end}...`);
      try {
        const historicalCandles = await derivClient.getCandles(asset, {
          count: count || 100,
          granularity: timeframe,
          end: end, // Pedir datos ANTES de este timestamp
        });

        console.log(`[handleGetCandlesCommand] Deriv API returned ${historicalCandles.length} candles`);
        candles = historicalCandles;
      } catch (apiError) {
        console.error(`[handleGetCandlesCommand] Error fetching from API:`, apiError);
        candles = [];
      }
    } else {
      // Sin 'end', usar cache o datos más recientes
      candles = marketCache.getCandles(asset, timeframe, count);
      console.log(`[handleGetCandlesCommand] Cache returned ${candles.length} candles`);

      // Si el cache está vacío o tiene muy pocas candles, obtener del API
      if (candles.length < 30 && count && count > candles.length) {
        console.log(`[handleGetCandlesCommand] Cache insufficient, fetching from Deriv API...`);

        try {
          const historicalCandles = await derivClient.getCandles(asset, {
            count: count || 100,
            granularity: timeframe,
          });

          console.log(`[handleGetCandlesCommand] Deriv API returned ${historicalCandles.length} candles`);
          candles = historicalCandles;
        } catch (apiError) {
          console.error(`[handleGetCandlesCommand] Error fetching from API:`, apiError);
        }
      }
    }

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      asset,
      timeframe,
      candles,
      count: candles.length,
    });

    console.log(`[handleGetCandlesCommand] Sent ${candles.length} candles to client`);
  } catch (error) {
    console.error(`[handleGetCandlesCommand] Error:`, error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'GET_CANDLES_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get candles',
    });
  }
}

/**
 * Handle 'trade' command
 * Execute a trade and persist to database
 */
export async function handleTradeCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer, stateManager, marketCache } = context;
  const { asset, direction, amount, duration, durationUnit, strategyName } = command.params as {
    asset: string;
    direction: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    durationUnit: 's' | 'm' | 'h' | 'd';
    strategyName?: string;
  };

  try {
    // Get current price for entry price
    const currentTick = marketCache.getTicks(asset, 1)[0];
    const entryPrice = currentTick?.price || 0;

    // Execute trade
    const result = await derivClient.buyContract({
      symbol: asset,
      contractType: direction,
      amount,
      duration,
      durationUnit,
    });

    // Calculate duration in seconds
    let durationSeconds = duration;
    if (durationUnit === 'm') durationSeconds *= 60;
    else if (durationUnit === 'h') durationSeconds *= 3600;
    else if (durationUnit === 'd') durationSeconds *= 86400;

    // Calculate expiry time
    const expiryTime = new Date(result.purchaseTime * 1000);
    expiryTime.setSeconds(expiryTime.getSeconds() + durationSeconds);

    // Record trade in State Manager
    await stateManager.recordTrade({
      contractId: result.contractId,
      type: direction,
      tradeMode: 'binary',
      asset,
      timeframe: durationSeconds,
      entryPrice,
      stake: result.buyPrice,
      expiryTime,
      strategyName: strategyName || 'manual',
    });

    console.log(`[handleTradeCommand] Trade recorded: ${result.contractId}`);

    // Broadcast trade executed event
    gatewayServer.broadcast(
      createEventMessage('trade:executed', {
        id: result.contractId,
        asset,
        direction,
        amount,
        duration,
        openPrice: result.buyPrice,
        timestamp: result.purchaseTime,
        status: 'open',
      })
    );

    // Subscribe to contract updates to get final result
    await derivClient.subscribeToContract(result.contractId, async (update: any) => {
      if (update.proposal_open_contract?.is_sold) {
        const contract = update.proposal_open_contract;
        const sellPrice = parseFloat(contract.sell_price);
        const buyPrice = parseFloat(contract.buy_price);
        const payout = parseFloat(contract.payout || '0');
        const profit = sellPrice - buyPrice;
        const result = profit > 0 ? 'WIN' : 'LOSS';

        // Update trade in State Manager
        await stateManager.updateTrade(contract.contract_id.toString(), {
          exitPrice: parseFloat(contract.exit_tick_display_value || contract.current_spot_display_value),
          payout,
          result,
          closedAt: new Date(contract.sell_time * 1000),
        });

        console.log(`[handleTradeCommand] Trade updated: ${contract.contract_id} - ${result}`);

        // Broadcast trade result event
        gatewayServer.broadcast(
          createEventMessage('trade:result', {
            id: contract.contract_id,
            asset,
            result: result === 'WIN' ? 'won' : 'lost',
            profit,
            closePrice: sellPrice,
            timestamp: contract.sell_time,
          })
        );
      }
    });

    // Send success response
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      contractId: result.contractId,
      buyPrice: result.buyPrice,
      payout: result.payout,
      startTime: result.startTime,
      purchaseTime: result.purchaseTime,
      message: `Trade executed: ${direction} ${asset} for ${amount}`,
    });
  } catch (error) {
    console.error('[handleTradeCommand] Error:', error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'TRADE_ERROR',
      message: error instanceof Error ? error.message : 'Failed to execute trade',
    });
  }
}

/**
 * Handle 'trade_cfd' command
 * Execute CFD/Multiplier trade
 */
export async function handleCFDTradeCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, gatewayServer, stateManager, marketCache } = context;
  const { asset, direction, amount, multiplier, duration, durationUnit, takeProfit, stopLoss, strategyName, account } = command.params as {
    asset: string;
    direction: 'MULTUP' | 'MULTDOWN';
    amount: number;
    multiplier: number;
    duration?: number;
    durationUnit?: 's' | 'm' | 'h' | 'd';
    takeProfit?: number;
    stopLoss?: number;
    strategyName?: string;
    account?: string; // Optional: specific loginid or 'current'
  };

  console.log(`[handleCFDTradeCommand] Executing CFD trade: ${direction} ${asset}, amount: ${amount}, multiplier: ${multiplier}`);

  try {
    // Get current price for entry price
    const currentTick = marketCache.getTicks(asset, 1)[0];
    const entryPrice = currentTick?.price || 0;

    // Execute CFD trade
    // If account is specified, use it; otherwise DerivClient will use its defaultAccount
    const result = await derivClient.buyCFD({
      symbol: asset,
      contractType: direction,
      amount,
      multiplier,
      duration,
      durationUnit,
      takeProfit,
      stopLoss,
      account: account, // Optional: if not specified, DerivClient uses defaultAccount from config
    });

    console.log(`[handleCFDTradeCommand] CFD trade executed: ${result.contractId}`);

    // Calculate duration in seconds (if provided, otherwise CFDs can be closed manually)
    let durationSeconds = duration || 0;
    if (duration && durationUnit) {
      if (durationUnit === 'm') durationSeconds *= 60;
      else if (durationUnit === 'h') durationSeconds *= 3600;
      else if (durationUnit === 'd') durationSeconds *= 86400;
    }

    // Calculate expiry time (if duration provided, otherwise use a default for tracking)
    const expiryTime = new Date(result.purchaseTime * 1000);
    if (durationSeconds > 0) {
      expiryTime.setSeconds(expiryTime.getSeconds() + durationSeconds);
    } else {
      // Default to 24 hours for CFDs without explicit duration (for tracking purposes)
      expiryTime.setHours(expiryTime.getHours() + 24);
    }

    // Record trade in State Manager
    await stateManager.recordTrade({
      contractId: result.contractId,
      type: direction === 'MULTUP' ? 'BUY' : 'SELL',
      tradeMode: 'cfd',
      asset,
      timeframe: durationSeconds || null, // CFDs don't use timeframes
      entryPrice,
      stake: result.buyPrice,
      expiryTime,
      strategyName: strategyName || 'manual',
    });

    console.log(`[handleCFDTradeCommand] Trade recorded: ${result.contractId}`);

    // Broadcast trade executed event
    gatewayServer.broadcast(
      createEventMessage('trade:executed', {
        id: result.contractId,
        asset,
        direction: direction === 'MULTUP' ? 'BUY' : 'SELL',
        amount,
        multiplier,
        duration,
        openPrice: entryPrice, // Use market price, not buyPrice (stake)
        stake: result.buyPrice, // Include stake separately
        timestamp: result.purchaseTime,
        status: 'open',
        takeProfit,
        stopLoss,
      })
    );

    // Subscribe to contract updates to get final result
    await derivClient.subscribeToContract(result.contractId, async (update: any) => {
      if (update.proposal_open_contract?.is_sold) {
        const contract = update.proposal_open_contract;
        const sellPrice = parseFloat(contract.sell_price);
        // Use profit directly from API - it's already calculated correctly by Deriv
        const profit = parseFloat(contract.profit) || (sellPrice - parseFloat(contract.buy_price));
        const tradeResult = profit >= 0 ? 'WIN' : 'LOSS';

        console.log(`[handleCFDTradeCommand] Contract ${contract.contract_id} closed:`)
        console.log(`   Sell Price: ${sellPrice}, Profit: ${profit}, Result: ${tradeResult}`);

        // Update trade in State Manager
        await stateManager.updateTrade(contract.contract_id.toString(), {
          exitPrice: parseFloat(contract.exit_tick_display_value || contract.current_spot_display_value),
          payout: profit,
          result: tradeResult,
          closedAt: new Date(contract.sell_time * 1000),
        });

        console.log(`[handleCFDTradeCommand] Trade updated: ${contract.contract_id} - ${tradeResult}`);

        // Broadcast trade result event
        // Note: contract_id is sent as string to match tradeHistory storage
        gatewayServer.broadcast(
          createEventMessage('trade:result', {
            id: contract.contract_id.toString(),
            asset,
            result: tradeResult === 'WIN' ? 'won' : 'lost',
            profit,
            closePrice: sellPrice,
            timestamp: contract.sell_time,
          })
        );
      }
    });

    // Send success response
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      contractId: result.contractId,
      buyPrice: result.buyPrice,
      startTime: result.startTime,
      purchaseTime: result.purchaseTime,
      message: `CFD trade executed: ${direction} ${asset} for ${amount} with multiplier ${multiplier}`,
    });
  } catch (error) {
    console.error('[handleCFDTradeCommand] Error:', error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'CFD_TRADE_ERROR',
      message: error instanceof Error ? error.message : 'Failed to execute CFD trade',
    });
  }
}

/**
 * Handle 'get_stats' command
 * Get trading statistics for a date
 */
export async function handleGetStatsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer, stateManager } = context;
  const { date } = (command.params || {}) as { date?: string };

  try {
    const stats = await stateManager.getDailyStats(date);

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      stats,
      date: stats.date,
    });
  } catch (error) {
    console.error('[handleGetStatsCommand] Error:', error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'GET_STATS_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get statistics',
    });
  }
}

/**
 * Handle 'get_trades' command
 * Get trade history with optional filters
 */
export async function handleGetTradesCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer, stateManager } = context;
  const { limit, asset, strategy, result, from, to } = command.params as {
    limit?: number;
    asset?: string;
    strategy?: string;
    result?: 'WIN' | 'LOSS' | 'PENDING';
    from?: string;
    to?: string;
  };

  try {
    const trades = await stateManager.getTrades({
      limit,
      asset,
      strategy,
      result,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      trades,
      count: trades.length,
    });
  } catch (error) {
    console.error('[handleGetTradesCommand] Error:', error);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'GET_TRADES_ERROR',
      message: error instanceof Error ? error.message : 'Failed to get trades',
    });
  }
}

/**
 * Handle 'ping' command
 * Keep-alive / health check
 */
export async function handlePingCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;

  gatewayServer.respondToCommand(ws, command.requestId!, true, {
    message: 'pong',
    timestamp: Date.now(),
  });
}

/**
 * Route command to appropriate handler
 */
export async function handleCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  switch (command.command) {
    case 'follow':
      await handleFollowCommand(ws, command, context);
      break;
    case 'unfollow':
      await handleUnfollowCommand(ws, command, context);
      break;
    case 'balance':
      await handleBalanceCommand(ws, command, context);
      break;
    case 'portfolio':
      await handlePortfolioCommand(ws, command, context);
      break;
    case 'multiplier_positions':
      await handleMultiplierPositionsCommand(ws, command, context);
      break;
    case 'profit_table':
      await handleProfitTableCommand(ws, command, context);
      break;
    case 'instruments':
      await handleInstrumentsCommand(ws, command, context);
      break;
    case 'history':
      await handleHistoryCommand(ws, command, context);
      break;
    case 'trade':
      await handleTradeCommand(ws, command, context);
      break;
    case 'trade_cfd':
      await handleCFDTradeCommand(ws, command, context);
      break;
    case 'get_assets':
      await handleGetAssetsCommand(ws, command, context);
      break;
    case 'get_ticks':
      await handleGetTicksCommand(ws, command, context);
      break;
    case 'get_candles':
      await handleGetCandlesCommand(ws, command, context);
      break;
    case 'get_stats':
      await handleGetStatsCommand(ws, command, context);
      break;
    case 'get_trades':
      await handleGetTradesCommand(ws, command, context);
      break;
    case 'ping':
      await handlePingCommand(ws, command, context);
      break;
    case 'update_indicators':
      await handleUpdateIndicatorsCommand(ws, command, context);
      break;
    case 'publish_signal_proximity':
      await handlePublishSignalProximityCommand(ws, command, context);
      break;
    case 'record_trade':
      await handleRecordTradeCommand(ws, command, context);
      break;
    case 'update_trade':
      await handleUpdateTradeCommand(ws, command, context);
      break;
    case 'register_trader':
      await handleRegisterTraderCommand(ws, command, context);
      break;
    case 'get_bot_info':
      await handleGetBotInfoCommand(ws, command, context);
      break;
    case 'heartbeat':
      await handleHeartbeatCommand(ws, command, context);
      break;
    case 'get_signal_proximities':
      await handleGetSignalProximitiesCommand(ws, command, context);
      break;
    case 'get_server_status':
      await handleGetServerStatusCommand(ws, command, context);
      break;
    case 'get_logs':
      await handleGetLogsCommand(ws, command, context);
      break;
    default:
      context.gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
        code: 'UNKNOWN_COMMAND',
        message: `Unknown command: ${command.command}`,
      });
  }
}

/**
 * Handle 'update_indicators' command
 * Receives indicators from Trader and broadcasts to all clients
 */
export async function handleUpdateIndicatorsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;
  const indicators = command.params;

  console.log('[handleUpdateIndicatorsCommand] Received indicators:', indicators);

  // Broadcast indicators to all connected clients
  gatewayServer.broadcast({
    type: 'indicators',
    data: indicators,
    timestamp: Date.now(),
  });

  console.log('[handleUpdateIndicatorsCommand] Broadcasted to clients');

  // Acknowledge receipt
  gatewayServer.respondToCommand(ws, command.requestId!, true, { received: true });
}

/**
 * Handle 'publish_signal_proximity' command
 * Broadcast signal proximity to all connected clients
 */
export async function handlePublishSignalProximityCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;
  const proximity = command.params;

  console.log('[handlePublishSignalProximityCommand] Received signal proximity:', {
    asset: proximity?.asset,
    proximity: proximity?.overallProximity,
    direction: proximity?.direction,
  });

  // Store in cache for later retrieval via get_signal_proximities command
  if (proximity?.asset) {
    signalProximityCache.set(proximity.asset, {
      asset: proximity.asset,
      direction: proximity.direction || 'neutral',
      proximity: proximity.overallProximity || proximity.proximity || 0,
      criteria: proximity.criteria,
      readyToSignal: proximity.readyToSignal || false,
      missingCriteria: proximity.missingCriteria,
      timestamp: Date.now(),
    });
  }

  // Broadcast signal proximity to all connected clients
  gatewayServer.broadcast({
    type: 'signal:proximity',
    data: proximity,
    timestamp: Date.now(),
  });

  console.log('[handlePublishSignalProximityCommand] Broadcasted to clients');

  // Acknowledge receipt
  gatewayServer.respondToCommand(ws, command.requestId!, true, { received: true });
}

/**
 * Handle 'record_trade' command
 * Saves trade information to database for analysis
 */
export async function handleRecordTradeCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { stateManager, gatewayServer } = context;

  // Validate that params exists
  if (!command.params) {
    console.error('[handleRecordTradeCommand] ❌ Missing params');
    gatewayServer.respondToCommand(ws, command.requestId!, false, {
      error: 'Missing trade data in command params'
    });
    return;
  }

  const tradeData = command.params as any;

  // Validate required fields
  if (!tradeData.contractId || !tradeData.type || !tradeData.asset ||
      !tradeData.entryPrice || !tradeData.stake || !tradeData.strategyName) {
    console.error('[handleRecordTradeCommand] ❌ Missing required fields');
    gatewayServer.respondToCommand(ws, command.requestId!, false, {
      error: 'Missing required trade fields (contractId, type, asset, entryPrice, stake, strategyName)'
    });
    return;
  }

  console.log('[handleRecordTradeCommand] Recording trade:', {
    contractId: tradeData.contractId,
    asset: tradeData.asset,
    type: tradeData.type,
    tradeMode: tradeData.tradeMode,
  });

  try {
    // Calculate expiryTime if not provided
    // For CFDs without duration, set to 24 hours from now
    // For binary options with timeframe, calculate from timeframe
    let expiryTime: Date;
    if (tradeData.expiryTime) {
      expiryTime = new Date(tradeData.expiryTime);
    } else if (tradeData.timeframe) {
      // Binary option with timeframe in seconds
      expiryTime = new Date(Date.now() + tradeData.timeframe * 1000);
    } else {
      // Default to 24 hours for CFDs
      expiryTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    // Record the trade in database
    await stateManager.recordTrade({
      contractId: tradeData.contractId,
      type: tradeData.type,
      tradeMode: tradeData.tradeMode || 'binary',
      asset: tradeData.asset,
      timeframe: tradeData.timeframe || null,
      entryPrice: tradeData.entryPrice,
      stake: tradeData.stake,
      strategyName: tradeData.strategyName,
      expiryTime,

      // CFD-specific
      multiplier: tradeData.multiplier || null,
      takeProfit: tradeData.takeProfit || null,
      stopLoss: tradeData.stopLoss || null,
      takeProfitAmount: tradeData.takeProfitAmount || null,
      stopLossAmount: tradeData.stopLossAmount || null,

      // Signal context
      signalType: tradeData.signalType || null,
      confidence: tradeData.confidence || null,

      // Indicators
      rsi: tradeData.rsi || null,
      bbUpper: tradeData.bbUpper || null,
      bbMiddle: tradeData.bbMiddle || null,
      bbLower: tradeData.bbLower || null,
      atr: tradeData.atr || null,

      // Additional context
      bbDistancePct: tradeData.bbDistancePct || null,
      priceVsMiddle: tradeData.priceVsMiddle || null,

      // Balance tracking
      balanceBefore: tradeData.balanceBefore || null,

      // Metadata (store extra context as JSON string)
      // Note: metadata is already JSON.stringify'd by the client
      metadata: tradeData.metadata || null,
    });

    console.log('[handleRecordTradeCommand] ✅ Trade recorded successfully');

    // Acknowledge success
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      recorded: true,
      contractId: tradeData.contractId
    });

  } catch (error: any) {
    console.error('[handleRecordTradeCommand] ❌ Error recording trade:', error.message);
    gatewayServer.respondToCommand(ws, command.requestId!, false, {
      error: error.message
    });
  }
}

/**
 * Handle 'update_trade' command
 * Updates trade information when it closes (result, profit, exit price)
 */
export async function handleUpdateTradeCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { stateManager, gatewayServer } = context;

  // Validate that params exists
  if (!command.params) {
    console.error('[handleUpdateTradeCommand] ❌ Missing params');
    gatewayServer.respondToCommand(ws, command.requestId!, false, {
      error: 'Missing trade update data in command params'
    });
    return;
  }

  const updateData = command.params as any;

  // Validate required fields
  if (!updateData.contractId) {
    console.error('[handleUpdateTradeCommand] ❌ Missing contractId');
    gatewayServer.respondToCommand(ws, command.requestId!, false, {
      error: 'Missing required field: contractId'
    });
    return;
  }

  console.log('[handleUpdateTradeCommand] Updating trade:', {
    contractId: updateData.contractId,
    result: updateData.result,
    exitPrice: updateData.exitPrice,
    payout: updateData.payout,
  });

  try {
    // Update the trade in database
    await stateManager.updateTrade(updateData.contractId, {
      exitPrice: updateData.exitPrice,
      payout: updateData.payout,
      result: updateData.result,
      closedAt: updateData.closedAt ? new Date(updateData.closedAt) : new Date(),
      metadata: updateData.metadata,
    });

    console.log('[handleUpdateTradeCommand] ✅ Trade updated successfully');

    // Acknowledge success
    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      updated: true,
      contractId: updateData.contractId
    });

  } catch (error: any) {
    console.error('[handleUpdateTradeCommand] ❌ Error updating trade:', error.message);
    gatewayServer.respondToCommand(ws, command.requestId!, false, {
      error: error.message
    });
  }
}

/**
 * Handle 'register_trader' command
 * Registers a trader with its strategy info for monitoring
 */
export async function handleRegisterTraderCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;
  const params = command.params as {
    id?: string;
    name: string;
    strategy: string;
    symbols: string[];
  };

  if (!params.name || !params.strategy) {
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'INVALID_PARAMS',
      message: 'Missing required params: name, strategy',
    });
    return;
  }

  const trader: RegisteredTrader = {
    id: params.id || `trader-${Date.now()}`,
    name: params.name,
    strategy: params.strategy,
    symbols: params.symbols || [],
    startedAt: Date.now(),
    ws,
    lastHeartbeat: Date.now(),
  };

  registeredTraders.set(ws, trader);

  console.log(`[handleRegisterTraderCommand] ✅ Trader registered: ${trader.name} (${trader.strategy}) - symbols: ${trader.symbols.join(', ')}`);

  // Broadcast trader connected event
  gatewayServer.broadcast({
    type: 'trader:connected',
    data: {
      id: trader.id,
      name: trader.name,
      strategy: trader.strategy,
      symbols: trader.symbols,
    },
    timestamp: Date.now(),
  });

  gatewayServer.respondToCommand(ws, command.requestId!, true, {
    registered: true,
    traderId: trader.id,
  });
}

/**
 * Handle 'get_bot_info' command
 * Returns info about connected traders and system status
 */
export async function handleGetBotInfoCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer, stateManager } = context;

  try {
    // Get registered traders
    const traders = getRegisteredTraders();

    // Get today's stats for summary
    const today = new Date().toISOString().split('T')[0];
    const stats = await stateManager.getDailyStats(today);

    // Get unique strategies from trades if no traders registered
    let strategies: string[] = traders.map(t => t.strategy);
    if (strategies.length === 0) {
      const recentTrades = await stateManager.getTrades({ limit: 100 });
      strategies = [...new Set(recentTrades.map(t => t.strategyName))];
    }

    const info = {
      traders: traders.map(t => ({
        id: t.id,
        name: t.name,
        strategy: t.strategy,
        symbols: t.symbols,
        uptime: t.uptime,
        uptimeFormatted: formatUptime(t.uptime as number),
        isActive: t.isActive,
      })),
      system: {
        connectedTraders: traders.length,
        activeStrategies: strategies,
        gatewayUptime: process.uptime() * 1000,
        gatewayUptimeFormatted: formatUptime(process.uptime() * 1000),
      },
      todayStats: stats ? {
        totalTrades: stats.totalTrades,
        wins: stats.wins,
        losses: stats.losses,
        winRate: stats.winRate,
        netPnL: stats.netPnL,
      } : null,
    };

    gatewayServer.respondToCommand(ws, command.requestId!, true, info);

  } catch (error: any) {
    console.error('[handleGetBotInfoCommand] Error:', error.message);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'ERROR',
      message: error.message,
    });
  }
}

/**
 * Handle 'heartbeat' command
 * Updates trader's last heartbeat time
 */
export async function handleHeartbeatCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;

  const trader = registeredTraders.get(ws);
  if (trader) {
    trader.lastHeartbeat = Date.now();
  }

  gatewayServer.respondToCommand(ws, command.requestId!, true, {
    acknowledged: true,
    timestamp: Date.now(),
  });
}

/**
 * Format uptime in human readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Handle 'get_signal_proximities' command
 * Returns the latest signal proximity data for all tracked assets
 */
export async function handleGetSignalProximitiesCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;

  try {
    // Get all signal proximities from cache
    const proximities = Array.from(signalProximityCache.values());

    // Filter out stale entries (older than 5 minutes)
    const now = Date.now();
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
    const activeProximities = proximities.filter(p => (now - p.timestamp) < STALE_THRESHOLD);

    // Sort by proximity (highest first - closer to signal)
    activeProximities.sort((a, b) => b.proximity - a.proximity);

    // Add formatted time since last update
    const result = activeProximities.map(p => ({
      ...p,
      age: now - p.timestamp,
      ageFormatted: formatUptime(now - p.timestamp),
    }));

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      proximities: result,
      count: result.length,
      timestamp: now,
    });

  } catch (error: any) {
    console.error('[handleGetSignalProximitiesCommand] Error:', error.message);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'ERROR',
      message: error.message,
    });
  }
}

/**
 * Handle 'get_server_status' command
 * Returns server resource usage (CPU, RAM, disk) and PM2 process status
 */
export async function handleGetServerStatusCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;
  const os = await import('os');
  const { execSync } = await import('child_process');

  try {
    // CPU info
    const cpus = os.cpus();
    const cpuCount = cpus.length;

    // Calculate CPU usage (average across all cores)
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpuCount;

    // Memory info
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePct = (usedMem / totalMem) * 100;

    // Disk info (try to get it, fallback if not available)
    let diskInfo = { total: 0, used: 0, available: 0, usedPct: 0 };
    try {
      const dfOutput = execSync('df -k / | tail -1', { encoding: 'utf8' });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 4) {
        diskInfo = {
          total: parseInt(parts[1] || '0') * 1024,
          used: parseInt(parts[2] || '0') * 1024,
          available: parseInt(parts[3] || '0') * 1024,
          usedPct: parseInt(parts[4] || '0') || 0,
        };
      }
    } catch {
      // Disk info not available
    }

    // Load average
    const loadAvg = os.loadavg();

    // Uptime
    const uptime = os.uptime();

    // PM2 processes (try to get them)
    let pm2Processes: Array<{
      name: string;
      status: string;
      cpu: number;
      memory: number;
      uptime: number;
      restarts: number;
    }> = [];

    try {
      const pm2Output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8' });
      const pm2Data = JSON.parse(pm2Output);
      pm2Processes = pm2Data.map((proc: any) => ({
        name: proc.name,
        status: proc.pm2_env?.status || 'unknown',
        cpu: proc.monit?.cpu || 0,
        memory: proc.monit?.memory || 0,
        uptime: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
        restarts: proc.pm2_env?.restart_time || 0,
      }));
    } catch {
      // PM2 not available or not running
    }

    const status = {
      cpu: {
        count: cpuCount,
        usage: Math.round(cpuUsage * 10) / 10,
        model: cpus[0]?.model || 'unknown',
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usagePct: Math.round(memUsagePct * 10) / 10,
        totalFormatted: formatBytes(totalMem),
        usedFormatted: formatBytes(usedMem),
        freeFormatted: formatBytes(freeMem),
      },
      disk: {
        total: diskInfo.total,
        used: diskInfo.used,
        available: diskInfo.available,
        usagePct: diskInfo.usedPct,
        totalFormatted: formatBytes(diskInfo.total),
        usedFormatted: formatBytes(diskInfo.used),
        availableFormatted: formatBytes(diskInfo.available),
      },
      system: {
        platform: os.platform(),
        hostname: os.hostname(),
        uptime,
        uptimeFormatted: formatUptime(uptime * 1000),
        loadAvg: loadAvg.map(l => Math.round(l * 100) / 100),
      },
      processes: pm2Processes.map(p => ({
        ...p,
        memoryFormatted: formatBytes(p.memory),
        uptimeFormatted: formatUptime(p.uptime),
      })),
      timestamp: Date.now(),
    };

    gatewayServer.respondToCommand(ws, command.requestId!, true, status);

  } catch (error: any) {
    console.error('[handleGetServerStatusCommand] Error:', error.message);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'ERROR',
      message: error.message,
    });
  }
}

/**
 * Handle 'get_logs' command
 * Returns recent logs from PM2 log files
 */
export async function handleGetLogsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer } = context;
  const { execSync } = await import('child_process');

  const params = (command.params || {}) as {
    service?: 'gateway' | 'trader' | 'telegram' | 'all';
    lines?: number;
    type?: 'out' | 'error' | 'all';
  };

  const service = params.service || 'trader';
  const lines = Math.min(params.lines || 50, 200); // Cap at 200 lines
  const logType = params.type || 'out';

  try {
    let logs: Array<{ service: string; type: string; content: string }> = [];

    // Map service names to PM2 process names
    const serviceMap: Record<string, string[]> = {
      'gateway': ['gateway'],
      'trader': ['trader-squeeze-mr', 'trader-keltner-mr', 'trader-hybrid-mtf'],
      'telegram': ['telegram'],
    };

    const services = service === 'all'
      ? ['gateway', 'trader', 'telegram']
      : [service];

    for (const svc of services) {
      const pm2Names = serviceMap[svc] || [svc];

      for (const pm2Name of pm2Names) {
      try {
        // Use the actual PM2 process name as the service identifier for traders
        const logServiceName = svc === 'trader' ? pm2Name : svc;
        if (logType === 'all' || logType === 'out') {
          const outLogs = execSync(
            `pm2 logs ${pm2Name} --lines ${lines} --nostream --out 2>/dev/null || echo "No logs available"`,
            { encoding: 'utf8', timeout: 5000 }
          );
          // Filter out PM2 headers, ANSI codes, and service prefixes
          const filteredOutLogs = outLogs
            .split('\n')
            .map(line => {
              // Remove ANSI color codes (e.g., [31m, [39m, [1m, [90m, [22m)
              let cleaned = line.replace(/\x1b\[[0-9;]*m/g, '');
              // Remove PM2 service prefix (e.g., "25|trader- | ")
              cleaned = cleaned.replace(/^\d+\|[^|]+\|\s*/, '');
              return cleaned;
            })
            .filter(line => {
              const trimmed = line.trim();
              return trimmed && 
                     !trimmed.includes('[TAILING]') && 
                     !trimmed.includes('Tailing last') &&
                     !trimmed.match(/last \d+ lines/i) &&
                     !trimmed.match(/\.log last \d+ lines/i) &&
                     // Filter out non-critical messages that aren't real errors
                     !trimmed.includes('SLACK_WEBHOOK_URL not set') &&
                     !trimmed.match(/^SLACK_WEBHOOK_URL/i);
            })
            .join('\n')
            .trim();
          
          if (filteredOutLogs && filteredOutLogs !== 'No logs available') {
            logs.push({ service: logServiceName, type: 'out', content: filteredOutLogs });
          }
        }

        if (logType === 'all' || logType === 'error') {
          const errLogs = execSync(
            `pm2 logs ${pm2Name} --lines ${lines} --nostream --err 2>/dev/null || echo "No error logs"`,
            { encoding: 'utf8', timeout: 5000 }
          );
          
          // Filter out PM2 headers, ANSI codes, and service prefixes
          const filteredErrLogs = errLogs
            .split('\n')
            .map(line => {
              // Remove ANSI color codes (e.g., [31m, [39m, [1m, [90m, [22m)
              let cleaned = line.replace(/\x1b\[[0-9;]*m/g, '');
              // Remove PM2 service prefix (e.g., "25|trader- | ")
              cleaned = cleaned.replace(/^\d+\|[^|]+\|\s*/, '');
              return cleaned;
            })
            .filter(line => {
              const trimmed = line.trim();
              return trimmed && 
                     !trimmed.includes('[TAILING]') && 
                     !trimmed.includes('Tailing last') &&
                     !trimmed.match(/last \d+ lines/i) &&
                     !trimmed.match(/\.log last \d+ lines/i) &&
                     // Filter out non-critical messages that aren't real errors
                     !trimmed.includes('SLACK_WEBHOOK_URL not set') &&
                     !trimmed.match(/^SLACK_WEBHOOK_URL/i);
            })
            .join('\n')
            .trim();
          
          if (filteredErrLogs && filteredErrLogs !== 'No error logs' && filteredErrLogs.length > 0) {
            logs.push({ service: logServiceName, type: 'error', content: filteredErrLogs });
          }
        }
      } catch {
        const logServiceName = svc === 'trader' ? pm2Name : svc;
        logs.push({ service: logServiceName, type: 'error', content: `Could not read logs for ${pm2Name}` });
      }
      }
    }

    gatewayServer.respondToCommand(ws, command.requestId!, true, {
      logs,
      service,
      lines,
      type: logType,
      timestamp: Date.now(),
    });

  } catch (error: any) {
    console.error('[handleGetLogsCommand] Error:', error.message);
    gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
      code: 'ERROR',
      message: error.message,
    });
  }
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
