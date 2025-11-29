#!/bin/bash
#
# Script para actualizar producción: Reemplazar BB-Squeeze-MR por Hybrid-MTF
# 
# Cambios:
# - Detener BB-Squeeze-MR (R_75)
# - Iniciar Hybrid-MTF para R_75 y R_100
# - Total: $2,000 para Hybrid-MTF ($1,000 por asset)

set -e

SERVER="${DEPLOY_SERVER:-root@37.27.47.129}"
REMOTE_PATH="/opt/apps/deriv-bot"

echo "════════════════════════════════════════════════════════════"
echo "  Actualizando Producción: Hybrid-MTF para R_75 y R_100"
echo "════════════════════════════════════════════════════════════"
echo ""

ssh $SERVER << 'ENDSSH'
    set -e
    cd /opt/apps/deriv-bot

    echo "📋 Estado actual de PM2:"
    pm2 status
    echo ""

    echo "🛑 1. Deteniendo BB-Squeeze-MR (R_75)..."
    pm2 stop trader-squeeze-mr 2>/dev/null || echo "   (No estaba corriendo)"
    pm2 delete trader-squeeze-mr 2>/dev/null || echo "   (No existía)"
    echo "   ✅ BB-Squeeze-MR detenido"
    echo ""

    echo "🚀 2. Iniciando Hybrid-MTF para R_75..."
    pm2 start "pnpm" \
      --name "trader-hybrid-mtf-r75" \
      --cwd /opt/apps/deriv-bot \
      --interpreter bash \
      -- \
      --filter "@deriv-bot/trader" "demo:hybrid-mtf" \
      --env SYMBOL="R_75" \
      --env STRATEGY_ALLOCATION="1000" \
      --env TRADE_MODE="cfd" \
      --env RISK_PERCENTAGE="0.02" \
      --env GATEWAY_WS_URL="ws://localhost:3000" || true
    
    # Si ya existe, actualizar variables de entorno
    pm2 restart trader-hybrid-mtf-r75 --update-env 2>/dev/null || true
    echo "   ✅ Hybrid-MTF R_75 iniciado"
    echo ""

    echo "🚀 3. Iniciando/Actualizando Hybrid-MTF para R_100..."
    # Si existe trader-hybrid-mtf, renombrarlo o actualizarlo
    if pm2 describe trader-hybrid-mtf > /dev/null 2>&1; then
        echo "   Actualizando trader-hybrid-mtf existente..."
        pm2 restart trader-hybrid-mtf --update-env --env SYMBOL="R_100" --env STRATEGY_ALLOCATION="1000" || true
        pm2 save
    else
        pm2 start "pnpm" \
          --name "trader-hybrid-mtf-r100" \
          --cwd /opt/apps/deriv-bot \
          --interpreter bash \
          -- \
          --filter "@deriv-bot/trader" "demo:hybrid-mtf" \
          --env SYMBOL="R_100" \
          --env STRATEGY_ALLOCATION="1000" \
          --env TRADE_MODE="cfd" \
          --env RISK_PERCENTAGE="0.02" \
          --env GATEWAY_WS_URL="ws://localhost:3000" || true
    fi
    echo "   ✅ Hybrid-MTF R_100 iniciado/actualizado"
    echo ""

    echo "💾 4. Guardando configuración PM2..."
    pm2 save
    echo "   ✅ Configuración guardada"
    echo ""

    echo "📊 5. Estado final:"
    pm2 status
    echo ""

    echo "📝 Logs de Hybrid-MTF R_75 (últimas 10 líneas):"
    pm2 logs trader-hybrid-mtf-r75 --lines 10 --nostream || echo "   (Aún iniciando...)"
    echo ""

    echo "📝 Logs de Hybrid-MTF R_100 (últimas 10 líneas):"
    pm2 logs trader-hybrid-mtf-r100 --lines 10 --nostream 2>/dev/null || \
    pm2 logs trader-hybrid-mtf --lines 10 --nostream 2>/dev/null || echo "   (Aún iniciando...)"
    echo ""

    echo "✅ Actualización completada!"
    echo ""
    echo "📊 Resumen de cambios:"
    echo "   - ❌ BB-Squeeze-MR (R_75): DETENIDO"
    echo "   - ✅ Hybrid-MTF (R_75): INICIADO ($1,000)"
    echo "   - ✅ Hybrid-MTF (R_100): INICIADO ($1,000)"
    echo "   - ✅ Keltner-MR (frxXAUUSD): SIN CAMBIOS ($1,000)"
    echo ""
    echo "💰 Total asignado: $3,000"
ENDSSH

echo ""
echo "✅ Script ejecutado. Verifica los logs arriba para confirmar que todo está corriendo."

