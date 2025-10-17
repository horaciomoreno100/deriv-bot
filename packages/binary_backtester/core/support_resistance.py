"""
Dynamic Support and Resistance Detection System
Uses multiple methods to identify key price levels
"""

import backtrader as bt
import numpy as np
from typing import List, Dict, Tuple, Optional
from collections import defaultdict


class SupportResistance:
    """
    Advanced Support/Resistance detection system
    Uses multiple methods:
    1. Swing Highs/Lows
    2. Price Clustering
    3. Volume Profile (when available)
    4. Touch Count (strength metric)
    """

    def __init__(self, lookback_period: int = 100, proximity_threshold: float = 0.001):
        """
        Initialize S/R detection system

        Args:
            lookback_period: Number of candles to look back for S/R detection
            proximity_threshold: Price proximity threshold (0.001 = 0.1%)
        """
        self.lookback_period = lookback_period
        self.proximity_threshold = proximity_threshold
        self.support_levels = []
        self.resistance_levels = []
        self.level_strength = defaultdict(int)  # Touch count for each level

    def update(self, data: bt.DataBase, current_bar: int):
        """
        Update support and resistance levels based on recent price action

        Args:
            data: Backtrader data feed
            current_bar: Current bar index
        """
        # Calculate how many bars we can look back
        available_bars = min(current_bar, self.lookback_period)
        if available_bars < 10:  # Need minimum data
            return

        # Get price history
        highs = []
        lows = []
        closes = []

        for i in range(available_bars):
            idx = -i if i > 0 else 0
            highs.append(data.high[idx])
            lows.append(data.low[idx])
            closes.append(data.close[idx])

        # Detect swing highs and lows
        swing_highs = self._find_swing_highs(highs)
        swing_lows = self._find_swing_lows(lows)

        # Detect price clusters
        clustered_levels = self._find_price_clusters(closes)

        # Combine all levels
        resistance_candidates = swing_highs + [level for level in clustered_levels if level > closes[0]]
        support_candidates = swing_lows + [level for level in clustered_levels if level < closes[0]]

        # Merge similar levels and calculate strength
        self.resistance_levels = self._merge_similar_levels(resistance_candidates)
        self.support_levels = self._merge_similar_levels(support_candidates)

        # Sort by proximity to current price
        current_price = closes[0]
        self.resistance_levels.sort(key=lambda x: abs(x - current_price))
        self.support_levels.sort(key=lambda x: abs(x - current_price))

    def _find_swing_highs(self, highs: List[float], window: int = 5) -> List[float]:
        """
        Find swing highs (local maxima)

        Args:
            highs: List of high prices
            window: Window size for swing detection

        Returns:
            List of swing high prices
        """
        swing_highs = []

        for i in range(window, len(highs) - window):
            is_swing_high = True

            # Check if current high is higher than surrounding highs
            for j in range(1, window + 1):
                if highs[i] <= highs[i - j] or highs[i] <= highs[i + j]:
                    is_swing_high = False
                    break

            if is_swing_high:
                swing_highs.append(highs[i])

        return swing_highs

    def _find_swing_lows(self, lows: List[float], window: int = 5) -> List[float]:
        """
        Find swing lows (local minima)

        Args:
            lows: List of low prices
            window: Window size for swing detection

        Returns:
            List of swing low prices
        """
        swing_lows = []

        for i in range(window, len(lows) - window):
            is_swing_low = True

            # Check if current low is lower than surrounding lows
            for j in range(1, window + 1):
                if lows[i] >= lows[i - j] or lows[i] >= lows[i + j]:
                    is_swing_low = False
                    break

            if is_swing_low:
                swing_lows.append(lows[i])

        return swing_lows

    def _find_price_clusters(self, prices: List[float], num_clusters: int = 5) -> List[float]:
        """
        Find price levels where price has spent significant time (clustering)

        Args:
            prices: List of prices
            num_clusters: Number of cluster centers to find

        Returns:
            List of cluster center prices
        """
        if len(prices) < num_clusters:
            return []

        # Simple histogram-based clustering
        price_range = max(prices) - min(prices)
        if price_range == 0:
            return []

        # Create bins
        num_bins = min(50, len(prices) // 2)
        hist, bin_edges = np.histogram(prices, bins=num_bins)

        # Find peaks in histogram (price clusters)
        clusters = []
        for i in range(1, len(hist) - 1):
            if hist[i] > hist[i - 1] and hist[i] > hist[i + 1]:
                # Peak found, get price level (bin center)
                cluster_price = (bin_edges[i] + bin_edges[i + 1]) / 2
                clusters.append(cluster_price)

        # Return top clusters by frequency
        cluster_strengths = [(price, hist[i]) for i, price in enumerate(clusters[:len(hist) - 2])]
        cluster_strengths.sort(key=lambda x: x[1], reverse=True)

        return [price for price, _ in cluster_strengths[:num_clusters]]

    def _merge_similar_levels(self, levels: List[float]) -> List[float]:
        """
        Merge price levels that are too close together

        Args:
            levels: List of price levels

        Returns:
            List of merged price levels
        """
        if not levels:
            return []

        # Sort levels
        sorted_levels = sorted(levels)
        merged = [sorted_levels[0]]

        for level in sorted_levels[1:]:
            # Calculate proximity to last merged level
            proximity = abs(level - merged[-1]) / merged[-1]

            if proximity > self.proximity_threshold:
                # Level is far enough, add it
                merged.append(level)
            else:
                # Level is too close, merge by averaging
                merged[-1] = (merged[-1] + level) / 2

        return merged

    def get_nearest_support(self, current_price: float) -> Optional[Dict[str, float]]:
        """
        Get nearest support level below current price

        Args:
            current_price: Current price

        Returns:
            Dictionary with support level info or None
        """
        supports_below = [s for s in self.support_levels if s < current_price]

        if not supports_below:
            return None

        nearest = max(supports_below)  # Closest support below
        distance = current_price - nearest
        distance_pct = (distance / current_price) * 100

        return {
            'level': nearest,
            'distance': distance,
            'distance_pct': distance_pct,
            'strength': self._calculate_level_strength(nearest, self.support_levels)
        }

    def get_nearest_resistance(self, current_price: float) -> Optional[Dict[str, float]]:
        """
        Get nearest resistance level above current price

        Args:
            current_price: Current price

        Returns:
            Dictionary with resistance level info or None
        """
        resistances_above = [r for r in self.resistance_levels if r > current_price]

        if not resistances_above:
            return None

        nearest = min(resistances_above)  # Closest resistance above
        distance = nearest - current_price
        distance_pct = (distance / current_price) * 100

        return {
            'level': nearest,
            'distance': distance,
            'distance_pct': distance_pct,
            'strength': self._calculate_level_strength(nearest, self.resistance_levels)
        }

    def _calculate_level_strength(self, level: float, level_list: List[float]) -> int:
        """
        Calculate strength of a support/resistance level based on:
        - How many times price touched it
        - How many similar levels exist nearby

        Args:
            level: Price level
            level_list: List of all levels

        Returns:
            Strength score (1-5)
        """
        # Count similar levels nearby (within 2x proximity threshold)
        similar_count = 0
        for other_level in level_list:
            proximity = abs(level - other_level) / level
            if proximity <= self.proximity_threshold * 2:
                similar_count += 1

        # Map count to strength (1-5)
        if similar_count >= 5:
            return 5
        elif similar_count >= 4:
            return 4
        elif similar_count >= 3:
            return 3
        elif similar_count >= 2:
            return 2
        else:
            return 1

    def is_near_support(self, current_price: float, max_distance_pct: float = 0.5) -> bool:
        """
        Check if price is near a support level

        Args:
            current_price: Current price
            max_distance_pct: Maximum distance percentage (default 0.5%)

        Returns:
            True if near support
        """
        nearest = self.get_nearest_support(current_price)
        if not nearest:
            return False

        return nearest['distance_pct'] <= max_distance_pct

    def is_near_resistance(self, current_price: float, max_distance_pct: float = 0.5) -> bool:
        """
        Check if price is near a resistance level

        Args:
            current_price: Current price
            max_distance_pct: Maximum distance percentage (default 0.5%)

        Returns:
            True if near resistance
        """
        nearest = self.get_nearest_resistance(current_price)
        if not nearest:
            return False

        return nearest['distance_pct'] <= max_distance_pct

    def get_proximity_score(self, current_price: float, pattern_type: str) -> float:
        """
        Calculate a proximity score (0-100) based on how close price is to S/R

        Args:
            current_price: Current price
            pattern_type: 'bullish' or 'bearish'

        Returns:
            Score from 0-100 (higher = better proximity)
        """
        if 'bullish' in pattern_type.lower():
            # For bullish patterns, check proximity to support
            nearest = self.get_nearest_support(current_price)
            if not nearest:
                return 0

            # Score based on distance (closer = better)
            # 0.1% = 100, 0.5% = 50, 1% = 25, 2%+ = 0
            distance_pct = nearest['distance_pct']
            if distance_pct <= 0.1:
                score = 100
            elif distance_pct <= 0.5:
                score = 100 - (distance_pct - 0.1) * 125  # Linear interpolation
            elif distance_pct <= 1.0:
                score = 50 - (distance_pct - 0.5) * 50
            elif distance_pct <= 2.0:
                score = 25 - (distance_pct - 1.0) * 25
            else:
                score = 0

            # Bonus for strong support
            score *= (nearest['strength'] / 5)  # Multiply by strength factor

            return max(0, min(100, score))

        else:  # bearish
            # For bearish patterns, check proximity to resistance
            nearest = self.get_nearest_resistance(current_price)
            if not nearest:
                return 0

            # Score based on distance (closer = better)
            distance_pct = nearest['distance_pct']
            if distance_pct <= 0.1:
                score = 100
            elif distance_pct <= 0.5:
                score = 100 - (distance_pct - 0.1) * 125
            elif distance_pct <= 1.0:
                score = 50 - (distance_pct - 0.5) * 50
            elif distance_pct <= 2.0:
                score = 25 - (distance_pct - 1.0) * 25
            else:
                score = 0

            # Bonus for strong resistance
            score *= (nearest['strength'] / 5)

            return max(0, min(100, score))

    def get_all_levels(self) -> Dict[str, List[float]]:
        """
        Get all support and resistance levels

        Returns:
            Dictionary with support and resistance lists
        """
        return {
            'support': self.support_levels.copy(),
            'resistance': self.resistance_levels.copy()
        }

    def get_stats(self) -> Dict:
        """
        Get statistics about S/R levels

        Returns:
            Dictionary with S/R statistics
        """
        return {
            'num_support_levels': len(self.support_levels),
            'num_resistance_levels': len(self.resistance_levels),
            'total_levels': len(self.support_levels) + len(self.resistance_levels),
            'lookback_period': self.lookback_period,
            'proximity_threshold': self.proximity_threshold
        }
