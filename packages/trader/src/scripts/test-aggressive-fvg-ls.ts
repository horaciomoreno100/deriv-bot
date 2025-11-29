/**
 * Test FVG-LS with AGGRESSIVE params for more trades
 */
import {
  loadCandlesFromCSV,
  runBacktest,
} from '../backtest/index.js';
import { FVGLiquiditySweepBacktestStrategy } from '../backtest/strategies/fvg-liquidity-sweep-backtest.strategy.js';

// Parámetros AGRESIVOS para scalping
const aggressiveParams = {
  swingLength: 3,              // Swings más rápidos
  liquidityRangePct: 0.02,     // 2% rango = más zonas
  minSwingsForZone: 2,
  requireCloseBack: false,     // NO requiere close back = más sweeps
  maxBarsAfterSweep: 30,
  minFVGSizePct: 0.0003,       // FVGs más pequeños
  fvgSearchBars: 15,
  maxBarsForEntry: 20,
  maxZoneAgeBars: 300,
  takeProfitRR: 1.0,           // 1:1 R:R
  stopLossBufferPct: 0.0015,
  cooldownSeconds: 30,         // 30s cooldown
  minConfidence: 0.6,
  entryZone: 'midpoint' as const,
  dynamicCooldownEnabled: false,
};

const asset = process.env.ASSET ?? 'R_75';
const days = process.env.DAYS ?? '90';

const candles = loadCandlesFromCSV(`./data/${asset}_1m_${days}d.csv`, {
  asset,
  timeframe: 60,
});

console.log('Asset:', asset);
console.log('Candles:', candles.length);

// Crear estrategia con params agresivos
const strategy = new FVGLiquiditySweepBacktestStrategy(asset, aggressiveParams);

const result = runBacktest(strategy, candles, {
  asset,
  timeframe: 60,
  initialBalance: 1000,
  stakeMode: 'percentage',
  stakePct: 0.02,
  multiplier: 100,
}, {
  runMonteCarlo: false,
  runOOS: false,
});

console.log('\n=== RESULTADO AGRESIVO ===');
console.log('Trades:', result.metrics.totalTrades);
console.log('Wins:', result.metrics.wins);
console.log('Losses:', result.metrics.losses);
console.log('Win Rate:', result.metrics.winRate.toFixed(1) + '%');
console.log('Net P&L:', '$' + result.metrics.netPnl.toFixed(2));
console.log('Profit Factor:', result.metrics.profitFactor.toFixed(2));
console.log('Max DD:', result.metrics.maxDrawdownPct.toFixed(1) + '%');
console.log('Expectancy:', '$' + result.metrics.expectancy.toFixed(2));
