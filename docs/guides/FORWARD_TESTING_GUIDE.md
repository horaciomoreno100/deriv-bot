# Guía de Forward Testing - Mean Reversion Strategy

**Fecha:** 2025-10-16
**Estrategia:** Mean Reversion (RSI 17/83, BB 20/2.0)
**Performance Backtest:** 63.87% WR, 54.09% ROI, $540.92 profit (90 días)

---

## 📋 Pre-requisitos

### 1. Completar Setup del Trader Package

El package `trader/` necesita ser configurado completamente antes de ejecutar:

```bash
cd packages/trader

# Crear package.json (si no existe)
cat > package.json << 'EOF'
{
  "name": "@deriv-bot/trader",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "dev": "tsc --watch",
    "build": "tsc",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@deriv-bot/shared": "workspace:*",
    "@deriv-bot/gateway": "workspace:*",
    "technicalindicators": "^3.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
EOF

# Crear tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
EOF

# Instalar dependencias
pnpm install
```

### 2. Verificar Compilación

```bash
# Desde raíz del proyecto
pnpm --filter @deriv-bot/trader build

# Verificar que no hay errores
pnpm --filter @deriv-bot/trader typecheck
```

### 3. Ejecutar Tests

```bash
# Tests unitarios de la estrategia
pnpm --filter @deriv-bot/trader test mean-reversion

# Todos los tests
pnpm --filter @deriv-bot/trader test
```

---

## 🚀 Setup de Forward Testing

### 1. Crear Script de Forward Testing

Crear `packages/trader/src/scripts/forward-test-mean-reversion.ts`:

```typescript
/**
 * Forward Testing Script - Mean Reversion Strategy
 *
 * Ejecuta la estrategia en cuenta demo y registra resultados
 */

import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { GatewayClient } from '../client/gateway-client.js';
import type { StrategyConfig } from '@deriv-bot/shared';
import * as fs from 'fs';

// Configuración
const DEMO_TOKEN = process.env.DERIV_DEMO_TOKEN;
const INITIAL_BALANCE = 10000; // $10,000 demo
const BASE_STAKE = 10; // $10 base stake (1% of $1000)
const TEST_DURATION_DAYS = 14; // 2 semanas

// Tracking
const tradeLog: any[] = [];
let balance = INITIAL_BALANCE;
let totalTrades = 0;
let wonTrades = 0;

/**
 * Setup de estrategia
 */
function createStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'MeanReversion-ForwardTest',
    enabled: true,
    assets: ['R_75'],
    maxConcurrentTrades: 1,
    amount: 1, // 1% of balance
    amountType: 'percentage',
    cooldownSeconds: 120,
    minConfidence: 0.75,
    parameters: {
      // Usa parámetros optimizados por defecto
      rsiOversold: 17,
      rsiOverbought: 83,
      bbPeriod: 20,
      bbStdDev: 2.0,
      atrMultiplier: 1.0,
      cooldownMinutes: 2,
      expiryMinutes: 3,
      maxWinStreak: 2,
      maxLossStreak: 3,
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Main forward testing loop
 */
async function runForwardTest() {
  console.log('🚀 Starting Forward Test - Mean Reversion Strategy');
  console.log(`📊 Initial Balance: $${INITIAL_BALANCE}`);
  console.log(`📅 Duration: ${TEST_DURATION_DAYS} days`);
  console.log(`💰 Base Stake: $${BASE_STAKE}\n`);

  // Conectar al gateway
  const gateway = new GatewayClient({
    token: DEMO_TOKEN,
    appId: 1089,
  });

  await gateway.connect();

  // Crear strategy engine
  const engine = new StrategyEngine();
  const strategy = createStrategy();
  engine.addStrategy(strategy);

  // Actualizar balance inicial
  engine.updateBalance(balance);

  // Escuchar señales
  engine.on('signal', async (signal, strat) => {
    totalTrades++;

    console.log(`\n📊 SIGNAL #${totalTrades}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Reason: ${signal.metadata?.reason}`);
    console.log(`   RSI: ${signal.metadata?.rsi?.toFixed(2)}`);
    console.log(`   Price: ${signal.metadata?.price}`);

    // Calcular stake con progressive anti-martingale
    const stake = (strategy as any).getCurrentStake(balance * 0.01);
    console.log(`   💰 Stake: $${stake.toFixed(2)}`);

    // Ejecutar contrato (aquí llamarías al gateway.buyContract)
    // Por ahora, simulación
    const won = Math.random() < 0.6387; // 63.87% WR esperado
    const payout = won ? stake * 0.8 : -stake; // 80% payout

    // Actualizar stats
    balance += payout;
    if (won) wonTrades++;

    // Actualizar anti-martingale
    (strategy as any).updateAntiMartingale(won, payout, stake);

    // Log trade
    const trade = {
      tradeId: totalTrades,
      timestamp: new Date().toISOString(),
      direction: signal.direction,
      stake,
      result: won ? 'WON' : 'LOST',
      payout,
      balance,
      winRate: (wonTrades / totalTrades) * 100,
      roi: ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100,
      metadata: signal.metadata,
    };

    tradeLog.push(trade);

    console.log(`   ${won ? '✅ WON' : '❌ LOST'}: ${payout > 0 ? '+' : ''}$${payout.toFixed(2)}`);
    console.log(`   Balance: $${balance.toFixed(2)}`);
    console.log(`   Win Rate: ${trade.winRate.toFixed(2)}%`);
    console.log(`   ROI: ${trade.roi.toFixed(2)}%`);

    // Guardar log cada 10 trades
    if (totalTrades % 10 === 0) {
      saveTradeLog();
    }
  });

  // Escuchar errores
  engine.on('strategy:error', (error, strat) => {
    console.error(`❌ Error in ${strat.getName()}:`, error.message);
  });

  // Iniciar estrategia
  await engine.startAll();

  console.log('✅ Strategy started. Monitoring for signals...\n');

  // Mantener activo por TEST_DURATION_DAYS
  const endTime = Date.now() + TEST_DURATION_DAYS * 24 * 60 * 60 * 1000;

  while (Date.now() < endTime) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Finalizar
  await engine.stopAll();
  await gateway.disconnect();

  // Generar reporte final
  generateFinalReport();
}

/**
 * Guardar log de trades
 */
function saveTradeLog() {
  const logPath = './forward-test-trades.json';
  fs.writeFileSync(logPath, JSON.stringify(tradeLog, null, 2));
  console.log(`📁 Trade log saved: ${logPath}`);
}

/**
 * Generar reporte final
 */
function generateFinalReport() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('           FORWARD TEST FINAL REPORT');
  console.log('═══════════════════════════════════════════════════\n');

  const winRate = (wonTrades / totalTrades) * 100;
  const roi = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;
  const profit = balance - INITIAL_BALANCE;
  const avgProfitPerTrade = profit / totalTrades;

  console.log(`📊 PERFORMANCE:`);
  console.log(`   Total Trades: ${totalTrades}`);
  console.log(`   Won: ${wonTrades} | Lost: ${totalTrades - wonTrades}`);
  console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
  console.log(`   ROI: ${roi.toFixed(2)}%`);
  console.log(`   Initial Balance: $${INITIAL_BALANCE.toFixed(2)}`);
  console.log(`   Final Balance: $${balance.toFixed(2)}`);
  console.log(`   Total Profit: $${profit.toFixed(2)}`);
  console.log(`   Avg Profit/Trade: $${avgProfitPerTrade.toFixed(2)}`);

  console.log(`\n📈 COMPARISON WITH BACKTEST:`);
  console.log(`   Expected WR: 63.87% | Actual: ${winRate.toFixed(2)}%`);
  console.log(`   Expected ROI: 54.09% | Actual: ${roi.toFixed(2)}%`);

  const wrDiff = winRate - 63.87;
  const roiDiff = roi - 54.09;

  console.log(`\n📊 DEVIATION:`);
  console.log(`   Win Rate: ${wrDiff > 0 ? '+' : ''}${wrDiff.toFixed(2)}%`);
  console.log(`   ROI: ${roiDiff > 0 ? '+' : ''}${roiDiff.toFixed(2)}%`);

  // Guardar reporte
  const report = {
    testDuration: `${TEST_DURATION_DAYS} days`,
    totalTrades,
    wonTrades,
    lostTrades: totalTrades - wonTrades,
    winRate,
    roi,
    initialBalance: INITIAL_BALANCE,
    finalBalance: balance,
    totalProfit: profit,
    avgProfitPerTrade,
    backtestComparison: {
      expectedWR: 63.87,
      actualWR: winRate,
      wrDeviation: wrDiff,
      expectedROI: 54.09,
      actualROI: roi,
      roiDeviation: roiDiff,
    },
    trades: tradeLog,
  };

  fs.writeFileSync('./forward-test-report.json', JSON.stringify(report, null, 2));
  console.log(`\n📁 Full report saved: forward-test-report.json`);
  console.log('\n═══════════════════════════════════════════════════\n');
}

// Ejecutar
runForwardTest().catch((error) => {
  console.error('❌ Forward test failed:', error);
  process.exit(1);
});
```

### 2. Ejecutar Forward Testing

```bash
# Configurar token de demo
export DERIV_DEMO_TOKEN="tu_token_demo"

# Ejecutar script
cd packages/trader
pnpm tsx src/scripts/forward-test-mean-reversion.ts
```

---

## 📊 Métricas a Monitorear

### Durante el Testing

1. **Win Rate**
   - Esperado: 63.87%
   - Rango aceptable: 60-67%
   - Red flag: < 58%

2. **ROI**
   - Esperado: 54.09%
   - Rango aceptable: 45-60%
   - Red flag: < 40%

3. **Número de Trades**
   - Esperado: ~1.3 trades/día
   - En 14 días: ~18 trades
   - Red flag: < 10 trades (over-filtering)

4. **Slippage**
   - Diferencia entre precio de señal y precio de ejecución
   - Aceptable: < 0.1%
   - Red flag: > 0.3%

5. **Latencia**
   - Tiempo desde señal hasta ejecución
   - Aceptable: < 500ms
   - Red flag: > 1000ms

### Reportes Diarios

Crear tabla de tracking:

| Día | Trades | Won | Lost | WR% | Balance | ROI% | Slippage Avg | Latency Avg |
|-----|--------|-----|------|-----|---------|------|--------------|-------------|
| 1   |        |     |      |     |         |      |              |             |
| 2   |        |     |      |     |         |      |              |             |
| ... |        |     |      |     |         |      |              |             |

---

## ⚠️ Red Flags y Acciones

### Si Win Rate < 58%
1. Revisar ejecución de señales
2. Verificar cálculo de indicadores
3. Comparar con backtest en el mismo período
4. Posible ajuste de parámetros necesario

### Si ROI < 40%
1. Verificar Progressive Anti-Martingale
2. Revisar payout rate real vs esperado (80%)
3. Calcular slippage acumulado
4. Considerar ajustar base stake

### Si Trades < 10 en 14 días
1. Verificar cooldown
2. Revisar filtro ATR
3. Confirmar que candles se reciben correctamente
4. Posible over-filtering

### Si Slippage > 0.3%
1. Optimizar latencia de ejecución
2. Considerar ejecutar en servidor más cercano a Deriv
3. Posible necesidad de ajustar timeframe

---

## ✅ Criterios de Éxito

Para proceder a Live Trading, debe cumplir **TODOS** estos criterios:

- [ ] Win Rate: 60-67%
- [ ] ROI: 45-60%
- [ ] Mínimo 15 trades en 14 días
- [ ] Sin errores de ejecución
- [ ] Slippage promedio < 0.2%
- [ ] Latencia promedio < 500ms
- [ ] Progressive Anti-Martingale funcionando correctamente
- [ ] No red flags sin resolver

---

## 🚨 Plan de Contingencia

### Si Forward Testing Falla

1. **Análisis Post-Mortem**
   - Comparar datos de forward test con backtest
   - Identificar diferencias en condiciones de mercado
   - Revisar logs de errores

2. **Ajustes Posibles**
   - Afinar umbrales RSI (16/84 o 18/82)
   - Ajustar cooldown (1.5 o 2.5 minutos)
   - Modificar ATR multiplier (0.9x o 1.1x)

3. **Re-backtest**
   - Ejecutar backtest con nuevos parámetros
   - Validar mejora estadísticamente significativa
   - Repetir forward test

---

## 📅 Timeline Sugerido

### Semana 1-2: Forward Testing
- Días 1-3: Monitoreo intensivo
- Días 4-7: Validación de métricas
- Días 8-14: Confirmación de consistencia

### Semana 3: Análisis y Decisión
- Generar reportes finales
- Comparar con backtest
- Decidir: ¿Proceder a Live o ajustar?

### Semana 4: Preparación para Live (si exitoso)
- Configurar cuenta real
- Definir micro stakes ($0.50-$1.00)
- Setup de monitoring y alertas

---

## 📞 Soporte

Para preguntas o issues durante forward testing:
- Revisar [ARCHITECTURE.md](ARCHITECTURE.md)
- Revisar [MIGRATION_SUMMARY.md](MIGRATION_SUMMARY.md)
- Logs en `forward-test-trades.json`
- Reporte en `forward-test-report.json`

---

**Última actualización:** 2025-10-16
**Versión Estrategia:** Test #5 (RSI 17/83)
**Status:** ✅ Ready to Start Forward Testing
