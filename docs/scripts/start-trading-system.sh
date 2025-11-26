#!/bin/bash
# Script para iniciar el sistema de trading completo
# Uso: ./start-trading-system.sh

set -e

echo "🔴 Deteniendo instancias previas..."
echo ""

# Matar procesos en puerto 3000 (Gateway)
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Matar procesos de gateway
pkill -f "tsx.*gateway" 2>/dev/null || true
pkill -f "pnpm.*gateway" 2>/dev/null || true

# Matar procesos de trader
pkill -f "tsx.*run-rsi-bb-scalping-demo" 2>/dev/null || true
pkill -f "pnpm.*trader" 2>/dev/null || true

sleep 2
echo "✅ Instancias previas detenidas"
echo ""

# Verificar que el puerto 3000 esté libre
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  El puerto 3000 todavía está ocupado. Intentando forzar cierre..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

echo "🚀 Iniciando sistema de trading..."
echo ""
echo "📡 Paso 1: Iniciando Gateway (puerto 3000)..."
echo "   Comando: cd packages/gateway && pnpm start"
echo ""

# Iniciar Gateway en background
cd packages/gateway
pnpm start > ../../logs/gateway.log 2>&1 &
GATEWAY_PID=$!
cd ../..

echo "   Gateway PID: $GATEWAY_PID"
echo "   Logs: logs/gateway.log"
echo ""

# Esperar a que Gateway esté listo
echo "⏳ Esperando a que Gateway esté listo..."
for i in {1..30}; do
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo "✅ Gateway está listo en puerto 3000"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Gateway no respondió en 30 segundos"
        echo "   Revisa los logs en: logs/gateway.log"
        exit 1
    fi
    sleep 1
done

sleep 2
echo ""
echo "🤖 Paso 2: Iniciando Trader (RSI-BB-Scalping-Demo)..."
echo "   Comando: cd packages/trader && pnpm start:rsi-bb-scalping"
echo ""

# Iniciar Trader en background
cd packages/trader
pnpm start:rsi-bb-scalping > ../../logs/trader.log 2>&1 &
TRADER_PID=$!
cd ../..

echo "   Trader PID: $TRADER_PID"
echo "   Logs: logs/trader.log"
echo ""

sleep 3

echo "✅✅✅ SISTEMA DE TRADING INICIADO ✅✅✅"
echo ""
echo "📊 Estado:"
echo "   Gateway PID: $GATEWAY_PID (puerto 3000)"
echo "   Trader PID:  $TRADER_PID"
echo ""
echo "📝 Logs en tiempo real:"
echo "   Gateway: tail -f logs/gateway.log"
echo "   Trader:  tail -f logs/trader.log"
echo ""
echo "🛑 Para detener el sistema:"
echo "   kill $GATEWAY_PID $TRADER_PID"
echo "   O ejecuta: ./stop-trading-system.sh"
echo ""
echo "🆕 Mejoras activas:"
echo "   ⏰ Timer Periódico: 30s (getPortfolio)"
echo "   📈 Trailing Stop: 20% TP, buffer 0.1%"
echo "   🎯 Límite Símbolo: Max 1 trade/asset"
echo "   💰 Riesgo Dinámico: 2% CFD, 1% Binary"
echo ""

# Guardar PIDs para stop script
echo "$GATEWAY_PID" > .gateway.pid
echo "$TRADER_PID" > .trader.pid

echo "✨ Sistema funcionando. Presiona Ctrl+C para ver los logs en vivo..."
echo ""

# Mostrar logs en vivo
tail -f logs/trader.log
