# Deriv API - Análisis Completo

## 📡 Conexión WebSocket

### Endpoint
```
wss://ws.derivws.com/websockets/v3?app_id={YOUR_APP_ID}
```

### App ID
- **Testing**: `1089` (para desarrollo)
- **Producción**: Obtener en https://api.deriv.com
- Requerido en la URL de conexión

### Ejemplo de Conexión
```typescript
import WebSocket from 'ws';

const app_id = 1089; // Testing
const connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

connection.onopen = () => {
  console.log('Connected to Deriv API');
};

connection.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  console.log('Received:', data);
};

connection.onerror = (error) => {
  console.error('WebSocket error:', error);
};

connection.onclose = () => {
  console.log('Connection closed');
};
```

### Keep-Alive
- **Timeout**: 2 minutos de inactividad
- **Solución**: Enviar `ping` periódicamente

```typescript
// Keep connection alive
setInterval(() => {
  if (connection.readyState === WebSocket.OPEN) {
    connection.send(JSON.stringify({ ping: 1 }));
  }
}, 60000); // Cada minuto
```

---

## 🔐 Autenticación

### Sin Autenticación (Market Data)
Algunos endpoints NO requieren auth:
- `active_symbols`
- `ticks`
- `ticks_history`
- `candles`
- `time`
- `website_status`

### Con Autenticación (Trading)
Endpoints que requieren token:
- `buy` (comprar contrato)
- `sell` (vender contrato)
- `portfolio`
- `balance`
- `profit_table`

### Obtener Token
1. Login en https://app.deriv.com
2. Ir a Settings → API token
3. Generar token con permisos necesarios

### Autorizar Sesión
```typescript
const authorize_request = {
  authorize: "YOUR_API_TOKEN"
};

connection.send(JSON.stringify(authorize_request));
```

**Response:**
```json
{
  "authorize": {
    "account_list": [...],
    "balance": 10000,
    "currency": "USD",
    "email": "user@example.com",
    "fullname": "John Doe",
    "loginid": "CR123456"
  },
  "msg_type": "authorize"
}
```

---

## 📊 Market Data APIs

### 1. Active Symbols
Obtener lista de assets disponibles para trading.

**Request:**
```json
{
  "active_symbols": "brief",
  "product_type": "basic"
}
```

**Response:**
```json
{
  "active_symbols": [
    {
      "allow_forward_starting": 0,
      "display_name": "EUR/USD",
      "exchange_is_open": 1,
      "is_trading_suspended": 0,
      "market": "forex",
      "market_display_name": "Forex",
      "pip": 0.0001,
      "submarket": "major_pairs",
      "submarket_display_name": "Major Pairs",
      "symbol": "frxEURUSD",
      "symbol_type": "forex"
    },
    {
      "display_name": "Volatility 10 Index",
      "market": "synthetic_index",
      "submarket": "random_index",
      "symbol": "R_10",
      "symbol_type": "stockindex"
    }
    // ... más símbolos
  ],
  "msg_type": "active_symbols"
}
```

**Categorías de Assets:**
- **Forex**: `frxEURUSD`, `frxGBPUSD`, etc.
- **Índices Sintéticos**: `R_10`, `R_25`, `R_50`, `R_75`, `R_100`
- **Volatility Indices**: `BOOM500`, `BOOM1000`, `CRASH500`, `CRASH1000`
- **Commodities**: Oro, Plata, Petróleo
- **Indices**: Wall Street, US Tech, etc.

### 2. Ticks (Real-time)
Subscribe a ticks en tiempo real de un asset.

**Request (Subscribe):**
```json
{
  "ticks": "R_100",
  "subscribe": 1
}
```

**Response (Initial):**
```json
{
  "echo_req": {
    "subscribe": 1,
    "ticks": "R_100"
  },
  "msg_type": "tick",
  "subscription": {
    "id": "unique_subscription_id"
  },
  "tick": {
    "ask": 456.123,
    "bid": 456.103,
    "epoch": 1704067200,
    "id": "unique_tick_id",
    "pip_size": 2,
    "quote": 456.113,
    "symbol": "R_100"
  }
}
```

**Subsequent Ticks:**
Cada tick nuevo llega con la misma estructura:
```json
{
  "tick": {
    "ask": 456.234,
    "bid": 456.214,
    "epoch": 1704067201,
    "quote": 456.224,
    "symbol": "R_100"
  }
}
```

**Unsubscribe:**
```json
{
  "forget": "unique_subscription_id"
}
```

### 3. Ticks History
Obtener histórico de ticks.

**Request:**
```json
{
  "ticks_history": "R_100",
  "end": "latest",
  "start": 1704000000,
  "count": 1000,
  "style": "ticks"
}
```

**Response:**
```json
{
  "echo_req": {
    "count": 1000,
    "end": "latest",
    "start": 1704000000,
    "style": "ticks",
    "ticks_history": "R_100"
  },
  "history": {
    "prices": [456.123, 456.234, 456.345, ...],
    "times": [1704000001, 1704000002, 1704000003, ...]
  },
  "msg_type": "history",
  "pip_size": 2
}
```

### 4. Candles (OHLC)
Obtener velas OHLC históricas.

**Request:**
```json
{
  "ticks_history": "R_100",
  "end": "latest",
  "start": 1704000000,
  "count": 500,
  "style": "candles",
  "granularity": 60
}
```

**Granularities disponibles:**
- `60` = 1 minuto
- `120` = 2 minutos
- `180` = 3 minutos
- `300` = 5 minutos
- `600` = 10 minutos
- `900` = 15 minutos
- `1800` = 30 minutos
- `3600` = 1 hora
- `14400` = 4 horas
- `86400` = 1 día

**Response:**
```json
{
  "candles": [
    {
      "close": 456.234,
      "epoch": 1704000060,
      "high": 456.345,
      "low": 456.123,
      "open": 456.200
    },
    {
      "close": 456.456,
      "epoch": 1704000120,
      "high": 456.567,
      "low": 456.234,
      "open": 456.234
    }
    // ... más velas
  ],
  "echo_req": {
    "count": 500,
    "end": "latest",
    "granularity": 60,
    "start": 1704000000,
    "style": "candles",
    "ticks_history": "R_100"
  },
  "msg_type": "candles",
  "pip_size": 2
}
```

### 5. Candles Stream (Real-time)
Subscribe a velas en tiempo real.

**Request:**
```json
{
  "ticks_history": "R_100",
  "end": "latest",
  "count": 1,
  "style": "candles",
  "granularity": 60,
  "subscribe": 1
}
```

**Response:**
Cada minuto llega una nueva vela:
```json
{
  "candles": [
    {
      "close": 456.789,
      "epoch": 1704067260,
      "high": 456.890,
      "low": 456.678,
      "open": 456.700
    }
  ],
  "subscription": {
    "id": "unique_subscription_id"
  }
}
```

---

## 💰 Trading APIs

### 1. Contracts For Symbol
Obtener contratos disponibles para un símbolo.

**Request:**
```json
{
  "contracts_for": "R_100",
  "currency": "USD",
  "product_type": "basic"
}
```

**Response:**
```json
{
  "contracts_for": {
    "available": [
      {
        "contract_category": "callput",
        "contract_category_display": "Up/Down",
        "contract_display": "Higher",
        "contract_type": "CALL",
        "max_contract_duration": "365d",
        "min_contract_duration": "15s",
        "sentiment": "up"
      },
      {
        "contract_category": "callput",
        "contract_display": "Lower",
        "contract_type": "PUT",
        "max_contract_duration": "365d",
        "min_contract_duration": "15s",
        "sentiment": "down"
      }
      // ... más tipos de contratos
    ]
  },
  "msg_type": "contracts_for"
}
```

### 2. Price Proposal
Obtener precio de un contrato ANTES de comprarlo.

**Request:**
```json
{
  "proposal": 1,
  "amount": 10,
  "basis": "stake",
  "contract_type": "CALL",
  "currency": "USD",
  "duration": 1,
  "duration_unit": "m",
  "symbol": "R_100",
  "subscribe": 1
}
```

**Parámetros:**
- `amount`: Monto a apostar
- `basis`: `"stake"` (apuesta) o `"payout"` (ganancia)
- `contract_type`: `"CALL"` o `"PUT"`
- `duration`: Duración del contrato
- `duration_unit`: `"s"` (segundos), `"m"` (minutos), `"h"` (horas), `"d"` (días)
- `symbol`: Asset a tradear
- `subscribe`: `1` para actualizaciones en tiempo real

**Response:**
```json
{
  "proposal": {
    "ask_price": 10,
    "date_start": 1704067200,
    "display_value": "9.30 USD",
    "id": "proposal_id_123",
    "longcode": "Win payout if Volatility 100 Index is strictly higher than entry spot at 1 minute after contract start time.",
    "payout": 19.30,
    "spot": 456.123,
    "spot_time": 1704067200
  },
  "subscription": {
    "id": "unique_subscription_id"
  }
}
```

**Cálculo de Payout:**
- `stake`: $10
- `payout`: $19.30
- `profit si gana`: $19.30 - $10 = $9.30
- `payout %`: 93% (9.30 / 10)

### 3. Buy Contract
Comprar un contrato.

**Método 1: Usando proposal_id**
```json
{
  "buy": "proposal_id_123",
  "price": 10
}
```

**Método 2: Parámetros directos**
```json
{
  "buy": 1,
  "price": 10,
  "parameters": {
    "amount": 10,
    "basis": "stake",
    "contract_type": "CALL",
    "currency": "USD",
    "duration": 1,
    "duration_unit": "m",
    "symbol": "R_100"
  },
  "subscribe": 1
}
```

**Response (Contract Opened):**
```json
{
  "buy": {
    "balance_after": 9990,
    "buy_price": 10,
    "contract_id": 123456789,
    "longcode": "Win payout if Volatility 100 Index is strictly higher than entry spot at 1 minute after contract start time.",
    "payout": 19.30,
    "purchase_time": 1704067200,
    "start_time": 1704067200,
    "transaction_id": 987654321
  },
  "subscription": {
    "id": "unique_subscription_id"
  }
}
```

**Updates (Mientras está abierto):**
```json
{
  "proposal_open_contract": {
    "contract_id": 123456789,
    "current_spot": 456.345,
    "current_spot_time": 1704067230,
    "entry_spot": 456.123,
    "is_sold": 0,
    "status": "open"
  }
}
```

**Final Result:**
```json
{
  "proposal_open_contract": {
    "contract_id": 123456789,
    "current_spot": 456.456,
    "entry_spot": 456.123,
    "exit_tick": 456.456,
    "is_sold": 1,
    "profit": 9.30,
    "sell_price": 19.30,
    "sell_time": 1704067260,
    "status": "won"
  }
}
```

**Status posibles:**
- `"open"`: Contrato abierto
- `"won"`: Ganó
- `"lost"`: Perdió

### 4. Portfolio
Ver contratos abiertos.

**Request:**
```json
{
  "portfolio": 1
}
```

**Response:**
```json
{
  "portfolio": {
    "contracts": [
      {
        "contract_id": 123456789,
        "contract_type": "CALL",
        "currency": "USD",
        "longcode": "...",
        "payout": 19.30,
        "purchase_time": 1704067200,
        "symbol": "R_100"
      }
    ]
  }
}
```

---

## 📦 Paquete @deriv/deriv-api

### Instalación
```bash
npm install @deriv/deriv-api ws
```

### Uso Básico
```typescript
import DerivAPI from '@deriv/deriv-api';
import WebSocket from 'ws';

const connection = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
const api = new DerivAPI({ connection });

// Ping
const ping_response = await api.ping();

// Active symbols
const symbols = await api.activeSymbols();

// Subscribe to ticks
const ticks_subscriber = api.subscribe({ ticks: 'R_100' });

ticks_subscriber.subscribe((tick) => {
  console.log('Tick:', tick);
});

// Unsubscribe
ticks_subscriber.unsubscribe();
```

### API de Alto Nivel
```typescript
// Ticks stream
const ticks = api.ticks('R_100');

ticks.onUpdate().subscribe((tick) => {
  console.log('Tick update:', tick);
});

// History
const history = await ticks.history({ count: 100 });

// Candles
const candles = api.candleStream('R_100', { granularity: 60 });

candles.onUpdate().subscribe((candle) => {
  console.log('Candle:', candle);
});
```

---

## 🎯 Flujo Completo de Trading

### 1. Conectar
```typescript
const connection = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
```

### 2. Obtener Assets Disponibles
```typescript
connection.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
```

### 3. Subscribe a Ticks
```typescript
connection.send(JSON.stringify({ ticks: 'R_100', subscribe: 1 }));
```

### 4. Obtener Histórico (para indicadores)
```typescript
connection.send(JSON.stringify({
  ticks_history: 'R_100',
  end: 'latest',
  count: 500,
  style: 'candles',
  granularity: 60
}));
```

### 5. Generar Señal (en tu estrategia)
```typescript
// RSI > 70 → PUT
// RSI < 30 → CALL
```

### 6. Obtener Precio (proposal)
```typescript
connection.send(JSON.stringify({
  proposal: 1,
  amount: 10,
  basis: 'stake',
  contract_type: 'CALL',
  currency: 'USD',
  duration: 1,
  duration_unit: 'm',
  symbol: 'R_100'
}));
```

### 7. Comprar Contrato
```typescript
connection.send(JSON.stringify({
  buy: proposal_id,
  price: 10
}));
```

### 8. Monitorear Resultado
```typescript
// Llegan updates automáticos con el status
```

---

## 🚨 Manejo de Errores

### Error Response Format
```json
{
  "error": {
    "code": "InvalidToken",
    "message": "The token you used is invalid or expired."
  },
  "msg_type": "authorize"
}
```

### Errores Comunes
- `InvalidToken`: Token inválido o expirado
- `AuthorizationRequired`: Endpoint requiere autenticación
- `InvalidSymbol`: Símbolo no existe
- `RateLimit`: Demasiados requests
- `ContractNotAvailable`: Contrato no disponible
- `InsufficientBalance`: Balance insuficiente

---

## 📝 Notas Importantes

### Límites
- **Rate Limit**: ~5 requests/segundo (no documentado oficialmente)
- **Subscriptions**: Múltiples subscriptions por conexión
- **Timeout**: 2 minutos sin actividad

### Best Practices
1. **Keep-alive**: Ping cada 60 segundos
2. **Reconnection**: Implementar auto-reconnect
3. **Error Handling**: Catch all errors y log
4. **req_id**: Usar para mapear requests/responses
5. **Unsubscribe**: Limpiar subscriptions al terminar

### Testing
- **Demo Account**: Usar para testing sin riesgo
- **App ID 1089**: Para desarrollo local
- **Virtual Money**: Balance demo no se pierde

---

## 🔗 Referencias

- **API Explorer**: https://api.deriv.com/
- **Documentación**: https://developers.deriv.com/
- **GitHub**: https://github.com/deriv-com/deriv-api
- **NPM Package**: https://www.npmjs.com/package/@deriv/deriv-api
