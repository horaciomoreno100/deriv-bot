#!/usr/bin/env python3
"""
Test Reversal Hunter Strategy with 30 days of data
Using the original working dataset
"""

import sys
import os
import json
import pandas as pd
import backtrader as bt
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strategies.reversal_hunter_optimized import ReversalHunterOptimizedStrategy

class SimpleBacktester:
    """Simple backtester for testing"""
    
    def __init__(self, initial_cash=1000.0):
        self.initial_cash = initial_cash
        self.cerebro = bt.Cerebro()
        self.cerebro.broker.setcash(initial_cash)
        self.cerebro.broker.setcommission(commission=0.0)
        
    def add_data(self, data_file):
        """Add data from file"""
        print(f"📊 Loading data from: {data_file}")
        
        with open(data_file, 'r') as f:
            data = json.load(f)
        
        # Handle different data formats
        if isinstance(data, dict) and 'candles' in data:
            df = pd.DataFrame(data['candles'])
            # Convert timestamp to datetime
            df['datetime'] = pd.to_datetime(df['timestamp'], unit='s')
        elif isinstance(data, list):
            df = pd.DataFrame(data)
            # Convert epoch to datetime
            df['datetime'] = pd.to_datetime(df['epoch'], unit='s')
        else:
            raise ValueError("Unknown data format")
        
        df.set_index('datetime', inplace=True)
        
        # Add volume column (required by Backtrader)
        df['volume'] = 1000  # Default volume
        
        # Reorder columns for Backtrader
        df = df[['open', 'high', 'low', 'close', 'volume']]
        
        print(f"✅ Loaded {len(df)} candles")
        print(f"   Period: {df.index[0]} to {df.index[-1]}")
        
        # Add data to cerebro
        data_feed = bt.feeds.PandasData(dataname=df)
        self.cerebro.adddata(data_feed)
        
        return df
    
    def add_strategy(self, strategy_class, **kwargs):
        """Add strategy"""
        self.cerebro.addstrategy(strategy_class, **kwargs)
        print(f"✅ Strategy {strategy_class.__name__} added")
    
    def run(self):
        """Run backtest"""
        print("🚀 Starting backtest...")
        
        # Run backtest
        results = self.cerebro.run()
        
        # Get final balance
        final_balance = self.cerebro.broker.getvalue()
        
        print(f"✅ Backtest completed")
        print(f"   Initial Cash: ${self.initial_cash:.2f}")
        print(f"   Final Balance: ${final_balance:.2f}")
        print(f"   Profit/Loss: ${final_balance - self.initial_cash:.2f}")
        
        return results

def test_30days_simple():
    """Test with 30 days of data using simple approach"""
    print("🎯 30-DAY REVERSAL HUNTER STRATEGY TEST")
    print("=" * 50)
    print("🚀 Testing with 30 days of data for robust evaluation")
    print("=" * 50)
    
    # Find the extended 30-day dataset
    data_dir = Path(__file__).parent.parent / "data"
    extended_dir = data_dir / "extended"
    
    if extended_dir.exists():
        extended_files = list(extended_dir.glob("extended_30days_*.json"))
        if extended_files:
            # Use the most recent extended file
            latest_extended = max(extended_files, key=lambda f: f.stat().st_mtime)
            print(f"📁 Using extended 30-day dataset: {latest_extended.name}")
            print(f"📊 This contains 30 days of extended data for robust evaluation")
            largest_file = latest_extended
        else:
            print("❌ No extended data files found")
            return
    else:
        print("❌ No extended data directory found")
        return
    
    # Create backtester
    backtester = SimpleBacktester(initial_cash=1000.0)
    
    # Add data
    df = backtester.add_data(largest_file)
    
    # Calculate days
    days = (df.index[-1] - df.index[0]).days
    print(f"📅 Dataset covers {days} days")
    
    # Add strategy with balanced parameters
    backtester.add_strategy(
        ReversalHunterOptimizedStrategy,
        # BALANCED parameters for 30-day evaluation
        min_confidence=0.001,
        proximity_threshold=0.01,
        atr_multiplier=0.5,
        wick_multiplier=1.0,
        engulfing_ratio=1.05,
        ema_period=6,
        atr_period=4,
        rsi_period=4,
        rsi_oversold=30,
        rsi_overbought=70,
        cooldown_seconds=15,
        max_concurrent_trades=5,
        min_strength_trade=1,
        use_anti_martingale=True,
        base_stake_percentage=0.01,
        max_win_streak=3,
        max_consecutive_losses=2,
        strength_multiplier=0.2
    )
    
    # Run backtest
    results = backtester.run()
    
    print("\n🎯 30-DAY BACKTEST COMPLETED!")
    print("=" * 40)
    print("✅ 30-day dataset evaluation")
    print("✅ Balanced parameters")
    print("✅ Robust backtesting")
    print("=" * 40)

if __name__ == "__main__":
    test_30days_simple()
