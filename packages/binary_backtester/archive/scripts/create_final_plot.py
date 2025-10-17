#!/usr/bin/env python3
"""
Create final interactive plot using REAL backtest results and REAL market data
"""

import json
import os
from datetime import datetime
import plotly.graph_objects as go
from plotly.subplots import make_subplots

def load_real_data():
    """Load real backtest results and market data"""
    
    # Load backtest results
    results_file = "backtest_results_20251015_133904.json"
    with open(results_file, 'r') as f:
        results = json.load(f)
    
    # Load real market data
    data_path = "data"
    real_data_files = [f for f in os.listdir(data_path) if f.startswith('deriv_candles_') and f.endswith('.json')]
    latest_file = sorted(real_data_files)[-1]
    filepath = os.path.join(data_path, latest_file)
    
    with open(filepath, 'r') as f:
        candles = json.load(f)
    
    # Process real candles
    dates = []
    prices = []
    
    for candle in candles:
        timestamp = candle['epoch']
        close_price = float(candle['close'])
        dt = datetime.fromtimestamp(timestamp)
        dates.append(dt)
        prices.append(close_price)
    
    print(f"✅ Loaded {len(dates)} real candles")
    print(f"✅ Backtest results: {results['total_trades']} trades, {results['win_rate']*100:.1f}% win rate")
    
    return dates, prices, results

def create_final_plot(dates, prices, results):
    """Create final interactive plot with real data"""
    
    # Create subplots
    fig = make_subplots(
        rows=2, cols=1,
        subplot_titles=(
            f'Binary Options Backtest - {results["symbol"]} (REAL Deriv API Data)', 
            'Performance Metrics'
        ),
        vertical_spacing=0.1,
        row_heights=[0.7, 0.3]
    )
    
    # Add real price line
    fig.add_trace(
        go.Scatter(
            x=dates,
            y=prices,
            mode='lines',
            name='REAL Deriv Data',
            line=dict(color='blue', width=2),
            hovertemplate='<b>Price:</b> $%{y:.2f}<br><b>Time:</b> %{x}<extra></extra>'
        ),
        row=1, col=1
    )
    
    # Add performance metrics
    metrics = ['Win Rate', 'ROI', 'Total Trades', 'Max Drawdown']
    values = [
        results['win_rate'] * 100,
        results['roi'],
        results['total_trades'],
        results['max_drawdown']
    ]
    colors = ['green' if v > 50 else 'red' if v < 0 else 'orange' for v in values]
    
    fig.add_trace(
        go.Bar(
            x=metrics,
            y=values,
            name='Performance',
            marker_color=colors,
            text=[f'{v:.1f}' for v in values],
            textposition='auto',
            hovertemplate='<b>%{x}</b><br>Value: %{y:.1f}<extra></extra>'
        ),
        row=2, col=1
    )
    
    # Update layout
    fig.update_layout(
        title={
            'text': f'Binary Options Backtester - {results["strategy_name"]} (REAL DATA)',
            'x': 0.5,
            'xanchor': 'center',
            'font': {'size': 20}
        },
        height=800,
        showlegend=True,
        hovermode='x unified',
        template='plotly_white'
    )
    
    # Update axes
    fig.update_xaxes(title_text="Time", row=1, col=1, type='date', tickformat='%m/%d %H:%M')
    fig.update_yaxes(title_text="Price ($)", row=1, col=1)
    fig.update_xaxes(title_text="Metrics", row=2, col=1)
    fig.update_yaxes(title_text="Value", row=2, col=1)
    
    # Add real results annotation
    fig.add_annotation(
        x=0.02, y=0.98,
        xref='paper', yref='paper',
        text=f"<b>Strategy:</b> {results['strategy_name']}<br><b>Symbol:</b> {results['symbol']}<br><b>Period:</b> {results['period']}<br><b>Total Trades:</b> {results['total_trades']}<br><b>Won Trades:</b> {results['won_trades']}<br><b>Lost Trades:</b> {results['lost_trades']}<br><b>Win Rate:</b> {results['win_rate']*100:.1f}%<br><b>ROI:</b> {results['roi']:.1f}%<br><b>Total Profit:</b> ${results['total_profit']:.2f}<br><b>Final Balance:</b> ${results['final_cash']:.2f}<br><b>Max Drawdown:</b> {results['max_drawdown']:.1f}%",
        showarrow=False,
        align='left',
        bgcolor='lightblue',
        bordercolor='blue',
        borderwidth=1,
        font=dict(size=10)
    )
    
    # Save as HTML
    html_filename = "final_real_deriv_plot.html"
    fig.write_html(html_filename)
    
    print(f"✅ Final real data plot saved to: {html_filename}")
    return html_filename

def main():
    """Create final plot with real data"""
    print("📊 FINAL REAL DATA PLOT - NO HARDCODED DATA")
    print("=" * 60)
    
    # Load real data
    dates, prices, results = load_real_data()
    
    # Create plot
    html_filename = create_final_plot(dates, prices, results)
    
    if html_filename:
        print(f"✅ Final plot created: {html_filename}")
        print("🎯 Features:")
        print("   • 🔍 Zoom in/out with mouse wheel")
        print("   • 🖱️ Pan by dragging")
        print("   • 📊 Hover for detailed information")
        print("   • 📱 Responsive design")
        print("   • 📈 Real backtest results")
        print("   • 📊 Real market data")
    
    print("\n🎯 FINAL PLOT COMPLETED!")
    print("✅ Used REAL backtest results")
    print("✅ Used REAL market data")
    print("✅ NO hardcoded data")
    print("=" * 60)

if __name__ == "__main__":
    main()
