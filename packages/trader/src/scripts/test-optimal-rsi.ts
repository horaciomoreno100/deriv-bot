import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { RSIScalpBacktestStrategy } from '../backtest/strategies/rsi-scalp-backtest.strategy.js';
import type { RSIScalpParams } from '../strategies/rsi-scalp.types.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03; // 3% stake
const MULTIPLIER = 100; // Higher leverage

const dataDir = path.join(process.cwd(), 'data');

// Test both assets
const assets = ['cryBTCUSD', 'cryETHUSD'];

console.log('='.repeat(100));
console.log('  OPTIMAL RSI SCALP CONFIGURATIONS (High PF Focus)');
console.log('='.repeat(100));

for (const ASSET of assets) {
  const candles = loadCandlesFromCSV(path.join(dataDir, ASSET + '_1m_90d.csv'), {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    openColumn: 'open',
    highColumn: 'high',
    lowColumn: 'low',
    closeColumn: 'close',
    timestampFormat: 'unix_ms',
  });

  console.log('\n\n' + ASSET + ' - ' + candles.length + ' candles');
  console.log('-'.repeat(100));
  console.log('Config'.padEnd(55) + ' | Trades | Win%  | Net PnL | PF   | DD% | Avg/Trade');
  console.log('-'.repeat(100));

  // Grid search around the best config
  const configs = [
    // Variations of the winning config
    { rsiL: 15, rsiS: 85, tp: 0.3, sl: 0.15, cd: 15 },
    { rsiL: 15, rsiS: 85, tp: 0.35, sl: 0.18, cd: 15 },
    { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 15 },
    { rsiL: 15, rsiS: 85, tp: 0.45, sl: 0.22, cd: 15 },
    { rsiL: 15, rsiS: 85, tp: 0.5, sl: 0.25, cd: 15 },
    // Different cooldowns
    { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 10 },
    { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 20 },
    { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 5 },
    // Slightly less extreme RSI
    { rsiL: 17, rsiS: 83, tp: 0.4, sl: 0.2, cd: 15 },
    { rsiL: 18, rsiS: 82, tp: 0.4, sl: 0.2, cd: 15 },
    { rsiL: 20, rsiS: 80, tp: 0.4, sl: 0.2, cd: 15 },
    // More extreme RSI
    { rsiL: 12, rsiS: 88, tp: 0.4, sl: 0.2, cd: 15 },
    { rsiL: 10, rsiS: 90, tp: 0.5, sl: 0.25, cd: 20 },
    // Different R:R ratios
    { rsiL: 15, rsiS: 85, tp: 0.6, sl: 0.2, cd: 15 }, // 3:1
    { rsiL: 15, rsiS: 85, tp: 0.8, sl: 0.2, cd: 15 }, // 4:1
    { rsiL: 12, rsiS: 88, tp: 0.6, sl: 0.2, cd: 20 }, // 3:1 extreme
  ];

  for (const cfg of configs) {
    const name = 'RSI ' + cfg.rsiL + '/' + cfg.rsiS + ', TP ' + cfg.tp + '% SL ' + cfg.sl + '%, CD ' + cfg.cd;
    const params: Partial<RSIScalpParams> = {
      entryLevels: {
        long: [{ rsiThreshold: cfg.rsiL, sizePercent: 100, enabled: true }],
        short: [{ rsiThreshold: cfg.rsiS, sizePercent: 100, enabled: true }],
      },
      takeProfitLevels: [
        { profitPercent: cfg.tp, rsiThreshold: 50, exitPercent: 100 },
      ],
      stopLossPercent: cfg.sl,
      cooldownBars: cfg.cd,
      useTrendFilter: false,
    };

    const strategy = new RSIScalpBacktestStrategy(ASSET, params);

    try {
      const result = runBacktest(strategy, candles, {
        asset: ASSET,
        timeframe: 60,
        initialBalance: INITIAL_CAPITAL,
        multiplier: MULTIPLIER,
        stakeAmount: INITIAL_CAPITAL * STAKE_PCT,
        takeProfitPct: cfg.tp / 100,
        stopLossPct: cfg.sl / 100,
      });

      const m = result.metrics;
      const avgTrade = m.totalTrades > 0 ? m.netPnl / m.totalTrades : 0;
      const pfVal = m.profitFactor;
      const pfStr = pfVal >= 1.5 ? pfVal.toFixed(2) + '*' : pfVal.toFixed(2);

      console.log(
        name.padEnd(55) + ' | ' +
        String(m.totalTrades).padStart(6) + ' | ' +
        m.winRate.toFixed(1).padStart(5) + '% | ' +
        ('$' + m.netPnl.toFixed(0)).padStart(7) + ' | ' +
        pfStr.padStart(5) + ' | ' +
        m.maxDrawdownPct.toFixed(1).padStart(4) + '% | ' +
        ('$' + avgTrade.toFixed(2)).padStart(8)
      );
    } catch (e: any) {
      console.log(name.padEnd(55) + ' | Error');
    }
  }
}

console.log('\n\n* = Profit Factor >= 1.5');
console.log('\nDone!');
