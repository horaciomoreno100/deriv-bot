/**
 * SMC Opportunity Backtest Strategy
 *
 * Tests SMC (Smart Money Concepts) signals historically:
 * - Detects signals at each bar WITHOUT looking ahead
 * - Tracks if TP or SL was hit after signal
 * - Calculates win rate, profit factor, and other metrics
 *
 * ANTI-OVERFITTING:
 * - Uses binary confluences (present/not present)
 * - Simple counting instead of weighted scoring
 * - No parameter optimization in this file
 */

import type { Candle, IndicatorSnapshot } from '@deriv-bot/shared';
import type { BacktestableStrategy, EntrySignal, BacktestConfig, MarketSnapshot } from '../types.js';
import {
  SMCOpportunityDetector,
  type SMCOpportunity,
  type SMCDetectorInput,
} from '../../analysis/smc-opportunity-detector.js';
import { MTFMarketStructureAnalyzer } from '../../analysis/mtf-market-structure.js';
import { OrderBlockDetector } from '../../analysis/order-block-detector.js';
import { FVGDetector } from '../../analysis/fvg-detector.js';
import { LiquiditySweepDetector } from '../../analysis/liquidity-sweep-detector.js';

/**
 * SMC Backtest Parameters
 */
export interface SMCBacktestParams {
  // Quality filter
  minQuality: 'A+' | 'A' | 'B' | 'C';

  // Risk management
  useStructuralTPSL: boolean; // Use SMC's structural TP/SL
  fixedTPPct: number; // Fixed TP % if not using structural
  fixedSLPct: number; // Fixed SL % if not using structural

  // Trade management
  maxBarsInTrade: number;
  cooldownBars: number;

  // Lookback for pattern detection
  swingLookback: number;
  mtfEnabled: boolean;
}

const DEFAULT_PARAMS: SMCBacktestParams = {
  minQuality: 'A', // Only A+ and A signals by default
  useStructuralTPSL: true,
  fixedTPPct: 0.5,
  fixedSLPct: 0.3,
  maxBarsInTrade: 30,
  cooldownBars: 5,
  swingLookback: 100,
  mtfEnabled: true,
};

/**
 * SMC Opportunity Backtest Strategy
 */
export class SMCOpportunityBacktestStrategy implements BacktestableStrategy {
  readonly name = 'SMC-Opportunity';
  readonly version = '1.0.0';

  private params: SMCBacktestParams;
  private asset: string;
  private lastTradeIndex: number = -1;

  // Detectors
  private smcDetector: SMCOpportunityDetector;
  private mtfAnalyzer: MTFMarketStructureAnalyzer;
  private obDetector: OrderBlockDetector;
  private fvgDetector: FVGDetector;
  private sweepDetector: LiquiditySweepDetector;

  // Pre-calculated data
  private isPreCalculated: boolean = false;

  constructor(asset: string, customParams?: Partial<SMCBacktestParams>) {
    this.asset = asset;
    this.params = { ...DEFAULT_PARAMS, ...customParams };

    // Initialize detectors
    this.smcDetector = new SMCOpportunityDetector();
    this.mtfAnalyzer = new MTFMarketStructureAnalyzer();
    this.obDetector = new OrderBlockDetector();
    this.fvgDetector = new FVGDetector();
    this.sweepDetector = new LiquiditySweepDetector();
  }

  requiredIndicators(): string[] {
    return ['rsi'];
  }

  getDefaultConfig(): Partial<BacktestConfig> {
    return {
      asset: this.asset,
      cooldownBars: this.params.cooldownBars,
      maxBarsInTrade: this.params.maxBarsInTrade,
    };
  }

  /**
   * Pre-calculate data (not much to pre-calc here since we need real-time detection)
   */
  preCalculate(_candles: Candle[]): void {
    this.isPreCalculated = true;
  }

  /**
   * Check for entry signal at current bar
   * IMPORTANT: Only uses data up to currentIndex (no look-ahead)
   */
  checkEntry(
    candles: Candle[],
    indicators: IndicatorSnapshot,
    currentIndex: number
  ): EntrySignal | null {
    // Minimum data required
    const minBars = this.params.swingLookback + 50;
    if (currentIndex < minBars) return null;

    // Cooldown check
    if (currentIndex - this.lastTradeIndex < this.params.cooldownBars) {
      return null;
    }

    // Get candles up to current index (no look-ahead)
    const historicalCandles = candles.slice(0, currentIndex + 1);
    const currentCandle = historicalCandles[historicalCandles.length - 1];
    if (!currentCandle) return null;

    // Detect SMC components using only historical data
    const mtfStructure = this.mtfAnalyzer.analyze(historicalCandles);
    const orderBlocks = this.obDetector.detect(historicalCandles);
    const fvgs = this.fvgDetector.detect(historicalCandles);
    // Sweep detector needs swing points from MTF structure
    const swingPoints = mtfStructure.tf1m.swingPoints;
    const sweeps = this.sweepDetector.detect(historicalCandles, swingPoints);

    // Build input for SMC detector
    const smcInput: SMCDetectorInput = {
      candles: historicalCandles,
      mtfStructure,
      orderBlocks,
      fvgs,
      sweeps,
      asset: this.asset,
    };

    // Detect opportunities
    const opportunities = this.smcDetector.detect(smcInput);

    // Filter by quality
    const qualityOrder: Record<string, number> = {
      'A+': 0,
      A: 1,
      B: 2,
      C: 3,
    };
    const minQualityLevel = qualityOrder[this.params.minQuality] ?? 1;

    const validOpportunities = opportunities.filter(
      (opp) => qualityOrder[opp.quality] <= minQualityLevel
    );

    if (validOpportunities.length === 0) return null;

    // Take the best opportunity
    const bestOpp = validOpportunities[0]!;
    const currentPrice = currentCandle.close;

    // Check if current price is near the entry zone (within 0.3%)
    const distanceToEntry =
      Math.abs(currentPrice - bestOpp.idealEntry) / currentPrice;
    if (distanceToEntry > 0.003) {
      // Price not at entry zone yet
      return null;
    }

    // Calculate TP/SL
    let tpPct: number;
    let slPct: number;

    if (this.params.useStructuralTPSL) {
      // Use structural levels from SMC detector
      const tpDistance = Math.abs(bestOpp.structuralTP1 - bestOpp.idealEntry);
      const slDistance = Math.abs(bestOpp.structuralSL - bestOpp.idealEntry);

      tpPct = tpDistance / bestOpp.idealEntry;
      slPct = slDistance / bestOpp.idealEntry;

      // Sanity check - cap TP/SL at reasonable levels
      tpPct = Math.min(tpPct, 0.02); // Max 2%
      slPct = Math.min(slPct, 0.01); // Max 1%
    } else {
      tpPct = this.params.fixedTPPct / 100;
      slPct = this.params.fixedSLPct / 100;
    }

    // Calculate confidence based on confluence count
    const confidence = Math.min(95, 50 + bestOpp.confluenceCount * 5);

    // Build signal
    const direction = bestOpp.direction === 'long' ? 'CALL' : 'PUT';

    // Build market snapshot
    const snapshot: MarketSnapshot = {
      timestamp: currentCandle.timestamp * 1000,
      candle: {
        index: currentIndex,
        timestamp: currentCandle.timestamp,
        open: currentCandle.open,
        high: currentCandle.high,
        low: currentCandle.low,
        close: currentCandle.close,
      },
      price: currentPrice,
      indicators: {
        ...indicators,
        smcQuality: qualityOrder[bestOpp.quality],
        smcConfluences: bestOpp.confluenceCount,
        smcSetupType: bestOpp.setupType,
        smcRR: bestOpp.riskRewardRatio,
      },
    };

    // Update last trade index
    this.lastTradeIndex = currentIndex;

    return {
      timestamp: currentCandle.timestamp,
      direction,
      price: currentPrice,
      confidence,
      reason: `${bestOpp.quality} ${bestOpp.setupType} | ${bestOpp.confluenceCount} confluences | R:R ${bestOpp.riskRewardRatio.toFixed(2)} | ${bestOpp.reasons.join(', ')}`,
      strategyName: this.name,
      strategyVersion: this.version,
      snapshot,
      suggestedTpPct: tpPct,
      suggestedSlPct: slPct,
    };
  }

  /**
   * Reset strategy state
   */
  reset(): void {
    this.lastTradeIndex = -1;
    this.isPreCalculated = false;
  }
}

/**
 * Factory function
 */
export function createSMCBacktestStrategy(
  asset: string,
  params?: Partial<SMCBacktestParams>
): SMCOpportunityBacktestStrategy {
  return new SMCOpportunityBacktestStrategy(asset, params);
}
