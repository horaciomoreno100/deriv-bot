/**
 * RSI Scalp Strategy
 *
 * Scalping strategy for crypto using RSI with DCA entries.
 *
 * Key features:
 * - RSI oversold/overbought detection
 * - Dollar Cost Averaging (DCA) for entries
 * - EMA trend filter
 * - Dual exit system (price % + RSI threshold)
 * - Daily risk limits
 */

import { RSI, EMA, SMA } from 'technicalindicators';
import { v4 as uuidv4 } from 'uuid';
import type { Candle } from '@deriv-bot/shared';
import type {
  RSIScalpParams,
  RSIScalpState,
  ScalpPosition,
  ScalpEntry,
  EntryLevel,
  ExitCheckResult,
  PositionMetrics,
  RSIScalpTradeSetup,
  IndicatorSnapshot,
} from './rsi-scalp.types.js';
import { DEFAULT_RSI_SCALP_PARAMS, getParamsForAsset } from './rsi-scalp.params.js';

/**
 * RSI Scalp Strategy Class
 */
export class RSIScalpStrategy {
  private params: RSIScalpParams;
  private state: Map<string, RSIScalpState> = new Map();
  private candles: Map<string, Candle[]> = new Map();
  private readonly maxCandles = 500;

  constructor(params?: Partial<RSIScalpParams>) {
    this.params = { ...DEFAULT_RSI_SCALP_PARAMS, ...params };
  }

  /**
   * Initialize state for a symbol
   */
  initializeSymbol(symbol: string): void {
    if (!this.state.has(symbol)) {
      const today = new Date().toISOString().split('T')[0] ?? '';
      this.state.set(symbol, {
        phase: 'SCANNING',
        lastRSI: 50,
        emaValue: 0,
        barsSinceLastTrade: 999,
        dailyTrades: 0,
        dailyPnL: 0,
        dailyResetDate: today,
      });
      this.candles.set(symbol, []);
    }
  }

  /**
   * Get asset-specific parameters
   */
  getParamsForSymbol(symbol: string): RSIScalpParams {
    return getParamsForAsset(symbol, this.params);
  }

  /**
   * Process a new candle
   */
  onCandle(candle: Candle): RSIScalpTradeSetup | null {
    const symbol = candle.asset;
    this.initializeSymbol(symbol);

    const params = this.getParamsForSymbol(symbol);
    const state = this.state.get(symbol)!;
    const candleArray = this.candles.get(symbol)!;

    // Add candle to history
    candleArray.push(candle);
    if (candleArray.length > this.maxCandles) {
      candleArray.shift();
    }

    // Need enough data for indicators
    const minCandles = Math.max(params.rsiPeriod, params.emaPeriod) + 10;
    if (candleArray.length < minCandles) {
      return null;
    }

    // Reset daily counters if new day
    this.checkDailyReset(state);

    // Calculate indicators
    const indicators = this.calculateIndicators(candleArray, params);
    if (!indicators) return null;

    state.lastRSI = indicators.rsi;
    state.emaValue = indicators.ema;
    state.barsSinceLastTrade++;

    // Check daily limits
    if (state.dailyTrades >= params.maxDailyTrades) {
      return null;
    }
    if (state.dailyPnL <= -params.maxDailyLossPercent) {
      return null;
    }

    // State machine
    switch (state.phase) {
      case 'SCANNING':
        return this.handleScanning(symbol, candle, indicators, params, state);

      case 'IN_POSITION':
        return this.handleInPosition(symbol, candle, indicators, params, state);

      case 'COOLING_DOWN':
        return this.handleCoolingDown(params, state);

      default:
        return null;
    }
  }

  /**
   * Handle SCANNING phase - look for entry opportunities
   */
  private handleScanning(
    symbol: string,
    _candle: Candle,
    indicators: IndicatorSnapshot,
    params: RSIScalpParams,
    state: RSIScalpState
  ): RSIScalpTradeSetup | null {
    const { rsi, ema, price } = indicators;

    // Determine direction based on trend filter
    let direction: 'LONG' | 'SHORT';
    if (params.useTrendFilter) {
      direction = price > ema ? 'LONG' : 'SHORT';
    } else {
      // Without filter, use RSI to determine
      direction = rsi < 50 ? 'LONG' : 'SHORT';
    }

    // Check entry conditions
    const entryLevel = this.checkEntryConditions(
      rsi,
      ema,
      price,
      direction,
      undefined,
      params
    );

    if (entryLevel) {
      // Validate trend filter
      if (params.useTrendFilter) {
        if (direction === 'LONG' && price < ema) return null;
        if (direction === 'SHORT' && price > ema) return null;
      }

      // Volume filter
      if (params.useVolumeFilter) {
        const candleArray = this.candles.get(symbol)!;
        if (!this.checkVolumeFilter(candleArray, params)) {
          return null;
        }
      }

      // Create new position
      const position = this.createPosition(symbol, direction, price, rsi, entryLevel, 0);
      state.position = position;
      state.phase = 'IN_POSITION';

      // Generate entry signal
      return this.generateEntrySignal(position, entryLevel, indicators, params);
    }

    return null;
  }

  /**
   * Handle IN_POSITION phase - manage position and exits
   */
  private handleInPosition(
    _symbol: string,
    candle: Candle,
    indicators: IndicatorSnapshot,
    params: RSIScalpParams,
    state: RSIScalpState
  ): RSIScalpTradeSetup | null {
    const position = state.position!;
    const { rsi, ema, price } = indicators;

    // Update position metrics
    this.updatePositionMetrics(position, price);

    // Check for DCA opportunity (add to position)
    const filledLevels = position.entries.length;
    const maxLevels = position.direction === 'LONG'
      ? params.entryLevels.long.filter(l => l.enabled).length
      : params.entryLevels.short.filter(l => l.enabled).length;

    if (filledLevels < maxLevels) {
      const nextLevel = this.checkEntryConditions(
        rsi,
        ema,
        price,
        position.direction,
        position,
        params
      );

      if (nextLevel) {
        // Add DCA entry
        this.addEntryToPosition(position, price, rsi, nextLevel, filledLevels);
        return this.generateDCASignal(position, nextLevel, indicators, params);
      }
    }

    // Check exit conditions
    const exitResult = this.checkExitConditions(position, price, rsi, params);

    if (exitResult.action !== 'NONE') {
      if (exitResult.action === 'FULL_EXIT') {
        // Full exit - close position
        const pnlPercent = position.unrealizedPnlPercent;
        state.dailyTrades++;
        state.dailyPnL += pnlPercent;
        state.phase = 'COOLING_DOWN';
        state.lastTradeTime = candle.timestamp;
        state.barsSinceLastTrade = 0;

        const signal = this.generateExitSignal(
          position,
          exitResult,
          indicators,
          params
        );

        state.position = undefined;
        return signal;
      } else {
        // Partial exit
        this.processPartialExit(position, exitResult.exitPercent);
        return this.generateExitSignal(position, exitResult, indicators, params);
      }
    }

    return null;
  }

  /**
   * Handle COOLING_DOWN phase - wait before next trade
   */
  private handleCoolingDown(
    params: RSIScalpParams,
    state: RSIScalpState
  ): RSIScalpTradeSetup | null {
    if (state.barsSinceLastTrade >= params.cooldownBars) {
      state.phase = 'SCANNING';
    }
    return null;
  }

  /**
   * Calculate RSI indicator
   */
  calculateRSI(candles: Candle[], period: number): number | null {
    if (candles.length < period + 1) return null;

    const closes = candles.map(c => c.close);
    const rsiValues = RSI.calculate({
      values: closes,
      period,
    });

    return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] ?? null : null;
  }

  /**
   * Calculate EMA indicator
   */
  calculateEMA(candles: Candle[], period: number): number | null {
    if (candles.length < period) return null;

    const closes = candles.map(c => c.close);
    const emaValues = EMA.calculate({
      values: closes,
      period,
    });

    return emaValues.length > 0 ? emaValues[emaValues.length - 1] ?? null : null;
  }

  /**
   * Calculate all indicators
   */
  private calculateIndicators(
    candles: Candle[],
    params: RSIScalpParams
  ): IndicatorSnapshot | null {
    const rsi = this.calculateRSI(candles, params.rsiPeriod);
    const ema = this.calculateEMA(candles, params.emaPeriod);

    if (rsi === null || ema === null) return null;

    const currentCandle = candles[candles.length - 1];
    if (!currentCandle) return null;

    const snapshot: IndicatorSnapshot = {
      rsi,
      ema,
      price: currentCandle.close,
    };

    // Volume calculations if needed
    if (params.useVolumeFilter && currentCandle.volume !== undefined) {
      const volumes = candles.slice(-params.volumePeriod).map(c => c.volume || 0);
      const smaValues = SMA.calculate({
        values: volumes,
        period: params.volumePeriod,
      });
      snapshot.volume = currentCandle.volume;
      snapshot.avgVolume = smaValues.length > 0 ? smaValues[smaValues.length - 1] : 0;
    }

    return snapshot;
  }

  /**
   * Check if entry conditions are met
   */
  checkEntryConditions(
    rsiValue: number,
    _ema: number,
    _price: number,
    direction: 'LONG' | 'SHORT',
    position: ScalpPosition | undefined,
    params: RSIScalpParams
  ): EntryLevel | null {
    const levels = direction === 'LONG'
      ? params.entryLevels.long
      : params.entryLevels.short;

    const enabledLevels = levels.filter(l => l.enabled);

    // Determine which level to check
    const currentLevelIndex = position ? position.entries.length : 0;
    if (currentLevelIndex >= enabledLevels.length) {
      return null; // All levels filled
    }

    const targetLevel = enabledLevels[currentLevelIndex];
    if (!targetLevel) return null;

    // Check RSI threshold
    if (direction === 'LONG') {
      if (rsiValue < targetLevel.rsiThreshold) {
        return targetLevel;
      }
    } else {
      if (rsiValue > targetLevel.rsiThreshold) {
        return targetLevel;
      }
    }

    return null;
  }

  /**
   * Check exit conditions
   */
  checkExitConditions(
    position: ScalpPosition,
    _currentPrice: number,
    rsi: number,
    params: RSIScalpParams
  ): ExitCheckResult {
    const pnlPercent = position.unrealizedPnlPercent;

    // Check stop loss first
    if (pnlPercent <= -params.stopLossPercent) {
      return {
        action: 'FULL_EXIT',
        exitPercent: 100,
        reason: `Stop loss hit: ${pnlPercent.toFixed(2)}%`,
      };
    }

    // Check take profit levels
    for (let i = 0; i < params.takeProfitLevels.length; i++) {
      const tpLevel = params.takeProfitLevels[i];
      if (!tpLevel) continue;

      // Skip if this TP was already hit
      if (i === 0 && position.tp1Hit) continue;
      if (i === 1 && position.tp2Hit) continue;

      const tpProfitPct = tpLevel.profitPercent;
      const tpExitPct = tpLevel.exitPercent;
      const tpRsiThresh = tpLevel.rsiThreshold;

      // Check profit condition
      const profitCondition = pnlPercent >= tpProfitPct;

      // Check RSI condition (if defined)
      let rsiCondition = false;
      if (tpRsiThresh !== undefined) {
        if (position.direction === 'LONG') {
          rsiCondition = rsi >= tpRsiThresh;
        } else {
          rsiCondition = rsi <= (100 - tpRsiThresh);
        }
      }

      // Either condition triggers TP
      if (profitCondition || rsiCondition) {
        const isPartial = tpExitPct < 100 && !position.tp1Hit;

        if (isPartial) {
          return {
            action: 'PARTIAL_EXIT',
            exitPercent: tpExitPct,
            reason: profitCondition
              ? `TP${i + 1}: Profit ${pnlPercent.toFixed(2)}% >= ${tpProfitPct}%`
              : `TP${i + 1}: RSI ${rsi.toFixed(1)} crossed ${tpRsiThresh ?? 50}`,
            tpLevel: i + 1,
          };
        } else {
          return {
            action: 'FULL_EXIT',
            exitPercent: 100,
            reason: profitCondition
              ? `TP${i + 1}: Profit ${pnlPercent.toFixed(2)}% >= ${tpProfitPct}%`
              : `TP${i + 1}: RSI ${rsi.toFixed(1)} crossed ${tpRsiThresh ?? 50}`,
            tpLevel: i + 1,
          };
        }
      }
    }

    return { action: 'NONE', exitPercent: 0, reason: '' };
  }

  /**
   * Calculate position metrics
   */
  calculatePositionMetrics(
    position: ScalpPosition,
    currentPrice: number
  ): PositionMetrics {
    const avgEntry = position.averageEntry;
    const direction = position.direction;

    // Calculate P&L
    let pnlPercent: number;
    if (direction === 'LONG') {
      pnlPercent = ((currentPrice - avgEntry) / avgEntry) * 100;
    } else {
      pnlPercent = ((avgEntry - currentPrice) / avgEntry) * 100;
    }

    // Adjust for remaining size after partial exits
    const effectivePnl = pnlPercent * (position.remainingSizePercent / 100);

    return {
      averageEntry: avgEntry,
      unrealizedPnl: effectivePnl,
      unrealizedPnlPercent: pnlPercent,
      riskAmount: avgEntry * (this.params.stopLossPercent / 100),
      currentR: pnlPercent / this.params.stopLossPercent,
    };
  }

  /**
   * Create a new position
   */
  private createPosition(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    price: number,
    rsi: number,
    entryLevel: EntryLevel,
    levelIndex: number
  ): ScalpPosition {
    const entry: ScalpEntry = {
      price,
      sizePercent: entryLevel.sizePercent,
      rsiAtEntry: rsi,
      timestamp: Date.now(),
      levelIndex,
    };

    return {
      id: uuidv4(),
      symbol,
      direction,
      entries: [entry],
      averageEntry: price,
      totalSizePercent: entryLevel.sizePercent,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      tp1Hit: false,
      tp2Hit: false,
      remainingSizePercent: 100,
      openTime: Date.now(),
    };
  }

  /**
   * Add DCA entry to existing position
   */
  private addEntryToPosition(
    position: ScalpPosition,
    price: number,
    rsi: number,
    entryLevel: EntryLevel,
    levelIndex: number
  ): void {
    const entry: ScalpEntry = {
      price,
      sizePercent: entryLevel.sizePercent,
      rsiAtEntry: rsi,
      timestamp: Date.now(),
      levelIndex,
    };

    position.entries.push(entry);

    // Recalculate weighted average entry
    let totalWeighted = 0;
    let totalSize = 0;
    for (const e of position.entries) {
      totalWeighted += e.price * e.sizePercent;
      totalSize += e.sizePercent;
    }

    position.averageEntry = totalWeighted / totalSize;
    position.totalSizePercent = totalSize;
  }

  /**
   * Update position metrics with current price
   */
  private updatePositionMetrics(position: ScalpPosition, currentPrice: number): void {
    const metrics = this.calculatePositionMetrics(position, currentPrice);
    position.unrealizedPnl = metrics.unrealizedPnl;
    position.unrealizedPnlPercent = metrics.unrealizedPnlPercent;
  }

  /**
   * Process partial exit
   */
  private processPartialExit(position: ScalpPosition, exitPercent: number): void {
    position.remainingSizePercent -= exitPercent;
    position.tp1Hit = true;
  }

  /**
   * Check volume filter
   */
  private checkVolumeFilter(candles: Candle[], volumeParams: RSIScalpParams): boolean {
    if (candles.length < volumeParams.volumePeriod) return true;

    const lastCandle = candles[candles.length - 1];
    const currentVolume = lastCandle?.volume ?? 0;
    const volumes = candles.slice(-volumeParams.volumePeriod).map(c => c.volume ?? 0);

    const smaValues = SMA.calculate({
      values: volumes,
      period: volumeParams.volumePeriod,
    });

    const avgVolume = smaValues.length > 0 ? (smaValues[smaValues.length - 1] ?? 0) : 0;

    return currentVolume >= avgVolume * volumeParams.volumeMultiplier;
  }

  /**
   * Check and reset daily counters
   */
  private checkDailyReset(state: RSIScalpState): void {
    const today = new Date().toISOString().split('T')[0] ?? '';
    if (state.dailyResetDate !== today) {
      state.dailyTrades = 0;
      state.dailyPnL = 0;
      state.dailyResetDate = today;
    }
  }

  /**
   * Generate entry signal
   */
  private generateEntrySignal(
    position: ScalpPosition,
    entryLevel: EntryLevel,
    indicators: IndicatorSnapshot,
    entryParams: RSIScalpParams
  ): RSIScalpTradeSetup {
    const direction = position.direction === 'LONG' ? 'CALL' : 'PUT';

    // Calculate SL and TP prices
    let stopLoss: number;
    let takeProfit: number;
    const tpPct = entryParams.takeProfitLevels[0]?.profitPercent ?? 0.75;

    if (position.direction === 'LONG') {
      stopLoss = position.averageEntry * (1 - entryParams.stopLossPercent / 100);
      takeProfit = position.averageEntry * (1 + tpPct / 100);
    } else {
      stopLoss = position.averageEntry * (1 + entryParams.stopLossPercent / 100);
      takeProfit = position.averageEntry * (1 - tpPct / 100);
    }

    // Calculate confidence based on RSI extremity
    const rsiExtremity = position.direction === 'LONG'
      ? (30 - indicators.rsi) / 30
      : (indicators.rsi - 70) / 30;
    const confidence = Math.min(0.9, entryParams.minConfidence + rsiExtremity * 0.3);

    return {
      direction,
      entryPrice: indicators.price,
      stopLoss,
      takeProfit,
      confidence,
      action: 'ENTRY',
      sizePercent: entryLevel.sizePercent,
      metadata: {
        rsi: indicators.rsi,
        ema: indicators.ema,
        entryLevel: position.entries.length,
        reason: `RSI ${indicators.rsi.toFixed(1)} hit level ${position.entries.length}`,
      },
    };
  }

  /**
   * Generate DCA signal
   */
  private generateDCASignal(
    position: ScalpPosition,
    entryLevel: EntryLevel,
    indicators: IndicatorSnapshot,
    dcaParams: RSIScalpParams
  ): RSIScalpTradeSetup {
    const direction = position.direction === 'LONG' ? 'CALL' : 'PUT';

    let stopLoss: number;
    let takeProfit: number;
    const tpPct = dcaParams.takeProfitLevels[0]?.profitPercent ?? 0.75;

    if (position.direction === 'LONG') {
      stopLoss = position.averageEntry * (1 - dcaParams.stopLossPercent / 100);
      takeProfit = position.averageEntry * (1 + tpPct / 100);
    } else {
      stopLoss = position.averageEntry * (1 + dcaParams.stopLossPercent / 100);
      takeProfit = position.averageEntry * (1 - tpPct / 100);
    }

    return {
      direction,
      entryPrice: indicators.price,
      stopLoss,
      takeProfit,
      confidence: 0.7,
      action: 'DCA',
      sizePercent: entryLevel.sizePercent,
      metadata: {
        rsi: indicators.rsi,
        ema: indicators.ema,
        entryLevel: position.entries.length,
        averageEntry: position.averageEntry,
        reason: `DCA entry ${position.entries.length}: RSI ${indicators.rsi.toFixed(1)}, avg entry now ${position.averageEntry.toFixed(2)}`,
      },
    };
  }

  /**
   * Generate exit signal
   */
  private generateExitSignal(
    position: ScalpPosition,
    exitResult: ExitCheckResult,
    indicators: IndicatorSnapshot,
    _exitParams: RSIScalpParams
  ): RSIScalpTradeSetup {
    // For exit, we send opposite direction signal or close signal
    const direction = position.direction === 'LONG' ? 'PUT' : 'CALL';

    return {
      direction,
      entryPrice: indicators.price,
      stopLoss: 0,
      takeProfit: 0,
      confidence: 0.9,
      action: exitResult.action === 'PARTIAL_EXIT' ? 'PARTIAL_EXIT' : 'FULL_EXIT',
      sizePercent: exitResult.exitPercent,
      metadata: {
        rsi: indicators.rsi,
        ema: indicators.ema,
        tpLevel: exitResult.tpLevel,
        averageEntry: position.averageEntry,
        unrealizedPnlPercent: position.unrealizedPnlPercent,
        reason: exitResult.reason,
      },
    };
  }

  /**
   * Get current state for a symbol
   */
  getState(symbol: string): RSIScalpState | undefined {
    return this.state.get(symbol);
  }

  /**
   * Get all states
   */
  getAllStates(): Map<string, RSIScalpState> {
    return this.state;
  }

  /**
   * Reset state for a symbol
   */
  resetSymbol(symbol: string): void {
    this.state.delete(symbol);
    this.candles.delete(symbol);
    this.initializeSymbol(symbol);
  }

  /**
   * Get parameters
   */
  getParams(): RSIScalpParams {
    return this.params;
  }
}

/**
 * Factory function to create strategy instance
 */
export function createRSIScalpStrategy(params?: Partial<RSIScalpParams>): RSIScalpStrategy {
  return new RSIScalpStrategy(params);
}
