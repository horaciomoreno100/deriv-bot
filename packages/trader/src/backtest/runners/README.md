# Fast Backtester

Sistema de backtesting ultra-rápido diseñado para optimización de parámetros.

## 🚀 Características

- **Pre-cálculo de indicadores**: Todos los indicadores se calculan UNA vez antes del loop
- **Sin overhead de objetos**: Loop simple sin crear objetos pesados (TradeWithContext, EventCollector, etc.)
- **Sin slices**: Usa índices directos en lugar de `candles.slice()`
- **Métricas esenciales**: Solo calcula lo necesario (trades, wins, PnL, DD, expectancy)
- **Target**: <100ms por config para 130k candles

## 📊 Comparación de Performance

| Método | Tiempo (140 configs) | Overhead |
|--------|---------------------|----------|
| **Full Backtest** (strategy-runner.ts) | ~2-5 minutos | Alto (objetos, contexto, Monte Carlo) |
| **Fast Backtester** | ~69ms | Mínimo (solo métricas básicas) |

**Mejora: ~2000x más rápido** ⚡

## 🎯 Uso Básico

```typescript
import { FastBacktester } from './fast-backtester.js';
import { createRSIEntryFn } from './fast-backtester-helpers.js';

// 1. Cargar candles
const candles = loadCandles('data/cryBTCUSD_1m_90d.csv');

// 2. Crear backtester con indicadores requeridos
const backtester = new FastBacktester(candles, ['rsi', 'atr'], {
  rsiPeriod: 14,
  atrPeriod: 14,
});

// 3. Crear función de entrada
const entryFn = createRSIEntryFn(17, 83); // RSI oversold/overbought

// 4. Ejecutar backtest
const result = backtester.run({
  entryFn,
  tpPct: 0.25,      // 0.25% take profit
  slPct: 0.25,      // 0.25% stop loss
  cooldown: 5,      // 5 bars cooldown
  initialBalance: 1000,
  stakePct: 0.03,
  multiplier: 100,
});

console.log(`Trades: ${result.trades}`);
console.log(`Win Rate: ${result.winRate.toFixed(1)}%`);
console.log(`Net PnL: $${result.netPnl.toFixed(2)}`);
console.log(`Profit Factor: ${result.profitFactor.toFixed(2)}`);
console.log(`Max DD: ${result.maxDrawdownPct.toFixed(1)}%`);
```

## 🔧 Funciones de Entrada Pre-construidas

### RSI Simple
```typescript
import { createRSIEntryFn } from './fast-backtester-helpers.js';

const entryFn = createRSIEntryFn(17, 83);
// Long cuando RSI <= 17
// Short cuando RSI >= 83
```

### RSI con Filtro EMA
```typescript
import { createRSIWithEMAEntryFn } from './fast-backtester-helpers.js';

const entryFn = createRSIWithEMAEntryFn(17, 83, true);
// Long cuando RSI <= 17 Y precio > EMA
// Short cuando RSI >= 83 Y precio < EMA
```

### Bollinger Bands Squeeze
```typescript
import { createBBSqueezeEntryFn } from './fast-backtester-helpers.js';

const entryFn = createBBSqueezeEntryFn(0);
// Entra cuando squeeze se libera con momentum
```

### Multi-Indicador (RSI + ADX + VWAP)
```typescript
import { createMultiIndicatorEntryFn } from './fast-backtester-helpers.js';

const entryFn = createMultiIndicatorEntryFn(17, 83, 20, true);
// RSI + ADX mínimo 20 + filtro VWAP bias
```

## 📝 Función de Entrada Personalizada

```typescript
const entryFn = (index: number, indicators: Record<string, number | boolean>) => {
  const rsi = indicators.rsi as number;
  const atr = indicators.atr as number;
  const price = indicators.price as number;

  // Tu lógica aquí
  if (rsi < 20 && atr > 0.5) {
    return {
      direction: 'CALL' as const,
      price: 0, // Se usará candles[index].close
    };
  }

  return null; // No signal
};
```

## 📈 Resultado del Backtest

```typescript
interface FastBacktestResult {
  trades: number;              // Total de trades
  wins: number;                // Trades ganadores
  losses: number;              // Trades perdedores
  winRate: number;             // Win rate %
  netPnl: number;              // PnL neto
  grossProfit: number;         // Ganancia bruta
  grossLoss: number;           // Pérdida bruta
  profitFactor: number;        // PF = grossProfit / grossLoss
  avgWin: number;              // Promedio de ganancias
  avgLoss: number;             // Promedio de pérdidas
  avgPnl: number;              // PnL promedio por trade
  maxDrawdown: number;         // Drawdown máximo ($)
  maxDrawdownPct: number;      // Drawdown máximo (%)
  maxConsecutiveWins: number;  // Racha máxima de wins
  maxConsecutiveLosses: number;// Racha máxima de losses
  expectancy: number;          // Expectativa (profit por $1 risked)
  riskRewardRatio: number;     // R:R = avgWin / avgLoss
  finalEquity: number;         // Equity final
  peakEquity: number;          // Equity pico
}
```

## 🎨 Ejemplo: Optimización de Parámetros

```typescript
const backtester = new FastBacktester(candles, ['rsi']);

const rsiConfigs = [15, 17, 20, 25];
const tpConfigs = [0.25, 0.3, 0.4];
const slConfigs = [0.15, 0.2, 0.25];

const results = [];

for (const rsiOs of rsiConfigs) {
  for (const tp of tpConfigs) {
    for (const sl of slConfigs) {
      const entryFn = createRSIEntryFn(rsiOs, 100 - rsiOs);
      
      const result = backtester.run({
        entryFn,
        tpPct: tp,
        slPct: sl,
        cooldown: 5,
      });

      results.push({
        config: `RSI ${rsiOs}/${100 - rsiOs}, TP ${tp}%, SL ${sl}%`,
        ...result,
      });
    }
  }
}

// Ordenar por score
results.sort((a, b) => {
  const scoreA = a.profitFactor > 1 
    ? (a.profitFactor - 1) * Math.sqrt(a.trades) * (1 - a.maxDrawdownPct / 100)
    : -Math.abs(a.netPnl);
  const scoreB = b.profitFactor > 1
    ? (b.profitFactor - 1) * Math.sqrt(b.trades) * (1 - b.maxDrawdownPct / 100)
    : -Math.abs(b.netPnl);
  return scoreB - scoreA;
});
```

## 🔍 Indicadores Soportados

- `rsi` - Relative Strength Index
- `atr` - Average True Range
- `adx` - Average Directional Index
- `plusDI`, `minusDI` - Directional Indicators
- `bbUpper`, `bbMiddle`, `bbLower` - Bollinger Bands
- `kcUpper`, `kcMiddle`, `kcLower` - Keltner Channels
- `sma`, `ema`, `ema20` - Moving Averages
- `macd`, `macdSignal`, `macdHistogram` - MACD
- `stochK`, `stochD` - Stochastic
- `squeezeOn`, `squeezeHistogram` - BB Squeeze
- `zigzagHigh`, `zigzagLow` - ZigZag
- `lastSwingHigh`, `lastSwingLow` - Last Swing Points

## ⚡ Optimizaciones Clave

1. **Pre-cálculo**: Todos los indicadores se calculan una vez al inicio
2. **Sin slices**: Usa índices directos `candles[i]` en lugar de `candles.slice(0, i+1)`
3. **Sin objetos pesados**: No crea `TradeWithContext`, `EventCollector`, etc.
4. **Loop simple**: Solo variables primitivas y arrays pre-construidos
5. **Métricas mínimas**: Solo calcula lo esencial para optimización

## 🆚 Cuándo Usar Fast vs Full Backtest

### Usa FastBacktester cuando:
- ✅ Optimizando parámetros (grid search, genetic algorithms)
- ✅ Necesitas probar cientos/miles de configuraciones
- ✅ Solo necesitas métricas básicas (trades, PnL, DD)
- ✅ Performance es crítica

### Usa Full Backtest (strategy-runner.ts) cuando:
- ✅ Validando la mejor configuración encontrada
- ✅ Necesitas análisis completo (Monte Carlo, Walk-Forward, OOS)
- ✅ Necesitas visualización de trades (charts)
- ✅ Necesitas contexto completo de cada trade

## 📚 Flujo Recomendado

```
1. FastBacktester → Optimización rápida (1000s de configs)
                    ↓
2. Encuentra top 10 configuraciones
                    ↓
3. Full Backtest → Validación completa (Monte Carlo, OOS)
                    ↓
4. Selecciona la mejor configuración
```

## 🐛 Troubleshooting

**Problema**: Indicadores no disponibles
```typescript
// Asegúrate de incluir el indicador en requiredIndicators
const backtester = new FastBacktester(candles, ['rsi', 'atr', 'adx']);
```

**Problema**: Precio de entrada es 0
```typescript
// Si price = 0 en la señal, se usará candles[index].close automáticamente
return { direction: 'CALL', price: 0 }; // ✅ OK
```

**Problema**: Muy lento
```typescript
// Verifica que no estés creando slices en entryFn
// ❌ MAL: candles.slice(0, index + 1)
// ✅ BIEN: Usa indicators pre-calculados
```

## 🚀 CryptoScalp v2 Support

FastBacktester incluye soporte optimizado para CryptoScalp v2:

```typescript
import { FastBacktester } from './fast-backtester.js';
import { createCryptoScalpV2EntryFn } from './crypto-scalp-v2-fast.js';
import { AGGRESSIVE_PRESET, BTC_CONFIG } from '../strategies/crypto-scalp/crypto-scalp.params.js';

const backtester = new FastBacktester(candles, ['rsi', 'atr', 'adx', 'bb']);

// Crear entry function con preset
const entryFn = createCryptoScalpV2EntryFn(candles, AGGRESSIVE_PRESET);

// O con configuración personalizada
const entryFn = createCryptoScalpV2EntryFn(candles, {
  ...BTC_CONFIG,
  rsi: { oversoldThreshold: 15, overboughtThreshold: 85, period: 14, useAsFilter: true },
});

const result = backtester.run({
  entryFn,
  tpPct: 0.3,
  slPct: 0.2,
  cooldown: 10,
});
```

**Características de CryptoScalp v2 Fast:**
- ✅ Pre-calcula VWAP series una vez
- ✅ Pre-calcula volume ratios
- ✅ Implementa scoring completo (RSI, BB, VWAP, ADX, Volume)
- ✅ Mismo scoring que CryptoScalp v2 original
- ✅ ~100x más rápido que el backtest completo

Ver `fast-crypto-scalp-v2-optimize.ts` para ejemplo completo.

## 📖 Ver También

- `fast-backtester.ts` - Implementación principal
- `fast-backtester-helpers.ts` - Funciones helper (RSI, BB, etc.)
- `crypto-scalp-v2-fast.ts` - Helper para CryptoScalp v2
- `fast-backtester-example.ts` - Ejemplo RSI simple
- `fast-crypto-scalp-v2-optimize.ts` - Ejemplo CryptoScalp v2
- `strategy-runner.ts` - Full backtest framework

