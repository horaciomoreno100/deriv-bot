"""
Reversal Hunter Strategy - TA-LIB VERSION
Uses industry-standard TA-Lib for pattern detection
and scipy for S/R detection to compare against manual implementation
"""

import backtrader as bt
import numpy as np
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, timedelta
from .base_strategy import BaseBinaryStrategy
from core.talib_patterns import TALibPatternDetector, ScipySupportResistance

class ReversalHunterBalancedStrategy(BaseBinaryStrategy):
    """
    TA-LIB VERSION Reversal Hunter Strategy
    - Uses TA-Lib for candlestick pattern detection
    - Uses scipy.signal.find_peaks for S/R detection
    - Same parameters as balanced version for fair comparison
    """

    params = (
        # PLAN ORIGINAL - Pattern detection parameters
        ('min_confidence', 0.002),  # Higher for quality
        ('proximity_threshold', 0.005),  # 0.5% proximity to S/R
        ('atr_multiplier', 1.0),  # ATR filter as per plan
        ('wick_multiplier', 2.0),  # Wick > 2x body (PLAN ORIGINAL)
        ('engulfing_ratio', 1.5),  # Engulfing > 1.5x body (PLAN ORIGINAL)

        # PLAN ORIGINAL - Indicator parameters
        ('ema_period', 20),  # EMA 20 for trend filter (PLAN ORIGINAL)
        ('atr_period', 14),  # ATR 14 (PLAN ORIGINAL)
        ('rsi_period', 14),  # RSI 14 optional bonus (PLAN ORIGINAL)
        ('rsi_oversold', 30),  # RSI < 30 for CALL bonus
        ('rsi_overbought', 70),  # RSI > 70 for PUT bonus

        # PLAN ORIGINAL - Trading parameters
        ('cooldown_seconds', 300),  # 5 min cooldown to avoid overtrading
        ('max_concurrent_trades', 3),  # Max 3 concurrent
        ('min_strength_trade', 2),  # Min strength 2 (PLAN ORIGINAL)

        # S/R System parameters
        ('sr_lookback', 100),  # Lookback for S/R detection
        ('sr_proximity_max', 0.5),  # Max distance to S/R (0.5%)

        # FUNCTIONAL Anti-Martingale parameters
        ('use_anti_martingale', True),
        ('base_stake_percentage', 0.01),
        ('max_win_streak_bonus', 3),  # Max streak before reset
        ('max_consecutive_losses', 3),
        ('win_streak_multiplier', 0.2),  # 20% increase per win
        ('loss_streak_multiplier', 0.3),  # 30% decrease per loss
        ('strength_multiplier', 0.1),  # Bonus per strength point
    )

    def __init__(self):
        super().__init__()

        # Initialize indicators (PLAN ORIGINAL: EMA 20, ATR 14, RSI 14)
        self.ema = bt.indicators.EMA(self.data.close, period=self.params.ema_period)
        self.atr = bt.indicators.ATR(self.data, period=self.params.atr_period)
        self.rsi = bt.indicators.RSI(self.data.close, period=self.params.rsi_period)

        # Initialize TA-Lib Pattern Detector
        self.pattern_detector = TALibPatternDetector()

        # Initialize Scipy Support/Resistance system
        self.sr_system = ScipySupportResistance(
            lookback_period=self.params.sr_lookback,
            proximity_threshold=self.params.proximity_threshold
        )

        # FUNCTIONAL Anti-Martingale state
        self.win_streak = 0
        self.loss_streak = 0
        self.accumulated_profit = 0.0
        self.stake_multiplier = 1.0
        self.base_stake = self.params.stake_amount

        # Track individual trades for Anti-Martingale
        self.pending_trades = []  # List of {entry_time, direction, stake, result}
        self.completed_trades = []

        # Pattern tracking
        self.last_signal_time = None
        self.active_trades = 0

        # ENHANCED: Store current signal context for detailed logging
        self.current_signal_context = {}

        # Performance tracking
        self.signals_generated = 0
        self.trades_executed = 0
        self.pattern_stats = {
            'pin_bar': {'total': 0, 'won': 0, 'lost': 0},
            'engulfing': {'total': 0, 'won': 0, 'lost': 0},
            'double_red': {'total': 0, 'won': 0, 'lost': 0},
            'double_green': {'total': 0, 'won': 0, 'lost': 0}
        }

        print(f"🎯 TA-LIB Reversal Hunter Strategy initialized")
        print(f"   Pattern Detection: TA-Lib (industry standard)")
        print(f"   S/R Detection: scipy.signal.find_peaks")
        print(f"   Min Confidence: {self.params.min_confidence}")
        print(f"   Proximity Threshold: {self.params.proximity_threshold}")
        print(f"   Min Strength Trade: {self.params.min_strength_trade}")
        print(f"   Cooldown: {self.params.cooldown_seconds}s")
        print(f"   Max Concurrent: {self.params.max_concurrent_trades}")
        print(f"   Anti-Martingale: ENABLED with tracking")

    def generate_signal(self) -> Optional[str]:
        """
        Generate BALANCED reversal signals with S/R integration
        """
        # Need enough data for indicators
        min_bars = max(self.params.ema_period, self.params.atr_period, self.params.rsi_period, 20)
        if len(self.data) < min_bars:
            return None

        # Update scipy-based Support/Resistance system
        lookback = min(len(self.data), self.params.sr_lookback)
        highs = np.array([self.data.high[-i] for i in range(lookback, 0, -1)])
        lows = np.array([self.data.low[-i] for i in range(lookback, 0, -1)])
        self.sr_system.update(highs, lows)

        # Check max concurrent trades
        if self.active_trades >= self.params.max_concurrent_trades:
            return None

        # Check cooldown
        if self._is_in_cooldown():
            return None

        # Get current candle data
        candle = self._get_current_candle()
        if not candle:
            return None

        # Detect patterns using TA-Lib
        pattern = self._detect_talib_pattern()
        if not pattern:
            return None

        # Check minimum strength
        if pattern['strength'] < self.params.min_strength_trade:
            return None

        # Apply BALANCED filters
        trend_filter = self._apply_balanced_trend_filter(candle, pattern)
        vol_filter = self._apply_balanced_vol_filter()
        rsi_filter = self._apply_balanced_rsi_filter(pattern)

        # CRITICAL: Check S/R proximity (PLAN ORIGINAL)
        sr_proximity = pattern['metadata'].get('sr_proximity', 0)
        min_sr_proximity = 30  # Minimum 30/100 score to trade

        if sr_proximity < min_sr_proximity:
            return None  # Too far from S/R, skip trade

        # Check if critical filters pass (trend + volatility + S/R)
        if not (trend_filter['passed'] and vol_filter['passed']):
            return None

        # RSI is bonus only, not blocking
        rsi_bonus = rsi_filter['passed']

        # Generate signal
        self.signals_generated += 1
        self.last_signal_time = self.datetime.datetime()
        self.active_trades += 1

        confidence = self._calculate_confidence(pattern['strength'], rsi_bonus)
        direction = 'CALL' if 'bullish' in pattern['type'] else 'PUT'

        # Track pattern
        pattern_key = self._get_pattern_key(pattern['type'])
        if pattern_key in self.pattern_stats:
            self.pattern_stats[pattern_key]['total'] += 1

        # ENHANCED: Store current signal context for detailed logging
        self.current_signal_context = {
            'pattern_type': pattern['type'],
            'pattern_key': pattern_key,
            'strength': pattern['strength'],
            'sr_proximity': sr_proximity,
            'rsi_value': self.rsi[0],
            'rsi_bonus': rsi_bonus,
            'confidence': confidence,
            'timestamp': self.datetime.datetime(),
            'hour': self.datetime.datetime().hour
        }

        print(f"📡 BALANCED SIGNAL #{self.signals_generated}: {direction} ({pattern['type']})")
        print(f"   Confidence: {confidence:.4f}")
        print(f"   Strength: {pattern['strength']}")
        print(f"   S/R Proximity: {sr_proximity:.1f}/100 ✅")  # Show S/R score
        print(f"   Trend: {trend_filter['reason']}")
        print(f"   Volatility: {vol_filter['reason']}")
        print(f"   RSI: {self.rsi[0]:.1f} ({'BONUS' if rsi_bonus else 'neutral'})")

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

    def _detect_talib_pattern(self) -> Optional[Dict]:
        """
        Detect patterns using TA-Lib library
        Returns pattern in same format as manual implementation
        """
        # Need at least 10 candles for TA-Lib patterns
        if len(self.data) < 10:
            return None

        # Get OHLC data for TA-Lib (last 50 candles for context)
        lookback = min(len(self.data), 50)
        opens = np.array([self.data.open[-i] for i in range(lookback, 0, -1)])
        highs = np.array([self.data.high[-i] for i in range(lookback, 0, -1)])
        lows = np.array([self.data.low[-i] for i in range(lookback, 0, -1)])
        closes = np.array([self.data.close[-i] for i in range(lookback, 0, -1)])

        # Detect patterns using TA-Lib
        patterns = self.pattern_detector.detect_patterns(opens, highs, lows, closes)

        if not patterns:
            return None

        # Get first detected pattern (TA-Lib may find multiple)
        pattern = patterns[0]

        # Add S/R proximity to pattern metadata
        current_price = self.data.close[0]
        sr_proximity = self.sr_system.get_proximity_score(current_price, pattern['type'])
        pattern['metadata']['sr_proximity'] = sr_proximity

        return pattern

    def _detect_pa_pattern(self, candle: Dict) -> Optional[Dict]:
        """Detect BALANCED price action patterns"""
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

        # Detect all patterns
        patterns = []

        # Pin Bar Detection (BALANCED)
        pin_bullish = self._detect_pin_bar_bullish(candle, prev_candle)
        if pin_bullish:
            patterns.append(pin_bullish)

        pin_bearish = self._detect_pin_bar_bearish(candle, prev_candle)
        if pin_bearish:
            patterns.append(pin_bearish)

        # Engulfing Detection (BALANCED)
        engulfing_bullish = self._detect_engulfing_bullish(candle, prev_candle)
        if engulfing_bullish:
            patterns.append(engulfing_bullish)

        engulfing_bearish = self._detect_engulfing_bearish(candle, prev_candle)
        if engulfing_bearish:
            patterns.append(engulfing_bearish)

        # Double Red/Green Detection (BALANCED)
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
        """BALANCED bullish pin bar detection"""
        body_size = abs(candle['close'] - candle['open'])
        total_range = candle['high'] - candle['low']

        if total_range == 0:
            return None

        body_ratio = body_size / total_range
        lower_wick = min(candle['open'], candle['close']) - candle['low']
        wick_ratio = lower_wick / total_range

        # MORE STRICT Pin bar criteria
        if (body_ratio < 0.3 and  # Stricter body ratio
            wick_ratio > 0.6 and  # Longer wick required
            lower_wick > body_size * self.params.wick_multiplier and  # Wick must be longer than body
            candle['close'] > candle['open']):  # Bullish close

            # Check S/R proximity
            proximity_score = self.sr_system.get_proximity_score(candle['close'], 'bullish')

            return {
                'type': 'pin_bar_bullish',
                'strength': 3,
                'metadata': {
                    'body_ratio': body_ratio,
                    'wick_ratio': wick_ratio,
                    'rsi_alignment': self.rsi[0] < 50,
                    'sr_proximity': proximity_score  # Real S/R proximity
                }
            }

        return None

    def _detect_pin_bar_bearish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """BALANCED bearish pin bar detection"""
        body_size = abs(candle['close'] - candle['open'])
        total_range = candle['high'] - candle['low']

        if total_range == 0:
            return None

        body_ratio = body_size / total_range
        upper_wick = candle['high'] - max(candle['open'], candle['close'])
        wick_ratio = upper_wick / total_range

        # MORE STRICT Pin bar criteria
        if (body_ratio < 0.3 and  # Stricter body ratio
            wick_ratio > 0.6 and  # Longer wick required
            upper_wick > body_size * self.params.wick_multiplier and  # Wick must be longer than body
            candle['close'] < candle['open']):  # Bearish close

            # Check S/R proximity
            proximity_score = self.sr_system.get_proximity_score(candle['close'], 'bearish')

            return {
                'type': 'pin_bar_bearish',
                'strength': 3,
                'metadata': {
                    'body_ratio': body_ratio,
                    'wick_ratio': wick_ratio,
                    'rsi_alignment': self.rsi[0] > 50,
                    'sr_proximity': proximity_score  # Real S/R proximity
                }
            }

        return None

    def _detect_engulfing_bullish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """BALANCED bullish engulfing detection"""
        # Current candle must be bullish
        if candle['close'] <= candle['open']:
            return None

        # Previous candle must be bearish
        if prev_candle['close'] >= prev_candle['open']:
            return None

        # BALANCED engulfing criteria
        current_body = abs(candle['close'] - candle['open'])
        prev_body = abs(prev_candle['close'] - prev_candle['open'])

        # Current candle must engulf previous
        if (candle['open'] <= prev_candle['close'] and
            candle['close'] >= prev_candle['open'] and
            current_body > prev_body * self.params.engulfing_ratio):

            # Check S/R proximity
            proximity_score = self.sr_system.get_proximity_score(candle['close'], 'bullish')

            return {
                'type': 'engulfing_bullish',
                'strength': 4,  # Highest strength
                'metadata': {
                    'body_ratio': current_body / prev_body,
                    'rsi_alignment': self.rsi[0] < 50,
                    'sr_proximity': proximity_score
                }
            }

        return None

    def _detect_engulfing_bearish(self, candle: Dict, prev_candle: Dict) -> Optional[Dict]:
        """BALANCED bearish engulfing detection"""
        # Current candle must be bearish
        if candle['close'] >= candle['open']:
            return None

        # Previous candle must be bullish
        if prev_candle['close'] <= prev_candle['open']:
            return None

        # BALANCED engulfing criteria
        current_body = abs(candle['close'] - candle['open'])
        prev_body = abs(prev_candle['close'] - prev_candle['open'])

        # Current candle must engulf previous
        if (candle['open'] >= prev_candle['close'] and
            candle['close'] <= prev_candle['open'] and
            current_body > prev_body * self.params.engulfing_ratio):

            # Check S/R proximity
            proximity_score = self.sr_system.get_proximity_score(candle['close'], 'bearish')

            return {
                'type': 'engulfing_bearish',
                'strength': 4,  # Highest strength
                'metadata': {
                    'body_ratio': current_body / prev_body,
                    'rsi_alignment': self.rsi[0] > 50,
                    'sr_proximity': proximity_score
                }
            }

        return None

    def _detect_double_red(self, candle: Dict, prev_candle: Dict, prev_prev_candle: Dict) -> Optional[Dict]:
        """BALANCED double red pattern detection"""
        # Check if previous two candles are bearish
        is_prev_bearish = prev_candle['close'] < prev_candle['open']
        is_prev_prev_bearish = prev_prev_candle['close'] < prev_prev_candle['open']

        # Signal: After two reds, expect bounce (CALL)
        if is_prev_bearish and is_prev_prev_bearish:
            # Check for reversal signal (current candle starting to bounce)
            current_body = abs(candle['close'] - candle['open'])
            prev_body = abs(prev_candle['close'] - prev_candle['open'])

            # If current shows reversal signs
            if current_body > 0:  # Has some movement
                # Check S/R proximity
                proximity_score = self.sr_system.get_proximity_score(candle['close'], 'bullish')

                return {
                    'type': 'double_red_bullish',  # Reversal signal
                    'strength': 2,
                    'metadata': {
                        'momentum': 'reversal',
                        'rsi_alignment': self.rsi[0] < 40,
                        'sr_proximity': proximity_score
                    }
                }

        return None

    def _detect_double_green(self, candle: Dict, prev_candle: Dict, prev_prev_candle: Dict) -> Optional[Dict]:
        """BALANCED double green pattern detection"""
        # Check if previous two candles are bullish
        is_prev_bullish = prev_candle['close'] > prev_candle['open']
        is_prev_prev_bullish = prev_prev_candle['close'] > prev_prev_candle['open']

        # Signal: After two greens, expect pullback (PUT)
        if is_prev_bullish and is_prev_prev_bullish:
            # Check for reversal signal (current candle starting to pullback)
            current_body = abs(candle['close'] - candle['open'])
            prev_body = abs(prev_candle['close'] - prev_candle['open'])

            # If current shows reversal signs
            if current_body > 0:  # Has some movement
                # Check S/R proximity
                proximity_score = self.sr_system.get_proximity_score(candle['close'], 'bearish')

                return {
                    'type': 'double_green_bearish',  # Reversal signal
                    'strength': 2,
                    'metadata': {
                        'momentum': 'reversal',
                        'rsi_alignment': self.rsi[0] > 60,
                        'sr_proximity': proximity_score
                    }
                }

        return None

    def _apply_balanced_trend_filter(self, candle: Dict, pattern: Dict) -> Dict:
        """Apply BALANCED trend filter - trend awareness but not blocking"""
        ema_value = self.ema[0]
        price = candle['close']

        # Check if price aligns with pattern direction
        is_bullish_pattern = 'bullish' in pattern['type']
        is_above_ema = price > ema_value

        # For bullish patterns, prefer price near/above EMA
        # For bearish patterns, prefer price near/below EMA
        alignment = (is_bullish_pattern and is_above_ema) or (not is_bullish_pattern and not is_above_ema)

        # More lenient - pass even if not perfect alignment
        passed = True  # Always pass, but note alignment

        return {
            'passed': passed,
            'reason': 'aligned_trend' if alignment else 'counter_trend',
            'proximity': 100 if alignment else 80
        }

    def _apply_balanced_vol_filter(self) -> Dict:
        """Apply BALANCED volatility filter - lower threshold"""
        current_atr = self.atr[0]
        previous_atr = self.atr[-1] if len(self.atr) > 1 else current_atr
        avg_atr = (current_atr + previous_atr) / 2

        # BALANCED volatility requirement - much lower threshold
        threshold = avg_atr * self.params.atr_multiplier
        passed = current_atr > threshold

        proximity = min(100, (current_atr / threshold) * 100) if threshold > 0 else 100

        return {
            'passed': passed,
            'reason': 'sufficient_volatility' if passed else 'low_volatility',
            'proximity': proximity
        }

    def _apply_balanced_rsi_filter(self, pattern: Dict) -> Dict:
        """Apply BALANCED RSI filter - bonus only, not blocking"""
        rsi_value = self.rsi[0]

        # Check RSI alignment with pattern
        is_bullish_pattern = 'bullish' in pattern['type']

        # Bonus if RSI aligns
        if is_bullish_pattern:
            bonus = rsi_value < self.params.rsi_oversold
        else:
            bonus = rsi_value > self.params.rsi_overbought

        return {
            'passed': bonus,  # Bonus only
            'reason': 'rsi_bonus' if bonus else 'rsi_neutral',
            'proximity': 100
        }

    def _calculate_confidence(self, strength: int, rsi_bonus: bool) -> float:
        """Calculate signal confidence"""
        base_confidence = self.params.min_confidence * strength
        rsi_confidence = 0.0015 if rsi_bonus else 0.0
        return base_confidence + rsi_confidence

    def _get_pattern_key(self, pattern_type: str) -> str:
        """Get pattern key for statistics"""
        if 'pin_bar' in pattern_type:
            return 'pin_bar'
        elif 'engulfing' in pattern_type:
            return 'engulfing'
        elif 'double_red' in pattern_type:
            return 'double_red'
        elif 'double_green' in pattern_type:
            return 'double_green'
        return 'unknown'

    def _is_in_cooldown(self) -> bool:
        """
        Check if strategy is in cooldown period (FUNCTIONAL)
        Prevents overtrading by enforcing minimum time between signals
        """
        if self.last_signal_time is None:
            return False

        current_time = self.datetime.datetime()
        time_diff = (current_time - self.last_signal_time).total_seconds()

        in_cooldown = time_diff < self.params.cooldown_seconds

        return in_cooldown

    def _execute_binary_trade(self, direction: str):
        """Execute binary trade with FUNCTIONAL Anti-Martingale"""
        # Calculate stake with Anti-Martingale
        stake = self._calculate_anti_martingale_stake()

        # Update stake amount
        self.params.stake_amount = stake

        # Track trade for Anti-Martingale with ENHANCED context
        trade_info = {
            'entry_time': self.datetime.datetime(),
            'direction': direction,
            'stake': stake,
            'result': None,  # Will be updated when expired
            'entry_price': self.data.close[0],
            # ENHANCED: Add signal context for analysis
            'pattern_type': self.current_signal_context.get('pattern_type', 'unknown'),
            'pattern_key': self.current_signal_context.get('pattern_key', 'unknown'),
            'strength': self.current_signal_context.get('strength', 0),
            'sr_proximity': self.current_signal_context.get('sr_proximity', 0),
            'rsi_value': self.current_signal_context.get('rsi_value', 50),
            'rsi_bonus': self.current_signal_context.get('rsi_bonus', False),
            'hour': self.current_signal_context.get('hour', 0),
            'trade_number': self.trades_executed + 1
        }
        self.pending_trades.append(trade_info)

        # Call parent method
        super()._execute_binary_trade(direction)

        self.trades_executed += 1

        print(f"💰 BALANCED TRADE #{self.trades_executed}: {direction}")
        print(f"   Stake: {stake:.2f}")
        print(f"   Win Streak: {self.win_streak} | Loss Streak: {self.loss_streak}")
        print(f"   Stake Multiplier: {self.stake_multiplier:.2f}x")
        print(f"   Pending Trades: {len(self.pending_trades)}")

    def _calculate_anti_martingale_stake(self) -> float:
        """Calculate stake using FUNCTIONAL Anti-Martingale system"""
        current_cash = self.broker.get_cash()
        base_stake = current_cash * self.params.base_stake_percentage

        # Start with base multiplier
        multiplier = 1.0

        # Apply win streak bonus
        if self.win_streak > 0:
            win_bonus = min(self.win_streak, self.params.max_win_streak_bonus) * self.params.win_streak_multiplier
            multiplier = 1.0 + win_bonus
            print(f"   💚 Win Streak Bonus: +{win_bonus*100:.0f}%")

        # Apply loss streak reduction
        elif self.loss_streak > 0:
            loss_penalty = min(self.loss_streak, self.params.max_consecutive_losses) * self.params.loss_streak_multiplier
            multiplier = max(0.2, 1.0 - loss_penalty)  # Min 20% of base
            print(f"   ❌ Loss Streak Penalty: -{loss_penalty*100:.0f}%")

        # Calculate final stake
        stake = base_stake * multiplier

        # Ensure minimum stake
        min_stake = max(current_cash * 0.001, 0.5)
        final_stake = max(stake, min_stake)

        # Update stake multiplier for tracking
        self.stake_multiplier = multiplier

        return final_stake

    def _check_expired_contracts(self):
        """FUNCTIONAL: Check and update Anti-Martingale state"""
        super()._check_expired_contracts()

        # Update pending trades results
        current_time = self.datetime.datetime()

        # Check which trades have expired (assuming 1-minute expiry)
        expired_trades = []
        for trade in self.pending_trades:
            time_diff = (current_time - trade['entry_time']).total_seconds()
            if time_diff >= 60:  # 1 minute = 60 seconds
                expired_trades.append(trade)

        # Process expired trades
        for trade in expired_trades:
            # Determine win/loss based on price movement
            # This is simplified - in reality, check actual contract result
            entry_price = trade['entry_price']
            current_price = self.data.close[0]

            if trade['direction'] == 'CALL':
                won = current_price > entry_price
            else:  # PUT
                won = current_price < entry_price

            # Update Anti-Martingale state
            if won:
                self.win_streak += 1
                self.loss_streak = 0
                profit = trade['stake'] * 0.95  # 95% payout
                self.accumulated_profit += profit
                print(f"✅ Trade WON! Win Streak: {self.win_streak}")
            else:
                self.loss_streak += 1
                self.win_streak = 0
                self.accumulated_profit -= trade['stake']
                print(f"❌ Trade LOST! Loss Streak: {self.loss_streak}")

            # Reset streak if max reached
            if self.win_streak >= self.params.max_win_streak_bonus:
                print(f"🔄 Win streak max reached! Resetting to maintain risk control.")
                self.win_streak = 0

            if self.loss_streak >= self.params.max_consecutive_losses:
                print(f"⚠️  Loss streak max reached! Consider reducing risk.")

            # Update pattern statistics
            # Note: We'd need to track pattern type in trade_info for accurate stats

            # Move to completed trades
            trade['result'] = 'won' if won else 'lost'
            self.completed_trades.append(trade)
            self.pending_trades.remove(trade)
            self.active_trades -= 1

    def get_statistics(self) -> Dict[str, Any]:
        """Get enhanced statistics"""
        stats = super().get_statistics()

        # Calculate pattern performance
        pattern_performance = {}
        for pattern_type, data in self.pattern_stats.items():
            if data['total'] > 0:
                win_rate = (data['won'] / data['total']) * 100 if data['total'] > 0 else 0
                pattern_performance[pattern_type] = {
                    'total': data['total'],
                    'won': data['won'],
                    'lost': data['lost'],
                    'win_rate': win_rate
                }

        # ENHANCED: Prepare detailed trade history for analysis
        detailed_trades = []
        for trade in self.completed_trades:
            detailed_trades.append({
                'timestamp': trade['entry_time'].isoformat() if isinstance(trade['entry_time'], datetime) else str(trade['entry_time']),
                'hour': trade.get('hour', 0),
                'direction': trade['direction'],
                'pattern_type': trade.get('pattern_type', 'unknown'),
                'pattern_key': trade.get('pattern_key', 'unknown'),
                'strength': trade.get('strength', 0),
                'sr_proximity': trade.get('sr_proximity', 0),
                'rsi_value': trade.get('rsi_value', 50),
                'rsi_bonus': trade.get('rsi_bonus', False),
                'stake': trade['stake'],
                'entry_price': trade['entry_price'],
                'result': trade['result'],
                'won': trade['result'] == 'won',
                'profit': trade['stake'] * 0.95 if trade['result'] == 'won' else -trade['stake']
            })

        # Add enhanced statistics
        stats.update({
            'signals_generated': self.signals_generated,
            'trades_executed': self.trades_executed,
            'signal_to_trade_ratio': (self.trades_executed / self.signals_generated * 100) if self.signals_generated > 0 else 0,
            'win_streak': self.win_streak,
            'loss_streak': self.loss_streak,
            'accumulated_profit': self.accumulated_profit,
            'stake_multiplier': self.stake_multiplier,
            'active_trades': self.active_trades,
            'pending_trades': len(self.pending_trades),
            'completed_trades': len(self.completed_trades),
            'detailed_trades': detailed_trades,  # ENHANCED: Full trade history
            'pattern_performance': pattern_performance
        })

        return stats

    def stop(self):
        """Enhanced stop method with detailed analysis"""
        stats = self.get_statistics()

        print("\n" + "="*70)
        print("🎯 BALANCED REVERSAL HUNTER STRATEGY RESULTS")
        print("="*70)
        print(f"Signals Generated: {stats['signals_generated']}")
        print(f"Trades Executed: {stats['trades_executed']}")
        print(f"Signal-to-Trade Ratio: {stats['signal_to_trade_ratio']:.1f}%")
        print(f"Total Trades: {stats['total_trades']}")
        print(f"Won Trades: {stats['won_trades']}")
        print(f"Lost Trades: {stats['lost_trades']}")
        print(f"Win Rate: {stats['win_rate']:.2f}%")
        print(f"Total Profit: {stats['total_profit']:.2f}")
        print(f"Final Balance: {self.broker.get_cash():.2f}")
        print(f"ROI: {stats.get('roi', 0):.2f}%")

        # Calculate trades per day
        if len(self.completed_trades) > 0:
            first_trade_time = self.completed_trades[0]['entry_time']
            last_trade_time = self.completed_trades[-1]['entry_time']
            duration_days = (last_trade_time - first_trade_time).total_seconds() / 86400
            trades_per_day = len(self.completed_trades) / duration_days if duration_days > 0 else 0
            print(f"Trades per Day: {trades_per_day:.2f}")

        print("\n📊 PATTERN PERFORMANCE:")
        print("-" * 40)
        if stats['pattern_performance']:
            for pattern_type, perf in stats['pattern_performance'].items():
                print(f"  {pattern_type:15s}: {perf['total']:3d} trades, {perf['win_rate']:5.1f}% win rate")
        else:
            print("  No pattern data available")

        print("\n🎯 ANTI-MARTINGALE SUMMARY:")
        print("-" * 40)
        print(f"Final Win Streak: {stats['win_streak']}")
        print(f"Final Loss Streak: {stats['loss_streak']}")
        print(f"Accumulated Profit: ${stats['accumulated_profit']:.2f}")
        print(f"Final Stake Multiplier: {stats['stake_multiplier']:.2f}x")
        print(f"Completed Trades: {stats['completed_trades']}")
        print(f"Pending Trades: {stats['pending_trades']}")
        print("="*70)
