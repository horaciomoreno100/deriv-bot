# 🚀 Ejecutar Trading Bot en Demo

## 📋 Resumen

Este proyecto tiene una **estrategia Mean Reversion optimizada** lista para trading en vivo:

- **Win Rate**: 63.87% (según backtest de 90 días)
- **ROI**: 54.09%
- **Profit**: $540.92 sobre $1000 inicial
- **Trades**: 119 trades en 3 meses
- **Parámetros**: RSI 17/83, BB 20/2.0, ATR 1.0x
- **Money Management**: Progressive Anti-Martingale

## 🏗️ Arquitectura

```
Deriv API ←→ Gateway ←→ Trader (Mean Reversion Strategy)
```

- **Gateway**: Se conecta a Deriv API WebSocket y expone servidor en `ws://localhost:3000`
- **Trader**: Se conecta al Gateway y ejecuta la estrategia Mean Reversion

## ✅ Configuración

El archivo `.env` ya está configurado con tu token:

```bash
DERIV_APP_ID=106646
DERIV_TOKEN=7He7yWbKh3vgmEY
DERIV_API_TOKEN=7He7yWbKh3vgmEY  # Necesario para el Gateway
DERIV_ENDPOINT=wss://ws.derivws.com/websockets/v3
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0
GATEWAY_URL=ws://localhost:3000
```

## 🎯 Opción 1: Trading Automático (Gateway + Trader)

### Paso 1: Iniciar el Gateway

En una terminal:

```bash
cd /Users/hmoreno/Documents/Development/deriv-bot
pnpm --filter @deriv-bot/gateway dev
```

Deberías ver:

```
✨ Gateway is ready!
[DerivClient] Authorized successfully
```

⚠️ **IMPORTANTE**: Si no ves `Authorized successfully`, el token está mal o expiró.

### Paso 2: Iniciar el Trader con Mean Reversion

En **otra terminal** (mientras el Gateway sigue corriendo):

```bash
cd /Users/hmoreno/Documents/Development/deriv-bot
pnpm --filter @deriv-bot/trader demo
```

El Trader:
1. ✅ Se conecta al Gateway
2. ✅ Se suscribe a R_75
3. ✅ Recibe ticks en tiempo real
4. ✅ Construye candles de 1 minuto
5. ⏰ Necesita ~30 candles (30 minutos) antes de generar señales
6. 🎯 Ejecuta trades cuando detecta RSI < 17 o RSI > 83 + Bollinger Bands
7. 💰 Aplica Progressive Anti-Martingale (aumenta stake en wins, reduce en losses)

### Qué esperar:

Después de ~30 minutos verás:

```
📈 Candle #30 completada
🎯 SEÑAL DETECTADA
   Tipo: CALL
   Confianza: 85.0%
   RSI: 16.82
   Price: 73145.23

📊 TRADE #1
   Direction: CALL
   Stake: $100.00
   ✅ WON: +$95.00
   Balance: $10095.00
   Win Rate: 100.00%
   ROI: 0.95%
```

### Detener:

Presiona `Ctrl+C` en el Trader para ver el resumen de la sesión. Luego `Ctrl+C` en el Gateway.

## 🎨 Opción 2: REPL Interactivo (para análisis manual)

Para ver el mercado en tiempo real SIN ejecutar trades automáticos:

```bash
cd /Users/hmoreno/Documents/Development/deriv-bot
pnpm --filter @deriv-bot/trader repl
```

El REPL te permite:
- Ver candles en tiempo real
- Ver indicadores (RSI, Bollinger Bands, ATR)
- Analizar proximidad de señales
- Ejecutar trades manualmente
- Ver balance y estadísticas

**Comandos del REPL:**
- `status` - Ver estado actual del mercado
- `indicators` - Ver valores de RSI, BB, ATR
- `signals` - Ver proximidad de señales CALL/PUT
- `trade CALL` - Ejecutar trade CALL manual
- `trade PUT` - Ejecutar trade PUT manual
- `balance` - Ver balance actual
- `history` - Ver historial de trades
- `exit` - Salir

## 🔧 Troubleshooting

### Error: "Please log in"

El Gateway no se autorizó. Verifica:
1. Token correcto en `.env` (variable `DERIV_API_TOKEN`)
2. Token no expirado (crea uno nuevo en https://app.deriv.com/account/api-token)
3. Token con permisos de `Trading` y `Admin`

### No llegan ticks

1. Verifica que el Gateway muestre `[DerivClient] Authorized successfully`
2. Verifica que el Trader muestre `✅ Suscrito a R_75`
3. Espera 1-2 minutos, a veces los ticks tardan

### Gateway se reinicia constantemente

Si usas `tsx watch`, cualquier cambio en archivos reinicia el servidor. Para evitarlo, usa:

```bash
pnpm --filter @deriv-bot/gateway start  # Sin watch mode
```

Pero primero debes compilar:

```bash
pnpm --filter @deriv-bot/gateway build
```

### Trader dice "Connection closed"

El Gateway se cayó o reinició. Vuelve a iniciar ambos procesos.

## 📊 Performance Esperado

Según el backtest con 90 días de datos reales de R_75:

| Métrica | Valor |
|---------|-------|
| Win Rate | 63.87% |
| ROI | 54.09% |
| Total Profit | $540.92 |
| Total Trades | 119 |
| Avg Win | $7.12 |
| Max Drawdown | 0% (muy bajo) |
| Duración | 89 días |
| Symbol | R_75 (Volatility 75 Index) |
| Timeframe | 1 minuto |
| Expiry | 3 minutos |

## ⚠️ Advertencias

- **Solo cuenta DEMO**: Este token es para cuenta demo, no uses tokens de cuenta real
- **Capital de riesgo**: Empieza con balance de prueba pequeño
- **Monitoreo**: Supervisa las primeras horas de trading
- **Internet estable**: Asegúrate de tener buena conexión
- **No cerrar durante trades**: Deja el script corriendo, no lo interrumpas durante un trade activo (3 minutos)
- **Warm-up time**: La estrategia necesita 30 candles (~30 minutos) antes de generar señales

## 🎓 Estrategia

### Mean Reversion (Test #5 - Optimizado)

**Concepto**: Cuando el precio se desvía mucho de su media (sobrecomprado o sobrevendido), tiende a volver.

**Señales CALL** (precio muy bajo, esperamos que suba):
- RSI < 17 (extremadamente sobrevendido)
- Precio cerca o debajo de Bollinger Band inferior
- ATR confirma volatilidad adecuada

**Señales PUT** (precio muy alto, esperamos que baje):
- RSI > 83 (extremadamente sobrecomprado)
- Precio cerca o arriba de Bollinger Band superior
- ATR confirma volatilidad adecuada

**Money Management - Progressive Anti-Martingale**:
- **Win**: Aumenta stake sumando el profit (stake + profit)
- **Loss**: Reduce stake a la mitad (stake / 2)
- **Max Win Streak**: 2 (luego resetea)
- **Max Loss Streak**: 3 (luego resetea)
- **Cooldown**: 2 minutos entre trades

**Indicadores**:
- RSI: 14 períodos
- Bollinger Bands: 20 períodos, 2.0 desviaciones estándar
- ATR: 14 períodos, multiplicador 1.0x

## 📝 Archivos Importantes

- [packages/trader/DEMO_SETUP.md](packages/trader/DEMO_SETUP.md) - Setup detallado del Trader
- [packages/binary_backtester/README.md](packages/binary_backtester/README.md) - Backtest Python
- [ARCHITECTURE.md](ARCHITECTURE.md) - Arquitectura completa del sistema
- [FORWARD_TESTING_GUIDE.md](FORWARD_TESTING_GUIDE.md) - Guía de forward testing

## 🐛 Debug Mode

Para ver logs más detallados:

**Gateway con logs:**
```bash
cd /Users/hmoreno/Documents/Development/deriv-bot
DEBUG=* pnpm --filter @deriv-bot/gateway dev
```

**Trader con logs:**
```bash
cd /Users/hmoreno/Documents/Development/deriv-bot
DEBUG=* pnpm --filter @deriv-bot/trader demo
```

## 🚀 Next Steps

1. **Ejecutar en demo** - Probar el sistema completo por 1-2 días
2. **Monitorear performance** - Comparar con backtest (63.87% WR esperado)
3. **Ajustar si es necesario** - Modificar parámetros si el WR está muy bajo
4. **Forward testing** - Documentar resultados durante 1-2 semanas
5. **Decidir si ir a real** - Solo si los resultados en demo son consistentes

## 📞 Soporte

Si encontrás problemas:

1. Verificá los logs del Gateway y Trader
2. Revisá el troubleshooting arriba
3. Verificá que el token sea válido y tenga permisos
4. Probá cerrar todo y reiniciar desde cero

---

✨ **Sistema listo para usar!** El backtest ya mostró resultados prometedores. Ahora es momento de probar en tiempo real.
