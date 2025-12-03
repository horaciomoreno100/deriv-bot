/**
 * Trade Manager
 *
 * Main orchestrator for trade management:
 * - Coordinates all sub-managers (Risk, SmartExit, TrailingStop, PositionMonitor)
 * - Maintains tradeHistory
 * - Provides unified interface for trade lifecycle
 * - Handles position recovery
 */

import { EventEmitter } from 'events';
import type { GatewayClient } from '@deriv-bot/shared';
import type { UnifiedTradeAdapter } from '../adapters/trade-adapter.js';
import { SmartExitManager } from './smart-exit-manager.js';
import { TrailingStopManager } from './trailing-stop-manager.js';
import { RiskManager } from './risk-manager.js';
import { PositionMonitor } from './position-monitor.js';
import type {
  Trade,
  SmartExitConfig,
  TrailingStopConfig,
  RiskConfig,
  PositionUpdate,
  ClosedPositionDetails,
} from './types.js';

export interface TradeManagerConfig {
  smartExit?: Partial<SmartExitConfig>;
  trailingStop?: Partial<TrailingStopConfig>;
  risk?: Partial<RiskConfig>;
  pollingInterval?: number;
}

export class TradeManager extends EventEmitter {
  private client: GatewayClient;
  private adapter: UnifiedTradeAdapter;
  private tradeHistory: Trade[] = [];

  // Track last known profit for each position (for reconciliation)
  // This is updated from proposal_open_contract updates and used when trade closes externally
  private lastKnownProfit: Map<string, number> = new Map();

  // CRITICAL: Pending trade locks to prevent race conditions
  // When a trade is being executed, we lock the asset to prevent duplicate trades
  // This solves the issue where two signals arrive within milliseconds
  private pendingTradeLocks: Map<string, number> = new Map(); // asset -> timestamp

  // Sub-managers
  private smartExitManager: SmartExitManager;
  private trailingStopManager: TrailingStopManager;
  private riskManager: RiskManager;
  private positionMonitor: PositionMonitor;

  constructor(
    client: GatewayClient,
    adapter: UnifiedTradeAdapter,
    monitoredSymbols: string[],
    config?: TradeManagerConfig
  ) {
    super();
    this.client = client;
    this.adapter = adapter;

    // Initialize sub-managers
    this.smartExitManager = new SmartExitManager(config?.smartExit);
    this.trailingStopManager = new TrailingStopManager(config?.trailingStop);
    this.riskManager = new RiskManager(config?.risk);

    // Determine trade mode from adapter
    const tradeMode = adapter.getMode();

    this.positionMonitor = new PositionMonitor(
      client,
      monitoredSymbols,
      config?.pollingInterval ?? 30000,
      tradeMode  // Pass trade mode to PositionMonitor
    );
  }

  /**
   * Start trade management system
   */
  async start(): Promise<void> {
    // Recover existing positions
    await this.recoverPositions();

    // Start position monitoring
    this.positionMonitor.start(
      (positions) => {
        this.handlePositionUpdates(positions);
      },
      (closedPositions) => {
        this.handleClosedPositions(closedPositions);
      }
    );

    console.log('✅ Trade Manager started');
  }

  /**
   * Stop trade management system
   */
  stop(): void {
    this.positionMonitor.stop();
    console.log('🛑 Trade Manager stopped');
  }

  /**
   * Check if a new trade can be opened
   * Also checks pending trade locks to prevent race conditions
   *
   * @param asset - The asset symbol
   * @param skipLockCheck - Skip lock check (use when caller already holds the lock)
   */
  canOpenTrade(asset: string, skipLockCheck = false): { allowed: boolean; reason?: string } {
    // CRITICAL: Check pending trade lock first (prevents race conditions)
    // Skip if caller already holds the lock (e.g., TradeExecutionService called from runner)
    if (!skipLockCheck) {
      const lockTime = this.pendingTradeLocks.get(asset);
      if (lockTime) {
        const lockAge = Date.now() - lockTime;
        // Lock expires after 30 seconds (in case of failed trade that didn't release)
        if (lockAge < 30000) {
          console.log(`[TradeManager] ⏳ Trade pending for ${asset} (locked ${lockAge}ms ago)`);
          return {
            allowed: false,
            reason: `Trade already pending for ${asset} (locked ${lockAge}ms ago)`,
          };
        } else {
          // Stale lock, remove it
          console.log(`[TradeManager] 🔓 Removing stale lock for ${asset} (${lockAge}ms old)`);
          this.pendingTradeLocks.delete(asset);
        }
      }
    }

    return this.riskManager.canOpenTrade(asset, this.tradeHistory);
  }

  /**
   * Acquire a pending trade lock for an asset
   * Call this BEFORE starting trade execution to prevent race conditions
   * Returns true if lock acquired, false if already locked
   */
  acquireTradeLock(asset: string): boolean {
    const existingLock = this.pendingTradeLocks.get(asset);
    if (existingLock) {
      const lockAge = Date.now() - existingLock;
      if (lockAge < 30000) {
        console.log(`[TradeManager] ❌ Cannot acquire lock for ${asset} - already locked`);
        return false;
      }
    }

    this.pendingTradeLocks.set(asset, Date.now());
    console.log(`[TradeManager] 🔒 Lock acquired for ${asset}`);
    return true;
  }

  /**
   * Release a pending trade lock for an asset
   * Call this AFTER trade execution completes (success or failure)
   */
  releaseTradeLock(asset: string): void {
    if (this.pendingTradeLocks.has(asset)) {
      this.pendingTradeLocks.delete(asset);
      console.log(`[TradeManager] 🔓 Lock released for ${asset}`);
    }
  }

  /**
   * Calculate stake for a new trade
   */
  async calculateStake(
    mode: 'binary' | 'cfd',
    slPercentage?: number
  ): Promise<number> {
    // Get current balance from API with error handling
    let balance = 0;
    try {
      const balanceInfo = await this.client.getBalance();
      if (balanceInfo && typeof balanceInfo.amount === 'number') {
        balance = balanceInfo.amount;
      } else {
        console.warn('[TradeManager] ⚠️  Balance not available, using minimum stake');
        // Return minimum stake when balance unavailable
        return this.riskManager.getMinStake();
      }
    } catch (error: any) {
      console.warn(`[TradeManager] ⚠️  Error getting balance: ${error.message}, using minimum stake`);
      return this.riskManager.getMinStake();
    }

    return this.riskManager.calculateStake(mode, balance, slPercentage);
  }

  /**
   * Register a new trade
   */
  registerTrade(trade: Trade): void {
    this.tradeHistory.push(trade);

    // Add Contract ID to PositionMonitor (for CFD mode tracking)
    if (trade.mode === 'cfd') {
      this.positionMonitor.addContractId(trade.contractId);
    }

    // Initialize trailing stop if CFD
    if (trade.mode === 'cfd' && trade.metadata?.tpPct) {
      const tpPct = trade.metadata.tpPct;
      const takeProfit = trade.direction === 'CALL'
        ? trade.entryPrice * (1 + tpPct / 100)
        : trade.entryPrice * (1 - tpPct / 100);

      this.trailingStopManager.initializeTrailingStop(
        trade.contractId,
        trade.asset,
        trade.direction,
        trade.entryPrice,
        takeProfit
      );
    }

    this.emit('trade:registered', trade);
  }

  /**
   * Evaluate exit for a trade (called on tick or portfolio update)
   */
  async evaluateExit(
    contractId: string,
    currentPrice: number,
    rsiValue?: number
  ): Promise<void> {
    const trade = this.tradeHistory.find(t => t.contractId === contractId);
    if (!trade || trade.closed) return;

    // Check SMART Exit rules
    const exitSignal = this.smartExitManager.evaluateExit(
      trade,
      currentPrice,
      Date.now(),
      rsiValue
    );

    if (exitSignal.shouldExit) {
      await this.closeTrade(contractId, exitSignal.reason);
      return;
    }

    // Check Trailing Stop (only for CFD)
    if (trade.mode === 'cfd') {
      const tpPct = trade.metadata?.tpPct || 0.3;
      const trailingResult = this.trailingStopManager.updateTrailingStop(
        contractId,
        exitSignal.profitPct,
        tpPct
      );

      if (trailingResult.shouldExit && trailingResult.reason) {
        await this.closeTrade(contractId, trailingResult.reason);
        return;
      }

      if (trailingResult.updatedTP) {
        this.emit('trailing:update', {
          contractId,
          newTP: trailingResult.updatedTP,
        });
      }
    }
  }

  /**
   * Close a trade
   */
  private async closeTrade(contractId: string, reason: string): Promise<void> {
    const trade = this.tradeHistory.find(t => t.contractId === contractId);
    if (!trade) return;

    console.log(`\n🎯 CLOSING TRADE: ${contractId}`);
    console.log(`   Reason: ${reason}`);

    try {
      await this.adapter.closeTrade(contractId);
      trade.closed = true;

      // Clean up trailing stop
      this.trailingStopManager.removeTrailingStop(contractId);

      // Remove Contract ID from PositionMonitor (for CFD mode)
      if (trade.mode === 'cfd') {
        this.positionMonitor.removeContractId(contractId);
      }

      this.emit('trade:closed', { contractId, reason });
    } catch (error: any) {
      console.error(`   ❌ Failed to close: ${error.message}`);
      this.emit('trade:error', { contractId, error: error.message });
    }
  }

  /**
   * Handle position updates from monitor
   */
  private handlePositionUpdates(positions: PositionUpdate[]): void {
    console.log(`\n⏰ [Position Monitor] Checking ${positions.length} position(s)...`);

    // 1. Update existing trades with current price and check for exit
    // Also track last known profit for reconciliation
    for (const position of positions) {
      // Save last known profit for this contract
      this.lastKnownProfit.set(position.contractId, position.profit);

      this.evaluateExit(position.contractId, position.currentPrice);
    }

    // 2. Reconcile: Check for trades that are open in our history but missing from API positions
    // This handles external closures (Stop Loss, Take Profit, Manual Close on broker site)
    const activeContractIds = new Set(positions.map(p => p.contractId));
    const openTrades = this.getOpenTrades();

    for (const trade of openTrades) {
      // If trade is NOT in the active positions list from API, it has closed externally
      if (!activeContractIds.has(trade.contractId)) {
        // Skip if already processed
        if (trade.closed) {
          continue;
        }

        // Get last known profit BEFORE we delete it
        const lastProfit = this.lastKnownProfit.get(trade.contractId) ?? 0;

        console.log(`\n🔍 Reconciliation: Trade ${trade.contractId} (${trade.asset}) is missing from API positions.`);
        console.log(`   External closure detected (TP/SL/Manual).`);
        console.log(`   Using last known profit: $${lastProfit.toFixed(2)}`);

        // Mark as closed locally
        trade.closed = true;

        // Clean up trailing stop
        this.trailingStopManager.removeTrailingStop(trade.contractId);

        // Remove from PositionMonitor tracking (if it was there)
        if (trade.mode === 'cfd') {
          this.positionMonitor.removeContractId(trade.contractId);
        }

        // Clean up last known profit
        this.lastKnownProfit.delete(trade.contractId);

        // Emit trade:closed immediately with last known profit
        // NOTE: profit_table API doesn't work reliably for Multiplier contracts on demo accounts
        // So we use the last profit value we received from proposal_open_contract updates
        const closeReason = lastProfit >= 0 ? 'TP_HIT' : 'SL_HIT';

        console.log(`   📤 Emitting trade:closed event (reason: ${closeReason})`);

        this.emit('trade:closed', {
          contractId: trade.contractId,
          reason: closeReason,
          profit: lastProfit,
        });
      }
    }
  }

  /**
   * Handle closed positions from profit_table API
   *
   * Updates trade history with complete details of closed positions
   * This is a backup mechanism - primary closure detection is in handlePositionUpdates
   *
   * NOTE: profit_table API doesn't work reliably for Multiplier contracts on demo accounts,
   * so this method may not receive data. The reconciliation in handlePositionUpdates
   * handles closures using lastKnownProfit instead.
   */
  private handleClosedPositions(closedPositions: ClosedPositionDetails[]): void {
    if (closedPositions.length === 0) {
      return;
    }

    console.log(`\n💰 [Trade Manager] Processing ${closedPositions.length} closed position(s) from profit_table...`);

    for (const closedPosition of closedPositions) {
      // Find the trade in our history
      const trade = this.tradeHistory.find(t => t.contractId === closedPosition.contractId);

      // Skip if trade is already closed (already handled by reconciliation)
      if (trade && trade.closed) {
        console.log(`   ⏭️  Trade ${closedPosition.contractId} already closed - skipping duplicate`);
        continue;
      }

      if (trade) {
        // Update trade with complete details
        trade.closed = true;

        // Add closure details to metadata
        if (!trade.metadata) {
          trade.metadata = {};
        }

        trade.metadata.sellPrice = closedPosition.sellPrice;
        // Handle sellTime safely - it could be a Date object or Unix timestamp
        trade.metadata.sellTime = closedPosition.sellTime instanceof Date
          ? closedPosition.sellTime.getTime()
          : (typeof closedPosition.sellTime === 'number' ? closedPosition.sellTime : Date.now());
        trade.metadata.profit = closedPosition.profit;
        trade.metadata.profitPercentage = closedPosition.profitPercentage;
        trade.metadata.duration = closedPosition.duration;
        trade.metadata.durationUnit = closedPosition.durationUnit;
        trade.metadata.transactionId = closedPosition.transactionId;

        const profitSign = closedPosition.profit >= 0 ? '+' : '';
        const outcome = closedPosition.profit >= 0 ? '✅ WIN' : '❌ LOSS';

        console.log(`\n${outcome} Trade ${trade.contractId} (${trade.asset}) closed (via profit_table):`);
        console.log(`   Entry: $${trade.entryPrice.toFixed(2)} → Exit: $${closedPosition.sellPrice.toFixed(2)}`);
        console.log(`   Profit: ${profitSign}$${closedPosition.profit.toFixed(2)} (${profitSign}${closedPosition.profitPercentage.toFixed(2)}%)`);
        console.log(`   Duration: ${closedPosition.duration}${closedPosition.durationUnit}`);
        console.log(`   Closed at: ${closedPosition.sellTime.toISOString()}`);

        // Clean up trailing stop if exists
        this.trailingStopManager.removeTrailingStop(trade.contractId);

        // Remove from PositionMonitor tracking
        if (trade.mode === 'cfd') {
          this.positionMonitor.removeContractId(trade.contractId);
        }

        // Emit event with full details
        this.emit('trade:closed', {
          contractId: trade.contractId,
          reason: 'Detected via profit_table API',
          profit: closedPosition.profit,
          profitPercentage: closedPosition.profitPercentage,
          sellPrice: closedPosition.sellPrice,
          sellTime: closedPosition.sellTime,
        });
      } else {
        // Trade not in our history - might be from another session or strategy
        console.log(`   ⚠️  Closed position ${closedPosition.contractId} (${closedPosition.symbol}) not found in trade history`);
        console.log(`       This might be from another session or external trade`);
      }
    }

    console.log(`\n✅ Finished processing closed positions\n`);
  }

  /**
   * Recover existing positions on startup
   */
  private async recoverPositions(): Promise<void> {
    console.log('\n🔄 Recovering existing positions...');

    const positions = await this.positionMonitor.recoverPositions();

    if (positions.length === 0) {
      console.log('   No existing positions found.\n');
      return;
    }

    console.log(`📊 Found ${positions.length} open position(s):`);

    for (const position of positions) {
      // Infer direction from contract type
      let direction: 'CALL' | 'PUT' = 'CALL';
      if (position.contractType) {
        const contractType = position.contractType.toUpperCase();
        if (contractType.includes('DOWN') || contractType.includes('PUT') || contractType.includes('FALL')) {
          direction = 'PUT';
        }
      }

      const trade: Trade = {
        contractId: position.contractId,
        asset: position.symbol,
        direction,
        entryPrice: position.buyPrice,
        timestamp: (() => {
          if (typeof position.purchaseTime === 'number' && position.purchaseTime > 0) {
            return position.purchaseTime;
          }
          if (position.purchaseTime instanceof Date) {
            const time = position.purchaseTime.getTime();
            // Check if the Date is valid (not NaN)
            if (!isNaN(time) && time > 0) {
              return time;
            }
          }
          // Fallback: use current time (warning removed - DerivClient handles this now)
          return Date.now();
        })(),
        closed: false,
        mode: 'cfd', // Assume CFD for recovered positions
        metadata: {
          tpPct: 0.3,
          slPct: 0.3,
          recovered: true,
        },
      };

      this.tradeHistory.push(trade);

      const timeOpen = Date.now() - trade.timestamp;
      const profitStatus = position.profit > 0 ? '🟢' : position.profit < 0 ? '🔴' : '⚪';

      console.log(`   ${profitStatus} ${trade.contractId} (${trade.asset})`);
      console.log(`      P&L: $${position.profit.toFixed(2)} (${position.profitPercentage.toFixed(2)}%)`);
      console.log(`      Time open: ${(timeOpen / 60000).toFixed(1)}min`);
    }

    console.log(`\n✅ Recovered ${positions.length} position(s)\n`);
  }

  /**
   * Get trade history
   */
  getTradeHistory(): Trade[] {
    return [...this.tradeHistory];
  }

  /**
   * Get open trades
   */
  getOpenTrades(): Trade[] {
    return this.tradeHistory.filter(t => !t.closed && t.contractId);
  }

  /**
   * Get risk statistics
   */
  getRiskStats() {
    return this.riskManager.getRiskStats(this.tradeHistory);
  }

  /**
   * Get managers (for advanced use)
   */
  getManagers() {
    return {
      smartExit: this.smartExitManager,
      trailingStop: this.trailingStopManager,
      risk: this.riskManager,
      positionMonitor: this.positionMonitor,
    };
  }
}
