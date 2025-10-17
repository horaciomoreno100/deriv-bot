#!/bin/bash

# Quick Start Script for Binary Options Backtester
echo "🚀 BINARY OPTIONS BACKTESTER - QUICK START"
echo "=========================================="

# Set environment variables
export DERIV_APP_ID=106646
export DERIV_TOKEN=7He7yWbKh3vgmEY

echo "⚙️  Configuration:"
echo "   App ID: $DERIV_APP_ID"
echo "   Token: ${DERIV_TOKEN:0:10}..."
echo ""

# Step 1: Fetch real data
echo "📊 Fetching real data from Deriv API..."
node bridge/deriv-data-bridge.js frxXAUUSD 60 1

# Step 2: Run backtest
echo ""
echo "🎯 Running backtest..."
python examples/run_bridge_backtest.py

echo ""
echo "✅ Quick start completed!"
echo "📊 Check the generated plots and results."
