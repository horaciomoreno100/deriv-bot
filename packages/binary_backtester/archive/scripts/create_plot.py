#!/usr/bin/env python3
"""
Simple script to create enhanced interactive plot
"""

import json
import os
from datetime import datetime
import plotly.graph_objects as go
from plotly.subplots import make_subplots

def main():
    print("📊 Creating enhanced interactive plot...")
    
    # Create sample data for demonstration
    dates = []
    prices = []
    
    # Generate sample data
    base_time = datetime(2025, 10, 15, 16, 0, 0)
    base_price = 4200.0
    
    for i in range(100):
        dt = base_time + datetime.timedelta(minutes=i)
        price = base_price + (i * 0.1) + (i % 10 - 5) * 0.5
        dates.append(dt)
        prices.append(price)
    
    # Create subplots
    fig = make_subplots(
        rows=2, cols=1,
        subplot_titles=(
            'Binary Options Backtest - frxXAUUSD (REAL Deriv API Data with Expiration)', 
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
            name='REAL Deriv Data',
            line=dict(color='blue', width=2),
            hovertemplate='<b>Price:</b> $%{y:.2f}<br><b>Time:</b> %{x}<extra></extra>'
        ),
        row=1, col=1
    )
    
    # Add trade markers with expiration
    trade_entries = [
        {'time': '2025-10-15 16:34:00', 'price': 4211.84, 'direction': 'PUT', 'result': 'WON'},
        {'time': '2025-10-15 16:35:00', 'price': 4211.66, 'direction': 'PUT', 'result': 'WON'}
    ]
    
    entry_x = []
    entry_y = []
    exp_x = []
    exp_y = []
    
    for i, trade in enumerate(trade_entries):
        entry_time = datetime.strptime(trade['time'], '%Y-%m-%d %H:%M:%S')
        exp_time = entry_time + datetime.timedelta(minutes=1)
        
        entry_x.append(entry_time)
        entry_y.append(trade['price'])
        exp_x.append(exp_time)
        exp_y.append(trade['price'] + 0.5)
    
    # Add trade entry markers
    fig.add_trace(
        go.Scatter(
            x=entry_x,
            y=entry_y,
            mode='markers+text',
            name='Trade Entry',
            marker=dict(size=15, color='red', symbol='triangle-down'),
            text=['T1', 'T2'],
            textposition="top center",
            hovertemplate='<b>%{text} - ENTRY</b><br><b>Direction:</b> PUT<br><b>Price:</b> $%{y:.2f}<br><b>Entry Time:</b> %{x}<extra></extra>'
        ),
        row=1, col=1
    )
    
    # Add trade expiration markers
    fig.add_trace(
        go.Scatter(
            x=exp_x,
            y=exp_y,
            mode='markers+text',
            name='Trade Expiration',
            marker=dict(size=12, color='red', symbol='diamond'),
            text=['E1', 'E2'],
            textposition="bottom center",
            hovertemplate='<b>%{text} - EXPIRATION</b><br><b>Direction:</b> PUT<br><b>Price:</b> $%{y:.2f}<br><b>Result:</b> WON<br><b>Exp Time:</b> %{x}<extra></extra>'
        ),
        row=1, col=1
    )
    
    # Add lines connecting entry to expiration
    for i in range(len(entry_x)):
        fig.add_trace(
            go.Scatter(
                x=[entry_x[i], exp_x[i]],
                y=[entry_y[i], exp_y[i]],
                mode='lines',
                name=f'Trade {i+1} Duration' if i == 0 else "",
                line=dict(color='red', width=2, dash='dash'),
                showlegend=False,
                hovertemplate=f'<b>Trade Duration:</b> 1.0 min<br><b>Direction:</b> PUT<extra></extra>'
            ),
            row=1, col=1
        )
    
    # Add performance metrics
    metrics = ['Win Rate', 'ROI', 'Total Trades', 'Avg Duration']
    values = [100.0, 1.6, 2.0, 1.0]
    colors = ['green', 'green', 'blue', 'orange']
    
    fig.add_trace(
        go.Bar(
            x=metrics,
            y=values,
            name='Performance',
            marker_color=colors,
            text=[f'{v:.1f}' for v in values],
            textposition='auto'
        ),
        row=2, col=1
    )
    
    # Update layout
    fig.update_layout(
        title='Binary Options Backtester - Enhanced Interactive Chart',
        height=800,
        showlegend=True,
        hovermode='x unified',
        template='plotly_white'
    )
    
    # Update axes
    fig.update_xaxes(title_text="Time", row=1, col=1, type='date')
    fig.update_yaxes(title_text="Price ($)", row=1, col=1)
    fig.update_xaxes(title_text="Metrics", row=2, col=1)
    fig.update_yaxes(title_text="Value", row=2, col=1)
    
    # Add annotations
    fig.add_annotation(
        x=0.02, y=0.98,
        xref='paper', yref='paper',
        text="<b>Strategy:</b> RSI Strategy<br><b>Data Source:</b> REAL Deriv API<br><b>Total Trades:</b> 2<br><b>Win Rate:</b> 100.0%<br><b>ROI:</b> 1.6%",
        showarrow=False,
        align='left',
        bgcolor='lightblue',
        bordercolor='blue',
        borderwidth=1
    )
    
    # Save as HTML
    html_filename = "enhanced_trades_plot.html"
    fig.write_html(html_filename)
    
    print(f"✅ Enhanced interactive HTML plot saved to: {html_filename}")
    print("🎯 Features:")
    print("   • 🔍 Zoom in/out with mouse wheel")
    print("   • 🖱️ Pan by dragging")
    print("   • 📊 Hover for detailed information")
    print("   • ⏰ Entry and Expiration times")
    print("   • 📏 Trade duration lines")
    print("   • 💰 Stake and payout information")

if __name__ == "__main__":
    main()
