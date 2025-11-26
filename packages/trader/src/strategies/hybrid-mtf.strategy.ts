/**
 * Hybrid Multi-Timeframe (MTF) Strategy
 *
 * Strategy: Combines Momentum and Mean Reversion based on multi-timeframe regime detection
 *
 * LOGIC:
 * - 15m Context: Determines macro regime (BULLISH_TREND / BEARISH_TREND / RANGE)
 * - 5m Filter: RSI extremes filter (avoid buying tops/selling bottoms)
 * - 1m Execution: BB + RSI signals for precise entry
 *
 * REGIME-BASED TRADING:
 * - BULLISH_TREND (15m): Only CALL signals (Momentum with trend)
 * - BEARISH_TREND (15m): Only PUT signals (Momentum with trend)
 * - RANGE (15m): Mean Reversion with POST_CONFIRM (wait 1 candle)
 *
 * Backtest Results (90 days):
 * - R_100: +$3,741 (50.8% WR, 1.03 PF)
 * - R_25: +$1,275 (49.7% WR, 1.02 PF)
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import { BollingerBands, ADX, SMA, RSI } from 'technicalindicators';

/**
 * Hybrid MTF Strategy Parameters
 */
export interface HybridMTFParams {
    // 15m Context (Macro Trend Detection)
    ctxAdxPeriod: number;
    ctxAdxThreshold: number;
    ctxSmaPeriod: number;
    ctxSlopeThreshold: number;

    // 5m Filter (Intermediate RSI)
    midRsiPeriod: number;
    midRsiOverbought: number;
    midRsiOversold: number;

    // 1m Execution (BB + RSI)
    bbPeriod: number;
    bbStdDev: number;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;

    // Risk Management
    takeProfitPct: number;
    stopLossPct: number;
    cooldownSeconds: number;
    minCandles: number;

    // Confirmation
    confirmationCandles: number;
}

/**
 * Macro regime detected from 15m context
 */
type MacroRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE';

/**
 * Pending signal waiting for confirmation (Mean Reversion only)
 */
interface PendingSignal {
    direction: 'CALL' | 'PUT';
    entryPrice: number;
    timestamp: number;
    candlesWaited: number;
}

/**
 * Resampled candle for higher timeframes
 */
interface ResampledCandle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

/**
 * Default parameters (optimized from backtest)
 */
const DEFAULT_PARAMS: HybridMTFParams = {
    // 15m Context
    ctxAdxPeriod: 14,
    ctxAdxThreshold: 25,
    ctxSmaPeriod: 50,
    ctxSlopeThreshold: 0.0002,

    // 5m Filter
    midRsiPeriod: 14,
    midRsiOverbought: 80,
    midRsiOversold: 20,

    // 1m Execution
    bbPeriod: 20,
    bbStdDev: 2,
    rsiPeriod: 14,
    rsiOverbought: 55,
    rsiOversold: 45,

    // Risk Management
    takeProfitPct: 0.005,  // 0.5%
    stopLossPct: 0.005,    // 0.5%
    cooldownSeconds: 60,
    minCandles: 100,       // Need more for 15m context

    // Confirmation
    confirmationCandles: 1,
};

/**
 * Hybrid Multi-Timeframe Strategy
 *
 * Dynamically switches between Momentum and Mean Reversion based on 15m regime
 */
export class HybridMTFStrategy extends BaseStrategy {
    private params: HybridMTFParams;
    private lastTradeTime: Record<string, number> = {};
    private pendingSignals: Record<string, PendingSignal | null> = {};

    // Internal buffers for resampled candles
    private candles5m: Record<string, ResampledCandle[]> = {};
    private candles15m: Record<string, ResampledCandle[]> = {};

    constructor(config: StrategyConfig) {
        super(config);
        this.params = {
            ...DEFAULT_PARAMS,
            ...(config.parameters as Partial<HybridMTFParams>),
        };
    }

    /**
     * Resample 1m candles to 5m or 15m
     */
    private resampleCandles(candles1m: Candle[], intervalMinutes: number): ResampledCandle[] {
        const resampled: ResampledCandle[] = [];
        const intervalMs = intervalMinutes * 60 * 1000;

        for (const candle of candles1m) {
            const slotStart = Math.floor(candle.timestamp / intervalMs) * intervalMs;

            // Find or create resampled candle for this slot
            let resampledCandle = resampled.find(c => c.timestamp === slotStart);

            if (!resampledCandle) {
                // New slot
                resampledCandle = {
                    timestamp: slotStart,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                };
                resampled.push(resampledCandle);
            } else {
                // Update existing slot
                resampledCandle.high = Math.max(resampledCandle.high, candle.high);
                resampledCandle.low = Math.min(resampledCandle.low, candle.low);
                resampledCandle.close = candle.close; // Last close
            }
        }

        return resampled.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Detect macro regime from 15m context
     */
    private detectRegime(candles15m: ResampledCandle[]): MacroRegime | null {
        if (candles15m.length < this.params.ctxSmaPeriod + 1) return null;

        const closes = candles15m.map(c => c.close);
        const highs = candles15m.map(c => c.high);
        const lows = candles15m.map(c => c.low);

        // Calculate ADX
        const adxResult = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: this.params.ctxAdxPeriod,
        });

        // Calculate SMA
        const smaResult = SMA.calculate({
            period: this.params.ctxSmaPeriod,
            values: closes,
        });

        if (adxResult.length < 2 || smaResult.length < 2) return null;

        const adx = adxResult[adxResult.length - 1]?.adx;
        const sma = smaResult[smaResult.length - 1];
        const prevSma = smaResult[smaResult.length - 2];

        if (!adx || sma === undefined || prevSma === undefined) return null;

        const smaSlope = (sma - prevSma) / prevSma;

        // Regime detection
        if (adx > this.params.ctxAdxThreshold) {
            if (smaSlope > this.params.ctxSlopeThreshold) return 'BULLISH_TREND';
            if (smaSlope < -this.params.ctxSlopeThreshold) return 'BEARISH_TREND';
        }

        return 'RANGE';
    }

    /**
     * Get 5m RSI for filtering
     */
    private get5mRSI(candles5m: ResampledCandle[]): number | null {
        if (candles5m.length < this.params.midRsiPeriod + 1) return null;

        const closes = candles5m.map(c => c.close);
        const rsiResult = RSI.calculate({
            period: this.params.midRsiPeriod,
            values: closes,
        });

        const lastRsi = rsiResult[rsiResult.length - 1];
        return lastRsi !== undefined ? lastRsi : null;
    }

    async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
        const { candles } = context;
        const asset = candle.asset;

        console.log(`[HybridMTF] 🔍 onCandle for ${asset} | price=${candle.close.toFixed(2)}`);

        // Need enough candles
        if (!candles || candles.length < this.params.minCandles) {
            console.log(`[HybridMTF] ⏭️  Not enough candles: ${candles?.length || 0} < ${this.params.minCandles}`);
            return null;
        }

        // Initialize asset state
        if (this.lastTradeTime[asset] === undefined) this.lastTradeTime[asset] = 0;
        if (!this.candles5m[asset]) this.candles5m[asset] = [];
        if (!this.candles15m[asset]) this.candles15m[asset] = [];

        // Check cooldown
        const now = Date.now();
        const timeSinceLastTrade = now - this.lastTradeTime[asset];
        const cooldownMs = this.params.cooldownSeconds * 1000;

        if (timeSinceLastTrade < cooldownMs) {
            console.log(`[HybridMTF] ⏸️  Cooldown: ${Math.round((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`);
            return null;
        }

        // Resample to 5m and 15m
        const candles5m = this.resampleCandles(candles, 5);
        const candles15m = this.resampleCandles(candles, 15);

        console.log(`[HybridMTF] 📊 Resampled: ${candles.length} x 1m → ${candles5m.length} x 5m, ${candles15m.length} x 15m`);

        // Detect regime
        const regime = this.detectRegime(candles15m);
        if (!regime) {
            console.log(`[HybridMTF] ❌ Could not detect regime (not enough data)`);
            return null;
        }

        console.log(`[HybridMTF] 🌍 Regime: ${regime}`);

        // Get 5m RSI filter
        const rsi5m = this.get5mRSI(candles5m);
        if (rsi5m === null) {
            console.log(`[HybridMTF] ❌ Could not calculate 5m RSI`);
            return null;
        }

        console.log(`[HybridMTF] 📈 5m RSI: ${rsi5m.toFixed(1)}`);

        // Calculate 1m indicators
        const closes = candles.map(c => c.close);
        const bbResult = BollingerBands.calculate({
            period: this.params.bbPeriod,
            values: closes,
            stdDev: this.params.bbStdDev,
        });

        const rsiResult = RSI.calculate({
            period: this.params.rsiPeriod,
            values: closes,
        });

        if (bbResult.length === 0 || rsiResult.length === 0) {
            console.log(`[HybridMTF] ❌ Could not calculate 1m indicators`);
            return null;
        }

        const bb = bbResult[bbResult.length - 1];
        const rsi = rsiResult[rsiResult.length - 1];

        if (!bb || rsi === undefined) {
            console.log(`[HybridMTF] ❌ Invalid 1m indicators`);
            return null;
        }

        const breakoutAbove = candle.close > bb.upper;
        const breakoutBelow = candle.close < bb.lower;

        console.log(`[HybridMTF] 📊 1m BB: ${bb.lower.toFixed(2)} < ${candle.close.toFixed(2)} < ${bb.upper.toFixed(2)} | RSI: ${rsi.toFixed(1)}`);

        // Handle pending confirmation (Mean Reversion only)
        const pending = this.pendingSignals[asset];
        if (pending) {
            pending.candlesWaited++;
            console.log(`[HybridMTF] ⏳ Pending ${pending.direction} signal (waited ${pending.candlesWaited}/${this.params.confirmationCandles} candles)`);

            if (pending.candlesWaited >= this.params.confirmationCandles) {
                // Check confirmation
                const confirmed = pending.direction === 'CALL'
                    ? candle.close > pending.entryPrice
                    : candle.close < pending.entryPrice;

                if (confirmed) {
                    console.log(`[HybridMTF] ✅ Signal CONFIRMED after ${pending.candlesWaited} candles`);
                    this.pendingSignals[asset] = null;
                    this.lastTradeTime[asset] = now;

                    return this.createSignal(
                        pending.direction,
                        0.8,
                        {
                            regime,
                            strategy: 'MEAN_REVERSION',
                            entryPrice: candle.close,
                            takeProfit: pending.direction === 'CALL'
                                ? candle.close * (1 + this.params.takeProfitPct)
                                : candle.close * (1 - this.params.takeProfitPct),
                            stopLoss: pending.direction === 'CALL'
                                ? candle.close * (1 - this.params.stopLossPct)
                                : candle.close * (1 + this.params.stopLossPct),
                        },
                        asset
                    );
                } else {
                    console.log(`[HybridMTF] ❌ Signal CANCELLED (price moved against us)`);
                    this.pendingSignals[asset] = null;
                }
            }
            return null;
        }

        // Generate new signal based on regime
        let signal: 'CALL' | 'PUT' | null = null;
        let strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION' = 'MOMENTUM';

        if (regime === 'BULLISH_TREND') {
            // 15m BULLISH: Only CALLs (Momentum)
            // 5m Filter: Avoid extreme overbought
            if (rsi5m < this.params.midRsiOverbought) {
                if (breakoutAbove && rsi > this.params.rsiOverbought) {
                    signal = 'CALL';
                    strategyUsed = 'MOMENTUM';
                    console.log(`[HybridMTF] 🚀 BULLISH MOMENTUM: Breakout above BB + RSI > ${this.params.rsiOverbought}`);
                }
            } else {
                console.log(`[HybridMTF] ⚠️  5m RSI too high (${rsi5m.toFixed(1)} > ${this.params.midRsiOverbought}) - skipping CALL`);
            }
        } else if (regime === 'BEARISH_TREND') {
            // 15m BEARISH: Only PUTs (Momentum)
            // 5m Filter: Avoid extreme oversold
            if (rsi5m > this.params.midRsiOversold) {
                if (breakoutBelow && rsi < this.params.rsiOversold) {
                    signal = 'PUT';
                    strategyUsed = 'MOMENTUM';
                    console.log(`[HybridMTF] 📉 BEARISH MOMENTUM: Breakout below BB + RSI < ${this.params.rsiOversold}`);
                }
            } else {
                console.log(`[HybridMTF] ⚠️  5m RSI too low (${rsi5m.toFixed(1)} < ${this.params.midRsiOversold}) - skipping PUT`);
            }
        } else {
            // RANGE: Mean Reversion with POST_CONFIRM
            strategyUsed = 'MEAN_REVERSION';

            if (breakoutAbove && rsi > this.params.rsiOverbought) {
                signal = 'PUT';
                console.log(`[HybridMTF] 🔄 RANGE MEAN REVERSION: Overbought → Expecting reversal DOWN (pending confirmation)`);
            } else if (breakoutBelow && rsi < this.params.rsiOversold) {
                signal = 'CALL';
                console.log(`[HybridMTF] 🔄 RANGE MEAN REVERSION: Oversold → Expecting reversal UP (pending confirmation)`);
            }
        }

        if (!signal) {
            console.log(`[HybridMTF] ⏳ No signal conditions met`);
            return null;
        }

        // For Momentum: Execute immediately
        if (strategyUsed === 'MOMENTUM') {
            this.lastTradeTime[asset] = now;
            return this.createSignal(
                signal,
                0.85,
                {
                    regime,
                    strategy: 'MOMENTUM',
                    entryPrice: candle.close,
                    takeProfit: signal === 'CALL'
                        ? candle.close * (1 + this.params.takeProfitPct)
                        : candle.close * (1 - this.params.takeProfitPct),
                    stopLoss: signal === 'CALL'
                        ? candle.close * (1 - this.params.stopLossPct)
                        : candle.close * (1 + this.params.stopLossPct),
                },
                asset
            );
        }

        // For Mean Reversion: Wait for confirmation
        this.pendingSignals[asset] = {
            direction: signal,
            entryPrice: candle.close,
            timestamp: now,
            candlesWaited: 0,
        };

        console.log(`[HybridMTF] ⏳ Mean Reversion signal pending confirmation (${signal})`);
        return null;
    }
}
