#!/usr/bin/env python3
"""
Test Reversal Hunter Strategy with Python Backtrader
"""

import sys
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.reversal_hunter_strategy import ReversalHunterStrategy
from config.settings import Config

def load_deriv_data():
    """Load Deriv data for testing"""
    print("📊 Loading Deriv data...")
    
    # Try to find Deriv data files
    data_dir = Path(__file__).parent.parent / "data"
    data_files = list(data_dir.glob("deriv_candles_*.json"))
    
    if not data_files:
        print("❌ No Deriv data files found")
        return None
    
    # Use the most recent file
    latest_file = max(data_files, key=lambda f: f.stat().st_mtime)
    print(f"📁 Using data file: {latest_file.name}")
    
    try:
        with open(latest_file, 'r') as f:
            data = json.load(f)
        
        # Handle different data formats
        candles = []
        if isinstance(data, list):
            candles = data
        elif isinstance(data, dict):
            if 'candles' in data:
                candles = data['candles']
            elif 'data' in data:
                candles = data['data']
        
        print(f"✅ Loaded {len(candles)} candles")
        return candles
        
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return None

def run_reversal_hunter_backtest():
    """Run Reversal Hunter backtest"""
    print("🚀 REVERSAL HUNTER STRATEGY - PYTHON BACKTRADER")
    print("=" * 60)
    print("🎯 Testing Reversal Hunter with Python Backtrader")
    print("=" * 60)
    
    # Load data
    candles = load_deriv_data()
    if not candles:
        print("❌ Failed to load data")
        return
    
    # Configuration
    config = Config(
        symbol='frxXAUUSD',  # Gold
        timeframe=60,    # 1 minute
        initial_cash=1000.0,
        expiration_time=1,  # 1 minute expiration
        payout=0.8,     # 80% payout
        risk_per_trade=0.01,  # 1% risk per trade
        days_back=1,   # 1 day of data (based on available data)
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
    print(f"   Data Points: {len(candles)}")
    print("-" * 60)
    
    # Create backtester
    backtester = EnhancedBinaryBacktester(config)
    
    try:
        print("🚀 Starting Reversal Hunter backtest...")
        
        # Run backtest with Reversal Hunter strategy
        results = backtester.run(ReversalHunterStrategy,
                                min_confidence=0.001,
                                proximity_threshold=0.01,
                                atr_multiplier=0.5,
                                wick_multiplier=1.0,
                                engulfing_ratio=1.05,
                                ema_period=5,
                                atr_period=3,
                                rsi_period=3,
                                rsi_oversold=35,
                                rsi_overbought=65,
                                cooldown_seconds=0,
                                max_concurrent_trades=100,
                                min_strength_trade=1,
                                use_anti_martingale=True,
                                base_stake_percentage=0.01,
                                max_win_streak=3,
                                max_consecutive_losses=2,
                                strength_multiplier=0.2)
        
        print("\n" + "="*60)
        print("📊 REVERSAL HUNTER RESULTS")
        print("="*60)
        print(f"Total Trades: {results.get('total_trades', 0)}")
        print(f"Won Trades: {results.get('won_trades', 0)}")
        print(f"Lost Trades: {results.get('lost_trades', 0)}")
        print(f"Win Rate: {results.get('win_rate', 0):.2f}%")
        print(f"Total Profit: {results.get('total_profit', 0):.2f}")
        print(f"Final Balance: {results.get('final_cash', 0):.2f}")
        print(f"ROI: {results.get('roi', 0):.2f}%")
        print(f"Max Drawdown: {results.get('max_drawdown', 0):.2f}%")
        print(f"Sharpe Ratio: {results.get('sharpe_ratio', 0):.2f}")
        print(f"Profit Factor: {results.get('profit_factor', 0):.2f}")
        print("="*60)
        
        # Calculate trades per day
        total_days = config.days_back
        trades_per_day = results.get('total_trades', 0) / total_days if total_days > 0 else 0
        print(f"\n📈 FREQUENCY ANALYSIS:")
        print(f"Trades per Day: {trades_per_day:.2f}")
        print(f"Target: 5-10 trades/day")
        print(f"Status: {'✅ ACHIEVED' if 5 <= trades_per_day <= 10 else '❌ NEEDS OPTIMIZATION'}")
        
        # Generate plot
        print("\n📊 Creating plot...")
        plot_filename = f"reversal_hunter_plot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        backtester.plot_results(plot_filename=plot_filename)
        print(f"✅ Plot saved to: {plot_filename}")
        
        # Save results
        results_file = f"reversal_hunter_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"💾 Results saved to: {results_file}")
        
        print("\n🎯 REVERSAL HUNTER BACKTEST COMPLETED!")
        print("✅ Python Backtrader engine")
        print("✅ Reversal Hunter strategy")
        print("✅ Anti-Martingale system")
        print("✅ Price action patterns")
        print("✅ Interactive plotting")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Backtest failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    run_reversal_hunter_backtest()
