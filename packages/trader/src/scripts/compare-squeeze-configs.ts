/**
 * BB Squeeze Configuration Comparison
 *
 * Compares 4 different configurations to find the best win rate:
 * 1. Baseline: Current momentum logic with SL 0.2%
 * 2. Wider SL: SL 0.3% (gives more room)
 * 3. Mean Reversion: Inverted logic (CALL when RSI<30, PUT when RSI>70)
 * 4. Combined: Wider SL + Mean Reversion
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Configuration
const SYMBOL = process.env.ASSET || 'R_100';
const DAYS = parseInt(process.env.DAYS || '90', 10);

// Candle interface
interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Trade result
interface TradeResult {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  result: 'WIN' | 'LOSS';
  exitReason: 'TP' | 'SL' | 'TIMEOUT';
  pnlPct: number;
  rsi: number;
  bbSqueeze: boolean;
}

// Configuration to test
interface TestConfig {
  name: string;
  tpPct: number;
  slPct: number;
  useMeanReversion: boolean;  // true = CALL when oversold, PUT when overbought
  rsiCallMax: number;         // RSI must be below this for CALL (mean reversion)
  rsiPutMin: number;          // RSI must be above this for PUT (mean reversion)
  description: string;
}

// Test configurations
const CONFIGS: TestConfig[] = [
  {
    name: 'Baseline',
    tpPct: 0.004,  // 0.4%
    slPct: 0.002,  // 0.2%
    useMeanReversion: false,
    rsiCallMax: 100,  // No filter
    rsiPutMin: 0,     // No filter
    description: 'Momentum: CALL on upward breakout, PUT on downward'
  },
  {
    name: 'Wider_SL',
    tpPct: 0.004,  // 0.4%
    slPct: 0.003,  // 0.3%
    useMeanReversion: false,
    rsiCallMax: 100,
    rsiPutMin: 0,
    description: 'Momentum with wider SL (0.3%)'
  },
  {
    name: 'MR_Strict',
    tpPct: 0.004,  // 0.4%
    slPct: 0.003,  // 0.3%
    useMeanReversion: true,
    rsiCallMax: 30,   // Only when RSI < 30
    rsiPutMin: 70,    // Only when RSI > 70
    description: 'Mean Reversion Strict: RSI<30/RSI>70 + SL 0.3%'
  },
  {
    name: 'MR_Relaxed_40',
    tpPct: 0.004,  // 0.4%
    slPct: 0.003,  // 0.3%
    useMeanReversion: true,
    rsiCallMax: 40,   // RSI < 40 for CALL
    rsiPutMin: 60,    // RSI > 60 for PUT
    description: 'Mean Reversion Relaxed: RSI<40/RSI>60 + SL 0.3%'
  },
  {
    name: 'MR_Relaxed_45',
    tpPct: 0.004,  // 0.4%
    slPct: 0.003,  // 0.3%
    useMeanReversion: true,
    rsiCallMax: 45,   // RSI < 45 for CALL
    rsiPutMin: 55,    // RSI > 55 for PUT
    description: 'Mean Reversion Very Relaxed: RSI<45/RSI>55 + SL 0.3%'
  },
  {
    name: 'MR_40_WiderSL',
    tpPct: 0.004,  // 0.4%
    slPct: 0.004,  // 0.4%
    useMeanReversion: true,
    rsiCallMax: 40,
    rsiPutMin: 60,
    description: 'Mean Reversion RSI<40/RSI>60 + SL 0.4%'
  },
  {
    name: 'MR_45_WidestSL',
    tpPct: 0.005,  // 0.5%
    slPct: 0.005,  // 0.5%
    useMeanReversion: true,
    rsiCallMax: 45,
    rsiPutMin: 55,
    description: 'Mean Reversion RSI<45/RSI>55 + 1:1 (0.5%/0.5%)'
  },
  {
    name: 'MR_45_TP06_SL05',
    tpPct: 0.006,  // 0.6%
    slPct: 0.005,  // 0.5%
    useMeanReversion: true,
    rsiCallMax: 45,
    rsiPutMin: 55,
    description: 'Mean Reversion RSI<45/RSI>55 + TP 0.6% / SL 0.5%'
  },
  {
    name: 'MR_45_TP08_SL05',
    tpPct: 0.008,  // 0.8%
    slPct: 0.005,  // 0.5%
    useMeanReversion: true,
    rsiCallMax: 45,
    rsiPutMin: 55,
    description: 'Mean Reversion RSI<45/RSI>55 + TP 0.8% / SL 0.5%'
  },
  {
    name: 'MR_40_TP06_SL04',
    tpPct: 0.006,  // 0.6%
    slPct: 0.004,  // 0.4%
    useMeanReversion: true,
    rsiCallMax: 40,
    rsiPutMin: 60,
    description: 'Mean Reversion RSI<40/RSI>60 + TP 0.6% / SL 0.4%'
  },
  {
    name: 'MR_40_TP08_SL04',
    tpPct: 0.008,  // 0.8%
    slPct: 0.004,  // 0.4%
    useMeanReversion: true,
    rsiCallMax: 40,
    rsiPutMin: 60,
    description: 'Mean Reversion RSI<40/RSI>60 + TP 0.8% / SL 0.4%'
  }
];

/**
 * Load candles from CSV
 */
function loadCandles(symbol: string): Candle[] | null {
  const csvPath = join(process.cwd(), 'backtest-data', `${symbol}_60s_30d.csv`);

  if (!existsSync(csvPath)) {
    console.log(`CSV not found: ${csvPath}`);
    return null;
  }

  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header

  const candles: Candle[] = lines.map(line => {
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
  return candles;
}

/**
 * Calculate RSI
 */
function calculateRSI(candles: Candle[], period: number = 14): number[] {
  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;

  // First RSI calculation
  for (let i = 1; i <= period && i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Fill initial values with 50
  for (let i = 0; i < period; i++) {
    rsi.push(50);
  }

  // Calculate RSI for remaining candles
  for (let i = period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }

  return rsi;
}

/**
 * Calculate Bollinger Bands
 */
function calculateBB(candles: Candle[], period: number = 20, stdDev: number = 2): { upper: number[], middle: number[], lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(candles[i].close);
      middle.push(candles[i].close);
      lower.push(candles[i].close);
      continue;
    }

    // Calculate SMA
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const sma = sum / period;

    // Calculate Standard Deviation
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += Math.pow(candles[j].close - sma, 2);
    }
    const std = Math.sqrt(sqSum / period);

    middle.push(sma);
    upper.push(sma + stdDev * std);
    lower.push(sma - stdDev * std);
  }

  return { upper, middle, lower };
}

/**
 * Calculate Keltner Channels
 */
function calculateKC(candles: Candle[], period: number = 20, multiplier: number = 1.5): { upper: number[], lower: number[] } {
  const upper: number[] = [];
  const lower: number[] = [];

  // Calculate ATR
  const atr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(candles[i].high - candles[i].low);
      continue;
    }

    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );

    if (i < period) {
      atr.push(tr);
    } else {
      const prevATR = atr[i - 1];
      atr.push((prevATR * (period - 1) + tr) / period);
    }
  }

  // Calculate EMA
  const ema: number[] = [];
  const k = 2 / (period + 1);

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      ema.push(candles[i].close);
    } else {
      ema.push(candles[i].close * k + ema[i - 1] * (1 - k));
    }
  }

  // Calculate KC
  for (let i = 0; i < candles.length; i++) {
    upper.push(ema[i] + multiplier * atr[i]);
    lower.push(ema[i] - multiplier * atr[i]);
  }

  return { upper, lower };
}

/**
 * Detect BB Squeeze
 */
function detectSqueeze(bb: { upper: number[], middle: number[], lower: number[] }, kc: { upper: number[], lower: number[] }): boolean[] {
  const squeeze: boolean[] = [];

  for (let i = 0; i < bb.upper.length; i++) {
    // Squeeze = BB inside KC
    const bbInside = bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i];
    squeeze.push(bbInside);
  }

  return squeeze;
}

/**
 * Simulate a trade
 */
function simulateTrade(
  candles: Candle[],
  entryIndex: number,
  direction: 'CALL' | 'PUT',
  tpPct: number,
  slPct: number,
  rsi: number,
  isSqueeze: boolean
): TradeResult {
  const entryCandle = candles[entryIndex];
  const entryPrice = entryCandle.close;

  // Calculate TP/SL
  const tpPrice = direction === 'CALL'
    ? entryPrice * (1 + tpPct)
    : entryPrice * (1 - tpPct);

  const slPrice = direction === 'CALL'
    ? entryPrice * (1 - slPct)
    : entryPrice * (1 + slPct);

  // Simulate for max 30 candles
  const maxCandles = Math.min(30, candles.length - entryIndex - 1);
  let exitPrice = entryPrice;
  let exitTime = entryCandle.timestamp;
  let exitReason: 'TP' | 'SL' | 'TIMEOUT' = 'TIMEOUT';

  for (let i = 1; i <= maxCandles; i++) {
    const candle = candles[entryIndex + i];

    if (direction === 'CALL') {
      // Check SL first (worst case)
      if (candle.low <= slPrice) {
        exitPrice = slPrice;
        exitTime = candle.timestamp;
        exitReason = 'SL';
        break;
      }
      // Check TP
      if (candle.high >= tpPrice) {
        exitPrice = tpPrice;
        exitTime = candle.timestamp;
        exitReason = 'TP';
        break;
      }
    } else {
      // PUT
      if (candle.high >= slPrice) {
        exitPrice = slPrice;
        exitTime = candle.timestamp;
        exitReason = 'SL';
        break;
      }
      if (candle.low <= tpPrice) {
        exitPrice = tpPrice;
        exitTime = candle.timestamp;
        exitReason = 'TP';
        break;
      }
    }
  }

  // Calculate P&L
  const pnlPct = direction === 'CALL'
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;

  return {
    direction,
    entryPrice,
    exitPrice,
    entryTime: entryCandle.timestamp,
    exitTime,
    result: pnlPct > 0 ? 'WIN' : 'LOSS',
    exitReason,
    pnlPct,
    rsi,
    bbSqueeze: isSqueeze,
  };
}

/**
 * Run backtest for a config
 */
function runBacktest(candles: Candle[], config: TestConfig): TradeResult[] {
  const trades: TradeResult[] = [];

  // Calculate indicators
  const rsi = calculateRSI(candles, 14);
  const bb = calculateBB(candles, 20, 2);
  const kc = calculateKC(candles, 20, 1.5);
  const squeeze = detectSqueeze(bb, kc);

  // Track squeeze state
  let wasInSqueeze = false;
  let lastTradeIndex = -100;

  for (let i = 50; i < candles.length - 30; i++) {
    const currentRSI = rsi[i];
    const inSqueeze = squeeze[i];

    // Cooldown (60 candles = 1 hour)
    if (i - lastTradeIndex < 60) continue;

    // Detect squeeze release
    const squeezeRelease = wasInSqueeze && !inSqueeze;
    wasInSqueeze = inSqueeze;

    if (!squeezeRelease) continue;

    // Determine direction based on config
    let direction: 'CALL' | 'PUT' | null = null;

    if (config.useMeanReversion) {
      // Mean Reversion: Buy oversold, sell overbought
      if (currentRSI < config.rsiCallMax) {
        direction = 'CALL';  // Buy when oversold (expect bounce up)
      } else if (currentRSI > config.rsiPutMin) {
        direction = 'PUT';   // Sell when overbought (expect drop)
      }
    } else {
      // Momentum: Trade breakout direction
      const priceVsMiddle = candles[i].close - bb.middle[i];
      if (priceVsMiddle > 0) {
        direction = 'CALL';  // Price above middle, go long
      } else {
        direction = 'PUT';   // Price below middle, go short
      }

      // Additional RSI filter for momentum
      if (direction === 'CALL' && currentRSI > 80) continue;  // Skip overbought
      if (direction === 'PUT' && currentRSI < 20) continue;   // Skip oversold
    }

    if (!direction) continue;

    // Execute trade
    const trade = simulateTrade(
      candles,
      i,
      direction,
      config.tpPct,
      config.slPct,
      currentRSI,
      true
    );

    trades.push(trade);
    lastTradeIndex = i;
  }

  return trades;
}

/**
 * Print results
 */
function printResults(results: Map<string, TradeResult[]>) {
  console.log('\n' + '='.repeat(100));
  console.log('📊 BB SQUEEZE CONFIGURATION COMPARISON');
  console.log('='.repeat(100));

  const summaries: any[] = [];

  for (const config of CONFIGS) {
    const trades = results.get(config.name) || [];
    const wins = trades.filter(t => t.result === 'WIN').length;
    const losses = trades.filter(t => t.result === 'LOSS').length;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

    const totalPnl = trades.reduce((sum, t) => sum + t.pnlPct, 0);
    const avgPnl = trades.length > 0 ? totalPnl / trades.length : 0;

    const tpExits = trades.filter(t => t.exitReason === 'TP').length;
    const slExits = trades.filter(t => t.exitReason === 'SL').length;

    // RSI at entry stats
    const callTrades = trades.filter(t => t.direction === 'CALL');
    const putTrades = trades.filter(t => t.direction === 'PUT');
    const avgCallRSI = callTrades.length > 0
      ? callTrades.reduce((sum, t) => sum + t.rsi, 0) / callTrades.length
      : 0;
    const avgPutRSI = putTrades.length > 0
      ? putTrades.reduce((sum, t) => sum + t.rsi, 0) / putTrades.length
      : 0;

    summaries.push({
      name: config.name,
      trades: trades.length,
      wins,
      losses,
      winRate,
      avgPnl,
      totalPnl,
      tpRate: trades.length > 0 ? (tpExits / trades.length) * 100 : 0,
      slRate: trades.length > 0 ? (slExits / trades.length) * 100 : 0,
      avgCallRSI,
      avgPutRSI,
      description: config.description,
    });
  }

  // Sort by win rate
  summaries.sort((a, b) => b.winRate - a.winRate);

  console.log('\n📈 RANKED BY WIN RATE:\n');
  console.log('┌─────────────────────┬────────┬──────┬───────┬──────────┬──────────┬─────────┬─────────┐');
  console.log('│ Configuration       │ Trades │ Wins │ Losses│ Win Rate │ Avg P&L  │ TP Rate │ SL Rate │');
  console.log('├─────────────────────┼────────┼──────┼───────┼──────────┼──────────┼─────────┼─────────┤');

  for (const s of summaries) {
    const name = s.name.padEnd(19);
    const trades = String(s.trades).padStart(6);
    const wins = String(s.wins).padStart(4);
    const losses = String(s.losses).padStart(5);
    const winRate = s.winRate.toFixed(1).padStart(6) + '%';
    const avgPnl = (s.avgPnl >= 0 ? '+' : '') + s.avgPnl.toFixed(2).padStart(6) + '%';
    const tpRate = s.tpRate.toFixed(1).padStart(5) + '%';
    const slRate = s.slRate.toFixed(1).padStart(5) + '%';

    console.log(`│ ${name} │ ${trades} │ ${wins} │ ${losses} │ ${winRate} │ ${avgPnl} │ ${tpRate} │ ${slRate} │`);
  }

  console.log('└─────────────────────┴────────┴──────┴───────┴──────────┴──────────┴─────────┴─────────┘');

  // Best configuration
  const best = summaries[0];
  console.log(`\n🏆 BEST CONFIGURATION: ${best.name}`);
  console.log(`   Description: ${best.description}`);
  console.log(`   Win Rate: ${best.winRate.toFixed(1)}%`);
  console.log(`   Avg P&L: ${best.avgPnl >= 0 ? '+' : ''}${best.avgPnl.toFixed(2)}%`);
  console.log(`   Total P&L: ${best.totalPnl >= 0 ? '+' : ''}${best.totalPnl.toFixed(2)}%`);

  // RSI Analysis
  console.log('\n📊 RSI AT ENTRY ANALYSIS:');
  console.log('┌─────────────────────┬───────────────┬───────────────┐');
  console.log('│ Configuration       │ Avg CALL RSI  │ Avg PUT RSI   │');
  console.log('├─────────────────────┼───────────────┼───────────────┤');

  for (const s of summaries) {
    const name = s.name.padEnd(19);
    const callRSI = s.avgCallRSI.toFixed(1).padStart(11);
    const putRSI = s.avgPutRSI.toFixed(1).padStart(11);
    console.log(`│ ${name} │ ${callRSI} │ ${putRSI} │`);
  }

  console.log('└─────────────────────┴───────────────┴───────────────┘');

  console.log('\n💡 INSIGHTS:');
  console.log('   - Mean Reversion enters CALL when RSI < 30 (oversold) -> expects bounce');
  console.log('   - Mean Reversion enters PUT when RSI > 70 (overbought) -> expects drop');
  console.log('   - Momentum follows breakout but can enter at extremes (risky)');
  console.log('   - Wider SL (0.3%) gives more room for trade to develop');

  console.log('\n' + '='.repeat(100));
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(100));
  console.log('🚀 BB SQUEEZE CONFIGURATION COMPARISON');
  console.log('='.repeat(100));
  console.log(`   Asset: ${SYMBOL}`);
  console.log(`   Target Days: ${DAYS}`);
  console.log();

  // Load candles
  console.log('📥 Loading candles...');
  const candles = loadCandles(SYMBOL);

  if (!candles || candles.length < 100) {
    console.error('❌ Insufficient candle data');
    console.log('   Run: SYMBOLS="R_100" DAYS=90 npx tsx src/scripts/fetch-historical-data.ts');
    process.exit(1);
  }

  console.log(`✅ Loaded ${candles.length} candles`);
  console.log(`   Period: ${new Date(candles[0].timestamp * 1000).toISOString().slice(0, 10)} to ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString().slice(0, 10)}`);

  // Run backtests
  const results = new Map<string, TradeResult[]>();

  for (const config of CONFIGS) {
    console.log(`\n📊 Testing: ${config.name}`);
    console.log(`   ${config.description}`);
    console.log(`   TP: ${(config.tpPct * 100).toFixed(1)}% | SL: ${(config.slPct * 100).toFixed(1)}%`);

    const trades = runBacktest(candles, config);
    results.set(config.name, trades);

    const wins = trades.filter(t => t.result === 'WIN').length;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    console.log(`   Trades: ${trades.length} | Win Rate: ${winRate.toFixed(1)}%`);
  }

  // Print comparison
  printResults(results);

  console.log('\n✅ Comparison complete');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
