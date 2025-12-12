/**
 * NFI Exit Conditions
 *
 * Dynamic ROI system and exit signals based on NostalgiaForInfinity.
 * Adapted for Deriv futures with mandatory stop loss.
 */

import type { Candle } from '@deriv-bot/shared';
import type {
  NFIIndicators,
  NFIParams,
  NFIExitSignal,
  NFIExitReason,
  NFIPosition,
  NFIDynamicROI,
} from './nfi.types.js';

/**
 * Check all exit conditions
 */
export function checkExitConditions(
  candle: Candle,
  position: NFIPosition,
  indicators: NFIIndicators,
  params: NFIParams,
  currentBar: number,
  entryBar: number
): NFIExitSignal {
  const barsHeld = currentBar - entryBar;
  const minutesHeld = barsHeld * 5; // 5m timeframe

  // Calculate current P&L
  const pnlPct = position.direction === 'CALL'
    ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - candle.close) / position.entryPrice) * 100;

  // Update position tracking
  position.currentPnl = pnlPct;
  position.barsHeld = barsHeld;

  if (pnlPct > position.highestPnl) {
    position.highestPnl = pnlPct;
  }
  if (pnlPct < position.lowestPnl) {
    position.lowestPnl = pnlPct;
  }

  // 1. DOOM MODE - Emergency exit
  if (params.doomMode.enabled) {
    const doomExit = checkDoomMode(pnlPct, params);
    if (doomExit.shouldExit) return doomExit;
  }

  // 2. STOP LOSS - Mandatory for futures
  const slExit = checkStopLoss(pnlPct, params);
  if (slExit.shouldExit) return slExit;

  // 3. TRAILING STOP
  const trailingExit = checkTrailingStop(pnlPct, position, params);
  if (trailingExit.shouldExit) return trailingExit;

  // 4. SIGNAL EXIT - Technical conditions
  const signalExit = checkSignalExit(candle, position, indicators, params);
  if (signalExit.shouldExit) return signalExit;

  // 5. DYNAMIC ROI - Time-based profit targets
  const roiExit = checkDynamicROI(pnlPct, minutesHeld, params.dynamicROI);
  if (roiExit.shouldExit) return roiExit;

  // 6. TIME LIMIT
  if (barsHeld >= params.risk.maxBarsInTrade) {
    return {
      shouldExit: true,
      reason: 'time_limit',
      tag: 'time_exit',
      profitPct: pnlPct,
      timeHeld: minutesHeld,
    };
  }

  // No exit signal
  return {
    shouldExit: false,
    reason: 'roi_target', // Default
    tag: '',
    profitPct: pnlPct,
    timeHeld: minutesHeld,
  };
}

/**
 * Check doom mode (emergency exit)
 */
function checkDoomMode(
  pnlPct: number,
  params: NFIParams
): NFIExitSignal {
  // Emergency exit on large unrealized loss
  if (pnlPct < -params.doomMode.profitThreshold * 100) {
    return {
      shouldExit: true,
      reason: 'doom_mode',
      tag: 'doom_exit',
      profitPct: pnlPct,
      timeHeld: 0,
    };
  }

  return { shouldExit: false, reason: 'doom_mode', tag: '', profitPct: pnlPct, timeHeld: 0 };
}

/**
 * Check stop loss
 */
function checkStopLoss(
  pnlPct: number,
  params: NFIParams
): NFIExitSignal {
  const slPct = -params.stopLoss.percentage * 100; // Convert to percentage

  if (pnlPct <= slPct) {
    return {
      shouldExit: true,
      reason: 'stop_loss',
      tag: `sl_${params.stopLoss.percentage * 100}pct`,
      profitPct: pnlPct,
      timeHeld: 0,
    };
  }

  return { shouldExit: false, reason: 'stop_loss', tag: '', profitPct: pnlPct, timeHeld: 0 };
}

/**
 * Check trailing stop
 */
function checkTrailingStop(
  pnlPct: number,
  position: NFIPosition,
  params: NFIParams
): NFIExitSignal {
  if (!params.stopLoss.useTrailing) {
    return { shouldExit: false, reason: 'trailing_stop', tag: '', profitPct: pnlPct, timeHeld: 0 };
  }

  const activationPct = params.stopLoss.trailingActivation * 100;
  const trailDistance = params.stopLoss.trailingDistance * 100;

  // Check if trailing stop is activated
  if (position.highestPnl >= activationPct) {
    // Calculate trailing stop level
    const trailingLevel = position.highestPnl - trailDistance;

    if (pnlPct <= trailingLevel) {
      return {
        shouldExit: true,
        reason: 'trailing_stop',
        tag: `trail_${trailingLevel.toFixed(1)}pct`,
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }
  }

  return { shouldExit: false, reason: 'trailing_stop', tag: '', profitPct: pnlPct, timeHeld: 0 };
}

/**
 * Check technical exit signals
 */
function checkSignalExit(
  candle: Candle,
  position: NFIPosition,
  ind: NFIIndicators,
  params: NFIParams
): NFIExitSignal {
  const pnlPct = position.currentPnl;

  // Only check signal exits when in profit
  if (pnlPct <= 0) {
    return { shouldExit: false, reason: 'signal_exit', tag: '', profitPct: pnlPct, timeHeld: 0 };
  }

  // =================================================================
  // LONG EXIT SIGNALS
  // =================================================================
  if (position.direction === 'CALL') {
    // Exit Signal 1: RSI overbought + BB upper touch
    if (
      ind.rsi_14 > params.exitSignals.rsi_overbought &&
      candle.close > ind.bb_upper
    ) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_1_rsi_bb',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 2: Extreme RSI
    if (ind.rsi_14 > 80) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_2_rsi_extreme',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 3: Stochastic overbought
    if (
      ind.stoch_rsi_k > params.exitSignals.stoch_overbought &&
      ind.stoch_rsi_k < ind.stoch_rsi_d
    ) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_3_stoch',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 4: RSI 1h overbought
    if (ind.rsi_14_1h > 78 && pnlPct > 1) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_4_rsi_1h',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 5: Multiple timeframe overbought
    if (ind.rsi_14 > 72 && ind.rsi_14_15m > 72 && ind.rsi_14_1h > 68) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_5_mtf_overbought',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 6: Williams %R overbought
    if (ind.williams_r > -10) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_6_williams',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 7: CCI extreme overbought
    if (ind.cci > 150) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_7_cci',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 8: Momentum exhaustion
    if (ind.roc_9 > 5 && ind.roc_2 < 0) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_8_momentum',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 9: CMF showing distribution (exit on weakness)
    if (ind.cmf < -0.15 && pnlPct > 0.5) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_9_cmf_weak',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 10: Trend reversal detected
    if (ind.dump_detected && pnlPct > 0) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'sell_signal_10_dump',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }
  }

  // =================================================================
  // SHORT EXIT SIGNALS (for PUT positions)
  // =================================================================
  if (position.direction === 'PUT') {
    // Exit Signal 1: RSI oversold + BB lower touch
    if (ind.rsi_14 < (100 - params.exitSignals.rsi_overbought) && candle.close < ind.bb_lower) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'buy_signal_1_rsi_bb',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 2: Extreme oversold
    if (ind.rsi_14 < 20) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'buy_signal_2_rsi_extreme',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }

    // Exit Signal 3: Pump detected (cover short)
    if (ind.pump_detected && pnlPct > 0) {
      return {
        shouldExit: true,
        reason: 'signal_exit',
        tag: 'buy_signal_3_pump',
        profitPct: pnlPct,
        timeHeld: 0,
      };
    }
  }

  return { shouldExit: false, reason: 'signal_exit', tag: '', profitPct: pnlPct, timeHeld: 0 };
}

/**
 * Check dynamic ROI - The heart of NFI
 *
 * As time increases, profit target decreases.
 * This allows taking smaller profits rather than holding forever.
 */
function checkDynamicROI(
  pnlPct: number,
  minutesHeld: number,
  dynamicROI: NFIDynamicROI
): NFIExitSignal {
  // If not in profit, no ROI exit
  if (pnlPct <= 0) {
    return { shouldExit: false, reason: 'roi_target', tag: '', profitPct: pnlPct, timeHeld: minutesHeld };
  }

  // Get applicable ROI target based on time held
  const roiTimes = Object.keys(dynamicROI)
    .map(Number)
    .sort((a, b) => b - a); // Sort descending to find highest applicable

  let applicableROI: number | null = null;
  let applicableTime: number = 0;

  for (const time of roiTimes) {
    if (minutesHeld >= time) {
      applicableROI = dynamicROI[time]!;
      applicableTime = time;
      break;
    }
  }

  // If we have an applicable ROI and profit exceeds it
  if (applicableROI !== null && pnlPct >= applicableROI) {
    return {
      shouldExit: true,
      reason: 'roi_target',
      tag: `roi_${applicableTime}min_${applicableROI}pct`,
      profitPct: pnlPct,
      timeHeld: minutesHeld,
    };
  }

  return { shouldExit: false, reason: 'roi_target', tag: '', profitPct: pnlPct, timeHeld: minutesHeld };
}

/**
 * Check if should derisk (reduce position)
 */
export function checkDerisk(
  pnlPct: number,
  position: NFIPosition,
  indicators: NFIIndicators,
  _params: NFIParams
): { shouldDerisk: boolean; reason: string } {
  // Don't derisk if not in profit
  if (pnlPct < 1) {
    return { shouldDerisk: false, reason: '' };
  }

  // Derisk if we've hit a good profit and momentum is weakening
  if (position.direction === 'CALL') {
    // Had good profit but it's decreasing
    if (position.highestPnl > 3 && pnlPct < position.highestPnl - 1) {
      if (indicators.rsi_14 > 65 || indicators.cmf < 0) {
        return { shouldDerisk: true, reason: 'profit_protection' };
      }
    }

    // Momentum exhaustion with profit
    if (pnlPct > 2 && indicators.roc_9 > 3 && indicators.roc_2 < 0) {
      return { shouldDerisk: true, reason: 'momentum_exhaustion' };
    }
  }

  return { shouldDerisk: false, reason: '' };
}

/**
 * Get profit target for current time
 */
export function getCurrentROITarget(
  minutesHeld: number,
  dynamicROI: NFIDynamicROI
): number {
  const roiTimes = Object.keys(dynamicROI)
    .map(Number)
    .sort((a, b) => b - a);

  for (const time of roiTimes) {
    if (minutesHeld >= time) {
      return dynamicROI[time]!;
    }
  }

  // Return highest target if time is very short
  const firstTime = Math.min(...Object.keys(dynamicROI).map(Number));
  return dynamicROI[firstTime] ?? 4.0;
}

/**
 * Calculate stop loss price
 */
export function calculateStopLossPrice(
  entryPrice: number,
  direction: 'CALL' | 'PUT',
  slPct: number
): number {
  if (direction === 'CALL') {
    return entryPrice * (1 - slPct);
  } else {
    return entryPrice * (1 + slPct);
  }
}

/**
 * Calculate take profit price for current ROI target
 */
export function calculateTakeProfitPrice(
  entryPrice: number,
  direction: 'CALL' | 'PUT',
  roiPct: number
): number {
  if (direction === 'CALL') {
    return entryPrice * (1 + roiPct / 100);
  } else {
    return entryPrice * (1 - roiPct / 100);
  }
}

/**
 * Format exit reason for logging
 */
export function formatExitReason(exit: NFIExitSignal): string {
  const reasonMap: Record<NFIExitReason, string> = {
    roi_target: 'ROI Target',
    signal_exit: 'Signal Exit',
    stop_loss: 'Stop Loss',
    trailing_stop: 'Trailing Stop',
    time_limit: 'Time Limit',
    doom_mode: 'Doom Mode',
    derisk: 'Derisk',
    grind_profit: 'Grind Profit',
    manual: 'Manual',
  };

  return `${reasonMap[exit.reason] || exit.reason} [${exit.tag}]`;
}
