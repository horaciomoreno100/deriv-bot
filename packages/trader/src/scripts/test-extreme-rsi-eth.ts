import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { RSIScalpBacktestStrategy } from '../backtest/strategies/rsi-scalp-backtest.strategy.js';
import type { RSIScalpParams } from '../strategies/rsi-scalp.types.js';

const ASSET = 'cryETHUSD';
const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.02;
const MULTIPLIER = 50;

const dataDir = path.join(process.cwd(), 'data');
const candles = loadCandlesFromCSV(path.join(dataDir, 'cryETHUSD_1m_90d.csv'), {
  asset: ASSET,
  timeframe: 60,
  timestampColumn: 'timestamp',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  timestampFormat: 'unix_ms',
});

console.log(`ETH - Loaded ${candles.length} candles\n`);

// Focus on the best configs from BTC
const configs = [
  { rsiL: 15, rsiS: 85, tp: 0.8, sl: 0.6, cd: 5, name: 'RSI 15/85, TP 0.8% SL 0.6%' },
  { rsiL: 15, rsiS: 85, tp: 1.0, sl: 0.7, cd: 5, name: 'RSI 15/85, TP 1.0% SL 0.7%' },
  { rsiL: 15, rsiS: 85, tp: 1.2, sl: 0.8, cd: 5, name: 'RSI 15/85, TP 1.2% SL 0.8%' },
  { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 15, name: 'RSI 15/85, TP 0.4% SL 0.2%' },
  { rsiL: 18, rsiS: 82, tp: 0.5, sl: 0.3, cd: 8, name: 'RSI 18/82, TP 0.5% SL 0.3%' },
  { rsiL: 18, rsiS: 82, tp: 0.6, sl: 0.4, cd: 8, name: 'RSI 18/82, TP 0.6% SL 0.4%' },
  { rsiL: 18, rsiS: 82, tp: 0.8, sl: 0.5, cd: 8, name: 'RSI 18/82, TP 0.8% SL 0.5%' },
  { rsiL: 12, rsiS: 88, tp: 1.0, sl: 0.5, cd: 10, name: 'RSI 12/88, TP 1.0% SL 0.5%' },
  { rsiL: 12, rsiS: 88, tp: 1.5, sl: 0.8, cd: 10, name: 'RSI 12/88, TP 1.5% SL 0.8%' },
  { rsiL: 10, rsiS: 90, tp: 2.0, sl: 1.0, cd: 15, name: 'RSI 10/90, TP 2.0% SL 1.0%' },
];

console.log('ETH RSI Scalp Edge Analysis\n');
console.log('Config'.padEnd(50) + ' | Trades | Win%  | Net PnL | PF   | DD%');
console.log('-'.repeat(95));

for (const cfg of configs) {
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
    console.log(
      cfg.name.padEnd(50) + ' | ' +
      String(m.totalTrades).padStart(6) + ' | ' +
      m.winRate.toFixed(1).padStart(5) + '% | ' +
      ('$' + m.netPnl.toFixed(0)).padStart(7) + ' | ' +
      m.profitFactor.toFixed(2).padStart(4) + ' | ' +
      m.maxDrawdownPct.toFixed(1).padStart(4) + '%'
    );
  } catch (e: any) {
    console.log(cfg.name.padEnd(50) + ' | Error');
  }
}
