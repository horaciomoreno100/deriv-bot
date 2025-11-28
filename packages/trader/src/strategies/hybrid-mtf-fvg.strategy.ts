/**
 * Hybrid MTF + FVG Strategy v1.0.0
 *
 * Strategy: Combines Hybrid MTF (Momentum + Mean Reversion) with FVG (Fair Value Gap)
 *
 * LOGIC:
 * - 15m Context: Determines macro regime (BULLISH_TREND / BEARISH_TREND / RANGE)
 * - 5m Filter: RSI extremes filter (avoid buying tops/selling bottoms)
 * - 1m Execution: BB + RSI signals (Hybrid MTF) OR FVG signals (price action)
 *
 * THREE MODES:
 * 1. MOMENTUM: Trend following (BULLISH_TREND → CALL on pullbacks, BEARISH_TREND → PUT on pullbacks)
 * 2. MEAN_REVERSION: Range trading (RANGE → reversal signals with confirmation)
 * 3. FVG: Price action gaps (complementary to Hybrid MTF, 85% non-overlapping)
 *
 * FVG INTEGRATION:
 * - FVG acts as a complementary signal source
 * - When Hybrid MTF and FVG both signal → higher confidence
 * - When only FVG signals → still valid (complementary)
 * - FVG uses price action, Hybrid MTF uses indicators (low correlation)
 *
 * Backtest Results (30 days R_100):
 * - Hybrid MTF: 47.0% WR, $3,225 P&L, 268 trades
 * - FVG: 64.5% WR, $5,124 P&L, 349 trades
 * - Correlation: 12.9% (highly complementary)
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import { BollingerBands, ADX, SMA, RSI } from 'technicalindicators';
import { FVGStrategy, type FVGStrategyParams } from './fvg.strategy.js';

/**
 * Hybrid MTF + FVG Strategy Parameters
 */
export interface HybridMTFFVGParams {
    // Hybrid MTF Parameters
    ctxAdxPeriod: number;
    ctxAdxThreshold: number;
    ctxSmaPeriod: number;
    ctxSlopeThreshold: number;
    midRsiPeriod: number;
    midRsiOverbought: number;
    midRsiOversold: number;
    bbPeriod: number;
    bbStdDev: number;
    bbWidthMin: number;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;
    takeProfitPct: number;
    stopLossPct: number;
    confirmationCandles: number;

    // FVG Parameters
    fvgTimeframe: number;
    fvgMinGapSizePct: number;
    fvgMaxGapAgeBars: number;
    fvgMaxStoredGaps: number;
    fvgEntryZone: 'edge' | 'middle' | 'full';
    fvgRequireConfirmation: boolean;
    fvgConfirmationBars: number;
    fvgTakeProfitMultiple: number;
    fvgStopLossBuffer: number;
    fvgUseRSIFilter: boolean;

    // Strategy Selection
    enableMomentum: boolean;
    enableMeanReversion: boolean;
    enableFVG: boolean;
    fvgAsFilter: boolean;  // If true, FVG only confirms Hybrid MTF signals. If false, FVG can signal independently

    // Risk Management
    cooldownSeconds: number;
    minCandles: number;
    dynamicCooldownEnabled: boolean;
    cooldownAfter2Losses: number;
    cooldownAfter3Losses: number;
    cooldownAfter4PlusLosses: number;
    dailyLossLimitEnabled: boolean;
    dailyLossLimitPct: number;
}

/**
 * Macro regime detected from 15m context
 */
type MacroRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE';

/**
 * Signal source
 */
type SignalSource = 'MOMENTUM' | 'MEAN_REVERSION' | 'FVG' | 'HYBRID_MTF_FVG';

/**
 * Pending signal waiting for confirmation
 */
interface PendingSignal {
    direction: 'CALL' | 'PUT';
    entryPrice: number;
    timestamp: number;
    candlesWaited: number;
    source: SignalSource;
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
 * Default parameters
 */
const DEFAULT_PARAMS: HybridMTFFVGParams = {
    // Hybrid MTF
    ctxAdxPeriod: 10,
    ctxAdxThreshold: 20,
    ctxSmaPeriod: 20,
    ctxSlopeThreshold: 0.0002,
    midRsiPeriod: 14,
    midRsiOverbought: 70,
    midRsiOversold: 30,
    bbPeriod: 20,
    bbStdDev: 2,
    bbWidthMin: 0.003,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
    confirmationCandles: 2,

    // FVG
    fvgTimeframe: 5,
    fvgMinGapSizePct: 0.0015,
    fvgMaxGapAgeBars: 100,
    fvgMaxStoredGaps: 10,
    fvgEntryZone: 'edge',
    fvgRequireConfirmation: true,
    fvgConfirmationBars: 2,
    fvgTakeProfitMultiple: 1.5,
    fvgStopLossBuffer: 0.001,
    fvgUseRSIFilter: true,

    // Strategy Selection
    enableMomentum: true,
    enableMeanReversion: true,
    enableFVG: true,
    fvgAsFilter: false,  // FVG can signal independently

    // Risk Management
    cooldownSeconds: 60,
    minCandles: 100,
    dynamicCooldownEnabled: true,
    cooldownAfter2Losses: 600,
    cooldownAfter3Losses: 1800,
    cooldownAfter4PlusLosses: 3600,
    dailyLossLimitEnabled: true,
    dailyLossLimitPct: 0.05,
};

/**
 * Hybrid MTF + FVG Strategy
 *
 * Combines three complementary approaches:
 * 1. Momentum (trend following)
 * 2. Mean Reversion (range trading)
 * 3. FVG (price action gaps)
 */
export class HybridMTFFVGStrategy extends BaseStrategy {
    private params: HybridMTFFVGParams;
    private lastTradeTime: Record<string, number> = {};
    private pendingSignals: Record<string, PendingSignal | null> = {};

    // Hybrid MTF state
    private candles5m: Record<string, ResampledCandle[]> = {};
    private candles15m: Record<string, ResampledCandle[]> = {};
    private hasDirectCandles: Record<string, { has5m: boolean; has15m: boolean }> = {};

    // FVG state (we'll use FVGStrategy internally)
    private fvgStrategy: FVGStrategy;

    // Dynamic Cooldown state
    private consecutiveLosses: Record<string, number> = {};
    private dynamicCooldownUntil: Record<string, number> = {};

    // Daily Loss Limit state
    private dailyPnl: Record<string, number> = {};
    private currentTradingDay: Record<string, string> = {};

    constructor(config: StrategyConfig) {
        super(config);
        this.params = {
            ...DEFAULT_PARAMS,
            ...(config.parameters as Partial<HybridMTFFVGParams>),
        };

        // Create internal FVG strategy
        const fvgParams: Partial<FVGStrategyParams> = {
            fvgTimeframe: this.params.fvgTimeframe,
            minGapSizePct: this.params.fvgMinGapSizePct,
            maxGapAgeBars: this.params.fvgMaxGapAgeBars,
            maxStoredGaps: this.params.fvgMaxStoredGaps,
            entryZone: this.params.fvgEntryZone,
            requireConfirmation: this.params.fvgRequireConfirmation,
            confirmationBars: this.params.fvgConfirmationBars,
            takeProfitMultiple: this.params.fvgTakeProfitMultiple,
            stopLossBuffer: this.params.fvgStopLossBuffer,
            useRSIFilter: this.params.fvgUseRSIFilter,
            cooldownSeconds: 0,  // We handle cooldown at this level
        };

        this.fvgStrategy = new FVGStrategy({
            ...config,
            parameters: fvgParams,
        });
    }

    /**
     * Load direct higher timeframe candles from API
     */
    loadDirectCandles(asset: string, candles5m: Candle[], candles15m: Candle[]): void {
        // Load for Hybrid MTF
        const resampled5m: ResampledCandle[] = candles5m.map(c => ({
            timestamp: c.timestamp * 1000,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        })).sort((a, b) => a.timestamp - b.timestamp);

        const resampled15m: ResampledCandle[] = candles15m.map(c => ({
            timestamp: c.timestamp * 1000,
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

        // Also load for FVG (it needs HTF candles too)
        const fvgHtfCandles = this.params.fvgTimeframe === 5 ? candles5m : candles15m;
        this.fvgStrategy.loadDirectCandles(asset, fvgHtfCandles);

        console.log(`[HybridMTF+FVG] Loaded ${resampled5m.length} x 5m, ${resampled15m.length} x 15m candles for ${asset}`);
    }

    /**
     * Resample 1m candles to higher timeframe
     */
    private resampleCandles(candles1m: Candle[], intervalMinutes: number): ResampledCandle[] {
        const resampled: ResampledCandle[] = [];
        const intervalSeconds = intervalMinutes * 60;

        for (const candle of candles1m) {
            const slotStartSeconds = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;
            const slotStart = slotStartSeconds * 1000;

            let resampledCandle = resampled.find(c => c.timestamp === slotStart);

            if (!resampledCandle) {
                resampledCandle = {
                    timestamp: slotStart,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                };
                resampled.push(resampledCandle);
            } else {
                resampledCandle.high = Math.max(resampledCandle.high, candle.high);
                resampledCandle.low = Math.min(resampledCandle.low, candle.low);
                resampledCandle.close = candle.close;
            }
        }

        return resampled.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Detect macro regime from 15m context
     */
    private detectRegime(candles15m: ResampledCandle[]): MacroRegime | null {
        if (candles15m.length < Math.max(this.params.ctxAdxPeriod, this.params.ctxSmaPeriod) + 1) {
            return null;
        }

        const closes = candles15m.map(c => c.close);
        const highs = candles15m.map(c => c.high);
        const lows = candles15m.map(c => c.low);

        const adxResult = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: this.params.ctxAdxPeriod,
        });

        const smaResult = SMA.calculate({
            period: this.params.ctxSmaPeriod,
            values: closes,
        });

        if (adxResult.length === 0 || smaResult.length === 0) {
            return null;
        }

        const adx = adxResult[adxResult.length - 1]!;
        const sma = smaResult[smaResult.length - 1]!;
        const currentPrice = closes[closes.length - 1]!;
        const prevSma = smaResult[smaResult.length - 2];

        if (adx.adx < this.params.ctxAdxThreshold || !prevSma) {
            return 'RANGE';
        }

        const slope = (sma - prevSma) / prevSma;
        const isBullish = currentPrice > sma && slope > this.params.ctxSlopeThreshold;
        const isBearish = currentPrice < sma && slope < -this.params.ctxSlopeThreshold;

        if (isBullish && adx.pdi > adx.mdi) {
            return 'BULLISH_TREND';
        } else if (isBearish && adx.mdi > adx.pdi) {
            return 'BEARISH_TREND';
        }

        return 'RANGE';
    }

    /**
     * Check for FVG signal
     */
    private async checkFVGSignal(
        candle: Candle,
        context: StrategyContext,
        hybridSignal: 'CALL' | 'PUT' | null
    ): Promise<{ signal: 'CALL' | 'PUT' | null; source: SignalSource }> {
        if (!this.params.enableFVG) {
            return { signal: null, source: 'MOMENTUM' };
        }

        // Get FVG signal
        const fvgSignal = await this.fvgStrategy.onCandle(candle, context);

        if (!fvgSignal) {
            return { signal: null, source: 'MOMENTUM' };
        }

        // If FVG is used as filter, only return signal if Hybrid MTF also signals
        if (this.params.fvgAsFilter) {
            if (hybridSignal && fvgSignal.direction === hybridSignal) {
                return { signal: fvgSignal.direction, source: 'HYBRID_MTF_FVG' };
            }
            return { signal: null, source: 'MOMENTUM' };
        }

        // FVG can signal independently
        return { signal: fvgSignal.direction, source: 'FVG' };
    }

    /**
     * Main candle processing
     */
    async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
        const { candles } = context;
        const asset = candle.asset;
        const price = candle.close;

        // Need enough candles
        if (!candles || candles.length < this.params.minCandles) {
            return null;
        }

        // Initialize state
        this.initializeAssetState(asset);

        const now = Date.now();

        // Check daily loss limit
        if (this.params.dailyLossLimitEnabled) {
            const today = new Date().toISOString().slice(0, 10);
            if (this.currentTradingDay[asset] !== today) {
                this.currentTradingDay[asset] = today;
                this.dailyPnl[asset] = 0;
            }
        }

        // Check dynamic cooldown
        const cooldownUntil = this.dynamicCooldownUntil[asset] ?? 0;
        if (this.params.dynamicCooldownEnabled && now < cooldownUntil) {
            return null;
        }

        // Check regular cooldown
        const lastTrade = this.lastTradeTime[asset] ?? 0;
        const timeSinceLastTrade = now - lastTrade;
        const cooldownMs = this.params.cooldownSeconds * 1000;

        if (timeSinceLastTrade < cooldownMs) {
            return null;
        }

        // Get or resample higher timeframe candles
        let candles5m: ResampledCandle[];
        let candles15m: ResampledCandle[];

        if (this.hasDirectCandles[asset]?.has5m) {
            candles5m = this.candles5m[asset] ?? [];
        } else {
            candles5m = this.resampleCandles(candles, 5);
            this.candles5m[asset] = candles5m;
        }

        if (this.hasDirectCandles[asset]?.has15m) {
            candles15m = this.candles15m[asset] ?? [];
        } else {
            candles15m = this.resampleCandles(candles, 15);
            this.candles15m[asset] = candles15m;
        }

        // Detect regime
        const regime = this.detectRegime(candles15m);
        if (!regime) {
            return null;
        }

        // Calculate indicators
        const closes = candles.map(c => c.close);
        const bb = BollingerBands.calculate({
            period: this.params.bbPeriod,
            values: closes,
            stdDev: this.params.bbStdDev,
        });

        const rsi = RSI.calculate({
            period: this.params.rsiPeriod,
            values: closes,
        });

        if (bb.length === 0 || rsi.length === 0) {
            return null;
        }

        const bbLast = bb[bb.length - 1]!;
        const rsiLast = rsi[rsi.length - 1]!;

        // BB width filter
        const bbWidth = (bbLast.upper - bbLast.lower) / bbLast.middle;
        if (bbWidth < this.params.bbWidthMin) {
            return null;
        }

        // Calculate 5m RSI
        const closes5m = candles5m.map(c => c.close);
        const rsi5mAll = RSI.calculate({
            period: this.params.midRsiPeriod,
            values: closes5m,
        });
        const rsi5m = rsi5mAll.length > 0 ? rsi5mAll[rsi5mAll.length - 1]! : null;

        // Handle pending confirmation
        const pending = this.pendingSignals[asset];
        if (pending) {
            pending.candlesWaited++;

            if (pending.candlesWaited >= this.params.confirmationCandles) {
                const confirmed = pending.direction === 'CALL'
                    ? price > pending.entryPrice
                    : price < pending.entryPrice;

                if (confirmed) {
                    this.pendingSignals[asset] = null;
                    this.lastTradeTime[asset] = now;

                    return this.createSignal(
                        pending.direction,
                        pending.source === 'HYBRID_MTF_FVG' ? 0.9 : 0.8,
                        {
                            strategy: 'HybridMTF+FVG',
                            source: pending.source,
                            regime,
                            entryPrice: price,
                            takeProfit: price * (1 + (pending.direction === 'CALL' ? this.params.takeProfitPct : -this.params.takeProfitPct)),
                            stopLoss: price * (1 - (pending.direction === 'CALL' ? this.params.stopLossPct : -this.params.stopLossPct)),
                            rsi: rsiLast,
                            rsi5m: rsi5m,
                        },
                        asset
                    );
                } else {
                    this.pendingSignals[asset] = null;
                }
            }
            return null;
        }

        // Generate Hybrid MTF signal
        let hybridSignal: 'CALL' | 'PUT' | null = null;
        let strategyUsed: 'MOMENTUM' | 'MEAN_REVERSION' = 'MOMENTUM';

        const breakoutAbove = price > bbLast.upper;
        const breakoutBelow = price < bbLast.lower;
        const priceNearLowerBand = price <= bbLast.lower * 1.005;
        const priceNearUpperBand = price >= bbLast.upper * 0.995;

        if (regime === 'BULLISH_TREND' && this.params.enableMomentum) {
            if (rsi5m && rsi5m > this.params.midRsiOversold) {
                if (priceNearLowerBand && rsiLast < this.params.rsiOversold) {
                    hybridSignal = 'CALL';
                    strategyUsed = 'MOMENTUM';
                }
            }
        } else if (regime === 'BEARISH_TREND' && this.params.enableMomentum) {
            if (rsi5m && rsi5m > this.params.midRsiOversold) {
                if (priceNearUpperBand && rsiLast > this.params.rsiOverbought) {
                    hybridSignal = 'PUT';
                    strategyUsed = 'MOMENTUM';
                }
            }
        } else if (regime === 'RANGE' && this.params.enableMeanReversion) {
            if (breakoutAbove && rsiLast > this.params.rsiOverbought) {
                hybridSignal = 'PUT';
                strategyUsed = 'MEAN_REVERSION';
            } else if (breakoutBelow && rsiLast < this.params.rsiOversold) {
                hybridSignal = 'CALL';
                strategyUsed = 'MEAN_REVERSION';
            }
        }

        // Check FVG signal
        const fvgResult = await this.checkFVGSignal(candle, context, hybridSignal);

        // Determine final signal
        let finalSignal: 'CALL' | 'PUT' | null = null;
        let finalSource: SignalSource = strategyUsed;

        if (hybridSignal && fvgResult.signal && hybridSignal === fvgResult.signal) {
            // Both agree - highest confidence
            finalSignal = hybridSignal;
            finalSource = 'HYBRID_MTF_FVG';
        } else if (hybridSignal) {
            // Only Hybrid MTF
            finalSignal = hybridSignal;
            finalSource = strategyUsed;
        } else if (fvgResult.signal) {
            // Only FVG (if enabled independently)
            finalSignal = fvgResult.signal;
            finalSource = fvgResult.source;
        }

        if (!finalSignal) {
            return null;
        }

        // For Mean Reversion, require confirmation
        if (strategyUsed === 'MEAN_REVERSION' && finalSource !== 'FVG') {
            this.pendingSignals[asset] = {
                direction: finalSignal,
                entryPrice: price,
                timestamp: now,
                candlesWaited: 0,
                source: finalSource,
            };
            return null;
        }

        // Execute immediately for Momentum or FVG
        this.lastTradeTime[asset] = now;

        const confidence = finalSource === 'HYBRID_MTF_FVG' ? 0.9 : 
                          finalSource === 'FVG' ? 0.8 : 
                          0.75;

        return this.createSignal(
            finalSignal,
            confidence,
            {
                strategy: 'HybridMTF+FVG',
                source: finalSource,
                regime,
                entryPrice: price,
                takeProfit: price * (1 + (finalSignal === 'CALL' ? this.params.takeProfitPct : -this.params.takeProfitPct)),
                stopLoss: price * (1 - (finalSignal === 'CALL' ? this.params.stopLossPct : -this.params.stopLossPct)),
                rsi: rsiLast,
                rsi5m: rsi5m,
            },
            asset
        );
    }

    /**
     * Initialize state for an asset
     */
    private initializeAssetState(asset: string): void {
        if (this.lastTradeTime[asset] === undefined) this.lastTradeTime[asset] = 0;
        if (!this.candles5m[asset]) this.candles5m[asset] = [];
        if (!this.candles15m[asset]) this.candles15m[asset] = [];
        if (!this.hasDirectCandles[asset]) this.hasDirectCandles[asset] = { has5m: false, has15m: false };
        if (this.consecutiveLosses[asset] === undefined) this.consecutiveLosses[asset] = 0;
        if (this.dynamicCooldownUntil[asset] === undefined) this.dynamicCooldownUntil[asset] = 0;
        if (this.dailyPnl[asset] === undefined) this.dailyPnl[asset] = 0;
        if (!this.currentTradingDay[asset]) this.currentTradingDay[asset] = '';
    }

    /**
     * Report trade result for dynamic cooldown
     */
    reportTradeResult(asset: string, pnl: number, isWin: boolean): void {
        this.initializeAssetState(asset);

        this.dailyPnl[asset] = (this.dailyPnl[asset] ?? 0) + pnl;

        if (isWin) {
            this.consecutiveLosses[asset] = 0;
            this.dynamicCooldownUntil[asset] = 0;
        } else {
            this.consecutiveLosses[asset] = (this.consecutiveLosses[asset] ?? 0) + 1;

            if (this.params.dynamicCooldownEnabled) {
                let cooldownSeconds = 0;

                if ((this.consecutiveLosses[asset] ?? 0) >= 4) {
                    cooldownSeconds = this.params.cooldownAfter4PlusLosses;
                } else if (this.consecutiveLosses[asset] === 3) {
                    cooldownSeconds = this.params.cooldownAfter3Losses;
                } else if (this.consecutiveLosses[asset] === 2) {
                    cooldownSeconds = this.params.cooldownAfter2Losses;
                }

                if (cooldownSeconds > 0) {
                    this.dynamicCooldownUntil[asset] = Date.now() + (cooldownSeconds * 1000);
                }
            }
        }
    }
}

