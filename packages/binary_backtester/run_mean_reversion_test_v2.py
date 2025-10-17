#!/usr/bin/env python3
"""
Test Mean Reversion Strategy on R_75 90-day dataset
"""
import sys
import os
import json
from datetime import datetime
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.mean_reversion_strategy import MeanReversionStrategy
from config.settings import Config

def main():
    print("🎯 MEAN REVERSION STRATEGY - BACKTEST")
    print("="*70)

    # Find latest R_75 data file
    data_dir = Path(__file__).parent / "data"
    r75_files = sorted(data_dir.glob('deriv_candles_R_75_*.json'), key=lambda p: p.stat().st_mtime, reverse=True)

    if not r75_files:
        print("❌ No R_75 data files found in data/")
        return 1

    latest_file = r75_files[0]
    print(f"📂 Using: {latest_file.name}")

    # Load data to get date range
    with open(latest_file, 'r') as f:
        candles = json.load(f)

    start_time = datetime.fromtimestamp(candles[0]['epoch'])
    end_time = datetime.fromtimestamp(candles[-1]['epoch'])
    duration_days = (end_time - start_time).total_seconds() / 86400

    print(f"📅 Period: {duration_days:.2f} days")
    print(f"📊 Candles: {len(candles):,}")

    # Strategy parameters
    print("\n📋 Strategy Parameters (TEST #5: RSI 17/83):")
    print("   Bollinger Bands: 20 period, 2 std dev")
    print("   ⭐ RSI: 14 period, oversold <17, overbought >83 (was 18/82)")
    print("   ATR Filter: 14 period, multiplier 1.0x")
    print("   Expiry: 3 minutes")
    print("   Cooldown: 2 minutes")
    print("   Anti-Martingale: Progressive Cycles (2 wins / 3 losses reset)")
    print("   Base Stake: 1% of cash")
    print("\n   🎯 Target: 59-61% win rate, 28-32% ROI, 200-230 trades")
    print("   📊 Baseline V2: 58.02% WR, 30.99% ROI, 262 trades")
    print("   📊 Test #4: 58.82% WR, 27.67% ROI, 238 trades")

    # Configuration
    config = Config(
        symbol='R_75',
        timeframe=60,
        initial_cash=1000.0,
        expiration_time=3,  # BASELINE: 3 minutes
        payout=0.95,
        risk_per_trade=0.01,
        days_back=90
    )

    config.start_date = start_time
    config.end_date = end_time

    print("\n🚀 Running backtest...")

    backtester = EnhancedBinaryBacktester(config)
    results = backtester.run(
        MeanReversionStrategy,
        initial_cash=1000.0,
        verbose=True
    )

    # Display results
    print("\n" + "="*70)
    print("📊 RESULTS")
    print("="*70)

    total_trades = results.get('total_trades', 0)
    win_rate = results.get('win_rate', 0)
    trades_per_day = total_trades / duration_days if duration_days > 0 else 0

    print(f"\n✅ Total Trades:    {total_trades}")
    print(f"✅ Won:             {results.get('won_trades', 0)}")
    print(f"✅ Lost:            {results.get('lost_trades', 0)}")
    print(f"✅ Win Rate:        {win_rate:.2f}%")
    print(f"✅ Trades/Day:      {trades_per_day:.2f}")
    print(f"✅ Total Profit:    ${results.get('total_profit', 0):.2f}")
    print(f"✅ ROI:             {results.get('roi', 0):.2f}%")
    print(f"✅ Final Cash:      ${results.get('final_cash', 0):.2f}")

    if total_trades > 0:
        avg_profit = results.get('total_profit', 0) / total_trades
        print(f"✅ Avg Profit/Trade: ${avg_profit:.2f}")

    # Assessment
    print("\n" + "="*70)
    print("🎯 ASSESSMENT")
    print("="*70)

    if win_rate >= 55 and results.get('roi', 0) > 5:
        print("\n✅ SUCCESS! Strategy meets targets")
        print("   Win Rate: ≥55% ✓")
        print("   ROI: >5% ✓")
        print("\n🚀 Next steps:")
        print("   1. Forward test on Deriv demo (2-3 days)")
        print("   2. If stable, deploy to live with micro stakes")

    elif win_rate >= 52 and results.get('roi', 0) > 0:
        print("\n⚠️  MARGINAL. Strategy shows promise but needs tuning")
        print(f"   Win Rate: {win_rate:.2f}% (target: 55%+)")
        print(f"   ROI: {results.get('roi', 0):.2f}% (target: 5%+)")
        print("\n🔧 Tuning suggestions:")
        print("   - Adjust RSI thresholds (try 18/82 or 15/85)")
        print("   - Adjust BB std dev (try 1.8 or 2.5)")
        print("   - Adjust ATR multiplier (try 1.2x or 0.8x)")
        print("   - Increase expiry to 5 minutes")

    else:
        print("\n❌ FAILURE. Strategy does not meet targets")
        print(f"   Win Rate: {win_rate:.2f}% (target: 55%+)")
        print(f"   ROI: {results.get('roi', 0):.2f}% (target: 5%+)")
        print("\n🔄 Pivot options:")
        print("   Option A: Try different parameters (tighter RSI, wider BB)")
        print("   Option B: Try different market (EUR/USD, Deriv Step Index)")
        print("   Option C: Abandon binary options entirely")

    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = Path(__file__).parent / f'mean_reversion_results_{timestamp}.json'

    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\n💾 Results saved to: {output_file.name}")
    print("="*70)

    return 0


if __name__ == '__main__':
    exit(main())
