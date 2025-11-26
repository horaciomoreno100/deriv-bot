# 🧪 Live Trading Validation Guide

## Purpose

This guide walks you through validating the entire live trading infrastructure using a **high-frequency test strategy** that generates 30-50 signals per hour.

⚠️ **CRITICAL:** Use DEMO account ONLY for validation!

---

## What Gets Validated

✅ Gateway connection & WebSocket communication
✅ Real-time candle streaming
✅ Strategy execution pipeline
✅ Signal generation logic
✅ Trade placement via Deriv API
✅ Order tracking & monitoring
✅ Result notification system
✅ Error handling & recovery
✅ State management

---

## Prerequisites

### 1. Deriv Demo Account

1. Go to https://deriv.com
2. Create a FREE demo account
3. Get your API token:
   - Go to Settings → API Token
   - Create token with scopes: `read`, `trade`, `trading_information`
   - Copy the token

### 2. Environment Setup

Create `.env` file in `/packages/gateway`:

```bash
# Deriv API Configuration
DERIV_APP_ID=your_app_id_here
DERIV_API_TOKEN=your_demo_api_token_here
DERIV_API_URL=wss://ws.derivws.com/websockets/v3?app_id=your_app_id

# Gateway Configuration
PORT=3001
LOG_LEVEL=debug

# Database
DATABASE_URL_GATEWAY=file:./prisma/dev.db
```

### 3. Database Setup

```bash
cd packages/gateway
DATABASE_URL_GATEWAY="file:./prisma/dev.db" npx prisma migrate dev
```

---

## Validation Test Strategy

### Parameters (Ultra-Relaxed for Max Signals)

```typescript
RSI Oversold:    40  (vs 24 in production)
RSI Overbought:  60  (vs 76 in production)
Cooldown:        5 seconds  (vs 30s in production)
Max Concurrent:  5 trades
```

### Expected Behavior

- **Frequency:** Signal every 5-30 seconds
- **Total Signals:** 30-50 in first hour
- **Concurrent Trades:** Up to 5 active at once
- **Contract:** R_25, 3min expiry, $1 stake

---

## Step-by-Step Validation

### Step 1: Start the Gateway

```bash
# Terminal 1
cd packages/gateway
pnpm dev
```

**Expected Output:**
```
🚀 Gateway server starting on port 3001
✅ Database connected
✅ Deriv API connected
📡 WebSocket server listening
```

### Step 2: Run Validation Test

```bash
# Terminal 2
cd packages/trader
pnpm test:validation
```

**Expected Output:**
```
🧪 Starting Validation Test - Ultra High Frequency
================================================================================

This will generate MANY signals (30-50/hour) to validate:
  ✅ Gateway connection & communication
  ✅ Strategy execution pipeline
  ✅ Trade placement & tracking
  ✅ Result monitoring

⚠️  WARNING: This is NOT a real trading strategy!
   Use DEMO account only for validation.

================================================================================

📡 Connecting to Gateway...
✅ Connected to Gateway
📊 Strategy loaded: Validation-Test
   Description: Ultra high-frequency strategy for testing live trading infrastructure

⚙️  Validation Parameters:
   RSI Oversold:  40 (very relaxed)
   RSI Overbought: 60 (very relaxed)
   Cooldown:      5000ms (5 seconds!)
   Max Concurrent: 5

🎯 Trading Configuration:
   Symbol:        R_25 (Volatility 25 Index)
   Timeframe:     1 minute
   Contract:      Rise/Fall (DIGITDIFF)
   Expiry:        3 minutes
   Stake:         $1.00 (minimum for testing)
   Max Active:    5 trades

🚀 Starting Strategy Engine...

Expected behavior:
  - Signals every 5-30 seconds
  - 30-50 total signals in first hour
  - Up to 5 concurrent trades

Press Ctrl+C to stop
================================================================================

[INFO] 🔵 CALL signal generated - RSI: 38.45 < 40
[INFO] 📤 Sending trade request to Gateway...
[INFO] ✅ Trade placed: contract_id=12345678
[INFO] 📊 Active trades: 1/5

[INFO] 🔴 PUT signal generated - RSI: 62.11 > 60
[INFO] 📤 Sending trade request to Gateway...
[INFO] ✅ Trade placed: contract_id=87654321
[INFO] 📊 Active trades: 2/5

...
```

### Step 3: Monitor for 15-30 Minutes

Watch for:

✅ **Signal Generation:**
- Signals appearing every 5-30 seconds
- Both CALL and PUT signals
- RSI values logged correctly

✅ **Trade Placement:**
- "Trade placed" confirmations
- Contract IDs received
- Active trade count updates

✅ **Trade Results:**
- Trades completing after 3 minutes
- Win/Loss notifications
- Active count decrements

✅ **Error Handling:**
- No crashes or exceptions
- Reconnection if connection drops
- Graceful error messages

❌ **Red Flags:**
- No signals generated
- Signals but no trades placed
- Trades not completing
- Connection errors
- Crashes or freezes

---

## Validation Checklist

After running for 30 minutes, verify:

- [ ] At least 15-25 signals generated
- [ ] At least 10 trades successfully placed
- [ ] At least 5 trades completed (won or lost)
- [ ] No unhandled errors or crashes
- [ ] Active trade count accurate
- [ ] Balance updates correctly
- [ ] Logs are clear and informative
- [ ] Can stop gracefully with Ctrl+C

---

## Common Issues & Solutions

### Issue: No signals generated

**Cause:** RSI not reaching thresholds
**Solution:** Wait longer (5-10 min) or lower thresholds to 35/65

### Issue: Signals but no trades placed

**Cause:** Gateway connection or API issue
**Solution:**
1. Check Gateway logs for errors
2. Verify Deriv API token is valid
3. Check demo account has balance

### Issue: Trades placed but never complete

**Cause:** Contract tracking issue
**Solution:**
1. Check if contracts are visible in Deriv dashboard
2. Verify contract_id in logs
3. Check Gateway database for contract records

### Issue: Connection drops frequently

**Cause:** Network or WebSocket issues
**Solution:**
1. Check internet connection
2. Verify Deriv API URL correct
3. Add reconnection logic (already implemented)

---

## After Successful Validation

Once you've confirmed everything works:

### 1. Stop Validation Test

```bash
# Press Ctrl+C in Terminal 2
```

### 2. Review Stats

Check Gateway database:

```bash
cd packages/gateway
DATABASE_URL_GATEWAY="file:./prisma/dev.db" npx prisma studio
```

Look at:
- `Contract` table: All trades recorded
- `Balance` table: Balance history
- `StateSnapshot` table: Strategy states

### 3. Next Steps

Choose your path:

**Option A - Conservative (Recommended):**
- Use **V6-HF** strategy (52.8% WR, +27.9% ROI)
- Start with small stake ($1-5)
- Monitor for 24-48 hours on demo
- Move to live with small amounts

**Option B - Quality-Focused:**
- Use **V5 MTF** strategy (53.8% WR, +18.1% ROI)
- Lower frequency but better win rate
- More conservative approach

---

## Production Strategy Migration

To switch from validation to production strategy:

### 1. Create Production Mean Reversion Strategy

```bash
# Copy template
cp packages/trader/src/strategies/validation-test.strategy.ts \
   packages/trader/src/strategies/mean-reversion-live.strategy.ts
```

### 2. Update Parameters to V6-HF

```typescript
// Production V6-HF parameters
private readonly RSI_OVERSOLD = 24;
private readonly RSI_OVERBOUGHT = 76;
private readonly COOLDOWN_MS = 30000;  // 30 seconds
private readonly MAX_CONCURRENT = 3;
```

### 3. Add Indicators

```typescript
// Add ATR, Bollinger Bands, Stochastic
// (See mean-reversion-demo-v2.ts for reference)
```

### 4. Test on Demo First!

```bash
pnpm demo  # Use existing demo script
```

---

## Safety Checklist Before Live Trading

- [ ] ✅ Validation test passed (15+ signals, 10+ trades)
- [ ] ✅ Tested production strategy on demo for 24+ hours
- [ ] ✅ Win rate matches backtest expectations (±2%)
- [ ] ✅ Using DEMO account token (not live)
- [ ] ✅ Start stake is small ($1-5 maximum)
- [ ] ✅ Stop-loss limits configured
- [ ] ✅ Monitoring/alerts set up
- [ ] ✅ Emergency stop procedure tested

---

## Emergency Stop Procedure

If anything goes wrong:

1. **Immediate Stop:**
   ```bash
   # Press Ctrl+C in trader terminal
   ```

2. **Verify Stopped:**
   - Check no new trades in Deriv dashboard
   - Verify Gateway shows "Strategy stopped"

3. **Close Open Positions (if needed):**
   - Go to Deriv dashboard
   - Manually close any open positions

4. **Review Logs:**
   ```bash
   # Check what went wrong
   cat packages/gateway/logs/trading.log
   ```

---

## Support & Troubleshooting

If you encounter issues:

1. Check logs in `packages/gateway/logs/`
2. Review database in Prisma Studio
3. Test Deriv API connection separately
4. Verify all environment variables set

---

## Summary

This validation test:
- ✅ Generates 30-50 signals/hour
- ✅ Tests entire trading pipeline
- ✅ Uses $1 stakes (minimal risk)
- ✅ Runs on demo account (no real money)
- ✅ Takes 30 minutes to complete

**After passing validation, you're ready for production strategy testing on demo account.**

Good luck! 🚀
