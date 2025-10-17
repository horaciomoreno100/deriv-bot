/**
 * Simple bridge that connects directly to Deriv API
 * No dependencies on the gateway package
 */

import WebSocket from 'ws';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

class SimpleDerivBridge {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isAuthorized = false;
        this.dataPath = 'data';
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        if (!existsSync(this.dataPath)) {
            mkdirSync(this.dataPath, { recursive: true });
        }
    }

    async connect(appId, token) {
        console.log('🔌 Connecting directly to Deriv API...');

        const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('✅ WebSocket connected');
                this.isConnected = true;

                // Authorize
                this.ws.send(JSON.stringify({ authorize: token }));
            });

            this.ws.on('message', (data) => {
                const message = JSON.parse(data);

                if (message.authorize) {
                    if (message.authorize.loginid) {
                        console.log('✅ Authorized successfully');
                        this.isAuthorized = true;
                        resolve(true);
                    } else {
                        console.error('❌ Authorization failed:', message.error);
                        reject(new Error('Authorization failed'));
                    }
                }
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('🔌 WebSocket closed');
                this.isConnected = false;
                this.isAuthorized = false;
            });
        });
    }

    async fetchHistoricalData(symbol, timeframe, days = 1) {
        console.log(`📊 Fetching ${days} days of data for ${symbol}...`);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        return new Promise((resolve, reject) => {
            const request = {
                ticks_history: symbol,
                adjust_start_time: 1,
                count: days * 24 * 60, // Approximate candles for the period
                end: "latest",
                start: 1,
                style: "candles",
                granularity: this.timeframeToGranularity(timeframe)
            };

            this.ws.send(JSON.stringify(request));

            this.ws.on('message', (data) => {
                const response = JSON.parse(data);

                if (response.candles) {
                    console.log(`✅ Fetched ${response.candles.length} candles`);

                    // Save data
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const filename = `deriv_candles_${timestamp}.json`;
                    const filepath = join(this.dataPath, filename);

                    writeFileSync(filepath, JSON.stringify(response.candles, null, 2));
                    console.log(`💾 Data saved to: ${filepath}`);

                    resolve({
                        filename,
                        filepath,
                        candles: response.candles.length,
                        symbol,
                        timeframe,
                        startDate: startDate.toISOString(),
                        endDate: endDate.toISOString()
                    });
                } else if (response.error) {
                    console.error('❌ Error fetching data:', response.error);
                    reject(new Error(response.error.message));
                }
            });
        });
    }

    async disconnect() {
        if (this.ws) {
            this.ws.close();
            console.log('🔌 Disconnected from Deriv API');
        }
    }

    timeframeToGranularity(timeframe) {
        if (timeframe <= 60) return 60;
        if (timeframe <= 300) return 300;
        if (timeframe <= 900) return 900;
        if (timeframe <= 3600) return 3600;
        if (timeframe <= 86400) return 86400;
        return 86400;
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const symbol = args[0] || 'frxXAUUSD';
    const timeframe = parseInt(args[1]) || 60;
    const days = parseInt(args[2]) || 1;
    const appId = process.env.DERIV_APP_ID || '106646';
    const token = process.env.DERIV_TOKEN;

    if (!token) {
        console.error('❌ DERIV_TOKEN environment variable is required');
        process.exit(1);
    }

    const bridge = new SimpleDerivBridge();

    try {
        await bridge.connect(appId, token);

        const result = await bridge.fetchHistoricalData(symbol, timeframe, days);

        console.log('\n📊 DATA FETCH SUMMARY');
        console.log('='.repeat(40));
        console.log(`Symbol: ${result.symbol}`);
        console.log(`Timeframe: ${result.timeframe}s`);
        console.log(`Period: ${result.startDate} to ${result.endDate}`);
        console.log(`Candles: ${result.candles}`);
        console.log(`File: ${result.filename}`);
        console.log('\n✅ Data ready for Python backtester!');
        console.log('💡 Run: python examples/run_backtest.py');

    } catch (error) {
        console.error('❌ Bridge failed:', error);
        process.exit(1);
    } finally {
        await bridge.disconnect();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
