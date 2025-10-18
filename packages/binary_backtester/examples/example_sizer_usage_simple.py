#!/usr/bin/env python3
"""
Simple Example: Using Position Sizers with Binary Options

Demonstrates sizer behavior with a simple test strategy
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import backtrader as bt
from sizers import MartingaleSizer, AntiMartingaleSizer, FixedSizer


class SimpleTestStrategy(bt.Strategy):
    """
    Simple test strategy that trades every 10 bars
    Just to demonstrate sizer behavior
    """
    params = (
        ('trade_interval', 10),
    )

    def __init__(self):
        self.bar_count = 0
        self.trade_log = []

    def next(self):
        self.bar_count += 1

        # Trade every N bars
        if self.bar_count % self.params.trade_interval == 0:
            # Alternate between buy and sell
            if len(self.trade_log) % 2 == 0:
                self.buy()
            else:
                self.sell()

    def notify_order(self, order):
        if order.status == order.Completed:
            direction = 'CALL' if order.isbuy() else 'PUT'
            stake = order.size
            self.trade_log.append({
                'type': 'order',
                'direction': direction,
                'stake': stake,
                'price': order.executed.price
            })
            print(f"  Order {len(self.trade_log)}: {direction} @ ${stake:.2f}")

    def notify_trade(self, trade):
        if trade.isclosed:
            won = trade.pnl > 0
            status = "WON" if won else "LOST"
            self.trade_log.append({
                'type': 'trade',
                'won': won,
                'pnl': trade.pnl
            })
            print(f"    Trade Result: {status} (P/L: ${trade.pnl:+.2f})")


def demo_sizer(sizer_class, sizer_name, **sizer_params):
    """
    Demonstrate a sizer's behavior
    """
    print("\n" + "=" * 70)
    print(f"DEMO: {sizer_name}")
    print("=" * 70)
    print(f"Sizer params: {sizer_params}")
    print()

    # Create simple price data (random walk)
    import pandas as pd
    import numpy as np

    # Generate 100 bars of random data
    np.random.seed(42)
    dates = pd.date_range('2025-01-01', periods=100, freq='1min')
    close = 100 + np.cumsum(np.random.randn(100) * 0.1)
    high = close + np.abs(np.random.randn(100) * 0.2)
    low = close - np.abs(np.random.randn(100) * 0.2)
    open_price = close + np.random.randn(100) * 0.1

    df = pd.DataFrame({
        'open': open_price,
        'high': high,
        'low': low,
        'close': close,
        'volume': np.random.randint(100, 1000, 100)
    }, index=dates)

    # Create cerebro
    cerebro = bt.Cerebro()
    cerebro.broker.set_cash(1000.0)

    # Add data
    data = bt.feeds.PandasData(dataname=df)
    cerebro.adddata(data)

    # Add strategy
    cerebro.addstrategy(SimpleTestStrategy, trade_interval=10)

    # Add sizer
    cerebro.addsizer(sizer_class, **sizer_params)

    # Run
    print(f"Initial Cash: ${cerebro.broker.get_cash():.2f}\n")
    results = cerebro.run()
    strat = results[0]

    # Results
    final = cerebro.broker.get_value()
    pnl = final - 1000
    print(f"\nFinal Value: ${final:.2f}")
    print(f"Total P/L: ${pnl:+.2f}")
    print(f"Total Orders: {len([t for t in strat.trade_log if t['type'] == 'order'])}")
    print("=" * 70)


def main():
    """
    Demo all sizers
    """
    print("\n" + "=" * 70)
    print("BINARY OPTIONS SIZERS - BEHAVIOR DEMONSTRATION")
    print("=" * 70)

    # Fixed Sizer
    demo_sizer(FixedSizer, "FIXED SIZER", stake=10.0)

    # Martingale
    demo_sizer(MartingaleSizer, "MARTINGALE", stake=10.0, max_multiplier=3)

    # Anti-Martingale
    demo_sizer(AntiMartingaleSizer, "ANTI-MARTINGALE", stake=10.0, max_multiplier=3)

    print("\n✅ All sizer demos completed!\n")


if __name__ == '__main__':
    main()
