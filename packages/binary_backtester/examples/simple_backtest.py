"""
Simple backtest example for binary options MVP
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
    Run a simple backtest example
    """
    print("🎯 BINARY OPTIONS BACKTESTER MVP")
    print("=" * 50)
    
    # Configuration
    config = Config(
        symbol='frxXAUUSD',
        timeframe=60,  # 1 minute
        initial_cash=1000.0,
        expiration_time=1,  # 1 minute expiration
        payout=0.8,  # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=7,  # 7 days of data
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
    print(f"   Risk per Trade: {config.risk_per_trade:.1%}")
    print(f"   Stake Amount: ${config.stake_amount}")
    print(f"   Period: {config.start_date} to {config.end_date}")
    print()
    
    # Create backtester
    backtester = BinaryBacktester(config)
    
    # Run backtest
    print("🚀 Starting backtest...")
    results = backtester.run(RSIStrategy)
    
    # Generate plots
    try:
        print("\n📊 Generating plots...")
        backtester.plot_results()
        print("✅ Plots generated successfully!")
    except Exception as e:
        print(f"⚠️  Could not generate plots: {e}")
        print("💡 Make sure you have matplotlib installed and a display available")
    
    # Display results
    print("\n" + "=" * 50)
    print("📊 BACKTEST RESULTS")
    print("=" * 50)
    print(f"Strategy: {results['strategy_name']}")
    print(f"Symbol: {results['symbol']}")
    print(f"Period: {results['period']}")
    print()
    print(f"💰 Financial Results:")
    print(f"   Initial Cash: ${results['initial_cash']:.2f}")
    print(f"   Final Cash: ${results['final_cash']:.2f}")
    print(f"   Total Profit: ${results['total_profit']:.2f}")
    print(f"   ROI: {results['roi']:.2f}%")
    print()
    print(f"📈 Trading Statistics:")
    print(f"   Total Trades: {results['total_trades']}")
    print(f"   Won Trades: {results['won_trades']}")
    print(f"   Lost Trades: {results['lost_trades']}")
    print(f"   Win Rate: {results['win_rate']:.2%}")
    print()
    print(f"📊 Risk Metrics:")
    sharpe_ratio = results.get('sharpe_ratio', 0) or 0
    max_drawdown = results.get('max_drawdown', 0) or 0
    active_contracts = results.get('active_contracts', 0) or 0
    print(f"   Sharpe Ratio: {sharpe_ratio:.2f}")
    print(f"   Max Drawdown: {max_drawdown:.2f}%")
    print(f"   Active Contracts: {active_contracts}")
    print("=" * 50)
    
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
    
    print("\n🎉 Backtest completed successfully!")
    
    # Optional: Save results
    try:
        filename = backtester.save_results()
        print(f"💾 Results saved to {filename}")
    except Exception as e:
        print(f"⚠️  Could not save results: {e}")

if __name__ == "__main__":
    main()
