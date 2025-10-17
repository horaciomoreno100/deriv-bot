"""
Configuration settings for binary backtester MVP
"""

from dataclasses import dataclass
from typing import Optional
from datetime import datetime, timedelta

@dataclass
class Config:
    """Configuration for binary backtester"""
    
    # Asset configuration
    symbol: str = 'frxXAUUSD'
    timeframe: int = 60  # seconds
    
    # Trading parameters
    initial_cash: float = 1000.0
    expiration_time: int = 1  # minutes
    payout: float = 0.8  # 80% payout
    risk_per_trade: float = 0.01  # 1% of capital
    
    # Data parameters
    days_back: int = 30
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    
    # Strategy parameters
    rsi_period: int = 14
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0
    
    def __post_init__(self):
        """Set default dates if not provided"""
        if self.end_date is None:
            self.end_date = datetime.now()
        if self.start_date is None:
            self.start_date = self.end_date - timedelta(days=self.days_back)
    
    @property
    def expiration_seconds(self) -> int:
        """Get expiration time in seconds"""
        return self.expiration_time * 60
    
    @property
    def stake_amount(self) -> float:
        """Calculate stake amount based on risk"""
        return self.initial_cash * self.risk_per_trade
