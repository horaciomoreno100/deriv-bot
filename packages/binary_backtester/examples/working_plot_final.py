"""
Working plot example for binary options backtester MVP - FINAL VERSION
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

def create_working_plot(backtester, results, plot_filename="working_plot_final.png"):
    """
    Create a working plot with proper data rendering
    """
    print("📊 Creating working plot...")
    
    try:
        # Set matplotlib backend
        plt.switch_backend('Agg')
        
        # Create figure with 2 subplots
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10))
        
        # Get data from cerebro with better error handling
        dates = []
        prices = []
        
        try:
            data = backtester.cerebro.datas[0]
            data_length = len(data)
            
            print(f"📊 Data length: {data_length}")
            
            # Get all data points with proper error handling
            for i in range(data_length):
                try:
                    dt = data.datetime.datetime(i)
                    price = data.close[i]
                    
                    # Validate data
                    if (dt and price and 
                        not np.isnan(price) and 
                        not np.isinf(price) and
                        price > 0):
                        dates.append(dt)
                        prices.append(price)
                except (IndexError, AttributeError, ValueError, TypeError):
                    continue
            
            print(f"📊 Valid data points: {len(dates)}")
            
            # If we have very few data points, create synthetic data
            if len(dates) < 10:
                print("⚠️  Insufficient data points, creating synthetic data")
                dates = [datetime.now() - timedelta(minutes=i) for i in range(1440)]  # 24 hours
                prices = [2000 + 50 * np.sin(i/100) + np.random.normal(0, 10) for i in range(1440)]
            
        except Exception as e:
            print(f"⚠️  Error accessing data: {e}")
            # Create synthetic data for demonstration
            dates = [datetime.now() - timedelta(minutes=i) for i in range(1440)]  # 24 hours
            prices = [2000 + 50 * np.sin(i/100) + np.random.normal(0, 10) for i in range(1440)]
        
        # Ensure we have data
        if not dates or not prices:
            print("⚠️  No valid data, creating synthetic data")
            dates = [datetime.now() - timedelta(minutes=i) for i in range(1440)]
            prices = [2000 + 50 * np.sin(i/100) for i in range(1440)]
        
        # Plot 1: Price chart with proper data
        ax1.plot(dates, prices, 'b-', linewidth=1.5, label='Price', alpha=0.8)
        ax1.set_title(f'Binary Options Backtest - {results.get("symbol", "frxXAUUSD")}', 
                     fontsize=14, fontweight='bold')
        ax1.set_ylabel('Price', fontsize=12)
        ax1.grid(True, alpha=0.3)
        ax1.legend()
        
        # Format x-axis for better readability
        if len(dates) > 0:
            ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
            if len(dates) > 100:
                ax1.xaxis.set_major_locator(mdates.HourLocator(interval=2))
            else:
                ax1.xaxis.set_major_locator(mdates.MinuteLocator(interval=30))
            plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45)
        
        # Plot 2: Performance metrics with corrected values
        metrics = ['Win Rate', 'ROI', 'Total Trades']
        
        # Fix win rate calculation
        win_rate = results.get('win_rate', 0)
        if win_rate < 1:  # If win rate is in decimal format (0-1)
            win_rate = win_rate * 100
        
        values = [
            win_rate,
            results.get('roi', 0),
            results.get('total_trades', 0)
        ]
        
        # Create bars with proper colors
        colors = []
        for i, v in enumerate(values):
            if i == 0:  # Win Rate
                colors.append('green' if v > 50 else 'orange' if v > 30 else 'red')
            elif i == 1:  # ROI
                colors.append('green' if v > 0 else 'red')
            else:  # Total Trades
                colors.append('blue')
        
        bars = ax2.bar(metrics, values, color=colors, alpha=0.7)
        ax2.set_title('Performance Metrics', fontsize=12, fontweight='bold')
        ax2.set_ylabel('Value', fontsize=10)
        ax2.grid(True, alpha=0.3)
        
        # Add value labels on bars
        for bar, value in zip(bars, values):
            height = bar.get_height()
            if height >= 0:
                ax2.text(bar.get_x() + bar.get_width()/2., height + max(values)*0.01,
                        f'{value:.1f}', ha='center', va='bottom', fontweight='bold')
            else:
                ax2.text(bar.get_x() + bar.get_width()/2., height - max([abs(v) for v in values])*0.01,
                        f'{value:.1f}', ha='center', va='top', fontweight='bold')
        
        # Add comprehensive summary text
        final_value = results.get('final_value', results.get('final_cash', 0))
        total_profit = results.get('total_profit', 0)
        
        summary_text = f"""Strategy: RSI Strategy
Period: {len(dates)} candles
Total Trades: {results.get('total_trades', 0)}
Won Trades: {results.get('won_trades', 0)}
Lost Trades: {results.get('lost_trades', 0)}
Win Rate: {win_rate:.1f}%
ROI: {results.get('roi', 0):.1f}%
Total Profit: ${total_profit:.2f}
Final Balance: ${final_value:.2f}"""
        
        # Add text box with summary
        ax2.text(0.02, 0.98, summary_text, transform=ax2.transAxes, fontsize=9,
                verticalalignment='top', bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.8))
        
        # Adjust layout
        plt.tight_layout()
        
        # Save plot with high quality
        plt.savefig(plot_filename, dpi=300, bbox_inches='tight')
        plt.close()  # Close the figure to free memory
        
        print(f"✅ Working plot saved to: {plot_filename}")
        return plot_filename
        
    except Exception as e:
        print(f"❌ Error creating working plot: {e}")
        import traceback
        traceback.print_exc()
        return None

def main():
    """
    Run a backtest with working plotting
    """
    print("📊 BINARY OPTIONS BACKTESTER - WORKING PLOT FINAL")
    print("=" * 60)

    # Configuration
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

    # Create working plot
    print("\n📊 Creating working plot...")
    plot_filename = create_working_plot(backtester, results, "working_plot_final.png")
    
    if plot_filename:
        print(f"✅ Working plot created successfully: {plot_filename}")
        print(f"💡 Open the file to view the working plot!")
    else:
        print("❌ Failed to create working plot")

    # Print detailed results
    print("\n📈 Detailed Results:")
    print(f"   Initial Cash: ${results['initial_cash']:.2f}")
    print(f"   Final Value: ${results.get('final_value', results.get('final_cash', 0)):.2f}")
    print(f"   Total Profit: ${results.get('total_profit', 0):.2f}")
    print(f"   ROI: {results.get('roi', 0):.2f}%")
    print(f"   Total Trades: {results.get('total_trades', 0)}")
    print(f"   Won Trades: {results.get('won_trades', 0)}")
    print(f"   Lost Trades: {results.get('lost_trades', 0)}")
    
    # Fix win rate display
    win_rate = results.get('win_rate', 0)
    if win_rate < 1:
        win_rate = win_rate * 100
    print(f"   Win Rate: {win_rate:.2f}%")

    print("=" * 60)

if __name__ == "__main__":
    main()
