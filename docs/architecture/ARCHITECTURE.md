# Deriv Bot - Arquitectura del Sistema

## 📋 Resumen

Sistema de trading automatizado para Deriv con soporte para backtesting en Python y ejecución en vivo en TypeScript.

## 🏗️ Estructura de Packages

```
deriv-bot/
├── packages/
│   ├── gateway/          # TypeScript - Conexión con Deriv API
│   ├── trader/           # TypeScript - Bot de trading en vivo
│   ├── shared/           # TypeScript - Tipos compartidos
│   └── binary_backtester/ # Python - Sistema de backtesting
```

---

## 📦 Package: Gateway

**Lenguaje:** TypeScript
**Propósito:** Manejo de conexión WebSocket con Deriv API

### Responsabilidades:
- Autenticación con Deriv
- Suscripción a ticks y candles
- Ejecución de contratos
- Gestión de balance y posiciones

### Estructura:
```
packages/gateway/src/
├── api/          # Clientes de API
├── cache/        # Cache de datos
├── events/       # Sistema de eventos
├── handlers/     # Handlers de respuestas
└── ws/           # WebSocket manager
```

---

## 📦 Package: Trader

**Lenguaje:** TypeScript
**Propósito:** Lógica de trading, estrategias, y gestión de riesgo

### Responsabilidades:
- Ejecutar estrategias de trading
- Gestión de riesgo (stop-loss, take-profit, max drawdown)
- Gestión de posiciones
- Cálculo de indicadores técnicos
- Backtesting

### Estructura:
```
packages/trader/src/
├── bot/           # Bot principal
├── client/        # Cliente del gateway
├── core/          # Core execution engine
├── indicators/    # Indicadores técnicos (RSI, BB, ATR, etc)
├── position/      # Gestión de posiciones
├── risk/          # Gestión de riesgo
├── strategy/      # Base de estrategias
├── strategies/    # Estrategias implementadas
│   ├── mean-reversion.strategy.ts ✨ OPTIMIZADA
│   ├── rsi-strategy.ts
│   └── sma-crossover-strategy.ts
└── validation/    # Validación de parámetros
```

### Estrategia Mean Reversion 🎯

**Archivo:** [mean-reversion.strategy.ts](packages/trader/src/strategies/mean-reversion.strategy.ts)

**Performance (90 días de backtest):**
- ✅ Win Rate: **63.87%**
- ✅ ROI: **54.09%**
- ✅ Profit: **$540.92**
- ✅ Trades: **119** (1.3/día)

**Parámetros Optimizados:**
```typescript
{
  rsiPeriod: 14,
  rsiOversold: 17,    // Umbral muy estricto
  rsiOverbought: 83,   // Umbral muy estricto
  bbPeriod: 20,
  bbStdDev: 2.0,
  atrMultiplier: 1.0,  // Filtro ATR estándar
  cooldownMinutes: 2,
  expiryMinutes: 3,
  maxWinStreak: 2,     // Progressive Anti-Martingale
  maxLossStreak: 3
}
```

**Lógica:**
1. **CALL Signal:** RSI < 17 + Precio ≤ BB Lower
2. **PUT Signal:** RSI > 83 + Precio ≥ BB Upper
3. **Filtro ATR:** Solo opera cuando volatilidad es normal (ATR ≤ 1.0x promedio)
4. **Cooldown:** 2 minutos entre trades
5. **Money Management:** Progressive Anti-Martingale
   - Win: `next_stake = current_stake + profit`
   - Loss: `next_stake = current_stake / 2`
   - Reset after 2 wins or 3 losses

**Uso:**
```typescript
import { MeanReversionStrategy } from '@deriv-bot/trader';

const strategy = new MeanReversionStrategy({
  name: 'MeanReversion-R75',
  enabled: true,
  assets: ['R_75'],
  maxConcurrentTrades: 1,
  amount: 1,  // 1% of balance
  amountType: 'percentage',
  cooldownSeconds: 120,
  minConfidence: 0.75,
  parameters: {}  // Usa defaults optimizados
});
```

---

## 📦 Package: Shared

**Lenguaje:** TypeScript
**Propósito:** Tipos y utilidades compartidas entre packages

### Exports:
```typescript
// Types
export type { Candle, Tick, Symbol, Balance } from './types/market';
export type { Signal, StrategyConfig, StrategyMetrics } from './types/strategy';
export type { Contract, ContractDirection } from './types/trade';
```

---

## 📦 Package: Binary Backtester

**Lenguaje:** Python
**Propósito:** Backtesting avanzado con Backtrader

### Responsabilidades:
- Backtesting de estrategias en datos históricos
- Optimización de parámetros
- Generación de reportes y métricas
- Integración con Python ML libraries

### Estructura:
```
packages/binary_backtester/
├── core/                # Motor de backtesting
│   ├── enhanced_backtrader_engine.py
│   ├── deriv_data_loader.py
│   └── binary_trade_manager.py
├── strategies/          # Estrategias Python (Backtrader)
│   └── mean_reversion_strategy.py ✨ OPTIMIZADA
├── data/               # Datos de mercado
├── docs/               # Documentación de tests
├── scripts/            # Scripts de análisis
├── bridge/             # Bridge Node.js → Python
│   └── deriv-data-bridge.js
├── archive/            # Archivos históricos
└── README.md
```

### Bridge: Gateway ↔ Python

**Propósito:** Traer datos históricos de Deriv API para backtesting

```javascript
// packages/binary_backtester/bridge/deriv-data-bridge.js
import { GatewayClient } from '@deriv-bot/gateway';

// Fetch data from Deriv API
// Save as JSON for Python backtester
```

**Uso:**
```bash
cd packages/binary_backtester/bridge
npm run fetch-data
```

---

## 🔄 Flujo de Trabajo

### 1. Desarrollo de Estrategia

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Implementar en Python (Backtrader)                      │
│    packages/binary_backtester/strategies/                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Backtest con datos históricos                           │
│    python run_mean_reversion_test_v2.py                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Optimizar parámetros (múltiples tests)                  │
│    - Test #1: Filtro de señales                            │
│    - Test #2: RSI 18/82 ✅                                  │
│    - Test #3: ATR 1.2x ❌ (over-filtering)                  │
│    - Test #4: Cooldown 3 min                                │
│    - Test #5: RSI 17/83 ✅✅ (OPTIMAL)                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Transcribir a TypeScript                                │
│    packages/trader/src/strategies/                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Forward Testing (Demo)                                  │
│    trader.addStrategy(meanReversionStrategy)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Live Trading (Micro Stakes)                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. Scale Up                                                 │
└─────────────────────────────────────────────────────────────┘
```

### 2. Ejecución en Vivo

```
Gateway              Trader                Strategy
   │                   │                      │
   │◄─── connect ──────┤                      │
   │                   │                      │
   │─── ticks ────────►│                      │
   │                   │                      │
   │─── candles ──────►│──── processCandle ──►│
   │                   │                      │
   │                   │◄──── signal ─────────┤
   │                   │                      │
   │                   │─ risk check          │
   │                   │                      │
   │◄─ buy contract ───┤                      │
   │                   │                      │
   │─ contract result ─►│                      │
   │                   │                      │
   │                   │── updateAntiMartingale ──►│
   │                   │                      │
```

---

## 🧪 Testing

### Python Backtesting
```bash
cd packages/binary_backtester
python run_mean_reversion_test_v2.py
```

### TypeScript Unit Tests
```bash
pnpm test
pnpm test:coverage
```

### TypeScript E2E Tests
```bash
pnpm test:e2e
```

---

## 📊 Optimización: Proceso Completo

### Historial de Tests (Mean Reversion)

| Test | Cambio | Win Rate | ROI | Trades | Status |
|------|--------|----------|-----|--------|--------|
| V1 (Baseline) | RSI 20/80 | 54.63% | 30.43% | 324 | Base |
| Test #1 | Signal filter | 55.36% | 24.31% | 224 | ❌ ROI dropped |
| Test #2 | RSI 18/82 | 58.02% | 30.99% | 262 | ✅ **Adopted as V2** |
| Test #3 | ATR 1.2x | 100% | 1.05% | 1 | ❌ Over-filtering |
| Test #4 | Cooldown 3 min | 58.82% | 27.67% | 238 | ⚠️ WR up, ROI down |
| **Test #5** | **RSI 17/83** | **63.87%** | **54.09%** | **119** | ✅✅ **OPTIMAL** |

### Lecciones Aprendidas:

1. **Calidad > Cantidad:** Menos trades de mejor calidad superan muchos mediocres
2. **Progressive Staking Amplifica:** Alto WR + progressive staking = ROI explosivo
3. **Over-filtering Es Fatal:** ATR 1.2x eliminó 99.6% de trades
4. **Mean Reversion ≠ High Volatility:** R_75 funciona mejor en volatilidad normal
5. **RSI Tighter = Better:** 17/83 captura solo reversiones extremas y confiables

---

## 🚀 Próximos Pasos

### 1. Forward Testing (Inmediato)
- [ ] Ejecutar estrategia en cuenta demo
- [ ] Validar 63.87% WR en tiempo real
- [ ] Monitorear slippage y ejecución

### 2. Live Testing (1-2 semanas)
- [ ] Micro stakes ($0.50-$1.00)
- [ ] Validar ROI esperado
- [ ] Ajustar si necesario

### 3. Scale Up (1 mes)
- [ ] Incrementar stakes gradualmente
- [ ] Diversificar a otros assets (R_100, R_50)
- [ ] Implementar múltiples estrategias

### 4. Mejoras Futuras
- [ ] ML para detectar regímenes de mercado
- [ ] Adaptive parameters basados en volatility
- [ ] Multi-timeframe analysis
- [ ] Sentiment analysis integration

---

## 📚 Documentación Adicional

- [README Principal](README.md)
- [Backtester README](packages/binary_backtester/README.md)
- [Análisis de Optimización](packages/binary_backtester/docs/OPTIMIZATION_COMPLETE_ANALYSIS.md)
- [Baseline V2](packages/binary_backtester/docs/BASELINE_V2.md)
- [Estrategia Mean Reversion - Ejemplos](packages/trader/src/strategies/examples/mean-reversion-example.ts)

---

## 🛠️ Tech Stack

### Backend (Trader)
- **TypeScript** 5.x
- **Node.js** >= 18
- **technicalindicators** (RSI, BB, ATR, etc)

### Backtesting
- **Python** 3.13
- **Backtrader** (motor de backtesting)
- **pandas** (data manipulation)
- **numpy** (cálculos)

### Infrastructure
- **pnpm** workspaces
- **vitest** (testing)
- **WebSocket** (Deriv API)

---

## 📞 Contacto

Para preguntas o sugerencias sobre la arquitectura, contactar al equipo de desarrollo.

---

**Última actualización:** 2025-10-16
**Versión Mean Reversion:** Test #5 (Optimized)
**Status:** ✅ Ready for Forward Testing
