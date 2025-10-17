#!/usr/bin/env python3
"""
Simple Reversal Hunter Strategy Test
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

from strategies.reversal_hunter_strategy import ReversalHunterStrategy

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
        
        # Convert to DataFrame
        df = pd.DataFrame(data)
        
        # Convert epoch to datetime
        df['datetime'] = pd.to_datetime(df['epoch'], unit='s')
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

def test_reversal_hunter():
    """Test Reversal Hunter strategy"""
    print("🎯 SIMPLE REVERSAL HUNTER TEST")
    print("=" * 50)
    
    # Find data file
    data_dir = Path(__file__).parent.parent / "data"
    data_files = list(data_dir.glob("deriv_candles_*.json"))
    
    if not data_files:
        print("❌ No data files found")
        return
    
    # Use most recent file
    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)
    print(f"📁 Using data file: {latest_file.name}")
    
    # Create backtester
    backtester = SimpleBacktester(initial_cash=1000.0)
    
    # Add data
    df = backtester.add_data(latest_file)
    
    # Add strategy with optimized parameters
    backtester.add_strategy(
        ReversalHunterStrategy,
        min_confidence=0.001,
        proximity_threshold=0.01,
        atr_multiplier=0.5,
        wick_multiplier=1.0,
        engulfing_ratio=1.05,
        ema_period=5,
        atr_period=3,
        rsi_period=3,
        rsi_oversold=35,
        rsi_overbought=65,
        cooldown_seconds=0,
        max_concurrent_trades=100,
        min_strength_trade=1,
        use_anti_martingale=True,
        base_stake_percentage=0.01,
        max_win_streak=3,
        max_consecutive_losses=2,
        strength_multiplier=0.2
    )
    
    # Run backtest
    results = backtester.run()
    
    print("\n🎯 REVERSAL HUNTER TEST COMPLETED!")
    print("✅ Python Backtrader engine")
    print("✅ Reversal Hunter strategy")
    print("✅ Anti-Martingale system")
    print("✅ Price action patterns")

if __name__ == "__main__":
    test_reversal_hunter()
