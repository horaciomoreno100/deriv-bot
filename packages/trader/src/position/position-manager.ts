/**
 * Position Manager
 *
 * Tracks open and closed positions
 */

import { EventEmitter } from 'events';
import type { Contract, TradeResult } from '@deriv-bot/shared';

/**
 * Position Manager Events
 */
export interface PositionManagerEvents {
  'position:opened': (position: Contract) => void;
  'position:closed': (position: Contract, result: TradeResult) => void;
  'position:updated': (position: Contract) => void;
}

/**
 * Daily Statistics
 */
export interface DailyStats {
  /** Total profit/loss for the day */
  pnl: number;
  /** Number of trades */
  tradeCount: number;
  /** Number of winning trades */
  wins: number;
  /** Number of losing trades */
  losses: number;
  /** Win rate (0-1) */
  winRate: number;
  /** Average profit */
  averageProfit: number;
  /** Average loss */
  averageLoss: number;
}

/**
 * Position Manager
 *
 * Manages open positions and tracks trading statistics
 *
 * @example
 * ```typescript
 * const positionManager = new PositionManager();
 *
 * // Listen for position events
 * positionManager.on('position:opened', (position) => {
 *   console.log('Position opened:', position);
 * });
 *
 * positionManager.on('position:closed', (position, result) => {
 *   console.log('Position closed:', result);
 * });
 *
 * // Add position
 * positionManager.addPosition(contract);
 *
 * // Get statistics
 * const stats = positionManager.getDailyStats();
 * ```
 */
export class PositionManager extends EventEmitter {
  private openPositions = new Map<string, Contract>();
  private closedPositions: TradeResult[] = [];
  private dailyStartTime: number;

  constructor() {
    super();
    this.dailyStartTime = this.getStartOfDay();
  }

  /**
   * Add a new position (when trade is executed)
   */
  addPosition(contract: Contract): void {
    this.openPositions.set(contract.id, contract);
    this.emit('position:opened', contract);
  }

  /**
   * Update an existing position
   */
  updatePosition(contract: Contract): void {
    const existing = this.openPositions.get(contract.id);

    if (!existing) {
      return;
    }

    this.openPositions.set(contract.id, contract);
    this.emit('position:updated', contract);
  }

  /**
   * Close a position (when trade completes)
   */
  closePosition(result: TradeResult): void {
    const position = this.openPositions.get(result.contractId);

    if (!position) {
      return;
    }

    // Update position status
    position.status = result.status;
    position.exitPrice = result.exitPrice;
    position.exitTime = result.exitTime;
    position.profit = result.profit;

    // Inherit strategyName from position if not in result
    const resultWithStrategy: TradeResult = {
      ...result,
      strategyName: result.strategyName ?? position.strategyName,
    };

    // Remove from open positions
    this.openPositions.delete(result.contractId);

    // Add to closed positions
    this.closedPositions.push(resultWithStrategy);

    // Emit event
    this.emit('position:closed', position, resultWithStrategy);
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Contract[] {
    return Array.from(this.openPositions.values());
  }

  /**
   * Get open positions count
   */
  getOpenPositionsCount(): number {
    return this.openPositions.size;
  }

  // ==========================================================================
  // STRATEGY-BASED FILTERING
  // ==========================================================================

  /**
   * Get open positions filtered by strategy
   */
  getOpenPositionsByStrategy(strategyName: string): Contract[] {
    return Array.from(this.openPositions.values()).filter(
      (p) => p.strategyName === strategyName
    );
  }

  /**
   * Get open positions count for a specific strategy
   */
  getOpenPositionsCountByStrategy(strategyName: string): number {
    return this.getOpenPositionsByStrategy(strategyName).length;
  }

  /**
   * Get daily statistics filtered by strategy
   */
  getDailyStatsByStrategy(strategyName: string): DailyStats {
    const todayResults = this.getClosedPositions().filter(
      (r) => r.strategyName === strategyName
    );

    if (todayResults.length === 0) {
      return {
        pnl: 0,
        tradeCount: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        averageProfit: 0,
        averageLoss: 0,
      };
    }

    const wins = todayResults.filter((r) => r.status === 'won');
    const losses = todayResults.filter((r) => r.status === 'lost');

    const totalPnL = todayResults.reduce((sum, r) => sum + r.profit, 0);
    const totalWinProfit = wins.reduce((sum, r) => sum + r.profit, 0);
    const totalLossProfit = losses.reduce((sum, r) => sum + r.profit, 0);

    return {
      pnl: totalPnL,
      tradeCount: todayResults.length,
      wins: wins.length,
      losses: losses.length,
      winRate: wins.length / todayResults.length,
      averageProfit: wins.length > 0 ? totalWinProfit / wins.length : 0,
      averageLoss: losses.length > 0 ? totalLossProfit / losses.length : 0,
    };
  }

  /**
   * Get a specific position
   */
  getPosition(contractId: string): Contract | undefined {
    return this.openPositions.get(contractId);
  }

  /**
   * Get closed positions (today)
   */
  getClosedPositions(): TradeResult[] {
    return this.closedPositions.filter(
      (result) => result.exitTime >= this.dailyStartTime
    );
  }

  /**
   * Get daily statistics
   */
  getDailyStats(): DailyStats {
    const todayResults = this.getClosedPositions();

    if (todayResults.length === 0) {
      return {
        pnl: 0,
        tradeCount: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        averageProfit: 0,
        averageLoss: 0,
      };
    }

    const wins = todayResults.filter((r) => r.status === 'won');
    const losses = todayResults.filter((r) => r.status === 'lost');

    const totalPnL = todayResults.reduce((sum, r) => sum + r.profit, 0);
    const totalWinProfit = wins.reduce((sum, r) => sum + r.profit, 0);
    const totalLossProfit = losses.reduce((sum, r) => sum + r.profit, 0);

    return {
      pnl: totalPnL,
      tradeCount: todayResults.length,
      wins: wins.length,
      losses: losses.length,
      winRate: wins.length / todayResults.length,
      averageProfit: wins.length > 0 ? totalWinProfit / wins.length : 0,
      averageLoss: losses.length > 0 ? totalLossProfit / losses.length : 0,
    };
  }

  /**
   * Reset daily statistics
   */
  resetDailyStats(): void {
    this.closedPositions = [];
    this.dailyStartTime = this.getStartOfDay();
  }

  /**
   * Clear all positions
   */
  clear(): void {
    this.openPositions.clear();
    this.closedPositions = [];
  }

  /**
   * Get start of current day (in ms)
   */
  private getStartOfDay(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  /**
   * Type-safe event listener
   */
  override on<K extends keyof PositionManagerEvents>(
    event: K,
    listener: PositionManagerEvents[K]
  ): this {
    return super.on(event as string, listener);
  }

  /**
   * Type-safe event emitter
   */
  override emit<K extends keyof PositionManagerEvents>(
    event: K,
    ...args: Parameters<PositionManagerEvents[K]>
  ): boolean {
    return super.emit(event as string, ...args);
  }
}
