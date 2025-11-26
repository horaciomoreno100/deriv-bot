/**
 * WebSocket Protocol for Gateway <-> Trader communication
 *
 * This defines all message types exchanged between Gateway and Trader
 */

import type {
  Tick,
  Symbol,
  Balance,
  BaseMessage,
  CommandMessage,
  ResponseMessage,
  EventMessage,
  ErrorMessage,
  GatewayMessage,
} from '@deriv-bot/shared';

// Re-export the shared protocol types
export type {
  BaseMessage,
  CommandMessage,
  ResponseMessage,
  EventMessage,
  ErrorMessage,
  GatewayMessage,
};

// ============================================
// Command Payloads
// ============================================

/**
 * Follow assets command
 * Subscribe to real-time data for specified assets
 */
export interface FollowCommand {
  command: 'follow';
  params: {
    assets: string[];
  };
}

/**
 * Unfollow assets command
 * Unsubscribe from real-time data
 */
export interface UnfollowCommand {
  command: 'unfollow';
  params: {
    assets: string[];
  };
}

/**
 * Get balance command
 */
export interface BalanceCommand {
  command: 'balance';
  params?: undefined;
}

/**
 * Get instruments/symbols command
 */
export interface InstrumentsCommand {
  command: 'instruments';
  params?: undefined;
}

/**
 * Get historical data command
 */
export interface HistoryCommand {
  command: 'history';
  params: {
    asset: string;
    timeframe: number; // seconds (60, 300, 900, etc)
    count: number;
    end?: 'latest' | number; // timestamp
  };
}

/**
 * Execute trade command
 */
export interface TradeCommand {
  command: 'trade';
  params: {
    asset: string;
    direction: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    durationUnit: 's' | 'm' | 'h' | 'd';
  };
}

/**
 * Ping command (keep-alive)
 */
export interface PingCommand {
  command: 'ping';
  params?: undefined;
}

/**
 * Get tracked assets command
 * Returns list of assets being tracked in cache
 */
export interface GetAssetsCommand {
  command: 'get_assets';
  params?: undefined;
}

/**
 * Get ticks command
 * Retrieve recent ticks from cache
 */
export interface GetTicksCommand {
  command: 'get_ticks';
  params: {
    asset: string;
    count?: number; // Number of recent ticks to retrieve
  };
}

/**
 * Get candles command
 * Retrieve recent candles from cache
 */
export interface GetCandlesCommand {
  command: 'get_candles';
  params: {
    asset: string;
    timeframe: number; // seconds (60, 300, 900, etc)
    count?: number; // Number of recent candles to retrieve
  };
}

/**
 * Union of all command types
 */
export type Command =
  | FollowCommand
  | UnfollowCommand
  | BalanceCommand
  | InstrumentsCommand
  | HistoryCommand
  | TradeCommand
  | PingCommand
  | GetAssetsCommand
  | GetTicksCommand
  | GetCandlesCommand;

// ============================================
// Event Payloads
// ============================================

/**
 * Tick event
 */
export interface TickEvent {
  type: 'tick';
  data: Tick;
}

/**
 * Balance event
 */
export interface BalanceEvent {
  type: 'balance';
  data: Balance;
}

/**
 * Trade executed event
 */
export interface TradeExecutedEvent {
  type: 'trade:executed';
  data: {
    id: string;
    asset: string;
    direction: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    openPrice: number;
    timestamp: number;
    status: 'open';
  };
}

/**
 * Trade result event
 */
export interface TradeResultEvent {
  type: 'trade:result';
  data: {
    id: string;
    asset: string;
    result: 'won' | 'lost';
    profit: number;
    closePrice: number;
    timestamp: number;
  };
}

/**
 * Instruments list event
 */
export interface InstrumentsEvent {
  type: 'instruments';
  data: {
    instruments: Symbol[];
    timestamp: number;
  };
}

/**
 * Historical data event
 */
export interface HistoricalDataEvent {
  type: 'historical_data';
  data: {
    asset: string;
    timeframe: number;
    candles: Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number;
    }>;
    timestamp: number;
  };
}

/**
 * Candle update event (real-time candle formation)
 */
export interface CandleUpdateEvent {
  type: 'candle_update';
  data: {
    asset: string;
    timeframe: number;
    candle: {
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number;
    };
    timestamp: number;
  };
}

/**
 * Candle closed event (candle finalized)
 */
export interface CandleClosedEvent {
  type: 'candle_closed';
  data: {
    asset: string;
    timeframe: number;
    candle: {
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number;
    };
    timestamp: number;
  };
}

/**
 * Trader connected event
 */
export interface TraderConnectedEvent {
  type: 'trader:connected';
  data: {
    id: string;
    name: string;
    strategy: string;
    symbols: string[];
  };
  timestamp: number;
}

/**
 * Trader disconnected event
 */
export interface TraderDisconnectedEvent {
  type: 'trader:disconnected';
  data: {
    id: string;
    name: string;
  };
  timestamp: number;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Create command message
 */
export function createCommandMessage(
  command: Command,
  requestId?: string
): CommandMessage {
  return {
    type: 'command',
    command: command.command,
    params: command.params,
    requestId,
    timestamp: Date.now(),
  };
}

/**
 * Create response message
 */
export function createResponseMessage(
  requestId: string | undefined,
  success: boolean,
  data?: any,
  error?: { code: string; message: string }
): ResponseMessage {
  return {
    type: 'response',
    requestId,
    success,
    data,
    error,
    timestamp: Date.now(),
  };
}

/**
 * Create event message
 */
export function createEventMessage(
  type: EventMessage['type'],
  data: any
): EventMessage {
  return {
    type,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create error message
 */
export function createErrorMessage(code: string, message: string): ErrorMessage {
  return {
    type: 'error',
    code,
    message,
    timestamp: Date.now(),
  };
}

/**
 * Parse incoming message
 */
export function parseMessage(raw: string): GatewayMessage {
  try {
    const message = JSON.parse(raw);

    if (!message.type) {
      throw new Error('Message missing type field');
    }

    return message as GatewayMessage;
  } catch (error) {
    throw new Error(`Failed to parse message: ${error}`);
  }
}

/**
 * Serialize message to JSON
 */
export function serializeMessage(message: GatewayMessage): string {
  return JSON.stringify(message);
}
