/**
 * CryptoScalp Strategy v2
 *
 * Advanced crypto scalping strategy combining multiple indicators:
 * - VWAP for institutional bias
 * - ADX for trend strength filtering
 * - ATR for dynamic TP/SL
 * - Bollinger Bands for volatility extremes
 * - Volume confirmation
 * - RSI for overbought/oversold
 * - Trailing stops
 * - DCA entries
 */

import type { Candle } from '@deriv-bot/shared';
import type {
  CryptoScalpParams,
  CryptoScalpStrategyState,
  CryptoScalpEntrySignal,
  CryptoScalpExitSignal,
  CryptoScalpIndicators,
  Direction,
} from './crypto-scalp.types.js';
import { getParamsForAsset } from './crypto-scalp.params.js';
import {
  calculateVWAP,
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  analyzeVolume,
  isTrending,
} from './indicators/index.js';

/**
 * CryptoScalp Strategy v2 Implementation
 */
export class CryptoScalpStrategy {
  readonly name = 'CryptoScalp';
  readonly version = '2.0.0';

  private params: CryptoScalpParams;
  private _asset: string;
  private state: CryptoScalpStrategyState;
  private _lastVolatilityRejection: string | null = null;

  constructor(asset: string, customParams?: Partial<CryptoScalpParams>) {
    this._asset = asset;
    this.params = getParamsForAsset(asset, customParams);
    this.state = this.createInitialState();
  }

  /**
   * Get asset symbol
   */
  get asset(): string {
    return this._asset;
  }

  /**
   * Get last volatility rejection reason (for logging)
   */
  get lastVolatilityRejection(): string | null {
    return this._lastVolatilityRejection;
  }

  /**
   * Create initial strategy state
   */
  private createInitialState(): CryptoScalpStrategyState {
    return {
      state: 'SCANNING',
      currentPosition: null,
      lastTradeIndex: -1,
      consecutiveLosses: 0,
      pauseUntilIndex: -1,
      indicatorValues: null,
    };
  }

  /**
   * Calculate all indicators for current candle
   */
  calculateIndicators(candles: Candle[]): CryptoScalpIndicators | null {
    if (candles.length < 50) return null;

    const currentCandle = candles[candles.length - 1]!;

    // VWAP
    const vwapResult = calculateVWAP(candles, this.params.vwap);
    if (!vwapResult) return null;

    // ADX
    const adxResult = calculateADX(candles, this.params.adx);
    if (!adxResult) return null;

    // ATR
    const atrResult = calculateATR(candles, this.params.atr);
    if (!atrResult) return null;

    // Bollinger Bands
    const bbResult = calculateBollingerBands(candles, this.params.bb);
    if (!bbResult) return null;

    // Volume
    const volumeResult = analyzeVolume(candles, this.params.volume);

    // RSI (simple calculation)
    const rsi = this.calculateRSI(candles, this.params.rsi.period);
    if (rsi === null) return null;

    return {
      timestamp: currentCandle.timestamp,
      vwap: vwapResult.vwap,
      vwapBias: vwapResult.bias,
      adx: adxResult.adx,
      plusDI: adxResult.plusDI,
      minusDI: adxResult.minusDI,
      trendStrength: adxResult.trendStrength,
      atr: atrResult.atr,
      rsi,
      bbUpper: bbResult.upper,
      bbMiddle: bbResult.middle,
      bbLower: bbResult.lower,
      bbZone: bbResult.zone,
      bbWidth: bbResult.widthPercent,
      volume: volumeResult?.currentVolume ?? 0,
      volumeSMA: volumeResult?.volumeSMA ?? 0,
      volumeRatio: volumeResult?.volumeRatio ?? 1,
    };
  }

  /**
   * Simple RSI calculation
   */
  private calculateRSI(candles: Candle[], period: number): number | null {
    if (candles.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
      const change = candles[i]!.close - candles[i - 1]!.close;
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Check if volatility is too extreme for trading
   * Returns rejection reason if volatility is too high, null if OK to trade
   */
  private checkVolatilityFilter(
    candles: Candle[],
    indicators: CryptoScalpIndicators
  ): string | null {
    if (!this.params.volatilityFilter.enabled) return null;

    const config = this.params.volatilityFilter;

    // 1. Check BB Width
    if (indicators.bbWidth > config.maxBBWidthPct) {
      return `BB Width ${indicators.bbWidth.toFixed(2)}% > max ${config.maxBBWidthPct}%`;
    }

    // 2. Check ATR ratio vs average
    if (candles.length >= config.atrAvgPeriod + this.params.atr.period) {
      const avgATR = this.calculateAverageATR(candles, config.atrAvgPeriod);
      if (avgATR > 0) {
        const currentATRRatio = indicators.atr / avgATR;
        if (currentATRRatio > config.maxATRRatio) {
          return `ATR ratio ${currentATRRatio.toFixed(2)}x > max ${config.maxATRRatio}x`;
        }
      }
    }

    return null;
  }

  /**
   * Calculate average ATR over a period for volatility comparison
   */
  private calculateAverageATR(candles: Candle[], period: number): number {
    const atrPeriod = this.params.atr.period;
    if (candles.length < period + atrPeriod) return 0;

    let sumATR = 0;
    let count = 0;

    // Calculate ATR at multiple points in history
    for (let i = candles.length - period; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const atrResult = calculateATR(slice, this.params.atr);
      if (atrResult) {
        sumATR += atrResult.atr;
        count++;
      }
    }

    return count > 0 ? sumATR / count : 0;
  }

  /**
   * Check for entry signal
   */
  checkEntry(
    candles: Candle[],
    currentIndex: number
  ): CryptoScalpEntrySignal | null {
    // Update state
    if (this.state.state !== 'SCANNING') return null;

    // Check cooldown
    if (
      this.state.lastTradeIndex >= 0 &&
      currentIndex - this.state.lastTradeIndex < this.params.cooldownBars
    ) {
      return null;
    }

    // Check pause after consecutive losses
    if (currentIndex < this.state.pauseUntilIndex) {
      return null;
    }

    // Calculate indicators
    const candleSlice = candles.slice(0, currentIndex + 1);
    const indicators = this.calculateIndicators(candleSlice);
    if (!indicators) return null;

    // ⚠️ VOLATILITY FILTER: Skip trading during extreme volatility
    const volatilityRejection = this.checkVolatilityFilter(candleSlice, indicators);
    if (volatilityRejection) {
      // Log rejection for monitoring (will show in runner logs)
      this._lastVolatilityRejection = volatilityRejection;
      return null;
    }
    this._lastVolatilityRejection = null;

    // Store for later use
    this.state.indicatorValues = {
      vwap: indicators.vwap,
      adx: indicators.adx,
      plusDI: indicators.plusDI,
      minusDI: indicators.minusDI,
      atr: indicators.atr,
      rsi: indicators.rsi,
      bbUpper: indicators.bbUpper,
      bbMiddle: indicators.bbMiddle,
      bbLower: indicators.bbLower,
      volumeSMA: indicators.volumeSMA,
    };

    // Check entry conditions
    const entrySignal = this.evaluateEntry(candles[currentIndex]!, indicators);
    if (!entrySignal) return null;

    // Get dynamic TP/SL from ATR
    const atrResult = calculateATR(candles.slice(0, currentIndex + 1), this.params.atr);
    const suggestedTP = atrResult?.suggestedTP ?? this.params.takeProfitLevels[0]?.profitPercent ?? 0.5;
    const suggestedSL = atrResult?.suggestedSL ?? this.params.baseStopLossPct;

    // Calculate trailing stop activation
    const trailingActivation = this.params.trailingStop.enabled
      ? this.params.trailingStop.activationPct
      : suggestedTP;

    return {
      direction: entrySignal.direction,
      price: candles[currentIndex]!.close,
      timestamp: candles[currentIndex]!.timestamp,
      confidence: entrySignal.confidence,
      reason: entrySignal.reason,
      indicators: {
        vwap: indicators.vwap,
        vwapBias: indicators.vwapBias,
        adx: indicators.adx,
        plusDI: indicators.plusDI,
        minusDI: indicators.minusDI,
        trendStrength: indicators.trendStrength,
        atr: indicators.atr,
        rsi: indicators.rsi,
        bbUpper: indicators.bbUpper,
        bbMiddle: indicators.bbMiddle,
        bbLower: indicators.bbLower,
        bbZone: indicators.bbZone,
        volumeRatio: indicators.volumeRatio,
      },
      suggestedTP,
      suggestedSL,
      trailingStopActivation: trailingActivation,
    };
  }

  /**
   * Evaluate entry conditions
   */
  private evaluateEntry(
    _candle: Candle,
    indicators: CryptoScalpIndicators
  ): { direction: Direction; confidence: number; reason: string } | null {
    let confidence = 0.5;

    // ===== LONG ENTRY =====
    const longConditions = this.checkLongConditions(indicators);
    if (longConditions.score >= 3) {
      confidence = 0.5 + longConditions.score * 0.1;
      return {
        direction: 'CALL',
        confidence: Math.min(confidence, 0.95),
        reason: longConditions.reasons.join(', '),
      };
    }

    // ===== SHORT ENTRY =====
    const shortConditions = this.checkShortConditions(indicators);
    if (shortConditions.score >= 3) {
      confidence = 0.5 + shortConditions.score * 0.1;
      return {
        direction: 'PUT',
        confidence: Math.min(confidence, 0.95),
        reason: shortConditions.reasons.join(', '),
      };
    }

    return null;
  }

  /**
   * Check LONG entry conditions
   */
  private checkLongConditions(
    indicators: CryptoScalpIndicators
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 1. RSI oversold
    if (indicators.rsi <= this.params.rsi.oversoldThreshold) {
      score += 2;
      reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`);
    } else if (indicators.rsi <= this.params.rsi.oversoldThreshold + 5) {
      score += 1;
      reasons.push(`RSI near oversold (${indicators.rsi.toFixed(1)})`);
    }

    // 2. Bollinger Band position
    if (indicators.bbZone === 'LOWER_EXTREME') {
      score += 2;
      reasons.push('BB lower extreme');
    } else if (indicators.bbZone === 'LOWER') {
      score += 1;
      reasons.push('BB lower zone');
    }

    // 3. VWAP bias
    if (this.params.vwap.useAsFilter) {
      if (indicators.vwapBias === 'BULLISH') {
        score += 1;
        reasons.push('VWAP bullish');
      } else if (indicators.vwapBias === 'BEARISH') {
        score -= 1; // Counter-trend, reduce confidence
      }
    }

    // 4. ADX trend filter
    if (this.params.adx.useAsFilter) {
      const adxResult = {
        adx: indicators.adx,
        plusDI: indicators.plusDI,
        minusDI: indicators.minusDI,
        trendStrength: indicators.trendStrength,
        trendDirection: 'NEUTRAL' as const,
      };

      // Mean reversion works better in ranging markets
      if (!isTrending(adxResult, 'MODERATE')) {
        score += 1;
        reasons.push('Ranging market');
      }

      // But also check DI for potential reversal
      if (indicators.minusDI > indicators.plusDI + 10) {
        score += 1;
        reasons.push('Strong -DI (reversal potential)');
      }
    }

    // 5. Volume confirmation
    if (this.params.volume.enabled) {
      if (indicators.volumeRatio >= this.params.volume.highVolumeThreshold) {
        score += 1;
        reasons.push('High volume');
      } else if (indicators.volumeRatio < this.params.volume.minRatioForEntry) {
        score -= 1;
        reasons.push('Low volume');
      }
    }

    return { score, reasons };
  }

  /**
   * Check SHORT entry conditions
   */
  private checkShortConditions(
    indicators: CryptoScalpIndicators
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 1. RSI overbought
    if (indicators.rsi >= this.params.rsi.overboughtThreshold) {
      score += 2;
      reasons.push(`RSI overbought (${indicators.rsi.toFixed(1)})`);
    } else if (indicators.rsi >= this.params.rsi.overboughtThreshold - 5) {
      score += 1;
      reasons.push(`RSI near overbought (${indicators.rsi.toFixed(1)})`);
    }

    // 2. Bollinger Band position
    if (indicators.bbZone === 'UPPER_EXTREME') {
      score += 2;
      reasons.push('BB upper extreme');
    } else if (indicators.bbZone === 'UPPER') {
      score += 1;
      reasons.push('BB upper zone');
    }

    // 3. VWAP bias
    if (this.params.vwap.useAsFilter) {
      if (indicators.vwapBias === 'BEARISH') {
        score += 1;
        reasons.push('VWAP bearish');
      } else if (indicators.vwapBias === 'BULLISH') {
        score -= 1; // Counter-trend
      }
    }

    // 4. ADX trend filter
    if (this.params.adx.useAsFilter) {
      const adxResult = {
        adx: indicators.adx,
        plusDI: indicators.plusDI,
        minusDI: indicators.minusDI,
        trendStrength: indicators.trendStrength,
        trendDirection: 'NEUTRAL' as const,
      };

      // Mean reversion in ranging markets
      if (!isTrending(adxResult, 'MODERATE')) {
        score += 1;
        reasons.push('Ranging market');
      }

      // Check DI for reversal
      if (indicators.plusDI > indicators.minusDI + 10) {
        score += 1;
        reasons.push('Strong +DI (reversal potential)');
      }
    }

    // 5. Volume confirmation
    if (this.params.volume.enabled) {
      if (indicators.volumeRatio >= this.params.volume.highVolumeThreshold) {
        score += 1;
        reasons.push('High volume');
      } else if (indicators.volumeRatio < this.params.volume.minRatioForEntry) {
        score -= 1;
      }
    }

    return { score, reasons };
  }

  /**
   * Check exit conditions
   */
  checkExit(
    candles: Candle[],
    currentIndex: number,
    entryPrice: number,
    direction: Direction,
    barsHeld: number,
    highestPnlPct: number
  ): CryptoScalpExitSignal | null {
    const currentCandle = candles[currentIndex]!;
    const currentPrice = currentCandle.close;

    // Calculate P&L
    const pnlPct =
      direction === 'CALL'
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

    // Get ATR for dynamic levels
    const atrResult = calculateATR(candles.slice(0, currentIndex + 1), this.params.atr);
    const tpPct = atrResult?.suggestedTP ?? this.params.takeProfitLevels[0]?.profitPercent ?? 0.5;
    const slPct = atrResult?.suggestedSL ?? this.params.baseStopLossPct;

    // 1. Stop Loss
    if (pnlPct <= -slPct) {
      return {
        price: currentPrice,
        timestamp: currentCandle.timestamp,
        reason: 'STOP_LOSS',
        pnlPercent: pnlPct,
      };
    }

    // 2. Take Profit
    if (pnlPct >= tpPct) {
      return {
        price: currentPrice,
        timestamp: currentCandle.timestamp,
        reason: 'TAKE_PROFIT',
        pnlPercent: pnlPct,
      };
    }

    // 3. Trailing Stop
    if (this.params.trailingStop.enabled && highestPnlPct >= this.params.trailingStop.activationPct) {
      const trailDistance = this.params.trailingStop.useATR
        ? (atrResult?.atrPercent ?? 0.1) * this.params.trailingStop.atrMultiplier
        : this.params.trailingStop.trailPct;

      if (pnlPct <= highestPnlPct - trailDistance) {
        return {
          price: currentPrice,
          timestamp: currentCandle.timestamp,
          reason: 'TRAILING_STOP',
          pnlPercent: pnlPct,
        };
      }
    }

    // 4. Time limit
    if (barsHeld >= this.params.maxBarsInTrade) {
      return {
        price: currentPrice,
        timestamp: currentCandle.timestamp,
        reason: 'TIME_LIMIT',
        pnlPercent: pnlPct,
      };
    }

    // 5. Signal reversal
    const indicators = this.calculateIndicators(candles.slice(0, currentIndex + 1));
    if (indicators) {
      // LONG position - exit on overbought
      if (direction === 'CALL' && indicators.rsi >= 70 && indicators.bbZone === 'UPPER') {
        return {
          price: currentPrice,
          timestamp: currentCandle.timestamp,
          reason: 'SIGNAL_REVERSAL',
          pnlPercent: pnlPct,
        };
      }

      // SHORT position - exit on oversold
      if (direction === 'PUT' && indicators.rsi <= 30 && indicators.bbZone === 'LOWER') {
        return {
          price: currentPrice,
          timestamp: currentCandle.timestamp,
          reason: 'SIGNAL_REVERSAL',
          pnlPercent: pnlPct,
        };
      }
    }

    return null;
  }

  /**
   * Process a closed trade for state management
   */
  onTradeClose(isWin: boolean, currentIndex: number): void {
    this.state.lastTradeIndex = currentIndex;
    this.state.state = 'COOLING_DOWN';

    if (isWin) {
      this.state.consecutiveLosses = 0;
    } else {
      this.state.consecutiveLosses++;

      // Check if we need to pause
      if (this.state.consecutiveLosses >= this.params.maxConsecutiveLosses) {
        this.state.pauseUntilIndex = currentIndex + this.params.pauseDurationBars;
        this.state.consecutiveLosses = 0;
      }
    }
  }

  /**
   * Update state after cooldown
   */
  updateState(currentIndex: number): void {
    if (this.state.state === 'COOLING_DOWN') {
      if (
        this.state.lastTradeIndex < 0 ||
        currentIndex - this.state.lastTradeIndex >= this.params.cooldownBars
      ) {
        this.state.state = 'SCANNING';
      }
    }
  }

  /**
   * Get current strategy state
   */
  getState(): CryptoScalpStrategyState {
    return { ...this.state };
  }

  /**
   * Get strategy parameters
   */
  getParams(): CryptoScalpParams {
    return { ...this.params };
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Get required warmup period
   */
  getWarmupPeriod(): number {
    return Math.max(
      this.params.rsi.period,
      this.params.vwap.periods,
      this.params.adx.period * 2,
      this.params.atr.period,
      this.params.bb.period,
      this.params.volume.smaPeriod
    ) + 10;
  }
}

/**
 * Factory function
 */
export function createCryptoScalpStrategy(
  asset: string,
  params?: Partial<CryptoScalpParams>
): CryptoScalpStrategy {
  return new CryptoScalpStrategy(asset, params);
}
