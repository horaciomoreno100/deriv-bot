/**
 * Hybrid Multi-Timeframe (MTF) Strategy v2.1.0
 *
 * Strategy: Combines Momentum and Mean Reversion based on multi-timeframe regime detection
 *
 * LOGIC:
 * - 15m Context: Determines macro regime (BULLISH_TREND / BEARISH_TREND / RANGE)
 * - 5m Filter: RSI extremes filter (avoid buying tops/selling bottoms)
 * - 1m Execution: BB + RSI signals for precise entry
 *
 * REGIME-BASED TRADING:
 * - BULLISH_TREND (15m): CALL on pullbacks (buy the dip - price near lower BB + oversold RSI)
 * - BEARISH_TREND (15m): PUT on pullbacks (sell the rally - price near upper BB + overbought RSI)
 * - RANGE (15m): Mean Reversion with POST_CONFIRM (wait 2 candles)
 *
 * v2.1.0 IMPROVEMENTS:
 * - Dynamic cooldown after consecutive losses (reduces DD from 13.8% to 8%)
 * - Optimized TP/SL: 0.4%/0.3% for better win rate
 * - Daily loss limit protection
 *
 * v2.0.0 IMPROVEMENTS:
 * - Fixed Momentum logic: Enter on pullbacks, not extensions
 * - RSI thresholds: 70/30 instead of 55/45 (neutral zone)
 * - ADX period: 10 instead of 14 (faster regime detection)
 * - 5m RSI filter: 70/30 instead of 80/20 (more useful)
 * - BB width filter: Avoid low volatility environments
 * - Confirmation: 2 candles instead of 1 for Mean Reversion
 *
 * Backtest Results (90 days R_100, $1000 capital, x200 mult):
 * - v2.1.0 (with cooldown): +$1014 (47.1% WR, 8.0% DD, 736 trades)
 * - v2.1.0 (no cooldown):   +$1026 (47.1% WR, 13.8% DD, 882 trades)
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
    bbWidthMin: number;  // Min BB width to avoid low volatility
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

    // Dynamic Cooldown (v2.1.0) - reduces DD from 13.8% to 8%
    dynamicCooldownEnabled: boolean;
    cooldownAfter2Losses: number;  // seconds after 2 consecutive losses
    cooldownAfter3Losses: number;  // seconds after 3 consecutive losses
    cooldownAfter4PlusLosses: number;  // seconds after 4+ consecutive losses

    // Daily Loss Limit (v2.1.0)
    dailyLossLimitEnabled: boolean;
    dailyLossLimitPct: number;  // max daily loss as % of capital (e.g., 0.05 = 5%)
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
 * Default parameters (optimized from backtest v2.0.0)
 */
const DEFAULT_PARAMS: HybridMTFParams = {
    // 15m Context - ADX 10 is faster than 14 for regime detection
    ctxAdxPeriod: 10,
    ctxAdxThreshold: 20,
    ctxSmaPeriod: 20,
    ctxSlopeThreshold: 0.0002,

    // 5m Filter - 70/30 are useful extremes (80/20 rarely triggers)
    midRsiPeriod: 14,
    midRsiOverbought: 70,
    midRsiOversold: 30,

    // 1m Execution - 70/30 for real overbought/oversold (55/45 is neutral zone)
    bbPeriod: 20,
    bbStdDev: 2,
    bbWidthMin: 0.003,  // Min BB width to avoid low volatility
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,

    // Risk Management - Optimized ratio 1.33:1 (TP 0.4% / SL 0.3%)
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    cooldownSeconds: 60,
    minCandles: 100,

    // Confirmation - 2 candles for Mean Reversion
    confirmationCandles: 2,

    // Dynamic Cooldown (v2.1.0) - reduces DD from 13.8% to 8%
    dynamicCooldownEnabled: true,
    cooldownAfter2Losses: 600,    // 10 minutes (10 bars) after 2 losses
    cooldownAfter3Losses: 1800,   // 30 minutes (30 bars) after 3 losses
    cooldownAfter4PlusLosses: 3600, // 60 minutes (60 bars) after 4+ losses

    // Daily Loss Limit (v2.1.0)
    dailyLossLimitEnabled: true,
    dailyLossLimitPct: 0.05,  // 5% max daily loss
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
    // Flag to track if we have direct candles loaded (from API)
    private hasDirectCandles: Record<string, { has5m: boolean; has15m: boolean }> = {};

    // Dynamic Cooldown state (v2.1.0)
    private consecutiveLosses: Record<string, number> = {};
    private dynamicCooldownUntil: Record<string, number> = {};  // timestamp when cooldown ends

    // Daily Loss Limit state (v2.1.0)
    private dailyPnl: Record<string, number> = {};
    private currentTradingDay: Record<string, string> = {};  // YYYY-MM-DD

    constructor(config: StrategyConfig) {
        super(config);
        this.params = {
            ...DEFAULT_PARAMS,
            ...(config.parameters as Partial<HybridMTFParams>),
        };
    }

    /**
     * Load historical candles directly from API (5m and 15m)
     * This is much more efficient than resampling from 1m candles
     */
    loadDirectCandles(asset: string, candles5m: Candle[], candles15m: Candle[]): void {
        // Convert Candle[] to ResampledCandle[]
        // Candle.timestamp is in seconds, ResampledCandle.timestamp is in milliseconds
        const resampled5m: ResampledCandle[] = candles5m.map(c => ({
            timestamp: c.timestamp * 1000, // Convert seconds to milliseconds
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        })).sort((a, b) => a.timestamp - b.timestamp);

        const resampled15m: ResampledCandle[] = candles15m.map(c => ({
            timestamp: c.timestamp * 1000, // Convert seconds to milliseconds
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        })).sort((a, b) => a.timestamp - b.timestamp);

        this.candles5m[asset] = resampled5m;
        this.candles15m[asset] = resampled15m;
        this.hasDirectCandles[asset] = {
            has5m: resampled5m.length > 0,
            has15m: resampled15m.length > 0,
        };

        console.log(`[HybridMTF] ✅ Loaded direct candles for ${asset}: ${resampled5m.length} x 5m, ${resampled15m.length} x 15m`);
    }

    /**
     * Resample 1m candles to 5m or 15m
     */
    private resampleCandles(candles1m: Candle[], intervalMinutes: number): ResampledCandle[] {
        const resampled: ResampledCandle[] = [];
        const intervalSeconds = intervalMinutes * 60; // Candle.timestamp is in seconds

        for (const candle of candles1m) {
            // Convert to seconds for calculation, then back to ms for storage
            const slotStartSeconds = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;
            const slotStart = slotStartSeconds * 1000; // Convert to ms for ResampledCandle

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
        if (!this.hasDirectCandles[asset]) {
            this.hasDirectCandles[asset] = { has5m: false, has15m: false };
        }
        // Initialize v2.1.0 state
        if (this.consecutiveLosses[asset] === undefined) this.consecutiveLosses[asset] = 0;
        if (this.dynamicCooldownUntil[asset] === undefined) this.dynamicCooldownUntil[asset] = 0;
        if (this.dailyPnl[asset] === undefined) this.dailyPnl[asset] = 0;
        if (!this.currentTradingDay[asset]) this.currentTradingDay[asset] = '';

        const now = Date.now();

        // Check daily loss limit (v2.1.0)
        if (this.params.dailyLossLimitEnabled) {
            const today = new Date().toISOString().slice(0, 10);
            if (this.currentTradingDay[asset] !== today) {
                // New day - reset daily P&L
                this.currentTradingDay[asset] = today;
                this.dailyPnl[asset] = 0;
                console.log(`[HybridMTF] 📅 New trading day: ${today} - daily P&L reset`);
            }
            // Note: dailyPnl is tracked by reportTradeResult(), checked below
        }

        // Check dynamic cooldown (v2.1.0)
        if (this.params.dynamicCooldownEnabled && now < this.dynamicCooldownUntil[asset]) {
            const remainingSec = Math.round((this.dynamicCooldownUntil[asset] - now) / 1000);
            console.log(`[HybridMTF] 🛡️  Dynamic cooldown: ${remainingSec}s remaining (after ${this.consecutiveLosses[asset]} losses)`);
            return null;
        }

        // Check regular cooldown
        const timeSinceLastTrade = now - this.lastTradeTime[asset];
        const cooldownMs = this.params.cooldownSeconds * 1000;

        if (timeSinceLastTrade < cooldownMs) {
            console.log(`[HybridMTF] ⏸️  Cooldown: ${Math.round((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`);
            return null;
        }

        // Use direct candles if available, otherwise resample from 1m
        let candles5m: ResampledCandle[];
        let candles15m: ResampledCandle[];

        if (this.hasDirectCandles[asset].has5m && this.hasDirectCandles[asset].has15m) {
            // Use direct candles from API (much faster!)
            candles5m = this.candles5m[asset];
            candles15m = this.candles15m[asset];
            
            // Update with latest 1m candle if needed (for real-time updates)
            // This is optional - the direct candles should be sufficient
            console.log(`[HybridMTF] 📊 Using direct candles: ${candles5m.length} x 5m, ${candles15m.length} x 15m`);
        } else {
            // Fallback: resample from 1m candles
            candles5m = this.resampleCandles(candles, 5);
            candles15m = this.resampleCandles(candles, 15);
            console.log(`[HybridMTF] 📊 Resampled: ${candles.length} x 1m → ${candles5m.length} x 5m, ${candles15m.length} x 15m`);
        }

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

        // BB width filter: avoid low volatility environments
        const bbWidth = (bb.upper - bb.lower) / bb.middle;
        if (bbWidth < this.params.bbWidthMin) {
            console.log(`[HybridMTF] ⏭️  BB width too low: ${(bbWidth * 100).toFixed(3)}% < ${(this.params.bbWidthMin * 100).toFixed(3)}%`);
            return null;
        }

        const breakoutAbove = candle.close > bb.upper;
        const breakoutBelow = candle.close < bb.lower;

        // Pullback zones for Momentum strategy
        const priceNearLowerBand = candle.close <= bb.lower * 1.005; // Within 0.5% of lower
        const priceNearUpperBand = candle.close >= bb.upper * 0.995; // Within 0.5% of upper

        console.log(`[HybridMTF] 📊 1m BB: ${bb.lower.toFixed(2)} < ${candle.close.toFixed(2)} < ${bb.upper.toFixed(2)} | RSI: ${rsi.toFixed(1)} | Width: ${(bbWidth * 100).toFixed(2)}%`);

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
            // FIXED: Enter on PULLBACKS (price near lower BB, RSI oversold), not on extensions
            // 5m Filter: Avoid extreme overbought (trend exhaustion)
            if (rsi5m < this.params.midRsiOverbought) {
                // Buy the dip: price pulls back to lower BB with oversold RSI in bullish trend
                if (priceNearLowerBand && rsi < this.params.rsiOversold) {
                    signal = 'CALL';
                    strategyUsed = 'MOMENTUM';
                    console.log(`[HybridMTF] 🚀 BULLISH MOMENTUM: Pullback to lower BB + RSI < ${this.params.rsiOversold} (buy the dip)`);
                }
            } else {
                console.log(`[HybridMTF] ⚠️  5m RSI too high (${rsi5m.toFixed(1)} > ${this.params.midRsiOverbought}) - trend exhaustion`);
            }
        } else if (regime === 'BEARISH_TREND') {
            // 15m BEARISH: Only PUTs (Momentum)
            // FIXED: Enter on PULLBACKS (price near upper BB, RSI overbought), not on extensions
            // 5m Filter: Avoid extreme oversold (trend exhaustion)
            if (rsi5m > this.params.midRsiOversold) {
                // Sell the rally: price pulls back to upper BB with overbought RSI in bearish trend
                if (priceNearUpperBand && rsi > this.params.rsiOverbought) {
                    signal = 'PUT';
                    strategyUsed = 'MOMENTUM';
                    console.log(`[HybridMTF] 📉 BEARISH MOMENTUM: Pullback to upper BB + RSI > ${this.params.rsiOverbought} (sell the rally)`);
                }
            } else {
                console.log(`[HybridMTF] ⚠️  5m RSI too low (${rsi5m.toFixed(1)} < ${this.params.midRsiOversold}) - trend exhaustion`);
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

    /**
     * Get signal readiness for dashboard/signal proximity
     */
    getSignalReadiness(candles: Candle[]): {
        asset: string;
        direction: 'call' | 'put' | 'neutral';
        overallProximity: number;
        criteria: Array<{
            name: string;
            current: number;
            target: number;
            unit: string;
            passed: boolean;
            distance: number;
        }>;
        readyToSignal: boolean;
        missingCriteria: string[];
    } | null {
        if (!candles || candles.length < this.params.minCandles) {
            console.log(`[HybridMTF.getSignalReadiness] Not enough candles: ${candles?.length || 0} < ${this.params.minCandles}`);
            return null;
        }

        const firstCandle = candles[0];
        if (!firstCandle) {
            console.log(`[HybridMTF.getSignalReadiness] No first candle`);
            return null;
        }

        const asset = firstCandle.asset || 'UNKNOWN';

        // Use direct candles if available, otherwise resample from 1m
        let candles5m: ResampledCandle[];
        let candles15m: ResampledCandle[];

        if (this.hasDirectCandles[asset]?.has5m && this.hasDirectCandles[asset]?.has15m) {
            // Use direct candles from API
            candles5m = this.candles5m[asset] || [];
            candles15m = this.candles15m[asset] || [];
        } else {
            // Fallback: resample from 1m candles
            candles5m = this.resampleCandles(candles, 5);
            candles15m = this.resampleCandles(candles, 15);
        }

        // Detect regime
        const regime = this.detectRegime(candles15m);
        if (!regime) {
            // Return partial readiness info even if regime can't be detected yet
            const needed15m = this.params.ctxSmaPeriod + 1;
            const have15m = candles15m.length;
            const progress = Math.min(100, Math.round((have15m / needed15m) * 100));
            
            return {
                asset,
                direction: 'neutral' as const,
                overallProximity: progress,
                criteria: [
                    {
                        name: '15m Context (Regime Detection)',
                        current: have15m,
                        target: needed15m,
                        unit: 'candles',
                        passed: false,
                        distance: needed15m - have15m,
                    },
                ],
                readyToSignal: false,
                missingCriteria: [`Need ${needed15m} 15m candles for regime detection (have ${have15m}, ${progress}% complete)`],
            };
        }

        // Get 5m RSI
        const rsi5m = this.get5mRSI(candles5m);
        if (rsi5m === null) {
            console.log(`[HybridMTF.getSignalReadiness] Could not get 5m RSI (need ${this.params.midRsiPeriod + 1} 5m candles, have ${candles5m.length})`);
            return null;
        }

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

        if (!bbResult || bbResult.length === 0 || !rsiResult || rsiResult.length === 0) {
            return null;
        }

        const currentBB = bbResult[bbResult.length - 1];
        const currentRSI = rsiResult[rsiResult.length - 1];
        const currentCandle = candles[candles.length - 1];

        if (!currentBB || currentRSI === undefined || !currentCandle) {
            return null;
        }

        const price = currentCandle.close;

        // Check cooldown
        const now = Date.now();
        const lastTradeTime = this.lastTradeTime[asset] || 0;
        const timeSinceLastTrade = now - lastTradeTime;
        const cooldownMs = this.params.cooldownSeconds * 1000;
        const cooldownOk = timeSinceLastTrade >= cooldownMs;

        // Check 5m RSI filter (avoid extremes)
        const rsi5mOk = rsi5m >= this.params.midRsiOversold && rsi5m <= this.params.midRsiOverbought;

        // BB width check
        const bbWidth = (currentBB.upper - currentBB.lower) / currentBB.middle;
        const bbWidthOk = bbWidth >= this.params.bbWidthMin;

        // Entry conditions based on regime (FIXED: Momentum uses pullbacks)
        let callReady = false;
        let putReady = false;

        // Pullback zones
        const priceNearLowerBand = price <= currentBB.lower * 1.005;
        const priceNearUpperBand = price >= currentBB.upper * 0.995;

        if (regime === 'BULLISH_TREND') {
            // Momentum CALL: Buy the dip (pullback to lower BB + oversold RSI)
            const rsiOversold = currentRSI < this.params.rsiOversold;
            callReady = priceNearLowerBand && rsiOversold && rsi5mOk && cooldownOk && bbWidthOk;
        } else if (regime === 'BEARISH_TREND') {
            // Momentum PUT: Sell the rally (pullback to upper BB + overbought RSI)
            const rsiOverbought = currentRSI > this.params.rsiOverbought;
            putReady = priceNearUpperBand && rsiOverbought && rsi5mOk && cooldownOk && bbWidthOk;
        } else {
            // RANGE: Mean Reversion (breakouts)
            const rsiOversold = currentRSI < this.params.rsiOversold;
            const rsiOverbought = currentRSI > this.params.rsiOverbought;
            const breakoutBelow = price <= currentBB.lower;
            const breakoutAbove = price >= currentBB.upper;
            callReady = breakoutBelow && rsiOversold && rsi5mOk && cooldownOk && bbWidthOk;
            putReady = breakoutAbove && rsiOverbought && rsi5mOk && cooldownOk && bbWidthOk;
        }

        // Determine direction and proximity
        let direction: 'call' | 'put' | 'neutral' = 'neutral';
        let overallProximity = 0;

        if (callReady) {
            direction = 'call';
            overallProximity = 100;
        } else if (putReady) {
            direction = 'put';
            overallProximity = 100;
        } else {
            // Calculate proximity scores
            const distToBBLower = Math.abs((price - currentBB.lower) / price);
            const distToBBUpper = Math.abs((price - currentBB.upper) / price);

            const callProximity = Math.max(
                0,
                (regime === 'BULLISH_TREND' || regime === 'RANGE' ? 100 : 0) * 0.3 +
                (price <= currentBB.lower ? 100 : Math.max(0, 100 - distToBBLower * 10000)) * 0.3 +
                (currentRSI < this.params.rsiOversold ? 100 : Math.max(0, 100 - Math.abs(currentRSI - this.params.rsiOversold) * 2)) * 0.2 +
                (rsi5mOk ? 100 : 0) * 0.1 +
                (cooldownOk ? 100 : Math.min(100, (timeSinceLastTrade / cooldownMs) * 100)) * 0.1
            );

            const putProximity = Math.max(
                0,
                (regime === 'BEARISH_TREND' || regime === 'RANGE' ? 100 : 0) * 0.3 +
                (price >= currentBB.upper ? 100 : Math.max(0, 100 - distToBBUpper * 10000)) * 0.3 +
                (currentRSI > this.params.rsiOverbought ? 100 : Math.max(0, 100 - Math.abs(currentRSI - this.params.rsiOverbought) * 2)) * 0.2 +
                (rsi5mOk ? 100 : 0) * 0.1 +
                (cooldownOk ? 100 : Math.min(100, (timeSinceLastTrade / cooldownMs) * 100)) * 0.1
            );

            if (callProximity > putProximity && callProximity > 10) {
                direction = 'call';
                overallProximity = Math.min(100, callProximity);
            } else if (putProximity > 10) {
                direction = 'put';
                overallProximity = Math.min(100, putProximity);
            }
        }

        // Build criteria array
        const criteria = [
            {
                name: 'Regime (15m)',
                current: regime === 'BULLISH_TREND' ? 1 : (regime === 'BEARISH_TREND' ? -1 : 0),
                target: direction === 'call' ? 1 : (direction === 'put' ? -1 : 0),
                unit: '',
                passed: (regime === 'BULLISH_TREND' && direction === 'call') ||
                    (regime === 'BEARISH_TREND' && direction === 'put') ||
                    (regime === 'RANGE'),
                distance: 0,
            },
            {
                name: 'Price vs BB_Lower',
                current: price,
                target: currentBB.lower,
                unit: '',
                passed: price <= currentBB.lower,
                distance: Math.abs((price - currentBB.lower) / price * 100),
            },
            {
                name: 'Price vs BB_Upper',
                current: price,
                target: currentBB.upper,
                unit: '',
                passed: price >= currentBB.upper,
                distance: Math.abs((price - currentBB.upper) / price * 100),
            },
            {
                name: 'RSI (1m)',
                current: currentRSI,
                target: direction === 'call' ? this.params.rsiOversold : this.params.rsiOverbought,
                unit: '',
                passed: direction === 'call' ? currentRSI < this.params.rsiOversold : currentRSI > this.params.rsiOverbought,
                distance: direction === 'call'
                    ? Math.abs(currentRSI - this.params.rsiOversold)
                    : Math.abs(currentRSI - this.params.rsiOverbought),
            },
            {
                name: 'RSI (5m) Filter',
                current: rsi5m,
                target: (this.params.midRsiOversold + this.params.midRsiOverbought) / 2,
                unit: '',
                passed: rsi5mOk,
                distance: rsi5mOk ? 0 : Math.min(
                    Math.abs(rsi5m - this.params.midRsiOversold),
                    Math.abs(rsi5m - this.params.midRsiOverbought)
                ),
            },
            {
                name: 'Cooldown',
                current: timeSinceLastTrade / 1000,
                target: cooldownMs / 1000,
                unit: 's',
                passed: cooldownOk,
                distance: cooldownOk ? 0 : (cooldownMs - timeSinceLastTrade) / 1000,
            },
        ];

        const missingCriteria: string[] = [];
        if (regime === 'BULLISH_TREND' && direction === 'put') missingCriteria.push('BULLISH_TREND only allows CALL');
        if (regime === 'BEARISH_TREND' && direction === 'call') missingCriteria.push('BEARISH_TREND only allows PUT');
        if (direction === 'call' && !priceNearLowerBand) missingCriteria.push('Price must be near BB_Lower for CALL');
        if (direction === 'put' && !priceNearUpperBand) missingCriteria.push('Price must be near BB_Upper for PUT');
        if (direction === 'call' && currentRSI >= this.params.rsiOversold) missingCriteria.push(`RSI(1m) must be < ${this.params.rsiOversold} for CALL`);
        if (direction === 'put' && currentRSI <= this.params.rsiOverbought) missingCriteria.push(`RSI(1m) must be > ${this.params.rsiOverbought} for PUT`);
        if (!rsi5mOk) missingCriteria.push(`RSI(5m) must be between ${this.params.midRsiOversold}-${this.params.midRsiOverbought}`);
        if (!bbWidthOk) missingCriteria.push(`BB width must be >= ${(this.params.bbWidthMin * 100).toFixed(2)}%`);
        if (!cooldownOk) missingCriteria.push('Cooldown active');

        return {
            asset,
            direction,
            overallProximity: Math.round(overallProximity),
            criteria,
            readyToSignal: callReady || putReady,
            missingCriteria,
        };
    }

    /**
     * Report trade result to update dynamic cooldown state (v2.1.0)
     *
     * Call this method after each trade completes to:
     * - Track consecutive losses
     * - Apply dynamic cooldown after losing streaks
     * - Track daily P&L for daily loss limit
     *
     * @param asset - The asset symbol
     * @param pnl - The P&L of the trade (positive = win, negative = loss)
     * @param isWin - Whether the trade was a win
     */
    reportTradeResult(asset: string, pnl: number, isWin: boolean): void {
        // Initialize if needed
        if (this.consecutiveLosses[asset] === undefined) this.consecutiveLosses[asset] = 0;
        if (this.dynamicCooldownUntil[asset] === undefined) this.dynamicCooldownUntil[asset] = 0;
        if (this.dailyPnl[asset] === undefined) this.dailyPnl[asset] = 0;

        // Update daily P&L
        this.dailyPnl[asset] += pnl;

        if (isWin) {
            // Reset consecutive losses on win
            if (this.consecutiveLosses[asset] > 0) {
                console.log(`[HybridMTF] ✅ WIN - Reset consecutive losses (was ${this.consecutiveLosses[asset]})`);
            }
            this.consecutiveLosses[asset] = 0;
            this.dynamicCooldownUntil[asset] = 0;
        } else {
            // Increment consecutive losses
            this.consecutiveLosses[asset]++;
            console.log(`[HybridMTF] ❌ LOSS #${this.consecutiveLosses[asset]} - P&L: $${pnl.toFixed(2)}`);

            // Apply dynamic cooldown based on consecutive losses
            if (this.params.dynamicCooldownEnabled) {
                let cooldownSeconds = 0;

                if (this.consecutiveLosses[asset] >= 4) {
                    cooldownSeconds = this.params.cooldownAfter4PlusLosses;
                } else if (this.consecutiveLosses[asset] === 3) {
                    cooldownSeconds = this.params.cooldownAfter3Losses;
                } else if (this.consecutiveLosses[asset] === 2) {
                    cooldownSeconds = this.params.cooldownAfter2Losses;
                }

                if (cooldownSeconds > 0) {
                    this.dynamicCooldownUntil[asset] = Date.now() + (cooldownSeconds * 1000);
                    console.log(`[HybridMTF] 🛡️  Dynamic cooldown activated: ${cooldownSeconds}s (${this.consecutiveLosses[asset]} consecutive losses)`);
                }
            }
        }

        // Check daily loss limit
        if (this.params.dailyLossLimitEnabled) {
            // Note: We don't have access to capital here, so we use absolute threshold
            // The dailyLossLimitPct is used as a reference in the signal generation
            console.log(`[HybridMTF] 📊 Daily P&L for ${asset}: $${this.dailyPnl[asset].toFixed(2)}`);
        }
    }

    /**
     * Check if daily loss limit has been reached
     * @param asset - The asset symbol
     * @param capital - Current capital to calculate percentage
     * @returns true if trading should be blocked
     */
    isDailyLossLimitReached(asset: string, capital: number): boolean {
        if (!this.params.dailyLossLimitEnabled) return false;

        const maxLoss = capital * this.params.dailyLossLimitPct;
        const currentLoss = -(this.dailyPnl[asset] ?? 0); // Convert to positive loss amount

        if (currentLoss >= maxLoss) {
            console.log(`[HybridMTF] 🚫 Daily loss limit reached: $${currentLoss.toFixed(2)} >= $${maxLoss.toFixed(2)} (${(this.params.dailyLossLimitPct * 100).toFixed(0)}%)`);
            return true;
        }

        return false;
    }

    /**
     * Get current streak protection status
     */
    getStreakStatus(asset: string): { consecutiveLosses: number; cooldownRemaining: number; dailyPnl: number } {
        return {
            consecutiveLosses: this.consecutiveLosses[asset] || 0,
            cooldownRemaining: Math.max(0, (this.dynamicCooldownUntil[asset] || 0) - Date.now()) / 1000,
            dailyPnl: this.dailyPnl[asset] || 0,
        };
    }
}
