import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DerivClient } from './deriv-client.js';
import type WebSocket from 'ws';

describe('DerivClient', () => {
  let client: DerivClient;
  let mockWebSocket: Partial<WebSocket>;

  beforeEach(() => {
    // Mock WebSocket
    mockWebSocket = {
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    };

    client = new DerivClient({
      appId: 1089,
      endpoint: 'wss://ws.derivws.com/websockets/v3',
    });

    // Inject mock WebSocket
    (client as any).ws = mockWebSocket;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection', () => {
    it('should create client with correct config', () => {
      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });

    it('should connect to Deriv WebSocket', async () => {
      const connectPromise = client.connect();

      // Simulate connection opened
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();

      await connectPromise;

      expect(client.isConnected()).toBe(true);
    });

    it('should handle connection errors', async () => {
      const connectPromise = client.connect();

      // Simulate error
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      onCallback?.(new Error('Connection failed'));

      await expect(connectPromise).rejects.toThrow('Connection failed');
    });

    it('should disconnect gracefully', async () => {
      // Connect first
      const connectPromise = client.connect();
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();
      await connectPromise;

      // Disconnect
      client.disconnect();

      expect(mockWebSocket.close).toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Ping / Keep-Alive', () => {
    it('should send ping message', async () => {
      // Connect
      const connectPromise = client.connect();
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();
      await connectPromise;

      // Send ping
      await client.ping();

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ ping: 1 })
      );
    });

    it('should start keep-alive when connected', async () => {
      vi.useFakeTimers();

      const connectPromise = client.connect();
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();
      await connectPromise;

      // Fast-forward 65 seconds
      vi.advanceTimersByTime(65000);

      // Should have sent at least one ping
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ ping: 1 })
      );

      vi.useRealTimers();
    });
  });

  describe('Active Symbols', () => {
    it('should fetch active symbols', async () => {
      // Connect
      const connectPromise = client.connect();
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();
      await connectPromise;

      // Request active symbols
      const symbolsPromise = client.getActiveSymbols();

      // Simulate response
      const messageCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      const response = {
        active_symbols: [
          {
            symbol: 'R_100',
            display_name: 'Volatility 100 Index',
            market: 'synthetic_index',
            submarket: 'random_index',
            exchange_is_open: 1,
            pip: 0.01,
          },
        ],
        msg_type: 'active_symbols',
      };

      messageCallback?.(JSON.stringify(response));

      const symbols = await symbolsPromise;

      expect(symbols).toHaveLength(1);
      expect(symbols[0].symbol).toBe('R_100');
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          active_symbols: 'brief',
          product_type: 'basic',
        })
      );
    });
  });

  describe('Ticks Subscription', () => {
    it('should subscribe to ticks', async () => {
      // Connect
      const connectPromise = client.connect();
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();
      await connectPromise;

      // Subscribe
      const callback = vi.fn();
      const subscription = await client.subscribeTicks('R_100', callback);

      expect(subscription).toBeDefined();
      expect(subscription.id).toBeDefined();
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          ticks: 'R_100',
          subscribe: 1,
        })
      );
    });

    it('should receive tick updates', async () => {
      // Connect
      const connectPromise = client.connect();
      const onOpenCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onOpenCallback?.();
      await connectPromise;

      // Subscribe
      const callback = vi.fn();
      await client.subscribeTicks('R_100', callback);

      // Simulate tick message
      const onMessageCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      const tickMessage = {
        tick: {
          ask: 456.123,
          bid: 456.103,
          epoch: 1704067200,
          quote: 456.113,
          symbol: 'R_100',
        },
        subscription: {
          id: 'test-sub-id',
        },
      };

      onMessageCallback?.(JSON.stringify(tickMessage));

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          asset: 'R_100',
          price: 456.113,
          timestamp: expect.any(Number),
        })
      );
    });

    it('should unsubscribe from ticks', async () => {
      // Connect
      const connectPromise = client.connect();
      const onCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onCallback?.();
      await connectPromise;

      // Subscribe
      const callback = vi.fn();
      const subscription = await client.subscribeTicks('R_100', callback);

      // Unsubscribe
      await client.unsubscribe(subscription.id);

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          forget: subscription.id,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      // Connect
      const connectPromise = client.connect();
      const onOpenCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'open'
      )?.[1];
      onOpenCallback?.();
      await connectPromise;

      // Request something
      const symbolsPromise = client.getActiveSymbols();

      // Simulate error response
      const onMessageCallback = (mockWebSocket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      const errorResponse = {
        error: {
          code: 'InvalidSymbol',
          message: 'Invalid symbol provided',
        },
        msg_type: 'active_symbols',
      };

      onMessageCallback?.(JSON.stringify(errorResponse));

      await expect(symbolsPromise).rejects.toThrow('Invalid symbol provided');
    });
  });
});
