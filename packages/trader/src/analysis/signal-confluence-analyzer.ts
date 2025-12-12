/**
 * Signal Confluence Analyzer
 *
 * Combines multiple analysis tools to generate high-quality trading signals:
 * - MTF Market Structure (support/resistance zones from 1m, 5m, 15m)
 * - RSI Divergence Detection
 * - Session/Killzone Filtering
 * - Liquidity Sweep Detection (from FVG-LS strategy)
 *
 * The goal is to find confluence of multiple factors for high-accuracy entries.
 */

import type { Candle } from '@deriv-bot/shared';
import {
  MTFMarketStructureAnalyzer,
  type MTFMarketStructure,
  type MTFZone,
  type ConfluenceZone,
} from './mtf-market-structure.js';
import {
  RSIDivergenceDetector,
  type RSIDivergence,
  type DivergenceDetectorOptions,
} from './rsi-divergence-detector.js';
import {
  SessionFilterService,
  type TradingSession,
  type SessionParams,
} from '../services/session-filter.service.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Signal direction
 */
export type SignalDirection = 'long' | 'short' | 'none';

/**
 * Confluence factors that can contribute to signal quality
 */
export interface ConfluenceFactors {
  // MTF Structure
  mtfStructure: {
    available: boolean;
    trend: 'up' | 'down' | 'sideways';
    trendStrength: number;
    atZone: boolean;
    zone?: MTFZone | ConfluenceZone;
    zoneType?: 'support' | 'resistance';
    zoneTimeframes: string[]; // Which TFs have this zone
    confluenceCount: number; // How many TFs agree
  };

  // RSI Divergence
  rsiDivergence: {
    available: boolean;
    detected: boolean;
    divergence?: RSIDivergence;
    type?: string;
    strength: number;
    confirmed: boolean;
  };

  // Session Filter
  session: {
    available: boolean;
    currentSession: TradingSession;
    isKillzone: boolean; // London/NY overlap
    stakePct: number;
    slMultiplier: number;
    canTrade: boolean;
  };

  // Price Action
  priceAction: {
    nearZone: boolean; // Is price within zone range
    distanceToZone: number; // As percentage of price
    rejectionCandle: boolean; // Rejection pattern at zone
    breakoutAttempt: boolean; // Breaking through zone
  };
}

/**
 * A confluence signal with quality score
 */
export interface ConfluenceSignal {
  // Basic signal info
  direction: SignalDirection;
  timestamp: number;
  price: number;
  asset: string;

  // Quality metrics
  score: number; // 0-100
  confidence: 'low' | 'medium' | 'high' | 'very_high';

  // Contributing factors
  factors: ConfluenceFactors;

  // Breakdown of score
  scoreBreakdown: {
    mtfScore: number;
    divergenceScore: number;
    sessionScore: number;
    priceActionScore: number;
  };

  // Suggested trade parameters
  suggestedEntry: number;
  suggestedSL: number;
  suggestedTP: number;
  riskRewardRatio: number;

  // Reasoning
  reasons: string[];
  warnings: string[];
}

/**
 * Analyzer configuration
 */
export interface ConfluenceAnalyzerConfig {
  // Minimum score to generate signal
  minSignalScore: number;

  // Weight for each factor (0-1)
  weights: {
    mtfStructure: number;
    rsiDivergence: number;
    session: number;
    priceAction: number;
  };

  // RSI Divergence settings
  divergenceOptions: DivergenceDetectorOptions;

  // Zone proximity threshold (as % of price)
  zoneProximityPct: number;

  // Session filter settings
  allowedSessions: TradingSession[];

  // Killzone boost (extra score during London/NY overlap)
  killzoneBoost: number;

  // Require confirmation candle
  requireConfirmation: boolean;
}

const DEFAULT_CONFIG: ConfluenceAnalyzerConfig = {
  minSignalScore: 60,
  weights: {
    mtfStructure: 0.35,
    rsiDivergence: 0.30,
    session: 0.15,
    priceAction: 0.20,
  },
  divergenceOptions: {
    rsiPeriod: 14,
    minSwingDistance: 5,
    maxSwingDistance: 40,
    swingLookback: 3,
    minRSIDifference: 3,
    requireConfirmation: true,
  },
  zoneProximityPct: 0.15, // 0.15% = ~15 pips for forex
  allowedSessions: ['ASIAN', 'LONDON', 'OVERLAP', 'NY'],
  killzoneBoost: 10,
  requireConfirmation: true,
};

// ============================================================================
// SIGNAL CONFLUENCE ANALYZER
// ============================================================================

/**
 * Signal Confluence Analyzer
 *
 * Analyzes market conditions across multiple dimensions to find
 * high-probability trade setups.
 *
 * @example
 * ```typescript
 * const analyzer = new SignalConfluenceAnalyzer();
 *
 * // Analyze current market conditions
 * const signal = analyzer.analyze(candles1m, asset);
 *
 * if (signal.score >= 70) {
 *   console.log(`High quality ${signal.direction} signal!`);
 *   console.log(`Score: ${signal.score}, Confidence: ${signal.confidence}`);
 * }
 * ```
 */
export class SignalConfluenceAnalyzer {
  private config: ConfluenceAnalyzerConfig;
  private mtfAnalyzer: MTFMarketStructureAnalyzer;
  private divergenceDetector: RSIDivergenceDetector;
  private sessionFilter: SessionFilterService;

  constructor(config: Partial<ConfluenceAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize sub-analyzers
    this.mtfAnalyzer = new MTFMarketStructureAnalyzer();
    this.divergenceDetector = new RSIDivergenceDetector(this.config.divergenceOptions);
    this.sessionFilter = new SessionFilterService({
      enabled: true,
      allowedSessions: this.config.allowedSessions,
    });
  }

  /**
   * Analyze market conditions and generate confluence signal
   *
   * @param candles1m - 1-minute candles (minimum 500 recommended)
   * @param asset - Asset symbol
   * @param timestamp - Optional specific timestamp (defaults to latest candle)
   */
  analyze(candles1m: Candle[], asset: string, timestamp?: number): ConfluenceSignal {
    const currentCandle = candles1m[candles1m.length - 1]!;
    const currentPrice = currentCandle.close;
    const ts = timestamp ?? currentCandle.timestamp;

    // Analyze each factor
    const mtfFactor = this.analyzeMTFStructure(candles1m, currentPrice, asset);
    const divergenceFactor = this.analyzeDivergence(candles1m, mtfFactor);
    const sessionFactor = this.analyzeSession(ts);
    const priceActionFactor = this.analyzePriceAction(candles1m, mtfFactor);

    // Combine factors
    const factors: ConfluenceFactors = {
      mtfStructure: mtfFactor,
      rsiDivergence: divergenceFactor,
      session: sessionFactor,
      priceAction: priceActionFactor,
    };

    // Calculate scores
    const mtfScore = this.calculateMTFScore(mtfFactor);
    const divergenceScore = this.calculateDivergenceScore(divergenceFactor);
    const sessionScore = this.calculateSessionScore(sessionFactor);
    const priceActionScore = this.calculatePriceActionScore(priceActionFactor);

    // Weighted total
    const totalScore = Math.round(
      mtfScore * this.config.weights.mtfStructure +
      divergenceScore * this.config.weights.rsiDivergence +
      sessionScore * this.config.weights.session +
      priceActionScore * this.config.weights.priceAction
    );

    // Determine direction
    const direction = this.determineDirection(factors);

    // Calculate confidence level
    const confidence = this.calculateConfidence(totalScore);

    // Build reasons and warnings
    const { reasons, warnings } = this.buildReasoningAnalysis(factors, direction);

    // Calculate trade parameters
    const tradeParams = this.calculateTradeParams(factors, currentPrice, direction);

    return {
      direction,
      timestamp: ts,
      price: currentPrice,
      asset,
      score: totalScore,
      confidence,
      factors,
      scoreBreakdown: {
        mtfScore,
        divergenceScore,
        sessionScore,
        priceActionScore,
      },
      suggestedEntry: tradeParams.entry,
      suggestedSL: tradeParams.sl,
      suggestedTP: tradeParams.tp,
      riskRewardRatio: tradeParams.rr,
      reasons,
      warnings,
    };
  }

  /**
   * Quick check if conditions are favorable for any signal
   */
  hasSignal(candles1m: Candle[], asset: string): boolean {
    const signal = this.analyze(candles1m, asset);
    return signal.score >= this.config.minSignalScore && signal.direction !== 'none';
  }

  // ============================================================================
  // FACTOR ANALYSIS
  // ============================================================================

  private analyzeMTFStructure(
    candles1m: Candle[],
    currentPrice: number,
    asset: string
  ): ConfluenceFactors['mtfStructure'] {
    try {
      const mtfStructure = this.mtfAnalyzer.analyze(candles1m, asset);

      // Find nearest zone
      let nearestZone: MTFZone | ConfluenceZone | undefined;
      let zoneType: 'support' | 'resistance' | undefined;
      let minDistance = Infinity;
      let zoneTimeframes: string[] = [];

      // Check confluence zones first (highest priority)
      for (const zone of mtfStructure.confluenceZones) {
        const midPrice = (zone.high + zone.low) / 2;
        const distance = Math.abs(currentPrice - midPrice) / currentPrice;

        if (distance < minDistance && distance < this.config.zoneProximityPct / 100) {
          minDistance = distance;
          nearestZone = zone;
          zoneType = zone.type;
          zoneTimeframes = zone.timeframes;
        }
      }

      // Then check all TF zones
      const allZones = [...mtfStructure.zones15m, ...mtfStructure.zones5m, ...mtfStructure.zones1m];
      for (const zone of allZones) {
        const midPrice = (zone.high + zone.low) / 2;
        const distance = Math.abs(currentPrice - midPrice) / currentPrice;

        if (distance < minDistance && distance < this.config.zoneProximityPct / 100) {
          minDistance = distance;
          nearestZone = zone;
          zoneType = zone.type;
          zoneTimeframes = [zone.source || '1m'];
        }
      }

      const atZone = nearestZone !== undefined;
      const confluenceCount = zoneTimeframes.length;

      return {
        available: true,
        trend: mtfStructure.overallTrend,
        trendStrength: mtfStructure.trendStrength,
        atZone,
        zone: nearestZone,
        zoneType,
        zoneTimeframes,
        confluenceCount,
      };
    } catch {
      return {
        available: false,
        trend: 'sideways',
        trendStrength: 0,
        atZone: false,
        zoneTimeframes: [],
        confluenceCount: 0,
      };
    }
  }

  private analyzeDivergence(
    candles1m: Candle[],
    mtfFactor: ConfluenceFactors['mtfStructure']
  ): ConfluenceFactors['rsiDivergence'] {
    try {
      let divergence: RSIDivergence | null = null;

      // If at a zone, look for divergence at that zone
      if (mtfFactor.atZone && mtfFactor.zone) {
        divergence = this.divergenceDetector.detectAtZone(
          candles1m,
          mtfFactor.zone.low,
          mtfFactor.zone.high,
          mtfFactor.zoneType!
        );
      }

      // Otherwise check for any recent divergence
      if (!divergence) {
        divergence = this.divergenceDetector.detectLatest(candles1m);
      }

      if (!divergence) {
        return {
          available: true,
          detected: false,
          strength: 0,
          confirmed: false,
        };
      }

      // Check if divergence is recent (within last 20 candles)
      const lastCandleIndex = candles1m.length - 1;
      const divergenceAge = lastCandleIndex - divergence.pricePoint2.index;

      if (divergenceAge > 20) {
        return {
          available: true,
          detected: false,
          strength: 0,
          confirmed: false,
        };
      }

      return {
        available: true,
        detected: true,
        divergence,
        type: divergence.type,
        strength: divergence.strength,
        confirmed: divergence.confirmed,
      };
    } catch {
      return {
        available: false,
        detected: false,
        strength: 0,
        confirmed: false,
      };
    }
  }

  private analyzeSession(timestamp: number): ConfluenceFactors['session'] {
    const session = this.sessionFilter.getSession(timestamp);
    const params = this.sessionFilter.getSessionParams(timestamp);
    const canTrade = this.sessionFilter.shouldTrade(timestamp);

    const isKillzone = session === 'OVERLAP' || session === 'LONDON';

    return {
      available: true,
      currentSession: session,
      isKillzone,
      stakePct: params.stakePct,
      slMultiplier: params.slMultiplier,
      canTrade,
    };
  }

  private analyzePriceAction(
    candles1m: Candle[],
    mtfFactor: ConfluenceFactors['mtfStructure']
  ): ConfluenceFactors['priceAction'] {
    const currentCandle = candles1m[candles1m.length - 1]!;
    const prevCandle = candles1m[candles1m.length - 2];

    let nearZone = false;
    let distanceToZone = 1; // 100% by default
    let rejectionCandle = false;
    let breakoutAttempt = false;

    if (mtfFactor.atZone && mtfFactor.zone) {
      nearZone = true;
      const zoneMid = (mtfFactor.zone.high + mtfFactor.zone.low) / 2;
      distanceToZone = Math.abs(currentCandle.close - zoneMid) / currentCandle.close;

      // Check for rejection candle
      const candleRange = currentCandle.high - currentCandle.low;
      const body = Math.abs(currentCandle.close - currentCandle.open);
      const bodyRatio = candleRange > 0 ? body / candleRange : 0;

      if (mtfFactor.zoneType === 'support') {
        // Bullish rejection: long lower wick, small body, close near high
        const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
        if (bodyRatio < 0.4 && lowerWick > candleRange * 0.5) {
          rejectionCandle = true;
        }
        // Breakout attempt: strong bearish candle breaking below
        if (currentCandle.close < mtfFactor.zone.low && currentCandle.close < currentCandle.open) {
          breakoutAttempt = true;
        }
      } else {
        // Bearish rejection: long upper wick, small body, close near low
        const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
        if (bodyRatio < 0.4 && upperWick > candleRange * 0.5) {
          rejectionCandle = true;
        }
        // Breakout attempt: strong bullish candle breaking above
        if (currentCandle.close > mtfFactor.zone.high && currentCandle.close > currentCandle.open) {
          breakoutAttempt = true;
        }
      }
    }

    return {
      nearZone,
      distanceToZone,
      rejectionCandle,
      breakoutAttempt,
    };
  }

  // ============================================================================
  // SCORING
  // ============================================================================

  private calculateMTFScore(factor: ConfluenceFactors['mtfStructure']): number {
    if (!factor.available) return 0;

    let score = 0;

    // Being at a zone is key
    if (factor.atZone) {
      score += 50;

      // Confluence from multiple TFs adds score
      score += Math.min(factor.confluenceCount * 15, 30);
    }

    // Trend alignment adds score
    if (factor.trendStrength > 50) {
      score += 20;
    }

    return Math.min(score, 100);
  }

  private calculateDivergenceScore(factor: ConfluenceFactors['rsiDivergence']): number {
    if (!factor.available || !factor.detected) return 0;

    let score = factor.strength; // Base score from divergence strength

    // Confirmation bonus
    if (factor.confirmed) {
      score += 15;
    }

    // Regular divergences are stronger than hidden
    if (factor.type === 'bullish' || factor.type === 'bearish') {
      score += 10;
    }

    return Math.min(score, 100);
  }

  private calculateSessionScore(factor: ConfluenceFactors['session']): number {
    if (!factor.available || !factor.canTrade) return 0;

    let score = 50; // Base score for being in allowed session

    // Killzone bonus
    if (factor.isKillzone) {
      score += this.config.killzoneBoost;
    }

    // High stake sessions are better
    if (factor.stakePct >= 1.0) {
      score += 20;
    } else if (factor.stakePct >= 0.75) {
      score += 10;
    }

    // CLOSED session penalty
    if (factor.currentSession === 'CLOSED') {
      score = 0;
    }

    return Math.min(score, 100);
  }

  private calculatePriceActionScore(factor: ConfluenceFactors['priceAction']): number {
    let score = 0;

    if (factor.nearZone) {
      score += 30;

      // Closer to zone = higher score
      if (factor.distanceToZone < 0.0005) { // Within 5 pips
        score += 30;
      } else if (factor.distanceToZone < 0.001) { // Within 10 pips
        score += 20;
      }

      // Rejection candle is strong confirmation
      if (factor.rejectionCandle) {
        score += 30;
      }

      // Breakout attempt is bearish for the signal
      if (factor.breakoutAttempt) {
        score -= 20;
      }
    }

    return Math.max(0, Math.min(score, 100));
  }

  // ============================================================================
  // DIRECTION & TRADE PARAMS
  // ============================================================================

  private determineDirection(factors: ConfluenceFactors): SignalDirection {
    const { mtfStructure, rsiDivergence, session, priceAction } = factors;

    // Must be able to trade
    if (!session.canTrade) return 'none';

    // Must have some zone context
    if (!mtfStructure.atZone) return 'none';

    // Determine direction from factors
    let longScore = 0;
    let shortScore = 0;

    // Zone type suggests direction
    if (mtfStructure.zoneType === 'support') {
      longScore += 30;
    } else if (mtfStructure.zoneType === 'resistance') {
      shortScore += 30;
    }

    // Divergence direction
    if (rsiDivergence.detected && rsiDivergence.divergence) {
      if (rsiDivergence.divergence.expectedDirection === 'up') {
        longScore += 40;
      } else {
        shortScore += 40;
      }
    }

    // Price action
    if (priceAction.rejectionCandle) {
      if (mtfStructure.zoneType === 'support') {
        longScore += 20;
      } else {
        shortScore += 20;
      }
    }

    // Breakout attempt contradicts zone trade
    if (priceAction.breakoutAttempt) {
      if (mtfStructure.zoneType === 'support') {
        longScore -= 30;
      } else {
        shortScore -= 30;
      }
    }

    // Decide
    if (longScore > shortScore && longScore > 40) {
      return 'long';
    } else if (shortScore > longScore && shortScore > 40) {
      return 'short';
    }

    return 'none';
  }

  private calculateTradeParams(
    factors: ConfluenceFactors,
    currentPrice: number,
    direction: SignalDirection
  ): { entry: number; sl: number; tp: number; rr: number } {
    const defaultRR = 2;

    if (direction === 'none' || !factors.mtfStructure.zone) {
      return { entry: currentPrice, sl: currentPrice, tp: currentPrice, rr: 0 };
    }

    const zone = factors.mtfStructure.zone;
    const entry = currentPrice;

    // SL just beyond zone
    const zoneBuffer = (zone.high - zone.low) * 0.5;
    let sl: number;
    let tp: number;

    if (direction === 'long') {
      sl = zone.low - zoneBuffer;
      const risk = entry - sl;
      tp = entry + risk * defaultRR;
    } else {
      sl = zone.high + zoneBuffer;
      const risk = sl - entry;
      tp = entry - risk * defaultRR;
    }

    // Apply session SL multiplier
    const slMultiplier = factors.session.slMultiplier || 1;
    if (direction === 'long') {
      sl = entry - (entry - sl) * slMultiplier;
    } else {
      sl = entry + (sl - entry) * slMultiplier;
    }

    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr = risk > 0 ? reward / risk : 0;

    return { entry, sl, tp, rr };
  }

  private calculateConfidence(score: number): ConfluenceSignal['confidence'] {
    if (score >= 85) return 'very_high';
    if (score >= 70) return 'high';
    if (score >= 55) return 'medium';
    return 'low';
  }

  // ============================================================================
  // REASONING
  // ============================================================================

  private buildReasoningAnalysis(
    factors: ConfluenceFactors,
    direction: SignalDirection
  ): { reasons: string[]; warnings: string[] } {
    const reasons: string[] = [];
    const warnings: string[] = [];

    // MTF Structure reasons
    if (factors.mtfStructure.atZone) {
      const tfCount = factors.mtfStructure.zoneTimeframes.length;
      if (tfCount >= 2) {
        reasons.push(`At ${factors.mtfStructure.zoneType} zone with ${tfCount} TF confluence`);
      } else {
        reasons.push(`At ${factors.mtfStructure.zoneType} zone`);
      }
    }

    if (factors.mtfStructure.trendStrength > 60) {
      reasons.push(`Strong ${factors.mtfStructure.trend} trend (${factors.mtfStructure.trendStrength}%)`);
    }

    // Divergence reasons
    if (factors.rsiDivergence.detected) {
      const divType = factors.rsiDivergence.type?.replace('_', ' ');
      const confirmed = factors.rsiDivergence.confirmed ? 'confirmed' : 'unconfirmed';
      reasons.push(`${divType} RSI divergence (${confirmed}, strength ${factors.rsiDivergence.strength}%)`);
    }

    // Session reasons
    if (factors.session.isKillzone) {
      reasons.push(`Trading during ${factors.session.currentSession} killzone`);
    }

    // Price action reasons
    if (factors.priceAction.rejectionCandle) {
      reasons.push('Rejection candle at zone');
    }

    // Warnings
    if (!factors.session.canTrade) {
      warnings.push(`${factors.session.currentSession} session - trading not recommended`);
    }

    if (factors.priceAction.breakoutAttempt) {
      warnings.push('Price attempting to break zone - may invalidate setup');
    }

    if (factors.session.stakePct < 1) {
      warnings.push(`Reduced stake recommended (${factors.session.stakePct * 100}%)`);
    }

    if (!factors.rsiDivergence.detected && direction !== 'none') {
      warnings.push('No RSI divergence confirmation');
    }

    return { reasons, warnings };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a confluence analyzer with default settings
 */
export function createConfluenceAnalyzer(
  config?: Partial<ConfluenceAnalyzerConfig>
): SignalConfluenceAnalyzer {
  return new SignalConfluenceAnalyzer(config);
}

/**
 * Quick analysis function
 */
export function analyzeConfluence(
  candles1m: Candle[],
  asset: string,
  config?: Partial<ConfluenceAnalyzerConfig>
): ConfluenceSignal {
  const analyzer = new SignalConfluenceAnalyzer(config);
  return analyzer.analyze(candles1m, asset);
}
