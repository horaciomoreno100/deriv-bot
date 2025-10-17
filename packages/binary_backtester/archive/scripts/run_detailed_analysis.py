#!/usr/bin/env python3
"""
Run backtest with detailed analysis
Exports trade data and analyzes performance by pattern, S/R, and time
"""

import sys
import os
import json
import pandas as pd
from datetime import datetime
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.reversal_hunter_balanced import ReversalHunterBalancedStrategy
from config.settings import Config


def analyze_results(results):
    """Detailed analysis of backtest results"""

    if 'detailed_trades' not in results or not results['detailed_trades']:
        print("❌ No detailed trade data available")
        return

    # Convert to DataFrame
    trades_df = pd.DataFrame(results['detailed_trades'])

    print("\n" + "="*70)
    print("🔍 DETAILED PERFORMANCE ANALYSIS")
    print("="*70)

    # 1. Overall Statistics
    total_trades = len(trades_df)
    won_trades = trades_df['won'].sum()
    lost_trades = total_trades - won_trades
    win_rate = (won_trades / total_trades * 100) if total_trades > 0 else 0

    print(f"\n📊 OVERALL STATISTICS:")
    print(f"   Total Trades: {total_trades}")
    print(f"   Won: {won_trades} | Lost: {lost_trades}")
    print(f"   Win Rate: {win_rate:.2f}%")
    print(f"   Total Profit: ${trades_df['profit'].sum():.2f}")

    # 2. Performance by Pattern
    print("\n" + "="*70)
    print("📊 PERFORMANCE BY PATTERN")
    print("="*70)

    pattern_stats = trades_df.groupby('pattern_key').agg({
        'won': ['count', 'sum'],
        'profit': 'sum'
    }).round(2)

    print(f"\n{'Pattern':<20} {'Total':>8} {'Won':>6} {'Lost':>6} {'Win%':>8} {'Profit':>10} {'Status'}")
    print("-"*70)

    for pattern in pattern_stats.index:
        group = trades_df[trades_df['pattern_key'] == pattern]
        total = len(group)
        won = group['won'].sum()
        lost = total - won
        win_pct = (won / total * 100) if total > 0 else 0
        profit = group['profit'].sum()

        if win_pct >= 55:
            status = "✅ Excellent"
        elif win_pct >= 52:
            status = "✅ Good"
        elif win_pct >= 50:
            status = "⚠️  Breakeven"
        else:
            status = "❌ Losing"

        print(f"{pattern:<20} {total:>8} {won:>6} {lost:>6} {win_pct:>7.2f}% ${profit:>9.2f} {status}")

    # 3. Performance by S/R Proximity
    print("\n" + "="*70)
    print("📊 PERFORMANCE BY S/R PROXIMITY")
    print("="*70)

    # Create buckets
    bins = [0, 32, 35, 38, 41, 45, 100]
    labels = ['30-32', '32-35', '35-38', '38-41', '41-45', '45+']

    trades_df['sr_bucket'] = pd.cut(trades_df['sr_proximity'], bins=bins, labels=labels, include_lowest=True)

    print(f"\n{'S/R Range':<12} {'Total':>8} {'Won':>6} {'Lost':>6} {'Win%':>8} {'Profit':>10} {'Status'}")
    print("-"*70)

    for bucket in labels:
        group = trades_df[trades_df['sr_bucket'] == bucket]
        if len(group) == 0:
            continue

        total = len(group)
        won = group['won'].sum()
        lost = total - won
        win_pct = (won / total * 100) if total > 0 else 0
        profit = group['profit'].sum()

        if win_pct >= 55:
            status = "✅ Excellent"
        elif win_pct >= 52:
            status = "✅ Good"
        elif win_pct >= 50:
            status = "⚠️  Breakeven"
        else:
            status = "❌ Losing"

        print(f"{bucket:<12} {total:>8} {won:>6} {lost:>6} {win_pct:>7.2f}% ${profit:>9.2f} {status}")

    # 4. Performance by Hour
    print("\n" + "="*70)
    print("📊 PERFORMANCE BY HOUR (GMT)")
    print("="*70)

    print(f"\n{'Hour':>4} {'Total':>8} {'Won':>6} {'Lost':>6} {'Win%':>8} {'Profit':>10} {'Quality'}")
    print("-"*70)

    hour_stats = trades_df.groupby('hour')

    for hour in sorted(trades_df['hour'].unique()):
        group = trades_df[trades_df['hour'] == hour]
        total = len(group)
        won = group['won'].sum()
        lost = total - won
        win_pct = (won / total * 100) if total > 0 else 0
        profit = group['profit'].sum()

        if total < 10:
            status = "📊 Low data"
        elif win_pct >= 55:
            status = "✅ Good"
        elif win_pct >= 50:
            status = "⚠️  OK"
        else:
            status = "❌ Poor"

        print(f"{hour:>4}h {total:>8} {won:>6} {lost:>6} {win_pct:>7.2f}% ${profit:>9.2f}  {status}")

    # 5. Performance by Strength
    print("\n" + "="*70)
    print("📊 PERFORMANCE BY STRENGTH")
    print("="*70)

    print(f"\n{'Strength':>8} {'Total':>8} {'Won':>6} {'Lost':>6} {'Win%':>8} {'Profit':>10} {'Status'}")
    print("-"*70)

    for strength in sorted(trades_df['strength'].unique()):
        group = trades_df[trades_df['strength'] == strength]
        total = len(group)
        won = group['won'].sum()
        lost = total - won
        win_pct = (won / total * 100) if total > 0 else 0
        profit = group['profit'].sum()

        if win_pct >= 55:
            status = "✅ Excellent"
        elif win_pct >= 52:
            status = "✅ Good"
        elif win_pct >= 50:
            status = "⚠️  Breakeven"
        else:
            status = "❌ Losing"

        print(f"{strength:>8} {total:>8} {won:>6} {lost:>6} {win_pct:>7.2f}% ${profit:>9.2f} {status}")

    # 6. RSI Bonus Analysis
    print("\n" + "="*70)
    print("📊 RSI BONUS IMPACT")
    print("="*70)

    print(f"\n{'RSI Bonus':<12} {'Total':>8} {'Won':>6} {'Win%':>8} {'Profit':>10}")
    print("-"*70)

    for has_bonus in [True, False]:
        group = trades_df[trades_df['rsi_bonus'] == has_bonus]
        if len(group) == 0:
            continue

        total = len(group)
        won = group['won'].sum()
        win_pct = (won / total * 100) if total > 0 else 0
        profit = group['profit'].sum()

        bonus_label = "With Bonus" if has_bonus else "No Bonus"
        print(f"{bonus_label:<12} {total:>8} {won:>6} {win_pct:>7.2f}% ${profit:>9.2f}")

    print("\n" + "="*70)


def main():
    print("🎯 RUN BACKTEST WITH DETAILED ANALYSIS")
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

    print(f"📊 Using: {latest_file.name}")
    print(f"📅 Period: {duration_days:.2f} days")
    print(f"📊 Candles: {len(candles):,}")
    print()

    # Create and run backtest
    tester = EnhancedBinaryBacktester(
        initial_cash=1000.0,
        payout_rate=0.95,
        expiration_time=1
    )

    # Add data
    tester.add_deriv_data(latest_file)

    # Add strategy
    tester.add_strategy(ReversalHunterBalancedStrategy)

    print("🚀 Running backtest with detailed logging...\n")

    # Run backtest
    results = tester.run()

    # Save results with detailed trades
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"detailed_results_{timestamp}.json"

    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\n💾 Results saved: {results_file}")

    # Run detailed analysis
    analyze_results(results)

    print("\n" + "="*70)
    print("✅ ANALYSIS COMPLETE")
    print("="*70)


if __name__ == "__main__":
    main()
