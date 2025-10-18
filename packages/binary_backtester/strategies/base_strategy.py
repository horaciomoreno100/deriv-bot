"""
Base strategy class for binary options (compatible with BinaryOptionsBroker)

This is a simplified base that relies on the broker to handle:
- Contract tracking
- Expiry management
- Cash settlement
- Trade notifications

Strategies should:
1. Generate signals in next()
2. Call buy() or sell() with stake
3. Override notify_order() and notify_trade() for logging
"""

import backtrader as bt
from typing import Optional


class BinaryBaseStrategy(bt.Strategy):
    """
    Base strategy class for binary options trading

    Compatible with BinaryOptionsBroker which handles all contract management.
    Subclasses only need to implement signal generation logic.
    """

    params = (
        ('stake_pct', 0.01),      # Base stake as % of cash (1%)
        ('expiry_bars', 3),        # Default expiry in bars
        ('debug', True),           # Enable debug logging
    )

    def __init__(self):
        """Initialize base strategy"""
        self.order = None
        self.trade_count = 0

    def log(self, txt, dt=None):
        """
        Helper for logging

        Args:
            txt: Message to log
            dt: Optional datetime (uses current bar datetime if None)
        """
        if self.params.debug:
            dt = dt or self.data.datetime.datetime(0)
            print(f'[{dt}] {txt}')

    def notify_order(self, order):
        """
        Called when order status changes

        Override in subclass to log execution details.

        Args:
            order: Backtrader Order object
        """
        if order.status == order.Completed:
            direction = 'CALL' if order.isbuy else 'PUT'
            self.log(f'{direction} EXECUTED @ {order.executed.price:.5f}, stake=${order.size:.2f}')

    def notify_trade(self, trade):
        """
        Called when trade closes (contract expires)

        Override in subclass to log P/L and update custom stats.

        Args:
            trade: Backtrader Trade object with pnl, value, etc.
        """
        if trade.isclosed:
            self.trade_count += 1
            won = trade.pnl > 0
            status = "WON" if won else "LOST"
            self.log(f'{status}: P/L=${trade.pnl:.2f} (Total trades: {self.trade_count})')

    def _calculate_stake(self) -> float:
        """
        Helper to calculate stake amount

        Default: stake_pct of current cash
        Override in subclass for custom sizing (e.g., martingale)

        Returns:
            Stake amount in cash
        """
        return self.broker.get_cash() * self.params.stake_pct

    def next(self):
        """
        Main strategy logic - override in subclasses

        Example:
            def next(self):
                signal = self._check_signal()  # Your signal logic
                if signal == 'CALL':
                    stake = self._calculate_stake()
                    self.buy(size=stake)
                elif signal == 'PUT':
                    stake = self._calculate_stake()
                    self.sell(size=stake)
        """
        raise NotImplementedError("Subclasses must implement next()")
