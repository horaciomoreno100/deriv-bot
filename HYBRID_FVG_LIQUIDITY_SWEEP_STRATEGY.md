# Estrategia Híbrida: FVG + Liquidity Sweep

## Resumen Ejecutivo

Esta estrategia combina dos conceptos ICT (Inner Circle Trader) de alta probabilidad:
1. **Liquidity Sweep**: Detecta cuando el precio barre stops (liquidez) y revierte
2. **Fair Value Gap (FVG)**: Identifica zonas de entrada después del sweep

La confluencia de ambos conceptos aumenta significativamente la probabilidad de éxito.

---

## Fundamento Teórico

### ¿Por qué funciona?

1. **Las instituciones necesitan liquidez**: Para entrar/salir de posiciones grandes sin mover el mercado, el "smart money" empuja el precio hacia zonas donde hay stops acumulados.

2. **El sweep es la trampa**: Cuando el precio barre la liquidez (activa los stops), las instituciones están tomando la contrapartida de esos stops para llenar sus órdenes.

3. **El FVG marca la dirección**: Después del sweep, el impulso deja un FVG que actúa como "imán" para el precio cuando retrace.

4. **Entry en el FVG post-sweep**: Cuando el precio vuelve al FVG después de un liquidity sweep, tenemos alta confluencia de que el movimiento continuará.

---

## Conceptos Clave

### Liquidity (Liquidez)

**Definición**: Zonas donde hay múltiples highs o lows en un rango pequeño, donde típicamente se acumulan stop losses.

**Tipos**:
- **Buyside Liquidity (BSL)**: Stops de shorts encima de highs recientes → zona de compra para instituciones
- **Sellside Liquidity (SSL)**: Stops de longs debajo de lows recientes → zona de venta para instituciones

**Detección**:
```typescript
// Múltiples highs dentro de range_percent (ej: 1%)
// O múltiples lows dentro de range_percent

interface LiquidityZone {
  type: 1 | -1;        // 1 = bullish (SSL swept), -1 = bearish (BSL swept)
  level: number;       // Nivel de precio de la liquidez
  endIndex: number;    // Último índice del nivel de liquidez
  sweptIndex: number;  // Índice de la vela que barrió la liquidez
}
```

### Liquidity Sweep

**Definición**: Movimiento de precio que atraviesa una zona de liquidez y luego revierte.

**Características**:
- Precio rompe el nivel de liquidez (activa stops)
- Vela cierra de vuelta dentro del rango previo (rechazo)
- A diferencia del "Liquidity Run", el sweep REVIERTE

**Señales de un Sweep válido**:
1. Rompimiento de nivel de liquidez identificado
2. Retorno rápido (1-3 velas) por debajo/encima del nivel
3. Volumen elevado en el sweep (opcional pero confirma)
4. Forma de mecha larga (wick) o vela de reversión

### Fair Value Gap (FVG)

**Definición**: Gap de precio donde no hubo trading equilibrado entre compradores y vendedores.

**Detección**:
```typescript
// Bullish FVG: candle[i].low > candle[i-2].high
// El gap está entre candle[i-2].high (bottom) y candle[i].low (top)

// Bearish FVG: candle[i].high < candle[i-2].low
// El gap está entre candle[i].high (bottom) y candle[i-2].low (top)

interface FVG {
  type: 1 | -1;           // 1 = bullish, -1 = bearish
  top: number;            // Tope del gap
  bottom: number;         // Piso del gap
  midpoint: number;       // (top + bottom) / 2
  mitigatedIndex?: number; // Índice donde se llenó el gap
}
```

---

## Lógica de la Estrategia Híbrida

### Flujo de Decisión

```
┌─────────────────────────────────────────────────────────────────┐
│                    FASE 1: ANÁLISIS DE CONTEXTO                 │
├─────────────────────────────────────────────────────────────────┤
│ 1. Determinar estructura de mercado (HTF: 15m/1H)               │
│    - Bullish: HH + HL → buscar sweeps de SSL                    │
│    - Bearish: LH + LL → buscar sweeps de BSL                    │
│    - Ranging: esperar claridad                                  │
│                                                                 │
│ 2. Identificar zonas de liquidez                                │
│    - Equal highs/lows                                           │
│    - Previous session H/L                                       │
│    - Swing highs/lows                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASE 2: DETECTAR SWEEP                       │
├─────────────────────────────────────────────────────────────────┤
│ Monitorear en timeframe de ejecución (5m/1m):                   │
│                                                                 │
│ SSL Sweep (señal LONG):                                         │
│   - Precio rompe debajo de zona de liquidez                     │
│   - Precio cierra de vuelta encima del nivel                    │
│   - Estructura bullish en HTF confirma                          │
│                                                                 │
│ BSL Sweep (señal SHORT):                                        │
│   - Precio rompe encima de zona de liquidez                     │
│   - Precio cierra de vuelta debajo del nivel                    │
│   - Estructura bearish en HTF confirma                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASE 3: BUSCAR FVG                           │
├─────────────────────────────────────────────────────────────────┤
│ Después del sweep, buscar FVG formado en la dirección del trade:│
│                                                                 │
│ Para LONG (después de SSL sweep):                               │
│   - Buscar Bullish FVG formado en el impulso alcista            │
│   - El FVG debe estar DEBAJO del precio actual                  │
│                                                                 │
│ Para SHORT (después de BSL sweep):                              │
│   - Buscar Bearish FVG formado en el impulso bajista            │
│   - El FVG debe estar ENCIMA del precio actual                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASE 4: ENTRY                                │
├─────────────────────────────────────────────────────────────────┤
│ Esperar retrace al FVG:                                         │
│                                                                 │
│ LONG Entry:                                                     │
│   - Precio retrace al 50% (midpoint) del Bullish FVG            │
│   - Opcional: esperar vela de confirmación (rejection)          │
│   - Entry: en el midpoint o con limit order                     │
│                                                                 │
│ SHORT Entry:                                                    │
│   - Precio retrace al 50% (midpoint) del Bearish FVG            │
│   - Opcional: esperar vela de confirmación (rejection)          │
│   - Entry: en el midpoint o con limit order                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASE 5: RISK MANAGEMENT                      │
├─────────────────────────────────────────────────────────────────┤
│ Stop Loss:                                                      │
│   - LONG: debajo del sweep low (liquidez barrida) + buffer      │
│   - SHORT: encima del sweep high (liquidez barrida) + buffer    │
│                                                                 │
│ Take Profit (opciones):                                         │
│   - 1:2 R:R mínimo                                              │
│   - Próxima zona de liquidez opuesta                            │
│   - Previous session H/L                                        │
│   - Swing high/low previo                                       │
│                                                                 │
│ Trailing Stop (opcional):                                       │
│   - Mover SL a breakeven después de 1R                          │
│   - Trail con structure (swing points)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementación TypeScript

### Interfaces

```typescript
interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface SwingPoint {
  index: number;
  type: 'high' | 'low';
  level: number;
}

interface LiquidityZone {
  type: 'BSL' | 'SSL';    // Buyside o Sellside
  level: number;          // Nivel de precio
  startIndex: number;     // Inicio de la zona
  endIndex: number;       // Fin de la zona
  sweptIndex?: number;    // Índice donde fue swept
  sweptPrice?: number;    // Precio del sweep
}

interface FVG {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  midpoint: number;
  formationIndex: number;
  mitigatedIndex?: number;
  mitigatedPct?: number;  // Qué porcentaje fue mitigado
}

interface TradeSetup {
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  metadata: {
    sweepType: 'BSL' | 'SSL';
    sweepIndex: number;
    sweepLevel: number;
    fvgTop: number;
    fvgBottom: number;
    fvgMidpoint: number;
    riskRewardRatio: number;
  };
}

interface StrategyState {
  phase: 'SCANNING' | 'SWEEP_DETECTED' | 'WAITING_FVG' | 'WAITING_ENTRY';
  activeSweep?: {
    type: 'BSL' | 'SSL';
    level: number;
    sweepIndex: number;
    sweepLow?: number;   // Para SSL sweep
    sweepHigh?: number;  // Para BSL sweep
  };
  activeFVG?: FVG;
  expirationBars: number; // Cuántas velas hasta que expire el setup
}
```

### Parámetros de la Estrategia

```typescript
interface FVGLiquiditySweepParams {
  // Detección de Swing Points
  swingLength: number;           // 10-50, default: 20
  
  // Detección de Liquidez
  liquidityRangePct: number;     // 0.005-0.02, default: 0.01 (1%)
  minLiquidityTouches: number;   // 2-5, default: 2
  
  // Detección de Sweep
  sweepConfirmationBars: number; // 1-3 velas para confirmar reversa
  requireCloseBack: boolean;     // Requiere cierre de vuelta en el rango
  
  // Detección de FVG
  minFVGSizePct: number;         // 0.001-0.005, default: 0.001 (0.1%)
  maxFVGAgeBars: number;         // 50-200, default: 100
  
  // Entry
  fvgEntryZone: 'top' | 'midpoint' | 'bottom'; // default: 'midpoint'
  requireConfirmationCandle: boolean;          // default: true
  
  // Risk Management
  stopLossBufferPct: number;     // 0.001-0.003, buffer detrás del sweep
  takeProfitMultiple: number;    // 1.5-3.0, R:R ratio
  maxRiskPct: number;            // 0.01-0.02, max risk por trade
  
  // Timeouts
  sweepExpirationBars: number;   // Cuántas velas antes de que expire sweep
  setupExpirationBars: number;   // Cuántas velas antes de que expire setup
  
  // Filtros opcionales
  useHTFBias: boolean;           // Usar bias de timeframe mayor
  htfTrendPeriod: number;        // Período para determinar tendencia HTF
  useSessions: boolean;          // Solo operar en kill zones
}

// Valores sugeridos para diferentes assets
const GOLD_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 15,
  liquidityRangePct: 0.008,
  minFVGSizePct: 0.0015,
  stopLossBufferPct: 0.002,
  takeProfitMultiple: 2.0,
};

const SYNTHETIC_INDEX_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 20,
  liquidityRangePct: 0.01,
  minFVGSizePct: 0.001,
  stopLossBufferPct: 0.0015,
  takeProfitMultiple: 1.5,
};
```

### Funciones Core

```typescript
/**
 * Detecta swing highs y lows
 */
function detectSwingPoints(
  candles: Candle[],
  swingLength: number
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  
  for (let i = swingLength; i < candles.length - swingLength; i++) {
    // Check swing high
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = 1; j <= swingLength; j++) {
      if (candles[i].high <= candles[i - j].high || 
          candles[i].high <= candles[i + j].high) {
        isSwingHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || 
          candles[i].low >= candles[i + j].low) {
        isSwingLow = false;
      }
    }
    
    if (isSwingHigh) {
      swings.push({ index: i, type: 'high', level: candles[i].high });
    }
    if (isSwingLow) {
      swings.push({ index: i, type: 'low', level: candles[i].low });
    }
  }
  
  return swings;
}

/**
 * Detecta zonas de liquidez (múltiples highs o lows en rango pequeño)
 */
function detectLiquidityZones(
  candles: Candle[],
  swings: SwingPoint[],
  rangePct: number,
  minTouches: number
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  const priceRange = Math.max(...candles.map(c => c.high)) - 
                    Math.min(...candles.map(c => c.low));
  const tolerance = priceRange * rangePct;
  
  // Agrupar swing highs cercanos (BSL)
  const swingHighs = swings.filter(s => s.type === 'high');
  const groupedHighs = groupNearbyLevels(swingHighs, tolerance);
  
  for (const group of groupedHighs) {
    if (group.length >= minTouches) {
      const avgLevel = group.reduce((sum, s) => sum + s.level, 0) / group.length;
      zones.push({
        type: 'BSL',
        level: avgLevel,
        startIndex: Math.min(...group.map(s => s.index)),
        endIndex: Math.max(...group.map(s => s.index)),
      });
    }
  }
  
  // Agrupar swing lows cercanos (SSL)
  const swingLows = swings.filter(s => s.type === 'low');
  const groupedLows = groupNearbyLevels(swingLows, tolerance);
  
  for (const group of groupedLows) {
    if (group.length >= minTouches) {
      const avgLevel = group.reduce((sum, s) => sum + s.level, 0) / group.length;
      zones.push({
        type: 'SSL',
        level: avgLevel,
        startIndex: Math.min(...group.map(s => s.index)),
        endIndex: Math.max(...group.map(s => s.index)),
      });
    }
  }
  
  return zones;
}

/**
 * Detecta si hubo un liquidity sweep
 */
function detectLiquiditySweep(
  candles: Candle[],
  zones: LiquidityZone[],
  currentIndex: number,
  params: FVGLiquiditySweepParams
): { zone: LiquidityZone; sweepCandle: Candle } | null {
  const currentCandle = candles[currentIndex];
  
  for (const zone of zones) {
    // Skip zonas ya swept
    if (zone.sweptIndex !== undefined) continue;
    
    // Skip zonas demasiado viejas
    if (currentIndex - zone.endIndex > params.sweepExpirationBars) continue;
    
    if (zone.type === 'SSL') {
      // Sweep de sellside liquidity (señal LONG)
      // Precio debe haber roto debajo Y cerrado encima
      const brokeBelow = currentCandle.low < zone.level;
      const closedAbove = currentCandle.close > zone.level;
      
      if (brokeBelow && closedAbove) {
        return { zone, sweepCandle: currentCandle };
      }
    } else {
      // Sweep de buyside liquidity (señal SHORT)
      // Precio debe haber roto encima Y cerrado debajo
      const brokeAbove = currentCandle.high > zone.level;
      const closedBelow = currentCandle.close < zone.level;
      
      if (brokeAbove && closedBelow) {
        return { zone, sweepCandle: currentCandle };
      }
    }
  }
  
  return null;
}

/**
 * Detecta FVGs en las últimas N velas
 */
function detectFVGs(
  candles: Candle[],
  startIndex: number,
  endIndex: number,
  minSizePct: number
): FVG[] {
  const fvgs: FVG[] = [];
  
  for (let i = startIndex + 2; i <= endIndex; i++) {
    const prev2 = candles[i - 2];
    const current = candles[i];
    const avgPrice = (current.high + current.low) / 2;
    
    // Bullish FVG: gap entre prev2.high y current.low
    if (current.low > prev2.high) {
      const size = current.low - prev2.high;
      if (size / avgPrice >= minSizePct) {
        fvgs.push({
          type: 'bullish',
          top: current.low,
          bottom: prev2.high,
          midpoint: (current.low + prev2.high) / 2,
          formationIndex: i,
        });
      }
    }
    
    // Bearish FVG: gap entre current.high y prev2.low
    if (current.high < prev2.low) {
      const size = prev2.low - current.high;
      if (size / avgPrice >= minSizePct) {
        fvgs.push({
          type: 'bearish',
          top: prev2.low,
          bottom: current.high,
          midpoint: (prev2.low + current.high) / 2,
          formationIndex: i,
        });
      }
    }
  }
  
  return fvgs;
}

/**
 * Verifica si el precio entró en la zona del FVG
 */
function checkFVGEntry(
  candle: Candle,
  fvg: FVG,
  entryZone: 'top' | 'midpoint' | 'bottom'
): boolean {
  let entryLevel: number;
  
  switch (entryZone) {
    case 'top':
      entryLevel = fvg.top;
      break;
    case 'bottom':
      entryLevel = fvg.bottom;
      break;
    case 'midpoint':
    default:
      entryLevel = fvg.midpoint;
  }
  
  if (fvg.type === 'bullish') {
    // Para bullish FVG, el precio debe tocar/entrar desde arriba
    return candle.low <= entryLevel;
  } else {
    // Para bearish FVG, el precio debe tocar/entrar desde abajo
    return candle.high >= entryLevel;
  }
}

/**
 * Genera el setup de trade completo
 */
function generateTradeSetup(
  currentCandle: Candle,
  sweep: { zone: LiquidityZone; sweepCandle: Candle },
  fvg: FVG,
  params: FVGLiquiditySweepParams
): TradeSetup {
  const direction = sweep.zone.type === 'SSL' ? 'CALL' : 'PUT';
  const entryPrice = fvg.midpoint;
  
  let stopLoss: number;
  let takeProfit: number;
  
  if (direction === 'CALL') {
    // LONG: SL debajo del sweep low
    stopLoss = sweep.sweepCandle.low * (1 - params.stopLossBufferPct);
    const riskAmount = entryPrice - stopLoss;
    takeProfit = entryPrice + (riskAmount * params.takeProfitMultiple);
  } else {
    // SHORT: SL encima del sweep high
    stopLoss = sweep.sweepCandle.high * (1 + params.stopLossBufferPct);
    const riskAmount = stopLoss - entryPrice;
    takeProfit = entryPrice - (riskAmount * params.takeProfitMultiple);
  }
  
  const riskRewardRatio = Math.abs(takeProfit - entryPrice) / 
                          Math.abs(stopLoss - entryPrice);
  
  return {
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    confidence: calculateConfidence(sweep, fvg, params),
    metadata: {
      sweepType: sweep.zone.type,
      sweepIndex: sweep.sweepCandle.timestamp,
      sweepLevel: sweep.zone.level,
      fvgTop: fvg.top,
      fvgBottom: fvg.bottom,
      fvgMidpoint: fvg.midpoint,
      riskRewardRatio,
    },
  };
}
```

---

## Ejemplos de Setups

### Ejemplo 1: SSL Sweep + Bullish FVG (LONG)

```
Contexto: Tendencia alcista en HTF (15m)

1. SSL Detectada:
   - Múltiples lows en $1920.50 (oro)
   - Zona válida con 3 toques

2. Sweep Ocurre:
   - Vela rompe hasta $1919.80 (debajo de SSL)
   - Vela cierra en $1921.20 (encima de SSL) ✓
   - → SSL swept, señal LONG

3. FVG Formado:
   - Impulso alcista post-sweep
   - Bullish FVG: bottom $1921.50, top $1922.30
   - Midpoint: $1921.90

4. Entry:
   - Precio retrace a $1921.90 (midpoint)
   - Entry: CALL @ $1921.90
   - SL: $1919.50 (debajo del sweep low)
   - TP: $1924.70 (2:1 R:R)
```

### Ejemplo 2: BSL Sweep + Bearish FVG (SHORT)

```
Contexto: Tendencia bajista en HTF (15m)

1. BSL Detectada:
   - Equal highs en $1935.00
   - Zona válida con 2 toques

2. Sweep Ocurre:
   - Vela rompe hasta $1935.80 (encima de BSL)
   - Vela cierra en $1934.50 (debajo de BSL) ✓
   - → BSL swept, señal SHORT

3. FVG Formado:
   - Impulso bajista post-sweep
   - Bearish FVG: top $1934.20, bottom $1933.50
   - Midpoint: $1933.85

4. Entry:
   - Precio retrace a $1933.85 (midpoint)
   - Entry: PUT @ $1933.85
   - SL: $1936.10 (encima del sweep high)
   - TP: $1929.35 (2:1 R:R)
```

---

## Métricas Esperadas

Basado en la investigación de estrategias similares con confluencia FVG + Liquidity:

| Métrica | Objetivo Conservador | Objetivo Optimista |
|---------|---------------------|-------------------|
| Win Rate | 55-60% | 65-70% |
| Profit Factor | 1.5-1.8 | 2.0-2.5 |
| Risk:Reward | 1:1.5 mínimo | 1:2.5 |
| Max Drawdown | <15% | <10% |
| Trades/día | 2-5 | 5-10 |

---

## Filtros Adicionales (Opcionales)

### 1. Session Filter
Solo operar durante kill zones (London Open, NY Open):
- London Open: 07:00-10:00 UTC
- NY Open: 12:00-15:00 UTC
- London Close: 15:00-17:00 UTC

### 2. HTF Bias Filter
Confirmar dirección con timeframe mayor:
- Si 15m es bullish → solo tomar SSL sweeps (LONG)
- Si 15m es bearish → solo tomar BSL sweeps (SHORT)

### 3. RSI Confirmation
RSI en oversold/overbought alineado con el sweep:
- SSL sweep + RSI < 30 → LONG más fuerte
- BSL sweep + RSI > 70 → SHORT más fuerte

### 4. Volume Spike
Confirmar que hubo volumen elevado durante el sweep.

---

## Diferencias vs Estrategia FVG Simple

| Aspecto | FVG Simple | FVG + Liquidity Sweep |
|---------|-----------|----------------------|
| Trigger | Cualquier FVG | Solo FVG post-sweep |
| Contexto | Ninguno requerido | Requiere sweep previo |
| Stop Loss | Detrás del FVG | Detrás del sweep (más ajustado) |
| Probabilidad | Media | Alta (confluencia) |
| Trades | Muchos | Menos pero mejores |
| Filtro Institucional | No | Sí (sweep = actividad institucional) |

---

## Próximos Pasos

1. **Implementar en TypeScript** la clase `FVGLiquiditySweepStrategy`
2. **Backtest** con datos de oro (frxXAUUSD) y synthetic indices
3. **Optimizar parámetros** para cada asset
4. **Forward test** con 100-200 trades
5. **Integrar con sistema existente** como estrategia complementaria

---

## Referencias

- ICT (Inner Circle Trader) - Conceptos de Smart Money
- Paquete Python: `smartmoneyconcepts` (joshyattridge)
- Artículos: FluxCharts, Equiti, ATAS sobre Liquidity Sweeps