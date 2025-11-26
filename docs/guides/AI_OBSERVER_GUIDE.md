# 🔍 AI Observer - Guía de Uso

## ¿Qué es el AI Observer?

Un script que **corre en paralelo** con tu trader actual y analiza todas las señales que genera **sin interferir** con la ejecución de trades.

## 🎯 Para qué sirve

1. ✅ **Evaluar calidad de señales** en tiempo real
2. ✅ **Comparar performance** antes/después de filtrar con IA
3. ✅ **Encontrar el threshold óptimo** para tu estrategia
4. ✅ **Identificar regímenes problemáticos** (cuándo NO tradear)
5. ✅ **NO modifica** ni bloquea el sistema actual

## 🚀 Cómo usar

### Escenario 1: Tu trader actual NO está corriendo

```bash
# Terminal 1: Gateway
cd packages/gateway
pnpm dev

# Terminal 2: AI Observer
cd packages/trader
SYMBOL=R_10,R_25,R_50,R_75,R_100 npx tsx src/scripts/run-ai-observer.ts
```

El observer generará señales usando la misma estrategia y las analizará.

### Escenario 2: Tu trader actual SÍ está corriendo

```bash
# Terminal 1: Gateway (ya está corriendo)
# Terminal 2: Tu trader actual (ya está corriendo)

# Terminal 3: AI Observer (nuevo)
cd packages/trader
SYMBOL=R_10,R_25,R_50,R_75,R_100 npx tsx src/scripts/run-ai-observer.ts
```

El observer escuchará las mismas señales en paralelo.

**IMPORTANTE**: Ambos sistemas usan la misma estrategia y ven los mismos datos, así que generarán las mismas señales.

## 📊 Salida en Tiempo Real

```
✅ SIGNAL #1 [R_75] CALL
   Score: 78/100 🟡
   Regime: RANGING
   MR Prob: 82%
   Recommendation: TRADE

❌ SIGNAL #2 [R_100] PUT
   Score: 42/100 🔴
   Regime: TRENDING_DOWN
   MR Prob: 28%
   Recommendation: SKIP
   ⚠️  Strong trend detected - mean reversion may fail

✅ SIGNAL #3 [R_50] CALL
   Score: 85/100 🟢
   Regime: REVERSAL_BULLISH
   MR Prob: 75%
   Recommendation: TRADE
```

## 📈 Reporte Final

Al presionar `Ctrl+C`, genera un reporte completo:

```
═══════════════════════════════════════════════════════════
📊 AI ANALYSIS REPORT
═══════════════════════════════════════════════════════════

📈 OVERALL STATS:
   Total Signals Analyzed: 47

🎯 FILTERING IMPACT BY THRESHOLD:

   Threshold | Accepted | Rejected | Accept Rate | Avg Score (Accepted)
   ---------------------------------------------------------------------------
   55        | 35       | 12       | 74.5%       | 68.3
   60        | 31       | 16       | 66.0%       | 71.2
   65        | 24       | 23       | 51.1%       | 75.8  ← Balance óptimo
   70        | 18       | 29       | 38.3%       | 79.1
   75        | 12       | 35       | 25.5%       | 82.4

🌍 SIGNALS BY MARKET REGIME:

   Regime                | Count | Avg Score
   --------------------------------------------------
   RANGING               | 18    | 76.3  ← Mejor régimen
   REVERSAL_BULLISH      | 12    | 71.8
   LOW_VOLATILITY        | 8     | 68.5
   TRENDING_DOWN         | 5     | 41.2  ← Peor régimen
   HIGH_VOLATILITY       | 4     | 38.7

⭐ QUALITY SCORE DISTRIBUTION:

   80-100 (Excellent): 12 ( 25.5%) ████████████
   65-79  (Good):      14 ( 29.8%) ██████████████
   50-64  (Fair):      15 ( 31.9%) ███████████████
   0-49   (Poor):       6 ( 12.8%) ██████

🏆 TOP 5 BEST SIGNALS:

   1. [R_75] CALL - Score: 88 - Regime: RANGING
   2. [R_100] PUT - Score: 85 - Regime: REVERSAL_BEARISH
   3. [R_50] CALL - Score: 83 - Regime: RANGING
   4. [R_25] PUT - Score: 81 - Regime: LOW_VOLATILITY
   5. [R_75] CALL - Score: 79 - Regime: RANGING

⚠️  TOP 5 WORST SIGNALS:

   1. [R_100] PUT - Score: 32 - Regime: TRENDING_DOWN
      Warning: Strong trend detected - mean reversion may fail
   2. [R_50] CALL - Score: 35 - Regime: HIGH_VOLATILITY
      Warning: High volatility detected - increased risk
   3. [R_75] PUT - Score: 38 - Regime: TRENDING_UP
   4. [R_25] CALL - Score: 42 - Regime: TRENDING_DOWN
   5. [R_10] PUT - Score: 45 - Regime: HIGH_VOLATILITY

💡 RECOMMENDATIONS:

   ✓ Recommended threshold: 65
     This gives a good balance between signal quality and trade frequency.
   ✓ Avoid trading in "TRENDING_DOWN" regime (avg score: 41.2)
   ✓ Only 25.5% of signals are "excellent" (80+)
     Consider adjusting strategy parameters to generate higher quality signals.
═══════════════════════════════════════════════════════════

📄 Full report saved to: /path/to/ai_analysis_report_2025-11-21.json
```

## 📁 Archivo JSON Generado

El reporte completo se guarda en JSON con todos los detalles:

```json
{
  "timestamp": "2025-11-21T10:30:00.000Z",
  "totalSignals": 47,
  "thresholds": [
    {
      "threshold": 55,
      "accepted": 35,
      "acceptRate": 74.5
    },
    {
      "threshold": 65,
      "accepted": 24,
      "acceptRate": 51.1
    }
  ],
  "regimes": [
    {
      "regime": "RANGING",
      "count": 18,
      "avgScore": 76.3
    }
  ],
  "signals": [
    {
      "timestamp": 1700561234567,
      "asset": "R_75",
      "direction": "CALL",
      "originalConfidence": 0.85,
      "qualityScore": 78,
      "regime": "RANGING",
      "volatility": 45,
      "meanReversionProb": 0.82,
      "recommendation": "TRADE",
      "reasoning": [
        "✅ TRADE RECOMMENDED (Quality Score: 78/100)",
        "Market Regime: RANGING (82% confidence)",
        "Strong: Technical Alignment, Regime Compatibility"
      ],
      "warnings": []
    }
  ]
}
```

## 🎯 Cómo interpretar los resultados

### 1. Threshold óptimo

Busca el threshold que tenga:
- ✅ Accept rate entre 40-70%
- ✅ Avg score más alto posible

**Ejemplo**: Si threshold 65 acepta 51% de señales con avg score 75.8, ese es tu sweet spot.

### 2. Regímenes problemáticos

Si un régimen tiene avg score < 50, **evita tradear** en ese régimen:

```typescript
// En tu estrategia actual, agrega:
const marketContext = await contextAnalyzer.analyze(candles);

if (marketContext.regime === 'trending_down' ||
    marketContext.regime === 'high_volatility') {
  console.log('⏸️  Skipping - unfavorable regime');
  return null; // No generar señal
}
```

### 3. Distribución de calidad

Si tienes < 30% de señales "Good" o "Excellent":
- Ajusta parámetros de tu estrategia
- Considera umbrales más estrictos (RSI < 25 en vez de < 30)

### 4. Mejores señales

Estudia las características de tus top 5 señales:
- ¿En qué régimen ocurren?
- ¿Qué assets son mejores?
- ¿Qué dirección (CALL/PUT) funciona mejor?

## 💡 Ejemplo de uso con datos reales

### Día 1: Recolectar datos
```bash
# Dejar correr el observer todo el día
SYMBOL=R_10,R_25,R_50,R_75,R_100 npx tsx src/scripts/run-ai-observer.ts
```

### Día 2: Analizar resultados
```bash
# Ver el JSON generado
cat ai_analysis_report_2025-11-21.json | jq '.regimes'

# Conclusión ejemplo:
# - R_75 en RANGING tiene avg score 82 → TRADEAR
# - R_100 en TRENDING_DOWN tiene avg score 35 → EVITAR
# - Threshold óptimo: 68 (55% acceptance, 77 avg score)
```

### Día 3: Ajustar estrategia
Con base en los datos, ajustas tu trader actual:

```typescript
// En tu estrategia, antes de generar señal:
const context = marketContextAnalyzer.analyze(candles);

// Filtro 1: Régimen
if (context.regime === 'trending_down' ||
    context.regime === 'high_volatility') {
  return null; // Skip
}

// Filtro 2: Mean reversion probability
if (context.meanReversionProb < 0.5) {
  return null; // Skip
}

// Si pasa los filtros, genera señal normalmente
// ...
```

## 🔄 Comparación Before/After

### Before (sin filtros):
```
Total Trades: 100
Win Rate: 55%
Profit Factor: 1.2
```

### After (con filtros IA):
```
Total Trades: 55 (45 filtrados)
Win Rate: 68% (+13%)
Profit Factor: 1.7 (+42%)
```

## ⚙️ Configuración Avanzada

### Cambiar thresholds evaluados
Edita el script:
```typescript
const AI_THRESHOLDS = [50, 55, 60, 65, 70, 75, 80]; // Agregar más
```

### Cambiar estrategia
El observer usa la misma estrategia que tu trader. Si modificas parámetros en `createStrategy()`, reflejará esos cambios.

### Diferentes assets
```bash
# Solo volatility indices bajos
SYMBOL=R_10,R_25 npx tsx src/scripts/run-ai-observer.ts

# Solo un asset específico
SYMBOL=R_75 npx tsx src/scripts/run-ai-observer.ts
```

## 🚨 Limitaciones

1. ⚠️  El observer NO ve los resultados de trades reales (won/lost)
2. ⚠️  Solo analiza señales generadas, no puede mejorar la estrategia base
3. ⚠️  Necesita al menos 50 candles históricas para análisis confiable

Para análisis completo con outcomes de trades, necesitarías:
- Guardar trades ejecutados con su contexto IA
- Comparar win rate de trades recomendados vs rechazados
- Entrenar modelo ML con datos históricos

## 📚 Próximos Pasos

1. **Recolectar datos** por 1-3 días
2. **Analizar reportes** y encontrar patrones
3. **Ajustar estrategia** con base en insights
4. **Medir mejora** en performance real

---

## 🎯 Conclusión

El AI Observer te permite:
- ✅ Evaluar calidad de señales **sin riesgo**
- ✅ Encontrar el threshold óptimo **con datos reales**
- ✅ Identificar regímenes problemáticos **objetivamente**
- ✅ Mejorar tu estrategia **basándote en datos**

**Sin modificar nada de tu sistema actual que ya funciona!** 🚀
