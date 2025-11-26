/**
 * Comprehensive Backtest Battery
 *
 * Purpose:
 * - Run Hybrid vs Momentum vs Mean Reversion backtest across multiple assets.
 * - Generate a consolidated performance report.
 * - Identify the best strategy for each asset.
 *
 * Usage:
 *   DAYS="60" npx tsx src/scripts/run-backtest-battery.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ADX, SMA, RSI } from 'technicalindicators';

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const DAYS = process.env.DAYS || '60';
const STAKE = 100;
const MULTIPLIER = 100;

const PARAMS = {
    // Indicators
    adxPeriod: 14,
    adxThreshold: 25,
    bbPeriod: 20,
    bbStdDev: 2,
    bbWidthThreshold: 0.006,
    smaPeriod: 50,
    slopeThreshold: 0.0002,
    rsiPeriod: 14,

    // Trading Logic
    rsiOverbought: 55,
    rsiOversold: 45,

    // Risk Management
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    cooldownBars: 5,

    // Confirmation
    confirmationCandles: 1, // For Mean Reversion
};

// =============================================================================
// TYPES
// =============================================================================

interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

type Regime = 'TREND' | 'RANGE_QUIET' | 'RANGE_VOLATILE';
type StrategyType = 'HYBRID' | 'MOMENTUM_ONLY' | 'MR_ONLY';

interface Trade {
    id: number;
    entryTime: number;
    exitTime: number;
    direction: 'CALL' | 'PUT';
    entryPrice: number;
    exitPrice: number;
    profit: number;
    result: 'WIN' | 'LOSS';
    regime: Regime;
    strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION';
}

interface AssetResult {
    asset: string;
    hybrid: StrategyMetrics;
    momentum: StrategyMetrics;
    meanReversion: StrategyMetrics;
    bestStrategy: string;
}

interface StrategyMetrics {
    totalTrades: number;
    winRate: number;
    netProfit: number;
    profitFactor: number;
}

// =============================================================================
// CORE LOGIC (Refactored from backtest-hybrid-strategy.ts)
// =============================================================================

function calculateIndicators(candles: Candle[]) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: PARAMS.adxPeriod });
    const bb = BollingerBands.calculate({ period: PARAMS.bbPeriod, values: closes, stdDev: PARAMS.bbStdDev });
    const sma = SMA.calculate({ period: PARAMS.smaPeriod, values: closes });
    const rsi = RSI.calculate({ period: PARAMS.rsiPeriod, values: closes });

    return { adx, bb, sma, rsi };
}

function detectRegime(
    adx: number,
    bbUpper: number,
    bbLower: number,
    bbMiddle: number,
    currentSMA: number,
    prevSMA: number
): Regime {
    const bbWidth = (bbUpper - bbLower) / bbMiddle;
    const smaSlope = (currentSMA - prevSMA) / prevSMA;

    const isTrendStrength = adx > PARAMS.adxThreshold;
    const isSqueeze = bbWidth < PARAMS.bbWidthThreshold;
    const isSlopeSignificant = Math.abs(smaSlope) > PARAMS.slopeThreshold;

    if (isTrendStrength && isSlopeSignificant) {
        return 'TREND';
    } else if (isSqueeze) {
        return 'RANGE_QUIET';
    } else {
        return 'RANGE_VOLATILE';
    }
}

function runBacktest(candles: Candle[], mode: StrategyType): Trade[] {
    const { adx, bb, sma, rsi } = calculateIndicators(candles);

    const minLen = Math.min(adx.length, bb.length, sma.length, rsi.length);
    const offset = candles.length - minLen;

    const trades: Trade[] = [];
    let lastTradeBar = -Infinity;
    let tradeId = 0;

    for (let i = 1; i < minLen - 1; i++) {
        const candleIdx = offset + i;

        if (candleIdx <= lastTradeBar) continue; // Skip if we are in a trade or cooldown
        if (candleIdx - lastTradeBar < PARAMS.cooldownBars) continue;

        const candle = candles[candleIdx];

        const adxVal = adx[i - (minLen - adx.length)].adx;
        const bbVal = bb[i - (minLen - bb.length)];
        const smaVal = sma[i - (minLen - sma.length)];
        const prevSmaVal = sma[i - (minLen - sma.length) - 1];
        const rsiVal = rsi[i - (minLen - rsi.length)];

        if (!bbVal || !smaVal || !prevSmaVal) continue;

        // 1. Detect Regime
        const regime = detectRegime(
            adxVal,
            bbVal.upper,
            bbVal.lower,
            bbVal.middle,
            smaVal,
            prevSmaVal
        );

        // 2. Determine Strategy Logic
        let useMomentum = false;
        let useMeanReversion = false;

        if (mode === 'HYBRID') {
            if (regime === 'TREND') useMomentum = true;
            else useMeanReversion = true;
        } else if (mode === 'MOMENTUM_ONLY') {
            useMomentum = true;
        } else if (mode === 'MR_ONLY') {
            useMeanReversion = true;
        }

        // 3. Check Signals
        let signal: 'CALL' | 'PUT' | null = null;
        const breakoutAbove = candle.close > bbVal.upper;
        const breakoutBelow = candle.close < bbVal.lower;

        if (useMomentum) {
            if (breakoutAbove && rsiVal > PARAMS.rsiOverbought) signal = 'CALL';
            else if (breakoutBelow && rsiVal < PARAMS.rsiOversold) signal = 'PUT';
        }

        if (useMeanReversion) {
            // Mean Reversion with POST_CONFIRM
            const nextCandle = candles[candleIdx + 1];
            if (nextCandle) {
                if (breakoutAbove && rsiVal > PARAMS.rsiOverbought) {
                    if (nextCandle.close < candle.close) signal = 'PUT';
                } else if (breakoutBelow && rsiVal < PARAMS.rsiOversold) {
                    if (nextCandle.close > candle.close) signal = 'CALL';
                }
            }
        }

        if (!signal) continue;

        // 4. Execute Trade
        let entryPrice = candle.close;
        let entryTime = candle.timestamp;
        let simulationStartIdx = 1;

        if (useMeanReversion && signal) {
            const nextCandle = candles[candleIdx + 1];
            if (!nextCandle) continue;
            entryPrice = nextCandle.close;
            entryTime = nextCandle.timestamp;
            simulationStartIdx = 2;
        }

        const tpPrice = signal === 'CALL'
            ? entryPrice * (1 + PARAMS.takeProfitPct)
            : entryPrice * (1 - PARAMS.takeProfitPct);
        const slPrice = signal === 'CALL'
            ? entryPrice * (1 - PARAMS.stopLossPct)
            : entryPrice * (1 + PARAMS.stopLossPct);

        let exitPrice = entryPrice;
        let exitTimeVal = entryTime;
        let result: 'WIN' | 'LOSS' = 'LOSS';

        for (let j = simulationStartIdx; j <= 60; j++) {
            if (candleIdx + j >= candles.length) break;
            const futureCandle = candles[candleIdx + j];

            if (signal === 'CALL') {
                if (futureCandle.high >= tpPrice) { exitPrice = tpPrice; result = 'WIN'; exitTimeVal = futureCandle.timestamp; break; }
                if (futureCandle.low <= slPrice) { exitPrice = slPrice; result = 'LOSS'; exitTimeVal = futureCandle.timestamp; break; }
            } else {
                if (futureCandle.low <= tpPrice) { exitPrice = tpPrice; result = 'WIN'; exitTimeVal = futureCandle.timestamp; break; }
                if (futureCandle.high >= slPrice) { exitPrice = slPrice; result = 'LOSS'; exitTimeVal = futureCandle.timestamp; break; }
            }

            if (j === 60) {
                exitPrice = futureCandle.close;
                const pnl = signal === 'CALL' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
                result = pnl > 0 ? 'WIN' : 'LOSS';
                exitTimeVal = futureCandle.timestamp;
            }
        }

        const priceChangePct = signal === 'CALL'
            ? (exitPrice - entryPrice) / entryPrice
            : (entryPrice - exitPrice) / entryPrice;

        const profit = priceChangePct * STAKE * MULTIPLIER;

        trades.push({
            id: ++tradeId,
            entryTime,
            exitTime: exitTimeVal,
            direction: signal,
            entryPrice,
            exitPrice,
            profit,
            result,
            regime: regime, // Note: This is the regime at detection time
            strategyUsed: useMomentum ? 'MOMENTUM' : 'MEAN_REVERSION'
        });

        lastTradeBar = candleIdx;
        if (useMeanReversion && signal) {
            lastTradeBar = candleIdx + 1;
        }
    }

    return trades;
}

// =============================================================================
// HELPERS
// =============================================================================

function loadCandles(asset: string, timeframe: string, days: string): Candle[] | null {
    const paths = [
        join(process.cwd(), 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'packages', 'trader', 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`)
    ];

    for (const p of paths) {
        if (existsSync(p)) {
            const content = readFileSync(p, 'utf-8');
            const lines = content.trim().split('\n').slice(1);
            return lines.map(line => {
                const [timestamp, open, high, low, close] = line.split(',');
                const ts = parseInt(timestamp);
                return {
                    timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                };
            }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close)).sort((a, b) => a.timestamp - b.timestamp);
        }
    }
    return null;
}

function getMetrics(trades: Trade[]): StrategyMetrics {
    const wins = trades.filter(t => t.result === 'WIN').length;
    const total = trades.length;
    const winRate = total > 0 ? (wins / total * 100) : 0;
    const netProfit = trades.reduce((sum, t) => sum + t.profit, 0);
    const grossProfit = trades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(trades.filter(t => t.profit < 0).reduce((s, t) => s + t.profit, 0));
    const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

    return { totalTrades: total, winRate, netProfit, profitFactor };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    console.log('='.repeat(100));
    console.log(`🔋 BATERÍA DE BACKTESTING COMPLETA (${DAYS} DÍAS)`);
    console.log('='.repeat(100));
    console.log(`Activos: ${ASSETS.join(', ')}`);
    console.log(`Estrategias: HÍBRIDA (con Confirmación) vs MOMENTUM vs MEAN REVERSION`);
    console.log('-'.repeat(100));
    console.log(`| Activo | Estrategia     | Trades | Win Rate | P. Factor | Net Profit |`);
    console.log(`|--------|----------------|--------|----------|-----------|------------|`);

    const results: AssetResult[] = [];

    for (const asset of ASSETS) {
        const candles = loadCandles(asset, '1m', DAYS);

        if (!candles) {
            console.log(`| ${asset.padEnd(6)} | ❌ NO DATA       | -      | -        | -         | -          |`);
            continue;
        }

        const hybridTrades = runBacktest(candles, 'HYBRID');
        const momTrades = runBacktest(candles, 'MOMENTUM_ONLY');
        const mrTrades = runBacktest(candles, 'MR_ONLY');

        const hybrid = getMetrics(hybridTrades);
        const mom = getMetrics(momTrades);
        const mr = getMetrics(mrTrades);

        // Determine winner
        let bestStrategy = 'HYBRID';
        let maxProfit = hybrid.netProfit;

        if (mom.netProfit > maxProfit) {
            maxProfit = mom.netProfit;
            bestStrategy = 'MOMENTUM';
        }
        if (mr.netProfit > maxProfit) {
            maxProfit = mr.netProfit;
            bestStrategy = 'MEAN_REV';
        }

        results.push({ asset, hybrid, momentum: mom, meanReversion: mr, bestStrategy });

        // Print rows
        const printRow = (name: string, m: StrategyMetrics, isBest: boolean) => {
            const bestMark = isBest ? '🏆' : '  ';
            const profitColor = m.netProfit >= 0 ? '+' : '';
            console.log(`| ${asset.padEnd(6)} | ${bestMark} ${name.padEnd(10)} | ${m.totalTrades.toString().padEnd(6)} | ${m.winRate.toFixed(1).padEnd(5)}%   | ${m.profitFactor.toFixed(2).padEnd(9)} | ${profitColor}$${m.netProfit.toFixed(2).padEnd(9)} |`);
        };

        printRow('HYBRID', hybrid, bestStrategy === 'HYBRID');
        printRow('MOMENTUM', mom, bestStrategy === 'MOMENTUM');
        printRow('MEAN REV', mr, bestStrategy === 'MEAN_REV');
        console.log(`|--------|----------------|--------|----------|-----------|------------|`);
    }

    console.log('\n📊 RESUMEN FINAL');
    console.log('='.repeat(50));

    const totalProfitHybrid = results.reduce((s, r) => s + r.hybrid.netProfit, 0);
    const totalProfitMom = results.reduce((s, r) => s + r.momentum.netProfit, 0);
    const totalProfitMR = results.reduce((s, r) => s + r.meanReversion.netProfit, 0);

    console.log(`Beneficio Total HÍBRIDA:      $${totalProfitHybrid.toFixed(2)}`);
    console.log(`Beneficio Total MOMENTUM:     $${totalProfitMom.toFixed(2)}`);
    console.log(`Beneficio Total MEAN REV:     $${totalProfitMR.toFixed(2)}`);

    console.log('\n🏆 MEJOR ESTRATEGIA POR ACTIVO:');
    results.forEach(r => {
        console.log(`  ${r.asset}: ${r.bestStrategy}`);
    });
}

main().catch(console.error);
