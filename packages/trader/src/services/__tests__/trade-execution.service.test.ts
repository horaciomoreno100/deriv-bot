/**
 * Trade Execution Service Tests
 *
 * Critical tests for trade execution, especially the canOpenTrade check
 * which prevents opening too many concurrent trades.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TradeExecutionService, type TradeExecutionConfig } from '../trade-execution.service.js';
import type { Signal } from '@deriv-bot/shared';

// Mock dependencies
const mockGatewayClient = {
  getBalance: vi.fn().mockResolvedValue({ amount: 1000 }),
  trade: vi.fn(),
  tradeCFD: vi.fn(),
};

const mockTradeAdapter = {
  executeTrade: vi.fn(),
  closeTrade: vi.fn(),
};

const mockTradeManager = {
  canOpenTrade: vi.fn(),
  calculateStake: vi.fn().mockResolvedValue(20),
  registerTrade: vi.fn(),
  on: vi.fn(),
};

describe('TradeExecutionService', () => {
  let service: TradeExecutionService;
  const config: TradeExecutionConfig = {
    mode: 'cfd',
    strategyName: 'TEST_STRATEGY',
    cfdTakeProfitPct: 0.004,
    cfdStopLossPct: 0.003,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TradeExecutionService(
      mockGatewayClient as any,
      mockTradeAdapter as any,
      mockTradeManager as any,
      config
    );
  });

  describe('canOpenTrade check', () => {
    it('should reject trade when global limit is reached', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({
        allowed: false,
        reason: 'Global limit reached (3/3)',
      });

      const signal: Signal = {
        direction: 'CALL',
        confidence: 0.8,
        timestamp: Date.now(),
        metadata: { entryPrice: 100 },
      };

      // Act
      const result = await service.executeTrade(signal, 'R_100');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Global limit reached (3/3)');
      expect(mockTradeManager.canOpenTrade).toHaveBeenCalledWith('R_100');
      expect(mockTradeAdapter.executeTrade).not.toHaveBeenCalled();
    });

    it('should reject trade when per-symbol limit is reached', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({
        allowed: false,
        reason: 'Symbol limit reached for R_100 (1/1)',
      });

      const signal: Signal = {
        direction: 'PUT',
        confidence: 0.9,
        timestamp: Date.now(),
        metadata: { entryPrice: 100 },
      };

      // Act
      const result = await service.executeTrade(signal, 'R_100');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Symbol limit reached for R_100 (1/1)');
      expect(mockTradeManager.canOpenTrade).toHaveBeenCalledWith('R_100');
    });

    it('should reject trade when daily loss limit is reached', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({
        allowed: false,
        reason: 'Daily loss limit reached (5.0% >= 5%). Trading paused until tomorrow.',
      });

      const signal: Signal = {
        direction: 'CALL',
        confidence: 0.85,
        timestamp: Date.now(),
        metadata: { entryPrice: 100 },
      };

      // Act
      const result = await service.executeTrade(signal, 'R_75');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Daily loss limit reached');
    });

    it('should allow trade when all limits are OK', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeAdapter.executeTrade.mockResolvedValue({
        success: true,
        contractId: '123456',
        entryPrice: 100,
      });

      const signal: Signal = {
        direction: 'CALL',
        confidence: 0.8,
        timestamp: Date.now(),
        metadata: { entryPrice: 100 },
      };

      // Act
      const result = await service.executeTrade(signal, 'R_100');

      // Assert
      expect(mockTradeManager.canOpenTrade).toHaveBeenCalledWith('R_100');
      // Trade should proceed (canOpenTrade returned allowed: true)
    });

    it('should check canOpenTrade BEFORE calculating stake', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({
        allowed: false,
        reason: 'Global limit reached',
      });

      const signal: Signal = {
        direction: 'CALL',
        confidence: 0.8,
        timestamp: Date.now(),
        metadata: { entryPrice: 100 },
      };

      // Act
      await service.executeTrade(signal, 'R_100');

      // Assert - calculateStake should NOT be called if canOpenTrade fails
      expect(mockTradeManager.canOpenTrade).toHaveBeenCalled();
      expect(mockTradeManager.calculateStake).not.toHaveBeenCalled();
    });

    it('should use correct asset from signal', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({
        allowed: false,
        reason: 'Test',
      });

      const signalWithAsset: Signal & { asset: string } = {
        direction: 'PUT',
        confidence: 0.7,
        timestamp: Date.now(),
        metadata: { entryPrice: 50 },
        asset: 'R_75',
      };

      // Act
      await service.executeTrade(signalWithAsset);

      // Assert
      expect(mockTradeManager.canOpenTrade).toHaveBeenCalledWith('R_75');
    });
  });
});
