# Deriv Bot CLI - Dashboard

Dashboard en tiempo real para monitorear el trading bot.

## Uso

El dashboard se conecta al Gateway para mostrar datos en tiempo real. **Gateway y Trader deben estar corriendo en terminales separadas**.

### 1. Iniciar Gateway

```bash
pnpm --filter @deriv-bot/gateway dev
```

### 2. Iniciar Trader (opcional)

```bash
pnpm --filter @deriv-bot/trader demo
```

### 3. Iniciar Dashboard

```bash
pnpm --filter @deriv-bot/cli dashboard
```

El dashboard mostrará:
- 📊 Precio actual y último update
- 💰 Balance y P&L del día
- 🎯 Indicadores (RSI, BB, ATR)
- 🔔 Proximidad a señales de trading
- 📊 Estadísticas del día

## Controles

- `q` - Salir del dashboard

## Notas

- El dashboard es solo de visualización, no controla los procesos
- Si Gateway no está corriendo, mostrará un error de conexión
- El balance viene de Deriv API (puede ser $0 en cuentas demo sin fondos)
