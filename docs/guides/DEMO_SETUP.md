# 🚀 Ejecutar Mean Reversion Strategy en Demo

## 📋 Prerequisitos

1. **Token de Deriv Demo Account**
   - Ve a https://app.deriv.com/account/api-token
   - Crea un token con permisos de `Trading` y `Admin` (solo para cuenta demo)
   - Copia el token

2. **Archivo .env**
   - Crea un archivo `.env` en la raíz del proyecto (`/deriv-bot/.env`)
   - Agrega tu token:

```bash
DERIV_APP_ID=1089
DERIV_TOKEN=tu_token_aqui
```

⚠️ **IMPORTANTE**: El script usa `DERIV_TOKEN`, no `DERIV_API_TOKEN`

## 🏃 Ejecutar

Desde la raíz del proyecto:

```bash
cd packages/trader
pnpm tsx src/scripts/run-mean-reversion-demo.ts
```

O usa el script npm:

```bash
pnpm --filter @deriv-bot/trader run demo
```

## 📊 Qué hace el script

1. **Conecta** a Deriv API con tu token
2. **Autoriza** y muestra tu balance
3. **Inicia** la estrategia Mean Reversion (RSI 17/83, BB 20/2.0, ATR 1.0x)
4. **Monitorea** el mercado R_75 en tiempo real
5. **Ejecuta trades** automáticamente cuando detecta señales
6. **Aplica** Progressive Anti-Martingale money management
7. **Muestra** estadísticas en tiempo real (Win Rate, ROI, Balance)

## ⚙️ Parámetros de la Estrategia

Los parámetros ya están optimizados según el Test #5 del backtesting:

- **RSI**: 14 períodos, oversold 17, overbought 83
- **Bollinger Bands**: 20 períodos, 2.0 desviaciones estándar
- **ATR**: 14 períodos, multiplicador 1.0x
- **Cooldown**: 2 minutos entre trades
- **Expiry**: 3 minutos por contrato
- **Stake**: 1% del balance por trade
- **Anti-Martingale**: Win streak máximo 2, Loss streak máximo 3

## 📈 Performance Esperado (según Backtest)

- **Win Rate**: 63.87%
- **ROI**: 54.09%
- **Promedio Win**: $7.12
- **Max Drawdown**: Muy bajo (0% en backtest)

## 🛑 Detener

Presiona `Ctrl+C` para detener el bot. Se mostrará un resumen de la sesión:

- Total trades ejecutados
- Wins / Losses
- Win Rate
- Balance final
- ROI de la sesión

## ⚠️ Advertencias

- **Solo para cuenta DEMO**: No uses tu token de cuenta real
- **Capital de riesgo**: Empieza con balance de prueba pequeño ($1000-$10000)
- **Monitoreo**: Supervisa las primeras horas de trading
- **Internet estable**: Asegúrate de tener buena conexión
- **No cerrar**: Deja el script corriendo, no lo interrumpas durante un trade activo

## 🔧 Troubleshooting

### Error: "DERIV_TOKEN no encontrado"
Crea el archivo `.env` con tu token

### Error: "api.subscribe is not a function"
Asegúrate de tener la última versión instalada:
```bash
pnpm install
```

### No se ejecutan trades
- Verifica que la estrategia esté detectando señales (mira los logs)
- La estrategia es conservadora, puede tardar en encontrar setups óptimos
- R_75 tiene períodos de baja volatilidad donde no hay señales

### Balance no actualiza
El script usa un balance simulado interno. Para ver tu balance real de Deriv, ve a https://app.deriv.com

## 📝 Notas

- El script construye candles de 1 minuto desde los ticks en tiempo real
- Necesita al menos 30 candles (~30 minutos) antes de generar señales
- Cada trade tiene 3 minutos de expiración
- El Progressive Anti-Martingale aumenta stake en wins, reduce en losses
