"""
Harmonic Patterns Strategy V2 for Binary Options
Implementación fiel al código de TradingView usando el ZigZag simplificado

Strategy: [STRATEGY][RS]ZigZag PA Strategy V4.1
Author: Ricardo Santos (TradingView)
Adapted for: Binary Options Backtesting

Key Differences from V1:
- Simple ZigZag based on candle direction changes (not % deviation)
- Uses highest(2)/lowest(2) for pivot detection
- More frequent signals like TradingView version

Version: 2.0
Date: 2025-10-17
"""
import backtrader as bt
import numpy as np
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Tuple


class HarmonicPatternsStrategyV2(bt.Strategy):
    """
    Harmonic Patterns Strategy V2 - TradingView ZigZag Implementation
    """

    params = (
        # Fibonacci Levels (from TradingView)
        ('entry_fib_rate', 0.236),  # Entry window
        ('tp_fib_rate', 0.618),     # Take profit
        ('sl_fib_rate', -0.236),    # Stop loss

        # Pattern Selection
        ('enable_bat', True),
        ('enable_butterfly', True),
        ('enable_gartley', True),
        ('enable_crab', True),
        ('enable_shark', True),
        ('enable_abcd', True),
        ('enable_anti_patterns', True),
        ('enable_exotic', False),

        # Risk Management
        ('initial_cash', 1000.0),
        ('base_stake_pct', 0.01),
        ('max_stake_pct', 0.05),
        ('min_stake_pct', 0.001),

        # Trade Management
        ('expiry_minutes', 3),
        ('cooldown_minutes', 0),  # No cooldown like TradingView
        ('max_concurrent_trades', 10),

        # Logging
        ('verbose', True),
    )

    def __init__(self):
        """Initialize strategy"""

        # ZigZag tracking (simplified TradingView method)
        self.zigzag_values = []  # Store zigzag pivot values
        self.last_direction = None  # -1 for down, 1 for up

        # XABCD points (valuewhen equivalents)
        self.x = None
        self.a = None
        self.b = None
        self.c = None
        self.d = None

        # State tracking
        self.trades_executed = 0
        self.last_trade_time = None

        # Statistics (for custom tracking beyond analyzers)
        self.total_patterns_detected = 0

    def next(self):
        """Called for each candle"""

        # Calculate ZigZag (TradingView method)
        zigzag_value = self._calculate_zigzag()

        if zigzag_value is not None:
            self.zigzag_values.append(zigzag_value)
            # Keep only last 5 values for XABCD pattern
            if len(self.zigzag_values) > 5:
                self.zigzag_values.pop(0)

        # Check if we're in cooldown
        if self._in_cooldown():
            return

        # Check max concurrent trades (broker doesn't expose this, so we skip for now)
        # The broker will handle all pending contracts internally

        # Need at least 5 zigzag values for XABCD
        if len(self.zigzag_values) < 5:
            return

        # Update XABCD points
        self._update_xabcd_points()

        # Check for patterns
        signal = self._check_harmonic_patterns()

        if signal:
            self._execute_trade(signal)

    def _calculate_zigzag(self) -> Optional[float]:
        """
        Calculate ZigZag using TradingView's simplified method

        Pine code:
        _isUp = close >= open
        _isDown = close <= open
        _direction = _isUp[1] and _isDown ? -1 : _isDown[1] and _isUp ? 1 : nz(_direction[1])
        _zigzag = _isUp[1] and _isDown and _direction[1] != -1 ? highest(2) :
                  _isDown[1] and _isUp and _direction[1] != 1 ? lowest(2) : na
        """
        # Need at least 2 bars
        if len(self.data) < 2:
            return None

        # Current and previous candle
        is_up = self.data.close[0] >= self.data.open[0]
        is_down = self.data.close[0] <= self.data.open[0]

        is_up_prev = self.data.close[-1] >= self.data.open[-1]
        is_down_prev = self.data.close[-1] <= self.data.open[-1]

        # Determine direction
        if is_up_prev and is_down:
            new_direction = -1
        elif is_down_prev and is_up:
            new_direction = 1
        else:
            new_direction = self.last_direction

        # Calculate zigzag value
        zigzag = None

        # Pivot high: was up, now down, and direction wasn't already down
        if is_up_prev and is_down and self.last_direction != -1:
            # highest(2) = max of last 2 highs
            zigzag = max(self.data.high[0], self.data.high[-1])

        # Pivot low: was down, now up, and direction wasn't already up
        elif is_down_prev and is_up and self.last_direction != 1:
            # lowest(2) = min of last 2 lows
            zigzag = min(self.data.low[0], self.data.low[-1])

        self.last_direction = new_direction

        return zigzag

    def _update_xabcd_points(self):
        """Update XABCD points from last 5 zigzag values"""
        if len(self.zigzag_values) >= 5:
            # valuewhen(sz, sz, 4) = 5th from end
            # valuewhen(sz, sz, 3) = 4th from end
            # valuewhen(sz, sz, 2) = 3rd from end
            # valuewhen(sz, sz, 1) = 2nd from end
            # valuewhen(sz, sz, 0) = 1st from end (most recent)
            self.x = self.zigzag_values[-5]
            self.a = self.zigzag_values[-4]
            self.b = self.zigzag_values[-3]
            self.c = self.zigzag_values[-2]
            self.d = self.zigzag_values[-1]

    def _check_harmonic_patterns(self) -> Optional[Dict]:
        """Check for harmonic patterns"""
        if None in [self.x, self.a, self.b, self.c, self.d]:
            return None

        # Calculate Fibonacci ratios (exact TradingView formulas)
        xab = abs(self.b - self.a) / abs(self.x - self.a) if abs(self.x - self.a) > 0 else 0
        xad = abs(self.a - self.d) / abs(self.x - self.a) if abs(self.x - self.a) > 0 else 0
        abc = abs(self.b - self.c) / abs(self.a - self.b) if abs(self.a - self.b) > 0 else 0
        bcd = abs(self.c - self.d) / abs(self.b - self.c) if abs(self.b - self.c) > 0 else 0

        # Mode: 1 for bullish (d < c), -1 for bearish (d > c)
        mode = 1 if self.d < self.c else -1

        # Check patterns
        pattern_name = None

        if self.params.enable_abcd and self._is_abcd(abc, bcd, mode):
            pattern_name = "ABCD"
        elif self.params.enable_bat and self._is_bat(xab, abc, bcd, xad, mode):
            pattern_name = "Bat"
        elif self.params.enable_butterfly and self._is_butterfly(xab, abc, bcd, xad, mode):
            pattern_name = "Butterfly"
        elif self.params.enable_gartley and self._is_gartley(xab, abc, bcd, xad, mode):
            pattern_name = "Gartley"
        elif self.params.enable_crab and self._is_crab(xab, abc, bcd, xad, mode):
            pattern_name = "Crab"
        elif self.params.enable_shark and self._is_shark(xab, abc, bcd, xad, mode):
            pattern_name = "Shark"
        elif self.params.enable_anti_patterns:
            if self._is_anti_bat(xab, abc, bcd, xad, mode):
                pattern_name = "Anti-Bat"
            elif self._is_anti_butterfly(xab, abc, bcd, xad, mode):
                pattern_name = "Anti-Butterfly"
            elif self._is_anti_gartley(xab, abc, bcd, xad, mode):
                pattern_name = "Anti-Gartley"
            elif self._is_anti_crab(xab, abc, bcd, xad, mode):
                pattern_name = "Anti-Crab"
            elif self._is_anti_shark(xab, abc, bcd, xad, mode):
                pattern_name = "Anti-Shark"

        if not pattern_name:
            return None

        # Calculate Fibonacci levels (exact TradingView formula)
        fib_range = abs(self.d - self.c)

        if self.d > self.c:  # Bearish
            fib_entry = self.d - (fib_range * self.params.entry_fib_rate)
            fib_tp = self.d - (fib_range * self.params.tp_fib_rate)
            fib_sl = self.d - (fib_range * self.params.sl_fib_rate)
        else:  # Bullish
            fib_entry = self.d + (fib_range * self.params.entry_fib_rate)
            fib_tp = self.d + (fib_range * self.params.tp_fib_rate)
            fib_sl = self.d + (fib_range * self.params.sl_fib_rate)

        current_price = self.data.close[0]

        # TradingView entry conditions:
        # buy: close <= f_last_fib(entry_rate)
        # sell: close >= f_last_fib(entry_rate)

        if mode == 1:  # Bullish -> CALL
            if current_price <= fib_entry:
                return {
                    'direction': 'CALL',
                    'pattern_name': f"Bull {pattern_name}",
                    'mode': mode,
                    'ratios': {'xab': xab, 'abc': abc, 'bcd': bcd, 'xad': xad},
                    'fib_entry': fib_entry,
                    'fib_tp': fib_tp,
                    'fib_sl': fib_sl,
                    'current_price': current_price,
                    'points': {'x': self.x, 'a': self.a, 'b': self.b, 'c': self.c, 'd': self.d}
                }
        else:  # Bearish -> PUT
            if current_price >= fib_entry:
                return {
                    'direction': 'PUT',
                    'pattern_name': f"Bear {pattern_name}",
                    'mode': mode,
                    'ratios': {'xab': xab, 'abc': abc, 'bcd': bcd, 'xad': xad},
                    'fib_entry': fib_entry,
                    'fib_tp': fib_tp,
                    'fib_sl': fib_sl,
                    'current_price': current_price,
                    'points': {'x': self.x, 'a': self.a, 'b': self.b, 'c': self.c, 'd': self.d}
                }

        return None

    # Pattern detection (same as V1)
    def _is_abcd(self, abc: float, bcd: float, mode: int) -> bool:
        return (0.382 <= abc <= 0.886 and 1.13 <= bcd <= 2.618)

    def _is_bat(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.382 <= xab <= 0.5 and 0.382 <= abc <= 0.886 and
                1.618 <= bcd <= 2.618 and 0.618 <= xad <= 1.0)

    def _is_anti_bat(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.5 <= xab <= 0.886 and 1.0 <= abc <= 2.618 and
                1.618 <= bcd <= 2.618 and 0.886 <= xad <= 1.0)

    def _is_butterfly(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (xab <= 0.786 and 0.382 <= abc <= 0.886 and
                1.618 <= bcd <= 2.618 and 1.27 <= xad <= 1.618)

    def _is_anti_butterfly(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.236 <= xab <= 0.886 and 1.13 <= abc <= 2.618 and
                1.0 <= bcd <= 1.382 and 0.5 <= xad <= 0.886)

    def _is_gartley(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.5 <= xab <= 0.618 and 0.382 <= abc <= 0.886 and
                1.13 <= bcd <= 2.618 and 0.75 <= xad <= 0.875)

    def _is_anti_gartley(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.5 <= xab <= 0.886 and 1.0 <= abc <= 2.618 and
                1.5 <= bcd <= 5.0 and 1.0 <= xad <= 5.0)

    def _is_crab(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.5 <= xab <= 0.875 and 0.382 <= abc <= 0.886 and
                2.0 <= bcd <= 5.0 and 1.382 <= xad <= 5.0)

    def _is_anti_crab(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.25 <= xab <= 0.5 and 1.13 <= abc <= 2.618 and
                1.618 <= bcd <= 2.618 and 0.5 <= xad <= 0.75)

    def _is_shark(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.5 <= xab <= 0.875 and 1.13 <= abc <= 1.618 and
                1.27 <= bcd <= 2.24 and 0.886 <= xad <= 1.13)

    def _is_anti_shark(self, xab: float, abc: float, bcd: float, xad: float, mode: int) -> bool:
        return (0.382 <= xab <= 0.875 and 0.5 <= abc <= 1.0 and
                1.25 <= bcd <= 2.618 and 0.5 <= xad <= 1.25)

    def _execute_trade(self, signal: Dict):
        """Execute trade using broker's buy()/sell() interface"""
        current_cash = self.broker.get_cash()
        stake = current_cash * self.params.base_stake_pct
        stake = max(current_cash * self.params.min_stake_pct,
                   min(stake, current_cash * self.params.max_stake_pct))

        # Use broker interface - no manual tracking needed
        if signal['direction'] == 'CALL':
            self.buy(size=stake)
        else:
            self.sell(size=stake)

        self.trades_executed += 1
        self.total_patterns_detected += 1
        self.last_trade_time = self.datetime.datetime()

        if self.params.verbose:
            self._log_trade_entry(signal, stake)

    def notify_order(self, order):
        """Called when order status changes"""
        if order.status == order.Completed:
            direction = 'CALL' if order.isbuy else 'PUT'
            if self.params.verbose:
                print(f'   ✓ {direction} EXECUTED @ {order.executed.price:.5f}, stake=${order.size:.2f}')

    def notify_trade(self, trade):
        """Called when trade closes (contract expires)"""
        if trade.isclosed:
            won = trade.pnl > 0
            if self.params.verbose:
                emoji = "✅" if won else "❌"
                print(f'{emoji} TRADE RESULT: P/L=${trade.pnl:.2f}')

    def _in_cooldown(self) -> bool:
        if self.last_trade_time is None or self.params.cooldown_minutes == 0:
            return False
        cooldown_delta = timedelta(minutes=self.params.cooldown_minutes)
        return (self.datetime.datetime() - self.last_trade_time) < cooldown_delta

    def _log_trade_entry(self, signal: Dict, stake: float):
        """Log trade entry details"""
        print(f"\n🎯 HARMONIC #{self.trades_executed}: {signal['direction']} - {signal['pattern_name']}")
        print(f"   Entry: {self.data.close[0]:.2f} | Expiry: {self.params.expiry_minutes}m | Stake: ${stake:.2f}")
        print(f"   Ratios: XAB={signal['ratios']['xab']:.3f} ABC={signal['ratios']['abc']:.3f} "
              f"BCD={signal['ratios']['bcd']:.3f} XAD={signal['ratios']['xad']:.3f}")

    def get_statistics(self) -> Dict:
        """Get statistics (minimal - analyzers will provide detailed stats)"""
        return {
            'total_patterns_detected': self.total_patterns_detected,
            'trades_executed': self.trades_executed
        }

    def stop(self):
        """Called when backtest ends - broker analyzers provide full stats"""
        if self.params.verbose:
            print("\n" + "=" * 70)
            print("🎯 HARMONIC PATTERNS V2 - FINAL STATISTICS")
            print("=" * 70)
            print(f"\n✅ Total Patterns Detected: {self.total_patterns_detected}")
            print(f"✅ Trades Executed: {self.trades_executed}")
            print(f"✅ Final Cash: ${self.broker.get_cash():.2f}")
            print("\n" + "=" * 70)
            print("Note: Use Backtrader analyzers for detailed trade statistics")
            print("=" * 70)
