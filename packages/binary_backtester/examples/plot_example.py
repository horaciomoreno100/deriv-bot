"""
Plot example for binary options backtester MVP
"""

import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.backtrader_engine import BinaryBacktester
from strategies.rsi_strategy import RSIStrategy
from config.settings import Config
from datetime import datetime, timedelta

def main():
    """
    Run a backtest with plotting
    """
    print("📊 BINARY OPTIONS BACKTESTER - PLOTTING EXAMPLE")
    print("=" * 60)
    
    # Configuration
    config = Config(
        symbol='frxXAUUSD',
        timeframe=60,  # 1 minute
        initial_cash=1000.0,
        expiration_time=1,  # 1 minute expiration
        payout=0.8,  # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=3,  # 3 days of data for faster plotting
        rsi_period=14,
        rsi_oversold=30.0,
        rsi_overbought=70.0
    )
    
    print(f"📊 Configuration:")
    print(f"   Symbol: {config.symbol}")
    print(f"   Timeframe: {config.timeframe}s")
    print(f"   Initial Cash: ${config.initial_cash}")
    print(f"   Expiration: {config.expiration_time} minutes")
    print(f"   Payout: {config.payout:.1%}")
    print(f"   Period: {config.start_date} to {config.end_date}")
    print()
    
    # Create backtester
    backtester = BinaryBacktester(config)
    
    # Run backtest
    print("🚀 Starting backtest...")
    results = backtester.run(RSIStrategy)
    
    # Display basic results
    print("\n" + "=" * 50)
    print("📊 QUICK RESULTS")
    print("=" * 50)
    print(f"Strategy: {results['strategy_name']}")
    print(f"Total Trades: {results['total_trades']}")
    print(f"Win Rate: {results['win_rate']:.2%}")
    print(f"Final Cash: ${results['final_cash']:.2f}")
    print(f"Total Profit: ${results['total_profit']:.2f}")
    print(f"ROI: {results['roi']:.2f}%")
    print("=" * 50)
    
    # Generate plots
    print("\n📊 Generating plots...")
    try:
        backtester.plot_results()
        print("✅ Plots generated successfully!")
        print("💡 The plot window should open automatically")
        print("💡 Close the plot window to continue")
    except Exception as e:
        print(f"❌ Could not generate plots: {e}")
        print("💡 Make sure you have matplotlib installed and a display available")
        print("💡 On macOS, you might need to install: pip install matplotlib")
        print("💡 On Linux, you might need: sudo apt-get install python3-tk")
    
    print("\n🎉 Plot example completed!")

if __name__ == "__main__":
    main()
