#!/usr/bin/env python3
"""
Quick Demo - Minimal working example
"""

import json
import os
from datetime import datetime
import plotly.graph_objects as go
from plotly.subplots import make_subplots

def create_simple_plot():
    """Create a simple interactive plot"""
    
    # Sample data
    dates = [datetime.now().replace(hour=i, minute=0, second=0, microsecond=0) for i in range(24)]
    prices = [2000 + i * 10 + (i % 3) * 5 for i in range(24)]
    
    # Sample backtest results
    results = {
        'symbol': 'frxXAUUSD',
        'strategy_name': 'RSI Strategy',
        'total_trades': 15,
        'won_trades': 10,
        'lost_trades': 5,
        'win_rate': 0.667,
        'roi': 12.5,
        'total_profit': 1250.0,
        'final_cash': 11250.0,
        'max_drawdown': 5.2
    }
    
    # Create subplots
    fig = make_subplots(
        rows=2, cols=1,
        subplot_titles=(
            f'Binary Options Backtest - {results["symbol"]}', 
            'Performance Metrics'
        ),
        vertical_spacing=0.1,
        row_heights=[0.7, 0.3]
    )
    
    # Add price line
    fig.add_trace(
        go.Scatter(
            x=dates,
            y=prices,
            mode='lines',
            name='Price',
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
            'text': f'Binary Options Backtester - {results["strategy_name"]}',
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
    fig.update_xaxes(title_text="Time", row=1, col=1, type='date', tickformat='%H:%M')
    fig.update_yaxes(title_text="Price ($)", row=1, col=1)
    fig.update_xaxes(title_text="Metrics", row=2, col=1)
    fig.update_yaxes(title_text="Value", row=2, col=1)
    
    # Add results annotation
    fig.add_annotation(
        x=0.02, y=0.98,
        xref='paper', yref='paper',
        text=f"<b>Strategy:</b> {results['strategy_name']}<br><b>Symbol:</b> {results['symbol']}<br><b>Total Trades:</b> {results['total_trades']}<br><b>Won Trades:</b> {results['won_trades']}<br><b>Lost Trades:</b> {results['lost_trades']}<br><b>Win Rate:</b> {results['win_rate']*100:.1f}%<br><b>ROI:</b> {results['roi']:.1f}%<br><b>Total Profit:</b> ${results['total_profit']:.2f}<br><b>Final Balance:</b> ${results['final_cash']:.2f}<br><b>Max Drawdown:</b> {results['max_drawdown']:.1f}%",
        showarrow=False,
        align='left',
        bgcolor='lightblue',
        bordercolor='blue',
        borderwidth=1,
        font=dict(size=10)
    )
    
    # Save as HTML
    html_filename = "quick_demo_plot.html"
    fig.write_html(html_filename)
    
    print(f"✅ Interactive plot saved: {html_filename}")
    print("🎯 Features:")
    print("   • 🔍 Zoom in/out with mouse wheel")
    print("   • 🖱️ Pan by dragging")
    print("   • 📊 Hover for detailed information")
    print("   • 📱 Responsive design")
    
    return html_filename

def main():
    """Create quick demo plot"""
    print("🚀 QUICK DEMO - BINARY OPTIONS BACKTESTER")
    print("=" * 50)
    
    # Create plot
    html_filename = create_simple_plot()
    
    if html_filename:
        print(f"\n✅ Plot created: {html_filename}")
        print("🌐 Open in browser to see interactive features")
    
    print("\n🎉 QUICK DEMO COMPLETED!")

if __name__ == "__main__":
    main()
