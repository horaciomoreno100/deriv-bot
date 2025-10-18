"""
Position Sizing for Binary Options

This module provides position sizing strategies for binary options trading:

- BaseBinarySizer: Foundation class with common functionality
- FixedSizer: Constant stake every trade
- MartingaleSizer: Double after losses (risky)
- AntiMartingaleSizer: Double after wins (safer)

Example usage:
    from sizers import MartingaleSizer
    cerebro.addsizer(MartingaleSizer, stake=10.0, max_multiplier=5)
"""
from .base_sizer import BaseBinarySizer
from .fixed_sizer import FixedSizer
from .martingale_sizer import MartingaleSizer, AntiMartingaleSizer

__all__ = [
    'BaseBinarySizer',
    'FixedSizer',
    'MartingaleSizer',
    'AntiMartingaleSizer'
]
