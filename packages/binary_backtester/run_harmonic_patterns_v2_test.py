"""
Run Harmonic Patterns V2 Strategy Backtest
V2 uses TradingView's simplified ZigZag method for more frequent signals
"""
import backtrader as bt
import json
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from strategies.harmonic_patterns_strategy_v2 import HarmonicPatternsStrategyV2
from brokers import BinaryOptionsBroker


def load_deriv_data():
    """Load Deriv data"""
    print("📊 Loading Deriv data...")

    data_dir = Path(__file__).parent / "data"
    data_files = list(data_dir.glob("deriv_candles_*.json"))

    if not data_files:
        print("❌ No Deriv data files found")
        return None

    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)
    print(f"📁 Using: {latest_file.name}")

    try:
        with open(latest_file, 'r') as f:
            data = json.load(f)

        candles = data if isinstance(data, list) else data.get('candles', data.get('data', []))
        print(f"✅ Loaded {len(candles)} candles")

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

        print(f"📊 Range: {df.index.min()} to {df.index.max()}")
        return bt.feeds.PandasData(dataname=df)

    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def run_backtest():
    """Run Harmonic Patterns V2 backtest"""

    print("=" * 70)
    print("🎯 HARMONIC PATTERNS V2 - TRADINGVIEW ZIGZAG METHOD")
    print("=" * 70)

    cerebro = bt.Cerebro()
    data = load_deriv_data()

    if data is None:
        return

    cerebro.adddata(data)

    # Add official BinaryOptionsBroker
    cerebro.broker = BinaryOptionsBroker(
        payout_rate=0.95,
        expiry_minutes=3,
        use_expiry_bars=False
    )
    cerebro.broker.set_cash(1000.0)

    # V2 Strategy with TradingView ZigZag
    cerebro.addstrategy(
        HarmonicPatternsStrategyV2,
        # Fibonacci Levels
        entry_fib_rate=0.236,  # TradingView default
        tp_fib_rate=0.618,
        sl_fib_rate=-0.236,

        # Patterns (enable all like TradingView)
        enable_bat=True,
        enable_butterfly=True,
        enable_gartley=True,
        enable_crab=True,
        enable_shark=True,
        enable_abcd=True,
        enable_anti_patterns=True,  # Enable anti-patterns
        enable_exotic=False,

        # Risk Management
        initial_cash=1000.0,
        base_stake_pct=0.01,
        max_stake_pct=0.05,
        min_stake_pct=0.001,

        # Trade Management (like TradingView)
        expiry_minutes=3,
        cooldown_minutes=0,  # No cooldown
        max_concurrent_trades=10,  # Allow multiple concurrent

        verbose=True
    )

    print("\n🚀 Running V2 backtest (TradingView ZigZag)...")
    print(f"   Initial Cash: $1000.00")
    print(f"   ZigZag: Simplified (candle direction changes)")
    print(f"   Patterns: All enabled (including anti-patterns)")

    strategies = cerebro.run()
    strategy = strategies[0]
    stats = strategy.get_statistics()

    # Save results
    results = {
        'strategy': 'Harmonic Patterns V2 (TradingView ZigZag)',
        'backtest_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'initial_cash': 1000.0,
        'final_cash': cerebro.broker.get_cash(),
        'total_profit': stats['total_profit'],
        'roi': stats['roi'],
        'total_trades': stats['total_trades'],
        'wins': stats['wins'],
        'losses': stats['losses'],
        'win_rate': stats['win_rate'],
        'avg_profit_per_trade': stats['total_profit'] / stats['total_trades'] if stats['total_trades'] > 0 else 0,
        'parameters': {
            'zigzag_method': 'TradingView_Simplified',
            'entry_fib_rate': 0.236,
            'tp_fib_rate': 0.618,
            'sl_fib_rate': -0.236,
            'enable_anti_patterns': True,
            'expiry_minutes': 3,
            'cooldown_minutes': 0,
            'max_concurrent_trades': 10
        },
        'trades': []
    }

    for trade in stats['completed_trades']:
        results['trades'].append({
            'entry_time': trade['entry_time'].strftime('%Y-%m-%d %H:%M:%S'),
            'direction': trade['direction'],
            'pattern_name': trade['pattern_name'],
            'entry_price': float(trade['entry_price']),
            'exit_price': float(trade['exit_price']),
            'stake': float(trade['stake']),
            'profit': float(trade['profit']),
            'result': trade['result'],
            'ratios': {k: float(v) for k, v in trade['signal_details']['ratios'].items()}
        })

    filename = f"harmonic_v2_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(filename, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n💾 Results saved: {filename}")

    # Summary
    print("\n" + "=" * 70)
    print("📊 V2 BACKTEST SUMMARY (TradingView Method)")
    print("=" * 70)
    print(f"Total Trades: {results['total_trades']}")
    print(f"Wins: {results['wins']} | Losses: {results['losses']}")
    print(f"Win Rate: {results['win_rate']:.2f}%")
    print(f"Total Profit: ${results['total_profit']:.2f}")
    print(f"ROI: {results['roi']:.2f}%")
    print(f"Final Cash: ${results['final_cash']:.2f}")
    if results['total_trades'] > 0:
        print(f"Avg Profit/Trade: ${results['avg_profit_per_trade']:.2f}")
        trades_per_day = results['total_trades'] / 90  # Assuming 90 days
        print(f"Trades/Day: {trades_per_day:.2f}")
    print("=" * 70)

    # Pattern distribution
    if results['trades']:
        print("\n📈 PATTERN DISTRIBUTION")
        print("=" * 70)
        pattern_counts = {}
        for trade in results['trades']:
            pattern = trade['pattern_name']
            pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1

        for pattern, count in sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True):
            pct = (count / results['total_trades']) * 100
            print(f"   {pattern}: {count} ({pct:.1f}%)")
        print("=" * 70)


if __name__ == '__main__':
    run_backtest()
