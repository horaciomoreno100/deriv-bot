/**
 * 🎯 Vdubus BinaryPro 1 - Indicador con Win Rate Manual v7.3
 * 
 * Estrategia basada en el indicador Pine Script de TradingView.
 * 
 * Características principales:
 * - Canal superior/inferior (highest/lowest)
 * - Bollinger Bands sobre el basis (promedio de canales)
 * - RSI para sobrecompra/sobreventa
 * - Detección de divergencias
 * - Filtro de tendencia basado en MA50
 * - Sistema de scoring para CALL/PUT
 * - Simulación de trades binarios con win rate tracking
 */

import { BaseStrategy, type StrategyContext } from '../strategy/base-strategy.js';
import type { Candle, Signal, StrategyConfig } from '@deriv-bot/shared';
import type { SignalProximity } from '@deriv-bot/shared';
import { RSI, SMA } from 'trading-signals';

/**
 * Vdubus Strategy Configuration
 */
export interface VdubusConfig extends StrategyConfig {
  // Parámetros de Canal
  upperChannelLength?: number;
  lowerChannelLength?: number;
  
  // MA50
  ma50Period?: number;
  
  // Bollinger Bands
  bbLength?: number;
  bbMultiplier?: number;
  
  // RSI
  rsiLength?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  
  // Divergencia
  divergenceLookback?: number;
  useDivergence?: boolean;
  
  // Tendencia
  useTrendFilter?: boolean;
  trendSensitivity?: number; // Porcentaje
  
  // Señales
  tolerance?: number; // Tolerancia de toque en porcentaje (0.008 = 0.8%)
  enableDynamicTolerance?: boolean; // Ajustar tolerance según volatilidad (BB width)
  minBarsBetweenSignals?: number; // Anti-solapamiento
  minScore?: number; // Score mínimo para generar señal
  minScoreCall?: number; // Score mínimo específico para CALL (más estricto)
  enableDynamicMinScoreCall?: boolean; // Ajustar minScoreCall según tendencia
  onlyStrong?: boolean; // Solo señales fuertes (>70)
  enableMid?: boolean; // Boost medio canal (lateral)
  requireCandleConfirmation?: boolean; // Requerir confirmación de vela anterior
  requireMomentumForCall?: boolean; // Requerir momentum positivo para CALL
  
  // Simulación
  expiryBars?: number; // Expiry en barras (default: 2)
  payoutPct?: number; // Payout % en wins (default: 80)
  
  // Configuración técnica
  candlePeriod?: number; // Período de vela en segundos (default: 60 = 1min)
  minCandles?: number; // Mínimo de velas necesarias
  disableWarmup?: boolean;
  
  // Filtro de horarios
  enableTimeFilter?: boolean; // Habilitar filtro de horarios óptimos
  optimalHours?: {
    start?: number; // Hora UTC de inicio (default: 8)
    end?: number; // Hora UTC de fin (default: 18)
    avoidAsiaForJPY?: boolean; // Evitar 0-6 UTC para pares JPY (default: true)
  };
}

/**
 * Vdubus BinaryPro Strategy
 */
export class VdubusBinaryProStrategy extends BaseStrategy {
  // Parámetros de Canal
  private readonly UPPER_CHANNEL_LENGTH: number;
  private readonly LOWER_CHANNEL_LENGTH: number;
  
  // MA50
  private readonly MA50_PERIOD: number;
  
  // Bollinger Bands
  private readonly BB_LENGTH: number;
  private readonly BB_MULTIPLIER: number;
  
  // RSI
  private readonly RSI_LENGTH: number;
  private readonly RSI_OVERSOLD: number;
  private readonly RSI_OVERBOUGHT: number;
  
  // Divergencia
  private readonly DIVERGENCE_LOOKBACK: number;
  private readonly USE_DIVERGENCE: boolean;
  
  // Tendencia
  private readonly USE_TREND_FILTER: boolean;
  private readonly TREND_SENSITIVITY: number;
  
  // Señales
  private readonly TOLERANCE: number;
  private readonly ENABLE_DYNAMIC_TOLERANCE: boolean;
  private readonly MIN_BARS_BETWEEN_SIGNALS: number;
  private readonly MIN_SCORE: number;
  private readonly MIN_SCORE_CALL: number;
  private readonly ENABLE_DYNAMIC_MIN_SCORE_CALL: boolean;
  private readonly ONLY_STRONG: boolean;
  private readonly ENABLE_MID: boolean;
  private readonly REQUIRE_CANDLE_CONFIRMATION: boolean;
  private readonly REQUIRE_MOMENTUM_FOR_CALL: boolean;
  
  // Simulación
  private readonly EXPIRY_BARS: number;
  // private readonly PAYOUT_PCT: number; // No usado actualmente
  
  // Configuración técnica
  private readonly CANDLE_PERIOD: number;
  private readonly MIN_CANDLES: number;
  private readonly DISABLE_WARMUP: boolean;
  
  // Filtro de horarios
  private readonly ENABLE_TIME_FILTER: boolean;
  private readonly OPTIMAL_HOURS_START: number;
  private readonly OPTIMAL_HOURS_END: number;
  private readonly AVOID_ASIA_FOR_JPY: boolean;
  
  // Estado interno
  private lastCandleTimestamp = new Map<string, number>();
  private lastSignalBarIndex = new Map<string, number>();
  private strategyStartTime: number = 0;
  private warmUpLogged = new Set<string>();
  
  constructor(config: VdubusConfig) {
    super(config);
    
    // Inicializar parámetros con defaults del Pine Script
    this.UPPER_CHANNEL_LENGTH = config.upperChannelLength ?? 20;
    this.LOWER_CHANNEL_LENGTH = config.lowerChannelLength ?? 20;
    this.MA50_PERIOD = config.ma50Period ?? 50;
    this.BB_LENGTH = config.bbLength ?? 20;
    this.BB_MULTIPLIER = config.bbMultiplier ?? 1.5;
    this.RSI_LENGTH = config.rsiLength ?? 14;
    this.RSI_OVERSOLD = config.rsiOversold ?? 30;
    this.RSI_OVERBOUGHT = config.rsiOverbought ?? 70;
    this.DIVERGENCE_LOOKBACK = config.divergenceLookback ?? 5;
    this.USE_DIVERGENCE = config.useDivergence ?? true;
    this.USE_TREND_FILTER = config.useTrendFilter ?? false;
    this.TREND_SENSITIVITY = config.trendSensitivity ?? 0.02;
    this.TOLERANCE = config.tolerance ?? 0.008;
    this.ENABLE_DYNAMIC_TOLERANCE = config.enableDynamicTolerance ?? false;
    this.MIN_BARS_BETWEEN_SIGNALS = config.minBarsBetweenSignals ?? 3;
    this.MIN_SCORE = config.minScore ?? 30;
    this.MIN_SCORE_CALL = config.minScoreCall ?? 40;
    this.ENABLE_DYNAMIC_MIN_SCORE_CALL = config.enableDynamicMinScoreCall ?? false;
    this.ONLY_STRONG = config.onlyStrong ?? false;
    this.ENABLE_MID = config.enableMid ?? true;
    this.REQUIRE_CANDLE_CONFIRMATION = config.requireCandleConfirmation ?? true;
    this.REQUIRE_MOMENTUM_FOR_CALL = config.requireMomentumForCall ?? true;
    this.EXPIRY_BARS = config.expiryBars ?? 2;
    // this.PAYOUT_PCT = config.payoutPct ?? 80; // No usado actualmente
    this.CANDLE_PERIOD = config.candlePeriod ?? 60;
    this.MIN_CANDLES = config.minCandles ?? 100;
    this.DISABLE_WARMUP = config.disableWarmup ?? false;
    
    // Filtro de horarios
    this.ENABLE_TIME_FILTER = config.enableTimeFilter ?? false;
    this.OPTIMAL_HOURS_START = config.optimalHours?.start ?? 8;
    this.OPTIMAL_HOURS_END = config.optimalHours?.end ?? 18;
    this.AVOID_ASIA_FOR_JPY = config.optimalHours?.avoidAsiaForJPY ?? true;
  }
  
  /**
   * Called when strategy starts
   */
  protected override async onStart(): Promise<void> {
    this.strategyStartTime = Date.now();
    console.log(`🔥 ${this.config.name} inicializada`);
    console.log(`📊 Score mínimo: ${this.MIN_SCORE} | Timeframe: ${this.CANDLE_PERIOD / 60}min`);
    if (!this.DISABLE_WARMUP) {
      console.log(`⏳ Warm-up: 1 minuto`);
    }
  }
  
  /**
   * Called when a candle closes - main strategy logic
   */
  protected async onCandle(candle: Candle, context: StrategyContext): Promise<Signal | null> {
    const asset = candle.asset;
    
    // Warm-up check
    if (!this.DISABLE_WARMUP) {
      const timeSinceStart = Date.now() - this.strategyStartTime;
      if (timeSinceStart < 60000) {
        if (!this.warmUpLogged.has(asset)) {
          const remaining = Math.round((60000 - timeSinceStart) / 1000);
          console.log(`⏳ [Vdubus] Warm-up: ${asset} - ${remaining}s remaining`);
          this.warmUpLogged.add(asset);
        }
        return null;
      }
    }
    
    // Filtro de horarios
    if (this.ENABLE_TIME_FILTER) {
      if (!this.isOptimalTradingTime(asset, candle.timestamp * 1000)) {
        if (Math.random() < 0.01) {
          console.log(`⏰ [Vdubus] Time filter blocked: ${asset}`);
        }
        return null;
      }
    }
    
    // Obtener velas
    const candles = context.candles;
    if (!candles || candles.length < this.MIN_CANDLES) {
      if (Math.random() < 0.01) {
        console.log(`📊 [Vdubus] Insufficient candles: ${asset} - ${candles?.length || 0}/${this.MIN_CANDLES}`);
      }
      return null;
    }
    
    // Evitar múltiples señales en la misma vela
    const currentCandle = candles[candles.length - 1];
    if (!currentCandle) return null;
    
    const lastTimestamp = this.lastCandleTimestamp.get(asset);
    if (lastTimestamp === currentCandle.timestamp) {
      return null;
    }
    
    // Calcular indicadores
    const indicators = this.calculateIndicators(candles);
    if (!indicators) return null;
    
    const {
      upper, lower, basis, ma50, bbUpper, bbLower, rsi,
      chPos, trend, slope, bullDiv, bearDiv, bbWidth, avgBBWidth
    } = indicators;
    
    const close = currentCandle.close;
    const high = currentCandle.high;
    const low = currentCandle.low;
    const open = currentCandle.open;
    
    // Calcular tolerance dinámico
    let currentTolerance = this.TOLERANCE;
    if (this.ENABLE_DYNAMIC_TOLERANCE && avgBBWidth > 0) {
      const volRatio = bbWidth / avgBBWidth;
      if (volRatio > 1.2) {
        currentTolerance = this.TOLERANCE * 1.25;
      } else if (volRatio < 0.8) {
        currentTolerance = this.TOLERANCE * 0.75;
      }
    }
    
    // Calcular scores
    const callScore = this.calculateCallScore({
      close, high, low, open,
      upper, lower, basis, ma50, bbUpper, bbLower, rsi,
      chPos, trend, bullDiv
    }, candles, currentTolerance);
    
    const putScore = this.calculatePutScore({
      close, high, low, open,
      upper, lower, basis, ma50, bbUpper, bbLower, rsi,
      chPos, trend, bearDiv
    }, candles, currentTolerance);
    
    // Verificar condiciones base
    const callOk = !this.USE_TREND_FILTER || trend !== 'DOWN';
    const putOk = !this.USE_TREND_FILTER || trend !== 'UP';
    
    // Filtros adicionales para CALL
    let callAdditionalChecks = true;
    
    // 1. Score mínimo más alto para CALL
    let callMinScore = this.MIN_SCORE_CALL;
    if (this.ENABLE_DYNAMIC_MIN_SCORE_CALL) {
      if (slope > 0.01) {
        callMinScore = this.MIN_SCORE_CALL + 15;
      } else if (slope < -0.01) {
        callMinScore = Math.max(this.MIN_SCORE - 10, this.MIN_SCORE_CALL - 10);
      }
    }
    
    if (callScore < callMinScore) {
      callAdditionalChecks = false;
    }
    
    // 2. Confirmación de vela anterior
    if (this.REQUIRE_CANDLE_CONFIRMATION && candles.length >= 2) {
      const prevCandle = candles[candles.length - 2];
      if (prevCandle) {
        const priceChange = ((close - prevCandle.close) / prevCandle.close) * 100;
        const priceRising = priceChange > -0.01;
        if (!priceRising) {
          callAdditionalChecks = false;
        }
      }
    }
    
    // 3. Momentum positivo
    if (this.REQUIRE_MOMENTUM_FOR_CALL && candles.length >= 3) {
      const prevCandle = candles[candles.length - 2];
      if (prevCandle) {
        const momentumPositive = close >= prevCandle.close;
        if (!momentumPositive) {
          callAdditionalChecks = false;
        }
      }
    }
    
    // 4. Validación de posición en canal
    if (chPos > 60) {
      callAdditionalChecks = false;
    }
    
    const callSig = callScore >= callMinScore && callOk && callAdditionalChecks;
    const putSig = putScore >= this.MIN_SCORE && putOk;
    
    const callStrong = callSig && callScore >= 70;
    const putStrong = putSig && putScore >= 70;
    
    // Aplicar filtro de solo fuertes
    const finalCallSig = this.ONLY_STRONG ? callStrong : callSig;
    const finalPutSig = this.ONLY_STRONG ? putStrong : putSig;
    
    // Filtro anti-repetición
    const currentBarIndex = candles.length - 1;
    const lastSignalBar = this.lastSignalBarIndex.get(asset) ?? -999;
    const barsSinceLastSignal = currentBarIndex - lastSignalBar;
    
    // Generar señal CALL
    if (finalCallSig && barsSinceLastSignal >= this.MIN_BARS_BETWEEN_SIGNALS) {
      console.log(`✅ [Vdubus] CALL signal: ${asset} | Score: ${callScore}/${callMinScore} | RSI: ${rsi.toFixed(1)} | chPos: ${chPos.toFixed(1)}`);
      this.lastCandleTimestamp.set(asset, currentCandle.timestamp);
      this.lastSignalBarIndex.set(asset, currentBarIndex);
      
      return this.createSignal('CALL', callScore, {
        rsi,
        ma50,
        chPos,
        slope,
        callScore,
        putScore,
        upper,
        lower,
        basis,
        bbUpper,
        bbLower,
        trend,
        isStrong: callStrong,
        bullDiv,
        duration: this.CANDLE_PERIOD * this.EXPIRY_BARS,
      });
    }
    
    // Generar señal PUT
    if (finalPutSig && barsSinceLastSignal >= this.MIN_BARS_BETWEEN_SIGNALS) {
      console.log(`✅ [Vdubus] PUT signal: ${asset} | Score: ${putScore}/${this.MIN_SCORE} | RSI: ${rsi.toFixed(1)} | chPos: ${chPos.toFixed(1)}`);
      this.lastCandleTimestamp.set(asset, currentCandle.timestamp);
      this.lastSignalBarIndex.set(asset, currentBarIndex);
      
      return this.createSignal('PUT', putScore, {
        rsi,
        ma50,
        chPos,
        slope,
        callScore,
        putScore,
        upper,
        lower,
        basis,
        bbUpper,
        bbLower,
        trend,
        isStrong: putStrong,
        bearDiv,
        duration: this.CANDLE_PERIOD * this.EXPIRY_BARS,
      });
    }
    
    return null;
  }
  
  /**
   * Get signal proximity (optional method for strategies that support it)
   */
  getSignalProximity(candles: Candle[]): SignalProximity | null {
    if (!candles || candles.length < this.MIN_CANDLES) {
      return null;
    }
    
    const indicators = this.calculateIndicators(candles);
    if (!indicators) return null;
    
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) return null;
    const { close, high, low, open, asset } = lastCandle;
    const { upper, lower, basis, ma50, bbUpper, bbLower, rsi, chPos, trend, bullDiv, bearDiv, slope, bbWidth, avgBBWidth } = indicators;
    
    // Calcular tolerance dinámico
    let currentTolerance = this.TOLERANCE;
    if (this.ENABLE_DYNAMIC_TOLERANCE && avgBBWidth > 0) {
      const volRatio = bbWidth / avgBBWidth;
      if (volRatio > 1.2) {
        currentTolerance = this.TOLERANCE * 1.25;
      } else if (volRatio < 0.8) {
        currentTolerance = this.TOLERANCE * 0.75;
      }
    }
    
    const callScore = this.calculateCallScore({
      close, high, low, open,
      upper, lower, basis, ma50, bbUpper, bbLower, rsi,
      chPos, trend, bullDiv
    }, candles, currentTolerance);
    
    const putScore = this.calculatePutScore({
      close, high, low, open,
      upper, lower, basis, ma50, bbUpper, bbLower, rsi,
      chPos, trend, bearDiv
    }, candles, currentTolerance);
    
    const callOk = !this.USE_TREND_FILTER || trend !== 'DOWN';
    const putOk = !this.USE_TREND_FILTER || trend !== 'UP';
    
    // Replicar filtros de analyze
    let callMinScore = this.MIN_SCORE_CALL;
    if (this.ENABLE_DYNAMIC_MIN_SCORE_CALL) {
      if (slope > 0.01) {
        callMinScore = this.MIN_SCORE_CALL + 15;
      } else if (slope < -0.01) {
        callMinScore = Math.max(this.MIN_SCORE - 10, this.MIN_SCORE_CALL - 10);
      }
    }
    
    let callAdditionalChecks = true;
    if (callScore < callMinScore) {
      callAdditionalChecks = false;
    }
    
    if (this.REQUIRE_CANDLE_CONFIRMATION && candles.length >= 2) {
      const prevCandle = candles[candles.length - 2];
      if (prevCandle) {
        const priceChange = ((close - prevCandle.close) / prevCandle.close) * 100;
        const priceRising = priceChange > -0.01;
        if (!priceRising) {
          callAdditionalChecks = false;
        }
      }
    }
    
    if (this.REQUIRE_MOMENTUM_FOR_CALL && candles.length >= 3) {
      const prevCandle = candles[candles.length - 2];
      if (prevCandle) {
        const momentumPositive = close >= prevCandle.close;
        if (!momentumPositive) {
          callAdditionalChecks = false;
        }
      }
    }
    
    if (chPos > 60) {
      callAdditionalChecks = false;
    }
    
    const callSig = callScore >= callMinScore && callOk && callAdditionalChecks;
    const putSig = putScore >= this.MIN_SCORE && putOk;
    
    const callStrong = callSig && callScore >= 70;
    const putStrong = putSig && putScore >= 70;
    
    const finalCallSig = this.ONLY_STRONG ? callStrong : callSig;
    const finalPutSig = this.ONLY_STRONG ? putStrong : putSig;
    
    const currentBarIndex = candles.length - 1;
    const lastSignalBar = this.lastSignalBarIndex.get(asset) ?? -999;
    const barsSinceLastSignal = currentBarIndex - lastSignalBar;
    const canSignal = barsSinceLastSignal >= this.MIN_BARS_BETWEEN_SIGNALS;
    
    const direction = callScore > putScore ? 'call' : putScore > callScore ? 'put' : 'neutral';
    
    let readyToSignal = false;
    if (direction === 'call') {
      readyToSignal = finalCallSig && canSignal;
    } else if (direction === 'put') {
      readyToSignal = finalPutSig && canSignal;
    }
    
    const minScoreForDirection = direction === 'call' ? callMinScore : this.MIN_SCORE;
    const currentScore = direction === 'call' ? callScore : putScore;
    
    let proximity: number;
    
    if (readyToSignal) {
      proximity = 100;
    } else {
      let scoreProximity = 0;
      if (currentScore < minScoreForDirection * 0.5) {
        scoreProximity = (currentScore / (minScoreForDirection * 0.5)) * 50;
      } else if (currentScore < minScoreForDirection) {
        const progress = (currentScore - minScoreForDirection * 0.5) / (minScoreForDirection * 0.5);
        scoreProximity = 50 + (progress * 30);
      } else {
        const excess = currentScore - minScoreForDirection;
        const maxReference = minScoreForDirection * 3;
        const maxExcess = maxReference - minScoreForDirection;
        const logExcess = Math.log1p(excess);
        const logMaxExcess = Math.log1p(maxExcess);
        const progress = Math.min(1, logExcess / logMaxExcess);
        scoreProximity = 80 + (progress * 15);
      }
      
      let filterPenalty = 0;
      
      if (direction === 'call') {
        if (!callAdditionalChecks) {
          filterPenalty += 20;
        }
        if (!canSignal) {
          filterPenalty += 15;
        }
        if (this.ONLY_STRONG && !callStrong) {
          filterPenalty += 10;
        }
      } else if (direction === 'put') {
        if (!canSignal) {
          filterPenalty += 15;
        }
        if (this.ONLY_STRONG && !putStrong) {
          filterPenalty += 10;
        }
      }
      
      proximity = Math.max(0, scoreProximity - filterPenalty);
    }
    
    proximity = Math.max(0, Math.min(100, Math.round(proximity)));
    
    const criteria = [
      {
        name: 'Score',
        current: currentScore,
        target: minScoreForDirection,
        unit: 'points',
        passed: currentScore >= minScoreForDirection,
        distance: Math.min(100, (currentScore / minScoreForDirection) * 100)
      },
      {
        name: 'RSI',
        current: rsi,
        target: direction === 'call' ? this.RSI_OVERSOLD : this.RSI_OVERBOUGHT,
        unit: '',
        passed: direction === 'call' ? rsi <= this.RSI_OVERSOLD : rsi >= this.RSI_OVERBOUGHT,
        distance: direction === 'call' 
          ? Math.max(0, 100 - ((rsi - this.RSI_OVERSOLD) / (this.RSI_OVERBOUGHT - this.RSI_OVERSOLD)) * 100)
          : Math.max(0, ((rsi - this.RSI_OVERSOLD) / (this.RSI_OVERBOUGHT - this.RSI_OVERSOLD)) * 100)
      },
      {
        name: 'Channel Position',
        current: chPos,
        target: direction === 'call' ? 30 : 70,
        unit: '%',
        passed: direction === 'call' ? chPos < 30 : chPos > 70,
        distance: direction === 'call'
          ? Math.max(0, 100 - ((chPos - 0) / 30) * 100)
          : Math.max(0, ((chPos - 70) / 30) * 100)
      }
    ];
    
    const missingCriteria = criteria
      .filter(c => !c.passed)
      .map(c => c.name);
    
    return {
      asset,
      direction,
      overallProximity: Math.round(proximity),
      criteria,
      readyToSignal,
      missingCriteria
    };
  }
  
  /**
   * Calcular todos los indicadores necesarios
   */
  private calculateIndicators(candles: Candle[]) {
    if (candles.length < this.MIN_CANDLES) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // 1. Canales (highest/lowest)
    const recentHighs = highs.slice(-this.UPPER_CHANNEL_LENGTH);
    const recentLows = lows.slice(-this.LOWER_CHANNEL_LENGTH);
    const upper = Math.max(...recentHighs);
    const lower = Math.min(...recentLows);
    const basis = (upper + lower) / 2;
    
    // 2. MA50
    const ma50 = new SMA(this.MA50_PERIOD);
    for (const close of closes) {
      ma50.update(close, false);
    }
    const ma50Value = ma50.getResult();
    if (!ma50Value) return null;
    const ma50_val = ma50Value.valueOf();
    
    // 3. Bollinger Bands sobre el basis
    const recentCloses = closes.slice(-this.BB_LENGTH);
    const closeMean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    const closeVariance = recentCloses.reduce((sum, val) => sum + Math.pow(val - closeMean, 2), 0) / recentCloses.length;
    const closeStdDev = Math.sqrt(closeVariance);
    const bbDev = this.BB_MULTIPLIER * closeStdDev;
    const bbUpper = basis + bbDev;
    const bbLower = basis - bbDev;
    const bbWidth = bbUpper - bbLower;
    
    // Calcular promedio de BB width
    let avgBBWidth = bbWidth;
    if (this.ENABLE_DYNAMIC_TOLERANCE && candles.length >= this.BB_LENGTH * 2) {
      const bbWidths: number[] = [];
      for (let i = this.BB_LENGTH; i < candles.length; i++) {
        const sliceCloses = closes.slice(i - this.BB_LENGTH, i);
        const sliceMean = sliceCloses.reduce((a, b) => a + b, 0) / sliceCloses.length;
        const sliceVariance = sliceCloses.reduce((sum, val) => sum + Math.pow(val - sliceMean, 2), 0) / sliceCloses.length;
        const sliceStdDev = Math.sqrt(sliceVariance);
        const sliceBBDev = this.BB_MULTIPLIER * sliceStdDev;
        const sliceBBWidth = sliceBBDev * 2;
        bbWidths.push(sliceBBWidth);
      }
      if (bbWidths.length > 0) {
        avgBBWidth = bbWidths.reduce((a, b) => a + b, 0) / bbWidths.length;
      }
    }
    
    // 4. RSI
    const rsi = new RSI(this.RSI_LENGTH);
    for (const close of closes) {
      rsi.update(close, false);
    }
    const rsiValue = rsi.getResult();
    if (!rsiValue) return null;
    const rsi_val = rsiValue.valueOf();
    
    // 5. Tendencia (slope de MA50)
    const ma50_10bars = new SMA(this.MA50_PERIOD);
    const closes10bars = closes.slice(0, Math.max(0, closes.length - 10));
    for (const close of closes10bars) {
      ma50_10bars.update(close, false);
    }
    const ma50_10barsValue = ma50_10bars.getResult();
    const ma50_10bars_val = ma50_10barsValue?.valueOf() ?? ma50_val;
    
    const slope = ((ma50_val - ma50_10bars_val) / ma50_10bars_val) * 100;
    const trend: 'UP' | 'DOWN' | 'LAT' = slope > this.TREND_SENSITIVITY ? 'UP' : 
                 slope < -this.TREND_SENSITIVITY ? 'DOWN' : 'LAT';
    
    // 6. Posición en canal
    const currentClose = closes[closes.length - 1];
    if (currentClose === undefined) return null;
    const chPos = upper !== lower ? ((currentClose - lower) / (upper - lower)) * 100 : 50;
    
    // 7. Divergencias
    let bullDiv = false;
    let bearDiv = false;
    
    if (this.USE_DIVERGENCE && candles.length >= this.DIVERGENCE_LOOKBACK + 2) {
      const rsiValues: number[] = [];
      for (let i = 0; i < candles.length; i++) {
        const rsiCalc = new RSI(this.RSI_LENGTH);
        const closesUpToI = closes.slice(0, i + 1);
        for (const close of closesUpToI) {
          rsiCalc.update(close, false);
        }
        const rsiResult = rsiCalc.getResult();
        if (rsiResult) {
          rsiValues.push(rsiResult.valueOf());
        } else {
          rsiValues.push(50);
        }
      }
      
      const currentLow = Math.min(...lows.slice(-this.DIVERGENCE_LOOKBACK));
      const previousLowestLow = Math.min(...lows.slice(-this.DIVERGENCE_LOOKBACK * 2 - 1, -this.DIVERGENCE_LOOKBACK - 1));
      const currentRsi = rsiValues[rsiValues.length - 1];
      if (currentRsi !== undefined) {
        const previousLowestRsi = Math.min(...rsiValues.slice(-this.DIVERGENCE_LOOKBACK * 2 - 1, -this.DIVERGENCE_LOOKBACK - 1));
        
        bullDiv = currentLow < previousLowestLow && currentRsi > previousLowestRsi;
        
        const currentHigh = Math.max(...highs.slice(-this.DIVERGENCE_LOOKBACK));
        const previousHighestHigh = Math.max(...highs.slice(-this.DIVERGENCE_LOOKBACK * 2 - 1, -this.DIVERGENCE_LOOKBACK - 1));
        const previousHighestRsi = Math.max(...rsiValues.slice(-this.DIVERGENCE_LOOKBACK * 2 - 1, -this.DIVERGENCE_LOOKBACK - 1));
        
        bearDiv = currentHigh > previousHighestHigh && currentRsi < previousHighestRsi;
      }
    }
    
    return {
      upper,
      lower,
      basis,
      ma50: ma50_val,
      bbUpper,
      bbLower,
      rsi: rsi_val,
      chPos,
      trend,
      slope,
      bullDiv,
      bearDiv,
      bbWidth,
      avgBBWidth
    };
  }
  
  /**
   * Calcular score para señal CALL
   */
  private calculateCallScore(data: {
    close: number;
    high: number;
    low: number;
    open: number;
    upper: number;
    lower: number;
    basis: number;
    ma50: number;
    bbUpper: number;
    bbLower: number;
    rsi: number;
    chPos: number;
    trend: 'UP' | 'DOWN' | 'LAT';
    bullDiv: boolean;
  }, candles: Candle[], tolerance?: number): number {
    let score = 0;
    const currentTolerance = tolerance ?? this.TOLERANCE;
    
    const distLCh = Math.abs(data.close - data.lower) / data.close * 100;
    const distLBb = Math.abs(data.close - data.bbLower) / data.close * 100;
    const nearLCh = distLCh <= currentTolerance * 100;
    const nearLBb = distLBb <= currentTolerance * 100;
    const touchL = data.low <= data.lower || data.low <= data.bbLower;
    
    const bullC = data.close > data.open;
    let bullRev = false;
    if (candles.length >= 2) {
      const prevCandle = candles[candles.length - 2];
      if (prevCandle) {
        bullRev = bullC && data.low <= prevCandle.low && data.close > prevCandle.close;
      }
    }
    const rsiCall = data.rsi <= this.RSI_OVERSOLD;
    
    if (touchL) {
      score += 50;
    } else if (nearLCh) {
      score += 35;
    }
    
    if (nearLBb) {
      score += 25;
    }
    
    if (bullC) {
      score += 15;
    }
    
    if (bullRev) {
      score += 20;
    }
    
    if (rsiCall) {
      score += 20;
    }
    
    if (data.chPos < 30) {
      score += 10;
    }
    
    if (this.ENABLE_MID && data.trend === 'LAT' && data.chPos < 50) {
      score += 15;
    }
    
    if (data.bullDiv) {
      score += 20;
    }
    
    if (this.USE_TREND_FILTER && data.trend === 'DOWN') {
      score -= 20;
    }
    
    return Math.max(0, score);
  }
  
  /**
   * Calcular score para señal PUT
   */
  private calculatePutScore(data: {
    close: number;
    high: number;
    low: number;
    open: number;
    upper: number;
    lower: number;
    basis: number;
    ma50: number;
    bbUpper: number;
    bbLower: number;
    rsi: number;
    chPos: number;
    trend: 'UP' | 'DOWN' | 'LAT';
    bearDiv: boolean;
  }, candles: Candle[], tolerance?: number): number {
    let score = 0;
    const currentTolerance = tolerance ?? this.TOLERANCE;
    
    const distUCh = Math.abs(data.upper - data.close) / data.close * 100;
    const distUBb = Math.abs(data.bbUpper - data.close) / data.close * 100;
    const nearUCh = distUCh <= currentTolerance * 100;
    const nearUBb = distUBb <= currentTolerance * 100;
    const touchU = data.high >= data.upper || data.high >= data.bbUpper;
    
    const bearC = data.close < data.open;
    let bearRev = false;
    if (candles.length >= 2) {
      const prevCandle = candles[candles.length - 2];
      if (prevCandle) {
        bearRev = bearC && data.high >= prevCandle.high && data.close < prevCandle.close;
      }
    }
    const rsiPut = data.rsi >= this.RSI_OVERBOUGHT;
    
    if (touchU) {
      score += 50;
    } else if (nearUCh) {
      score += 35;
    }
    
    if (nearUBb) {
      score += 25;
    }
    
    if (bearC) {
      score += 15;
    }
    
    if (bearRev) {
      score += 20;
    }
    
    if (rsiPut) {
      score += 20;
    }
    
    if (data.chPos > 70) {
      score += 10;
    }
    
    if (this.ENABLE_MID && data.trend === 'LAT' && data.chPos > 50) {
      score += 15;
    }
    
    if (data.bearDiv) {
      score += 20;
    }
    
    if (this.USE_TREND_FILTER && data.trend === 'UP') {
      score -= 20;
    }
    
    return Math.max(0, score);
  }
  
  /**
   * Verificar si es un horario óptimo para operar
   */
  private isOptimalTradingTime(asset: string, timestamp: number): boolean {
    const date = new Date(timestamp);
    const utcHour = date.getUTCHours();
    
    const isJPYPair = asset.includes('JPY');
    
    if (isJPYPair && this.AVOID_ASIA_FOR_JPY) {
      if (utcHour >= 0 && utcHour < 6) {
        return false;
      }
    }
    
    if (utcHour >= this.OPTIMAL_HOURS_START && utcHour < this.OPTIMAL_HOURS_END) {
      return true;
    }
    
    return false;
  }
}

