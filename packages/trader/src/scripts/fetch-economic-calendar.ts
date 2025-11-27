/**
 * Fetch Historical Economic Calendar Data
 *
 * Downloads economic events from JBlanked/Forex Factory API
 * and saves them for analysis
 *
 * Usage:
 *   JBLANKED_API_KEY="your_key" npx tsx src/scripts/fetch-economic-calendar.ts
 *
 * Without API key, uses hardcoded major events as fallback
 */

import dotenv from 'dotenv';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

// =============================================================================
// CONFIGURATION
// =============================================================================

const OUTPUT_DIR = process.env.OUTPUT_DIR || './analysis-output';
const DAYS_BACK = parseInt(process.env.DAYS_BACK || '365', 10);
const API_KEY = process.env.JBLANKED_API_KEY || '';
const CURRENCIES = ['USD', 'EUR'];

// =============================================================================
// TYPES
// =============================================================================

interface EconomicEvent {
  id: string;
  name: string;
  currency: string;
  category: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: number;
  date: string;
  time: string;
  actual?: string | number;
  forecast?: string | number;
  previous?: string | number;
}

// =============================================================================
// HARDCODED MAJOR EVENTS (FALLBACK)
// =============================================================================

/**
 * Generate hardcoded major economic events for a given year
 * Used as fallback when API is not available
 */
function getHardcodedEventsForYear(year: number): EconomicEvent[] {
  const events: EconomicEvent[] = [];

  // Helper to find first Friday of a month
  function getFirstFriday(y: number, month: number): string {
    const date = new Date(y, month, 1);
    while (date.getDay() !== 5) {
      date.setDate(date.getDate() + 1);
    }
    return date.toISOString().split('T')[0]!;
  }

  // Helper to get nth day of week in a month
  function getNthDayOfWeek(y: number, month: number, dayOfWeek: number, n: number): string {
    const date = new Date(y, month, 1);
    let count = 0;
    while (count < n) {
      if (date.getDay() === dayOfWeek) count++;
      if (count < n) date.setDate(date.getDate() + 1);
    }
    return date.toISOString().split('T')[0]!;
  }

  // NFP (Non-Farm Payrolls) - First Friday of each month, 13:30 UTC
  for (let month = 0; month < 12; month++) {
    const date = getFirstFriday(year, month);
    const ts = new Date(`${date}T13:30:00Z`).getTime() / 1000;
    events.push({
      id: `nfp-${date}`,
      name: 'Non-Farm Payrolls',
      currency: 'USD',
      category: 'EMPLOYMENT',
      impact: 'HIGH',
      timestamp: ts,
      date,
      time: '13:30',
    });
  }

  // FOMC Meetings - Approximately every 6 weeks, 19:00 UTC
  // Using 3rd Wednesday of Jan, Mar, May, Jun, Jul, Sep, Nov, Dec as approximation
  const fomcMonths = [0, 2, 4, 5, 6, 8, 10, 11]; // Jan, Mar, May, Jun, Jul, Sep, Nov, Dec
  for (const month of fomcMonths) {
    const date = getNthDayOfWeek(year, month, 3, 3); // 3rd Wednesday
    const ts = new Date(`${date}T19:00:00Z`).getTime() / 1000;
    events.push({
      id: `fomc-${date}`,
      name: 'FOMC Interest Rate Decision',
      currency: 'USD',
      category: 'INTEREST_RATE',
      impact: 'HIGH',
      timestamp: ts,
      date,
      time: '19:00',
    });
  }

  // ECB Rate Decisions - Usually 2nd Thursday of Jan, Mar, Apr, Jun, Jul, Sep, Oct, Dec
  const ecbMonths = [0, 2, 3, 5, 6, 8, 9, 11];
  for (const month of ecbMonths) {
    const date = getNthDayOfWeek(year, month, 4, 2); // 2nd Thursday
    const ts = new Date(`${date}T13:15:00Z`).getTime() / 1000;
    events.push({
      id: `ecb-${date}`,
      name: 'ECB Interest Rate Decision',
      currency: 'EUR',
      category: 'INTEREST_RATE',
      impact: 'HIGH',
      timestamp: ts,
      date,
      time: '13:15',
    });
  }

  // CPI (Consumer Price Index) - Usually 2nd week of month, 13:30 UTC
  for (let month = 0; month < 12; month++) {
    // Approximate as 12th of each month
    const date = `${year}-${String(month + 1).padStart(2, '0')}-12`;
    const ts = new Date(`${date}T13:30:00Z`).getTime() / 1000;
    events.push({
      id: `cpi-${date}`,
      name: 'CPI m/m',
      currency: 'USD',
      category: 'INFLATION',
      impact: 'HIGH',
      timestamp: ts,
      date,
      time: '13:30',
    });
  }

  // GDP - Quarterly releases (last week of Jan, Apr, Jul, Oct for advance)
  const gdpSchedule = [
    { month: 0, day: 25, name: 'GDP q/q (Q4 Advance)' },
    { month: 1, day: 28, name: 'GDP q/q (Q4 Second)' },
    { month: 2, day: 28, name: 'GDP q/q (Q4 Final)' },
    { month: 3, day: 25, name: 'GDP q/q (Q1 Advance)' },
    { month: 4, day: 28, name: 'GDP q/q (Q1 Second)' },
    { month: 5, day: 27, name: 'GDP q/q (Q1 Final)' },
    { month: 6, day: 25, name: 'GDP q/q (Q2 Advance)' },
    { month: 7, day: 28, name: 'GDP q/q (Q2 Second)' },
    { month: 8, day: 26, name: 'GDP q/q (Q2 Final)' },
    { month: 9, day: 28, name: 'GDP q/q (Q3 Advance)' },
    { month: 10, day: 27, name: 'GDP q/q (Q3 Second)' },
    { month: 11, day: 19, name: 'GDP q/q (Q3 Final)' },
  ];

  for (const { month, day, name } of gdpSchedule) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ts = new Date(`${date}T13:30:00Z`).getTime() / 1000;
    events.push({
      id: `gdp-${date}`,
      name,
      currency: 'USD',
      category: 'GDP',
      impact: 'HIGH',
      timestamp: ts,
      date,
      time: '13:30',
    });
  }

  // Medium Impact Events - ISM PMI (first business day of month)
  for (let month = 0; month < 12; month++) {
    // Get first day of month, skip to Monday if weekend
    let firstDay = new Date(year, month, 1);
    while (firstDay.getDay() === 0 || firstDay.getDay() === 6) {
      firstDay.setDate(firstDay.getDate() + 1);
    }
    const date = firstDay.toISOString().split('T')[0]!;
    const ts = new Date(`${date}T15:00:00Z`).getTime() / 1000;
    events.push({
      id: `ism-${date}`,
      name: 'ISM Manufacturing PMI',
      currency: 'USD',
      category: 'MANUFACTURING',
      impact: 'MEDIUM',
      timestamp: ts,
      date,
      time: '15:00',
    });
  }

  // Retail Sales - Mid-month (around 15th)
  for (let month = 0; month < 12; month++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-15`;
    const ts = new Date(`${date}T13:30:00Z`).getTime() / 1000;
    events.push({
      id: `retail-${date}`,
      name: 'Retail Sales m/m',
      currency: 'USD',
      category: 'RETAIL',
      impact: 'MEDIUM',
      timestamp: ts,
      date,
      time: '13:30',
    });
  }

  // Jobless Claims - Every Thursday
  // Find first Thursday of the year
  let firstThursday = new Date(year, 0, 1);
  while (firstThursday.getDay() !== 4) {
    firstThursday.setDate(firstThursday.getDate() + 1);
  }

  const endOfYear = new Date(year, 11, 31);
  for (let d = new Date(firstThursday); d <= endOfYear; d.setDate(d.getDate() + 7)) {
    const date = d.toISOString().split('T')[0]!;
    const ts = new Date(`${date}T13:30:00Z`).getTime() / 1000;
    events.push({
      id: `jobless-${date}`,
      name: 'Initial Jobless Claims',
      currency: 'USD',
      category: 'EMPLOYMENT',
      impact: 'MEDIUM',
      timestamp: ts,
      date,
      time: '13:30',
    });
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// =============================================================================
// API FETCHING
// =============================================================================

interface JBlankedEvent {
  Name: string;
  Currency: string;
  Category?: string;
  Date: string;
  Actual?: string | number;
  Forecast?: string | number;
  Previous?: string | number;
  Strength?: string;
}

async function fetchFromAPI(fromDate: string, toDate: string): Promise<EconomicEvent[]> {
  if (!API_KEY) {
    console.log('⚠️  No API key provided, using hardcoded events');
    return [];
  }

  const url = `https://www.jblanked.com/news/api/forex-factory/calendar/?from=${fromDate}&to=${toDate}`;

  try {
    console.log(`📡 Fetching from API: ${fromDate} to ${toDate}`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Api-Key ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as JBlankedEvent[];
    console.log(`✅ Got ${data.length} events from API`);

    return data
      .filter((e) => CURRENCIES.includes(e.Currency.toUpperCase()))
      .map((item) => parseJBlankedEvent(item));
  } catch (error) {
    console.error('❌ API fetch failed:', error);
    return [];
  }
}

function parseJBlankedEvent(item: JBlankedEvent): EconomicEvent {
  // Parse date "2024.11.01 13:30:00" -> timestamp
  const dateStr = item.Date.replace(/\./g, '-').replace(' ', 'T') + 'Z';
  const timestamp = Math.floor(new Date(dateStr).getTime() / 1000);

  const currency = item.Currency.toUpperCase();
  const name = item.Name;

  // Classify impact
  let impact: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

  const highImpact = [
    'Non-Farm', 'NFP', 'FOMC', 'Fed', 'ECB', 'CPI', 'GDP',
    'Unemployment Rate', 'Interest Rate',
  ];

  const mediumImpact = [
    'PMI', 'ISM', 'Retail Sales', 'Jobless Claims', 'PPI',
    'Trade Balance', 'Industrial Production', 'Consumer Confidence',
  ];

  const upperName = name.toUpperCase();

  if (highImpact.some((h) => upperName.includes(h.toUpperCase()))) {
    impact = 'HIGH';
  } else if (mediumImpact.some((m) => upperName.includes(m.toUpperCase()))) {
    impact = 'MEDIUM';
  }

  // Also check API strength field
  if (item.Strength?.toLowerCase().includes('high') || item.Strength?.toLowerCase().includes('strong')) {
    impact = 'HIGH';
  } else if (item.Strength?.toLowerCase().includes('medium') || item.Strength?.toLowerCase().includes('moderate')) {
    impact = 'MEDIUM';
  }

  return {
    id: `${timestamp}-${currency}-${name.replace(/\s+/g, '-').toLowerCase()}`,
    name,
    currency,
    category: classifyCategory(name),
    impact,
    timestamp,
    date: item.Date.split(' ')[0]!.replace(/\./g, '-'),
    time: item.Date.split(' ')[1]!.substring(0, 5),
    actual: item.Actual,
    forecast: item.Forecast,
    previous: item.Previous,
  };
}

function classifyCategory(name: string): string {
  const upper = name.toUpperCase();

  if (upper.includes('RATE') || upper.includes('FOMC') || upper.includes('FED') || upper.includes('ECB')) {
    return 'INTEREST_RATE';
  }
  if (upper.includes('EMPLOYMENT') || upper.includes('PAYROLL') || upper.includes('NFP') || upper.includes('JOBLESS')) {
    return 'EMPLOYMENT';
  }
  if (upper.includes('CPI') || upper.includes('PPI') || upper.includes('INFLATION')) {
    return 'INFLATION';
  }
  if (upper.includes('GDP')) {
    return 'GDP';
  }
  if (upper.includes('RETAIL') || upper.includes('SALES')) {
    return 'RETAIL';
  }
  if (upper.includes('PMI') || upper.includes('ISM') || upper.includes('MANUFACTURING')) {
    return 'MANUFACTURING';
  }

  return 'OTHER';
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('📅 ECONOMIC CALENDAR DATA FETCHER');
  console.log('='.repeat(80));
  console.log(`Days back: ${DAYS_BACK}`);
  console.log(`Currencies: ${CURRENCIES.join(', ')}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('='.repeat(80));

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Calculate date range
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - DAYS_BACK);

  const fromStr = fromDate.toISOString().split('T')[0]!;
  const toStr = now.toISOString().split('T')[0]!;

  console.log(`\nDate range: ${fromStr} to ${toStr}`);

  // Try to fetch from API
  let events = await fetchFromAPI(fromStr, toStr);

  // Fallback to hardcoded events - generate for years in range
  if (events.length === 0) {
    const startYear = fromDate.getFullYear();
    const endYear = now.getFullYear();
    console.log(`\n📋 Using hardcoded events for ${startYear}-${endYear}...`);

    for (let year = startYear; year <= endYear; year++) {
      const yearEvents = getHardcodedEventsForYear(year);
      events.push(...yearEvents);
    }
  }

  // Filter by date range
  const fromTs = fromDate.getTime() / 1000;
  const toTs = now.getTime() / 1000;

  events = events.filter((e) => e.timestamp >= fromTs && e.timestamp <= toTs);

  console.log(`\n📊 Total events: ${events.length}`);

  // Count by impact
  const highCount = events.filter((e) => e.impact === 'HIGH').length;
  const mediumCount = events.filter((e) => e.impact === 'MEDIUM').length;
  const lowCount = events.filter((e) => e.impact === 'LOW').length;

  console.log(`  HIGH impact: ${highCount}`);
  console.log(`  MEDIUM impact: ${mediumCount}`);
  console.log(`  LOW impact: ${lowCount}`);

  // Count by category
  const byCategory: Record<string, number> = {};
  for (const e of events) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  console.log('\nBy category:');
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Save to CSV
  const csvHeader = 'id,name,currency,category,impact,timestamp,date,time,actual,forecast,previous';
  const csvRows = events.map((e) =>
    `"${e.id}","${e.name}","${e.currency}","${e.category}","${e.impact}",${e.timestamp},"${e.date}","${e.time}","${e.actual || ''}","${e.forecast || ''}","${e.previous || ''}"`
  );

  const csv = [csvHeader, ...csvRows].join('\n');
  const csvPath = join(OUTPUT_DIR, 'economic_events.csv');
  writeFileSync(csvPath, csv, 'utf-8');
  console.log(`\n💾 Saved: ${csvPath}`);

  // Also save as JSON for easier parsing
  const jsonPath = join(OUTPUT_DIR, 'economic_events.json');
  writeFileSync(jsonPath, JSON.stringify(events, null, 2), 'utf-8');
  console.log(`💾 Saved: ${jsonPath}`);

  // Create summary
  const summary = {
    dateRange: { from: fromStr, to: toStr },
    totalEvents: events.length,
    byImpact: { high: highCount, medium: mediumCount, low: lowCount },
    byCategory,
    currencies: CURRENCIES,
    source: API_KEY ? 'JBlanked API' : 'Hardcoded 2024 events',
  };

  const summaryPath = join(OUTPUT_DIR, 'economic_events_summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`💾 Saved: ${summaryPath}`);

  console.log('\n' + '='.repeat(80));
  console.log('✅ Economic calendar fetch complete!');
  console.log('='.repeat(80));
}

main().catch(console.error);
