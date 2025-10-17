/**
 * Mean Reversion Strategy - Example Usage
 *
 * This example shows how to use the optimized Mean Reversion strategy
 * with the trader bot.
 */

import { MeanReversionStrategy } from '../mean-reversion.strategy.js';
import { StrategyEngine } from '../../strategy/strategy-engine.js';
import type { StrategyConfig } from '@deriv-bot/shared';

/**
 * Example 1: Default Configuration (Optimized for R_75)
 *
 * Uses the backtested optimal parameters:
 * - RSI 17/83
 * - BB 20, 2.0
 * - ATR 1.0x
 * - Cooldown 2 min
 * - Progressive Anti-Martingale
 */
export function createDefaultMeanReversionStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'MeanReversion-R75-Default',
    enabled: true,
    assets: ['R_75'], // Volatility 75 Index
    maxConcurrentTrades: 1,
    amount: 1, // 1% of balance
    amountType: 'percentage',
    cooldownSeconds: 120, // 2 minutes
    minConfidence: 0.75,
    parameters: {
      // Uses defaults from strategy (optimized values)
      expiryMinutes: 3,
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Example 2: Conservative Configuration
 *
 * More conservative thresholds for lower risk:
 * - Tighter RSI thresholds (15/85)
 * - Longer cooldown (3 min)
 * - Smaller stakes
 */
export function createConservativeMeanReversionStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'MeanReversion-R75-Conservative',
    enabled: true,
    assets: ['R_75'],
    maxConcurrentTrades: 1,
    amount: 0.5, // 0.5% of balance
    amountType: 'percentage',
    cooldownSeconds: 180, // 3 minutes
    minConfidence: 0.85, // Higher confidence required
    parameters: {
      rsiOversold: 15, // Even tighter
      rsiOverbought: 85, // Even tighter
      cooldownMinutes: 3,
      expiryMinutes: 3,
      maxWinStreak: 2,
      maxLossStreak: 3,
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Example 3: Aggressive Configuration
 *
 * More aggressive for higher risk/reward:
 * - Looser RSI thresholds (20/80)
 * - Shorter cooldown (1 min)
 * - Progressive staking
 */
export function createAggressiveMeanReversionStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'MeanReversion-R75-Aggressive',
    enabled: true,
    assets: ['R_75'],
    maxConcurrentTrades: 2, // Allow 2 concurrent trades
    amount: 2, // 2% of balance
    amountType: 'percentage',
    cooldownSeconds: 60, // 1 minute
    minConfidence: 0.65, // Lower confidence threshold
    parameters: {
      rsiOversold: 20, // Looser thresholds = more trades
      rsiOverbought: 80,
      cooldownMinutes: 1,
      expiryMinutes: 3,
      maxWinStreak: 3, // Longer progressive cycles
      maxLossStreak: 2, // Shorter loss tolerance
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Example 4: Using with Strategy Engine
 *
 * Shows how to integrate with the strategy engine
 */
export function setupMeanReversionWithEngine(): StrategyEngine {
  const engine = new StrategyEngine();

  // Create strategy
  const strategy = createDefaultMeanReversionStrategy();

  // Add to engine
  engine.addStrategy(strategy);

  // Listen for signals
  engine.on('signal', (signal, strat) => {
    console.log(`📊 Signal from ${strat.getName()}:`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Reason: ${signal.metadata?.reason}`);
    console.log(`   RSI: ${signal.metadata?.rsi}`);
    console.log(`   Price: ${signal.metadata?.price}`);
  });

  // Listen for errors
  engine.on('strategy:error', (error, strat) => {
    console.error(`❌ Error in ${strat.getName()}:`, error.message);
  });

  return engine;
}

/**
 * Example 5: Manual Signal Processing
 *
 * Shows how to manually process candles and handle signals
 */
export async function manualSignalProcessing() {
  const strategy = createDefaultMeanReversionStrategy();

  // Start strategy
  await strategy.start();

  // Listen for signals
  strategy.on('signal', (signal) => {
    console.log('🎯 Trading Signal:', signal);

    // Calculate stake with progressive anti-martingale
    const baseStake = 10; // $10 base
    const actualStake = (strategy as any).getCurrentStake(baseStake);

    console.log(`💰 Stake: $${actualStake.toFixed(2)}`);

    // After trade result, update anti-martingale
    // Example: Won trade with $8 profit
    const won = true;
    const profit = 8;
    (strategy as any).updateAntiMartingale(won, profit, actualStake);

    // Check streak info
    const streakInfo = (strategy as any).getStreakInfo();
    console.log('📊 Streak Info:', streakInfo);
  });

  // Stop strategy when done
  // await strategy.stop();
}

/**
 * Example 6: Multi-Asset Configuration
 *
 * Run the same strategy on multiple volatile assets
 */
export function createMultiAssetMeanReversion(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'MeanReversion-MultiAsset',
    enabled: true,
    assets: ['R_75', 'R_100', 'R_50'], // Multiple volatility indices
    maxConcurrentTrades: 3, // One per asset
    amount: 1,
    amountType: 'percentage',
    cooldownSeconds: 120,
    minConfidence: 0.75,
    parameters: {
      // Default optimized parameters
    },
  };

  return new MeanReversionStrategy(config);
}

// Export usage examples
export const examples = {
  default: createDefaultMeanReversionStrategy,
  conservative: createConservativeMeanReversionStrategy,
  aggressive: createAggressiveMeanReversionStrategy,
  withEngine: setupMeanReversionWithEngine,
  manual: manualSignalProcessing,
  multiAsset: createMultiAssetMeanReversion,
};
