"""
RSI Strategy for binary options
"""

import backtrader as bt
from typing import Optional
from .base_strategy import BaseBinaryStrategy

class RSIStrategy(BaseBinaryStrategy):
    """
    RSI-based strategy for binary options
    """
    
    params = (
        ('rsi_period', 14),
        ('rsi_oversold', 30.0),
        ('rsi_overbought', 70.0),
    )
    
    def __init__(self):
        super().__init__()
        
        # RSI indicator
        self.rsi = bt.indicators.RSI(
            self.data.close,
            period=self.params.rsi_period
        )
        
        # Track previous RSI for trend detection
        self.prev_rsi = None
    
    def generate_signal(self) -> Optional[str]:
        """
        Generate RSI-based trading signal
        """
        # Need at least 2 RSI values for trend detection
        if len(self.rsi) < 2:
            return None
        
        current_rsi = self.rsi[0]
        previous_rsi = self.rsi[-1]
        
        # CALL signal: RSI oversold and rising
        if (current_rsi < self.params.rsi_oversold and 
            current_rsi > previous_rsi):
            return 'CALL'
        
        # PUT signal: RSI overbought and falling
        if (current_rsi > self.params.rsi_overbought and 
            current_rsi < previous_rsi):
            return 'PUT'
        
        return None
    
    def next(self):
        """
        Override next method to add RSI logging
        """
        # Log RSI values for debugging
        if len(self.rsi) > 0:
            current_rsi = self.rsi[0]
            if self.prev_rsi is not None:
                rsi_change = current_rsi - self.prev_rsi
                if abs(rsi_change) > 5:  # Significant RSI change
                    print(f"📈 RSI: {current_rsi:.1f} (change: {rsi_change:+.1f})")
            
            self.prev_rsi = current_rsi
        
        # Call parent next method
        super().next()
