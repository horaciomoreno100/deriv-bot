/**
 * Analysis Module Exports
 *
 * AI Analysis and Market Structure tools
 */

export { AIAnalyzer } from './ai-analyzer.js';
export { MarketContextAnalyzer } from './market-context-analyzer.js';
export { SignalQualityScorer } from './signal-quality-scorer.js';

// Market Structure Analysis
export {
  MarketStructureDetector,
  analyzeMarketStructure,
} from './market-structure-detector.js';

export {
  generateMarketStructureChart,
  generateMTFMarketStructureChart,
  exportMarketStructureChart,
  type MarketStructureChartOptions,
} from './market-structure-chart.js';

// MTF Market Structure Analysis
export {
  MTFMarketStructureAnalyzer,
  analyzeMTFStructure,
  type MTFMarketStructure,
  type MTFZone,
  type ConfluenceZone,
  type MTFAnalysisOptions,
} from './mtf-market-structure.js';

// RSI Divergence Detection
export {
  RSIDivergenceDetector,
  detectRSIDivergences,
  checkDivergenceAtZone,
  type RSIDivergence,
  type DivergenceType,
  type DivergenceDetectorOptions,
} from './rsi-divergence-detector.js';

// Signal Confluence Analyzer
export {
  SignalConfluenceAnalyzer,
  createConfluenceAnalyzer,
  analyzeConfluence,
  type ConfluenceSignal,
  type ConfluenceFactors,
  type ConfluenceAnalyzerConfig,
  type SignalDirection,
} from './signal-confluence-analyzer.js';

// Order Block Detection
export {
  OrderBlockDetector,
  detectOrderBlocks,
  type OrderBlock,
  type OrderBlockConfig,
} from './order-block-detector.js';

// Liquidity Sweep Detection
export {
  LiquiditySweepDetector,
  detectLiquiditySweeps,
  type LiquiditySweep,
  type LiquiditySweepConfig,
} from './liquidity-sweep-detector.js';

// Fair Value Gap (FVG) Detection
export {
  FVGDetector,
  detectFVGs,
  type FairValueGap,
  type FVGConfig,
} from './fvg-detector.js';

// SMC Opportunity Detection
export {
  SMCOpportunityDetector,
  detectSMCOpportunities,
  getHighQualitySetups,
  type SMCOpportunity,
  type SMCSetupType,
  type SMCConfluenceFactors,
  type SMCDetectorInput,
  type TradeDirection,
} from './smc-opportunity-detector.js';
