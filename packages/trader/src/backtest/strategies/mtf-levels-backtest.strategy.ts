/**
 * MTF Levels Strategy - Backtest Adapter
 *
 * Estrategia basada en niveles de timeframes mayores (5m, 15m).
 *
 * Concepto:
 * 1. Calcula swings de 5m y 15m usando los datos de 1m
 * 2. Cuando el precio en 1m toca un nivel de 5m/15m y rebota → entrada
 * 3. Solo opera en la dirección de la tendencia del timeframe mayor
 *
 * Ventajas:
 * - Filtra el ruido de 1m
 * - Opera en niveles importantes (no cualquier swing)
 * - Alineado con la tendencia mayor
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';

interface SwingLevel {
  price: number;
  type: 'high' | 'low';
  timestamp: number;
  strength: number; // 1 = 5m, 2 = 15m, 3 = both
}

interface MTFContext {
  trend5m: 'up' | 'down' | 'sideways';
  trend15m: 'up' | 'down' | 'sideways';
  levels: SwingLevel[];
  lastUpdate: number;
}

export interface MTFLevelsParams {
  // Timeframe multipliers (relative to 1m)
  tf5mBars: number;   // 5 bars of 1m = 1 bar of 5m
  tf15mBars: number;  // 15 bars of 1m = 1 bar of 15m

  // Swing detection
  swingDepth5m: number;   // Depth for 5m swings
  swingDepth15m: number;  // Depth for 15m swings

  // Level proximity
  levelTolerance: number;  // ATR multiplier for "near level"

  // Confirmation
  confirmationBars: number;
  confirmationMinMove: number; // ATR multiplier
  confirmationBarsPUT?: number; // Confirmation bars específico para PUT (más estricto)
  confirmationMinMoveAgainstTrend?: number; // Movimiento mínimo cuando vamos contra tendencia

  // Trend filter
  requireTrendAlignment: boolean;
  requireStrongLevelAgainstTrend?: boolean; // Requerir nivel strength >= 2 cuando vamos contra tendencia

  // Bollinger Bands filter
  requireBBBand?: boolean; // Requerir que precio esté en banda BB apropiada
  bbBandTolerance?: number; // Tolerancia para considerar "en banda" (0.0-1.0, default 0.1 = 10% del ancho de banda)

  // Recent price trend filter
  checkRecentPriceTrend?: boolean; // Verificar que precio no se esté moviendo en contra antes de entrar
  recentTrendBars?: number; // Número de velas a revisar (default 3)
  recentTrendThreshold?: number; // % de movimiento en contra para rechazar (default 0.1%)

  // Bounce strength filter
  minBounceStrength?: number; // Mínimo bounce strength (0.0-1.0, default 0.3 = 30% del rango de vela)

  // RSI filter
  avoidRSIMidRange?: boolean; // Evitar RSI 40-60 (zona neutral sin momentum claro)

  // Direction filter
  allowedDirection: 'both' | 'CALL' | 'PUT';  // Filter by direction

  // Risk management
  takeProfitPct: number;
  stopLossPct: number;
  cooldownBars: number;
  minCandles: number;
}

const DEFAULT_PARAMS: MTFLevelsParams = {
  tf5mBars: 5,
  tf15mBars: 15,

  swingDepth5m: 3,
  swingDepth15m: 3,

  levelTolerance: 0.5,  // 0.5 ATR from level

  confirmationBars: 1,          // Solo 1 vela de confirmación (era 2)
  confirmationMinMove: 0.2,     // 0.2 ATR (era 0.3)

  requireTrendAlignment: false, // NO filtrar por tendencia (base limpia)
  allowedDirection: 'both',     // Ambas direcciones

  takeProfitPct: 0.005,
  stopLossPct: 0.003,
  cooldownBars: 3,              // Cooldown bajo (era 10)
  minCandles: 100,
};

export class MTFLevelsBacktestStrategy implements BacktestableStrategy {
  readonly name = 'MTFLevels';
  readonly version = '1.0.0';

  private params: MTFLevelsParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  // MTF data cache
  private candles5m: Candle[] = [];
  private candles15m: Candle[] = [];
  private swings5m: SwingLevel[] = [];
  private swings15m: SwingLevel[] = [];
  private lastResampleIndex: number = -1;

  constructor(asset: string, customParams?: Partial<MTFLevelsParams>) {
    this.asset = asset;
    this.params = { ...DEFAULT_PARAMS, ...customParams };
  }

  requiredIndicators(): string[] {
    const indicators = ['rsi', 'atr', 'ema20'];
    // Agregar BB si el filtro está habilitado
    if (this.params.requireBBBand) {
      indicators.push('bbUpper', 'bbMiddle', 'bbLower');
    }
    return indicators;
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    // MEJORA 6: TP más ajustado cuando vamos contra tendencia (se aplicará dinámicamente)
    return {
      asset: this.asset,
      takeProfitPct: this.params.takeProfitPct,
      stopLossPct: this.params.stopLossPct,
      cooldownBars: this.params.cooldownBars,
      maxBarsInTrade: 25, // Reducir de 30 a 25 para cerrar trades que no avanzan
    };
  }

  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    if (currentIndex < this.params.minCandles) return null;

    // Cooldown check
    if (this.lastTradeIndex >= 0 && currentIndex - this.lastTradeIndex < this.params.cooldownBars) {
      return null;
    }

    const candle = candles[currentIndex]!;
    const atr = indicators.atr as number | undefined;
    const rsi = indicators.rsi as number | undefined;

    if (!atr || !rsi) return null;

    // Update MTF data periodically (every 5 bars to save computation)
    if (currentIndex - this.lastResampleIndex >= 5 || this.lastResampleIndex === -1) {
      this.updateMTFData(candles, currentIndex);
      this.lastResampleIndex = currentIndex;
    }

    // Get current context
    const context = this.getMTFContext(candles, currentIndex);
    if (!context) return null;

    // Find nearest level
    const price = candle.close;
    const nearestLevel = this.findNearestLevel(price, atr);

    if (!nearestLevel) return null;

    // Check if price touched level and is bouncing
    const signal = this.checkLevelBounce(candles, currentIndex, nearestLevel, atr, rsi, context, indicators);

    if (!signal) return null;

    this.lastTradeIndex = currentIndex;

    const snapshot: MarketSnapshot = {
      timestamp: candle.timestamp * 1000,
      candle: {
        index: currentIndex,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      },
      price,
      indicators: {
        ...indicators,
        nearestLevel: nearestLevel.price,
        levelType: nearestLevel.type,
        levelStrength: nearestLevel.strength,
        trend5m: context.trend5m,
        trend15m: context.trend15m,
      },
    };

    // MEJORA 6: TP más ajustado cuando vamos contra tendencia
    const againstTrend = 
      (signal.direction === 'CALL' && (snapshot.indicators.trend15m === 'down' || snapshot.indicators.trend5m === 'down')) ||
      (signal.direction === 'PUT' && (snapshot.indicators.trend15m === 'up' || snapshot.indicators.trend5m === 'up'));
    
    const tpPct = againstTrend 
      ? this.params.takeProfitPct * 0.8  // 20% más ajustado contra tendencia
      : this.params.takeProfitPct;

    return {
      timestamp: candle.timestamp,
      direction: signal.direction,
      price,
      confidence: signal.confidence,
      reason: signal.reason,
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot,
      suggestedTpPct: tpPct,
      suggestedSlPct: this.params.stopLossPct,
    };
  }

  /**
   * Resample 1m candles to higher timeframes
   */
  private resampleCandles(candles: Candle[], tfBars: number): Candle[] {
    const resampled: Candle[] = [];

    for (let i = 0; i <= candles.length - tfBars; i += tfBars) {
      const chunk = candles.slice(i, i + tfBars);
      if (chunk.length === 0) continue;

      resampled.push({
        timestamp: chunk[0]!.timestamp,
        open: chunk[0]!.open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1]!.close,
      });
    }

    return resampled;
  }

  /**
   * Detect swing points in candles
   */
  private detectSwings(candles: Candle[], depth: number, strength: number): SwingLevel[] {
    const swings: SwingLevel[] = [];

    for (let i = depth; i < candles.length - depth; i++) {
      const candle = candles[i]!;
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= depth; j++) {
        const left = candles[i - j]!;
        const right = candles[i + j]!;

        if (candle.high <= left.high || candle.high <= right.high) isHigh = false;
        if (candle.low >= left.low || candle.low >= right.low) isLow = false;
      }

      if (isHigh) {
        swings.push({
          price: candle.high,
          type: 'high',
          timestamp: candle.timestamp,
          strength,
        });
      } else if (isLow) {
        swings.push({
          price: candle.low,
          type: 'low',
          timestamp: candle.timestamp,
          strength,
        });
      }
    }

    return swings;
  }

  /**
   * Update MTF data (resample and detect swings)
   */
  private updateMTFData(candles: Candle[], currentIndex: number): void {
    const relevantCandles = candles.slice(0, currentIndex + 1);

    // Resample to 5m and 15m
    this.candles5m = this.resampleCandles(relevantCandles, this.params.tf5mBars);
    this.candles15m = this.resampleCandles(relevantCandles, this.params.tf15mBars);

    // Detect swings
    this.swings5m = this.detectSwings(this.candles5m, this.params.swingDepth5m, 1);
    this.swings15m = this.detectSwings(this.candles15m, this.params.swingDepth15m, 2);

    // Merge and enhance swings that appear in both timeframes
    this.mergeSwings();
  }

  /**
   * Merge swings from different timeframes
   * If a swing appears in both 5m and 15m (similar price), increase strength
   */
  private mergeSwings(): void {
    const tolerance = 0.002; // 0.2% price difference

    for (const s15 of this.swings15m) {
      for (const s5 of this.swings5m) {
        if (s5.type === s15.type) {
          const priceDiff = Math.abs(s5.price - s15.price) / s15.price;
          if (priceDiff < tolerance) {
            s5.strength = 3; // Both timeframes agree
            s15.strength = 3;
          }
        }
      }
    }
  }

  /**
   * Get current MTF context (trends and levels)
   */
  private getMTFContext(candles: Candle[], currentIndex: number): MTFContext | null {
    if (this.swings5m.length < 4 || this.swings15m.length < 4) {
      return null;
    }

    // Determine 5m trend
    const recent5mHighs = this.swings5m.filter(s => s.type === 'high').slice(-2);
    const recent5mLows = this.swings5m.filter(s => s.type === 'low').slice(-2);
    const trend5m = this.determineTrend(recent5mHighs, recent5mLows);

    // Determine 15m trend
    const recent15mHighs = this.swings15m.filter(s => s.type === 'high').slice(-2);
    const recent15mLows = this.swings15m.filter(s => s.type === 'low').slice(-2);
    const trend15m = this.determineTrend(recent15mHighs, recent15mLows);

    // Combine levels from both timeframes, keeping most recent
    const allLevels = [...this.swings5m.slice(-10), ...this.swings15m.slice(-6)];

    return {
      trend5m,
      trend15m,
      levels: allLevels,
      lastUpdate: currentIndex,
    };
  }

  /**
   * Determine trend from swing highs and lows
   */
  private determineTrend(highs: SwingLevel[], lows: SwingLevel[]): 'up' | 'down' | 'sideways' {
    if (highs.length < 2 || lows.length < 2) return 'sideways';

    const hh = highs[1]!.price > highs[0]!.price;
    const hl = lows[1]!.price > lows[0]!.price;
    const lh = highs[1]!.price < highs[0]!.price;
    const ll = lows[1]!.price < lows[0]!.price;

    if (hh && hl) return 'up';
    if (lh && ll) return 'down';
    if (hh || hl) return 'up';
    if (lh || ll) return 'down';

    return 'sideways';
  }

  /**
   * Find nearest swing level to current price
   */
  private findNearestLevel(price: number, atr: number): SwingLevel | null {
    const tolerance = atr * this.params.levelTolerance;
    let nearest: SwingLevel | null = null;
    let minDist = Infinity;

    // For scalping (high tolerance), check more recent levels
    const lookback5m = this.params.levelTolerance > 1.0 ? 20 : 10;
    const lookback15m = this.params.levelTolerance > 1.0 ? 12 : 6;

    // Check 5m levels first (more relevant for 1m trading)
    for (const level of [...this.swings5m.slice(-lookback5m), ...this.swings15m.slice(-lookback15m)]) {
      const dist = Math.abs(price - level.price);
      if (dist < tolerance && dist < minDist) {
        minDist = dist;
        nearest = level;
      }
    }

    return nearest;
  }

  /**
   * Check if price bounced off a level
   */
  private checkLevelBounce(
    candles: Candle[],
    currentIndex: number,
    level: SwingLevel,
    atr: number,
    rsi: number,
    context: MTFContext,
    indicators: IndicatorSnapshot
  ): { direction: 'CALL' | 'PUT'; confidence: number; reason: string } | null {
    const { confirmationBars, confirmationMinMove, requireTrendAlignment } = this.params;
    const candle = candles[currentIndex]!;

    // Determine expected bounce direction based on level type
    // Support (swing low) → expect CALL (bounce up)
    // Resistance (swing high) → expect PUT (bounce down)
    const expectedDirection: 'CALL' | 'PUT' = level.type === 'low' ? 'CALL' : 'PUT';

    // Check direction filter
    const { allowedDirection } = this.params;
    if (allowedDirection !== 'both' && allowedDirection !== expectedDirection) {
      return null; // Direction not allowed
    }

    // Check if going against trend
    const againstTrend = 
      (expectedDirection === 'CALL' && (context.trend15m === 'down' || context.trend5m === 'down')) ||
      (expectedDirection === 'PUT' && (context.trend15m === 'up' || context.trend5m === 'up'));

    // Check trend alignment if required
    if (requireTrendAlignment) {
      // For CALL, we want uptrend or sideways (not downtrend) in BOTH timeframes
      // For PUT, we want downtrend or sideways (not uptrend) in BOTH timeframes
      if (expectedDirection === 'CALL') {
        // Don't CALL if 15m is down OR 5m is down
        if (context.trend15m === 'down' || context.trend5m === 'down') {
          return null;
        }
      }
      if (expectedDirection === 'PUT') {
        // Don't PUT if 15m is up OR 5m is up
        if (context.trend15m === 'up' || context.trend5m === 'up') {
          return null;
        }
      }
    }

    // MEJORA 1: Requerir nivel más fuerte cuando vamos contra tendencia
    if (this.params.requireStrongLevelAgainstTrend && againstTrend) {
      if (level.strength < 2) {
        return null; // Solo niveles de 15m o ambos cuando vamos contra tendencia
      }
    }

    // Check if we actually touched the level recently
    // For scalping (high tolerance), use wider touch detection
    let touchedLevel = false;
    let actualTouchIndex = -1;
    const lookback = this.params.levelTolerance > 1.0 ? 8 : 5;
    const touchTolerance = this.params.levelTolerance > 1.0 ? 0.005 : 0.002; // 0.5% vs 0.2%
    
    for (let i = 0; i < lookback && currentIndex - i >= 0; i++) {
      const c = candles[currentIndex - i]!;
      if (level.type === 'low') {
        // For support, check if low touched level
        if (c.low <= level.price * (1 + touchTolerance)) {
          touchedLevel = true;
          actualTouchIndex = currentIndex - i;
          break;
        }
      } else {
        // For resistance, check if high touched level
        if (c.high >= level.price * (1 - touchTolerance)) {
          touchedLevel = true;
          actualTouchIndex = currentIndex - i;
          break;
        }
      }
    }

    if (!touchedLevel) return null;

    // MEJORA 9: Verificar que después de tocar el nivel, el precio realmente rebotó
    // No entrar si el precio sigue en la misma dirección después de tocar el nivel
    if (actualTouchIndex >= 0 && actualTouchIndex < currentIndex) {
      const touchCandle = candles[actualTouchIndex]!;
      const barsAfterTouch = currentIndex - actualTouchIndex;
      
      // Verificar las velas después del toque
      if (barsAfterTouch >= 2) {
        let movedAway = false;
        
        if (level.type === 'low' && expectedDirection === 'CALL') {
          // Para CALL en support, verificar que el precio subió después del toque
          const priceAfterTouch = candles[actualTouchIndex + 1]!.close;
          if (priceAfterTouch > touchCandle.low * 1.0005) { // Al menos 0.05% arriba
            movedAway = true;
          }
        } else if (level.type === 'high' && expectedDirection === 'PUT') {
          // Para PUT en resistance, verificar que el precio bajó después del toque
          const priceAfterTouch = candles[actualTouchIndex + 1]!.close;
          if (priceAfterTouch < touchCandle.high * 0.9995) { // Al menos 0.05% abajo
            movedAway = true;
          }
        }
        
        // Si el precio no se movió en la dirección esperada después del toque, no entrar
        if (!movedAway && barsAfterTouch >= 2) {
          return null; // No hubo bounce real después de tocar el nivel
        }
      }
    }

    // SOLUCIÓN 1: Verificar tendencia reciente del precio
    // No entrar si precio se movió en contra en las últimas velas
    if (this.params.checkRecentPriceTrend) {
      const recentBars = this.params.recentTrendBars || 3;
      const threshold = this.params.recentTrendThreshold || 0.1; // 0.1%
      
      if (currentIndex >= recentBars) {
        const startPrice = candles[currentIndex - recentBars]!.close;
        const currentPrice = candle.close;
        const priceChange = ((currentPrice - startPrice) / startPrice) * 100;
        
        // Para CALL, rechazar si precio bajó más del threshold
        if (expectedDirection === 'CALL' && priceChange < -threshold) {
          return null; // Precio bajando antes de entrada CALL
        }
        
        // Para PUT, rechazar si precio subió más del threshold
        if (expectedDirection === 'PUT' && priceChange > threshold) {
          return null; // Precio subiendo antes de entrada PUT
        }
      }
    }

    // MEJORA 7: Filtro de Bollinger Bands
    // CALL solo en banda baja, PUT solo en banda alta
    if (this.params.requireBBBand) {
      const bbUpper = indicators.bbUpper as number | undefined;
      const bbLower = indicators.bbLower as number | undefined;
      const bbMiddle = indicators.bbMiddle as number | undefined;

      if (bbUpper && bbLower && bbMiddle) {
        const bbWidth = bbUpper - bbLower;
        const tolerance = (this.params.bbBandTolerance || 0.1) * bbWidth; // Default 10% del ancho
        const currentPrice = candle.close;
        
        if (expectedDirection === 'CALL') {
          // Para CALL, precio debe estar cerca de la banda baja
          // Consideramos "en banda baja" si está dentro del tolerance% del ancho desde bbLower
          const distanceFromLower = currentPrice - bbLower;
          if (distanceFromLower > tolerance) {
            return null; // Precio no está en banda baja
          }
        } else if (expectedDirection === 'PUT') {
          // Para PUT, precio debe estar cerca de la banda alta
          // Consideramos "en banda alta" si está dentro del tolerance% del ancho desde bbUpper
          const distanceFromUpper = bbUpper - currentPrice;
          if (distanceFromUpper > tolerance) {
            return null; // Precio no está en banda alta
          }
        }
      } else {
        // Si no hay datos de BB, no entrar (requerimos BB)
        return null;
      }
    }

    // MEJORA 3: Usar confirmationBars específico para PUT si está configurado
    const barsToConfirm = (expectedDirection === 'PUT' && this.params.confirmationBarsPUT !== undefined)
      ? this.params.confirmationBarsPUT
      : confirmationBars;

    // MEJORA 4: Usar confirmationMinMove más alto cuando vamos contra tendencia
    const minMoveMultiplier = (againstTrend && this.params.confirmationMinMoveAgainstTrend !== undefined)
      ? this.params.confirmationMinMoveAgainstTrend
      : confirmationMinMove;
    const minMove = atr * minMoveMultiplier;

    // Check confirmation (bounce in expected direction)
    // Skip confirmation if confirmationBars is 0 (scalping mode)
    if (barsToConfirm > 0) {
      let confirmedBars = 0;
      let totalMove = 0;
      let strongBodyCount = 0; // MEJORA 5: Contar velas con cuerpo fuerte
      let bounceStrength = 0; // MEJORA 8: Fuerza del bounce

      // Verificar confirmación mirando hacia atrás desde currentIndex
      // La lógica original verificaba desde currentIndex - i hacia atrás
      for (let i = 1; i <= barsToConfirm && currentIndex - i >= 0; i++) {
        const bar = candles[currentIndex - i + 1]!;
        const prevBar = candles[currentIndex - i]!;

        // Check for bounce in expected direction
        if (expectedDirection === 'CALL' && bar.close > prevBar.close) {
          confirmedBars++;
          const move = bar.close - prevBar.close;
          totalMove += move;
          
          // MEJORA 8: Calcular fuerza del bounce (movimiento relativo al rango de la vela)
          const barRange = bar.high - bar.low;
          if (barRange > 0) {
            bounceStrength = Math.max(bounceStrength, move / barRange);
          }
          
          // MEJORA 5: Verificar cuerpo fuerte (cuerpo > 50% del rango) - solo si confirmationBarsPUT está configurado
          if (this.params.confirmationBarsPUT !== undefined) {
            const bodySize = Math.abs(bar.close - bar.open);
            if (barRange > 0 && bodySize / barRange > 0.5) {
              strongBodyCount++;
            }
          }
        } else if (expectedDirection === 'PUT' && bar.close < prevBar.close) {
          confirmedBars++;
          const move = prevBar.close - bar.close;
          totalMove += move;
          
          // MEJORA 8: Calcular fuerza del bounce
          const barRange = bar.high - bar.low;
          if (barRange > 0) {
            bounceStrength = Math.max(bounceStrength, move / barRange);
          }
          
          // MEJORA 5: Verificar cuerpo fuerte - solo si confirmationBarsPUT está configurado
          if (this.params.confirmationBarsPUT !== undefined) {
            const bodySize = Math.abs(bar.close - bar.open);
            if (barRange > 0 && bodySize / barRange > 0.5) {
              strongBodyCount++;
            }
          }
        }
      }

      // MEJORA 5: Require at least one strong body candle for PUT (solo si confirmationBarsPUT está configurado)
      if (expectedDirection === 'PUT' && this.params.confirmationBarsPUT !== undefined && strongBodyCount === 0 && barsToConfirm >= 2) {
        return null;
      }

      // MEJORA 8: Requerir bounce mínimo (configurable, default 30% del rango de la vela)
      // Esto evita entradas cuando el bounce es muy débil
      const minBounceStrength = this.params.minBounceStrength ?? 0.3;
      if (bounceStrength < minBounceStrength) {
        return null; // Bounce muy débil
      }

      if (confirmedBars < barsToConfirm || totalMove < minMove) {
        return null;
      }
    }

    // RSI filter: Evitar zona neutral (40-60) donde no hay momentum claro
    if (this.params.avoidRSIMidRange) {
      if (rsi >= 40 && rsi <= 60) {
        return null; // Zona neutral, evitar entradas
      }
    }

    // Calculate confidence based on level strength and trend alignment
    let confidence = 70;
    confidence += level.strength * 5; // +5 for 5m, +10 for 15m, +15 for both
    if (context.trend5m === (expectedDirection === 'CALL' ? 'up' : 'down')) confidence += 5;
    if (context.trend15m === (expectedDirection === 'CALL' ? 'up' : 'down')) confidence += 10;

    const levelTF = level.strength === 3 ? '5m+15m' : level.strength === 2 ? '15m' : '5m';
    const reason = `MTF Level ${expectedDirection}: Bounce from ${level.type === 'low' ? 'support' : 'resistance'} at ${level.price.toFixed(2)} (${levelTF}), trend 5m=${context.trend5m}, 15m=${context.trend15m}, RSI=${rsi.toFixed(1)}`;

    return {
      direction: expectedDirection,
      confidence: Math.min(confidence, 95),
      reason,
    };
  }

  reset(): void {
    this.lastTradeIndex = -1;
    this.candles5m = [];
    this.candles15m = [];
    this.swings5m = [];
    this.swings15m = [];
    this.lastResampleIndex = -1;
  }
}

/**
 * Factory function
 */
export function createMTFLevelsStrategy(
  asset: string,
  params?: Partial<MTFLevelsParams>
): MTFLevelsBacktestStrategy {
  return new MTFLevelsBacktestStrategy(asset, params);
}
