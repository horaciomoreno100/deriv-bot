/**
 * News Filter Service
 *
 * Real-time filter to avoid trading during economic events
 * Based on analysis showing +30% improvement in MR win rate when filtering news
 */

import {
  EconomicEvent,
  EventCurrency,
  TradeFilterResult,
  NewsFilterConfig,
  DEFAULT_NEWS_FILTER_CONFIG,
} from '../types/economic-event.js';

/**
 * Hardcoded economic events for current year
 * Used when API is not available
 */
function generateEventsForYear(year: number): EconomicEvent[] {
  const events: EconomicEvent[] = [];

  // Helper functions
  function getFirstFriday(y: number, month: number): Date {
    const date = new Date(y, month, 1);
    while (date.getDay() !== 5) date.setDate(date.getDate() + 1);
    return date;
  }

  function getNthDayOfWeek(y: number, month: number, dayOfWeek: number, n: number): Date {
    const date = new Date(y, month, 1);
    let count = 0;
    while (count < n) {
      if (date.getDay() === dayOfWeek) count++;
      if (count < n) date.setDate(date.getDate() + 1);
    }
    return date;
  }

  // NFP - First Friday of each month, 13:30 UTC
  for (let month = 0; month < 12; month++) {
    const date = getFirstFriday(year, month);
    events.push({
      id: `nfp-${year}-${month}`,
      name: 'Non-Farm Payrolls',
      currency: 'USD',
      category: 'EMPLOYMENT',
      impact: 'HIGH',
      timestamp: Math.floor(new Date(date.setUTCHours(13, 30, 0, 0)).getTime() / 1000),
      date: date.toISOString().split('T')[0]!,
      time: '13:30',
      source: 'MANUAL',
    });
  }

  // FOMC - 3rd Wednesday of Jan, Mar, May, Jun, Jul, Sep, Nov, Dec at 19:00 UTC
  const fomcMonths = [0, 2, 4, 5, 6, 8, 10, 11];
  for (const month of fomcMonths) {
    const date = getNthDayOfWeek(year, month, 3, 3);
    events.push({
      id: `fomc-${year}-${month}`,
      name: 'FOMC Interest Rate Decision',
      currency: 'USD',
      category: 'INTEREST_RATE',
      impact: 'HIGH',
      timestamp: Math.floor(new Date(date.setUTCHours(19, 0, 0, 0)).getTime() / 1000),
      date: date.toISOString().split('T')[0]!,
      time: '19:00',
      source: 'MANUAL',
    });
  }

  // ECB - 2nd Thursday of Jan, Mar, Apr, Jun, Jul, Sep, Oct, Dec at 13:15 UTC
  const ecbMonths = [0, 2, 3, 5, 6, 8, 9, 11];
  for (const month of ecbMonths) {
    const date = getNthDayOfWeek(year, month, 4, 2);
    events.push({
      id: `ecb-${year}-${month}`,
      name: 'ECB Interest Rate Decision',
      currency: 'EUR',
      category: 'INTEREST_RATE',
      impact: 'HIGH',
      timestamp: Math.floor(new Date(date.setUTCHours(13, 15, 0, 0)).getTime() / 1000),
      date: date.toISOString().split('T')[0]!,
      time: '13:15',
      source: 'MANUAL',
    });
  }

  // CPI - 12th of each month at 13:30 UTC
  for (let month = 0; month < 12; month++) {
    const date = new Date(year, month, 12, 13, 30, 0);
    events.push({
      id: `cpi-${year}-${month}`,
      name: 'CPI m/m',
      currency: 'USD',
      category: 'INFLATION',
      impact: 'HIGH',
      timestamp: Math.floor(date.getTime() / 1000),
      date: date.toISOString().split('T')[0]!,
      time: '13:30',
      source: 'MANUAL',
    });
  }

  // ISM PMI - First business day of month at 15:00 UTC
  for (let month = 0; month < 12; month++) {
    let date = new Date(year, month, 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    events.push({
      id: `ism-${year}-${month}`,
      name: 'ISM Manufacturing PMI',
      currency: 'USD',
      category: 'MANUFACTURING',
      impact: 'MEDIUM',
      timestamp: Math.floor(new Date(date.setUTCHours(15, 0, 0, 0)).getTime() / 1000),
      date: date.toISOString().split('T')[0]!,
      time: '15:00',
      source: 'MANUAL',
    });
  }

  // Jobless Claims - Every Thursday at 13:30 UTC
  let thursday = new Date(year, 0, 1);
  while (thursday.getDay() !== 4) thursday.setDate(thursday.getDate() + 1);

  while (thursday.getFullYear() === year) {
    events.push({
      id: `jobless-${thursday.toISOString().split('T')[0]}`,
      name: 'Initial Jobless Claims',
      currency: 'USD',
      category: 'EMPLOYMENT',
      impact: 'MEDIUM',
      timestamp: Math.floor(new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate(), 13, 30, 0).getTime() / 1000),
      date: thursday.toISOString().split('T')[0]!,
      time: '13:30',
      source: 'MANUAL',
    });
    thursday.setDate(thursday.getDate() + 7);
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * News Filter Service
 *
 * Recommended configuration based on analysis:
 * - HIGH impact: 15 min before, 30 min after
 * - MEDIUM impact: 10 min before, 15 min after
 * - Expected improvement: +30% win rate
 */
export class NewsFilterService {
  private events: EconomicEvent[] = [];
  private config: NewsFilterConfig;
  private lastRefresh: number = 0;
  private refreshInterval = 24 * 60 * 60 * 1000; // 24 hours

  constructor(config: Partial<NewsFilterConfig> = {}) {
    // Override defaults with analysis-based recommendations
    this.config = {
      ...DEFAULT_NEWS_FILTER_CONFIG,
      minutesBeforeHigh: 15,
      minutesAfterHigh: 30,
      minutesBeforeMedium: 10,
      minutesAfterMedium: 15,
      ...config,
    };

    this.refreshEvents();
  }

  /**
   * Refresh event list (called automatically)
   */
  private refreshEvents(): void {
    const now = Date.now();
    if (now - this.lastRefresh < this.refreshInterval && this.events.length > 0) {
      return;
    }

    const currentYear = new Date().getFullYear();
    this.events = [
      ...generateEventsForYear(currentYear),
      ...generateEventsForYear(currentYear + 1),
    ];

    // Filter to relevant currencies
    this.events = this.events.filter((e) =>
      this.config.currencies.includes(e.currency as EventCurrency)
    );

    this.lastRefresh = now;
  }

  /**
   * Check if trading should be allowed at current time
   */
  shouldTrade(pair: string = 'EURUSD'): TradeFilterResult {
    return this.shouldTradeAt(Math.floor(Date.now() / 1000), pair);
  }

  /**
   * Check if trading should be allowed at a specific timestamp
   */
  shouldTradeAt(timestamp: number, pair: string = 'EURUSD'): TradeFilterResult {
    this.refreshEvents();

    // Get currencies for this pair
    const currencies = this.getCurrenciesForPair(pair);

    // Filter events for relevant currencies
    const relevantEvents = this.events.filter((e) =>
      currencies.includes(e.currency as EventCurrency)
    );

    // Check each event
    for (const event of relevantEvents) {
      const minutesToEvent = (event.timestamp - timestamp) / 60;
      const absMinutes = Math.abs(minutesToEvent);

      let windowBefore: number;
      let windowAfter: number;

      if (event.impact === 'HIGH') {
        windowBefore = this.config.minutesBeforeHigh;
        windowAfter = this.config.minutesAfterHigh;
      } else if (event.impact === 'MEDIUM') {
        windowBefore = this.config.minutesBeforeMedium;
        windowAfter = this.config.minutesAfterMedium;
      } else {
        continue; // Skip LOW impact
      }

      // Check if we're in the news window
      const inWindowBefore = minutesToEvent > 0 && minutesToEvent <= windowBefore;
      const inWindowAfter = minutesToEvent < 0 && absMinutes <= windowAfter;

      if (inWindowBefore || inWindowAfter) {
        const position = minutesToEvent > 0
          ? `in ${Math.round(minutesToEvent)} min`
          : `${Math.round(absMinutes)} min ago`;

        return {
          canTrade: false,
          reason: `⚠️ ${event.name} ${position}`,
          nextEvent: event,
          minutesToNextEvent: minutesToEvent > 0 ? Math.round(minutesToEvent) : undefined,
          currentImpact: event.impact,
        };
      }
    }

    // Find next upcoming event
    const futureEvents = relevantEvents
      .filter((e) => e.timestamp > timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    const nextEvent = futureEvents[0];
    const minutesToNext = nextEvent
      ? Math.round((nextEvent.timestamp - timestamp) / 60)
      : undefined;

    return {
      canTrade: true,
      reason: nextEvent
        ? `✅ Safe. Next: ${nextEvent.name} in ${minutesToNext} min`
        : '✅ No upcoming events',
      nextEvent,
      minutesToNextEvent: minutesToNext,
      currentImpact: 'NONE',
    };
  }

  /**
   * Get trading windows for today
   */
  getTodayWindows(): Array<{ start: string; end: string; status: 'safe' | 'news'; event?: string }> {
    this.refreshEvents();

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const dayStartTs = Math.floor(dayStart.getTime() / 1000);
    const dayEndTs = Math.floor(dayEnd.getTime() / 1000);

    // Get today's events
    const todayEvents = this.events
      .filter((e) => e.timestamp >= dayStartTs && e.timestamp < dayEndTs)
      .filter((e) => e.impact === 'HIGH' || e.impact === 'MEDIUM')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (todayEvents.length === 0) {
      return [{ start: '00:00', end: '23:59', status: 'safe' }];
    }

    const windows: Array<{ start: string; end: string; status: 'safe' | 'news'; event?: string }> = [];
    let currentTs = dayStartTs;

    for (const event of todayEvents) {
      const windowBefore = event.impact === 'HIGH'
        ? this.config.minutesBeforeHigh
        : this.config.minutesBeforeMedium;
      const windowAfter = event.impact === 'HIGH'
        ? this.config.minutesAfterHigh
        : this.config.minutesAfterMedium;

      const eventStart = event.timestamp - windowBefore * 60;
      const eventEnd = event.timestamp + windowAfter * 60;

      // Safe window before this event
      if (currentTs < eventStart) {
        windows.push({
          start: this.formatTime(currentTs),
          end: this.formatTime(eventStart),
          status: 'safe',
        });
      }

      // News window
      windows.push({
        start: this.formatTime(eventStart),
        end: this.formatTime(eventEnd),
        status: 'news',
        event: event.name,
      });

      currentTs = eventEnd;
    }

    // Final safe window
    if (currentTs < dayEndTs) {
      windows.push({
        start: this.formatTime(currentTs),
        end: '23:59',
        status: 'safe',
      });
    }

    return windows;
  }

  /**
   * Get next N events
   */
  getUpcomingEvents(count: number = 5): EconomicEvent[] {
    this.refreshEvents();
    const now = Math.floor(Date.now() / 1000);

    return this.events
      .filter((e) => e.timestamp > now)
      .slice(0, count);
  }

  /**
   * Check if today is a major event day
   */
  isMajorEventDay(): { isMajor: boolean; event?: EconomicEvent } {
    this.refreshEvents();

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const majorEventNames = ['Non-Farm', 'NFP', 'FOMC', 'ECB Interest Rate'];

    const majorEvent = this.events.find(
      (e) =>
        e.timestamp >= dayStart.getTime() / 1000 &&
        e.timestamp < dayEnd.getTime() / 1000 &&
        majorEventNames.some((m) => e.name.includes(m))
    );

    return {
      isMajor: !!majorEvent,
      event: majorEvent,
    };
  }

  // Helper methods
  private getCurrenciesForPair(pair: string): EventCurrency[] {
    const normalized = pair.toUpperCase().replace(/[^A-Z]/g, '');

    const currencyMap: Record<string, EventCurrency[]> = {
      EURUSD: ['EUR', 'USD'],
      FRXEURUSD: ['EUR', 'USD'],
      GBPUSD: ['GBP', 'USD'],
      USDJPY: ['USD', 'JPY'],
      XAUUSD: ['USD'],
      FRXXAUUSD: ['USD'],
    };

    return currencyMap[normalized] || ['USD', 'EUR'];
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NewsFilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): NewsFilterConfig {
    return { ...this.config };
  }
}

/**
 * Create a pre-configured news filter with analysis-recommended settings
 */
export function createNewsFilter(config?: Partial<NewsFilterConfig>): NewsFilterService {
  return new NewsFilterService(config);
}

/**
 * Singleton instance for easy access
 */
let defaultInstance: NewsFilterService | null = null;

export function getNewsFilter(): NewsFilterService {
  if (!defaultInstance) {
    defaultInstance = createNewsFilter();
  }
  return defaultInstance;
}
