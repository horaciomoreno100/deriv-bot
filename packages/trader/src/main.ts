#!/usr/bin/env node
/**
 * Trader Main - Entry point for the Trader service
 *
 * Integrates:
 * - GatewayClient: Connection to Gateway
 * - StrategyEngine: Executes trading strategies
 * - RiskManager: Evaluates signals
 * - PositionManager: Tracks positions
 */

import { GatewayClient, loadEnvFromRoot } from '@deriv-bot/shared';
import { StrategyEngine } from './strategy/strategy-engine.js';
import { RiskManager } from './risk/risk-manager.js';
import { PositionManager } from './position/position-manager.js';
import { StrategyAccountant } from './accounting/strategy-accountant.js';
import type { BaseStrategy } from './strategy/base-strategy.js';
import type { Signal, Contract } from '@deriv-bot/shared';

// Load environment variables from project root
loadEnvFromRoot();

/**
 * Trader configuration from environment
 */
export interface TraderConfig {
  // Gateway connection
  gatewayUrl: string;
  autoReconnect: boolean;

  // Risk management
  maxRiskPerTrade: number;
  maxOpenPositions: number;
  maxDailyLoss: number;
  minConfidence: number;
  fixedStake?: number;

  // Logging
  enableLogging: boolean;
}

/**
 * Load configuration from environment
 */
function loadConfig(): TraderConfig {
  return {
    // Gateway
    gatewayUrl: process.env.GATEWAY_URL || 'ws://localhost:3000',
    autoReconnect: process.env.AUTO_RECONNECT !== 'false',

    // Risk
    maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.02'),
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '3', 10),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '0.10'),
    minConfidence: parseFloat(process.env.MIN_CONFIDENCE || '0.7'),
    fixedStake: process.env.FIXED_STAKE ? parseFloat(process.env.FIXED_STAKE) : undefined,

    // Logging
    enableLogging: process.env.ENABLE_LOGGING !== 'false',
  };
}

/**
 * Main Trader class
 */
export class Trader {
  private config: TraderConfig;
  private gatewayClient: GatewayClient;
  private strategyEngine: StrategyEngine;
  private riskManager: RiskManager;
  private positionManager: PositionManager;
  private accountant: StrategyAccountant;
  private running = false;
  private balance: number = 0;

  constructor(config: TraderConfig) {
    this.config = config;

    // Initialize Gateway Client
    this.gatewayClient = new GatewayClient({
      url: config.gatewayUrl,
      autoReconnect: config.autoReconnect,
      enableLogging: config.enableLogging,
    });

    // Initialize Strategy Engine
    this.strategyEngine = new StrategyEngine();

    // Initialize Risk Manager
    this.riskManager = new RiskManager({
      maxRiskPerTrade: config.maxRiskPerTrade,
      maxOpenPositions: config.maxOpenPositions,
      maxDailyLoss: config.maxDailyLoss,
      minConfidence: config.minConfidence,
      fixedStake: config.fixedStake,
    });

    // Initialize Position Manager
    this.positionManager = new PositionManager();

    // Initialize Strategy Accountant
    this.accountant = new StrategyAccountant();

    // Setup event handlers
    this.setupHandlers();
  }

  /**
   * Allocate balance to a strategy for independent accounting
   * When allocations are used, each strategy trades with its own balance
   */
  allocateToStrategy(strategyName: string, amount: number): void {
    this.accountant.allocate(strategyName, amount);
    this.log(`💰 Allocated ${amount} to ${strategyName}`);
  }

  /**
   * Get the StrategyAccountant for external access
   */
  getAccountant(): StrategyAccountant {
    return this.accountant;
  }

  /**
   * Setup event handlers
   */
  private setupHandlers(): void {
    // Gateway connection events
    this.gatewayClient.on('connected', () => {
      this.log('✅ Connected to Gateway');
      this.onConnected();
    });

    this.gatewayClient.on('disconnected', () => {
      this.log('❌ Disconnected from Gateway');
    });

    this.gatewayClient.on('error', (error) => {
      this.log('⚠️  Gateway error:', error.message);
    });

    // Market data events
    this.gatewayClient.on('tick', (tick) => {
      this.strategyEngine.processTick(tick);
    });

    this.gatewayClient.on('candle:closed', (data) => {
      this.strategyEngine.processCandle(data.candle);
    });

    // Strategy events
    this.strategyEngine.on('signal', async (signal, strategy) => {
      await this.handleSignal(signal, strategy);
    });

    this.strategyEngine.on('strategy:error', (error, strategy) => {
      this.log(`⚠️  Strategy error [${strategy.getName()}]:`, error.message);
    });

    // Position events
    this.positionManager.on('position:opened', (position) => {
      this.log(`📈 Position opened: ${position.direction} ${position.symbol} @ ${position.entryPrice}`);
    });

    this.positionManager.on('position:closed', (position, result) => {
      const emoji = result.status === 'won' ? '✅' : '❌';
      this.log(`${emoji} Position closed: ${result.status.toUpperCase()} | P/L: ${result.profit.toFixed(2)}`);

      // Record trade in accountant if strategy has allocation
      const strategyName = result.strategyName ?? position.strategyName;
      if (strategyName && this.accountant.hasStrategy(strategyName)) {
        this.accountant.recordTrade(strategyName, result);
        this.accountant.decrementOpenPositions(strategyName);
        this.accountant.releaseStake(strategyName, position.stake);

        // Print strategy-specific stats
        const strategyStats = this.accountant.getStats(strategyName);
        if (strategyStats) {
          this.log(`📊 [${strategyName}] Balance: ${this.accountant.getBalance(strategyName).toFixed(2)} | ROI: ${strategyStats.roi.toFixed(1)}% | Win Rate: ${(strategyStats.winRate * 100).toFixed(1)}%`);
        }
      }

      // Print global daily stats
      const stats = this.positionManager.getDailyStats();
      this.log(`📊 Daily Stats: ${stats.wins}W / ${stats.losses}L | Win Rate: ${(stats.winRate * 100).toFixed(1)}% | P/L: ${stats.pnl.toFixed(2)}`);
    });

    // Trade result events from Gateway
    this.gatewayClient.on('trade:result', (data) => {
      this.positionManager.closePosition(data);
    });
  }

  /**
   * Add a strategy to the engine
   */
  addStrategy(strategy: BaseStrategy): void {
    this.strategyEngine.addStrategy(strategy);
  }

  /**
   * Start the Trader
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.log('🚀 Starting Trader...\n');

    // 1. Connect to Gateway
    this.log('📡 Connecting to Gateway...');
    await this.gatewayClient.connect();

    // 2. Get initial balance
    this.log('💰 Fetching balance...');
    const balanceData = await this.gatewayClient.getBalance();
    this.balance = balanceData.amount;
    this.riskManager.setStartingBalance(this.balance);
    this.log(`✅ Balance: ${this.balance} ${balanceData.currency}\n`);

    // 3. Start all strategies
    this.log('🎯 Starting strategies...');
    await this.strategyEngine.startAll();
    const strategies = this.strategyEngine.getAllStrategies();
    strategies.forEach((s) => {
      this.log(`  ✓ ${s.getName()}`);
    });
    this.log();

    // 4. Subscribe to assets
    const assets = new Set<string>();
    strategies.forEach((s) => {
      s.getConfig().assets.forEach((a) => assets.add(a));
    });

    if (assets.size > 0) {
      this.log(`👀 Subscribing to assets: ${Array.from(assets).join(', ')}`);
      await this.gatewayClient.follow(Array.from(assets));
      this.log();
    }

    this.running = true;
    this.log('✨ Trader is running!\n');

    // Print configuration
    this.printConfig();
  }

  /**
   * Stop the Trader
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.log('\n🛑 Stopping Trader...\n');

    // 1. Stop all strategies
    this.log('🎯 Stopping strategies...');
    await this.strategyEngine.stopAll();

    // 2. Disconnect from Gateway
    this.log('📡 Disconnecting from Gateway...');
    await this.gatewayClient.disconnect();

    this.running = false;
    this.log('✅ Trader stopped\n');

    // Print final stats
    const stats = this.positionManager.getDailyStats();
    this.log('📊 Final Stats:');
    this.log(`   Trades: ${stats.tradeCount}`);
    this.log(`   Wins: ${stats.wins} | Losses: ${stats.losses}`);
    this.log(`   Win Rate: ${(stats.winRate * 100).toFixed(1)}%`);
    this.log(`   P/L: ${stats.pnl.toFixed(2)}`);
    this.log();
  }

  /**
   * Handle signal from strategy
   */
  private async handleSignal(signal: Signal, strategy: BaseStrategy): Promise<void> {
    const strategyName = strategy.getName();
    this.log(`🔔 Signal from ${strategyName}: ${signal.direction} ${signal.symbol} (confidence: ${(signal.confidence * 100).toFixed(0)}%)`);

    // Use per-strategy accounting if strategy has allocation, otherwise global balance
    const useStrategyAccounting = this.accountant.hasStrategy(strategyName);
    let riskContext;

    if (useStrategyAccounting) {
      // Use strategy-specific accounting
      const strategyContext = this.accountant.getRiskContext(strategyName);
      if (!strategyContext) {
        this.log(`❌ Signal rejected: Strategy ${strategyName} context not available`);
        return;
      }
      riskContext = {
        balance: strategyContext.balance,
        openPositions: strategyContext.openPositions,
        dailyPnL: strategyContext.dailyPnL,
      };
    } else {
      // Use global balance
      riskContext = {
        balance: this.balance,
        openPositions: this.positionManager.getOpenPositionsCount(),
        dailyPnL: this.positionManager.getDailyStats().pnl,
      };
    }

    // Evaluate with Risk Manager
    const decision = this.riskManager.evaluateSignal(signal, riskContext);

    if (!decision.approved) {
      this.log(`❌ Signal rejected: ${decision.reason}`);
      return;
    }

    // Reserve stake in accountant if using per-strategy accounting
    if (useStrategyAccounting) {
      const reserved = this.accountant.reserveStake(strategyName, decision.stakeAmount!);
      if (!reserved) {
        this.log(`❌ Signal rejected: Insufficient balance in ${strategyName} account`);
        return;
      }
    }

    this.log(`✅ Signal approved | Stake: ${decision.stakeAmount}${useStrategyAccounting ? ` [${strategyName}]` : ''}`);

    try {
      // Execute trade via Gateway
      const result = await this.gatewayClient.trade({
        asset: signal.symbol,
        direction: signal.direction,
        amount: decision.stakeAmount!,
        duration: 1,
        durationUnit: 'm',
      });

      // Add position with strategyName
      const contract: Contract = {
        id: result.contractId,
        symbol: signal.symbol,
        direction: signal.direction,
        stake: decision.stakeAmount!,
        payout: result.payout,
        entryPrice: result.buyPrice,
        entryTime: result.purchaseTime,
        status: 'open',
        duration: 60,
        strategyName, // Track which strategy opened this position
      };

      this.positionManager.addPosition(contract);

      // Track open position in accountant
      if (useStrategyAccounting) {
        this.accountant.incrementOpenPositions(strategyName);
      }

      // Update global balance (actual account balance)
      this.balance -= decision.stakeAmount!;
      this.strategyEngine.updateBalance(this.balance);

    } catch (error) {
      // Release stake if trade failed
      if (useStrategyAccounting) {
        this.accountant.releaseStake(strategyName, decision.stakeAmount!);
      }
      this.log(`❌ Trade execution failed:`, error);
    }
  }

  /**
   * Called when connected to Gateway
   */
  private async onConnected(): Promise<void> {
    // Update balance
    try {
      const balanceData = await this.gatewayClient.getBalance();
      this.balance = balanceData.amount;
      this.strategyEngine.updateBalance(this.balance);
    } catch (error) {
      this.log('⚠️  Failed to update balance:', error);
    }
  }

  /**
   * Print configuration
   */
  private printConfig(): void {
    this.log('⚙️  Configuration:');
    this.log(`   Gateway: ${this.config.gatewayUrl}`);
    this.log(`   Max Risk/Trade: ${(this.config.maxRiskPerTrade * 100).toFixed(1)}%`);
    this.log(`   Max Open Positions: ${this.config.maxOpenPositions}`);
    this.log(`   Max Daily Loss: ${(this.config.maxDailyLoss * 100).toFixed(1)}%`);
    this.log(`   Min Confidence: ${(this.config.minConfidence * 100).toFixed(0)}%`);
    if (this.config.fixedStake) {
      this.log(`   Fixed Stake: ${this.config.fixedStake}`);
    }
    this.log();
  }

  /**
   * Log message (if enabled)
   */
  private log(...args: any[]): void {
    if (this.config.enableLogging) {
      console.log(...args);
    }
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      balance: this.balance,
      openPositions: this.positionManager.getOpenPositionsCount(),
      dailyStats: this.positionManager.getDailyStats(),
    };
  }
}

/**
 * Main entry point
 */
async function main() {
  // Load configuration
  const config = loadConfig();

  // Create Trader instance
  const trader = new Trader(config);

  // Handle graceful shutdown
  const shutdown = async () => {
    await trader.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start Trader
  try {
    await trader.start();
  } catch (error) {
    console.error('❌ Failed to start Trader:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { loadConfig };
