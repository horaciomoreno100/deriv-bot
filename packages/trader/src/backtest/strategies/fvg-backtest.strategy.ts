/**
 * Fair Value Gap (FVG) Strategy - Backtest Adapter
 *
 * Trades price returns to FVG zones (liquidity imbalances)
 *
 * OPTIMIZATION: Pre-calculates HTF candles and detects all FVGs ONCE before backtest
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { RSI } from 'technicalindicators';

/**
 * FVG Strategy Parameters
 */
interface FVGParams {
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
    cooldownBars: number;            // Min bars between trades
    minCandles: number;              // Min candles before trading

    // Filters
    useRSIFilter: boolean;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;
}

/**
 * Fair Value Gap data structure
 */
interface FairValueGap {
    id: string;
    type: 'BULLISH' | 'BEARISH';
    upperPrice: number;
    lowerPrice: number;
    midPrice: number;
    gapSize: number;
    gapSizePct: number;
    createdBarIndex: number;
    status: 'active' | 'tested' | 'mitigated' | 'invalidated';
    mitigationLevel: number;
}

/**
 * Pending entry waiting for confirmation
 */
interface PendingEntry {
    fvg: FairValueGap;
    direction: 'CALL' | 'PUT';
    entryPrice: number;
    candleIndex: number;
    candlesWaited: number;
}

/**
 * Pre-calculated data for a specific 1m candle index
 */
interface PreCalculatedData {
    rsi: number | null;
    bullishFVGs: FairValueGap[];
    bearishFVGs: FairValueGap[];
}

const DEFAULT_PARAMS: FVGParams = {
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
    stopLossBuffer: 0.001,
    cooldownBars: 5,
    minCandles: 100,

    // Filters - RSI confirmation
    useRSIFilter: true,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
};

const ASSET_CONFIGS: Record<string, Partial<FVGParams>> = {
    'R_75': {
        minGapSizePct: 0.002,
        takeProfitMultiple: 1.5,
    },
    'R_100': {
        minGapSizePct: 0.0015,
        takeProfitMultiple: 1.5,
    },
    'frxXAUUSD': {
        minGapSizePct: 0.001,
        takeProfitMultiple: 2.0,
        fvgTimeframe: 15,
    },
};

/**
 * FVG Strategy for Backtesting (OPTIMIZED)
 */
export class FVGBacktestStrategy implements BacktestableStrategy {
    readonly name = 'FVG';
    readonly version = '1.0.0';

    private params: FVGParams;
    private asset: string;
    private lastTradeIndex: number = -1;
    private pendingEntry: PendingEntry | null = null;

    // Pre-calculated data
    private preCalculated: PreCalculatedData[] = [];
    private isPreCalculated: boolean = false;

    // All FVGs detected during pre-calculation
    private allBullishFVGs: FairValueGap[] = [];
    private allBearishFVGs: FairValueGap[] = [];

    constructor(asset: string, customParams?: Partial<FVGParams>) {
        this.asset = asset;
        const assetConfig = ASSET_CONFIGS[asset] ?? {};
        this.params = { ...DEFAULT_PARAMS, ...assetConfig, ...customParams };
    }

    requiredIndicators(): string[] {
        return ['rsi'];
    }

    getDefaultConfig(): Partial<BacktestConfig> {
        return {
            asset: this.asset,
            cooldownBars: this.params.cooldownBars,
        };
    }

    /**
     * Pre-calculate all data ONCE before the backtest loop
     */
    preCalculate(candles: Candle[]): void {
        console.log(`[FVG] Pre-calculating FVG data for ${candles.length} candles...`);
        const startTime = Date.now();

        // 1. Resample to HTF candles
        const htfCandles = this.resampleAllCandles(candles, this.params.fvgTimeframe);
        console.log(`[FVG] Resampled to ${htfCandles.length} x ${this.params.fvgTimeframe}m candles`);

        // 2. Calculate 1m RSI
        const closes = candles.map(c => c.close);
        const rsiAll = RSI.calculate({
            period: this.params.rsiPeriod,
            values: closes,
        });
        const rsiOffset = candles.length - rsiAll.length;

        // 3. Detect all FVGs from HTF candles
        this.detectAllFVGs(htfCandles);
        console.log(`[FVG] Detected ${this.allBullishFVGs.length} bullish and ${this.allBearishFVGs.length} bearish FVGs`);

        // 4. Build timestamp mapping: HTF timestamp -> HTF candle index (OPTIMIZED: O(n) instead of O(n²))
        const htfTimestampToIndex = new Map<number, number>();
        htfCandles.forEach((c, i) => htfTimestampToIndex.set(c.timestamp, i));
        
        const intervalSeconds = this.params.fvgTimeframe * 60;

        // 5. Pre-calculate active FVGs for each 1m candle
        this.preCalculated = new Array(candles.length);

        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i]!;
            const price = candle.close;

            // Get RSI
            let rsi: number | null = null;
            const rsiIdx = i - rsiOffset;
            if (rsiIdx >= 0 && rsiAll[rsiIdx] !== undefined) {
                rsi = rsiAll[rsiIdx]!;
            }

            // Get HTF candle index for this 1m candle (OPTIMIZED: O(1) lookup)
            const slot = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;
            const htfIdx = htfTimestampToIndex.get(slot) ?? -1;
            
            // Get active FVGs at this point (not filled, not too old)
            // Note: htfIdx is the index in the HTF candles array, used for age calculation
            const bullishFVGs = this.getActiveFVGs(this.allBullishFVGs, price, htfIdx);
            const bearishFVGs = this.getActiveFVGs(this.allBearishFVGs, price, htfIdx);

            this.preCalculated[i] = {
                rsi,
                bullishFVGs,
                bearishFVGs,
            };
        }

        this.isPreCalculated = true;
        const elapsed = Date.now() - startTime;
        console.log(`[FVG] Pre-calculation completed in ${elapsed}ms`);
    }

    /**
     * Resample 1m candles to higher timeframe
     */
    private resampleAllCandles(candles1m: Candle[], intervalMinutes: number): Candle[] {
        const resampled: Map<number, Candle> = new Map();
        const intervalSeconds = intervalMinutes * 60;

        for (const candle of candles1m) {
            const slotStart = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;

            const existing = resampled.get(slotStart);
            if (!existing) {
                resampled.set(slotStart, {
                    timestamp: slotStart,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    asset: candle.asset,
                    timeframe: intervalMinutes * 60,
                });
            } else {
                existing.high = Math.max(existing.high, candle.high);
                existing.low = Math.min(existing.low, candle.low);
                existing.close = candle.close;
            }
        }

        return Array.from(resampled.values()).sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Detect all FVGs from HTF candles
     */
    private detectAllFVGs(candles: Candle[]): void {
        this.allBullishFVGs = [];
        this.allBearishFVGs = [];

        for (let i = 2; i < candles.length; i++) {
            const candle1 = candles[i - 2]!;
            const candle2 = candles[i - 1]!;
            const candle3 = candles[i]!;

            // Bullish FVG: Candle3.low > Candle1.high (gap up)
            if (candle3.low > candle1.high) {
                const gapSize = candle3.low - candle1.high;
                const gapSizePct = gapSize / candle2.close;

                if (gapSizePct >= this.params.minGapSizePct) {
                    this.allBullishFVGs.push({
                        id: `BULL_${candle3.timestamp}`,
                        type: 'BULLISH',
                        upperPrice: candle3.low,
                        lowerPrice: candle1.high,
                        midPrice: (candle3.low + candle1.high) / 2,
                        gapSize,
                        gapSizePct,
                        createdBarIndex: i,
                        status: 'active',
                        mitigationLevel: 0,
                    });
                }
            }

            // Bearish FVG: Candle3.high < Candle1.low (gap down)
            if (candle3.high < candle1.low) {
                const gapSize = candle1.low - candle3.high;
                const gapSizePct = gapSize / candle2.close;

                if (gapSizePct >= this.params.minGapSizePct) {
                    this.allBearishFVGs.push({
                        id: `BEAR_${candle3.timestamp}`,
                        type: 'BEARISH',
                        upperPrice: candle1.low,
                        lowerPrice: candle3.high,
                        midPrice: (candle1.low + candle3.high) / 2,
                        gapSize,
                        gapSizePct,
                        createdBarIndex: i,
                        status: 'active',
                        mitigationLevel: 0,
                    });
                }
            }
        }
    }

    /**
     * Get active FVGs at a given price and bar index
     * Calculates status dynamically WITHOUT mutating the FVG objects
     * (Important: We need to check status at each candle, not mutate during pre-calculation)
     */
    private getActiveFVGs(
        allFVGs: FairValueGap[],
        currentPrice: number,
        currentBarIdx: number
    ): FairValueGap[] {
        return allFVGs.filter(fvg => {
            // Check age
            const age = currentBarIdx - fvg.createdBarIndex;
            if (age > this.params.maxGapAgeBars || age < 0) {
                return false;
            }

            // Calculate current status dynamically (don't mutate)
            let currentStatus = fvg.status;
            let mitigationLevel = fvg.mitigationLevel;

            if (fvg.type === 'BULLISH') {
                // Check if price completely crossed below (invalidation)
                if (currentPrice < fvg.lowerPrice) {
                    // Only invalidate if it was previously tested and didn't mitigate
                    if (currentStatus === 'tested' && mitigationLevel < 50) {
                        return false; // Invalidated
                    }
                }

                // Check if price entered the FVG
                if (currentPrice <= fvg.upperPrice && currentPrice >= fvg.lowerPrice) {
                    if (currentStatus === 'active') {
                        currentStatus = 'tested';
                    }
                    mitigationLevel = ((fvg.upperPrice - currentPrice) / fvg.gapSize) * 100;
                    
                    // Check if mitigated (50%+ filled)
                    if (mitigationLevel >= 50) {
                        return false; // Mitigated, skip
                    }
                }
            } else {
                // BEARISH FVG
                // Check if price completely crossed above (invalidation)
                if (currentPrice > fvg.upperPrice) {
                    // Only invalidate if it was previously tested and didn't mitigate
                    if (currentStatus === 'tested' && mitigationLevel < 50) {
                        return false; // Invalidated
                    }
                }

                // Check if price entered the FVG
                if (currentPrice >= fvg.lowerPrice && currentPrice <= fvg.upperPrice) {
                    if (currentStatus === 'active') {
                        currentStatus = 'tested';
                    }
                    mitigationLevel = ((currentPrice - fvg.lowerPrice) / fvg.gapSize) * 100;
                    
                    // Check if mitigated (50%+ filled)
                    if (mitigationLevel >= 50) {
                        return false; // Mitigated, skip
                    }
                }
            }

            // Only return FVGs that are active or tested (not mitigated/invalidated)
            return currentStatus === 'active' || currentStatus === 'tested';
        }).slice(-this.params.maxStoredGaps);
    }

    /**
     * Check if price is in entry zone of FVG
     */
    private isPriceInEntryZone(price: number, fvg: FairValueGap): boolean {
        switch (this.params.entryZone) {
            case 'edge':
                if (fvg.type === 'BULLISH') {
                    return price <= fvg.upperPrice && price >= fvg.upperPrice - (fvg.gapSize * 0.2);
                } else {
                    return price >= fvg.lowerPrice && price <= fvg.lowerPrice + (fvg.gapSize * 0.2);
                }

            case 'middle':
                const midRange = fvg.gapSize * 0.3;
                return price >= fvg.midPrice - midRange && price <= fvg.midPrice + midRange;

            case 'full':
                return price >= fvg.lowerPrice && price <= fvg.upperPrice;

            default:
                return price >= fvg.lowerPrice && price <= fvg.upperPrice;
        }
    }

    /**
     * Find tradeable FVG
     */
    private findTradeableFVG(
        bullishFVGs: FairValueGap[],
        bearishFVGs: FairValueGap[],
        price: number,
        rsi: number | null
    ): { fvg: FairValueGap; direction: 'CALL' | 'PUT' } | null {
        // Check Bullish FVGs (price coming DOWN into gap -> CALL)
        for (const fvg of bullishFVGs) {
            if (!this.isPriceInEntryZone(price, fvg)) continue;

            // RSI filter: Should be oversold for bullish entry (RSI < 40)
            if (this.params.useRSIFilter && rsi !== null) {
                if (rsi > this.params.rsiOversold + 10) continue; // RSI > 40, skip
            }

            return { fvg, direction: 'CALL' };
        }

        // Check Bearish FVGs (price coming UP into gap -> PUT)
        for (const fvg of bearishFVGs) {
            if (!this.isPriceInEntryZone(price, fvg)) continue;

            // RSI filter: Should be overbought for bearish entry (RSI > 60)
            if (this.params.useRSIFilter && rsi !== null) {
                if (rsi < this.params.rsiOverbought - 10) continue; // RSI < 60, skip
            }

            return { fvg, direction: 'PUT' };
        }

        return null;
    }

    /**
     * Calculate TP and SL prices
     */
    private calculateTPSL(
        fvg: FairValueGap,
        direction: 'CALL' | 'PUT',
        _entryPrice: number
    ): { tpPct: number; slPct: number; tpPrice: number; slPrice: number } {
        if (direction === 'CALL') {
            const tpDistance = fvg.gapSize * this.params.takeProfitMultiple;
            const tpPrice = fvg.upperPrice + tpDistance;
            const slPrice = fvg.lowerPrice * (1 - this.params.stopLossBuffer);

            // Calculate percentage from entry price
            const tpPct = (tpPrice - _entryPrice) / _entryPrice;
            const slPct = (_entryPrice - slPrice) / _entryPrice;

            return { tpPct, slPct, tpPrice, slPrice };
        } else {
            const tpDistance = fvg.gapSize * this.params.takeProfitMultiple;
            const tpPrice = fvg.lowerPrice - tpDistance;
            const slPrice = fvg.upperPrice * (1 + this.params.stopLossBuffer);

            const tpPct = (_entryPrice - tpPrice) / _entryPrice;
            const slPct = (slPrice - _entryPrice) / _entryPrice;

            return { tpPct, slPct, tpPrice, slPrice };
        }
    }

    checkEntry(
        candles: Candle[],
        indicators: IndicatorSnapshot,
        currentIndex: number
    ): EntrySignal | null {
        // Ensure pre-calculation is done
        if (!this.isPreCalculated) {
            this.preCalculate(candles);
        }

        if (currentIndex < this.params.minCandles) return null;

        // Cooldown check
        if (currentIndex - this.lastTradeIndex < this.params.cooldownBars) return null;

        const candle = candles[currentIndex];
        if (!candle) return null;

        const price = candle.close;
        const data = this.preCalculated[currentIndex];

        if (!data) return null;

        const { rsi, bullishFVGs, bearishFVGs } = data;

        // Handle pending confirmation
        if (this.pendingEntry) {
            this.pendingEntry.candlesWaited++;

            if (this.pendingEntry.candlesWaited >= this.params.confirmationBars) {
                const pending = this.pendingEntry;
                const confirmed = pending.direction === 'CALL'
                    ? price > pending.entryPrice
                    : price < pending.entryPrice;

                if (confirmed) {
                    this.pendingEntry = null;
                    this.lastTradeIndex = currentIndex;

                    const { tpPct, slPct } = this.calculateTPSL(pending.fvg, pending.direction, price);

                    const snapshot: MarketSnapshot = {
                        timestamp: candle.timestamp * 1000,
                        candle: {
                            index: currentIndex,
                            timestamp: candle.timestamp,
                            open: candle.open,
                            high: candle.high,
                            low: candle.low,
                            close: candle.close,
                        },
                        price,
                        indicators: {
                            ...indicators,
                            rsi: rsi ?? 50,
                            fvgUpper: pending.fvg.upperPrice,
                            fvgLower: pending.fvg.lowerPrice,
                            fvgMid: pending.fvg.midPrice,
                        },
                    };

                    return {
                        timestamp: candle.timestamp,
                        direction: pending.direction,
                        price,
                        confidence: 75,
                        reason: `FVG ${pending.fvg.type} confirmed: ${pending.direction} after ${pending.candlesWaited} candles`,
                        strategyName: this.name,
                        strategyVersion: this.version,
                        snapshot,
                        suggestedTpPct: tpPct,
                        suggestedSlPct: slPct,
                    };
                } else {
                    this.pendingEntry = null;
                }
            }
            return null;
        }

        // Find tradeable FVG
        const trade = this.findTradeableFVG(bullishFVGs, bearishFVGs, price, rsi);

        if (!trade) return null;

        // Require confirmation?
        if (this.params.requireConfirmation) {
            this.pendingEntry = {
                fvg: trade.fvg,
                direction: trade.direction,
                entryPrice: price,
                candleIndex: currentIndex,
                candlesWaited: 0,
            };
            return null;
        }

        // Execute immediately
        this.lastTradeIndex = currentIndex;

        const { tpPct, slPct } = this.calculateTPSL(trade.fvg, trade.direction, price);

        const snapshot: MarketSnapshot = {
            timestamp: candle.timestamp * 1000,
            candle: {
                index: currentIndex,
                timestamp: candle.timestamp,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
            },
            price,
            indicators: {
                ...indicators,
                rsi: rsi ?? 50,
                fvgUpper: trade.fvg.upperPrice,
                fvgLower: trade.fvg.lowerPrice,
                fvgMid: trade.fvg.midPrice,
            },
        };

        return {
            timestamp: candle.timestamp,
            direction: trade.direction,
            price,
            confidence: 80,
            reason: `FVG ${trade.fvg.type}: ${trade.direction} at ${(trade.fvg.gapSizePct * 100).toFixed(2)}% gap`,
            strategyName: this.name,
            strategyVersion: this.version,
            snapshot,
            suggestedTpPct: tpPct,
            suggestedSlPct: slPct,
        };
    }

    reset(): void {
        this.lastTradeIndex = -1;
        this.pendingEntry = null;
        this.preCalculated = [];
        this.isPreCalculated = false;
        this.allBullishFVGs = [];
        this.allBearishFVGs = [];
    }
}

export function createFVGStrategy(
    asset: string,
    params?: Partial<FVGParams>
): FVGBacktestStrategy {
    return new FVGBacktestStrategy(asset, params);
}
