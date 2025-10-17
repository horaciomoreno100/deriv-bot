#!/usr/bin/env node
/**
 * Download 30 days of Deriv data for backtesting
 */

import { DerivClient } from '../../gateway/dist/api/deriv-client.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

class DerivDataDownloader {
    constructor() {
        this.client = null;
        this.dataPath = '../data';
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        if (!existsSync(this.dataPath)) {
            mkdirSync(this.dataPath, { recursive: true });
        }
    }

    async connect() {
        console.log('🔌 Connecting to Deriv API...');
        
        this.client = new DerivClient({
            appId: 1089, // Using the app ID from the gateway
            endpoint: 'wss://ws.derivws.com/websockets/v3'
        });

        await this.client.connect();
        console.log('✅ Connected to Deriv API');
    }

    async fetchHistoricalData(symbol, timeframe, days = 30) {
        console.log(`📊 Fetching ${days} days of data for ${symbol}...`);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        try {
            // Get historical candles
            const candles = await this.client.getCandles(symbol, {
                granularity: this.timeframeToGranularity(timeframe),
                count: 1000, // Maximum candles per request
                start: Math.floor(startDate.getTime() / 1000),
                end: Math.floor(endDate.getTime() / 1000)
            });

            console.log(`✅ Fetched ${candles.length} candles`);
            console.log(`   Period: ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
            console.log(`   Timeframe: ${timeframe} seconds`);

            // Save data
            const filename = `${symbol}_${timeframe}s_${days}days_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            const filepath = join(this.dataPath, filename);
            
            const data = {
                symbol: symbol,
                timeframe: timeframe,
                days: days,
                candles: candles,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                totalCandles: candles.length
            };

            writeFileSync(filepath, JSON.stringify(data, null, 2));
            console.log(`💾 Saved to: ${filepath}`);

            return {
                filename,
                candles: candles.length,
                period: `${startDate.toISOString()} to ${endDate.toISOString()}`
            };

        } catch (error) {
            console.error('❌ Error fetching data:', error);
            throw error;
        }
    }

    timeframeToGranularity(timeframe) {
        const mapping = {
            60: 60,      // 1 minute
            300: 300,    // 5 minutes
            900: 900,    // 15 minutes
            3600: 3600,  // 1 hour
            86400: 86400 // 1 day
        };
        return mapping[timeframe] || 60;
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            console.log('🔌 Disconnected from Deriv API');
        }
    }
}

async function main() {
    console.log('🎯 DERIV 30-DAY DATA DOWNLOADER');
    console.log('================================\n');

    const downloader = new DerivDataDownloader();

    try {
        // Connect
        await downloader.connect();

        // Download data for different symbols
        const symbols = [
            { symbol: 'R_100', timeframe: 60, days: 30 },  // Volatility 100
            { symbol: 'R_75', timeframe: 60, days: 30 },  // Volatility 75
            { symbol: 'frxXAUUSD', timeframe: 60, days: 30 }, // Gold
        ];

        for (const config of symbols) {
            console.log(`\n📊 Downloading ${config.symbol}...`);
            const result = await downloader.fetchHistoricalData(
                config.symbol, 
                config.timeframe, 
                config.days
            );
            console.log(`✅ ${config.symbol}: ${result.candles} candles downloaded`);
        }

        console.log('\n🎯 DOWNLOAD COMPLETED!');
        console.log('======================');
        console.log('✅ 30 days of data downloaded for multiple symbols');
        console.log('✅ Ready for backtesting with robust dataset');
        console.log('✅ Run: python examples/test_optimized_reversal_hunter.py');

    } catch (error) {
        console.error('❌ Download failed:', error);
        process.exit(1);
    } finally {
        await downloader.disconnect();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { DerivDataDownloader };
