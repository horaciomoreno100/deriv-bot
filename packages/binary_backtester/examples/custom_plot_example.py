"""
Custom plot example for binary options backtester MVP
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

def create_custom_plot(backtester, results, plot_filename="custom_backtest_plot.png"):
    """
    Create a custom plot using matplotlib directly
    """
    print("📊 Creating custom plot...")
    
    try:
        # Get data from cerebro
        data = backtester.cerebro.datas[0]
        
        # Create figure with subplots
        fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(15, 12), sharex=True)
        
        # Prepare data
        dates = []
        prices = []
        rsi_values = []
        
        # Extract data from backtrader
        for i in range(len(data)):
            try:
                date = data.datetime.datetime(i)
                price = data.close[i]
                dates.append(date)
                prices.append(price)
                
                # Get RSI if available
                if hasattr(data, 'rsi') and data.rsi[i] is not None:
                    rsi_values.append(data.rsi[i])
                else:
                    rsi_values.append(np.nan)
            except:
                continue
        
        # Convert to numpy arrays
        dates = np.array(dates)
        prices = np.array(prices)
        rsi_values = np.array(rsi_values)
        
        # Plot 1: Price Chart with Trade Signals
        ax1.plot(dates, prices, label='Close Price', linewidth=1, color='blue')
        ax1.set_title(f'Price Chart - {results["strategy_name"]} Strategy', fontsize=14, fontweight='bold')
        ax1.set_ylabel('Price', fontsize=12)
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        # Add trade markers if we have trade data
        if 'trades' in results:
            for trade in results['trades']:
                if trade['direction'] == 'CALL':
                    ax1.scatter(trade['entry_time'], trade['entry_price'], 
                              color='green', marker='^', s=100, alpha=0.7, label='CALL' if 'CALL' not in [t.get('label') for t in ax1.get_children()] else "")
                elif trade['direction'] == 'PUT':
                    ax1.scatter(trade['entry_time'], trade['entry_price'], 
                              color='red', marker='v', s=100, alpha=0.7, label='PUT' if 'PUT' not in [t.get('label') for t in ax1.get_children()] else "")
        
        # Plot 2: RSI Indicator
        ax2.plot(dates, rsi_values, label='RSI', linewidth=1, color='purple')
        ax2.axhline(y=70, color='r', linestyle='--', alpha=0.7, label='Overbought (70)')
        ax2.axhline(y=30, color='g', linestyle='--', alpha=0.7, label='Oversold (30)')
        ax2.set_title('RSI Indicator', fontsize=14, fontweight='bold')
        ax2.set_ylabel('RSI', fontsize=12)
        ax2.set_ylim(0, 100)
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        # Plot 3: Equity Curve
        if 'equity_curve' in results:
            equity_dates = [point['time'] for point in results['equity_curve']]
            equity_values = [point['balance'] for point in results['equity_curve']]
            ax3.plot(equity_dates, equity_values, label='Account Balance', linewidth=2, color='green')
        else:
            # Create a simple equity curve based on results
            initial_balance = results['initial_cash']
            final_balance = results['final_cash']
            ax3.plot([dates[0], dates[-1]], [initial_balance, final_balance], 
                    label='Account Balance', linewidth=2, color='green')
        
        ax3.set_title('Equity Curve', fontsize=14, fontweight='bold')
        ax3.set_ylabel('Balance ($)', fontsize=12)
        ax3.set_xlabel('Time', fontsize=12)
        ax3.legend()
        ax3.grid(True, alpha=0.3)
        
        # Format x-axis
        ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
        ax1.xaxis.set_major_locator(mdates.HourLocator(interval=2))
        plt.xticks(rotation=45)
        
        # Add performance metrics as text
        metrics_text = f"""
        Strategy: {results['strategy_name']}
        Total Trades: {results['total_trades']}
        Win Rate: {results['win_rate']:.1f}%
        ROI: {results['roi']:.1f}%
        Final Balance: ${results['final_cash']:.2f}
        """
        
        fig.text(0.02, 0.02, metrics_text, fontsize=10, 
                bbox=dict(boxstyle="round,pad=0.3", facecolor="lightgray", alpha=0.8))
        
        plt.tight_layout()
        
        # Save plot
        plt.savefig(plot_filename, dpi=150, bbox_inches='tight')
        print(f"📊 Custom plot saved to: {plot_filename}")
        plt.close()
        
        return plot_filename
        
    except Exception as e:
        print(f"❌ Error creating custom plot: {e}")
        import traceback
        traceback.print_exc()
        return None

def main():
    """
    Run a backtest with custom plotting
    """
    print("📊 BINARY OPTIONS BACKTESTER - CUSTOM PLOT EXAMPLE")
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
        rsi_overbought=70.0
    )
    
    print(f"📊 Configuration:")
    print(f"   Symbol: {config.symbol}")
    print(f"   Timeframe: {config.timeframe}s")
    print(f"   Initial Cash: ${config.initial_cash}")
    print(f"   Expiration: {config.expiration_time} minutes")
    print(f"   Payout: {config.payout*100:.1f}%")
    print(f"   Period: {config.start_date} to {config.end_date}")
    
    # Create backtester
    backtester = BinaryBacktester(config)
    
    # Run backtest
    print("\n🚀 Starting backtest...")
    results = backtester.run(RSIStrategy)
    
    # Display results
    print("\n" + "="*50)
    print("📊 STRATEGY RESULTS")
    print("="*50)
    print(f"Total Trades: {results['total_trades']}")
    print(f"Won Trades: {results['won_trades']}")
    print(f"Lost Trades: {results['lost_trades']}")
    print(f"Win Rate: {results['win_rate']:.2f}%")
    print(f"Total Profit: ${results['total_profit']:.2f}")
    print(f"Final Balance: ${results['final_cash']:.2f}")
    print(f"ROI: {results['roi']:.2f}%")
    print("="*50)
    
    # Create custom plot
    print("\n📊 Creating custom plot...")
    plot_filename = create_custom_plot(backtester, results)
    
    if plot_filename:
        print(f"✅ Custom plot created successfully: {plot_filename}")
    else:
        print("❌ Failed to create custom plot")
    
    print("\n🎉 Custom plot example completed!")

if __name__ == "__main__":
    main()
