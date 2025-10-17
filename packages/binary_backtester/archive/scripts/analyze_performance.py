#!/usr/bin/env python3
"""
Detailed Performance Analysis Script
Analyzes backtest results to identify what's causing low win rate
"""

import sys
import os
import json
import pandas as pd
from datetime import datetime
from pathlib import Path
from collections import defaultdict

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.reversal_hunter_balanced import ReversalHunterBalancedStrategy
from config.settings import Config


class PerformanceAnalyzer:
    """Detailed analysis of strategy performance"""

    def __init__(self):
        self.trades = []
        self.signals = []

    def capture_trade_data(self, strategy):
        """Capture detailed trade data during backtest"""
        # This will be called by a modified strategy
        pass

    def analyze_by_pattern(self, trades_df):
        """Analyze win rate by pattern type"""
        print("\n" + "="*60)
        print("📊 PERFORMANCE BY PATTERN")
        print("="*60)

        pattern_groups = trades_df.groupby('pattern_type')

        results = []
        for pattern, group in pattern_groups:
            total = len(group)
            won = group['won'].sum()
            lost = total - won
            win_rate = (won / total * 100) if total > 0 else 0
            avg_profit = group['profit'].mean()

            results.append({
                'pattern': pattern,
                'total': total,
                'won': won,
                'lost': lost,
                'win_rate': win_rate,
                'avg_profit': avg_profit
            })

        # Sort by total trades
        results.sort(key=lambda x: x['total'], reverse=True)

        print(f"\n{'Pattern':<20} {'Total':>8} {'Won':>6} {'Lost':>6} {'Win%':>8} {'Avg P/L':>10}")
        print("-"*60)

        for r in results:
            status = "✅" if r['win_rate'] >= 55 else "⚠️" if r['win_rate'] >= 50 else "❌"
            print(f"{r['pattern']:<20} {r['total']:>8} {r['won']:>6} {r['lost']:>6} {r['win_rate']:>7.2f}% {r['avg_profit']:>9.2f} {status}")

        return results

    def analyze_by_sr_proximity(self, trades_df):
        """Analyze win rate by S/R proximity ranges"""
        print("\n" + "="*60)
        print("📊 PERFORMANCE BY S/R PROXIMITY")
        print("="*60)

        # Define proximity buckets
        bins = [0, 30, 35, 40, 45, 50, 100]
        labels = ['0-30', '30-35', '35-40', '40-45', '45-50', '50+']

        trades_df['sr_bucket'] = pd.cut(trades_df['sr_proximity'], bins=bins, labels=labels, include_lowest=True)

        bucket_groups = trades_df.groupby('sr_bucket', observed=True)

        results = []
        for bucket, group in bucket_groups:
            total = len(group)
            won = group['won'].sum()
            win_rate = (won / total * 100) if total > 0 else 0
            avg_profit = group['profit'].mean()

            results.append({
                'bucket': bucket,
                'total': total,
                'won': won,
                'win_rate': win_rate,
                'avg_profit': avg_profit
            })

        print(f"\n{'S/R Range':<12} {'Total':>8} {'Won':>6} {'Win%':>8} {'Avg P/L':>10}")
        print("-"*60)

        for r in results:
            status = "✅" if r['win_rate'] >= 55 else "⚠️" if r['win_rate'] >= 50 else "❌"
            print(f"{r['bucket']:<12} {r['total']:>8} {r['won']:>6} {r['win_rate']:>7.2f}% {r['avg_profit']:>9.2f} {status}")

        return results

    def analyze_by_hour(self, trades_df):
        """Analyze win rate by hour of day"""
        print("\n" + "="*60)
        print("📊 PERFORMANCE BY HOUR (GMT)")
        print("="*60)

        # Extract hour from timestamp
        trades_df['hour'] = trades_df['timestamp'].apply(lambda x: x.hour if isinstance(x, datetime) else 0)

        hour_groups = trades_df.groupby('hour')

        results = []
        for hour, group in hour_groups:
            total = len(group)
            won = group['won'].sum()
            win_rate = (won / total * 100) if total > 0 else 0
            avg_profit = group['profit'].mean()

            results.append({
                'hour': hour,
                'total': total,
                'won': won,
                'win_rate': win_rate,
                'avg_profit': avg_profit
            })

        # Sort by hour
        results.sort(key=lambda x: x['hour'])

        print(f"\n{'Hour':>4} {'Total':>8} {'Won':>6} {'Win%':>8} {'Avg P/L':>10} {'Quality'}")
        print("-"*60)

        for r in results:
            if r['total'] < 5:
                status = "📊 Low data"
            elif r['win_rate'] >= 55:
                status = "✅ Good"
            elif r['win_rate'] >= 50:
                status = "⚠️  OK"
            else:
                status = "❌ Poor"

            print(f"{r['hour']:>4}h {r['total']:>8} {r['won']:>6} {r['win_rate']:>7.2f}% {r['avg_profit']:>9.2f}  {status}")

        return results

    def analyze_by_strength(self, trades_df):
        """Analyze win rate by pattern strength"""
        print("\n" + "="*60)
        print("📊 PERFORMANCE BY STRENGTH")
        print("="*60)

        strength_groups = trades_df.groupby('strength')

        results = []
        for strength, group in strength_groups:
            total = len(group)
            won = group['won'].sum()
            win_rate = (won / total * 100) if total > 0 else 0
            avg_profit = group['profit'].mean()

            results.append({
                'strength': strength,
                'total': total,
                'won': won,
                'win_rate': win_rate,
                'avg_profit': avg_profit
            })

        # Sort by strength
        results.sort(key=lambda x: x['strength'])

        print(f"\n{'Strength':>8} {'Total':>8} {'Won':>6} {'Win%':>8} {'Avg P/L':>10}")
        print("-"*60)

        for r in results:
            status = "✅" if r['win_rate'] >= 55 else "⚠️" if r['win_rate'] >= 50 else "❌"
            print(f"{r['strength']:>8} {r['total']:>8} {r['won']:>6} {r['win_rate']:>7.2f}% {r['avg_profit']:>9.2f} {status}")

        return results


def extract_trade_data_from_logs(log_file_path):
    """
    Extract trade data from backtest output logs
    This is a fallback if we can't capture data during backtest
    """
    trades = []

    # Read the log file
    with open(log_file_path, 'r') as f:
        lines = f.readlines()

    current_trade = {}

    for line in lines:
        # Parse signal lines
        if "BALANCED SIGNAL #" in line:
            # Extract pattern type
            if "pin_bar" in line:
                current_trade['pattern_type'] = 'pin_bar_bullish' if 'CALL' in line else 'pin_bar_bearish'
            elif "engulfing" in line:
                current_trade['pattern_type'] = 'engulfing_bullish' if 'CALL' in line else 'engulfing_bearish'
            elif "double_red" in line:
                current_trade['pattern_type'] = 'double_red_bullish'
            elif "double_green" in line:
                current_trade['pattern_type'] = 'double_green_bearish'

        # Extract strength
        if "Strength:" in line:
            strength = int(line.split("Strength:")[1].strip().split()[0])
            current_trade['strength'] = strength

        # Extract S/R proximity
        if "S/R Proximity:" in line:
            sr_prox = float(line.split("S/R Proximity:")[1].strip().split("/")[0])
            current_trade['sr_proximity'] = sr_prox

        # Extract trade result
        if "Contract contract_" in line and ("WON" in line or "LOST" in line):
            won = "WON" in line
            profit = float(line.split("Profit:")[1].strip())

            current_trade['won'] = won
            current_trade['profit'] = profit

            # Save trade
            if current_trade:
                trades.append(current_trade.copy())

            current_trade = {}

    return trades


def main():
    """Run detailed performance analysis"""

    print("🔍 DETAILED PERFORMANCE ANALYSIS")
    print("="*60)
    print("Analyzing backtest results to identify low win rate causes...")
    print()

    # Find latest data file
    data_dir = Path(__file__).parent / "data"
    data_files = list(data_dir.glob("deriv_candles_*.json"))

    if not data_files:
        print("❌ No data files found")
        return

    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)

    # Load candles to get metadata
    with open(latest_file, 'r') as f:
        candles = json.load(f)

    duration_days = (candles[-1]['epoch'] - candles[0]['epoch']) / 86400

    print(f"📊 Data: {latest_file.name}")
    print(f"📅 Period: {duration_days:.2f} days")
    print(f"📊 Candles: {len(candles):,}")
    print()

    # For now, we'll create synthetic trade data from the last backtest log
    # In a real implementation, we'd modify the strategy to export detailed trade logs

    print("⚠️  Note: To get detailed analysis, we need to export trade data during backtest")
    print("    This would require modifying the strategy to log:")
    print("    - Pattern type, strength, S/R proximity for each trade")
    print("    - Timestamp, direction, result")
    print()
    print("📝 RECOMMENDATION: Create enhanced logging in strategy")
    print()

    # Show what analysis we WOULD do with the data
    print("🎯 ANALYSIS PLAN:")
    print("="*60)
    print()
    print("1️⃣  PATTERN PERFORMANCE")
    print("   - Compare win rate: Pin Bar vs Engulfing vs Double Red/Green")
    print("   - Hypothesis: Double Red/Green (strength 2) may be dragging down win rate")
    print()
    print("2️⃣  S/R PROXIMITY CORRELATION")
    print("   - Bucket trades by proximity: 30-35, 35-40, 40-45, 45-50, 50+")
    print("   - Hypothesis: Lower proximity (30-35) may have worse win rate")
    print()
    print("3️⃣  SESSION/TIME ANALYSIS")
    print("   - Win rate by hour of day (GMT)")
    print("   - Hypothesis: Some hours (low liquidity) may have poor performance")
    print()
    print("4️⃣  STRENGTH CORRELATION")
    print("   - Win rate by strength (2 vs 3 vs 4)")
    print("   - Hypothesis: Higher strength should = higher win rate")
    print()

    print("="*60)
    print("🔧 NEXT STEP: Modify strategy to export detailed trade logs")
    print("="*60)


if __name__ == "__main__":
    main()
