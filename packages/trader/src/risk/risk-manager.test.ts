/**
 * Risk Manager Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RiskManager } from './risk-manager.js';
import type { Signal } from '@deriv-bot/shared';

describe('RiskManager', () => {
  let riskManager: RiskManager;
  let mockSignal: Signal;

  beforeEach(() => {
    riskManager = new RiskManager({
      maxRiskPerTrade: 0.02, // 2%
      maxOpenPositions: 3,
      maxDailyLoss: 0.10, // 10%
      minConfidence: 0.7,
    });

    riskManager.setStartingBalance(1000);

    mockSignal = {
      strategyName: 'TestStrategy',
      symbol: 'R_100',
      direction: 'CALL',
      confidence: 0.8,
      timestamp: Date.now(),
    };
  });

  describe('evaluateSignal', () => {
    it('should approve signal with sufficient confidence', () => {
      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 0,
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(true);
      expect(decision.stakeAmount).toBeGreaterThan(0);
    });

    it('should reject signal with low confidence', () => {
      mockSignal.confidence = 0.5; // Below 0.7 threshold

      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 0,
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(false);
      expect(decision.reason).toContain('Confidence');
    });

    it('should reject when max open positions reached', () => {
      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 3, // At max
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(false);
      expect(decision.reason).toContain('Maximum open positions');
    });

    it('should reject when daily loss limit reached', () => {
      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 0,
        dailyPnL: -100, // Lost 10% of starting balance
      });

      expect(decision.approved).toBe(false);
      expect(decision.reason).toContain('Daily loss limit');
    });

    it('should reject when insufficient balance', () => {
      // With fixed stake = 100, balance = 50 should be insufficient
      riskManager.updateConfig({ fixedStake: 100 });

      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 50, // Less than fixed stake
        openPositions: 0,
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(false);
      expect(decision.reason).toContain('Insufficient balance');
    });

    it('should calculate risk-based stake amount', () => {
      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 0,
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(true);
      // Stake = balance * maxRiskPerTrade * confidence
      // = 1000 * 0.02 * 0.8 = 16
      expect(decision.stakeAmount).toBe(16);
    });

    it('should scale stake with confidence', () => {
      mockSignal.confidence = 0.9;

      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 0,
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(true);
      // Stake = 1000 * 0.02 * 0.9 = 18
      expect(decision.stakeAmount).toBe(18);
    });

    it('should use fixed stake when configured', () => {
      riskManager.updateConfig({ fixedStake: 50 });

      const decision = riskManager.evaluateSignal(mockSignal, {
        balance: 1000,
        openPositions: 0,
        dailyPnL: 0,
      });

      expect(decision.approved).toBe(true);
      expect(decision.stakeAmount).toBe(50);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      riskManager.updateConfig({ maxRiskPerTrade: 0.05 });

      const config = riskManager.getConfig();
      expect(config.maxRiskPerTrade).toBe(0.05);
      expect(config.maxOpenPositions).toBe(3); // Unchanged
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = riskManager.getConfig();

      expect(config.maxRiskPerTrade).toBe(0.02);
      expect(config.maxOpenPositions).toBe(3);
      expect(config.maxDailyLoss).toBe(0.10);
      expect(config.minConfidence).toBe(0.7);
    });
  });
});
