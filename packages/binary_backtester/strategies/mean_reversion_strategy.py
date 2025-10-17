"""
Mean Reversion Strategy for Binary Options (BASELINE V2 - Optimized)
Strategy: Exploits R_75's controlled volatility using Bollinger Bands + RSI extremes

Entry Rules:
- CALL: RSI < 18 AND close < BB Lower Band (oversold)
- PUT: RSI > 82 AND close > BB Upper Band (overbought)

Filters:
- ATR > average (avoid dead zones with low volatility)
- Cooldown: 2 minutes between trades
- Max concurrent trades: 3

Risk Management:
- Base stake: 1%
- Strength-based: 1 (RSI only) or 2 (RSI + BB touch)
- Progressive Anti-Martingale: Win cycle adds profit, loss cycle halves stake
- Reset after 2 wins or 3 losses

Performance (90 days backtest):
- Win Rate: 58.02%
- ROI: 30.99%
- Total Profit: $309.87
- Trades: 262

Version: 2.0 (Optimized)
Date: 2025-10-16
"""
import backtrader as bt
import numpy as np
from datetime import datetime, timedelta
from typing import Optional, Dict, List


class MeanReversionStrategy(bt.Strategy):
    """
    Mean Reversion Strategy using Bollinger Bands and RSI
    Designed for R_75 (Volatility 75 Index) 1-minute timeframe
    """

    params = (
        # Bollinger Bands
        ('bb_period', 20),
        ('bb_std_dev', 2.0),

        # RSI
        ('rsi_period', 14),
        ('rsi_oversold', 17),  # TEST #5: Even tighter threshold (was 18)
        ('rsi_overbought', 83),  # TEST #5: Even tighter threshold (was 82)

        # ATR Filter
        ('atr_period', 14),
        ('atr_multiplier', 1.0),  # BASELINE V2: Standard filter (1.2x over-filtered)

        # Risk Management
        ('initial_cash', 1000.0),
        ('base_stake_pct', 0.01),  # 1% of cash
        ('max_stake_pct', 0.05),  # Max 5%
        ('min_stake_pct', 0.001),  # Min 0.1%

        # Anti-Martingale (Progressive Cycles)
        ('win_multiplier', 1.2),  # Not used in progressive mode
        ('loss_multiplier', 0.5),  # Not used in progressive mode
        ('max_win_streak', 2),  # Reset after 2 wins (more conservative)
        ('max_loss_streak', 3),  # Reset after 3 losses

        # Trade Management
        ('expiry_minutes', 3),  # BASELINE: 3 minutes
        ('cooldown_minutes', 2),  # BASELINE V2: 2-minute cooldown
        ('max_concurrent_trades', 3),  # Baseline

        # Logging
        ('verbose', True),
    )

    def __init__(self):
        """Initialize strategy indicators and state"""

        # Indicators
        self.bb = bt.indicators.BollingerBands(
            self.data.close,
            period=self.params.bb_period,
            devfactor=self.params.bb_std_dev
        )
        self.rsi = bt.indicators.RSI(
            self.data.close,
            period=self.params.rsi_period
        )
        self.atr = bt.indicators.ATR(
            self.data,
            period=self.params.atr_period
        )

        # ATR average (for filtering)
        self.atr_avg = bt.indicators.SMA(self.atr, period=50)

        # State tracking
        self.trades_executed = 0
        self.pending_trades = []
        self.completed_trades = []

        # Anti-Martingale state (progressive cycles)
        self.win_streak = 0
        self.loss_streak = 0
        self.current_stake = None  # Will be set to base stake on first trade
        self.last_profit = 0.0  # Track last trade profit for progressive staking

        # Cooldown tracking
        self.last_trade_time = None

        # Statistics
        self.total_profit = 0.0
        self.wins = 0
        self.losses = 0

    def next(self):
        """Called for each new candle"""

        # Check if we're in cooldown
        if self._in_cooldown():
            return

        # Check if we have max concurrent trades
        if len(self.pending_trades) >= self.params.max_concurrent_trades:
            return

        # Update pending trades (check expiry)
        self._update_pending_trades()

        # Check for signal
        signal = self._check_signal()

        if signal:
            self._execute_trade(signal)

    def _check_signal(self) -> Optional[Dict]:
        """
        Check for mean reversion signal

        Returns:
            Dict with 'direction' and 'strength', or None
        """
        # Need enough data for indicators
        if len(self.data) < max(self.params.bb_period, self.params.rsi_period, self.params.atr_period):
            return None

        current_price = self.data.close[0]
        rsi_value = self.rsi[0]
        bb_upper = self.bb.lines.top[0]
        bb_lower = self.bb.lines.bot[0]
        bb_middle = self.bb.lines.mid[0]
        atr_value = self.atr[0]
        atr_avg_value = self.atr_avg[0]

        # ATR Filter: Only trade when volatility is sufficient
        if atr_value < atr_avg_value * self.params.atr_multiplier:
            return None

        signal = None
        strength = 0

        # CALL Signal: Oversold (RSI < 20) + Below BB Lower
        if rsi_value < self.params.rsi_oversold:
            strength = 1

            if current_price < bb_lower:
                strength = 2  # Stronger signal (both conditions met)

            signal = {
                'direction': 'CALL',
                'strength': strength,
                'rsi': rsi_value,
                'price': current_price,
                'bb_lower': bb_lower,
                'bb_upper': bb_upper,
                'bb_middle': bb_middle,
                'atr': atr_value,
                'distance_from_bb': abs(current_price - bb_lower) / bb_lower * 100
            }

        # PUT Signal: Overbought (RSI > 80) + Above BB Upper
        elif rsi_value > self.params.rsi_overbought:
            strength = 1

            if current_price > bb_upper:
                strength = 2  # Stronger signal

            signal = {
                'direction': 'PUT',
                'strength': strength,
                'rsi': rsi_value,
                'price': current_price,
                'bb_lower': bb_lower,
                'bb_upper': bb_upper,
                'bb_middle': bb_middle,
                'atr': atr_value,
                'distance_from_bb': abs(current_price - bb_upper) / bb_upper * 100
            }

        return signal

    def _execute_trade(self, signal: Dict):
        """Execute trade based on signal"""

        # Calculate stake using Anti-Martingale
        stake = self._calculate_stake(signal['strength'])

        # Create trade
        trade_info = {
            'entry_time': self.datetime.datetime(),
            'direction': signal['direction'],
            'strength': signal['strength'],
            'stake': stake,
            'entry_price': self.data.close[0],
            'expiry_time': self.datetime.datetime() + timedelta(minutes=self.params.expiry_minutes),
            'result': None,
            'exit_price': None,
            'profit': 0.0,
            'signal_details': signal,
            'win_streak': self.win_streak,
            'loss_streak': self.loss_streak,
            'progressive_stake': self.current_stake if self.current_stake else stake
        }

        self.pending_trades.append(trade_info)
        self.trades_executed += 1
        self.last_trade_time = self.datetime.datetime()

        if self.params.verbose:
            self._log_trade_entry(trade_info)

    def _calculate_stake(self, strength: int) -> float:
        """
        Calculate stake using Progressive Cycles Anti-Martingale

        Win cycle: stake = previous_stake + previous_profit
        Loss cycle: stake = previous_stake - (previous_stake / 2)
        Reset after 3 wins or 3 losses

        Args:
            strength: Signal strength (1 or 2)

        Returns:
            Stake amount
        """
        current_cash = self.broker.get_cash()
        base_stake = current_cash * self.params.base_stake_pct

        # First trade or after reset: use base stake
        if self.current_stake is None or (self.win_streak == 0 and self.loss_streak == 0):
            stake = base_stake
        else:
            # Progressive staking based on last trade result
            stake = self.current_stake

        # Apply strength multiplier (small bonus for stronger signals)
        strength_multiplier = 1.0 + (strength - 1) * 0.1  # 1.0x for strength 1, 1.1x for strength 2
        stake *= strength_multiplier

        # Clamp to limits
        max_stake = current_cash * self.params.max_stake_pct
        min_stake = current_cash * self.params.min_stake_pct
        stake = max(min_stake, min(stake, max_stake))

        return round(stake, 2)

    def _update_pending_trades(self):
        """Check if any pending trades have expired"""

        current_time = self.datetime.datetime()
        expired_trades = []

        for trade in self.pending_trades:
            if current_time >= trade['expiry_time']:
                # Determine result
                exit_price = self.data.close[0]
                entry_price = trade['entry_price']

                if trade['direction'] == 'CALL':
                    won = exit_price > entry_price
                else:  # PUT
                    won = exit_price < entry_price

                # Calculate profit (95% payout on win, lose stake on loss)
                if won:
                    profit = trade['stake'] * 0.95
                    trade['result'] = 'won'
                    self.wins += 1
                    self._update_anti_martingale(won=True, profit=profit, stake=trade['stake'])
                else:
                    profit = -trade['stake']
                    trade['result'] = 'lost'
                    self.losses += 1
                    self._update_anti_martingale(won=False, profit=profit, stake=trade['stake'])

                trade['exit_price'] = exit_price
                trade['profit'] = profit
                self.total_profit += profit

                # Update broker cash
                self.broker.add_cash(profit)

                # Move to completed trades
                self.completed_trades.append(trade)
                expired_trades.append(trade)

                if self.params.verbose:
                    self._log_trade_result(trade)

        # Remove expired trades from pending
        for trade in expired_trades:
            self.pending_trades.remove(trade)

    def _update_anti_martingale(self, won: bool, profit: float, stake: float):
        """
        Update Progressive Cycles Anti-Martingale

        Win: next_stake = current_stake + profit
        Loss: next_stake = current_stake - (current_stake / 2)
        Reset after 3 consecutive wins or losses
        """
        if won:
            self.win_streak += 1
            self.loss_streak = 0

            # Progressive increase: add the profit to current stake
            # Next stake = current_stake + profit
            self.current_stake = stake + profit
            self.last_profit = profit

            # Reset after max win streak (2-3 wins)
            if self.win_streak >= self.params.max_win_streak:
                self.win_streak = 0
                self.current_stake = None  # Reset to base on next trade
                self.last_profit = 0.0

        else:
            self.loss_streak += 1
            self.win_streak = 0

            # Progressive decrease: subtract half of current stake
            # Next stake = current_stake - (current_stake / 2) = current_stake / 2
            self.current_stake = stake / 2.0
            self.last_profit = profit  # Negative value

            # Reset after max loss streak (2-3 losses)
            if self.loss_streak >= self.params.max_loss_streak:
                self.loss_streak = 0
                self.current_stake = None  # Reset to base on next trade
                self.last_profit = 0.0

    def _in_cooldown(self) -> bool:
        """Check if we're in cooldown period"""
        if self.last_trade_time is None:
            return False

        cooldown_delta = timedelta(minutes=self.params.cooldown_minutes)
        return (self.datetime.datetime() - self.last_trade_time) < cooldown_delta

    def _log_trade_entry(self, trade: Dict):
        """Log trade entry"""
        signal = trade['signal_details']
        print(f"\n📊 MEAN REVERSION SIGNAL #{self.trades_executed}: {trade['direction']}")
        print(f"   Time: {trade['entry_time']}")
        print(f"   Entry Price: {trade['entry_price']:.2f}")
        print(f"   Expiry: {self.params.expiry_minutes}m")
        print(f"   RSI: {signal['rsi']:.2f} ({'OVERSOLD' if signal['rsi'] < 30 else 'OVERBOUGHT'})")
        print(f"   BB Distance: {signal['distance_from_bb']:.3f}%")
        print(f"   ATR: {signal['atr']:.2f}")
        print(f"   Strength: {trade['strength']}/2")
        print(f"   Stake: ${trade['stake']:.2f}")
        print(f"   Win Streak: {trade['win_streak']} | Loss Streak: {trade['loss_streak']}")
        if 'progressive_stake' in trade:
            print(f"   Progressive Cycle: ${trade['progressive_stake']:.2f} → ${trade['stake']:.2f}")

    def _log_trade_result(self, trade: Dict):
        """Log trade result"""
        emoji = "✅" if trade['result'] == 'won' else "❌"
        print(f"\n{emoji} TRADE RESULT: {trade['direction']} {trade['result'].upper()}")
        print(f"   Entry: {trade['entry_price']:.2f} → Exit: {trade['exit_price']:.2f}")
        print(f"   Profit: ${trade['profit']:.2f}")
        print(f"   Total Profit: ${self.total_profit:.2f}")
        print(f"   Win Rate: {self.wins}/{self.wins + self.losses} ({self.wins/(self.wins + self.losses)*100:.2f}%)")

    def get_statistics(self) -> Dict:
        """Return strategy statistics"""
        total_trades = self.wins + self.losses
        win_rate = (self.wins / total_trades * 100) if total_trades > 0 else 0

        return {
            'total_trades': total_trades,
            'wins': self.wins,
            'losses': self.losses,
            'win_rate': win_rate,
            'total_profit': self.total_profit,
            'roi': (self.total_profit / self.params.initial_cash * 100) if self.params.initial_cash > 0 else 0,
            'completed_trades': self.completed_trades,
            'pending_trades': len(self.pending_trades)
        }

    def stop(self):
        """Called when backtest ends"""
        if self.params.verbose:
            print("\n" + "=" * 70)
            print("📊 MEAN REVERSION STRATEGY - FINAL STATISTICS")
            print("=" * 70)

            stats = self.get_statistics()

            print(f"\n✅ Total Trades: {stats['total_trades']}")
            print(f"✅ Wins: {stats['wins']} | Losses: {stats['losses']}")
            print(f"✅ Win Rate: {stats['win_rate']:.2f}%")
            print(f"✅ Total Profit: ${stats['total_profit']:.2f}")
            print(f"✅ ROI: {stats['roi']:.2f}%")
            print(f"✅ Final Cash: ${self.broker.get_cash():.2f}")

            if stats['total_trades'] > 0:
                avg_profit = stats['total_profit'] / stats['total_trades']
                print(f"✅ Avg Profit/Trade: ${avg_profit:.2f}")

            print("\n" + "=" * 70)
