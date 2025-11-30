# Trading Dashboard - Ink UI

Dashboard interactivo de monitoreo de trading construido con [Ink](https://github.com/vadimdemedes/ink) (React para terminales).

## Características

- ✨ **UI Moderna**: Interfaz basada en React con Ink para renderizado estable
- 📊 **Monitoreo en Tiempo Real**: Balance, posiciones abiertas, y proximidad de señales
- 🎯 **Multi-Asset**: Monitorea múltiples símbolos simultáneamente
- 📈 **Signal Proximity**: Visualiza qué tan cerca está cada asset de generar una señal
- ⚡ **Auto-Refresh**: Actualización automática cada 3 segundos
- 🎨 **Colores y Bordes**: UI limpia con colores y bordes redondeados
- ⌨️ **Comandos de Teclado**: Control interactivo del dashboard

## Instalación

Las dependencias ya están instaladas. El dashboard usa:
- `ink` - Framework React para terminales
- `react` 19.x - Para componentes React
- `@types/react` - Tipos TypeScript para React

## Uso

### Iniciar el Dashboard

```bash
# Terminal 1 - Iniciar Gateway
cd packages/gateway
pnpm start

# Terminal 2 - Iniciar Dashboard (en otra terminal)
cd packages/trader
SYMBOL="R_75,R_100" pnpm run dashboard
```

### Variables de Entorno

- `SYMBOL` - Símbolos a monitorear (separados por comas). Default: `R_75`
- `GATEWAY_URL` - URL del Gateway WebSocket. Default: `ws://localhost:3000`

### Comandos de Teclado

Una vez que el dashboard está corriendo:

- `q` - Salir del dashboard
- `r` - Refrescar datos manualmente
- `c` - Alternar entre modo compacto y completo
- `h` - Mostrar ayuda
- `Ctrl+C` - Salir del dashboard

## Arquitectura

```
┌─────────────────────────┐
│   DashboardApp (Ink)    │  ← Componente React principal
│   - Header              │
│   - AccountStatus       │
│   - OpenPositions       │
│   - SignalProximity     │
│   - Strategies          │
│   - MonitoredAssets     │
│   - Commands            │
└───────┬─────────────────┘
        │
        ├─ Fetch data cada 3s
        │
┌───────▼─────────────────┐
│  DashboardDataProvider  │  ← Proveedor de datos
│  - getBalance()         │
│  - getPositions()       │
│  - getStrategies()      │
│  - getSignalProximity() │
│  - getMonitoredAssets() │
└───────┬─────────────────┘
        │
        ├─────────────┬──────────────┐
        │             │              │
┌───────▼───────┐ ┌──▼──────┐ ┌────▼────────┐
│ GatewayClient │ │ Strategy│ │ StrategyEng │
│               │ │ Engine  │ │             │
└───────────────┘ └─────────┘ └─────────────┘
```

## Componentes

### Componentes UI (packages/trader/src/dashboard/components/)

- **Header.tsx** - Encabezado del dashboard
- **AccountStatus.tsx** - Estado de la cuenta (balance, loginid)
- **OpenPositions.tsx** - Posiciones abiertas con P&L en tiempo real
- **SignalProximity.tsx** - Proximidad de señales con barra de progreso
- **Strategies.tsx** - Estrategias activas
- **MonitoredAssets.tsx** - Assets monitoreados con precios en tiempo real
- **Commands.tsx** - Comandos de teclado disponibles

### Lógica (packages/trader/src/dashboard/)

- **DashboardApp.tsx** - Componente React principal con Ink
- **dashboard-data-provider.ts** - Proveedor de datos que conecta con Gateway/Engine
- **dashboard.ts** (legacy) - Dashboard anterior (ASCII manual)

## Vista del Dashboard

```
╭────────────────────────────────────────────────────────╮
│ 🚀 DERIV BOT TRADING DASHBOARD                         │
╰────────────────────────────────────────────────────────╯

╭─ 📊 ACCOUNT STATUS ────╮  ╭─ 📈 OPEN POSITIONS (2) ───╮
│ Account: VRTC123 (DEMO)│  │ 🟢 R_75 CALL @ 245.32     │
│ Balance: $9,876.54 USD │  │    +$12.45 (+5.23%)       │
│                        │  │    Entry: 244.10          │
│ Last Update: 10:45:23  │  │                           │
╰────────────────────────╯  │ 🔴 R_100 PUT @ 512.10     │
                            │    -$3.20 (-1.45%)        │
╭─ 🎯 STRATEGIES (1) ────╮  │    Entry: 515.30          │
│ ✓ RSI + BB Scalping    │  ╰───────────────────────────╯
│   Assets: R_75, R_100  │
│   Status: ACTIVE       │  ╭─ 📡 SIGNAL PROXIMITY ─────╮
│   Signals: 5 today     │  │ R_75: ████████░░░░ 80%    │
╰────────────────────────╯  │   ✓ RSI Oversold          │
                            │   ✓ Below BB Lower        │
╭─ 📊 MONITORED ASSETS ─╮  │                           │
│ R_75: 245.32 ▲ +0.5%  │  │ R_100: ███░░░░░░░░ 30%    │
│ R_100: 512.10 ▼ -0.3% │  │   ✗ RSI Not Overbought    │
╰────────────────────────╯  ╰───────────────────────────╯

╭─ ⌨️ COMMANDS ──────────╮
│ q - Quit               │
│ r - Refresh            │
│ c - Compact mode       │
│ h - Help               │
╰────────────────────────╯

💡 This dashboard monitors only - does NOT execute trades.
```

## Migración desde Dashboard Anterior

El dashboard anterior usaba renderizado ASCII manual con ANSI escape codes, lo que causaba:
- Caracteres corruptos
- Layout desalineado
- Difícil de mantener

El nuevo dashboard con Ink ofrece:
- ✅ Renderizado estable usando React
- ✅ Layouts flexibles con Flexbox
- ✅ Manejo automático de actualizaciones
- ✅ Componentes reutilizables
- ✅ Mejor manejo de errores

## Troubleshooting

### Error: "Raw mode is not supported"

Este error ocurre cuando se ejecuta el dashboard en background o sin TTY.
Siempre ejecuta el dashboard en una terminal interactiva:

```bash
# ✅ Correcto
pnpm run dashboard

# ❌ Incorrecto (en background)
pnpm run dashboard &
```

### Dashboard no se actualiza

Verifica que el Gateway esté corriendo:

```bash
lsof -i:3000
# Debería mostrar un proceso en el puerto 3000
```

### Posiciones no aparecen

El dashboard usa caché de 3 segundos para evitar rate limits del API.
Espera unos segundos o presiona `r` para refrescar manualmente.

## Desarrollo

### Agregar un nuevo componente

1. Crear el componente en `src/dashboard/components/`
2. Importarlo en `DashboardApp.tsx`
3. Agregarlo al layout con `<Box>` y props de Ink

Ejemplo:

```tsx
// src/dashboard/components/NewComponent.tsx
import React from 'react';
import { Box, Text } from 'ink';

export const NewComponent: React.FC = () => {
  return (
    <Box borderStyle="round" borderColor="blue" paddingX={1}>
      <Text bold color="blue">🚀 NEW FEATURE</Text>
    </Box>
  );
};
```

### Agregar nueva fuente de datos

1. Agregar método en `DashboardDataProvider`
2. Agregar al type `DashboardData`
3. Llamar en `fetchAll()`
4. Usar en componente UI

## Referencias

- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [React Documentation](https://react.dev/)
- [Gateway Client API](../gateway/README.md)

## Notas Importantes

- **El dashboard solo monitorea** - NO ejecuta trades
- Para ejecutar trades, usa el trader: `pnpm run trader:rsi-bb`
- El dashboard puede correr simultáneamente con el trader
- Ambos se conectan al mismo Gateway
