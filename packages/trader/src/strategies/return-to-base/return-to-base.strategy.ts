/**
 * Return to Base - Scalping Strategy
 *
 * Estrategia de reversión a la media optimizada para scalping en M1/M5.
 * Basada en el concepto de "elástico" - el precio estirado tiende a volver.
 *
 * == LÓGICA ==
 * 1. Marco de Contexto (M5): Detectar sobre-extensión (precio fuera de BB 2.5)
 * 2. Marco de Gatillo (M1): Entrar con precisión cuando hay señal de reversión
 * 3. Filtro "Boca de Cocodrilo": NO entrar si las bandas se expanden (tendencia fuerte)
 *
 * == INDICADORES ==
 * - Bollinger Bands (20, 2.5) - Solo extremos reales
 * - RSI (7) - Reacción rápida a picos
 * - EMA 20 - Primer objetivo (TP1)
 * - EMA 50 - Filtro de tendencia corto plazo
 *
 * == ENTRADAS ==
 * LONG:
 *   - Precio tocó banda inferior en M5
 *   - Vela M1 cierra dentro de bandas (reversión)
 *   - RSI(7) subiendo desde <20
 *   - Bandas NO expandiéndose
 *
 * SHORT:
 *   - Precio tocó banda superior en M5
 *   - Vela M1 cierra dentro de bandas (reversión)
 *   - RSI(7) bajando desde >80
 *   - Bandas NO expandiéndose
 *
 * == GESTIÓN ==
 * - SL: 2-3 pips por encima/debajo del swing high/low
 * - TP1: EMA 20 (parcial)
 * - TP2: EMA 50 o BB Middle
 */

import type { Candle, Signal } from '@deriv-bot/shared';
import { RSI, BollingerBands, EMA } from 'technicalindicators';

// ============================================================================
// TYPES
// ============================================================================

export interface ReturnToBaseParams {
  // Bollinger Bands
  bbPeriod: number;
  bbStdDev: number;  // 2.5 para solo extremos reales

  // RSI rápido
  rsiPeriod: number;  // 7 para reacción rápida
  rsiOversold: number;  // 20
  rsiOverbought: number;  // 80

  // EMAs para targets
  emaFastPeriod: number;  // 20 - TP1
  emaSlowPeriod: number;  // 50 - Filtro/TP2

  // Filtro "Boca de Cocodrilo" - expansión de bandas
  bandWidthExpansionThreshold: number;  // % de expansión que indica tendencia
  bandWidthLookback: number;  // Velas para comparar expansión

  // Stop Loss
  slAtrMultiplier: number;  // Multiplicador ATR para SL
  slMinPips: number;  // SL mínimo en pips

  // Gestión
  maxBarsInTrade: number;  // Salir si no alcanza TP
  minCandles: number;  // Velas mínimas para calcular

  // Confirmaciones
  requireRejectionCandle: boolean;  // Vela de rechazo obligatoria
  requireRsiConfirmation: boolean;  // RSI moviéndose en dirección correcta
}

export interface ReturnToBaseIndicators {
  // Bollinger Bands
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  bbWidthPrev: number;
  isBandExpanding: boolean;

  // RSI
  rsi: number;
  rsiPrev: number;
  rsiDirection: 'rising' | 'falling' | 'flat';

  // EMAs
  ema20: number;
  ema50: number;

  // Price action
  price: number;
  high: number;
  low: number;
  open: number;

  // Candle patterns
  isBullishCandle: boolean;
  isBearishCandle: boolean;
  hasUpperWick: boolean;
  hasLowerWick: boolean;

  // Band touch detection
  touchedUpperBand: boolean;
  touchedLowerBand: boolean;
  closedInsideBands: boolean;
}

export interface ReturnToBaseSignal {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;  // EMA 20
  takeProfit2: number;  // EMA 50 o BB Middle
  confidence: number;
  reason: string;
  indicators: Partial<ReturnToBaseIndicators>;
}

// ============================================================================
// DEFAULT PARAMETERS
// ============================================================================

export const DEFAULT_RTB_PARAMS: ReturnToBaseParams = {
  // Bollinger Bands - más extremo que el estándar
  bbPeriod: 20,
  bbStdDev: 2.5,  // Solo extremos reales

  // RSI rápido
  rsiPeriod: 7,  // Reacción rápida
  rsiOversold: 20,
  rsiOverbought: 80,

  // EMAs
  emaFastPeriod: 20,
  emaSlowPeriod: 50,

  // Filtro expansión de bandas
  bandWidthExpansionThreshold: 0.15,  // 15% de expansión = tendencia
  bandWidthLookback: 5,

  // Stop Loss
  slAtrMultiplier: 1.5,
  slMinPips: 3,

  // Gestión
  maxBarsInTrade: 15,
  minCandles: 60,

  // Confirmaciones
  requireRejectionCandle: true,
  requireRsiConfirmation: true,
};

// ============================================================================
// STRATEGY CLASS
// ============================================================================

export class ReturnToBaseStrategy {
  private params: ReturnToBaseParams;
  private lastSignalTime: number = 0;
  private cooldownMs: number = 60000;  // 1 minuto entre señales

  constructor(params: Partial<ReturnToBaseParams> = {}) {
    this.params = { ...DEFAULT_RTB_PARAMS, ...params };
  }

  // ============================================================================
  // MAIN ENTRY POINT
  // ============================================================================

  /**
   * Procesa una nueva vela y genera señal si hay oportunidad
   */
  analyze(candles: Candle[], asset: string): Signal | null {
    // Validar datos suficientes
    if (candles.length < this.params.minCandles) {
      return null;
    }

    // Cooldown entre señales
    const now = Date.now();
    if (now - this.lastSignalTime < this.cooldownMs) {
      return null;
    }

    // Calcular indicadores
    const indicators = this.calculateIndicators(candles);
    if (!indicators) {
      return null;
    }

    // Verificar condiciones de entrada
    const signal = this.checkEntryConditions(indicators);
    if (!signal) {
      return null;
    }

    // Actualizar cooldown
    this.lastSignalTime = now;

    // Convertir a formato Signal
    return this.toSignal(signal, asset);
  }

  // ============================================================================
  // INDICATOR CALCULATION
  // ============================================================================

  private calculateIndicators(candles: Candle[]): ReturnToBaseIndicators | null {
    try {
      const closes = candles.map(c => c.close);

      // Bollinger Bands
      const bbResult = BollingerBands.calculate({
        period: this.params.bbPeriod,
        values: closes,
        stdDev: this.params.bbStdDev,
      });

      if (bbResult.length < 2) return null;

      const bbCurrent = bbResult[bbResult.length - 1]!;
      const bbPrev = bbResult[bbResult.length - 2]!;

      // Calcular ancho de bandas normalizado
      const bbWidth = (bbCurrent.upper - bbCurrent.lower) / bbCurrent.middle;
      const bbWidthPrev = (bbPrev.upper - bbPrev.lower) / bbPrev.middle;

      // Detectar expansión de bandas (Boca de Cocodrilo)
      let isBandExpanding = false;
      if (bbResult.length >= this.params.bandWidthLookback) {
        const lookbackBB = bbResult[bbResult.length - this.params.bandWidthLookback]!;
        const lookbackWidth = (lookbackBB.upper - lookbackBB.lower) / lookbackBB.middle;
        const expansion = (bbWidth - lookbackWidth) / lookbackWidth;
        isBandExpanding = expansion > this.params.bandWidthExpansionThreshold;
      }

      // RSI
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

      // Current candle data
      const currentCandle = candles[candles.length - 1]!;
      const price = currentCandle.close;
      const high = currentCandle.high;
      const low = currentCandle.low;
      const open = currentCandle.open;

      // Candle patterns
      const isBullishCandle = price > open;
      const isBearishCandle = price < open;
      const bodySize = Math.abs(price - open);
      const upperWick = high - Math.max(price, open);
      const lowerWick = Math.min(price, open) - low;
      const hasUpperWick = upperWick > bodySize * 0.5;
      const hasLowerWick = lowerWick > bodySize * 0.5;

      // Band touch detection
      const touchedUpperBand = high >= bbCurrent.upper;
      const touchedLowerBand = low <= bbCurrent.lower;
      const closedInsideBands = price < bbCurrent.upper && price > bbCurrent.lower;

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
        price,
        high,
        low,
        open,
        isBullishCandle,
        isBearishCandle,
        hasUpperWick,
        hasLowerWick,
        touchedUpperBand,
        touchedLowerBand,
        closedInsideBands,
      };
    } catch (error) {
      console.error('[RTB] Error calculating indicators:', error);
      return null;
    }
  }

  // ============================================================================
  // ENTRY CONDITIONS
  // ============================================================================

  private checkEntryConditions(ind: ReturnToBaseIndicators): ReturnToBaseSignal | null {
    // FILTRO CRÍTICO: No entrar si las bandas se expanden (Boca de Cocodrilo)
    if (ind.isBandExpanding) {
      return null;
    }

    // Check LONG conditions
    const longSignal = this.checkLongEntry(ind);
    if (longSignal) return longSignal;

    // Check SHORT conditions
    const shortSignal = this.checkShortEntry(ind);
    if (shortSignal) return shortSignal;

    return null;
  }

  private checkLongEntry(ind: ReturnToBaseIndicators): ReturnToBaseSignal | null {
    // Condición 1: Precio tocó banda inferior
    if (!ind.touchedLowerBand) {
      return null;
    }

    // Condición 2: Vela cerró dentro de las bandas (reversión)
    if (!ind.closedInsideBands) {
      return null;
    }

    // Condición 3: Vela de rechazo (bullish candle con lower wick)
    if (this.params.requireRejectionCandle) {
      if (!ind.isBullishCandle || !ind.hasLowerWick) {
        return null;
      }
    }

    // Condición 4: RSI en zona de sobreventa y subiendo
    if (this.params.requireRsiConfirmation) {
      if (ind.rsiPrev >= this.params.rsiOversold || ind.rsiDirection !== 'rising') {
        return null;
      }
    }

    // Calcular niveles
    const entryPrice = ind.price;
    const stopLoss = ind.low - (ind.bbWidth * ind.price * 0.1);  // Debajo del mínimo
    const takeProfit1 = ind.ema20;
    const takeProfit2 = ind.bbMiddle;

    // Validar que TP esté por encima de entry
    if (takeProfit1 <= entryPrice) {
      return null;
    }

    // Calcular confianza
    const confidence = this.calculateConfidence(ind, 'LONG');

    return {
      direction: 'LONG',
      entryPrice,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: 'Lower BB touch + bullish rejection + RSI oversold rising',
      indicators: {
        rsi: ind.rsi,
        bbLower: ind.bbLower,
        bbMiddle: ind.bbMiddle,
        ema20: ind.ema20,
        isBandExpanding: ind.isBandExpanding,
      },
    };
  }

  private checkShortEntry(ind: ReturnToBaseIndicators): ReturnToBaseSignal | null {
    // Condición 1: Precio tocó banda superior
    if (!ind.touchedUpperBand) {
      return null;
    }

    // Condición 2: Vela cerró dentro de las bandas (reversión)
    if (!ind.closedInsideBands) {
      return null;
    }

    // Condición 3: Vela de rechazo (bearish candle con upper wick)
    if (this.params.requireRejectionCandle) {
      if (!ind.isBearishCandle || !ind.hasUpperWick) {
        return null;
      }
    }

    // Condición 4: RSI en zona de sobrecompra y bajando
    if (this.params.requireRsiConfirmation) {
      if (ind.rsiPrev <= this.params.rsiOverbought || ind.rsiDirection !== 'falling') {
        return null;
      }
    }

    // Calcular niveles
    const entryPrice = ind.price;
    const stopLoss = ind.high + (ind.bbWidth * ind.price * 0.1);  // Encima del máximo
    const takeProfit1 = ind.ema20;
    const takeProfit2 = ind.bbMiddle;

    // Validar que TP esté por debajo de entry
    if (takeProfit1 >= entryPrice) {
      return null;
    }

    // Calcular confianza
    const confidence = this.calculateConfidence(ind, 'SHORT');

    return {
      direction: 'SHORT',
      entryPrice,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: 'Upper BB touch + bearish rejection + RSI overbought falling',
      indicators: {
        rsi: ind.rsi,
        bbUpper: ind.bbUpper,
        bbMiddle: ind.bbMiddle,
        ema20: ind.ema20,
        isBandExpanding: ind.isBandExpanding,
      },
    };
  }

  // ============================================================================
  // CONFIDENCE CALCULATION
  // ============================================================================

  private calculateConfidence(ind: ReturnToBaseIndicators, direction: 'LONG' | 'SHORT'): number {
    let confidence = 0.5;

    // RSI extremo aumenta confianza
    if (direction === 'LONG' && ind.rsi < 15) {
      confidence += 0.15;
    } else if (direction === 'SHORT' && ind.rsi > 85) {
      confidence += 0.15;
    }

    // Vela de rechazo fuerte
    if (direction === 'LONG' && ind.hasLowerWick && ind.isBullishCandle) {
      confidence += 0.1;
    } else if (direction === 'SHORT' && ind.hasUpperWick && ind.isBearishCandle) {
      confidence += 0.1;
    }

    // Bandas estables (no expandiéndose)
    if (!ind.isBandExpanding && ind.bbWidth < ind.bbWidthPrev) {
      confidence += 0.1;  // Bandas contrayéndose = mejor para MR
    }

    // Precio muy alejado de la media
    const distanceFromMiddle = Math.abs(ind.price - ind.bbMiddle) / ind.bbMiddle;
    if (distanceFromMiddle > 0.02) {  // >2% de distancia
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95);
  }

  // ============================================================================
  // SIGNAL CONVERSION
  // ============================================================================

  private toSignal(rtbSignal: ReturnToBaseSignal, asset: string): Signal {
    return {
      strategyName: 'RETURN_TO_BASE',
      symbol: asset,
      asset,
      direction: rtbSignal.direction === 'LONG' ? 'CALL' : 'PUT',
      confidence: rtbSignal.confidence,
      timestamp: Date.now(),
      metadata: {
        price: rtbSignal.entryPrice,
        currentPrice: rtbSignal.entryPrice,
        stopLoss: rtbSignal.stopLoss,
        takeProfit: rtbSignal.takeProfit1,  // TP1 como principal
        takeProfit2: rtbSignal.takeProfit2,
        reason: rtbSignal.reason,
        ...rtbSignal.indicators,
      },
    };
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  getName(): string {
    return 'RETURN_TO_BASE';
  }

  getParams(): ReturnToBaseParams {
    return { ...this.params };
  }

  updateParams(params: Partial<ReturnToBaseParams>): void {
    this.params = { ...this.params, ...params };
  }

  setCooldown(ms: number): void {
    this.cooldownMs = ms;
  }
}

// ============================================================================
// FACTORY & PRESETS
// ============================================================================

export function createReturnToBase(params?: Partial<ReturnToBaseParams>): ReturnToBaseStrategy {
  return new ReturnToBaseStrategy(params);
}

/**
 * Preset para scalping agresivo (más señales, menos filtros)
 */
export const RTB_AGGRESSIVE_PRESET: Partial<ReturnToBaseParams> = {
  bbStdDev: 2.0,  // Bandas más cercanas
  rsiOversold: 25,
  rsiOverbought: 75,
  requireRejectionCandle: false,
  requireRsiConfirmation: false,
  bandWidthExpansionThreshold: 0.25,
};

/**
 * Preset conservador (menos señales, más filtros)
 */
export const RTB_CONSERVATIVE_PRESET: Partial<ReturnToBaseParams> = {
  bbStdDev: 3.0,  // Solo extremos muy alejados
  rsiOversold: 15,
  rsiOverbought: 85,
  requireRejectionCandle: true,
  requireRsiConfirmation: true,
  bandWidthExpansionThreshold: 0.10,
};

/**
 * Preset para crypto (más volátil)
 */
export const RTB_CRYPTO_PRESET: Partial<ReturnToBaseParams> = {
  bbStdDev: 2.5,
  rsiPeriod: 5,  // Aún más rápido para crypto
  rsiOversold: 15,
  rsiOverbought: 85,
  slAtrMultiplier: 2.0,  // SL más amplio
  maxBarsInTrade: 20,
};

/**
 * Preset para forex majors
 */
export const RTB_FOREX_PRESET: Partial<ReturnToBaseParams> = {
  bbStdDev: 2.5,
  rsiPeriod: 7,
  rsiOversold: 20,
  rsiOverbought: 80,
  slAtrMultiplier: 1.5,
  maxBarsInTrade: 15,
};

/**
 * Preset balanceado - requiere rechazo pero no RSI extremo
 */
export const RTB_BALANCED_PRESET: Partial<ReturnToBaseParams> = {
  bbStdDev: 2.0,  // Bandas más cercanas para más señales
  rsiPeriod: 7,
  rsiOversold: 30,  // Menos extremo
  rsiOverbought: 70,
  requireRejectionCandle: true,  // Sí requiere rechazo
  requireRsiConfirmation: false, // No requiere RSI extremo
  bandWidthExpansionThreshold: 0.20,
};

/**
 * Preset para synthetic indices
 */
export const RTB_SYNTHETIC_PRESET: Partial<ReturnToBaseParams> = {
  bbStdDev: 2.0,
  rsiPeriod: 7,
  rsiOversold: 30,
  rsiOverbought: 70,
  requireRejectionCandle: true,
  requireRsiConfirmation: false,
  bandWidthExpansionThreshold: 0.15,
  maxBarsInTrade: 10,  // Menos tiempo para synthetic
};
