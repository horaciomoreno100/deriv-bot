#!/bin/bash

# Script para iniciar Gateway + Web UI Dashboard
# Uso: ./start-dashboard.sh

set -e

echo "🚀 Iniciando Deriv Bot Dashboard..."
echo ""

# Verificar que exista .env
if [ ! -f .env ]; then
    echo "❌ Error: No se encontró el archivo .env"
    echo ""
    echo "Crea un archivo .env en la raíz con:"
    echo "  DERIV_API_TOKEN=tu_token_aqui"
    echo "  DERIV_APP_ID=1089"
    echo ""
    exit 1
fi

# Verificar que exista el token
if ! grep -q "DERIV_API_TOKEN=" .env; then
    echo "❌ Error: DERIV_API_TOKEN no configurado en .env"
    exit 1
fi

echo "✅ Configuración encontrada"
echo ""

# Iniciar Gateway en background
echo "🔌 Iniciando Gateway..."
pnpm --filter gateway dev > logs/gateway.log 2>&1 &
GATEWAY_PID=$!
echo "   Gateway PID: $GATEWAY_PID"

# Esperar a que el Gateway esté listo
sleep 3

# Verificar que el Gateway siga corriendo
if ! kill -0 $GATEWAY_PID 2>/dev/null; then
    echo "❌ Error: Gateway falló al iniciar. Revisa logs/gateway.log"
    exit 1
fi

echo "✅ Gateway corriendo en ws://localhost:3000"
echo ""

# Iniciar Web UI
echo "🌐 Iniciando Web UI..."
echo "   URL: http://localhost:5173"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dashboard listo! Abre: http://localhost:5173"
echo "  Presiona Ctrl+C para detener todo"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Iniciar Web UI (foreground)
pnpm --filter web-ui dev

# Cleanup cuando termine
echo ""
echo "🛑 Deteniendo servicios..."
kill $GATEWAY_PID 2>/dev/null || true
echo "✅ Todo detenido"
