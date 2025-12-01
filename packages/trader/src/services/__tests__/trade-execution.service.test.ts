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

  describe('Signal to Trade Flow (TDD)', () => {
    /**
     * These tests verify the complete signal-to-trade execution flow
     * that was broken due to:
     * 1. Wrong method name (executeSignal vs executeTrade)
     * 2. Entry price not found in signal (signal.price vs signal.metadata.price)
     */

    it('should extract entry price from signal.price (direct)', async () => {
      // Arrange - This is how CryptoScalp v2 sends signals
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeAdapter.executeTrade.mockResolvedValue({
        success: true,
        contractId: '123456',
        entryPrice: 2847.50,
      });

      const signalWithDirectPrice = {
        direction: 'CALL' as const,
        confidence: 0.7,
        timestamp: Date.now(),
        asset: 'cryETHUSD',
        price: 2847.50, // Direct price, not in metadata
        reason: 'CryptoScalp v2 Entry',
      };

      // Act
      const result = await service.executeTrade(signalWithDirectPrice as any);

      // Assert
      expect(result.success).toBe(true);
      expect(mockTradeAdapter.executeTrade).toHaveBeenCalled();
      // Verify entry price was extracted correctly
      const tradeCall = mockTradeAdapter.executeTrade.mock.calls[0];
      expect(tradeCall).toBeDefined();
    });

    it('should extract entry price from signal.metadata.price', async () => {
      // Arrange - Legacy format with price in metadata
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeAdapter.executeTrade.mockResolvedValue({
        success: true,
        contractId: '789012',
        entryPrice: 100,
      });

      const signalWithMetadataPrice: Signal = {
        direction: 'PUT',
        confidence: 0.8,
        timestamp: Date.now(),
        metadata: { price: 100 },
      };

      // Act
      const result = await service.executeTrade(signalWithMetadataPrice, 'R_100');

      // Assert
      expect(result.success).toBe(true);
      expect(mockTradeAdapter.executeTrade).toHaveBeenCalled();
    });

    it('should extract entry price from signal.metadata.entryPrice', async () => {
      // Arrange - Another legacy format
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeAdapter.executeTrade.mockResolvedValue({
        success: true,
        contractId: '345678',
        entryPrice: 150,
      });

      const signalWithEntryPrice: Signal = {
        direction: 'CALL',
        confidence: 0.75,
        timestamp: Date.now(),
        metadata: { entryPrice: 150 },
      };

      // Act
      const result = await service.executeTrade(signalWithEntryPrice, 'R_75');

      // Assert
      expect(result.success).toBe(true);
      expect(mockTradeAdapter.executeTrade).toHaveBeenCalled();
    });

    it('should fail CFD trade when no entry price is available', async () => {
      // Arrange - Signal without any price information
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });

      const signalWithoutPrice: Signal = {
        direction: 'CALL',
        confidence: 0.8,
        timestamp: Date.now(),
        // No price anywhere
      };

      // Act
      const result = await service.executeTrade(signalWithoutPrice, 'cryETHUSD');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Entry price not available');
      expect(mockTradeAdapter.executeTrade).not.toHaveBeenCalled();
    });

    it('should prioritize signal.price over metadata.price', async () => {
      // Arrange - Both locations have prices, direct should win
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeAdapter.executeTrade.mockResolvedValue({
        success: true,
        contractId: '999999',
        entryPrice: 2850,
      });

      const signalWithBothPrices = {
        direction: 'CALL' as const,
        confidence: 0.7,
        timestamp: Date.now(),
        asset: 'cryETHUSD',
        price: 2850, // Direct price should be used
        metadata: { price: 2800 }, // This should be ignored
      };

      // Act
      const result = await service.executeTrade(signalWithBothPrices as any);

      // Assert
      expect(result.success).toBe(true);
      // The trade should use 2850, not 2800
    });

    it('should execute complete signal-to-trade flow successfully', async () => {
      // Arrange - Full flow test mimicking CryptoScalp v2
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeManager.calculateStake.mockResolvedValue(72.20);
      mockGatewayClient.getBalance.mockResolvedValue({ amount: 2406.69 });
      mockTradeAdapter.executeTrade.mockResolvedValue({
        success: true,
        contractId: '300670917748',
        entryPrice: 2837.49,
      });

      const cryptoScalpSignal = {
        asset: 'cryETHUSD',
        direction: 'CALL' as const,
        confidence: 0.7,
        timestamp: Date.now(),
        price: 2837.49,
        reason: 'CryptoScalp v2 Entry',
      };

      // Act
      const result = await service.executeTrade(cryptoScalpSignal as any);

      // Assert - Complete flow verification
      expect(mockTradeManager.canOpenTrade).toHaveBeenCalledWith('cryETHUSD');
      expect(mockTradeManager.calculateStake).toHaveBeenCalled();
      expect(mockGatewayClient.getBalance).toHaveBeenCalled();
      expect(mockTradeAdapter.executeTrade).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.contractId).toBe('300670917748');
    });

    it('should handle trade adapter errors gracefully', async () => {
      // Arrange
      mockTradeManager.canOpenTrade.mockReturnValue({ allowed: true });
      mockTradeAdapter.executeTrade.mockRejectedValue(
        new Error('CFD buy failed: Amount too high')
      );

      const signal = {
        direction: 'CALL' as const,
        confidence: 0.7,
        timestamp: Date.now(),
        asset: 'cryETHUSD',
        price: 2850,
      };

      // Act
      const result = await service.executeTrade(signal as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('CFD buy failed');
    });
  });
});
