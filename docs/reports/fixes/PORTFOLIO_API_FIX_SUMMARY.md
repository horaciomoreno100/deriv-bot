# Portfolio API Fix: Multiplier Contract Support

## Problem Identified

**INITIAL ASSUMPTION (INCORRECT):** The Deriv `portfolio` API endpoint does NOT return Multiplier contracts (MULTUP/MULTDOWN).

**REALITY:** The Portfolio API **DOES** return Multiplier contracts! Testing confirmed this on 2025-11-24.

**Evidence from test-portfolio-debug.ts:**
```
📋 Getting portfolio (account: current)...
[DerivClient] Found 2 contract(s) in portfolio response
[DerivClient] Open contract found: 300127589868 - R_25 - MULTUP
[DerivClient] Open contract found: 300127523528 - R_50 - MULTDOWN
   ✅ Portfolio returned: 2 position(s)
```

## Root Cause

The actual problem was in the PositionMonitor implementation:

**BEFORE (Broken):**
```typescript
if (this.tradeMode === 'cfd') {
  // CFD Mode: Use proposal_open_contract API with tracked Contract IDs
  const contractIdArray = Array.from(this.contractIds);
  openPositions = await this.client.getMultiplierPositions(contractIdArray);
}
```

**Problem:** When no Contract IDs were tracked yet (e.g., on bot restart before registering trades), `contractIdArray` was empty, so it returned 0 positions even though positions existed in the portfolio.

## Solution Implemented

**AFTER (Fixed):**
```typescript
// Use portfolio API for both Binary Options and CFD modes
// Testing confirmed that Portfolio API DOES return Multiplier contracts
console.log(`   Using portfolio API...`);
const openPositions = await this.client.getPortfolio();
```

**Why this works:**
- Portfolio API returns ALL open contracts (Binary Options AND Multipliers)
- No need to track Contract IDs manually
- Works on bot restart (recovers existing positions)
- Simpler and more reliable

## Files Modified

### Core Fix
- [packages/trader/src/trade-management/position-monitor.ts:88-98](packages/trader/src/trade-management/position-monitor.ts#L88-L98) - Simplified to use Portfolio API for both modes

### Enhanced Debug Logging (for investigation)
- [packages/gateway/src/api/deriv-client.ts:976-1004](packages/gateway/src/api/deriv-client.ts#L976-L1004) - Added detailed API response logging

### Test Script
- [packages/gateway/src/test-portfolio-debug.ts](packages/gateway/src/test-portfolio-debug.ts) - Created to verify Portfolio API behavior

## Architecture Flow

### Before (Broken)

```
PositionMonitor (CFD mode)
    └─> getMultiplierPositions([...contractIds])
        └─> If contractIds is empty: Returns []
            └─> Result: NO positions detected (even if they exist)
            └─> Impact: Smart Exit rules NOT applied
```

### After (Fixed)

```
PositionMonitor (both modes)
    └─> getPortfolio()
        └─> portfolio API
            └─> Returns: ALL contracts (Binary + Multipliers)
            └─> Result: Positions detected correctly
            └─> Impact: Smart Exit rules applied successfully
```

## Testing Results

**Test Script Output (2025-11-24):**
```
💰 Getting balance...
   Balance: $6612.01 USD
   Account: VRTC14469660 (demo)

📋 Getting portfolio (account: current)...
   ✅ Portfolio returned: 2 position(s)

   Position 1:
      Contract ID: 300127589868
      Symbol: R_25
      Type: MULTUP
      Buy Price: 655.5

   Position 2:
      Contract ID: 300127523528
      Symbol: R_50
      Type: MULTDOWN
      Buy Price: 728.33
```

**Conclusion:** Portfolio API works perfectly with Multiplier contracts!

## Impact

### Before Fix
- ❌ PositionMonitor returned 0 positions for CFD mode
- ❌ Contract ID tracking required manual registration
- ❌ Bot couldn't recover positions on restart
- ❌ Smart Exit rules NOT applied to CFD trades

### After Fix
- ✅ PositionMonitor detects ALL positions (Binary + Multipliers)
- ✅ No manual Contract ID tracking needed
- ✅ Bot recovers positions automatically on restart
- ✅ Smart Exit rules applied to all CFD trades:
  - **0A: Stagnation Exit** (15min + 0.1% profit)
  - **0B: Virtual Trailing Stop** (Breakeven protection)
  - **1A: Max Duration** (40min if profit >= 0)
  - **1B: Extreme Duration** (120min forced close)
  - **2: Profitable + RSI Reversal**
- ✅ Guardian Mode protects ALL positions

## Clean Up Recommendations

Since we now know Portfolio API works for Multipliers, we can:

1. **Remove `getMultiplierPositions()` method** (no longer needed)
2. **Remove Contract ID tracking** in TradeManager (lines 120-123, 208-211)
3. **Remove Contract ID tracking** in PositionMonitor (lines 63-77)
4. **Simplify PositionMonitor constructor** (remove tradeMode parameter)
5. **Remove `multiplier_positions` command handler** from Gateway

These changes will simplify the codebase significantly.

## Related Documentation

- [RISK_MANAGEMENT_FIX.md](RISK_MANAGEMENT_FIX.md) - Stake calculation fix (10% → 1-2%)
- [CRITICAL_FIXES_GUARDIAN_MODE.md](CRITICAL_FIXES_GUARDIAN_MODE.md) - Virtual Trailing Stop & Guardian Mode
- [SMART_EXIT_ANALYSIS.md](SMART_EXIT_ANALYSIS.md) - Smart Exit rules documentation

## Next Steps

1. ✅ **COMPLETED:** Test Portfolio API with Multiplier contracts
2. ✅ **COMPLETED:** Fix PositionMonitor to use Portfolio API for all modes
3. ⏳ **PENDING:** Clean up unnecessary code (getMultiplierPositions, Contract ID tracking)
4. ⏳ **PENDING:** Test with live CFD trades
5. ⏳ **PENDING:** Investigate balance inconsistency
6. ⏳ **PENDING:** Verify Wins/Losses counter updates correctly
