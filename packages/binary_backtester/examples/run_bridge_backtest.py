#!/usr/bin/env python3
"""
Run binary options backtest using data from the Deriv Gateway Bridge
"""

import sys
import os
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.rsi_strategy import RSIStrategy
from config.settings import Config

def fetch_data_via_bridge(symbol='frxXAUUSD', timeframe=60, days=1):
    """
    Fetch data using the Deriv Gateway Bridge
    """
    print("🌉 Fetching data via Deriv Gateway Bridge...")
    
    # Check if bridge exists
    bridge_path = Path(__file__).parent.parent / "bridge" / "deriv-data-bridge.js"
    if not bridge_path.exists():
        print("❌ Bridge not found. Please ensure the bridge is set up.")
        return None
    
    try:
        # Run the bridge to fetch data
        cmd = [
            "node", 
            str(bridge_path), 
            symbol, 
            str(timeframe), 
            str(days)
        ]
        
        print(f"🔌 Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=bridge_path.parent)
        
        if result.returncode != 0:
            print(f"❌ Bridge failed: {result.stderr}")
            return None
        
        print("✅ Data fetched successfully via bridge")
        print(result.stdout)
        
        # Find the latest data file
        data_dir = Path(__file__).parent.parent / "data"
        data_files = list(data_dir.glob("deriv_candles_*.json"))
        
        if not data_files:
            print("❌ No data files found")
            return None
        
        # Get the most recent file
        latest_file = max(data_files, key=lambda f: f.stat().st_mtime)
        print(f"📊 Using data file: {latest_file.name}")
        
        return str(latest_file)
        
    except Exception as e:
        print(f"❌ Error running bridge: {e}")
        return None

def run_backtest_with_bridge_data():
    """
    Run backtest using data fetched via the bridge
    """
    print("🚀 BINARY OPTIONS BACKTESTER - GATEWAY BRIDGE")
    print("=" * 60)
    print("🌉 Using Deriv Gateway Bridge for real-time data")
    print("=" * 60)
    
    # Configuration
    symbol = 'frxXAUUSD'
    timeframe = 60  # 1 minute
    days = 1  # 1 day of data
    
    # Fetch data via bridge
    data_file = fetch_data_via_bridge(symbol, timeframe, days)
    
    if not data_file:
        print("❌ Failed to fetch data via bridge")
        return
    
    # Set up configuration
    config = Config(
        symbol=symbol,
        timeframe=timeframe,
        initial_cash=1000.0,
        expiration_time=1,  # 1 minute expiration
        payout=0.8,  # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=days,
    )
    
    # Set date range
    config.start_date = datetime.now() - timedelta(days=config.days_back)
    config.end_date = datetime.now()
    
    print("\n⚙️ Configuration:")
    print(f"   Symbol: {config.symbol}")
    print(f"   Timeframe: {config.timeframe}s")
    print(f"   Initial Cash: ${config.initial_cash:.1f}")
    print(f"   Expiration: {config.expiration_time} minutes")
    print(f"   Payout: {config.payout*100:.0f}%")
    print(f"   Period: {config.start_date} to {config.end_date}")
    print(f"   Data Source: Deriv Gateway Bridge")
    print("-" * 60)
    
    # Create backtester
    backtester = EnhancedBinaryBacktester(config)
    
    try:
        print("🚀 Starting backtest with Gateway Bridge data...")
        results = backtester.run(RSIStrategy, 
                                rsi_period=config.rsi_period,
                                rsi_oversold=config.rsi_oversold,
                                rsi_overbought=config.rsi_overbought)
        
        print("\n==================================================")
        print("📊 STRATEGY RESULTS (Gateway Bridge Data)")
        print("==================================================")
        print(f"Total Trades: {results.get('total_trades', 0)}")
        print(f"Won Trades: {results.get('won_trades', 0)}")
        print(f"Lost Trades: {results.get('lost_trades', 0)}")
        print(f"Win Rate: {results.get('win_rate', 0):.2f}%")
        print(f"Total Profit: {results.get('total_profit', 0):.2f}")
        print(f"Final Balance: {results.get('final_cash', 0):.2f}")
        print("==================================================")
        
        # Generate plot
        print("\n📊 Creating interactive plot...")
        plot_filename = f"gateway_bridge_plot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        backtester.plot_results(plot_filename)
        print(f"✅ Plot saved to: {plot_filename}")
        
        # Save results
        results_file = f"gateway_bridge_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"💾 Results saved to: {results_file}")
        
        print("\n🎯 GATEWAY BRIDGE BACKTEST COMPLETED!")
        print("✅ Used Deriv Gateway Bridge")
        print("✅ Real-time data from Deriv API")
        print("✅ Python Backtrader engine")
        print("✅ Interactive plotting")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Backtest failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    run_backtest_with_bridge_data()
