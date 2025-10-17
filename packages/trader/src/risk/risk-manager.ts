/**
 * Risk Manager
 *
 * Manages trading risk and position sizing
 */

import type { Signal } from '@deriv-bot/shared';

/**
 * Risk Management Configuration
 */
export interface RiskConfig {
  /** Maximum risk per trade (as percentage of balance, 0.01 = 1%) */
  maxRiskPerTrade: number;
  /** Maximum open positions */
  maxOpenPositions: number;
  /** Maximum daily loss (as percentage of starting balance) */
  maxDailyLoss: number;
  /** Minimum confidence required to trade */
  minConfidence: number;
  /** Fixed stake amount (overrides risk-based sizing if set) */
  fixedStake?: number;
}

/**
 * Trade Decision
 */
export interface TradeDecision {
  /** Whether to execute the trade */
  approved: boolean;
  /** Stake amount (if approved) */
  stakeAmount?: number;
  /** Reason for rejection (if not approved) */
  reason?: string;
}

/**
 * Risk Manager
 *
 * Evaluates signals and determines:
 * - Whether to take the trade
 * - Position size based on risk
 *
 * @example
 * ```typescript
 * const riskManager = new RiskManager({
 *   maxRiskPerTrade: 0.02, // 2% per trade
 *   maxOpenPositions: 3,
 *   maxDailyLoss: 0.10, // 10% max daily loss
 *   minConfidence: 0.7, // 70% minimum confidence
 * });
 *
 * // Evaluate a signal
 * const decision = riskManager.evaluateSignal(signal, {
 *   balance: 1000,
 *   openPositions: 1,
 *   dailyPnL: -50,
 * });
 *
 * if (decision.approved) {
 *   // Execute trade with decision.stakeAmount
 * }
 * ```
 */
export class RiskManager {
  private config: RiskConfig;
  private startingBalance: number = 0;

  constructor(config: RiskConfig) {
    this.config = config;
  }

  /**
   * Set starting balance (for daily loss tracking)
   */
  setStartingBalance(balance: number): void {
    this.startingBalance = balance;
  }

  /**
   * Evaluate a signal and determine if/how to trade
   */
  evaluateSignal(
    signal: Signal,
    context: {
      balance: number;
      openPositions: number;
      dailyPnL: number;
    }
  ): TradeDecision {
    const { balance, openPositions, dailyPnL } = context;

    // Check confidence threshold
    if (signal.confidence < this.config.minConfidence) {
      return {
        approved: false,
        reason: `Confidence ${signal.confidence.toFixed(2)} below minimum ${this.config.minConfidence.toFixed(2)}`,
      };
    }

    // Check max open positions
    if (openPositions >= this.config.maxOpenPositions) {
      return {
        approved: false,
        reason: `Maximum open positions (${this.config.maxOpenPositions}) reached`,
      };
    }

    // Check daily loss limit
    const maxDailyLossAmount = this.startingBalance * this.config.maxDailyLoss;
    if (Math.abs(dailyPnL) >= maxDailyLossAmount) {
      return {
        approved: false,
        reason: `Daily loss limit reached (${dailyPnL.toFixed(2)} / ${maxDailyLossAmount.toFixed(2)})`,
      };
    }

    // Calculate stake amount
    const stakeAmount = this.calculateStakeAmount(balance, signal.confidence);

    // Check if balance is sufficient
    if (stakeAmount > balance) {
      return {
        approved: false,
        reason: `Insufficient balance (${balance.toFixed(2)} < ${stakeAmount.toFixed(2)})`,
      };
    }

    return {
      approved: true,
      stakeAmount,
    };
  }

  /**
   * Calculate stake amount based on risk
   */
  private calculateStakeAmount(balance: number, confidence: number): number {
    // Use fixed stake if configured
    if (this.config.fixedStake) {
      return this.config.fixedStake;
    }

    // Risk-based sizing: stake = balance * maxRiskPerTrade * confidence
    // Higher confidence = larger position
    const riskAmount = balance * this.config.maxRiskPerTrade;
    const stakeAmount = riskAmount * confidence;

    // Round to 2 decimal places
    return Math.round(stakeAmount * 100) / 100;
  }

  /**
   * Update risk configuration
   */
  updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RiskConfig {
    return { ...this.config };
  }
}
