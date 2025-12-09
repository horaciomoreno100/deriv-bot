# Análisis de Uptime y Soluciones Implementadas

**Fecha:** 2025-12-09
**Problema:** Bot no mantiene uptime de más de 4 horas

## Diagnóstico

### Errores Encontrados en Logs

1. **"Please log in"** - Pérdida de autenticación con Deriv API
   - Ocurre cuando el WebSocket se reconecta pero no re-autentica correctamente
   - El gateway intenta reconectar pero falla el re-auth

2. **"Request timeout"** - Timeouts en autorización
   - Re-autorización falla por timeout (>10s)
   - Posible latencia de red o sobrecarga del servidor Deriv

3. **"ECONNREFUSED localhost:3000"** - Gateway caído
   - Los traders no pueden conectar al gateway
   - Causa cascada de errores en todos los servicios

4. **"Not connected"** - Estado de conexión inconsistente
   - El cliente cree estar conectado pero el WS está cerrado
   - Falta de manejo robusto del estado de conexión

### Patrón de Fallas

```
23:00 - Gateway pierde conexión con Deriv
23:00 - Todos los comandos fallan con "Not connected"
10:30 - Gateway intenta reconectar
10:30 - Re-auth falla con timeout
10:31 - Múltiples intentos de re-auth fallan
10:31 - Ciclo continúa hasta que alguien reinicia manualmente
```

## Soluciones Implementadas

### 1. Auto-Reporte via Telegram (NUEVO)

**Archivo:** `packages/telegram/src/telegram-bot.ts`

- Reportes automáticos cada 4 horas con:
  - Estado del gateway (latencia)
  - Traders activos
  - Uso de memoria/disco
  - Balance de cuenta
  - Estadísticas del día
  - Lista de procesos PM2

- Configuración via env vars:
  ```bash
  TELEGRAM_AUTO_REPORT_INTERVAL=14400000  # 4 horas (default)
  TELEGRAM_HEALTH_CHECK_INTERVAL=60000     # 60 segundos (default)
  ```

### 2. Monitoreo de Health Proactivo (NUEVO)

**Archivo:** `packages/telegram/src/telegram-bot.ts`

- Chequeo cada 60 segundos
- Alertas automáticas cuando:
  - Gateway no responde (3 fallos consecutivos)
  - Memoria > 80% (degraded) o > 90% (critical)
  - Disco > 85% (degraded) o > 95% (critical)
  - Cualquier proceso PM2 offline
  - Latencia > 2s (degraded) o > 5s (critical)

- Notificación de recuperación cuando el sistema vuelve a healthy

### 3. Watchdog Mejorado

**Archivo:** `packages/trader/src/scripts/watchdog.ts`

- **AUTO_RESTART ahora es TRUE por defecto**
- Reduce MAX_ERRORS de 5 a 3 (más agresivo)
- Envía alertas a Telegram además de Slack
- Rate limit de 5 minutos entre alertas Telegram

### 4. Comandos Telegram Existentes

Ya disponibles para uso manual:
- `/health` - Resumen de salud del sistema
- `/server` - Estado del servidor (CPU, RAM, disk, PM2)
- `/logs` - Ver logs recientes
- `/errors` - Ver logs de error

## Mejores Prácticas para Uptime

### Configuración PM2 Recomendada

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'gateway',
      script: 'dist/main.js',
      cwd: '/opt/apps/deriv-bot/packages/gateway',
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s',
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'watchdog',
      script: 'npx tsx src/scripts/watchdog.ts',
      cwd: '/opt/apps/deriv-bot/packages/trader',
      env: {
        WATCHDOG_AUTO_RESTART: 'true',
        WATCHDOG_MAX_ERRORS: '3',
        WATCHDOG_INTERVAL: '60000',
      },
    },
    // ... traders
  ],
};
```

### Variables de Entorno Críticas

```bash
# Gateway
DERIV_APP_ID=xxxxx
DERIV_API_TOKEN=xxxxx

# Alertas
TELEGRAM_BOT_TOKEN=xxxxx
TELEGRAM_CHAT_ID=xxxxx
SLACK_WEBHOOK_URL=xxxxx  # Opcional

# Watchdog
WATCHDOG_AUTO_RESTART=true
WATCHDOG_MAX_ERRORS=3
WATCHDOG_INTERVAL=60000

# Telegram auto-reports
TELEGRAM_AUTO_REPORT_INTERVAL=14400000  # 4 horas
TELEGRAM_HEALTH_CHECK_INTERVAL=60000     # 1 minuto
```

### Orden de Inicio Correcto

1. Gateway primero (esperar 10s)
2. Watchdog segundo
3. Telegram tercero
4. Traders al final

```bash
pm2 start gateway && sleep 10 && pm2 start watchdog telegram && sleep 5 && pm2 start trader-*
```

### Monitoreo Externo Recomendado

Para máxima confiabilidad, considera:

1. **UptimeRobot o similar** - Ping externo al servidor
2. **Cron job de health check** - Independiente de PM2
3. **Log rotation** - Evitar que disco se llene

```bash
# Crontab recomendado
# Health check cada 5 minutos
*/5 * * * * curl -s http://localhost:3000/health || pm2 restart gateway

# Limpiar logs viejos diariamente
0 3 * * * find /opt/apps/deriv-bot/logs -name "*.log" -mtime +7 -delete
```

## Acciones Pendientes

1. **Desplegar cambios al servidor:**
   ```bash
   git add -A && git commit -m "feat: add auto health reports and proactive alerting"
   git push origin main
   ssh root@37.27.47.129 "cd /opt/apps/deriv-bot && git pull && pnpm build && pm2 restart all"
   ```

2. **Verificar que recibas los reportes automáticos:**
   - Primer reporte llegará 5 minutos después del reinicio
   - Reportes subsecuentes cada 4 horas

3. **Monitorear por 24 horas:**
   - Verificar que las alertas llegan cuando hay problemas
   - Ajustar intervalos si es necesario

## Resumen de Cambios

| Archivo | Cambio |
|---------|--------|
| `packages/telegram/src/telegram-bot.ts` | +220 líneas: auto-reporting, health monitoring |
| `packages/telegram/src/main.ts` | +4 líneas: nuevas config vars |
| `packages/trader/src/scripts/watchdog.ts` | +40 líneas: telegram alerts, defaults mejorados |

## Contacto

Si los problemas persisten después de estos cambios, los siguientes pasos serían:
1. Revisar logs de Deriv API para entender por qué expira la sesión
2. Implementar heartbeat más agresivo con Deriv
3. Considerar múltiples conexiones WebSocket como fallback
