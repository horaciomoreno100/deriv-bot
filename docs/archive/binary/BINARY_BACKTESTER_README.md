# Binary Options Backtester

Binary options backtester using Python Backtrader and Deriv API integration via Gateway Bridge.

## Features

- **Real Deriv API Integration**: Uses gateway bridge to fetch real market data
- **Backtrader Engine**: Leverages Python's Backtrader for backtesting
- **Binary Options Support**: Specialized for all-or-nothing outcomes
- **Interactive Plots**: HTML plots with zoom, pan, and trade visualization
- **Multiple Strategies**: RSI, SMA, and custom strategies
- **Risk Management**: Position sizing and risk controls
- **Gateway Bridge**: Seamless integration with Deriv Gateway

## Architecture

```
binary_backtester/
├── bridge/                 # Gateway Bridge (Node.js)
│   ├── deriv-data-bridge.js
│   ├── package.json
│   └── README.md
├── core/                  # Python core (Backtrader)
├── strategies/            # Python strategies
├── examples/              # Python examples
├── data/                  # Historical data cache
└── config/               # Configuration
```

## Quick Start

### 1. Setup Environment

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Node.js dependencies for bridge
cd bridge && npm install
```

### 2. Set Environment Variables

```bash
export DERIV_APP_ID=106646
export DERIV_TOKEN=your-deriv-token-here
```

### 3. Fetch Data via Gateway Bridge

```bash
# Fetch Gold data (1 day, 1-minute candles)
cd bridge
node deriv-data-bridge.js frxXAUUSD 60 1
```

### 4. Run Backtest

```bash
# Run backtest with gateway data
python examples/run_bridge_backtest.py

# Or run with existing data
python examples/run_backtest.py
```

## Usage Examples

### Gateway Bridge Integration

```bash
# Fetch data for multiple assets
node bridge/deriv-data-bridge.js frxXAUUSD 60 1    # Gold
node bridge/deriv-data-bridge.js frxEURUSD 60 1   # EUR/USD
node bridge/deriv-data-bridge.js frxGBPUSD 60 1   # GBP/USD

# Run backtests
python examples/run_bridge_backtest.py
```

### Direct Python Usage

```python
from core.enhanced_backtrader_engine import EnhancedBinaryBacktester
from strategies.rsi_strategy import RSIStrategy
from config.settings import Config

# Configuration
config = Config(
    symbol='frxXAUUSD',
    timeframe=60,
    initial_cash=1000.0,
    expiration_time=1,
    payout=0.8
)

# Create backtester
backtester = EnhancedBinaryBacktester(config)

# Run backtest
results = backtester.run(RSIStrategy)

# Generate plot
backtester.plot_results('results.png')
```

## Gateway Bridge

The bridge provides seamless integration with the Deriv Gateway:

### Features
- **Real-time Data**: Fetches live data from Deriv API
- **Historical Data**: Downloads historical candles
- **Format Compatibility**: Saves data for Python backtester
- **Multiple Symbols**: Gold, Forex, Crypto support
- **Timeframe Support**: 1min, 5min, 15min, 1hour, 1day

### Usage

```bash
# Basic usage
node bridge/deriv-data-bridge.js SYMBOL TIMEFRAME DAYS

# Examples
node bridge/deriv-data-bridge.js frxXAUUSD 60 1     # Gold, 1min, 1 day
node bridge/deriv-data-bridge.js frxEURUSD 300 3   # EUR/USD, 5min, 3 days
node bridge/deriv-data-bridge.js frxBTCUSD 900 7   # Bitcoin, 15min, 1 week
```

## Strategies

### RSI Strategy

```python
from strategies.rsi_strategy import RSIStrategy

strategy = RSIStrategy(
    rsi_period=14,
    rsi_oversold=30,
    rsi_overbought=70
)
```

### Custom Strategy

```python
from strategies.base_strategy import BaseBinaryStrategy

class MyStrategy(BaseBinaryStrategy):
    def generate_signal(self):
        # Your strategy logic here
        if self.rsi[0] < 30:
            return 'CALL'
        elif self.rsi[0] > 70:
            return 'PUT'
        return None
```

## Results

The backtester provides comprehensive results:

- **Performance Metrics**: Win rate, ROI, Sharpe ratio
- **Trade Analysis**: Individual trade details with entry/exit times
- **Risk Metrics**: Max drawdown, volatility
- **Interactive Plots**: HTML visualizations with trade markers
- **Export Options**: JSON, CSV, HTML reports

## Configuration

### Environment Variables

```bash
DERIV_APP_ID=106646
DERIV_TOKEN=your-deriv-token-here
```

### Backtest Configuration

```python
config = Config(
    symbol='frxXAUUSD',        # Trading symbol
    timeframe=60,              # Timeframe in seconds
    initial_cash=1000.0,       # Starting balance
    stake_amount=10.0,         # Stake per trade
    payout=0.8,                # Payout percentage (80%)
    expiration_time=1,         # Expiration in minutes
    risk_per_trade=0.01        # Risk per trade (1%)
)
```

## Development

```bash
# Install dependencies
pip install -r requirements.txt
cd bridge && npm install

# Run tests
python -m pytest tests/

# Run backtest
python examples/run_bridge_backtest.py

# Generate plot
python examples/create_plot.py
```

## License

MIT
