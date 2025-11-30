# Plan de Refactor del Motor de Backtesting

## Estado Actual - Problemas Identificados

### 1. Código Duplicado

Hay **múltiples implementaciones** del mismo concepto:

| Archivo | Propósito | Problemas |
|---------|-----------|-----------|
| `backtest-engine.ts` | Motor puro con funciones | ✅ Bien diseñado, pero no captura indicadores |
| `simple-backtest.ts` | Usa Grademark | Dependencia externa, duplica lógica |
| `enhanced-backtest.ts` | Copia de simple-backtest | Código duplicado |
| `run-backtest.ts` | Usa BacktestJS | Otra dependencia, otro formato |
| `backtest-bb-squeeze.ts` | Script standalone | Duplica simulateTrade() |
| `mr-backtest-runner.ts` | Para estrategias MR | Bueno, pero separado del engine principal |

### 2. Dependencias Externas Innecesarias
- `grademark` - Library de backtesting
- `@backtest/framework` - Otra library
- `data-forge` - Para DataFrames

**No necesitamos estas dependencias.** El `backtest-engine.ts` ya tiene todo lo necesario.

### 3. Fragmentación de Scripts
- 60+ scripts en `/scripts/` con código duplicado
- Cada uno reimplementa:
  - Carga de CSV
  - Cálculo de indicadores
  - Simulación de trades
  - Reporte de métricas

### 4. No hay Captura de Contexto
- Los trades no guardan los indicadores al momento de entry/exit
- No se puede visualizar qué pasó realmente
- No hay forma de correlacionar señal → trade → chart

---

## Arquitectura Propuesta

### Estructura de Directorios

```
packages/trader/src/backtest/
├── index.ts                    # Exports públicos
├── types.ts                    # Tipos unificados
├── engine/
│   ├── backtest-engine.ts      # Motor core (MANTENER, refactorear)
│   ├── trade-executor.ts       # Ejecuta trades con contexto
│   └── event-collector.ts      # Captura eventos para viz
├── runners/
│   ├── strategy-runner.ts      # Corre cualquier estrategia
│   └── batch-runner.ts         # Corre múltiples configs
├── analysis/
│   ├── metrics.ts              # Cálculo de métricas
│   ├── monte-carlo.ts          # Simulación Monte Carlo
│   ├── walk-forward.ts         # Walk-forward analysis
│   └── oos-test.ts             # Out-of-sample test
├── data/
│   ├── csv-loader.ts           # Carga CSV (único lugar)
│   └── indicator-cache.ts      # Pre-cálculo de indicadores
└── reporters/
    ├── console-reporter.ts     # Output a consola
    ├── json-reporter.ts        # Export JSON
    └── chart-reporter.ts       # Genera charts con Plotly
```

### Tipos Unificados

```typescript
// packages/trader/src/backtest/types.ts

import type { Candle } from '@deriv-bot/shared';
import type {
  MarketSnapshot,
  TradeWithContext,
  IndicatorSnapshot
} from '@deriv-bot/shared';

/**
 * Configuración única para cualquier backtest
 */
export interface BacktestConfig {
  // Datos
  asset: string;
  timeframe: number;

  // Capital
  initialBalance: number;
  stakeMode: 'fixed' | 'percentage';
  stakeAmount: number;      // Si fixed
  stakePct: number;         // Si percentage

  // Multiplier (Deriv CFD)
  multiplier: number;

  // TP/SL
  takeProfitPct: number;
  stopLossPct: number;
  maxBarsInTrade: number;

  // Trailing Stop (opcional)
  useTrailingStop: boolean;
  trailingActivationPct?: number;
  trailingDistancePct?: number;

  // Cooldown
  cooldownBars: number;

  // Filtros
  filters?: {
    sessionFilter?: boolean;
    newsFilter?: boolean;
    dayHourFilter?: boolean;
  };
}

/**
 * Señal de entrada generada por estrategia
 */
export interface EntrySignal {
  timestamp: number;
  direction: 'CALL' | 'PUT';
  price: number;
  confidence: number;
  reason: string;
  strategyName: string;

  // Estado del mercado al generar señal
  snapshot: MarketSnapshot;

  // TP/SL sugeridos por la estrategia (opcional)
  suggestedTp?: number;
  suggestedSl?: number;
}

/**
 * Resultado de un backtest
 */
export interface BacktestResult {
  // Metadata
  asset: string;
  timeframe: number;
  strategyName: string;
  config: BacktestConfig;

  // Periodo
  dateRange: {
    from: Date;
    to: Date;
    candleCount: number;
  };

  // Resultados
  trades: TradeWithContext[];
  metrics: BacktestMetrics;

  // Datos para visualización
  candles: Candle[];
  indicatorSeries: Map<string, number[]>;

  // Análisis adicional (opcional)
  monteCarlo?: MonteCarloResult;
  walkForward?: WalkForwardResult;
  oosTest?: OOSResult;
}

/**
 * Interface que debe implementar cualquier estrategia
 * para ser compatible con el backtest engine
 */
export interface BacktestableStrategy {
  name: string;

  /**
   * Dado un conjunto de candles y los indicadores pre-calculados,
   * retorna una señal de entrada o null
   */
  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null;

  /**
   * Lista de indicadores que necesita esta estrategia
   */
  requiredIndicators(): string[];
}
```

### Flujo del Nuevo Engine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKTEST FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. SETUP                                                                  │
│   ─────────                                                                 │
│   CSVLoader.load(path) ──▶ Candle[]                                        │
│   IndicatorCache.precompute(candles, strategy.requiredIndicators())        │
│   EventCollector.init()                                                    │
│                                                                             │
│   2. LOOP                                                                   │
│   ────────                                                                  │
│   for each candle:                                                         │
│     │                                                                       │
│     ├─ collector.onCandle(candle, indicators[i])                           │
│     │                                                                       │
│     ├─ signal = strategy.checkEntry(candles, indicators[i], i)             │
│     │                                                                       │
│     ├─ if signal:                                                          │
│     │    collector.onSignal(signal)                                        │
│     │    trade = TradeExecutor.execute(signal, futureCandles, config)      │
│     │    collector.onTradeComplete(trade)                                  │
│     │                                                                       │
│     └─ continue                                                            │
│                                                                             │
│   3. ANALYSIS                                                               │
│   ───────────                                                               │
│   metrics = Metrics.calculate(trades, config)                              │
│   monteCarlo = MonteCarlo.run(trades, config)  // opcional                 │
│   oosTest = OOSTest.run(trades, config)        // opcional                 │
│                                                                             │
│   4. OUTPUT                                                                 │
│   ────────                                                                  │
│   result = collector.toBacktestResult(metrics, monteCarlo, oosTest)        │
│   ConsoleReporter.print(result)                                            │
│   JsonReporter.save(result)                    // opcional                 │
│   ChartReporter.generateHTML(result)           // opcional                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Plan de Implementación

### Fase 1: Consolidar Core (Día 1)
1. Crear `types.ts` con tipos unificados
2. Refactorizar `backtest-engine.ts`:
   - Mantener funciones puras
   - Agregar captura de `MarketSnapshot` en `executeTrade()`
   - Retornar `TradeWithContext` en vez de `Trade`
3. Crear `event-collector.ts`:
   - Captura candles + indicadores
   - Captura señales
   - Captura trades con contexto completo

### Fase 2: Crear Runners (Día 2)
1. Crear `csv-loader.ts` (consolidar código duplicado)
2. Crear `indicator-cache.ts` (pre-cálculo eficiente)
3. Crear `strategy-runner.ts`:
   - Interface unificada
   - Acepta cualquier `BacktestableStrategy`
   - Genera `BacktestResult` completo

### Fase 3: Reporters (Día 3)
1. Crear `console-reporter.ts` (formateo bonito)
2. Crear `json-reporter.ts` (export)
3. Integrar `chart-reporter.ts` con visualización existente

### Fase 4: Migrar Estrategias (Día 4-5)
1. Adaptar `BBSqueezeStrategy` a `BacktestableStrategy`
2. Adaptar `MeanReversionStrategy` a `BacktestableStrategy`
3. Adaptar estrategias MR existentes

### Fase 5: Limpieza (Día 6)
1. Eliminar archivos duplicados:
   - `simple-backtest.ts`
   - `enhanced-backtest.ts`
   - `run-backtest.ts`
   - `bb-squeeze-backtest.ts` (en backtest/)
2. Consolidar scripts en `/scripts/`:
   - Mantener solo los necesarios
   - Refactorizar para usar nuevo engine
3. Remover dependencias:
   - `grademark`
   - `@backtest/framework`
   - `data-forge`

---

## Archivos a Eliminar

```
packages/trader/src/backtest/
├── simple-backtest.ts        ❌ ELIMINAR
├── enhanced-backtest.ts      ❌ ELIMINAR
├── run-backtest.ts           ❌ ELIMINAR
├── bb-squeeze-backtest.ts    ❌ ELIMINAR
└── mr-backtest-runner.ts     🔄 REFACTORIZAR → strategy-runner.ts
```

## Archivos a Mantener/Refactorizar

```
packages/trader/src/backtest/
├── backtest-engine.ts        🔄 REFACTORIZAR (agregar contexto)
└── backtest-engine.test.ts   ✅ MANTENER (actualizar tests)
```

---

## Beneficios del Refactor

1. **Un solo lugar** para toda la lógica de backtest
2. **Tipos consistentes** en todo el sistema
3. **Captura completa** de contexto para visualización
4. **Fácil de extender** con nuevas estrategias
5. **Menos dependencias** (no más grademark, backtest-framework)
6. **Mejor performance** (pre-cálculo de indicadores)
7. **Integración nativa** con el chart generator

---

## Preguntas para el Usuario

Antes de implementar, confirmar:

1. ¿Mantener soporte para trailing stop? (actualmente en backtest-engine)
2. ¿Priorizar alguna estrategia específica para migrar primero?
3. ¿Hay scripts en `/scripts/` que sean críticos y no se deben tocar?
4. ¿El análisis Monte Carlo y Walk-Forward son importantes o los dejamos para después?
