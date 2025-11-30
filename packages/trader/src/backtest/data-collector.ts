/**
 * Data Collector for ML Feature Mining
 *
 * This module captures detailed market snapshots at trade entry points
 * for training ML models (XGBoost, etc.) to predict trade outcomes.
 *
 * Usage:
 * 1. Initialize DataCollector at backtest start
 * 2. Call captureEntry() when opening a trade
 * 3. Call updateOutcome() when trade closes
 * 4. Call exportToCSV() at backtest end
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';

// =============================================================================
// FEATURE ROW INTERFACE - All features captured at trade entry
// =============================================================================

export interface TradeFeatureRow {
  // Identification
  tradeId: string;
  asset: string;
  timestamp: number;
  datetime: string;

  // Time-based features
  hourOfDay: number;           // 0-23
  dayOfWeek: number;           // 0-6 (Sunday = 0)
  minuteOfHour: number;        // 0-59
  isMarketOpen: boolean;       // For forex: Asian/London/NY sessions
  timeBlock6h: number;         // v3.0.0: 6-hour block (0-3) for synthetic indices

  // Direction
  direction: 'CALL' | 'PUT';
  directionEncoded: number;    // 1 = CALL, 0 = PUT

  // Price context
  entryPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;

  // Raw Indicators - 1m Timeframe
  rsi1m: number | null;
  rsi1mPrev: number | null;    // Previous candle RSI
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;

  // Raw Indicators - 5m Timeframe
  rsi5m: number | null;
  rsi5mPrev: number | null;

  // Raw Indicators - 15m Timeframe (Context)
  adx15m: number | null;
  sma15m: number | null;
  sma15mPrev: number | null;

  // Engineered Features - Bollinger Bands
  bbWidth: number | null;           // (Upper - Lower) / Middle
  bbWidthPct: number | null;        // BB width as percentage
  pricePositionInBB: number | null; // Where price is in BB (-1 to 1, 0 = middle)
  distToUpperBB: number | null;     // % distance to upper band
  distToLowerBB: number | null;     // % distance to lower band

  // Engineered Features - RSI Analysis
  rsiDelta1m: number | null;        // RSI current - RSI previous (momentum)
  rsiDelta5m: number | null;        // 5m RSI momentum
  rsiDivergence: number | null;     // 1m RSI - 5m RSI (cross-timeframe)

  // Engineered Features - Trend
  smaSlope15m: number | null;       // Normalized SMA slope
  distToSma15m: number | null;      // % distance from price to SMA

  // Engineered Features - Volatility
  atr1m: number | null;             // Average True Range (if available)
  candleBodyPct: number | null;     // |Close - Open| / (High - Low)
  upperWickPct: number | null;      // Upper wick as % of range
  lowerWickPct: number | null;      // Lower wick as % of range

  // v3.0.0 Features - ATR-based
  atrPercent: number | null;        // ATR as percentage of price
  dynamicTpPct: number | null;      // Dynamic TP calculated from ATR
  dynamicSlPct: number | null;      // Dynamic SL calculated from ATR
  tpSlRatio: number | null;         // TP/SL ratio (reward/risk)

  // v3.0.0 Features - Normalized Slope
  normalizedSlope: number | null;   // Linear regression slope normalized by ATR
  slopeStrength: number | null;     // Absolute value of normalized slope

  // v3.0.0 Features - RSI Divergence Detection
  rsiDivergenceType: 'BULLISH' | 'BEARISH' | null; // Detected divergence type
  rsiDivergenceEncoded: number | null; // 1 = BULLISH, -1 = BEARISH, 0 = none

  // Regime
  regime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE' | null;
  regimeEncoded: number | null;     // 2 = BULLISH, 1 = RANGE, 0 = BEARISH

  // Strategy type
  strategyType: 'MOMENTUM' | 'MEAN_REVERSION';
  strategyEncoded: number;          // 1 = MOMENTUM, 0 = MEAN_REVERSION

  // Signal strength
  confidence: number;

  // Recent price action (lookback)
  priceChange1: number | null;      // % change last 1 candle
  priceChange5: number | null;      // % change last 5 candles
  priceChange15: number | null;     // % change last 15 candles

  // Target (filled after trade closes)
  target: number | null;            // 1 = WIN (TP hit), 0 = LOSS (SL hit)
  exitReason: string | null;        // 'TP', 'SL', 'TIMEOUT', 'TRAILING_STOP'
  pnl: number | null;               // Actual P&L
  barsHeld: number | null;          // How long trade was open
}

// =============================================================================
// DATA COLLECTOR CLASS
// =============================================================================

export class DataCollector {
  private trainingData: Map<string, TradeFeatureRow> = new Map();
  private tradeCounter: number = 0;
  private asset: string;

  constructor(asset: string) {
    this.asset = asset;
  }

  /**
   * Generate unique trade ID
   */
  private generateTradeId(): string {
    this.tradeCounter++;
    return `${this.asset}_${Date.now()}_${this.tradeCounter}`;
  }

  /**
   * Capture features at trade entry
   */
  captureEntry(params: {
    candles: Candle[];
    currentIndex: number;
    direction: 'CALL' | 'PUT';
    entryPrice: number;
    confidence: number;
    regime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE' | null;
    strategyType: 'MOMENTUM' | 'MEAN_REVERSION';
    indicators: {
      rsi1m: number | null;
      rsi1mPrev?: number | null;
      rsi5m: number | null;
      rsi5mPrev?: number | null;
      bbUpper: number | null;
      bbMiddle: number | null;
      bbLower: number | null;
      adx15m?: number | null;
      sma15m?: number | null;
      sma15mPrev?: number | null;
      atr1m?: number | null;
      // v3.0.0 additions
      atrPercent?: number | null;
      normalizedSlope?: number | null;
      rsiDivergence?: 'BULLISH' | 'BEARISH' | null;
      dynamicTpPct?: number | null;
      dynamicSlPct?: number | null;
    };
  }): string {
    const tradeId = this.generateTradeId();

    // Extract params first to avoid variable shadowing
    const { indicators, candles, currentIndex } = params;
    const candle = candles[currentIndex]!;
    const date = new Date(candle.timestamp * 1000);

    // BB Features
    let bbWidth: number | null = null;
    let bbWidthPct: number | null = null;
    let pricePositionInBB: number | null = null;
    let distToUpperBB: number | null = null;
    let distToLowerBB: number | null = null;

    if (indicators.bbUpper && indicators.bbMiddle && indicators.bbLower) {
      const range = indicators.bbUpper - indicators.bbLower;
      bbWidth = range / indicators.bbMiddle;
      bbWidthPct = bbWidth * 100;

      // Position in BB: -1 (at lower), 0 (at middle), +1 (at upper)
      pricePositionInBB = range > 0
        ? ((params.entryPrice - indicators.bbMiddle) / (range / 2))
        : 0;

      distToUpperBB = ((indicators.bbUpper - params.entryPrice) / params.entryPrice) * 100;
      distToLowerBB = ((params.entryPrice - indicators.bbLower) / params.entryPrice) * 100;
    }

    // RSI Deltas
    const rsiDelta1m = indicators.rsi1m !== null && indicators.rsi1mPrev !== null
      ? indicators.rsi1m - indicators.rsi1mPrev
      : null;

    const rsiDelta5m = indicators.rsi5m !== null && indicators.rsi5mPrev !== null
      ? indicators.rsi5m - indicators.rsi5mPrev
      : null;

    const rsiDivergence = indicators.rsi1m !== null && indicators.rsi5m !== null
      ? indicators.rsi1m - indicators.rsi5m
      : null;

    // SMA Features
    let smaSlope15m: number | null = null;
    let distToSma15m: number | null = null;

    if (indicators.sma15m !== null) {
      distToSma15m = ((params.entryPrice - indicators.sma15m) / indicators.sma15m) * 100;

      if (indicators.sma15mPrev !== null && indicators.sma15mPrev !== 0) {
        smaSlope15m = ((indicators.sma15m - indicators.sma15mPrev) / indicators.sma15mPrev) * 100;
      }
    }

    // Candle body analysis
    const candleRange = candle.high - candle.low;
    const candleBody = Math.abs(candle.close - candle.open);
    const candleBodyPct = candleRange > 0 ? candleBody / candleRange : 0;

    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWickPct = candleRange > 0 ? upperWick / candleRange : 0;
    const lowerWickPct = candleRange > 0 ? lowerWick / candleRange : 0;

    // Price changes (lookback)
    let priceChange1: number | null = null;
    let priceChange5: number | null = null;
    let priceChange15: number | null = null;

    if (currentIndex >= 1 && candles[currentIndex - 1]) {
      priceChange1 = ((candle.close - candles[currentIndex - 1]!.close) / candles[currentIndex - 1]!.close) * 100;
    }
    if (currentIndex >= 5 && candles[currentIndex - 5]) {
      priceChange5 = ((candle.close - candles[currentIndex - 5]!.close) / candles[currentIndex - 5]!.close) * 100;
    }
    if (currentIndex >= 15 && candles[currentIndex - 15]) {
      priceChange15 = ((candle.close - candles[currentIndex - 15]!.close) / candles[currentIndex - 15]!.close) * 100;
    }

    // Determine market session (for forex assets)
    const hour = date.getUTCHours();
    const isAsianSession = hour >= 0 && hour < 8;
    const isLondonSession = hour >= 8 && hour < 16;
    const isNYSession = hour >= 13 && hour < 22;
    const isMarketOpen = isAsianSession || isLondonSession || isNYSession;

    // v3.0.0: 6-hour time blocks for synthetic indices (24/7 markets)
    const timeBlock6h = Math.floor(hour / 6); // 0=00-06h, 1=06-12h, 2=12-18h, 3=18-24h

    // Encode categorical variables
    const regimeEncoded = params.regime === 'BULLISH_TREND' ? 2
      : params.regime === 'RANGE' ? 1
      : params.regime === 'BEARISH_TREND' ? 0
      : null;

    // v3.0.0: Process new features
    const atrPercent = indicators.atrPercent ?? null;
    const normalizedSlope = indicators.normalizedSlope ?? null;
    const slopeStrength = normalizedSlope !== null ? Math.abs(normalizedSlope) : null;
    const dynamicTpPct = indicators.dynamicTpPct ?? null;
    const dynamicSlPct = indicators.dynamicSlPct ?? null;
    const tpSlRatio = (dynamicTpPct !== null && dynamicSlPct !== null && dynamicSlPct !== 0)
      ? dynamicTpPct / dynamicSlPct
      : null;

    // v3.0.0: RSI Divergence encoding
    const rsiDivergenceType = indicators.rsiDivergence ?? null;
    const rsiDivergenceEncoded = rsiDivergenceType === 'BULLISH' ? 1
      : rsiDivergenceType === 'BEARISH' ? -1
      : 0;

    const row: TradeFeatureRow = {
      // Identification
      tradeId,
      asset: this.asset,
      timestamp: candle.timestamp,
      datetime: date.toISOString(),

      // Time features
      hourOfDay: date.getUTCHours(),
      dayOfWeek: date.getUTCDay(),
      minuteOfHour: date.getUTCMinutes(),
      isMarketOpen,
      timeBlock6h,

      // Direction
      direction: params.direction,
      directionEncoded: params.direction === 'CALL' ? 1 : 0,

      // Price context
      entryPrice: params.entryPrice,
      openPrice: candle.open,
      highPrice: candle.high,
      lowPrice: candle.low,
      closePrice: candle.close,

      // Raw indicators - 1m
      rsi1m: indicators.rsi1m,
      rsi1mPrev: indicators.rsi1mPrev ?? null,
      bbUpper: indicators.bbUpper,
      bbMiddle: indicators.bbMiddle,
      bbLower: indicators.bbLower,

      // Raw indicators - 5m
      rsi5m: indicators.rsi5m,
      rsi5mPrev: indicators.rsi5mPrev ?? null,

      // Raw indicators - 15m
      adx15m: indicators.adx15m ?? null,
      sma15m: indicators.sma15m ?? null,
      sma15mPrev: indicators.sma15mPrev ?? null,

      // Engineered - BB
      bbWidth,
      bbWidthPct,
      pricePositionInBB,
      distToUpperBB,
      distToLowerBB,

      // Engineered - RSI
      rsiDelta1m,
      rsiDelta5m,
      rsiDivergence,

      // Engineered - Trend
      smaSlope15m,
      distToSma15m,

      // Engineered - Volatility
      atr1m: indicators.atr1m ?? null,
      candleBodyPct,
      upperWickPct,
      lowerWickPct,

      // v3.0.0 Features - ATR-based
      atrPercent,
      dynamicTpPct,
      dynamicSlPct,
      tpSlRatio,

      // v3.0.0 Features - Normalized Slope
      normalizedSlope,
      slopeStrength,

      // v3.0.0 Features - RSI Divergence Detection
      rsiDivergenceType,
      rsiDivergenceEncoded,

      // Regime
      regime: params.regime,
      regimeEncoded,

      // Strategy
      strategyType: params.strategyType,
      strategyEncoded: params.strategyType === 'MOMENTUM' ? 1 : 0,

      // Signal
      confidence: params.confidence,

      // Price action
      priceChange1,
      priceChange5,
      priceChange15,

      // Target (to be filled later)
      target: null,
      exitReason: null,
      pnl: null,
      barsHeld: null,
    };

    this.trainingData.set(tradeId, row);
    return tradeId;
  }

  /**
   * Update trade outcome after it closes
   */
  updateOutcome(params: {
    tradeId: string;
    exitReason: 'TP' | 'SL' | 'TIMEOUT' | 'TRAILING_STOP';
    pnl: number;
    barsHeld: number;
  }): void {
    const row = this.trainingData.get(params.tradeId);
    if (!row) {
      console.warn(`[DataCollector] Trade ${params.tradeId} not found`);
      return;
    }

    // Target: 1 = WIN (TP hit or positive PnL), 0 = LOSS
    const isWin = params.exitReason === 'TP' ||
      (params.exitReason === 'TRAILING_STOP' && params.pnl > 0);

    row.target = isWin ? 1 : 0;
    row.exitReason = params.exitReason;
    row.pnl = params.pnl;
    row.barsHeld = params.barsHeld;
  }

  /**
   * Get all collected data (including incomplete trades)
   */
  getAllData(): TradeFeatureRow[] {
    return Array.from(this.trainingData.values());
  }

  /**
   * Get only completed trades (with target filled)
   */
  getCompletedData(): TradeFeatureRow[] {
    return Array.from(this.trainingData.values()).filter(row => row.target !== null);
  }

  /**
   * Get statistics about collected data
   */
  getStats(): {
    total: number;
    completed: number;
    incomplete: number;
    wins: number;
    losses: number;
    winRate: number;
  } {
    const all = this.getAllData();
    const completed = this.getCompletedData();
    const wins = completed.filter(r => r.target === 1).length;
    const losses = completed.filter(r => r.target === 0).length;

    return {
      total: all.length,
      completed: completed.length,
      incomplete: all.length - completed.length,
      wins,
      losses,
      winRate: completed.length > 0 ? (wins / completed.length) * 100 : 0,
    };
  }

  /**
   * Export data to CSV file
   */
  exportToCSV(outputDir?: string): string {
    const data = this.getCompletedData();

    if (data.length === 0) {
      console.warn('[DataCollector] No completed trades to export');
      return '';
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `ml_training_${this.asset}_${timestamp}.csv`;

    // Use provided dir or default to analysis-output
    const dir = outputDir || path.join(process.cwd(), 'analysis-output');

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filepath = path.join(dir, filename);

    // Get headers from first row
    const headers = Object.keys(data[0]!);

    // Build CSV content
    const lines: string[] = [];
    lines.push(headers.join(','));

    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header as keyof TradeFeatureRow];

        // Handle null values
        if (value === null || value === undefined) {
          return '';
        }

        // Handle strings (escape commas and quotes)
        if (typeof value === 'string') {
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }

        // Handle booleans
        if (typeof value === 'boolean') {
          return value ? '1' : '0';
        }

        // Handle numbers (round to 6 decimal places for floats)
        if (typeof value === 'number') {
          return Number.isInteger(value) ? value.toString() : value.toFixed(6);
        }

        return String(value);
      });

      lines.push(values.join(','));
    }

    // Write file
    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');

    console.log(`[DataCollector] Exported ${data.length} trades to ${filepath}`);
    return filepath;
  }

  /**
   * Export to JSON (for inspection/debugging)
   */
  exportToJSON(outputDir?: string): string {
    const data = this.getCompletedData();

    if (data.length === 0) {
      console.warn('[DataCollector] No completed trades to export');
      return '';
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `ml_training_${this.asset}_${timestamp}.json`;

    const dir = outputDir || path.join(process.cwd(), 'analysis-output');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filepath = path.join(dir, filename);

    const output = {
      meta: {
        asset: this.asset,
        exportedAt: new Date().toISOString(),
        totalTrades: data.length,
        stats: this.getStats(),
      },
      features: Object.keys(data[0]!),
      data,
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`[DataCollector] Exported ${data.length} trades to ${filepath}`);
    return filepath;
  }

  /**
   * Reset collector for new backtest
   */
  reset(): void {
    this.trainingData.clear();
    this.tradeCounter = 0;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a DataCollector instance
 */
export function createDataCollector(asset: string): DataCollector {
  return new DataCollector(asset);
}

/**
 * Feature importance hints for ML model training
 */
export const FEATURE_IMPORTANCE_HINTS = {
  // High importance (likely predictive)
  high: [
    'rsi1m',
    'rsi5m',
    'bbWidth',
    'pricePositionInBB',
    'rsiDelta1m',
    'regime',
    'strategyType',
    'hourOfDay',
    'distToSma15m',
  ],
  // Medium importance
  medium: [
    'rsiDivergence',
    'smaSlope15m',
    'adx15m',
    'priceChange5',
    'candleBodyPct',
    'confidence',
  ],
  // Lower importance (contextual)
  low: [
    'dayOfWeek',
    'minuteOfHour',
    'upperWickPct',
    'lowerWickPct',
    'isMarketOpen',
  ],
};

/**
 * Recommended XGBoost parameters for this dataset
 */
export const RECOMMENDED_XGBOOST_PARAMS = {
  // Classification task
  objective: 'binary:logistic',
  eval_metric: 'auc',

  // Tree parameters
  max_depth: 6,
  min_child_weight: 1,
  subsample: 0.8,
  colsample_bytree: 0.8,

  // Learning
  learning_rate: 0.1,
  n_estimators: 100,

  // Regularization (prevent overfitting)
  reg_alpha: 0.1,
  reg_lambda: 1.0,

  // Class imbalance handling
  scale_pos_weight: 1.0, // Adjust based on win/loss ratio
};
