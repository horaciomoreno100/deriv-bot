#!/usr/bin/env npx tsx
/**
 * Test Risk Manager with Volatility-Adjusted Position Sizing
 *
 * Demonstrates how the RiskManager adjusts stake size based on asset volatility.
 */

import { RiskManager } from '../risk/risk-manager.js';

const BALANCE = 1000;
const MAX_RISK = 0.02; // 2% per trade

// Create risk manager with volatility adjustment enabled
const riskManager = new RiskManager({
  maxRiskPerTrade: MAX_RISK,
  maxOpenPositions: 3,
  maxDailyLoss: 0.10,
  minConfidence: 0.7,
  useVolatilityAdjustment: true,
});

riskManager.setStartingBalance(BALANCE);

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     VOLATILITY-ADJUSTED POSITION SIZING                    ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log();
console.log(`Balance: $${BALANCE}`);
console.log(`Base Risk: ${(MAX_RISK * 100).toFixed(1)}% = $${(BALANCE * MAX_RISK).toFixed(2)}`);
console.log();

// Test assets with backtest metrics from our analysis
const testAssets = [
  {
    asset: 'R_100',
    metrics: { winRate: 0.413, avgWin: 10.35, avgLoss: 5.66, profitFactor: 1.31 },
    description: 'Synthetic Index - HIGH volatility',
  },
  {
    asset: 'cryETHUSD',
    metrics: { winRate: 0.478, avgWin: 5.0, avgLoss: 5.0, profitFactor: 0.95 },
    description: 'Crypto - HIGH volatility (unprofitable)',
  },
  {
    asset: 'frxEURUSD',
    metrics: { winRate: 0.600, avgWin: 0.82, avgLoss: 0.87, profitFactor: 1.53 },
    description: 'Forex - LOW volatility',
  },
  {
    asset: 'OTC_GDAXI',
    metrics: { winRate: 0.688, avgWin: 3.73, avgLoss: 2.88, profitFactor: 2.85 },
    description: 'DAX Index - LOW volatility',
  },
];

console.log('┌─────────────┬────────────┬────────────┬────────────┬─────────┬──────────────────────────┐');
console.log('│ Asset       │ Vol Scale  │ Base Stake │ Adj. Stake │ Method  │ Details                  │');
console.log('├─────────────┼────────────┼────────────┼────────────┼─────────┼──────────────────────────┤');

for (const { asset, metrics, description } of testAssets) {
  const profile = riskManager.getVolatilityProfile(asset);
  const baseStake = BALANCE * MAX_RISK;
  const recommendation = riskManager.getRecommendedStake(asset, BALANCE, metrics);

  console.log(
    `│ ${asset.padEnd(11)} │ ${profile.riskScaleFactor.toFixed(2).padStart(10)} │ $${baseStake.toFixed(2).padStart(9)} │ $${recommendation.stake.toFixed(2).padStart(9)} │ ${recommendation.method.padEnd(7)} │ ${description.substring(0, 24).padEnd(24)} │`
  );
}

console.log('└─────────────┴────────────┴────────────┴────────────┴─────────┴──────────────────────────┘');
console.log();

// Detailed breakdown
console.log('═'.repeat(70));
console.log('DETAILED BREAKDOWN');
console.log('═'.repeat(70));
console.log();

for (const { asset, metrics, description } of testAssets) {
  const profile = riskManager.getVolatilityProfile(asset);
  const recommendation = riskManager.getRecommendedStake(asset, BALANCE, metrics);

  console.log(`📊 ${asset} - ${description}`);
  console.log(`   Volatility Profile:`);
  console.log(`     - Expected Max DD: ${profile.expectedMaxDD}%`);
  console.log(`     - Volatility Multiplier: ${profile.volatilityMultiplier}x`);
  console.log(`     - Risk Scale Factor: ${profile.riskScaleFactor}x`);
  console.log(`   Backtest Metrics:`);
  console.log(`     - Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`);
  console.log(`     - Avg Win/Loss: $${metrics.avgWin.toFixed(2)} / $${metrics.avgLoss.toFixed(2)}`);
  console.log(`     - Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
  console.log(`   Recommendation:`);
  console.log(`     - Stake: $${recommendation.stake.toFixed(2)}`);
  console.log(`     - Method: ${recommendation.method}`);
  console.log(`     - ${recommendation.details}`);
  console.log();
}

// Summary
console.log('═'.repeat(70));
console.log('SUMMARY');
console.log('═'.repeat(70));
console.log();
console.log('Key takeaways:');
console.log('');
console.log('1. HIGH volatility assets (R_100, crypto):');
console.log('   → Scale factor 0.67-0.77x reduces stake to ~$14-15');
console.log('   → Protects against large drawdowns');
console.log('');
console.log('2. LOW volatility assets (forex, DAX):');
console.log('   → Scale factor 1.5-2.0x increases stake to ~$30-40');
console.log('   → Captures more profit from stable markets');
console.log('');
console.log('3. UNPROFITABLE strategies (cryETHUSD):');
console.log('   → Kelly returns $0 stake');
console.log('   → Do not trade!');
console.log('');
console.log('✅ With this system, expected drawdown is normalized across all assets.');
