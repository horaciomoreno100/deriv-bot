/**
 * BacktestJS Configuration for BB Squeeze Strategy
 * Generated automatically
 */

module.exports = {
  // Strategy parameters to test
  params: {
    bbPeriod: [15, 20, 25],           // Bollinger Bands period
    bbStdDev: [2, 2.5],                // BB standard deviation
    kcPeriod: [15, 20, 25],            // Keltner Channel period
    kcMultiplier: [1.0, 1.5, 2.0],     // KC ATR multiplier
    takeProfitPct: [0.003, 0.004, 0.005], // 0.3%, 0.4%, 0.5%
    stopLossPct: [0.0015, 0.002, 0.0025], // 0.15%, 0.2%, 0.25%
  },

  // Symbols to test
  symbols: ["R_100"],

  // Initial capital
  initialCapital: 10000,

  // Position sizing
  positionSize: 0.02, // 2% risk per trade
};
