# Changelog - Web UI

## [0.1.0] - 2025-10-18

### 🎉 Initial Release

**Nuevo package `@deriv-bot/web-ui`** - Dashboard web en tiempo real para visualización de trading.

### Características

#### 📊 Gráfico de Velas (Candlestick Chart)
- Gráfico de velas en tiempo real usando **Lightweight Charts**
- Actualización automática con cada nuevo tick
- Soporte para múltiples timeframes (actualmente 1m)
- Zoom y navegación del chart
- Auto-scroll a la última vela

#### 📈 Indicadores Técnicos
- **RSI** (Relative Strength Index)
- **Bandas de Bollinger** (Upper, Middle, Lower)
- **ATR** (Average True Range)
- Dibujados como overlays sobre el chart
- Actualización en tiempo real desde la estrategia

#### 🎯 Marcadores de Trading
- **Marcadores de entrada** (flechas verde/roja) cuando se ejecuta un trade
- **Marcadores de salida** con resultado (WIN/LOSS) y profit/loss
- Color-coding: verde para CALL/WIN, rojo para PUT/LOSS

#### 📱 Dashboard Layout
- **Header**: Estado de conexión, asset, precio en vivo, balance
- **Chart principal**: Ocupa la mayor parte de la pantalla
- **Panel lateral**: Stats del día e indicadores actuales
- Diseño responsive y profesional

#### 🔌 Conexión WebSocket
- Hook personalizado `useGatewayConnection` para comunicación con Gateway
- Auto-reconexión en caso de desconexión
- Escucha eventos en tiempo real:
  - `tick` - Actualiza precio
  - `candle_update` - Actualiza vela actual
  - `candle_closed` - Vela cerrada
  - `indicators` - Actualiza indicadores
  - `trade:executed` - Marca entrada
  - `trade:result` - Marca salida

#### 🎨 UI/UX
- **Dark theme** profesional (negro/gris)
- **Color scheme** consistente con trading apps
- **Font monospace** para números
- Estados de loading claros
- Indicadores de conexión visual

### Stack Técnico
- **React 18** - Framework UI
- **TypeScript** - Type safety
- **Vite** - Build tool y dev server
- **Lightweight Charts 4.x** - Gráficos financieros
- **WebSocket** - Comunicación en tiempo real
- **CSS Modules** - Estilos scoped

### Archivos Creados
```
packages/web-ui/
├── src/
│   ├── components/
│   │   ├── CandlestickChart.tsx      # Componente del gráfico
│   │   ├── CandlestickChart.css
│   │   ├── TradingDashboard.tsx      # Dashboard principal
│   │   └── TradingDashboard.css
│   ├── hooks/
│   │   └── useGatewayConnection.ts   # Hook para WebSocket
│   ├── types/
│   │   └── shared.d.ts               # Type definitions
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
└── CHANGELOG.md
```

### Scripts Disponibles
- `pnpm dev` - Inicia servidor de desarrollo (http://localhost:5173)
- `pnpm build` - Build para producción
- `pnpm preview` - Preview del build

### Uso
```bash
# Terminal 1: Gateway
pnpm gateway

# Terminal 2: Web UI
pnpm web-ui

# Abre: http://localhost:5173
```

### Configuración
- **Gateway URL**: `ws://localhost:3000` (hardcoded en App.tsx)
- **Asset default**: `R_100` (configurable en App.tsx)
- **Timeframe**: 1 minuto (60 segundos)
- **Candles mostradas**: Últimas 200

### Próximas Mejoras
- [ ] Selector de assets (dropdown)
- [ ] Selector de timeframes (1m, 5m, 15m, 1h)
- [ ] Herramientas de dibujo (líneas, soportes, resistencias)
- [ ] Panel de órdenes activas
- [ ] Historial de trades con filtros
- [ ] Alertas visuales para señales
- [ ] Configuración de conexión en UI
- [ ] Modo dark/light toggle
- [ ] Export de datos a CSV
- [ ] Múltiples charts en split view

### Notas Técnicas
- Las velas se mantienen en memoria (últimas 200)
- Los indicadores vienen del Gateway (calculados por la estrategia)
- Los marcadores de trades se persisten en estado local
- El chart usa el timestamp de las velas para el eje X
- Auto-scroll mantiene la vista en la última vela

### Compatibilidad
- **Browsers**: Chrome, Firefox, Safari, Edge (últimas versiones)
- **Node**: >= 18.0.0
- **Gateway**: Requiere Gateway v0.1.0+
- **Shared**: Requiere @deriv-bot/shared v0.1.0+
