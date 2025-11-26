/**
 * Market Regime Analysis Tool
 *
 * Purpose: Validate logic for detecting "Trend" vs "Range" market phases.
 * This is Phase 1 of the Hybrid Strategy implementation.
 *
 * Metrics used:
 * - ADX (Average Directional Index): Strength of trend (>25 usually trend)
 * - BB Width: Volatility measure (Low = Squeeze/Range, High = Volatility)
 * - SMA Slope: Directional bias
 *
 * Usage:
 *   ASSET="R_100" DAYS="30" npx tsx src/scripts/analyze-market-regimes.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BollingerBands, ADX, SMA } from 'technicalindicators';

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

type Regime = 'TREND_BULLISH' | 'TREND_BEARISH' | 'RANGE_QUIET' | 'RANGE_VOLATILE' | 'UNCERTAIN';

interface RegimeAnalysis {
    timestamp: number;
    price: number;
    regime: Regime;
    metrics: {
        adx: number;
        bbWidth: number;
        smaSlope: number;
        sma: number;
    };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const ASSET = process.env.ASSET || 'R_100';
const DAYS = process.env.DAYS || '30';

// Detection Parameters (To be tuned)
const PARAMS = {
    adxPeriod: 14,
    adxThreshold: 25,       // Above 25 = Trend
    bbPeriod: 20,
    bbStdDev: 2,
    bbWidthThreshold: 0.006, // Below this = Squeeze/Quiet Range (Adjusted for R_100)
    smaPeriod: 50,
    slopeThreshold: 0.0002, // Min slope to consider "trending"
};

// =============================================================================
// INDICATORS
// =============================================================================

function calculateIndicators(candles: Candle[]) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // 1. ADX
    const adxInput = {
        high: highs,
        low: lows,
        close: closes,
        period: PARAMS.adxPeriod,
    };
    const adxResult = ADX.calculate(adxInput);

    // 2. Bollinger Bands
    const bbInput = {
        period: PARAMS.bbPeriod,
        values: closes,
        stdDev: PARAMS.bbStdDev,
    };
    const bbResult = BollingerBands.calculate(bbInput);

    // 3. SMA
    const smaInput = {
        period: PARAMS.smaPeriod,
        values: closes,
    };
    const smaResult = SMA.calculate(smaInput);

    return { adxResult, bbResult, smaResult };
}

// =============================================================================
// REGIME DETECTION LOGIC
// =============================================================================

function detectRegime(
    price: number,
    adx: number,
    bbUpper: number,
    bbLower: number,
    bbMiddle: number,
    currentSMA: number,
    prevSMA: number
): { regime: Regime; metrics: any } {
    // 1. Calculate Metrics
    const bbWidth = (bbUpper - bbLower) / bbMiddle;
    const smaSlope = (currentSMA - prevSMA) / prevSMA;

    // 2. Logic Tree
    let regime: Regime = 'UNCERTAIN';

    const isTrendStrength = adx > PARAMS.adxThreshold;
    const isSqueeze = bbWidth < PARAMS.bbWidthThreshold;
    const isSlopeBullish = smaSlope > PARAMS.slopeThreshold;
    const isSlopeBearish = smaSlope < -PARAMS.slopeThreshold;

    if (isTrendStrength) {
        if (isSlopeBullish && price > currentSMA) {
            regime = 'TREND_BULLISH';
        } else if (isSlopeBearish && price < currentSMA) {
            regime = 'TREND_BEARISH';
        } else {
            // ADX high but slope flat/contradictory? Volatile Range.
            regime = 'RANGE_VOLATILE';
        }
    } else {
        // Low ADX
        if (isSqueeze) {
            regime = 'RANGE_QUIET';
        } else {
            regime = 'RANGE_VOLATILE';
        }
    }

    return {
        regime,
        metrics: {
            adx,
            bbWidth,
            smaSlope,
            sma: currentSMA
        }
    };
}

// =============================================================================
// DATA LOADING
// =============================================================================

function loadCandles(asset: string, timeframe: string, days: string): Candle[] | null {
    // Try multiple paths/names
    const paths = [
        join(process.cwd(), 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'packages', 'trader', 'backtest-data', `${asset}_${timeframe}_${days}d.csv`),
        join(process.cwd(), 'backtest-data', `${asset}_60s_${days}d.csv`) // Legacy name
    ];

    for (const p of paths) {
        if (existsSync(p)) {
            console.log(`Loading data from: ${p}`);
            const content = readFileSync(p, 'utf-8');
            const lines = content.trim().split('\n').slice(1);

            const candles = lines.map(line => {
                const [timestamp, open, high, low, close] = line.split(',');
                const ts = parseInt(timestamp);
                return {
                    timestamp: ts > 10000000000 ? Math.floor(ts / 1000) : ts,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                };
            }).filter(c => !isNaN(c.timestamp) && !isNaN(c.close));

            candles.sort((a, b) => a.timestamp - b.timestamp);
            return candles;
        }
    }

    return null;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log(`🔍 MARKET REGIME ANALYSIS - ${ASSET}`);
    console.log('='.repeat(70));
    console.log(`Parameters:`);
    console.log(`  ADX Threshold: ${PARAMS.adxThreshold}`);
    console.log(`  BB Width Threshold: ${PARAMS.bbWidthThreshold}`);
    console.log(`  SMA Slope Threshold: ${PARAMS.slopeThreshold}`);
    console.log('='.repeat(70));

    // Load Data
    const candles = loadCandles(ASSET, '1m', DAYS);
    if (!candles) {
        console.error('❌ Could not load data. Please run fetch-historical-data.ts first.');
        process.exit(1);
    }
    console.log(`Loaded ${candles.length} candles.`);

    // Calculate Indicators
    console.log('Calculating indicators...');
    const { adxResult, bbResult, smaResult } = calculateIndicators(candles);

    // Align Arrays
    // Technicalindicators returns arrays shorter than input. We need to align them by the end.
    const minLen = Math.min(adxResult.length, bbResult.length, smaResult.length);
    const offset = candles.length - minLen;

    // Analyze
    const results: RegimeAnalysis[] = [];
    const regimeCounts: Record<Regime, number> = {
        'TREND_BULLISH': 0,
        'TREND_BEARISH': 0,
        'RANGE_QUIET': 0,
        'RANGE_VOLATILE': 0,
        'UNCERTAIN': 0
    };

    // Skip first few to allow slope calculation
    for (let i = 1; i < minLen; i++) {
        const candleIdx = offset + i;
        const candle = candles[candleIdx];

        // Get indicator values (aligned to end)
        // Note: technicalindicators results are 0-indexed relative to their own start
        // We need to map them correctly.
        // If adx has length 100 and candles 114 (period 14), adx[0] corresponds to candle[14]
        // So we can just iterate from the end backwards or align carefully.

        // Let's use the offset logic:
        // adxResult[i] corresponds to candles[offset + i] IF minLen is based on the shortest indicator

        // Re-calculating offset for each indicator to be safe
        const adxIdx = i - (minLen - adxResult.length);
        const bbIdx = i - (minLen - bbResult.length);
        const smaIdx = i - (minLen - smaResult.length);
        const prevSmaIdx = smaIdx - 1;

        if (adxIdx < 0 || bbIdx < 0 || smaIdx < 0 || prevSmaIdx < 0) continue;

        const adxVal = adxResult[adxIdx].adx;
        const bb = bbResult[bbIdx];
        const currentSMA = smaResult[smaIdx];
        const prevSMA = smaResult[prevSmaIdx];

        const analysis = detectRegime(
            candle.close,
            adxVal,
            bb.upper,
            bb.lower,
            bb.middle,
            currentSMA,
            prevSMA
        );

        results.push({
            timestamp: candle.timestamp,
            price: candle.close,
            ...analysis
        });

        regimeCounts[analysis.regime]++;
    }

    // Output Statistics
    console.log('\n📊 REGIME DISTRIBUTION:');
    const total = results.length;
    Object.entries(regimeCounts).forEach(([regime, count]) => {
        const pct = (count / total * 100).toFixed(1);
        console.log(`  ${regime.padEnd(15)}: ${count.toString().padEnd(6)} (${pct}%)`);
    });

    // Output Sample Transitions (to verify logic)
    console.log('\n🔄 SAMPLE TRANSITIONS (Last 20 changes):');
    let lastRegime = results[0]?.regime;
    let changesShown = 0;

    // Show last 50 candles detail
    const recent = results.slice(-50);

    console.log('\nRecent Market State (Last 10 candles):');
    console.log('Timestamp       | Price   | Regime          | ADX  | BB Width | Slope');
    console.log('-'.repeat(75));

    recent.slice(-10).forEach(r => {
        const date = new Date(r.timestamp * 1000).toISOString().substr(11, 8);
        const slope = (r.metrics.smaSlope * 10000).toFixed(2); // Scaled for readability
        console.log(`${date} | ${r.price.toFixed(2)} | ${r.regime.padEnd(15)} | ${r.metrics.adx.toFixed(1)} | ${r.metrics.bbWidth.toFixed(4)}   | ${slope}`);
    });

    // Suggestion based on distribution
    console.log('\n💡 INSIGHTS:');
    const trendPct = ((regimeCounts['TREND_BULLISH'] + regimeCounts['TREND_BEARISH']) / total * 100);
    const rangePct = ((regimeCounts['RANGE_QUIET'] + regimeCounts['RANGE_VOLATILE']) / total * 100);

    console.log(`  Trend Time: ${trendPct.toFixed(1)}%`);
    console.log(`  Range Time: ${rangePct.toFixed(1)}%`);

    if (trendPct > 30) {
        console.log('  -> Market shows significant trending phases. Momentum strategy should perform well here.');
    } else {
        console.log('  -> Market is predominantly ranging. Mean Reversion should dominate.');
    }
}

main().catch(console.error);
