# Deriv Data Bridge

Bridge between the Deriv Gateway and Python Backtester.

## Features

- **Real-time Data**: Fetches live data from Deriv API via gateway
- **Historical Data**: Downloads historical candles for backtesting
- **Format Compatibility**: Saves data in format expected by Python backtester
- **Multiple Symbols**: Support for Gold, Forex, and other assets
- **Timeframe Support**: 1min, 5min, 15min, 1hour, 1day

## Usage

### Fetch Data for Backtesting

```bash
# Fetch 1 day of Gold data (1 minute candles)
node deriv-data-bridge.js frxXAUUSD 60 1

# Fetch 3 days of EUR/USD data (5 minute candles)
node deriv-data-bridge.js frxEURUSD 300 3

# Fetch 1 week of Bitcoin data (15 minute candles)
node deriv-data-bridge.js frxBTCUSD 900 7
```

### Environment Variables

```bash
export DERIV_APP_ID=106646
export DERIV_TOKEN=your-deriv-token-here
```

### Programmatic Usage

```javascript
import { DerivDataBridge } from './deriv-data-bridge.js';

const bridge = new DerivDataBridge();
await bridge.connect(106646, 'your-token');
const result = await bridge.fetchHistoricalData('frxXAUUSD', 60, 1);
console.log(`Fetched ${result.candles} candles`);
await bridge.disconnect();
```

## Data Format

The bridge saves data in the format expected by the Python backtester:

```json
[
  {
    "epoch": 1760471580,
    "open": 4136.02,
    "high": 4138.25,
    "low": 4135.91,
    "close": 4138.05,
    "volume": 100
  }
]
```

## Integration with Python Backtester

1. **Fetch Data**: Use the bridge to get real Deriv data
2. **Run Backtest**: Python backtester uses the saved data
3. **Generate Plots**: Create interactive HTML plots
4. **Analyze Results**: Review performance metrics

## Examples

### Quick Gold Backtest

```bash
# 1. Fetch Gold data
node deriv-data-bridge.js frxXAUUSD 60 1

# 2. Run Python backtest
python examples/run_backtest.py

# 3. View results
open backtest_results.html
```

### Multi-Asset Analysis

```bash
# Fetch data for multiple assets
node deriv-data-bridge.js frxXAUUSD 60 1    # Gold
node deriv-data-bridge.js frxEURUSD 60 1   # EUR/USD
node deriv-data-bridge.js frxGBPUSD 60 1   # GBP/USD

# Run backtests for each
python examples/run_backtest.py --symbol frxXAUUSD
python examples/run_backtest.py --symbol frxEURUSD
python examples/run_backtest.py --symbol frxGBPUSD
```

## Error Handling

The bridge includes comprehensive error handling:

- **Connection Issues**: Retries and fallback options
- **Data Validation**: Ensures data quality and completeness
- **Rate Limiting**: Respects Deriv API limits
- **Data Validation**: Checks for missing or invalid candles

## Performance

- **Fast Fetching**: Optimized for large datasets
- **Memory Efficient**: Streams data to avoid memory issues
- **Caching**: Reuses existing data when possible
- **Parallel Processing**: Fetches multiple symbols simultaneously

## License

MIT
