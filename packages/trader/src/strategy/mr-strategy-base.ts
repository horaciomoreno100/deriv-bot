/**
 * Mean Reversion Strategy Base
 *
 * Abstract base class for all Mean Reversion strategies.
 * Provides common functionality for MR signal generation, filtering, and exit logic.
 */

import type { Candle, Signal } from '@deriv-bot/shared';
import { NewsFilterService, createNewsFilter } from '@deriv-bot/shared';
import { SessionFilterService } from '../services/session-filter.service.js';
import { calculateATR, calculateADX, calculateRSI, calculateEMA, calculateBollingerBands } from '../indicators/index.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Direction of trade
 */
export type TradeDirection = 'LONG' | 'SHORT';

/**
 * Exit reason for a trade
 */
export type ExitReason = 'TP' | 'SL' | 'TIME' | 'SIGNAL' | 'TRAILING' | 'MANUAL';

/**
 * Trade signal with entry/exit parameters
 */
export interface MRTradeSignal {
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  maxBars: number;
  metadata: Record<string, unknown>;
}

/**
 * Active trade being tracked
 */
export interface ActiveTrade {
  id: string;
  direction: TradeDirection;
  entryPrice: number;
  entryTime: number;
  entryBar: number;
  stopLoss: number;
  takeProfit: number;
  maxBars: number;
  metadata: Record<string, unknown>;
}

/**
 * Closed trade result
 */
export interface ClosedTrade extends ActiveTrade {
  exitPrice: number;
  exitTime: number;
  exitBar: number;
  exitReason: ExitReason;
  pnl: number;
  pnlPct: number;
  barsHeld: number;
}

/**
 * Common MR strategy parameters
 */
export interface MRStrategyParams {
  // Indicator periods
  atrPeriod: number;
  adxPeriod: number;
  rsiPeriod: number;
  emaPeriod: number;

  // ADX threshold for ranging market
  adxThreshold: number;

  // Stop loss multiplier (x ATR)
  slMultiplier: number;

  // Maximum bars to hold position
  maxBars: number;

  // Minimum candles required
  minCandles: number;

  // Filters
  enableNewsFilter: boolean;
  enableSessionFilter: boolean;

  // Asset type
  assetType: 'synthetic' | 'forex' | 'commodities';
}

/**
 * Default MR parameters
 */
export const DEFAULT_MR_PARAMS: MRStrategyParams = {
  atrPeriod: 14,
  adxPeriod: 14,
  rsiPeriod: 14,
  emaPeriod: 20,
  adxThreshold: 25,
  slMultiplier: 1.5,
  maxBars: 12,
  minCandles: 50,
  enableNewsFilter: false,
  enableSessionFilter: false,
  assetType: 'forex',
};

/**
 * Indicator values at a point in time
 */
export interface IndicatorSnapshot {
  atr: number;
  adx: number;
  rsi: number;
  ema: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  price: number;
  timestamp: number;
}

/**
 * Filter result
 */
export interface FilterResult {
  canTrade: boolean;
  reason?: string;
}

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

/**
 * Abstract base class for Mean Reversion strategies
 *
 * Subclasses must implement:
 * - checkEntry(): Generate entry signal based on strategy logic
 * - checkExit(): Check if position should be closed
 * - getName(): Return strategy name
 * - getDefaultParams(): Return strategy-specific default params
 */
export abstract class MRStrategyBase {
  protected params: MRStrategyParams;
  protected newsFilter: NewsFilterService | null = null;
  protected sessionFilter: SessionFilterService | null = null;
  protected activeTrade: ActiveTrade | null = null;
  protected closedTrades: ClosedTrade[] = [];
  protected currentBar: number = 0;

  constructor(params: Partial<MRStrategyParams> = {}) {
    // Merge with strategy-specific defaults, then user params
    this.params = {
      ...DEFAULT_MR_PARAMS,
      ...this.getDefaultParams(),
      ...params,
    };

    // Initialize filters
    if (this.params.enableNewsFilter && this.params.assetType !== 'synthetic') {
      this.newsFilter = createNewsFilter({
        minutesBeforeHigh: 15,
        minutesAfterHigh: 30,
        minutesBeforeMedium: 10,
        minutesAfterMedium: 15,
        currencies: ['USD', 'EUR'],
      });
    }

    if (this.params.enableSessionFilter) {
      this.sessionFilter = new SessionFilterService();
    }
  }

  // ============================================================================
  // ABSTRACT METHODS (must be implemented by subclasses)
  // ============================================================================

  /**
   * Strategy name identifier
   */
  abstract getName(): string;

  /**
   * Strategy-specific default parameters
   */
  abstract getDefaultParams(): Partial<MRStrategyParams>;

  /**
   * Check for entry signal
   * @param candles - Historical candles including current
   * @param indicators - Pre-calculated indicator values
   * @returns Trade signal or null if no entry
   */
  abstract checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot
  ): MRTradeSignal | null;

  /**
   * Check for exit signal
   * @param candles - Historical candles including current
   * @param indicators - Pre-calculated indicator values
   * @param trade - Current active trade
   * @returns Exit reason or null if should hold
   */
  abstract checkExit(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    trade: ActiveTrade
  ): ExitReason | null;

  // ============================================================================
  // MAIN PROCESSING
  // ============================================================================

  /**
   * Process a new candle
   * Returns Signal for external systems or null
   */
  onCandle(candle: Candle, candles: Candle[], asset: string): Signal | null {
    this.currentBar++;

    // Check if we have enough data
    if (candles.length < this.params.minCandles) {
      return null;
    }

    // Calculate indicators
    const indicators = this.calculateIndicators(candles);
    if (!indicators) {
      return null;
    }

    // Check filters
    const filterResult = this.applyFilters(candle, asset);
    if (!filterResult.canTrade) {
      return null;
    }

    // If we have an active trade, check for exit
    if (this.activeTrade) {
      const exitReason = this.checkExit(candles, indicators, this.activeTrade);

      // Also check for automatic exits (SL, TP, time)
      const autoExit = this.checkAutoExit(candle, this.activeTrade);

      if (exitReason || autoExit) {
        this.closeTrade(candle, exitReason || autoExit!);
      }

      // Don't generate new signals while in a trade
      return null;
    }

    // Check for entry
    const entrySignal = this.checkEntry(candles, indicators);
    if (!entrySignal) {
      return null;
    }

    // Apply session-specific adjustments
    if (this.sessionFilter) {
      const sessionParams = this.sessionFilter.getSessionParams(candle.timestamp);
      entrySignal.stopLoss = candle.close - (candle.close - entrySignal.stopLoss) * sessionParams.slMultiplier;
    }

    // Open the trade
    this.openTrade(candle, entrySignal);

    // Convert to Signal format for external systems
    return this.toSignal(entrySignal, asset, candle.close);
  }

  // ============================================================================
  // INDICATOR CALCULATION
  // ============================================================================

  /**
   * Calculate all indicators for current candles
   */
  protected calculateIndicators(candles: Candle[]): IndicatorSnapshot | null {
    try {
      const atrValues = calculateATR(candles, this.params.atrPeriod);
      const adxValues = calculateADX(candles, this.params.adxPeriod);
      const rsiValues = calculateRSI(candles, this.params.rsiPeriod);
      const emaValues = calculateEMA(candles, this.params.emaPeriod);
      const bbValues = calculateBollingerBands(candles, 20, 2);

      const lastCandle = candles[candles.length - 1]!;
      const atr = atrValues[atrValues.length - 1];
      const adxObj = adxValues[adxValues.length - 1];
      const rsi = rsiValues[rsiValues.length - 1];
      const ema = emaValues[emaValues.length - 1];
      const bb = bbValues[bbValues.length - 1];

      if (
        atr === undefined ||
        !adxObj ||
        rsi === undefined ||
        ema === undefined ||
        !bb
      ) {
        return null;
      }

      return {
        atr,
        adx: adxObj.adx,
        rsi,
        ema,
        bbUpper: bb.upper,
        bbMiddle: bb.middle,
        bbLower: bb.lower,
        bbWidth: (bb.upper - bb.lower) / bb.middle,
        price: lastCandle.close,
        timestamp: lastCandle.timestamp,
      };
    } catch {
      return null;
    }
  }

  // ============================================================================
  // FILTER APPLICATION
  // ============================================================================

  /**
   * Apply all filters (news, session, etc.)
   */
  protected applyFilters(candle: Candle, asset: string): FilterResult {
    // News filter
    if (this.newsFilter && this.params.enableNewsFilter) {
      const forexPair = this.getForexPairForAsset(asset);
      if (forexPair) {
        const newsCheck = this.newsFilter.shouldTradeAt(
          Math.floor(candle.timestamp / 1000),
          forexPair
        );
        if (!newsCheck.canTrade) {
          return { canTrade: false, reason: newsCheck.reason };
        }
      }
    }

    // Session filter
    if (this.sessionFilter && this.params.enableSessionFilter) {
      const sessionCheck = this.sessionFilter.shouldTrade(candle.timestamp);
      if (!sessionCheck) {
        return { canTrade: false, reason: 'Outside trading session' };
      }
    }

    return { canTrade: true };
  }

  /**
   * Map asset to forex pair for news filtering
   */
  protected getForexPairForAsset(asset: string): string | null {
    const mapping: Record<string, string> = {
      frxEURUSD: 'EURUSD',
      frxGBPUSD: 'GBPUSD',
      frxUSDJPY: 'USDJPY',
      frxAUDUSD: 'AUDUSD',
      frxUSDCAD: 'USDCAD',
      frxUSDCHF: 'USDCHF',
      frxNZDUSD: 'NZDUSD',
      frxXAUUSD: 'XAUUSD',
      frxXAGUSD: 'XAGUSD',
    };
    return mapping[asset] ?? null;
  }

  // ============================================================================
  // TRADE MANAGEMENT
  // ============================================================================

  /**
   * Open a new trade
   */
  protected openTrade(candle: Candle, signal: MRTradeSignal): void {
    this.activeTrade = {
      id: `${this.getName()}-${Date.now()}`,
      direction: signal.direction,
      entryPrice: candle.close,
      entryTime: candle.timestamp,
      entryBar: this.currentBar,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      maxBars: signal.maxBars,
      metadata: signal.metadata,
    };
  }

  /**
   * Close the active trade
   */
  protected closeTrade(candle: Candle, reason: ExitReason): void {
    if (!this.activeTrade) return;

    const exitPrice = candle.close;
    const pnl =
      this.activeTrade.direction === 'LONG'
        ? exitPrice - this.activeTrade.entryPrice
        : this.activeTrade.entryPrice - exitPrice;

    const closedTrade: ClosedTrade = {
      ...this.activeTrade,
      exitPrice,
      exitTime: candle.timestamp,
      exitBar: this.currentBar,
      exitReason: reason,
      pnl,
      pnlPct: (pnl / this.activeTrade.entryPrice) * 100,
      barsHeld: this.currentBar - this.activeTrade.entryBar,
    };

    this.closedTrades.push(closedTrade);
    this.activeTrade = null;
  }

  /**
   * Check for automatic exits (SL, TP, time)
   */
  protected checkAutoExit(candle: Candle, trade: ActiveTrade): ExitReason | null {
    const price = candle.close;
    const barsHeld = this.currentBar - trade.entryBar;

    if (trade.direction === 'LONG') {
      // Stop loss
      if (price <= trade.stopLoss) {
        return 'SL';
      }
      // Take profit
      if (price >= trade.takeProfit) {
        return 'TP';
      }
    } else {
      // Stop loss
      if (price >= trade.stopLoss) {
        return 'SL';
      }
      // Take profit
      if (price <= trade.takeProfit) {
        return 'TP';
      }
    }

    // Time exit
    if (barsHeld >= trade.maxBars) {
      return 'TIME';
    }

    return null;
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Convert internal signal to external Signal format
   */
  protected toSignal(signal: MRTradeSignal, asset: string, entryPrice: number): Signal {
    return {
      strategyName: this.getName(),
      symbol: asset,
      asset,
      direction: signal.direction === 'LONG' ? 'CALL' : 'PUT',
      confidence: signal.confidence,
      timestamp: Date.now(),
      metadata: {
        ...signal.metadata,
        price: entryPrice, // Entry price for CFD trades
        currentPrice: entryPrice, // Alias for compatibility
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        maxBars: signal.maxBars,
      },
    };
  }

  /**
   * Get current parameters
   */
  getParams(): MRStrategyParams {
    return { ...this.params };
  }

  /**
   * Update parameters
   */
  updateParams(params: Partial<MRStrategyParams>): void {
    this.params = { ...this.params, ...params };
  }

  /**
   * Get active trade
   */
  getActiveTrade(): ActiveTrade | null {
    return this.activeTrade ? { ...this.activeTrade } : null;
  }

  /**
   * Get closed trades
   */
  getClosedTrades(): ClosedTrade[] {
    return [...this.closedTrades];
  }

  /**
   * Reset state (for backtesting)
   */
  reset(): void {
    this.activeTrade = null;
    this.closedTrades = [];
    this.currentBar = 0;
  }

  /**
   * Check if ADX indicates ranging market (good for MR)
   */
  protected isRangingMarket(adx: number): boolean {
    return adx < this.params.adxThreshold;
  }

  /**
   * Calculate stop loss price
   */
  protected calculateSL(
    direction: TradeDirection,
    price: number,
    atr: number
  ): number {
    const distance = atr * this.params.slMultiplier;
    return direction === 'LONG' ? price - distance : price + distance;
  }
}
