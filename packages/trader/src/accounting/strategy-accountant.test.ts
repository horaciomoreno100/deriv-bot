/**
 * Strategy Accountant Tests (TDD)
 *
 * Tests for the StrategyAccountant component that manages
 * per-strategy balance allocation and P/L tracking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrategyAccountant } from './strategy-accountant.js';
import type { TradeResult } from '@deriv-bot/shared';

describe('StrategyAccountant', () => {
  let accountant: StrategyAccountant;

  beforeEach(() => {
    accountant = new StrategyAccountant();
  });

  // ==========================================================================
  // ALLOCATION TESTS
  // ==========================================================================

  describe('allocate', () => {
    it('should allocate balance to a new strategy', () => {
      accountant.allocate('KELTNER_MR', 1000);

      expect(accountant.getBalance('KELTNER_MR')).toBe(1000);
    });

    it('should allocate balance to multiple strategies', () => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.allocate('BB_SQUEEZE', 500);

      expect(accountant.getBalance('KELTNER_MR')).toBe(1000);
      expect(accountant.getBalance('BB_SQUEEZE')).toBe(500);
    });

    it('should throw error for negative allocation', () => {
      expect(() => accountant.allocate('KELTNER_MR', -100)).toThrow(
        'Allocation amount must be positive'
      );
    });

    it('should throw error for zero allocation', () => {
      expect(() => accountant.allocate('KELTNER_MR', 0)).toThrow(
        'Allocation amount must be positive'
      );
    });

    it('should allow re-allocating to existing strategy (adds to balance)', () => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.allocate('KELTNER_MR', 500);

      expect(accountant.getBalance('KELTNER_MR')).toBe(1500);
    });
  });

  // ==========================================================================
  // BALANCE TESTS
  // ==========================================================================

  describe('getBalance', () => {
    it('should return 0 for non-existent strategy', () => {
      expect(accountant.getBalance('NON_EXISTENT')).toBe(0);
    });

    it('should return allocated balance for existing strategy', () => {
      accountant.allocate('KELTNER_MR', 1000);
      expect(accountant.getBalance('KELTNER_MR')).toBe(1000);
    });
  });

  describe('getTotalBalance', () => {
    it('should return 0 when no strategies allocated', () => {
      expect(accountant.getTotalBalance()).toBe(0);
    });

    it('should return sum of all strategy balances', () => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.allocate('BB_SQUEEZE', 500);

      expect(accountant.getTotalBalance()).toBe(1500);
    });
  });

  // ==========================================================================
  // TRADE RECORDING TESTS
  // ==========================================================================

  describe('recordTrade', () => {
    const createTradeResult = (
      strategyName: string,
      profit: number,
      status: 'won' | 'lost' = profit > 0 ? 'won' : 'lost'
    ): TradeResult => ({
      contractId: `contract-${Date.now()}`,
      status,
      profit,
      exitPrice: 100,
      exitTime: Date.now(),
    });

    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
    });

    it('should update balance after winning trade', () => {
      const trade = createTradeResult('KELTNER_MR', 50);
      accountant.recordTrade('KELTNER_MR', trade);

      expect(accountant.getBalance('KELTNER_MR')).toBe(1050);
    });

    it('should update balance after losing trade', () => {
      const trade = createTradeResult('KELTNER_MR', -30);
      accountant.recordTrade('KELTNER_MR', trade);

      expect(accountant.getBalance('KELTNER_MR')).toBe(970);
    });

    it('should track multiple trades correctly', () => {
      accountant.recordTrade('KELTNER_MR', createTradeResult('KELTNER_MR', 50));
      accountant.recordTrade('KELTNER_MR', createTradeResult('KELTNER_MR', -20));
      accountant.recordTrade('KELTNER_MR', createTradeResult('KELTNER_MR', 30));

      expect(accountant.getBalance('KELTNER_MR')).toBe(1060); // 1000 + 50 - 20 + 30
    });

    it('should throw error for non-existent strategy', () => {
      const trade = createTradeResult('NON_EXISTENT', 50);

      expect(() => accountant.recordTrade('NON_EXISTENT', trade)).toThrow(
        'Strategy NON_EXISTENT not found'
      );
    });

    it('should not allow balance to go negative (circuit breaker)', () => {
      const bigLoss = createTradeResult('KELTNER_MR', -1500);
      accountant.recordTrade('KELTNER_MR', bigLoss);

      // Balance should be capped at 0, not negative
      expect(accountant.getBalance('KELTNER_MR')).toBe(0);
    });
  });

  // ==========================================================================
  // RESERVE STAKE TESTS (for open positions)
  // ==========================================================================

  describe('reserveStake', () => {
    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
    });

    it('should reserve stake from available balance', () => {
      const reserved = accountant.reserveStake('KELTNER_MR', 50);

      expect(reserved).toBe(true);
      expect(accountant.getAvailableBalance('KELTNER_MR')).toBe(950);
      expect(accountant.getBalance('KELTNER_MR')).toBe(1000); // Total unchanged
    });

    it('should track reserved amount separately', () => {
      accountant.reserveStake('KELTNER_MR', 50);
      accountant.reserveStake('KELTNER_MR', 30);

      expect(accountant.getReservedBalance('KELTNER_MR')).toBe(80);
      expect(accountant.getAvailableBalance('KELTNER_MR')).toBe(920);
    });

    it('should reject stake larger than available balance', () => {
      const reserved = accountant.reserveStake('KELTNER_MR', 1500);

      expect(reserved).toBe(false);
      expect(accountant.getAvailableBalance('KELTNER_MR')).toBe(1000);
    });

    it('should return false for non-existent strategy', () => {
      const reserved = accountant.reserveStake('NON_EXISTENT', 50);
      expect(reserved).toBe(false);
    });
  });

  describe('releaseStake', () => {
    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.reserveStake('KELTNER_MR', 100);
    });

    it('should release reserved stake back to available', () => {
      accountant.releaseStake('KELTNER_MR', 100);

      expect(accountant.getReservedBalance('KELTNER_MR')).toBe(0);
      expect(accountant.getAvailableBalance('KELTNER_MR')).toBe(1000);
    });

    it('should handle partial release', () => {
      accountant.releaseStake('KELTNER_MR', 50);

      expect(accountant.getReservedBalance('KELTNER_MR')).toBe(50);
      expect(accountant.getAvailableBalance('KELTNER_MR')).toBe(950);
    });
  });

  // ==========================================================================
  // STATISTICS TESTS
  // ==========================================================================

  describe('getStats', () => {
    const createTradeResult = (
      profit: number,
      status: 'won' | 'lost' = profit > 0 ? 'won' : 'lost'
    ): TradeResult => ({
      contractId: `contract-${Date.now()}-${Math.random()}`,
      status,
      profit,
      exitPrice: 100,
      exitTime: Date.now(),
    });

    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
    });

    it('should return empty stats for strategy with no trades', () => {
      const stats = accountant.getStats('KELTNER_MR');

      expect(stats.totalTrades).toBe(0);
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.totalPnL).toBe(0);
      expect(stats.roi).toBe(0);
    });

    it('should calculate correct stats after trades', () => {
      accountant.recordTrade('KELTNER_MR', createTradeResult(50));
      accountant.recordTrade('KELTNER_MR', createTradeResult(30));
      accountant.recordTrade('KELTNER_MR', createTradeResult(-20));

      const stats = accountant.getStats('KELTNER_MR');

      expect(stats.totalTrades).toBe(3);
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBeCloseTo(0.6667, 2);
      expect(stats.totalPnL).toBe(60);
      expect(stats.roi).toBeCloseTo(6, 1); // 60/1000 * 100 = 6%
    });

    it('should track max drawdown', () => {
      // Start at 1000
      accountant.recordTrade('KELTNER_MR', createTradeResult(100)); // 1100
      accountant.recordTrade('KELTNER_MR', createTradeResult(-200)); // 900 (DD: 200/1100 = 18.18%)
      accountant.recordTrade('KELTNER_MR', createTradeResult(50)); // 950

      const stats = accountant.getStats('KELTNER_MR');

      expect(stats.maxDrawdown).toBeCloseTo(18.18, 1);
    });

    it('should return null stats for non-existent strategy', () => {
      const stats = accountant.getStats('NON_EXISTENT');
      expect(stats).toBeNull();
    });
  });

  // ==========================================================================
  // OPEN POSITIONS TRACKING
  // ==========================================================================

  describe('openPositions tracking', () => {
    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.allocate('BB_SQUEEZE', 500);
    });

    it('should track open positions per strategy', () => {
      accountant.incrementOpenPositions('KELTNER_MR');
      accountant.incrementOpenPositions('KELTNER_MR');
      accountant.incrementOpenPositions('BB_SQUEEZE');

      expect(accountant.getOpenPositionsCount('KELTNER_MR')).toBe(2);
      expect(accountant.getOpenPositionsCount('BB_SQUEEZE')).toBe(1);
    });

    it('should decrement open positions', () => {
      accountant.incrementOpenPositions('KELTNER_MR');
      accountant.incrementOpenPositions('KELTNER_MR');
      accountant.decrementOpenPositions('KELTNER_MR');

      expect(accountant.getOpenPositionsCount('KELTNER_MR')).toBe(1);
    });

    it('should not go below 0 open positions', () => {
      accountant.decrementOpenPositions('KELTNER_MR');

      expect(accountant.getOpenPositionsCount('KELTNER_MR')).toBe(0);
    });

    it('should return 0 for non-existent strategy', () => {
      expect(accountant.getOpenPositionsCount('NON_EXISTENT')).toBe(0);
    });
  });

  // ==========================================================================
  // DAILY P/L TRACKING
  // ==========================================================================

  describe('daily P/L tracking', () => {
    const createTradeResult = (profit: number): TradeResult => ({
      contractId: `contract-${Date.now()}-${Math.random()}`,
      status: profit > 0 ? 'won' : 'lost',
      profit,
      exitPrice: 100,
      exitTime: Date.now(),
    });

    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
    });

    it('should track daily P/L per strategy', () => {
      accountant.recordTrade('KELTNER_MR', createTradeResult(50));
      accountant.recordTrade('KELTNER_MR', createTradeResult(-30));

      expect(accountant.getDailyPnL('KELTNER_MR')).toBe(20);
    });

    it('should reset daily P/L', () => {
      accountant.recordTrade('KELTNER_MR', createTradeResult(50));
      accountant.resetDailyStats('KELTNER_MR');

      expect(accountant.getDailyPnL('KELTNER_MR')).toBe(0);
    });

    it('should return 0 for non-existent strategy', () => {
      expect(accountant.getDailyPnL('NON_EXISTENT')).toBe(0);
    });
  });

  // ==========================================================================
  // CONTEXT FOR RISK MANAGER
  // ==========================================================================

  describe('getRiskContext', () => {
    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
    });

    it('should return context object for RiskManager', () => {
      accountant.reserveStake('KELTNER_MR', 100);
      accountant.incrementOpenPositions('KELTNER_MR');

      const context = accountant.getRiskContext('KELTNER_MR');

      expect(context).toEqual({
        balance: 900, // Available balance
        openPositions: 1,
        dailyPnL: 0,
      });
    });

    it('should return null context for non-existent strategy', () => {
      const context = accountant.getRiskContext('NON_EXISTENT');
      expect(context).toBeNull();
    });
  });

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  describe('events', () => {
    beforeEach(() => {
      accountant.allocate('KELTNER_MR', 1000);
    });

    it('should emit trade:recorded event', () => {
      const listener = vi.fn();
      accountant.on('trade:recorded', listener);

      const trade: TradeResult = {
        contractId: 'test-123',
        status: 'won',
        profit: 50,
        exitPrice: 100,
        exitTime: Date.now(),
      };

      accountant.recordTrade('KELTNER_MR', trade);

      expect(listener).toHaveBeenCalledWith('KELTNER_MR', trade, 1050);
    });

    it('should emit balance:updated event', () => {
      const listener = vi.fn();
      accountant.on('balance:updated', listener);

      const trade: TradeResult = {
        contractId: 'test-123',
        status: 'won',
        profit: 50,
        exitPrice: 100,
        exitTime: Date.now(),
      };

      accountant.recordTrade('KELTNER_MR', trade);

      expect(listener).toHaveBeenCalledWith('KELTNER_MR', 1050, 1000);
    });
  });

  // ==========================================================================
  // SERIALIZATION (for persistence)
  // ==========================================================================

  describe('serialization', () => {
    it('should serialize state to JSON', () => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.allocate('BB_SQUEEZE', 500);

      const json = accountant.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.strategies).toHaveProperty('KELTNER_MR');
      expect(parsed.strategies).toHaveProperty('BB_SQUEEZE');
      expect(parsed.strategies.KELTNER_MR.balance).toBe(1000);
    });

    it('should restore state from JSON', () => {
      accountant.allocate('KELTNER_MR', 1000);
      const json = accountant.toJSON();

      const newAccountant = StrategyAccountant.fromJSON(json);

      expect(newAccountant.getBalance('KELTNER_MR')).toBe(1000);
    });
  });

  // ==========================================================================
  // GET ALL STRATEGIES
  // ==========================================================================

  describe('getAllStrategies', () => {
    it('should return empty array when no strategies', () => {
      expect(accountant.getAllStrategies()).toEqual([]);
    });

    it('should return all strategy names', () => {
      accountant.allocate('KELTNER_MR', 1000);
      accountant.allocate('BB_SQUEEZE', 500);

      const strategies = accountant.getAllStrategies();

      expect(strategies).toContain('KELTNER_MR');
      expect(strategies).toContain('BB_SQUEEZE');
      expect(strategies).toHaveLength(2);
    });
  });
});
