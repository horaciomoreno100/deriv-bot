# 🎯 Configuración de Estrategias Múltiples (3 Estrategias)

Este documento describe cómo ejecutar tres estrategias en paralelo con asignación de capital separada.

## 📊 Estrategias Configuradas

### 1. Hybrid-MTF (R_75) - Multi-Timeframe Híbrido
- **Asset**: R_75 (Volatility 75 Index)
- **Estrategia**: Multi-timeframe híbrido (15m/5m/1m)
- **Backtest (90 días)**: +$1,177 (45% WR, 1.15 PF) con $1,000 capital
- **Asignación de Capital**: $1,000

### 2. Hybrid-MTF (R_100) - Multi-Timeframe Híbrido
- **Asset**: R_100 (Volatility 100 Index)
- **Estrategia**: Multi-timeframe híbrido (15m/5m/1m)
- **Backtest (90 días)**: +$1,177 (45% WR, 1.15 PF) con $1,000 capital
- **Asignación de Capital**: $1,000

### 3. Keltner-MR (frxXAUUSD) - Mean Reversion para Oro
- **Asset**: frxXAUUSD (Gold/USD)
- **Estrategia**: Mean Reversion con Keltner Channels
- **Backtest**: Optimizado para forex/metales
- **Asignación de Capital**: $1,000 (configurable)

## 🏗️ Arquitectura

Cada estrategia corre como un **proceso separado** con su propia asignación de capital usando `StrategyAccountant`:

```
Total Account Balance: $3,000
├── Hybrid-MTF (R_75): $1,000
├── Hybrid-MTF (R_100): $1,000
└── Keltner-MR (frxXAUUSD): $1,000
```

### Ventajas de esta Arquitectura

1. **Aislamiento de Capital**: Cada estrategia tiene su propio balance
2. **Procesos Independientes**: Si una falla, la otra sigue funcionando
3. **Monitoreo Separado**: Métricas y logs independientes
4. **Escalabilidad**: Fácil agregar más estrategias

## 🚀 Ejecución Local

### Opción 1: Ejecutar en Terminales Separadas

**Terminal 1 - Hybrid-MTF (R_75):**
```bash
cd packages/trader
SYMBOL="R_75" STRATEGY_ALLOCATION="1000" pnpm demo:hybrid-mtf
```

**Terminal 2 - Hybrid-MTF (R_100):**
```bash
cd packages/trader
SYMBOL="R_100" STRATEGY_ALLOCATION="1000" pnpm demo:hybrid-mtf
```

**Terminal 3 - Keltner-MR (frxXAUUSD):**
```bash
cd packages/trader
SYMBOL="frxXAUUSD" STRATEGY_ALLOCATION="1000" pnpm demo:keltner-mr
```

### Opción 2: Ejecutar en Background

**Hybrid-MTF (R_75):**
```bash
SYMBOL="R_75" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:hybrid-mtf > logs/hybrid-mtf-r75.log 2>&1 &
```

**Hybrid-MTF (R_100):**
```bash
SYMBOL="R_100" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:hybrid-mtf > logs/hybrid-mtf-r100.log 2>&1 &
```

**Keltner-MR:**
```bash
SYMBOL="frxXAUUSD" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:keltner-mr > logs/keltner-mr.log 2>&1 &
```

## 🖥️ Deployment en Servidor (PM2)

### 1. Configurar PM2 Ecosystem

Crear/actualizar `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'trader-hybrid-mtf-r75',
      script: 'pnpm',
      args: '--filter @deriv-bot/trader demo:hybrid-mtf',
      cwd: '/opt/apps/deriv-bot',
      env: {
        SYMBOL: 'R_75',
        STRATEGY_ALLOCATION: '1000',
        TRADE_MODE: 'cfd',
        RISK_PERCENTAGE: '0.02',
        GATEWAY_WS_URL: 'ws://localhost:3000',
        ACCOUNT_LOGINID: 'your_login_id',
      },
      error_file: './logs/trader-hybrid-mtf-r75-error.log',
      out_file: './logs/trader-hybrid-mtf-r75-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'trader-hybrid-mtf-r100',
      script: 'pnpm',
      args: '--filter @deriv-bot/trader demo:hybrid-mtf',
      cwd: '/opt/apps/deriv-bot',
      env: {
        SYMBOL: 'R_100',
        STRATEGY_ALLOCATION: '1000',
        TRADE_MODE: 'cfd',
        RISK_PERCENTAGE: '0.02',
        GATEWAY_WS_URL: 'ws://localhost:3000',
        ACCOUNT_LOGINID: 'your_login_id',
      },
      error_file: './logs/trader-hybrid-mtf-r100-error.log',
      out_file: './logs/trader-hybrid-mtf-r100-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'trader-keltner-mr',
      script: 'pnpm',
      args: '--filter @deriv-bot/trader demo:keltner-mr',
      cwd: '/opt/apps/deriv-bot',
      env: {
        SYMBOL: 'frxXAUUSD',
        STRATEGY_ALLOCATION: '1000',
        TRADE_MODE: 'cfd',
        RISK_PERCENTAGE: '0.02',
        GATEWAY_WS_URL: 'ws://localhost:3000',
        ACCOUNT_LOGINID: 'your_login_id',
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
  ],
};
```

### 2. Iniciar Procesos

```bash
# Iniciar ambos procesos
pm2 start ecosystem.config.js

# O iniciar individualmente
pm2 start ecosystem.config.js --only trader-hybrid-mtf-r75
pm2 start ecosystem.config.js --only trader-hybrid-mtf-r100
```

### 3. Monitoreo

```bash
# Ver estado de ambos procesos
pm2 status

# Ver logs en tiempo real
pm2 logs

# Ver logs de una estrategia específica
pm2 logs trader-hybrid-mtf-r75
pm2 logs trader-hybrid-mtf-r100

# Ver métricas
pm2 monit
```

### 4. Gestión

```bash
# Reiniciar ambas estrategias
pm2 restart all

# Reiniciar una específica
pm2 restart trader-hybrid-mtf-r75
pm2 restart trader-hybrid-mtf-r100

# Detener ambas
pm2 stop all

# Detener una específica
pm2 stop trader-hybrid-mtf-r75
pm2 stop trader-hybrid-mtf-r100

# Eliminar procesos
pm2 delete all
```

## ⚙️ Variables de Entorno

### Hybrid-MTF (R_75)

```bash
SYMBOL="R_75"                    # Asset a tradear
STRATEGY_ALLOCATION="1000"       # Capital asignado a esta estrategia
TRADE_MODE="cfd"                 # Modo de trading (cfd/binary)
RISK_PERCENTAGE="0.02"           # 2% de riesgo por trade
GATEWAY_WS_URL="ws://localhost:3000"
ACCOUNT_LOGINID="your_login_id"
```

### Hybrid-MTF (R_100)

```bash
SYMBOL="R_100"                   # Asset a tradear
STRATEGY_ALLOCATION="1000"       # Capital asignado a esta estrategia
TRADE_MODE="cfd"                 # Modo de trading (cfd/binary)
RISK_PERCENTAGE="0.02"           # 2% de riesgo por trade
GATEWAY_WS_URL="ws://localhost:3000"
ACCOUNT_LOGINID="your_login_id"
```

### Keltner-MR (frxXAUUSD)

```bash
SYMBOL="frxXAUUSD"               # Asset a tradear (Gold/USD)
STRATEGY_ALLOCATION="1000"       # Capital asignado a esta estrategia
TRADE_MODE="cfd"                 # Modo de trading (cfd/binary)
RISK_PERCENTAGE="0.02"           # 2% de riesgo por trade
GATEWAY_WS_URL="ws://localhost:3000"
ACCOUNT_LOGINID="your_login_id"
ENABLE_SESSION_FILTER="true"     # Habilitar filtro de sesiones (forex 24/5)
ALLOWED_SESSIONS="LONDON,NY,ASIAN" # Sesiones permitidas
```

## 📊 Monitoreo y Métricas

### Ver Estadísticas de Cada Estrategia

Cada estrategia muestra sus propias estadísticas:

**BB-Squeeze-MR:**
```
📊 Stats: 5W/3L (62.5% WR) | Total: 8 | P&L: $+125.50 | ROI: 12.55%
Strategy Balance: $1,125.50
```

**Hybrid-MTF:**
```
📊 Stats: 4W/4L (50.0% WR) | Total: 8 | P&L: $+87.30 | ROI: 8.73%
Strategy Balance: $1,087.30
```

**Keltner-MR:**
```
📊 Stats: 3W/2L (60.0% WR) | Total: 5 | P&L: $+45.20 | ROI: 6.78%
Strategy Balance: $711.87
```

### Balance Total

El balance total de la cuenta se puede verificar en el Gateway o en los logs de cada estrategia. La suma de los balances de las 3 estrategias debería aproximarse al balance total de la cuenta.

## 🔧 Troubleshooting

### Problema: Una estrategia no inicia

1. Verificar logs:
   ```bash
   pm2 logs trader-squeeze-mr --lines 50
   ```

2. Verificar que el Gateway esté corriendo:
   ```bash
   pm2 status gateway
   ```

3. Verificar variables de entorno:
   ```bash
   pm2 env trader-hybrid-mtf-r75
   pm2 env trader-hybrid-mtf-r100
   ```

### Problema: Balance insuficiente

Si una estrategia reporta "Insufficient balance":
- Verificar que `STRATEGY_ALLOCATION` no exceda el balance total
- Verificar que el balance de la cuenta sea suficiente para ambas estrategias

### Problema: Conflictos de suscripción

Si ambas estrategias intentan suscribirse al mismo asset:
- Verificar que `SYMBOL` sea diferente para cada proceso
- Hybrid-MTF R_75 debe usar `R_75`
- Hybrid-MTF R_100 debe usar `R_100`

## 📈 Optimización de Capital

### Distribución Equitativa (Configuración Actual)

| Estrategia | Asset | Asignación | % del Total |
|------------|-------|------------|-------------|
| Hybrid-MTF | R_75 | $1,000 | 33.33% |
| Hybrid-MTF | R_100 | $1,000 | 33.33% |
| Keltner-MR | frxXAUUSD | $1,000 | 33.33% |

**Total**: $3,000

**Nota**: Esta distribución equitativa permite que cada estrategia tenga suficiente capital para operar de manera independiente y manejar drawdowns normales.

### Ajuste Dinámico

Puedes ajustar la asignación según el rendimiento real:

```bash
# Ejemplo: Ajustar asignaciones según rendimiento
pm2 restart trader-hybrid-mtf-r75 --update-env --env STRATEGY_ALLOCATION=1200
pm2 restart trader-hybrid-mtf-r100 --update-env --env STRATEGY_ALLOCATION=800
pm2 restart trader-keltner-mr --update-env --env STRATEGY_ALLOCATION=1000
```

**Importante**: Asegúrate de que la suma de las asignaciones no exceda el balance total disponible ($3,000).

## ✅ Checklist de Deployment

- [ ] Gateway corriendo y accesible
- [ ] Variables de entorno configuradas para las 3 estrategias
- [ ] Balance total suficiente ($3,000 mínimo)
- [ ] PM2 configurado con los 3 procesos
- [ ] Logs configurados y accesibles
- [ ] Monitoreo activo (PM2 monit o similar)
- [ ] Alertas configuradas (Slack/Telegram)
- [ ] Verificar que cada proceso use su asset correcto (R_75 para hybrid-mtf-r75, R_100 para hybrid-mtf-r100, frxXAUUSD para keltner-mr)

## 📝 Notas

- Cada estrategia mantiene su propio balance usando `StrategyAccountant`
- Los trades de una estrategia no afectan el balance de las otras
- El balance total de la cuenta es la suma de las 3 asignaciones ($3,000) más cualquier capital no asignado
- Recomendado: mantener un buffer de capital no asignado para manejar drawdowns
- Keltner-MR (oro) usa filtro de sesiones por defecto (forex 24/5), las otras dos estrategias (R_75, R_100) operan 24/7
- Cada estrategia está optimizada para su asset específico - no intercambiar assets entre estrategias

