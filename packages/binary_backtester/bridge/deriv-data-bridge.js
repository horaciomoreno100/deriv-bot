/**
 * Bridge between Deriv Gateway and Python Backtester
 * 
 * This script uses the gateway to fetch real data from Deriv API
 * and saves it in the format expected by the Python backtester.
 */

import { DerivClient } from '@deriv-bot/gateway';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

class DerivDataBridge {
    constructor() {
        this.client = null;
        this.dataPath = 'data';
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        if (!existsSync(this.dataPath)) {
            mkdirSync(this.dataPath, { recursive: true });
        }
    }

    async connect(appId, token) {
        console.log('🔌 Connecting to Deriv API via Gateway...');

        this.client = new DerivClient({
            appId: parseInt(appId),
            token: token,
            endpoint: 'wss://ws.derivws.com/websockets/v3'
        });

        await this.client.connect();
        console.log('✅ Connected to Deriv API');
    }

    async fetchHistoricalData(symbol, timeframe, days = 1) {
        console.log(`📊 Fetching ${days} days of data for ${symbol}...`);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        try {
            // Get historical candles
            const candles = await this.client.getCandles({
                symbol: symbol,
                granularity: this.timeframeToGranularity(timeframe),
                start: Math.floor(startDate.getTime() / 1000),
                end: Math.floor(endDate.getTime() / 1000)
            });

            console.log(`✅ Fetched ${candles.length} candles`);

            // Save in format expected by Python backtester
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `deriv_candles_${timestamp}.json`;
            const filepath = join(this.dataPath, filename);

            writeFileSync(filepath, JSON.stringify(candles, null, 2));
            console.log(`💾 Data saved to: ${filepath}`);

            return {
                filename,
                filepath,
                candles: candles.length,
                symbol,
                timeframe,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            };

        } catch (error) {
            console.error('❌ Error fetching data:', error);
            throw error;
        }
    }

    async fetchRealTimeData(symbol, count = 100) {
        console.log(`📡 Fetching ${count} real-time ticks for ${symbol}...`);

        try {
            const ticks = await this.client.getTicks(symbol, count);
            console.log(`✅ Fetched ${ticks.length} ticks`);
            return ticks;
        } catch (error) {
            console.error('❌ Error fetching real-time data:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            console.log('🔌 Disconnected from Deriv API');
        }
    }

    timeframeToGranularity(timeframe) {
        // Convert seconds to Deriv granularity
        if (timeframe <= 60) return 60; // 1 minute
        if (timeframe <= 300) return 300; // 5 minutes
        if (timeframe <= 900) return 900; // 15 minutes
        if (timeframe <= 3600) return 3600; // 1 hour
        if (timeframe <= 86400) return 86400; // 1 day
        return 86400; // Default to 1 day
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

    const bridge = new DerivDataBridge();

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

// Export for programmatic use
export { DerivDataBridge };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
