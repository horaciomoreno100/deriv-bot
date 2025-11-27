# 🚀 Setup PM2 para KELTNER_MR (Post-Deploy)

## Estado Actual

✅ **Código desplegado** - El código ya está en el servidor  
❌ **Proceso PM2** - Falta crear el proceso `trader-keltner-mr`

## Comando para Crear el Proceso

Conéctate al servidor y ejecuta:

```bash
# SSH al servidor
ssh root@37.27.47.129

# Ir al directorio
cd /opt/apps/deriv-bot

# Crear proceso PM2 para KELTNER_MR
pm2 start "node packages/trader/dist/scripts/run-keltner-mr.js" \
  --name "trader-keltner-mr" \
  --cwd /opt/apps/deriv-bot

# Guardar configuración PM2
pm2 save
```

## Verificar que Funciona

```bash
# Ver estado
pm2 status

# Ver logs
pm2 logs trader-keltner-mr --lines 50
```

Deberías ver:
```
┌─────┬──────────────────────┬─────────┬─────────┐
│ id  │ name                 │ status  │ cpu     │
├─────┼──────────────────────┼─────────┼─────────┤
│ 0   │ gateway              │ online  │ 0%      │
│ 4   │ trader-squeeze-mr    │ online  │ 0%      │
│ X   │ trader-keltner-mr    │ online  │ 0%      │ ← NUEVO
│ 3   │ telegram             │ online  │ 0%      │
└─────┴──────────────────────┴─────────┴─────────┘
```

## Logs Esperados

En los logs deberías ver:
```
🎯 KELTNER_MR - MEAN REVERSION STRATEGY
✅ Connected to Gateway
✅ Strategy "KELTNER_MR" initialized
✅ Subscribed to: frxEURUSD
✅ Strategy is now running!
```

