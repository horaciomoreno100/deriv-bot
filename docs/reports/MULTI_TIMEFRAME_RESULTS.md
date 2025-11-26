# 📊 Resultados: Multi-Timeframe Reversal Strategy

## 🎯 Objetivo Original
Mejorar Win Rate del 53% actual a 58-62% usando análisis multi-timeframe (15min contexto + 5min señal + 1min timing)

---

## 📈 RESULTADOS DEL BACKTEST

### Matriz Completa (30 días, 3 assets, 3 duraciones)

| Asset | Duration | Trades | WR%   | ROI%      | P&L    |
|-------|----------|--------|-------|-----------|--------|
| R_100 | 1min     | 488    | 52.0% | -61.60%   | -$616  |
| R_100 | 2min     | 334    | 47.3% | -99.20%   | -$992  |
| R_100 | 5min     | 332    | 47.3% | -98.80%   | -$988  |
| R_50  | 1min     | 455    | 49.5% | -100.00%  | -$1000 |
| **R_50**  | **2min**     | **555**    | **53.9%** | **-33.60%**   | **-$336**  |
| R_50  | 5min     | 555    | 52.4% | -62.40%   | -$624  |
| R_25  | 1min     | 717    | 51.7% | -98.40%   | -$984  |
| R_25  | 2min     | 509    | 50.1% | -100.00%  | -$1000 |
| R_25  | 5min     | 645    | 51.3% | -98.40%   | -$984  |

### Resumen por Asset

| Asset | Avg WR% | Best WR% | Worst WR% | Total Trades |
|-------|---------|----------|-----------|--------------|
| R_100 | 48.9%   | 52.0%    | 47.3%     | 1,154        |
| R_50  | 51.9%   | **53.9%**| 49.5%     | 1,565        |
| R_25  | 51.0%   | 51.7%    | 50.1%     | 1,871        |

### Resumen General

- **Win Rate Global**: 50.76% (vs 53% baseline)
- **Configuraciones Rentables**: 0/9 (0%)
- **Mejor Config**: R_50 + 2min → 53.9% WR
- **Peor Config**: R_100 + 2min/5min → 47.3% WR

---

## ❌ PROBLEMAS IDENTIFICADOS

### 1. Win Rate Inferior al Baseline
- **Esperado**: 58-62% WR
- **Obtenido**: 50.76% WR
- **Diferencia**: -2.24% vs baseline (53%)

### 2. Buffer Size Inicial Insuficiente
**Problema Original:**
- Con 200 velas de 1min → solo 13 velas de 15min
- RSI(14) necesita 15 velas → **RSI de 15min era null**
- SMA(50) necesita 50 velas → **SMA de 15min era null**

**Solución Aplicada:**
- Aumentamos buffer a 800 velas de 1min
- Esto da 53 velas de 15min (50 x 1.5 / 3 = 53)
- Ahora 15m RSI y SMA funcionan correctamente

### 3. Agregación de Velas vs Datos Nativos
Actualmente estamos **agregando velas**:
- 1min → 5min → 15min

**Limitaciones:**
- Posibles discrepancias en OHLC
- Timestamps no perfectamente alineados
- Volumen agregado puede no ser preciso

**Alternativa Sugerida:**
- Descargar datos nativos de 5min y 15min desde Deriv API
- Usar `granularity: 300` (5min) y `granularity: 900` (15min)

### 4. La Estrategia de Reversión Puede No Funcionar
El problema fundamental podría ser que **las reversiones RSI+BB no funcionan bien** en mercados sintéticos de Deriv:
- Los mercados sintéticos tienen características únicas
- Las reversiones pueden no ser tan predecibles
- Necesitamos probar estrategias trend-following

---

## ✅ ASPECTOS POSITIVOS

### 1. Una Configuración Supera al Baseline
- **R_50 + 2min**: 53.9% WR (vs 53% baseline)
- Esta es la única configuración que muestra mejora
- 555 trades = sample size significativo

### 2. Implementación Técnica Correcta
- Multi-timeframe aggregation funciona ✅
- Indicadores de 15min ahora se calculan correctamente ✅
- Sistema de scoring funciona como diseñado ✅
- Tests passing (18/18) ✅

### 3. El Framework es Reutilizable
- Candle aggregator utility está lista
- Podemos usar el mismo enfoque para otras estrategias
- Base sólida para futuras mejoras

---

## 🔍 ANÁLISIS DE SEÑALES (Debug Output)

### Estadísticas
- Total señales en 10,000 velas: 88
- CALL signals: 37 (42%)
- PUT signals: 51 (58%)
- Señales por 1000 velas: 8.8

### Características de las Señales
- Scores entre 70-105 puntos
- Confidence: 70-95%
- 15m RSI funciona correctamente (valores: 28.1, 32.0, 62.9, 64.8, 70.6)
- 15m Trend: mayormente "neutral"
- 5m RSI: valores extremos correctos (16.6-90.1)

### Observación Importante
**El 15m trend siempre es "neutral"** → esto sugiere que:
- SMA(50) en 15min detecta poco trending
- Los mercados sintéticos son más mean-reverting
- La estrategia está filtrando pocas señales por trend

---

## 📊 COMPARACIÓN: Single vs Multi-Timeframe

| Métrica | Single-TF (Walk-Forward) | Multi-TF (Backtest) |
|---------|--------------------------|---------------------|
| Win Rate| 53.1%                    | 50.76%              |
| Mejor Config | R_100 5min: 59.6% WR | R_50 2min: 53.9% WR |
| Peor Config  | R_50 5min: 46.7% WR  | R_100 2/5min: 47.3% WR |
| ROI     | -5.64% avg               | -99.11% avg         |

**Conclusión**: Multi-timeframe NO mejoró los resultados vs single-timeframe.

---

## 💡 PRÓXIMOS PASOS

### Opción A: Optimizar Multi-Timeframe Actual
1. Ajustar scoring system (reducir threshold de 70 → 60)
2. Afinar parámetros RSI (probar 10-20 / 80-90 en vez de 20/80)
3. Reducir cooldown de 5min → 2min
4. Walk-forward validation en la mejor config (R_50 2min)

### Opción B: Descargar Datos Nativos de Timeframes
1. Crear script para descargar 5min y 15min desde Deriv API
2. Re-implementar strategy para usar datos nativos
3. Comparar resultados: aggregated vs native data

### Opción C: Cambiar de Enfoque Completamente
1. **Probar estrategia trend-following** en vez de reversal:
   - Moving Average Crossover (EMA 12/26)
   - Supertrend indicator
   - Donchian Channel breakout
2. **Probar estrategia de momentum**:
   - RSI momentum (mid-range 40-60)
   - MACD histogram
   - Rate of Change (ROC)
3. **Ensayar machine learning**:
   - Feature engineering con los indicadores existentes
   - Random Forest / XGBoost
   - Neural Network (LSTM para series temporales)

### Opción D: Aceptar la Realidad
- **Tal vez 53-55% WR es el límite realista** para estos mercados
- Enfocarse en **gestión de riesgo** en vez de mejorar WR:
  - Kelly Criterion para stake sizing
  - Stop-loss después de X pérdidas consecutivas
  - Diversificación entre múltiples assets
  - Time-based filters (evitar ciertos horarios)

---

## 🎯 RECOMENDACIÓN

**Recomiendo Opción C: Cambiar a Estrategia Trend-Following**

**Razones:**
1. Las reversiones claramente no funcionan bien (~50% WR)
2. Los mercados sintéticos pueden tener mejor trending que mean-reversion
3. Trend-following generalmente tiene mejor risk/reward
4. Es más fácil optimizar trend-following strategies

**Plan Concreto:**
1. Implementar **EMA Crossover Strategy** (12/26):
   - Señal CALL cuando EMA12 cruza arriba de EMA26
   - Señal PUT cuando EMA12 cruza abajo de EMA26
   - Usar multi-timeframe: 15min para trend, 5min para señal
2. Backtest en 30 días
3. Walk-forward validation
4. Si WR > 55%, proceder a paper trading

---

## 📚 LECCIONES APRENDIDAS

1. ✅ **Multi-timeframe no es una solución mágica**
   - El contexto ayuda, pero no garantiza mejora
   - La estrategia base debe ser sólida primero

2. ✅ **Aggregación de velas funciona pero tiene limitaciones**
   - Es suficiente para backtesting inicial
   - Para producción, usar datos nativos es mejor

3. ✅ **53% WR puede ser el límite para reversals**
   - Los mercados sintéticos tienen características únicas
   - Necesitamos adaptar estrategias a estos mercados específicamente

4. ✅ **La cantidad de trades importa**
   - 555 trades en R_50 2min dio mejor resultado
   - Sample size pequeño puede dar falsos positivos

5. ✅ **Testing riguroso es esencial**
   - Walk-forward validation detectó overfitting
   - Backtesting simple no es suficiente

---

## 🚀 ESTADO ACTUAL

### Implementado ✅
- [x] Candle aggregator (1min → 5min → 15min)
- [x] Multi-timeframe reversal strategy
- [x] Scoring system (30 + 50 + 20 = 100 puntos)
- [x] Backtest completo (30 días, 3 assets, 3 duraciones)
- [x] Debug tools para análisis de señales
- [x] Tests (18/18 passing)

### Por Hacer 🔜
- [ ] Walk-forward validation de multi-timeframe strategy
- [ ] Implementar trend-following strategy (EMA crossover)
- [ ] Descargar datos nativos de 5min y 15min
- [ ] Comparar aggregated vs native data
- [ ] Machine learning feature engineering

---

## 📌 CONCLUSIÓN FINAL

La estrategia multi-timeframe **no cumplió con las expectativas**:
- **Objetivo**: 58-62% WR
- **Resultado**: 50.76% WR
- **Diferencia**: -7.24 a -11.24 puntos porcentuales

**Sin embargo**, aprendimos mucho:
1. La implementación técnica está correcta
2. El framework es reutilizable
3. Confirmamos que reversals no funcionan bien
4. Tenemos una dirección clara: probar trend-following

**Próximo paso recomendado:** Implementar EMA Crossover Strategy con enfoque trend-following.
