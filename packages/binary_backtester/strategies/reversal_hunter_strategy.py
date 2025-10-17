"""
Reversal Hunter Strategy for Binary Options
Python implementation using Backtrader framework
"""

import backtrader as bt
import numpy as np
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, timedelta
from .base_strategy import BaseBinaryStrategy

class ReversalHunterStrategy(BaseBinaryStrategy):
    """
    Reversal Hunter Strategy - Python implementation
    Detects price action patterns for binary options trading
    """
    
    params = (
        # Pattern detection parameters
        ('min_confidence', 0.001),
        ('proximity_threshold', 0.01),
        ('atr_multiplier', 0.5),
        ('wick_multiplier', 1.0),
        ('engulfing_ratio', 1.05),
        
        # Indicator parameters
        ('ema_period', 5),
        ('atr_period', 3),
        ('rsi_period', 3),
        ('rsi_oversold', 35),
        ('rsi_overbought', 65),
        
        # Trading parameters
        ('cooldown_seconds', 0),  # No cooldown for maximum frequency
        ('max_concurrent_trades', 100),
        ('min_strength_trade', 1),
        
        # Anti-Martingale parameters
        ('use_anti_martingale', True),
        ('base_stake_percentage', 0.01),
        ('max_win_streak', 3),
        ('max_consecutive_losses', 2),
        ('strength_multiplier', 0.2),
    )
    
    def __init__(self):
        super().__init__()
        
        # Initialize indicators
        self.ema = bt.indicators.EMA(self.data.close, period=self.params.ema_period)
        self.atr = bt.indicators.ATR(self.data, period=self.params.atr_period)
        self.rsi = bt.indicators.RSI(self.data.close, period=self.params.rsi_period)
        
        # Anti-Martingale state
        self.win_streak = 0
        self.loss_streak = 0
        self.accumulated_profit = 0.0
        self.stake_multiplier = 1.0
        self.base_stake = self.params.stake_amount
        
        # Pattern tracking
        self.last_signal_time = None
        self.active_trades = 0
        
        # Performance tracking
        self.signals_generated = 0
        self.trades_executed = 0
        
        print(f"🎯 Reversal Hunter Strategy initialized")
        print(f"   Min Confidence: {self.params.min_confidence}")
        print(f"   Proximity Threshold: {self.params.proximity_threshold}")
        print(f"   ATR Multiplier: {self.params.atr_multiplier}")
        print(f"   Wick Multiplier: {self.params.wick_multiplier}")
        print(f"   Anti-Martingale: {self.params.use_anti_martingale}")
    
    def generate_signal(self) -> Optional[str]:
        """
        Generate reversal signals based on price action patterns
        """
        # Need enough data for indicators
        if len(self.data) < max(self.params.ema_period, self.params.atr_period, self.params.rsi_period):
            return None
        
        # Get current candle data
        candle = self._get_current_candle()
        if not candle:
            return None
        
        # Detect price action patterns
        pattern = self._detect_pa_pattern(candle)
        if not pattern:
            return None
        
        # Apply filters
        trend_filter = self._apply_trend_filter(candle)
        vol_filter = self._apply_vol_filter()
        rsi_filter = self._apply_rsi_filter()
        
        # Check if all filters pass
        if not (trend_filter['passed'] and vol_filter['passed']):
            return None
        
        # Generate signal
        self.signals_generated += 1
        self.last_signal_time = self.datetime.datetime()
        self.active_trades += 1
        
        confidence = self._calculate_confidence(pattern['strength'], rsi_filter['passed'])
        direction = 'CALL' if 'bullish' in pattern['type'] else 'PUT'
        
        print(f"📡 SIGNAL #{self.signals_generated}: {direction} ({pattern['type']})")
        print(f"   Confidence: {confidence:.4f}")
        print(f"   Strength: {pattern['strength']}")
        print(f"   Trend: {trend_filter['reason']}")
        print(f"   Volatility: {vol_filter['reason']}")
        print(f"   RSI: {self.rsi[0]:.1f}")
        
        return direction
    
    def _get_current_candle(self) -> Optional[Dict]:
        """Get current candle data"""
        try:
            return {
                'open': self.data.open[0],
                'high': self.data.high[0],
                'low': self.data.low[0],
                'close': self.data.close[0],
                'volume': self.data.volume[0],
                'timestamp': self.datetime.datetime()
            }
        except:
            return None
    
    def _detect_pa_pattern(self, candle: Dict) -> Optional[Dict]:
        """Detect price action patterns"""
        # Get previous candles for pattern detection
        if len(self.data) < 3:
            return None
        
        prev_candle = {
            'open': self.data.open[-1],
            'high': self.data.high[-1],
            'low': self.data.low[-1],
            'close': self.data.close[-1]
        }
        
        prev_prev_candle = {
            'open': self.data.open[-2],
            'high': self.data.high[-2],
            'low': self.data.low[-2],
            'close': self.data.close[-2]
        }
        
        # Detect patterns
        patterns = []
        
        # Pin Bar Detection
        pin_bullish = self._detect_pin_bar_bullish(candle, prev_candle)
        if pin_bullish:
            patterns.append(pin_bullish)
        
        pin_bearish = self._detect_pin_bar_bearish(candle, prev_candle)
        if pin_bearish:
            patterns.append(pin_bearish)
        
        # Engulfing Detection
        engulfing_bullish = self._detect_engulfing_bullish(candle, prev_candle)
        if engulfing_bullish:
            patterns.append(engulfing_bullish)
        
        engulfing_bearish = self._detect_engulfing_bearish(candle, prev_candle)
        if engulfing_bearish:
            patterns.append(engulfing_bearish)
        
        # Double Red/Green Detection
        double_red = self._detect_double_red(candle, prev_candle, prev_prev_candle)
        if double_red:
            patterns.append(double_red)
        
        double_green = self._detect_double_green(candle, prev_candle, prev_prev_candle)
        if double_green:
            patterns.append(double_green)
        
        # Return strongest pattern
        if patterns:
            return max(patterns, key=lambda p: p['strength'])
        
        return None
    
    def _detect_pin_bar_bullish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """Detect bullish pin bar"""
        body_size = abs(candle['close'] - candle['open'])
        total_range = candle['high'] - candle['low']
        
        if total_range == 0:
            return None
        
        body_ratio = body_size / total_range
        wick_ratio = (candle['close'] - candle['low']) / total_range
        
        # Pin bar criteria
        if (body_ratio < 0.3 and 
            wick_ratio > 0.6 and 
            candle['close'] > candle['open']):
            
            return {
                'type': 'pin_bar_bullish',
                'strength': 2,
                'metadata': {
                    'body_ratio': body_ratio,
                    'wick_ratio': wick_ratio,
                    'proximity_to_sr': self._calculate_proximity_to_sr(candle),
                    'rsi_alignment': self.rsi[0] < 50
                }
            }
        
        return None
    
    def _detect_pin_bar_bearish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """Detect bearish pin bar"""
        body_size = abs(candle['close'] - candle['open'])
        total_range = candle['high'] - candle['low']
        
        if total_range == 0:
            return None
        
        body_ratio = body_size / total_range
        wick_ratio = (candle['high'] - candle['close']) / total_range
        
        # Pin bar criteria
        if (body_ratio < 0.3 and 
            wick_ratio > 0.6 and 
            candle['close'] < candle['open']):
            
            return {
                'type': 'pin_bar_bearish',
                'strength': 2,
                'metadata': {
                    'body_ratio': body_ratio,
                    'wick_ratio': wick_ratio,
                    'proximity_to_sr': self._calculate_proximity_to_sr(candle),
                    'rsi_alignment': self.rsi[0] > 50
                }
            }
        
        return None
    
    def _detect_engulfing_bullish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """Detect bullish engulfing"""
        # Current candle must be bullish
        if candle['close'] <= candle['open']:
            return None
        
        # Previous candle must be bearish
        if prev_candle['close'] >= prev_candle['open']:
            return None
        
        # Current candle must engulf previous
        if (candle['open'] < prev_candle['close'] and 
            candle['close'] > prev_candle['open']):
            
            return {
                'type': 'engulfing_bullish',
                'strength': 3,
                'metadata': {
                    'body_ratio': 1.0,
                    'wick_ratio': 0.0,
                    'proximity_to_sr': self._calculate_proximity_to_sr(candle),
                    'rsi_alignment': self.rsi[0] < 50
                }
            }
        
        return None
    
    def _detect_engulfing_bearish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """Detect bearish engulfing"""
        # Current candle must be bearish
        if candle['close'] >= candle['open']:
            return None
        
        # Previous candle must be bullish
        if prev_candle['close'] <= prev_candle['open']:
            return None
        
        # Current candle must engulf previous
        if (candle['open'] > prev_candle['close'] and 
            candle['close'] < prev_candle['open']):
            
            return {
                'type': 'engulfing_bearish',
                'strength': 3,
                'metadata': {
                    'body_ratio': 1.0,
                    'wick_ratio': 0.0,
                    'proximity_to_sr': self._calculate_proximity_to_sr(candle),
                    'rsi_alignment': self.rsi[0] > 50
                }
            }
        
        return None
    
    def _detect_double_red(self, candle: Dict, prev_candle: Dict, prev_prev_candle: Dict) -> Optional[Dict]:
        """Detect double red pattern"""
        # Check if previous two candles are bearish
        is_prev_bearish = prev_candle['close'] < prev_candle['open']
        is_prev_prev_bearish = prev_prev_candle['close'] < prev_prev_candle['open']
        is_current_bearish = candle['close'] < candle['open']
        
        if is_prev_bearish and is_prev_prev_bearish and is_current_bearish:
            return {
                'type': 'double_red_bearish',
                'strength': 1,
                'metadata': {
                    'body_ratio': 1.0,
                    'wick_ratio': 0.0,
                    'proximity_to_sr': self._calculate_proximity_to_sr(candle),
                    'rsi_alignment': True
                }
            }
        
        return None
    
    def _detect_double_green(self, candle: Dict, prev_candle: Dict, prev_prev_candle: Dict) -> Optional[Dict]:
        """Detect double green pattern"""
        # Check if previous two candles are bullish
        is_prev_bullish = prev_candle['close'] > prev_candle['open']
        is_prev_prev_bullish = prev_prev_candle['close'] > prev_prev_candle['open']
        is_current_bullish = candle['close'] > candle['open']
        
        if is_prev_bullish and is_prev_prev_bullish and is_current_bullish:
            return {
                'type': 'double_green_bullish',
                'strength': 1,
                'metadata': {
                    'body_ratio': 1.0,
                    'wick_ratio': 0.0,
                    'proximity_to_sr': self._calculate_proximity_to_sr(candle),
                    'rsi_alignment': True
                }
            }
        
        return None
    
    def _apply_trend_filter(self, candle: Dict) -> Dict:
        """Apply trend filter"""
        is_uptrend = candle['close'] > self.ema[0]
        is_downtrend = candle['close'] < self.ema[0]
        
        return {
            'passed': True,  # Always pass for maximum opportunities
            'reason': 'uptrend' if is_uptrend else 'downtrend' if is_downtrend else 'sideways',
            'proximity': 100
        }
    
    def _apply_vol_filter(self) -> Dict:
        """Apply volatility filter"""
        current_atr = self.atr[0]
        previous_atr = self.atr[-1] if len(self.atr) > 1 else current_atr
        avg_atr = (current_atr + previous_atr) / 2
        
        threshold = avg_atr * self.params.atr_multiplier
        passed = current_atr > threshold
        proximity = min(100, (current_atr / threshold) * 100) if threshold > 0 else 100
        
        return {
            'passed': passed,
            'reason': 'sufficient_volatility' if passed else 'low_volatility',
            'proximity': proximity
        }
    
    def _apply_rsi_filter(self) -> Dict:
        """Apply RSI filter (bonus only, not blocking)"""
        rsi_value = self.rsi[0]
        
        return {
            'passed': True,  # Always pass, RSI is bonus only
            'reason': 'rsi_oversold' if rsi_value < self.params.rsi_oversold else 
                     'rsi_overbought' if rsi_value > self.params.rsi_overbought else 'rsi_neutral',
            'proximity': 100
        }
    
    def _calculate_confidence(self, strength: int, rsi_alignment: bool) -> float:
        """Calculate signal confidence"""
        base_confidence = self.params.min_confidence * strength
        rsi_bonus = 0.001 if rsi_alignment else 0.0
        return base_confidence + rsi_bonus
    
    def _calculate_proximity_to_sr(self, candle: Dict) -> float:
        """Calculate proximity to support/resistance (simplified)"""
        # Simplified S/R calculation
        return 0.5  # Placeholder
    
    def _execute_binary_trade(self, direction: str):
        """Execute binary trade with Anti-Martingale"""
        # Calculate stake with Anti-Martingale
        stake = self._calculate_anti_martingale_stake()
        
        # Update stake amount
        self.params.stake_amount = stake
        
        # Call parent method
        super()._execute_binary_trade(direction)
        
        self.trades_executed += 1
        
        print(f"💰 TRADE #{self.trades_executed}: {direction}")
        print(f"   Stake: {stake:.2f}")
        print(f"   Anti-Martingale: Win Streak: {self.win_streak}, Loss Streak: {self.loss_streak}")
        print(f"   Accumulated Profit: {self.accumulated_profit:.2f}")
        print(f"   Stake Multiplier: {self.stake_multiplier:.2f}x")
    
    def _calculate_anti_martingale_stake(self) -> float:
        """Calculate stake using Anti-Martingale system"""
        base_stake = self.broker.get_cash() * self.params.base_stake_percentage
        
        # Apply strength multiplier
        strength_multiplier = 1 + (self.params.strength_multiplier * 2)  # Assuming strength 2
        
        # Apply Anti-Martingale logic
        if self.win_streak > 0:
            # On winning streak, increase stake
            win_multiplier = 1 + (self.win_streak * 0.2)
            stake = base_stake * strength_multiplier * win_multiplier
        elif self.loss_streak > 0:
            # On losing streak, decrease stake
            loss_multiplier = max(0.5, 1 - (self.loss_streak * 0.2))
            stake = base_stake * strength_multiplier * loss_multiplier
        else:
            # Normal stake
            stake = base_stake * strength_multiplier
        
        # Ensure minimum stake
        min_stake = max(self.broker.get_cash() * 0.001, 1.0)
        return max(stake, min_stake)
    
    def _check_expired_contracts(self):
        """Override to update Anti-Martingale state"""
        super()._check_expired_contracts()
        
        # Update Anti-Martingale state based on recent trades
        # This is a simplified version - in practice, you'd track individual trade results
        pass
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get enhanced statistics including Anti-Martingale info"""
        stats = super().get_statistics()
        
        # Add Anti-Martingale statistics
        stats.update({
            'signals_generated': self.signals_generated,
            'trades_executed': self.trades_executed,
            'signal_to_trade_ratio': (self.trades_executed / self.signals_generated * 100) if self.signals_generated > 0 else 0,
            'win_streak': self.win_streak,
            'loss_streak': self.loss_streak,
            'accumulated_profit': self.accumulated_profit,
            'stake_multiplier': self.stake_multiplier,
            'active_trades': self.active_trades
        })
        
        return stats
    
    def stop(self):
        """Enhanced stop method with Anti-Martingale summary"""
        stats = self.get_statistics()
        
        print("\n" + "="*60)
        print("🎯 REVERSAL HUNTER STRATEGY RESULTS")
        print("="*60)
        print(f"Signals Generated: {stats['signals_generated']}")
        print(f"Trades Executed: {stats['trades_executed']}")
        print(f"Signal-to-Trade Ratio: {stats['signal_to_trade_ratio']:.1f}%")
        print(f"Total Trades: {stats['total_trades']}")
        print(f"Won Trades: {stats['won_trades']}")
        print(f"Lost Trades: {stats['lost_trades']}")
        print(f"Win Rate: {stats['win_rate']:.2%}")
        print(f"Total Profit: {stats['total_profit']:.2f}")
        print(f"Final Balance: {self.broker.get_cash():.2f}")
        print(f"Active Trades: {stats['active_trades']}")
        print("\n🎯 ANTI-MARTINGALE SUMMARY:")
        print(f"Win Streak: {stats['win_streak']}")
        print(f"Loss Streak: {stats['loss_streak']}")
        print(f"Accumulated Profit: {stats['accumulated_profit']:.2f}")
        print(f"Stake Multiplier: {stats['stake_multiplier']:.2f}x")
        print("="*60)
