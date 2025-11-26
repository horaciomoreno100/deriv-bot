/**
 * AI Analysis Types - For ML-enhanced signal quality assessment
 */

/**
 * Market regime detection
 */
export type MarketRegime =
  | 'trending_up'      // Strong upward trend
  | 'trending_down'    // Strong downward trend
  | 'ranging'          // Sideways movement
  | 'high_volatility'  // Choppy, unpredictable
  | 'low_volatility'   // Calm, stable
  | 'reversal_bullish' // Potential reversal to upside
  | 'reversal_bearish' // Potential reversal to downside
  | 'unknown';         // Not enough data

/**
 * Market context analysis result
 */
export interface MarketContext {
  /** Current market regime */
  regime: MarketRegime;
  /** Regime confidence (0-1) */
  regimeConfidence: number;
  /** Current volatility percentile (0-100) */
  volatilityPercentile: number;
  /** Trend strength (-1 to 1, negative = down, positive = up) */
  trendStrength: number;
  /** Momentum indicator (-1 to 1) */
  momentum: number;
  /** Volume profile (relative to average, 0-2+) */
  volumeProfile: number;
  /** Mean reversion probability (0-1) */
  meanReversionProb: number;
  /** Trend continuation probability (0-1) */
  trendContinuationProb: number;
}

/**
 * Signal quality score breakdown
 */
export interface SignalQualityScore {
  /** Overall quality score (0-100) */
  overall: number;
  /** Individual component scores */
  components: {
    /** Technical indicator alignment (0-100) */
    technicalAlignment: number;
    /** Pattern recognition match (0-100) */
    patternMatch: number;
    /** Historical edge based on similar setups (0-100) */
    historicalEdge: number;
    /** Risk/reward assessment (0-100) */
    riskReward: number;
    /** Market regime compatibility (0-100) */
    regimeCompatibility: number;
    /** Timing quality (0-100) */
    timing: number;
  };
  /** Explanation of the score */
  explanation: string[];
  /** Warning flags */
  warnings: string[];
}

/**
 * AI-enhanced trade recommendation
 */
export interface AITradeRecommendation {
  /** Should execute this trade? */
  shouldTrade: boolean;
  /** Recommended position size multiplier (0.5 = half size, 1.0 = full, 1.5 = 1.5x, etc.) */
  sizeMultiplier: number;
  /** Recommended TP adjustment (multiplier, 1.0 = keep original) */
  tpMultiplier: number;
  /** Recommended SL adjustment (multiplier, 1.0 = keep original) */
  slMultiplier: number;
  /** Adjusted confidence (0-1) */
  adjustedConfidence: number;
  /** Reasoning for the recommendation */
  reasoning: string[];
  /** Alternative suggestions */
  alternatives?: string[];
}

/**
 * Historical pattern match
 */
export interface PatternMatch {
  /** Pattern type identifier */
  patternId: string;
  /** Pattern name */
  patternName: string;
  /** Similarity score (0-1) */
  similarity: number;
  /** Historical win rate for this pattern */
  historicalWinRate: number;
  /** Average profit for this pattern */
  avgProfit: number;
  /** Number of historical occurrences */
  occurrences: number;
  /** Best entry timing after pattern (seconds) */
  bestTiming?: number;
}

/**
 * Complete AI analysis result
 */
export interface AIAnalysisResult {
  /** Timestamp of analysis */
  timestamp: number;
  /** Asset being analyzed */
  asset: string;
  /** Market context */
  marketContext: MarketContext;
  /** Signal quality score */
  qualityScore: SignalQualityScore;
  /** Trade recommendation */
  recommendation: AITradeRecommendation;
  /** Pattern matches found */
  patternMatches: PatternMatch[];
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * AI Analyzer configuration
 */
export interface AIAnalyzerConfig {
  /** Minimum quality score to execute trade (0-100) */
  minQualityScore: number;
  /** Enable pattern recognition */
  enablePatternRecognition: boolean;
  /** Enable regime detection */
  enableRegimeDetection: boolean;
  /** Historical data window size (number of candles) */
  historicalWindow: number;
  /** Minimum historical samples for pattern matching */
  minHistoricalSamples: number;
  /** Conservative mode (stricter filtering) */
  conservativeMode: boolean;
}

/**
 * Learning data point for ML training
 */
export interface TradeOutcomeData {
  /** Trade ID */
  tradeId: string;
  /** Timestamp */
  timestamp: number;
  /** Asset */
  asset: string;
  /** Direction */
  direction: 'CALL' | 'PUT';
  /** Market context at entry */
  entryContext: MarketContext;
  /** Quality score at entry */
  entryQualityScore: SignalQualityScore;
  /** Entry price */
  entryPrice: number;
  /** Exit price */
  exitPrice: number;
  /** Profit/Loss */
  pnl: number;
  /** Was it a win? */
  won: boolean;
  /** Actual duration */
  durationSeconds: number;
  /** Exit reason */
  exitReason: 'tp' | 'sl' | 'timeout' | 'manual';
}
