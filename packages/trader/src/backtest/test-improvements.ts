/**
 * Test Improvements - BB Squeeze Strategy
 *
 * Prueba mejoras UNA POR UNA para medir impacto real:
 * 1. Trailing Stop
 * 2. Evitar Sábados
 * 3. Confirmación Post-Breakout
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ATR, RSI } from 'technicalindicators';

// Config
const BACKTEST_DIR = './backtest-data';
const SYMBOL = process.env.SYMBOL || 'R_75';
const BACKTEST_DAYS = parseInt(process.env.BACKTEST_DAYS || '30', 10);

// Test mode from env
const TEST_MODE = process.env.TEST_MODE || 'baseline';
// baseline | trailing_stop | no_saturday | confirmation | all_combined

// Strategy Parameters (R_75 optimized)
const PARAMS = {
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcMultiplier: 2.0,
  rsiPeriod: 14,
  takeProfitPct: 0.004, // 0.4%
  stopLossPct: 0.002,   // 0.2%
  minCandles: 50,

  // Trailing Stop params - VERY CONSERVATIVE
  trailingActivationPct: 0.6,  // Activate at 60% of TP
  trailingDistancePct: 0.002,  // 0.2% trailing distance (same as SL)

  // Confirmation params
  confirmationBars: 2,  // Wait 2 bars after breakout
};

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradeResult {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  profit: number;
  exitReason: string;
  dayOfWeek: number;
  barsHeld: number;
  bestPricePct: number;
}

function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emaArray.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }
  return emaArray;
}

function calculateIndicators(candles: Candle[], index: number) {
  if (index < PARAMS.minCandles) return { bb: null, kc: null, rsi: null };

  const window = candles.slice(Math.max(0, index - PARAMS.bbPeriod - 10), index + 1);
  const closes = window.map(c => c.close);
  const highs = window.map(c => c.high);
  const lows = window.map(c => c.low);

  const bbResult = BollingerBands.calculate({
    period: PARAMS.bbPeriod,
    values: closes,
    stdDev: PARAMS.bbStdDev,
  });

  const ema = calculateEMA(closes, PARAMS.kcPeriod);
  const atrValues = ATR.calculate({
    high: highs, low: lows, close: closes,
    period: PARAMS.kcPeriod,
  });

  const rsiValues = RSI.calculate({
    period: PARAMS.rsiPeriod,
    values: closes,
  });

  if (!bbResult?.length || !atrValues?.length || !rsiValues?.length) {
    return { bb: null, kc: null, rsi: null };
  }

  const bb = bbResult[bbResult.length - 1];
  const atr = atrValues[atrValues.length - 1];
  const kcMiddle = ema[ema.length - 1];

  return {
    bb: bb ? { upper: bb.upper, middle: bb.middle, lower: bb.lower } : null,
    kc: atr ? {
      upper: kcMiddle + atr * PARAMS.kcMultiplier,
      middle: kcMiddle,
      lower: kcMiddle - atr * PARAMS.kcMultiplier,
    } : null,
    rsi: rsiValues[rsiValues.length - 1] || null,
  };
}

function getSqueezeInfo(candles: Candle[], currentIndex: number): { hadSqueeze: boolean; duration: number } {
  if (currentIndex < 10) return { hadSqueeze: false, duration: 0 };

  let squeezeDuration = 0;
  let foundSqueeze = false;

  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 20); i--) {
    const indicators = calculateIndicators(candles, i);
    if (indicators.bb && indicators.kc) {
      const inSqueeze = indicators.bb.upper < indicators.kc.upper &&
                       indicators.bb.lower > indicators.kc.lower;
      if (inSqueeze) {
        squeezeDuration++;
        foundSqueeze = true;
      } else if (foundSqueeze) {
        break;
      }
    }
  }

  return { hadSqueeze: foundSqueeze, duration: squeezeDuration };
}

/**
 * Simulate trade with optional improvements
 */
function simulateTrade(
  candles: Candle[],
  entryIndex: number,
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  useTrailingStop: boolean
): TradeResult | null {
  const entryCandle = candles[entryIndex];
  const entryDate = new Date(entryCandle.timestamp);
  const dayOfWeek = entryDate.getUTCDay();

  const tpPrice = direction === 'LONG'
    ? entryPrice * (1 + PARAMS.takeProfitPct)
    : entryPrice * (1 - PARAMS.takeProfitPct);

  let slPrice = direction === 'LONG'
    ? entryPrice * (1 - PARAMS.stopLossPct)
    : entryPrice * (1 + PARAMS.stopLossPct);

  let bestPrice = entryPrice;
  let trailingActivated = false;

  for (let i = entryIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    const barsHeld = i - entryIndex;

    if (direction === 'LONG') {
      bestPrice = Math.max(bestPrice, candle.high);

      // Break-Even Stop Logic (simpler - move SL to entry at 50% of TP)
      if (useTrailingStop && !trailingActivated) {
        const currentGainPct = (bestPrice - entryPrice) / (tpPrice - entryPrice);
        if (currentGainPct >= PARAMS.trailingActivationPct) {
          trailingActivated = true;
          // Move SL to break-even (entry price)
          slPrice = entryPrice;
        }
      }

      // NO trailing after activation - just break-even protection

      // Check TP
      if (candle.high >= tpPrice) {
        const bestPricePct = ((bestPrice - entryPrice) / (tpPrice - entryPrice)) * 100;
        return {
          direction, entryPrice, exitPrice: tpPrice,
          profit: tpPrice - entryPrice,
          exitReason: 'TP', dayOfWeek, barsHeld, bestPricePct
        };
      }

      // Check SL
      if (candle.low <= slPrice) {
        const bestPricePct = ((bestPrice - entryPrice) / (tpPrice - entryPrice)) * 100;
        return {
          direction, entryPrice, exitPrice: slPrice,
          profit: slPrice - entryPrice,
          exitReason: trailingActivated ? 'BREAK_EVEN' : 'SL',
          dayOfWeek, barsHeld, bestPricePct: Math.max(0, bestPricePct)
        };
      }
    } else {
      // SHORT
      bestPrice = Math.min(bestPrice, candle.low);

      // Break-Even Stop Logic (simpler - move SL to entry at 60% of TP)
      if (useTrailingStop && !trailingActivated) {
        const currentGainPct = (entryPrice - bestPrice) / (entryPrice - tpPrice);
        if (currentGainPct >= PARAMS.trailingActivationPct) {
          trailingActivated = true;
          // Move SL to break-even (entry price)
          slPrice = entryPrice;
        }
      }

      // NO trailing after activation - just break-even protection

      // Check TP
      if (candle.low <= tpPrice) {
        const bestPricePct = ((entryPrice - bestPrice) / (entryPrice - tpPrice)) * 100;
        return {
          direction, entryPrice, exitPrice: tpPrice,
          profit: entryPrice - tpPrice,
          exitReason: 'TP', dayOfWeek, barsHeld, bestPricePct
        };
      }

      // Check SL
      if (candle.high >= slPrice) {
        const bestPricePct = ((entryPrice - bestPrice) / (entryPrice - tpPrice)) * 100;
        return {
          direction, entryPrice, exitPrice: slPrice,
          profit: entryPrice - slPrice,
          exitReason: trailingActivated ? 'BREAK_EVEN' : 'SL',
          dayOfWeek, barsHeld, bestPricePct: Math.max(0, bestPricePct)
        };
      }
    }
  }

  return null;
}

/**
 * Run backtest with specific improvements
 */
function runBacktest(
  candles: Candle[],
  options: {
    useTrailingStop: boolean;
    skipSaturday: boolean;
    useConfirmation: boolean;
  }
): TradeResult[] {
  const trades: TradeResult[] = [];
  let lastTradeIndex = -100;

  for (let i = PARAMS.minCandles; i < candles.length - 100; i++) {
    if (i - lastTradeIndex < 5) continue;

    const candle = candles[i];
    const indicators = calculateIndicators(candles, i);

    if (!indicators.bb || !indicators.kc || indicators.rsi === null) continue;

    const squeezeInfo = getSqueezeInfo(candles, i);
    if (!squeezeInfo.hadSqueeze) continue;

    // Skip Saturday if enabled
    if (options.skipSaturday) {
      const date = new Date(candle.timestamp);
      if (date.getUTCDay() === 6) continue; // Saturday = 6
    }

    const price = candle.close;
    const rsi = indicators.rsi;

    // LONG signal
    const breakoutAbove = price > indicators.bb.upper;
    const rsiBullish = rsi > 55;

    if (breakoutAbove && rsiBullish) {
      // Confirmation: wait N bars
      let entryIndex = i;
      if (options.useConfirmation) {
        entryIndex = i + PARAMS.confirmationBars;
        if (entryIndex >= candles.length - 10) continue;
        // Verify still above BB after confirmation
        const confirmCandle = candles[entryIndex];
        const confirmIndicators = calculateIndicators(candles, entryIndex);
        if (!confirmIndicators.bb || confirmCandle.close <= confirmIndicators.bb.upper) {
          continue; // Breakout failed
        }
      }

      const entryPrice = candles[entryIndex].close;
      const trade = simulateTrade(candles, entryIndex, 'LONG', entryPrice, options.useTrailingStop);
      if (trade) {
        trades.push(trade);
        lastTradeIndex = entryIndex;
        i = entryIndex + trade.barsHeld;
      }
      continue;
    }

    // SHORT signal
    const breakoutBelow = price < indicators.bb.lower;
    const rsiBearish = rsi < 45;

    if (breakoutBelow && rsiBearish) {
      let entryIndex = i;
      if (options.useConfirmation) {
        entryIndex = i + PARAMS.confirmationBars;
        if (entryIndex >= candles.length - 10) continue;
        const confirmCandle = candles[entryIndex];
        const confirmIndicators = calculateIndicators(candles, entryIndex);
        if (!confirmIndicators.bb || confirmCandle.close >= confirmIndicators.bb.lower) {
          continue;
        }
      }

      const entryPrice = candles[entryIndex].close;
      const trade = simulateTrade(candles, entryIndex, 'SHORT', entryPrice, options.useTrailingStop);
      if (trade) {
        trades.push(trade);
        lastTradeIndex = entryIndex;
        i = entryIndex + trade.barsHeld;
      }
    }
  }

  return trades;
}

function loadCandles(filepath: string): Candle[] {
  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.split('\n').filter(line => line.trim() !== '');
  return lines.slice(1).map(row => {
    const [timestamp, open, high, low, close] = row.split(',');
    return {
      timestamp: parseInt(timestamp, 10),
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
    };
  });
}

function analyzeResults(name: string, trades: TradeResult[]) {
  const wins = trades.filter(t => t.profit > 0);
  const losses = trades.filter(t => t.profit <= 0);

  const totalProfit = wins.reduce((s, t) => s + t.profit, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const netProfit = trades.reduce((s, t) => s + t.profit, 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

  // Count exit reasons
  const exitReasons: Record<string, number> = {};
  trades.forEach(t => {
    exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ${name}`);
  console.log('='.repeat(80));
  console.log(`   Total Trades:    ${trades.length}`);
  console.log(`   Wins:            ${wins.length} (${winRate.toFixed(1)}%)`);
  console.log(`   Losses:          ${losses.length}`);
  console.log(`   Net Profit:      $${netProfit.toFixed(2)}`);
  console.log(`   Profit Factor:   ${profitFactor.toFixed(2)}`);
  console.log(`   Avg Win:         $${wins.length > 0 ? (totalProfit / wins.length).toFixed(2) : '0.00'}`);
  console.log(`   Avg Loss:        $${losses.length > 0 ? (totalLoss / losses.length).toFixed(2) : '0.00'}`);
  console.log(`\n   Exit Reasons:`);
  Object.entries(exitReasons).forEach(([reason, count]) => {
    console.log(`      ${reason}: ${count} (${(count / trades.length * 100).toFixed(1)}%)`);
  });

  return { trades: trades.length, wins: wins.length, winRate, netProfit, profitFactor };
}

async function main() {
  const filepath = join(BACKTEST_DIR, `${SYMBOL}_60s_${BACKTEST_DAYS}d.csv`);

  if (!existsSync(filepath)) {
    console.error(`❌ Data file not found: ${filepath}`);
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('🧪 TESTING IMPROVEMENTS - BB SQUEEZE');
  console.log('='.repeat(80));
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Test Mode: ${TEST_MODE}`);

  const candles = loadCandles(filepath);
  console.log(`Loaded ${candles.length} candles\n`);

  const results: Record<string, any> = {};

  // 1. BASELINE (sin mejoras)
  console.log('\n🔵 Running BASELINE...');
  const baselineTrades = runBacktest(candles, {
    useTrailingStop: false,
    skipSaturday: false,
    useConfirmation: false,
  });
  results['baseline'] = analyzeResults('BASELINE (Sin Mejoras)', baselineTrades);

  if (TEST_MODE === 'baseline') {
    console.log('\n✅ Baseline complete');
    return;
  }

  // 2. TRAILING STOP
  if (TEST_MODE === 'trailing_stop' || TEST_MODE === 'all') {
    console.log('\n🟢 Running TRAILING STOP...');
    const trailingTrades = runBacktest(candles, {
      useTrailingStop: true,
      skipSaturday: false,
      useConfirmation: false,
    });
    results['trailing_stop'] = analyzeResults('BREAK-EVEN STOP (60% activation)', trailingTrades);
  }

  // 3. NO SATURDAY
  if (TEST_MODE === 'no_saturday' || TEST_MODE === 'all') {
    console.log('\n🟡 Running NO SATURDAY...');
    const noSatTrades = runBacktest(candles, {
      useTrailingStop: false,
      skipSaturday: true,
      useConfirmation: false,
    });
    results['no_saturday'] = analyzeResults('NO SATURDAY (Skip Saturday trades)', noSatTrades);
  }

  // 4. CONFIRMATION
  if (TEST_MODE === 'confirmation' || TEST_MODE === 'all') {
    console.log('\n🟠 Running CONFIRMATION...');
    const confirmTrades = runBacktest(candles, {
      useTrailingStop: false,
      skipSaturday: false,
      useConfirmation: true,
    });
    results['confirmation'] = analyzeResults('CONFIRMATION (Wait 2 bars)', confirmTrades);
  }

  // 5. BEST COMBO (no_saturday + break_even - sin confirmation que empeora)
  if (TEST_MODE === 'best_combo' || TEST_MODE === 'all') {
    console.log('\n🟣 Running BEST COMBO (No Saturday + Break-Even)...');
    const bestComboTrades = runBacktest(candles, {
      useTrailingStop: true,  // This is now break-even
      skipSaturday: true,
      useConfirmation: false, // Skip confirmation - it hurts performance
    });
    results['best_combo'] = analyzeResults('BEST COMBO (No Sat + Break-Even)', bestComboTrades);
  }

  // 6. ALL COMBINED (including confirmation for reference)
  if (TEST_MODE === 'all_combined' || TEST_MODE === 'all') {
    console.log('\n🔴 Running ALL COMBINED...');
    const allTrades = runBacktest(candles, {
      useTrailingStop: true,
      skipSaturday: true,
      useConfirmation: true,
    });
    results['all_combined'] = analyzeResults('ALL COMBINED', allTrades);
  }

  // COMPARISON TABLE
  if (Object.keys(results).length > 1) {
    console.log(`\n${'='.repeat(80)}`);
    console.log('📈 COMPARISON TABLE');
    console.log('='.repeat(80));
    console.log(`${'Strategy'.padEnd(35)} | Trades | Win Rate | Net Profit | PF`);
    console.log('-'.repeat(80));

    const baseline = results['baseline'];
    Object.entries(results).forEach(([name, r]) => {
      const winRateDiff = name === 'baseline' ? '' : ` (${r.winRate > baseline.winRate ? '+' : ''}${(r.winRate - baseline.winRate).toFixed(1)}%)`;
      const profitDiff = name === 'baseline' ? '' : ` (${r.netProfit > baseline.netProfit ? '+' : ''}${(r.netProfit - baseline.netProfit).toFixed(0)})`;

      console.log(
        `${name.padEnd(35)} | ${r.trades.toString().padStart(6)} | ${r.winRate.toFixed(1).padStart(6)}%${winRateDiff.padEnd(8)} | $${r.netProfit.toFixed(0).padStart(8)}${profitDiff.padEnd(10)} | ${r.profitFactor.toFixed(2)}`
      );
    });
  }

  console.log('\n✅ All tests complete!\n');
}

main().catch(console.error);
