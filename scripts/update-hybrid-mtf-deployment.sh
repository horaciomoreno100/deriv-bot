#!/bin/bash
#
# Script para actualizar produccion: Consolidar traders y agregar FVG
#
# Cambios:
# - Consolidar Hybrid-MTF: Un solo trader con R_75,R_100 ($1,000 total)
# - Agregar FVG: Nuevo trader con R_75,R_100 ($1,000 total)
# - Mantener Keltner-MR para frxEURUSD
#
# Distribucion final:
# - HYBRID_MTF: R_75,R_100 - $1,000
# - FVG: R_75,R_100 - $1,000
# - KELTNER_MR: frxEURUSD - $1,000
# Total: $3,000

set -e

SERVER="${DEPLOY_SERVER:-root@37.27.47.129}"
REMOTE_PATH="/opt/apps/deriv-bot"

echo "=================================================================="
echo "  Actualizando Produccion: Consolidar Hybrid-MTF + Agregar FVG"
echo "=================================================================="
echo ""

ssh $SERVER << 'ENDSSH'
    set -e
    cd /opt/apps/deriv-bot

    echo "=========================================="
    echo " Estado actual de PM2"
    echo "=========================================="
    pm2 status
    echo ""

    echo "=========================================="
    echo " 1. Deteniendo traders Hybrid-MTF separados"
    echo "=========================================="
    pm2 stop trader-hybrid-mtf-r75 2>/dev/null || echo "   (No estaba corriendo)"
    pm2 delete trader-hybrid-mtf-r75 2>/dev/null || echo "   (No existia)"
    pm2 stop trader-hybrid-mtf-r100 2>/dev/null || echo "   (No estaba corriendo)"
    pm2 delete trader-hybrid-mtf-r100 2>/dev/null || echo "   (No existia)"
    pm2 stop trader-hybrid-mtf 2>/dev/null || echo "   (No estaba corriendo)"
    pm2 delete trader-hybrid-mtf 2>/dev/null || echo "   (No existia)"
    echo "   OK Traders Hybrid-MTF detenidos"
    echo ""

    echo "=========================================="
    echo " 2. Iniciando Hybrid-MTF consolidado (R_75,R_100)"
    echo "=========================================="
    pm2 start "pnpm" \
      --name "trader-hybrid-mtf" \
      --cwd /opt/apps/deriv-bot \
      -- \
      --filter "@deriv-bot/trader" "demo:hybrid-mtf" \
      --env SYMBOL="R_75,R_100" \
      --env STRATEGY_ALLOCATION="1000" \
      --env TRADE_MODE="cfd" \
      --env RISK_PERCENTAGE="0.02" \
      --env GATEWAY_WS_URL="ws://localhost:3000" || true

    pm2 restart trader-hybrid-mtf --update-env 2>/dev/null || true
    echo "   OK Hybrid-MTF consolidado iniciado"
    echo "   Symbols: R_75,R_100"
    echo "   Allocation: $1,000"
    echo ""

    echo "=========================================="
    echo " 3. Deteniendo FVG si existe"
    echo "=========================================="
    pm2 stop trader-fvg 2>/dev/null || echo "   (No estaba corriendo)"
    pm2 delete trader-fvg 2>/dev/null || echo "   (No existia)"
    echo ""

    echo "=========================================="
    echo " 4. Iniciando FVG (R_75,R_100)"
    echo "=========================================="
    pm2 start "pnpm" \
      --name "trader-fvg" \
      --cwd /opt/apps/deriv-bot \
      -- \
      --filter "@deriv-bot/trader" "demo:fvg" \
      --env SYMBOL="R_75,R_100" \
      --env STRATEGY_ALLOCATION="1000" \
      --env TRADE_MODE="cfd" \
      --env RISK_PERCENTAGE="0.02" \
      --env FVG_TIMEFRAME="5" \
      --env FVG_ENTRY_ZONE="middle" \
      --env GATEWAY_WS_URL="ws://localhost:3000" || true

    pm2 restart trader-fvg --update-env 2>/dev/null || true
    echo "   OK FVG iniciado"
    echo "   Symbols: R_75,R_100"
    echo "   Allocation: $1,000"
    echo "   Timeframe: 5m"
    echo "   Entry Zone: middle"
    echo ""

    echo "=========================================="
    echo " 5. Guardando configuracion PM2"
    echo "=========================================="
    pm2 save
    echo "   OK Configuracion guardada"
    echo ""

    echo "=========================================="
    echo " 6. Estado final"
    echo "=========================================="
    pm2 status
    echo ""

    echo "=========================================="
    echo " 7. Logs Hybrid-MTF (ultimas 15 lineas)"
    echo "=========================================="
    pm2 logs trader-hybrid-mtf --lines 15 --nostream || echo "   (Aun iniciando...)"
    echo ""

    echo "=========================================="
    echo " 8. Logs FVG (ultimas 15 lineas)"
    echo "=========================================="
    pm2 logs trader-fvg --lines 15 --nostream || echo "   (Aun iniciando...)"
    echo ""

    echo "=========================================="
    echo " Actualizacion completada!"
    echo "=========================================="
    echo ""
    echo " Resumen de traders activos:"
    echo "   HYBRID_MTF: R_75,R_100 ($1,000)"
    echo "   FVG: R_75,R_100 ($1,000)"
    echo "   KELTNER_MR: frxEURUSD ($1,000) - sin cambios"
    echo ""
    echo " Total asignado: $3,000"
ENDSSH

echo ""
echo "OK Script ejecutado. Verifica los logs arriba para confirmar que todo esta corriendo."
