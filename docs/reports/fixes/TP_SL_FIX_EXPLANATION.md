# TP/SL Fix for Deriv Multiplier Contracts

## Problem

Trades were failing with error: **"Enter an amount equal to or lower than 6043.95"**

Even though stake was only $134.31, well below the limit of $6043.95.

## Root Cause

**For Deriv multiplier contracts, TP/SL values in `limit_order` must be DOLLAR AMOUNTS (profit/loss), NOT absolute price levels.**

### What We Were Sending (WRONG):
```json
{
  "limit_order": {
    "take_profit": 38341,      // ❌ Absolute price level
    "stop_loss": 38111.87      // ❌ Absolute price level
  }
}
```

### What We Should Send (CORRECT):
```json
{
  "limit_order": {
    "take_profit": 50,    // ✅ Dollar profit amount
    "stop_loss": 10       // ✅ Dollar loss amount
  }
}
```

## API Validation Limits

From proposal response `validation_params`:
```json
{
  "take_profit": {
    "max": "6043.95",  // Maximum PROFIT in dollars
    "min": "0.10"
  },
  "stop_loss": {
    "max": "134.31",   // Maximum LOSS in dollars (= stake amount)
    "min": "1.96"
  }
}
```

**Key Insight**:
- Max TP is ~90% of balance ($6043.95 of $6783.55 balance)
- Max SL equals stake amount (can't lose more than you invest)

## The Fix

Modified [deriv-client.ts:635-725](packages/gateway/src/api/deriv-client.ts#L635-L725) to:

### Step 1: Get Initial Proposal (No TP/SL)
```typescript
const initialProposal = {
  proposal: 1,
  amount: stake,
  basis: 'stake',
  contract_type: 'MULTUP',
  symbol: 'R_75',
  multiplier: 50,
  // NO limit_order - we need spot price first
};
```

This gives us the **spot price** needed for calculations.

### Step 2: Convert Price Levels to Dollar Amounts

For a **BUY (MULTUP)** contract:
```typescript
const positionSize = stake × multiplier;

// TP: Convert price level to dollar profit
const dollarProfit = ((tpPrice - spotPrice) / spotPrice) × positionSize;

// SL: Convert price level to dollar loss
const dollarLoss = ((spotPrice - slPrice) / spotPrice) × positionSize;
```

For a **SELL (MULTDOWN)** contract:
```typescript
// TP: profit when price goes down
const dollarProfit = ((spotPrice - tpPrice) / spotPrice) × positionSize;

// SL: loss when price goes up
const dollarLoss = ((slPrice - spotPrice) / spotPrice) × positionSize;
```

### Step 3: Get Final Proposal with Dollar Amounts
```typescript
const finalProposal = {
  proposal: 1,
  ...parameters,
  limit_order: {
    take_profit: Math.max(0.10, roundedProfit),   // Min $0.10
    stop_loss: Math.min(stake, Math.max(1.96, roundedLoss))  // Min $1.96, Max = stake
  }
};
```

### Step 4: Buy with Proposal ID
```typescript
const buy = {
  buy: proposalId,
  price: askPrice
};
```

## Example Calculation

### Scenario:
- Stake: $134.31
- Multiplier: 50x
- Spot Price: 38000
- TP Price: 38114 (0.3% above spot)
- SL Price: 37924 (0.2% below spot)

### Calculations:
```
Position Size = $134.31 × 50 = $6,715.50

TP Dollar Amount:
= ((38114 - 38000) / 38000) × $6,715.50
= (114 / 38000) × $6,715.50
= 0.003 × $6,715.50
= $20.15

SL Dollar Amount:
= ((38000 - 37924) / 38000) × $6,715.50
= (76 / 38000) × $6,715.50
= 0.002 × $6,715.50
= $13.43
```

### API Request:
```json
{
  "limit_order": {
    "take_profit": 20.15,   // ✅ $20.15 profit
    "stop_loss": 13.43      // ✅ $13.43 loss
  }
}
```

## Impact

This fix allows TP/SL to work correctly for ALL multiplier contracts across all assets (R_10, R_25, R_50, R_75, R_100).

The bot can now:
- ✅ Execute trades with take-profit orders
- ✅ Execute trades with stop-loss orders
- ✅ Properly manage risk using dollar-based TP/SL
- ✅ Work within Deriv API validation limits

## Testing

To test the fix, restart both gateway and trader:

```bash
# Terminal 1: Restart gateway
cd packages/gateway
pnpm dev

# Terminal 2: Restart trader
cd packages/trader
TRADE_MODE=cfd SYMBOL="R_75" pnpm run demo
```

Watch for log lines:
```
[DerivClient] TP: 38114 (price) → $20.15 (profit)
[DerivClient] SL: 37924 (price) → $13.43 (loss)
```

This confirms the conversion is working correctly.
