/**
 * Validate Gateway Commands for Telegram Bot
 *
 * Tests all commands that would be needed for Telegram integration
 * Run against the remote server: GATEWAY_URL=ws://37.27.47.129:3000 npx tsx validate-telegram-commands.ts
 */

import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';

interface TestResult {
  command: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  data?: any;
  error?: string;
}

const results: TestResult[] = [];

/**
 * Send command and wait for response
 */
async function sendCommand(ws: WebSocket, command: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      reject(new Error('Command timeout (10s)'));
    }, 10000);

    const handler = (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.requestId === requestId) {
          clearTimeout(timeout);
          ws.off('message', handler);
          if (message.success) {
            resolve(message.data);
          } else {
            reject(new Error(message.error?.message || 'Command failed'));
          }
        }
      } catch (e) {
        // Ignore parse errors for event messages
      }
    };

    ws.on('message', handler);

    ws.send(JSON.stringify({
      type: 'command',
      command,
      params,
      requestId,
      timestamp: Date.now(),
    }));
  });
}

/**
 * Run a test
 */
async function runTest(
  ws: WebSocket,
  name: string,
  command: string,
  params?: any,
  validate?: (data: any) => boolean
): Promise<void> {
  const start = Date.now();
  try {
    const data = await sendCommand(ws, command, params);
    const duration = Date.now() - start;

    const isValid = validate ? validate(data) : true;

    results.push({
      command: name,
      status: isValid ? 'PASS' : 'FAIL',
      duration,
      data: summarizeData(data),
      error: isValid ? undefined : 'Validation failed',
    });
  } catch (error: any) {
    results.push({
      command: name,
      status: 'FAIL',
      duration: Date.now() - start,
      error: error.message,
    });
  }
}

/**
 * Summarize data for display
 */
function summarizeData(data: any): any {
  if (!data) return null;

  // For arrays, show count and first item
  if (Array.isArray(data)) {
    return { count: data.length, sample: data[0] };
  }

  // For objects with count, show summary
  if (data.count !== undefined) {
    const summary: any = { count: data.count };
    if (data.totalProfit !== undefined) summary.totalProfit = data.totalProfit;
    if (data.winRate !== undefined) summary.winRate = data.winRate;
    if (data.wins !== undefined) summary.wins = data.wins;
    if (data.losses !== undefined) summary.losses = data.losses;
    return summary;
  }

  // For balance
  if (data.amount !== undefined && data.currency !== undefined) {
    return { amount: data.amount, currency: data.currency };
  }

  // For stats
  if (data.stats) {
    return data.stats;
  }

  return data;
}

/**
 * Main test runner
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     GATEWAY COMMAND VALIDATION FOR TELEGRAM                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📡 Connecting to: ${GATEWAY_URL}\n`);

  const ws = new WebSocket(GATEWAY_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ Connected to Gateway\n');
      resolve();
    });
    ws.on('error', (err) => {
      console.error('❌ Connection failed:', err.message);
      reject(err);
    });
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TESTING COMMANDS FOR TELEGRAM BOT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ============================================
  // 1. PING - Health check
  // ============================================
  console.log('1️⃣  Testing: ping (health check)');
  await runTest(ws, 'ping', 'ping', undefined, (data) => data.message === 'pong');

  // ============================================
  // 2. BALANCE - /balance command
  // ============================================
  console.log('2️⃣  Testing: balance (/balance)');
  await runTest(ws, 'balance', 'balance', undefined, (data) =>
    typeof data.amount === 'number' && typeof data.currency === 'string'
  );

  // ============================================
  // 3. PORTFOLIO - /status command (open positions)
  // ============================================
  console.log('3️⃣  Testing: portfolio (/status)');
  await runTest(ws, 'portfolio', 'portfolio', undefined, (data) =>
    Array.isArray(data.positions) && typeof data.count === 'number'
  );

  // ============================================
  // 4. PROFIT TABLE - /profit command (closed trades)
  // ============================================
  console.log('4️⃣  Testing: profit_table (/profit - last 24h)');
  const yesterday = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  await runTest(ws, 'profit_table', 'profit_table', {
    dateFrom: yesterday,
    limit: 50
  }, (data) =>
    Array.isArray(data.contracts) && typeof data.totalProfit === 'number'
  );

  // ============================================
  // 5. GET STATS - /stats command (daily stats)
  // ============================================
  console.log('5️⃣  Testing: get_stats (/stats)');
  await runTest(ws, 'get_stats', 'get_stats', undefined, (data) =>
    data.stats && typeof data.stats.totalTrades === 'number'
  );

  // ============================================
  // 6. GET TRADES - /trades command (trade history)
  // ============================================
  console.log('6️⃣  Testing: get_trades (/trades)');
  await runTest(ws, 'get_trades', 'get_trades', { limit: 10 }, (data) =>
    Array.isArray(data.trades)
  );

  // ============================================
  // 7. GET ASSETS - /assets command (monitored assets)
  // ============================================
  console.log('7️⃣  Testing: get_assets (/assets)');
  await runTest(ws, 'get_assets', 'get_assets', undefined, (data) =>
    Array.isArray(data.assets)
  );

  // ============================================
  // 8. INSTRUMENTS - Available trading pairs
  // ============================================
  console.log('8️⃣  Testing: instruments (available symbols)');
  await runTest(ws, 'instruments', 'instruments', undefined, (data) =>
    Array.isArray(data.instruments) && data.instruments.length > 0
  );

  // ============================================
  // 9. GET CANDLES - Historical data
  // ============================================
  console.log('9️⃣  Testing: get_candles (historical data)');
  await runTest(ws, 'get_candles', 'get_candles', {
    asset: 'R_75',
    timeframe: 60,
    count: 10
  }, (data) =>
    Array.isArray(data.candles)
  );

  // Close connection
  ws.close();

  // ============================================
  // RESULTS SUMMARY
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RESULTS SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    const duration = `${result.duration}ms`.padStart(6);
    console.log(`${icon} ${result.command.padEnd(20)} [${duration}]`);

    if (result.status === 'PASS' && result.data) {
      console.log(`   └─ ${JSON.stringify(result.data)}`);
    }
    if (result.status === 'FAIL' && result.error) {
      console.log(`   └─ Error: ${result.error}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ============================================
  // TELEGRAM FEATURE MAPPING
  // ============================================
  console.log('📱 TELEGRAM COMMAND MAPPING:\n');

  const mapping = [
    { telegram: '/balance', gateway: 'balance', status: results.find(r => r.command === 'balance')?.status },
    { telegram: '/status', gateway: 'portfolio', status: results.find(r => r.command === 'portfolio')?.status },
    { telegram: '/profit', gateway: 'profit_table', status: results.find(r => r.command === 'profit_table')?.status },
    { telegram: '/stats', gateway: 'get_stats', status: results.find(r => r.command === 'get_stats')?.status },
    { telegram: '/trades', gateway: 'get_trades', status: results.find(r => r.command === 'get_trades')?.status },
    { telegram: '/assets', gateway: 'get_assets', status: results.find(r => r.command === 'get_assets')?.status },
  ];

  for (const m of mapping) {
    const icon = m.status === 'PASS' ? '✅' : '❌';
    console.log(`   ${icon} ${m.telegram.padEnd(12)} → ${m.gateway}`);
  }

  console.log('\n📝 MISSING FOR TELEGRAM:\n');
  console.log('   ⚠️  /start, /stop, /pause  → Need "control" command');
  console.log('   ⚠️  /forceexit             → Need "close_position" command');
  console.log('   ⚠️  Daily summary          → Need scheduled task\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
