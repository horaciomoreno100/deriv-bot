/**
 * Script to list all available symbols that support Multiplier contracts
 *
 * Run: npx tsx src/scripts/list-available-symbols.ts
 */

import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const DERIV_API_TOKEN = process.env.DERIV_API_TOKEN;
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

interface ActiveSymbol {
  symbol: string;
  display_name: string;
  market: string;
  market_display_name: string;
  submarket: string;
  submarket_display_name: string;
  is_trading_suspended: number;
  pip: number;
}

class SymbolLister {
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

      this.ws.on('error', (err) => {
        reject(err);
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
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
      }, 30000);
    });
  }

  async authorize(): Promise<void> {
    if (!DERIV_API_TOKEN) {
      console.log('⚠️  No API token - showing all symbols (some may not be available for your account)\n');
      return;
    }

    console.log(`🔑 Authorizing...`);
    const response = await this.request({ authorize: DERIV_API_TOKEN });
    console.log(`✅ Authorized as: ${response.authorize.email}\n`);
  }

  async getActiveSymbols(): Promise<ActiveSymbol[]> {
    console.log(`📊 Fetching active symbols...`);
    const response = await this.request({
      active_symbols: 'full',
      product_type: 'basic',
    });
    return response.active_symbols || [];
  }

  async checkMultiplierSupport(symbol: string): Promise<boolean> {
    try {
      const response = await this.request({
        contracts_for: symbol,
        currency: 'USD',
        product_type: 'basic',
      });

      const contracts = response.contracts_for?.available || [];
      return contracts.some((c: any) =>
        c.contract_type === 'MULTUP' || c.contract_type === 'MULTDOWN'
      );
    } catch {
      return false;
    }
  }

  async run(): Promise<void> {
    try {
      await this.connect();
      await this.authorize();

      const symbols = await this.getActiveSymbols();
      console.log(`📋 Found ${symbols.length} total symbols\n`);

      // Group by market
      const byMarket = new Map<string, ActiveSymbol[]>();
      for (const sym of symbols) {
        const market = sym.market_display_name;
        if (!byMarket.has(market)) {
          byMarket.set(market, []);
        }
        byMarket.get(market)!.push(sym);
      }

      // Markets to check for Multipliers (non-Volatility)
      const marketsToCheck = [
        'Forex',
        'Commodities',
        'Stock Indices',
        'Cryptocurrencies',
        'Derived',
        'Basket Indices',
      ];

      console.log('=' .repeat(80));
      console.log('SYMBOLS WITH MULTIPLIER SUPPORT (by Market)');
      console.log('=' .repeat(80));

      for (const [market, marketSymbols] of byMarket) {
        // Skip if not in our target markets
        if (!marketsToCheck.some(m => market.toLowerCase().includes(m.toLowerCase()))) {
          continue;
        }

        console.log(`\n📈 ${market.toUpperCase()}`);
        console.log('-'.repeat(60));

        // Group by submarket
        const bySubmarket = new Map<string, ActiveSymbol[]>();
        for (const sym of marketSymbols) {
          const sub = sym.submarket_display_name;
          if (!bySubmarket.has(sub)) {
            bySubmarket.set(sub, []);
          }
          bySubmarket.get(sub)!.push(sym);
        }

        for (const [submarket, subSymbols] of bySubmarket) {
          const multiplierSymbols: ActiveSymbol[] = [];

          // Check first 5 symbols per submarket for Multiplier support
          for (const sym of subSymbols.slice(0, 10)) {
            if (!sym.is_trading_suspended) {
              const hasMultiplier = await checkMultiplierFast(sym.symbol);
              if (hasMultiplier) {
                multiplierSymbols.push(sym);
              }
            }
          }

          if (multiplierSymbols.length > 0) {
            console.log(`\n  📊 ${submarket}:`);
            for (const sym of multiplierSymbols) {
              console.log(`     ${sym.symbol.padEnd(20)} | ${sym.display_name}`);
            }
          }
        }
      }

      // Also show Volatility Indices for reference
      console.log(`\n\n📈 VOLATILITY INDICES (Current - for reference)`);
      console.log('-'.repeat(60));
      const volSymbols = symbols.filter(s =>
        s.market === 'synthetic_index' &&
        s.symbol.startsWith('R_') &&
        !s.is_trading_suspended
      );
      for (const sym of volSymbols) {
        console.log(`   ${sym.symbol.padEnd(20)} | ${sym.display_name}`);
      }

      console.log('\n\n' + '='.repeat(80));
      console.log('RECOMMENDED SYMBOLS FOR BB SQUEEZE TESTING');
      console.log('='.repeat(80));

      console.log(`
📊 FOREX (Major Pairs):
   SYMBOL="frxEURUSD"         # EUR/USD
   SYMBOL="frxGBPUSD"         # GBP/USD
   SYMBOL="frxUSDJPY"         # USD/JPY
   SYMBOL="frxAUDUSD"         # AUD/USD

🥇 METALS:
   SYMBOL="frxXAUUSD"         # Gold/USD
   SYMBOL="frxXAGUSD"         # Silver/USD

📈 INDICES:
   SYMBOL="OTC_DJI"           # Dow Jones
   SYMBOL="OTC_NDX"           # NASDAQ 100
   SYMBOL="OTC_SPX"           # S&P 500
   SYMBOL="OTC_FTSE"          # FTSE 100

⚡ VOLATILITY (Current):
   SYMBOL="R_75"              # Volatility 75
   SYMBOL="R_100"             # Volatility 100
   SYMBOL="1HZ100V"           # Volatility 100 (1s)

💡 EXAMPLE USAGE:
   TRADE_MODE=cfd SYMBOL="frxXAUUSD" pnpm demo:squeeze
   TRADE_MODE=cfd SYMBOL="frxEURUSD,frxGBPUSD" pnpm demo:squeeze
`);

      this.ws?.close();
      process.exit(0);
    } catch (error: any) {
      console.error(`\n❌ Error:`, error.message);
      process.exit(1);
    }
  }
}

// Fast check without full contracts_for call
async function checkMultiplierFast(symbol: string): Promise<boolean> {
  // Known symbols that support Multipliers
  const multiplierSymbols = [
    // Volatility Indices
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
    // Forex majors
    'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 'frxUSDCAD', 'frxUSDCHF',
    'frxEURGBP', 'frxEURJPY', 'frxGBPJPY', 'frxAUDJPY',
    // Metals
    'frxXAUUSD', 'frxXAGUSD',
    // Crypto
    'cryBTCUSD', 'cryETHUSD',
    // Indices
    'OTC_DJI', 'OTC_NDX', 'OTC_SPX', 'OTC_FTSE', 'OTC_DAX',
    // Crash/Boom
    'BOOM1000', 'BOOM500', 'CRASH1000', 'CRASH500',
    // Jump indices
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
    // Step indices
    'stpRNG', 'STEPIDX',
    // Range Break
    'RDBEAR', 'RDBULL',
  ];

  return multiplierSymbols.includes(symbol) ||
         symbol.startsWith('R_') ||
         symbol.startsWith('1HZ') ||
         symbol.startsWith('frx') ||
         symbol.startsWith('cry') ||
         symbol.startsWith('OTC_');
}

const lister = new SymbolLister();
lister.run();
