/**
 * Fair Value Gap (FVG) Strategy v1.0.0
 *
 * Strategy: Trade price returns to Fair Value Gaps (imbalances in order flow)
 *
 * THEORY:
 * - FVG = Price moved so fast it left a "gap" (no overlap between candle 1 high and candle 3 low)
 * - Price tends to return to fill these gaps before continuing
 * - Entry when price returns to the FVG zone (mitigation)
 *
 * LOGIC:
 * - Detect FVGs on higher timeframe (5m or 15m)
 * - Wait for price to return to FVG zone on 1m
 * - Enter with confirmation (rejection candle or RSI filter)
 * - TP: Opposite side of FVG or extension
 * - SL: Beyond the full FVG (invalidation)
 *
 * FVG DETECTION:
 * - Bullish FVG: Candle3.low > Candle1.high (gap up)
 * - Bearish FVG: Candle3.high < Candle1.low (gap down)
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import { RSI } from 'technicalindicators';

/**
 * FVG Strategy Parameters
 */
export interface FVGStrategyParams {
    // FVG Detection
    fvgTimeframe: number;           // 5 or 15 (minutes)
    minGapSizePct: number;          // 0.001 = 0.1% minimum gap size
    maxGapAgeBars: number;          // Max age in bars before FVG expires
    maxStoredGaps: number;          // Max FVGs to track per direction

    // Entry Configuration
    entryZone: 'edge' | 'middle' | 'full';  // Where to enter in the FVG
    requireConfirmation: boolean;    // Wait for rejection candle
    confirmationBars: number;        // Bars to wait for confirmation

    // Risk Management
    takeProfitMultiple: number;      // TP at X times the gap size
    stopLossBuffer: number;          // Extra % beyond FVG for SL
    cooldownSeconds: number;         // Min seconds between trades
    minCandles: number;              // Min candles before trading

    // Filters
    useRSIFilter: boolean;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;
    useTrendFilter: boolean;         // Only FVGs in trend direction
    trendSmaPeriod: number;          // SMA period for trend detection

    // Dynamic Cooldown (from v2.1.0)
    dynamicCooldownEnabled: boolean;
    cooldownAfter2Losses: number;
    cooldownAfter3Losses: number;
    cooldownAfter4PlusLosses: number;

    // Daily Loss Limit
    dailyLossLimitEnabled: boolean;
    dailyLossLimitPct: number;
}

/**
 * Fair Value Gap data structure
 * 
 * Note: For compatibility, you can access:
 * - top = upperPrice
 * - bottom = lowerPrice  
 * - midpoint = midPrice
 * - size = gapSize
 */
export interface FairValueGap {
    id: string;                      // Unique identifier
    type: 'BULLISH' | 'BEARISH';     // Gap direction
    upperPrice: number;              // Top of the gap
    lowerPrice: number;              // Bottom of the gap
    midPrice: number;                // Middle (50% mitigation point)
    gapSize: number;                 // Size in price units
    gapSizePct: number;              // Size as percentage
    createdAt: number;               // Timestamp when detected
    createdBarIndex: number;         // Bar index when created
    status: 'active' | 'tested' | 'mitigated' | 'invalidated';
    mitigationLevel: number;         // How much has been filled (0-100%)
    testedAt?: number;               // Timestamp when price first entered the gap
    mitigatedAt?: number;            // Timestamp when price filled 50%+ of the gap
    invalidatedAt?: number;          // Timestamp when FVG was invalidated
    sourceCandles: {                 // The 3 candles that formed the FVG
        candle1: { high: number; low: number; timestamp: number };
        candle2: { high: number; low: number; timestamp: number };
        candle3: { high: number; low: number; timestamp: number };
    };
}

/**
 * Pending entry waiting for confirmation
 */
interface PendingEntry {
    fvg: FairValueGap;
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
 * Default parameters (conservative settings)
 */
const DEFAULT_PARAMS: FVGStrategyParams = {
    // FVG Detection - 5m timeframe, 0.15% min gap
    fvgTimeframe: 5,
    minGapSizePct: 0.0015,
    maxGapAgeBars: 100,
    maxStoredGaps: 10,

    // Entry - Middle of FVG with confirmation
    entryZone: 'middle',
    requireConfirmation: true,
    confirmationBars: 2,

    // Risk Management - 1.5:1 R:R ratio
    takeProfitMultiple: 1.5,
    stopLossBuffer: 0.001,          // 0.1% buffer beyond FVG
    cooldownSeconds: 60,
    minCandles: 100,

    // Filters - RSI confirmation
    useRSIFilter: true,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    useTrendFilter: false,          // Allow counter-trend FVGs
    trendSmaPeriod: 50,

    // Dynamic Cooldown (same as Hybrid MTF v2.1.0)
    dynamicCooldownEnabled: true,
    cooldownAfter2Losses: 600,
    cooldownAfter3Losses: 1800,
    cooldownAfter4PlusLosses: 3600,

    // Daily Loss Limit
    dailyLossLimitEnabled: true,
    dailyLossLimitPct: 0.05,
};

/**
 * Fair Value Gap Strategy
 *
 * Trades price returns to FVG zones (liquidity imbalances)
 */
export class FVGStrategy extends BaseStrategy {
    private params: FVGStrategyParams;
    private lastTradeTime: Record<string, number> = {};
    private pendingEntries: Record<string, PendingEntry | null> = {};

    // FVG storage per asset
    private bullishFVGs: Record<string, FairValueGap[]> = {};
    private bearishFVGs: Record<string, FairValueGap[]> = {};

    // Higher timeframe candles
    private htfCandles: Record<string, ResampledCandle[]> = {};
    private hasDirectCandles: Record<string, boolean> = {};

    // Dynamic Cooldown state
    private consecutiveLosses: Record<string, number> = {};
    private dynamicCooldownUntil: Record<string, number> = {};

    // Daily Loss Limit state
    private dailyPnl: Record<string, number> = {};
    private currentTradingDay: Record<string, string> = {};

    // Bar counter for FVG aging
    private barIndex: Record<string, number> = {};

    constructor(config: StrategyConfig) {
        super(config);
        this.params = {
            ...DEFAULT_PARAMS,
            ...(config.parameters as Partial<FVGStrategyParams>),
        };
    }

    /**
     * Load direct higher timeframe candles from API
     */
    loadDirectCandles(asset: string, htfCandles: Candle[]): void {
        const resampled: ResampledCandle[] = htfCandles.map(c => ({
            timestamp: c.timestamp * 1000,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        })).sort((a, b) => a.timestamp - b.timestamp);

        this.htfCandles[asset] = resampled;
        this.hasDirectCandles[asset] = resampled.length > 0;

        console.log(`[FVG] Loaded ${resampled.length} x ${this.params.fvgTimeframe}m candles for ${asset}`);

        // Scan for initial FVGs
        this.scanForFVGs(asset, resampled);
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
     * Scan candles for Fair Value Gaps
     */
    private scanForFVGs(asset: string, candles: ResampledCandle[]): void {
        if (candles.length < 3) return;

        // Initialize storage
        if (!this.bullishFVGs[asset]) this.bullishFVGs[asset] = [];
        if (!this.bearishFVGs[asset]) this.bearishFVGs[asset] = [];

        const currentBarIdx = this.barIndex[asset] || 0;

        // Scan last 3 candles for new FVG
        for (let i = candles.length - 1; i >= 2; i--) {
            const candle1 = candles[i - 2]!;
            const candle2 = candles[i - 1]!;
            const candle3 = candles[i]!;

            // Check for Bullish FVG: Candle3.low > Candle1.high (gap up)
            if (candle3.low > candle1.high) {
                const gapSize = candle3.low - candle1.high;
                const gapSizePct = gapSize / candle2.close;

                if (gapSizePct >= this.params.minGapSizePct) {
                    const fvg: FairValueGap = {
                        id: `BULL_${candle3.timestamp}`,
                        type: 'BULLISH',
                        upperPrice: candle3.low,
                        lowerPrice: candle1.high,
                        midPrice: (candle3.low + candle1.high) / 2,
                        gapSize,
                        gapSizePct,
                        createdAt: candle3.timestamp,
                        createdBarIndex: currentBarIdx,
                        status: 'active',
                        mitigationLevel: 0,
                        sourceCandles: {
                            candle1: { high: candle1.high, low: candle1.low, timestamp: candle1.timestamp },
                            candle2: { high: candle2.high, low: candle2.low, timestamp: candle2.timestamp },
                            candle3: { high: candle3.high, low: candle3.low, timestamp: candle3.timestamp },
                        },
                    };

                    // Check if already exists
                    if (!this.bullishFVGs[asset]!.find(f => f.id === fvg.id)) {
                        this.bullishFVGs[asset]!.push(fvg);
                        console.log(`[FVG] Bullish FVG detected: ${fvg.lowerPrice.toFixed(2)} - ${fvg.upperPrice.toFixed(2)} (${(gapSizePct * 100).toFixed(3)}%)`);
                    }
                }
            }

            // Check for Bearish FVG: Candle3.high < Candle1.low (gap down)
            if (candle3.high < candle1.low) {
                const gapSize = candle1.low - candle3.high;
                const gapSizePct = gapSize / candle2.close;

                if (gapSizePct >= this.params.minGapSizePct) {
                    const fvg: FairValueGap = {
                        id: `BEAR_${candle3.timestamp}`,
                        type: 'BEARISH',
                        upperPrice: candle1.low,
                        lowerPrice: candle3.high,
                        midPrice: (candle1.low + candle3.high) / 2,
                        gapSize,
                        gapSizePct,
                        createdAt: candle3.timestamp,
                        createdBarIndex: currentBarIdx,
                        status: 'active',
                        mitigationLevel: 0,
                        sourceCandles: {
                            candle1: { high: candle1.high, low: candle1.low, timestamp: candle1.timestamp },
                            candle2: { high: candle2.high, low: candle2.low, timestamp: candle2.timestamp },
                            candle3: { high: candle3.high, low: candle3.low, timestamp: candle3.timestamp },
                        },
                    };

                    if (!this.bearishFVGs[asset]!.find(f => f.id === fvg.id)) {
                        this.bearishFVGs[asset]!.push(fvg);
                        console.log(`[FVG] Bearish FVG detected: ${fvg.lowerPrice.toFixed(2)} - ${fvg.upperPrice.toFixed(2)} (${(gapSizePct * 100).toFixed(3)}%)`);
                    }
                }
            }

            // Only scan last few candles for new FVGs
            if (i < candles.length - 5) break;
        }

        // Trim to max stored
        this.bullishFVGs[asset] = this.bullishFVGs[asset].slice(-this.params.maxStoredGaps);
        this.bearishFVGs[asset] = this.bearishFVGs[asset].slice(-this.params.maxStoredGaps);
    }

    /**
     * Update FVG status based on current price
     * 
     * States:
     * - active: FVG detected, price hasn't entered yet
     * - tested: Price has entered the FVG zone
     * - mitigated: Price has filled 50%+ of the gap
     * - invalidated: Price completely crossed the FVG without reaction, or too old
     */
    private updateFVGStatus(asset: string, currentPrice: number, currentBarIdx: number): void {
        const now = Date.now();

        // Update Bullish FVGs (price coming DOWN to fill the gap)
        for (const fvg of this.bullishFVGs[asset] || []) {
            if (fvg.status === 'invalidated' || fvg.status === 'mitigated') continue;

            // Check if FVG is too old
            const age = currentBarIdx - fvg.createdBarIndex;
            if (age > this.params.maxGapAgeBars) {
                fvg.status = 'invalidated';
                fvg.invalidatedAt = now;
                continue;
            }

            // Check if price has completely crossed below the FVG (invalidation)
            // If price goes below lowerPrice without filling, the FVG is invalidated
            if (currentPrice < fvg.lowerPrice) {
                // Only invalidate if we were already tested and price continued down
                if (fvg.status === 'tested' && fvg.mitigationLevel < 50) {
                    fvg.status = 'invalidated';
                    fvg.invalidatedAt = now;
                    continue;
                }
            }

            // Check if price has entered the FVG
            if (currentPrice <= fvg.upperPrice && currentPrice >= fvg.lowerPrice) {
                // Mark as tested if not already
                if (fvg.status === 'active') {
                    fvg.status = 'tested';
                    fvg.testedAt = now;
                }

                // Calculate mitigation level
                fvg.mitigationLevel = ((fvg.upperPrice - currentPrice) / fvg.gapSize) * 100;

                // Check if mitigated (50%+ filled)
                if (fvg.mitigationLevel >= 50 && fvg.status === 'tested') {
                    fvg.status = 'mitigated';
                    fvg.mitigatedAt = now;
                }
            } else if (currentPrice > fvg.upperPrice) {
                // Price is above the FVG - still active
                // (price might come back down to fill it)
            }
        }

        // Update Bearish FVGs (price coming UP to fill the gap)
        for (const fvg of this.bearishFVGs[asset] || []) {
            if (fvg.status === 'invalidated' || fvg.status === 'mitigated') continue;

            // Check if FVG is too old
            const age = currentBarIdx - fvg.createdBarIndex;
            if (age > this.params.maxGapAgeBars) {
                fvg.status = 'invalidated';
                fvg.invalidatedAt = now;
                continue;
            }

            // Check if price has completely crossed above the FVG (invalidation)
            if (currentPrice > fvg.upperPrice) {
                // Only invalidate if we were already tested and price continued up
                if (fvg.status === 'tested' && fvg.mitigationLevel < 50) {
                    fvg.status = 'invalidated';
                    fvg.invalidatedAt = now;
                    continue;
                }
            }

            // Check if price has entered the FVG
            if (currentPrice >= fvg.lowerPrice && currentPrice <= fvg.upperPrice) {
                // Mark as tested if not already
                if (fvg.status === 'active') {
                    fvg.status = 'tested';
                    fvg.testedAt = now;
                }

                // Calculate mitigation level
                fvg.mitigationLevel = ((currentPrice - fvg.lowerPrice) / fvg.gapSize) * 100;

                // Check if mitigated (50%+ filled)
                if (fvg.mitigationLevel >= 50 && fvg.status === 'tested') {
                    fvg.status = 'mitigated';
                    fvg.mitigatedAt = now;
                }
            } else if (currentPrice < fvg.lowerPrice) {
                // Price is below the FVG - still active
                // (price might come back up to fill it)
            }
        }

        // Clean up invalidated/mitigated FVGs (keep only active/tested)
        this.bullishFVGs[asset] = (this.bullishFVGs[asset] || []).filter(
            f => f.status === 'active' || f.status === 'tested'
        );
        this.bearishFVGs[asset] = (this.bearishFVGs[asset] || []).filter(
            f => f.status === 'active' || f.status === 'tested'
        );
    }

    /**
     * Find tradeable FVG that price is entering
     */
    private findTradeableFVG(
        asset: string,
        price: number,
        rsi: number | null
    ): { fvg: FairValueGap; direction: 'CALL' | 'PUT' } | null {
        // Check Bullish FVGs (price coming DOWN into gap -> CALL)
        for (const fvg of this.bullishFVGs[asset] || []) {
            if (fvg.status === 'mitigated' || fvg.status === 'invalidated') continue;

            const inZone = this.isPriceInEntryZone(price, fvg);
            if (!inZone) continue;

            // RSI filter: Should be oversold for bullish entry
            if (this.params.useRSIFilter && rsi !== null) {
                if (rsi > this.params.rsiOversold + 10) {
                    continue; // RSI not low enough
                }
            }

            console.log(`[FVG] Price ${price.toFixed(2)} in Bullish FVG zone [${fvg.lowerPrice.toFixed(2)} - ${fvg.upperPrice.toFixed(2)}]`);
            return { fvg, direction: 'CALL' };
        }

        // Check Bearish FVGs (price coming UP into gap -> PUT)
        for (const fvg of this.bearishFVGs[asset] || []) {
            if (fvg.status === 'mitigated' || fvg.status === 'invalidated') continue;

            const inZone = this.isPriceInEntryZone(price, fvg);
            if (!inZone) continue;

            // RSI filter: Should be overbought for bearish entry
            if (this.params.useRSIFilter && rsi !== null) {
                if (rsi < this.params.rsiOverbought - 10) {
                    continue; // RSI not high enough
                }
            }

            console.log(`[FVG] Price ${price.toFixed(2)} in Bearish FVG zone [${fvg.lowerPrice.toFixed(2)} - ${fvg.upperPrice.toFixed(2)}]`);
            return { fvg, direction: 'PUT' };
        }

        return null;
    }

    /**
     * Check if price is in the entry zone of an FVG
     */
    private isPriceInEntryZone(price: number, fvg: FairValueGap): boolean {
        switch (this.params.entryZone) {
            case 'edge':
                // Enter at the edge (first touch)
                if (fvg.type === 'BULLISH') {
                    return price <= fvg.upperPrice && price >= fvg.upperPrice - (fvg.gapSize * 0.2);
                } else {
                    return price >= fvg.lowerPrice && price <= fvg.lowerPrice + (fvg.gapSize * 0.2);
                }

            case 'middle':
                // Enter around the 50% mitigation point
                const midRange = fvg.gapSize * 0.3;
                return price >= fvg.midPrice - midRange && price <= fvg.midPrice + midRange;

            case 'full':
                // Enter anywhere in the FVG
                return price >= fvg.lowerPrice && price <= fvg.upperPrice;

            default:
                return price >= fvg.lowerPrice && price <= fvg.upperPrice;
        }
    }

    /**
     * Calculate TP and SL based on FVG
     */
    private calculateTPSL(
        fvg: FairValueGap,
        direction: 'CALL' | 'PUT',
        _entryPrice: number
    ): { takeProfit: number; stopLoss: number } {
        if (direction === 'CALL') {
            // CALL: TP above FVG, SL below FVG
            const tpDistance = fvg.gapSize * this.params.takeProfitMultiple;
            const takeProfit = fvg.upperPrice + tpDistance;
            const stopLoss = fvg.lowerPrice * (1 - this.params.stopLossBuffer);

            return { takeProfit, stopLoss };
        } else {
            // PUT: TP below FVG, SL above FVG
            const tpDistance = fvg.gapSize * this.params.takeProfitMultiple;
            const takeProfit = fvg.lowerPrice - tpDistance;
            const stopLoss = fvg.upperPrice * (1 + this.params.stopLossBuffer);

            return { takeProfit, stopLoss };
        }
    }

    /**
     * Main candle processing
     */
    async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
        const { candles } = context;
        const asset = candle.asset;
        const price = candle.close;

        console.log(`[FVG] onCandle for ${asset} | price=${price.toFixed(2)}`);

        // Need enough candles
        if (!candles || candles.length < this.params.minCandles) {
            console.log(`[FVG] Not enough candles: ${candles?.length || 0} < ${this.params.minCandles}`);
            return null;
        }

        // Initialize state
        this.initializeAssetState(asset);

        // Increment bar counter
        this.barIndex[asset] = (this.barIndex[asset] ?? 0) + 1;

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
            const remainingSec = Math.round((cooldownUntil - now) / 1000);
            console.log(`[FVG] Dynamic cooldown: ${remainingSec}s remaining`);
            return null;
        }

        // Check regular cooldown
        const lastTrade = this.lastTradeTime[asset] ?? 0;
        const timeSinceLastTrade = now - lastTrade;
        const cooldownMs = this.params.cooldownSeconds * 1000;

        if (timeSinceLastTrade < cooldownMs) {
            console.log(`[FVG] Cooldown: ${Math.round((cooldownMs - timeSinceLastTrade) / 1000)}s remaining`);
            return null;
        }

        // Get or resample higher timeframe candles
        let htfCandles: ResampledCandle[];
        if (this.hasDirectCandles[asset]) {
            htfCandles = this.htfCandles[asset] ?? [];
        } else {
            htfCandles = this.resampleCandles(candles, this.params.fvgTimeframe);
            this.htfCandles[asset] = htfCandles;
        }

        // Scan for new FVGs
        this.scanForFVGs(asset, htfCandles);

        // Update FVG statuses
        this.updateFVGStatus(asset, price, this.barIndex[asset] ?? 0);

        // Calculate RSI
        const closes = candles.map(c => c.close);
        const rsiResult = RSI.calculate({
            period: this.params.rsiPeriod,
            values: closes,
        });
        const rsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;

        // Log current FVG state
        const bullishCount = (this.bullishFVGs[asset] || []).filter(f => f.status === 'active' || f.status === 'tested').length;
        const bearishCount = (this.bearishFVGs[asset] || []).filter(f => f.status === 'active' || f.status === 'tested').length;
        const activeBullish = (this.bullishFVGs[asset] || []).filter(f => f.status === 'active').length;
        const testedBullish = (this.bullishFVGs[asset] || []).filter(f => f.status === 'tested').length;
        const activeBearish = (this.bearishFVGs[asset] || []).filter(f => f.status === 'active').length;
        const testedBearish = (this.bearishFVGs[asset] || []).filter(f => f.status === 'tested').length;
        console.log(`[FVG] FVGs: ${bullishCount} bullish (${activeBullish} active, ${testedBullish} tested), ${bearishCount} bearish (${activeBearish} active, ${testedBearish} tested) | RSI: ${rsi?.toFixed(1) || 'N/A'}`);

        // Handle pending confirmation
        const pending = this.pendingEntries[asset];
        if (pending) {
            pending.candlesWaited++;
            console.log(`[FVG] Pending ${pending.direction} (waited ${pending.candlesWaited}/${this.params.confirmationBars})`);

            if (pending.candlesWaited >= this.params.confirmationBars) {
                // Check for confirmation (price moved in expected direction)
                const confirmed = pending.direction === 'CALL'
                    ? candle.close > pending.entryPrice
                    : candle.close < pending.entryPrice;

                if (confirmed) {
                    console.log(`[FVG] Signal CONFIRMED after ${pending.candlesWaited} candles`);
                    this.pendingEntries[asset] = null;
                    this.lastTradeTime[asset] = now;

                    const { takeProfit, stopLoss } = this.calculateTPSL(
                        pending.fvg,
                        pending.direction,
                        candle.close
                    );

                    return this.createSignal(
                        pending.direction,
                        0.75,
                        {
                            strategy: 'FVG',
                            fvgType: pending.fvg.type,
                            fvgUpper: pending.fvg.upperPrice,
                            fvgLower: pending.fvg.lowerPrice,
                            fvgMid: pending.fvg.midPrice,
                            entryPrice: candle.close,
                            takeProfit,
                            stopLoss,
                            rsi,
                        },
                        asset
                    );
                } else {
                    console.log(`[FVG] Signal CANCELLED (no confirmation)`);
                    this.pendingEntries[asset] = null;
                }
            }
            return null;
        }

        // Find tradeable FVG (only active or tested FVGs)
        const trade = this.findTradeableFVG(asset, price, rsi ?? null);

        if (!trade) {
            console.log(`[FVG] No tradeable FVG at current price`);
            return null;
        }

        // Only trade FVGs that are active or recently tested (not mitigated)
        if (trade.fvg.status === 'mitigated' || trade.fvg.status === 'invalidated') {
            console.log(`[FVG] FVG ${trade.fvg.id} is ${trade.fvg.status}, skipping`);
            return null;
        }

        // Require confirmation?
        if (this.params.requireConfirmation) {
            this.pendingEntries[asset] = {
                fvg: trade.fvg,
                direction: trade.direction,
                entryPrice: price,
                timestamp: now,
                candlesWaited: 0,
            };
            console.log(`[FVG] Pending ${trade.direction} signal (awaiting confirmation)`);
            return null;
        }

        // Execute immediately
        this.lastTradeTime[asset] = now;

        const { takeProfit, stopLoss } = this.calculateTPSL(
            trade.fvg,
            trade.direction,
            price
        );

        console.log(`[FVG] SIGNAL: ${trade.direction} at ${price.toFixed(2)} | TP: ${takeProfit.toFixed(2)} | SL: ${stopLoss.toFixed(2)}`);

        return this.createSignal(
            trade.direction,
            0.8,
            {
                strategy: 'FVG',
                fvgType: trade.fvg.type,
                fvgUpper: trade.fvg.upperPrice,
                fvgLower: trade.fvg.lowerPrice,
                fvgMid: trade.fvg.midPrice,
                entryPrice: price,
                takeProfit,
                stopLoss,
                rsi,
            },
            asset
        );
    }

    /**
     * Initialize state for an asset
     */
    private initializeAssetState(asset: string): void {
        if (this.lastTradeTime[asset] === undefined) this.lastTradeTime[asset] = 0;
        if (!this.bullishFVGs[asset]) this.bullishFVGs[asset] = [];
        if (!this.bearishFVGs[asset]) this.bearishFVGs[asset] = [];
        if (!this.htfCandles[asset]) this.htfCandles[asset] = [];
        if (!this.hasDirectCandles[asset]) this.hasDirectCandles[asset] = false;
        if (this.consecutiveLosses[asset] === undefined) this.consecutiveLosses[asset] = 0;
        if (this.dynamicCooldownUntil[asset] === undefined) this.dynamicCooldownUntil[asset] = 0;
        if (this.dailyPnl[asset] === undefined) this.dailyPnl[asset] = 0;
        if (!this.currentTradingDay[asset]) this.currentTradingDay[asset] = '';
        if (this.barIndex[asset] === undefined) this.barIndex[asset] = 0;
    }

    /**
     * Report trade result for dynamic cooldown
     */
    reportTradeResult(asset: string, pnl: number, isWin: boolean): void {
        this.initializeAssetState(asset);

        this.dailyPnl[asset] = (this.dailyPnl[asset] ?? 0) + pnl;

        if (isWin) {
            if ((this.consecutiveLosses[asset] ?? 0) > 0) {
                console.log(`[FVG] WIN - Reset consecutive losses (was ${this.consecutiveLosses[asset]})`);
            }
            this.consecutiveLosses[asset] = 0;
            this.dynamicCooldownUntil[asset] = 0;
        } else {
            this.consecutiveLosses[asset] = (this.consecutiveLosses[asset] ?? 0) + 1;
            console.log(`[FVG] LOSS #${this.consecutiveLosses[asset]}`);

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
                    console.log(`[FVG] Dynamic cooldown: ${cooldownSeconds}s (${this.consecutiveLosses[asset]} consecutive losses)`);
                }
            }
        }
    }

    /**
     * Get current FVG state for monitoring
     */
    getFVGState(asset: string): {
        bullishFVGs: FairValueGap[];
        bearishFVGs: FairValueGap[];
        consecutiveLosses: number;
        dailyPnl: number;
    } {
        return {
            bullishFVGs: this.bullishFVGs[asset] || [],
            bearishFVGs: this.bearishFVGs[asset] || [],
            consecutiveLosses: this.consecutiveLosses[asset] || 0,
            dailyPnl: this.dailyPnl[asset] || 0,
        };
    }

    /**
     * Get signal readiness/proximity
     */
    getSignalReadiness(candles: Candle[]): {
        asset: string;
        direction: 'call' | 'put' | 'neutral';
        overallProximity: number;
        activeFVGs: number;
        nearestFVG: FairValueGap | null;
        readyToSignal: boolean;
        missingCriteria: string[];
    } | null {
        if (!candles || candles.length < this.params.minCandles) {
            return null;
        }

        const asset = candles[0]?.asset || 'UNKNOWN';
        const price = candles[candles.length - 1]?.close || 0;

        this.initializeAssetState(asset);

        const bullishFVGs = (this.bullishFVGs[asset] || []).filter(f => f.status === 'active' || f.status === 'tested');
        const bearishFVGs = (this.bearishFVGs[asset] || []).filter(f => f.status === 'active' || f.status === 'tested');
        const totalFVGs = bullishFVGs.length + bearishFVGs.length;

        // Find nearest FVG
        let nearestFVG: FairValueGap | null = null;
        let nearestDistance = Infinity;
        let direction: 'call' | 'put' | 'neutral' = 'neutral';

        for (const fvg of bullishFVGs) {
            const dist = Math.abs(price - fvg.midPrice);
            if (dist < nearestDistance) {
                nearestDistance = dist;
                nearestFVG = fvg;
                direction = 'call';
            }
        }

        for (const fvg of bearishFVGs) {
            const dist = Math.abs(price - fvg.midPrice);
            if (dist < nearestDistance) {
                nearestDistance = dist;
                nearestFVG = fvg;
                direction = 'put';
            }
        }

        // Calculate proximity
        let overallProximity = 0;
        const missingCriteria: string[] = [];

        if (!nearestFVG) {
            missingCriteria.push('No active FVGs detected');
        } else {
            const inZone = this.isPriceInEntryZone(price, nearestFVG);
            if (inZone) {
                overallProximity = 100;
            } else {
                const distPct = nearestDistance / price;
                overallProximity = Math.max(0, 100 - (distPct * 10000));
                missingCriteria.push(`Price ${(distPct * 100).toFixed(2)}% from FVG zone`);
            }
        }

        // Check cooldown
        const now = Date.now();
        const timeSinceLastTrade = now - (this.lastTradeTime[asset] ?? 0);
        const cooldownMs = this.params.cooldownSeconds * 1000;
        if (timeSinceLastTrade < cooldownMs) {
            missingCriteria.push('Cooldown active');
            overallProximity *= 0.5;
        }

        return {
            asset,
            direction,
            overallProximity: Math.round(overallProximity),
            activeFVGs: totalFVGs,
            nearestFVG,
            readyToSignal: overallProximity >= 100 && missingCriteria.length === 0,
            missingCriteria,
        };
    }
}
