import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DerivClient } from './deriv-client.js';

/**
 * Integration tests - Connect to real Deriv API
 *
 * These tests verify that our client works with the actual Deriv API.
 * They use the demo/test app_id 1089.
 */
describe('DerivClient Integration Tests', () => {
  let client: DerivClient;

  beforeAll(async () => {
    client = new DerivClient({
      appId: 1089, // Test app ID
      endpoint: 'wss://ws.derivws.com/websockets/v3',
    });

    await client.connect();
  }, 10000); // 10 second timeout for connection

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
  });

  it('should connect successfully', () => {
    expect(client.isConnected()).toBe(true);
  });

  it('should respond to ping', async () => {
    await expect(client.ping()).resolves.not.toThrow();
  });

  it('should fetch active symbols', async () => {
    const symbols = await client.getActiveSymbols();

    expect(symbols).toBeDefined();
    expect(Array.isArray(symbols)).toBe(true);
    expect(symbols.length).toBeGreaterThan(0);

    // Check structure of first symbol
    const firstSymbol = symbols[0];
    expect(firstSymbol).toHaveProperty('symbol');
    expect(firstSymbol).toHaveProperty('displayName');
    expect(firstSymbol).toHaveProperty('market');
    expect(firstSymbol).toHaveProperty('submarket');
    expect(firstSymbol).toHaveProperty('isOpen');
    expect(firstSymbol).toHaveProperty('pipSize');

    // Find R_100 (should always be available)
    const r100 = symbols.find((s) => s.symbol === 'R_100');
    expect(r100).toBeDefined();
    expect(r100?.displayName).toContain('Volatility 100');
  }, 10000);

  it('should subscribe to ticks', async () => {
    const ticks: any[] = [];

    const subscription = await client.subscribeTicks('R_100', (tick) => {
      ticks.push(tick);
    });

    expect(subscription).toBeDefined();
    expect(subscription.id).toBeDefined();

    // Wait for at least 1 tick (ticks come every ~1 second)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(ticks.length).toBeGreaterThan(0);

    // Check structure of first tick
    const firstTick = ticks[0];
    expect(firstTick).toHaveProperty('asset');
    expect(firstTick).toHaveProperty('price');
    expect(firstTick).toHaveProperty('timestamp');
    expect(firstTick.asset).toBe('R_100');
    expect(typeof firstTick.price).toBe('number');
    expect(typeof firstTick.timestamp).toBe('number');

    // Cleanup
    await client.unsubscribe(subscription.id);
  }, 15000);

  it('should unsubscribe from ticks', async () => {
    const subscription = await client.subscribeTicks('R_100', () => {});

    // Unsubscribe
    await expect(
      client.unsubscribe(subscription.id)
    ).resolves.not.toThrow();
  }, 10000);
});
