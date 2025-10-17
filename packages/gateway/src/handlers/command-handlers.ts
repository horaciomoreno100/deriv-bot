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
 * Handle 'follow' command
 * Subscribe to real-time ticks for assets
 */
export async function handleFollowCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { derivClient, marketCache, gatewayServer, eventBus } = context;
  const { assets } = command.params as { assets: string[] };

  console.log(`[handleFollowCommand] Starting follow for assets:`, assets);

  try {
    for (const asset of assets) {
      // Skip if already subscribed
      if (activeSubscriptions.has(asset)) {
        console.log(`[handleFollowCommand] Already subscribed to ${asset}, skipping`);
        continue;
      }

      console.log(`[handleFollowCommand] Subscribing to ${asset}...`);

      // Subscribe to ticks from Deriv API
      const subscription = await derivClient.subscribeTicks(asset, (tick: Tick) => {
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
  const { asset, timeframe, count } = command.params as {
    asset: string;
    timeframe: number;
    count?: number;
  };

  console.log(`[handleGetCandlesCommand] Getting candles for ${asset}, timeframe: ${timeframe}, count: ${count || 'all'}`);

  try {
    // Primero intentar obtener del cache
    let candles = marketCache.getCandles(asset, timeframe, count);

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

        // Usar las candles del API directamente
        // El cache se irá llenando con los ticks en tiempo real
        candles = historicalCandles;
      } catch (apiError) {
        console.error(`[handleGetCandlesCommand] Error fetching from API:`, apiError);
        // Continuar con lo que hay en cache
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
 * Handle 'get_stats' command
 * Get trading statistics for a date
 */
export async function handleGetStatsCommand(
  ws: WebSocket,
  command: CommandMessage,
  context: CommandHandlerContext
): Promise<void> {
  const { gatewayServer, stateManager } = context;
  const { date } = command.params as { date?: string };

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
    case 'instruments':
      await handleInstrumentsCommand(ws, command, context);
      break;
    case 'history':
      await handleHistoryCommand(ws, command, context);
      break;
    case 'trade':
      await handleTradeCommand(ws, command, context);
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
    default:
      context.gatewayServer.respondToCommand(ws, command.requestId!, false, undefined, {
        code: 'UNKNOWN_COMMAND',
        message: `Unknown command: ${command.command}`,
      });
  }
}
