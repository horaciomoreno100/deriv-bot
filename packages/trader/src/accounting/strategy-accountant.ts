/**
 * Strategy Accountant
 *
 * Manages per-strategy balance allocation and P/L tracking.
 * This component is responsible for:
 * - Tracking allocated balance per strategy
 * - Recording trades and updating balances
 * - Providing context for RiskManager
 * - Generating per-strategy statistics
 *
 * Design principles:
 * - Single Responsibility: Only handles accounting, not risk decisions
 * - Decoupled: Works independently of RiskManager and PositionManager
 * - Event-driven: Emits events for observers
 */

import { EventEmitter } from 'events';
import type { TradeResult } from '@deriv-bot/shared';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Strategy account state
 */
interface StrategyAccount {
  /** Strategy name */
  name: string;
  /** Total allocated balance */
  balance: number;
  /** Initial allocation (for ROI calculation) */
  initialBalance: number;
  /** Reserved for open positions */
  reserved: number;
  /** Open positions count */
  openPositions: number;
  /** Trade history for stats */
  trades: TradeRecord[];
  /** Daily P/L (resets daily) */
  dailyPnL: number;
  /** Peak balance (for drawdown) */
  peakBalance: number;
  /** Max drawdown percentage */
  maxDrawdown: number;
}

/**
 * Trade record for history
 */
interface TradeRecord {
  contractId: string;
  profit: number;
  status: 'won' | 'lost';
  timestamp: number;
}

/**
 * Strategy statistics
 */
export interface StrategyStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  roi: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
}

/**
 * Risk context for RiskManager
 */
export interface RiskContext {
  balance: number;
  openPositions: number;
  dailyPnL: number;
}

/**
 * Accountant events
 */
export interface StrategyAccountantEvents {
  'trade:recorded': (
    strategyName: string,
    trade: TradeResult,
    newBalance: number
  ) => void;
  'balance:updated': (
    strategyName: string,
    newBalance: number,
    previousBalance: number
  ) => void;
  'allocation:added': (strategyName: string, amount: number) => void;
}

/**
 * Serialized state for persistence
 */
interface SerializedState {
  version: number;
  timestamp: number;
  strategies: Record<string, StrategyAccount>;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export class StrategyAccountant extends EventEmitter {
  private accounts: Map<string, StrategyAccount> = new Map();

  constructor() {
    super();
  }

  // ===========================================================================
  // ALLOCATION
  // ===========================================================================

  /**
   * Allocate balance to a strategy
   * If strategy already exists, adds to existing balance
   */
  allocate(strategyName: string, amount: number): void {
    if (amount <= 0) {
      throw new Error('Allocation amount must be positive');
    }

    const existing = this.accounts.get(strategyName);

    if (existing) {
      // Add to existing balance
      const previousBalance = existing.balance;
      existing.balance += amount;
      existing.peakBalance = Math.max(existing.peakBalance, existing.balance);
      this.emit('balance:updated', strategyName, existing.balance, previousBalance);
    } else {
      // Create new account
      this.accounts.set(strategyName, {
        name: strategyName,
        balance: amount,
        initialBalance: amount,
        reserved: 0,
        openPositions: 0,
        trades: [],
        dailyPnL: 0,
        peakBalance: amount,
        maxDrawdown: 0,
      });
    }

    this.emit('allocation:added', strategyName, amount);
  }

  // ===========================================================================
  // BALANCE QUERIES
  // ===========================================================================

  /**
   * Get total balance for a strategy (including reserved)
   */
  getBalance(strategyName: string): number {
    const account = this.accounts.get(strategyName);
    return account?.balance ?? 0;
  }

  /**
   * Get available balance (total - reserved)
   */
  getAvailableBalance(strategyName: string): number {
    const account = this.accounts.get(strategyName);
    if (!account) return 0;
    return account.balance - account.reserved;
  }

  /**
   * Get reserved balance (in open positions)
   */
  getReservedBalance(strategyName: string): number {
    const account = this.accounts.get(strategyName);
    return account?.reserved ?? 0;
  }

  /**
   * Get total balance across all strategies
   */
  getTotalBalance(): number {
    let total = 0;
    this.accounts.forEach((account) => {
      total += account.balance;
    });
    return total;
  }

  // ===========================================================================
  // TRADE RECORDING
  // ===========================================================================

  /**
   * Record a completed trade
   */
  recordTrade(strategyName: string, trade: TradeResult): void {
    const account = this.accounts.get(strategyName);

    if (!account) {
      throw new Error(`Strategy ${strategyName} not found`);
    }

    const previousBalance = account.balance;

    // Update balance (with circuit breaker - don't go below 0)
    account.balance = Math.max(0, account.balance + trade.profit);

    // Update daily P/L
    account.dailyPnL += trade.profit;

    // Update peak and drawdown
    if (account.balance > account.peakBalance) {
      account.peakBalance = account.balance;
    } else if (account.peakBalance > 0) {
      const currentDrawdown =
        ((account.peakBalance - account.balance) / account.peakBalance) * 100;
      account.maxDrawdown = Math.max(account.maxDrawdown, currentDrawdown);
    }

    // Record trade in history (only closed trades, so status is 'won' or 'lost')
    account.trades.push({
      contractId: trade.contractId,
      profit: trade.profit,
      status: trade.status as 'won' | 'lost',
      timestamp: Date.now(),
    });

    // Emit events
    this.emit('trade:recorded', strategyName, trade, account.balance);
    this.emit('balance:updated', strategyName, account.balance, previousBalance);
  }

  // ===========================================================================
  // STAKE RESERVATION (for open positions)
  // ===========================================================================

  /**
   * Reserve stake for an opening position
   * Returns true if successful, false if insufficient balance
   */
  reserveStake(strategyName: string, amount: number): boolean {
    const account = this.accounts.get(strategyName);

    if (!account) {
      return false;
    }

    const available = account.balance - account.reserved;

    if (amount > available) {
      return false;
    }

    account.reserved += amount;
    return true;
  }

  /**
   * Release reserved stake (when position closes)
   */
  releaseStake(strategyName: string, amount: number): void {
    const account = this.accounts.get(strategyName);

    if (!account) {
      return;
    }

    account.reserved = Math.max(0, account.reserved - amount);
  }

  // ===========================================================================
  // OPEN POSITIONS TRACKING
  // ===========================================================================

  /**
   * Increment open positions count
   */
  incrementOpenPositions(strategyName: string): void {
    const account = this.accounts.get(strategyName);
    if (account) {
      account.openPositions++;
    }
  }

  /**
   * Decrement open positions count
   */
  decrementOpenPositions(strategyName: string): void {
    const account = this.accounts.get(strategyName);
    if (account && account.openPositions > 0) {
      account.openPositions--;
    }
  }

  /**
   * Get open positions count
   */
  getOpenPositionsCount(strategyName: string): number {
    const account = this.accounts.get(strategyName);
    return account?.openPositions ?? 0;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get strategy statistics
   */
  getStats(strategyName: string): StrategyStats | null {
    const account = this.accounts.get(strategyName);

    if (!account) {
      return null;
    }

    const trades = account.trades;
    const wins = trades.filter((t) => t.status === 'won');
    const losses = trades.filter((t) => t.status === 'lost');

    const totalPnL = trades.reduce((sum, t) => sum + t.profit, 0);
    const totalWinProfit = wins.reduce((sum, t) => sum + t.profit, 0);
    const totalLossProfit = losses.reduce((sum, t) => sum + t.profit, 0);

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      totalPnL,
      roi:
        account.initialBalance > 0
          ? (totalPnL / account.initialBalance) * 100
          : 0,
      maxDrawdown: account.maxDrawdown,
      avgWin: wins.length > 0 ? totalWinProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLossProfit / losses.length : 0,
    };
  }

  // ===========================================================================
  // DAILY P/L
  // ===========================================================================

  /**
   * Get daily P/L for a strategy
   */
  getDailyPnL(strategyName: string): number {
    const account = this.accounts.get(strategyName);
    return account?.dailyPnL ?? 0;
  }

  /**
   * Reset daily stats for a strategy
   */
  resetDailyStats(strategyName: string): void {
    const account = this.accounts.get(strategyName);
    if (account) {
      account.dailyPnL = 0;
    }
  }

  /**
   * Reset daily stats for all strategies
   */
  resetAllDailyStats(): void {
    this.accounts.forEach((account) => {
      account.dailyPnL = 0;
    });
  }

  // ===========================================================================
  // RISK CONTEXT
  // ===========================================================================

  /**
   * Get context for RiskManager evaluation
   */
  getRiskContext(strategyName: string): RiskContext | null {
    const account = this.accounts.get(strategyName);

    if (!account) {
      return null;
    }

    return {
      balance: account.balance - account.reserved, // Available balance
      openPositions: account.openPositions,
      dailyPnL: account.dailyPnL,
    };
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  /**
   * Get all strategy names
   */
  getAllStrategies(): string[] {
    return Array.from(this.accounts.keys());
  }

  /**
   * Check if strategy exists
   */
  hasStrategy(strategyName: string): boolean {
    return this.accounts.has(strategyName);
  }

  /**
   * Remove a strategy
   */
  removeStrategy(strategyName: string): void {
    this.accounts.delete(strategyName);
  }

  // ===========================================================================
  // SERIALIZATION
  // ===========================================================================

  /**
   * Serialize state to JSON
   */
  toJSON(): string {
    const state: SerializedState = {
      version: 1,
      timestamp: Date.now(),
      strategies: Object.fromEntries(this.accounts),
    };
    return JSON.stringify(state, null, 2);
  }

  /**
   * Restore from JSON
   */
  static fromJSON(json: string): StrategyAccountant {
    const state: SerializedState = JSON.parse(json);
    const accountant = new StrategyAccountant();

    Object.entries(state.strategies).forEach(([name, account]) => {
      accountant.accounts.set(name, account);
    });

    return accountant;
  }

  // ===========================================================================
  // EVENTS (type-safe)
  // ===========================================================================

  override on<K extends keyof StrategyAccountantEvents>(
    event: K,
    listener: StrategyAccountantEvents[K]
  ): this {
    return super.on(event as string, listener);
  }

  override emit<K extends keyof StrategyAccountantEvents>(
    event: K,
    ...args: Parameters<StrategyAccountantEvents[K]>
  ): boolean {
    return super.emit(event as string, ...args);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new StrategyAccountant
 */
export function createStrategyAccountant(): StrategyAccountant {
  return new StrategyAccountant();
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { StrategyAccount, TradeRecord };
