# Bollinger Band Squeeze Strategy

## Descripción General

La estrategia **BB Squeeze** es un sistema de scalping basado en la detección de fases de baja volatilidad (squeeze) seguidas de breakouts explosivos. Esta estrategia es ideal para traders que buscan capturar movimientos rápidos después de períodos de consolidación.

## Fundamento Teórico

### ¿Qué es un "Squeeze"?

Un **squeeze** (compresión) ocurre cuando:
- Las **Bandas de Bollinger** (BB) se contraen y quedan dentro de los **Canales de Keltner** (KC)
- BB_Upper < KC_Upper **Y** BB_Lower > KC_Lower
- Esto indica que la volatilidad está comprimida y el precio está consolidando

### Por qué funciona

1. **Fase de Compresión (Squeeze)**: El mercado está en equilibrio, acumulando energía
2. **Fase de Expansión (Breakout)**: La energía acumulada se libera en un movimiento direccional fuerte
3. **Probabilidad**: Los breakouts después de squeeze tienden a ser más fuertes y sostenidos

## Indicadores Técnicos

### 1. Bollinger Bands (BB)
- **Período**: 20 velas
- **Desviación Estándar**: 2
- **Uso**: Detectar volatilidad y breakouts

### 2. Keltner Channels (KC)
- **Período**: 20 velas (EMA)
- **Multiplicador ATR**: 1.5
- **Uso**: Confirmar squeeze y expansión de volatilidad

### 3. ATR (Average True Range)
- **Período**: 20 velas
- **Uso**: Calcular Keltner Channels

## Lógica de la Estrategia

### Detección de Squeeze
```
💤 Squeeze Detected cuando:
  • BB_Upper < KC_Upper
  • BB_Lower > KC_Lower
  • Log: "💤 SQUEEZE DETECTED (Low Volatility)"
```

### Señal CALL (Compra)
```
🚀 Breakout CALL cuando:
  • Venimos de un Squeeze reciente (< 5 minutos)
  • Precio actual > BB_Upper
  • Cooldown completado (60s)
```

### Señal PUT (Venta)
```
📉 Breakout PUT cuando:
  • Venimos de un Squeeze reciente (< 5 minutos)
  • Precio actual < BB_Lower
  • Cooldown completado (60s)
```

## Gestión de Riesgo

### Take Profit (TP)
- **Porcentaje**: 0.4%
- **Razón**: Los breakouts post-squeeze tienden a ser fuertes, justificando un TP más agresivo

### Stop Loss (SL)
- **Porcentaje**: 0.2%
- **Razón**: Si el breakout falla y el precio regresa, salimos rápido

### TP/SL Ratio
- **Ratio**: 2:1
- **Expectativa**: Por cada 1 dólar arriesgado, buscamos ganar 2 dólares

### Smart Exit
```
🎯 Salida Inteligente:
  • Si el precio toca BB_Middle (media de 20)
  • Razón: Mean reversion - el precio tiende a regresar a la media
```

## Parámetros Configurables

```typescript
{
  bbPeriod: 20,           // Período de Bollinger Bands
  bbStdDev: 2,            // Desviación estándar de BB
  kcPeriod: 20,           // Período de Keltner Channels
  kcMultiplier: 1.5,      // Multiplicador de ATR para KC
  takeProfitPct: 0.004,   // 0.4% TP
  stopLossPct: 0.002,     // 0.2% SL
  cooldownSeconds: 60,    // Cooldown entre trades
  minCandles: 50,         // Velas mínimas para indicadores
}
```

## Uso

### Iniciar el Demo

```bash
# Modo CFD (recomendado)
TRADE_MODE=cfd pnpm demo:squeeze

# Con símbolos específicos
SYMBOL="R_75,R_100" TRADE_MODE=cfd pnpm demo:squeeze

# Con configuración personalizada
TRADE_MODE=cfd INITIAL_CAPITAL=10000 RISK_PERCENTAGE=0.02 pnpm demo:squeeze
```

### Variables de Entorno

```bash
# Obligatorias
DERIV_APP_ID=your_app_id
DERIV_API_TOKEN=your_api_token

# Opcionales
TRADE_MODE=cfd                    # cfd o binary (default: cfd)
SYMBOL=R_75,R_100                 # Símbolos a tradear (default: R_75,R_100)
INITIAL_CAPITAL=10000             # Capital inicial (default: 10000)
RISK_PERCENTAGE=0.02              # Riesgo por trade (default: 0.02 = 2%)
ACCOUNT_LOGINID=your_loginid      # Login ID de Deriv
GATEWAY_WS_URL=ws://localhost:3000 # URL del Gateway (default: ws://localhost:3000)
```

## Salida de la Consola

### Durante Squeeze
```
[BBSqueeze] 💤 SQUEEZE DETECTED (Low Volatility) - BB inside KC
[BBSqueeze]    BB Range: [150.25, 152.75]
[BBSqueeze]    KC Range: [149.80, 153.20]
```

### Breakout CALL
```
[BBSqueeze] 🚀 BREAKOUT ABOVE BB_Upper detected!
[BBSqueeze]    Price: 152.85 > BB_Upper: 152.75
[BBSqueeze]    Time since squeeze: 45s

🎯 SEÑAL DETECTADA - EJECUTANDO TRADE
   Direction: CALL
   Confidence: 80.0%
   Asset: R_75
```

### Breakout PUT
```
[BBSqueeze] 📉 BREAKOUT BELOW BB_Lower detected!
[BBSqueeze]    Price: 150.15 < BB_Lower: 150.25
[BBSqueeze]    Time since squeeze: 67s

🎯 SEÑAL DETECTADA - EJECUTANDO TRADE
   Direction: PUT
   Confidence: 80.0%
   Asset: R_100
```

## Mejores Prácticas

### 1. Timeframe Recomendado
- **1 minuto (60s)**: Ideal para scalping rápido
- **3 minutos (180s)**: Para movimientos más amplios (requiere ajustar TP/SL)

### 2. Símbolos Recomendados
- **Volatility Indices**: R_75, R_100 (alta volatilidad, squeezes frecuentes)
- **Forex**: Pares mayores durante sesiones activas (alta liquidez)

### 3. Horarios Óptimos
- **Volatility Indices**: 24/7 (siempre activos)
- **Forex**: Overlaps de sesiones (Londres-NY, Tokio-Londres)

### 4. Gestión de Múltiples Trades
- **Max Open Trades**: 3 simultáneos
- **Max per Symbol**: 1 por símbolo
- **Razón**: Evitar sobreexposición durante breakouts falsos

## Métricas Esperadas (Estimación)

| Métrica | Valor Estimado |
|---------|----------------|
| **Win Rate** | 35-45% |
| **Profit Factor** | 1.1-1.3 |
| **Avg Win** | 0.4% |
| **Avg Loss** | 0.2% |
| **TP/SL Ratio** | 2:1 |
| **Trades/Día** | 15-30 (depende de la volatilidad) |
| **ROI Mensual** | 20-40% (depende del riesgo) |

> **Nota**: Estas métricas son estimaciones. Debes realizar backtesting con datos reales para obtener resultados precisos.

## Ventajas

✅ **Señales claras**: Fácil de identificar squeezes y breakouts
✅ **High RR Ratio**: 2:1 TP/SL maximiza ganancias
✅ **Smart Exit**: Mean reversion reduce pérdidas extendidas
✅ **Scalping rápido**: Trades de corta duración (1-5 minutos)
✅ **Adaptable**: Funciona en múltiples timeframes y símbolos

## Desventajas

❌ **Breakouts falsos**: No todos los squeezes resultan en breakouts válidos
❌ **Requiere volatilidad**: No funciona en mercados demasiado estables
❌ **Win rate moderado**: 35-45% (compensado por TP/SL ratio)
❌ **Requiere monitoreo**: Mejor con ejecución automatizada

## Optimización

### Ajustar TP/SL
```typescript
// Más agresivo (mayor riesgo/recompensa)
takeProfitPct: 0.006,  // 0.6%
stopLossPct: 0.002,    // 0.2% (3:1 ratio)

// Más conservador (mayor win rate)
takeProfitPct: 0.003,  // 0.3%
stopLossPct: 0.0025,   // 0.25% (1.2:1 ratio)
```

### Ajustar Períodos
```typescript
// Más sensible (más señales)
bbPeriod: 15,
kcPeriod: 15,

// Más estable (menos señales)
bbPeriod: 30,
kcPeriod: 30,
```

### Ajustar KC Multiplier
```typescript
// Squeeze más estricto (menos señales, mayor calidad)
kcMultiplier: 2.0,

// Squeeze más flexible (más señales)
kcMultiplier: 1.0,
```

## Testing

### Backtesting
```bash
# TODO: Implementar backtesting para BB Squeeze
# pnpm backtest:squeeze
```

### Live Testing
```bash
# Modo demo con capital virtual
TRADE_MODE=cfd INITIAL_CAPITAL=1000 pnpm demo:squeeze
```

### Monitoreo
- El dashboard muestra el estado actual del squeeze
- Signal Proximity indica qué tan cerca está la señal
- Logs detallados de cada fase (squeeze, breakout, trade)

## Soporte

Si encuentras problemas o tienes preguntas:

1. Revisa los logs detallados en la consola
2. Verifica que el Gateway esté corriendo
3. Asegúrate de tener suficientes velas históricas (mínimo 50)
4. Confirma que el símbolo tenga volatilidad suficiente

## Autor

Estrategia implementada para el proyecto **deriv-bot** por el equipo de Trading Cuantitativo.

---

**¡Happy Trading! 🚀📈**
