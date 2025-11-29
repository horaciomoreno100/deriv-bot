import * as path from 'path';
import { loadCandlesFromCSV, runBacktest } from '../backtest/index.js';
import { RSIScalpBacktestStrategy } from '../backtest/strategies/rsi-scalp-backtest.strategy.js';
import type { RSIScalpParams } from '../strategies/rsi-scalp.types.js';

const ASSET = 'cryBTCUSD';
const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.02;
const MULTIPLIER = 50;

const dataDir = path.join(process.cwd(), 'data');
const candles = loadCandlesFromCSV(path.join(dataDir, 'cryBTCUSD_1m_90d.csv'), {
  asset: ASSET,
  timeframe: 60,
  timestampColumn: 'timestamp',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  timestampFormat: 'unix_ms',
});

console.log(`Loaded ${candles.length} candles\n`);

const configs = [
  // Very extreme RSI with favorable R:R
  { rsiL: 15, rsiS: 85, tp: 0.8, sl: 0.6, cd: 5, name: 'Ultra extreme RSI 15/85, TP 0.8% SL 0.6%' },
  { rsiL: 18, rsiS: 82, tp: 0.7, sl: 0.5, cd: 5, name: 'Extreme RSI 18/82, TP 0.7% SL 0.5%' },
  { rsiL: 20, rsiS: 80, tp: 1.0, sl: 0.5, cd: 8, name: 'RSI 20/80, TP 1% SL 0.5% (2:1 R:R)' },
  { rsiL: 20, rsiS: 80, tp: 0.8, sl: 0.4, cd: 8, name: 'RSI 20/80, TP 0.8% SL 0.4% (2:1 R:R)' },
  { rsiL: 22, rsiS: 78, tp: 0.6, sl: 0.3, cd: 10, name: 'RSI 22/78, TP 0.6% SL 0.3% (2:1 R:R)' },
  // More selective with tighter SL
  { rsiL: 18, rsiS: 82, tp: 0.5, sl: 0.25, cd: 10, name: 'RSI 18/82, TP 0.5% SL 0.25% (2:1 R:R) - Tight' },
  { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 15, name: 'RSI 15/85, TP 0.4% SL 0.2% (2:1 R:R) - Very tight' },
  // Test wider SL with quick TP
  { rsiL: 20, rsiS: 80, tp: 0.3, sl: 0.8, cd: 5, name: 'RSI 20/80, Quick TP 0.3% SL 0.8%' },
  { rsiL: 18, rsiS: 82, tp: 0.25, sl: 0.5, cd: 3, name: 'RSI 18/82, Quick scalp TP 0.25% SL 0.5%' },
  // High win-rate setups
  { rsiL: 25, rsiS: 75, tp: 0.3, sl: 1.0, cd: 3, name: 'RSI 25/75, Tiny TP 0.3% Wide SL 1%' },
  { rsiL: 20, rsiS: 80, tp: 0.2, sl: 0.8, cd: 2, name: 'RSI 20/80, Micro TP 0.2% Wide SL 0.8%' },
];

console.log('RSI Scalp Edge Analysis\n');
console.log('Config'.padEnd(60) + ' | Trades | Win%  | Net PnL | PF   | DD%');
console.log('-'.repeat(100));

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
    useTrendFilter: false, // Disable EMA filter to get more signals
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
      cfg.name.padEnd(60) + ' | ' +
      String(m.totalTrades).padStart(6) + ' | ' +
      m.winRate.toFixed(1).padStart(5) + '% | ' +
      ('$' + m.netPnl.toFixed(0)).padStart(7) + ' | ' +
      m.profitFactor.toFixed(2).padStart(4) + ' | ' +
      m.maxDrawdownPct.toFixed(1).padStart(4) + '%'
    );
  } catch (e: any) {
    console.log(cfg.name.padEnd(60) + ' | Error: ' + e.message);
  }
}
