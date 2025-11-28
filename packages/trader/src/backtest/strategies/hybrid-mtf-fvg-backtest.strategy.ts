/**
 * Hybrid MTF + FVG Strategy - Backtest Adapter
 *
 * Combines Hybrid MTF (Momentum + Mean Reversion) with FVG (Fair Value Gap)
 *
 * OPTIMIZATION: Uses pre-calculated data from both strategies
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import { HybridMTFBacktestStrategy } from './hybrid-mtf-backtest.strategy.js';
import { FVGBacktestStrategy } from './fvg-backtest.strategy.js';

/**
 * Hybrid MTF + FVG Strategy Parameters
 */
interface HybridMTFFVGParams {
    // Strategy Selection
    enableMomentum: boolean;
    enableMeanReversion: boolean;
    enableFVG: boolean;
    fvgAsFilter: boolean;  // If true, FVG only confirms Hybrid MTF signals

    // Hybrid MTF params (passed through)
    hybridMTFParams?: any;

    // FVG params (passed through)
    fvgParams?: any;
}

const DEFAULT_PARAMS: HybridMTFFVGParams = {
    enableMomentum: true,
    enableMeanReversion: true,
    enableFVG: true,
    fvgAsFilter: false,  // FVG can signal independently
};

/**
 * Hybrid MTF + FVG Strategy for Backtesting
 */
export class HybridMTFFVGBacktestStrategy implements BacktestableStrategy {
    readonly name = 'HybridMTF+FVG';
    readonly version = '1.0.0';

    private params: HybridMTFFVGParams;
    private asset: string;
    private hybridStrategy: HybridMTFBacktestStrategy;
    private fvgStrategy: FVGBacktestStrategy;
    private lastTradeIndex: number = -1;

    constructor(asset: string, customParams?: Partial<HybridMTFFVGParams>) {
        this.asset = asset;
        this.params = { ...DEFAULT_PARAMS, ...customParams };

        // Create internal strategies
        this.hybridStrategy = new HybridMTFBacktestStrategy(asset, this.params.hybridMTFParams);
        this.fvgStrategy = new FVGBacktestStrategy(asset, {
            ...this.params.fvgParams,
            entryZone: 'edge',  // Best performing FVG config
            requireConfirmation: true,
        });
    }

    requiredIndicators(): string[] {
        return ['rsi', 'bbUpper', 'bbMiddle', 'bbLower', 'adx', 'sma'];
    }

    getDefaultConfig(): Partial<BacktestConfig> {
        return {
            asset: this.asset,
            takeProfitPct: 0.004,  // Hybrid MTF default
            stopLossPct: 0.003,
            cooldownBars: 5,
        };
    }

    /**
     * Pre-calculate data for both strategies
     */
    preCalculate(candles: Candle[]): void {
        console.log(`[HybridMTF+FVG] Pre-calculating combined strategy data...`);
        
        // Pre-calculate both strategies
        if (this.params.enableMomentum || this.params.enableMeanReversion) {
            this.hybridStrategy.preCalculate(candles);
        }
        
        if (this.params.enableFVG) {
            this.fvgStrategy.preCalculate(candles);
        }
    }

    checkEntry(
        candles: Candle[],
        indicators: IndicatorSnapshot,
        currentIndex: number
    ): EntrySignal | null {
        if (currentIndex < 100) return null;  // minCandles

        // Cooldown check
        if (currentIndex - this.lastTradeIndex < 5) return null;

        const candle = candles[currentIndex];
        if (!candle) return null;

        // Get signals from both strategies
        let hybridSignal: EntrySignal | null = null;
        let fvgSignal: EntrySignal | null = null;

        // Get Hybrid MTF signal
        if (this.params.enableMomentum || this.params.enableMeanReversion) {
            hybridSignal = this.hybridStrategy.checkEntry(candles, indicators, currentIndex);
        }

        // Get FVG signal
        if (this.params.enableFVG) {
            fvgSignal = this.fvgStrategy.checkEntry(candles, indicators, currentIndex);
        }

        // Combine signals
        let finalSignal: EntrySignal | null = null;
        let source: string = '';

        // Case 1: Both strategies signal in same direction (highest confidence)
        if (hybridSignal && fvgSignal && hybridSignal.direction === fvgSignal.direction) {
            finalSignal = {
                ...hybridSignal,
                confidence: 90,
                reason: `HYBRID_MTF+FVG: Both strategies agree on ${hybridSignal.direction}`,
            };
            source = 'HYBRID_MTF_FVG';
        }
        // Case 2: Only Hybrid MTF signals
        else if (hybridSignal && (!this.params.enableFVG || this.params.fvgAsFilter)) {
            // If FVG is used as filter, we need FVG confirmation
            if (this.params.fvgAsFilter && this.params.enableFVG) {
                // Wait for FVG confirmation
                if (fvgSignal && fvgSignal.direction === hybridSignal.direction) {
                    finalSignal = {
                        ...hybridSignal,
                        confidence: 85,
                        reason: `HYBRID_MTF (FVG confirmed): ${hybridSignal.direction}`,
                    };
                    source = 'HYBRID_MTF_FVG';
                }
            } else {
                finalSignal = hybridSignal;
                source = 'HYBRID_MTF';
            }
        }
        // Case 3: Only FVG signals (if enabled independently)
        else if (fvgSignal && !this.params.fvgAsFilter) {
            finalSignal = fvgSignal;
            source = 'FVG';
        }

        if (!finalSignal) {
            return null;
        }

        this.lastTradeIndex = currentIndex;

        // Update metadata
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
            price: candle.close,
            indicators: {
                ...indicators,
                signalSource: source,
            },
        };

        return {
            ...finalSignal,
            snapshot,
            strategyName: this.name,
            strategyVersion: this.version,
        };
    }

    reset(): void {
        this.lastTradeIndex = -1;
        if (this.hybridStrategy.reset) this.hybridStrategy.reset();
        if (this.fvgStrategy.reset) this.fvgStrategy.reset();
    }
}

/**
 * Factory function
 */
export function createHybridMTFFVGStrategy(
    asset: string,
    params?: Partial<HybridMTFFVGParams>
): HybridMTFFVGBacktestStrategy {
    return new HybridMTFFVGBacktestStrategy(asset, params);
}

