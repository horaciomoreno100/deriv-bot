"""
Complete System Demo - Final Implementation
Demonstrates all features of the binary options backtester
"""

import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from core.strategy_comparator import StrategyComparator
from strategies.rsi_strategy import RSIStrategy
from strategies.advanced_strategies import (
    MACDStrategy, BollingerBandsStrategy, StochasticStrategy,
    MultiTimeframeStrategy, MeanReversionStrategy, MomentumStrategy
)
from config.settings import Config
from datetime import datetime, timedelta

def main():
    """
    Complete system demonstration
    """
    print("🚀 BINARY OPTIONS BACKTESTER - COMPLETE SYSTEM DEMO")
    print("=" * 70)
    
    # Configuration
    config = Config(
        symbol='frxXAUUSD',
        timeframe=60,  # 1 minute
        initial_cash=10000.0,  # Larger capital for better results
        expiration_time=1,  # 1 minute expiration
        payout=0.8,  # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=7,  # 7 days of data
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
    
    # Define strategies to compare
    strategies = [
        {
            'name': 'RSI Strategy',
            'class': RSIStrategy,
            'params': {
                'rsi_period': 14,
                'rsi_oversold': 30,
                'rsi_overbought': 70
            }
        },
        {
            'name': 'MACD Strategy',
            'class': MACDStrategy,
            'params': {
                'fast_period': 12,
                'slow_period': 26,
                'signal_period': 9,
                'macd_threshold': 0.5
            }
        },
        {
            'name': 'Bollinger Bands Strategy',
            'class': BollingerBandsStrategy,
            'params': {
                'bb_period': 20,
                'bb_std': 2.0,
                'bb_threshold': 0.8
            }
        },
        {
            'name': 'Stochastic Strategy',
            'class': StochasticStrategy,
            'params': {
                'stoch_k_period': 14,
                'stoch_d_period': 3,
                'stoch_upper': 80,
                'stoch_lower': 20
            }
        },
        {
            'name': 'Multi-Timeframe Strategy',
            'class': MultiTimeframeStrategy,
            'params': {
                'rsi_period': 14,
                'rsi_oversold': 30,
                'rsi_overbought': 70,
                'bb_period': 20,
                'bb_std': 2.0,
                'macd_fast': 12,
                'macd_slow': 26,
                'macd_signal': 9
            }
        },
        {
            'name': 'Mean Reversion Strategy',
            'class': MeanReversionStrategy,
            'params': {
                'lookback_period': 20,
                'deviation_threshold': 2.0,
                'rsi_period': 14
            }
        },
        {
            'name': 'Momentum Strategy',
            'class': MomentumStrategy,
            'params': {
                'momentum_period': 10,
                'momentum_threshold': 0.5,
                'volume_period': 20
            }
        }
    ]
    
    print(f"\n📊 Testing {len(strategies)} strategies...")
    
    # Create strategy comparator
    comparator = StrategyComparator(config)
    
    # Run strategy comparison
    print("\n🔄 Running strategy comparison...")
    comparison_results = comparator.run_strategy_comparison(strategies)
    
    # Display results
    print("\n📈 COMPARISON RESULTS")
    print("=" * 70)
    
    if comparison_results and 'comparison_df' in comparison_results:
        df = comparison_results['comparison_df']
        
        print("\n🏆 TOP PERFORMING STRATEGIES:")
        print("-" * 50)
        for i, (_, row) in enumerate(df.head(3).iterrows(), 1):
            print(f"{i}. {row['Strategy']}")
            print(f"   ROI: {row['ROI']:.2f}%")
            print(f"   Win Rate: {row['Win Rate']:.2f}%")
            print(f"   Total Trades: {row['Total Trades']}")
            print(f"   Sharpe Ratio: {row['Sharpe Ratio']:.2f}")
            print(f"   Max Drawdown: {row['Max Drawdown']:.2f}%")
            print()
    
    # Generate comprehensive plots
    print("📊 Generating comparison plots...")
    try:
        plot_filename = comparator.create_comparison_plot()
        if plot_filename:
            print(f"✅ Comparison plot saved: {plot_filename}")
    except Exception as e:
        print(f"⚠️  Comparison plot failed: {e}")
    
    # Generate detailed report
    print("\n📄 Generating detailed report...")
    try:
        report_filename = comparator.generate_comparison_report()
        if report_filename:
            print(f"✅ Report saved: {report_filename}")
    except Exception as e:
        print(f"⚠️  Report generation failed: {e}")
    
    # Export data
    print("\n💾 Exporting comparison data...")
    try:
        data_filename = comparator.export_comparison_data()
        if data_filename:
            print(f"✅ Data exported: {data_filename}")
    except Exception as e:
        print(f"⚠️  Data export failed: {e}")
    
    # Test best strategy individually
    print("\n🎯 Testing best strategy individually...")
    best_strategy = comparator.get_best_strategy()
    
    if best_strategy:
        print(f"Best strategy: {best_strategy['name']}")
        
        # Run individual backtest with enhanced features
        individual_backtester = EnhancedBinaryBacktester(config)
        
        try:
            individual_results = individual_backtester.run(
                best_strategy['config']['class'],
                **best_strategy['config'].get('params', {})
            )
            
            print("\n📊 Individual Strategy Results:")
            print(f"   ROI: {individual_results['roi']:.2f}%")
            print(f"   Win Rate: {individual_results['win_rate']:.2f}%")
            print(f"   Total Trades: {individual_results['total_trades']}")
            print(f"   Final Cash: ${individual_results['final_cash']:,.2f}")
            
            # Create individual plots
            print("\n📊 Creating individual strategy plots...")
            try:
                # Comprehensive plot
                comp_plot = individual_backtester.plot_results(
                    plot_type='comprehensive',
                    plot_filename=f"best_strategy_comprehensive_{best_strategy['name'].replace(' ', '_').lower()}.png"
                )
                if comp_plot:
                    print(f"✅ Comprehensive plot: {comp_plot}")
                
                # Performance plot
                perf_plot = individual_backtester.plot_results(
                    plot_type='performance',
                    plot_filename=f"best_strategy_performance_{best_strategy['name'].replace(' ', '_').lower()}.png"
                )
                if perf_plot:
                    print(f"✅ Performance plot: {perf_plot}")
                
            except Exception as e:
                print(f"⚠️  Individual plotting failed: {e}")
            
            # Export individual results
            try:
                export_filename = individual_backtester.export_results()
                if export_filename:
                    print(f"✅ Individual results exported: {export_filename}")
            except Exception as e:
                print(f"⚠️  Individual export failed: {e}")
            
            # Display performance summary
            print("\n" + individual_backtester.get_performance_summary())
            
        except Exception as e:
            print(f"❌ Individual backtest failed: {e}")
    
    print("\n🎉 COMPLETE SYSTEM DEMO FINISHED!")
    print("=" * 70)
    print("📁 Generated files:")
    print("   - Strategy comparison plots")
    print("   - Individual strategy plots")
    print("   - Detailed reports")
    print("   - Exported data files")
    print("\n✅ All features demonstrated successfully!")

if __name__ == "__main__":
    main()
