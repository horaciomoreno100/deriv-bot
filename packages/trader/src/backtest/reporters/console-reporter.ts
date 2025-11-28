/**
 * Console Reporter for Backtest Results
 *
 * Pretty-prints backtest results to the console.
 */

import type { BacktestResult, BacktestMetrics, MonteCarloResult, OOSResult } from '../types.js';

/**
 * Format a number with fixed decimals
 */
function fmt(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

/**
 * Format currency
 */
function fmtCurrency(n: number): string {
  return `$${fmt(n)}`;
}

/**
 * Format percentage
 */
function fmtPct(n: number): string {
  return `${fmt(n, 1)}%`;
}

/**
 * Create a horizontal line
 */
function line(char: string = '─', length: number = 60): string {
  return char.repeat(length);
}

/**
 * Print backtest result summary to console
 */
export function printBacktestResult(result: BacktestResult): void {
  const { metrics, config, dateRange, strategyName, strategyVersion, asset } = result;

  console.log('\n' + line('═'));
  console.log(`  BACKTEST RESULT: ${strategyName} v${strategyVersion ?? '1.0.0'}`);
  console.log(line('═'));

  // Configuration
  console.log('\n📊 CONFIGURATION');
  console.log(line());
  console.log(`  Asset:        ${asset}`);
  console.log(`  Timeframe:    ${config.timeframe}s`);
  console.log(`  Period:       ${dateRange.from.toISOString().split('T')[0]} → ${dateRange.to.toISOString().split('T')[0]}`);
  console.log(`  Candles:      ${dateRange.candleCount.toLocaleString()}`);
  console.log(`  Initial:      ${fmtCurrency(config.initialBalance)}`);
  console.log(`  Stake:        ${config.stakeMode === 'percentage' ? fmtPct(config.stakePct * 100) : fmtCurrency(config.stakeAmount)}`);
  console.log(`  Multiplier:   ${config.multiplier}x`);
  console.log(`  TP/SL:        ${fmtPct(config.takeProfitPct * 100)} / ${fmtPct(config.stopLossPct * 100)}`);

  // Results
  printMetrics(metrics);

  // Monte Carlo
  if (result.monteCarlo) {
    printMonteCarlo(result.monteCarlo);
  }

  // OOS Test
  if (result.oosTest) {
    printOOSResult(result.oosTest);
  }

  // Execution info
  console.log('\n⏱️  EXECUTION');
  console.log(line());
  console.log(`  Completed:    ${result.executedAt.toISOString()}`);
  console.log(`  Duration:     ${result.executionTimeMs}ms`);

  console.log('\n' + line('═') + '\n');
}

/**
 * Print metrics
 */
export function printMetrics(metrics: BacktestMetrics): void {
  console.log('\n📈 PERFORMANCE');
  console.log(line());
  console.log(`  Trades:       ${metrics.totalTrades} (${metrics.wins}W / ${metrics.losses}L)`);
  console.log(`  Win Rate:     ${fmtPct(metrics.winRate)}`);
  console.log(`  Net P&L:      ${fmtCurrency(metrics.netPnl)}`);
  console.log(`  Profit Factor: ${metrics.profitFactor === Infinity ? '∞' : fmt(metrics.profitFactor)}`);

  console.log('\n💰 P&L BREAKDOWN');
  console.log(line());
  console.log(`  Gross Profit: ${fmtCurrency(metrics.grossProfit)}`);
  console.log(`  Gross Loss:   ${fmtCurrency(metrics.grossLoss)}`);
  console.log(`  Avg Win:      ${fmtCurrency(metrics.avgWin)}`);
  console.log(`  Avg Loss:     ${fmtCurrency(metrics.avgLoss)}`);
  console.log(`  Avg Trade:    ${fmtCurrency(metrics.avgPnl)}`);

  console.log('\n⚠️  RISK METRICS');
  console.log(line());
  console.log(`  Max Drawdown: ${fmtCurrency(metrics.maxDrawdown)} (${fmtPct(metrics.maxDrawdownPct)})`);
  console.log(`  Max Consec W: ${metrics.maxConsecutiveWins}`);
  console.log(`  Max Consec L: ${metrics.maxConsecutiveLosses}`);
  console.log(`  Expectancy:   ${fmtCurrency(metrics.expectancy)}`);
  console.log(`  SQN:          ${fmt(metrics.sqn)}`);

  console.log('\n🔍 QUALITY');
  console.log(line());
  console.log(`  Near Misses:  ${metrics.nearMisses} (lost but reached >50% of TP)`);
  console.log(`  Quick Losses: ${metrics.immediateReversals} (lost in ≤3 bars)`);
  console.log(`  Avg Duration: ${fmt(metrics.avgBarsHeld, 1)} bars`);
}

/**
 * Print Monte Carlo results
 */
export function printMonteCarlo(mc: MonteCarloResult): void {
  console.log('\n🎲 MONTE CARLO SIMULATION');
  console.log(line());
  console.log(`  Simulations:  ${mc.simulations}`);
  console.log(`  Original P&L: ${fmtCurrency(mc.original.netPnl)}`);
  console.log('');
  console.log('  P&L Distribution:');
  console.log(`    5th:  ${fmtCurrency(mc.distribution.netPnl.p5)}`);
  console.log(`    25th: ${fmtCurrency(mc.distribution.netPnl.p25)}`);
  console.log(`    50th: ${fmtCurrency(mc.distribution.netPnl.p50)}`);
  console.log(`    75th: ${fmtCurrency(mc.distribution.netPnl.p75)}`);
  console.log(`    95th: ${fmtCurrency(mc.distribution.netPnl.p95)}`);
  console.log('');
  console.log(`  Profit Probability: ${fmtPct(mc.profitProbability)}`);
  console.log(`  Risk of Ruin:       ${fmtPct(mc.riskOfRuin)}`);
  console.log(`  95% CI: ${fmtCurrency(mc.confidence95.minProfit)} to ${fmtCurrency(mc.confidence95.maxProfit)}`);
}

/**
 * Print OOS results
 */
export function printOOSResult(oos: OOSResult): void {
  console.log('\n🧪 OUT-OF-SAMPLE TEST');
  console.log(line());
  console.log('  In-Sample:');
  console.log(`    Trades:   ${oos.inSample.trades}`);
  console.log(`    Win Rate: ${fmtPct(oos.inSample.winRate)}`);
  console.log(`    Net P&L:  ${fmtCurrency(oos.inSample.netPnl)}`);
  console.log(`    PF:       ${fmt(oos.inSample.profitFactor)}`);
  console.log('');
  console.log('  Out-of-Sample:');
  console.log(`    Trades:   ${oos.outOfSample.trades}`);
  console.log(`    Win Rate: ${fmtPct(oos.outOfSample.winRate)}`);
  console.log(`    Net P&L:  ${fmtCurrency(oos.outOfSample.netPnl)}`);
  console.log(`    PF:       ${fmt(oos.outOfSample.profitFactor)}`);
  console.log('');
  console.log(`  WR Delta:    ${fmt(oos.winRateDelta, 1)} pts`);
  console.log(`  Overfit Score: ${fmt(oos.overfitScore, 0)}/100`);
  console.log(`  Verdict:     ${oos.recommendation}`);
}

/**
 * Print a compact one-line summary
 */
export function printCompactSummary(result: BacktestResult): void {
  const { metrics } = result;
  const pf = metrics.profitFactor === Infinity ? '∞' : fmt(metrics.profitFactor);
  console.log(
    `${result.strategyName} | ` +
    `${metrics.totalTrades} trades | ` +
    `${fmtPct(metrics.winRate)} WR | ` +
    `${fmtCurrency(metrics.netPnl)} P&L | ` +
    `PF ${pf} | ` +
    `DD ${fmtPct(metrics.maxDrawdownPct)}`
  );
}
