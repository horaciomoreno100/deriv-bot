/**
 * Investigate Stock Indices (DAX, NASDAQ, S&P 500, etc.) in Deriv API
 *
 * Checks:
 * - Available stock indices symbols
 * - Multiplier contract support
 * - Trading hours
 * - Contract types available
 * - Price data availability
 *
 * Usage:
 *   npx tsx src/scripts/investigate-stock-indices.ts
 */

import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const DERIV_API_TOKEN = process.env.DERIV_API_TOKEN;
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// Stock indices to investigate (will be populated from API)
const STOCK_INDICES_TO_CHECK = [
    'OTC_GDAXI',    // DAX (Germany) - correct symbol
    'OTC_DJI',      // Dow Jones (US)
    'OTC_NDX',      // NASDAQ 100 (US)
    'OTC_SPC',      // S&P 500 (US) - might be different
    'OTC_FTSE',     // FTSE 100 (UK)
    'OTC_N225',     // Nikkei 225 (Japan)
    'OTC_AS51',     // ASX 200 (Australia)
    'OTC_SX5E',     // Euro Stoxx 50
    'OTC_FCHI',     // CAC 40 (France)
    'OTC_HSI',      // Hang Seng (Hong Kong)
];

class StockIndicesInvestigator {
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
            }, 15000);
        });
    }

    async authorize(): Promise<void> {
        if (!DERIV_API_TOKEN) {
            console.log('⚠️  No API token - some features may be limited\n');
            return;
        }

        console.log(`🔑 Authorizing...`);
        const response = await this.request({ authorize: DERIV_API_TOKEN });
        console.log(`✅ Authorized as: ${response.authorize.email}\n`);
    }

    async getActiveSymbols(): Promise<any[]> {
        const response = await this.request({
            active_symbols: 'full',
            product_type: 'basic',
        });
        return response.active_symbols || [];
    }

    async getSymbolInfo(symbol: string): Promise<any | null> {
        try {
            const symbols = await this.getActiveSymbols();
            return symbols.find((s: any) => s.symbol === symbol) || null;
        } catch {
            return null;
        }
    }

    async getContractsFor(symbol: string): Promise<any> {
        try {
            const response = await this.request({
                contracts_for: symbol,
                currency: 'USD',
                product_type: 'basic',
            });
            return response.contracts_for || null;
        } catch (err: any) {
            return { error: err.message };
        }
    }

    async getTickHistory(symbol: string, count: number = 10): Promise<any> {
        try {
            const response = await this.request({
                ticks_history: symbol,
                count,
                end: 'latest',
                style: 'ticks',
            });
            return response.history || null;
        } catch (err: any) {
            return { error: err.message };
        }
    }

    async getCandles(symbol: string, interval: number = 60, count: number = 10): Promise<any> {
        try {
            const response = await this.request({
                ohlc: symbol,
                end: 'latest',
                count,
                granularity: interval,
            });
            return response.ohlc || null;
        } catch (err: any) {
            return { error: err.message };
        }
    }

    async getProposal(symbol: string, contractType: string = 'CALL'): Promise<any> {
        try {
            const response = await this.request({
                proposal: 1,
                amount: 10,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration: 1,
                duration_unit: 'm',
                symbol,
            });
            return response.proposal || null;
        } catch (err: any) {
            return { error: err.message };
        }
    }

    async investigateIndex(symbol: string): Promise<void> {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 Investigating: ${symbol}`);
        console.log('='.repeat(80));

        // 1. Get symbol info
        const symbolInfo = await this.getSymbolInfo(symbol);
        if (!symbolInfo) {
            console.log(`❌ Symbol not found: ${symbol}`);
            return;
        }

        console.log(`\n📋 Symbol Information:`);
        console.log(`   Display Name: ${symbolInfo.display_name || 'N/A'}`);
        console.log(`   Market: ${symbolInfo.market || 'N/A'}`);
        console.log(`   Submarket: ${symbolInfo.submarket || 'N/A'}`);
        console.log(`   Market Display: ${symbolInfo.market_display_name || 'N/A'}`);
        console.log(`   Submarket Display: ${symbolInfo.submarket_display_name || 'N/A'}`);
        console.log(`   Trading Suspended: ${symbolInfo.is_trading_suspended || 0}`);
        console.log(`   Exchange Open: ${symbolInfo.exchange_is_open || 0}`);
        console.log(`   Pip Size: ${symbolInfo.pip || 'N/A'}`);

        // 2. Get available contracts
        console.log(`\n📦 Available Contracts:`);
        const contracts = await this.getContractsFor(symbol);
        if (contracts.error) {
            console.log(`   ❌ Error: ${contracts.error}`);
        } else if (contracts.available) {
            const contractTypes = contracts.available.map((c: any) => ({
                type: c.contract_type,
                category: c.contract_category,
                display: c.contract_display,
                minDuration: c.min_contract_duration,
                maxDuration: c.max_contract_duration,
            }));

            console.log(`   Found ${contractTypes.length} contract types:`);
            for (const ct of contractTypes) {
                console.log(`   - ${ct.type} (${ct.category}): ${ct.minDuration} - ${ct.maxDuration}`);
            }

            // Check for multiplier support
            const hasMultiplier = contractTypes.some((ct: any) => 
                ct.type === 'MULTUP' || ct.type === 'MULTDOWN'
            );
            console.log(`   ${hasMultiplier ? '✅' : '❌'} Multiplier Support: ${hasMultiplier ? 'YES' : 'NO'}`);
        } else {
            console.log(`   ⚠️  No contracts available`);
        }

        // 3. Get current price (tick)
        console.log(`\n💰 Current Price:`);
        const tickHistory = await this.getTickHistory(symbol, 1);
        if (tickHistory && tickHistory.prices && tickHistory.prices.length > 0) {
            const latestTick = tickHistory.prices[tickHistory.prices.length - 1];
            console.log(`   Latest Tick: ${latestTick.quote || 'N/A'}`);
            if (latestTick.epoch) {
                try {
                    console.log(`   Time: ${new Date(latestTick.epoch * 1000).toISOString()}`);
                } catch {
                    console.log(`   Time: ${latestTick.epoch}`);
                }
            }
        } else {
            console.log(`   ⚠️  No tick data available`);
        }

        // 4. Get candles
        console.log(`\n📈 Historical Candles (1m, last 10):`);
        const candles = await this.getCandles(symbol, 60, 10);
        if (candles && candles.candles && candles.candles.length > 0) {
            console.log(`   Found ${candles.candles.length} candles`);
            const latest = candles.candles[candles.candles.length - 1];
            console.log(`   Latest: O=${latest.open}, H=${latest.high}, L=${latest.low}, C=${latest.close}`);
            console.log(`   Time: ${new Date(latest.epoch * 1000).toISOString()}`);
        } else {
            console.log(`   ⚠️  No candle data available`);
        }

        // 5. Get proposal (if multiplier available)
        if (contracts.available) {
            const hasMultiplier = contracts.available.some((c: any) => 
                c.contract_type === 'MULTUP' || c.contract_type === 'MULTDOWN'
            );
            
            if (hasMultiplier) {
                console.log(`\n💵 Multiplier Proposal (1 min, $10 stake):`);
                const proposal = await this.getProposal(symbol, 'MULTUP');
                if (proposal && !proposal.error) {
                    console.log(`   Spot: ${proposal.spot}`);
                    console.log(`   Ask Price: ${proposal.ask_price}`);
                    console.log(`   Payout: ${proposal.payout}`);
                    if (proposal.limit_order) {
                        console.log(`   Limit Order Support: YES`);
                        console.log(`   Max TP: ${proposal.limit_order.take_profit?.max || 'N/A'}`);
                        console.log(`   Max SL: ${proposal.limit_order.stop_loss?.max || 'N/A'}`);
                    }
                } else {
                    console.log(`   ⚠️  Could not get proposal: ${proposal?.error || 'Unknown error'}`);
                }
            }
        }
    }

    async run(): Promise<void> {
        try {
            await this.connect();
            await this.authorize();

            console.log('\n' + '═'.repeat(80));
            console.log('🔍 STOCK INDICES INVESTIGATION');
            console.log('═'.repeat(80));

            // First, get all stock indices from active symbols
            console.log(`\n📊 Fetching all stock indices from Deriv...`);
            const allSymbols = await this.getActiveSymbols();
            const stockIndices = allSymbols.filter((s: any) => 
                s.market === 'stock_index' || 
                s.market_display_name === 'Stock Indices' ||
                s.symbol.startsWith('OTC_')
            );

            console.log(`\n📋 Found ${stockIndices.length} stock indices:`);
            const indexSymbols = stockIndices.map((s: any) => s.symbol);
            console.log(`   ${indexSymbols.slice(0, 20).join(', ')}${indexSymbols.length > 20 ? '...' : ''}`);

            // Investigate specific indices
            for (const symbol of STOCK_INDICES_TO_CHECK) {
                await this.investigateIndex(symbol);
                await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
            }

            // Summary
            console.log(`\n\n${'═'.repeat(80)}`);
            console.log('📊 SUMMARY');
            console.log('═'.repeat(80));

            const summary: Array<{
                symbol: string;
                name: string;
                hasMultiplier: boolean;
                isOpen: boolean;
                contracts: number;
            }> = [];

            for (const symbol of STOCK_INDICES_TO_CHECK) {
                const info = await this.getSymbolInfo(symbol);
                if (info) {
                    const contracts = await this.getContractsFor(symbol);
                    const hasMultiplier = contracts.available?.some((c: any) => 
                        c.contract_type === 'MULTUP' || c.contract_type === 'MULTDOWN'
                    ) || false;

                    summary.push({
                        symbol,
                        name: info.display_name || symbol,
                        hasMultiplier,
                        isOpen: info.exchange_is_open === 1,
                        contracts: contracts.available?.length || 0,
                    });
                }
            }

            console.log(`\n${'Symbol'.padEnd(15)} │ ${'Name'.padEnd(30)} │ Multiplier │ Open │ Contracts`);
            console.log('─'.repeat(80));
            for (const s of summary) {
                console.log(
                    `${s.symbol.padEnd(15)} │ ${s.name.padEnd(30)} │ ${s.hasMultiplier ? '✅ YES'.padEnd(11) : '❌ NO'.padEnd(11)} │ ${s.isOpen ? '✅' : '❌'}   │ ${s.contracts}`
                );
            }

            console.log('\n' + '═'.repeat(80));

        } catch (error) {
            console.error('Error:', error);
        } finally {
            if (this.ws) {
                this.ws.close();
            }
        }
    }
}

// Run
const investigator = new StockIndicesInvestigator();
investigator.run().catch(console.error);

