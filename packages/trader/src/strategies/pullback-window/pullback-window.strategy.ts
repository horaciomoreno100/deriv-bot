/**
 * Pullback Window Strategy
 *
 * State machine-based scalping strategy with 4 phases:
 * 1. SCANNING: Looking for EMA crossover
 * 2. ARMED: Waiting for pullback against trend
 * 3. WINDOW_OPEN: Waiting for breakout
 * 4. ENTRY: Signal confirmed
 */

import type { Candle, Signal } from '@deriv-bot/shared';
import type {
  PullbackWindowParams,
  PhaseState,
  TradingPhase,
  TradeDirection,
  PullbackWindowSignalMetadata,
} from './pullback-window.types.js';
import { TradingPhase as Phase } from './pullback-window.types.js';
import { mergeParams } from './pullback-window.params.js';

export class PullbackWindowStrategy {
  private readonly params: PullbackWindowParams;
  private state: PhaseState;

  constructor(
    private readonly asset: string,
    customParams?: Partial<PullbackWindowParams>,
    _debug: boolean = false
  ) {
    this.params = mergeParams(customParams);
    this.state = this.resetState();
  }

  /**
   * Main entry point - evaluate current candle for signal
   */
  public evaluateEntry(
    candles: Candle[],
    currentIndex: number,
    indicators: Record<string, number>
  ): Signal | null {
    // Need enough history for EMAs
    if (currentIndex < this.params.emaSlowPeriod + 5) {
      return null;
    }

    const candle = candles[currentIndex]!;

    // Extract indicators
    const ema1 = indicators.ema1 ?? indicators[`ema${this.params.emaConfirmPeriod}`];
    const ema14 = indicators.ema14 ?? indicators[`ema${this.params.emaFastPeriod}`];
    const ema18 = indicators.ema18 ?? indicators[`ema${this.params.emaMediumPeriod}`];
    const ema24 = indicators.ema24 ?? indicators[`ema${this.params.emaSlowPeriod}`];
    const atr = indicators.atr;
    const adx = indicators.adx;

    // Validate required indicators
    if (
      typeof ema1 !== 'number' ||
      typeof ema14 !== 'number' ||
      typeof ema18 !== 'number' ||
      typeof ema24 !== 'number' ||
      typeof atr !== 'number'
    ) {
      return null;
    }

    // Optional ADX filter
    if (this.params.minAdx > 0 && typeof adx === 'number' && adx < this.params.minAdx) {
      // Weak trend, reset to scanning
      if (this.state.phase !== Phase.SCANNING) {
        this.transitionTo(Phase.SCANNING, currentIndex, candle.close, 'ADX too weak');
      }
      return null;
    }

    // State machine logic
    switch (this.state.phase) {
      case Phase.SCANNING:
        this.handleScanning(candles, currentIndex, ema1, ema14, ema18, ema24);
        break;

      case Phase.ARMED:
        this.handleArmed(candles, currentIndex, atr);
        break;

      case Phase.WINDOW_OPEN:
        return this.handleWindowOpen(candles, currentIndex, atr, adx, {
          ema1,
          ema14,
          ema18,
          ema24,
        });

      case Phase.ENTRY:
        // Entry signal was already generated in previous candle
        // Reset to scanning for next opportunity
        this.transitionTo(Phase.SCANNING, currentIndex, candle.close, 'Entry processed');
        break;
    }

    return null;
  }

  /**
   * PHASE 1: SCANNING
   * Look for EMA crossover to start setup
   */
  private handleScanning(
    candles: Candle[],
    currentIndex: number,
    ema1: number,
    ema14: number,
    ema18: number,
    ema24: number
  ): void {
    const candle = candles[currentIndex]!;
    const prevCandle = candles[currentIndex - 1];

    if (!prevCandle) return;

    // LONG: EMA(1) crosses above EMA(14), EMA(18), EMA(24)
    // Confirm with green candle
    const longCrossover =
      ema1 > ema14 &&
      ema1 > ema18 &&
      ema1 > ema24 &&
      candle.close > candle.open;  // Green candle

    // SHORT: EMA(1) crosses below EMA(14), EMA(18), EMA(24)
    // Confirm with red candle
    const shortCrossover =
      ema1 < ema14 &&
      ema1 < ema18 &&
      ema1 < ema24 &&
      candle.close < candle.open;  // Red candle

    if (longCrossover) {
      this.state.direction = 'LONG';
      this.state.pullbackCount = 0;
      this.state.armingCandle = currentIndex;
      this.transitionTo(Phase.ARMED, currentIndex, candle.close, 'LONG crossover detected');
    } else if (shortCrossover) {
      this.state.direction = 'SHORT';
      this.state.pullbackCount = 0;
      this.state.armingCandle = currentIndex;
      this.transitionTo(Phase.ARMED, currentIndex, candle.close, 'SHORT crossover detected');
    }
  }

  /**
   * PHASE 2: ARMED
   * Wait for pullback against trend
   */
  private handleArmed(candles: Candle[], currentIndex: number, atr: number): void {
    const candle = candles[currentIndex]!;
    const direction = this.state.direction;

    if (!direction) {
      this.transitionTo(Phase.SCANNING, currentIndex, candle.close, 'No direction set');
      return;
    }

    // Check for opposite signal (invalidation)
    if (this.detectOppositeSignal(candles, currentIndex)) {
      this.transitionTo(Phase.SCANNING, currentIndex, candle.close, 'Opposite signal detected');
      return;
    }

    // Count pullback candles
    const isPullbackCandle =
      direction === 'LONG'
        ? candle.close < candle.open  // Red candle for LONG
        : candle.close > candle.open;  // Green candle for SHORT

    if (isPullbackCandle) {
      this.state.pullbackCount++;

      // Track pullback extremes
      if (direction === 'LONG') {
        const currentHigh = this.state.pullbackHigh ?? candle.high;
        this.state.pullbackHigh = Math.max(currentHigh, candle.high);
      } else {
        const currentLow = this.state.pullbackLow ?? candle.low;
        this.state.pullbackLow = Math.min(currentLow, candle.low);
      }
    } else {
      // Trend-direction candle appeared, check if we can open window
      const maxPullback =
        direction === 'LONG'
          ? this.params.longPullbackMaxCandles
          : this.params.shortPullbackMaxCandles;

      if (
        this.state.pullbackCount >= this.params.minPullbackCandles &&
        this.state.pullbackCount <= maxPullback
      ) {
        // Open window
        this.openWindow(currentIndex, candle, atr, direction);
      } else {
        // Pullback too short or too long, reset
        this.transitionTo(
          Phase.SCANNING,
          currentIndex,
          candle.close,
          `Pullback ${this.state.pullbackCount} candles (need ${this.params.minPullbackCandles}-${maxPullback})`
        );
      }
    }

    // Check if pullback exceeded max
    const maxPullback =
      direction === 'LONG'
        ? this.params.longPullbackMaxCandles
        : this.params.shortPullbackMaxCandles;

    if (this.state.pullbackCount > maxPullback) {
      this.transitionTo(
        Phase.SCANNING,
        currentIndex,
        candle.close,
        `Pullback too long (${this.state.pullbackCount} > ${maxPullback})`
      );
    }
  }

  /**
   * PHASE 3: WINDOW_OPEN
   * Wait for price to break through breakout level
   */
  private handleWindowOpen(
    candles: Candle[],
    currentIndex: number,
    atr: number,
    adx: number | undefined,
    emas: { ema1: number; ema14: number; ema18: number; ema24: number }
  ): Signal | null {
    const candle = candles[currentIndex]!;
    const direction = this.state.direction;

    if (!direction || this.state.breakoutLevel === null || this.state.windowStart === null) {
      this.transitionTo(Phase.SCANNING, currentIndex, candle.close, 'Invalid window state');
      return null;
    }

    // Check for opposite signal (invalidation)
    if (this.detectOppositeSignal(candles, currentIndex)) {
      this.transitionTo(Phase.SCANNING, currentIndex, candle.close, 'Opposite signal in window');
      return null;
    }

    // Check if price hit invalidation level
    if (this.state.invalidationLevel !== null) {
      const invalidated =
        direction === 'LONG'
          ? candle.low <= this.state.invalidationLevel
          : candle.high >= this.state.invalidationLevel;

      if (invalidated) {
        this.transitionTo(
          Phase.SCANNING,
          currentIndex,
          candle.close,
          'Invalidation level hit'
        );
        return null;
      }
    }

    // Check for breakout
    const breakout =
      direction === 'LONG'
        ? candle.high > this.state.breakoutLevel
        : candle.low < this.state.breakoutLevel;

    if (breakout) {
      // ENTRY! Generate signal
      const signal = this.generateSignal(candle, atr, adx, emas);
      this.transitionTo(Phase.ENTRY, currentIndex, candle.close, 'Breakout confirmed');
      return signal;
    }

    // Check if window expired
    this.state.windowCandlesRemaining--;
    if (this.state.windowCandlesRemaining <= 0) {
      this.transitionTo(
        Phase.SCANNING,
        currentIndex,
        candle.close,
        'Window expired without breakout'
      );
    }

    return null;
  }

  /**
   * Open entry window after valid pullback
   */
  private openWindow(
    currentIndex: number,
    candle: Candle,
    atr: number,
    direction: TradeDirection
  ): void {
    if (!direction) return;

    // Calculate breakout level based on pullback extremes + ATR offset
    const offset = atr * this.params.windowOffsetMultiplier;

    if (direction === 'LONG') {
      this.state.breakoutLevel = (this.state.pullbackHigh ?? candle.high) + offset;
      this.state.invalidationLevel = (this.state.pullbackLow ?? candle.low) - offset;
      this.state.windowCandlesRemaining = this.params.longEntryWindowPeriods;
    } else {
      this.state.breakoutLevel = (this.state.pullbackLow ?? candle.low) - offset;
      this.state.invalidationLevel = (this.state.pullbackHigh ?? candle.high) + offset;
      this.state.windowCandlesRemaining = this.params.shortEntryWindowPeriods;
    }

    this.state.windowStart = currentIndex;
    this.transitionTo(
      Phase.WINDOW_OPEN,
      currentIndex,
      candle.close,
      `Window opened: breakout=${this.state.breakoutLevel.toFixed(2)}`
    );
  }

  /**
   * Generate entry signal with metadata
   */
  private generateSignal(
    candle: Candle,
    atr: number,
    adx: number | undefined,
    emas: { ema1: number; ema14: number; ema18: number; ema24: number }
  ): Signal {
    const direction = this.state.direction;
    const breakoutLevel = this.state.breakoutLevel!;
    const price = candle.close;

    // Calculate SL/TP based on ATR
    const slDistance = atr * this.params.slAtrMultiplier;
    const tpDistance = atr * this.params.tpAtrMultiplier;

    const slPrice = direction === 'LONG' ? price - slDistance : price + slDistance;
    const tpPrice = direction === 'LONG' ? price + tpDistance : price - tpDistance;

    const metadata: PullbackWindowSignalMetadata = {
      phase: this.state.phase,
      pullbackCandles: this.state.pullbackCount,
      breakoutLevel,
      invalidationLevel: this.state.invalidationLevel!,
      atr,
      slPrice,
      tpPrice,
      adx,
      ema1: emas.ema1,
      ema14: emas.ema14,
      ema18: emas.ema18,
      ema24: emas.ema24,
      price, // Include price in metadata for CFD trades
      entryPrice: price, // Alias for compatibility
    };

    return {
      symbol: this.asset,
      asset: this.asset, // Keep for compatibility
      direction: direction === 'LONG' ? 'CALL' : 'PUT',
      confidence: 0.8,
      timestamp: candle.timestamp,
      strategyName: 'PULLBACK-WINDOW',
      reason: `PullbackWindow: ${direction} breakout after ${this.state.pullbackCount}-candle pullback | SL: ${slPrice.toFixed(2)} | TP: ${tpPrice.toFixed(2)}`,
      metadata,
    };
  }

  /**
   * Detect opposite signal (invalidates current setup)
   */
  private detectOppositeSignal(candles: Candle[], currentIndex: number): boolean {
    const candle = candles[currentIndex]!;
    const direction = this.state.direction;

    if (!direction) return false;

    // Simple check: strong candle in opposite direction
    const candleSize = Math.abs(candle.close - candle.open);
    const atrEstimate = candleSize * 2; // Rough estimate

    if (direction === 'LONG') {
      // Big red candle could invalidate LONG setup
      return candle.close < candle.open && candleSize > atrEstimate;
    } else {
      // Big green candle could invalidate SHORT setup
      return candle.close > candle.open && candleSize > atrEstimate;
    }
  }

  /**
   * Transition to new phase
   */
  private transitionTo(
    newPhase: TradingPhase,
    _candleIndex: number,
    _price: number,
    _reason: string
  ): void {
    this.state.phase = newPhase;

    // Log transition (optional, for debugging)
    // console.log(`[${this.asset}] ${this.state.phase} → ${newPhase}: ${_reason} (idx=${_candleIndex}, price=${_price.toFixed(2)})`);

    // Reset state when going back to SCANNING
    if (newPhase === Phase.SCANNING) {
      this.state = this.resetState();
    }
  }

  /**
   * Reset state machine to initial state
   */
  private resetState(): PhaseState {
    return {
      phase: Phase.SCANNING,
      direction: null,
      pullbackCount: 0,
      windowStart: null,
      windowCandlesRemaining: 0,
      breakoutLevel: null,
      invalidationLevel: null,
      armingCandle: null,
      pullbackHigh: null,
      pullbackLow: null,
    };
  }

  /**
   * Get current state (for debugging)
   */
  public getState(): PhaseState {
    return { ...this.state };
  }
}
