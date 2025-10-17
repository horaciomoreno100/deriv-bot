#!/usr/bin/env python3
"""
Test Mean Reversion Strategy on R_75 90-day dataset
"""
import json
from pathlib import Path
from datetime import datetime
from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.mean_reversion_strategy import MeanReversionStrategy


def main():
    """Run Mean Reversion backtest"""
    print("🎯 MEAN REVERSION STRATEGY - BACKTEST")
    print("=" * 70)

    # Find latest R_75 data file
    data_dir = Path('data')
    r75_files = sorted(data_dir.glob('deriv_candles_R_75_*.json'), key=lambda p: p.stat().st_mtime, reverse=True)

    if not r75_files:
        print("❌ No R_75 data files found in data/")
        print("   Run: python scripts/fetch_deriv_r75_data.py --days 90")
        return 1

    data_file = r75_files[0]
    print(f"📂 Using data: {data_file.name}")

    # Load data
    with open(data_file, 'r') as f:
        candles = json.load(f)

    if isinstance(candles, dict) and 'candles' in candles:
        candles = candles['candles']

    print(f"📊 Candles loaded: {len(candles):,}")
    print(f"📅 Period: {len(candles) / (24 * 60):.1f} days")
    print()

    # Strategy parameters
    print("📋 Strategy Parameters:")
    print("   Bollinger Bands: 20 period, 2 std dev")
    print("   RSI: 14 period, oversold <20, overbought >80")
    print("   ATR Filter: 14 period, multiplier 1.0x")
    print("   Expiry: 3 minutes")
    print("   Cooldown: 2 minutes")
    print("   Anti-Martingale: Win +20%, Loss -50%")
    print("   Base Stake: 1% of cash")
    print()

    # Initialize backtester
    print("🚀 Initializing backtest engine...")
    backtester = EnhancedBinaryBacktester(
        initial_cash=1000.0,
        symbol='R_75',
        timeframe='60s'
    )

    # Add data
    print("📊 Loading data into engine...")
    backtester.add_deriv_data(candles)

    # Add strategy
    print("📊 Adding Mean Reversion strategy...")
    backtester.cerebro.addstrategy(
        MeanReversionStrategy,
        initial_cash=1000.0,
        verbose=True
    )

    # Run backtest
    print("\n🚀 Starting backtest...")
    print("=" * 70)
    print()

    results = backtester.run()

    # Display results
    print("\n" + "=" * 70)
    print("📊 BACKTEST RESULTS")
    print("=" * 70)

    print(f"\n✅ Total Trades: {results['total_trades']}")
    print(f"✅ Won: {results['won_trades']} | Lost: {results['lost_trades']}")
    print(f"✅ Win Rate: {results['win_rate']:.2f}%")
    print(f"✅ Total Profit: ${results['total_profit']:.2f}")
    print(f"✅ ROI: {results['roi']:.2f}%")
    print(f"✅ Final Cash: ${results['final_cash']:.2f}")

    if results['total_trades'] > 0:
        avg_profit = results['total_profit'] / results['total_trades']
        print(f"✅ Avg Profit/Trade: ${avg_profit:.2f}")

        # Trades per day
        duration_days = len(candles) / (24 * 60)
        trades_per_day = results['total_trades'] / duration_days
        print(f"✅ Trades/Day: {trades_per_day:.2f}")

    # Assessment
    print("\n" + "=" * 70)
    print("🎯 ASSESSMENT")
    print("=" * 70)

    if results['win_rate'] >= 55 and results['roi'] > 5:
        print("\n✅ SUCCESS! Strategy meets targets")
        print("   Win Rate: ≥55% ✓")
        print("   ROI: >5% ✓")
        print("\n🚀 Next steps:")
        print("   1. Forward test on Deriv demo (2-3 days)")
        print("   2. If stable, deploy to live with micro stakes")

    elif results['win_rate'] >= 52 and results['roi'] > 0:
        print("\n⚠️  MARGINAL. Strategy shows promise but needs tuning")
        print(f"   Win Rate: {results['win_rate']:.2f}% (target: 55%+)")
        print(f"   ROI: {results['roi']:.2f}% (target: 5%+)")
        print("\n🔧 Tuning suggestions:")
        print("   - Adjust RSI thresholds (try 18/82 or 15/85)")
        print("   - Adjust BB std dev (try 1.8 or 2.5)")
        print("   - Adjust ATR multiplier (try 1.2x or 0.8x)")
        print("   - Increase expiry to 5 minutes")

    else:
        print("\n❌ FAILURE. Strategy does not meet targets")
        print(f"   Win Rate: {results['win_rate']:.2f}% (target: 55%+)")
        print(f"   ROI: {results['roi']:.2f}% (target: 5%+)")
        print("\n🔄 Pivot options:")
        print("   Option A: Try different parameters (tighter RSI, wider BB)")
        print("   Option B: Try different market (EUR/USD, Deriv Step Index)")
        print("   Option C: Abandon binary options entirely")

    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = f'mean_reversion_results_{timestamp}.json'

    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\n💾 Results saved to: {output_file}")
    print("\n" + "=" * 70)

    return 0


if __name__ == '__main__':
    exit(main())
