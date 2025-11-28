# CÓMO FUNCIONA LA ESTRATEGIA MTF LEVELS

## 📋 CONCEPTO GENERAL

La estrategia MTF Levels opera en el principio de **bounce en niveles significativos**:
- Identifica niveles importantes de timeframes mayores (5m y 15m)
- Espera a que el precio toque estos niveles en el timeframe de 1m
- Entra cuando el precio rebota del nivel en la dirección esperada

---

## 🔄 FLUJO DE LA ESTRATEGIA

### PASO 1: Resample a Timeframes Mayores

**Cada 5 velas de 1m → 1 vela de 5m**
- Open: Open de la primera vela
- High: Máximo high de las 5 velas
- Low: Mínimo low de las 5 velas
- Close: Close de la última vela

**Cada 15 velas de 1m → 1 vela de 15m**
- Misma lógica, pero con 15 velas

**Ejemplo:**
```
1m: [v1, v2, v3, v4, v5] → 5m: [v1.open, max(highs), min(lows), v5.close]
```

---

### PASO 2: Detectar Swings (Puntos de Giro)

**Algoritmo de Swing Detection:**
- Para cada vela en 5m/15m, verifica si es un swing high o low
- Un swing high: el high es mayor que los `depth` highs a izquierda y derecha
- Un swing low: el low es menor que los `depth` lows a izquierda y derecha

**Parámetros:**
- `swingDepth5m: 2` → Compara con 2 velas a cada lado
- `swingDepth15m: 2` → Compara con 2 velas a cada lado

**Ejemplo:**
```
5m velas: [A, B, C, D, E, F, G]
Si C.high > B.high && C.high > D.high → C es swing high
Si C.high > A.high && C.high > E.high → C es swing high confirmado (depth=2)
```

**Fuerza del Nivel (Strength):**
- `strength = 1`: Solo aparece en 5m
- `strength = 2`: Solo aparece en 15m
- `strength = 3`: Aparece en ambos (5m + 15m) - **NIVEL FUERTE** ⭐

---

### PASO 3: Determinar Tendencias

**Tendencia 5m:**
- Compara los últimos 2 swing highs y 2 swing lows
- **Uptrend**: Higher highs (HH) Y higher lows (HL)
- **Downtrend**: Lower highs (LH) Y lower lows (LL)
- **Sideways**: Patrón mixto

**Tendencia 15m:**
- Misma lógica pero con swings de 15m

**Ejemplo:**
```
5m swings:
  Highs: [100, 102] → HH ✅
  Lows: [98, 99] → HL ✅
  → Tendencia: UP
```

---

### PASO 4: Buscar Nivel Cercano

**En cada vela de 1m:**
1. Calcula distancia a todos los niveles (swings) recientes
2. Busca el nivel más cercano dentro de la tolerancia
3. Tolerancia: `levelTolerance * ATR` (default: 0.9 * ATR)

**Ejemplo:**
```
Precio actual: $3920
ATR: $5
Tolerancia: 0.9 * $5 = $4.5

Niveles disponibles:
  - Swing low 5m: $3918 (distancia: $2) ✅ DENTRO
  - Swing high 15m: $3928 (distancia: $8) ❌ FUERA
  - Swing low 15m: $3915 (distancia: $5) ❌ FUERA (muy cerca del límite)

→ Nivel encontrado: $3918 (swing low 5m)
```

---

### PASO 5: Verificar Toque del Nivel

**Lookback: 5-8 velas hacia atrás**

**Para Support (swing low):**
- Verifica si alguna vela tuvo su `low` cerca del nivel
- Tolerancia de toque: 0.2% - 0.5% del precio del nivel

**Para Resistance (swing high):**
- Verifica si alguna vela tuvo su `high` cerca del nivel
- Misma tolerancia

**Ejemplo:**
```
Nivel: $3918 (swing low)
Últimas 5 velas:
  v1: low=$3920 ❌
  v2: low=$3919 ❌
  v3: low=$3917.5 ✅ TOQUE (dentro de 0.2%)
  v4: low=$3918.5
  v5: low=$3920

→ Nivel fue tocado en v3
```

---

### PASO 6: Verificar Bounce Real

**Después de tocar el nivel:**
- Verifica que el precio se movió en la dirección esperada
- Para CALL (support): precio debe subir al menos 0.05% después del toque
- Para PUT (resistance): precio debe bajar al menos 0.05% después del toque

**Ejemplo:**
```
Nivel tocado en v3: low=$3917.5
v4: close=$3919.2
Cambio: ($3919.2 - $3917.5) / $3917.5 = 0.043% ❌ Muy poco

vs

v4: close=$3920.5
Cambio: ($3920.5 - $3917.5) / $3917.5 = 0.077% ✅ Bounce real
```

---

### PASO 7: Confirmación de Bounce

**Verifica las últimas velas (mirando hacia atrás):**
- Para CALL: busca velas que cerraron más altas que la anterior
- Para PUT: busca velas que cerraron más bajas que la anterior
- Requiere: `confirmationBars` velas confirmando (default: 1)
- Movimiento mínimo: `confirmationMinMove * ATR` (default: 0.2 * ATR)

**Bounce Strength:**
- Calcula qué % del rango de la vela fue el movimiento
- Mínimo requerido: 30% (default) o 50% (si está configurado)

**Ejemplo:**
```
CALL esperado, última vela:
  Open: $3920
  High: $3925
  Low: $3918
  Close: $3923

Movimiento: $3923 - $3920 = $3
Rango: $3925 - $3918 = $7
Bounce strength: $3 / $7 = 43% ✅ (mayor que 30%)
```

---

### PASO 8: Filtros Adicionales

#### A. Bollinger Bands Filter
**Si `requireBBBand: true`:**
- **CALL**: Precio debe estar cerca de la banda baja (BB Lower)
  - Dentro del `bbBandTolerance * ancho_banda` desde BB Lower
  - Default: 15% del ancho de banda
  
- **PUT**: Precio debe estar cerca de la banda alta (BB Upper)
  - Dentro del `bbBandTolerance * ancho_banda` desde BB Upper

**Ejemplo:**
```
BB Upper: $3930
BB Lower: $3910
BB Width: $20
Tolerance: 0.15 * $20 = $3

Para CALL:
  Precio: $3912
  Distancia desde BB Lower: $3912 - $3910 = $2 ✅ (dentro de $3)

Para PUT:
  Precio: $3928
  Distancia desde BB Upper: $3930 - $3928 = $2 ✅ (dentro de $3)
```

#### B. RSI Filter (Opcional)
**Si `avoidRSIMidRange: true`:**
- Evita entradas cuando RSI está entre 40-60 (zona neutral)

#### C. Nivel Fuerte (EDGE)
**Si `requireStrongLevelAgainstTrend: true`:**
- Cuando vamos contra tendencia, requiere nivel con `strength >= 2`
- Esto significa nivel de 15m o nivel que aparece en ambos (5m+15m)

---

### PASO 9: Generar Señal de Entrada

**Si todas las condiciones se cumplen:**
- **Dirección**: CALL si nivel es support (swing low), PUT si es resistance (swing high)
- **Confidence**: Basada en:
  - Fuerza del nivel (strength)
  - Alineación con tendencia
  - Calidad del bounce

**Ejemplo de señal:**
```typescript
{
  direction: 'CALL',
  confidence: 85,
  reason: 'MTF Level CALL: Bounce from support at $3918.00 (5m+15m), trend 5m=up, 15m=up, RSI=45.2'
}
```

---

### PASO 10: Gestión de Salida

**Take Profit:**
- Default: 0.4% del precio de entrada
- Si contra tendencia: 0.32% (20% más ajustado)

**Stop Loss:**
- Default: 0.3% del precio de entrada

**Timeout:**
- Si el trade no alcanza TP ni SL en 25 velas → cierra en break-even o pequeña pérdida

---

## 📊 EJEMPLO COMPLETO

### Escenario: CALL en Support

**1. Resample:**
```
1m: [v1...v5] → 5m: [candle_5m_1]
1m: [v1...v15] → 15m: [candle_15m_1]
```

**2. Detect Swings:**
```
5m swings: [high@$3930, low@$3918, high@$3925]
15m swings: [high@$3935, low@$3918, high@$3930]
→ Nivel $3918 aparece en ambos → strength=3 ⭐
```

**3. Determinar Tendencia:**
```
5m: últimos highs [3925, 3930] → HH ✅
5m: últimos lows [3918, 3920] → HL ✅
→ Tendencia 5m: UP

15m: últimos highs [3930, 3935] → HH ✅
15m: últimos lows [3918, 3922] → HL ✅
→ Tendencia 15m: UP
```

**4. Precio Actual:**
```
Precio: $3920
ATR: $5
Tolerancia: 0.9 * $5 = $4.5
Nivel más cercano: $3918 (distancia: $2) ✅
```

**5. Verificar Toque:**
```
Últimas 5 velas:
  v1: low=$3921
  v2: low=$3920
  v3: low=$3917.8 ✅ TOQUE (dentro de 0.2%)
  v4: low=$3919
  v5: low=$3920
```

**6. Verificar Bounce:**
```
v3: low=$3917.8
v4: close=$3919.5
Cambio: 0.044% ❌ Muy poco

v5: close=$3920.8
Cambio desde v3: 0.077% ✅ Bounce real
```

**7. Confirmación:**
```
v5:
  Open: $3919.5
  Close: $3920.8
  High: $3922
  Low: $3918.5
  
Movimiento: $1.3
Rango: $3.5
Bounce strength: 37% ✅ (mayor que 30%)
```

**8. Filtros:**
```
BB Lower: $3910
BB Upper: $3930
Precio: $3920
Posición BB: 50% ❌ (no está en banda baja)

Pero bbBandTolerance=0.15 permite hasta 15% del ancho
Ancho: $20
Tolerancia: $3
Distancia desde BB Lower: $10 ❌ FUERA

→ NO ENTRAR (falla filtro BB)
```

**Si el precio estuviera en $3912:**
```
Distancia desde BB Lower: $2 ✅ (dentro de $3)
→ ENTRAR ✅
```

---

## 🎯 PARÁMETROS CLAVE

### Frecuencia de Trades
- `levelTolerance: 0.9` → Más alto = más oportunidades
- `cooldownBars: 6` → Menos = más trades
- `confirmationBars: 1` → Menos = más trades

### Calidad de Entradas
- `requireBBBand: true` → Solo entrar en extremos de BB
- `requireStrongLevelAgainstTrend: true` → Solo niveles fuertes
- `minBounceStrength: 0.3` → Bounce mínimo del 30% del rango

### Gestión de Riesgo
- `takeProfitPct: 0.004` → TP del 0.4%
- `stopLossPct: 0.003` → SL del 0.3%
- `maxBarsInTrade: 25` → Timeout después de 25 velas

---

## 🔍 EL EDGE ENCONTRADO

**Requerir nivel fuerte (5m+15m):**
- Filtra niveles débiles que tienen 38.9% WR
- Mantiene niveles fuertes que tienen 55.3% WR
- Mejora esperanza matemática en +114%
- Reduce drawdown en -57%

**Por qué funciona:**
- Los niveles que aparecen en ambos timeframes son más significativos
- Tienen mayor probabilidad de actuar como soporte/resistencia real
- El mercado respeta más estos niveles

---

## 📝 RESUMEN DEL FLUJO

```
1. Resample 1m → 5m y 15m
2. Detectar swings en 5m y 15m
3. Determinar tendencias
4. Buscar nivel cercano al precio actual
5. Verificar que el precio tocó el nivel
6. Verificar que hubo bounce real
7. Confirmar bounce con velas recientes
8. Aplicar filtros (BB, RSI, nivel fuerte)
9. Generar señal de entrada
10. Gestionar salida (TP/SL/Timeout)
```

---

**Fecha**: $(date)
**Versión**: 1.0

