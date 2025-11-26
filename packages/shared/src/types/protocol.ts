/**
 * WebSocket Protocol Types for Gateway <-> Trader communication
 *
 * These types are shared between Gateway and Trader to avoid circular dependencies
 */

/**
 * Base message structure
 */
export interface BaseMessage {
  type: string;
  timestamp?: number;
}

/**
 * Command message from Trader to Gateway
 */
export interface CommandMessage extends BaseMessage {
  type: 'command';
  command: string;
  params?: Record<string, any>;
  requestId?: string;
}

/**
 * Response message from Gateway to Trader
 */
export interface ResponseMessage extends BaseMessage {
  type: 'response';
  requestId?: string;
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Event message from Gateway to Trader (broadcast)
 */
export interface EventMessage extends BaseMessage {
  type: 'tick' | 'balance' | 'trade:executed' | 'trade:result' | 'instruments' | 'historical_data' | 'candle_update' | 'candle_closed' | 'indicators' | 'signal:proximity';
  data: any;
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * Message types union
 */
export type GatewayMessage = CommandMessage | ResponseMessage | EventMessage | ErrorMessage;
