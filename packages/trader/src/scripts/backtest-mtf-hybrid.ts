/**
 * Multi-Timeframe Hybrid Strategy Backtest
 *
 * Strategy:
 * - 15m "Director": Determines Macro Regime (Trend vs Range).
 * - 1m "Worker": Executes trades allowed by the Director.
 *
 * Logic:
 * - If 15m is TRENDING BULLISH -> Only allow CALLs (Momentum).
 * - If 15m is TRENDING BEARISH -> Only allow PUTs (Momentum).
 * - If 15m is RANGING -> Allow Mean Reversion (Both directions).
 *
 * Usage:
 *   DAYS="60" npx tsx src/scripts/backtest-mtf-hybrid.ts
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
    // 15m Context (Macro Trend)
    ctxAdxPeriod: 14,
    ctxAdxThreshold: 25,
    ctxSmaPeriod: 50,
    ctxSlopeThreshold: 0.0002,

    // 5m Context (Intermediate Structure)
    midRsiPeriod: 14,
    midRsiOverbought: 60, // Stricter than 1m
    midRsiOversold: 40,

    // 1m Execution Indicators
    bbPeriod: 20,
    bbStdDev: 2,
    rsiPeriod: 14,
    rsiOverbought: 55,
    rsiOversold: 45,

    // Risk Management
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    cooldownBars: 5,
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

type MacroRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE';

interface Trade {
    id: number;
    entryTime: number;
    exitTime: number;
    direction: 'CALL' | 'PUT';
    entryPrice: number;
    exitPrice: number;
    profit: number;
    result: 'WIN' | 'LOSS';
    macroRegime: MacroRegime;
    strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION';
}

interface StrategyMetrics {
    totalTrades: number;
    winRate: number;
    netProfit: number;
    profitFactor: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function loadCandles(asset: string, timeframe: string, days: string): Candle[] | null {
    // Try multiple paths and formats
    const paths = [
        join(process.cwd(), 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'packages', 'trader', 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'packages', 'trader', 'data', `${asset}_${timeframe}_${days}d.csv`),
        // Fallback for 1m -> 60s
        ...(timeframe === '1m' ? [
            join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`),
            join(process.cwd(), 'packages', 'trader', 'backtest-data', `${asset}_60s_${days}d.csv`),
            join(process.cwd(), 'data', `${asset}_60s_${days}d.csv`),
            join(process.cwd(), 'packages', 'trader', 'data', `${asset}_60s_${days}d.csv`)
        ] : [])
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

function calculateIndicators(candles: Candle[], periodPrefix: 'ctx' | 'mid' | '') {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Dynamic param access
    const adxPeriod = PARAMS[`${periodPrefix}AdxPeriod` as keyof typeof PARAMS] || 14;
    const smaPeriod = PARAMS[`${periodPrefix}SmaPeriod` as keyof typeof PARAMS] || 50;
    const bbPeriod = PARAMS.bbPeriod;
    const rsiPeriod = PARAMS.rsiPeriod; // Use same period for simplicity or add midRsiPeriod logic

    let adx: any[] = [];
    let sma: number[] = [];
    let bb: any[] = [];
    let rsi: number[] = [];

    if (periodPrefix === 'ctx') {
        adx = ADX.calculate({ high: highs, low: lows, close: closes, period: adxPeriod });
        sma = SMA.calculate({ period: smaPeriod, values: closes });
    } else if (periodPrefix === 'mid') {
        // For 5m, maybe we care about RSI and SMA?
        rsi = RSI.calculate({ period: PARAMS.midRsiPeriod, values: closes });
        sma = SMA.calculate({ period: 50, values: closes }); // 50 SMA on 5m
    } else {
        // 1m
        bb = BollingerBands.calculate({ period: bbPeriod, values: closes, stdDev: PARAMS.bbStdDev });
        rsi = RSI.calculate({ period: rsiPeriod, values: closes });
    }

    return { adx, sma, bb, rsi };
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
// CORE LOGIC
// =============================================================================

function runBacktest(candles1m: Candle[], candles5m: Candle[], candles15m: Candle[]): Trade[] {
    // 1. Calculate Indicators
    const ind15m = calculateIndicators(candles15m, 'ctx');
    const ind5m = calculateIndicators(candles5m, 'mid');
    const ind1m = calculateIndicators(candles1m, '');

    // Map Contexts
    const ctxMap15 = new Map<number, { adx: number, sma: number, prevSma: number }>();
    const ctxMap5 = new Map<number, { rsi: number, sma: number }>();

    // Align 15m
    const minLen15 = Math.min(ind15m.adx.length, ind15m.sma.length);
    const offset15 = candles15m.length - minLen15;
    for (let i = 1; i < minLen15; i++) {
        const idx = offset15 + i;
        const candle = candles15m[idx];
        const adxVal = ind15m.adx[i - (minLen15 - ind15m.adx.length)].adx;
        const smaVal = ind15m.sma[i - (minLen15 - ind15m.sma.length)];
        const prevSmaVal = ind15m.sma[i - (minLen15 - ind15m.sma.length) - 1];
        if (adxVal && smaVal && prevSmaVal) ctxMap15.set(candle.timestamp, { adx: adxVal, sma: smaVal, prevSma: prevSmaVal });
    }

    // Align 5m
    const minLen5 = Math.min(ind5m.rsi.length, ind5m.sma.length);
    const offset5 = candles5m.length - minLen5;
    for (let i = 0; i < minLen5; i++) {
        const idx = offset5 + i;
        const candle = candles5m[idx];
        const rsiVal = ind5m.rsi[i - (minLen5 - ind5m.rsi.length)];
        const smaVal = ind5m.sma[i - (minLen5 - ind5m.sma.length)];
        if (rsiVal && smaVal) ctxMap5.set(candle.timestamp, { rsi: rsiVal, sma: smaVal });
    }

    // 2. Iterate 1m Candles
    const trades: Trade[] = [];
    let lastTradeBar = -Infinity;
    let tradeId = 0;

    const minLen1 = Math.min(ind1m.bb.length, ind1m.rsi.length);
    const offset1 = candles1m.length - minLen1;

    for (let i = 1; i < minLen1 - 1; i++) {
        const candleIdx = offset1 + i;
        if (candleIdx <= lastTradeBar) continue;
        if (candleIdx - lastTradeBar < PARAMS.cooldownBars) continue;

        const candle = candles1m[candleIdx];

        // Get Contexts (Previous completed candles)
        // 15m context
        const currentSlotStart15 = Math.floor(candle.timestamp / 900) * 900;
        const prevSlotStart15 = currentSlotStart15 - 900;
        const ctx15 = ctxMap15.get(prevSlotStart15);

        // 5m context
        const currentSlotStart5 = Math.floor(candle.timestamp / 300) * 300;
        const prevSlotStart5 = currentSlotStart5 - 300;
        const ctx5 = ctxMap5.get(prevSlotStart5);

        if (!ctx15 || !ctx5) continue;

        // Determine Macro Regime (15m)
        const smaSlope15 = (ctx15.sma - ctx15.prevSma) / ctx15.prevSma;
        let macroRegime: MacroRegime = 'RANGE';
        if (ctx15.adx > PARAMS.ctxAdxThreshold) {
            if (smaSlope15 > PARAMS.ctxSlopeThreshold) macroRegime = 'BULLISH_TREND';
            else if (smaSlope15 < -PARAMS.ctxSlopeThreshold) macroRegime = 'BEARISH_TREND';
        }

        // 1m Indicators
        const bbVal = ind1m.bb[i - (minLen1 - ind1m.bb.length)];
        const rsiVal = ind1m.rsi[i - (minLen1 - ind1m.rsi.length)];
        if (!bbVal || !rsiVal) continue;

        // Logic
        let signal: 'CALL' | 'PUT' | null = null;
        let strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION' = 'MEAN_REVERSION';
        const breakoutAbove = candle.close > bbVal.upper;
        const breakoutBelow = candle.close < bbVal.lower;

        // --- 3-TIMEFRAME LOGIC ---

        if (macroRegime === 'BULLISH_TREND') {
            // 15m BULLISH
            // 5m Filter: RSI should not be extremely overbought (>80) to avoid buying the top.
            if (ctx5.rsi < 80) {
                // Momentum CALL
                if (breakoutAbove && rsiVal > PARAMS.rsiOverbought) {
                    signal = 'CALL';
                    strategyUsed = 'MOMENTUM';
                }
            }
        }
        else if (macroRegime === 'BEARISH_TREND') {
            // 15m BEARISH
            // 5m Filter: RSI should not be extremely oversold (<20)
            if (ctx5.rsi > 20) {
                // Momentum PUT
                if (breakoutBelow && rsiVal < PARAMS.rsiOversold) {
                    signal = 'PUT';
                    strategyUsed = 'MOMENTUM';
                }
            }
        }
        else {
            // RANGE (15m)
            // 5m Filter: If 5m RSI is neutral (40-60), maybe range is stable?
            // Or use 5m to confirm the reversal?
            // Let's stick to 1m confirmation for now, but maybe require 5m to NOT be trending strongly?
            // If 5m ADX was available we'd use it. For now, let's just use 1m logic.

            const nextCandle = candles1m[candleIdx + 1];
            if (nextCandle) {
                if (breakoutAbove && rsiVal > PARAMS.rsiOverbought) {
                    if (nextCandle.close < candle.close) {
                        signal = 'PUT';
                        strategyUsed = 'MEAN_REVERSION';
                    }
                } else if (breakoutBelow && rsiVal < PARAMS.rsiOversold) {
                    if (nextCandle.close > candle.close) {
                        signal = 'CALL';
                        strategyUsed = 'MEAN_REVERSION';
                    }
                }
            }
        }

        if (!signal) continue;

        // Execution
        let entryPrice = candle.close;
        let entryTime = candle.timestamp;
        let simulationStartIdx = 1;

        if (strategyUsed === 'MEAN_REVERSION') {
            const nextCandle = candles1m[candleIdx + 1];
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
            if (candleIdx + j >= candles1m.length) break;
            const futureCandle = candles1m[candleIdx + j];

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
            macroRegime,
            strategyUsed
        });

        lastTradeBar = candleIdx;
        if (strategyUsed === 'MEAN_REVERSION') lastTradeBar = candleIdx + 1;
    }

    return trades;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    console.log('='.repeat(100));
    console.log(`🌐 BACKTEST 3-TIMEFRAME (15m/5m/1m) HÍBRIDO`);
    console.log('='.repeat(100));
    console.log(`Contexto Macro: 15 min (Define Régimen)`);
    console.log(`Filtro Intermedio: 5 min (Evita extremos)`);
    console.log(`Ejecución: 1 min (Define Entrada)`);
    console.log('-'.repeat(100));
    console.log(`| Activo | Estrategia | Trades | Win Rate | P. Factor | Net Profit |`);
    console.log(`|--------|------------|--------|----------|-----------|------------|`);

    for (const asset of ASSETS) {
        const candles1m = loadCandles(asset, '1m', DAYS);
        const candles5m = loadCandles(asset, '5m', DAYS);
        const candles15m = loadCandles(asset, '15m', DAYS);

        if (!candles1m || !candles5m || !candles15m) {
            console.log(`| ${asset.padEnd(6)} | ❌ NO DATA   | -      | -        | -         | -          |`);
            continue;
        }

        const mtfTrades = runBacktest(candles1m, candles5m, candles15m);
        const mtfMetrics = getMetrics(mtfTrades);

        const profitColor = mtfMetrics.netProfit >= 0 ? '+' : '';
        console.log(`| ${asset.padEnd(6)} | 3-TF HYBRID| ${mtfMetrics.totalTrades.toString().padEnd(6)} | ${mtfMetrics.winRate.toFixed(1).padEnd(5)}%   | ${mtfMetrics.profitFactor.toFixed(2).padEnd(9)} | ${profitColor}$${mtfMetrics.netProfit.toFixed(2).padEnd(9)} |`);
    }
    console.log(`|--------|------------|--------|----------|-----------|------------|`);
}

main().catch(console.error);
