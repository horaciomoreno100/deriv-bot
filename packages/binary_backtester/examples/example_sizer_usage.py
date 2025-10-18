#!/usr/bin/env python3
"""
Example: Using Position Sizers with Binary Options Strategies

This script demonstrates how to use different sizers:
- FixedSizer: Constant stake
- MartingaleSizer: Double on loss
- AntiMartingaleSizer: Double on win

Compares performance across the same strategy with different sizing.
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import backtrader as bt
import pandas as pd
import json
from datetime import datetime
from brokers import BinaryOptionsBroker
from sizers import MartingaleSizer, AntiMartingaleSizer, FixedSizer

# Direct import to avoid __init__.py issues
import sys
from pathlib import Path
strategies_path = Path(__file__).parent.parent / 'strategies'
sys.path.insert(0, str(strategies_path))
from mean_reversion_strategy_v4 import MeanReversionStrategyV4


def load_deriv_data():
    """
    Load latest Deriv data file

    Returns:
        bt.feeds.PandasData: Backtrader data feed
    """
    data_dir = Path(__file__).parent.parent / "data"
    data_files = list(data_dir.glob("deriv_candles_R_*.json"))

    if not data_files:
        raise FileNotFoundError("No Deriv data files found in data/ directory")

    # Use latest file
    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)
    print(f"📂 Loading data: {latest_file.name}")

    with open(latest_file, 'r') as f:
        data = json.load(f)

    # Handle both list and dict formats
    candles = data if isinstance(data, list) else data.get('candles', [])

    # Convert to DataFrame
    df_data = []
    for candle in candles:
        df_data.append({
            'datetime': datetime.fromtimestamp(candle['epoch']),
            'open': float(candle['open']),
            'high': float(candle['high']),
            'low': float(candle['low']),
            'close': float(candle['close']),
            'volume': 0
        })

    df = pd.DataFrame(df_data)
    df = df.set_index('datetime')
    df = df.sort_index()

    print(f"   Candles: {len(df)}")
    print(f"   Period: {df.index[0]} to {df.index[-1]}")
    print(f"   Duration: {(df.index[-1] - df.index[0]).days} days\n")

    return bt.feeds.PandasData(dataname=df)


def test_with_sizer(sizer_class, sizer_name, **sizer_params):
    """
    Run backtest with specific sizer

    Args:
        sizer_class: Sizer class (FixedSizer, MartingaleSizer, etc.)
        sizer_name: Display name for output
        **sizer_params: Parameters to pass to sizer

    Returns:
        dict: Backtest results
    """
    print("\n" + "=" * 80)
    print(f"TESTING WITH: {sizer_name}")
    print("=" * 80)

    # Print sizer params
    print("\n🎲 Sizer Configuration:")
    for key, value in sizer_params.items():
        print(f"   {key}: {value}")

    # Create Cerebro
    cerebro = bt.Cerebro()

    # Binary Options Broker
    cerebro.broker = BinaryOptionsBroker(
        payout_rate=0.95,      # 95% payout (5% house edge)
        use_expiry_bars=True,
        expiry_bars=3          # 3-minute expiry
    )
    cerebro.broker.set_cash(1000.0)

    # Load data
    data = load_deriv_data()
    cerebro.adddata(data)

    # Add strategy (Mean Reversion V4)
    cerebro.addstrategy(
        MeanReversionStrategyV4,
        initial_cash=1000.0,
        verbose=False,  # Suppress trade logs
        # V4 params
        rsi_oversold=21,
        rsi_overbought=79,
        atr_multiplier=0.87,
        expiry_minutes=3,
        cooldown_minutes=1,
        max_concurrent_trades=2,
        min_strength=2
    )

    # Add sizer
    cerebro.addsizer(sizer_class, **sizer_params)

    # Add analyzers
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
    cerebro.addanalyzer(bt.analyzers.Returns, _name='returns')
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')

    # Run
    print(f"\n💰 Initial Cash: ${cerebro.broker.get_cash():.2f}")
    print("🚀 Running backtest...\n")

    results = cerebro.run()
    strat = results[0]

    # Extract results
    trades_analysis = strat.analyzers.trades.get_analysis()
    returns_analysis = strat.analyzers.returns.get_analysis()
    drawdown_analysis = strat.analyzers.drawdown.get_analysis()

    # Calculate metrics
    final_value = cerebro.broker.get_value()
    total_pnl = final_value - 1000.0
    roi = (total_pnl / 1000.0) * 100

    total_trades = trades_analysis.total.closed if hasattr(trades_analysis.total, 'closed') else 0
    wins = trades_analysis.won.total if hasattr(trades_analysis, 'won') else 0
    losses = trades_analysis.lost.total if hasattr(trades_analysis, 'lost') else 0
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    max_dd = drawdown_analysis.get('max', {}).get('drawdown', 0)

    # Print results
    print("=" * 80)
    print("RESULTS")
    print("=" * 80)
    print(f"\n💵 Financial Performance:")
    print(f"   Initial Cash:  ${1000.00:,.2f}")
    print(f"   Final Value:   ${final_value:,.2f}")
    print(f"   Total P/L:     ${total_pnl:+,.2f}")
    print(f"   ROI:           {roi:+.2f}%")
    print(f"   Max Drawdown:  {max_dd:.2f}%")

    print(f"\n📊 Trading Statistics:")
    print(f"   Total Trades:  {total_trades}")
    print(f"   Wins:          {wins}")
    print(f"   Losses:        {losses}")
    print(f"   Win Rate:      {win_rate:.2f}%")

    if total_trades > 0:
        avg_pnl = total_pnl / total_trades
        print(f"   Avg P/L/Trade: ${avg_pnl:+.2f}")

    print("=" * 80 + "\n")

    return {
        'sizer': sizer_name,
        'params': sizer_params,
        'final_value': final_value,
        'total_pnl': total_pnl,
        'roi': roi,
        'total_trades': total_trades,
        'wins': wins,
        'losses': losses,
        'win_rate': win_rate,
        'max_drawdown': max_dd
    }


def main():
    """
    Run comparison of all sizers
    """
    print("\n" + "=" * 80)
    print("BINARY OPTIONS SIZERS - PERFORMANCE COMPARISON")
    print("=" * 80)
    print("\nStrategy: Mean Reversion V4")
    print("Market: Deriv Synthetic Indices (R_75 or latest)")
    print("Initial Capital: $1,000")
    print("Payout Rate: 95%")
    print("\n" + "=" * 80)

    results = []

    # Test 1: Fixed Sizer (baseline)
    print("\n\n🔷 TEST 1/3: FIXED SIZER (Baseline)")
    print("Always stake $10 - most conservative approach")
    result_fixed = test_with_sizer(
        FixedSizer,
        "FIXED SIZER",
        stake=10.0
    )
    results.append(result_fixed)

    # Test 2: Martingale (risky)
    print("\n\n🔶 TEST 2/3: MARTINGALE SIZER (Risky)")
    print("Double stake after each LOSS - chasing losses")
    result_martingale = test_with_sizer(
        MartingaleSizer,
        "MARTINGALE",
        stake=10.0,
        max_multiplier=5  # Max 32x stake
    )
    results.append(result_martingale)

    # Test 3: Anti-Martingale (safer progressive)
    print("\n\n🔵 TEST 3/3: ANTI-MARTINGALE SIZER (Safer Progressive)")
    print("Double stake after each WIN - risking profits")
    result_anti = test_with_sizer(
        AntiMartingaleSizer,
        "ANTI-MARTINGALE",
        stake=10.0,
        max_multiplier=3  # Max 8x stake
    )
    results.append(result_anti)

    # Comparison Summary
    print("\n\n" + "=" * 80)
    print("📊 COMPARISON SUMMARY")
    print("=" * 80)
    print(f"\n{'Sizer':<20} {'ROI':>10} {'Trades':>10} {'Win Rate':>10} {'Max DD':>10}")
    print("-" * 80)

    for r in results:
        print(f"{r['sizer']:<20} {r['roi']:>+9.2f}% {r['total_trades']:>10} "
              f"{r['win_rate']:>9.2f}% {r['max_drawdown']:>9.2f}%")

    print("\n" + "=" * 80)
    print("💡 INSIGHTS")
    print("=" * 80)

    # Find best ROI
    best_roi = max(results, key=lambda x: x['roi'])
    print(f"\n✅ Best ROI: {best_roi['sizer']} ({best_roi['roi']:+.2f}%)")

    # Find safest (lowest drawdown)
    safest = min(results, key=lambda x: x['max_drawdown'])
    print(f"🛡️  Safest (Lowest DD): {safest['sizer']} ({safest['max_drawdown']:.2f}% DD)")

    # Recommendations
    print("\n📌 Recommendations:")
    print("   - Fixed: Best for consistent, predictable risk management")
    print("   - Martingale: High risk/reward - can recover quickly OR blow up account")
    print("   - Anti-Martingale: Balanced - lets winners run while protecting capital")

    print("\n" + "=" * 80)
    print("✅ SIZER COMPARISON COMPLETE")
    print("=" * 80 + "\n")


if __name__ == '__main__':
    try:
        main()
    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}")
        print("\nPlease run a data download script first:")
        print("  python scripts/download_30days_deriv.py")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
