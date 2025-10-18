"""
Base Sizer for Binary Options

Provides foundation for all position sizing strategies with:
- Base stake management
- Percentage-based sizing
- Min/Max limits
- Trade result tracking
"""
import backtrader as bt


class BaseBinarySizer(bt.Sizer):
    """
    Base class for binary options position sizing

    All sizers inherit from this to get common functionality like:
    - Stake calculation with percentage or fixed amount
    - Min/Max stake limits
    - Trade result tracking (wins/losses streak)

    Params:
        stake (float): Base stake amount (default: 10.0)
        stake_pct (float): Alternative - percentage of cash (e.g., 0.02 = 2%)
        min_stake (float): Minimum stake allowed (default: 1.0)
        max_stake (float): Maximum stake allowed (default: None = unlimited)

    Subclasses should override:
        _calculate_next_stake(): Custom logic for stake progression
    """

    params = (
        ('stake', 10.0),           # Base stake amount
        ('stake_pct', None),        # Or % of cash (overrides stake if set)
        ('min_stake', 1.0),         # Minimum stake
        ('max_stake', None),        # Maximum stake (None = no limit)
    )

    def __init__(self):
        super().__init__()
        # Current stake state
        self.current_stake = self.params.stake

        # Trade tracking
        self.last_trade_pnl = 0.0
        self.consecutive_wins = 0
        self.consecutive_losses = 0

    def _getsizing(self, comminfo, cash, data, isbuy):
        """
        Calculate stake size for next trade

        Called by Backtrader before each trade to determine position size.

        Args:
            comminfo: Commission info (unused for binary options)
            cash: Available cash in account
            data: Data feed (unused)
            isbuy: True if buy order, False if sell

        Returns:
            float: Stake amount for the trade
        """
        # Calculate base stake (either percentage or custom logic)
        if self.params.stake_pct:
            stake = cash * self.params.stake_pct
        else:
            stake = self._calculate_next_stake()

        # Apply limits
        if self.params.min_stake:
            stake = max(stake, self.params.min_stake)
        if self.params.max_stake:
            stake = min(stake, self.params.max_stake)

        # Can't stake more than available cash
        stake = min(stake, cash)

        return stake

    def _calculate_next_stake(self):
        """
        Calculate next stake based on sizer logic

        Override this in subclasses to implement custom sizing logic.
        Base implementation returns current stake unchanged.

        Returns:
            float: Next stake amount
        """
        return self.current_stake

    def notify_trade(self, trade):
        """
        Track trade results for progression logic

        Called by Backtrader after each trade closes.
        Updates consecutive wins/losses and last P/L.

        Args:
            trade: Trade object with pnl, value, etc.
        """
        if not trade.isclosed:
            return

        self.last_trade_pnl = trade.pnl

        if trade.pnl > 0:
            # Win
            self.consecutive_wins += 1
            self.consecutive_losses = 0
        else:
            # Loss
            self.consecutive_losses += 1
            self.consecutive_wins = 0