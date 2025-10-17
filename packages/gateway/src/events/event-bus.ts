import { EventEmitter } from 'events';
import type { Tick, Candle } from '@deriv-bot/shared';

/**
 * Event types emitted by the Gateway
 */
export interface GatewayEvents {
  // Market data events
  'tick': (tick: Tick) => void;
  'candle:update': (data: { asset: string; timeframe: number; candle: Candle }) => void;
  'candle:closed': (data: { asset: string; timeframe: number; candle: Candle }) => void;

  // System events
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;

  // Generic event
  [event: string]: (...args: any[]) => void;
}

/**
 * EventBus - Singleton event emitter for Gateway events
 *
 * Used to decouple components and propagate events throughout the system.
 *
 * @example
 * ```typescript
 * const eventBus = EventBus.getInstance();
 *
 * // Listen for ticks
 * eventBus.on('tick', (tick) => {
 *   console.log('Tick:', tick);
 * });
 *
 * // Emit tick
 * eventBus.emit('tick', {
 *   asset: 'R_100',
 *   price: 1234.56,
 *   timestamp: Date.now()
 * });
 * ```
 */
export class EventBus extends EventEmitter {
  private static instance: EventBus;

  private constructor() {
    super();
    this.setMaxListeners(100); // Increase limit for many subscriptions
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  // Type-safe wrappers
  emitTyped<K extends keyof GatewayEvents>(
    event: K,
    ...args: Parameters<GatewayEvents[K]>
  ): boolean {
    return super.emit(event as string, ...args);
  }

  onTyped<K extends keyof GatewayEvents>(
    event: K,
    listener: GatewayEvents[K]
  ): this {
    return super.on(event as string, listener);
  }

  onceTyped<K extends keyof GatewayEvents>(
    event: K,
    listener: GatewayEvents[K]
  ): this {
    return super.once(event as string, listener);
  }

  offTyped<K extends keyof GatewayEvents>(
    event: K,
    listener: GatewayEvents[K]
  ): this {
    return super.off(event as string, listener);
  }
}
