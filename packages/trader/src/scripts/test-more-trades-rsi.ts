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
console.log('  FINDING BALANCE: MORE TRADES + POSITIVE PF');
console.log('  Target: 200+ trades, PF >= 1.3, DD <= 5%');
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
  console.log('Config'.padEnd(55) + ' | Trades | Win%  | Net PnL | PF   | DD% | $/Trade');
  console.log('-'.repeat(100));

  // Test configs with more trades potential
  const configs = [
    // RSI 20/80 con diferentes R:R
    { rsiL: 20, rsiS: 80, tp: 0.3, sl: 0.3, cd: 5 },   // 1:1
    { rsiL: 20, rsiS: 80, tp: 0.4, sl: 0.3, cd: 5 },   // 1.3:1
    { rsiL: 20, rsiS: 80, tp: 0.5, sl: 0.3, cd: 5 },   // 1.7:1
    { rsiL: 20, rsiS: 80, tp: 0.5, sl: 0.25, cd: 5 },  // 2:1
    { rsiL: 20, rsiS: 80, tp: 0.6, sl: 0.25, cd: 5 },  // 2.4:1
    { rsiL: 20, rsiS: 80, tp: 0.6, sl: 0.2, cd: 5 },   // 3:1

    // RSI 22/78 (más trades)
    { rsiL: 22, rsiS: 78, tp: 0.4, sl: 0.2, cd: 5 },
    { rsiL: 22, rsiS: 78, tp: 0.5, sl: 0.25, cd: 5 },
    { rsiL: 22, rsiS: 78, tp: 0.6, sl: 0.2, cd: 5 },

    // RSI 25/75 (muchos más trades)
    { rsiL: 25, rsiS: 75, tp: 0.3, sl: 0.15, cd: 3 },
    { rsiL: 25, rsiS: 75, tp: 0.4, sl: 0.2, cd: 3 },
    { rsiL: 25, rsiS: 75, tp: 0.5, sl: 0.25, cd: 3 },
    { rsiL: 25, rsiS: 75, tp: 0.6, sl: 0.2, cd: 3 },

    // RSI 18/82 con bajo cooldown
    { rsiL: 18, rsiS: 82, tp: 0.3, sl: 0.15, cd: 3 },
    { rsiL: 18, rsiS: 82, tp: 0.4, sl: 0.2, cd: 3 },
    { rsiL: 18, rsiS: 82, tp: 0.5, sl: 0.25, cd: 3 },
    { rsiL: 18, rsiS: 82, tp: 0.6, sl: 0.2, cd: 3 },

    // RSI 17/83 sin cooldown
    { rsiL: 17, rsiS: 83, tp: 0.3, sl: 0.15, cd: 1 },
    { rsiL: 17, rsiS: 83, tp: 0.4, sl: 0.2, cd: 1 },
    { rsiL: 17, rsiS: 83, tp: 0.5, sl: 0.25, cd: 1 },

    // RSI 15/85 con bajo cooldown (más trades que antes)
    { rsiL: 15, rsiS: 85, tp: 0.3, sl: 0.15, cd: 5 },
    { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 5 },
    { rsiL: 15, rsiS: 85, tp: 0.3, sl: 0.15, cd: 3 },
    { rsiL: 15, rsiS: 85, tp: 0.4, sl: 0.2, cd: 3 },
  ];

  const results: Array<{ name: string; trades: number; pf: number; netPnl: number; dd: number }> = [];

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

      // Highlight good configs
      let marker = '';
      if (m.totalTrades >= 200 && pfVal >= 1.3 && m.maxDrawdownPct <= 5) {
        marker = ' ★★★';
      } else if (m.totalTrades >= 150 && pfVal >= 1.2) {
        marker = ' ★★';
      } else if (pfVal >= 1.5) {
        marker = ' ★';
      }

      console.log(
        name.padEnd(55) + ' | ' +
        String(m.totalTrades).padStart(6) + ' | ' +
        m.winRate.toFixed(1).padStart(5) + '% | ' +
        ('$' + m.netPnl.toFixed(0)).padStart(7) + ' | ' +
        pfVal.toFixed(2).padStart(5) + ' | ' +
        m.maxDrawdownPct.toFixed(1).padStart(4) + '% | ' +
        ('$' + avgTrade.toFixed(2)).padStart(7) +
        marker
      );

      results.push({ name, trades: m.totalTrades, pf: pfVal, netPnl: m.netPnl, dd: m.maxDrawdownPct });
    } catch (e: any) {
      console.log(name.padEnd(55) + ' | Error');
    }
  }

  // Print best configs
  console.log('\n--- BEST BALANCED CONFIGS (trades >= 150, PF >= 1.2) ---');
  const balanced = results
    .filter(r => r.trades >= 150 && r.pf >= 1.2)
    .sort((a, b) => (b.pf * Math.log10(b.trades)) - (a.pf * Math.log10(a.trades)));

  for (const r of balanced.slice(0, 5)) {
    console.log(`  ${r.name} => ${r.trades} trades, PF ${r.pf.toFixed(2)}, $${r.netPnl.toFixed(0)}`);
  }
}

console.log('\n\n★ = PF >= 1.5');
console.log('★★ = 150+ trades, PF >= 1.2');
console.log('★★★ = 200+ trades, PF >= 1.3, DD <= 5%');
console.log('\nDone!');
