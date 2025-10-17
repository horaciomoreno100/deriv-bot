#!/bin/bash

# Simple Binary Options Backtester - No Gateway Dependencies
echo "🚀 BINARY OPTIONS BACKTESTER - SIMPLE VERSION"
echo "=============================================="

# Set environment variables
export DERIV_APP_ID=106646
export DERIV_TOKEN=7He7yWbKh3vgmEY

echo "⚙️  Configuration:"
echo "   App ID: $DERIV_APP_ID"
echo "   Token: ${DERIV_TOKEN:0:10}..."
echo ""

# Step 1: Use existing data or generate synthetic
echo "📊 Step 1: Using existing data..."
if [ -f "data/deriv_candles_*.json" ]; then
    echo "   ✅ Found existing real data"
else
    echo "   ⚠️  No real data found, will use synthetic data"
fi

# Step 2: Run backtest with existing data
echo ""
echo "🎯 Step 2: Running backtest..."
python examples/simple_backtest.py

echo ""
echo "✅ Simple backtest completed!"
echo "📊 Check the generated plots and results files."
