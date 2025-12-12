/**
 * NFI Backtest Strategy Adapter
 *
 * Implements BacktestableStrategy for running NostalgiaForInfinity in backtesting environment.
 */

import type { Candle, IndicatorSnapshot as SharedIndicatorSnapshot } from '@deriv-bot/shared';
import type {
  BacktestableStrategy,
  EntrySignal,
  BacktestConfig,
  MarketSnapshot,
} from '../types.js';
import {
  NFIStrategy,
  type NFIParams,
  type NFIIndicators,
  getParamsForAsset,
  DEFAULT_NFI_PARAMS,
  calculateAllIndicators,
  checkEntryConditions,
  getBestEntryCondition,
} from '../../strategies/nfi/index.js';

type Direction = 'CALL' | 'PUT';

/**
 * NFI strategy adapter for backtesting
 */
export class NFIBacktestStrategy implements BacktestableStrategy {
  readonly name = 'NostalgiaForInfinity';
  readonly version = '1.0.0';

  private asset: string;
  private params: NFIParams;
  private lastIndicators: NFIIndicators | null = null;

  // State tracking
  private barIndex = 0;
  private lastEntryBar = -1;
  private consecutiveLosses = 0;
  private pauseUntilBar = -1;

  constructor(asset: string, customParams?: Partial<NFIParams>) {
    this.asset = asset;
    this.params = getParamsForAsset(asset, customParams ?? DEFAULT_NFI_PARAMS);
  }

  /**
   * Required indicators for backtest engine
   */
  requiredIndicators(): string[] {
    // NFI calculates its own indicators internally via multi-timeframe analysis
    return ['rsi', 'ema', 'sma', 'bbands', 'stoch', 'cci', 'mfi', 'cmf'];
  }

  /**
   * Get default backtest configuration
   */
  getDefaultConfig(): Partial<BacktestConfig> {
    const roiKeys = Object.keys(this.params.dynamicROI).map(Number);
    const firstROI = this.params.dynamicROI[Math.min(...roiKeys)] ?? 4.0;

    return {
      asset: this.asset,
      takeProfitPct: firstROI / 100, // Convert percentage to decimal
      stopLossPct: this.params.stopLoss.percentage,
      cooldownBars: this.params.risk.cooldownBars,
      maxBarsInTrade: this.params.risk.maxBarsInTrade,
    };
  }

  /**
   * Check for entry signal
   */
  checkEntry(
    candles: Candle[],
    _indicators: SharedIndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    this.barIndex = currentIndex;

    // Check cooldown
    if (this.lastEntryBar >= 0 && currentIndex - this.lastEntryBar < this.params.risk.cooldownBars) {
      return null;
    }

    // Check pause
    if (currentIndex < this.pauseUntilBar) {
      return null;
    }

    // Need sufficient candles for multi-TF indicators
    if (candles.length < 300 || currentIndex < 300) {
      return null;
    }

    // Calculate indicators up to current bar
    const candleSlice = candles.slice(0, currentIndex + 1);
    const indicators = calculateAllIndicators(candleSlice, this.params);

    if (!indicators) {
      return null;
    }

    this.lastIndicators = indicators;

    const currentCandle = candles[currentIndex]!;

    // Check all entry conditions
    const conditions = checkEntryConditions(currentCandle, indicators, this.params, 'CALL' as Direction);
    const bestCondition = getBestEntryCondition(conditions);

    if (!bestCondition) {
      return null;
    }

    // Apply ML-validated filters to reduce losses
    // Filters validated with out-of-sample testing (85.7% improvement)
    const atrPct = currentCandle.close > 0 ? (indicators.atr / currentCandle.close) * 100 : 0;
    const maxATR = 0.284;  // Filter high volatility
    const maxADX = 26.3;   // Filter strong trends
    const excludeTags = ['4']; // Exclude worst performing tag

    // Check ATR filter
    if (atrPct > maxATR) {
      return null;
    }

    // Check ADX filter
    if (indicators.adx > maxADX) {
      return null;
    }

    // Check tag exclusion
    if (excludeTags.includes(bestCondition.tag)) {
      return null;
    }

    // Calculate dynamic TP/SL
    const roiKeys = Object.keys(this.params.dynamicROI).map(Number);
    const firstROI = this.params.dynamicROI[Math.min(...roiKeys)] ?? 4.0;
    const tpPct = firstROI / 100;
    const slPct = this.params.stopLoss.percentage;

    // Create market snapshot
    const snapshot: MarketSnapshot = {
      timestamp: currentCandle.timestamp * 1000,
      candle: {
        index: currentIndex,
        timestamp: currentCandle.timestamp,
        open: currentCandle.open,
        high: currentCandle.high,
        low: currentCandle.low,
        close: currentCandle.close,
      },
      price: currentCandle.close,
      indicators: {
        rsi: indicators.rsi_14,
        rsi_3: indicators.rsi_3,
        rsi_1h: indicators.rsi_14_1h,
        ema_200: indicators.ema_200,
        bb_lower: indicators.bb_lower,
        bb_upper: indicators.bb_upper,
        bb_middle: indicators.bb_middle,
        cmf: indicators.cmf,
        ewo: indicators.ewo,
        stoch_rsi_k: indicators.stoch_rsi_k,
      },
    };

    // Update state
    this.lastEntryBar = currentIndex;

    return {
      direction: bestCondition.tag.startsWith('short') ? 'PUT' : 'CALL',
      confidence: bestCondition.confidence,
      timestamp: currentCandle.timestamp * 1000,
      price: currentCandle.close,
      reason: `NFI ${bestCondition.mode} [${bestCondition.tag}]: ${bestCondition.reasons.slice(0, 3).join(', ')}`,
      indicators: snapshot.indicators,
      snapshot,
      suggestedTP: tpPct,
      suggestedSL: slPct,
      metadata: {
        entryTag: bestCondition.tag,
        entryMode: bestCondition.mode,
        reasons: bestCondition.reasons,
        rsi_14: indicators.rsi_14,
        rsi_14_1h: indicators.rsi_14_1h,
        cmf: indicators.cmf,
        ewo: indicators.ewo,
      },
    };
  }

  /**
   * Check for exit signal
   */
  shouldExit(
    candles: Candle[],
    _indicators: SharedIndicatorSnapshot,
    currentIndex: number,
    entryIndex: number,
    entryPrice: number,
    direction: Direction
  ): { shouldExit: boolean; reason: string } {
    const barsHeld = currentIndex - entryIndex;
    const minutesHeld = barsHeld * 5; // 5m timeframe

    const currentCandle = candles[currentIndex]!;
    const currentPrice = currentCandle.close;

    // Calculate P&L
    const pnlPct = direction === 'CALL'
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    // 1. Stop Loss
    const slPct = this.params.stopLoss.percentage * 100;
    if (pnlPct <= -slPct) {
      return { shouldExit: true, reason: `STOP_LOSS (${pnlPct.toFixed(2)}%)` };
    }

    // 2. Dynamic ROI
    const roiTimes = Object.keys(this.params.dynamicROI)
      .map(Number)
      .sort((a, b) => b - a);

    for (const time of roiTimes) {
      if (minutesHeld >= time) {
        const target = this.params.dynamicROI[time]!;
        if (pnlPct >= target) {
          return { shouldExit: true, reason: `ROI_${time}min (${pnlPct.toFixed(2)}% >= ${target}%)` };
        }
        break;
      }
    }

    // 3. Time limit
    if (barsHeld >= this.params.risk.maxBarsInTrade) {
      return { shouldExit: true, reason: `TIME_LIMIT (${barsHeld} bars)` };
    }

    // 4. Signal-based exits (if in profit)
    if (pnlPct > 0 && this.lastIndicators) {
      const ind = this.lastIndicators;

      // RSI overbought exit
      if (direction === 'CALL' && ind.rsi_14 > this.params.exitSignals.rsi_overbought) {
        return { shouldExit: true, reason: `RSI_OVERBOUGHT (${ind.rsi_14.toFixed(0)})` };
      }

      // BB overbought exit
      if (direction === 'CALL' && this.params.exitSignals.bb_overbought && currentPrice > ind.bb_upper) {
        return { shouldExit: true, reason: 'BB_UPPER_TOUCH' };
      }

      // Stoch overbought
      if (direction === 'CALL' && ind.stoch_rsi_k > this.params.exitSignals.stoch_overbought) {
        return { shouldExit: true, reason: `STOCH_OVERBOUGHT (${ind.stoch_rsi_k.toFixed(0)})` };
      }
    }

    return { shouldExit: false, reason: '' };
  }

  /**
   * Report trade result for state tracking
   */
  onTradeClose(isWin: boolean, currentIndex: number): void {
    if (isWin) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;

      if (this.consecutiveLosses >= this.params.risk.maxConsecutiveLosses) {
        this.pauseUntilBar = currentIndex + this.params.risk.pauseBarsAfterMaxLosses;
        this.consecutiveLosses = 0;
      }
    }
  }

  /**
   * Get strategy params
   */
  getParams(): NFIParams {
    return { ...this.params };
  }

  /**
   * Get last calculated indicators
   */
  getLastIndicators(): NFIIndicators | null {
    return this.lastIndicators;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.barIndex = 0;
    this.lastEntryBar = -1;
    this.consecutiveLosses = 0;
    this.pauseUntilBar = -1;
    this.lastIndicators = null;
  }
}
