/**
 * Historical Data Fetcher for Deriv API
 *
 * Robust script to download 30 days of 1-minute candles with:
 * - Pagination handling
 * - Rate limiting
 * - Gap detection and validation
 * - Progress tracking
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';

// Configuration
const APP_ID = process.env.DERIV_APP_ID || '106646';
const SYMBOLS = process.env.SYMBOLS?.split(',') || ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const DAYS = parseInt(process.env.DAYS || '30', 10);
// Supported granularities: 60 (1m), 120 (2m), 180 (3m), 300 (5m), 600 (10m), 900 (15m), 1800 (30m), 3600 (1h)
const GRANULARITY = parseInt(process.env.GRANULARITY || '60', 10);
const DATA_DIR = join(process.cwd(), 'data');
const MAX_CANDLES_PER_REQUEST = 5000; // Deriv API limit
const REQUEST_DELAY_MS = 1000; // 1 second between requests
const MAX_GAP_MINUTES = Math.max(5, GRANULARITY / 60); // Alert if gap > expected interval

// Helper to get timeframe label
function getTimeframeLabel(granularitySeconds: number): string {
  const minutes = granularitySeconds / 60;
  if (minutes < 60) return `${minutes}m`;
  return `${minutes / 60}h`;
}

interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface DownloadStats {
  symbol: string;
  totalCandles: number;
  startTime: Date;
  endTime: Date;
  gaps: Array<{ from: Date; to: Date; minutes: number }>;
  requests: number;
}

/**
 * Simple WebSocket-based API client
 */
class DerivWSClient {
  private ws: WebSocket;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(appId: string) {
    this.ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);

    this.ws.on('message', (data: any) => {
      const response = JSON.parse(data.toString());

      if (response.req_id && this.pendingRequests.has(response.req_id)) {
        const { resolve, reject } = this.pendingRequests.get(response.req_id)!;
        this.pendingRequests.delete(response.req_id);

        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response);
        }
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', (error) => reject(error));
    });
  }

  async request(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = ++this.requestId;
      const requestPayload = { ...payload, req_id: reqId };

      this.pendingRequests.set(reqId, { resolve, reject });

      this.ws.send(JSON.stringify(requestPayload));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate end time for fetching data (now - offset)
 */
function calculateEndTime(daysBack: number): number {
  const now = Date.now();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((now - (daysBack * millisecondsPerDay)) / 1000);
}

/**
 * Detect gaps in candle data
 */
function detectGaps(candles: Candle[]): Array<{ from: Date; to: Date; minutes: number }> {
  const gaps: Array<{ from: Date; to: Date; minutes: number }> = [];

  for (let i = 1; i < candles.length; i++) {
    const prevEpoch = candles[i - 1].epoch;
    const currEpoch = candles[i].epoch;
    const gapSeconds = currEpoch - prevEpoch;
    const expectedGap = GRANULARITY;

    // If gap is larger than expected + tolerance
    if (gapSeconds > expectedGap + 60) {
      const gapMinutes = Math.floor(gapSeconds / 60);
      if (gapMinutes >= MAX_GAP_MINUTES) {
        gaps.push({
          from: new Date(prevEpoch * 1000),
          to: new Date(currEpoch * 1000),
          minutes: gapMinutes,
        });
      }
    }
  }

  return gaps;
}

/**
 * Fetch candles with pagination
 */
async function fetchCandlesWithPagination(
  client: DerivWSClient,
  symbol: string,
  targetDays: number
): Promise<Candle[]> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📥 Fetching ${targetDays} days of data for ${symbol}`);
  console.log('='.repeat(80));

  const allCandles: Candle[] = [];
  let endTime = Math.floor(Date.now() / 1000); // Current time in seconds
  const targetStartTime = calculateEndTime(targetDays);
  let requestCount = 0;
  let hasMoreData = true;

  console.log(`   Target period: ${new Date(targetStartTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);
  console.log(`   Candles per request: ${MAX_CANDLES_PER_REQUEST}`);
  console.log(`   Rate limit delay: ${REQUEST_DELAY_MS}ms\n`);

  while (hasMoreData && endTime > targetStartTime) {
    requestCount++;

    try {
      console.log(`[Request ${requestCount}] Fetching up to ${MAX_CANDLES_PER_REQUEST} candles ending at ${new Date(endTime * 1000).toISOString()}...`);

      // Request candles
      const response = await client.request({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: MAX_CANDLES_PER_REQUEST,
        end: endTime.toString(),
        granularity: GRANULARITY,
        style: 'candles',
      });

      if (!response.candles || response.candles.length === 0) {
        console.log('   ✓ No more candles available');
        hasMoreData = false;
        break;
      }

      const candles = response.candles.map((c: any) => ({
        epoch: c.epoch,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: c.volume ? parseFloat(c.volume) : 0,
      }));

      console.log(`   ✓ Received ${candles.length} candles`);
      console.log(`     Range: ${new Date(candles[0].epoch * 1000).toISOString()} to ${new Date(candles[candles.length - 1].epoch * 1000).toISOString()}`);

      // Add to collection (prepend since we're going backwards)
      allCandles.unshift(...candles);

      // Update endTime to fetch older data (use the oldest candle we just got)
      const oldestCandle = candles[0];
      endTime = oldestCandle.epoch - 1; // Go back 1 second to avoid overlap

      // Check if we've reached our target
      if (oldestCandle.epoch <= targetStartTime) {
        console.log(`   ✓ Reached target start time`);
        hasMoreData = false;
      }

      // Progress update
      const currentProgress = allCandles.length;
      const estimatedTotal = (targetDays * 24 * 60); // minutes in targetDays
      const progressPct = Math.min(100, (currentProgress / estimatedTotal) * 100);
      console.log(`   Progress: ${currentProgress} candles (~${progressPct.toFixed(1)}%)\n`);

      // Rate limiting
      if (hasMoreData) {
        await sleep(REQUEST_DELAY_MS);
      }

    } catch (error: any) {
      console.error(`   ❌ Error fetching candles:`, error.message);
      if (error.code === 'RateLimit') {
        console.log(`   ⏱️  Rate limit hit, waiting 5 seconds...`);
        await sleep(5000);
      } else {
        throw error;
      }
    }
  }

  // Remove duplicates (by epoch)
  const uniqueCandles = Array.from(
    new Map(allCandles.map(c => [c.epoch, c])).values()
  );

  // Sort by epoch ascending
  uniqueCandles.sort((a, b) => a.epoch - b.epoch);

  console.log(`\n📊 Download Summary:`);
  console.log(`   Total requests: ${requestCount}`);
  console.log(`   Candles fetched: ${allCandles.length}`);
  console.log(`   Unique candles: ${uniqueCandles.length}`);
  console.log(`   Period: ${new Date(uniqueCandles[0].epoch * 1000).toISOString()} to ${new Date(uniqueCandles[uniqueCandles.length - 1].epoch * 1000).toISOString()}`);

  return uniqueCandles;
}

/**
 * Analyze and report on downloaded data
 */
function analyzeData(symbol: string, candles: Candle[]): DownloadStats {
  const gaps = detectGaps(candles);

  const stats: DownloadStats = {
    symbol,
    totalCandles: candles.length,
    startTime: new Date(candles[0].epoch * 1000),
    endTime: new Date(candles[candles.length - 1].epoch * 1000),
    gaps,
    requests: 0,
  };

  console.log(`\n🔍 Data Quality Analysis:`);
  console.log(`   Expected candles (1/min): ~${Math.floor((stats.endTime.getTime() - stats.startTime.getTime()) / (60 * 1000))}`);
  console.log(`   Actual candles: ${stats.totalCandles}`);
  console.log(`   Coverage: ${((stats.totalCandles / Math.floor((stats.endTime.getTime() - stats.startTime.getTime()) / (60 * 1000))) * 100).toFixed(2)}%`);

  if (gaps.length > 0) {
    console.log(`\n⚠️  Detected ${gaps.length} significant gaps (>${MAX_GAP_MINUTES} minutes):`);
    gaps.slice(0, 5).forEach((gap, i) => {
      console.log(`   ${i + 1}. ${gap.from.toISOString()} → ${gap.to.toISOString()} (${gap.minutes} min)`);
    });
    if (gaps.length > 5) {
      console.log(`   ... and ${gaps.length - 5} more gaps`);
    }
  } else {
    console.log(`\n✅ No significant gaps detected!`);
  }

  return stats;
}

/**
 * Save candles to JSON file
 */
function saveToFile(symbol: string, candles: Candle[], stats: DownloadStats): string {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `${symbol}_${DAYS}days_${timestamp}.json`;
  const filepath = join(DATA_DIR, filename);

  const data = {
    metadata: {
      symbol: stats.symbol,
      granularity: GRANULARITY,
      totalCandles: stats.totalCandles,
      startTime: stats.startTime.toISOString(),
      endTime: stats.endTime.toISOString(),
      downloadedAt: new Date().toISOString(),
      gaps: stats.gaps.length,
      gapDetails: stats.gaps,
    },
    candles,
  };

  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`\n💾 Saved to: ${filepath}`);
  console.log(`   File size: ${(Buffer.byteLength(JSON.stringify(data)) / 1024 / 1024).toFixed(2)} MB`);

  return filepath;
}

/**
 * Convert JSON to CSV format for backtesting
 */
function convertToCSV(symbol: string, candles: Candle[]): string {
  const tfLabel = getTimeframeLabel(GRANULARITY);
  const filename = `${symbol}_${tfLabel}_${DAYS}d.csv`;
  const filepath = join(DATA_DIR, filename);

  const header = 'timestamp,open,high,low,close,volume';
  const rows = candles.map(c => {
    const timestamp = c.epoch * 1000;
    return `${timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume || 0}`;
  });

  const csv = [header, ...rows].join('\n');

  // Save to data directory
  writeFileSync(filepath, csv);

  // Save to backtest-data directory as well
  const backtestDir = join(process.cwd(), 'backtest-data');
  if (!existsSync(backtestDir)) {
    mkdirSync(backtestDir, { recursive: true });
  }
  const backtestPath = join(backtestDir, filename);
  writeFileSync(backtestPath, csv);

  console.log(`\n📄 CSV files created:`);
  console.log(`   ${filepath}`);
  console.log(`   ${backtestPath}`);

  return filepath;
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('📥 DERIV HISTORICAL DATA FETCHER');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Days: ${DAYS}`);
  console.log(`   Granularity: ${GRANULARITY}s (${getTimeframeLabel(GRANULARITY)})`);
  console.log(`   App ID: ${APP_ID}`);
  console.log();

  // Connect to Deriv API
  console.log('🔌 Connecting to Deriv API...');
  const client = new DerivWSClient(APP_ID);
  await client.connect();
  console.log('✅ Connected to Deriv API\n');

  const allStats: DownloadStats[] = [];

  // Fetch data for each symbol
  for (const symbol of SYMBOLS) {
    try {
      // Fetch candles with pagination
      const candles = await fetchCandlesWithPagination(client, symbol, DAYS);

      // Analyze data quality
      const stats = analyzeData(symbol, candles);
      allStats.push(stats);

      // Save to JSON
      saveToFile(symbol, candles, stats);

      // Convert to CSV for backtesting
      convertToCSV(symbol, candles);

      console.log(`\n✅ ${symbol} download complete!\n`);

    } catch (error: any) {
      console.error(`\n❌ Failed to download ${symbol}:`, error.message);
      console.error(error.stack);
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log();

  for (const stats of allStats) {
    console.log(`${stats.symbol}:`);
    console.log(`   Candles: ${stats.totalCandles}`);
    console.log(`   Period: ${stats.startTime.toISOString()} to ${stats.endTime.toISOString()}`);
    console.log(`   Gaps: ${stats.gaps.length}`);
    console.log();
  }

  console.log('✅ All downloads complete!\n');

  // Close connection
  client.close();
  process.exit(0);
}

// Run
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
