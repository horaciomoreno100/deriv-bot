# CryptoScalp v2 - Presets Optimizados

## 📊 Resumen de Optimizaciones

Después de extenso backtesting y validación, se han identificado las configuraciones óptimas para cada asset.

### Mejoras Aplicadas

1. **MTF Filter (Multi-Timeframe)**: Filtro de tendencia usando EMA 50 en timeframe 15m
   - Mejora consistente en ambos assets
   - ETH: +$1,718 (+146%)
   - BTC: +$1,631 (de pérdida a ganancia)

2. **Zombie Killer**: Cierre temprano de trades que no están funcionando
   - ETH: Smart Zombie (solo si revierte después de 15 bars, min 0.05% PnL)
   - BTC: Zombie Killer (después de 15 bars, min 0.1% PnL)
   - Mejora significativa en Win Rate

3. **BB Upper/Lower Exit**: Cierre en Bollinger Bands (solo ETH)
   - ETH: +$4,146 adicionales (+61%)
   - BTC: No aplica (empeora resultados)

---

## 🎯 ETH Optimized Preset

### Configuración de Parámetros

```typescript
import { ETH_OPTIMIZED_PRESET } from './crypto-scalp.params';

// Usar con FastBacktester
const config = {
  ...ETH_OPTIMIZED_PRESET,
  // FastBacktester optimizations
  zombieKiller: {
    enabled: true,
    bars: 15,
    minPnlPct: 0.05,
    onlyIfReversing: true, // Solo cerrar si está revirtiendo
  },
  exitOnBBUpper: true,  // Cerrar CALLs en BB Superior
  exitOnBBLower: true,  // Cerrar PUTs en BB Inferior
  bbUpperLowerMinPnl: 0.05, // Solo cerrar si hay al menos 0.05% ganancia
};
```

### Resultados del Backtest (90 días)

| Métrica | Valor |
|---------|-------|
| **Net PnL** | $10,949 |
| **Profit Factor** | 1.43 |
| **Win Rate** | 50% |
| **Max Drawdown** | 10.3% |
| **Trades** | 2,830 |
| **Avg Win** | $25.99 |
| **Avg Loss** | $17.85 |
| **Risk:Reward** | 1.46:1 |
| **Expectancy** | 0.129 (profit per $1 risked) |

### Mejora vs BASE

- **Net PnL**: +$9,775 (+833%)
- **Profit Factor**: 1.09 → 1.43 (+31%)
- **Win Rate**: 35% → 50% (+14.6%)
- **Max Drawdown**: 35.3% → 10.3% (-71%)

### Uso

```typescript
import { createCryptoScalpV2EntryFn } from './backtest/runners/crypto-scalp-v2-fast';
import { ETH_OPTIMIZED_PRESET } from './strategies/crypto-scalp/crypto-scalp.params';

const entryFn = createCryptoScalpV2EntryFn(candles, ETH_OPTIMIZED_PRESET, {
  enableMTF: true, // Habilitar MTF Filter
});

const result = backtester.run({
  entryFn,
  tpPct: 0.5,
  slPct: 0.2,
  cooldown: 20,
  maxBarsInTrade: 60,
  zombieKiller: {
    enabled: true,
    bars: 15,
    minPnlPct: 0.05,
    onlyIfReversing: true,
  },
  exitOnBBUpper: true,
  exitOnBBLower: true,
  bbUpperLowerMinPnl: 0.05,
});
```

---

## 🎯 BTC Optimized Preset

### Configuración de Parámetros

```typescript
import { BTC_OPTIMIZED_PRESET } from './crypto-scalp.params';

// Usar con FastBacktester
const config = {
  ...BTC_OPTIMIZED_PRESET,
  // FastBacktester optimizations
  zombieKiller: {
    enabled: true,
    bars: 15,
    minPnlPct: 0.1, // BTC necesita umbral más alto
  },
  // NO usar exitOnBBUpper/exitOnBBLower (empeora resultados)
};
```

### Resultados del Backtest (90 días)

| Métrica | Valor |
|---------|-------|
| **Net PnL** | $3,847 |
| **Profit Factor** | 1.27 |
| **Win Rate** | 51% |
| **Max Drawdown** | 12.4% |
| **Trades** | 2,961 |
| **Avg Win** | $11.85 |
| **Avg Loss** | $9.83 |
| **Risk:Reward** | 1.21:1 |
| **Expectancy** | 0.043 (profit per $1 risked) |

### Mejora vs BASE

- **Net PnL**: -$93 → $3,847 (de pérdida a ganancia)
- **Profit Factor**: 0.98 → 1.27 (+29%)
- **Win Rate**: 39% → 51% (+12.4%)
- **Max Drawdown**: 32.6% → 12.4% (-62%)

### Uso

```typescript
import { createCryptoScalpV2EntryFn } from './backtest/runners/crypto-scalp-v2-fast';
import { BTC_OPTIMIZED_PRESET } from './strategies/crypto-scalp/crypto-scalp.params';

const entryFn = createCryptoScalpV2EntryFn(candles, BTC_OPTIMIZED_PRESET, {
  enableMTF: true, // Habilitar MTF Filter
});

const result = backtester.run({
  entryFn,
  tpPct: 0.5,
  slPct: 0.2,
  cooldown: 20,
  maxBarsInTrade: 60,
  zombieKiller: {
    enabled: true,
    bars: 15,
    minPnlPct: 0.1, // BTC necesita umbral más alto
  },
  // NO usar exitOnBBUpper/exitOnBBLower
});
```

---

## ✅ Validación de Overfitting

Todos los presets han sido validados para evitar overfitting:

### Test 1: Out-of-Sample (Train/Test Split)
- **ETH**: PF Train 1.28 → Test 1.50 (+17.7%) ✅
- **BTC**: PF Train 1.28 → Test 1.26 (-1.3%) ✅

### Test 2: Walk-Forward Analysis
- **ETH**: 3/3 ventanas rentables, CV 10.8% ✅
- **BTC**: 3/3 ventanas rentables, CV 5.5% ✅

### Test 3: Parameter Sensitivity
- **ETH**: Cambio máximo 39.4% (sensibilidad moderada) ✅
- **BTC**: Cambio máximo 22.6% (baja sensibilidad) ✅

**Conclusión**: No se detectó overfitting significativo. Las estrategias son robustas y generalizables.

---

## 📝 Notas Importantes

1. **MTF Filter**: Siempre habilitar (`enableMTF: true`) para ambos assets
2. **Zombie Killer**: Configuración diferente por asset
   - ETH: `onlyIfReversing: true` (más conservador)
   - BTC: Sin `onlyIfReversing` (umbral más alto)
3. **BB Exit**: Solo para ETH, no usar en BTC
4. **Balance Inicial**: $1,000 (stake: 3% = $30 por trade)
5. **Multiplier**: 100 (binary options)

---

## 🔄 Migración desde Presets Anteriores

### Si usabas HIGH_PF_PRESET para ETH:
```typescript
// Antes
const entryFn = createCryptoScalpV2EntryFn(candles, HIGH_PF_PRESET);

// Ahora
const entryFn = createCryptoScalpV2EntryFn(candles, ETH_OPTIMIZED_PRESET, {
  enableMTF: true,
});
```

### Si usabas CONSERVATIVE_PRESET para BTC:
```typescript
// Antes
const entryFn = createCryptoScalpV2EntryFn(candles, CONSERVATIVE_PRESET);

// Ahora
const entryFn = createCryptoScalpV2EntryFn(candles, BTC_OPTIMIZED_PRESET, {
  enableMTF: true,
});
```

---

## 📊 Comparación de Versiones

| Versión | ETH Net PnL | ETH PF | BTC Net PnL | BTC PF |
|---------|-------------|--------|-------------|--------|
| BASE (Original) | $1,174 | 1.09 | -$93 | 0.98 |
| + MTF Filter | $2,892 | 1.19 | $1,538 | 1.14 |
| + Zombie Killer | $6,804 | 1.38 | $3,847 | 1.27 |
| + BB Exit (solo ETH) | **$10,949** | **1.43** | - | - |
| **FINAL** | **$10,949** | **1.43** | **$3,847** | **1.27** |

---

## 🚀 Próximos Pasos

1. ✅ Presets optimizados creados
2. ✅ Validación de overfitting completada
3. ⏳ Integración en sistema de trading en vivo
4. ⏳ Monitoreo de performance en producción

---

**Última actualización**: Noviembre 2025
**Versión**: CryptoScalp v2.0 Optimized

