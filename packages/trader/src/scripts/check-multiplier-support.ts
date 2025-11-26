/**
 * Check which symbols support Multiplier contracts via Deriv API
 *
 * Run: npx tsx src/scripts/check-multiplier-support.ts
 */

import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const DERIV_API_TOKEN = process.env.DERIV_API_TOKEN;
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// Symbols to check
const SYMBOLS_TO_CHECK = [
  // Forex Majors
  'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 'frxUSDCAD', 'frxUSDCHF',
  // Forex Minors
  'frxEURGBP', 'frxEURJPY', 'frxGBPJPY', 'frxAUDJPY', 'frxEURCAD',
  // Metals
  'frxXAUUSD', 'frxXAGUSD',
  // Crypto
  'cryBTCUSD', 'cryETHUSD',
  // Indices
  'OTC_DJI', 'OTC_NDX', 'OTC_SPX', 'OTC_FTSE', 'OTC_DAX',
  // Volatility Indices (we know these work)
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Boom/Crash
  'BOOM1000', 'BOOM500', 'CRASH1000', 'CRASH500',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Range Break
  'RDBEAR', 'RDBULL',
  // Step Index
  'stpRNG',
];

class MultiplierChecker {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void }>();

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`\n🔌 Connecting to Deriv API...`);
      this.ws = new WebSocket(DERIV_WS_URL);

      this.ws.on('open', () => {
        console.log(`✅ Connected\n`);
        resolve();
      });

      this.ws.on('error', reject);

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.req_id && this.pendingRequests.has(message.req_id)) {
            const pending = this.pendingRequests.get(message.req_id)!;
            if (message.error) {
              pending.reject(new Error(message.error.message));
            } else {
              pending.resolve(message);
            }
            this.pendingRequests.delete(message.req_id);
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      });
    });
  }

  private async request(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = ++this.requestId;
      this.pendingRequests.set(reqId, { resolve, reject });
      this.ws!.send(JSON.stringify({ ...payload, req_id: reqId }));

      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  async authorize(): Promise<void> {
    if (!DERIV_API_TOKEN) {
      console.log('⚠️  No API token - results may vary by region\n');
      return;
    }

    console.log(`🔑 Authorizing...`);
    const response = await this.request({ authorize: DERIV_API_TOKEN });
    console.log(`✅ Authorized as: ${response.authorize.email}`);
    console.log(`   Landing Company: ${response.authorize.landing_company_name}\n`);
  }

  async checkSymbol(symbol: string): Promise<{
    symbol: string;
    hasMultipliers: boolean;
    multiplierValues?: number[];
    minStake?: number;
    maxStake?: number;
    error?: string;
  }> {
    try {
      const response = await this.request({
        contracts_for: symbol,
        currency: 'USD',
        product_type: 'basic',
      });

      const contracts = response.contracts_for?.available || [];

      // Find MULTUP and MULTDOWN contracts
      const multiplierContracts = contracts.filter((c: any) =>
        c.contract_type === 'MULTUP' || c.contract_type === 'MULTDOWN'
      );

      if (multiplierContracts.length === 0) {
        return { symbol, hasMultipliers: false };
      }

      // Get multiplier details from first contract
      const contract = multiplierContracts[0];

      return {
        symbol,
        hasMultipliers: true,
        multiplierValues: contract.multiplier_range || [],
        minStake: contract.min_stake,
        maxStake: contract.max_stake,
      };
    } catch (error: any) {
      return {
        symbol,
        hasMultipliers: false,
        error: error.message,
      };
    }
  }

  async run(): Promise<void> {
    try {
      await this.connect();
      await this.authorize();

      console.log('=' .repeat(80));
      console.log('CHECKING MULTIPLIER SUPPORT FOR VARIOUS MARKETS');
      console.log('=' .repeat(80));

      const results: Map<string, any[]> = new Map();

      // Categorize symbols
      const categories: Record<string, string[]> = {
        'FOREX MAJORS': ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 'frxUSDCAD', 'frxUSDCHF'],
        'FOREX MINORS': ['frxEURGBP', 'frxEURJPY', 'frxGBPJPY', 'frxAUDJPY', 'frxEURCAD'],
        'METALS': ['frxXAUUSD', 'frxXAGUSD'],
        'CRYPTO': ['cryBTCUSD', 'cryETHUSD'],
        'INDICES': ['OTC_DJI', 'OTC_NDX', 'OTC_SPX', 'OTC_FTSE', 'OTC_DAX'],
        'VOLATILITY INDEX': ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
        'VOLATILITY 1s': ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'],
        'BOOM/CRASH': ['BOOM1000', 'BOOM500', 'CRASH1000', 'CRASH500'],
        'JUMP INDEX': ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'],
        'RANGE BREAK': ['RDBEAR', 'RDBULL'],
        'STEP INDEX': ['stpRNG'],
      };

      for (const [category, symbols] of Object.entries(categories)) {
        console.log(`\n📊 ${category}`);
        console.log('-'.repeat(60));

        const categoryResults: any[] = [];

        for (const symbol of symbols) {
          process.stdout.write(`   Checking ${symbol}... `);
          const result = await this.checkSymbol(symbol);

          if (result.hasMultipliers) {
            const multipliers = result.multiplierValues?.join(', ') || 'N/A';
            console.log(`✅ SUPPORTED`);
            console.log(`      Multipliers: [${multipliers}]`);
            console.log(`      Stake: $${result.minStake || '?'} - $${result.maxStake || '?'}`);
            categoryResults.push(result);
          } else if (result.error) {
            console.log(`⚠️  Error: ${result.error}`);
          } else {
            console.log(`❌ NOT AVAILABLE`);
          }

          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 200));
        }

        results.set(category, categoryResults);
      }

      // Summary
      console.log('\n\n' + '='.repeat(80));
      console.log('SUMMARY: SYMBOLS WITH MULTIPLIER SUPPORT');
      console.log('='.repeat(80));

      let totalSupported = 0;
      for (const [category, categoryResults] of results) {
        if (categoryResults.length > 0) {
          console.log(`\n✅ ${category}:`);
          for (const r of categoryResults) {
            const multipliers = r.multiplierValues?.slice(0, 5).join(', ') || 'N/A';
            console.log(`   ${r.symbol.padEnd(15)} | Multipliers: [${multipliers}${r.multiplierValues?.length > 5 ? '...' : ''}]`);
            totalSupported++;
          }
        }
      }

      console.log(`\n📈 Total symbols with Multiplier support: ${totalSupported}`);

      // Usage examples
      console.log('\n\n' + '='.repeat(80));
      console.log('USAGE EXAMPLES FOR BB SQUEEZE STRATEGY');
      console.log('='.repeat(80));

      const forexSupported = results.get('FOREX MAJORS')?.map(r => r.symbol) || [];
      const metalsSupported = results.get('METALS')?.map(r => r.symbol) || [];

      if (forexSupported.length > 0) {
        console.log(`\n# Forex:`);
        console.log(`TRADE_MODE=cfd SYMBOL="${forexSupported[0]}" pnpm demo:squeeze`);
      }

      if (metalsSupported.length > 0) {
        console.log(`\n# Metals (Gold):`);
        console.log(`TRADE_MODE=cfd SYMBOL="${metalsSupported[0]}" pnpm demo:squeeze`);
      }

      console.log(`\n# Multiple assets:`);
      const allSupported = [...forexSupported.slice(0, 2), ...metalsSupported.slice(0, 1)];
      if (allSupported.length > 0) {
        console.log(`TRADE_MODE=cfd SYMBOL="${allSupported.join(',')}" pnpm demo:squeeze`);
      }

      this.ws?.close();
      process.exit(0);
    } catch (error: any) {
      console.error(`\n❌ Error:`, error.message);
      process.exit(1);
    }
  }
}

const checker = new MultiplierChecker();
checker.run();
