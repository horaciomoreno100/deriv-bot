/**
 * Risk Manager
 *
 * Manages trading risk and position limits:
 * - Global trade limit (max 3 concurrent trades)
 * - Per-symbol limit (max 1 trade per asset)
 * - Dynamic stake calculation based on balance and risk % (compound interest)
 * - Safety limits (min $5, max $500)
 * - Daily loss limit (5% of balance) to protect capital
 *
 * Backtest-Optimized Configuration (180 days, R_100):
 * - With daily loss limit: +150% ROI, 25% max drawdown
 * - Without: +88% ROI, 48% max drawdown
 */

import type { Trade, RiskConfig, DailyTradingStats } from './types.js';

export class RiskManager {
  private config: RiskConfig;
  private dailyStats: DailyTradingStats;

  constructor(config?: Partial<RiskConfig>) {
    this.config = {
      maxOpenTrades: config?.maxOpenTrades ?? 3,
      maxTradesPerSymbol: config?.maxTradesPerSymbol ?? 1,
      riskPercentageCFD: config?.riskPercentageCFD ?? 0.02,       // 2% (backtest-optimized)
      riskPercentageBinary: config?.riskPercentageBinary ?? 0.02, // 2%
      minStake: config?.minStake ?? 5.0,                          // $5 minimum
      maxStake: config?.maxStake ?? 500.0,                        // $500 maximum
      maxStakePercentage: config?.maxStakePercentage ?? 0.02,     // 2% max per trade
      // Daily loss limit (backtest-optimized: reduces drawdown by 50%)
      dailyLossLimitPct: config?.dailyLossLimitPct ?? 5,          // 5% daily loss limit
      dailyLossLimitEnabled: config?.dailyLossLimitEnabled ?? true,
    };

    // Initialize daily stats
    this.dailyStats = this.createNewDayStats(0);
  }

  /**
   * Create new daily stats object
   */
  private createNewDayStats(startBalance: number): DailyTradingStats {
    return {
      date: new Date().toISOString().slice(0, 10),
      startBalance,
      currentLoss: 0,
      tradesExecuted: 0,
      tradesPaused: 0,
      limitReached: false,
    };
  }

  /**
   * Update daily stats at start of new day or when balance changes
   */
  updateDailyStats(currentBalance: number): void {
    const today = new Date().toISOString().slice(0, 10);

    if (this.dailyStats.date !== today) {
      // New day - reset stats
      console.log(`[RiskManager] 📅 New trading day: ${today}`);
      console.log(`   Previous day stats: ${this.dailyStats.tradesExecuted} trades, $${this.dailyStats.currentLoss.toFixed(2)} losses`);
      this.dailyStats = this.createNewDayStats(currentBalance);
    } else if (this.dailyStats.startBalance === 0) {
      // First update of the day
      this.dailyStats.startBalance = currentBalance;
    }
  }

  /**
   * Record a trade loss for daily tracking
   */
  recordTradeLoss(lossAmount: number): void {
    this.dailyStats.currentLoss += Math.abs(lossAmount);
    this.dailyStats.tradesExecuted++;

    const lossPct = (this.dailyStats.currentLoss / this.dailyStats.startBalance) * 100;

    console.log(`[RiskManager] 📉 Loss recorded: $${Math.abs(lossAmount).toFixed(2)}`);
    console.log(`   Daily loss so far: $${this.dailyStats.currentLoss.toFixed(2)} (${lossPct.toFixed(1)}%)`);

    if (this.config.dailyLossLimitEnabled && lossPct >= this.config.dailyLossLimitPct) {
      this.dailyStats.limitReached = true;
      console.log(`   ⚠️  DAILY LOSS LIMIT REACHED (${this.config.dailyLossLimitPct}%) - Trading paused for today`);
    }
  }

  /**
   * Record a successful trade (for statistics)
   */
  recordTradeWin(): void {
    this.dailyStats.tradesExecuted++;
  }

  /**
   * Check if daily loss limit allows trading
   */
  canTradeToday(): { allowed: boolean; reason?: string } {
    if (!this.config.dailyLossLimitEnabled) {
      return { allowed: true };
    }

    if (this.dailyStats.limitReached) {
      this.dailyStats.tradesPaused++;
      return {
        allowed: false,
        reason: `Daily loss limit reached (${this.config.dailyLossLimitPct}%). Trading paused until tomorrow.`,
      };
    }

    const lossPct = this.dailyStats.startBalance > 0
      ? (this.dailyStats.currentLoss / this.dailyStats.startBalance) * 100
      : 0;

    if (lossPct >= this.config.dailyLossLimitPct) {
      this.dailyStats.limitReached = true;
      this.dailyStats.tradesPaused++;
      return {
        allowed: false,
        reason: `Daily loss limit reached (${lossPct.toFixed(1)}% >= ${this.config.dailyLossLimitPct}%). Trading paused until tomorrow.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a new trade can be opened (respects all limits including daily loss)
   */
  canOpenTrade(
    asset: string,
    tradeHistory: Trade[]
  ): { allowed: boolean; reason?: string } {
    // First check daily loss limit
    const dailyCheck = this.canTradeToday();
    if (!dailyCheck.allowed) {
      console.log(`[RiskManager] ⛔ ${dailyCheck.reason}`);
      return dailyCheck;
    }

    // Check global limit
    const openTrades = tradeHistory.filter(t => !t.closed && t.contractId);
    const openTradesCount = openTrades.length;

    console.log(`[RiskManager] Checking if can open trade for ${asset}:`);
    console.log(`   Total open trades: ${openTradesCount}/${this.config.maxOpenTrades}`);
    console.log(`   Open trades by symbol:`, openTrades.map(t => `${t.asset} (${t.contractId})`));

    if (openTradesCount >= this.config.maxOpenTrades) {
      return {
        allowed: false,
        reason: `Global limit reached (${openTradesCount}/${this.config.maxOpenTrades})`,
      };
    }

    // Check per-symbol limit
    const openTradesForAsset = tradeHistory.filter(
      t => !t.closed && t.contractId && t.asset === asset
    );
    const openTradesForAssetCount = openTradesForAsset.length;

    console.log(`   Open trades for ${asset}: ${openTradesForAssetCount}/${this.config.maxTradesPerSymbol}`);
    if (openTradesForAssetCount > 0) {
      console.log(`   Existing contracts: `, openTradesForAsset.map(t => t.contractId));
    }

    if (openTradesForAssetCount >= this.config.maxTradesPerSymbol) {
      return {
        allowed: false,
        reason: `Symbol limit reached for ${asset} (${openTradesForAssetCount}/${this.config.maxTradesPerSymbol})`,
      };
    }

    console.log(`   ✅ Trade allowed for ${asset}`);
    return { allowed: true };
  }

  /**
   * Calculate stake for a trade based on mode and balance (compound interest)
   *
   * Uses percentage of current balance for compound growth.
   * Backtest results show 2% stake with $500 cap produces optimal risk/reward.
   */
  calculateStake(
    mode: 'binary' | 'cfd',
    balance: number,
    _slPercentage?: number  // Unused, kept for backwards compatibility
  ): number {
    let stake: number;

    if (mode === 'cfd') {
      // CFD: Direct percentage of balance (compound interest)
      // With multipliers and TP/SL, we risk riskPercentageCFD of the balance per trade
      // Example: Balance $1000, risk 2% = stake $20
      const stakeRaw = balance * this.config.riskPercentageCFD;
      stake = Math.floor(stakeRaw * 100) / 100;

      console.log(`[RiskManager] CFD Stake calculation (compound):`);
      console.log(`   Balance: $${balance.toFixed(2)}`);
      console.log(`   Risk percentage: ${(this.config.riskPercentageCFD * 100).toFixed(2)}%`);
      console.log(`   Calculated stake: $${stake.toFixed(2)}`);
    } else {
      // Binary: Fixed percentage (compound interest)
      const stakeRaw = balance * this.config.riskPercentageBinary * 0.99; // Safety margin
      stake = Math.floor(stakeRaw * 100) / 100;
    }

    // Apply safety limits (min $5, max $500 or maxStakePercentage)
    const maxStakePct = balance * this.config.maxStakePercentage;
    const maxStakeAbsolute = this.config.maxStake;
    const effectiveMax = Math.min(maxStakePct, maxStakeAbsolute);

    stake = Math.max(this.config.minStake, Math.min(stake, effectiveMax));

    console.log(`   Limits: min=$${this.config.minStake}, max=$${effectiveMax.toFixed(2)} (pct: $${maxStakePct.toFixed(2)}, abs: $${maxStakeAbsolute})`);
    console.log(`   Final stake: $${stake.toFixed(2)}`);

    return stake;
  }

  /**
   * Get current risk statistics
   */
  getRiskStats(tradeHistory: Trade[]): {
    openTrades: number;
    maxOpenTrades: number;
    tradesBySymbol: Map<string, number>;
    utilizationPct: number;
    dailyStats: DailyTradingStats;
  } {
    const openTrades = tradeHistory.filter(t => !t.closed && t.contractId);
    const tradesBySymbol = new Map<string, number>();

    openTrades.forEach(trade => {
      const count = tradesBySymbol.get(trade.asset) || 0;
      tradesBySymbol.set(trade.asset, count + 1);
    });

    return {
      openTrades: openTrades.length,
      maxOpenTrades: this.config.maxOpenTrades,
      tradesBySymbol,
      utilizationPct: (openTrades.length / this.config.maxOpenTrades) * 100,
      dailyStats: { ...this.dailyStats },
    };
  }

  /**
   * Get daily trading statistics
   */
  getDailyStats(): DailyTradingStats {
    return { ...this.dailyStats };
  }

  /**
   * Get minimum stake amount (for fallback when balance unavailable)
   */
  getMinStake(): number {
    return this.config.minStake;
  }

  /**
   * Get configuration
   */
  getConfig(): RiskConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
