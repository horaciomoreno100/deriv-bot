# 🚀 Deployment: KELTNER_MR Strategy

## Resumen

Agregar la estrategia **KELTNER_MR** al servidor para ejecutarla en paralelo con **BB-Squeeze-MR**.

## ⚠️ Decisión de Arquitectura

**Recomendación: Proceso PM2 Separado** ✅

Cada estrategia corre como proceso independiente:
- ✅ **Independencia**: Si una falla, la otra sigue funcionando
- ✅ **Logs separados**: Fácil debugging y monitoreo
- ✅ **Reinicio independiente**: Puedes reiniciar solo una estrategia
- ✅ **PM2 está diseñado para esto**: Maneja múltiples procesos eficientemente
- ✅ **Recursos mínimos**: Solo ~10MB RAM adicionales

Ver [STRATEGY_DEPLOYMENT_OPTIONS.md](./STRATEGY_DEPLOYMENT_OPTIONS.md) para análisis detallado.

## Configuración Actual

**Estrategias activas:**
- ✅ Gateway (puerto 3000)
- ✅ BB-Squeeze-MR Trader (R_75, R_100)
- ✅ Telegram Bot

**Nueva estrategia:**
- 🆕 KELTNER_MR Trader (frxEURUSD)

## Pasos de Deployment

### 1. Deploy del Código

```bash
# Desde tu máquina local
cd /Users/hmoreno/Documents/Development/deriv-bot

# Hacer commit de los cambios
git add .
git commit -m "feat: add KELTNER_MR strategy for EUR/USD trading"

# Deploy al servidor
pnpm deploy
```

O si prefieres hacerlo manualmente:

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

### 2. Configurar PM2 para KELTNER_MR

En el servidor, agregar el nuevo proceso PM2:

```bash
# SSH al servidor
ssh root@tu-servidor-ip
cd /opt/apps/deriv-bot

# Iniciar KELTNER_MR como proceso PM2 (usando pnpm como el otro trader)
pm2 start "pnpm" --name "trader-keltner-mr" -- \
  --filter "@deriv-bot/trader" "demo:keltner-mr" \
  --cwd /opt/apps/deriv-bot

# Guardar configuración PM2
pm2 save
```

### 3. Configurar Variables de Entorno

Asegúrate de que el archivo `.env` en el servidor tenga las variables necesarias:

```bash
# En el servidor
cd /opt/apps/deriv-bot
nano .env
```

Variables requeridas (ya deberían estar configuradas):
```bash
DERIV_APP_ID=tu_app_id
DERIV_API_TOKEN=tu_token
GATEWAY_WS_URL=ws://localhost:3000

# Opcionales para KELTNER_MR
SYMBOL=frxEURUSD                    # Por defecto ya es frxEURUSD
STRATEGY_ALLOCATION=1000            # Balance para KELTNER_MR
ENABLE_SESSION_FILTER=true          # Filtro de sesión (default: true)
ALLOWED_SESSIONS=LONDON,NY,ASIAN    # Sesiones permitidas
```

### 4. Verificar que Funciona

```bash
# Ver estado de todos los procesos
pm2 status

# Ver logs de KELTNER_MR
pm2 logs trader-keltner-mr

# Ver logs en tiempo real
pm2 logs trader-keltner-mr --lines 50

# Ver métricas
pm2 monit
```

Deberías ver algo como:
```
┌─────┬──────────────────────┬─────────┬─────────┬──────────┐
│ id  │ name                 │ status  │ cpu     │ memory   │
├─────┼──────────────────────┼─────────┼─────────┼──────────┤
│ 0   │ gateway              │ online  │ 0%      │ 45.2mb   │
│ 1   │ trader-squeeze-mr    │ online  │ 0%      │ 32.1mb   │
│ 2   │ trader-keltner-mr    │ online  │ 0%      │ 28.5mb   │
│ 3   │ telegram             │ online  │ 0%      │ 15.3mb   │
└─────┴──────────────────────┴─────────┴─────────┴──────────┘
```

### 5. Actualizar Script de Deploy (Opcional)

Para que el script `deploy.sh` reinicie también KELTNER_MR, actualiza la línea 108:

```bash
# Antes:
ssh $SERVER "pm2 restart gateway trader-squeeze telegram && pm2 save"

# Después:
ssh $SERVER "pm2 restart gateway trader-squeeze-mr trader-keltner-mr telegram && pm2 save"
```

## Configuración de PM2 con Ecosystem File (Recomendado)

Si prefieres usar un archivo de configuración PM2, crea `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'gateway',
      script: 'node',
      args: 'packages/gateway/dist/index.js',
      cwd: '/opt/apps/deriv-bot',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/gateway-error.log',
      out_file: './logs/gateway-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'trader-squeeze-mr',
      script: 'node',
      args: 'packages/trader/dist/scripts/run-bb-squeeze-mr.js',
      cwd: '/opt/apps/deriv-bot',
      env: {
        NODE_ENV: 'production',
        SYMBOL: 'R_75,R_100',
        TRADE_MODE: 'cfd',
      },
      error_file: './logs/trader-squeeze-mr-error.log',
      out_file: './logs/trader-squeeze-mr-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'trader-keltner-mr',
      script: 'node',
      args: 'packages/trader/dist/scripts/run-keltner-mr.js',
      cwd: '/opt/apps/deriv-bot',
      env: {
        NODE_ENV: 'production',
        SYMBOL: 'frxEURUSD',
        TRADE_MODE: 'cfd',
        STRATEGY_ALLOCATION: '1000',
        ENABLE_SESSION_FILTER: 'true',
        ALLOWED_SESSIONS: 'LONDON,NY,ASIAN',
      },
      error_file: './logs/trader-keltner-mr-error.log',
      out_file: './logs/trader-keltner-mr-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'telegram',
      script: 'node',
      args: 'packages/telegram/dist/index.js',
      cwd: '/opt/apps/deriv-bot',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/telegram-error.log',
      out_file: './logs/telegram-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
```

Luego:
```bash
# Eliminar procesos actuales
pm2 delete all

# Iniciar desde ecosystem file
pm2 start ecosystem.config.cjs

# Guardar
pm2 save
```

## Comandos Útiles

```bash
# Ver estado
pm2 status

# Ver logs de todas las estrategias
pm2 logs

# Ver logs de KELTNER_MR específicamente
pm2 logs trader-keltner-mr

# Reiniciar solo KELTNER_MR
pm2 restart trader-keltner-mr

# Detener KELTNER_MR
pm2 stop trader-keltner-mr

# Eliminar KELTNER_MR
pm2 delete trader-keltner-mr

# Ver métricas en tiempo real
pm2 monit

# Ver información detallada
pm2 describe trader-keltner-mr
```

## Monitoreo

### Verificar que está funcionando:

1. **Logs del Gateway**: Debería mostrar la conexión del nuevo trader
2. **Logs de KELTNER_MR**: Debería mostrar:
   - ✅ Connected to Gateway
   - ✅ Strategy "KELTNER_MR" initialized
   - ✅ Subscribed to: frxEURUSD
   - ✅ Strategy is now running!

3. **PM2 Status**: Debería mostrar `trader-keltner-mr` como `online`

### Verificar trades:

Los trades de KELTNER_MR aparecerán en:
- Logs de PM2: `pm2 logs trader-keltner-mr`
- Gateway logs: `pm2 logs gateway`
- Telegram bot (si está configurado)

## Troubleshooting

### Si KELTNER_MR no inicia:

```bash
# Ver errores
pm2 logs trader-keltner-mr --err --lines 100

# Verificar que el build se completó
ls -la packages/trader/dist/scripts/run-keltner-mr.js

# Si no existe, hacer build
cd /opt/apps/deriv-bot
pnpm build
```

### Si no se conecta al Gateway:

```bash
# Verificar que Gateway está corriendo
pm2 status gateway

# Verificar puerto 3000
netstat -tulpn | grep 3000

# Ver logs del Gateway
pm2 logs gateway --lines 50
```

### Si hay errores de variables de entorno:

```bash
# Verificar .env
cat .env | grep -E "DERIV|GATEWAY|SYMBOL"

# Reiniciar con variables actualizadas
pm2 restart trader-keltner-mr --update-env
```

## Notas Importantes

1. **Balance Allocation**: KELTNER_MR usa `STRATEGY_ALLOCATION=1000` por defecto. Asegúrate de tener suficiente balance en la cuenta.

2. **Session Filter**: La estrategia está configurada para forex 24/5, solo tradea en sesiones LONDON, NY, ASIAN.

3. **Símbolo**: Solo está optimizada para `frxEURUSD`. No cambiar a otros símbolos sin re-optimizar.

4. **Gateway Compartido**: Ambas estrategias (BB-Squeeze-MR y KELTNER_MR) comparten el mismo Gateway. No hay conflicto.

5. **Multi-Strategy**: El `StrategyAccountant` permite que ambas estrategias operen independientemente con sus propios balances.

## Estado Final Esperado

Después del deployment, deberías tener:

```
🟢 Gateway
├ Port: 3000
└ Uptime: Xh Xm

🟢 BB-Squeeze-MR Trader
├ Strategy: BB-Squeeze-MR
├ Symbols: R_75, R_100
└ Uptime: Xh Xm

🟢 KELTNER_MR Trader
├ Strategy: KELTNER_MR
├ Symbols: frxEURUSD
├ Session Filter: LONDON, NY, ASIAN
└ Uptime: Xh Xm

🟢 Telegram Bot
└ Uptime: Xh Xm
```

