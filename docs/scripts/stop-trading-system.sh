#!/bin/bash
# Script para detener el sistema de trading
# Uso: ./stop-trading-system.sh

echo "🛑 Deteniendo sistema de trading..."
echo ""

# Leer PIDs guardados
if [ -f .gateway.pid ]; then
    GATEWAY_PID=$(cat .gateway.pid)
    echo "📡 Deteniendo Gateway (PID: $GATEWAY_PID)..."
    kill $GATEWAY_PID 2>/dev/null || echo "   Gateway ya estaba detenido"
    rm .gateway.pid
fi

if [ -f .trader.pid ]; then
    TRADER_PID=$(cat .trader.pid)
    echo "🤖 Deteniendo Trader (PID: $TRADER_PID)..."
    kill $TRADER_PID 2>/dev/null || echo "   Trader ya estaba detenido"
    rm .trader.pid
fi

# Forzar cierre de cualquier proceso residual
echo ""
echo "🧹 Limpiando procesos residuales..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
pkill -f "tsx.*gateway" 2>/dev/null || true
pkill -f "tsx.*run-rsi-bb-scalping-demo" 2>/dev/null || true
pkill -f "pnpm.*gateway" 2>/dev/null || true
pkill -f "pnpm.*trader" 2>/dev/null || true

sleep 1

# Verificar que todo esté detenido
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Puerto 3000 todavía ocupado, forzando..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo ""
echo "✅ Sistema de trading detenido completamente"
echo ""
