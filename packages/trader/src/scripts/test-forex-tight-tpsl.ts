/**
 * Test forex with tighter TP/SL for faster trades
 */
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createFVGLiquiditySweepStrategy,
} from '../backtest/index.js';
import { DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS, FOREX_PARAMS } from '../strategies/fvg-liquidity-sweep.params.js';

const ASSETS = ['frxAUDUSD', 'frxEURUSD', 'frxGBPUSD', 'frxUSDCHF'];

// Test different TP/SL configurations
const CONFIGS = [
  { name: 'Current (RR=1.0, SL=0.15%)', takeProfitRR: 1.0, stopLossBufferPct: 0.0015 },
  { name: 'Tight (RR=0.5, SL=0.10%)', takeProfitRR: 0.5, stopLossBufferPct: 0.001 },
  { name: 'Very Tight (RR=0.5, SL=0.08%)', takeProfitRR: 0.5, stopLossBufferPct: 0.0008 },
  { name: 'Scalp (RR=0.3, SL=0.05%)', takeProfitRR: 0.3, stopLossBufferPct: 0.0005 },
];

async function main() {
  console.log('Testing FVG-LS Forex with different TP/SL configurations\n');
  console.log('='.repeat(100));

  for (const config of CONFIGS) {
    console.log('\n📊 CONFIG: ' + config.name);
    console.log('-'.repeat(100));

    let totalTrades = 0;
    let totalPnl = 0;
    let totalDuration = 0;
    const configResults: Array<{
      asset: string;
      trades: number;
      winRate: number;
      pnl: number;
      pf: number;
      avgDuration: number;
    }> = [];

    for (const asset of ASSETS) {
      const dataPath = path.join(process.cwd(), 'data', asset + '_1m_90d.csv');

      try {
        const candles = loadCandlesFromCSV(dataPath, {
          asset,
          timeframe: 60,
          timestampColumn: 'timestamp',
          openColumn: 'open',
          highColumn: 'high',
          lowColumn: 'low',
          closeColumn: 'close',
        });

        const params = {
          ...DEFAULT_FVG_LIQUIDITY_SWEEP_PARAMS,
          ...FOREX_PARAMS,
          takeProfitRR: config.takeProfitRR,
          stopLossBufferPct: config.stopLossBufferPct,
        };

        const strategy = createFVGLiquiditySweepStrategy(params);

        const result = await runBacktest({
          candles,
          strategy,
          initialBalance: 1000,
          stakePct: 0.02,
          multiplier: 100,
          runMonteCarlo: false,
          runOOS: false,
          verbose: false,
        });

        const avgDuration = result.trades.length > 0
          ? result.trades.reduce((sum, t) => sum + (t.exitBar - t.entryBar), 0) / result.trades.length
          : 0;

        configResults.push({
          asset,
          trades: result.metrics.totalTrades,
          winRate: result.metrics.winRate,
          pnl: result.metrics.netPnl,
          pf: result.metrics.profitFactor,
          avgDuration,
        });

        totalTrades += result.metrics.totalTrades;
        totalPnl += result.metrics.netPnl;
        totalDuration += avgDuration;

      } catch (e: any) {
        console.log('  ' + asset + ': Error - ' + e.message);
      }
    }

    // Print results for this config
    console.log('\n  Asset      | Trades | Win% | P&L      | PF   | Avg Duration');
    console.log('  -----------|--------|------|----------|------|-------------');
    for (const r of configResults) {
      const pnlStr = r.pnl >= 0 ? '+$' + r.pnl.toFixed(0) : '-$' + Math.abs(r.pnl).toFixed(0);
      const assetPad = r.asset + ' '.repeat(10 - r.asset.length);
      const tradesPad = ' '.repeat(6 - String(r.trades).length) + r.trades;
      const pnlPad = ' '.repeat(8 - pnlStr.length) + pnlStr;
      console.log('  ' + assetPad + ' | ' + tradesPad + ' | ' + (r.winRate*100).toFixed(0) + '%  | ' + pnlPad + ' | ' + r.pf.toFixed(2) + ' | ' + r.avgDuration.toFixed(1) + ' min');
    }

    const avgDurationAll = totalDuration / ASSETS.length;
    const totalPnlStr = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(0);
    console.log('  -----------|--------|------|----------|------|-------------');
    console.log('  TOTAL      | ' + ' '.repeat(6 - String(totalTrades).length) + totalTrades + ' |      | ' + ' '.repeat(8 - totalPnlStr.length) + totalPnlStr + ' |      | ' + avgDurationAll.toFixed(1) + ' min');
  }

  console.log('\n' + '='.repeat(100));
}

main().catch(console.error);
