# Arquitectura Desacoplada - Provider/Consumer

## Visión General

El sistema está diseñado con una **arquitectura desacoplada** donde:

- **Trader** = Provider (productor de datos)
- **Dashboard** = Consumer (consumidor de datos)
- **Gateway** = Message Broker (intermediario de comunicación)

```
┌─────────────────────────────────────────────────────────┐
│                     GATEWAY                             │
│              (Message Broker/Hub)                       │
│                                                         │
│  - WebSocket Server                                     │
│  - Deriv API Integration                                │
│  - Market Data Cache                                    │
│  - Event Broadcasting                                   │
│  - State Management                                     │
└────┬───────────────────────────┬────────────────────────┘
     │                           │
     │ Publish                   │ Subscribe
     │ (Provider)                │ (Consumer)
     │                           │
┌────▼───────────────┐     ┌────▼──────────────┐
│      TRADER        │     │     DASHBOARD      │
│    (Provider)      │     │    (Consumer)      │
│                    │     │                    │
│ - StrategyEngine   │     │ - Ink UI           │
│ - Signal Gen       │     │ - Read-Only        │
│ - Trade Execution  │     │ - Visualization    │
│ - Indicator Calc   │     │ - No Processing    │
│ - Publishes:       │     │ - Subscribes:      │
│   • Signals        │     │   • Balance        │
│   • Proximity      │     │   • Positions      │
│   • Indicators     │     │   • Ticks          │
│   • Trades         │     │   • Proximity      │
└────────────────────┘     └────────────────────┘
```

## Principios de Diseño

### 1. Separación de Responsabilidades

**Trader (Provider)**
- ✅ Ejecuta estrategias de trading
- ✅ Calcula indicadores técnicos
- ✅ Genera señales de trading
- ✅ Ejecuta trades
- ✅ Publica eventos al Gateway

**Dashboard (Consumer)**
- ✅ Visualiza datos en tiempo real
- ✅ Lee datos del Gateway
- ❌ NO ejecuta estrategias
- ❌ NO calcula indicadores
- ❌ NO genera señales
- ❌ NO ejecuta trades

**Gateway (Message Broker)**
- ✅ Integración con Deriv API
- ✅ Gestión de conexiones WebSocket
- ✅ Broadcasting de eventos
- ✅ Caché de datos de mercado
- ✅ Gestión de estado centralizado

### 2. Sin Duplicación de Procesamiento

**Antes (Acoplado)**
```typescript
// Dashboard tenía su propio StrategyEngine
const dashboard = new Dashboard();
const strategyEngine = new StrategyEngine(); // ❌ Duplicación!

// Dashboard calculaba indicadores
strategyEngine.processCandle(candle); // ❌ Procesamiento duplicado!
```

**Ahora (Desacoplado)**
```typescript
// Dashboard solo consume del Gateway
const dashboard = new Dashboard();
const dataProvider = new SimpleDashboardDataProvider(gatewayClient); // ✅ Solo lectura!

// Dashboard solo visualiza, no procesa
gatewayClient.on('signal:proximity', (data) => {
  // ✅ Solo muestra los datos recibidos
});
```

### 3. Single Source of Truth

El **Gateway** es la única fuente de verdad para:
- Balance de cuenta
- Posiciones abiertas
- Datos de mercado (ticks, candles)
- Estado de trades

El **Trader** publica información adicional:
- Signal proximity
- Indicadores calculados
- Eventos de estrategias

## Flujo de Datos

### Flujo de Signal Proximity

```
1. Trader calcula proximidad de señal
   ├─> Strategy.getSignalProximity()
   └─> Returns: { asset, proximity, direction, conditions }

2. Trader publica al Gateway
   ├─> gatewayClient.publishSignalProximity(proximity)
   └─> Gateway.broadcast('signal:proximity', data)

3. Dashboard recibe del Gateway
   ├─> gatewayClient.on('signal:proximity', (data) => {})
   └─> SimpleDashboardDataProvider.signalProximityCache.set(asset, data)

4. Dashboard visualiza
   └─> SignalProximityPanel renders cached data
```

### Flujo de Market Data

```
1. Gateway recibe tick de Deriv API
   └─> DerivClient.on('tick', tick)

2. Gateway broadcast a todos los clientes
   └─> WebSocketServer.broadcast('tick', tick)

3. Trader y Dashboard reciben
   ├─> Trader: processes tick, calculates indicators
   └─> Dashboard: updates price display
```

## Implementación

### 1. Protocol WebSocket

```typescript
// packages/gateway/src/ws/protocol.ts
export interface EventMessage extends BaseMessage {
  type: 'tick' | 'balance' | 'signal:proximity' | ...;
  data: any;
}
```

### 2. Shared Types

```typescript
// packages/shared/src/types/strategy.ts
export interface SignalProximity {
  asset: string;
  direction: 'call' | 'put' | 'neutral';
  overallProximity: number;
  criteria: Array<{
    name: string;
    current: number;
    target: number;
    passed: boolean;
  }>;
}
```

### 3. Gateway Client (Trader & Dashboard)

```typescript
// packages/trader/src/client/gateway-client.ts
export interface GatewayClientEvents {
  'signal:proximity': (data: SignalProximity) => void;
  // ... otros eventos
}
```

### 4. Simple Dashboard Data Provider

```typescript
// packages/trader/src/dashboard/dashboard-data-provider-simple.ts
export class SimpleDashboardDataProvider {
  private signalProximityCache: Map<string, SignalProximity> = new Map();

  constructor(private gatewayClient: GatewayClient) {
    // Subscribe to signal proximity updates
    this.gatewayClient.on('signal:proximity', (data) => {
      this.signalProximityCache.set(data.asset, data);
    });
  }
}
```

## Ventajas de la Arquitectura Desacoplada

### ✅ Performance
- **Sin duplicación de cálculos**: Solo el trader calcula indicadores
- **Menos carga en el dashboard**: Solo visualiza, no procesa
- **Mejor uso de recursos**: Un solo proceso pesado (trader)

### ✅ Escalabilidad
- **Múltiples dashboards**: Varios clientes pueden conectarse sin overhead
- **Traders independientes**: Pueden correr en diferentes máquinas
- **Balanceo de carga**: Gateway puede distribuir carga

### ✅ Mantenibilidad
- **Código más simple**: Cada componente tiene una responsabilidad
- **Testing más fácil**: Components son independientes
- **Debugging más claro**: Flujo de datos es unidireccional

### ✅ Flexibilidad
- **Dashboard sin trader**: Puedes monitorear sin ejecutar trades
- **Múltiples UIs**: CLI, Web, Mobile pueden consumir del mismo Gateway
- **Hot-swap strategies**: Cambiar estrategias sin reiniciar dashboard

## Uso

### Iniciar Sistema Completo

```bash
# Terminal 1 - Gateway (siempre requerido)
cd packages/gateway
pnpm start

# Terminal 2 - Trader (provider)
cd packages/trader
TRADE_MODE=cfd SYMBOL="R_75,R_100" pnpm run trader:rsi-bb

# Terminal 3 - Dashboard (consumer)
cd packages/trader
SYMBOL="R_75,R_100" pnpm run dashboard
```

### Solo Dashboard (sin trading)

```bash
# Terminal 1 - Gateway
cd packages/gateway
pnpm start

# Terminal 2 - Dashboard (solo visualización)
cd packages/trader
SYMBOL="R_75,R_100" pnpm run dashboard
```

**Nota**: Signal proximity solo aparecerá si el trader está corriendo y publicando datos.

## Próximos Pasos

### Fase 1: Completar Desacoplamiento ✅
- [x] Remover StrategyEngine del dashboard
- [x] Crear SimpleDashboardDataProvider
- [x] Agregar protocolo signal:proximity
- [x] Actualizar GatewayClient con nuevo evento

### Fase 2: Trader como Publisher (Pendiente)
- [ ] Agregar método `publishSignalProximity()` en GatewayClient
- [ ] Trader llama a `publishSignalProximity()` periódicamente
- [ ] Gateway broadcast signal:proximity a todos los clientes

### Fase 3: Web UI (Futuro)
- [ ] Crear Web UI que consume del Gateway
- [ ] Usar WebSocket en el browser
- [ ] Mismo protocolo que CLI Dashboard

## Comandos Rápidos

```bash
# Dashboard simple (consumer puro)
pnpm run dashboard

# Dashboard legacy (con StrategyEngine)
pnpm run dashboard:legacy

# Trader RSI+BB
TRADE_MODE=cfd SYMBOL="R_75,R_100" pnpm run trader:rsi-bb
```

## Troubleshooting

### Dashboard muestra "Waiting for trader to publish signal proximity..."

**Causa**: El trader no está corriendo o no está publicando signal proximity.

**Solución**: Inicia el trader en otra terminal:
```bash
TRADE_MODE=cfd SYMBOL="R_75,R_100" pnpm run trader:rsi-bb
```

### Posiciones no aparecen

**Causa**: El Gateway no tiene posiciones abiertas o hay un problema de conexión.

**Solución**:
1. Verifica que el Gateway esté corriendo: `lsof -i:3000`
2. Verifica que el trader haya ejecutado trades
3. Presiona `r` para refrescar manualmente

### Dashboard se congela

**Causa**: Ink tiene problemas con input cuando se ejecuta en background.

**Solución**: Siempre ejecuta el dashboard en una terminal interactiva (no en background).

## Referencias

- [Gateway Protocol](packages/gateway/src/ws/protocol.ts)
- [Shared Types](packages/shared/src/types/)
- [Dashboard Data Provider](packages/trader/src/dashboard/dashboard-data-provider-simple.ts)
- [Gateway Client](packages/trader/src/client/gateway-client.ts)
