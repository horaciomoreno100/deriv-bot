"""
Fixed Sizer - Constant stake for every trade

Simplest sizing strategy: same stake amount regardless of wins/losses.
"""
from .base_sizer import BaseBinarySizer


class FixedSizer(BaseBinarySizer):
    """
    Fixed stake sizer - constant position size

    Always uses the same stake amount for every trade.
    Most conservative approach, good for:
    - Risk-averse traders
    - Testing strategies
    - Baseline comparisons

    Example:
        cerebro.addsizer(FixedSizer, stake=10.0)
        # Every trade: $10

    Params:
        stake (float): Fixed stake amount (default: 10.0)
    """

    def _calculate_next_stake(self):
        """
        Return fixed stake amount

        Returns:
            float: Always returns self.params.stake
        """
        return self.params.stake
