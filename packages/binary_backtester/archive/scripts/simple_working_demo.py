#!/usr/bin/env python3
"""
Simple Working Demo - Fixed version that works with Deriv data
"""

import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.rsi_strategy import RSIStrategy
from config.settings import Config
from datetime import datetime, timedelta

def main():
    """
    Simple working demo with RSI strategy only
    """
    print("🚀 BINARY OPTIONS BACKTESTER - SIMPLE WORKING DEMO")
    print("=" * 60)
    
    # Configuration
    config = Config(
        symbol='frxXAUUSD',
        timeframe=60,  # 1 minute
        initial_cash=10000.0,
        expiration_time=1,  # 1 minute expiration
        payout=0.8,  # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=3,  # 3 days of data (reduced for faster execution)
        rsi_period=14,
        rsi_oversold=30.0,
        rsi_overbought=70.0,
    )
    
    print("⚙️ Configuration:")
    print(f"   Symbol: {config.symbol}")
    print(f"   Timeframe: {config.timeframe}s")
    print(f"   Initial Cash: ${config.initial_cash:,.2f}")
    print(f"   Expiration: {config.expiration_time} minutes")
    print(f"   Payout: {config.payout*100:.0f}%")
    print(f"   Period: {config.start_date} to {config.end_date}")
    print(f"   Duration: {config.days_back} days")
    
    # Create backtester
    backtester = EnhancedBinaryBacktester(config)
    
    print("\n🔄 Running RSI Strategy backtest...")
    
    try:
        # Run RSI strategy
        results = backtester.run(RSIStrategy)
        
        print("\n📊 BACKTEST RESULTS:")
        print("=" * 40)
        print(f"   ROI: {results['roi']:.2f}%")
        print(f"   Win Rate: {results['win_rate']:.2f}%")
        print(f"   Total Trades: {results['total_trades']}")
        print(f"   Won Trades: {results['won_trades']}")
        print(f"   Lost Trades: {results['lost_trades']}")
        print(f"   Final Cash: ${results['final_cash']:,.2f}")
        print(f"   Total Profit: ${results['total_profit']:,.2f}")
        print(f"   Max Drawdown: {results['max_drawdown']:.2f}%")
        print(f"   Sharpe Ratio: {results['sharpe_ratio']:.2f}")
        print(f"   Profit Factor: {results['profit_factor']:.2f}")
        
        # Create plots
        print("\n📊 Creating plots...")
        
        # Comprehensive plot
        comp_plot = backtester.plot_results(
            plot_type='comprehensive',
            plot_filename="simple_demo_comprehensive.png"
        )
        if comp_plot:
            print(f"✅ Comprehensive plot: {comp_plot}")
        
        # Performance plot
        perf_plot = backtester.plot_results(
            plot_type='performance',
            plot_filename="simple_demo_performance.png"
        )
        if perf_plot:
            print(f"✅ Performance plot: {perf_plot}")
        
        # Export results
        export_file = backtester.export_results()
        if export_file:
            print(f"✅ Results exported: {export_file}")
        
        # Display performance summary
        print("\n" + backtester.get_performance_summary())
        
    except Exception as e:
        print(f"❌ Backtest failed: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n🎉 SIMPLE DEMO COMPLETED!")
    print("=" * 60)

if __name__ == "__main__":
    main()
