"""
TA-Lib Pattern Detection
Industry-standard candlestick pattern detection using TA-Lib library
"""

import talib
import numpy as np
from typing import Optional, Dict, List
from scipy.signal import find_peaks


class TALibPatternDetector:
    """
    Candlestick pattern detection using TA-Lib

    Returns patterns in same format as our manual implementation
    for easy comparison
    """

    def __init__(self):
        self.last_patterns = {}

    def detect_patterns(self, opens, highs, lows, closes) -> List[Dict]:
        """
        Detect all patterns using TA-Lib

        Args:
            opens, highs, lows, closes: numpy arrays of OHLC data

        Returns:
            List of detected patterns with metadata
        """
        patterns = []

        # Convert to numpy arrays if needed
        opens = np.array(opens)
        highs = np.array(highs)
        lows = np.array(lows)
        closes = np.array(closes)

        # Need at least 2 candles for patterns
        if len(closes) < 2:
            return patterns

        # Get current candle index
        current_idx = -1

        # === PIN BAR PATTERNS ===

        # Bullish Pin Bar (Hammer)
        hammer = talib.CDLHAMMER(opens, highs, lows, closes)
        if hammer[current_idx] == 100:
            patterns.append({
                'type': 'pin_bar_bullish',
                'strength': 3,
                'source': 'talib_hammer',
                'metadata': {}
            })

        # Bearish Pin Bar (Hanging Man)
        hanging_man = talib.CDLHANGINGMAN(opens, highs, lows, closes)
        if hanging_man[current_idx] == -100:
            patterns.append({
                'type': 'pin_bar_bearish',
                'strength': 3,
                'source': 'talib_hangingman',
                'metadata': {}
            })

        # Bearish Pin Bar (Shooting Star)
        shooting_star = talib.CDLSHOOTINGSTAR(opens, highs, lows, closes)
        if shooting_star[current_idx] == -100:
            patterns.append({
                'type': 'pin_bar_bearish',
                'strength': 3,
                'source': 'talib_shootingstar',
                'metadata': {}
            })

        # === ENGULFING PATTERNS ===

        engulfing = talib.CDLENGULFING(opens, highs, lows, closes)
        if engulfing[current_idx] == 100:
            patterns.append({
                'type': 'engulfing_bullish',
                'strength': 4,
                'source': 'talib_engulfing',
                'metadata': {}
            })
        elif engulfing[current_idx] == -100:
            patterns.append({
                'type': 'engulfing_bearish',
                'strength': 4,
                'source': 'talib_engulfing',
                'metadata': {}
            })

        # === ADDITIONAL REVERSAL PATTERNS ===

        # Morning Star (Bullish reversal - 3 candle pattern)
        morning_star = talib.CDLMORNINGSTAR(opens, highs, lows, closes)
        if morning_star[current_idx] == 100:
            patterns.append({
                'type': 'morning_star_bullish',
                'strength': 4,
                'source': 'talib_morningstar',
                'metadata': {}
            })

        # Evening Star (Bearish reversal - 3 candle pattern)
        evening_star = talib.CDLEVENINGSTAR(opens, highs, lows, closes)
        if evening_star[current_idx] == -100:
            patterns.append({
                'type': 'evening_star_bearish',
                'strength': 4,
                'source': 'talib_eveningstar',
                'metadata': {}
            })

        # Dark Cloud Cover (Bearish reversal)
        dark_cloud = talib.CDLDARKCLOUDCOVER(opens, highs, lows, closes)
        if dark_cloud[current_idx] == -100:
            patterns.append({
                'type': 'dark_cloud_bearish',
                'strength': 3,
                'source': 'talib_darkcloud',
                'metadata': {}
            })

        # Piercing Line (Bullish reversal)
        piercing = talib.CDLPIERCING(opens, highs, lows, closes)
        if piercing[current_idx] == 100:
            patterns.append({
                'type': 'piercing_bullish',
                'strength': 3,
                'source': 'talib_piercing',
                'metadata': {}
            })

        return patterns


class ScipySupportResistance:
    """
    Support/Resistance detection using scipy.signal.find_peaks

    More robust than manual swing point detection
    """

    def __init__(self, lookback_period: int = 100, proximity_threshold: float = 0.005):
        self.lookback_period = lookback_period
        self.proximity_threshold = proximity_threshold
        self.resistance_levels = []
        self.support_levels = []

    def update(self, highs: np.ndarray, lows: np.ndarray):
        """
        Update support and resistance levels using scipy peak detection

        Args:
            highs: Array of high prices
            lows: Array of low prices
        """
        # Use last N candles
        if len(highs) > self.lookback_period:
            highs = highs[-self.lookback_period:]
            lows = lows[-self.lookback_period:]

        # Calculate dynamic thresholds based on volatility
        high_std = np.std(highs)
        low_std = np.std(lows)

        # Find resistance levels (peaks in highs)
        resistance_indices, resistance_props = find_peaks(
            highs,
            distance=5,  # Minimum 5 candles between peaks
            prominence=high_std * 0.3,  # Peak must be significant
            width=1  # Minimum width
        )

        # Find support levels (peaks in inverted lows)
        support_indices, support_props = find_peaks(
            -lows,
            distance=5,
            prominence=low_std * 0.3,
            width=1
        )

        # Extract levels
        if len(resistance_indices) > 0:
            self.resistance_levels = highs[resistance_indices].tolist()
        else:
            self.resistance_levels = []

        if len(support_indices) > 0:
            self.support_levels = lows[support_indices].tolist()
        else:
            self.support_levels = []

        # Cluster nearby levels (within 0.2%)
        self.resistance_levels = self._cluster_levels(self.resistance_levels)
        self.support_levels = self._cluster_levels(self.support_levels)

    def _cluster_levels(self, levels: List[float], threshold: float = 0.002) -> List[float]:
        """Cluster nearby levels to reduce noise"""
        if not levels:
            return []

        levels = sorted(levels)
        clustered = [levels[0]]

        for level in levels[1:]:
            # If far from last clustered level, add it
            if abs(level - clustered[-1]) / clustered[-1] > threshold:
                clustered.append(level)
            else:
                # Otherwise, average with last level
                clustered[-1] = (clustered[-1] + level) / 2

        return clustered

    def get_proximity_score(self, current_price: float, pattern_type: str) -> float:
        """
        Calculate proximity score (0-100) based on distance to nearest S/R level

        Args:
            current_price: Current market price
            pattern_type: 'bullish' or 'bearish' pattern

        Returns:
            Proximity score (0-100), higher = closer to S/R
        """
        is_bullish = 'bullish' in pattern_type

        # For bullish patterns, check proximity to support
        # For bearish patterns, check proximity to resistance
        relevant_levels = self.support_levels if is_bullish else self.resistance_levels

        if not relevant_levels:
            return 0

        # Find nearest level
        distances = [abs(current_price - level) / current_price for level in relevant_levels]
        min_distance = min(distances)

        # Convert distance to score (0-100)
        # 0.1% distance = 100 score
        # 0.5% distance = 50 score
        # 1.0% distance = 25 score
        # 2.0%+ distance = 0 score

        if min_distance < 0.001:  # < 0.1%
            score = 100
        elif min_distance < 0.005:  # < 0.5%
            score = 100 - (min_distance - 0.001) * 20000
        elif min_distance < 0.01:  # < 1.0%
            score = 50 - (min_distance - 0.005) * 5000
        elif min_distance < 0.02:  # < 2.0%
            score = 25 - (min_distance - 0.01) * 2500
        else:
            score = 0

        return max(0, min(100, score))

    def get_levels(self) -> Dict[str, List[float]]:
        """Get current support and resistance levels"""
        return {
            'support': self.support_levels,
            'resistance': self.resistance_levels
        }
