/**
 * Trade Execution Service
 *
 * Centralized service for executing trades across all strategies.
 * Eliminates code duplication from demo scripts.
 *
 * Features:
 * - Automatic stake calculation via TradeManager
 * - Support for both Binary Options and CFDs
 * - TP/SL calculation for CFDs
 * - Balance management
 * - Trade registration with TradeManager
 * - Comprehensive logging
 */

import type { GatewayClient } from '@deriv-bot/shared';
import type { UnifiedTradeAdapter, TradeMode } from '../adapters/trade-adapter.js';
import type { TradeManager } from '../trade-management/index.js';
import type { Signal } from '@deriv-bot/shared';

/**
 * Trade Execution Configuration
 */
export interface TradeExecutionConfig {
  /** Trade mode (binary or cfd) */
  mode: TradeMode;

  /** Strategy name for logging */
  strategyName: string;

  /** Binary options duration (in minutes) */
  binaryDuration?: number;

  /** CFD take profit percentage (default: 0.005 = 0.5%) */
  cfdTakeProfitPct?: number;

  /** CFD stop loss percentage (default: 0.0025 = 0.25%) */
  cfdStopLossPct?: number;

  /** Optional account loginid for CFD trades */
  accountLoginid?: string;

  /** Asset-specific multipliers for CFDs */
  multiplierMap?: Record<string, number>;
}

/**
 * Default configuration values (Backtest-Optimized)
 *
 * Multiplier Analysis (180 days, R_100, 2% stake):
 * - x100: +150% ROI, 25% drawdown (conservative)
 * - x200: +229% ROI, 53% drawdown (optimal balance)
 * - x300: +128% ROI, 57% drawdown (diminishing returns)
 * - x500: +204% ROI, 59% drawdown (high risk)
 *
 * Recommended: x200 for best risk-adjusted returns
 */
const DEFAULT_CONFIG: Partial<TradeExecutionConfig> = {
  binaryDuration: 1, // 1 minute
  cfdTakeProfitPct: 0.004, // 0.4% (optimized from 0.5%)
  cfdStopLossPct: 0.002,   // 0.2% (optimized from 0.25%, maintains 2:1 ratio)
  multiplierMap: {
    'R_10': 400,
    'R_25': 160,
    'R_50': 160,            // Increased for better returns
    'R_75': 100,            // Increased from 50 (backtest-optimized)
    'R_100': 200,           // Increased from 100 to 200 (backtest-optimized)
  },
};

/**
 * Trade execution result
 */
export interface TradeExecutionResult {
  success: boolean;
  contractId?: string;
  entryPrice?: number;
  stake?: number;
  error?: string;
}

/**
 * Trade Execution Service
 *
 * Handles all trade execution logic for strategies
 */
export class TradeExecutionService {
  private config: TradeExecutionConfig;
  private tradeCount = 0;

  constructor(
    private gatewayClient: GatewayClient,
    private tradeAdapter: UnifiedTradeAdapter,
    private tradeManager: TradeManager,
    config: TradeExecutionConfig
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Execute a trade from a signal
   */
  async executeTrade(signal: Signal, defaultAsset?: string): Promise<TradeExecutionResult> {
    const asset = (signal as any).asset || signal.symbol || defaultAsset || 'R_75';

    // Check if we can open a new trade (risk management)
    const canOpen = this.tradeManager.canOpenTrade(asset);
    if (!canOpen.allowed) {
      console.log(`\n❌ Trade rejected: ${canOpen.reason}`);
      return {
        success: false,
        error: canOpen.reason || 'Trade not allowed by risk manager',
      };
    }

    this.tradeCount++;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 EJECUTANDO TRADE #${this.tradeCount}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   Strategy: ${this.config.strategyName}`);
    console.log(`   Mode: ${this.config.mode.toUpperCase()}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Asset: ${asset}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);

    try {
      // Get entry price from signal - check multiple locations for compatibility
      // Priority: signal.price > signal.metadata.price > signal.metadata.entryPrice
      let entryPrice = 0;
      if (typeof (signal as any).price === 'number' && (signal as any).price > 0) {
        entryPrice = (signal as any).price;
      } else if (typeof signal.metadata?.price === 'number' && signal.metadata.price > 0) {
        entryPrice = signal.metadata.price;
      } else if (typeof signal.metadata?.entryPrice === 'number' && signal.metadata.entryPrice > 0) {
        entryPrice = signal.metadata.entryPrice;
      }
      if (entryPrice === 0 && this.config.mode === 'cfd') {
        throw new Error('Entry price not available in signal for CFD trade');
      }

      // Calculate dynamic stake using TradeManager
      const slPercentage = this.config.mode === 'cfd' ? this.config.cfdStopLossPct : undefined;
      let stake = await this.tradeManager.calculateStake(this.config.mode, slPercentage);

      console.log(`   💡 Stake calculado: $${stake.toFixed(2)}`);

      // Get current balance
      let currentBalance = 0;
      try {
        const balanceInfo = await this.gatewayClient.getBalance();
        if (balanceInfo && balanceInfo.amount) {
          currentBalance = balanceInfo.amount;
          console.log(`   💰 Balance actual: $${currentBalance.toFixed(2)}`);
        }
      } catch (error) {
        console.warn(`   ⚠️  No se pudo obtener balance`);
      }

      // Validate minimum stake for CFD trades
      // Deriv API requires minimum stake based on symbol and multiplier
      // Based on errors seen: minimum is typically $3-5, using $5 as safe minimum
      if (this.config.mode === 'cfd') {
        const MIN_STAKE_CFD = 5.0; // Safe minimum for CFD trades
        if (stake < MIN_STAKE_CFD) {
          if (currentBalance < MIN_STAKE_CFD) {
            throw new Error(`Insufficient balance for CFD trade. Required: $${MIN_STAKE_CFD.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`);
          }
          console.log(`   ⚠️  Stake ${stake.toFixed(2)} below minimum ${MIN_STAKE_CFD.toFixed(2)}, adjusting to minimum`);
          stake = MIN_STAKE_CFD;
        }
      }

      // Execute trade based on mode
      let result;

      if (this.config.mode === 'binary') {
        result = await this.executeBinaryTrade(signal, asset, stake);
      } else {
        result = await this.executeCFDTrade(signal, asset, stake, entryPrice);
      }

      // Log success
      console.log(`\n✅✅✅ TRADE EJECUTADO EXITOSAMENTE ✅✅✅`);
      console.log(`   Contract ID: ${result.contractId}`);
      console.log(`   Entry Price: ${result.entryPrice.toFixed(2)}`);
      console.log(`   Stake: $${stake.toFixed(2)}`);

      if (this.config.mode === 'cfd') {
        const multiplier = this.getMultiplierForAsset(asset);
        console.log(`   Multiplier: ${multiplier}`);
        if (result.takeProfit) {
          console.log(`   Take Profit: ${result.takeProfit.toFixed(2)}`);
          console.log(`   Stop Loss: ${result.stopLoss?.toFixed(2)}`);
        }
      }

      if (currentBalance > 0) {
        const newBalance = currentBalance - stake;
        console.log(`   Balance después: $${newBalance.toFixed(2)}`);
      }
      console.log(`${'='.repeat(80)}\n`);

      // Register trade with TradeManager
      this.registerTrade(result, signal, asset, stake);

      return {
        success: true,
        contractId: result.contractId,
        entryPrice: result.entryPrice,
        stake,
      };

    } catch (error: any) {
      console.error(`   ❌ Error executing trade: ${error.message}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute a binary options trade
   */
  private async executeBinaryTrade(signal: Signal, asset: string, stake: number) {
    const direction = signal.direction === 'CALL' ? 'CALL' : 'PUT';

    return await this.tradeAdapter.executeTrade({
      asset,
      direction,
      amount: stake,
      duration: this.config.binaryDuration || 1,
      durationUnit: 'm',
      strategyName: this.config.strategyName,
    });
  }

  /**
   * Execute a CFD trade with TP/SL
   */
  private async executeCFDTrade(signal: Signal, asset: string, stake: number, entryPrice: number) {
    const direction = signal.direction === 'CALL' ? 'BUY' : 'SELL';

    // Calculate TP/SL prices
    // PRIORITY: Use strategy-specific TP/SL from signal metadata (asset-optimized)
    // FALLBACK: Use global config values if not present in signal
    const tpPercentage = typeof signal.metadata?.tpPct === 'number'
      ? signal.metadata.tpPct
      : (this.config.cfdTakeProfitPct || 0.005);

    const slPercentage = typeof signal.metadata?.slPct === 'number'
      ? signal.metadata.slPct
      : (this.config.cfdStopLossPct || 0.0025);

    console.log(`   🎯 [Execution] Using Strategy TP: ${(tpPercentage * 100).toFixed(2)}% | SL: ${(slPercentage * 100).toFixed(2)}%`);

    const takeProfit = direction === 'BUY'
      ? Math.round((entryPrice * (1 + tpPercentage)) * 100) / 100
      : Math.round((entryPrice * (1 - tpPercentage)) * 100) / 100;

    const stopLoss = direction === 'BUY'
      ? Math.round((entryPrice * (1 - slPercentage)) * 100) / 100
      : Math.round((entryPrice * (1 + slPercentage)) * 100) / 100;

    const multiplier = this.getMultiplierForAsset(asset);

    console.log(`   Asset: ${asset}`);
    console.log(`   Direction: ${direction}`);
    console.log(`   Entry Price: ${entryPrice}`);
    console.log(`   Multiplier: ${multiplier}x`);
    console.log(`   Stake: $${stake}`);
    console.log(`   Take Profit: ${takeProfit}`);
    console.log(`   Stop Loss: ${stopLoss}`);

    return await this.tradeAdapter.executeTrade({
      asset,
      direction,
      amount: stake,
      multiplier,
      takeProfit,
      stopLoss,
      strategyName: this.config.strategyName,
      account: this.config.accountLoginid,
    });
  }

  /**
   * Register trade with TradeManager
   */
  private registerTrade(result: any, signal: Signal, asset: string, stake: number): void {
    const tpPct = this.config.mode === 'cfd' ? this.config.cfdTakeProfitPct || 0.005 : 0.005;
    const slPct = this.config.mode === 'cfd' ? this.config.cfdStopLossPct || 0.0025 : 0.005;

    this.tradeManager.registerTrade({
      contractId: result.contractId,
      asset,
      direction: signal.direction,
      entryPrice: result.entryPrice,
      timestamp: Date.now(),
      closed: false,
      stake,
      mode: this.config.mode,
      metadata: {
        tpPct,
        slPct,
        ...signal.metadata,
      },
    });

    console.log(`   ✅ Trade registrado en TradeManager`);
  }

  /**
   * Get multiplier for a given asset
   */
  private getMultiplierForAsset(asset: string): number {
    const map = this.config.multiplierMap || DEFAULT_CONFIG.multiplierMap!;
    return map[asset] || 100;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TradeExecutionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current trade count
   */
  getTradeCount(): number {
    return this.tradeCount;
  }

  /**
   * Reset trade count
   */
  resetTradeCount(): void {
    this.tradeCount = 0;
  }
}
