"""
Pivot Reversal Strategy with Anti-Martingale
Ported from TradingView Pine Script to Python/Backtrader

Strategy Logic:
- Detects potential pivot lows/highs in real-time (no lag)
- Confirms with candlestick reversal patterns
- Uses Anti-Martingale money management (reduce on loss, reset on win)
- Optimized for 1-minute expiry binary options

Win Rate: ~49-50% (from TradingView backtest)
Profit Factor: 1.049
"""

import backtrader as bt
from typing import Optional
from datetime import timedelta


class PivotReversalStrategy(bt.Strategy):
    """
    Pivot Reversal Strategy for Binary Options
    """

    params = (
        ('symbol', 'R_75'),
        ('expiration_time', 1),  # 1 minute expiry
        ('stake_amount', 10.0),
        ('payout_rate', 0.80),
        ('left_bars', 5),  # Number of bars to check for pivot (increased for stricter pivots)
        ('max_loss_streak', 2),  # Reset after 2 consecutive losses
        ('cooldown_seconds', 60),  # 1 minute cooldown (1 trade per candle)
        ('min_pivot_diff_pct', 0.1),  # Min % diff of low/high for significant pivot (vs ATR)
        ('min_atr_threshold', 50.0),  # Min ATR value to trade (adjusted for R_75 scale ~100k)
        ('trend_ema_fast', 20),  # Fast EMA for trend
        ('trend_ema_slow', 50),  # Slow EMA for trend
    )

    def __init__(self, **kwargs):
        # Remove unexpected kwargs before calling super().__init__()
        kwargs.pop('initial_cash', None)
        super().__init__()

        # State tracking
        self.trades_executed = 0
        self.last_trade_time = None

        # Statistics tracking
        self.call_signals = 0
        self.put_signals = 0

        # Technical indicators for filtering
        self.atr = bt.indicators.ATR(self.data, period=14)
        self.ema_fast = bt.indicators.EMA(self.data.close, period=self.params.trend_ema_fast)
        self.ema_slow = bt.indicators.EMA(self.data.close, period=self.params.trend_ema_slow)

        print(f"🚀 Pivot Reversal Strategy Initialized (FILTERED - FIXED STAKE)")
        print(f"   Left Bars: {self.params.left_bars} (stricter)")
        print(f"   Expiry: {self.params.expiration_time} minute")
        print(f"   Fixed Stake: ${self.params.stake_amount} (anti-martingale disabled)")
        print(f"   Payout Rate: {self.params.payout_rate * 100}%")
        print(f"   Cooldown: {self.params.cooldown_seconds} seconds")
        print(f"   Filters:")
        print(f"     ├─ Min Pivot Diff: {self.params.min_pivot_diff_pct * 100}% of ATR")
        print(f"     ├─ Min ATR: {self.params.min_atr_threshold}")
        print(f"     └─ Trend EMAs: {self.params.trend_ema_fast}/{self.params.trend_ema_slow}")

    def next(self):
        """Main strategy logic"""
        # Check cooldown
        if self._in_cooldown():
            return

        # Generate signal
        signal = self.generate_signal()

        if signal:
            self._execute_trade(signal)

    def generate_signal(self) -> Optional[str]:
        """
        Generate trading signal with multiple filters to reduce noise
        Returns: 'CALL', 'PUT', or None
        """
        # Need enough bars for indicators
        min_bars = max(self.params.left_bars + 2, self.params.trend_ema_slow + 1)
        if len(self) < min_bars:
            return None

        # Filter 1: ATR threshold - skip low volatility periods
        atr_value = self.atr[0]
        if atr_value < self.params.min_atr_threshold:
            return None

        # Filter 2: Trend direction
        is_uptrend = self.ema_fast[0] > self.ema_slow[0]

        # Stricter pivot detection
        is_potential_pivot_low = self._is_potential_pivot_low()
        is_potential_pivot_high = self._is_potential_pivot_high()

        # Reversal patterns
        is_bullish_reversal = self._is_bullish_reversal()
        is_bearish_reversal = self._is_bearish_reversal()

        # Filter 3: Minimum pivot significance (price difference vs ATR)
        current_low = self.data.low[0]
        prev_low = min(self.data.low[-1], self.data.close[-1])
        pivot_diff_low = abs(current_low - prev_low) / atr_value if atr_value > 0 else 0

        current_high = self.data.high[0]
        prev_high = max(self.data.high[-1], self.data.close[-1])
        pivot_diff_high = abs(current_high - prev_high) / atr_value if atr_value > 0 else 0

        # CALL Signal: Pivot low + bullish reversal + min diff + uptrend
        if (is_potential_pivot_low and is_bullish_reversal and
            pivot_diff_low > self.params.min_pivot_diff_pct and
            is_uptrend):
            return 'CALL'

        # PUT Signal: Pivot high + bearish reversal + min diff + downtrend
        if (is_potential_pivot_high and is_bearish_reversal and
            pivot_diff_high > self.params.min_pivot_diff_pct and
            not is_uptrend):
            return 'PUT'

        return None

    def _is_potential_pivot_low(self) -> bool:
        """
        Stricter pivot low: Current low is lowest of last N bars
        AND previous bar was also a local low (mini-confirmation without lag)
        """
        current_low = self.data.low[0]
        prev_low = self.data.low[-1]
        lookback = self.params.left_bars

        # Current bar must be lowest of lookback period
        for i in range(1, lookback + 1):
            if self.data.low[-i] < current_low:
                return False

        # Previous bar should also be a local low (mini-confirmation)
        # This reduces false signals in choppy markets
        for i in range(2, min(lookback, 4) + 1):  # Check 2-3 bars before prev
            if self.data.low[-i] < prev_low:
                return False

        return True

    def _is_potential_pivot_high(self) -> bool:
        """
        Stricter pivot high: Current high is highest of last N bars
        AND previous bar was also a local high (mini-confirmation without lag)
        """
        current_high = self.data.high[0]
        prev_high = self.data.high[-1]
        lookback = self.params.left_bars

        # Current bar must be highest of lookback period
        for i in range(1, lookback + 1):
            if self.data.high[-i] > current_high:
                return False

        # Previous bar should also be a local high (mini-confirmation)
        for i in range(2, min(lookback, 4) + 1):  # Check 2-3 bars before prev
            if self.data.high[-i] > prev_high:
                return False

        return True

    def _is_bullish_reversal(self) -> bool:
        """
        Detect bullish reversal pattern: Green candle after red candle
        """
        current_close = self.data.close[0]
        current_open = self.data.open[0]
        prev_close = self.data.close[-1]
        prev_open = self.data.open[-1]

        is_current_green = current_close > current_open
        is_prev_red = prev_close < prev_open

        return is_current_green and is_prev_red

    def _is_bearish_reversal(self) -> bool:
        """
        Detect bearish reversal pattern: Red candle after green candle
        """
        current_close = self.data.close[0]
        current_open = self.data.open[0]
        prev_close = self.data.close[-1]
        prev_open = self.data.open[-1]

        is_current_red = current_close < current_open
        is_prev_green = prev_close > prev_open

        return is_current_red and is_prev_green

    def _execute_trade(self, direction: str):
        """Execute trade using broker's buy()/sell() interface"""
        stake = self.params.stake_amount

        # Get filter values for logging
        atr_value = self.atr[0]
        trend = "UP" if self.ema_fast[0] > self.ema_slow[0] else "DOWN"

        # Count and log signal ONLY when actually executing trade
        if direction == 'CALL':
            self.call_signals += 1
            print(f"   📈 CALL #{self.call_signals} - Filtered Pivot Low")
            self.buy(size=stake)
        else:
            self.put_signals += 1
            print(f"   📉 PUT #{self.put_signals} - Filtered Pivot High")
            self.sell(size=stake)

        print(f"      Price: {self.data.close[0]:.2f} | Stake: ${stake:.2f} (FIXED) | ATR: {atr_value:.2f} | Trend: {trend}")

        self.trades_executed += 1
        self.last_trade_time = self.datetime.datetime()

    def notify_order(self, order):
        """Called when order status changes"""
        if order.status == order.Completed:
            direction = 'CALL' if order.isbuy else 'PUT'
            print(f'   ✓ {direction} EXECUTED @ {order.executed.price:.5f}, stake=${order.size:.2f}')

    def notify_trade(self, trade):
        """Called when trade closes (contract expires)"""
        if trade.isclosed:
            won = trade.pnl > 0
            emoji = "✅" if won else "❌"
            status = "WON" if won else "LOST"
            print(f'{emoji} {status} ${abs(trade.pnl):.2f} | Balance: ${self.broker.get_cash():.2f}')

    def _in_cooldown(self) -> bool:
        """Check if we're in cooldown period"""
        if self.last_trade_time is None:
            return False

        current_time = self.datetime.datetime()
        time_diff = (current_time - self.last_trade_time).total_seconds()

        return time_diff < self.params.cooldown_seconds

    def stop(self):
        """Called when backtest ends - broker analyzers provide full stats"""
        print("\n" + "="*60)
        print("📊 PIVOT REVERSAL STRATEGY RESULTS (FIXED STAKE)")
        print("="*60)
        print(f"Trades Executed: {self.trades_executed}")
        print(f"  ├─ CALL Signals: {self.call_signals}")
        print(f"  └─ PUT Signals: {self.put_signals}")
        print(f"")
        print(f"Final Balance: ${self.broker.get_cash():.2f}")
        print(f"Fixed Stake: ${self.params.stake_amount:.2f}")
        print("="*60)
        print("Note: Use Backtrader analyzers for detailed trade statistics")
        print("="*60)
