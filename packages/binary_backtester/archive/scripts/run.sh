#!/bin/bash

# Binary Options Backtester - Simple Run Script
echo "🚀 BINARY OPTIONS BACKTESTER"
echo "============================"

# Set environment variables
export DERIV_APP_ID=106646
export DERIV_TOKEN=7He7yWbKh3vgmEY

echo "⚙️  Configuration:"
echo "   App ID: $DERIV_APP_ID"
echo "   Token: ${DERIV_TOKEN:0:10}..."
echo ""

# Step 1: Fetch real data
echo "📊 Step 1: Fetching real data from Deriv API..."
node bridge/deriv-data-bridge.js frxXAUUSD 60 1

# Step 2: Run backtest
echo ""
echo "🎯 Step 2: Running backtest with real data..."
python examples/run_bridge_backtest.py

echo ""
echo "✅ Backtest completed!"
echo "📊 Check the generated plots and results files."
echo "🎯 Files generated:"
echo "   - *.png (plots)"
echo "   - *.html (interactive plots)"
echo "   - data/*.json (historical data)"
