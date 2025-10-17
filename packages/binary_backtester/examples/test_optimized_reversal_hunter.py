#!/usr/bin/env python3
"""
Test OPTIMIZED Reversal Hunter Strategy
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

class OptimizedBacktester:
    """Optimized backtester for testing enhanced strategy"""
    
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
            # Format: {"symbol": "frxXAUUSD", "timeframe": 60, "candles": [...]}
            df = pd.DataFrame(data['candles'])
            # Convert timestamp to datetime
            df['datetime'] = pd.to_datetime(df['timestamp'], unit='s')
        elif isinstance(data, list):
            # Format: [{"epoch": 1760268902, "open": 2000.0, ...}, ...]
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
        print(f"✅ OPTIMIZED Strategy {strategy_class.__name__} added")
    
    def run(self):
        """Run backtest"""
        print("🚀 Starting OPTIMIZED backtest...")
        
        # Run backtest
        results = self.cerebro.run()
        
        # Get final balance
        final_balance = self.cerebro.broker.getvalue()
        
        print(f"✅ OPTIMIZED Backtest completed")
        print(f"   Initial Cash: ${self.initial_cash:.2f}")
        print(f"   Final Balance: ${final_balance:.2f}")
        print(f"   Profit/Loss: ${final_balance - self.initial_cash:.2f}")
        
        return results

def test_optimized_reversal_hunter():
    """Test OPTIMIZED Reversal Hunter strategy"""
    print("🎯 OPTIMIZED REVERSAL HUNTER STRATEGY TEST")
    print("=" * 60)
    print("🚀 Testing ENHANCED Reversal Hunter with better filtering")
    print("=" * 60)
    
    # Find combined data file - use the 30-day combined dataset
    data_dir = Path(__file__).parent.parent / "data"
    combined_dir = data_dir / "combined"
    
    if combined_dir.exists():
        combined_files = list(combined_dir.glob("combined_30days_*.json"))
        if combined_files:
            # Use the most recent combined file
            latest_combined = max(combined_files, key=lambda f: f.stat().st_mtime)
            print(f"📁 Using combined 30-day dataset: {latest_combined.name}")
            print(f"📊 This contains ~30 days of combined data for robust evaluation")
            largest_file = latest_combined
        else:
            print("❌ No combined data files found")
            return
    else:
        print("❌ No combined data directory found")
        return
    
    # Create OPTIMIZED backtester
    backtester = OptimizedBacktester(initial_cash=1000.0)
    
    # Add data
    df = backtester.add_data(largest_file)
    
    # Add BALANCED strategy with 24-day dataset parameters
    backtester.add_strategy(
        ReversalHunterOptimizedStrategy,
        # BALANCED Pattern detection parameters (less restrictive for 24 days)
        min_confidence=0.001,
        proximity_threshold=0.01,
        atr_multiplier=0.5,
        wick_multiplier=1.0,
        engulfing_ratio=1.05,
        
        # BALANCED Indicator parameters
        ema_period=6,
        atr_period=4,
        rsi_period=4,
        rsi_oversold=30,
        rsi_overbought=70,
        
        # BALANCED Trading parameters
        cooldown_seconds=15,  # Shorter cooldown for more opportunities
        max_concurrent_trades=5,  # More concurrent trades
        min_strength_trade=1,  # Allow strength 1 trades
        
        # BALANCED Anti-Martingale parameters
        use_anti_martingale=True,
        base_stake_percentage=0.01,
        max_win_streak=3,
        max_consecutive_losses=2,
        strength_multiplier=0.2
    )
    
    # Run backtest
    results = backtester.run()
    
    print("\n🎯 OPTIMIZED REVERSAL HUNTER TEST COMPLETED!")
    print("✅ Enhanced Python Backtrader engine")
    print("✅ OPTIMIZED Reversal Hunter strategy")
    print("✅ ENHANCED Anti-Martingale system")
    print("✅ Better pattern filtering")
    print("✅ Improved win rate targeting")
    print("=" * 60)

if __name__ == "__main__":
    test_optimized_reversal_hunter()
