# Dashboard ASCII Design

## Layout Propuesto

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                    🚀 DERIV BOT TRADING DASHBOARD                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📊 ACCOUNT STATUS                    📈 OPEN POSITIONS (3)                  ║
║  ─────────────────────────────────    ─────────────────────────────────────  ║
║  Account: VRTC14469660 (DEMO)         🟢 R_75  CALL  @ 39925.50              ║
║  Balance: $2,636.02 USD               Profit: +$12.50 (+2.5%)                ║
║  Equity: $2,648.52 USD                Entry: 39920.00 | Current: 39925.50   ║
║  Daily P&L: +$45.30 (+1.75%)          ─────────────────────────────────────  ║
║  Win Rate: 58.3% (14W/10L)            🔴 R_100 PUT   @ 882.45               ║
║                                       Loss: -$8.20 (-1.2%)                  ║
║                                       Entry: 882.60 | Current: 882.45       ║
║                                       ─────────────────────────────────────  ║
║                                       🟢 R_75  CALL  @ 39930.20             ║
║                                       Profit: +$15.30 (+3.1%)               ║
║                                       Entry: 39915.00 | Current: 39930.20   ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🎯 ACTIVE STRATEGIES (2)             📡 SIGNAL PROXIMITY                    ║
║  ─────────────────────────────────    ─────────────────────────────────────  ║
║  ✓ RSI + BB Scalping                  R_75:  ████████░░ 85% (CALL)          ║
║    Assets: R_75, R_100                Conditions: BB Touch ✓ | RSI: 32 ✓    ║
║    Status: ACTIVE                      ATR Filter: ✓                         ║
║    Signals: 12 today                   ─────────────────────────────────────  ║
║                                         R_100: ██████░░░░ 60% (PUT)          ║
║  ✓ Mean Reversion                     Conditions: BB Touch ✓ | RSI: 68 ✓    ║
║    Assets: R_50, R_75                 ATR Filter: ⚠️ (High volatility)      ║
║    Status: ACTIVE                      ─────────────────────────────────────  ║
║    Signals: 8 today                    R_50:  ████░░░░░░ 40% (CALL)          ║
║                                        Conditions: BB Touch ✗ | RSI: 45      ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📊 MONITORED ASSETS (3)              ⏱️  LAST UPDATE: 16:45:23 UTC          ║
║  ─────────────────────────────────    ─────────────────────────────────────  ║
║  R_75:  39925.50  ▲ +0.12%  [ACTIVE]  Commands:                              ║
║  R_100: 882.45    ▼ -0.05%  [ACTIVE]  • 'q' - Quit                          ║
║  R_50:  1250.30   ▲ +0.08%  [ACTIVE]  • 'p' - Portfolio                     ║
║                                        • 'b' - Balance                       ║
║                                        • 's' - Strategies                    ║
║                                        • 'r' - Refresh                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## Componentes del Dashboard

### 1. Account Status Panel
- Login ID y tipo de cuenta
- Balance actual
- Equity (balance + P&L no realizado)
- Daily P&L (ganancia/pérdida del día)
- Win Rate (estadísticas del día)

### 2. Open Positions Panel
- Lista de posiciones abiertas
- Indicador visual (🟢 ganancia, 🔴 pérdida)
- Asset, dirección, precio actual
- Ganancia/pérdida absoluta y porcentual
- Precio de entrada vs precio actual

### 3. Active Strategies Panel
- Lista de estrategias activas
- Assets monitoreados por cada estrategia
- Estado (ACTIVE/PAUSED)
- Contador de señales generadas hoy

### 4. Signal Proximity Panel
- Por cada asset monitoreado:
  - Barra de progreso de proximidad (0-100%)
  - Dirección esperada (CALL/PUT)
  - Estado de condiciones (✓/✗/⚠️)
  - Indicadores relevantes (RSI, BB, ATR, etc.)

### 5. Monitored Assets Panel
- Lista de assets siendo analizados
- Precio actual
- Cambio porcentual (▲/▼)
- Estado de conexión

### 6. Commands Panel
- Lista de comandos disponibles
- Atajos de teclado

## Características

- **Actualización en tiempo real**: El dashboard se actualiza automáticamente cada 1-2 segundos
- **Interactivo**: Comandos de teclado para acciones rápidas
- **Colorizado**: Usa colores ANSI para mejor legibilidad
- **Responsive**: Se adapta al tamaño de la terminal
- **Modo compacto**: Opción para mostrar versión simplificada

## Comandos Interactivos

- `q` / `Ctrl+C` - Salir
- `p` - Mostrar portfolio detallado
- `b` - Mostrar balance detallado
- `s` - Mostrar estrategias detalladas
- `r` - Refrescar manualmente
- `h` - Mostrar ayuda
- `c` - Cambiar modo (compacto/completo)
- `l` - Mostrar log de trades recientes

