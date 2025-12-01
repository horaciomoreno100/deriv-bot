/**
 * TradeManager TDD Tests
 *
 * Critical tests for:
 * 1. Position recovery on startup (tradeManager.start())
 * 2. Risk limits (maxOpenTrades, maxTradesPerSymbol)
 * 3. Reconciliation of external closures (TP/SL hit)
 *
 * These tests were created after a production incident where
 * 58+ positions accumulated because start() was not called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TradeManager } from '../trade-manager.js';
import type { Trade } from '../types.js';

// Mock GatewayClient
const createMockGatewayClient = () => ({
  getBalance: vi.fn().mockResolvedValue({ amount: 1000 }),
  getPortfolio: vi.fn().mockResolvedValue({ contracts: [] }),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
});

// Mock UnifiedTradeAdapter
const createMockTradeAdapter = () => ({
  getMode: vi.fn().mockReturnValue('cfd'),
  executeTrade: vi.fn(),
  closeTrade: vi.fn(),
});

// Mock PositionMonitor
vi.mock('../position-monitor.js', () => ({
  PositionMonitor: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    recoverPositions: vi.fn().mockResolvedValue([]),
    addContractId: vi.fn(),
    removeContractId: vi.fn(),
  })),
}));

describe('TradeManager', () => {
  let tradeManager: TradeManager;
  let mockClient: ReturnType<typeof createMockGatewayClient>;
  let mockAdapter: ReturnType<typeof createMockTradeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockGatewayClient();
    mockAdapter = createMockTradeAdapter();

    tradeManager = new TradeManager(
      mockClient as any,
      mockAdapter as any,
      ['R_100', 'R_75', 'cryETHUSD'],
      {
        risk: {
          maxOpenTrades: 3,
          maxTradesPerSymbol: 1,
          riskPercentageCFD: 0.02,
          riskPercentageBinary: 0.01,
          minStake: 1.0,
          maxStakePercentage: 0.10,
        },
      }
    );
  });

  afterEach(() => {
    tradeManager.stop();
  });

  describe('Position Recovery (start())', () => {
    /**
     * CRITICAL TEST: Verifies that start() recovers existing positions
     *
     * This is the bug that caused 58+ positions to accumulate:
     * - Trading scripts were NOT calling start()
     * - TradeManager thought there were 0 positions
     * - Risk limits (maxOpenTrades: 3) were bypassed
     */
    it('should recover existing positions when start() is called', async () => {
      // Arrange - Mock 3 existing positions in broker
      const mockPositions = [
        {
          contractId: '123456',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10.00,
          profit: 1.50,
          profitPercentage: 15,
          purchaseTime: Date.now() - 60000,
        },
        {
          contractId: '789012',
          symbol: 'R_75',
          contractType: 'MULTDOWN',
          buyPrice: 15.00,
          profit: -2.00,
          profitPercentage: -13.33,
          purchaseTime: Date.now() - 120000,
        },
        {
          contractId: '345678',
          symbol: 'cryETHUSD',
          contractType: 'MULTUP',
          buyPrice: 50.00,
          profit: 5.00,
          profitPercentage: 10,
          purchaseTime: Date.now() - 30000,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      // Act
      await tradeManager.start();

      // Assert - All 3 positions should be recovered
      const openTrades = tradeManager.getOpenTrades();
      expect(openTrades).toHaveLength(3);

      // Verify each position was recovered correctly
      expect(openTrades.find(t => t.contractId === '123456')).toBeDefined();
      expect(openTrades.find(t => t.contractId === '789012')).toBeDefined();
      expect(openTrades.find(t => t.contractId === '345678')).toBeDefined();

      // Verify direction inference from contract type
      const upTrade = openTrades.find(t => t.contractId === '123456');
      expect(upTrade?.direction).toBe('CALL');

      const downTrade = openTrades.find(t => t.contractId === '789012');
      expect(downTrade?.direction).toBe('PUT');
    });

    it('should handle empty portfolio gracefully', async () => {
      // Arrange
      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue([]);

      // Act
      await tradeManager.start();

      // Assert
      const openTrades = tradeManager.getOpenTrades();
      expect(openTrades).toHaveLength(0);
    });

    it('should mark recovered positions with metadata.recovered = true', async () => {
      // Arrange
      const mockPositions = [
        {
          contractId: '111111',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 20.00,
          profit: 3.00,
          profitPercentage: 15,
          purchaseTime: Date.now() - 60000,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      // Act
      await tradeManager.start();

      // Assert
      const openTrades = tradeManager.getOpenTrades();
      expect(openTrades[0].metadata?.recovered).toBe(true);
    });
  });

  describe('Risk Limits (canOpenTrade)', () => {
    /**
     * Tests that risk limits work AFTER position recovery
     */

    it('should block new trades when maxOpenTrades limit reached', async () => {
      // Arrange - Recover 3 positions (maxOpenTrades = 3)
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
        { contractId: '2', symbol: 'R_75', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
        { contractId: '3', symbol: 'cryETHUSD', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Act - Try to open another trade
      const result = tradeManager.canOpenTrade('R_50');

      // Assert - Should be blocked
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global limit reached');
    });

    it('should block new trades when maxTradesPerSymbol limit reached', async () => {
      // Arrange - Recover 1 position for R_100 (maxTradesPerSymbol = 1)
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Act - Try to open another trade for R_100
      const result = tradeManager.canOpenTrade('R_100');

      // Assert - Should be blocked for same symbol
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Symbol limit reached for R_100');
    });

    it('should allow trades for different symbols when under limits', async () => {
      // Arrange - Recover 1 position for R_100
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Act - Try to open trade for R_75 (different symbol)
      const result = tradeManager.canOpenTrade('R_75');

      // Assert - Should be allowed
      expect(result.allowed).toBe(true);
    });

    it('should correctly count recovered positions toward limits', async () => {
      // Arrange - Recover 2 positions
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
        { contractId: '2', symbol: 'R_75', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Act - Check open trades count
      const openTrades = tradeManager.getOpenTrades();

      // Assert
      expect(openTrades).toHaveLength(2);

      // Should allow 1 more trade (maxOpenTrades = 3)
      const resultAllowed = tradeManager.canOpenTrade('cryETHUSD');
      expect(resultAllowed.allowed).toBe(true);

      // Register the new trade manually
      tradeManager.registerTrade({
        contractId: '3',
        asset: 'cryETHUSD',
        direction: 'CALL',
        entryPrice: 100,
        timestamp: Date.now(),
        closed: false,
        mode: 'cfd',
      });

      // Now should be at limit
      const resultBlocked = tradeManager.canOpenTrade('R_50');
      expect(resultBlocked.allowed).toBe(false);
    });
  });

  describe('Risk Limits WITHOUT start() called (BUG SCENARIO)', () => {
    /**
     * This test documents the bug behavior when start() is NOT called
     * Without recovery, TradeManager thinks there are 0 positions
     */

    it('should incorrectly allow trades when start() is NOT called (documenting bug)', async () => {
      // Arrange - DO NOT call start()
      // In production, this caused 58+ positions because limits weren't enforced

      // Act - Check if trade is allowed (without recovery)
      const result = tradeManager.canOpenTrade('R_100');

      // Assert - Shows 0 open trades (the bug)
      expect(tradeManager.getOpenTrades()).toHaveLength(0);
      expect(result.allowed).toBe(true); // This is the problematic behavior
    });
  });

  describe('Trade Registration', () => {
    it('should register new trades and track them', () => {
      // Arrange
      const trade: Trade = {
        contractId: 'new-123',
        asset: 'R_100',
        direction: 'CALL',
        entryPrice: 100,
        timestamp: Date.now(),
        closed: false,
        mode: 'cfd',
        metadata: { tpPct: 0.4, slPct: 0.3 },
      };

      // Act
      tradeManager.registerTrade(trade);

      // Assert
      const openTrades = tradeManager.getOpenTrades();
      expect(openTrades).toHaveLength(1);
      expect(openTrades[0].contractId).toBe('new-123');
    });

    it('should emit trade:registered event', () => {
      // Arrange
      const eventSpy = vi.fn();
      tradeManager.on('trade:registered', eventSpy);

      const trade: Trade = {
        contractId: 'evt-123',
        asset: 'R_100',
        direction: 'CALL',
        entryPrice: 100,
        timestamp: Date.now(),
        closed: false,
        mode: 'cfd',
      };

      // Act
      tradeManager.registerTrade(trade);

      // Assert
      expect(eventSpy).toHaveBeenCalledWith(trade);
    });
  });

  describe('Stake Calculation', () => {
    it('should calculate stake based on balance and risk percentage', async () => {
      // Arrange
      mockClient.getBalance.mockResolvedValue({ amount: 1000 });

      // Act - 2% risk on $1000 = $20
      const stake = await tradeManager.calculateStake('cfd', 0.003);

      // Assert
      expect(stake).toBeGreaterThan(0);
      expect(stake).toBeLessThanOrEqual(100); // Max 10% of balance
    });

    it('should return minimum stake when balance is unavailable', async () => {
      // Arrange
      mockClient.getBalance.mockRejectedValue(new Error('Connection error'));

      // Act
      const stake = await tradeManager.calculateStake('cfd');

      // Assert - Should return minimum stake
      expect(stake).toBe(1.0); // minStake from config
    });
  });

  describe('Trade History', () => {
    it('should maintain complete trade history', async () => {
      // Arrange - Recover some positions first
      const mockPositions = [
        { contractId: 'recovered-1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 1, profitPercentage: 10, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Register a new trade
      const newTrade: Trade = {
        contractId: 'new-trade-1',
        asset: 'R_75',
        direction: 'PUT',
        entryPrice: 50,
        timestamp: Date.now(),
        closed: false,
        mode: 'cfd',
      };
      tradeManager.registerTrade(newTrade);

      // Act
      const history = tradeManager.getTradeHistory();

      // Assert - Should include both recovered and new trades
      expect(history).toHaveLength(2);
      expect(history.find(t => t.contractId === 'recovered-1')).toBeDefined();
      expect(history.find(t => t.contractId === 'new-trade-1')).toBeDefined();
    });

    it('should correctly filter open vs closed trades', async () => {
      // Arrange
      const mockPositions = [
        { contractId: 'open-1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Register a closed trade manually (simulating)
      const closedTrade: Trade = {
        contractId: 'closed-1',
        asset: 'R_75',
        direction: 'CALL',
        entryPrice: 20,
        timestamp: Date.now(),
        closed: true, // Closed
        mode: 'cfd',
      };
      tradeManager.registerTrade(closedTrade);

      // Act
      const openTrades = tradeManager.getOpenTrades();
      const allTrades = tradeManager.getTradeHistory();

      // Assert
      expect(allTrades).toHaveLength(2);
      expect(openTrades).toHaveLength(1); // Only open trade
      expect(openTrades[0].contractId).toBe('open-1');
    });
  });

  describe('PurchaseTime Handling', () => {
    /**
     * Tests for purchaseTime validation during position recovery
     * Addresses production issue with "Invalid purchaseTime" warnings
     */

    it('should handle purchaseTime as a number (timestamp)', async () => {
      const now = Date.now();
      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: now - 60000, // 1 minute ago as number
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.timestamp).toBe(now - 60000);
    });

    it('should handle purchaseTime as a valid Date object', async () => {
      const validDate = new Date(Date.now() - 60000);
      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: validDate,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.timestamp).toBe(validDate.getTime());
    });

    it('should fallback to current time when purchaseTime is invalid Date (NaN)', async () => {
      const invalidDate = new Date('invalid');
      const beforeTest = Date.now();

      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: invalidDate,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      // Should be approximately now (within 1 second)
      expect(trade.timestamp).toBeGreaterThanOrEqual(beforeTest);
      expect(trade.timestamp).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('should fallback to current time when purchaseTime is undefined', async () => {
      const beforeTest = Date.now();

      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: undefined as any,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.timestamp).toBeGreaterThanOrEqual(beforeTest);
    });

    it('should fallback to current time when purchaseTime is 0', async () => {
      const beforeTest = Date.now();

      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: 0,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.timestamp).toBeGreaterThanOrEqual(beforeTest);
    });

    it('should fallback to current time when purchaseTime is negative', async () => {
      const beforeTest = Date.now();

      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: -1000,
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.timestamp).toBeGreaterThanOrEqual(beforeTest);
    });

    it('should not log warning for valid purchaseTime', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      const mockPositions = [
        {
          contractId: '1',
          symbol: 'R_100',
          contractType: 'MULTUP',
          buyPrice: 10,
          profit: 0,
          profitPercentage: 0,
          purchaseTime: Date.now() - 60000, // Valid timestamp
        },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      // Should not have called console.warn with purchaseTime message
      const purchaseTimeWarnings = consoleSpy.mock.calls.filter(
        call => call[0]?.includes?.('purchaseTime')
      );
      expect(purchaseTimeWarnings).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });

  describe('Direction Inference', () => {
    it('should infer CALL direction from MULTUP contract type', async () => {
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.direction).toBe('CALL');
    });

    it('should infer PUT direction from MULTDOWN contract type', async () => {
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'MULTDOWN', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.direction).toBe('PUT');
    });

    it('should infer PUT direction from PUT contract type', async () => {
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'PUT', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.direction).toBe('PUT');
    });

    it('should infer PUT direction from FALL contract type', async () => {
      const mockPositions = [
        { contractId: '1', symbol: 'R_100', contractType: 'FALL', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      ];

      const positionMonitor = tradeManager.getManagers().positionMonitor;
      vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(mockPositions);

      await tradeManager.start();

      const trade = tradeManager.getOpenTrades()[0];
      expect(trade.direction).toBe('PUT');
    });
  });
});

describe('TradeManager Integration Scenarios', () => {
  /**
   * Integration-like tests that simulate real production scenarios
   */

  it('should prevent accumulating positions beyond limit (production bug scenario)', async () => {
    // This test simulates the production bug where 58+ positions accumulated

    const mockClient = createMockGatewayClient();
    const mockAdapter = createMockTradeAdapter();

    const tradeManager = new TradeManager(
      mockClient as any,
      mockAdapter as any,
      ['R_100'],
      {
        risk: {
          maxOpenTrades: 3,
          maxTradesPerSymbol: 1,
        },
      }
    );

    // Simulate broker having 5 positions (more than limit)
    const brokerPositions = [
      { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      { contractId: '2', symbol: 'R_100', contractType: 'MULTDOWN', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      { contractId: '3', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      { contractId: '4', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      { contractId: '5', symbol: 'R_100', contractType: 'MULTDOWN', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
    ];

    const positionMonitor = tradeManager.getManagers().positionMonitor;
    vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(brokerPositions);

    // Call start() - this recovers all 5 positions
    await tradeManager.start();

    // Verify all positions are tracked
    expect(tradeManager.getOpenTrades()).toHaveLength(5);

    // Now try to open more trades - should ALL be blocked
    const result1 = tradeManager.canOpenTrade('R_100');
    expect(result1.allowed).toBe(false);
    expect(result1.reason).toContain('limit reached'); // Either global or symbol limit

    const result2 = tradeManager.canOpenTrade('R_75');
    expect(result2.allowed).toBe(false);
    expect(result2.reason).toContain('Global limit reached'); // At 5, over the 3 limit

    tradeManager.stop();
  });

  it('should allow resuming trading after positions close', async () => {
    const mockClient = createMockGatewayClient();
    const mockAdapter = createMockTradeAdapter();

    const tradeManager = new TradeManager(
      mockClient as any,
      mockAdapter as any,
      ['R_100', 'R_75'],
      {
        risk: {
          maxOpenTrades: 2,
          maxTradesPerSymbol: 1,
        },
      }
    );

    // Start with 2 positions (at limit)
    const initialPositions = [
      { contractId: '1', symbol: 'R_100', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
      { contractId: '2', symbol: 'R_75', contractType: 'MULTUP', buyPrice: 10, profit: 0, profitPercentage: 0, purchaseTime: Date.now() },
    ];

    const positionMonitor = tradeManager.getManagers().positionMonitor;
    vi.spyOn(positionMonitor, 'recoverPositions').mockResolvedValue(initialPositions);

    await tradeManager.start();

    // At limit - cannot open more
    expect(tradeManager.canOpenTrade('R_50').allowed).toBe(false);

    // Simulate one trade closing by marking it
    const trades = tradeManager.getOpenTrades();
    trades[0].closed = true;

    // Now should allow opening new trade (1 open, max 2)
    const result = tradeManager.canOpenTrade('R_50');
    expect(result.allowed).toBe(true);

    tradeManager.stop();
  });
});
