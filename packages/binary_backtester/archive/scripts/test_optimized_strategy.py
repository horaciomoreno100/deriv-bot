#!/usr/bin/env python3
"""
Quick test script for OPTIMIZED Reversal Hunter strategy
Tests with 30 days of real R_75 data
"""

import json
import os
from datetime import datetime
from core.deriv_data_loader import DerivDataLoader
from core.enhanced_backtrader_engine import EnhancedBacktestEngine
from strategies.reversal_hunter_optimized import ReversalHunterBalancedStrategy

def run_optimized_test():
    """Run optimized strategy test"""

    # Find most recent deriv data file
    data_dir = 'data'
    deriv_files = [f for f in os.listdir(data_dir)
                   if f.startswith('deriv_candles_R_75') and f.endswith('.json')]

    if not deriv_files:
        print("❌ No R_75 data files found")
        return

    # Get most recent file
    latest_file = max(deriv_files, key=lambda f: os.path.getmtime(os.path.join(data_dir, f)))

    # Load candles to get stats
    with open(os.path.join(data_dir, latest_file), 'r') as f:
        candles = json.load(f)

    duration_days = (candles[-1]['epoch'] - candles[0]['epoch']) / 86400

    print("🎯 OPTIMIZED REVERSAL HUNTER TEST")
    print("=" * 60)
    print(f"📊 Using: {latest_file}")
    print(f"📅 Period: {duration_days:.2f} days")
    print(f"📊 Candles: {len(candles)}")
    print()
    print("🔧 OPTIMIZATIONS APPLIED:")
    print("   - Cooldown: 300s → 900s (15 min)")
    print("   - Min Strength: 2 → 3 (Pin Bar + Engulfing only)")
    print("   - Min S/R Proximity: 30 → 50 (stricter)")
    print("   - RSI: Optional → MANDATORY")
    print()

    # Load data
    data_loader = DerivDataLoader(symbol='R_75')
    df = data_loader.load_data()

    if df is None or len(df) == 0:
        print("❌ Failed to load data")
        return

    # Create engine
    engine = EnhancedBacktestEngine(
        initial_cash=1000.0,
        payout_rate=0.95,
        expiration_time=1  # 1 minute binary options
    )

    # Add data
    engine.add_data(df, name='R_75')

    # Add strategy
    engine.add_strategy(ReversalHunterBalancedStrategy)

    # Run backtest
    print("🚀 Running OPTIMIZED backtest...\n")
    results = engine.run()

    if results:
        # Save results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"optimized_test_{timestamp}.json"

        with open(filename, 'w') as f:
            json.dump(results, f, indent=2)

        # Calculate trades per day
        trades_per_day = results['total_trades'] / duration_days if duration_days > 0 else 0

        print("\n" + "=" * 60)
        print("📊 OPTIMIZED RESULTS")
        print("=" * 60)
        print(f"Total Trades:       {results['total_trades']}")
        print(f"Won:                {results['won_trades']}")
        print(f"Lost:               {results['lost_trades']}")
        print(f"Win Rate:           {results['win_rate']:.2f}%")
        print(f"Trades/Day:         {trades_per_day:.2f}")
        print(f"Total Profit:       ${results['total_profit']:.2f}")
        print(f"Final Balance:      ${results['final_cash']:.2f}")
        print(f"ROI:                {results['roi']:.2f}%")
        print()
        print("=" * 60)
        print()

        # Assessment
        print("✅ ASSESSMENT:")

        # Frequency check
        if 5 <= trades_per_day <= 10:
            print(f"  ✅ Frequency: {trades_per_day:.2f} trades/day (target: 5-10)")
        elif trades_per_day < 5:
            print(f"  ⚠️  Frequency: {trades_per_day:.2f} trades/day (target: 5-10) - TOO LOW")
        else:
            print(f"  ⚠️  Frequency: {trades_per_day:.2f} trades/day (target: 5-10) - TOO HIGH")

        # Win rate check
        if results['win_rate'] >= 55:
            print(f"  ✅ Win rate excellent: {results['win_rate']:.2f}% (target: 55%+)")
        elif results['win_rate'] >= 52:
            print(f"  ✅ Win rate good: {results['win_rate']:.2f}% (target: 55%+)")
        else:
            print(f"  ⚠️  Win rate: {results['win_rate']:.2f}% (target: 55%+)")

        # ROI check
        if results['roi'] > 5:
            print(f"  ✅ ROI positive: {results['roi']:.2f}%")
        elif results['roi'] > 0:
            print(f"  ⚠️  ROI slightly positive: {results['roi']:.2f}%")
        else:
            print(f"  ❌ ROI negative: {results['roi']:.2f}%")

        print("=" * 60)
        print()

        # Compare with baseline
        print("📊 COMPARISON WITH BASELINE:")
        print("=" * 60)
        print("Metric              | Baseline  | Optimized | Change")
        print("-" * 60)
        print(f"Trades/Day          |   31.10   | {trades_per_day:8.2f}  | {((trades_per_day/31.10 - 1) * 100):+6.1f}%")
        print(f"Win Rate            |  50.16%   | {results['win_rate']:7.2f}%  | {(results['win_rate'] - 50.16):+6.2f}%")
        print(f"ROI                 | -67.03%   | {results['roi']:7.2f}%  | {(results['roi'] - (-67.03)):+6.2f}%")
        print("=" * 60)

        print(f"\n💾 Saved: {filename}")

if __name__ == "__main__":
    run_optimized_test()
