# Deriv Bot

Bot de trading automatizado para Deriv con arquitectura modular, bot de Telegram y deployment automatizado.

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](./CHANGELOG.md)

## Arquitectura

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Telegram   │────▶│   Gateway   │────▶│  Deriv API  │
│    Bot      │     │   (WS:3000) │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                    ┌─────┴─────┐
                    ▼           ▼
              ┌─────────┐ ┌─────────┐
              │ Trader  │ │ Web UI  │
              │BB-Squeeze│ │(Charts) │
              └─────────┘ └─────────┘
```

## Packages

| Package | Descripción |
|---------|-------------|
| `@deriv-bot/gateway` | WebSocket server, conexión Deriv API, state manager |
| `@deriv-bot/trader` | Estrategias de trading (BB-Squeeze, Mean Reversion) |
| `@deriv-bot/telegram` | Bot de Telegram para monitoreo y comandos |
| `@deriv-bot/shared` | Tipos compartidos, GatewayClient |
| `@deriv-bot/web-ui` | Dashboard web con gráficos |
| `@deriv-bot/cli` | REPL para terminal |

## Quick Start

### Prerrequisitos
- Node.js >= 18
- pnpm >= 8

### Instalación

```bash
# Clonar e instalar
git clone https://github.com/horaciomoreno100/deriv-bot.git
cd deriv-bot
pnpm install

# Configurar
cp .env.example .env
# Editar .env con tus credenciales

# Build
pnpm build
```

### Ejecutar Localmente

```bash
# Terminal 1: Gateway
pnpm gateway

# Terminal 2: Trader (BB-Squeeze strategy)
TRADE_MODE=cfd SYMBOL="R_75,R_100" pnpm --filter @deriv-bot/trader demo:squeeze

# Terminal 3: Telegram Bot (opcional)
pnpm --filter @deriv-bot/telegram dev
```

## Bot de Telegram

Bot estilo FreqTrade para monitorear el trading:

### Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `/info` | Info del bot: estrategias, uptime, traders conectados |
| `/balance` | Balance actual de la cuenta |
| `/status` | Posiciones abiertas y P/L |
| `/profit` | Performance últimas 24h |
| `/stats` | Estadísticas del día |
| `/assets` | Assets monitoreados |
| `/ping` | Verificar conexión con Gateway |
| `/help` | Lista de comandos |

### Notificaciones Automáticas

El bot envía notificaciones cuando:

- Se abre una posición (símbolo, dirección, stake)
- Se cierra una posición (resultado, P/L)

### Configuración

```bash
# En .env
TELEGRAM_BOT_TOKEN=tu_token_de_botfather
TELEGRAM_CHAT_ID=tu_chat_id
```

## Estrategia BB-Squeeze

Estrategia de breakout basada en Bollinger Bands y Keltner Channels:

### Lógica

1. **Detectar Squeeze**: BB dentro de KC (baja volatilidad)
2. **CALL**: Precio rompe BB superior después del squeeze
3. **PUT**: Precio rompe BB inferior después del squeeze
4. **Smart Exit**: Cierre en BB middle (mean reversion)

### Parámetros

- Bollinger Bands: 20 períodos, 2 StdDev
- Keltner Channels: 20 períodos, 1.5 ATR
- Take Profit: 0.4%
- Stop Loss: 0.2%
- Cooldown: 60 segundos

## Deploy a Producción

### Setup Inicial del Servidor

```bash
# En el servidor (Hetzner/VPS)
cd /opt/apps
git clone https://github.com/horaciomoreno100/deriv-bot.git
cd deriv-bot
pnpm install
pnpm build

# Configurar PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Deploy Automatizado

```bash
# Deploy rápido
pnpm deploy

# Deploy con restart de todos los servicios
pnpm deploy:restart-all
```

### Configuración de Deploy

```bash
# En .env
DEPLOY_SERVER=root@tu-servidor-ip
DEPLOY_PATH=/opt/apps/deriv-bot
```

## Releases

Usamos [release-it](https://github.com/release-it/release-it) con conventional changelog:

```bash
# Preview del release
pnpm release:dry

# Crear release (patch: 0.2.0 → 0.2.1)
pnpm release

# Release minor (0.2.0 → 0.3.0)
pnpm release:minor

# Release major (0.2.0 → 1.0.0)
pnpm release:major
```

Esto automáticamente:
- Bump de versión
- Genera CHANGELOG.md
- Commit + tag
- Push a GitHub
- Crea GitHub Release

## Scripts Útiles

```bash
# Development
pnpm dev              # Todos los packages en watch mode
pnpm gateway          # Solo gateway
pnpm trader           # Solo trader

# Build
pnpm build            # Build core packages
pnpm build:all        # Build todos los packages

# Testing
pnpm test             # Run tests
pnpm test:ui          # Tests con UI
pnpm test:coverage    # Coverage report

# Linting
pnpm lint             # ESLint
pnpm format           # Prettier

# Deploy
pnpm deploy           # Deploy a producción
pnpm release          # Crear release
```

## Estructura del Proyecto

```
deriv-bot/
├── packages/
│   ├── gateway/          # WebSocket server + Deriv API
│   ├── trader/           # Trading strategies
│   ├── telegram/         # Telegram bot
│   ├── shared/           # Shared types
│   ├── web-ui/           # Web dashboard
│   └── cli/              # Terminal REPL
├── scripts/
│   └── deploy.sh         # Deploy script
├── .env                  # Configuración local
├── .env.example          # Template de configuración
├── .release-it.json      # Config de releases
├── CHANGELOG.md          # Historial de cambios
└── deploys.log           # Log de deploys
```

## Variables de Entorno

```bash
# Deriv API
DERIV_APP_ID=tu_app_id
DERIV_API_TOKEN=tu_token
DERIV_ENDPOINT=wss://ws.derivws.com/websockets/v3

# Gateway
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0

# Telegram
TELEGRAM_BOT_TOKEN=tu_bot_token
TELEGRAM_CHAT_ID=tu_chat_id

# Deploy
DEPLOY_SERVER=user@server-ip
DEPLOY_PATH=/opt/apps/deriv-bot

# GitHub (para releases)
GITHUB_TOKEN=ghp_xxx
```

## Documentación

- [CHANGELOG.md](./CHANGELOG.md) - Historial de cambios
- [docs/](./docs/) - Documentación técnica

## Licencia

MIT
