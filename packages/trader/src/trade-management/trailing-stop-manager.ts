/**
 * Trailing Stop Manager
 *
 * Manages dynamic trailing stop loss for CFD trades:
 * - Activates when profit reaches 20% of TP target
 * - Trails profit with 0.1% buffer
 * - Locks in profits by adjusting TP dynamically
 */

import type { TrailingStopInfo, TrailingStopConfig } from './types.js';

export class TrailingStopManager {
  private trailingStops: Map<string, TrailingStopInfo>;
  private config: TrailingStopConfig;

  constructor(config?: Partial<TrailingStopConfig>) {
    this.trailingStops = new Map();
    this.config = {
      activationThreshold: config?.activationThreshold ?? 0.20, // 20% of TP
      buffer: config?.buffer ?? 0.001,                          // 0.1%
    };
  }

  /**
   * Initialize trailing stop for a new trade
   */
  initializeTrailingStop(
    contractId: string,
    asset: string,
    direction: 'CALL' | 'PUT',
    entryPrice: number,
    takeProfit: number
  ): void {
    const trailingInfo: TrailingStopInfo = {
      contractId,
      asset,
      direction,
      entryPrice,
      currentTP: takeProfit,
      highestProfit: 0,
      isTrailingActive: false,
    };

    this.trailingStops.set(contractId, trailingInfo);
  }

  /**
   * Update trailing stop with current profit
   * Returns true if trade should be closed
   */
  updateTrailingStop(
    contractId: string,
    profitPct: number,
    tpPct: number
  ): { shouldExit: boolean; reason?: string; updatedTP?: number } {
    const trailing = this.trailingStops.get(contractId);
    if (!trailing) {
      return { shouldExit: false };
    }

    // Update highest profit
    if (profitPct > trailing.highestProfit) {
      trailing.highestProfit = profitPct;
    }

    // Activate trailing if threshold reached
    const activationThreshold = tpPct * this.config.activationThreshold;
    if (!trailing.isTrailingActive && profitPct >= activationThreshold) {
      trailing.isTrailingActive = true;
      trailing.trailingActivatedAt = Date.now();
      console.log(`📈 TRAILING STOP ACTIVATED for ${contractId}`);
      console.log(`   Profit: ${profitPct.toFixed(2)}% | Threshold: ${activationThreshold.toFixed(2)}%`);
    }

    // Check if we should exit (profit dropped below buffer)
    if (trailing.isTrailingActive) {
      const profitDrop = trailing.highestProfit - profitPct;
      const bufferThreshold = tpPct * this.config.buffer;

      if (profitDrop >= bufferThreshold) {
        return {
          shouldExit: true,
          reason: `Trailing stop: profit dropped ${profitDrop.toFixed(3)}% from max ${trailing.highestProfit.toFixed(2)}%`,
        };
      }

      // Calculate new TP (lock in profits)
      const direction = trailing.direction;
      const entryPrice = trailing.entryPrice;
      const lockedProfitPct = trailing.highestProfit - bufferThreshold;

      const newTP = direction === 'CALL'
        ? entryPrice * (1 + lockedProfitPct / 100)
        : entryPrice * (1 - lockedProfitPct / 100);

      // Only update if significantly different
      if (Math.abs(newTP - trailing.currentTP) > 0.01) {
        trailing.currentTP = newTP;
        return {
          shouldExit: false,
          updatedTP: newTP,
        };
      }
    }

    return { shouldExit: false };
  }

  /**
   * Get trailing stop info for a contract
   */
  getTrailingStop(contractId: string): TrailingStopInfo | undefined {
    return this.trailingStops.get(contractId);
  }

  /**
   * Remove trailing stop (when trade closes)
   */
  removeTrailingStop(contractId: string): void {
    this.trailingStops.delete(contractId);
  }

  /**
   * Get all active trailing stops
   */
  getAllTrailingStops(): Map<string, TrailingStopInfo> {
    return new Map(this.trailingStops);
  }

  /**
   * Clear all trailing stops
   */
  clear(): void {
    this.trailingStops.clear();
  }

  /**
   * Get configuration
   */
  getConfig(): TrailingStopConfig {
    return { ...this.config };
  }
}
