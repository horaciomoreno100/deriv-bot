#!/usr/bin/env python3
"""
Quick test of the BALANCED Reversal Hunter Strategy
"""

import sys
import os
import json
from datetime import datetime
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.reversal_hunter_balanced import ReversalHunterBalancedStrategy
from config.settings import Config

def main():
    print("🎯 QUICK TEST - BALANCED REVERSAL HUNTER")
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

    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    results_file = f"balanced_test_{timestamp}.json"
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n💾 Saved: {results_file}")

if __name__ == "__main__":
    main()
