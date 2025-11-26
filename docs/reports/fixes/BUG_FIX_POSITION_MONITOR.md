# Bug Fix: PositionMonitor mostrando 0 posiciones

## 🐛 Problema Reportado

El usuario reportó que tenía 2 operaciones abiertas en Deriv, pero el PositionMonitor mostraba:
```
🔍 [PositionMonitor] Portfolio check:
   Monitored symbols: [R_10, R_25, R_50, R_75, R_100]
   Open positions: 0
```

## 🔍 Investigación

### 1. Prueba directa del API de Deriv

Creamos [`packages/gateway/src/test-portfolio-debug.ts`](packages/gateway/src/test-portfolio-debug.ts) para probar directamente el método `DerivClient.getPortfolio()`.

**Resultado:** ✅ El API funciona correctamente y devuelve 2 posiciones abiertas:

```json
{
  "portfolio": {
    "contracts": [
      {
        "contract_id": 300127589868,
        "contract_type": "MULTUP",
        "symbol": "R_25",
        "buy_price": 655.5
      },
      {
        "contract_id": 300127523528,
        "contract_type": "MULTDOWN",
        "symbol": "R_50",
        "buy_price": 728.33
      }
    ]
  }
}
```

### 2. Análisis del problema

El problema NO estaba en el API. El problema era un **desajuste de configuración**:

- **Posiciones abiertas reales:** R_25 y R_50 (de un demo anterior)
- **Símbolos monitoreados por el demo:** R_75 y R_100

El `PositionMonitor` filtra correctamente las posiciones por símbolo, así que cuando buscaba posiciones de R_75/R_100, no encontraba ninguna (las posiciones eran de R_25/R_50).

## ✅ Solución Implementada

### Cambios realizados:

#### 1. [position-monitor.ts](packages/trader/src/trade-management/position-monitor.ts)

Agregamos **logging detallado** para debugging:

```typescript
private async checkPositions(): Promise<void> {
  try {
    console.log(`\n🔍 [PositionMonitor] Portfolio check starting...`);
    console.log(`   Monitored symbols: [${this.monitoredSymbols.join(', ')}]`);

    const openPositions = await this.client.getPortfolio();
    console.log(`   Raw API response - positions count: ${openPositions?.length || 0}`);

    if (openPositions && openPositions.length > 0) {
      console.log(`   📋 Positions from API:`);
      openPositions.forEach((pos, index) => {
        console.log(`   ${index + 1}. Symbol: "${pos.symbol}" | Contract: ${pos.contractId}`);
        console.log(`      Monitored? ${this.monitoredSymbols.includes(pos.symbol)}`);
      });
    }

    // Filter logic with detailed logging...
  }
}
```

**Beneficio:** Ahora podemos ver exactamente qué posiciones devuelve el API y cómo se están filtrando.

#### 2. [run-support-resistance-demo.ts](packages/trader/src/scripts/run-support-resistance-demo.ts) (línea 122-124)

**Antes:**
```typescript
tradeManager = new TradeManager(gatewayClient, adapter, SYMBOLS, {
```

**Después:**
```typescript
// Monitor ALL volatility indices (not just active trading symbols) to detect any open positions
const MONITORED_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
tradeManager = new TradeManager(gatewayClient, adapter, MONITORED_SYMBOLS, {
```

**Razón:** Permite que el sistema detecte y maneje posiciones abiertas de **cualquier** índice de volatilidad, no solo los que está tradeando activamente en este demo. Esto es útil si:
- Tienes múltiples estrategias corriendo
- Tienes posiciones de demos anteriores
- Cambias los símbolos del demo pero quedaron posiciones abiertas

## 📊 Flujo del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│ 1. PositionMonitor cada 30s llama getPortfolio()           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. GatewayClient.getPortfolio() → Gateway Handler          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Gateway → DerivClient.getPortfolio() → Deriv API        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Deriv API devuelve posiciones (R_25, R_50)              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PositionMonitor FILTRA por monitoredSymbols             │
│    - ANTES: [R_75, R_100] → 0 matches                      │
│    - AHORA: [R_10, R_25, R_50, R_75, R_100] → 2 matches    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. TradeManager.evaluateExit() → SmartExitManager          │
│    Aplica reglas de Fast Profit Taking                     │
└─────────────────────────────────────────────────────────────┘
```

## 🧪 Testing

Para verificar el fix:

```bash
# 1. Rebuild trader
cd packages/trader
pnpm build

# 2. Run demo (con las 2 posiciones R_25/R_50 abiertas)
cd ../..
export TRADE_MODE=cfd
pnpm demo:sr
```

**Resultado esperado:**
```
🔍 [PositionMonitor] Portfolio check starting...
   Monitored symbols: [R_10, R_25, R_50, R_75, R_100]
   Raw API response - positions count: 2
   📋 Positions from API:
   1. Symbol: "R_25" | Contract: 300127589868 | Type: MULTUP
      Monitored? true (checking against [R_10, R_25, R_50, R_75, R_100])
   2. Symbol: "R_50" | Contract: 300127523528 | Type: MULTDOWN
      Monitored? true (checking against [R_10, R_25, R_50, R_75, R_100])
   ✅ Relevant positions (after filter): 2
   📤 Calling onPositionUpdate with 2 position(s)
```

## 📝 Notas Adicionales

### Por qué el cache del Gateway no era el problema

El Gateway tiene un cache de 5 segundos para `getPortfolio()` ([command-handlers.ts:41](packages/gateway/src/handlers/command-handlers.ts#L41)), pero esto NO era el problema porque:

1. El cache devuelve los mismos datos que el API
2. El PositionMonitor hace polling cada 30 segundos (> 5s cache TTL)
3. El problema era el filtrado por símbolos, no la obtención de datos

### Archivos creados para debugging

- [`packages/gateway/src/test-portfolio-debug.ts`](packages/gateway/src/test-portfolio-debug.ts) - Prueba directa del API de Deriv
- [`packages/trader/src/scripts/test-position-monitor.ts`](packages/trader/src/scripts/test-position-monitor.ts) - Prueba del PositionMonitor con diferentes configuraciones

Estos archivos quedan disponibles para debugging futuro.

## ✨ Mejoras Futuras Recomendadas

1. **Advertencia de posiciones no monitoreadas:** Si el API devuelve posiciones que no están en `monitoredSymbols`, mostrar un warning:
   ```
   ⚠️  Warning: Found 2 open position(s) for symbols not being monitored: [R_25, R_50]
   ```

2. **Auto-inclusión dinámica:** Opción para agregar automáticamente símbolos al `monitoredSymbols` cuando se detectan posiciones:
   ```typescript
   if (autoIncludeOpenPositions) {
     openPositions.forEach(pos => {
       if (!this.monitoredSymbols.includes(pos.symbol)) {
         this.monitoredSymbols.push(pos.symbol);
         console.log(`   ➕ Added ${pos.symbol} to monitored symbols`);
       }
     });
   }
   ```

3. **Dashboard web:** Mostrar visualmente todas las posiciones abiertas (monitoreadas o no) en el dashboard web.
