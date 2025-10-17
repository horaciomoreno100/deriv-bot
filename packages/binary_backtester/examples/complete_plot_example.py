"""
Complete plot example for binary options backtester MVP
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

def create_complete_plot(backtester, results, plot_filename="complete_backtest_plot.png"):
    """
    Create a complete plot with all analysis
    """
    print("📊 Creating complete analysis plot...")
    
    try:
        # Get data from cerebro
        data = backtester.cerebro.datas[0]
        
        # Create figure with 4 subplots
        fig = plt.figure(figsize=(16, 12))
        gs = fig.add_gridspec(4, 2, height_ratios=[2, 1, 1, 1], width_ratios=[3, 1])
        
        # Plot 1: Price Chart with Trade Signals (main chart)
        ax1 = fig.add_subplot(gs[0, :])
        
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
        
        # Plot price chart
        ax1.plot(dates, prices, label='Close Price', linewidth=1, color='blue', alpha=0.8)
        ax1.set_title(f'Binary Options Strategy Analysis - {results["strategy_name"]}', 
                     fontsize=16, fontweight='bold')
        ax1.set_ylabel('Price', fontsize=12)
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        # Add trade markers if we have trade data
        if 'trades' in results:
            for trade in results['trades']:
                if trade['direction'] == 'CALL':
                    ax1.scatter(trade['entry_time'], trade['entry_price'], 
                              color='green', marker='^', s=100, alpha=0.7, 
                              label='CALL' if 'CALL' not in [t.get('label') for t in ax1.get_children()] else "")
                elif trade['direction'] == 'PUT':
                    ax1.scatter(trade['entry_time'], trade['entry_price'], 
                              color='red', marker='v', s=100, alpha=0.7, 
                              label='PUT' if 'PUT' not in [t.get('label') for t in ax1.get_children()] else "")
        
        # Plot 2: RSI Indicator
        ax2 = fig.add_subplot(gs[1, :])
        ax2.plot(dates, rsi_values, label='RSI', linewidth=1, color='purple')
        ax2.axhline(y=70, color='r', linestyle='--', alpha=0.7, label='Overbought (70)')
        ax2.axhline(y=30, color='g', linestyle='--', alpha=0.7, label='Oversold (30)')
        ax2.set_title('RSI Indicator', fontsize=14, fontweight='bold')
        ax2.set_ylabel('RSI', fontsize=12)
        ax2.set_ylim(0, 100)
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        # Plot 3: Equity Curve
        ax3 = fig.add_subplot(gs[2, :])
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
        ax3.legend()
        ax3.grid(True, alpha=0.3)
        
        # Plot 4: Performance Metrics
        ax4 = fig.add_subplot(gs[3, 0])
        
        # Create performance metrics bar chart
        metrics = ['Win Rate', 'ROI', 'Sharpe', 'Max DD']
        sharpe_ratio = results.get('sharpe_ratio', 0) or 0
        max_drawdown = results.get('max_drawdown', 0) or 0
        values = [
            results['win_rate'] * 100,
            results['roi'],
            sharpe_ratio,
            max_drawdown
        ]
        
        colors = ['green' if v > 0 else 'red' for v in values]
        bars = ax4.bar(metrics, values, color=colors, alpha=0.7)
        ax4.set_title('Performance Metrics', fontsize=12, fontweight='bold')
        ax4.set_ylabel('Value', fontsize=10)
        ax4.grid(True, alpha=0.3)
        
        # Add value labels on bars
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax4.text(bar.get_x() + bar.get_width()/2., height,
                    f'{value:.1f}', ha='center', va='bottom' if height > 0 else 'top')
        
        # Plot 5: Trade Distribution
        ax5 = fig.add_subplot(gs[3, 1])
        
        # Create pie chart for trade distribution
        won_trades = results['won_trades']
        lost_trades = results['lost_trades']
        
        sizes = [won_trades, lost_trades]
        labels = ['Won', 'Lost']
        colors = ['green', 'red']
        
        ax5.pie(sizes, labels=labels, colors=colors, autopct='%1.1f%%', startangle=90)
        ax5.set_title('Trade Distribution', fontsize=12, fontweight='bold')
        
        # Format x-axis for all time-based plots
        for ax in [ax1, ax2, ax3]:
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
            ax.xaxis.set_major_locator(mdates.HourLocator(interval=2))
            plt.setp(ax.xaxis.get_majorticklabels(), rotation=45)
        
        # Add performance summary as text
        summary_text = f"""
        Strategy: {results['strategy_name']}
        Period: {results.get('period', 'N/A')}
        Total Trades: {results['total_trades']}
        Win Rate: {results['win_rate']:.1f}%
        ROI: {results['roi']:.1f}%
        Final Balance: ${results['final_cash']:.2f}
        Sharpe Ratio: {sharpe_ratio:.2f}
        Max Drawdown: {max_drawdown:.1f}%
        """
        
        fig.text(0.02, 0.02, summary_text, fontsize=10, 
                bbox=dict(boxstyle="round,pad=0.3", facecolor="lightblue", alpha=0.8))
        
        plt.tight_layout()
        
        # Save plot
        plt.savefig(plot_filename, dpi=150, bbox_inches='tight')
        print(f"📊 Complete analysis plot saved to: {plot_filename}")
        plt.close()
        
        return plot_filename
        
    except Exception as e:
        print(f"❌ Error creating complete plot: {e}")
        import traceback
        traceback.print_exc()
        return None

def main():
    """
    Run a complete backtest with comprehensive plotting
    """
    print("📊 BINARY OPTIONS BACKTESTER - COMPLETE PLOT EXAMPLE")
    print("=" * 70)
    
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
    print("\n" + "="*60)
    print("📊 STRATEGY RESULTS")
    print("="*60)
    print(f"Strategy: {results['strategy_name']}")
    print(f"Total Trades: {results['total_trades']}")
    print(f"Won Trades: {results['won_trades']}")
    print(f"Lost Trades: {results['lost_trades']}")
    print(f"Win Rate: {results['win_rate']:.2f}%")
    print(f"Total Profit: ${results['total_profit']:.2f}")
    print(f"Final Balance: ${results['final_cash']:.2f}")
    print(f"ROI: {results['roi']:.2f}%")
    sharpe_ratio = results.get('sharpe_ratio', 0) or 0
    max_drawdown = results.get('max_drawdown', 0) or 0
    print(f"Sharpe Ratio: {sharpe_ratio:.2f}")
    print(f"Max Drawdown: {max_drawdown:.2f}%")
    print("="*60)
    
    # Create complete plot
    print("\n📊 Creating complete analysis plot...")
    plot_filename = create_complete_plot(backtester, results)
    
    if plot_filename:
        print(f"✅ Complete analysis plot created successfully: {plot_filename}")
        
        # Performance evaluation
        print("\n🎯 PERFORMANCE EVALUATION:")
        if results['win_rate'] > 0.6:
            print("✅ Good win rate (>60%)")
        elif results['win_rate'] > 0.5:
            print("⚠️  Moderate win rate (50-60%)")
        else:
            print("❌ Low win rate (<50%)")
        
        if results['roi'] > 0:
            print("✅ Profitable strategy")
        else:
            print("❌ Loss-making strategy")
        
        sharpe_ratio = results.get('sharpe_ratio', 0) or 0
        if sharpe_ratio > 1.0:
            print("✅ Good risk-adjusted returns")
        elif sharpe_ratio > 0.5:
            print("⚠️  Moderate risk-adjusted returns")
        else:
            print("❌ Poor risk-adjusted returns")
        
        print(f"\n📊 Plot saved to: {plot_filename}")
        print("💡 Open the plot file to see the complete analysis!")
        
    else:
        print("❌ Failed to create complete plot")
    
    print("\n🎉 Complete plot example completed!")

if __name__ == "__main__":
    main()
