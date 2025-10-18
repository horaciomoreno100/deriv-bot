"""
Martingale and Anti-Martingale Sizing

Two progression-based strategies:
- Martingale: Increase stake after LOSS (risky, chasing losses)
- Anti-Martingale: Increase stake after WIN (safer, risking profits)
"""
from .base_sizer import BaseBinarySizer


class MartingaleSizer(BaseBinarySizer):
    """
    Martingale sizing - double stake after each LOSS

    Classic Martingale system: increase position after losses to recover
    when you finally win. VERY RISKY - can wipe out account in losing streak.

    How it works:
        Trade 1: $10 → Loss
        Trade 2: $20 → Loss (trying to recover $10)
        Trade 3: $40 → Loss (trying to recover $30)
        Trade 4: $80 → WIN  (recover all + profit)
        Trade 5: $10 → Reset to base

    Progression formula:
        stake = base_stake * (multiplier ^ consecutive_losses)

    Example:
        cerebro.addsizer(MartingaleSizer, stake=10.0, max_multiplier=5)
        # Max stake: 10 * (2^5) = $320

    Params:
        stake (float): Base stake amount
        multiplier (float): Multiplication factor after loss (default: 2.0)
        max_multiplier (int): Max doublings allowed (default: 5 = 32x max)
        reset_on_win (bool): Reset to base after win (default: True)

    Warning:
        Use with EXTREME caution. Long losing streaks can destroy capital.
        Always set max_multiplier to limit maximum exposure.
    """

    params = (
        ('multiplier', 2.0),        # Double after loss
        ('max_multiplier', 5),      # Max 2^5 = 32x stake
        ('reset_on_win', True),     # Reset after winning
    )

    def __init__(self):
        super().__init__()
        self.base_stake = self.params.stake
        self.current_multiplier = 1

    def _calculate_next_stake(self):
        """
        Calculate stake based on current multiplier

        Returns:
            float: base_stake * current_multiplier
        """
        return self.base_stake * self.current_multiplier

    def notify_trade(self, trade):
        """
        Update multiplier based on trade result

        Win: Reset to base (if reset_on_win=True)
        Loss: Increase multiplier (capped at max)

        Args:
            trade: Closed trade object
        """
        super().notify_trade(trade)

        if not trade.isclosed:
            return

        if trade.pnl > 0:
            # Win: reset to base stake
            if self.params.reset_on_win:
                self.current_multiplier = 1
        else:
            # Loss: increase stake
            self.current_multiplier *= self.params.multiplier

            # Cap at maximum (e.g., 2^5 = 32x)
            max_mult = self.params.multiplier ** self.params.max_multiplier
            self.current_multiplier = min(self.current_multiplier, max_mult)


class AntiMartingaleSizer(BaseBinarySizer):
    """
    Anti-Martingale sizing - increase stake after each WIN

    Also called "Reverse Martingale" or "Paroli system".
    Much safer than Martingale: risks profits, not capital.

    How it works:
        Trade 1: $10 → WIN
        Trade 2: $20 → WIN (betting profit)
        Trade 3: $40 → WIN (betting accumulated profit)
        Trade 4: $80 → LOSS (reset, lost profits but kept original capital)
        Trade 5: $10 → Reset to base

    Philosophy:
        "Let winners run" by increasing size during winning streaks.
        Any loss resets to base, protecting capital.

    Example:
        cerebro.addsizer(AntiMartingaleSizer, stake=10.0, max_multiplier=3)
        # Max stake: 10 * (2^3) = $80

    Params:
        stake (float): Base stake amount
        multiplier (float): Multiplication factor after win (default: 2.0)
        max_multiplier (int): Max increases allowed (default: 3 = 8x max)
        reset_on_loss (bool): Reset to base after loss (default: True)

    Advantages:
        - Protects original capital
        - Maximizes profits during winning streaks
        - Much safer than Martingale
    """

    params = (
        ('multiplier', 2.0),        # Double after win
        ('max_multiplier', 3),      # Max 2^3 = 8x (safer than Martingale)
        ('reset_on_loss', True),    # Reset after losing
    )

    def __init__(self):
        super().__init__()
        self.base_stake = self.params.stake
        self.current_multiplier = 1

    def _calculate_next_stake(self):
        """
        Calculate stake based on current multiplier

        Returns:
            float: base_stake * current_multiplier
        """
        return self.base_stake * self.current_multiplier

    def notify_trade(self, trade):
        """
        Update multiplier based on trade result

        Win: Increase multiplier (capped at max)
        Loss: Reset to base (if reset_on_loss=True)

        Args:
            trade: Closed trade object
        """
        super().notify_trade(trade)

        if not trade.isclosed:
            return

        if trade.pnl > 0:
            # Win: increase stake
            self.current_multiplier *= self.params.multiplier

            # Cap at maximum (e.g., 2^3 = 8x)
            max_mult = self.params.multiplier ** self.params.max_multiplier
            self.current_multiplier = min(self.current_multiplier, max_mult)
        else:
            # Loss: reset to base stake
            if self.params.reset_on_loss:
                self.current_multiplier = 1
