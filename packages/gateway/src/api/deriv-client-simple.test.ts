import { describe, it, expect } from 'vitest';
import { DerivClient } from './deriv-client.js';

/**
 * Simple smoke test - Just verify the client can connect
 */
describe('DerivClient - Smoke Test', () => {
  it('should connect and get symbols', async () => {
    const client = new DerivClient({
      appId: 1089,
      endpoint: 'wss://ws.derivws.com/websockets/v3',
    });

    // Connect
    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Get symbols
    const symbols = await client.getActiveSymbols();
    expect(symbols.length).toBeGreaterThan(0);

    // Find R_100
    const r100 = symbols.find((s) => s.symbol === 'R_100');
    expect(r100).toBeDefined();
    expect(r100?.displayName).toContain('Volatility');

    // Disconnect
    client.disconnect();
    expect(client.isConnected()).toBe(false);
  }, 15000);

  it('should subscribe to ticks and receive updates', async () => {
    const client = new DerivClient({
      appId: 1089,
      endpoint: 'wss://ws.derivws.com/websockets/v3',
    });

    await client.connect();

    const ticks: any[] = [];

    // Subscribe
    const sub = await client.subscribeTicks('R_100', (tick) => {
      ticks.push(tick);
    });

    expect(sub.id).toBeDefined();

    // Wait 5 seconds for ticks
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Should have received ticks
    expect(ticks.length).toBeGreaterThan(0);

    const firstTick = ticks[0];
    expect(firstTick.asset).toBe('R_100');
    expect(typeof firstTick.price).toBe('number');
    expect(firstTick.price).toBeGreaterThan(0);

    // Unsubscribe
    await client.unsubscribe(sub.id);

    // Disconnect
    client.disconnect();
  }, 20000);
});
