#!/usr/bin/env tsx
/**
 * Compare MR Strategies Script
 *
 * Runs all 4 MR strategies on EUR/USD M5 data and generates comparison report.
 *
 * Usage:
 *   npx tsx src/scripts/compare-mr-strategies.ts
 *
 * Environment variables:
 *   ASSET       - Asset to test (default: frxEURUSD)
 *   DATA_FILE   - Path to CSV data file
 *   INITIAL_BAL - Initial balance (default: 10000)
 *   STAKE_PCT   - Position size % (default: 0.02)
 *   MULTIPLIER  - Deriv multiplier (default: 100)
 *   RUN_MC      - Run Monte Carlo (default: false)
 *   RUN_OOS     - Run Out-of-Sample test (default: false)
 */

import { join } from 'path';
import { existsSync } from 'fs';
import {
  compareMRStrategies,
  saveComparisonResults,
  type MRBacktestConfig,
} from '../backtest/mr-backtest-runner.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ANALYSIS_OUTPUT_DIR = join(process.cwd(), 'analysis-output');

// Parse environment variables
const config: MRBacktestConfig = {
  asset: process.env.ASSET || 'frxEURUSD',
  dataPath: process.env.DATA_FILE || join(ANALYSIS_OUTPUT_DIR, 'frxEURUSD_300s_365d.csv'),
  initialBalance: parseFloat(process.env.INITIAL_BAL || '10000'),
  stakePct: parseFloat(process.env.STAKE_PCT || '0.02'),
  multiplier: parseFloat(process.env.MULTIPLIER || '100'),
  takeProfitPct: 0.005, // 0.5%
  stopLossPct: 0.005,   // 0.5%
  maxBarsInTrade: 20,
  spreadPips: 1.0,
  pipValue: 0.0001,
  enableNewsFilter: process.env.NEWS_FILTER === 'true',
  enableSessionFilter: process.env.SESSION_FILTER === 'true',
  runMonteCarlo: process.env.RUN_MC === 'true',
  runOOSTest: process.env.RUN_OOS === 'true',
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔬 MEAN REVERSION STRATEGY COMPARISON');
  console.log('='.repeat(80));
  console.log('');

  // Check if data file exists
  if (!existsSync(config.dataPath)) {
    console.error(`❌ Data file not found: ${config.dataPath}`);
    console.log('');
    console.log('To fetch data, run:');
    console.log('  SYMBOLS="frxEURUSD" DAYS=365 pnpm data:fetch:forex');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Asset:           ${config.asset}`);
  console.log(`  Data file:       ${config.dataPath}`);
  console.log(`  Initial balance: $${config.initialBalance.toLocaleString()}`);
  console.log(`  Position size:   ${(config.stakePct * 100).toFixed(1)}%`);
  console.log(`  Multiplier:      x${config.multiplier}`);
  console.log(`  TP/SL:           ${(config.takeProfitPct! * 100).toFixed(2)}% / ${(config.stopLossPct! * 100).toFixed(2)}%`);
  console.log(`  News filter:     ${config.enableNewsFilter ? 'ON' : 'OFF'}`);
  console.log(`  Session filter:  ${config.enableSessionFilter ? 'ON' : 'OFF'}`);
  console.log(`  Monte Carlo:     ${config.runMonteCarlo ? 'ON' : 'OFF'}`);
  console.log(`  OOS Test:        ${config.runOOSTest ? 'ON' : 'OFF'}`);
  console.log('');

  try {
    // Run comparison
    const result = await compareMRStrategies(config);

    // Save results
    const outputPath = join(ANALYSIS_OUTPUT_DIR, 'mr_strategy_comparison.json');
    saveComparisonResults(result, outputPath);

    // Print final summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL RANKING');
    console.log('='.repeat(80));
    console.log('');

    for (const item of result.ranking) {
      const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : '  ';
      const pf = item.profitFactor >= 999 ? '∞' : item.profitFactor.toFixed(2);

      console.log(
        `${medal} #${item.rank} ${item.strategy.padEnd(16)} | ` +
        `WR: ${item.winRate.toFixed(1)}% | ` +
        `PF: ${pf.padStart(6)} | ` +
        `P&L: $${item.netPnl.toFixed(2).padStart(10)} | ` +
        `Trades: ${item.trades}`
      );
    }

    console.log('\n' + '='.repeat(80));

    // Recommendations
    const best = result.ranking[0];
    if (best && best.profitFactor >= 1.5 && best.netPnl > 0) {
      console.log(`\n✅ RECOMENDACIÓN: ${best.strategy}`);
      console.log(`   - Profit Factor: ${best.profitFactor.toFixed(2)}`);
      console.log(`   - Win Rate: ${best.winRate.toFixed(1)}%`);
      console.log(`   - Net P&L: $${best.netPnl.toFixed(2)}`);
    } else {
      console.log('\n⚠️  Ninguna estrategia alcanzó PF >= 1.5');
      console.log('   Considera ajustar parámetros o revisar las condiciones de mercado');
    }

    // Tips for next steps
    console.log('\n📝 Próximos pasos:');
    console.log('   1. Ejecutar con RUN_OOS=true para validar robustez');
    console.log('   2. Ejecutar con RUN_MC=true para análisis de riesgo');
    console.log('   3. Probar con NEWS_FILTER=true para filtrar noticias');
    console.log('   4. Probar con SESSION_FILTER=true para filtrar por sesión');

    console.log('\n✅ Comparación completa!\n');

  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

main().catch(console.error);
