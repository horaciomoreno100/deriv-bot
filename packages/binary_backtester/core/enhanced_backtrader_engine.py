"""
Enhanced Backtrader Engine for Binary Options - Final Implementation
"""

import backtrader as bt
import pandas as pd
import numpy as np
from typing import Type, Dict, Any, Optional, List, Tuple
from datetime import datetime, timedelta
import matplotlib
import matplotlib.pyplot as plt
import os
import json
from dataclasses import dataclass, asdict

from .deriv_data_loader import DerivDataLoader
from .binary_trade_manager import BinaryTradeManager, BinaryContract
from config.settings import Config

@dataclass
class BacktestMetrics:
    """Comprehensive backtest metrics"""
    # Basic metrics
    initial_cash: float
    final_cash: float
    total_profit: float
    roi: float
    total_trades: int
    won_trades: int
    lost_trades: int
    win_rate: float
    
    # Risk metrics
    max_drawdown: float
    sharpe_ratio: float
    profit_factor: float
    average_win: float
    average_loss: float
    largest_win: float
    largest_loss: float
    
    # Time metrics
    start_date: datetime
    end_date: datetime
    duration_days: float
    
    # Strategy specific
    strategy_name: str
    symbol: str
    timeframe: int
    expiration_time: int
    payout_rate: float

class EnhancedBinaryBacktester:
    """
    Enhanced backtester with advanced features for binary options
    """

    def __init__(self, config: Config):
        self.config = config
        self.data_loader = DerivDataLoader()
        self.trade_manager = BinaryTradeManager(payout_rate=config.payout)
        self.cerebro = None
        self.results = None
        self.metrics = None
        
        # Performance tracking
        self.equity_curve = []
        self.drawdown_curve = []
        self.trade_history = []

    def setup_engine(self):
        """Setup enhanced Backtrader engine with optimizations"""
        # Create cerebro with optimizations
        self.cerebro = bt.Cerebro()
        
        # Set initial cash
        self.cerebro.broker.setcash(self.config.initial_cash)
        
        # Use standard broker with custom commission
        self.cerebro.broker.setcommission(commission=0.0)
        
        # Load and prepare data
        df = self.data_loader.load_historical_data(
            symbol=self.config.symbol,
            timeframe=self.config.timeframe,
            start_date=self.config.start_date,
            end_date=self.config.end_date
        )
        
        # Convert DataFrame to Backtrader data feed with optimizations
        data = bt.feeds.PandasData(
            dataname=df,
            datetime=None,
            open='open',
            high='high',
            low='low',
            close='close',
            volume='volume',
            openinterest=None
        )
        
        # Add data to cerebro
        self.cerebro.adddata(data)
        
        # Add observers for enhanced tracking
        self.cerebro.addobserver(bt.observers.Broker)
        self.cerebro.addobserver(bt.observers.Trades)
        self.cerebro.addobserver(bt.observers.BuySell)
        
        print(f"✅ Enhanced engine setup complete")
        print(f"   Initial cash: ${self.config.initial_cash}")
        print(f"   Symbol: {self.config.symbol}")
        print(f"   Timeframe: {self.config.timeframe}s")
        print(f"   Data points: {len(df)}")

    def add_strategy(self, strategy_class: Type[bt.Strategy], **kwargs):
        """Add strategy with enhanced configuration"""
        if self.cerebro is None:
            self.setup_engine()
        
        # Add strategy with parameters
        self.cerebro.addstrategy(strategy_class, **kwargs)
        print(f"✅ Strategy {strategy_class.__name__} added")

    def run(self, strategy_class: Type[bt.Strategy], **kwargs) -> Dict[str, Any]:
        """Run enhanced backtest with comprehensive metrics"""
        self.setup_engine()
        self.add_strategy(strategy_class, **kwargs)
        
        print(f"🚀 Starting enhanced backtest...")
        start_time = datetime.now()
        
        # Run backtest
        self.results = self.cerebro.run()
        end_time = datetime.now()
        
        print(f"✅ Backtest completed in {(end_time - start_time).total_seconds():.2f}s")
        
        # Calculate comprehensive metrics
        self.metrics = self._calculate_metrics()
        
        # Store results
        self._store_results()
        
        return self.metrics.__dict__

    def _calculate_metrics(self) -> BacktestMetrics:
        """Calculate comprehensive backtest metrics"""
        strat = self.results[0]
        final_cash = self.cerebro.broker.getvalue()
        initial_cash = self.config.initial_cash
        total_profit = final_cash - initial_cash
        roi = (total_profit / initial_cash) * 100 if initial_cash != 0 else 0
        
        # Get trade manager stats
        # trade_stats = self.trade_manager.get_stats()  # Not used, commented out
        
        # Calculate advanced metrics
        max_drawdown = self._calculate_max_drawdown()
        sharpe_ratio = self._calculate_sharpe_ratio()
        profit_factor = self._calculate_profit_factor()
        
        # Calculate win/loss statistics (handle different attribute names)
        won_trades = getattr(strat, 'won_trades', getattr(strat, 'wins', 0))
        lost_trades = getattr(strat, 'lost_trades', getattr(strat, 'losses', 0))
        total_trades = getattr(strat, 'total_trades', getattr(strat, 'trades_executed', won_trades + lost_trades))
        win_rate = (won_trades / total_trades) * 100 if total_trades > 0 else 0

        # Calculate average win/loss
        total_profit = getattr(strat, 'total_profit', 0)
        average_win = total_profit / won_trades if won_trades > 0 else 0
        average_loss = abs(total_profit - (average_win * won_trades)) / lost_trades if lost_trades > 0 else 0
        
        # ENHANCED: Get detailed statistics from strategy if available
        detailed_trades = []
        if hasattr(strat, 'get_statistics'):
            strategy_stats = strat.get_statistics()
            detailed_trades = strategy_stats.get('detailed_trades', [])

        metrics = BacktestMetrics(
            initial_cash=initial_cash,
            final_cash=final_cash,
            total_profit=total_profit,
            roi=roi,
            total_trades=total_trades,
            won_trades=won_trades,
            lost_trades=lost_trades,
            win_rate=win_rate,
            max_drawdown=max_drawdown,
            sharpe_ratio=sharpe_ratio,
            profit_factor=profit_factor,
            average_win=average_win,
            average_loss=average_loss,
            largest_win=average_win,  # Simplified for now
            largest_loss=average_loss,  # Simplified for now
            start_date=self.config.start_date,
            end_date=self.config.end_date,
            duration_days=(self.config.end_date - self.config.start_date).days,
            strategy_name=strat.__class__.__name__,
            symbol=self.config.symbol,
            timeframe=self.config.timeframe,
            expiration_time=self.config.expiration_time,
            payout_rate=self.config.payout
        )

        # ENHANCED: Add detailed trades to metrics
        metrics.detailed_trades = detailed_trades

        return metrics

    def _calculate_max_drawdown(self) -> float:
        """Calculate maximum drawdown"""
        if not self.equity_curve:
            return 0.0
        
        peak = self.equity_curve[0]
        max_dd = 0.0
        
        for value in self.equity_curve:
            if value > peak:
                peak = value
            drawdown = (peak - value) / peak * 100
            max_dd = max(max_dd, drawdown)
        
        return max_dd

    def _calculate_sharpe_ratio(self) -> float:
        """Calculate Sharpe ratio"""
        if len(self.equity_curve) < 2:
            return 0.0
        
        returns = np.diff(self.equity_curve) / self.equity_curve[:-1]
        if len(returns) == 0 or np.std(returns) == 0:
            return 0.0
        
        return np.mean(returns) / np.std(returns) * np.sqrt(252)  # Annualized

    def _calculate_profit_factor(self) -> float:
        """Calculate profit factor"""
        if not self.trade_history:
            return 0.0
        
        gross_profit = sum(trade['pnl'] for trade in self.trade_history if trade['pnl'] > 0)
        gross_loss = abs(sum(trade['pnl'] for trade in self.trade_history if trade['pnl'] < 0))
        
        return gross_profit / gross_loss if gross_loss > 0 else 0.0

    def _store_results(self):
        """Store results for analysis"""
        # Store equity curve
        self.equity_curve = [self.config.initial_cash]
        # Add more sophisticated equity curve tracking here
        
        # Store trade history
        self.trade_history = []  # self.trade_manager.get_all_trades() - not implemented yet

    def plot_results(self, 
                    plot_type: str = 'comprehensive',
                    save_plot: bool = True,
                    plot_filename: str = None) -> str:
        """
        Create comprehensive plots with multiple visualization options
        """
        if self.cerebro is None:
            raise ValueError("Must run backtest first")
        
        print(f"📊 Creating {plot_type} plot...")
        
        try:
            # Set matplotlib backend
            matplotlib.use('Agg')
            
            if plot_type == 'comprehensive':
                return self._create_comprehensive_plot(save_plot, plot_filename)
            elif plot_type == 'simple':
                return self._create_simple_plot(save_plot, plot_filename)
            elif plot_type == 'performance':
                return self._create_performance_plot(save_plot, plot_filename)
            else:
                return self._create_simple_plot(save_plot, plot_filename)
                
        except Exception as e:
            print(f"⚠️  Plotting error: {e}")
            return None

    def _create_comprehensive_plot(self, save_plot: bool, plot_filename: str) -> str:
        """Create comprehensive multi-panel plot"""
        if plot_filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            plot_filename = f"comprehensive_backtest_{timestamp}.png"
        
        # Create figure with subplots
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        fig.suptitle(f'Binary Options Backtest - {self.config.symbol}', fontsize=16, fontweight='bold')
        
        # Get data
        data = self.cerebro.datas[0]
        dates = [data.datetime.datetime(i) for i in range(len(data))]
        prices = [data.close[i] for i in range(len(data))]
        
        # Plot 1: Price chart with trades
        ax1 = axes[0, 0]
        ax1.plot(dates, prices, 'b-', linewidth=1, label='Price')
        ax1.set_title('Price Chart with Trades')
        ax1.set_ylabel('Price')
        ax1.grid(True, alpha=0.3)
        
        # Plot 2: Equity curve
        ax2 = axes[0, 1]
        if self.equity_curve:
            ax2.plot(range(len(self.equity_curve)), self.equity_curve, 'g-', linewidth=2)
        ax2.set_title('Equity Curve')
        ax2.set_ylabel('Balance')
        ax2.grid(True, alpha=0.3)
        
        # Plot 3: Performance metrics
        ax3 = axes[1, 0]
        metrics = ['Win Rate', 'ROI', 'Sharpe', 'Max DD']
        values = [
            self.metrics.win_rate,
            self.metrics.roi,
            self.metrics.sharpe_ratio,
            self.metrics.max_drawdown
        ]
        bars = ax3.bar(metrics, values, color=['green' if v > 0 else 'red' for v in values])
        ax3.set_title('Performance Metrics')
        ax3.set_ylabel('Value')
        
        # Add value labels on bars
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax3.text(bar.get_x() + bar.get_width()/2., height,
                    f'{value:.2f}', ha='center', va='bottom')
        
        # Plot 4: Trade distribution
        ax4 = axes[1, 1]
        if self.trade_history:
            pnl_values = [trade['pnl'] for trade in self.trade_history]
            ax4.hist(pnl_values, bins=20, alpha=0.7, color='blue', edgecolor='black')
            ax4.set_title('Trade P&L Distribution')
            ax4.set_xlabel('P&L')
            ax4.set_ylabel('Frequency')
            ax4.grid(True, alpha=0.3)
        
        plt.tight_layout()
        
        if save_plot:
            plt.savefig(plot_filename, dpi=300, bbox_inches='tight')
            print(f"📊 Comprehensive plot saved: {plot_filename}")
        
        plt.close()
        return plot_filename

    def _create_simple_plot(self, save_plot: bool, plot_filename: str) -> str:
        """Create simple plot using Backtrader's built-in plotting"""
        if plot_filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            plot_filename = f"simple_backtest_{timestamp}.png"
        
        try:
            self.cerebro.plot(
                iplot=False,
                style='line',
                volume=False,
                grid=False,
                savefig=plot_filename
            )
            print(f"📊 Simple plot saved: {plot_filename}")
            return plot_filename
        except Exception as e:
            print(f"⚠️  Simple plot failed: {e}")
            return None

    def _create_performance_plot(self, save_plot: bool, plot_filename: str) -> str:
        """Create performance-focused plot"""
        if plot_filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            plot_filename = f"performance_backtest_{timestamp}.png"
        
        fig, axes = plt.subplots(1, 3, figsize=(18, 6))
        fig.suptitle(f'Performance Analysis - {self.config.symbol}', fontsize=16, fontweight='bold')
        
        # Equity curve
        axes[0].plot(self.equity_curve if self.equity_curve else [self.config.initial_cash])
        axes[0].set_title('Equity Curve')
        axes[0].set_ylabel('Balance')
        axes[0].grid(True, alpha=0.3)
        
        # Drawdown
        if self.drawdown_curve:
            axes[1].fill_between(range(len(self.drawdown_curve)), self.drawdown_curve, 0, alpha=0.3, color='red')
            axes[1].set_title('Drawdown')
            axes[1].set_ylabel('Drawdown %')
            axes[1].grid(True, alpha=0.3)
        
        # Monthly returns
        axes[2].bar(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], 
                   [self.metrics.roi/6] * 6, alpha=0.7)
        axes[2].set_title('Monthly Returns (Simulated)')
        axes[2].set_ylabel('Return %')
        axes[2].grid(True, alpha=0.3)
        
        plt.tight_layout()
        
        if save_plot:
            plt.savefig(plot_filename, dpi=300, bbox_inches='tight')
            print(f"📊 Performance plot saved: {plot_filename}")
        
        plt.close()
        return plot_filename

    def export_results(self, filename: str = None) -> str:
        """Export results to JSON file"""
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"backtest_results_{timestamp}.json"
        
        # Convert metrics to dictionary
        results_dict = asdict(self.metrics)
        
        # Add additional data
        results_dict['trade_history'] = self.trade_history
        results_dict['equity_curve'] = self.equity_curve
        
        # Save to file
        with open(filename, 'w') as f:
            json.dump(results_dict, f, indent=2, default=str)
        
        print(f"📄 Results exported to: {filename}")
        return filename

    def get_performance_summary(self) -> str:
        """Get formatted performance summary"""
        if not self.metrics:
            return "No backtest results available"
        
        summary = f"""
🎯 BINARY OPTIONS BACKTEST RESULTS
{'='*50}
Strategy: {self.metrics.strategy_name}
Symbol: {self.metrics.symbol}
Period: {self.metrics.start_date.strftime('%Y-%m-%d')} to {self.metrics.end_date.strftime('%Y-%m-%d')}
Duration: {self.metrics.duration_days:.1f} days

💰 FINANCIAL METRICS
{'='*50}
Initial Cash: ${self.metrics.initial_cash:,.2f}
Final Cash: ${self.metrics.final_cash:,.2f}
Total Profit: ${self.metrics.total_profit:,.2f}
ROI: {self.metrics.roi:.2f}%

📊 TRADING METRICS
{'='*50}
Total Trades: {self.metrics.total_trades}
Won Trades: {self.metrics.won_trades}
Lost Trades: {self.metrics.lost_trades}
Win Rate: {self.metrics.win_rate:.2f}%

📈 RISK METRICS
{'='*50}
Max Drawdown: {self.metrics.max_drawdown:.2f}%
Sharpe Ratio: {self.metrics.sharpe_ratio:.2f}
Profit Factor: {self.metrics.profit_factor:.2f}
Average Win: ${self.metrics.average_win:.2f}
Average Loss: ${self.metrics.average_loss:.2f}

⚙️ CONFIGURATION
{'='*50}
Timeframe: {self.metrics.timeframe}s
Expiration: {self.metrics.expiration_time} minutes
Payout Rate: {self.metrics.payout_rate*100:.0f}%
        """
        
        return summary

# Note: Using standard Backtrader broker with binary options logic in strategies
