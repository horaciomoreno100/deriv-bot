#!/usr/bin/env python3
"""
Run TA-LIB Reversal Hunter Strategy with DETAILED ANALYSIS
"""

import sys
import os
import json
import pandas as pd
from datetime import datetime
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.reversal_hunter_talib import ReversalHunterBalancedStrategy
from config.settings import Config

def main():
    print("🎯 QUICK TEST - TA-LIB REVERSAL HUNTER")
    print("="*60)

    # Find latest data file
    data_dir = Path(__file__).parent / "data"
    data_files = list(data_dir.glob("deriv_candles_*.json"))

    if not data_files:
        print("❌ No data files found")
        return

    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)
    print(f"📊 Using: {latest_file.name}")

    # Load data to get date range
    with open(latest_file, 'r') as f:
        candles = json.load(f)

    start_time = datetime.fromtimestamp(candles[0]['epoch'])
    end_time = datetime.fromtimestamp(candles[-1]['epoch'])
    duration_days = (end_time - start_time).total_seconds() / 86400

    print(f"📅 Period: {duration_days:.2f} days")
    print(f"📊 Candles: {len(candles)}")

    # Configuration
    config = Config(
        symbol='frxXAUUSD',
        timeframe=60,
        initial_cash=1000.0,
        expiration_time=1,
        payout=0.95,
        risk_per_trade=0.01,
        days_back=30
    )

    config.start_date = start_time
    config.end_date = end_time

    print("\n🚀 Running backtest...")

    backtester = EnhancedBinaryBacktester(config)
    results = backtester.run(
        ReversalHunterBalancedStrategy,
        stake_amount=10.0,
        expiration_time=1
    )

    # Display results
    print("\n" + "="*60)
    print("📊 RESULTS")
    print("="*60)

    total_trades = results.get('total_trades', 0)
    win_rate = results.get('win_rate', 0)
    trades_per_day = total_trades / duration_days if duration_days > 0 else 0

    print(f"Total Trades:       {total_trades}")
    print(f"Won:                {results.get('won_trades', 0)}")
    print(f"Lost:               {results.get('lost_trades', 0)}")
    print(f"Win Rate:           {win_rate:.2f}%")
    print(f"Trades/Day:         {trades_per_day:.2f}")
    print(f"Total Profit:       ${results.get('total_profit', 0):.2f}")
    print(f"Final Balance:      ${results.get('final_cash', 0):.2f}")
    print(f"ROI:                {results.get('roi', 0):.2f}%")

    print("\n🎯 Anti-Martingale:")
    print(f"Win Streak:         {results.get('win_streak', 0)}")
    print(f"Loss Streak:        {results.get('loss_streak', 0)}")
    print(f"Stake Multiplier:   {results.get('stake_multiplier', 1.0):.2f}x")

    # Pattern performance
    pattern_perf = results.get('pattern_performance', {})
    if pattern_perf:
        print("\n🎨 Patterns:")
        for name, data in pattern_perf.items():
            print(f"  {name:15s}: {data['total']:3d} trades, {data['win_rate']:5.1f}% win rate")

    print("\n" + "="*60)

    # Assessment
    print("\n✅ ASSESSMENT:")
    if trades_per_day >= 5 and trades_per_day <= 10:
        print(f"  ✅ Frequency GOOD: {trades_per_day:.2f} trades/day")
    else:
        print(f"  ⚠️  Frequency: {trades_per_day:.2f} trades/day (target: 5-10)")

    if win_rate >= 55:
        print(f"  ✅ Win rate EXCELLENT: {win_rate:.2f}%")
    elif win_rate >= 50:
        print(f"  ⚠️  Win rate OK: {win_rate:.2f}% (target: 55%+)")
    else:
        print(f"  ❌ Win rate LOW: {win_rate:.2f}% (target: 55%+)")

    if results.get('win_streak', 0) > 0 or results.get('loss_streak', 0) > 0:
        print(f"  ✅ Anti-Martingale WORKING")
    else:
        print(f"  ⚠️  Anti-Martingale not triggered")

    print("="*60)

    # DETAILED ANALYSIS
    if 'detailed_trades' in results and results['detailed_trades']:
        print("\n" + "="*70)
        print("🔍 DETAILED PERFORMANCE ANALYSIS - Investigating Low Win Rate")
        print("="*70)

        trades_df = pd.DataFrame(results['detailed_trades'])

        # 1. Performance by Pattern
        print("\n📊 PERFORMANCE BY PATTERN:")
        print(f"{'Pattern':<20} {'Total':>8} {'Won':>6} {'Lost':>6} {'Win%':>8} {'Status'}")
        print("-"*70)

        for pattern in trades_df['pattern_key'].unique():
            group = trades_df[trades_df['pattern_key'] == pattern]
            total = len(group)
            won = group['won'].sum()
            lost = total - won
            win_pct = (won / total * 100) if total > 0 else 0

            status = "✅" if win_pct >= 52 else "❌"
            print(f"{pattern:<20} {total:>8} {won:>6} {lost:>6} {win_pct:>7.2f}% {status}")

        # 2. Performance by S/R Proximity
        print("\n📊 PERFORMANCE BY S/R PROXIMITY:")
        bins = [0, 32, 35, 38, 41, 45, 100]
        labels = ['30-32', '32-35', '35-38', '38-41', '41-45', '45+']
        trades_df['sr_bucket'] = pd.cut(trades_df['sr_proximity'], bins=bins, labels=labels, include_lowest=True)

        print(f"{'S/R Range':<12} {'Total':>8} {'Won':>6} {'Win%':>8} {'Status'}")
        print("-"*70)

        for bucket in labels:
            group = trades_df[trades_df['sr_bucket'] == bucket]
            if len(group) == 0:
                continue
            total = len(group)
            won = group['won'].sum()
            win_pct = (won / total * 100) if total > 0 else 0
            status = "✅" if win_pct >= 52 else "❌"
            print(f"{bucket:<12} {total:>8} {won:>6} {win_pct:>7.2f}% {status}")

        # 3. Best/Worst Hours
        print("\n📊 BEST/WORST PERFORMING HOURS:")
        hour_stats = []
        for hour in sorted(trades_df['hour'].unique()):
            group = trades_df[trades_df['hour'] == hour]
            if len(group) >= 10:  # Only show hours with significant data
                total = len(group)
                won = group['won'].sum()
                win_pct = (won / total * 100) if total > 0 else 0
                hour_stats.append((hour, total, won, win_pct))

        # Sort by win rate
        hour_stats.sort(key=lambda x: x[3], reverse=True)

        print(f"\nBest 5 Hours:")
        for hour, total, won, win_pct in hour_stats[:5]:
            print(f"  {hour:>2}h: {win_pct:>5.1f}% ({won}/{total} trades)")

        print(f"\nWorst 5 Hours:")
        for hour, total, won, win_pct in hour_stats[-5:]:
            print(f"  {hour:>2}h: {win_pct:>5.1f}% ({won}/{total} trades)")

        print("\n" + "="*70)

    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    results_file = f"talib_test_{timestamp}.json"
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n💾 Saved: {results_file}")

if __name__ == "__main__":
    main()
