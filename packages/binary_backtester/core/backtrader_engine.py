"""
Backtrader engine integration for binary options
"""

import backtrader as bt
import pandas as pd
from typing import Type, Dict, Any, Optional
from datetime import datetime
import os

from .deriv_data_loader import DerivDataLoader
from .binary_trade_manager import BinaryTradeManager
from config.settings import Config

class BinaryBacktester:
    """
    Main backtester class that integrates Backtrader with binary options
    """
    
    def __init__(self, config: Config):
        self.config = config
        self.data_loader = DerivDataLoader()
        self.trade_manager = BinaryTradeManager(payout_rate=config.payout)
        self.cerebro = None
        self.results = None
    
    def setup_engine(self):
        """
        Setup Backtrader engine
        """
        # Create cerebro
        self.cerebro = bt.Cerebro()
        
        # Set initial cash
        self.cerebro.broker.set_cash(self.config.initial_cash)
        
        # Set commission (0 for binary options)
        self.cerebro.broker.setcommission(commission=0.0)
        
        # Add data
        data = self._load_data()
        self.cerebro.adddata(data)
        
        print(f"✅ Backtrader engine setup complete")
        print(f"   Initial cash: ${self.config.initial_cash}")
        print(f"   Symbol: {self.config.symbol}")
        print(f"   Timeframe: {self.config.timeframe}s")
        print(f"   Expiration: {self.config.expiration_time} minutes")
    
    def _load_data(self) -> bt.feeds.PandasData:
        """
        Load historical data
        """
        print(f"📊 Loading data for {self.config.symbol}...")
        
        # Load data from Deriv
        df = self.data_loader.load_historical_data(
            symbol=self.config.symbol,
            timeframe=self.config.timeframe,
            start_date=self.config.start_date,
            end_date=self.config.end_date
        )
        
        print(f"✅ Loaded {len(df)} candles")
        print(f"   Period: {df.index[0]} to {df.index[-1]}")
        
        # Convert to Backtrader format
        data = bt.feeds.PandasData(
            dataname=df,
            datetime=None,  # Use index
            open='open',
            high='high',
            low='low',
            close='close',
            volume='volume' if 'volume' in df.columns else None,
            timeframe=bt.TimeFrame.Minutes,
            compression=1
        )
        
        return data
    
    def run(self, strategy_class: Type, strategy_params: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Run backtest with given strategy
        """
        if self.cerebro is None:
            self.setup_engine()
        
        # Prepare strategy parameters
        strategy_params = strategy_params or {}
        strategy_params.update({
            'symbol': self.config.symbol,
            'expiration_time': self.config.expiration_time,
            'stake_amount': self.config.stake_amount,
            'payout_rate': self.config.payout,
            'rsi_period': self.config.rsi_period,
            'rsi_oversold': self.config.rsi_oversold,
            'rsi_overbought': self.config.rsi_overbought
        })
        
        # Add strategy
        self.cerebro.addstrategy(strategy_class, **strategy_params)
        
        # Add analyzers
        self.cerebro.addanalyzer(bt.analyzers.Returns, _name='returns')
        self.cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe')
        self.cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
        
        print(f"🚀 Running backtest with {strategy_class.__name__}...")
        
        # Run backtest
        self.results = self.cerebro.run()
        
        # Extract results
        strategy = self.results[0]
        analyzers = strategy.analyzers
        
        # Get strategy statistics
        strategy_stats = strategy.get_statistics()
        
        # Get analyzer results
        returns_analysis = analyzers.returns.get_analysis()
        sharpe_analysis = analyzers.sharpe.get_analysis()
        drawdown_analysis = analyzers.drawdown.get_analysis()
        
        # Compile final results
        final_results = {
            'strategy_name': strategy_class.__name__,
            'symbol': self.config.symbol,
            'timeframe': self.config.timeframe,
            'period': f"{self.config.start_date} to {self.config.end_date}",
            'initial_cash': self.config.initial_cash,
            'final_cash': self.cerebro.broker.get_cash(),
            'total_profit': strategy_stats['total_profit'],
            'total_trades': strategy_stats['total_trades'],
            'won_trades': strategy_stats['won_trades'],
            'lost_trades': strategy_stats['lost_trades'],
            'win_rate': strategy_stats['win_rate'],
            'roi': (strategy_stats['total_profit'] / self.config.initial_cash) * 100,
            'sharpe_ratio': sharpe_analysis.get('sharperatio', 0),
            'max_drawdown': drawdown_analysis.get('max', {}).get('drawdown', 0),
            'active_contracts': strategy_stats['active_contracts']
        }
        
        return final_results
    
    def plot_results(self, figsize: tuple = (12, 8), save_plot: bool = True, plot_filename: str = None):
        """
        Plot backtest results using Backtrader's plotting capabilities
        """
        if self.cerebro is None:
            raise ValueError("Must run backtest first")
        
        try:
            if save_plot:
                if plot_filename is None:
                    from datetime import datetime
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    plot_filename = f"backtest_plot_{timestamp}.png"
                
                # Configure matplotlib for file saving
                import matplotlib
                matplotlib.use('Agg')  # Use non-interactive backend
                
                # Use Backtrader's plotting with correct parameters
                self.cerebro.plot(
                    figsize=figsize,
                    style='candlestick',
                    barup='green',
                    bardown='red',
                    savefig=plot_filename,
                    dpi=100
                )
                print(f"📊 Plot saved to: {plot_filename}")
                return plot_filename
            else:
                # Try to show interactive plot
                self.cerebro.plot(
                    figsize=figsize,
                    style='candlestick',
                    barup='green',
                    bardown='red'
                )
                print("📊 Plot displayed successfully!")
        except Exception as e:
            print(f"⚠️  Could not generate plot: {e}")
            print("💡 Trying alternative plotting method...")
            
            # Try alternative plotting method
            try:
                return self._alternative_plot(save_plot, plot_filename)
            except Exception as e2:
                print(f"❌ Alternative plotting also failed: {e2}")
                return None
    
    def _alternative_plot(self, save_plot: bool = True, plot_filename: str = None):
        """
        Alternative plotting method using matplotlib directly
        """
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
        from datetime import datetime
        
        # Get data from cerebro
        data = self.cerebro.datas[0]
        
        # Create figure
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
        
        # Plot price data
        dates = [data.datetime.datetime(i) for i in range(len(data))]
        ax1.plot(dates, data.close, label='Close Price', linewidth=1)
        ax1.set_title('Price Chart')
        ax1.set_ylabel('Price')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        # Plot volume if available
        if hasattr(data, 'volume') and data.volume[0] is not None:
            ax2.bar(dates, data.volume, alpha=0.7, label='Volume')
            ax2.set_ylabel('Volume')
            ax2.legend()
        else:
            ax2.text(0.5, 0.5, 'No Volume Data', ha='center', va='center', transform=ax2.transAxes)
            ax2.set_ylabel('Volume')
        
        ax2.set_xlabel('Time')
        ax2.grid(True, alpha=0.3)
        
        # Format x-axis
        ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
        ax1.xaxis.set_major_locator(mdates.HourLocator(interval=1))
        plt.xticks(rotation=45)
        
        plt.tight_layout()
        
        if save_plot:
            if plot_filename is None:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                plot_filename = f"backtest_plot_{timestamp}.png"
            
            plt.savefig(plot_filename, dpi=100, bbox_inches='tight')
            print(f"📊 Alternative plot saved to: {plot_filename}")
            plt.close()
            return plot_filename
        else:
            plt.show()
            return True
    
    def save_results(self, filename: str = None):
        """
        Save results to file
        """
        if self.results is None:
            raise ValueError("Must run backtest first")
        
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"backtest_results_{timestamp}.json"
        
        import json
        
        # Get results
        results = self.run(self.results[0].__class__)
        
        # Save to file
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        print(f"💾 Results saved to {filename}")
        return filename
