/**
 * NostalgiaForInfinity (NFI) Strategy
 *
 * Full port of the legendary Freqtrade NFI strategy to Deriv.
 * Adapted for futures trading with mandatory stop loss.
 *
 * Features:
 * - 30+ entry conditions across 9 modes
 * - Multi-timeframe analysis (5m, 15m, 1h, 4h, 1d)
 * - Dynamic ROI (time-based profit targets)
 * - Technical exit signals
 * - Trailing stop
 * - Doom mode protection
 *
 * Original: https://github.com/iterativv/NostalgiaForInfinity
 */

import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import { BaseStrategy, type StrategyContext } from '../../strategy/base-strategy.js';
import type {
  NFIParams,
  NFIState,
  NFIPosition,
  NFIIndicators,
  NFITradeResult,
  Direction,
} from './nfi.types.js';
import { getParamsForAsset, validateParams, DEFAULT_NFI_PARAMS } from './nfi.params.js';
import { calculateAllIndicators } from './indicators.js';
import { checkEntryConditions, getBestEntryCondition } from './entry-conditions.js';
import {
  checkExitConditions,
  formatExitReason,
  getCurrentROITarget,
  calculateStopLossPrice,
  calculateTakeProfitPrice,
} from './exit-conditions.js';

/**
 * NFI Strategy Implementation
 */
export class NFIStrategy extends BaseStrategy {
  readonly name = 'NostalgiaForInfinity';
  readonly version = '1.0.0';

  private params: NFIParams;

  // State per asset
  private states: Record<string, NFIState> = {};
  private barIndex: Record<string, number> = {};

  // Trade history for analysis
  private tradeHistory: Record<string, NFITradeResult[]> = {};

  constructor(config: StrategyConfig) {
    super(config);

    // Parse custom parameters from config
    const customParams = config.parameters as Partial<NFIParams> | undefined;
    this.params = { ...DEFAULT_NFI_PARAMS, ...customParams };

    // Validate parameters
    const errors = validateParams(this.params);
    if (errors.length > 0) {
      console.warn(`[NFI] Parameter validation warnings: ${errors.join(', ')}`);
    }
  }

  /**
   * Initialize state for an asset
   */
  private initializeState(asset: string): void {
    if (!this.states[asset]) {
      this.states[asset] = {
        phase: 'SCANNING',
        position: null,
        indicators: null,
        lastEntryTag: null,
        barsSinceTrade: 0,
        consecutiveLosses: 0,
        pauseUntilBar: -1,
        grindingState: null,
      };
    }
    if (this.barIndex[asset] === undefined) {
      this.barIndex[asset] = 0;
    }
    if (!this.tradeHistory[asset]) {
      this.tradeHistory[asset] = [];
    }
  }

  /**
   * Main candle processing
   */
  async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    const asset = candle.asset;
    const price = candle.close;
    const { candles } = context;

    // Initialize state
    this.initializeState(asset);
    const state = this.states[asset]!;

    // Get asset-specific params
    const params = getParamsForAsset(asset, this.params);

    // Increment bar counter
    this.barIndex[asset] = (this.barIndex[asset] ?? 0) + 1;
    const currentBar = this.barIndex[asset]!;
    state.barsSinceTrade++;

    // Need minimum candles for indicators
    const minCandles = 300; // Need ~288 for 1d resampling
    if (!candles || candles.length < minCandles) {
      return null;
    }

    // Calculate indicators
    const indicators = calculateAllIndicators(candles, params);
    if (!indicators) {
      console.log(`[NFI] ${asset} | Insufficient data for indicators`);
      return null;
    }
    state.indicators = indicators;

    // Check if paused (after consecutive losses)
    if (currentBar < state.pauseUntilBar) {
      console.log(
        `[NFI] ${asset} | PAUSED until bar ${state.pauseUntilBar} ` +
          `(${state.pauseUntilBar - currentBar} bars remaining)`
      );
      return null;
    }

    // Log current state
    this.logState(asset, price, state, indicators, params);

    // State machine
    switch (state.phase) {
      case 'SCANNING':
        return this.handleScanning(candle, state, indicators, params, currentBar, asset);

      case 'IN_POSITION':
        return this.handleInPosition(candle, state, indicators, params, currentBar, asset);

      case 'COOLING_DOWN':
        // Check cooldown
        if (state.barsSinceTrade >= params.risk.cooldownBars) {
          state.phase = 'SCANNING';
          console.log(`[NFI] ${asset} | Cooldown complete, resuming scanning`);
        }
        return null;

      case 'PAUSED':
        // Check if pause is over
        if (currentBar >= state.pauseUntilBar) {
          state.phase = 'SCANNING';
          state.consecutiveLosses = 0;
          console.log(`[NFI] ${asset} | Pause complete, resuming trading`);
        }
        return null;

      default:
        state.phase = 'SCANNING';
        return null;
    }
  }

  /**
   * Handle SCANNING phase - Look for entry signals
   */
  private handleScanning(
    candle: Candle,
    state: NFIState,
    indicators: NFIIndicators,
    params: NFIParams,
    _currentBar: number,
    asset: string
  ): Signal | null {
    // Check all entry conditions
    const conditions = checkEntryConditions(candle, indicators, params, 'CALL');
    const triggeredConditions = conditions.filter(c => c.triggered);

    // Log triggered conditions
    if (triggeredConditions.length > 0) {
      console.log(
        `[NFI] ${asset} | ${triggeredConditions.length} conditions triggered: ` +
          triggeredConditions.map(c => `${c.tag}(${c.mode})`).join(', ')
      );
    }

    // Get best condition
    const bestCondition = getBestEntryCondition(conditions);
    if (!bestCondition) {
      return null;
    }

    // Apply ML-validated filters to reduce losses
    // Filters validated with out-of-sample testing (85.7% improvement)
    const atrPct = candle.close > 0 ? (indicators.atr / candle.close) * 100 : 0;
    const maxATR = 0.284;  // Filter high volatility
    const maxADX = 26.3;   // Filter strong trends
    const excludeTags = ['4']; // Exclude worst performing tag

    // Check ATR filter
    if (atrPct > maxATR) {
      console.log(
        `[NFI] ${asset} | Entry filtered: ATR ${atrPct.toFixed(3)}% > ${maxATR}% ` +
        `(Tag: ${bestCondition.tag})`
      );
      return null;
    }

    // Check ADX filter
    if (indicators.adx > maxADX) {
      console.log(
        `[NFI] ${asset} | Entry filtered: ADX ${indicators.adx.toFixed(1)} > ${maxADX} ` +
        `(Tag: ${bestCondition.tag})`
      );
      return null;
    }

    // Check tag exclusion
    if (excludeTags.includes(bestCondition.tag)) {
      console.log(
        `[NFI] ${asset} | Entry filtered: Tag ${bestCondition.tag} excluded ` +
        `(poor performance: 35.8% WR)`
      );
      return null;
    }

    // Create position
    const direction: Direction = 'CALL';
    const position: NFIPosition = {
      direction,
      entryPrice: candle.close,
      entryTimestamp: candle.timestamp,
      entryTag: bestCondition.tag,
      entryMode: bestCondition.mode,
      stake: 1, // Will be set by trader
      barsHeld: 0,
      highestPnl: 0,
      lowestPnl: 0,
      currentPnl: 0,
      trailingStopPrice: null,
    };

    state.position = position;
    state.phase = 'IN_POSITION';
    state.lastEntryTag = bestCondition.tag;
    state.barsSinceTrade = 0;

    // Calculate SL/TP
    const slPrice = calculateStopLossPrice(candle.close, direction, params.stopLoss.percentage);
    const roiTarget = getCurrentROITarget(0, params.dynamicROI);
    const tpPrice = calculateTakeProfitPrice(candle.close, direction, roiTarget);

    console.log(
      `[NFI] ${asset} | ENTRY SIGNAL: ${direction} @ ${candle.close.toFixed(2)} | ` +
        `Tag: ${bestCondition.tag} (${bestCondition.mode}) | ` +
        `Confidence: ${(bestCondition.confidence * 100).toFixed(0)}% | ` +
        `SL: ${slPrice.toFixed(2)} | TP: ${tpPrice.toFixed(2)} | ` +
        `Reasons: ${bestCondition.reasons.slice(0, 3).join(', ')}`
    );

    // Create signal
    return this.createSignal(direction, bestCondition.confidence, {
      strategy: 'NostalgiaForInfinity',
      version: this.version,
      entryTag: bestCondition.tag,
      entryMode: bestCondition.mode,
      reasons: bestCondition.reasons,
      entryPrice: candle.close,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      slPct: params.stopLoss.percentage,
      tpPct: roiTarget / 100,
      indicators: {
        rsi_14: indicators.rsi_14,
        rsi_14_1h: indicators.rsi_14_1h,
        bb_lower: indicators.bb_lower,
        bb_upper: indicators.bb_upper,
        ema_200: indicators.ema_200,
        cmf: indicators.cmf,
        stoch_rsi_k: indicators.stoch_rsi_k,
      },
    }, asset);
  }

  /**
   * Handle IN_POSITION phase - Check for exit signals
   */
  private handleInPosition(
    candle: Candle,
    state: NFIState,
    indicators: NFIIndicators,
    params: NFIParams,
    currentBar: number,
    asset: string
  ): Signal | null {
    if (!state.position) {
      state.phase = 'SCANNING';
      return null;
    }

    const position = state.position;
    const entryBar = currentBar - position.barsHeld;

    // Check exit conditions
    const exitSignal = checkExitConditions(
      candle,
      position,
      indicators,
      params,
      currentBar,
      entryBar
    );

    // Update position tracking
    position.barsHeld++;

    // Log position status periodically
    if (position.barsHeld % 6 === 0) {
      const roiTarget = getCurrentROITarget(position.barsHeld * 5, params.dynamicROI);
      console.log(
        `[NFI] ${asset} | Position: ${position.direction} | ` +
          `PnL: ${position.currentPnl.toFixed(2)}% | ` +
          `Bars: ${position.barsHeld} | ` +
          `High: ${position.highestPnl.toFixed(2)}% | ` +
          `Low: ${position.lowestPnl.toFixed(2)}% | ` +
          `ROI Target: ${roiTarget.toFixed(2)}%`
      );
    }

    // Check if should exit
    if (exitSignal.shouldExit) {
      const exitReason = formatExitReason(exitSignal);
      const isWin = position.currentPnl > 0;

      console.log(
        `[NFI] ${asset} | EXIT: ${exitReason} | ` +
          `PnL: ${position.currentPnl.toFixed(2)}% | ` +
          `Bars held: ${position.barsHeld} | ` +
          `Entry tag: ${position.entryTag}`
      );

      // Record trade
      const tradeResult: NFITradeResult = {
        direction: position.direction,
        entryPrice: position.entryPrice,
        exitPrice: candle.close,
        entryTag: position.entryTag,
        exitReason: exitSignal.reason,
        exitTag: exitSignal.tag,
        pnlPct: position.currentPnl,
        barsHeld: position.barsHeld,
        grindEntries: 0,
        maxDrawdown: position.lowestPnl,
        maxProfit: position.highestPnl,
      };
      this.tradeHistory[asset]!.push(tradeResult);

      // Update state
      state.position = null;
      state.phase = 'COOLING_DOWN';
      state.barsSinceTrade = 0;

      // Track consecutive losses
      if (!isWin) {
        state.consecutiveLosses++;
        console.log(`[NFI] ${asset} | Consecutive losses: ${state.consecutiveLosses}`);

        // Check if should pause
        if (state.consecutiveLosses >= params.risk.maxConsecutiveLosses) {
          state.phase = 'PAUSED';
          state.pauseUntilBar = currentBar + params.risk.pauseBarsAfterMaxLosses;
          console.log(
            `[NFI] ${asset} | PAUSING after ${state.consecutiveLosses} losses. ` +
              `Resume at bar ${state.pauseUntilBar}`
          );
        }
      } else {
        state.consecutiveLosses = 0;
      }

      // For backtesting, we don't return a signal for exits
      // The backtest runner handles exits internally
      return null;
    }

    return null;
  }

  /**
   * Log current state
   */
  private logState(
    asset: string,
    price: number,
    state: NFIState,
    indicators: NFIIndicators,
    _params: NFIParams
  ): void {
    const phase = state.phase;
    const rsi = indicators.rsi_14.toFixed(0);
    const rsi1h = indicators.rsi_14_1h.toFixed(0);
    const trend = indicators.is_uptrend ? '↑' : indicators.is_downtrend ? '↓' : '→';
    const pump = indicators.pump_detected ? '🚀' : '';
    const dump = indicators.dump_detected ? '💥' : '';

    console.log(
      `[NFI] ${asset} | ${phase} | Price: ${price.toFixed(2)} | ` +
        `RSI: ${rsi} (1h: ${rsi1h}) | Trend: ${trend} ${pump}${dump} | ` +
        `CMF: ${indicators.cmf.toFixed(2)} | EWO: ${indicators.ewo.toFixed(2)}`
    );
  }

  /**
   * Report trade result for external tracking
   */
  reportTradeResult(asset: string, _pnl: number, isWin: boolean): void {
    this.initializeState(asset);
    const state = this.states[asset]!;

    if (isWin) {
      state.consecutiveLosses = 0;
    } else {
      state.consecutiveLosses++;

      if (state.consecutiveLosses >= this.params.risk.maxConsecutiveLosses) {
        const currentBar = this.barIndex[asset] ?? 0;
        state.phase = 'PAUSED';
        state.pauseUntilBar = currentBar + this.params.risk.pauseBarsAfterMaxLosses;
      }
    }
  }

  /**
   * Get current state for monitoring
   */
  getState(asset: string): NFIState | undefined {
    return this.states[asset];
  }

  /**
   * Get trade history
   */
  getTradeHistory(asset: string): NFITradeResult[] {
    return this.tradeHistory[asset] ?? [];
  }

  /**
   * Get statistics for an asset
   */
  getStatistics(asset: string): {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnl: number;
    profitFactor: number;
    bestTrade: number;
    worstTrade: number;
    avgBarsHeld: number;
    entryTagStats: Record<string, { count: number; wins: number; avgPnl: number }>;
  } {
    const trades = this.tradeHistory[asset] ?? [];

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnl: 0,
        profitFactor: 0,
        bestTrade: 0,
        worstTrade: 0,
        avgBarsHeld: 0,
        entryTagStats: {},
      };
    }

    const wins = trades.filter(t => t.pnlPct > 0).length;
    const losses = trades.length - wins;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnlPct, 0);
    const grossProfit = trades.filter(t => t.pnlPct > 0).reduce((sum, t) => sum + t.pnlPct, 0);
    const grossLoss = Math.abs(
      trades.filter(t => t.pnlPct < 0).reduce((sum, t) => sum + t.pnlPct, 0)
    );
    const avgBarsHeld = trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length;

    // Entry tag statistics
    const entryTagStats: Record<string, { count: number; wins: number; totalPnl: number }> = {};
    for (const trade of trades) {
      if (!entryTagStats[trade.entryTag]) {
        entryTagStats[trade.entryTag] = { count: 0, wins: 0, totalPnl: 0 };
      }
      entryTagStats[trade.entryTag]!.count++;
      if (trade.pnlPct > 0) entryTagStats[trade.entryTag]!.wins++;
      entryTagStats[trade.entryTag]!.totalPnl += trade.pnlPct;
    }

    const formattedTagStats: Record<string, { count: number; wins: number; avgPnl: number }> = {};
    for (const [tag, stats] of Object.entries(entryTagStats)) {
      formattedTagStats[tag] = {
        count: stats.count,
        wins: stats.wins,
        avgPnl: stats.totalPnl / stats.count,
      };
    }

    return {
      totalTrades: trades.length,
      wins,
      losses,
      winRate: (wins / trades.length) * 100,
      avgPnl: totalPnl / trades.length,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      bestTrade: Math.max(...trades.map(t => t.pnlPct)),
      worstTrade: Math.min(...trades.map(t => t.pnlPct)),
      avgBarsHeld,
      entryTagStats: formattedTagStats,
    };
  }

  /**
   * Get parameters
   */
  getParams(): NFIParams {
    return { ...this.params };
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    this.states = {};
    this.barIndex = {};
    // Keep trade history for analysis
  }

  /**
   * Clear trade history
   */
  clearHistory(): void {
    this.tradeHistory = {};
  }
}

/**
 * Factory function
 */
export function createNFIStrategy(config: StrategyConfig): NFIStrategy {
  return new NFIStrategy(config);
}
