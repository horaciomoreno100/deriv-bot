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

import { GatewayClient, getOpenObserveLogger, type OpenObserveLogger, loadEnvFromRoot } from '@deriv-bot/shared';
import { StrategyEngine } from './strategy/strategy-engine.js';
import { RiskManager } from './risk/risk-manager.js';
import { PositionManager } from './position/position-manager.js';
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
  private ooLogger: OpenObserveLogger;
  private running = false;
  private balance: number = 0;

  constructor(config: TraderConfig) {
    this.config = config;

    // Initialize OpenObserve Logger (with service name for per-service streams)
    this.ooLogger = getOpenObserveLogger({ service: 'trader' });

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

    // Setup event handlers
    this.setupHandlers();
  }

  /**
   * Setup event handlers
   */
  private setupHandlers(): void {
    // Gateway connection events
    this.gatewayClient.on('connected', () => {
      this.log('✅ Connected to Gateway');
      this.ooLogger.info('trader', 'Connected to Gateway', { url: this.config.gatewayUrl });
      this.onConnected();
    });

    this.gatewayClient.on('disconnected', () => {
      this.log('❌ Disconnected from Gateway');
      this.ooLogger.warn('trader', 'Disconnected from Gateway');
    });

    this.gatewayClient.on('error', (error) => {
      this.log('⚠️  Gateway error:', error.message);
      this.ooLogger.error('trader', 'Gateway error', { error: error.message });
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
      this.ooLogger.info('trader', 'Signal received', {
        strategy: strategy.getName(),
        symbol: signal.symbol,
        direction: signal.direction,
        confidence: signal.confidence
      });
      await this.handleSignal(signal, strategy);
    });

    this.strategyEngine.on('strategy:error', (error, strategy) => {
      this.log(`⚠️  Strategy error [${strategy.getName()}]:`, error.message);
      this.ooLogger.error('trader', 'Strategy error', {
        strategy: strategy.getName(),
        error: error.message
      });
    });

    // Position events
    this.positionManager.on('position:opened', (position) => {
      this.log(`📈 Position opened: ${position.direction} ${position.symbol} @ ${position.entryPrice}`);
      this.ooLogger.info('trader', 'Position opened', {
        symbol: position.symbol,
        direction: position.direction,
        entryPrice: position.entryPrice,
        stake: position.stake
      });
    });

    this.positionManager.on('position:closed', (_position, result) => {
      const emoji = result.status === 'won' ? '✅' : '❌';
      this.log(`${emoji} Position closed: ${result.status.toUpperCase()} | P/L: ${result.profit.toFixed(2)}`);

      // Print daily stats
      const stats = this.positionManager.getDailyStats();
      this.log(`📊 Daily Stats: ${stats.wins}W / ${stats.losses}L | Win Rate: ${(stats.winRate * 100).toFixed(1)}% | P/L: ${stats.pnl.toFixed(2)}`);

      this.ooLogger.info('trader', 'Position closed', {
        status: result.status,
        profit: result.profit,
        dailyStats: stats
      });
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
    this.ooLogger.info('trader', 'Starting Trader service');

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
    this.ooLogger.info('trader', 'Trader is running', {
      balance: this.balance,
      strategies: strategies.map(s => s.getName()),
      assets: Array.from(assets)
    });

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
    this.ooLogger.warn('trader', 'Stopping Trader service');

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

    // Log final stats to OpenObserve
    this.ooLogger.info('trader', 'Trader stopped', {
      finalStats: stats,
      finalBalance: this.balance
    });

    // Close OpenObserve logger
    await this.ooLogger.close();
  }

  /**
   * Handle signal from strategy
   */
  private async handleSignal(signal: Signal, strategy: BaseStrategy): Promise<void> {
    this.log(`🔔 Signal from ${strategy.getName()}: ${signal.direction} ${signal.symbol} (confidence: ${(signal.confidence * 100).toFixed(0)}%)`);

    // Evaluate with Risk Manager
    const decision = this.riskManager.evaluateSignal(signal, {
      balance: this.balance,
      openPositions: this.positionManager.getOpenPositionsCount(),
      dailyPnL: this.positionManager.getDailyStats().pnl,
    });

    if (!decision.approved) {
      this.log(`❌ Signal rejected: ${decision.reason}`);
      this.ooLogger.warn('trader', 'Signal rejected', {
        strategy: strategy.getName(),
        symbol: signal.symbol,
        direction: signal.direction,
        reason: decision.reason
      });
      return;
    }

    this.log(`✅ Signal approved | Stake: ${decision.stakeAmount}`);
    this.ooLogger.info('trader', 'Signal approved', {
      strategy: strategy.getName(),
      symbol: signal.symbol,
      direction: signal.direction,
      stake: decision.stakeAmount
    });

    try {
      // Execute trade via Gateway
      const result = await this.gatewayClient.trade({
        asset: signal.symbol,
        direction: signal.direction,
        amount: decision.stakeAmount!,
        duration: 1,
        durationUnit: 'm',
      });

      // Add position
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
      };

      this.positionManager.addPosition(contract);

      // Update balance
      this.balance -= decision.stakeAmount!;
      this.strategyEngine.updateBalance(this.balance);

      this.ooLogger.info('trader', 'Trade executed', {
        contractId: result.contractId,
        symbol: signal.symbol,
        direction: signal.direction,
        stake: decision.stakeAmount,
        payout: result.payout
      });

    } catch (error) {
      this.log(`❌ Trade execution failed:`, error);
      this.ooLogger.error('trader', 'Trade execution failed', {
        symbol: signal.symbol,
        direction: signal.direction,
        error: error instanceof Error ? error.message : String(error)
      });
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
