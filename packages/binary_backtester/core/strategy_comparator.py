"""
Strategy Comparison System for Binary Options
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from typing import List, Dict, Any, Tuple
from datetime import datetime
import json
import os

from .enhanced_backtrader_engine import EnhancedBinaryBacktester, BacktestMetrics
from config.settings import Config

class StrategyComparator:
    """
    Compare multiple strategies and generate comprehensive reports
    """
    
    def __init__(self, config: Config):
        self.config = config
        self.results = {}
        self.comparison_data = None
        
    def run_strategy_comparison(self, strategies: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Run multiple strategies and compare results
        
        Args:
            strategies: List of strategy configurations
            [
                {
                    'name': 'RSI Strategy',
                    'class': RSIStrategy,
                    'params': {'rsi_period': 14, 'rsi_oversold': 30}
                },
                ...
            ]
        """
        print(f"🔄 Running strategy comparison with {len(strategies)} strategies...")
        
        for strategy_config in strategies:
            print(f"\n📊 Testing {strategy_config['name']}...")
            
            # Create backtester
            backtester = EnhancedBinaryBacktester(self.config)
            
            # Run backtest
            try:
                results = backtester.run(
                    strategy_config['class'], 
                    **strategy_config.get('params', {})
                )
                
                # Store results
                self.results[strategy_config['name']] = {
                    'metrics': results,
                    'backtester': backtester,
                    'strategy_config': strategy_config
                }
                
                print(f"✅ {strategy_config['name']} completed successfully")
                
            except Exception as e:
                print(f"❌ {strategy_config['name']} failed: {e}")
                self.results[strategy_config['name']] = {
                    'error': str(e),
                    'strategy_config': strategy_config
                }
        
        # Generate comparison
        self.comparison_data = self._generate_comparison_data()
        
        return self.comparison_data
    
    def _generate_comparison_data(self) -> Dict[str, Any]:
        """Generate comprehensive comparison data"""
        if not self.results:
            return {}
        
        # Create comparison DataFrame
        comparison_df = pd.DataFrame()
        
        for strategy_name, result in self.results.items():
            if 'error' in result:
                continue
                
            metrics = result['metrics']
            
            # Extract key metrics
            strategy_data = {
                'Strategy': strategy_name,
                'ROI': metrics.get('roi', 0),
                'Win Rate': metrics.get('win_rate', 0),
                'Total Trades': metrics.get('total_trades', 0),
                'Max Drawdown': metrics.get('max_drawdown', 0),
                'Sharpe Ratio': metrics.get('sharpe_ratio', 0),
                'Profit Factor': metrics.get('profit_factor', 0),
                'Final Cash': metrics.get('final_cash', 0),
                'Total Profit': metrics.get('total_profit', 0)
            }
            
            comparison_df = pd.concat([comparison_df, pd.DataFrame([strategy_data])], 
                                    ignore_index=True)
        
        # Sort by ROI
        comparison_df = comparison_df.sort_values('ROI', ascending=False)
        
        # Calculate rankings
        comparison_df['ROI Rank'] = comparison_df['ROI'].rank(ascending=False)
        comparison_df['Win Rate Rank'] = comparison_df['Win Rate'].rank(ascending=False)
        comparison_df['Sharpe Rank'] = comparison_df['Sharpe Ratio'].rank(ascending=False)
        
        # Calculate composite score
        comparison_df['Composite Score'] = (
            comparison_df['ROI Rank'] * 0.4 +
            comparison_df['Win Rate Rank'] * 0.3 +
            comparison_df['Sharpe Rank'] * 0.3
        )
        
        return {
            'comparison_df': comparison_df,
            'best_strategy': comparison_df.iloc[0]['Strategy'] if len(comparison_df) > 0 else None,
            'total_strategies': len(comparison_df)
        }
    
    def create_comparison_plot(self, save_plot: bool = True, 
                             plot_filename: str = None) -> str:
        """Create comprehensive comparison visualization"""
        if not self.comparison_data or self.comparison_data['comparison_df'].empty:
            print("❌ No comparison data available")
            return None
        
        if plot_filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            plot_filename = f"strategy_comparison_{timestamp}.png"
        
        df = self.comparison_data['comparison_df']
        
        # Create subplots
        fig, axes = plt.subplots(2, 2, figsize=(16, 12))
        fig.suptitle('Strategy Comparison Analysis', fontsize=16, fontweight='bold')
        
        # Plot 1: ROI Comparison
        ax1 = axes[0, 0]
        bars1 = ax1.bar(df['Strategy'], df['ROI'], color='skyblue', alpha=0.7)
        ax1.set_title('ROI Comparison')
        ax1.set_ylabel('ROI (%)')
        ax1.tick_params(axis='x', rotation=45)
        
        # Add value labels
        for bar, value in zip(bars1, df['ROI']):
            ax1.text(bar.get_x() + bar.get_width()/2., bar.get_height(),
                    f'{value:.1f}%', ha='center', va='bottom')
        
        # Plot 2: Win Rate vs Sharpe Ratio
        ax2 = axes[0, 1]
        scatter = ax2.scatter(df['Win Rate'], df['Sharpe Ratio'], 
                            s=df['Total Trades']*2, alpha=0.6, c=df['ROI'], 
                            cmap='viridis')
        ax2.set_xlabel('Win Rate (%)')
        ax2.set_ylabel('Sharpe Ratio')
        ax2.set_title('Win Rate vs Sharpe Ratio\n(Bubble size = Total Trades)')
        
        # Add colorbar
        cbar = plt.colorbar(scatter, ax=ax2)
        cbar.set_label('ROI (%)')
        
        # Plot 3: Risk vs Return
        ax3 = axes[1, 0]
        ax3.scatter(df['Max Drawdown'], df['ROI'], 
                   s=df['Total Trades']*2, alpha=0.6, c=df['Sharpe Ratio'], 
                   cmap='RdYlGn')
        ax3.set_xlabel('Max Drawdown (%)')
        ax3.set_ylabel('ROI (%)')
        ax3.set_title('Risk vs Return\n(Bubble size = Total Trades)')
        
        # Add strategy labels
        for i, strategy in enumerate(df['Strategy']):
            ax3.annotate(strategy, (df.iloc[i]['Max Drawdown'], df.iloc[i]['ROI']),
                        xytext=(5, 5), textcoords='offset points', fontsize=8)
        
        # Plot 4: Composite Score
        ax4 = axes[1, 1]
        bars4 = ax4.barh(df['Strategy'], df['Composite Score'], color='lightcoral', alpha=0.7)
        ax4.set_xlabel('Composite Score (Lower is Better)')
        ax4.set_title('Overall Performance Ranking')
        
        # Add value labels
        for bar, value in zip(bars4, df['Composite Score']):
            ax4.text(bar.get_width(), bar.get_y() + bar.get_height()/2.,
                    f'{value:.1f}', ha='left', va='center')
        
        plt.tight_layout()
        
        if save_plot:
            plt.savefig(plot_filename, dpi=300, bbox_inches='tight')
            print(f"📊 Comparison plot saved: {plot_filename}")
        
        plt.close()
        return plot_filename
    
    def generate_comparison_report(self, filename: str = None) -> str:
        """Generate detailed comparison report"""
        if not self.comparison_data:
            return "No comparison data available"
        
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"strategy_comparison_report_{timestamp}.txt"
        
        df = self.comparison_data['comparison_df']
        
        report = f"""
🎯 STRATEGY COMPARISON REPORT
{'='*60}
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
Total Strategies: {len(df)}
Best Strategy: {self.comparison_data['best_strategy']}

📊 DETAILED RESULTS
{'='*60}
"""
        
        for _, row in df.iterrows():
            report += f"""
Strategy: {row['Strategy']}
{'='*40}
ROI: {row['ROI']:.2f}%
Win Rate: {row['Win Rate']:.2f}%
Total Trades: {row['Total Trades']}
Max Drawdown: {row['Max Drawdown']:.2f}%
Sharpe Ratio: {row['Sharpe Ratio']:.2f}
Profit Factor: {row['Profit Factor']:.2f}
Final Cash: ${row['Final Cash']:,.2f}
Total Profit: ${row['Total Profit']:,.2f}
Composite Score: {row['Composite Score']:.2f}

"""
        
        # Rankings
        report += f"""
🏆 RANKINGS
{'='*60}
"""
        
        # ROI Ranking
        roi_ranking = df.sort_values('ROI', ascending=False)
        report += "\nROI Ranking:\n"
        for i, (_, row) in enumerate(roi_ranking.iterrows(), 1):
            report += f"{i}. {row['Strategy']}: {row['ROI']:.2f}%\n"
        
        # Win Rate Ranking
        wr_ranking = df.sort_values('Win Rate', ascending=False)
        report += "\nWin Rate Ranking:\n"
        for i, (_, row) in enumerate(wr_ranking.iterrows(), 1):
            report += f"{i}. {row['Strategy']}: {row['Win Rate']:.2f}%\n"
        
        # Composite Score Ranking
        composite_ranking = df.sort_values('Composite Score')
        report += "\nOverall Performance Ranking:\n"
        for i, (_, row) in enumerate(composite_ranking.iterrows(), 1):
            report += f"{i}. {row['Strategy']}: {row['Composite Score']:.2f}\n"
        
        # Save report
        with open(filename, 'w') as f:
            f.write(report)
        
        print(f"📄 Comparison report saved: {filename}")
        return filename
    
    def export_comparison_data(self, filename: str = None) -> str:
        """Export comparison data to JSON"""
        if not self.comparison_data:
            return "No comparison data available"
        
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"strategy_comparison_data_{timestamp}.json"
        
        # Convert DataFrame to dictionary
        data = {
            'comparison_data': self.comparison_data['comparison_df'].to_dict('records'),
            'best_strategy': self.comparison_data['best_strategy'],
            'total_strategies': self.comparison_data['total_strategies'],
            'generated_at': datetime.now().isoformat()
        }
        
        # Add individual strategy results
        data['strategy_results'] = {}
        for strategy_name, result in self.results.items():
            if 'error' not in result:
                data['strategy_results'][strategy_name] = result['metrics']
            else:
                data['strategy_results'][strategy_name] = {'error': result['error']}
        
        # Save to file
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        
        print(f"📄 Comparison data exported: {filename}")
        return filename
    
    def get_best_strategy(self) -> Dict[str, Any]:
        """Get the best performing strategy"""
        if not self.comparison_data:
            return None
        
        best_strategy_name = self.comparison_data['best_strategy']
        if best_strategy_name in self.results:
            return {
                'name': best_strategy_name,
                'metrics': self.results[best_strategy_name]['metrics'],
                'config': self.results[best_strategy_name]['strategy_config']
            }
        
        return None
