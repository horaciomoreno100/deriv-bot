/**
 * Return to Base - Backtest Strategy Adapter
 *
 * Adapter that wraps ReturnToBaseStrategy for use with the unified backtest engine.
 */

import type { Candle } from '@deriv-bot/shared';
import type { IndicatorSnapshot } from '@deriv-bot/shared';
import type {
  BacktestableStrategy,
  EntrySignal,
  BacktestConfig,
} from '../types.js';
import {
  ReturnToBaseStrategy,
  type ReturnToBaseParams,
  DEFAULT_RTB_PARAMS,
  RTB_AGGRESSIVE_PRESET,
  RTB_CONSERVATIVE_PRESET,
  RTB_CRYPTO_PRESET,
  RTB_FOREX_PRESET,
} from '../../strategies/return-to-base/index.js';
import { RSI, BollingerBands, EMA } from 'technicalindicators';

// ============================================================================
// BACKTEST ADAPTER
// ============================================================================

export class ReturnToBaseBacktestStrategy implements BacktestableStrategy {
  public readonly name = 'RETURN_TO_BASE';
  public readonly version = '1.0.0';

  private params: ReturnToBaseParams;

  constructor(params: Partial<ReturnToBaseParams> = {}) {
    this.params = { ...DEFAULT_RTB_PARAMS, ...params };
  }

  /**
   * List of indicators required by this strategy
   */
  requiredIndicators(): string[] {
    return ['rsi', 'bbUpper', 'bbMiddle', 'bbLower', 'ema20', 'atr'];
  }

  /**
   * Default backtest config optimized for this strategy
   */
  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      takeProfitPct: 0.004,  // 0.4% - TP corto para scalping
      stopLossPct: 0.006,    // 0.6% - SL más amplio (ratio 1:1.5)
      maxBarsInTrade: this.params.maxBarsInTrade,
      cooldownBars: 1,
    };
  }

  /**
   * Check for entry signal
   */
  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Need at least minCandles
    if (candles.length < this.params.minCandles) {
      return null;
    }

    // Get candles up to current index (for backtesting, we slice)
    const relevantCandles = candles.slice(0, currentIndex + 1);
    if (relevantCandles.length < this.params.minCandles) {
      return null;
    }

    // Calculate our own indicators since we need custom BB (2.5 stddev) and RSI (7)
    const calculatedIndicators = this.calculateIndicators(relevantCandles);
    if (!calculatedIndicators) {
      return null;
    }

    const currentCandle = relevantCandles[relevantCandles.length - 1]!;

    // Check for entry conditions
    const signal = this.checkEntryConditions(calculatedIndicators, currentCandle);
    if (!signal) {
      return null;
    }

    // Create entry signal
    return {
      timestamp: currentCandle.timestamp,
      direction: signal.direction === 'LONG' ? 'CALL' : 'PUT',
      price: currentCandle.close,
      confidence: signal.confidence,
      reason: signal.reason,
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot: {
        timestamp: currentCandle.timestamp,
        price: currentCandle.close,
        indicators: {
          ...indicators,
          rtb_rsi: calculatedIndicators.rsi,
          rtb_bbUpper: calculatedIndicators.bbUpper,
          rtb_bbLower: calculatedIndicators.bbLower,
          rtb_bbMiddle: calculatedIndicators.bbMiddle,
          rtb_ema20: calculatedIndicators.ema20,
          rtb_bandExpanding: calculatedIndicators.isBandExpanding ? 1 : 0,
        },
      },
      suggestedTpPct: signal.tpPct,
      suggestedSlPct: signal.slPct,
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private calculateIndicators(candles: Candle[]): CalculatedIndicators | null {
    try {
      const closes = candles.map(c => c.close);

      // Bollinger Bands with custom stdDev (2.5)
      const bbResult = BollingerBands.calculate({
        period: this.params.bbPeriod,
        values: closes,
        stdDev: this.params.bbStdDev,
      });

      if (bbResult.length < 2) return null;

      const bbCurrent = bbResult[bbResult.length - 1]!;
      const bbPrev = bbResult[bbResult.length - 2]!;

      // Band width
      const bbWidth = (bbCurrent.upper - bbCurrent.lower) / bbCurrent.middle;
      const bbWidthPrev = (bbPrev.upper - bbPrev.lower) / bbPrev.middle;

      // Detect band expansion (Boca de Cocodrilo)
      let isBandExpanding = false;
      if (bbResult.length >= this.params.bandWidthLookback) {
        const lookbackBB = bbResult[bbResult.length - this.params.bandWidthLookback]!;
        const lookbackWidth = (lookbackBB.upper - lookbackBB.lower) / lookbackBB.middle;
        const expansion = (bbWidth - lookbackWidth) / lookbackWidth;
        isBandExpanding = expansion > this.params.bandWidthExpansionThreshold;
      }

      // RSI with custom period (7)
      const rsiResult = RSI.calculate({
        period: this.params.rsiPeriod,
        values: closes,
      });

      if (rsiResult.length < 2) return null;

      const rsi = rsiResult[rsiResult.length - 1]!;
      const rsiPrev = rsiResult[rsiResult.length - 2]!;

      let rsiDirection: 'rising' | 'falling' | 'flat' = 'flat';
      if (rsi > rsiPrev + 1) rsiDirection = 'rising';
      else if (rsi < rsiPrev - 1) rsiDirection = 'falling';

      // EMAs
      const ema20Result = EMA.calculate({
        period: this.params.emaFastPeriod,
        values: closes,
      });

      const ema50Result = EMA.calculate({
        period: this.params.emaSlowPeriod,
        values: closes,
      });

      if (ema20Result.length < 1 || ema50Result.length < 1) return null;

      const ema20 = ema20Result[ema20Result.length - 1]!;
      const ema50 = ema50Result[ema50Result.length - 1]!;

      return {
        bbUpper: bbCurrent.upper,
        bbMiddle: bbCurrent.middle,
        bbLower: bbCurrent.lower,
        bbWidth,
        bbWidthPrev,
        isBandExpanding,
        rsi,
        rsiPrev,
        rsiDirection,
        ema20,
        ema50,
      };
    } catch {
      return null;
    }
  }

  private checkEntryConditions(
    ind: CalculatedIndicators,
    candle: Candle
  ): InternalSignal | null {
    // CRITICAL FILTER: Don't enter if bands are expanding (Boca de Cocodrilo)
    if (ind.isBandExpanding) {
      return null;
    }

    const price = candle.close;
    const high = candle.high;
    const low = candle.low;
    const open = candle.open;

    // Candle patterns
    const isBullishCandle = price > open;
    const isBearishCandle = price < open;
    const bodySize = Math.abs(price - open);
    const upperWick = high - Math.max(price, open);
    const lowerWick = Math.min(price, open) - low;
    const hasUpperWick = upperWick > bodySize * 0.5;
    const hasLowerWick = lowerWick > bodySize * 0.5;

    // Band touch detection
    const touchedUpperBand = high >= ind.bbUpper;
    const touchedLowerBand = low <= ind.bbLower;
    const closedInsideBands = price < ind.bbUpper && price > ind.bbLower;

    // Fixed TP/SL percentages for scalping (tight)
    const FIXED_TP_PCT = 0.003;  // 0.3% TP
    const FIXED_SL_PCT = 0.004;  // 0.4% SL (ratio 1.33:1 a favor del SL)

    // Check LONG
    if (touchedLowerBand && closedInsideBands) {
      // Rejection candle check
      if (this.params.requireRejectionCandle && (!isBullishCandle || !hasLowerWick)) {
        // Skip - no rejection
      } else if (this.params.requireRsiConfirmation &&
                 (ind.rsiPrev >= this.params.rsiOversold || ind.rsiDirection !== 'rising')) {
        // Skip - RSI not confirming
      } else {
        // Valid LONG - use fixed percentages
        return {
          direction: 'LONG',
          confidence: this.calculateConfidence(ind, 'LONG', hasLowerWick, isBullishCandle),
          reason: 'Lower BB touch + bullish rejection',
          tpPct: FIXED_TP_PCT,
          slPct: FIXED_SL_PCT,
        };
      }
    }

    // Check SHORT
    if (touchedUpperBand && closedInsideBands) {
      // Rejection candle check
      if (this.params.requireRejectionCandle && (!isBearishCandle || !hasUpperWick)) {
        // Skip - no rejection
      } else if (this.params.requireRsiConfirmation &&
                 (ind.rsiPrev <= this.params.rsiOverbought || ind.rsiDirection !== 'falling')) {
        // Skip - RSI not confirming
      } else {
        // Valid SHORT - use fixed percentages
        return {
          direction: 'SHORT',
          confidence: this.calculateConfidence(ind, 'SHORT', hasUpperWick, isBearishCandle),
          reason: 'Upper BB touch + bearish rejection',
          tpPct: FIXED_TP_PCT,
          slPct: FIXED_SL_PCT,
        };
      }
    }

    return null;
  }

  private calculateConfidence(
    ind: CalculatedIndicators,
    direction: 'LONG' | 'SHORT',
    hasWick: boolean,
    hasRejection: boolean
  ): number {
    let confidence = 0.5;

    // Extreme RSI
    if (direction === 'LONG' && ind.rsi < 15) {
      confidence += 0.15;
    } else if (direction === 'SHORT' && ind.rsi > 85) {
      confidence += 0.15;
    }

    // Strong rejection candle
    if (hasWick && hasRejection) {
      confidence += 0.1;
    }

    // Stable bands
    if (!ind.isBandExpanding && ind.bbWidth < ind.bbWidthPrev) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95);
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  getParams(): ReturnToBaseParams {
    return { ...this.params };
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface CalculatedIndicators {
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  bbWidthPrev: number;
  isBandExpanding: boolean;
  rsi: number;
  rsiPrev: number;
  rsiDirection: 'rising' | 'falling' | 'flat';
  ema20: number;
  ema50: number;
}

interface InternalSignal {
  direction: 'LONG' | 'SHORT';
  confidence: number;
  reason: string;
  tpPct: number;
  slPct: number;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createReturnToBaseStrategy(
  params?: Partial<ReturnToBaseParams>
): ReturnToBaseBacktestStrategy {
  return new ReturnToBaseBacktestStrategy(params);
}

/**
 * Create strategy with preset for specific asset type
 */
export function createReturnToBaseForAsset(
  asset: string,
  customParams?: Partial<ReturnToBaseParams>
): ReturnToBaseBacktestStrategy {
  let baseParams: Partial<ReturnToBaseParams> = {};

  // Select preset based on asset
  if (asset.startsWith('cry') || asset.includes('BTC') || asset.includes('ETH')) {
    baseParams = RTB_CRYPTO_PRESET;
  } else if (asset.startsWith('frx') || asset.includes('USD') || asset.includes('EUR')) {
    baseParams = RTB_FOREX_PRESET;
  }
  // For synthetic indices, use default params

  return new ReturnToBaseBacktestStrategy({ ...baseParams, ...customParams });
}

// Export presets for reference
export {
  DEFAULT_RTB_PARAMS,
  RTB_AGGRESSIVE_PRESET,
  RTB_CONSERVATIVE_PRESET,
  RTB_CRYPTO_PRESET,
  RTB_FOREX_PRESET,
};
