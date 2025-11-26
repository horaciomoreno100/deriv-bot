/**
 * BB Squeeze Mean Reversion - A/B Testing de Mejoras Individuales
 *
 * Prueba cada mejora de forma aislada para ver cuál agrega valor real.
 * Usa el motor de backtest testeado y sólido.
 *
 * Usage: ASSET="R_100" DAYS="90" npx tsx src/scripts/backtest-mr-improvements.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  executeTrade,
  calculateMetrics,
  createTradeEntry,
  type Candle,
  type Trade,
  type BacktestConfig,
  type BacktestMetrics,
} from '../backtest/backtest-engine';

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';

const baseConfig: BacktestConfig = {
  initialBalance: 1000,
  stakeAmount: 20,              // Fixed $20 per trade (no compound!)
  multiplier: 200,
  takeProfitPct: 0.005,         // 0.5%
  stopLossPct: 0.005,           // 0.5%
  maxBarsInTrade: 50,
  cooldownBars: 5,
};

const indicatorParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 1.5,
  rsiPeriod: 7,
  rsiCallMax: 45,    // CALL when RSI < 45 (oversold)
  rsiPutMin: 55,     // PUT when RSI > 55 (overbought)
  trendPeriod: 20,
};

// =============================================================================
// INDICATORS
// =============================================================================

function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateStdDev(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  return Math.sqrt(slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period);
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return NaN;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (!prev || !curr) continue;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + (gains / period) / (losses / period)));
}

function getBBandKC(closes: number[], candles: Candle[]) {
  const sma = calculateSMA(closes, indicatorParams.bbPeriod);
  const std = calculateStdDev(closes, indicatorParams.bbPeriod);
  const bbUpper = sma + (std * indicatorParams.bbStdDev);
  const bbLower = sma - (std * indicatorParams.bbStdDev);

  const ema = calculateSMA(closes, indicatorParams.kcPeriod);
  const atr = calculateATR(candles, indicatorParams.kcPeriod);
  const kcUpper = ema + (atr * indicatorParams.kcMultiplier);
  const kcLower = ema - (atr * indicatorParams.kcMultiplier);

  return { bbUpper, bbLower, kcUpper, kcLower, sma, atr };
}

function getTrend(closes: number[], period: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (closes.length < period + 10) return 'NEUTRAL';
  const currentSMA = calculateSMA(closes, period);
  const prevSMA = calculateSMA(closes.slice(0, -5), period);
  const currentPrice = closes[closes.length - 1];
  const smaSlope = (currentSMA - prevSMA) / prevSMA;

  if (currentPrice > currentSMA && smaSlope > 0.0005) return 'BULLISH';
  if (currentPrice < currentSMA && smaSlope < -0.0005) return 'BEARISH';
  return 'NEUTRAL';
}

// =============================================================================
// DATA LOADING
// =============================================================================

function loadCandles(asset: string, timeframe: string, days: string): Candle[] | null {
  const paths = [
    join(process.cwd(), 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
    join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`),
  ];

  for (const csvPath of paths) {
    if (!existsSync(csvPath)) continue;

    const content = readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n').slice(1);

    const candles = lines.map(line => {
      const [timestamp, open, high, low, close] = line.split(',');
      const ts = parseInt(timestamp);
      return {
        timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
      };
    }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close));

    candles.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`   ✅ Loaded ${candles.length} candles from ${csvPath.split('/').pop()}`);
    return candles;
  }

  return null;
}

function getHTFCandlesUpTo(htfCandles: Candle[], timestamp: number, count: number): Candle[] {
  const result: Candle[] = [];
  for (let i = htfCandles.length - 1; i >= 0 && result.length < count; i--) {
    if (htfCandles[i].timestamp <= timestamp) {
      result.unshift(htfCandles[i]);
    }
  }
  return result;
}

// =============================================================================
// STRATEGY VARIANTS
// =============================================================================

interface StrategyConfig {
  name: string;
  description: string;
  usePostBreakoutConfirm: boolean;
  confirmBars: number;
  useMTFFilter: boolean;
  useTrailingStop: boolean;
  trailingActivationPct: number;
  trailingDistancePct: number;
}

const strategyVariants: StrategyConfig[] = [
  {
    name: 'BASELINE',
    description: 'Mean Reversion simple (sin mejoras)',
    usePostBreakoutConfirm: false,
    confirmBars: 0,
    useMTFFilter: false,
    useTrailingStop: false,
    trailingActivationPct: 0,
    trailingDistancePct: 0,
  },
  {
    name: 'POST_CONFIRM_1',
    description: '+ Confirmación 1 candle después',
    usePostBreakoutConfirm: true,
    confirmBars: 1,
    useMTFFilter: false,
    useTrailingStop: false,
    trailingActivationPct: 0,
    trailingDistancePct: 0,
  },
  {
    name: 'POST_CONFIRM_2',
    description: '+ Confirmación 2 candles después',
    usePostBreakoutConfirm: true,
    confirmBars: 2,
    useMTFFilter: false,
    useTrailingStop: false,
    trailingActivationPct: 0,
    trailingDistancePct: 0,
  },
  {
    name: 'MTF_FILTER',
    description: '+ Filtro tendencia 15m (no contra-trend)',
    usePostBreakoutConfirm: false,
    confirmBars: 0,
    useMTFFilter: true,
    useTrailingStop: false,
    trailingActivationPct: 0,
    trailingDistancePct: 0,
  },
  {
    name: 'TRAILING_50',
    description: '+ Trailing Stop (activa al 50% del TP)',
    usePostBreakoutConfirm: false,
    confirmBars: 0,
    useMTFFilter: false,
    useTrailingStop: true,
    trailingActivationPct: baseConfig.takeProfitPct * 0.5,
    trailingDistancePct: 0.002,
  },
  {
    name: 'TRAILING_30',
    description: '+ Trailing Stop (activa al 30% del TP)',
    usePostBreakoutConfirm: false,
    confirmBars: 0,
    useMTFFilter: false,
    useTrailingStop: true,
    trailingActivationPct: baseConfig.takeProfitPct * 0.3,
    trailingDistancePct: 0.002,
  },
];

// =============================================================================
// BACKTEST RUNNER
// =============================================================================

function runBacktest(
  strategy: StrategyConfig,
  candles1m: Candle[],
  candles15m?: Candle[]
): { trades: Trade[]; metrics: BacktestMetrics } {
  const trades: Trade[] = [];
  const closes1m = candles1m.map(c => c.close);

  let inSqueeze = false;
  let squeezeEndBar = -1;
  let lastTradeBar = -Infinity;

  const minBars = 30;

  // Build config with trailing stop settings
  const config: BacktestConfig = {
    ...baseConfig,
    useTrailingStop: strategy.useTrailingStop,
    trailingActivationPct: strategy.trailingActivationPct,
    trailingDistancePct: strategy.trailingDistancePct,
  };

  for (let i = minBars; i < candles1m.length - 50; i++) {
    if (i - lastTradeBar < baseConfig.cooldownBars) continue;

    const candle = candles1m[i];
    const timestamp = candle.timestamp;
    const closeSlice = closes1m.slice(0, i + 1);
    const candleSlice = candles1m.slice(0, i + 1);

    // Calculate indicators
    const ind = getBBandKC(closeSlice, candleSlice);
    const rsi = calculateRSI(closeSlice, indicatorParams.rsiPeriod);

    if (isNaN(ind.bbUpper) || isNaN(ind.kcUpper) || isNaN(rsi)) continue;

    // Detect squeeze
    const currentSqueeze = ind.bbUpper < ind.kcUpper && ind.bbLower > ind.kcLower;
    if (currentSqueeze && !inSqueeze) inSqueeze = true;
    else if (!currentSqueeze && inSqueeze) {
      inSqueeze = false;
      squeezeEndBar = i;
    }

    if (squeezeEndBar < 0 || i - squeezeEndBar > 10) continue;

    const price = candle.close;
    let signal: 'CALL' | 'PUT' | null = null;

    // MEAN REVERSION SIGNAL LOGIC
    const breakoutBelow = price < ind.bbLower;
    const rsiOversold = rsi < indicatorParams.rsiCallMax;
    const breakoutAbove = price > ind.bbUpper;
    const rsiOverbought = rsi > indicatorParams.rsiPutMin;

    if (breakoutBelow && rsiOversold) {
      signal = 'CALL';
    } else if (breakoutAbove && rsiOverbought) {
      signal = 'PUT';
    }

    if (!signal) continue;

    // FILTER 1: Post-Breakout Confirmation
    if (strategy.usePostBreakoutConfirm) {
      let confirmed = false;
      for (let c = 1; c <= strategy.confirmBars && i + c < candles1m.length; c++) {
        const confirmCandle = candles1m[i + c];
        if (signal === 'CALL' && confirmCandle.close > candle.close) {
          confirmed = true;
          break;
        }
        if (signal === 'PUT' && confirmCandle.close < candle.close) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed) continue;
    }

    // FILTER 2: Multi-Timeframe Trend
    if (strategy.useMTFFilter && candles15m) {
      const htf15mCandles = getHTFCandlesUpTo(candles15m, timestamp, indicatorParams.trendPeriod + 10);
      if (htf15mCandles.length >= indicatorParams.trendPeriod) {
        const closes15m = htf15mCandles.map(c => c.close);
        const trend15m = getTrend(closes15m, indicatorParams.trendPeriod);

        // Mean Reversion: Don't fight strong trends
        if (signal === 'CALL' && trend15m === 'BEARISH') continue;
        if (signal === 'PUT' && trend15m === 'BULLISH') continue;
      }
    }

    // EXECUTE TRADE using the tested engine
    const entry = createTradeEntry(timestamp, signal, price, config);
    const futureCandles = candles1m.slice(i + 1, i + 1 + baseConfig.maxBarsInTrade);
    const trade = executeTrade(entry, futureCandles, config);

    if (trade) {
      trades.push(trade);
      lastTradeBar = i;
    }
  }

  const metrics = calculateMetrics(trades, config);
  return { trades, metrics };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log(`📊 BB SQUEEZE MEAN REVERSION - A/B TESTING DE MEJORAS`);
  console.log('='.repeat(80));
  console.log(`\nAsset: ${ASSET} | Period: ${DAYS} days`);
  console.log(`Stake: $${baseConfig.stakeAmount} (fijo) | Multiplier: x${baseConfig.multiplier}`);
  console.log(`TP/SL: ${baseConfig.takeProfitPct * 100}% / ${baseConfig.stopLossPct * 100}%\n`);

  // Load data
  console.log('📥 Loading data...');
  const candles1m = loadCandles(ASSET, '1m', DAYS) || loadCandles(ASSET, '60s', DAYS);
  const candles15m = loadCandles(ASSET, '15m', DAYS);

  if (!candles1m) {
    console.log('❌ 1m data not found');
    process.exit(1);
  }

  // Run all tests
  console.log('\n🧪 Running A/B tests...\n');
  const results: Array<{ strategy: StrategyConfig; metrics: BacktestMetrics }> = [];

  for (const strategy of strategyVariants) {
    process.stdout.write(`   Testing ${strategy.name.padEnd(20)}...`);
    const { metrics } = runBacktest(strategy, candles1m, candles15m || undefined);
    results.push({ strategy, metrics });
    console.log(` ${metrics.totalTrades} trades | WR: ${metrics.winRate.toFixed(1)}% | Net: $${metrics.netPnl.toFixed(2)}`);
  }

  // Print results table
  console.log('\n' + '='.repeat(80));
  console.log('📈 RESULTADOS COMPARATIVOS');
  console.log('='.repeat(80));

  console.log('\n┌────────────────────┬────────┬─────────┬────────────┬─────────┬───────────┐');
  console.log('│ Configuración      │ Trades │ Win Rate│ Net Profit │ PF      │ Max DD    │');
  console.log('├────────────────────┼────────┼─────────┼────────────┼─────────┼───────────┤');

  const baseline = results[0].metrics;
  for (const { strategy, metrics } of results) {
    const pf = metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2);
    console.log(
      `│ ${strategy.name.padEnd(18)} │ ` +
      `${metrics.totalTrades.toString().padStart(6)} │ ` +
      `${metrics.winRate.toFixed(1).padStart(6)}% │ ` +
      `$${metrics.netPnl.toFixed(2).padStart(9)} │ ` +
      `${pf.padStart(7)} │ ` +
      `${metrics.maxDrawdownPct.toFixed(1).padStart(8)}% │`
    );
  }
  console.log('└────────────────────┴────────┴─────────┴────────────┴─────────┴───────────┘');

  // Analysis insights
  console.log('\n' + '='.repeat(80));
  console.log('🔍 ANÁLISIS DE MEJORAS vs BASELINE');
  console.log('='.repeat(80));

  console.log('\n┌────────────────────┬────────────┬─────────────┬──────────────────────────────┐');
  console.log('│ Mejora             │ ΔWin Rate  │ ΔNet Profit │ Insight                      │');
  console.log('├────────────────────┼────────────┼─────────────┼──────────────────────────────┤');

  for (let i = 1; i < results.length; i++) {
    const { strategy, metrics } = results[i];
    const wrDiff = metrics.winRate - baseline.winRate;
    const netDiff = metrics.netPnl - baseline.netPnl;
    const wrSign = wrDiff >= 0 ? '+' : '';
    const netSign = netDiff >= 0 ? '+' : '';

    let insight = '';
    if (netDiff > 100) insight = '✅ MEJORA SIGNIFICATIVA';
    else if (netDiff > 0) insight = '📈 Mejora leve';
    else if (netDiff > -100) insight = '➖ Sin cambio significativo';
    else insight = '❌ Empeora resultados';

    console.log(
      `│ ${strategy.name.padEnd(18)} │ ` +
      `${wrSign}${wrDiff.toFixed(1).padStart(9)}% │ ` +
      `${netSign}$${netDiff.toFixed(2).padStart(10)} │ ` +
      `${insight.padEnd(28)} │`
    );
  }
  console.log('└────────────────────┴────────────┴─────────────┴──────────────────────────────┘');

  // Loss analysis
  console.log('\n' + '='.repeat(80));
  console.log('📊 ANÁLISIS DE PÉRDIDAS');
  console.log('='.repeat(80));

  console.log('\n┌────────────────────┬────────────────┬───────────────────┐');
  console.log('│ Configuración      │ Near Misses    │ Immediate Reversals│');
  console.log('│                    │ (>50% del TP)  │ (≤3 bars)         │');
  console.log('├────────────────────┼────────────────┼───────────────────┤');

  for (const { strategy, metrics } of results) {
    const nearMissPct = metrics.losses > 0 ? (metrics.nearMisses / metrics.losses * 100).toFixed(1) : '0.0';
    const immRevPct = metrics.losses > 0 ? (metrics.immediateReversals / metrics.losses * 100).toFixed(1) : '0.0';
    console.log(
      `│ ${strategy.name.padEnd(18)} │ ` +
      `${metrics.nearMisses.toString().padStart(5)} (${nearMissPct.padStart(5)}%) │ ` +
      `${metrics.immediateReversals.toString().padStart(6)} (${immRevPct.padStart(5)}%)  │`
    );
  }
  console.log('└────────────────────┴────────────────┴───────────────────┘');

  // Winner determination
  console.log('\n' + '='.repeat(80));
  const best = results.reduce((a, b) => a.metrics.netPnl > b.metrics.netPnl ? a : b);
  const bestByWR = results.reduce((a, b) => a.metrics.winRate > b.metrics.winRate ? a : b);
  const bestByPF = results.reduce((a, b) => {
    const aPF = a.metrics.profitFactor === Infinity ? 999 : a.metrics.profitFactor;
    const bPF = b.metrics.profitFactor === Infinity ? 999 : b.metrics.profitFactor;
    return aPF > bPF ? a : b;
  });

  console.log(`🏆 MEJOR POR PROFIT:      ${best.strategy.name} ($${best.metrics.netPnl.toFixed(2)})`);
  console.log(`🏆 MEJOR POR WIN RATE:    ${bestByWR.strategy.name} (${bestByWR.metrics.winRate.toFixed(1)}%)`);
  const pfStr = bestByPF.metrics.profitFactor === Infinity ? '∞' : bestByPF.metrics.profitFactor.toFixed(2);
  console.log(`🏆 MEJOR POR PROFIT FACTOR: ${bestByPF.strategy.name} (${pfStr})`);
  console.log('='.repeat(80));

  // Detailed stats
  console.log('\n📊 MÉTRICAS ADICIONALES:');
  console.log('┌────────────────────┬─────────────┬───────────┬───────────┬───────────┐');
  console.log('│ Configuración      │ Expectancy  │ SQN       │ Avg Bars  │ ConsecL   │');
  console.log('├────────────────────┼─────────────┼───────────┼───────────┼───────────┤');
  for (const { strategy, metrics } of results) {
    console.log(
      `│ ${strategy.name.padEnd(18)} │ ` +
      `$${metrics.expectancy.toFixed(2).padStart(10)} │ ` +
      `${metrics.sqn.toFixed(2).padStart(9)} │ ` +
      `${metrics.avgBarsHeld.toFixed(1).padStart(9)} │ ` +
      `${metrics.maxConsecutiveLosses.toString().padStart(9)} │`
    );
  }
  console.log('└────────────────────┴─────────────┴───────────┴───────────┴───────────┘');
}

main().catch(console.error);
