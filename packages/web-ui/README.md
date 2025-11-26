# Web UI - Live Trading Dashboard

Dashboard web en tiempo real para visualizar operaciones de trading con gráficos de velas, indicadores y estadísticas.

## 🎯 Características

- **Gráfico de velas en tiempo real** usando Lightweight Charts
- **Indicadores técnicos** (RSI, Bollinger Bands, ATR)
- **Marcadores de entrada/salida** de trades
- **Panel de estadísticas** del día
- **Conexión WebSocket** directa al Gateway

## 🚀 Inicio Rápido

### Pre-requisitos

1. **Gateway debe estar corriendo** en `ws://localhost:3000`:
   ```bash
   pnpm --filter gateway dev
   ```

2. **(Opcional) Trader con estrategia activa** para ver trades en vivo:
   ```bash
   pnpm --filter trader demo
   ```

### Ejecutar Web UI

```bash
# Desde la raíz del proyecto
pnpm --filter web-ui dev

# O desde este directorio
cd packages/web-ui
pnpm dev
```

Abre tu navegador en: **http://localhost:5173**

## 📊 ¿Qué vas a ver?

### Header
- **Estado de conexión** al Gateway (Connected/Disconnected)
- **Asset actual** (ej: R_100)
- **Precio en tiempo real**
- **Balance de cuenta**

### Gráfico Principal
- **Velas de 1 minuto** actualizándose en tiempo real
- **Bandas de Bollinger** dibujadas sobre las velas
- **Marcadores de entrada** (flechas verdes/rojas) cuando se ejecuta un trade
- **Marcadores de salida** con resultado (WIN/LOSS) y profit/loss

### Panel Lateral (Stats)
- **Today's Stats**: Trades, Wins, Losses, Win Rate, Net P&L
- **Indicators**: Valores actuales de RSI, BB, ATR

## 🔌 Conexión al Gateway

El dashboard se conecta automáticamente al Gateway via WebSocket y:

1. **Subscribe al asset** (default: R_100)
2. **Carga 100 velas iniciales** de historial
3. **Escucha eventos en tiempo real**:
   - `tick` - Actualiza precio
   - `candle_update` - Actualiza vela actual
   - `candle_closed` - Vela cerrada
   - `indicators` - Actualiza indicadores
   - `trade:executed` - Marca entrada de trade
   - `trade:result` - Marca salida de trade

## 🎨 Tecnologías

- **React 18** - Framework UI
- **Vite** - Build tool
- **Lightweight Charts** - Gráficos financieros de TradingView
- **TypeScript** - Type safety
- **WebSocket** - Comunicación en tiempo real

## 🛠️ Desarrollo

### Cambiar Asset

Edita `src/App.tsx`:
```tsx
const [asset] = useState('R_75'); // Cambia a R_75, CRASH300N, etc.
```

### Cambiar Gateway URL

Edita `src/App.tsx`:
```tsx
const [gatewayUrl] = useState('ws://your-gateway-url:3000');
```

### Estructura de Archivos

```
web-ui/
├── src/
│   ├── components/
│   │   ├── CandlestickChart.tsx     # Componente del gráfico
│   │   ├── CandlestickChart.css
│   │   ├── TradingDashboard.tsx     # Dashboard principal
│   │   └── TradingDashboard.css
│   ├── hooks/
│   │   └── useGatewayConnection.ts  # Hook para WebSocket
│   ├── types/
│   │   └── shared.d.ts              # Type definitions
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
└── vite.config.ts
```

## 🐛 Troubleshooting

### "Cannot connect to Gateway"
- Verifica que el Gateway esté corriendo en `ws://localhost:3000`
- Revisa la consola del navegador para errores de WebSocket

### "No chart data"
- Espera unos segundos para que se carguen las velas iniciales
- Verifica que el asset esté disponible en Deriv

### Las velas no se actualizan
- Verifica que el Gateway esté recibiendo ticks de Deriv
- Revisa los logs del Gateway (`pnpm --filter gateway dev`)

## 🚧 Próximas Mejoras

- [ ] Selector de assets (dropdown)
- [ ] Selector de timeframes (1m, 5m, 15m, etc.)
- [ ] Dibujos en el chart (líneas, soportes, resistencias)
- [ ] Panel de órdenes activas
- [ ] Historial de trades con filtros
- [ ] Modo dark/light
- [ ] Alertas visuales para señales
- [ ] Export de datos a CSV

## 📝 Notas

- Las velas se mantienen en memoria (últimas 200)
- Los indicadores se actualizan cuando la estrategia los envía al Gateway
- Los marcadores de trades se persisten en memoria del frontend
