# Estado de Implementación - Optimizaciones CryptoScalp v2

## ✅ Implementado

### 1. Salidas Dinámicas (BB Middle / VWAP)
- ✅ Agregado `exitOnBBMiddle` y `exitOnVWAP` a `FastBacktestConfig`
- ✅ Lógica de salida implementada en `FastBacktester.run()`
- ✅ Prioridad de salidas: SL → BB Middle/VWAP → TP → Zombie Killer
- ⚠️ **Pendiente:** Agregar VWAP al indicator cache para acceso rápido

### 2. Time-Based Stop Loss (Zombie Killer)
- ✅ Agregado `zombieKiller` config a `FastBacktestConfig`
- ✅ Lógica implementada: cierra si PnL < threshold después de N barras
- ✅ Funciona para LONG y SHORT

## 🚧 En Progreso

### 3. Filtro MTF (Multi-Timeframe)
- ⏳ **Pendiente:** Implementar cálculo de EMA 50 en 15m
- ⏳ **Pendiente:** Modificar scoring dinámico en `createCryptoScalpV2EntryFn`
- ⏳ **Pendiente:** Ajustar umbrales de score según tendencia 15m

### 4. Re-Entradas (Scale-In)
- ⏳ **Pendiente:** Modificar FastBacktester para soportar entradas parciales
- ⏳ **Pendiente:** Lógica de re-entrada cuando precio va en contra

## ❌ No Implementado

### 5. Limit Orders
- ❌ No aplicable en backtesting/opciones binarias
- ❌ Solo para trading real (si está disponible)

---

## Próximos Pasos

1. **Agregar VWAP al indicator cache** - Para acceso rápido en salidas
2. **Implementar filtro MTF** - Calcular EMA 15m y ajustar scoring
3. **Testing** - Probar optimizaciones con datos reales
4. **Comparar resultados** - Antes vs Después

---

## Cómo Usar las Nuevas Features

### Salidas BB Middle
```typescript
const result = backtester.run({
  entryFn,
  tpPct: 0.5,
  slPct: 0.2,
  cooldown: 10,
  exitOnBBMiddle: true, // ✅ Nueva feature
});
```

### Salidas VWAP
```typescript
const result = backtester.run({
  entryFn,
  tpPct: 0.5,
  slPct: 0.2,
  cooldown: 10,
  exitOnVWAP: true, // ✅ Nueva feature
});
```

### Zombie Killer
```typescript
const result = backtester.run({
  entryFn,
  tpPct: 0.5,
  slPct: 0.2,
  cooldown: 10,
  zombieKiller: {
    enabled: true,
    bars: 15,        // Cerrar después de 15 barras
    minPnlPct: 0.05, // Si PnL < 0.05%
  },
});
```

