/**
 * Position Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PositionManager } from './position-manager.js';
import type { Contract, TradeResult } from '@deriv-bot/shared';

describe('PositionManager', () => {
  let positionManager: PositionManager;
  let mockContract: Contract;

  beforeEach(() => {
    positionManager = new PositionManager();

    mockContract = {
      id: 'contract-123',
      symbol: 'R_100',
      direction: 'CALL',
      stake: 10,
      payout: 18,
      entryPrice: 1234.56,
      entryTime: Date.now(),
      status: 'open',
      duration: 60,
    };
  });

  describe('addPosition', () => {
    it('should add a new position', () => {
      positionManager.addPosition(mockContract);

      const positions = positionManager.getOpenPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].id).toBe('contract-123');
    });

    it('should emit position:opened event', () => {
      const handler = vi.fn();
      positionManager.on('position:opened', handler);

      positionManager.addPosition(mockContract);

      expect(handler).toHaveBeenCalledWith(mockContract);
    });

    it('should increment open positions count', () => {
      expect(positionManager.getOpenPositionsCount()).toBe(0);

      positionManager.addPosition(mockContract);

      expect(positionManager.getOpenPositionsCount()).toBe(1);
    });
  });

  describe('updatePosition', () => {
    it('should update an existing position', () => {
      positionManager.addPosition(mockContract);

      const updated = { ...mockContract, currentPrice: 1240 };
      positionManager.updatePosition(updated);

      const position = positionManager.getPosition('contract-123');
      expect(position?.currentPrice).toBe(1240);
    });

    it('should emit position:updated event', () => {
      positionManager.addPosition(mockContract);

      const handler = vi.fn();
      positionManager.on('position:updated', handler);

      const updated = { ...mockContract, currentPrice: 1240 };
      positionManager.updatePosition(updated);

      expect(handler).toHaveBeenCalledWith(updated);
    });

    it('should not update non-existent position', () => {
      const handler = vi.fn();
      positionManager.on('position:updated', handler);

      positionManager.updatePosition(mockContract);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('closePosition', () => {
    it('should close a position', () => {
      positionManager.addPosition(mockContract);

      const result: TradeResult = {
        contractId: 'contract-123',
        symbol: 'R_100',
        direction: 'CALL',
        status: 'won',
        stake: 10,
        payout: 18,
        profit: 8,
        entryPrice: 1234.56,
        exitPrice: 1245.00,
        entryTime: mockContract.entryTime,
        exitTime: Date.now(),
      };

      positionManager.closePosition(result);

      expect(positionManager.getOpenPositionsCount()).toBe(0);
      expect(positionManager.getClosedPositions()).toHaveLength(1);
    });

    it('should emit position:closed event', () => {
      positionManager.addPosition(mockContract);

      const handler = vi.fn();
      positionManager.on('position:closed', handler);

      const result: TradeResult = {
        contractId: 'contract-123',
        symbol: 'R_100',
        direction: 'CALL',
        status: 'won',
        stake: 10,
        payout: 18,
        profit: 8,
        entryPrice: 1234.56,
        exitPrice: 1245.00,
        entryTime: mockContract.entryTime,
        exitTime: Date.now(),
      };

      positionManager.closePosition(result);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'contract-123' }),
        result
      );
    });

    it('should update position with exit data', () => {
      positionManager.addPosition(mockContract);

      const result: TradeResult = {
        contractId: 'contract-123',
        symbol: 'R_100',
        direction: 'CALL',
        status: 'won',
        stake: 10,
        payout: 18,
        profit: 8,
        entryPrice: 1234.56,
        exitPrice: 1245.00,
        entryTime: mockContract.entryTime,
        exitTime: Date.now(),
      };

      positionManager.closePosition(result);

      const closed = positionManager.getClosedPositions();
      expect(closed[0].profit).toBe(8);
      expect(closed[0].exitPrice).toBe(1245.00);
    });
  });

  describe('getDailyStats', () => {
    it('should return empty stats when no trades', () => {
      const stats = positionManager.getDailyStats();

      expect(stats.pnl).toBe(0);
      expect(stats.tradeCount).toBe(0);
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.winRate).toBe(0);
    });

    it('should calculate daily stats correctly', () => {
      // Add and close 2 winning trades
      for (let i = 0; i < 2; i++) {
        const contract = { ...mockContract, id: `contract-${i}` };
        positionManager.addPosition(contract);

        const result: TradeResult = {
          contractId: contract.id,
          symbol: 'R_100',
          direction: 'CALL',
          status: 'won',
          stake: 10,
          payout: 18,
          profit: 8,
          entryPrice: 1234.56,
          exitPrice: 1245.00,
          entryTime: Date.now(),
          exitTime: Date.now(),
        };

        positionManager.closePosition(result);
      }

      // Add and close 1 losing trade
      const losingContract = { ...mockContract, id: 'contract-loss' };
      positionManager.addPosition(losingContract);

      const lossResult: TradeResult = {
        contractId: 'contract-loss',
        symbol: 'R_100',
        direction: 'PUT',
        status: 'lost',
        stake: 10,
        payout: 0,
        profit: -10,
        entryPrice: 1234.56,
        exitPrice: 1220.00,
        entryTime: Date.now(),
        exitTime: Date.now(),
      };

      positionManager.closePosition(lossResult);

      const stats = positionManager.getDailyStats();

      expect(stats.tradeCount).toBe(3);
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBeCloseTo(0.666, 2);
      expect(stats.pnl).toBe(6); // 8 + 8 - 10
      expect(stats.averageProfit).toBe(8);
      expect(stats.averageLoss).toBe(-10);
    });
  });

  describe('getPosition', () => {
    it('should return position by ID', () => {
      positionManager.addPosition(mockContract);

      const position = positionManager.getPosition('contract-123');

      expect(position).toBeDefined();
      expect(position?.id).toBe('contract-123');
    });

    it('should return undefined for non-existent position', () => {
      const position = positionManager.getPosition('non-existent');

      expect(position).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all positions', () => {
      positionManager.addPosition(mockContract);

      positionManager.clear();

      expect(positionManager.getOpenPositionsCount()).toBe(0);
      expect(positionManager.getClosedPositions()).toHaveLength(0);
    });
  });

  describe('resetDailyStats', () => {
    it('should reset daily statistics', () => {
      positionManager.addPosition(mockContract);

      const result: TradeResult = {
        contractId: 'contract-123',
        symbol: 'R_100',
        direction: 'CALL',
        status: 'won',
        stake: 10,
        payout: 18,
        profit: 8,
        entryPrice: 1234.56,
        exitPrice: 1245.00,
        entryTime: Date.now(),
        exitTime: Date.now(),
      };

      positionManager.closePosition(result);

      expect(positionManager.getDailyStats().tradeCount).toBe(1);

      positionManager.resetDailyStats();

      expect(positionManager.getDailyStats().tradeCount).toBe(0);
    });
  });

  // ==========================================================================
  // STRATEGY-BASED FILTERING (NEW)
  // ==========================================================================

  describe('strategy filtering', () => {
    it('should track positions by strategy', () => {
      const contract1 = { ...mockContract, id: 'c1', strategyName: 'KELTNER_MR' };
      const contract2 = { ...mockContract, id: 'c2', strategyName: 'BB_SQUEEZE' };
      const contract3 = { ...mockContract, id: 'c3', strategyName: 'KELTNER_MR' };

      positionManager.addPosition(contract1);
      positionManager.addPosition(contract2);
      positionManager.addPosition(contract3);

      expect(positionManager.getOpenPositionsByStrategy('KELTNER_MR')).toHaveLength(2);
      expect(positionManager.getOpenPositionsByStrategy('BB_SQUEEZE')).toHaveLength(1);
    });

    it('should count open positions by strategy', () => {
      const contract1 = { ...mockContract, id: 'c1', strategyName: 'KELTNER_MR' };
      const contract2 = { ...mockContract, id: 'c2', strategyName: 'BB_SQUEEZE' };

      positionManager.addPosition(contract1);
      positionManager.addPosition(contract2);

      expect(positionManager.getOpenPositionsCountByStrategy('KELTNER_MR')).toBe(1);
      expect(positionManager.getOpenPositionsCountByStrategy('BB_SQUEEZE')).toBe(1);
      expect(positionManager.getOpenPositionsCountByStrategy('NON_EXISTENT')).toBe(0);
    });

    it('should get daily stats by strategy', () => {
      // KELTNER_MR: 1 win
      const keltnerContract = { ...mockContract, id: 'k1', strategyName: 'KELTNER_MR' };
      positionManager.addPosition(keltnerContract);
      positionManager.closePosition({
        contractId: 'k1',
        status: 'won',
        profit: 50,
        exitPrice: 1250,
        exitTime: Date.now(),
        strategyName: 'KELTNER_MR',
      });

      // BB_SQUEEZE: 1 loss
      const bbContract = { ...mockContract, id: 'b1', strategyName: 'BB_SQUEEZE' };
      positionManager.addPosition(bbContract);
      positionManager.closePosition({
        contractId: 'b1',
        status: 'lost',
        profit: -20,
        exitPrice: 1200,
        exitTime: Date.now(),
        strategyName: 'BB_SQUEEZE',
      });

      const keltnerStats = positionManager.getDailyStatsByStrategy('KELTNER_MR');
      const bbStats = positionManager.getDailyStatsByStrategy('BB_SQUEEZE');

      expect(keltnerStats.wins).toBe(1);
      expect(keltnerStats.losses).toBe(0);
      expect(keltnerStats.pnl).toBe(50);

      expect(bbStats.wins).toBe(0);
      expect(bbStats.losses).toBe(1);
      expect(bbStats.pnl).toBe(-20);
    });

    it('should inherit strategyName from position when closing', () => {
      const contract = { ...mockContract, id: 'c1', strategyName: 'KELTNER_MR' };
      positionManager.addPosition(contract);

      // Close without strategyName in result - should inherit from position
      positionManager.closePosition({
        contractId: 'c1',
        status: 'won',
        profit: 50,
        exitPrice: 1250,
        exitTime: Date.now(),
      });

      const stats = positionManager.getDailyStatsByStrategy('KELTNER_MR');
      expect(stats.wins).toBe(1);
    });
  });
});
