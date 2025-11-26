/**
 * Hybrid Strategy Backtest
 *
 * Strategy:
 * - Detects Market Regime (TREND vs RANGE)
 * - Switches logic dynamically:
 *   - TREND -> Momentum (Follow the breakout)
 *   - RANGE -> Mean Reversion (Fade the breakout)
 *
 * Usage:
 *   ASSET="R_100" DAYS="90" npx tsx src/scripts/backtest-hybrid-strategy.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ADX, SMA, RSI } from 'technicalindicators';

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

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '90';
const STAKE = 100;
const MULTIPLIER = 100; // Typical for R_100

const PARAMS = {
    // Indicators
    adxPeriod: 14,
    adxThreshold: 25,
    bbPeriod: 20,
    bbStdDev: 2,
    bbWidthThreshold: 0.006, // Tuned from analysis
    smaPeriod: 50,
    slopeThreshold: 0.0002,
    rsiPeriod: 14,

    // Trading Logic
    rsiOverbought: 55,
    rsiOversold: 45,

    // Risk Management
    takeProfitPct: 0.005, // 0.5%
    stopLossPct: 0.005,   // 0.5%
    cooldownBars: 5,
};

// =============================================================================
// INDICATORS
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

// =============================================================================
// LOGIC
// =============================================================================

function detectRegime(
    price: number,
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

function runBacktest(candles: Candle[], mode: StrategyType) {
    const { adx, bb, sma, rsi } = calculateIndicators(candles);

    // Align
    const minLen = Math.min(adx.length, bb.length, sma.length, rsi.length);
    const offset = candles.length - minLen;

    const trades: Trade[] = [];
    let lastTradeBar = -Infinity;
    let tradeId = 0;

    for (let i = 1; i < minLen - 1; i++) {
        const candleIdx = offset + i;

        if (candleIdx - lastTradeBar < PARAMS.cooldownBars) continue;

        const candle = candles[candleIdx];

        // Get aligned indicators
        const adxVal = adx[i - (minLen - adx.length)].adx;
        const bbVal = bb[i - (minLen - bb.length)];
        const smaVal = sma[i - (minLen - sma.length)];
        const prevSmaVal = sma[i - (minLen - sma.length) - 1];
        const rsiVal = rsi[i - (minLen - rsi.length)];

        if (!bbVal || !smaVal || !prevSmaVal) continue;

        // 1. Detect Regime
        const regime = detectRegime(
            candle.close,
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
            else useMeanReversion = true; // Both Quiet and Volatile Range use MR
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
            // Momentum: Follow the breakout (Immediate entry)
            if (breakoutAbove && rsiVal > PARAMS.rsiOverbought) signal = 'CALL';
            else if (breakoutBelow && rsiVal < PARAMS.rsiOversold) signal = 'PUT';
        }

        if (useMeanReversion) {
            // Mean Reversion: Fade the breakout (With POST_CONFIRM logic)
            // We need to look at the NEXT candle to confirm
            // If we are at index `i`, we check `i+1` for confirmation

            const nextCandle = candles[candleIdx + 1]; // Look ahead 1 bar for confirmation
            if (nextCandle) {
                if (breakoutAbove && rsiVal > PARAMS.rsiOverbought) {
                    // Potential PUT. Confirm if next candle goes DOWN (close < open or close < prev_close)
                    // Strategy uses: price < entryPrice (where entry would have been current close)
                    if (nextCandle.close < candle.close) {
                        signal = 'PUT';
                        // We enter at the CLOSE of the confirmation candle (which is nextCandle)
                        // So we need to adjust entry time/price in the simulation loop
                        // But for simplicity in this loop structure, we can just say we enter NOW
                        // but we actually need to skip this bar in the main loop or handle the offset.

                        // Better approach for this simple loop:
                        // If we have a signal, we set entryPrice = nextCandle.close
                        // And we start checking for exit from i+2
                    }
                } else if (breakoutBelow && rsiVal < PARAMS.rsiOversold) {
                    // Potential CALL. Confirm if next candle goes UP
                    if (nextCandle.close > candle.close) {
                        signal = 'CALL';
                    }
                }
            }
        }

        if (!signal) continue;

        // 4. Execute Trade (Simulation)
        // For MR with confirmation, we enter at the close of the confirmation candle (nextCandle)
        // For Momentum, we enter at close of current candle

        let entryPrice = candle.close;
        let entryTime = candle.timestamp;
        let simulationStartIdx = 1; // Start checking exit from next candle

        if (useMeanReversion && signal) {
            // Adjust for confirmation candle
            const nextCandle = candles[candleIdx + 1];
            if (!nextCandle) continue; // Should not happen if signal was set, but for safety
            entryPrice = nextCandle.close;
            entryTime = nextCandle.timestamp;
            simulationStartIdx = 2; // Start checking exit from 2 candles ahead
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

        // Look ahead max 60 bars
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

            // Time exit
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
            regime,
            strategyUsed: useMomentum ? 'MOMENTUM' : 'MEAN_REVERSION'
        });

        lastTradeBar = candleIdx;

        // If we used confirmation, we advanced one extra step effectively
        if (useMeanReversion && signal) {
            lastTradeBar = candleIdx + 1;
        }
    }

    return trades;
}

// =============================================================================
// MAIN
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

async function main() {
    console.log('='.repeat(80));
    console.log(`🧬 BACKTEST ESTRATEGIA HÍBRIDA - ${ASSET}`);
    console.log('='.repeat(80));

    const candles = loadCandles(ASSET, '1m', DAYS);
    if (!candles) {
        console.error('❌ No se encontraron datos');
        process.exit(1);
    }
    console.log(`Cargadas ${candles.length} velas.`);

    console.log('\nEjecutando simulaciones...');

    const hybridTrades = runBacktest(candles, 'HYBRID');
    const momTrades = runBacktest(candles, 'MOMENTUM_ONLY');
    const mrTrades = runBacktest(candles, 'MR_ONLY');

    // Metrics Helper
    const getMetrics = (trades: Trade[]) => {
        const wins = trades.filter(t => t.result === 'WIN').length;
        const total = trades.length;
        const winRate = total > 0 ? (wins / total * 100) : 0;
        const netProfit = trades.reduce((sum, t) => sum + t.profit, 0);
        const profitFactor = Math.abs(trades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0) /
            trades.filter(t => t.profit < 0).reduce((s, t) => s + t.profit, 0));
        return { total, wins, winRate, netProfit, profitFactor };
    };

    const hybrid = getMetrics(hybridTrades);
    const mom = getMetrics(momTrades);
    const mr = getMetrics(mrTrades);

    console.log('\n📊 COMPARACIÓN DE RENDIMIENTO');
    console.log('--------------------------------------------------------------------------------');
    console.log(`Métrica         | HÍBRIDA        | SOLO MOMENTUM  | SOLO MEAN REV  `);
    console.log('--------------------------------------------------------------------------------');
    console.log(`Total Trades    | ${hybrid.total.toString().padEnd(14)} | ${mom.total.toString().padEnd(14)} | ${mr.total.toString().padEnd(14)}`);
    console.log(`Tasa Acierto    | ${hybrid.winRate.toFixed(1).padEnd(13)}% | ${mom.winRate.toFixed(1).padEnd(13)}% | ${mr.winRate.toFixed(1).padEnd(13)}%`);
    console.log(`Beneficio Neto  | $${hybrid.netProfit.toFixed(2).padEnd(13)} | $${mom.netProfit.toFixed(2).padEnd(13)} | $${mr.netProfit.toFixed(2).padEnd(13)}`);
    console.log(`Factor Benef.   | ${hybrid.profitFactor.toFixed(2).padEnd(14)} | ${mom.profitFactor.toFixed(2).padEnd(14)} | ${mr.profitFactor.toFixed(2).padEnd(14)}`);
    console.log('--------------------------------------------------------------------------------');

    // Hybrid Details
    console.log('\n🔍 DETALLES ESTRATEGIA HÍBRIDA');
    const momUsed = hybridTrades.filter(t => t.strategyUsed === 'MOMENTUM');
    const mrUsed = hybridTrades.filter(t => t.strategyUsed === 'MEAN_REVERSION');

    console.log(`\nTrades por Lógica de Estrategia:`);
    console.log(`  MOMENTUM (Tendencia): ${momUsed.length} trades (Tasa Acierto: ${(momUsed.filter(t => t.result === 'WIN').length / momUsed.length * 100 || 0).toFixed(1)}%)`);
    console.log(`  MEAN REV (Rango):     ${mrUsed.length} trades (Tasa Acierto: ${(mrUsed.filter(t => t.result === 'WIN').length / mrUsed.length * 100 || 0).toFixed(1)}%)`);

    console.log(`\nTrades por Régimen de Mercado:`);
    const trendTrades = hybridTrades.filter(t => t.regime === 'TREND');
    const rangeQTrades = hybridTrades.filter(t => t.regime === 'RANGE_QUIET');
    const rangeVTrades = hybridTrades.filter(t => t.regime === 'RANGE_VOLATILE');

    console.log(`  TENDENCIA (Trend):       ${trendTrades.length} trades`);
    console.log(`  RANGO QUIETO (Quiet):    ${rangeQTrades.length} trades`);
    console.log(`  RANGO VOLÁTIL (Volatile):${rangeVTrades.length} trades`);

    // Conclusion
    console.log('\n🏆 CONCLUSIÓN:');
    if (hybrid.netProfit > mom.netProfit && hybrid.netProfit > mr.netProfit) {
        console.log('  ¡La Estrategia Híbrida SUPERA a ambas estrategias puras!');
    } else if (hybrid.netProfit > mr.netProfit) {
        console.log('  La Híbrida mejora a Mean Reversion, pero Momentum podría ser mejor por sí sola.');
    } else {
        console.log('  La Estrategia Híbrida tiene menor rendimiento. La detección de régimen podría necesitar ajustes.');
    }
}

main().catch(console.error);
