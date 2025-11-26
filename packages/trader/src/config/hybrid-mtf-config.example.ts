/**
 * Example Configuration for Hybrid MTF Strategy
 *
 * This file shows how to configure the HybridMTFStrategy for R_100 and R_25
 * based on 90-day backtest results.
 *
 * Usage:
 * 1. Copy this configuration to your bot's strategy config
 * 2. Adjust parameters if needed based on live performance
 * 3. Start with paper trading to validate
 */

import { HybridMTFStrategy } from '../strategies/hybrid-mtf.strategy.js';
import type { StrategyConfig } from '@deriv-bot/shared';

/**
 * Configuration for R_100
 * Backtest: +$3,741 (90 days, 50.8% WR, 1.03 PF)
 */
export const R100_HYBRID_MTF_CONFIG: StrategyConfig = {
    name: 'HybridMTF-R100',
    enabled: true,
    assets: ['R_100'],
    timeframe: '1m',  // Base timeframe (will resample to 5m/15m internally)
    parameters: {
        // 15m Context (Macro Trend Detection)
        ctxAdxPeriod: 14,
        ctxAdxThreshold: 25,
        ctxSmaPeriod: 50,
        ctxSlopeThreshold: 0.0002,

        // 5m Filter (Intermediate RSI)
        midRsiPeriod: 14,
        midRsiOverbought: 80,  // Avoid buying extreme tops
        midRsiOversold: 20,    // Avoid selling extreme bottoms

        // 1m Execution (BB + RSI)
        bbPeriod: 20,
        bbStdDev: 2,
        rsiPeriod: 14,
        rsiOverbought: 55,
        rsiOversold: 45,

        // Risk Management
        takeProfitPct: 0.005,  // 0.5% TP
        stopLossPct: 0.005,    // 0.5% SL
        cooldownSeconds: 60,   // 1 minute between trades
        minCandles: 100,       // Need enough for 15m context

        // Confirmation (Mean Reversion only)
        confirmationCandles: 1,  // Wait 1 candle for MR confirmation
    },
};

/**
 * Configuration for R_25
 * Backtest: +$1,275 (90 days, 49.7% WR, 1.02 PF)
 */
export const R25_HYBRID_MTF_CONFIG: StrategyConfig = {
    name: 'HybridMTF-R25',
    enabled: true,
    assets: ['R_25'],
    timeframe: '1m',
    parameters: {
        // Same parameters as R_100 (can be tuned separately if needed)
        ctxAdxPeriod: 14,
        ctxAdxThreshold: 25,
        ctxSmaPeriod: 50,
        ctxSlopeThreshold: 0.0002,

        midRsiPeriod: 14,
        midRsiOverbought: 80,
        midRsiOversold: 20,

        bbPeriod: 20,
        bbStdDev: 2,
        rsiPeriod: 14,
        rsiOverbought: 55,
        rsiOversold: 45,

        takeProfitPct: 0.005,
        stopLossPct: 0.005,
        cooldownSeconds: 60,
        minCandles: 100,

        confirmationCandles: 1,
    },
};

/**
 * Example: How to use in your bot
 */
/*
import { HybridMTFStrategy } from '@deriv-bot/trader';
import { R100_HYBRID_MTF_CONFIG, R25_HYBRID_MTF_CONFIG } from './config/hybrid-mtf-config.js';

// Create strategy instances
const r100Strategy = new HybridMTFStrategy(R100_HYBRID_MTF_CONFIG);
const r25Strategy = new HybridMTFStrategy(R25_HYBRID_MTF_CONFIG);

// Add to strategy engine
strategyEngine.addStrategy(r100Strategy);
strategyEngine.addStrategy(r25Strategy);

// Start trading
await strategyEngine.start();
*/
