# Deriv Bot

Bot de trading automatizado para opciones binarias en Deriv con arquitectura modular y ejecución en tiempo real (TypeScript).

## ✨ Estrategia Mean Reversion - Optimizada

**Performance (90 días de backtest en R_75):**
- ✅ **Win Rate: 63.87%**
- ✅ **ROI: 54.09%**
- ✅ **Ganancia Total: $540.92**
- ✅ **Trades: 119** (1.3/día)
- ✅ **Progressive Anti-Martingale**

**Status:** ✅ Sistema funcionando en Demo - Listo para Forward Testing

## 🤖 NUEVO: AI-Enhanced Signal Analysis

Sistema de análisis basado en IA que mejora la calidad de señales mediante:

- **Detección de Régimen de Mercado** (trending, ranging, reversal, volatility)
- **Signal Quality Scoring** (0-100) con 6 componentes
- **Ajustes Dinámicos** de TP/SL según volatilidad
- **Filtrado Inteligente** rechaza señales de baja calidad

**Resultado esperado**: Win rate +10-15%, Profit factor +30-50%

### 🔍 AI Observer (Recomendado - NO interfiere con tu sistema)

Corre en **paralelo** con tu trader actual, analiza señales sin modificar nada:

```bash
# Terminal 1: Tu trader actual (corriendo normalmente)
# Terminal 2: AI Observer (nuevo - solo observa y reporta)
cd packages/trader
SYMBOL=R_10,R_25,R_50,R_75,R_100 npx tsx src/scripts/run-ai-observer.ts
```

Al terminar, genera reporte completo:

- Threshold óptimo para tu estrategia
- Regímenes problemáticos (cuándo NO tradear)
- Distribución de calidad de señales
- Top 5 mejores/peores señales

📖 Ver: [AI_OBSERVER_GUIDE.md](./AI_OBSERVER_GUIDE.md) | [AI_ANALYSIS_SUMMARY.md](./AI_ANALYSIS_SUMMARY.md) | [AI_ANALYSIS_GUIDE.md](./AI_ANALYSIS_GUIDE.md)

## 🏗️ Arquitectura

Sistema modular con Gateway centralizado:

```
┌─────────┐      ┌─────────┐      ┌──────────┐
│ Web UI  │─────▶│ Gateway │─────▶│  Deriv   │
│(Charts) │      │  (WS)   │      │   API    │
└─────────┘      └─────────┘      └──────────┘
     │                │
┌─────────┐           ▼
│  REPL   │      ┌─────────┐
│ (CLI)   │      │ Trader  │
└─────────┘      │Strategy │
                 └─────────┘
```

**Nuevo**: 🎨 **Web UI Dashboard** con gráfico de velas en tiempo real, indicadores técnicos y marcadores de trades.

## 🚀 Quick Start

### Prerrequisitos
- Node.js >= 18
- pnpm >= 8


### Instalación

```bash
# Instalar pnpm
npm install -g pnpm

# Instalar dependencias
pnpm install

# Build shared package
pnpm --filter @deriv-bot/shared build
```

### Configuración

El archivo `.env` ya está configurado en el root:

```bash
DERIV_APP_ID=106646
DERIV_TOKEN=7He7yWbKh3vgmEY
DERIV_API_TOKEN=7He7yWbKh3vgmEY
DERIV_ENDPOINT=wss://ws.derivws.com/websockets/v3
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0
GATEWAY_URL=ws://localhost:3000
```

### Ejecutar el Sistema

#### 🎨 Opción 1: Web UI Dashboard (Recomendado)

Dashboard web con gráfico de velas en tiempo real:

```bash
# Script automático que inicia Gateway + Web UI
./start-dashboard.sh

# O manualmente:
# Terminal 1: Gateway
pnpm gateway

# Terminal 2: Web UI
pnpm web-ui
```

Abre tu navegador en: **http://localhost:5173**

Ver: [QUICKSTART_WEB_UI.md](./QUICKSTART_WEB_UI.md) para guía completa.

#### 🖥️ Opción 2: CLI/REPL (Terminal)

**Terminal 1 - Gateway:**
```bash
pnpm --filter @deriv-bot/gateway dev
```

**Terminal 2 - REPL:**
```bash
pnpm --filter @deriv-bot/cli dev
```

#### 🤖 Ejecutar Estrategia de Trading

Para ver trades automáticos (funciona con ambas opciones):

**Terminal 3:**
```bash
pnpm --filter @deriv-bot/trader demo
```

El sistema se conectará y comenzará a:
1. ✅ Obtener balance de cuenta demo
2. ✅ Cargar 100 candles históricas de R_75
3. ✅ Monitorear mercado en tiempo real
4. ✅ Generar señales con Mean Reversion strategy

## 📁 Estructura del Proyecto

```
deriv-bot/
├── docs/                    # 📚 Documentación completa (35 archivos)
├── packages/
│   ├── gateway/            # 🌐 Gateway - Conexión con Deriv API
│   │   ├── src/
│   │   │   ├── api/           # DerivClient (WebSocket)
│   │   │   ├── cache/         # Market data cache + candle builder
│   │   │   ├── events/        # Event bus
│   │   │   ├── handlers/      # Command handlers
│   │   │   └── ws/            # Gateway WebSocket server
│   │   └── prisma/         # Database schema (candles, ticks)
│   │
│   ├── trader/             # 🤖 Trading Bot + Strategies
│   │   └── src/
│   │       ├── client/        # GatewayClient
│   │       ├── indicators/    # RSI, Bollinger Bands, ATR
│   │       ├── strategies/    # Mean Reversion Strategy
│   │       ├── position/      # Position manager
│   │       ├── risk/          # Risk manager
│   │       └── scripts/       # run-mean-reversion-demo-v2.ts
│   │
│   ├── web-ui/             # 🎨 Web Dashboard (Nuevo!)
│   │   └── src/
│   │       ├── components/    # CandlestickChart, TradingDashboard
│   │       ├── hooks/         # useGatewayConnection
│   │       └── types/         # Type definitions
│   │
│   ├── cli/                # 🖥️  Terminal REPL Dashboard
│   │
│   └── shared/             # 📦 Shared types (Candle, Tick, Trade)
│
├── .env                    # ⚙️  Configuración (tokens, endpoints)
├── start-dashboard.sh      # 🚀 Script de inicio Web UI
└── README.md              # 📖 Este archivo
```

## 📚 Documentación

Toda la documentación está en [`/docs`](./docs):

- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - Arquitectura completa del sistema
- **[RUN_DEMO.md](./docs/RUN_DEMO.md)** - Guía para ejecutar el demo
- **[FINAL_STATUS.md](./docs/FINAL_STATUS.md)** - Estado actual del proyecto
- [DERIV_API_ANALYSIS.md](./docs/DERIV_API_ANALYSIS.md) - Análisis del API de Deriv


Ver todos los docs: [docs/INDEX.md](./docs/INDEX.md)

## 🧪 Testing

```bash
# Tests de todo el proyecto
pnpm test

# Tests con UI
pnpm test:ui

# Coverage
pnpm test:coverage

# Tests de un package específico
pnpm --filter @deriv-bot/gateway test
pnpm --filter @deriv-bot/trader test
```

## 🏗️ Build

```bash
# Build todo
pnpm build

# Build de un package específico
pnpm --filter @deriv-bot/gateway build
pnpm --filter @deriv-bot/trader build
```

## 📖 Scripts Útiles

### Gateway
```bash
pnpm --filter @deriv-bot/gateway dev      # Modo desarrollo (hot-reload)
pnpm --filter @deriv-bot/gateway build    # Build para producción
pnpm --filter @deriv-bot/gateway test     # Ejecutar tests
```

### Trader
```bash
pnpm --filter @deriv-bot/trader demo      # Demo Mean Reversion
pnpm --filter @deriv-bot/trader dev       # Modo desarrollo
pnpm --filter @deriv-bot/trader build     # Build para producción
```


## 🎯 Mean Reversion Strategy

### Parámetros Optimizados

- **RSI:** 14 períodos, thresholds 17/83
- **Bollinger Bands:** 20 períodos, 2.0 desviaciones estándar
- **ATR:** 14 períodos, multiplicador 1.0x para stop loss
- **Timeframe:** 1 minuto
- **Expiry:** 3 minutos
- **Money Management:** Progressive Anti-Martingale

### Condiciones de Señal

**CALL:**
- RSI < 17 (sobreventa extrema) O
- Precio < Banda Inferior de Bollinger

**PUT:**
- RSI > 83 (sobrecompra extrema) O
- Precio > Banda Superior de Bollinger

## 🔧 Desarrollo

### Agregar dependencia

```bash
# A gateway
pnpm --filter @deriv-bot/gateway add <package-name>

# A trader
pnpm --filter @deriv-bot/trader add <package-name>

# Dev dependency
pnpm --filter @deriv-bot/gateway add -D <package-name>
```

### Trabajar en shared package

```bash
# Rebuild después de cambios
pnpm --filter @deriv-bot/shared build

# Watch mode
pnpm --filter @deriv-bot/shared dev
```

## 🎯 Roadmap

### ✅ Completado
- [x] Arquitectura Gateway + Trader
- [x] Conexión con Deriv API (WebSocket)

- [x] Optimización Mean Reversion (63.87% WR, 54.09% ROI)
- [x] Implementación TypeScript de estrategia
- [x] Market data cache + candle builder
- [x] Historical candles loading (fix 100 candles)
- [x] Real-time tick streaming
- [x] Limpieza completa de código legacy

### 🔄 En Progreso
- [ ] State Manager (persistencia de trades/stats)
- [ ] Prisma models (Trade, DailyStats, Session)
- [ ] REPL con Ink (interfaz visual)

### 📋 Próximo
- [ ] Forward testing en demo (validación)
- [ ] Dashboard visual con stats
- [ ] Alertas y notificaciones
- [ ] Multi-asset support
- [ ] Web UI (opcional)

## 📝 Notas

- **Ambiente:** Demo (sin riesgo real)
- **Token configurado:** Con permisos de lectura + trading
- **App ID:** 106646
- **Gateway:** Puerto 3000 (WebSocket)
- **Código limpio:** ~20 archivos legacy eliminados

## 🤝 Contribuir

Este es un proyecto privado de desarrollo.

## 📄 Licencia

MIT
