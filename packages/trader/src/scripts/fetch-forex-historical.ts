/**
 * Fetch Extended Historical Forex Data from Deriv API
 *
 * Downloads up to 1 year of candle data by making multiple API calls
 * (Deriv API limit is 5000 candles per request)
 *
 * Usage:
 *   SYMBOLS="frxEURUSD" DAYS=365 GRANULARITY=300 npx tsx src/scripts/fetch-forex-historical.ts
 *
 * Granularity options (seconds):
 *   60   = 1 minute  (~525,600 candles/year, needs ~106 requests)
 *   300  = 5 minutes (~105,120 candles/year, needs ~22 requests)
 *   900  = 15 minutes (~35,040 candles/year, needs ~8 requests)
 *   3600 = 1 hour (~8,760 candles/year, needs ~2 requests)
 */

import dotenv from 'dotenv';
import WebSocket from 'ws';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

dotenv.config();

// =============================================================================
// CONFIGURATION
// =============================================================================

const SYMBOLS = (process.env.SYMBOLS || 'frxEURUSD').split(',');
const DAYS = parseInt(process.env.DAYS || '365', 10);
const GRANULARITY = parseInt(process.env.GRANULARITY || '300', 10); // Default 5 min
const OUTPUT_DIR = process.env.OUTPUT_DIR || './analysis-output';
const APP_ID = process.env.DERIV_APP_ID || '1089'; // Public app ID

const MAX_CANDLES_PER_REQUEST = 4999; // Deriv API limit
const DELAY_BETWEEN_REQUESTS = 1000; // 1 second delay to avoid rate limiting

// =============================================================================
// DERIV API CLIENT (Direct WebSocket)
// =============================================================================

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

class SimpleDerivClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log('✅ Connected to Deriv API');
        resolve();
      });

      this.ws.on('error', (error) => {
        reject(error);
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        const reqId = message.req_id;

        if (reqId && this.pendingRequests.has(reqId)) {
          const { resolve, reject } = this.pendingRequests.get(reqId)!;
          this.pendingRequests.delete(reqId);

          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message);
          }
        }
      });

      this.ws.on('close', () => {
        console.log('Connection closed');
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async request(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const reqId = ++this.requestId;
      const request = { ...payload, req_id: reqId };

      this.pendingRequests.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  async getCandles(
    symbol: string,
    granularity: number,
    start: number,
    end: number
  ): Promise<Candle[]> {
    const response = await this.request({
      ticks_history: symbol,
      style: 'candles',
      granularity,
      start,
      end,
      adjust_start_time: 1,
    });

    if (!response.candles || response.candles.length === 0) {
      return [];
    }

    return response.candles.map((c: any) => ({
      timestamp: c.epoch,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    }));
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function candlesToCSV(candles: Candle[]): string {
  const header = 'timestamp,open,high,low,close,volume';
  const rows = candles.map(c =>
    `${c.timestamp},${c.open},${c.high},${c.low},${c.close},0`
  );
  return [header, ...rows].join('\n');
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('📥 EXTENDED FOREX HISTORICAL DATA FETCHER');
  console.log('='.repeat(80));
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Granularity: ${GRANULARITY}s (${GRANULARITY / 60} min)`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('='.repeat(80));

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Calculate time range
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (DAYS * 24 * 60 * 60);

  // Calculate expected candles
  const totalSeconds = DAYS * 24 * 60 * 60;
  const expectedCandles = Math.floor(totalSeconds / GRANULARITY);
  const requestsNeeded = Math.ceil(expectedCandles / MAX_CANDLES_PER_REQUEST);

  console.log(`\nTime range: ${formatDate(startTime)} to ${formatDate(now)}`);
  console.log(`Expected candles: ~${expectedCandles.toLocaleString()}`);
  console.log(`Requests needed: ~${requestsNeeded}`);
  console.log('');

  // Connect to Deriv API
  const client = new SimpleDerivClient();
  await client.connect();

  for (const symbol of SYMBOLS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Fetching ${symbol}...`);
    console.log('='.repeat(60));

    const allCandles: Candle[] = [];
    let currentEnd = now;
    let requestCount = 0;
    let retryCount = 0;
    let noProgressCount = 0;
    const maxRetries = 3;

    while (currentEnd > startTime) {
      requestCount++;
      const chunkStart = Math.max(startTime, currentEnd - (MAX_CANDLES_PER_REQUEST * GRANULARITY));

      console.log(`  Request ${requestCount}: ${formatDate(chunkStart)} to ${formatDate(currentEnd)}`);

      try {
        const candles = await client.getCandles(symbol, GRANULARITY, chunkStart, currentEnd);

        if (candles.length === 0) {
          console.log(`  ⚠️  No more data available`);
          break;
        }

        // Add candles (avoiding duplicates)
        const existingTimestamps = new Set(allCandles.map(c => c.timestamp));
        const newCandles = candles.filter(c => !existingTimestamps.has(c.timestamp));
        allCandles.push(...newCandles);

        console.log(`  ✅ Got ${candles.length} candles (${newCandles.length} new), total: ${allCandles.length}`);

        // Check for progress - if we're getting very few new candles, we're done
        if (newCandles.length < 10) {
          noProgressCount++;
          if (noProgressCount >= 3) {
            console.log(`  ⚠️  No significant progress in last 3 requests, stopping`);
            break;
          }
        } else {
          noProgressCount = 0;
        }

        // Move to earlier time period - use the OLDEST candle from response
        const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);
        const oldestCandle = sortedCandles[0];
        if (oldestCandle && oldestCandle.timestamp < currentEnd) {
          currentEnd = oldestCandle.timestamp - 1;
        } else {
          console.log(`  ⚠️  Cannot go further back, stopping`);
          break;
        }

        // Reset retry count on success
        retryCount = 0;

        // Delay between requests
        await sleep(DELAY_BETWEEN_REQUESTS);

      } catch (error: any) {
        console.error(`  ❌ Error: ${error.message}`);
        retryCount++;

        if (retryCount >= maxRetries) {
          console.error(`  ❌ Max retries reached, stopping`);
          break;
        }

        console.log(`  🔄 Retrying (${retryCount}/${maxRetries})...`);
        await sleep(DELAY_BETWEEN_REQUESTS * 2);
      }

      // Safety limit
      if (requestCount > 50) {
        console.log(`  ⚠️  Safety limit reached (50 requests)`);
        break;
      }
    }

    // Sort candles by timestamp
    allCandles.sort((a, b) => a.timestamp - b.timestamp);

    // Remove duplicates (final pass)
    const uniqueCandles = allCandles.filter((candle, index, self) =>
      index === self.findIndex(c => c.timestamp === candle.timestamp)
    );

    console.log(`\n📊 ${symbol} Summary:`);
    console.log(`  Total candles: ${uniqueCandles.length.toLocaleString()}`);

    if (uniqueCandles.length > 0) {
      console.log(`  Period: ${formatDate(uniqueCandles[0]!.timestamp)} to ${formatDate(uniqueCandles[uniqueCandles.length - 1]!.timestamp)}`);

      // Calculate actual days covered
      const firstTs = uniqueCandles[0]!.timestamp;
      const lastTs = uniqueCandles[uniqueCandles.length - 1]!.timestamp;
      const daysCovered = (lastTs - firstTs) / (24 * 60 * 60);
      console.log(`  Days covered: ${daysCovered.toFixed(1)}`);

      // Save to CSV
      const csv = candlesToCSV(uniqueCandles);
      const filename = join(OUTPUT_DIR, `${symbol}_${GRANULARITY}s_${DAYS}d.csv`);
      writeFileSync(filename, csv, 'utf-8');
      console.log(`  💾 Saved: ${filename}`);

      // Also save as raw_candles for the analysis script
      const rawFilename = join(OUTPUT_DIR, `${symbol}_raw_candles.csv`);
      writeFileSync(rawFilename, csv, 'utf-8');
      console.log(`  💾 Saved: ${rawFilename}`);
    } else {
      console.log(`  ❌ No data retrieved for ${symbol}`);
    }
  }

  await client.disconnect();

  console.log('\n' + '='.repeat(80));
  console.log('✅ Data fetch complete!');
  console.log('='.repeat(80));
  console.log('\nNext steps:');
  console.log('  1. Run analysis: pnpm analyze:forex');
  console.log('  2. Open Jupyter: cd analysis-output && source venv/bin/activate && jupyter notebook');
  console.log('='.repeat(80));
}

main().catch(console.error);
