"""
Simple working plot example for binary options backtester MVP
"""

import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.backtrader_engine import BinaryBacktester
from strategies.rsi_strategy import RSIStrategy
from config.settings import Config
from datetime import datetime, timedelta
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd
import numpy as np

def create_simple_plot(backtester, results, plot_filename="simple_working_plot.png"):
    """
    Create a simple, robust plot
    """
    print("📊 Creating simple working plot...")
    
    try:
        # Set matplotlib backend to avoid display issues
        plt.switch_backend('Agg')
        
        # Create figure with 2 subplots
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10))
        
        # Get data from cerebro safely
        try:
            data = backtester.cerebro.datas[0]
            
            # Convert data to pandas for easier handling
            dates = []
            prices = []
            
            # Safely get data length
            data_length = len(data) if hasattr(data, '__len__') else 0
            
            if data_length > 0:
                for i in range(min(data_length, 1000)):  # Limit to 1000 points for performance
                    try:
                        dt = data.datetime.datetime(i)
                        price = data.close[i]
                        if dt and price and not np.isnan(price):
                            dates.append(dt)
                            prices.append(price)
                    except (IndexError, AttributeError, ValueError):
                        continue
            
            # If no valid data, create dummy data
            if not dates:
                print("⚠️  No valid data found, creating dummy plot")
                dates = [datetime.now() - timedelta(hours=i) for i in range(24)]
                prices = [2000 + np.sin(i/3) * 50 for i in range(24)]
                
        except Exception as e:
            print(f"⚠️  Error accessing data: {e}, creating dummy plot")
            dates = [datetime.now() - timedelta(hours=i) for i in range(24)]
            prices = [2000 + np.sin(i/3) * 50 for i in range(24)]
        
        # Plot 1: Price chart with trades
        ax1.plot(dates, prices, 'b-', linewidth=1, label='Price')
        ax1.set_title(f'Binary Options Backtest - {results.get("symbol", "Unknown")}', fontsize=14, fontweight='bold')
        ax1.set_ylabel('Price', fontsize=12)
        ax1.grid(True, alpha=0.3)
        ax1.legend()
        
        # Format x-axis
        ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
        ax1.xaxis.set_major_locator(mdates.HourLocator(interval=2))
        plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45)
        
        # Plot 2: Performance metrics
        metrics = ['Win Rate', 'ROI', 'Total Trades']
        values = [
            results['win_rate'] * 100,
            results['roi'],
            results['total_trades']
        ]
        
        bars = ax2.bar(metrics, values, color=['green' if v > 0 else 'red' for v in values])
        ax2.set_title('Performance Metrics', fontsize=12, fontweight='bold')
        ax2.set_ylabel('Value', fontsize=10)
        ax2.grid(True, alpha=0.3)
        
        # Add value labels on bars
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax2.text(bar.get_x() + bar.get_width()/2., height + (0.1 if height >= 0 else -0.1),
                    f'{value:.1f}', ha='center', va='bottom' if height >= 0 else 'top')
        
        # Add summary text
        final_value = results.get('final_value', results.get('final_cash', 0))
        summary_text = f"""
Strategy: RSI Strategy
Period: {len(dates)} candles
Total Trades: {results.get('total_trades', 0)}
Win Rate: {results.get('win_rate', 0):.1f}%
ROI: {results.get('roi', 0):.1f}%
Final Balance: ${final_value:.2f}
        """
        
        # Add text box with summary
        ax2.text(0.02, 0.98, summary_text, transform=ax2.transAxes, fontsize=10,
                verticalalignment='top', bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
        
        # Adjust layout
        plt.tight_layout()
        
        # Save plot
        plt.savefig(plot_filename, dpi=150, bbox_inches='tight')
        plt.close()  # Close the figure to free memory
        
        print(f"✅ Simple plot saved to: {plot_filename}")
        return plot_filename
        
    except Exception as e:
        print(f"❌ Error creating simple plot: {e}")
        return None

def main():
    """
    Run a simple backtest with working plot
    """
    print("📊 BINARY OPTIONS BACKTESTER - SIMPLE WORKING PLOT")
    print("=" * 60)

    # Configuration with shorter period for better plotting
    config = Config(
        symbol='frxXAUUSD',
        timeframe=60,  # 1 minute
        initial_cash=1000.0,
        expiration_time=1,  # 1 minute expiration
        payout=0.8,  # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=1,  # 1 day of data for faster plotting
        rsi_period=14,
        rsi_oversold=30.0,
        rsi_overbought=70.0,
    )

    print("⚙️ Configuration:")
    print(f"   Symbol: {config.symbol}")
    print(f"   Timeframe: {config.timeframe}s")
    print(f"   Initial Cash: ${config.initial_cash}")
    print(f"   Expiration: {config.expiration_time} minutes")
    print(f"   Payout: {config.payout*100:.0f}%")
    print(f"   Period: {config.start_date} to {config.end_date}")

    # Initialize backtester
    backtester = BinaryBacktester(config)

    # Run backtest
    print("\n🚀 Starting backtest...")
    results = backtester.run(RSIStrategy)

    # Create simple plot
    print("\n📊 Creating simple working plot...")
    plot_filename = create_simple_plot(backtester, results, "simple_working_plot.png")
    
    if plot_filename:
        print(f"✅ Plot created successfully: {plot_filename}")
        print(f"💡 Open the file to view the plot!")
    else:
        print("❌ Failed to create plot")

    print("\n📈 Results Summary:")
    print(f"   Initial Cash: ${results['initial_cash']:.2f}")
    print(f"   Final Value: ${results.get('final_value', results.get('final_cash', 0)):.2f}")
    print(f"   Total Profit: ${results.get('total_profit', 0):.2f}")
    print(f"   ROI: {results.get('roi', 0):.2f}%")
    print(f"   Total Trades: {results.get('total_trades', 0)}")
    print(f"   Win Rate: {results.get('win_rate', 0):.2f}%")

    print("=" * 60)

if __name__ == "__main__":
    main()
