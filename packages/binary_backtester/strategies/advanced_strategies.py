"""
Advanced Binary Options Strategies
"""

import backtrader as bt
import numpy as np
from typing import Optional
from .base_strategy import BaseBinaryStrategy

class MACDStrategy(BaseBinaryStrategy):
    """
    MACD-based strategy for binary options
    """
    params = (
        ('fast_period', 12),
        ('slow_period', 26),
        ('signal_period', 9),
        ('macd_threshold', 0.5),
    )

    def __init__(self):
        super().__init__()
        
        # MACD indicator
        self.macd = bt.indicators.MACD(
            self.data.close,
            period_me1=self.params.fast_period,
            period_me2=self.params.slow_period,
            period_signal=self.params.signal_period
        )
        
        # Track previous MACD for trend detection
        self.prev_macd = None
        self.prev_signal = None

    def generate_signal(self) -> Optional[str]:
        """Generate MACD-based trading signal"""
        if len(self.macd.macd) < 2 or len(self.macd.signal) < 2:
            return None
        
        current_macd = self.macd.macd[0]
        current_signal = self.macd.signal[0]
        prev_macd = self.macd.macd[-1]
        prev_signal = self.macd.signal[-1]
        
        # MACD crossover signals
        if (prev_macd <= prev_signal and current_macd > current_signal and 
            current_macd > self.params.macd_threshold):
            return 'CALL'
        elif (prev_macd >= prev_signal and current_macd < current_signal and 
              current_macd < -self.params.macd_threshold):
            return 'PUT'
        
        return None

class BollingerBandsStrategy(BaseBinaryStrategy):
    """
    Bollinger Bands strategy for binary options
    """
    params = (
        ('bb_period', 20),
        ('bb_std', 2.0),
        ('bb_threshold', 0.8),
    )

    def __init__(self):
        super().__init__()
        
        # Bollinger Bands indicator
        self.bb = bt.indicators.BollingerBands(
            self.data.close,
            period=self.params.bb_period,
            devfactor=self.params.bb_std
        )
        
        # RSI for confirmation
        self.rsi = bt.indicators.RSI(self.data.close, period=14)

    def generate_signal(self) -> Optional[str]:
        """Generate Bollinger Bands-based trading signal"""
        if len(self.bb.lines.top) < 1:
            return None
        
        current_price = self.data.close[0]
        bb_top = self.bb.lines.top[0]
        bb_bottom = self.bb.lines.bot[0]
        bb_middle = self.bb.lines.mid[0]
        rsi_value = self.rsi[0]
        
        # Price near upper band + RSI overbought = PUT signal
        if (current_price >= bb_top * self.params.bb_threshold and 
            rsi_value > 70):
            return 'PUT'
        
        # Price near lower band + RSI oversold = CALL signal
        elif (current_price <= bb_bottom * (2 - self.params.bb_threshold) and 
              rsi_value < 30):
            return 'CALL'
        
        return None

class StochasticStrategy(BaseBinaryStrategy):
    """
    Stochastic Oscillator strategy for binary options
    """
    params = (
        ('stoch_k_period', 14),
        ('stoch_d_period', 3),
        ('stoch_upper', 80),
        ('stoch_lower', 20),
    )

    def __init__(self):
        super().__init__()
        
        # Stochastic indicator
        self.stoch = bt.indicators.Stochastic(
            self.data,
            period=self.params.stoch_k_period,
            period_dfast=self.params.stoch_d_period
        )

    def generate_signal(self) -> Optional[str]:
        """Generate Stochastic-based trading signal"""
        if len(self.stoch.lines.percK) < 2:
            return None
        
        current_k = self.stoch.lines.percK[0]
        current_d = self.stoch.lines.percD[0]
        prev_k = self.stoch.lines.percK[-1]
        prev_d = self.stoch.lines.percD[-1]
        
        # Oversold + K crossing above D = CALL signal
        if (current_k < self.params.stoch_lower and 
            prev_k <= prev_d and current_k > current_d):
            return 'CALL'
        
        # Overbought + K crossing below D = PUT signal
        elif (current_k > self.params.stoch_upper and 
              prev_k >= prev_d and current_k < current_d):
            return 'PUT'
        
        return None

class MultiTimeframeStrategy(BaseBinaryStrategy):
    """
    Multi-timeframe strategy combining multiple indicators
    """
    params = (
        ('rsi_period', 14),
        ('rsi_oversold', 30),
        ('rsi_overbought', 70),
        ('bb_period', 20),
        ('bb_std', 2.0),
        ('macd_fast', 12),
        ('macd_slow', 26),
        ('macd_signal', 9),
    )

    def __init__(self):
        super().__init__()
        
        # Multiple indicators
        self.rsi = bt.indicators.RSI(self.data.close, period=self.params.rsi_period)
        self.bb = bt.indicators.BollingerBands(
            self.data.close,
            period=self.params.bb_period,
            devfactor=self.params.bb_std
        )
        self.macd = bt.indicators.MACD(
            self.data.close,
            period_me1=self.params.macd_fast,
            period_me2=self.params.macd_slow,
            period_signal=self.params.macd_signal
        )
        
        # Moving averages for trend
        self.sma_20 = bt.indicators.SMA(self.data.close, period=20)
        self.sma_50 = bt.indicators.SMA(self.data.close, period=50)

    def generate_signal(self) -> Optional[str]:
        """Generate multi-timeframe trading signal"""
        if (len(self.rsi) < 1 or len(self.bb.lines.top) < 1 or 
            len(self.macd.macd) < 1 or len(self.sma_20) < 1):
            return None
        
        # Get current values
        rsi_value = self.rsi[0]
        bb_top = self.bb.lines.top[0]
        bb_bottom = self.bb.lines.bot[0]
        bb_middle = self.bb.lines.mid[0]
        macd_value = self.macd.macd[0]
        macd_signal = self.macd.signal[0]
        sma_20_value = self.sma_20[0]
        sma_50_value = self.sma_50[0]
        current_price = self.data.close[0]
        
        # Trend analysis
        uptrend = sma_20_value > sma_50_value
        downtrend = sma_20_value < sma_50_value
        
        # CALL signal conditions
        call_conditions = [
            rsi_value < self.params.rsi_oversold,
            current_price < bb_middle,
            macd_value > macd_signal,
            uptrend
        ]
        
        # PUT signal conditions
        put_conditions = [
            rsi_value > self.params.rsi_overbought,
            current_price > bb_middle,
            macd_value < macd_signal,
            downtrend
        ]
        
        # Require at least 3 out of 4 conditions
        if sum(call_conditions) >= 3:
            return 'CALL'
        elif sum(put_conditions) >= 3:
            return 'PUT'
        
        return None

class MeanReversionStrategy(BaseBinaryStrategy):
    """
    Mean reversion strategy for binary options
    """
    params = (
        ('lookback_period', 20),
        ('deviation_threshold', 2.0),
        ('rsi_period', 14),
    )

    def __init__(self):
        super().__init__()
        
        # Mean reversion indicators
        self.sma = bt.indicators.SMA(self.data.close, period=self.params.lookback_period)
        self.std = bt.indicators.StandardDeviation(self.data.close, period=self.params.lookback_period)
        self.rsi = bt.indicators.RSI(self.data.close, period=self.params.rsi_period)
        
        # Track price extremes
        self.price_highs = []
        self.price_lows = []

    def generate_signal(self) -> Optional[str]:
        """Generate mean reversion trading signal"""
        if len(self.sma) < 1 or len(self.std) < 1:
            return None
        
        current_price = self.data.close[0]
        sma_value = self.sma[0]
        std_value = self.std[0]
        rsi_value = self.rsi[0]
        
        # Calculate z-score
        z_score = (current_price - sma_value) / std_value if std_value > 0 else 0
        
        # Oversold condition (price below mean - threshold * std)
        if (z_score < -self.params.deviation_threshold and 
            rsi_value < 30):
            return 'CALL'
        
        # Overbought condition (price above mean + threshold * std)
        elif (z_score > self.params.deviation_threshold and 
              rsi_value > 70):
            return 'PUT'
        
        return None

class MomentumStrategy(BaseBinaryStrategy):
    """
    Momentum strategy for binary options
    """
    params = (
        ('momentum_period', 10),
        ('momentum_threshold', 0.5),
        ('volume_period', 20),
    )

    def __init__(self):
        super().__init__()
        
        # Momentum indicators
        self.momentum = bt.indicators.Momentum(self.data.close, period=self.params.momentum_period)
        self.roc = bt.indicators.RateOfChange(self.data.close, period=self.params.momentum_period)
        self.volume_sma = bt.indicators.SMA(self.data.volume, period=self.params.volume_period)
        
        # Trend indicators
        self.ema_12 = bt.indicators.EMA(self.data.close, period=12)
        self.ema_26 = bt.indicators.EMA(self.data.close, period=26)

    def generate_signal(self) -> Optional[str]:
        """Generate momentum-based trading signal"""
        if (len(self.momentum) < 1 or len(self.roc) < 1 or 
            len(self.volume_sma) < 1 or len(self.ema_12) < 1):
            return None
        
        momentum_value = self.momentum[0]
        roc_value = self.roc[0]
        current_volume = self.data.volume[0]
        avg_volume = self.volume_sma[0]
        ema_12_value = self.ema_12[0]
        ema_26_value = self.ema_26[0]
        
        # Strong momentum up + volume confirmation + trend up
        if (momentum_value > self.params.momentum_threshold and 
            roc_value > 0 and 
            current_volume > avg_volume * 1.2 and
            ema_12_value > ema_26_value):
            return 'CALL'
        
        # Strong momentum down + volume confirmation + trend down
        elif (momentum_value < -self.params.momentum_threshold and 
              roc_value < 0 and 
              current_volume > avg_volume * 1.2 and
              ema_12_value < ema_26_value):
            return 'PUT'
        
        return None
