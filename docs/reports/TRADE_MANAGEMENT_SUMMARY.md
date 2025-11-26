# Resumen Ejecutivo: Gestor de Operaciones Abiertas

## Visión General

El sistema gestiona las operaciones abiertas a través de un **array en memoria llamado `tradeHistory`** que actúa como registro centralizado de todas las posiciones. Este array es monitoreado continuamente por el sistema **SMART Exit** que evalúa cada posición en tiempo real.

---

## Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────────────────────────────────────────────────┐
│                    GESTOR DE TRADES                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. tradeHistory[] (Array en Memoria)                        │
│     └─> Registro central de todas las posiciones             │
│                                                               │
│  2. Sistema SMART Exit (Líneas 678-780)                      │
│     └─> Monitoreo continuo via ticks                         │
│                                                               │
│  3. Sistema de Recuperación (Líneas 503-567)                 │
│     └─> Carga posiciones existentes al iniciar               │
│                                                               │
│  4. Control de Límites (Líneas 442-451) ✅ NUEVO             │
│     └─> Máximo 3 trades abiertos en paralelo                 │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Registro de Trades: `tradeHistory[]`

### Estructura de Datos

```typescript
tradeHistory = [
  {
    contractId: "597284872488",           // ID único del contrato
    asset: "R_75",                        // Símbolo del activo
    direction: "CALL" | "PUT",            // Dirección de la operación
    entryPrice: 5497.454,                 // Precio de entrada
    timestamp: 1700723401000,             // Timestamp de apertura (ms)
    closed: false,                        // Estado: abierta/cerrada
    metadata: {
      tpPct: 0.3,                         // Take Profit %
      slPct: 0.3,                         // Stop Loss %
      recovered: false                    // Si fue recuperada al reiniciar
    }
  },
  // ... más trades
]
```

### Flujo de Vida de un Trade

```
1. CREACIÓN
   └─> Signal detectada → executeTrade() → Se agrega a tradeHistory[]

2. MONITOREO (mientras closed = false)
   └─> Tick events → SMART Exit evalúa → Decide si cerrar

3. CIERRE
   └─> SMART Exit o TP/SL → adapter.closeTrade() → closed = true

4. PERMANECE EN MEMORIA
   └─> No se elimina, solo se marca como cerrada para estadísticas
```

---

## 2. Sistema SMART Exit (Monitoreo Activo)

### Ubicación
**Líneas 678-780** en `run-rsi-bb-scalping-demo.ts`

### Funcionamiento

```
┌──────────────────────────────────────────────────────────┐
│  CADA TICK (≈ cada segundo)                              │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  for each trade in tradeHistory:                         │
│    if (!trade.closed && trade.contractId):               │
│                                                           │
│      ┌─────────────────────────────────────────┐         │
│      │  1. Calcular métricas                   │         │
│      │     - Tiempo en trade                   │         │
│      │     - P&L actual (%)                    │         │
│      │     - Precio actual vs entrada          │         │
│      └─────────────────────────────────────────┘         │
│                                                           │
│      ┌─────────────────────────────────────────┐         │
│      │  2. Evaluar EXIT RULES                  │         │
│      │                                          │         │
│      │  ✅ RULE 1A: Max Duration (40 min)      │         │
│      │     if (time >= 40min && profit >= 0%)  │         │
│      │        → CERRAR                          │         │
│      │                                          │         │
│      │  🆕 RULE 1B: Extreme Duration (120 min) │         │
│      │     if (time >= 120min)                 │         │
│      │        → CERRAR (incluso en pérdida)    │         │
│      │                                          │         │
│      │  ✅ RULE 2: Profitable + RSI Reversal   │         │
│      │     if (profit >= 75% TP                │         │
│      │         && time >= 1min                 │         │
│      │         && RSI reversal detected)       │         │
│      │        → CERRAR                          │         │
│      └─────────────────────────────────────────┘         │
│                                                           │
│      if (shouldExit):                                    │
│        adapter.closeTrade(contractId)                    │
│        trade.closed = true                               │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### Reglas de EXIT Configuradas

| Regla | Condición | Acción | Propósito |
|-------|-----------|--------|-----------|
| **1A** | `time >= 40min && profit >= 0%` | Cerrar | Proteger ganancias/breakeven |
| **1B** 🆕 | `time >= 120min` | Cerrar forzoso | Limitar pérdidas máximas |
| **2** | `profit >= 75% TP && time >= 1min && RSI reversal` | Cerrar temprano | Capturar ganancias antes de reversión |

---

## 3. Sistema de Recuperación de Posiciones

### Ubicación
**Líneas 503-567** en `run-rsi-bb-scalping-demo.ts`

### ¿Qué hace?

Cuando el bot se reinicia, **recupera automáticamente** todas las posiciones abiertas de la API de Deriv para que el sistema SMART Exit pueda seguir monitoreándolas.

### Flujo

```
INICIO DEL BOT
    │
    ├─> await client.getPortfolio()
    │       │
    │       ├─> Obtiene todas las posiciones abiertas desde Deriv API
    │       │
    │       └─> Filtra solo los símbolos monitoreados (SYMBOLS)
    │
    ├─> Para cada posición:
    │       │
    │       ├─> Infiere dirección (CALL/PUT) desde contractType
    │       │   ("MULTUP" → CALL, "MULTDOWN" → PUT)
    │       │
    │       ├─> Crea objeto trade:
    │       │   {
    │       │     contractId,
    │       │     asset,
    │       │     direction,
    │       │     entryPrice: position.buyPrice,
    │       │     timestamp: position.purchaseTime,
    │       │     closed: false,
    │       │     metadata: { recovered: true }
    │       │   }
    │       │
    │       └─> tradeHistory.push(trade)
    │
    └─> SMART Exit comienza a monitorear inmediatamente
```

### Salida de Consola

```
🔄 Checking for existing open positions...
📊 Found 2 open position(s):
   🔴 597284872488 (R_75)
      Direction: PUT
      Entry: 5497.45
      Current P&L: -12.45 (-0.23%)
      Time open: 745.2 minutes  ← ⚠️ Problema detectado!

   🟢 597285001234 (R_75)
      Direction: CALL
      Entry: 5512.30
      Current P&L: +5.67 (+0.10%)
      Time open: 15.3 minutes

✅ Recovered 2 position(s) for SMART Exit monitoring
```

---

## 4. Control de Límites de Trades Abiertos 🆕

### Ubicación
**Líneas 442-451** en `run-rsi-bb-scalping-demo.ts`

### Configuración

```typescript
const MAX_OPEN_TRADES = 3;  // Máximo 3 posiciones abiertas simultáneamente
```

### Funcionamiento

```
NUEVA SEÑAL DETECTADA
    │
    ├─> Contar trades abiertos:
    │   openTradesCount = tradeHistory.filter(t => !t.closed && t.contractId).length
    │
    ├─> if (openTradesCount >= 3):
    │       │
    │       ├─> ⚠️ IGNORAR SEÑAL
    │       │
    │       └─> Mostrar mensaje:
    │           "SEÑAL IGNORADA - LÍMITE DE TRADES ABIERTOS ALCANZADO"
    │           "Trades abiertos actualmente: 3/3"
    │
    └─> else:
        │
        └─> ✅ EJECUTAR TRADE
```

### Salida de Consola

```
⚠️  SEÑAL IGNORADA - LÍMITE DE TRADES ABIERTOS ALCANZADO
   Direction: CALL | Asset: R_75
   Trades abiertos actualmente: 3/3
   Esperando a que se cierren trades antes de abrir nuevas posiciones.
```

---

## 5. Ciclo de Vida Completo de una Operación

### Diagrama de Flujo

```
START
  │
  ├─> 1. DETECCIÓN DE SEÑAL
  │      - Strategy emite signal (CALL/PUT)
  │      - Signal pasa por filtros:
  │        • No durante inicialización
  │        • No antes de primera vela real
  │        • No durante warm-up
  │        • ✅ NUEVO: No si hay 3+ trades abiertos
  │
  ├─> 2. EJECUCIÓN
  │      - executeTrade(adapter, signal, client)
  │      - Se crea posición en Deriv (CFD Multiplier)
  │      - Se agrega a tradeHistory[]
  │      - closed = false
  │
  ├─> 3. MONITOREO (Loop continuo)
  │      │
  │      └─> Para cada tick recibido:
  │            │
  │            ├─> Calcular P&L actual
  │            ├─> Calcular tiempo en trade
  │            ├─> Evaluar SMART Exit rules
  │            │
  │            └─> if (shouldExit):
  │                  - adapter.closeTrade(contractId)
  │                  - trade.closed = true
  │                  - Actualizar estadísticas
  │
  ├─> 4. CIERRE
  │      - Via SMART Exit, TP, o SL
  │      - Se emite evento 'trade:closed'
  │      - Se actualiza balance
  │      - Se guardan estadísticas
  │
  └─> 5. PERMANECE EN MEMORIA
       - trade.closed = true
       - Se mantiene en tradeHistory[] para stats
       - Libera un slot (ahora puede abrir nuevo trade si < 3)
```

---

## 6. Mejoras Implementadas

### ✅ Fix 1: EXTREME MAX DURATION (120 minutos)

**Problema**: Trades en pérdida permanecían abiertos indefinidamente

**Solución**: Agregado EXIT RULE 1B que cierra **todos** los trades después de 2 horas, incluso si están en pérdida.

```typescript
// EXIT RULE 1B: EXTREME MAX DURATION (even if losing)
else if (timeInTrade >= (MAX_TRADE_DURATION * 3)) { // 120 minutes
  shouldExit = true;
  exitReason = `EXTREME duration (${(timeInTrade / 60000).toFixed(1)}min) - forced close to cap losses`;
  console.warn(`⚠️  FORCING CLOSE: Trade has been open for ${(timeInTrade / 60000).toFixed(1)} minutes...`);
}
```

### ✅ Fix 2: Límite de Trades Abiertos (Max 3)

**Problema**: El bot abría muchas posiciones simultáneas en el mismo par

**Solución**: Agregado control que rechaza nuevas señales si ya hay 3 trades abiertos

```typescript
// RISK MANAGEMENT: Max 3 open trades in parallel
const MAX_OPEN_TRADES = 3;
const openTradesCount = tradeHistory.filter(t => !t.closed && t.contractId).length;
if (openTradesCount >= MAX_OPEN_TRADES) {
  console.log(`⚠️  SEÑAL IGNORADA - LÍMITE DE TRADES ABIERTOS ALCANZADO`);
  return;
}
```

---

## 7. Estadísticas y Tracking

### Variables Globales de Tracking

```typescript
let balance = INITIAL_BALANCE;           // Balance actual
let totalTrades = 0;                     // Total de trades ejecutados
let wonTrades = 0;                       // Trades ganadores
let lostTrades = 0;                      // Trades perdedores
const tradeHistory: Array<any> = [];     // Registro completo de trades
```

### Eventos Monitoreados

```typescript
// Cuando se cierra un trade (TP/SL o vencimiento)
client.on('contract_closed', (data) => {
  // Actualizar estadísticas
  // Calcular P&L
  // Actualizar balance
  // Marcar trade como cerrado en tradeHistory
});
```

---

## 8. Consideraciones Importantes

### ⚠️ Limitaciones Actuales

1. **Solo funciona con ticks activos**
   - Si no hay ticks para un símbolo, SMART Exit no evalúa
   - Solución recomendada: Agregar timer periódico (cada 60s)

2. **Sin persistencia en base de datos**
   - tradeHistory[] solo vive en memoria
   - Se pierde si el bot crashea
   - Las posiciones se recuperan de Deriv API al reiniciar

3. **No considera correlación entre pares**
   - Puede tener 3 trades en R_75 simultáneamente
   - No hay diversificación por activo

### 🎯 Recomendaciones

1. **Agregar límite por símbolo**
   ```typescript
   const MAX_TRADES_PER_SYMBOL = 1;
   ```

2. **Persistir tradeHistory en DB**
   - Para análisis histórico
   - Para auditoría
   - Para recuperación más robusta

3. **Agregar timer periódico para SMART Exit**
   ```typescript
   setInterval(() => {
     // Revisar todas las posiciones cada 60s
     // Sin depender de ticks
   }, 60000);
   ```

---

## Resumen Ejecutivo Final

### ¿Cómo funciona?

1. **Registro centralizado**: Todas las posiciones viven en `tradeHistory[]`
2. **Monitoreo continuo**: SMART Exit evalúa cada posición en cada tick
3. **Recuperación automática**: Al reiniciar, carga posiciones de Deriv API
4. **Control de riesgo**: Máximo 3 trades abiertos simultáneamente
5. **Cierre inteligente**: 3 reglas de EXIT (40min, 120min, RSI reversal)

### Archivos Clave

- **`run-rsi-bb-scalping-demo.ts`**: Script principal
  - Líneas 503-567: Recuperación de posiciones
  - Líneas 442-451: Control de límites
  - Líneas 678-780: Sistema SMART Exit

### Configuración Actual

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `MAX_OPEN_TRADES` | 3 | Trades abiertos en paralelo |
| `MAX_TRADE_DURATION` | 40 min | Duración normal máxima |
| `EXTREME_MAX_DURATION` | 120 min | Cierre forzoso |
| `MIN_TRADE_DURATION` | 1 min | Duración mínima antes de early exit |
| `EARLY_EXIT_TP_PCT` | 75% | % del TP para early exit |

---

**Documentación generada**: 2025-11-23
**Versión del sistema**: RSI + BB Scalping Demo v2.0
**Estado**: ✅ Operacional con mejoras de risk management
