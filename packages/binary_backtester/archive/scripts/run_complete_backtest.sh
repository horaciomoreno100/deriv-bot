#!/bin/bash

# Binary Options Backtester - Complete Workflow
# This script runs the complete backtesting workflow using real Deriv data

echo "🚀 BINARY OPTIONS BACKTESTER - COMPLETE WORKFLOW"
echo "================================================"

# Set environment variables
export DERIV_APP_ID=106646
export DERIV_TOKEN=7He7yWbKh3vgmEY

echo "⚙️  Configuration:"
echo "   App ID: $DERIV_APP_ID"
echo "   Token: ${DERIV_TOKEN:0:10}..."
echo ""

# Step 1: Fetch real data via gateway bridge
echo "📊 Step 1: Fetching real data from Deriv API..."
cd bridge
node deriv-data-bridge.js frxXAUUSD 60 1
cd ..

# Step 2: Run backtest with real data
echo ""
echo "🎯 Step 2: Running backtest with real data..."
python examples/run_bridge_backtest.py

echo ""
echo "✅ Complete workflow finished!"
echo "📊 Check the generated plots and results files."
