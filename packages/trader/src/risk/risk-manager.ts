/**
 * Risk Manager
 *
 * Manages trading risk and position sizing with volatility normalization.
 *
 * Key Features:
 * - Volatility-adjusted position sizing
 * - Asset class risk profiles
 * - Daily loss limits
 * - Kelly Criterion (simplified)
 */

import type { Signal } from '@deriv-bot/shared';

/**
 * Asset Volatility Profile
 *
 * Based on historical backtest data:
 * - R_100: 14.3% max DD → high volatility
 * - cryETHUSD: 12.2% max DD → high volatility
 * - frxEURUSD: 0.5% max DD → low volatility
 * - OTC_GDAXI: 0.6% max DD → low volatility
 */
export interface AssetVolatilityProfile {
  /** Asset symbol */
  asset: string;
  /** Expected max drawdown percentage */
  expectedMaxDD: number;
  /** Volatility multiplier (1 = baseline) */
  volatilityMultiplier: number;
  /** Risk scaling factor (inverse of volatility) */
  riskScaleFactor: number;
}

/**
 * Default volatility profiles based on backtest results
 */
export const ASSET_VOLATILITY_PROFILES: AssetVolatilityProfile[] = [
  // Synthetic Indices - HIGH volatility
  { asset: 'R_10', expectedMaxDD: 15, volatilityMultiplier: 1.5, riskScaleFactor: 0.67 },
  { asset: 'R_25', expectedMaxDD: 15, volatilityMultiplier: 1.5, riskScaleFactor: 0.67 },
  { asset: 'R_50', expectedMaxDD: 14, volatilityMultiplier: 1.4, riskScaleFactor: 0.71 },
  { asset: 'R_75', expectedMaxDD: 14, volatilityMultiplier: 1.4, riskScaleFactor: 0.71 },
  { asset: 'R_100', expectedMaxDD: 14, volatilityMultiplier: 1.4, riskScaleFactor: 0.71 },

  // Crypto - HIGH volatility
  { asset: 'cryBTCUSD', expectedMaxDD: 12, volatilityMultiplier: 1.3, riskScaleFactor: 0.77 },
  { asset: 'cryETHUSD', expectedMaxDD: 12, volatilityMultiplier: 1.3, riskScaleFactor: 0.77 },

  // Forex - LOW volatility
  { asset: 'frxEURUSD', expectedMaxDD: 1, volatilityMultiplier: 0.5, riskScaleFactor: 2.0 },
  { asset: 'frxGBPUSD', expectedMaxDD: 1.5, volatilityMultiplier: 0.6, riskScaleFactor: 1.67 },
  { asset: 'frxUSDJPY', expectedMaxDD: 1, volatilityMultiplier: 0.5, riskScaleFactor: 2.0 },
  { asset: 'frxAUDUSD', expectedMaxDD: 1.5, volatilityMultiplier: 0.6, riskScaleFactor: 1.67 },
  { asset: 'frxUSDCHF', expectedMaxDD: 1, volatilityMultiplier: 0.5, riskScaleFactor: 2.0 },

  // Indices - MEDIUM volatility
  { asset: 'OTC_GDAXI', expectedMaxDD: 1, volatilityMultiplier: 0.5, riskScaleFactor: 2.0 },
  { asset: 'OTC_NDX', expectedMaxDD: 3, volatilityMultiplier: 0.8, riskScaleFactor: 1.25 },
  { asset: 'OTC_SPX', expectedMaxDD: 2, volatilityMultiplier: 0.7, riskScaleFactor: 1.43 },
];

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
  /** Enable volatility-adjusted sizing */
  useVolatilityAdjustment?: boolean;
  /** Custom volatility profiles (overrides defaults) */
  volatilityProfiles?: AssetVolatilityProfile[];
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
  private volatilityProfiles: Map<string, AssetVolatilityProfile>;

  constructor(config: RiskConfig) {
    this.config = config;

    // Initialize volatility profiles
    this.volatilityProfiles = new Map();
    const profiles = config.volatilityProfiles ?? ASSET_VOLATILITY_PROFILES;
    for (const profile of profiles) {
      this.volatilityProfiles.set(profile.asset, profile);
    }
  }

  /**
   * Get volatility profile for an asset
   */
  getVolatilityProfile(asset: string): AssetVolatilityProfile {
    const profile = this.volatilityProfiles.get(asset);
    if (profile) return profile;

    // Default profile for unknown assets (conservative)
    return {
      asset,
      expectedMaxDD: 10,
      volatilityMultiplier: 1.0,
      riskScaleFactor: 1.0,
    };
  }

  /**
   * Set starting balance (for daily loss tracking)
   */
  setStartingBalance(balance: number): void {
    this.startingBalance = balance;
  }

  /**
   * Evaluate a signal and determine if/how to trade
   *
   * @param signal - Trading signal to evaluate
   * @param context - Current account context
   * @param asset - Asset symbol for volatility adjustment (optional)
   */
  evaluateSignal(
    signal: Signal,
    context: {
      balance: number;
      openPositions: number;
      dailyPnL: number;
    },
    asset?: string
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

    // Calculate stake amount with volatility adjustment
    const stakeAmount = this.calculateStakeAmount(balance, signal.confidence, asset);

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
   * Calculate stake amount based on risk and volatility
   *
   * Formula:
   *   stake = balance * maxRiskPerTrade * confidence * riskScaleFactor
   *
   * Where riskScaleFactor is:
   *   - 0.67-0.77 for high volatility (R_100, crypto) → smaller positions
   *   - 1.0 for baseline
   *   - 1.5-2.0 for low volatility (forex, DAX) → larger positions
   *
   * This normalizes the expected drawdown across all assets.
   */
  private calculateStakeAmount(balance: number, confidence: number, asset?: string): number {
    // Use fixed stake if configured
    if (this.config.fixedStake) {
      return this.config.fixedStake;
    }

    // Base risk calculation
    const riskAmount = balance * this.config.maxRiskPerTrade;
    let stakeAmount = riskAmount * confidence;

    // Apply volatility adjustment if enabled and asset provided
    if (this.config.useVolatilityAdjustment && asset) {
      const profile = this.getVolatilityProfile(asset);
      stakeAmount *= profile.riskScaleFactor;
    }

    // Round to 2 decimal places
    return Math.round(stakeAmount * 100) / 100;
  }

  /**
   * Calculate optimal position size using simplified Kelly Criterion
   *
   * Kelly Formula: f* = (bp - q) / b
   * Where:
   *   f* = fraction of bankroll to bet
   *   b = odds received on the bet (e.g., 1.8 for 80% payout)
   *   p = probability of winning
   *   q = probability of losing (1 - p)
   *
   * @param winRate - Historical win rate (0-1)
   * @param avgWin - Average win amount
   * @param avgLoss - Average loss amount
   * @param balance - Current balance
   * @param kellyFraction - Fraction of Kelly to use (0.25 = quarter Kelly, safer)
   */
  calculateKellyStake(
    winRate: number,
    avgWin: number,
    avgLoss: number,
    balance: number,
    kellyFraction: number = 0.25
  ): number {
    // Odds: how much you win relative to how much you lose
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - p;

    // Kelly fraction
    const kelly = (b * p - q) / b;

    // If Kelly is negative, don't bet (strategy is unprofitable)
    if (kelly <= 0) {
      return 0;
    }

    // Apply Kelly fraction (e.g., quarter Kelly for safety)
    const adjustedKelly = kelly * kellyFraction;

    // Calculate stake
    const stakeAmount = balance * adjustedKelly;

    // Cap at max risk per trade
    const maxStake = balance * this.config.maxRiskPerTrade;

    return Math.round(Math.min(stakeAmount, maxStake) * 100) / 100;
  }

  /**
   * Get recommended stake based on backtest metrics
   */
  getRecommendedStake(
    asset: string,
    balance: number,
    backtestMetrics: {
      winRate: number;
      avgWin: number;
      avgLoss: number;
      profitFactor: number;
    }
  ): { stake: number; method: string; details: string } {
    const profile = this.getVolatilityProfile(asset);
    const { winRate, avgWin, avgLoss, profitFactor } = backtestMetrics;

    // If strategy is unprofitable, don't trade
    if (profitFactor < 1) {
      return {
        stake: 0,
        method: 'NONE',
        details: `Strategy unprofitable (PF ${profitFactor.toFixed(2)}). Do not trade.`,
      };
    }

    // Calculate Kelly stake
    const kellyStake = this.calculateKellyStake(winRate, avgWin, avgLoss, balance, 0.25);

    // Calculate volatility-adjusted stake
    const baseStake = balance * this.config.maxRiskPerTrade;
    const volAdjustedStake = baseStake * profile.riskScaleFactor;

    // Use the smaller of the two (more conservative)
    const recommendedStake = Math.min(kellyStake, volAdjustedStake);

    return {
      stake: Math.round(recommendedStake * 100) / 100,
      method: kellyStake < volAdjustedStake ? 'KELLY' : 'VOLATILITY',
      details: `Kelly: $${kellyStake.toFixed(2)}, Vol-Adj: $${volAdjustedStake.toFixed(2)} (${profile.asset} scale: ${profile.riskScaleFactor.toFixed(2)}x)`,
    };
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
