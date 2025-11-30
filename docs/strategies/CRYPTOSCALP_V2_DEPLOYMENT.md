# 🚀 Deployment: CryptoScalp v2 Optimized

## Resumen

Deploy de la estrategia **CryptoScalp v2 Optimized** con presets optimizados para ETH y BTC.

## 📊 Resultados del Backtest

### ETH (cryETHUSD)
- **Net PnL**: $10,949 (+833% vs BASE)
- **Profit Factor**: 1.43
- **Win Rate**: 50%
- **Max Drawdown**: 10.3%
- **Trades**: 2,830

### BTC (cryBTCUSD)
- **Net PnL**: $3,847 (de -$93 a +$3,847)
- **Profit Factor**: 1.27
- **Win Rate**: 51%
- **Max Drawdown**: 12.4%
- **Trades**: 2,961

## ⚙️ Configuración

### Variables de Entorno

```bash
# Asset a tradear (cryETHUSD o cryBTCUSD)
SYMBOL=cryETHUSD

# Modo de trading (cfd o binary)
TRADE_MODE=cfd

# Capital inicial
INITIAL_CAPITAL=10000

# Asignación para esta estrategia
STRATEGY_ALLOCATION=1000

# Porcentaje de riesgo por trade
RISK_PERCENTAGE=0.03

# Gateway URL
GATEWAY_WS_URL=ws://localhost:3000

# Account Login ID (opcional)
ACCOUNT_LOGINID=your_login_id
```

## 🚀 Ejecución Local

### Opción 1: Demo Mode (Recomendado para pruebas)

```bash
cd packages/trader

# Para ETH
SYMBOL=cryETHUSD STRATEGY_ALLOCATION=1000 pnpm demo:crypto-scalp-v2

# Para BTC
SYMBOL=cryBTCUSD STRATEGY_ALLOCATION=1000 pnpm demo:crypto-scalp-v2
```

### Opción 2: Múltiples Assets

```bash
SYMBOL="cryETHUSD,cryBTCUSD" STRATEGY_ALLOCATION=2000 pnpm demo:crypto-scalp-v2
```

## 📋 Presets Optimizados

### ETH Optimized Preset
- **MTF Filter**: Habilitado (15m EMA 50)
- **Zombie Killer**: Habilitado (15 bars, 0.05% min, solo si revierte)
- **BB Upper/Lower Exit**: Habilitado (0.05% min PnL)
- **TP**: 0.5%
- **SL**: 0.2%

### BTC Optimized Preset
- **MTF Filter**: Habilitado (15m EMA 50)
- **Zombie Killer**: Habilitado (15 bars, 0.1% min)
- **BB Upper/Lower Exit**: NO habilitado (empeora resultados)
- **TP**: 0.5%
- **SL**: 0.2%

## 🔧 Deployment en Servidor

### 1. Deploy del Código

```bash
# Desde tu máquina local
cd /Users/hmoreno/Documents/Development/deriv-bot

# Hacer commit de los cambios
git add .
git commit -m "feat: deploy CryptoScalp v2 optimized strategy"

# Deploy al servidor
pnpm deploy
```

O manualmente:

```bash
# Push al repositorio
git push origin main

# SSH al servidor
ssh root@tu-servidor-ip

# En el servidor
cd /opt/apps/deriv-bot
git pull origin main
pnpm install
pnpm build
```

### 2. Configurar PM2

```bash
# SSH al servidor
ssh root@tu-servidor-ip
cd /opt/apps/deriv-bot

# Iniciar CryptoScalp v2 para ETH
pm2 start "pnpm" --name "trader-crypto-scalp-v2-eth" -- \
  --filter "@deriv-bot/trader" "demo:crypto-scalp-v2" \
  --cwd /opt/apps/deriv-bot \
  --env SYMBOL=cryETHUSD \
  --env STRATEGY_ALLOCATION=1000 \
  --env TRADE_MODE=cfd

# Iniciar CryptoScalp v2 para BTC
pm2 start "pnpm" --name "trader-crypto-scalp-v2-btc" -- \
  --filter "@deriv-bot/trader" "demo:crypto-scalp-v2" \
  --cwd /opt/apps/deriv-bot \
  --env SYMBOL=cryBTCUSD \
  --env STRATEGY_ALLOCATION=1000 \
  --env TRADE_MODE=cfd

# Guardar configuración PM2
pm2 save
```

### 3. Verificar Estado

```bash
# Ver logs
pm2 logs trader-crypto-scalp-v2-eth
pm2 logs trader-crypto-scalp-v2-btc

# Ver estado
pm2 status

# Reiniciar si es necesario
pm2 restart trader-crypto-scalp-v2-eth
pm2 restart trader-crypto-scalp-v2-btc
```

## ⚠️ Notas Importantes

1. **Warm-up Period**: La estrategia necesita 50 velas (50 minutos) antes de generar señales
2. **Gateway**: Asegúrate de que el Gateway esté corriendo antes de iniciar el trader
3. **Demo First**: Siempre prueba en modo demo antes de usar cuenta real
4. **Monitoreo**: Monitorea los logs y métricas durante las primeras horas
5. **Capital**: Empieza con asignación pequeña ($500-1000) para validar

## 📊 Monitoreo

### Métricas a Observar

- **Win Rate**: Debe estar cerca del 50% (ETH) o 51% (BTC)
- **Profit Factor**: Debe estar cerca de 1.43 (ETH) o 1.27 (BTC)
- **Drawdown**: No debe exceder 15%
- **Trades por día**: ~30-40 trades por asset

### Alertas

El sistema incluye alertas de Telegram para:
- Conexión/desconexión del Gateway
- Errores críticos
- Trades ejecutados

## 🔄 Rollback

Si necesitas hacer rollback:

```bash
# Detener procesos
pm2 stop trader-crypto-scalp-v2-eth
pm2 stop trader-crypto-scalp-v2-btc

# Eliminar procesos
pm2 delete trader-crypto-scalp-v2-eth
pm2 delete trader-crypto-scalp-v2-btc

# Volver a versión anterior
git checkout <previous-commit>
pnpm build
pm2 restart all
```

## 📚 Documentación Adicional

- Ver `CRYPTOSCALP_V2_OPTIMIZED_PRESETS.md` para detalles de los presets
- Ver `CRYPTOSCALP_V2_EXECUTIVE_SUMMARY.md` para resumen ejecutivo
- Ver `IMPLEMENTATION_STATUS.md` para estado de implementación

---

**Última actualización**: Noviembre 2025
**Versión**: CryptoScalp v2.0 Optimized

