#!/usr/bin/env python3
"""
Mean Reversion Strategy V4 Backtest Runner
Tests the V4 optimized strategy with SMA50 filter and Stochastic confirmation
"""
import backtrader as bt
import pandas as pd
import json
from datetime import datetime
from pathlib import Path
from strategies.mean_reversion_strategy_v4 import MeanReversionStrategyV4
from brokers import BinaryOptionsBroker


def run_backtest(data_file: str, initial_cash: float = 1000.0, verbose: bool = True):
    """
    Run backtest on V4 Mean Reversion strategy

    Args:
        data_file: Path to JSON or CSV data file (1-minute candles)
        initial_cash: Starting capital
        verbose: Print trade details

    Returns:
        dict: Backtest results with statistics
    """

    print("=" * 80)
    print("MEAN REVERSION STRATEGY V4.2 - BACKTEST (BALANCED OPTIMIZATION)")
    print("=" * 80)
    print(f"\n📂 Data file: {data_file}")
    print(f"💰 Initial cash: ${initial_cash}")
    print(f"\n🎯 V4.2 Parameters (BALANCED FOR WR + FREQUENCY):")
    print(f"   RSI: 21/79 (balanced) - V4.0=22/78, V4.1=20/80")
    print(f"   ATR: 0.87x (balanced) - V4.0=0.85x, V4.1=0.9x")
    print(f"   Cooldown: 1 minute")
    print(f"   Expiry: 3 minutes (longer for reversion)")
    print(f"   SMA50 trend filter: ±2%")
    print(f"   Min strength: 2 (RSI+BB required)")
    print(f"   Stochastic confirmation: ENABLED")
    print(f"   Max concurrent: 2")
    print("\n" + "=" * 80 + "\n")

    # Load data (support both JSON and CSV)
    if data_file.endswith('.json'):
        # Load JSON format (Deriv API format)
        df = pd.read_json(data_file)
        df['datetime'] = pd.to_datetime(df['epoch'], unit='s')
        df.set_index('datetime', inplace=True)
        # Add volume column if missing (not critical for this strategy)
        if 'volume' not in df.columns:
            df['volume'] = 0
    else:
        # Load CSV format
        df = pd.read_csv(data_file)
        df['datetime'] = pd.to_datetime(df['datetime'])
        df.set_index('datetime', inplace=True)

    print(f"📊 Data loaded: {len(df)} candles")
    print(f"   Period: {df.index[0]} to {df.index[-1]}")
    print(f"   Duration: {(df.index[-1] - df.index[0]).days} days\n")

    # Create Cerebro instance
    cerebro = bt.Cerebro()

    # Add official BinaryOptionsBroker
    cerebro.broker = BinaryOptionsBroker(
        payout_rate=0.95,
        expiry_minutes=3,  # Using expiry_minutes (time-based)
        use_expiry_bars=False
    )
    cerebro.broker.set_cash(initial_cash)

    # Add data feed
    data = bt.feeds.PandasData(
        dataname=df,
        datetime=None,
        open='open',
        high='high',
        low='low',
        close='close',
        volume='volume',
        openinterest=-1
    )
    cerebro.adddata(data)

    # Add strategy with V4.2 parameters (balanced)
    cerebro.addstrategy(
        MeanReversionStrategyV4,
        initial_cash=initial_cash,
        verbose=verbose,
        # V4.2 specific params - BALANCED
        rsi_oversold=21,  # V4.2: Balanced (V4.0=22, V4.1=20)
        rsi_overbought=79,  # V4.2: Balanced (V4.0=78, V4.1=80)
        atr_multiplier=0.87,  # V4.2: Balanced (V4.0=0.85, V4.1=0.9)
        sma_period=50,
        stoch_period=9,
        stoch_oversold=20,
        stoch_overbought=80,
        expiry_minutes=3,  # V4.2: Longer expiry for better WR
        cooldown_minutes=1,
        max_concurrent_trades=2,
        min_strength=2
    )

    # Run backtest
    print("\n🚀 Running backtest...\n")
    results = cerebro.run()
    strategy = results[0]

    # Get statistics from strategy
    stats = strategy.get_statistics()

    # Get trade analyzer results
    try:
        trade_analyzer = [a for a in results if hasattr(a, 'get_analysis')][0]
        analyzer_stats = trade_analyzer.get_analysis()
    except:
        analyzer_stats = {}

    # Calculate metrics
    final_cash = cerebro.broker.get_cash()
    total_return = final_cash - initial_cash

    # Extract trade stats from analyzer or strategy
    total_trades = stats.get('trades_executed', 0)
    wins = analyzer_stats.get('won', {}).get('total', 0)
    losses = analyzer_stats.get('lost', {}).get('total', 0)
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
    total_profit = total_return

    # Print summary
    print("\n" + "=" * 80)
    print("📊 BACKTEST RESULTS SUMMARY")
    print("=" * 80)
    roi = (total_return / initial_cash * 100)

    print(f"\n💰 Financial Performance:")
    print(f"   Initial Cash: ${initial_cash:,.2f}")
    print(f"   Final Cash: ${final_cash:,.2f}")
    print(f"   Total Return: ${total_return:,.2f}")
    print(f"   ROI: {roi:.2f}%")

    print(f"\n📈 Trade Statistics:")
    print(f"   Total Trades: {total_trades}")
    print(f"   Wins: {wins} ({win_rate:.2f}%)")
    print(f"   Losses: {losses}")
    print(f"   Avg Profit/Trade: ${total_profit/total_trades:.2f}" if total_trades > 0 else "   N/A")

    # V4 specific metrics
    print(f"\n🎯 V4 Quality Filters:")
    print(f"   Signals Filtered by SMA50: {stats.get('signals_filtered_by_sma', 0)}")
    print(f"   Signals Filtered by Min Strength: {stats.get('signals_filtered_by_strength', 0)}")

    # Trading frequency
    days = (df.index[-1] - df.index[0]).days
    if days > 0:
        trades_per_day = total_trades / days
        print(f"\n📅 Frequency:")
        print(f"   Trades per day: {trades_per_day:.2f}")

    print("\n" + "=" * 80)

    # Save results
    results_data = {
        'strategy': 'MeanReversionV4.2',
        'version': '4.2',
        'timestamp': datetime.now().isoformat(),
        'data_file': data_file,
        'backtest_period': {
            'start': df.index[0].isoformat(),
            'end': df.index[-1].isoformat(),
            'days': days
        },
        'parameters': {
            'initial_cash': initial_cash,
            'rsi_oversold': 21,  # V4.2
            'rsi_overbought': 79,  # V4.2
            'atr_multiplier': 0.87,  # V4.2
            'sma_period': 50,
            'stoch_period': 9,
            'expiry_minutes': 3,  # V4.2: Longer
            'cooldown_minutes': 1,
            'max_concurrent_trades': 2,
            'min_strength': 2,
            'sma_tolerance_pct': 2.0
        },
        'results': {
            'final_cash': final_cash,
            'total_return': total_return,
            'roi': (total_return / initial_cash * 100),
            'total_trades': total_trades,
            'wins': wins,
            'losses': losses,
            'win_rate': win_rate,
            'avg_profit_per_trade': total_profit / total_trades if total_trades > 0 else 0,
            'trades_per_day': trades_per_day if days > 0 else 0,
            'signals_filtered_by_sma': stats.get('signals_filtered_by_sma', 0),
            'signals_filtered_by_strength': stats.get('signals_filtered_by_strength', 0)
        }
    }

    # Save to JSON
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = f'mean_reversion_v4.2_results_{timestamp}.json'

    with open(output_file, 'w') as f:
        json.dump(results_data, f, indent=2)

    print(f"\n💾 Results saved to: {output_file}\n")

    return results_data


if __name__ == '__main__':
    # Run backtest with your data file
    data_file = 'data/deriv_candles_R_75_20251016_162542.json'

    if not Path(data_file).exists():
        print(f"\n❌ Error: Data file not found: {data_file}")
        print("\nPlease update the 'data_file' variable in this script.")
        print("Supported formats:")
        print("  - JSON: epoch,open,high,low,close")
        print("  - CSV: datetime,open,high,low,close,volume\n")
    else:
        results = run_backtest(
            data_file=data_file,
            initial_cash=1000.0,
            verbose=False  # Set to False to hide trade-by-trade logs
        )
