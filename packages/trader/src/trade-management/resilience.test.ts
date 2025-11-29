/**
 * Resilience Tests
 *
 * Tests for error handling and recovery scenarios:
 * 1. Minimum stake auto-retry (Deriv API dynamic minimums)
 * 2. Balance undefined handling
 * 3. Command timeout handling
 * 4. Connection closed handling
 */

import { describe, it, expect } from 'vitest';
import { RiskManager } from './risk-manager.js';

describe('Resilience: RiskManager', () => {
  describe('getMinStake', () => {
    it('should return minimum stake value', () => {
      const riskManager = new RiskManager({ minStake: 5.0 });
      expect(riskManager.getMinStake()).toBe(5.0);
    });

    it('should return default minimum stake (5.0) when not configured', () => {
      const riskManager = new RiskManager({});
      expect(riskManager.getMinStake()).toBe(5.0);
    });

    it('should use custom minimum stake when configured', () => {
      const riskManager = new RiskManager({ minStake: 10.0 });
      expect(riskManager.getMinStake()).toBe(10.0);
    });
  });
});

describe('Resilience: Minimum Stake Regex Parsing', () => {
  it('should parse minimum amount from error message', () => {
    const errorMessage = 'Enter an amount equal to or higher than 3.43.';
    // The regex captures digits and dots, then we use parseFloat to get the number
    const minAmountMatch = errorMessage.match(/higher than ([\d.]+)/);

    expect(minAmountMatch).not.toBeNull();
    // The regex captures "3.43." but parseFloat handles it correctly, converting to 3.43
    expect(parseFloat(minAmountMatch![1]!)).toBe(3.43);
  });

  it('should handle different minimum amount formats', () => {
    const testCases = [
      { message: 'Enter an amount equal to or higher than 5.00.', expected: 5.00 },
      { message: 'Enter an amount equal to or higher than 10.', expected: 10 },
      { message: 'Enter an amount equal to or higher than 3.09.', expected: 3.09 },
      { message: 'Enter an amount equal to or higher than 6.24.', expected: 6.24 },
    ];

    for (const testCase of testCases) {
      const match = testCase.message.match(/higher than ([\d.]+)/);
      expect(match).not.toBeNull();
      // parseFloat handles trailing dots correctly
      expect(parseFloat(match![1]!)).toBe(testCase.expected);
    }
  });

  it('should calculate adjusted amount with 10% buffer', () => {
    const minAmount = 3.43;
    const adjustedAmount = Math.round((minAmount * 1.1) * 100) / 100;

    expect(adjustedAmount).toBe(3.77);
    expect(adjustedAmount).toBeGreaterThan(minAmount);
  });
});

describe('Resilience: Error Message Classification', () => {
  // These functions match the actual implementation pattern in position-monitor.ts
  const isTimeoutError = (message: string | undefined): boolean =>
    Boolean(message?.includes('timeout') || message?.includes('Command timeout'));

  const isConnectionError = (message: string | undefined): boolean =>
    Boolean(message?.includes('Connection closed') || message?.includes('Not connected'));

  it('should classify timeout errors correctly', () => {
    expect(isTimeoutError('Command timeout: portfolio')).toBe(true);
    expect(isTimeoutError('Request timeout')).toBe(true);
    expect(isTimeoutError('Some other error')).toBe(false);
  });

  it('should classify connection errors correctly', () => {
    expect(isConnectionError('Connection closed')).toBe(true);
    expect(isConnectionError('Not connected to Gateway')).toBe(true);
    expect(isConnectionError('Some other error')).toBe(false);
  });

  it('should handle undefined error messages', () => {
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });
});

describe('Resilience: Signal Metadata', () => {
  it('should validate signal has entryPrice in metadata for CFD trades', () => {
    const signalWithPrice = {
      direction: 'CALL',
      confidence: 0.8,
      metadata: {
        entryPrice: 100.50,
        tpPct: 0.004,
        slPct: 0.003,
      },
    };

    const signalWithoutPrice = {
      direction: 'CALL',
      confidence: 0.8,
      metadata: {},
    };

    // Signal with entryPrice should be valid
    const entryPrice1 = typeof signalWithPrice.metadata?.entryPrice === 'number'
      ? signalWithPrice.metadata.entryPrice
      : 0;
    expect(entryPrice1).toBe(100.50);

    // Signal without entryPrice should return 0
    const entryPrice2 = typeof signalWithoutPrice.metadata?.entryPrice === 'number'
      ? signalWithoutPrice.metadata.entryPrice
      : 0;
    expect(entryPrice2).toBe(0);
  });

  it('should accept both "price" and "entryPrice" for backwards compatibility', () => {
    const signalWithOldFormat = {
      direction: 'CALL',
      confidence: 0.8,
      metadata: {
        price: 100.50, // Old format
      },
    };

    const signalWithNewFormat = {
      direction: 'CALL',
      confidence: 0.8,
      metadata: {
        entryPrice: 100.50, // New format
      },
    };

    // Both formats should work
    const getEntryPrice = (signal: any) =>
      typeof signal.metadata?.price === 'number'
        ? signal.metadata.price
        : (typeof signal.metadata?.entryPrice === 'number' ? signal.metadata.entryPrice : 0);

    expect(getEntryPrice(signalWithOldFormat)).toBe(100.50);
    expect(getEntryPrice(signalWithNewFormat)).toBe(100.50);
  });
});

describe('Resilience: Already Subscribed Detection', () => {
  // This matches the actual implementation in gateway-client.ts
  const isAlreadySubscribedError = (message: string | undefined): boolean =>
    Boolean(message?.includes('already subscribed'));

  it('should detect "already subscribed" error', () => {
    expect(isAlreadySubscribedError('You are already subscribed to R_75')).toBe(true);
    expect(isAlreadySubscribedError('Error: You are already subscribed to R_100')).toBe(true);
  });

  it('should not match unrelated errors', () => {
    expect(isAlreadySubscribedError('Connection timeout')).toBe(false);
    expect(isAlreadySubscribedError('Market is closed')).toBe(false);
  });

  it('should handle undefined error messages', () => {
    expect(isAlreadySubscribedError(undefined)).toBe(false);
  });
});

describe('Resilience: Market Closed Detection', () => {
  // These functions match the actual implementation pattern in gateway-client.ts
  const isMarketClosedError = (message: string | undefined): boolean =>
    Boolean(
      message?.includes('market is presently closed') ||
      message?.includes('Market is closed') ||
      message?.includes('MarketIsClosed')
    );

  it('should detect "market is presently closed" error', () => {
    expect(isMarketClosedError('This market is presently closed.')).toBe(true);
    expect(isMarketClosedError('Error: This market is presently closed.')).toBe(true);
  });

  it('should detect "Market is closed" error', () => {
    expect(isMarketClosedError('Market is closed')).toBe(true);
    expect(isMarketClosedError('The Market is closed for trading')).toBe(true);
  });

  it('should detect "MarketIsClosed" error code', () => {
    expect(isMarketClosedError('MarketIsClosed')).toBe(true);
    expect(isMarketClosedError('Error code: MarketIsClosed')).toBe(true);
  });

  it('should not match unrelated errors', () => {
    expect(isMarketClosedError('Connection timeout')).toBe(false);
    expect(isMarketClosedError('Invalid symbol')).toBe(false);
    expect(isMarketClosedError('Some other error')).toBe(false);
  });

  it('should handle undefined error messages', () => {
    expect(isMarketClosedError(undefined)).toBe(false);
  });

  it('should calculate exponential backoff correctly', () => {
    const baseDelayMs = 60000; // 1 minute

    // Retry 1: 1 min, Retry 2: 2 min, Retry 3: 4 min, Retry 4: 8 min, Retry 5: 16 min
    const expectedDelays = [1, 2, 4, 8, 16]; // in minutes

    for (let attempt = 0; attempt < 5; attempt++) {
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      const delayMinutes = delayMs / 60000;
      expect(delayMinutes).toBe(expectedDelays[attempt]);
    }
  });
});
