# 🎯 Multi-Timeframe Analysis - Diseño

**Objetivo**: Mejorar Win Rate usando confirmación de timeframe superior

---

## 📊 CONCEPTO

### Problema Actual:
Analizamos en **1 solo timeframe** (5min), lo que causa:
- Señales falsas por ruido de mercado
- No vemos el contexto más amplio
- No sabemos si la reversión es sostenible

### Solución Multi-Timeframe:
Analizar en **múltiples timeframes** simultáneamente:
1. **Timeframe Alto (15min)**: Contexto general, tendencia macro
2. **Timeframe Medio (5min)**: Señales de trading, reversiones
3. **Timeframe Bajo (1min)**: Timing exacto de entrada

---

## 🏗️ ARQUITECTURA

### Flujo de Decisión:

```
1. ANÁLISIS EN 15MIN (Contexto)
   ↓
   ¿Hay tendencia fuerte? → NO → Continuar
                          → SÍ → Skip (no tradear contra tendencia)
   ↓
   ¿RSI está en rango extremo? → SÍ → Continuar
                                → NO → Skip
   ↓
2. ANÁLISIS EN 5MIN (Señal)
   ↓
   ¿RSI oversold/overbought? → SÍ → Continuar
                              → NO → Skip
   ↓
   ¿Precio en Bollinger Band? → SÍ → Continuar
                               → NO → Skip
   ↓
3. CONFIRMACIÓN EN 1MIN (Timing)
   ↓
   ¿Momentum girando? → SÍ → TRADE!
                      → NO → Wait
```

---

## 📈 ESTRATEGIA MULTI-TIMEFRAME

### Timeframe 15min (Contexto):
**Propósito**: Evitar tradear contra tendencia fuerte

```typescript
// 1. Detectar tendencia en 15min
const sma50_15m = calculateSMA(candles15m, 50);
const price = candles15m[last].close;

// 2. Check si hay tendencia fuerte
if (price > sma50_15m * 1.02) {
    // Uptrend fuerte - solo CALL signals
    allowPUT = false;
} else if (price < sma50_15m * 0.98) {
    // Downtrend fuerte - solo PUT signals
    allowCALL = false;
}

// 3. RSI extremo en 15min (confirmación)
const rsi15m = calculateRSI(candles15m, 14);
if (rsi15m < 30 || rsi15m > 70) {
    // RSI extremo en timeframe alto - buen setup
    contextScore += 30;
}
```

### Timeframe 5min (Señal):
**Propósito**: Generar la señal principal

```typescript
// 1. RSI + Bollinger Bands (como antes)
const rsi5m = calculateRSI(candles5m, 14);
const bb5m = calculateBB(candles5m, 20, 2);

// 2. Señal de reversión
if (rsi5m < 20 && price < bb5m.lower) {
    signalScore += 40;
    signalType = 'CALL';
}

// 3. Debe estar alineado con contexto 15min
if (signalType === 'CALL' && !allowCALL) {
    return null; // Contra tendencia, skip
}
```

### Timeframe 1min (Timing):
**Propósito**: Timing exacto de entrada

```typescript
// 1. Momentum girando (confirmación final)
const momentum1m = calculateMomentum(candles1m, 5);

if (signalType === 'CALL' && momentum1m > 0) {
    // Momentum positivo - entrada ahora!
    timingScore += 20;
    return createSignal('CALL');
}

// 2. Esperar a que momentum gire
// Si momentum negativo, esperar siguiente vela
```

---

## 🎯 VENTAJAS DEL MULTI-TIMEFRAME

### 1. Mayor Win Rate
**Estimado: +5-10% WR**
- Evita señales contra tendencia
- Mejor contexto = mejores decisiones
- Confirmación múltiple

### 2. Menos Señales Falsas
- 3 niveles de filtrado
- Solo señales de alta calidad
- Reduce overtrading

### 3. Mejor Timing
- Entrada exacta en 1min
- Evita entrar demasiado temprano/tarde
- Mejor risk/reward

### 4. Más Robusto
- Menos sensible al ruido
- Funciona en múltiples condiciones
- Menos overfitting

---

## 🔧 IMPLEMENTACIÓN TÉCNICA

### Opción 1: Agregar Velas (Recomendado)
**Ventaja**: Usa los mismos datos de 1min que ya tenemos

```typescript
// Convertir velas de 1min a 5min
function aggregateCandles(candles1m: Candle[], targetTimeframe: number): Candle[] {
    const candles5m: Candle[] = [];

    for (let i = 0; i < candles1m.length; i += targetTimeframe) {
        const chunk = candles1m.slice(i, i + targetTimeframe);

        candles5m.push({
            timestamp: chunk[0].timestamp,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((sum, c) => sum + c.volume, 0)
        });
    }

    return candles5m;
}

// Convertir 1min → 5min → 15min
const candles1m = historicalData['60'];  // 1min
const candles5m = aggregateCandles(candles1m, 5);   // 5min
const candles15m = aggregateCandles(candles5m, 3);  // 15min
```

### Opción 2: Descargar Datos Separados
**Ventaja**: Más preciso si Deriv API lo soporta

```typescript
// Descargar datos de múltiples timeframes
const data1m = await derivClient.getHistory('R_25', 60);    // 1min
const data5m = await derivClient.getHistory('R_25', 300);   // 5min
const data15m = await derivClient.getHistory('R_25', 900);  // 15min
```

---

## 📊 ESTRUCTURA DE DATOS

### Multi-Timeframe Context:

```typescript
interface MultiTimeframeContext {
    // Timeframe 15min
    tf15m: {
        candles: Candle[];
        rsi: number;
        sma50: number;
        trend: 'bullish' | 'bearish' | 'neutral';
        trendStrength: number;
    };

    // Timeframe 5min
    tf5m: {
        candles: Candle[];
        rsi: number;
        bb: { upper: number; middle: number; lower: number };
        signal: 'CALL' | 'PUT' | null;
    };

    // Timeframe 1min
    tf1m: {
        candles: Candle[];
        momentum: number;
        priceAction: 'bullish' | 'bearish' | 'neutral';
        readyToTrade: boolean;
    };

    // Alignment
    aligned: boolean;  // Todos los timeframes alineados
    score: number;     // Score agregado de todos los timeframes
}
```

---

## 🎯 SCORING SYSTEM MULTI-TIMEFRAME

### Distribución de Puntos (Total: 100):

```typescript
// Timeframe 15min - Contexto (30 puntos)
- Tendencia alineada: +15 puntos
- RSI extremo: +15 puntos

// Timeframe 5min - Señal (50 puntos)
- RSI oversold/overbought: +25 puntos
- Precio en BB extremo: +25 puntos

// Timeframe 1min - Timing (20 puntos)
- Momentum girando: +10 puntos
- Price action confirmación: +10 puntos

// Score mínimo para tradear: 70 puntos
```

---

## 🧪 EJEMPLO PRÁCTICO

### Setup CALL (Bullish Reversal):

```
📊 Timeframe 15min:
   SMA50: 1000
   Price: 980 (2% below SMA) ✅
   RSI: 35 (not extreme uptrend) ✅
   → Contexto OK para CALL

📊 Timeframe 5min:
   RSI: 18 (oversold) ✅
   BB Lower: 975
   Price: 973 (below lower band) ✅
   → Señal CALL generada

📊 Timeframe 1min:
   Last 3 candles: Bearish, Bearish, Bullish
   Momentum: +0.002 (turning positive) ✅
   Current candle: Bullish ✅
   → Timing perfecto!

🎯 RESULTADO:
   Score: 30 + 50 + 20 = 100
   Signal: CALL con 95% confidence
   Entry: Ahora!
```

---

## 📈 EXPECTED RESULTS

### Sin Multi-Timeframe (Actual):
- Win Rate: 53% (walk-forward)
- Trades: ~80 en 15 días
- ROI: -1.37%

### Con Multi-Timeframe (Esperado):
- Win Rate: **58-62%** (+5-9%)
- Trades: ~40-50 en 15 días (menos pero mejor calidad)
- ROI: **+5-10%**

### Por qué Mejora:
1. Filtra señales contra tendencia (-20% de señales falsas)
2. Mejor timing de entrada (+5% WR)
3. Contexto previene operaciones malas (+5% WR)

---

## 🚀 PLAN DE IMPLEMENTACIÓN

### Fase 1: Agregación de Velas (30 min)
1. Función para convertir 1min → 5min → 15min
2. Tests unitarios
3. Validar que las velas agregadas son correctas

### Fase 2: Indicadores Multi-Timeframe (45 min)
1. Calcular RSI, SMA, BB en cada timeframe
2. Detectar tendencia en 15min
3. Generar señal en 5min
4. Confirmar en 1min

### Fase 3: Estrategia Multi-Timeframe (1 hora)
1. Integrar los 3 timeframes
2. Sistema de scoring
3. Lógica de alineación

### Fase 4: Backtesting (30 min)
1. Backtest en 30 días
2. Walk-forward validation
3. Comparar con estrategia single-timeframe

### Tiempo Total Estimado: **2.5-3 horas**

---

## 🎯 MÉTRICAS DE ÉXITO

La estrategia multi-timeframe será considerada exitosa si:

✅ **Win Rate**: >55% en walk-forward (vs 53% actual)
✅ **ROI**: >+5% en 15 días testing (vs -1.37% actual)
✅ **Consistencia**: <8% diff entre windows (vs 10% actual)
✅ **Trades**: 30-60 por ventana (suficiente sample size)

---

## 📚 REFERENCIAS Y BEST PRACTICES

### Trading Wisdom:
> "The trend is your friend until the end"
>
> Nunca tradear contra la tendencia del timeframe superior

### Multi-Timeframe Rules:
1. **Always check higher timeframe first**
2. **Trade in direction of higher timeframe**
3. **Use lower timeframe for entry timing**
4. **Multiple confirmations = higher confidence**

---

¿Listo para empezar con la implementación? 🚀
