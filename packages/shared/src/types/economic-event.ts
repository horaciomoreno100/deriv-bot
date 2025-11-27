/**
 * Economic Event Types
 *
 * Types for economic calendar events and news filtering
 */

/** Impact level of economic event */
export type EconomicImpact = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/** Source of the economic event data */
export type EventSource = 'FOREX_FACTORY' | 'MQL5' | 'INVESTING' | 'MANUAL';

/** Currency affected by the event */
export type EventCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CHF' | 'NZD';

/** Category of economic event */
export type EventCategory =
  | 'INTEREST_RATE'
  | 'EMPLOYMENT'
  | 'INFLATION'
  | 'GDP'
  | 'RETAIL'
  | 'MANUFACTURING'
  | 'HOUSING'
  | 'CONSUMER'
  | 'TRADE'
  | 'SPEECH'
  | 'OTHER';

/**
 * Economic event from calendar
 */
export interface EconomicEvent {
  /** Unique identifier */
  id: string;

  /** Event name (e.g., "Non-Farm Payrolls") */
  name: string;

  /** Currency affected */
  currency: EventCurrency;

  /** Event category */
  category: EventCategory;

  /** Impact level */
  impact: EconomicImpact;

  /** Event timestamp (Unix epoch seconds) */
  timestamp: number;

  /** Event date string (YYYY-MM-DD) */
  date: string;

  /** Event time string (HH:MM UTC) */
  time: string;

  /** Actual value (if released) */
  actual?: number | string;

  /** Forecasted value */
  forecast?: number | string;

  /** Previous value */
  previous?: number | string;

  /** Data source */
  source: EventSource;

  /** Raw API response data */
  rawData?: Record<string, unknown>;
}

/**
 * News window around an event
 */
export interface NewsWindow {
  /** Event that created this window */
  event: EconomicEvent;

  /** Window start timestamp (Unix epoch seconds) */
  startTimestamp: number;

  /** Window end timestamp (Unix epoch seconds) */
  endTimestamp: number;

  /** Minutes before event */
  minutesBefore: number;

  /** Minutes after event */
  minutesAfter: number;
}

/**
 * Trading window status
 */
export interface TradingWindow {
  /** Start time (HH:MM UTC) */
  start: string;

  /** End time (HH:MM UTC) */
  end: string;

  /** Start timestamp */
  startTimestamp: number;

  /** End timestamp */
  endTimestamp: number;

  /** Whether trading is safe */
  status: 'safe' | 'news' | 'caution';

  /** Event causing restriction (if any) */
  event?: EconomicEvent;
}

/**
 * Result of should_trade check
 */
export interface TradeFilterResult {
  /** Whether trading is allowed */
  canTrade: boolean;

  /** Reason for decision */
  reason: string;

  /** Next event (if any) */
  nextEvent?: EconomicEvent;

  /** Minutes until next event */
  minutesToNextEvent?: number;

  /** Current impact level */
  currentImpact: EconomicImpact;
}

/**
 * Configuration for news filter
 */
export interface NewsFilterConfig {
  /** Minutes before HIGH impact event to stop trading */
  minutesBeforeHigh: number;

  /** Minutes after HIGH impact event to resume trading */
  minutesAfterHigh: number;

  /** Minutes before MEDIUM impact event to stop trading */
  minutesBeforeMedium: number;

  /** Minutes after MEDIUM impact event to resume trading */
  minutesAfterMedium: number;

  /** Currencies to monitor */
  currencies: EventCurrency[];

  /** Whether to skip entire day on major events (NFP, FOMC) */
  skipMajorEventDays: boolean;

  /** List of events that trigger full-day skip */
  majorEvents: string[];
}

/**
 * Default news filter configuration
 */
export const DEFAULT_NEWS_FILTER_CONFIG: NewsFilterConfig = {
  minutesBeforeHigh: 60,
  minutesAfterHigh: 90,
  minutesBeforeMedium: 30,
  minutesAfterMedium: 60,
  currencies: ['USD', 'EUR'],
  skipMajorEventDays: false,
  majorEvents: [
    'Non-Farm Payrolls',
    'NFP',
    'Nonfarm Payrolls',
    'FOMC',
    'Federal Funds Rate',
    'Fed Interest Rate Decision',
    'ECB Interest Rate Decision',
    'ECB Rate Decision',
  ],
};

/**
 * High impact events list (for classification)
 */
export const HIGH_IMPACT_EVENTS = [
  // Employment
  'Non-Farm Payrolls',
  'NFP',
  'Nonfarm Payrolls',
  'Unemployment Rate',
  'Average Hourly Earnings',
  'ADP Employment Change',

  // Central Bank
  'FOMC',
  'Federal Funds Rate',
  'Fed Interest Rate Decision',
  'FOMC Statement',
  'Fed Chair Powell Speaks',
  'ECB Interest Rate Decision',
  'ECB Rate Decision',
  'ECB Press Conference',
  'ECB President Lagarde Speaks',

  // Inflation
  'CPI m/m',
  'CPI y/y',
  'Core CPI m/m',
  'Core CPI y/y',
  'PCE Price Index',
  'Core PCE Price Index',

  // GDP
  'GDP q/q',
  'GDP y/y',
  'Advance GDP',
  'Preliminary GDP',
  'Final GDP',
];

/**
 * Medium impact events list
 */
export const MEDIUM_IMPACT_EVENTS = [
  // Retail & Consumer
  'Retail Sales m/m',
  'Core Retail Sales m/m',
  'Consumer Confidence',
  'Michigan Consumer Sentiment',

  // Manufacturing & PMI
  'ISM Manufacturing PMI',
  'ISM Services PMI',
  'Manufacturing PMI',
  'Services PMI',
  'Industrial Production m/m',
  'Durable Goods Orders m/m',

  // Housing
  'Building Permits',
  'Housing Starts',
  'Existing Home Sales',
  'New Home Sales',

  // Trade & Other
  'Trade Balance',
  'PPI m/m',
  'Initial Jobless Claims',
  'Continuing Jobless Claims',
];

/**
 * Classify event impact based on name
 */
export function classifyEventImpact(eventName: string): EconomicImpact {
  const upperName = eventName.toUpperCase();

  for (const highEvent of HIGH_IMPACT_EVENTS) {
    if (upperName.includes(highEvent.toUpperCase())) {
      return 'HIGH';
    }
  }

  for (const mediumEvent of MEDIUM_IMPACT_EVENTS) {
    if (upperName.includes(mediumEvent.toUpperCase())) {
      return 'MEDIUM';
    }
  }

  return 'LOW';
}

/**
 * Classify event category based on name
 */
export function classifyEventCategory(eventName: string): EventCategory {
  const upperName = eventName.toUpperCase();

  if (
    upperName.includes('RATE') ||
    upperName.includes('FOMC') ||
    upperName.includes('FED') ||
    upperName.includes('ECB')
  ) {
    return 'INTEREST_RATE';
  }

  if (
    upperName.includes('EMPLOYMENT') ||
    upperName.includes('PAYROLL') ||
    upperName.includes('NFP') ||
    upperName.includes('JOBLESS') ||
    upperName.includes('UNEMPLOYMENT')
  ) {
    return 'EMPLOYMENT';
  }

  if (upperName.includes('CPI') || upperName.includes('PPI') || upperName.includes('INFLATION')) {
    return 'INFLATION';
  }

  if (upperName.includes('GDP')) {
    return 'GDP';
  }

  if (upperName.includes('RETAIL') || upperName.includes('SALES')) {
    return 'RETAIL';
  }

  if (
    upperName.includes('PMI') ||
    upperName.includes('ISM') ||
    upperName.includes('MANUFACTURING') ||
    upperName.includes('INDUSTRIAL')
  ) {
    return 'MANUFACTURING';
  }

  if (
    upperName.includes('HOUSING') ||
    upperName.includes('HOME') ||
    upperName.includes('BUILDING')
  ) {
    return 'HOUSING';
  }

  if (
    upperName.includes('CONSUMER') ||
    upperName.includes('CONFIDENCE') ||
    upperName.includes('SENTIMENT')
  ) {
    return 'CONSUMER';
  }

  if (upperName.includes('TRADE') || upperName.includes('BALANCE')) {
    return 'TRADE';
  }

  if (upperName.includes('SPEAK') || upperName.includes('SPEECH') || upperName.includes('PRESS')) {
    return 'SPEECH';
  }

  return 'OTHER';
}
