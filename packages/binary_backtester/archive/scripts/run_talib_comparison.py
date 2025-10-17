#!/usr/bin/env python3
"""
TA-Lib vs Manual Implementation Comparison
Runs both strategies on same data and compares results
"""

import sys
import os
import json
import pandas as pd
from datetime import datetime
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.reversal_hunter_balanced import ReversalHunterBalancedStrategy as ManualStrategy
from strategies.reversal_hunter_talib import ReversalHunterBalancedStrategy as TALibStrategy
from config.settings import Config


def run_comparison():
    """Run both strategies and compare results"""

    print("🔬 TA-LIB VS MANUAL IMPLEMENTATION COMPARISON")
    print("="*70)

    # Find latest data file
    data_dir = Path(__file__).parent / "data"
    data_files = list(data_dir.glob("deriv_candles_*.json"))

    if not data_files:
        print("❌ No data files found")
        return

    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)

    # Load candles to get stats
    with open(latest_file, 'r') as f:
        candles = json.load(f)

    duration_days = (candles[-1]['epoch'] - candles[0]['epoch']) / 86400

    print(f"📊 Data: {latest_file.name}")
    print(f"📅 Period: {duration_days:.2f} days")
    print(f"📊 Candles: {len(candles):,}")
    print()

    # === RUN MANUAL STRATEGY ===
    print("="*70)
    print("🔧 RUNNING MANUAL IMPLEMENTATION")
    print("="*70)

    config_manual = Config(
        symbol='frxXAUUSD',
        timeframe=60,
        initial_cash=1000.0,
        expiration_time=1,
        payout=0.95,
        risk_per_trade=0.01,
        days_back=30
    )

    start_time = datetime.fromtimestamp(candles[0]['epoch'])
    end_time = datetime.fromtimestamp(candles[-1]['epoch'])
    config_manual.start_date = start_time
    config_manual.end_date = end_time

    tester_manual = EnhancedBinaryBacktester(config_manual)
    tester_manual.add_deriv_data(latest_file)

    print("\n🚀 Running manual strategy backtest...\n")
    results_manual = tester_manual.run(ManualStrategy, stake_amount=10.0, expiration_time=1)

    # === RUN TA-LIB STRATEGY ===
    print("\n" + "="*70)
    print("🔧 RUNNING TA-LIB IMPLEMENTATION")
    print("="*70)

    config_talib = Config(
        symbol='frxXAUUSD',
        timeframe=60,
        initial_cash=1000.0,
        expiration_time=1,
        payout=0.95,
        risk_per_trade=0.01,
        days_back=30
    )

    config_talib.start_date = start_time
    config_talib.end_date = end_time

    tester_talib = EnhancedBinaryBacktester(config_talib)
    tester_talib.add_deriv_data(latest_file)

    print("\n🚀 Running TA-Lib strategy backtest...\n")
    results_talib = tester_talib.run(TALibStrategy, stake_amount=10.0, expiration_time=1)

    # === COMPARISON ===
    print("\n\n" + "="*70)
    print("📊 COMPARISON RESULTS")
    print("="*70)

    # Extract metrics
    manual_trades = results_manual.get('total_trades', 0)
    manual_wr = results_manual.get('win_rate', 0)
    manual_roi = results_manual.get('roi', 0)
    manual_profit = results_manual.get('total_profit', 0)

    talib_trades = results_talib.get('total_trades', 0)
    talib_wr = results_talib.get('win_rate', 0)
    talib_roi = results_talib.get('roi', 0)
    talib_profit = results_talib.get('total_profit', 0)

    # Print comparison table
    print(f"\n{'Metric':<25} {'Manual':<20} {'TA-Lib':<20} {'Winner'}")
    print("-"*70)

    # Total Trades
    winner = "✅ TA-Lib" if abs(talib_trades - 933) < abs(manual_trades - 933) else "✅ Manual" if abs(manual_trades - 933) < abs(talib_trades - 933) else "➡️  Tie"
    print(f"{'Total Trades':<25} {manual_trades:<20} {talib_trades:<20} {winner}")

    # Trades per day
    manual_tpd = manual_trades / duration_days if duration_days > 0 else 0
    talib_tpd = talib_trades / duration_days if duration_days > 0 else 0
    winner = "✅ TA-Lib" if abs(talib_tpd - 7) < abs(manual_tpd - 7) else "✅ Manual" if abs(manual_tpd - 7) < abs(talib_tpd - 7) else "➡️  Tie"
    print(f"{'Trades/Day':<25} {manual_tpd:<20.2f} {talib_tpd:<20.2f} {winner}")

    # Win Rate
    winner = "✅ TA-Lib" if talib_wr > manual_wr else "✅ Manual" if manual_wr > talib_wr else "➡️  Tie"
    print(f"{'Win Rate (%)':<25} {manual_wr:<20.2f} {talib_wr:<20.2f} {winner}")

    # ROI
    winner = "✅ TA-Lib" if talib_roi > manual_roi else "✅ Manual" if manual_roi > talib_roi else "➡️  Tie"
    print(f"{'ROI (%)':<25} {manual_roi:<20.2f} {talib_roi:<20.2f} {winner}")

    # Profit
    winner = "✅ TA-Lib" if talib_profit > manual_profit else "✅ Manual" if manual_profit > talib_profit else "➡️  Tie"
    print(f"{'Total Profit ($)':<25} {manual_profit:<20.2f} {talib_profit:<20.2f} {winner}")

    # Pattern distribution
    if 'detailed_trades' in results_manual and 'detailed_trades' in results_talib:
        print("\n" + "="*70)
        print("📊 PATTERN DISTRIBUTION")
        print("="*70)

        manual_df = pd.DataFrame(results_manual['detailed_trades'])
        talib_df = pd.DataFrame(results_talib['detailed_trades'])

        print(f"\n{'Pattern':<25} {'Manual Count':<20} {'TA-Lib Count':<20}")
        print("-"*70)

        # Manual patterns
        manual_patterns = manual_df['pattern_key'].value_counts().to_dict()
        talib_patterns = talib_df['pattern_key'].value_counts().to_dict()

        all_patterns = set(list(manual_patterns.keys()) + list(talib_patterns.keys()))

        for pattern in sorted(all_patterns):
            manual_count = manual_patterns.get(pattern, 0)
            talib_count = talib_patterns.get(pattern, 0)
            print(f"{pattern:<25} {manual_count:<20} {talib_count:<20}")

    # === CONCLUSION ===
    print("\n\n" + "="*70)
    print("🎯 CONCLUSION")
    print("="*70)

    if abs(talib_wr - manual_wr) < 2:  # Less than 2% difference
        print("\n⚠️  Win rates are VERY SIMILAR (< 2% difference)")
        print("   This suggests:")
        print("   1. ✅ Our manual pattern detection is CORRECT")
        print("   2. ❌ The patterns themselves don't work well for R_75 1m")
        print("   3. 📊 Need to try different approach (not price action)")
        print()
        print("   RECOMMENDATION: Abandon price action patterns, try:")
        print("   - Order flow analysis")
        print("   - Machine learning signals")
        print("   - Market microstructure indicators")

    elif talib_wr > manual_wr + 5:  # TA-Lib is 5%+ better
        print("\n✅ TA-LIB IS SIGNIFICANTLY BETTER")
        print(f"   Win rate improvement: +{talib_wr - manual_wr:.2f}%")
        print("   This suggests:")
        print("   1. ❌ Our manual pattern detection has BUGS")
        print("   2. ✅ Should use TA-Lib in production")
        print("   3. 📊 Patterns work, but our implementation was wrong")
        print()
        print("   RECOMMENDATION: Replace manual detection with TA-Lib")

    elif manual_wr > talib_wr + 5:  # Manual is 5%+ better
        print("\n✅ MANUAL IMPLEMENTATION IS BETTER")
        print(f"   Win rate improvement: +{manual_wr - talib_wr:.2f}%")
        print("   This suggests:")
        print("   1. ✅ Our custom detection is SUPERIOR")
        print("   2. ✅ We've tuned it better for R_75 1m timeframe")
        print("   3. 📊 Keep manual implementation, optimize parameters")
        print()
        print("   RECOMMENDATION: Keep manual, optimize S/R thresholds")

    else:
        print("\n📊 Results are MIXED (2-5% difference)")
        print("   Both implementations are comparable")
        print("   Try optimizing both before deciding")

    print("\n" + "="*70)

    # Save comparison results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    comparison_file = f"talib_comparison_{timestamp}.json"

    comparison_results = {
        'manual': results_manual,
        'talib': results_talib,
        'comparison': {
            'manual_trades': manual_trades,
            'talib_trades': talib_trades,
            'manual_win_rate': manual_wr,
            'talib_win_rate': talib_wr,
            'win_rate_diff': talib_wr - manual_wr,
            'manual_roi': manual_roi,
            'talib_roi': talib_roi,
            'roi_diff': talib_roi - manual_roi
        }
    }

    with open(comparison_file, 'w') as f:
        json.dump(comparison_results, f, indent=2, default=str)

    print(f"\n💾 Comparison saved: {comparison_file}")


if __name__ == "__main__":
    run_comparison()
