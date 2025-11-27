/**
 * Economic Calendar Service
 *
 * Fetches economic events from JBlanked API and other sources
 * Provides filtering and caching capabilities
 */

import {
  EconomicEvent,
  EconomicImpact,
  EventCurrency,
  EventSource,
  NewsWindow,
  TradingWindow,
  TradeFilterResult,
  NewsFilterConfig,
  DEFAULT_NEWS_FILTER_CONFIG,
  classifyEventImpact,
  classifyEventCategory,
} from '../types/economic-event.js';

/**
 * JBlanked API response format
 */
interface JBlankedEvent {
  Name: string;
  Currency: string;
  Category?: string;
  Date: string; // "2024.11.01 13:30:00"
  Actual?: number | string;
  Forecast?: number | string;
  Previous?: number | string;
  Strength?: string;
  Quality?: string;
}

/**
 * Cache entry for events
 */
interface CacheEntry {
  events: EconomicEvent[];
  timestamp: number;
  ttl: number;
}

/**
 * Economic Calendar Service
 */
export class EconomicCalendarService {
  private apiKey: string;
  private baseUrl: string;
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  constructor(apiKey: string, baseUrl = 'https://www.jblanked.com/news/api/') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch events for today
   */
  async getTodayEvents(
    currencies: EventCurrency[] = ['USD', 'EUR'],
    source: 'mql5' | 'forex-factory' = 'forex-factory'
  ): Promise<EconomicEvent[]> {
    const cacheKey = `today-${source}-${currencies.join(',')}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const endpoint =
      source === 'mql5' ? 'mql5/calendar/today/' : 'forex-factory/calendar/today/';

    try {
      const events = await this.fetchEvents(endpoint);
      const filtered = this.filterByCurrency(events, currencies);
      this.setCache(cacheKey, filtered);
      return filtered;
    } catch (error) {
      console.error('[EconomicCalendar] Error fetching today events:', error);
      return [];
    }
  }

  /**
   * Fetch historical events for a date range
   */
  async getHistoricalEvents(
    fromDate: string, // YYYY-MM-DD
    toDate: string, // YYYY-MM-DD
    currencies: EventCurrency[] = ['USD', 'EUR']
  ): Promise<EconomicEvent[]> {
    const cacheKey = `historical-${fromDate}-${toDate}-${currencies.join(',')}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const endpoint = `forex-factory/calendar/?from=${fromDate}&to=${toDate}`;

    try {
      const events = await this.fetchEvents(endpoint);
      const filtered = this.filterByCurrency(events, currencies);
      // Longer TTL for historical data (1 hour)
      this.setCache(cacheKey, filtered, 60 * 60 * 1000);
      return filtered;
    } catch (error) {
      console.error('[EconomicCalendar] Error fetching historical events:', error);
      return [];
    }
  }

  /**
   * Get high impact events only
   */
  filterHighImpact(events: EconomicEvent[]): EconomicEvent[] {
    return events.filter((e) => e.impact === 'HIGH');
  }

  /**
   * Get medium and high impact events
   */
  filterMediumAndHighImpact(events: EconomicEvent[]): EconomicEvent[] {
    return events.filter((e) => e.impact === 'HIGH' || e.impact === 'MEDIUM');
  }

  /**
   * Check if a timestamp falls within a news window
   */
  isInNewsWindow(
    timestamp: number,
    events: EconomicEvent[],
    config: Partial<NewsFilterConfig> = {}
  ): { inWindow: boolean; event?: EconomicEvent; impact: EconomicImpact } {
    const cfg = { ...DEFAULT_NEWS_FILTER_CONFIG, ...config };

    for (const event of events) {
      const eventTime = event.timestamp;

      let minutesBefore: number;
      let minutesAfter: number;

      if (event.impact === 'HIGH') {
        minutesBefore = cfg.minutesBeforeHigh;
        minutesAfter = cfg.minutesAfterHigh;
      } else if (event.impact === 'MEDIUM') {
        minutesBefore = cfg.minutesBeforeMedium;
        minutesAfter = cfg.minutesAfterMedium;
      } else {
        continue; // Skip low impact events
      }

      const windowStart = eventTime - minutesBefore * 60;
      const windowEnd = eventTime + minutesAfter * 60;

      if (timestamp >= windowStart && timestamp <= windowEnd) {
        return { inWindow: true, event, impact: event.impact };
      }
    }

    return { inWindow: false, impact: 'NONE' };
  }

  /**
   * Check if should trade at a given time
   */
  shouldTrade(
    timestamp: number,
    events: EconomicEvent[],
    config: Partial<NewsFilterConfig> = {}
  ): TradeFilterResult {
    const cfg = { ...DEFAULT_NEWS_FILTER_CONFIG, ...config };

    // Check for major event days
    if (cfg.skipMajorEventDays) {
      const dayStart = new Date(timestamp * 1000);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      for (const event of events) {
        const eventDate = new Date(event.timestamp * 1000);
        if (eventDate >= dayStart && eventDate < dayEnd) {
          if (cfg.majorEvents.some((major) => event.name.toUpperCase().includes(major.toUpperCase()))) {
            return {
              canTrade: false,
              reason: `Major event day: ${event.name}`,
              nextEvent: event,
              currentImpact: 'HIGH',
            };
          }
        }
      }
    }

    // Check news windows
    const windowCheck = this.isInNewsWindow(timestamp, events, config);
    if (windowCheck.inWindow && windowCheck.event) {
      const minutesToEvent = Math.round((windowCheck.event.timestamp - timestamp) / 60);
      const position = minutesToEvent > 0 ? `in ${minutesToEvent} minutes` : `${Math.abs(minutesToEvent)} minutes ago`;

      return {
        canTrade: false,
        reason: `${windowCheck.event.name} ${position}`,
        nextEvent: windowCheck.event,
        minutesToNextEvent: minutesToEvent > 0 ? minutesToEvent : undefined,
        currentImpact: windowCheck.impact,
      };
    }

    // Find next event
    const futureEvents = events
      .filter((e) => e.timestamp > timestamp && (e.impact === 'HIGH' || e.impact === 'MEDIUM'))
      .sort((a, b) => a.timestamp - b.timestamp);

    const nextEvent = futureEvents[0];
    const minutesToNext = nextEvent ? Math.round((nextEvent.timestamp - timestamp) / 60) : undefined;

    return {
      canTrade: true,
      reason: nextEvent ? `Safe to trade. Next event: ${nextEvent.name} in ${minutesToNext} min` : 'No upcoming events',
      nextEvent,
      minutesToNextEvent: minutesToNext,
      currentImpact: 'NONE',
    };
  }

  /**
   * Get trading windows for today
   */
  getTradingWindowsForDay(
    events: EconomicEvent[],
    date: Date = new Date(),
    config: Partial<NewsFilterConfig> = {}
  ): TradingWindow[] {
    const cfg = { ...DEFAULT_NEWS_FILTER_CONFIG, ...config };
    const windows: TradingWindow[] = [];

    // Get day boundaries
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Filter events for this day
    const dayEvents = events
      .filter((e) => {
        const eventDate = new Date(e.timestamp * 1000);
        return eventDate >= dayStart && eventDate < dayEnd;
      })
      .filter((e) => e.impact === 'HIGH' || e.impact === 'MEDIUM')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (dayEvents.length === 0) {
      return [
        {
          start: '00:00',
          end: '23:59',
          startTimestamp: Math.floor(dayStart.getTime() / 1000),
          endTimestamp: Math.floor(dayEnd.getTime() / 1000) - 60,
          status: 'safe',
        },
      ];
    }

    // Build windows around events
    let currentTime = Math.floor(dayStart.getTime() / 1000);

    for (const event of dayEvents) {
      const minutesBefore = event.impact === 'HIGH' ? cfg.minutesBeforeHigh : cfg.minutesBeforeMedium;
      const minutesAfter = event.impact === 'HIGH' ? cfg.minutesAfterHigh : cfg.minutesAfterMedium;

      const windowStart = event.timestamp - minutesBefore * 60;
      const windowEnd = event.timestamp + minutesAfter * 60;

      // Safe window before this event
      if (currentTime < windowStart) {
        windows.push({
          start: this.formatTime(currentTime),
          end: this.formatTime(windowStart),
          startTimestamp: currentTime,
          endTimestamp: windowStart,
          status: 'safe',
        });
      }

      // News window
      windows.push({
        start: this.formatTime(windowStart),
        end: this.formatTime(windowEnd),
        startTimestamp: windowStart,
        endTimestamp: windowEnd,
        status: 'news',
        event,
      });

      currentTime = windowEnd;
    }

    // Final safe window
    const dayEndTs = Math.floor(dayEnd.getTime() / 1000);
    if (currentTime < dayEndTs) {
      windows.push({
        start: this.formatTime(currentTime),
        end: '23:59',
        startTimestamp: currentTime,
        endTimestamp: dayEndTs - 60,
        status: 'safe',
      });
    }

    return windows;
  }

  /**
   * Get next event from now
   */
  getNextEvent(events: EconomicEvent[], currency?: EventCurrency): EconomicEvent | undefined {
    const now = Math.floor(Date.now() / 1000);
    const filtered = currency ? events.filter((e) => e.currency === currency) : events;

    return filtered
      .filter((e) => e.timestamp > now)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
  }

  /**
   * Create news windows for all events
   */
  createNewsWindows(events: EconomicEvent[], config: Partial<NewsFilterConfig> = {}): NewsWindow[] {
    const cfg = { ...DEFAULT_NEWS_FILTER_CONFIG, ...config };

    return events
      .filter((e) => e.impact === 'HIGH' || e.impact === 'MEDIUM')
      .map((event) => {
        const minutesBefore = event.impact === 'HIGH' ? cfg.minutesBeforeHigh : cfg.minutesBeforeMedium;
        const minutesAfter = event.impact === 'HIGH' ? cfg.minutesAfterHigh : cfg.minutesAfterMedium;

        return {
          event,
          startTimestamp: event.timestamp - minutesBefore * 60,
          endTimestamp: event.timestamp + minutesAfter * 60,
          minutesBefore,
          minutesAfter,
        };
      });
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async fetchEvents(endpoint: string): Promise<EconomicEvent[]> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as JBlankedEvent[];

    return data.map((item) => this.parseJBlankedEvent(item));
  }

  private parseJBlankedEvent(item: JBlankedEvent): EconomicEvent {
    // Parse date "2024.11.01 13:30:00" -> timestamp
    const dateStr = item.Date.replace(/\./g, '-').replace(' ', 'T') + 'Z';
    const timestamp = Math.floor(new Date(dateStr).getTime() / 1000);

    const currency = item.Currency.toUpperCase() as EventCurrency;
    const name = item.Name;

    // Classify impact - use API strength if available, otherwise classify by name
    let impact: EconomicImpact;
    if (item.Strength?.toLowerCase().includes('strong') || item.Strength?.toLowerCase().includes('high')) {
      impact = 'HIGH';
    } else if (item.Strength?.toLowerCase().includes('moderate') || item.Strength?.toLowerCase().includes('medium')) {
      impact = 'MEDIUM';
    } else {
      impact = classifyEventImpact(name);
    }

    return {
      id: `${timestamp}-${currency}-${name.replace(/\s+/g, '-').toLowerCase()}`,
      name,
      currency,
      category: classifyEventCategory(name),
      impact,
      timestamp,
      date: item.Date.split(' ')[0]!.replace(/\./g, '-'),
      time: item.Date.split(' ')[1]!.substring(0, 5),
      actual: item.Actual,
      forecast: item.Forecast,
      previous: item.Previous,
      source: 'FOREX_FACTORY' as EventSource,
      rawData: item as unknown as Record<string, unknown>,
    };
  }

  private filterByCurrency(events: EconomicEvent[], currencies: EventCurrency[]): EconomicEvent[] {
    return events.filter((e) => currencies.includes(e.currency));
  }

  private getFromCache(key: string): EconomicEvent[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.events;
  }

  private setCache(key: string, events: EconomicEvent[], ttl = this.defaultTTL): void {
    this.cache.set(key, {
      events,
      timestamp: Date.now(),
      ttl,
    });
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Create service with optional API key from environment
 */
export function createEconomicCalendarService(apiKey?: string): EconomicCalendarService {
  const key = apiKey || process.env.JBLANKED_API_KEY || '';
  if (!key) {
    console.warn('[EconomicCalendar] No API key provided. Some features may not work.');
  }
  return new EconomicCalendarService(key);
}
