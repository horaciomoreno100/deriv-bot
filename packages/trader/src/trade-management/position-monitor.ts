/**
 * Position Monitor
 *
 * Monitors open positions via periodic polling:
 * - Polls portfolio every 30 seconds
 * - Independent of tick stream
 * - Recovers positions after restart
 * - Provides position updates to trade manager
 * - Detects closed positions using profit_table API
 */

import type { PositionUpdate, ClosedPositionDetails } from './types.js';
import type { GatewayClient } from '@deriv-bot/shared';

export class PositionMonitor {
  private client: GatewayClient;
  private monitoredSymbols: string[];
  private pollingInterval: number;
  private timerId: NodeJS.Timeout | null = null;
  private onPositionUpdate?: (positions: PositionUpdate[]) => void;
  private onPositionClosed?: (closedPositions: ClosedPositionDetails[]) => void;
  private tradeMode: 'binary' | 'cfd';
  private contractIds: Set<string> = new Set();

  constructor(
    client: GatewayClient,
    monitoredSymbols: string[],
    pollingInterval: number = 30000, // 30 seconds
    tradeMode: 'binary' | 'cfd' = 'binary'
  ) {
    this.client = client;
    this.monitoredSymbols = monitoredSymbols;
    this.pollingInterval = pollingInterval;
    this.tradeMode = tradeMode;
  }

  /**
   * Start periodic monitoring
   */
  start(
    onUpdate: (positions: PositionUpdate[]) => void,
    onClosed?: (closedPositions: ClosedPositionDetails[]) => void
  ): void {
    this.onPositionUpdate = onUpdate;
    this.onPositionClosed = onClosed;

    // Initial check
    this.checkPositions();

    // Start periodic polling
    this.timerId = setInterval(() => {
      this.checkPositions();
    }, this.pollingInterval);

    console.log(`⏰ Position Monitor started (polling every ${this.pollingInterval / 1000}s)`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      console.log('🛑 Position Monitor stopped');
    }
  }

  /**
   * Add Contract ID to track (for CFD mode)
   */
  addContractId(contractId: string): void {
    this.contractIds.add(contractId);
    console.log(`[PositionMonitor] Tracking Contract ID: ${contractId} (total: ${this.contractIds.size})`);
  }

  /**
   * Remove Contract ID (when position closes)
   */
  removeContractId(contractId: string): void {
    this.contractIds.delete(contractId);
    console.log(`[PositionMonitor] Stopped tracking Contract ID: ${contractId} (remaining: ${this.contractIds.size})`);
  }

  /**
   * Check current positions from API
   *
   * GUARDIAN MODE: Monitors ALL open positions, not just configured symbols.
   * This prevents "orphaned trades" when symbols are changed or trades from other strategies exist.
   *
   * NOTE: Portfolio API DOES support Multiplier contracts (MULTUP/MULTDOWN).
   * The earlier assumption that it didn't was incorrect. We use Portfolio API for both modes.
   */
  private async checkPositions(): Promise<void> {
    try {
      console.log(`\n🔍 [PositionMonitor] Portfolio check starting (GUARDIAN MODE, ${this.tradeMode.toUpperCase()} mode)...`);
      console.log(`   Preferred symbols: [${this.monitoredSymbols.join(', ')}]`);

      // Use portfolio API for both Binary Options and CFD modes
      // Testing confirmed that Portfolio API DOES return Multiplier contracts
      console.log(`   Using portfolio API...`);
      const openPositions = await this.client.getPortfolio();

      console.log(`   Raw API response - positions count: ${openPositions?.length || 0}`);

      if (!openPositions || openPositions.length === 0) {
        console.log(`   ✅ No positions found - sending empty update\n`);
        if (this.onPositionUpdate) {
          this.onPositionUpdate([]);
        }
        // DON'T return here - we still need to check for recently closed positions
        // via profit_table API to get accurate profit data
        await this.checkClosedPositions();
        return;
      }

      // GUARDIAN MODE: Monitor ALL positions, warn about unexpected ones
      console.log(`   📋 All positions from API:`);
      const preferredPositions: typeof openPositions = [];
      const orphanedPositions: typeof openPositions = [];

      openPositions.forEach((pos: PositionUpdate, index: number) => {
        const isPreferred = this.monitoredSymbols.includes(pos.symbol);
        console.log(`   ${index + 1}. Symbol: "${pos.symbol}" | Contract: ${pos.contractId} | Type: ${pos.contractType}`);
        console.log(`      Status: ${isPreferred ? '✅ PREFERRED' : '⚠️  ORPHANED (not in config)'}`);

        if (isPreferred) {
          preferredPositions.push(pos);
        } else {
          orphanedPositions.push(pos);
        }
      });

      // Warn about orphaned positions but still monitor them
      if (orphanedPositions.length > 0) {
        console.log(`\n   ⚠️  WARNING: Found ${orphanedPositions.length} ORPHANED position(s) not in configured symbols:`);
        orphanedPositions.forEach((pos: PositionUpdate) => {
          console.log(`      - ${pos.symbol} (${pos.contractId}) | Profit: $${pos.profit.toFixed(2)}`);
        });
        console.log(`   🛡️  GUARDIAN MODE: Will monitor ALL positions to prevent losses\n`);
      }

      // Monitor ALL positions (preferred + orphaned)
      const allPositions = [...preferredPositions, ...orphanedPositions];
      console.log(`   ✅ Total positions to monitor: ${allPositions.length} (${preferredPositions.length} preferred + ${orphanedPositions.length} orphaned)`);

      if (allPositions.length > 0 && this.onPositionUpdate) {
        console.log(`   📤 Calling onPositionUpdate with ${allPositions.length} position(s)\n`);
        this.onPositionUpdate(allPositions);
      } else {
        console.log(`   ⏭️  No positions or no callback - skipping update\n`);
      }

      // Check for recently closed positions using profit_table API
      await this.checkClosedPositions();

    } catch (error: any) {
      console.error(`⚠️  Position Monitor error: ${error.message}`);
    }
  }

  /**
   * Check for recently closed positions using profit_table API
   *
   * NOTE: Uses a 1-hour lookback window to ensure we catch all recent closes.
   * Tracks seen contract IDs to prevent duplicate notifications.
   */
  private seenClosedContractIds: Set<string> = new Set();

  private async checkClosedPositions(): Promise<void> {
    // Skip if no callback registered
    if (!this.onPositionClosed) {
      return;
    }

    try {
      // Query profit_table for recent closed contracts (last hour)
      const now = Date.now();
      const lookbackWindow = 3600000; // 1 hour lookback to ensure we catch closes
      const dateFrom = Math.floor((now - lookbackWindow) / 1000); // Convert to epoch seconds

      console.log(`\n📊 [PositionMonitor] Checking profit_table (since ${new Date(dateFrom * 1000).toISOString()})...`);
      console.log(`   Looking for symbols: [${this.monitoredSymbols.join(', ')}]`);

      const closedContracts = await this.client.getProfitTable({
        dateFrom,
        limit: 50,
        sort: 'DESC', // Newest first
      });

      console.log(`   📥 profit_table returned ${closedContracts.length} contracts`);

      if (closedContracts.length === 0) {
        console.log(`   ✅ No closed contracts in profit_table\n`);
        return;
      }

      // Log all returned contracts for debugging
      console.log(`   📋 All contracts from profit_table:`);
      closedContracts.forEach((contract, index) => {
        const profitSign = contract.profit >= 0 ? '+' : '';
        console.log(`   ${index + 1}. ${contract.symbol} | ID: ${contract.contractId} | Type: ${contract.contractType}`);
        console.log(`      Profit: ${profitSign}$${contract.profit.toFixed(2)} | Sell: ${contract.sellTime?.toISOString?.() || 'N/A'}`);
      });

      // Filter for monitored symbols and contracts we haven't seen yet
      const relevantClosed = closedContracts.filter(contract => {
        const isMonitoredSymbol = this.monitoredSymbols.includes(contract.symbol);
        const isNewContract = !this.seenClosedContractIds.has(contract.contractId);

        if (isMonitoredSymbol && !isNewContract) {
          console.log(`   ⏭️  Skipping already-seen contract: ${contract.contractId}`);
        }

        return isMonitoredSymbol && isNewContract;
      });

      if (relevantClosed.length > 0) {
        console.log(`\n   🎯 Found ${relevantClosed.length} NEW closed position(s) for monitored symbols:`);
        relevantClosed.forEach((contract, index) => {
          const profitSign = contract.profit >= 0 ? '+' : '';
          console.log(`   ${index + 1}. ${contract.symbol} | Contract: ${contract.contractId}`);
          console.log(`      Type: ${contract.contractType} | Profit: ${profitSign}$${contract.profit.toFixed(2)} (${profitSign}${contract.profitPercentage.toFixed(2)}%)`);
          console.log(`      Closed at: ${contract.sellTime?.toISOString?.() || 'N/A'}`);

          // Mark as seen to prevent duplicates
          this.seenClosedContractIds.add(contract.contractId);
        });

        // Notify callback
        console.log(`   📤 Calling onPositionClosed with ${relevantClosed.length} closed position(s)\n`);
        this.onPositionClosed(relevantClosed);
      } else {
        console.log(`   ✅ No new closed positions for monitored symbols\n`);
      }

    } catch (error: any) {
      console.error(`⚠️  Error checking closed positions: ${error.message}`);
    }
  }

  /**
   * Recover existing positions (on startup)
   */
  async recoverPositions(): Promise<PositionUpdate[]> {
    try {
      const openPositions = await this.client.getPortfolio();

      if (!openPositions || openPositions.length === 0) {
        return [];
      }

      // Filter monitored symbols (GUARDIAN MODE also applies here for recovery)
      const relevantPositions = openPositions.filter((pos: PositionUpdate) =>
        this.monitoredSymbols.includes(pos.symbol)
      );

      return relevantPositions;
    } catch (error: any) {
      console.error(`⚠️  Could not recover positions: ${error.message}`);
      return [];
    }
  }

  /**
   * Update monitored symbols
   */
  updateMonitoredSymbols(symbols: string[]): void {
    this.monitoredSymbols = symbols;
  }

  /**
   * Get current configuration
   */
  getConfig(): { symbols: string[]; pollingInterval: number } {
    return {
      symbols: [...this.monitoredSymbols],
      pollingInterval: this.pollingInterval,
    };
  }
}
