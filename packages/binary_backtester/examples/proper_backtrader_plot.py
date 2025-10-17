"""
Proper Backtrader plotting implementation using official documentation
"""

import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.backtrader_engine import BinaryBacktester
from strategies.rsi_strategy import RSIStrategy
from config.settings import Config
from datetime import datetime, timedelta
import matplotlib
import matplotlib.pyplot as plt

def main():
    """
    Run a backtest with proper Backtrader plotting
    """
    print("📊 BINARY OPTIONS BACKTESTER - PROPER BACKTRADER PLOTTING")
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

    # Print results
    print("\n📈 Results Summary:")
    print(f"   Initial Cash: ${results['initial_cash']:.2f}")
    print(f"   Final Value: ${results.get('final_value', results.get('final_cash', 0)):.2f}")
    print(f"   Total Profit: ${results.get('total_profit', 0):.2f}")
    print(f"   ROI: {results.get('roi', 0):.2f}%")
    print(f"   Total Trades: {results.get('total_trades', 0)}")
    print(f"   Win Rate: {results.get('win_rate', 0):.2f}%")

    # Proper Backtrader plotting using official documentation
    print("\n📊 Creating proper Backtrader plot...")
    
    try:
        # Set matplotlib backend to avoid display issues
        matplotlib.use('Agg')
        
        # Use Backtrader's built-in plotting with proper configuration
        # According to documentation: cerebro.plot(plotter=None, numfigs=1, iplot=True, **kwargs)
        
        # Method 1: Basic plotting with savefig
        print("   Method 1: Basic plotting with savefig...")
        try:
            backtester.cerebro.plot(
                iplot=False,  # Don't show interactive plot
                style='candlestick',  # Use candlestick style
                barup='green',  # Green for bullish bars
                bardown='red',   # Red for bearish bars
                volume=True,     # Show volume
                grid=True,       # Show grid
                savefig='proper_backtrader_plot_method1.png'
            )
            print("   ✅ Method 1 successful: proper_backtrader_plot_method1.png")
        except Exception as e:
            print(f"   ❌ Method 1 failed: {e}")

        # Method 2: Plotting with custom PlotScheme
        print("   Method 2: Custom PlotScheme...")
        try:
            from backtrader import plot
            
            # Create custom plot scheme
            plot_scheme = plot.PlotScheme()
            plot_scheme.style = 'candlestick'
            plot_scheme.barup = 'green'
            plot_scheme.bardown = 'red'
            plot_scheme.volume = True
            plot_scheme.grid = True
            plot_scheme.legendind = True
            plot_scheme.linevalues = True
            plot_scheme.valuetags = True
            
            backtester.cerebro.plot(
                plotter=plot_scheme,
                iplot=False,
                savefig='proper_backtrader_plot_method2.png'
            )
            print("   ✅ Method 2 successful: proper_backtrader_plot_method2.png")
        except Exception as e:
            print(f"   ❌ Method 2 failed: {e}")

        # Method 3: Multiple figures
        print("   Method 3: Multiple figures...")
        try:
            backtester.cerebro.plot(
                iplot=False,
                numfigs=2,  # Split into 2 figures
                style='line',  # Line style
                savefig='proper_backtrader_plot_method3.png'
            )
            print("   ✅ Method 3 successful: proper_backtrader_plot_method3.png")
        except Exception as e:
            print(f"   ❌ Method 3 failed: {e}")

        # Method 4: Minimal plotting
        print("   Method 4: Minimal plotting...")
        try:
            backtester.cerebro.plot(
                iplot=False,
                style='line',
                volume=False,
                grid=False,
                savefig='proper_backtrader_plot_method4.png'
            )
            print("   ✅ Method 4 successful: proper_backtrader_plot_method4.png")
        except Exception as e:
            print(f"   ❌ Method 4 failed: {e}")

    except Exception as e:
        print(f"❌ Error in plotting: {e}")
        print("💡 This might be due to data issues or matplotlib configuration")

    print("\n🎯 Plotting completed!")
    print("=" * 70)

if __name__ == "__main__":
    main()

