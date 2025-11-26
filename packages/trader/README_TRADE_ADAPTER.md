# 🔄 Trade Adapter - Switch between Binary Options and CFDs

El Trade Adapter permite que las estrategias funcionen con ambos tipos de contratos:
- **Binary Options**: CALL/PUT con expiración fija
- **CFDs/Multipliers**: BUY/SELL con TP/SL

## 📋 Características

✅ **UnifiedTradeAdapter**: Adapter principal que switchea entre modos
✅ **BinaryOptionsAdapter**: Para Binary Options (CALL/PUT)
✅ **CFDAdapter**: Para CFDs/Multipliers (BUY/SELL con TP/SL)
✅ **Conversión automática**: Convierte direcciones entre modos

## 🚀 Uso

### Ejemplo Básico

```typescript
import { UnifiedTradeAdapter } from '@deriv-bot/trader';
import { GatewayClient } from '@deriv-bot/trader';

// Crear cliente Gateway
const client = new GatewayClient({ url: 'ws://localhost:3000' });
await client.connect();

// Crear adapter en modo Binary Options
const adapter = new UnifiedTradeAdapter(client, 'binary');

// O cambiar a modo CFD
adapter.setMode('cfd');

// Ejecutar trade (automáticamente usa el modo correcto)
const result = await adapter.executeTrade({
  asset: 'R_75',
  direction: 'BUY', // o 'CALL' para binary
  amount: 100,
  // ... otros parámetros según el modo
});
```

### Modo Binary Options

```typescript
const adapter = new UnifiedTradeAdapter(client, 'binary');

const result = await adapter.executeTrade({
  asset: 'R_75',
  direction: 'CALL', // o 'PUT'
  amount: 10,
  duration: 1,
  durationUnit: 'm',
  strategyName: 'MyStrategy',
});
```

### Modo CFD/Multiplier

```typescript
const adapter = new UnifiedTradeAdapter(client, 'cfd');

const result = await adapter.executeTrade({
  asset: 'R_75',
  direction: 'BUY', // o 'SELL'
  amount: 100,
  multiplier: 30,
  takeProfit: 56500, // Precio de TP
  stopLoss: 56300,   // Precio de SL
  strategyName: 'MyStrategy',
});

// Cerrar trade manualmente
await adapter.closeTrade(result.contractId);
```

## 📊 Script de Demo

### RSI + Bollinger Bands Scalping

```bash
# Modo Binary Options (default)
cd packages/trader
TRADE_MODE=binary pnpm run demo:rsi-bb

# Modo CFD/Multiplier
TRADE_MODE=cfd pnpm run demo:rsi-bb
```

### Variables de Entorno

```bash
# Gateway
export GATEWAY_URL=ws://localhost:3000

# Trading
export SYMBOL=R_75
export INITIAL_CAPITAL=10000
export TRADE_MODE=binary  # o 'cfd'
```

## 🔧 API

### UnifiedTradeAdapter

```typescript
class UnifiedTradeAdapter {
  // Cambiar modo
  setMode(mode: 'binary' | 'cfd'): void;
  
  // Obtener modo actual
  getMode(): 'binary' | 'cfd';
  
  // Ejecutar trade
  executeTrade(params: TradeParams): Promise<TradeResult>;
  
  // Cerrar trade (solo CFDs)
  closeTrade(contractId: string): Promise<void>;
  
  // Convertir direcciones
  convertDirection(direction: 'BUY' | 'SELL'): 'CALL' | 'PUT';
  convertDirectionReverse(direction: 'CALL' | 'PUT'): 'BUY' | 'SELL';
}
```

## ⚠️ Notas

- **CFD Support**: Requiere extensión del Gateway para soporte completo de CFDs
- **Binary Options**: Totalmente soportado y funcional
- **Conversión**: El adapter convierte automáticamente entre CALL/PUT y BUY/SELL

## 📚 Ejemplos

Ver `packages/trader/src/scripts/run-rsi-bb-scalping-demo.ts` para un ejemplo completo.

