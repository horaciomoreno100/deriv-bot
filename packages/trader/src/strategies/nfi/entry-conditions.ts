/**
 * NFI Entry Conditions
 *
 * Port of NostalgiaForInfinity entry conditions.
 * Each condition has a unique tag for tracking and analysis.
 *
 * Based on: https://github.com/iterativv/NostalgiaForInfinity
 */

import type { Candle } from '@deriv-bot/shared';
import type {
  NFIIndicators,
  NFIParams,
  NFIEntryCondition,
  NFIEntryMode,
  Direction,
} from './nfi.types.js';

/**
 * Check all enabled entry conditions
 */
export function checkEntryConditions(
  candle: Candle,
  indicators: NFIIndicators,
  params: NFIParams,
  direction: Direction = 'CALL'
): NFIEntryCondition[] {
  const results: NFIEntryCondition[] = [];
  const conditions = params.entryConditions;

  // Helper to check and add condition
  const check = (
    tag: string,
    mode: NFIEntryMode,
    enableKey: keyof typeof conditions,
    checker: () => { triggered: boolean; confidence: number; reasons: string[] }
  ) => {
    if (conditions[enableKey] === false) return;

    const result = checker();
    results.push({
      tag,
      mode,
      triggered: result.triggered,
      confidence: result.confidence,
      reasons: result.reasons,
    });
  };

  if (direction === 'CALL') {
    // =================================================================
    // NORMAL MODE (Tags 1-13) - Classic dip buying
    // =================================================================

    // Condition 1: BB40 + RSI + EMA trend alignment
    check('1', 'normal', 'condition_1_enable', () =>
      condition_1_long(candle, indicators, params)
    );

    // Condition 2: BB20 + Volume filter
    check('2', 'normal', 'condition_2_enable', () =>
      condition_2_long(candle, indicators, params)
    );

    // Condition 3: SSL Channel + RSI divergence
    check('3', 'normal', 'condition_3_enable', () =>
      condition_3_long(candle, indicators, params)
    );

    // Condition 4: EWO + RSI oversold extreme
    check('4', 'normal', 'condition_4_enable', () =>
      condition_4_long(candle, indicators, params)
    );

    // Condition 5: BB touch + momentum confirmation
    check('5', 'normal', 'condition_5_enable', () =>
      condition_5_long(candle, indicators, params)
    );

    // Condition 6: Multi-timeframe RSI alignment
    check('6', 'normal', 'condition_6_enable', () =>
      condition_6_long(candle, indicators, params)
    );

    // Condition 7: CMF + RSI combo
    check('7', 'normal', 'condition_7_enable', () =>
      condition_7_long(candle, indicators, params)
    );

    // Condition 8: Williams %R extreme
    check('8', 'normal', 'condition_8_enable', () =>
      condition_8_long(candle, indicators, params)
    );

    // Condition 9: CCI oversold
    check('9', 'normal', 'condition_9_enable', () =>
      condition_9_long(candle, indicators, params)
    );

    // Condition 10: Stochastic RSI oversold
    check('10', 'normal', 'condition_10_enable', () =>
      condition_10_long(candle, indicators, params)
    );

    // Condition 11: EMA cross + RSI filter
    check('11', 'normal', 'condition_11_enable', () =>
      condition_11_long(candle, indicators, params)
    );

    // Condition 12: BB squeeze breakout
    check('12', 'normal', 'condition_12_enable', () =>
      condition_12_long(candle, indicators, params)
    );

    // Condition 13: MFI + RSI combo
    check('13', 'normal', 'condition_13_enable', () =>
      condition_13_long(candle, indicators, params)
    );

    // =================================================================
    // PUMP MODE (Tags 21-26) - Entry after pump detection
    // =================================================================

    check('21', 'pump', 'condition_21_enable', () =>
      condition_21_long(candle, indicators, params)
    );

    check('22', 'pump', 'condition_22_enable', () =>
      condition_22_long(candle, indicators, params)
    );

    check('23', 'pump', 'condition_23_enable', () =>
      condition_23_long(candle, indicators, params)
    );

    // =================================================================
    // QUICK MODE (Tags 41-53) - Fast scalping entries
    // =================================================================

    check('41', 'quick', 'condition_41_enable', () =>
      condition_41_long(candle, indicators, params)
    );

    check('42', 'quick', 'condition_42_enable', () =>
      condition_42_long(candle, indicators, params)
    );

    check('43', 'quick', 'condition_43_enable', () =>
      condition_43_long(candle, indicators, params)
    );

    check('44', 'quick', 'condition_44_enable', () =>
      condition_44_long(candle, indicators, params)
    );

    check('45', 'quick', 'condition_45_enable', () =>
      condition_45_long(candle, indicators, params)
    );

    // =================================================================
    // RAPID MODE (Tags 101-110) - Ultra-fast entries
    // =================================================================

    check('101', 'rapid', 'condition_101_enable', () =>
      condition_101_long(candle, indicators, params)
    );

    check('102', 'rapid', 'condition_102_enable', () =>
      condition_102_long(candle, indicators, params)
    );

    check('103', 'rapid', 'condition_103_enable', () =>
      condition_103_long(candle, indicators, params)
    );

    // =================================================================
    // GRIND MODE (Tag 120) - Small consistent profits
    // =================================================================

    check('120', 'grind', 'condition_120_enable', () =>
      condition_120_long(candle, indicators, params)
    );

    // =================================================================
    // TOP COINS MODE (Tags 141-143) - BTC/ETH specific
    // =================================================================

    check('141', 'top_coins', 'condition_141_enable', () =>
      condition_141_long(candle, indicators, params)
    );

    check('142', 'top_coins', 'condition_142_enable', () =>
      condition_142_long(candle, indicators, params)
    );

    // =================================================================
    // DERISK MODE (Tag 161) - Risk-off entries
    // =================================================================

    check('161', 'derisk', 'condition_161_enable', () =>
      condition_161_long(candle, indicators, params)
    );
  }

  return results;
}

/**
 * Get best triggered condition (highest confidence)
 */
export function getBestEntryCondition(
  conditions: NFIEntryCondition[]
): NFIEntryCondition | null {
  const triggered = conditions.filter(c => c.triggered);
  if (triggered.length === 0) return null;

  return triggered.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  );
}

// =================================================================
// NORMAL MODE CONDITIONS (Tags 1-13)
// =================================================================

/**
 * Condition 1: BB40 + RSI + EMA trend
 *
 * Original NFI condition:
 * - Price < SMA9
 * - Price > EMA200 (1h)
 * - EMA50 > EMA200
 * - EMA50_1h > EMA200_1h
 * - BB delta > close * 0.017
 * - Close delta > close * 0.013
 * - Tail < BB delta * 0.445
 * - Close < Lower BB (shifted)
 */
function condition_1_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Price below SMA9
  if (candle.close < ind.sma_9) {
    score++;
    reasons.push('Close < SMA9');
  }

  // Trend alignment: EMA50 > EMA200
  if (ind.ema_50 > ind.ema_200) {
    score++;
    reasons.push('EMA50 > EMA200 (uptrend)');
  }

  // Price above EMA200 1h
  if (candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Close > EMA200_1h');
  }

  // BB delta condition
  if (ind.bb_delta > candle.close * params.bb.deltaThreshold) {
    score++;
    reasons.push(`BB delta > ${(params.bb.deltaThreshold * 100).toFixed(1)}%`);
  }

  // Close delta positive momentum
  if (Math.abs(ind.close_delta) > candle.close * params.bb.closeThreshold) {
    score++;
    reasons.push('Strong close delta');
  }

  // Tail condition (small wick = strong close)
  if (ind.tail < ind.bb_delta * params.bb.tailThreshold) {
    score++;
    reasons.push('Small tail (strong buying)');
  }

  // Close below lower BB
  if (candle.close < ind.bb_lower) {
    score += 2;
    reasons.push('Close below lower BB');
  }

  const triggered = score >= 5;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 2: BB20 + Volume
 *
 * Original:
 * - Close < SMA9
 * - Close > EMA200
 * - Close > EMA200_1h
 * - Close < EMA slow (26)
 * - Close < 0.992 * BB lower
 */
function condition_2_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (candle.close < ind.sma_9) {
    score++;
    reasons.push('Close < SMA9');
  }

  if (candle.close > ind.ema_200) {
    score++;
    reasons.push('Close > EMA200');
  }

  if (candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Close > EMA200_1h');
  }

  if (candle.close < ind.ema_26) {
    score++;
    reasons.push('Close < EMA26');
  }

  // Deep below BB
  if (candle.close < 0.992 * ind.bb_lower) {
    score += 2;
    reasons.push('Close < 99.2% BB lower');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 3: SSL Channel + RSI divergence
 */
function condition_3_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // SSL bullish
  if (ind.ssl_up_1h > ind.ssl_down_1h) {
    score++;
    reasons.push('SSL bullish (1h)');
  }

  // EMA trend
  if (ind.ema_50 > ind.ema_200) {
    score++;
    reasons.push('EMA50 > EMA200');
  }

  if (ind.ema_50_1h > ind.ema_200_1h) {
    score++;
    reasons.push('EMA50_1h > EMA200_1h');
  }

  // RSI divergence: Local RSI much lower than 1h RSI
  if (ind.rsi_14 < ind.rsi_14_1h - 15) {
    score += 2;
    reasons.push(`RSI divergence (${ind.rsi_14.toFixed(0)} vs ${ind.rsi_14_1h.toFixed(0)} 1h)`);
  }

  // Price above EMA200
  if (candle.close > ind.ema_200 && candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Above EMA200 multi-TF');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 4: EWO + RSI oversold extreme
 */
function condition_4_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // EWO bullish
  if (ind.ewo > params.ewo.high_threshold) {
    score++;
    reasons.push(`EWO bullish (${ind.ewo.toFixed(2)})`);
  }

  // RSI oversold
  if (ind.rsi_14 < params.rsi.oversold) {
    score += 2;
    reasons.push(`RSI oversold (${ind.rsi_14.toFixed(0)})`);
  }

  // RSI extreme
  if (ind.rsi_14 < params.rsi.oversold_extreme) {
    score++;
    reasons.push('RSI extreme oversold');
  }

  // Trend filter
  if (!ind.is_downtrend) {
    score++;
    reasons.push('Not in downtrend');
  }

  // Price near BB lower
  if (candle.close < ind.bb_lower * 1.01) {
    score++;
    reasons.push('Near BB lower');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 5: BB touch + momentum
 */
function condition_5_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // BB touch (low touched lower band)
  if (candle.low <= ind.bb_lower) {
    score += 2;
    reasons.push('Low touched BB lower');
  }

  // But close recovered (bullish wick)
  if (candle.close > ind.bb_lower) {
    score++;
    reasons.push('Close recovered above BB');
  }

  // RSI showing momentum shift
  if (ind.rsi_3_change > 0) {
    score++;
    reasons.push('RSI momentum positive');
  }

  // Not extremely oversold (avoiding dead cat)
  if (ind.rsi_14 > params.rsi.oversold_extreme) {
    score++;
    reasons.push('RSI not extreme');
  }

  // Volume present
  if ((candle.volume ?? 0) > 0) {
    score++;
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 6: Multi-timeframe RSI alignment
 */
function condition_6_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 5m RSI oversold
  if (ind.rsi_14 < params.rsi.oversold) {
    score++;
    reasons.push(`RSI 5m oversold (${ind.rsi_14.toFixed(0)})`);
  }

  // 15m RSI not extreme
  if (ind.rsi_14_15m > params.rsi.oversold_extreme && ind.rsi_14_15m < params.rsi.overbought) {
    score++;
    reasons.push(`RSI 15m neutral (${ind.rsi_14_15m.toFixed(0)})`);
  }

  // 1h RSI recovering
  if (ind.rsi_14_1h > ind.rsi_14) {
    score++;
    reasons.push('RSI 1h > RSI 5m');
  }

  // 4h trend not bearish
  if (ind.rsi_14_4h > 40) {
    score++;
    reasons.push('RSI 4h neutral/bullish');
  }

  // Price above key EMAs
  if (candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Above EMA200 1h');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 7: CMF + RSI combo
 */
function condition_7_long(
  _candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // CMF showing accumulation
  if (ind.cmf > 0) {
    score++;
    reasons.push(`CMF positive (${ind.cmf.toFixed(2)})`);
  }

  // CMF 1h also positive
  if (ind.cmf_1h > 0) {
    score++;
    reasons.push('CMF 1h positive');
  }

  // RSI oversold
  if (ind.rsi_14 < params.rsi.oversold + 5) {
    score++;
    reasons.push(`RSI low (${ind.rsi_14.toFixed(0)})`);
  }

  // RSI turning up
  if (ind.rsi_3 > 20) {
    score++;
    reasons.push('RSI_3 recovering');
  }

  // Not in strong downtrend
  if (ind.cti > -0.8) {
    score++;
    reasons.push('CTI not extreme bearish');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 8: Williams %R extreme
 */
function condition_8_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Williams %R extreme oversold
  if (ind.williams_r < -90) {
    score += 2;
    reasons.push(`Williams %R extreme (${ind.williams_r.toFixed(0)})`);
  } else if (ind.williams_r < -80) {
    score++;
    reasons.push(`Williams %R oversold (${ind.williams_r.toFixed(0)})`);
  }

  // RSI confirmation
  if (ind.rsi_14 < 35) {
    score++;
    reasons.push('RSI confirming');
  }

  // Price above trend EMAs
  if (candle.close > ind.ema_200) {
    score++;
    reasons.push('Above EMA200');
  }

  // Momentum recovering
  if (ind.roc_2 > -1) {
    score++;
    reasons.push('ROC stabilizing');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 9: CCI oversold
 */
function condition_9_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // CCI oversold
  if (ind.cci < -100) {
    score += 2;
    reasons.push(`CCI oversold (${ind.cci.toFixed(0)})`);
  }

  // CCI extreme
  if (ind.cci < -150) {
    score++;
    reasons.push('CCI extreme');
  }

  // RSI also oversold
  if (ind.rsi_14 < params.rsi.oversold + 5) {
    score++;
    reasons.push('RSI confirming');
  }

  // Trend filter
  if (candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Above EMA200 1h');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 10: Stochastic RSI oversold
 */
function condition_10_long(
  _candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Stoch RSI oversold
  if (ind.stoch_rsi_k < 20) {
    score += 2;
    reasons.push(`Stoch RSI K oversold (${ind.stoch_rsi_k.toFixed(0)})`);
  }

  // K crossing above D (bullish cross)
  if (ind.stoch_rsi_k > ind.stoch_rsi_d && ind.stoch_rsi_k < 30) {
    score++;
    reasons.push('Stoch RSI bullish cross');
  }

  // RSI confirmation
  if (ind.rsi_14 < params.rsi.oversold + 10) {
    score++;
    reasons.push('RSI low');
  }

  // Trend filter
  if (!ind.is_downtrend) {
    score++;
    reasons.push('Not in downtrend');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 11: EMA cross + RSI
 */
function condition_11_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // EMA difference narrowing (potential cross)
  const emaDiff = (ind.ema_26 - ind.ema_12) / candle.close;
  if (emaDiff > 0 && emaDiff < params.ema.openMult) {
    score++;
    reasons.push('EMA convergence');
  }

  // EMA12 > EMA26 (bullish)
  if (ind.ema_12 > ind.ema_26) {
    score++;
    reasons.push('EMA12 > EMA26');
  }

  // RSI oversold bounce
  if (ind.rsi_14 > params.rsi.oversold_extreme && ind.rsi_14 < params.rsi.neutral_low) {
    score++;
    reasons.push('RSI recovering from oversold');
  }

  // RSI momentum positive
  if (ind.rsi_3_change > 0) {
    score++;
    reasons.push('RSI momentum up');
  }

  // Price above long EMA
  if (candle.close > ind.ema_200) {
    score++;
    reasons.push('Above EMA200');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 12: BB squeeze breakout
 */
function condition_12_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // BB width narrow (squeeze)
  if (ind.bb_width < 0.04) {
    score++;
    reasons.push('BB squeeze');
  }

  // Breaking above middle
  if (candle.close > ind.bb_middle) {
    score++;
    reasons.push('Breaking above BB middle');
  }

  // RSI not extreme
  if (ind.rsi_14 > 40 && ind.rsi_14 < 60) {
    score++;
    reasons.push('RSI neutral (breakout potential)');
  }

  // Momentum positive
  if (ind.roc_2 > 0) {
    score++;
    reasons.push('Positive momentum');
  }

  // Trend support
  if (candle.close > ind.ema_50) {
    score++;
    reasons.push('Above EMA50');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.95);

  return { triggered, confidence, reasons };
}

/**
 * Condition 13: MFI + RSI combo
 */
function condition_13_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // MFI oversold
  if (ind.mfi < 30) {
    score++;
    reasons.push(`MFI oversold (${ind.mfi.toFixed(0)})`);
  }

  // MFI extreme
  if (ind.mfi < 20) {
    score++;
    reasons.push('MFI extreme');
  }

  // RSI oversold
  if (ind.rsi_14 < params.rsi.oversold) {
    score++;
    reasons.push('RSI oversold');
  }

  // Price near BB lower
  if (candle.close < ind.bb_middle) {
    score++;
    reasons.push('Below BB middle');
  }

  // Not in crash
  if (!ind.dump_detected) {
    score++;
    reasons.push('No dump detected');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.95);

  return { triggered, confidence, reasons };
}

// =================================================================
// PUMP MODE CONDITIONS (Tags 21-26)
// =================================================================

/**
 * Condition 21: Post-pump pullback entry
 */
function condition_21_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Recent pump detected
  if (ind.pump_detected) {
    score++;
    reasons.push('Pump detected');
  }

  // RSI pulled back from overbought
  if (ind.rsi_14 < params.rsi.overbought && ind.rsi_14 > params.rsi.neutral_low) {
    score++;
    reasons.push('RSI pulled back');
  }

  // Still above EMAs (trend intact)
  if (candle.close > ind.ema_50 && candle.close > ind.ema_200) {
    score++;
    reasons.push('Above trend EMAs');
  }

  // EWO still positive
  if (ind.ewo > 0) {
    score++;
    reasons.push('EWO positive');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.90);

  return { triggered, confidence, reasons };
}

/**
 * Condition 22: Pump continuation
 */
function condition_22_long(
  _candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (ind.pump_detected) {
    score++;
    reasons.push('In pump');
  }

  // Strong momentum
  if (ind.roc_9 > 2) {
    score++;
    reasons.push('Strong ROC');
  }

  // EWO very positive
  if (ind.ewo > 4) {
    score++;
    reasons.push('Strong EWO');
  }

  // RSI mid-range (room to run)
  if (ind.rsi_14 > 45 && ind.rsi_14 < 70) {
    score++;
    reasons.push('RSI has room');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.85);

  return { triggered, confidence, reasons };
}

/**
 * Condition 23: Pump + volume
 */
function condition_23_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (ind.pump_detected) {
    score++;
    reasons.push('Pump active');
  }

  // CMF positive (buying pressure)
  if (ind.cmf > 0.1) {
    score++;
    reasons.push('Strong CMF');
  }

  // Above all key EMAs
  if (candle.close > ind.ema_12 && candle.close > ind.ema_26 && candle.close > ind.ema_50) {
    score++;
    reasons.push('Above all EMAs');
  }

  const triggered = score >= 2;
  const confidence = Math.min(0.5 + score * 0.12, 0.85);

  return { triggered, confidence, reasons };
}

// =================================================================
// QUICK MODE CONDITIONS (Tags 41-45)
// =================================================================

/**
 * Condition 41: Quick RSI bounce
 */
function condition_41_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // RSI_3 very oversold
  if (ind.rsi_3 < 20) {
    score += 2;
    reasons.push(`RSI_3 extreme (${ind.rsi_3.toFixed(0)})`);
  }

  // RSI_3 turning up
  if (ind.rsi_3_change > 5) {
    score++;
    reasons.push('RSI_3 bouncing');
  }

  // Not in strong downtrend
  if (ind.rsi_14_1h > 30) {
    score++;
    reasons.push('1h RSI not crashed');
  }

  // Quick check: price above some EMA
  if (candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Above EMA200 1h');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.85);

  return { triggered, confidence, reasons };
}

/**
 * Condition 42: Quick BB touch
 */
function condition_42_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Touched lower BB
  if (candle.low < ind.bb_lower) {
    score += 2;
    reasons.push('Touched lower BB');
  }

  // Closed above
  if (candle.close > ind.bb_lower) {
    score++;
    reasons.push('Closed above BB');
  }

  // Quick RSI oversold
  if (ind.rsi_3 < 25) {
    score++;
    reasons.push('RSI_3 oversold');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.85);

  return { triggered, confidence, reasons };
}

/**
 * Condition 43: Quick momentum shift
 */
function condition_43_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // ROC turning positive
  if (ind.roc_2 > 0 && ind.roc_9 < 0) {
    score++;
    reasons.push('Short-term momentum shift');
  }

  // RSI_3 bouncing hard
  if (ind.rsi_3_change > 10) {
    score++;
    reasons.push('Strong RSI bounce');
  }

  // Was oversold
  if (ind.rsi_14 < 40) {
    score++;
    reasons.push('Coming from oversold');
  }

  // Trend support
  if (candle.close > ind.ema_200) {
    score++;
    reasons.push('Above EMA200');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.85);

  return { triggered, confidence, reasons };
}

/**
 * Condition 44: Quick stoch bounce
 */
function condition_44_long(
  _candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Stoch RSI very oversold
  if (ind.stoch_rsi_k < 15) {
    score += 2;
    reasons.push('Stoch RSI extreme');
  }

  // Starting to turn
  if (ind.stoch_rsi_k > ind.stoch_rsi_d) {
    score++;
    reasons.push('Stoch crossing up');
  }

  // RSI not crashed
  if (ind.rsi_14 > 20) {
    score++;
    reasons.push('RSI holding');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.85);

  return { triggered, confidence, reasons };
}

/**
 * Condition 45: Quick CCI bounce
 */
function condition_45_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // CCI very oversold
  if (ind.cci < -150) {
    score += 2;
    reasons.push(`CCI extreme (${ind.cci.toFixed(0)})`);
  }

  // Near BB lower
  if (candle.close < ind.bb_lower * 1.005) {
    score++;
    reasons.push('Near BB lower');
  }

  // RSI supporting
  if (ind.rsi_14 < 35) {
    score++;
    reasons.push('RSI oversold');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.1, 0.85);

  return { triggered, confidence, reasons };
}

// =================================================================
// RAPID MODE CONDITIONS (Tags 101-103)
// =================================================================

/**
 * Condition 101: Rapid oversold
 */
function condition_101_long(
  _candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // RSI_3 crashed
  if (ind.rsi_3 < 10) {
    score += 2;
    reasons.push(`RSI_3 crashed (${ind.rsi_3.toFixed(0)})`);
  }

  // But 15m not crashed (divergence)
  if (ind.rsi_3_15m > 20) {
    score++;
    reasons.push('15m RSI holding');
  }

  // 1h showing support
  if (ind.rsi_14_1h > 30) {
    score++;
    reasons.push('1h RSI supportive');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.12, 0.80);

  return { triggered, confidence, reasons };
}

/**
 * Condition 102: Rapid momentum
 */
function condition_102_long(
  _candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Strong RSI_3 bounce
  if (ind.rsi_3_change > 15) {
    score += 2;
    reasons.push('Massive RSI_3 bounce');
  }

  // Was oversold
  if (ind.rsi_14 < 35) {
    score++;
    reasons.push('From oversold');
  }

  // Not in crash
  if (!ind.dump_detected) {
    score++;
    reasons.push('Not in dump');
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.12, 0.80);

  return { triggered, confidence, reasons };
}

/**
 * Condition 103: Rapid reversal
 */
function condition_103_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Bullish candle from low
  if (candle.close > candle.open && candle.low < ind.bb_lower) {
    score += 2;
    reasons.push('Bullish reversal candle');
  }

  // RSI_3 turning
  if (ind.rsi_3_change > 10) {
    score++;
    reasons.push('RSI momentum shift');
  }

  // Volume present
  if ((candle.volume ?? 0) > 0) {
    score++;
  }

  const triggered = score >= 3;
  const confidence = Math.min(0.5 + score * 0.12, 0.80);

  return { triggered, confidence, reasons };
}

// =================================================================
// GRIND MODE (Tag 120)
// =================================================================

/**
 * Condition 120: Grind entry
 */
function condition_120_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Slightly oversold
  if (ind.rsi_14 < params.rsi.neutral_low) {
    score++;
    reasons.push('RSI below neutral');
  }

  // Below BB middle
  if (candle.close < ind.bb_middle) {
    score++;
    reasons.push('Below BB middle');
  }

  // Trend intact
  if (candle.close > ind.ema_200) {
    score++;
    reasons.push('Above EMA200');
  }

  // Not in major move
  if (Math.abs(ind.roc_9) < 3) {
    score++;
    reasons.push('Stable price');
  }

  // CMF neutral to positive
  if (ind.cmf > -0.1) {
    score++;
    reasons.push('CMF acceptable');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.06, 0.75);

  return { triggered, confidence, reasons };
}

// =================================================================
// TOP COINS MODE (Tags 141-142)
// =================================================================

/**
 * Condition 141: Top coin dip buy
 */
function condition_141_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // RSI oversold but not crashed
  if (ind.rsi_14 < params.rsi.oversold && ind.rsi_14 > params.rsi.oversold_extreme) {
    score++;
    reasons.push('RSI oversold range');
  }

  // Multi-TF support
  if (ind.rsi_14_1h > 30 && ind.rsi_14_4h > 35) {
    score++;
    reasons.push('Multi-TF RSI support');
  }

  // Price near lower BB
  if (candle.close < ind.bb_lower * 1.02) {
    score++;
    reasons.push('Near BB lower');
  }

  // Trend filter
  if (candle.close > ind.ema_200_1h) {
    score++;
    reasons.push('Above 1h EMA200');
  }

  // CTI not extreme
  if (ind.cti_1h > -0.8) {
    score++;
    reasons.push('CTI 1h acceptable');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.90);

  return { triggered, confidence, reasons };
}

/**
 * Condition 142: Top coin trend follow
 */
function condition_142_long(
  candle: Candle,
  ind: NFIIndicators,
  _params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Strong uptrend
  if (ind.is_uptrend) {
    score++;
    reasons.push('In uptrend');
  }

  // Pullback to EMA
  if (candle.close > ind.ema_50 * 0.99 && candle.close < ind.ema_50 * 1.02) {
    score++;
    reasons.push('Pullback to EMA50');
  }

  // RSI healthy
  if (ind.rsi_14 > 40 && ind.rsi_14 < 65) {
    score++;
    reasons.push('RSI healthy');
  }

  // Higher TF support
  if (ind.ema_50_1h > ind.ema_200_1h) {
    score++;
    reasons.push('1h trend bullish');
  }

  // Momentum positive
  if (ind.roc_9_4h > 0) {
    score++;
    reasons.push('4h momentum positive');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.90);

  return { triggered, confidence, reasons };
}

// =================================================================
// DERISK MODE (Tag 161)
// =================================================================

/**
 * Condition 161: Derisk entry (conservative)
 */
function condition_161_long(
  candle: Candle,
  ind: NFIIndicators,
  params: NFIParams
): { triggered: boolean; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Very oversold
  if (ind.rsi_14 < params.rsi.oversold_extreme + 5) {
    score++;
    reasons.push('Very oversold');
  }

  // All timeframes oversold
  if (ind.rsi_14_15m < params.rsi.oversold && ind.rsi_14_1h < params.rsi.oversold + 10) {
    score++;
    reasons.push('Multi-TF oversold');
  }

  // Strong trend intact on higher TF
  if (candle.close > ind.ema_200_4h) {
    score++;
    reasons.push('Above EMA200 4h');
  }

  // Volume showing accumulation
  if (ind.cmf > 0.05) {
    score++;
    reasons.push('CMF accumulation');
  }

  // MFI also oversold
  if (ind.mfi < 25) {
    score++;
    reasons.push('MFI oversold');
  }

  const triggered = score >= 4;
  const confidence = Math.min(0.5 + score * 0.08, 0.85);

  return { triggered, confidence, reasons };
}
