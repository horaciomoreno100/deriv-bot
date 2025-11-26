# 🚀 Quickstart - Web UI con Gráfico de Velas en Tiempo Real

Este documento te guía paso a paso para ver el dashboard web con gráfico de velas en tiempo real.

## ¿Qué vas a ver?

Un dashboard web profesional con:
- ✅ **Gráfico de velas (candlestick)** actualizándose en tiempo real
- ✅ **Indicadores técnicos** (RSI, Bollinger Bands, ATR) dibujados sobre el chart
- ✅ **Marcadores de entrada/salida** cuando se ejecutan trades
- ✅ **Panel de estadísticas** del día (trades, wins, losses, P&L)
- ✅ **Precio en vivo** del asset

## Pre-requisitos

1. **Node.js 18+** y **pnpm** instalados
2. **Cuenta de Deriv** con API token configurado
3. **Gateway configurado** con tu Deriv API token

## Paso 1: Configurar Deriv API Token

Si no lo hiciste aún, crea un `.env` en la raíz del proyecto:

```bash
# .env
DERIV_API_TOKEN=tu_token_aqui
DERIV_APP_ID=1089
```

Para obtener tu token:
1. Ve a https://app.deriv.com/account/api-token
2. Crea un nuevo token con permisos de **Read**, **Trade**, y **Admin**
3. Copia el token al `.env`

## Paso 2: Instalar Dependencias

```bash
# Desde la raíz del proyecto
pnpm install
```

## Paso 3: Iniciar el Gateway

El Gateway se conecta a Deriv y expone un WebSocket para el frontend:

```bash
pnpm gateway
```

Deberías ver:
```
[Gateway] Server started on ws://localhost:3000
[DerivClient] Connected to Deriv API
[DerivClient] Authorized successfully
```

**Deja esta terminal abierta** ✅

## Paso 4: Iniciar el Web UI

En una **nueva terminal**:

```bash
pnpm web-ui
```

Deberías ver:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

## Paso 5: Abrir en el Navegador

Abre tu navegador en: **http://localhost:5173**

Deberías ver:
- ✅ Header con "● Connected" en verde
- ✅ Precio del asset actualizándose
- ✅ Gráfico de velas cargando datos iniciales
- ✅ Panel lateral con stats (probablemente en 0 si no hay trades)

## 🎉 ¡Listo! Ya tenés el dashboard funcionando

### ¿Qué hace cada componente?

```
┌─────────────┐
│  Deriv API  │ ← Proveedor de datos de mercado
└──────┬──────┘
       │
       ↓ WebSocket
┌─────────────┐
│   Gateway   │ ← Servidor intermedio (ws://localhost:3000)
└──────┬──────┘
       │
       ↓ WebSocket
┌─────────────┐
│   Web UI    │ ← Dashboard en tu navegador (http://localhost:5173)
└─────────────┘
```

## Paso Opcional: Ejecutar Trader con Estrategia

Si querés ver **trades en vivo** con marcadores de entrada/salida en el chart:

**Terminal 3**:
```bash
# Ejecutar estrategia Mean Reversion
pnpm --filter @deriv-bot/trader demo
```

Esto ejecutará trades automáticamente y verás:
- 🟢 Flechas verdes/rojas cuando entra una orden
- 💰 Marcadores de salida con WIN/LOSS y el profit

## 🎯 Cambiar el Asset

Por defecto está en `R_100`. Para cambiar a otro asset:

1. Edita `packages/web-ui/src/App.tsx`
2. Cambia la línea:
   ```tsx
   const [asset] = useState('R_100'); // ← Cambia a R_75, CRASH300N, etc.
   ```
3. El dashboard se recargará automáticamente (hot reload)

## 🐛 Troubleshooting

### "● Disconnected" en rojo

**Problema**: El Web UI no puede conectarse al Gateway.

**Solución**:
1. Verifica que el Gateway esté corriendo: `pnpm gateway`
2. Revisa que esté en `ws://localhost:3000`
3. Mira los logs del Gateway

### "Loading chart data..." se queda cargando

**Problema**: No se cargan las velas.

**Solución**:
1. Abre la consola del navegador (F12)
2. Busca errores de WebSocket o requests
3. Verifica que el asset exista en Deriv (ej: R_100, R_75, etc.)
4. Revisa los logs del Gateway

### No veo indicadores

**Problema**: Los indicadores no aparecen en el chart.

**Solución**:
1. Los indicadores solo se muestran si hay una estrategia corriendo que los envíe
2. Ejecuta el Trader: `pnpm --filter @deriv-bot/trader demo:mean-reversion`
3. Los indicadores se actualizan cuando la estrategia calcula RSI, BB, etc.

## 📊 Arquitectura Rápida

```
packages/
├── gateway/         ← WebSocket server que habla con Deriv API
├── trader/          ← Estrategias de trading (opcional para ver trades)
├── web-ui/          ← Dashboard React que visualiza todo
├── shared/          ← Types compartidos
└── cli/             ← REPL en terminal (alternativa al web-ui)
```

## 🚧 Próximos Pasos

Algunas ideas para mejorar el dashboard:

- [ ] Selector de assets (dropdown)
- [ ] Selector de timeframes (1m, 5m, 15m)
- [ ] Herramientas de dibujo (líneas, soportes)
- [ ] Panel de órdenes activas
- [ ] Alertas visuales para señales
- [ ] Modo dark/light
- [ ] Export de trades a CSV

## 📚 Más Documentación

- [Web UI README](./packages/web-ui/README.md) - Detalles técnicos del frontend
- [Gateway README](./packages/gateway/README.md) - API del Gateway
- [Trader README](./packages/trader/README.md) - Estrategias de trading

---

**¿Preguntas?** Abre un issue en el repo o revisa los logs de cada componente.
