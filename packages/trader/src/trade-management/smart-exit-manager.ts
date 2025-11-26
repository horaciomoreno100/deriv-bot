/**
 * Smart Exit Manager
 *
 * Responsible for evaluating exit conditions for open trades:
 * - RULE 1A: Max duration (40min) if profit >= 0
 * - RULE 1B: Extreme duration (120min) regardless of P&L
 * - RULE 2: Profitable + RSI reversal
 */

import type { Trade, SmartExitConfig, ExitSignal } from './types.js';

export class SmartExitManager {
  private config: SmartExitConfig;

  constructor(config?: Partial<SmartExitConfig>) {
    this.config = {
      maxTradeDuration: config?.maxTradeDuration ?? 40 * 60 * 1000,    // 40 minutes
      extremeMaxDuration: config?.extremeMaxDuration ?? 120 * 60 * 1000, // 120 minutes
      minTradeDuration: config?.minTradeDuration ?? 60 * 1000,         // 1 minute
      earlyExitTpPct: config?.earlyExitTpPct ?? 0.75,                  // 75% of TP
      stagnationDuration: config?.stagnationDuration ?? 15 * 60 * 1000, // 15 minutes
      stagnationMinProfit: config?.stagnationMinProfit ?? 0.1,          // 0.1%
      breakevenEnabled: config?.breakevenEnabled ?? true,               // Enabled by default
    };
  }

  /**
   * Evaluate if a trade should exit based on SMART Exit rules
   */
  evaluateExit(
    trade: Trade,
    currentPrice: number,
    currentTime: number = Date.now(),
    rsiValue?: number
  ): ExitSignal {
    const timeInTrade = currentTime - trade.timestamp;
    const profitPct = this.calculateProfitPct(trade, currentPrice);
    const tpPct = trade.metadata?.tpPct || 0.3;
    const slPct = trade.metadata?.slPct || 0.25;

    // EXIT RULE 0A: STAGNATION EXIT (Fast Profit Taking)
    // Close if duration > 15 min AND profit > 0.1%
    if (
      timeInTrade >= this.config.stagnationDuration &&
      profitPct >= this.config.stagnationMinProfit
    ) {
      return {
        shouldExit: true,
        reason: `Stagnation exit (${(timeInTrade / 60000).toFixed(1)}min, +${profitPct.toFixed(2)}%) - fast profit taking`,
        contractId: trade.contractId,
        profitPct,
        timeInTrade,
      };
    }

    // EXIT RULE 0B: BREAKEVEN PROTECTION (Virtual Trailing Stop)
    // Activate protect mode when profit >= 1R, then close only if price drops below entry
    if (this.config.breakevenEnabled) {
      // Check if we should activate protect mode
      if (!trade.metadata?.protectModeActive && profitPct >= slPct) {
        // Activate protect mode (this won't close the trade, just sets a flag)
        if (!trade.metadata) trade.metadata = {};
        trade.metadata.protectModeActive = true;
        trade.metadata.protectModeActivatedAt = currentTime;
        console.log(`   🛡️  [${trade.contractId}] Breakeven protection ACTIVATED at +${profitPct.toFixed(2)}% (>= ${slPct.toFixed(2)}%)`);
        console.log(`   📈 Trade can continue to TP (${tpPct.toFixed(2)}%), but will close if price drops below entry`);
      }

      // If protect mode is active, check if price dropped below entry (virtual stop loss)
      if (trade.metadata?.protectModeActive && profitPct < 0) {
        const protectDuration = trade.metadata.protectModeActivatedAt
          ? (currentTime - trade.metadata.protectModeActivatedAt) / 60000
          : 0;
        return {
          shouldExit: true,
          reason: `Breakeven protection triggered (price < entry after ${protectDuration.toFixed(1)}min in protect mode)`,
          contractId: trade.contractId,
          profitPct,
          timeInTrade,
        };
      }
    }

    // EXIT RULE 1A: MAX DURATION (only if neutral or positive)
    if (timeInTrade >= this.config.maxTradeDuration && profitPct >= 0) {
      return {
        shouldExit: true,
        reason: `Max duration (${(timeInTrade / 60000).toFixed(1)}min) - ${profitPct > 0 ? 'profit' : 'breakeven'}`,
        contractId: trade.contractId,
        profitPct,
        timeInTrade,
      };
    }

    // EXIT RULE 1B: EXTREME MAX DURATION (even if losing)
    if (timeInTrade >= this.config.extremeMaxDuration) {
      return {
        shouldExit: true,
        reason: `EXTREME duration (${(timeInTrade / 60000).toFixed(1)}min) - forced close`,
        contractId: trade.contractId,
        profitPct,
        timeInTrade,
      };
    }

    // EXIT RULE 2: PROFITABLE + RSI REVERSAL
    const earlyExitThreshold = tpPct * this.config.earlyExitTpPct;
    if (
      profitPct >= earlyExitThreshold &&
      profitPct > 0.1 &&
      timeInTrade >= this.config.minTradeDuration &&
      rsiValue !== undefined
    ) {
      // Check RSI reversal
      if (trade.direction === 'CALL' && rsiValue >= 65) {
        return {
          shouldExit: true,
          reason: `Profitable + RSI overbought (${rsiValue.toFixed(1)}) - reversal signal`,
          contractId: trade.contractId,
          profitPct,
          timeInTrade,
        };
      } else if (trade.direction === 'PUT' && rsiValue <= 35) {
        return {
          shouldExit: true,
          reason: `Profitable + RSI oversold (${rsiValue.toFixed(1)}) - reversal signal`,
          contractId: trade.contractId,
          profitPct,
          timeInTrade,
        };
      }
    }

    // No exit signal
    return {
      shouldExit: false,
      reason: '',
      contractId: trade.contractId,
      profitPct,
      timeInTrade,
    };
  }

  /**
   * Calculate profit percentage for a trade
   */
  private calculateProfitPct(trade: Trade, currentPrice: number): number {
    if (trade.direction === 'CALL') {
      return ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    } else {
      return ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): SmartExitConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartExitConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
