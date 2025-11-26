# Risk Management Fix: Stake Calculation

## Problema Identificado

El stake por operación estaba siendo del **~10% del balance** en lugar del 1-2% configurado.

### Ejemplo del Bug

**Balance:** $7,000
**Risk configurado:** 2%
**Stake esperado:** $140 (2% de $7,000)
**Stake real:** $700 (10% de $7,000) ❌

## Causa Raíz

La fórmula de cálculo del stake para CFDs estaba incorrecta:

**ANTES (Incorrecto):**
```typescript
const riskAmount = balance * riskPercentageCFD;  // 2% = $140
const stakeRaw = riskAmount / slPercentage;      // $140 / 0.25% = $56,000
stake = Math.min(stakeRaw, balance * 0.10);      // Limitado a 10% = $700
```

**Problema:** La división por `slPercentage` multiplicaba el stake por ~400x, luego se limitaba al 10% máximo.

## Solución Implementada

**DESPUÉS (Correcto):**
```typescript
// CFD: Direct percentage of balance
const stakeRaw = balance * riskPercentageCFD;
stake = Math.floor(stakeRaw * 100) / 100;
```

**Por qué funciona:**
- Con Multipliers + TP/SL, el risk management ya está incluido en el broker
- El stake es simplemente el porcentaje del balance que queremos arriesgar por trade
- No necesitamos dividir por SL porque el SL es manejado por el broker

## Nuevos Defaults

**File:** [packages/trader/src/trade-management/risk-manager.ts:16-25](packages/trader/src/trade-management/risk-manager.ts#L16-L25)

```typescript
constructor(config?: Partial<RiskConfig>) {
  this.config = {
    maxOpenTrades: 3,
    maxTradesPerSymbol: 1,
    riskPercentageCFD: 0.01,        // 1% (antes: 2%)
    riskPercentageBinary: 0.01,     // 1%
    minStake: 1.0,
    maxStakePercentage: 0.02,       // 2% max (antes: 10%)
  };
}
```

### Cambios de Defaults:
1. **riskPercentageCFD:** 2% → **1%** (más conservador)
2. **maxStakePercentage:** 10% → **2%** (safety limit más estricto)

## Ejemplos de Cálculo

### Balance: $8,000

| Risk % | Stake por Trade | Max Trades (3) | Capital en Riesgo |
|--------|-----------------|----------------|-------------------|
| 1%     | **$80**         | $240           | 3% del balance    |
| 2%     | **$160**        | $480           | 6% del balance    |

### Balance: $10,000

| Risk % | Stake por Trade | Max Trades (3) | Capital en Riesgo |
|--------|-----------------|----------------|-------------------|
| 1%     | **$100**        | $300           | 3% del balance    |
| 2%     | **$200**        | $600           | 6% del balance    |

## Logs Añadidos

Para debugging, se añadieron logs en el cálculo:

```
[RiskManager] CFD Stake calculation:
   Balance: $8000.00
   Risk percentage: 1.00%
   Calculated stake: $80.00
   After limits (min: $1.00, max: $160.00): $80.00
```

## Archivos Modificados

- [packages/trader/src/trade-management/risk-manager.ts](packages/trader/src/trade-management/risk-manager.ts)
  - Líneas 16-25: Nuevos defaults (1% risk, 2% max)
  - Líneas 74-105: Nueva fórmula de cálculo simplificada

## Impacto

### Antes (Bug)
- ❌ Stake ~10% del balance por trade
- ❌ 3 trades = 30% del capital en riesgo
- ❌ Risk management inefectivo
- ❌ Exposición excesiva

### Después (Fijo)
- ✅ Stake 1-2% del balance por trade
- ✅ 3 trades = 3-6% del capital en riesgo
- ✅ Risk management conservador y efectivo
- ✅ Exposición controlada

## Configuración Recomendada

Para live trading, usa:

```typescript
risk: {
  maxOpenTrades: 3,
  maxTradesPerSymbol: 1,
  riskPercentageCFD: 0.01,        // 1% conservative
  maxStakePercentage: 0.02,       // 2% hard limit
}
```

Para testing agresivo:

```typescript
risk: {
  maxOpenTrades: 3,
  maxTradesPerSymbol: 1,
  riskPercentageCFD: 0.02,        // 2% aggressive
  maxStakePercentage: 0.03,       // 3% hard limit
}
```

## Testing

```bash
# Build
pnpm --filter @deriv-bot/trader build

# Run demo
export TRADE_MODE=cfd
export RISK_PERCENTAGE=0.01  # 1%
pnpm demo:sr
```

**Logs esperados:**
```
[RiskManager] CFD Stake calculation:
   Balance: $8000.00
   Risk percentage: 1.00%
   Calculated stake: $80.00
   After limits (min: $1.00, max: $160.00): $80.00
```

## Relacionado

- [PORTFOLIO_API_FIX_SUMMARY.md](PORTFOLIO_API_FIX_SUMMARY.md) - Fix de detección de posiciones
- [CRITICAL_FIXES_GUARDIAN_MODE.md](CRITICAL_FIXES_GUARDIAN_MODE.md) - Virtual Trailing Stop
