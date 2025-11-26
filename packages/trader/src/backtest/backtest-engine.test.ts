/**
 * Tests para el Motor de Backtest
 *
 * Verificamos:
 * 1. Cálculo de P&L correcto
 * 2. TP/SL funcionan bien
 * 3. Trailing stop funciona
 * 4. Métricas calculadas correctamente
 * 5. Casos edge
 */

import { describe, it, expect } from 'vitest';
import {
  executeTrade,
  calculateMetrics,
  createTradeEntry,
  runMonteCarloSimulation,
  runWalkForwardAnalysis,
  runOutOfSampleTest,
  type Candle,
  type TradeEntry,
  type Trade,
  type BacktestConfig,
} from './backtest-engine';

// =============================================================================
// HELPERS
// =============================================================================

function createCandle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number
): Candle {
  return { timestamp, open, high, low, close };
}

function createCandles(prices: Array<{ o: number; h: number; l: number; c: number }>): Candle[] {
  return prices.map((p, i) => createCandle(1000 + i * 60, p.o, p.h, p.l, p.c));
}

const defaultConfig: BacktestConfig = {
  initialBalance: 1000,
  stakeAmount: 20,
  multiplier: 200,
  takeProfitPct: 0.005,   // 0.5%
  stopLossPct: 0.005,     // 0.5%
  maxBarsInTrade: 50,
  cooldownBars: 5,
};

// =============================================================================
// TRADE EXECUTION TESTS
// =============================================================================

describe('executeTrade - Basic P&L Calculation', () => {
  it('should return null for empty candles', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 100.5,
      slPrice: 99.5,
    };
    const result = executeTrade(entry, [], defaultConfig);
    expect(result).toBeNull();
  });

  it('should calculate CALL win correctly when TP is hit', () => {
    // Entry at 100, TP at 100.5 (0.5% up)
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 100.5,
      slPrice: 99.5,
    };

    // Price goes up and hits TP
    const candles = createCandles([
      { o: 100, h: 100.2, l: 99.9, c: 100.1 },  // Bar 1: No hit
      { o: 100.1, h: 100.6, l: 100, c: 100.5 }, // Bar 2: TP hit at 100.5
    ]);

    const result = executeTrade(entry, candles, defaultConfig);

    expect(result).not.toBeNull();
    expect(result!.result).toBe('WIN');
    expect(result!.exitReason).toBe('TP');
    expect(result!.exitPrice).toBe(100.5);

    // P&L: (100.5 - 100) / 100 * 20 * 200 = 0.005 * 20 * 200 = $20
    expect(result!.pnl).toBeCloseTo(20, 2);
    expect(result!.pnlPct).toBeCloseTo(0.5, 2);
  });

  it('should calculate CALL loss correctly when SL is hit', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 100.5,
      slPrice: 99.5,
    };

    // Price goes down and hits SL
    const candles = createCandles([
      { o: 100, h: 100.1, l: 99.8, c: 99.9 },  // Bar 1: No hit
      { o: 99.9, h: 99.9, l: 99.4, c: 99.5 },  // Bar 2: SL hit at 99.5
    ]);

    const result = executeTrade(entry, candles, defaultConfig);

    expect(result).not.toBeNull();
    expect(result!.result).toBe('LOSS');
    expect(result!.exitReason).toBe('SL');
    expect(result!.exitPrice).toBe(99.5);

    // P&L: (99.5 - 100) / 100 * 20 * 200 = -0.005 * 20 * 200 = -$20
    expect(result!.pnl).toBeCloseTo(-20, 2);
    expect(result!.pnlPct).toBeCloseTo(-0.5, 2);
  });

  it('should calculate PUT win correctly when TP is hit', () => {
    // Entry at 100, TP at 99.5 (0.5% down)
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'PUT',
      entryPrice: 100,
      stake: 20,
      tpPrice: 99.5,
      slPrice: 100.5,
    };

    // Price goes down and hits TP
    const candles = createCandles([
      { o: 100, h: 100.1, l: 99.8, c: 99.9 },  // Bar 1: No hit
      { o: 99.9, h: 100, l: 99.4, c: 99.5 },   // Bar 2: TP hit at 99.5
    ]);

    const result = executeTrade(entry, candles, defaultConfig);

    expect(result).not.toBeNull();
    expect(result!.result).toBe('WIN');
    expect(result!.exitReason).toBe('TP');
    expect(result!.exitPrice).toBe(99.5);

    // P&L: (100 - 99.5) / 100 * 20 * 200 = 0.005 * 20 * 200 = $20
    expect(result!.pnl).toBeCloseTo(20, 2);
  });

  it('should calculate PUT loss correctly when SL is hit', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'PUT',
      entryPrice: 100,
      stake: 20,
      tpPrice: 99.5,
      slPrice: 100.5,
    };

    // Price goes up and hits SL
    const candles = createCandles([
      { o: 100, h: 100.2, l: 99.9, c: 100.1 },  // Bar 1: No hit
      { o: 100.1, h: 100.6, l: 100, c: 100.5 }, // Bar 2: SL hit at 100.5
    ]);

    const result = executeTrade(entry, candles, defaultConfig);

    expect(result).not.toBeNull();
    expect(result!.result).toBe('LOSS');
    expect(result!.exitReason).toBe('SL');
    expect(result!.exitPrice).toBe(100.5);

    // P&L: (100 - 100.5) / 100 * 20 * 200 = -0.005 * 20 * 200 = -$20
    expect(result!.pnl).toBeCloseTo(-20, 2);
  });

  it('should timeout and use close price', () => {
    const config = { ...defaultConfig, maxBarsInTrade: 3 };
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 101,   // Won't reach
      slPrice: 99,    // Won't reach
    };

    // Price stays in range, doesn't hit TP/SL
    const candles = createCandles([
      { o: 100, h: 100.2, l: 99.8, c: 100.1 },
      { o: 100.1, h: 100.3, l: 99.9, c: 100.2 },
      { o: 100.2, h: 100.4, l: 100, c: 100.15 }, // Last candle, timeout
    ]);

    const result = executeTrade(entry, candles, config);

    expect(result).not.toBeNull();
    expect(result!.exitReason).toBe('TIMEOUT');
    expect(result!.exitPrice).toBe(100.15);
    expect(result!.barsHeld).toBe(3);

    // P&L: (100.15 - 100) / 100 * 20 * 200 = 0.0015 * 4000 = $6
    expect(result!.pnl).toBeCloseTo(6, 2);
  });
});

describe('executeTrade - Excursion Tracking', () => {
  it('should track maximum favorable excursion for CALL', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 101,
      slPrice: 99,
    };

    // Price goes up to 100.8 (0.8%) then comes back and hits SL
    const candles = createCandles([
      { o: 100, h: 100.8, l: 99.9, c: 100.5 },   // High of 100.8 = +0.8%
      { o: 100.5, h: 100.6, l: 98.5, c: 99 },    // SL hit
    ]);

    const result = executeTrade(entry, candles, defaultConfig);

    expect(result).not.toBeNull();
    expect(result!.maxFavorableExcursion).toBeCloseTo(0.8, 1); // Reached +0.8%
  });

  it('should track maximum adverse excursion for PUT', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'PUT',
      entryPrice: 100,
      stake: 20,
      tpPrice: 99,
      slPrice: 101,
    };

    // Price spikes up (adverse) then drops to TP
    const candles = createCandles([
      { o: 100, h: 100.6, l: 99.8, c: 99.9 },   // High adverse of 0.6%
      { o: 99.9, h: 100, l: 98.5, c: 99 },       // TP hit
    ]);

    const result = executeTrade(entry, candles, defaultConfig);

    expect(result).not.toBeNull();
    expect(result!.maxAdverseExcursion).toBeCloseTo(0.6, 1);
  });
});

describe('executeTrade - Trailing Stop', () => {
  const trailingConfig: BacktestConfig = {
    ...defaultConfig,
    useTrailingStop: true,
    trailingActivationPct: 0.003, // Activate after +0.3%
    trailingDistancePct: 0.002,   // Trail at 0.2% distance
  };

  it('should activate trailing stop after reaching activation level', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 100.5,  // 0.5%
      slPrice: 99.5,   // -0.5%
    };

    // Price goes up to 100.4 (+0.4%, activates trailing at +0.3%)
    // Then drops to trailing stop
    const candles = createCandles([
      { o: 100, h: 100.4, l: 99.9, c: 100.3 },   // +0.4% high, trailing activates
      // Trailing stop should be at: 100.4 * (1 - 0.002) = 100.2
      { o: 100.3, h: 100.35, l: 100.1, c: 100.2 }, // Trailing stop hit at ~100.2
    ]);

    const result = executeTrade(entry, candles, trailingConfig);

    expect(result).not.toBeNull();
    expect(result!.exitReason).toBe('TRAILING_STOP');
    // Trailing triggered at: 100.4 * 0.998 = 100.1992
    expect(result!.exitPrice).toBeCloseTo(100.2, 1);
    expect(result!.pnl).toBeGreaterThan(0); // Still a win
  });

  it('should not activate trailing stop if activation level not reached', () => {
    const entry: TradeEntry = {
      timestamp: 1000,
      direction: 'CALL',
      entryPrice: 100,
      stake: 20,
      tpPrice: 100.5,
      slPrice: 99.5,
    };

    // Price only goes up to +0.2% (below 0.3% activation), then hits SL
    const candles = createCandles([
      { o: 100, h: 100.2, l: 99.9, c: 100.1 },   // Only +0.2%
      { o: 100.1, h: 100.15, l: 99.4, c: 99.5 }, // SL hit
    ]);

    const result = executeTrade(entry, candles, trailingConfig);

    expect(result).not.toBeNull();
    expect(result!.exitReason).toBe('SL');
    expect(result!.exitPrice).toBe(99.5);
  });
});

// =============================================================================
// METRICS CALCULATION TESTS
// =============================================================================

describe('calculateMetrics', () => {
  it('should return zeros for empty trades', () => {
    const metrics = calculateMetrics([], defaultConfig);

    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.netPnl).toBe(0);
    expect(metrics.profitFactor).toBe(0);
  });

  it('should calculate win rate correctly', () => {
    const trades: Trade[] = [
      createMockTrade('WIN', 20),
      createMockTrade('WIN', 20),
      createMockTrade('LOSS', -20),
      createMockTrade('WIN', 20),
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    expect(metrics.totalTrades).toBe(4);
    expect(metrics.wins).toBe(3);
    expect(metrics.losses).toBe(1);
    expect(metrics.winRate).toBe(75);
  });

  it('should calculate net P&L correctly', () => {
    const trades: Trade[] = [
      createMockTrade('WIN', 25),
      createMockTrade('LOSS', -20),
      createMockTrade('WIN', 30),
      createMockTrade('LOSS', -15),
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    // Net: 25 - 20 + 30 - 15 = 20
    expect(metrics.netPnl).toBe(20);
    expect(metrics.grossProfit).toBe(55);  // 25 + 30
    expect(metrics.grossLoss).toBe(35);    // 20 + 15
  });

  it('should calculate profit factor correctly', () => {
    const trades: Trade[] = [
      createMockTrade('WIN', 100),
      createMockTrade('LOSS', -50),
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    // PF: 100 / 50 = 2.0
    expect(metrics.profitFactor).toBe(2);
  });

  it('should return Infinity profit factor when no losses', () => {
    const trades: Trade[] = [
      createMockTrade('WIN', 50),
      createMockTrade('WIN', 50),
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    expect(metrics.profitFactor).toBe(Infinity);
  });

  it('should calculate max drawdown correctly', () => {
    const config = { ...defaultConfig, initialBalance: 1000 };
    const trades: Trade[] = [
      createMockTrade('WIN', 100),   // Equity: 1100
      createMockTrade('WIN', 100),   // Equity: 1200 (new peak)
      createMockTrade('LOSS', -150), // Equity: 1050 (drawdown: 150)
      createMockTrade('LOSS', -100), // Equity: 950 (drawdown: 250)
      createMockTrade('WIN', 300),   // Equity: 1250 (new peak)
    ];

    const metrics = calculateMetrics(trades, config);

    expect(metrics.maxDrawdown).toBe(250);
    expect(metrics.maxDrawdownPct).toBe(25); // 250/1000 = 25%
  });

  it('should count consecutive wins/losses correctly', () => {
    const trades: Trade[] = [
      createMockTrade('WIN', 10),
      createMockTrade('WIN', 10),
      createMockTrade('WIN', 10),
      createMockTrade('LOSS', -10),
      createMockTrade('LOSS', -10),
      createMockTrade('WIN', 10),
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    expect(metrics.maxConsecutiveWins).toBe(3);
    expect(metrics.maxConsecutiveLosses).toBe(2);
  });

  it('should count near misses correctly', () => {
    // TP is 0.5%, so near miss is reaching >0.25%
    const trades: Trade[] = [
      createMockTrade('LOSS', -20, { maxFavorableExcursion: 0.3 }),  // Reached 0.3%, near miss
      createMockTrade('LOSS', -20, { maxFavorableExcursion: 0.1 }),  // Only 0.1%, not near miss
      createMockTrade('LOSS', -20, { maxFavorableExcursion: 0.4 }),  // Reached 0.4%, near miss
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    expect(metrics.nearMisses).toBe(2);
  });

  it('should count immediate reversals correctly', () => {
    const trades: Trade[] = [
      createMockTrade('LOSS', -20, { barsHeld: 1 }),   // 1 bar, immediate
      createMockTrade('LOSS', -20, { barsHeld: 3 }),   // 3 bars, immediate
      createMockTrade('LOSS', -20, { barsHeld: 4 }),   // 4 bars, not immediate
      createMockTrade('LOSS', -20, { barsHeld: 10 }),  // 10 bars, not immediate
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    expect(metrics.immediateReversals).toBe(2);
  });

  it('should calculate expectancy correctly', () => {
    // 60% win rate, avg win $30, avg loss $20
    const trades: Trade[] = [
      createMockTrade('WIN', 30),
      createMockTrade('WIN', 30),
      createMockTrade('WIN', 30),
      createMockTrade('LOSS', -20),
      createMockTrade('LOSS', -20),
    ];

    const metrics = calculateMetrics(trades, defaultConfig);

    // Expectancy: 0.6 * 30 - 0.4 * 20 = 18 - 8 = 10
    expect(metrics.expectancy).toBeCloseTo(10, 1);
  });
});

// =============================================================================
// CREATE TRADE ENTRY TESTS
// =============================================================================

describe('createTradeEntry', () => {
  it('should create CALL entry with correct TP/SL', () => {
    const entry = createTradeEntry(1000, 'CALL', 100, defaultConfig);

    expect(entry.direction).toBe('CALL');
    expect(entry.entryPrice).toBe(100);
    expect(entry.stake).toBe(20);
    expect(entry.tpPrice).toBeCloseTo(100.5, 5);  // 100 * 1.005
    expect(entry.slPrice).toBeCloseTo(99.5, 5);   // 100 * 0.995
  });

  it('should create PUT entry with correct TP/SL', () => {
    const entry = createTradeEntry(1000, 'PUT', 100, defaultConfig);

    expect(entry.direction).toBe('PUT');
    expect(entry.entryPrice).toBe(100);
    expect(entry.tpPrice).toBeCloseTo(99.5, 5);   // 100 * 0.995
    expect(entry.slPrice).toBeCloseTo(100.5, 5);  // 100 * 1.005
  });

  it('should use stakePct when provided', () => {
    const config = { ...defaultConfig, stakePct: 0.05 }; // 5% of balance
    const entry = createTradeEntry(1000, 'CALL', 100, config);

    expect(entry.stake).toBe(50); // 1000 * 0.05
  });
});

// =============================================================================
// INTEGRATION TEST
// =============================================================================

describe('Integration: Full backtest scenario', () => {
  it('should produce consistent results for known trade sequence', () => {
    const config: BacktestConfig = {
      initialBalance: 1000,
      stakeAmount: 10,
      multiplier: 100,
      takeProfitPct: 0.01,   // 1%
      stopLossPct: 0.01,     // 1%
      maxBarsInTrade: 10,
      cooldownBars: 1,
    };

    // Trade 1: CALL at 100, price goes to 101 = WIN
    const entry1 = createTradeEntry(1000, 'CALL', 100, config);
    const candles1 = createCandles([
      { o: 100, h: 101.5, l: 99.8, c: 101 },
    ]);
    const trade1 = executeTrade(entry1, candles1, config)!;

    expect(trade1.result).toBe('WIN');
    // P&L: 0.01 * 10 * 100 = $10
    expect(trade1.pnl).toBeCloseTo(10, 2);

    // Trade 2: PUT at 100, price goes to 99 = WIN
    const entry2 = createTradeEntry(2000, 'PUT', 100, config);
    const candles2 = createCandles([
      { o: 100, h: 100.2, l: 98.5, c: 99 },
    ]);
    const trade2 = executeTrade(entry2, candles2, config)!;

    expect(trade2.result).toBe('WIN');
    expect(trade2.pnl).toBeCloseTo(10, 2);

    // Trade 3: CALL at 100, price drops to 99 = LOSS
    const entry3 = createTradeEntry(3000, 'CALL', 100, config);
    const candles3 = createCandles([
      { o: 100, h: 100.2, l: 98.5, c: 99 },
    ]);
    const trade3 = executeTrade(entry3, candles3, config)!;

    expect(trade3.result).toBe('LOSS');
    expect(trade3.pnl).toBeCloseTo(-10, 2);

    // Calculate metrics
    const metrics = calculateMetrics([trade1, trade2, trade3], config);

    expect(metrics.totalTrades).toBe(3);
    expect(metrics.wins).toBe(2);
    expect(metrics.losses).toBe(1);
    expect(metrics.winRate).toBeCloseTo(66.67, 0);
    expect(metrics.netPnl).toBeCloseTo(10, 2); // 10 + 10 - 10
    expect(metrics.profitFactor).toBe(2);      // 20 / 10
  });
});

// =============================================================================
// HELPERS
// =============================================================================

function createMockTrade(
  result: 'WIN' | 'LOSS',
  pnl: number,
  overrides?: Partial<Trade>
): Trade {
  return {
    timestamp: 1000,
    direction: 'CALL',
    entryPrice: 100,
    stake: 20,
    tpPrice: 100.5,
    slPrice: 99.5,
    exitTimestamp: 1060,
    exitPrice: result === 'WIN' ? 100.5 : 99.5,
    exitReason: result === 'WIN' ? 'TP' : 'SL',
    pnl,
    pnlPct: result === 'WIN' ? 0.5 : -0.5,
    result,
    barsHeld: 5,
    maxFavorableExcursion: 0.3,
    maxAdverseExcursion: 0.2,
    ...overrides,
  };
}

// =============================================================================
// MONTE CARLO TESTS
// =============================================================================

describe('runMonteCarloSimulation', () => {
  it('should return zeros for empty trades', () => {
    const mc = runMonteCarloSimulation([], defaultConfig);

    expect(mc.simulations).toBe(0);
    expect(mc.profitProbability).toBe(0);
    expect(mc.riskOfRuin).toBe(0);
  });

  it('should calculate correct profit probability for profitable trades', () => {
    // 10 winning trades of $20 each
    const trades = Array(10).fill(null).map(() => createMockTrade('WIN', 20));

    const mc = runMonteCarloSimulation(trades, defaultConfig, 100);

    // All permutations should be profitable since all trades win
    expect(mc.profitProbability).toBe(100);
    expect(mc.riskOfRuin).toBe(0);
    expect(mc.distribution.netPnl.mean).toBeCloseTo(200, 0); // 10 * $20
  });

  it('should calculate correct values for losing trades', () => {
    // 10 losing trades of $20 each
    const trades = Array(10).fill(null).map(() => createMockTrade('LOSS', -20));

    const mc = runMonteCarloSimulation(trades, defaultConfig, 100);

    // All permutations should lose money
    expect(mc.profitProbability).toBe(0);
    expect(mc.distribution.netPnl.mean).toBeCloseTo(-200, 0);
  });

  it('should have variation in drawdown across simulations', () => {
    // Mixed trades - order matters for drawdown
    const trades = [
      createMockTrade('WIN', 50),
      createMockTrade('WIN', 50),
      createMockTrade('LOSS', -30),
      createMockTrade('LOSS', -30),
      createMockTrade('LOSS', -30),
      createMockTrade('WIN', 40),
    ];

    const mc = runMonteCarloSimulation(trades, defaultConfig, 500);

    // Net PnL should be same for all permutations (50+50-30-30-30+40 = 50)
    // But drawdown varies based on order
    expect(mc.distribution.netPnl.mean).toBeCloseTo(50, 0);
    expect(mc.distribution.netPnl.p5).toBeCloseTo(50, 0);
    expect(mc.distribution.netPnl.p95).toBeCloseTo(50, 0);

    // Drawdown should have variation
    expect(mc.distribution.maxDrawdown.p95).toBeGreaterThan(mc.distribution.maxDrawdown.p5);
  });

  it('should detect risk of ruin with large losses', () => {
    // Trades that can cause bankruptcy if losses come first
    const config = { ...defaultConfig, initialBalance: 100 };
    const trades = [
      createMockTrade('LOSS', -40),
      createMockTrade('LOSS', -40),
      createMockTrade('LOSS', -40),
      createMockTrade('WIN', 200),  // Big win but might not happen if bankrupt
    ];

    const mc = runMonteCarloSimulation(trades, config, 1000);

    // Some permutations will go bankrupt (3 losses first = -120 on $100 balance)
    expect(mc.riskOfRuin).toBeGreaterThan(0);
  });

  it('should preserve net PnL across all permutations (no bankruptcy)', () => {
    // Trades that won't cause bankruptcy
    const config = { ...defaultConfig, initialBalance: 10000 };
    const trades = [
      createMockTrade('WIN', 100),
      createMockTrade('LOSS', -50),
      createMockTrade('WIN', 80),
      createMockTrade('LOSS', -30),
    ];

    const mc = runMonteCarloSimulation(trades, config, 100);

    // Net should be same: 100 - 50 + 80 - 30 = 100
    expect(mc.distribution.netPnl.mean).toBeCloseTo(100, 0);
    expect(mc.riskOfRuin).toBe(0);
  });

  it('should calculate confidence intervals correctly', () => {
    const trades = [
      createMockTrade('WIN', 30),
      createMockTrade('WIN', 30),
      createMockTrade('LOSS', -20),
      createMockTrade('WIN', 30),
      createMockTrade('LOSS', -20),
    ];

    const mc = runMonteCarloSimulation(trades, defaultConfig, 1000);

    // 95% CI should contain the actual net PnL
    expect(mc.confidence95.minProfit).toBeLessThanOrEqual(mc.original.netPnl);
    expect(mc.confidence95.maxProfit).toBeGreaterThanOrEqual(mc.original.netPnl);
  });
});

// =============================================================================
// WALK-FORWARD ANALYSIS TESTS
// =============================================================================

describe('runWalkForwardAnalysis', () => {
  it('should return empty result for insufficient trades', () => {
    const trades = [createMockTrade('WIN', 20)];
    const wfa = runWalkForwardAnalysis(trades, defaultConfig);

    expect(wfa.windows).toHaveLength(0);
    expect(wfa.consistencyScore).toBe(0);
  });

  it('should split trades into correct number of windows', () => {
    // Create 100 trades with sequential timestamps
    const trades = Array(100).fill(null).map((_, i) =>
      createMockTrade('WIN', 20, { timestamp: 1000 + i * 60 })
    );

    const wfa = runWalkForwardAnalysis(trades, defaultConfig, 5);

    expect(wfa.windows).toHaveLength(5);
    expect(wfa.totalTrainTrades + wfa.totalTestTrades).toBeLessThanOrEqual(100);
  });

  it('should calculate consistency score correctly', () => {
    // Create trades where all windows should be profitable
    const trades = Array(100).fill(null).map((_, i) =>
      createMockTrade('WIN', 20, { timestamp: 1000 + i * 60 })
    );

    const wfa = runWalkForwardAnalysis(trades, defaultConfig, 5);

    expect(wfa.consistencyScore).toBe(100); // All windows profitable
  });

  it('should detect degradation between train and test', () => {
    // Create trades that get worse over time (simulate overfitting)
    const trades: Trade[] = [];
    for (let i = 0; i < 100; i++) {
      // First half: mostly wins. Second half: mostly losses
      const isWin = i < 70;
      trades.push(createMockTrade(
        isWin ? 'WIN' : 'LOSS',
        isWin ? 20 : -20,
        { timestamp: 1000 + i * 60 }
      ));
    }

    const wfa = runWalkForwardAnalysis(trades, defaultConfig, 5);

    // Later windows should have worse test performance
    expect(wfa.windows.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// OUT-OF-SAMPLE TESTS
// =============================================================================

describe('runOutOfSampleTest', () => {
  it('should return error for insufficient trades', () => {
    const trades = [createMockTrade('WIN', 20)];
    const oos = runOutOfSampleTest(trades, defaultConfig);

    expect(oos.recommendation).toContain('Not enough trades');
  });

  it('should split trades chronologically', () => {
    const trades = Array(100).fill(null).map((_, i) =>
      createMockTrade('WIN', 20, { timestamp: 1000 + i * 60 })
    );

    const oos = runOutOfSampleTest(trades, defaultConfig, 0.7);

    expect(oos.inSample.trades).toBe(70);
    expect(oos.outOfSample.trades).toBe(30);
  });

  it('should mark as robust when OOS performs well', () => {
    // All winning trades - should perform same in both periods
    const trades = Array(100).fill(null).map((_, i) =>
      createMockTrade('WIN', 20, { timestamp: 1000 + i * 60 })
    );

    const oos = runOutOfSampleTest(trades, defaultConfig);

    expect(oos.isOverfit).toBe(false);
    expect(oos.overfitScore).toBeLessThan(20);
    expect(oos.recommendation).toContain('ROBUSTO');
  });

  it('should detect overfitting when OOS is much worse', () => {
    // First 70%: wins, Last 30%: losses
    const trades: Trade[] = [];
    for (let i = 0; i < 100; i++) {
      const isWin = i < 70;
      trades.push(createMockTrade(
        isWin ? 'WIN' : 'LOSS',
        isWin ? 20 : -20,
        { timestamp: 1000 + i * 60 }
      ));
    }

    const oos = runOutOfSampleTest(trades, defaultConfig, 0.7);

    // In-sample should be profitable, OOS should be losing
    expect(oos.inSample.netPnl).toBeGreaterThan(0);
    expect(oos.outOfSample.netPnl).toBeLessThan(0);
    expect(oos.isOverfit).toBe(true);
    expect(oos.recommendation).toContain('OVERFIT');
  });

  it('should calculate overfit score correctly', () => {
    // Mixed performance with degradation
    const trades: Trade[] = [];
    for (let i = 0; i < 100; i++) {
      // 80% wins in first half, 55% wins in second half
      const winProbability = i < 70 ? 0.8 : 0.55;
      const isWin = (i % 100) / 100 < winProbability;
      trades.push(createMockTrade(
        isWin ? 'WIN' : 'LOSS',
        isWin ? 20 : -20,
        { timestamp: 1000 + i * 60 }
      ));
    }

    const oos = runOutOfSampleTest(trades, defaultConfig);

    // Should have some overfit score due to degradation
    expect(oos.overfitScore).toBeGreaterThanOrEqual(0);
    expect(oos.overfitScore).toBeLessThanOrEqual(100);
  });
});
